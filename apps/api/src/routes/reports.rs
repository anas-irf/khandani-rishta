//! Member reports, `POST /v1/reports` (15 section 13, 13 section 6).
//!
//! The member side of T-504: filing only. Triage, outcomes and sanctions belong to the staff
//! routes. Filing a report never changes anything for the reported member (03 section 4.11);
//! the only side effect is the optional block the reporter asked for.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use super::relations::after_block;
use crate::auth::Connected;
use crate::db::reports::{self as db, Filed, NewReport, Subject};
use crate::domain::options::ReportReason;
use crate::domain::text_rules::tidy_multiline;
use crate::domain::time::{karachi_date, next_karachi_midnight};
use crate::domain::types::ReportSubject;
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode, FieldErrors};
use crate::extract::ApiJson;
use crate::state::AppState;
use crate::views;

/// Longest `details` text in characters (04 section 9.1, 13 section 6.2).
const DETAILS_MAX_CHARS: usize = 1000;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(file_report))
}

/// `POST /v1/reports`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FileReportBody {
    /// The reported member.
    pub target_profile_id: Uuid,
    pub subject_type: ReportSubject,
    /// Required for `photo`, not allowed otherwise: an approved photo of the target.
    pub photo_id: Option<Uuid>,
    /// Required for `message`, not allowed otherwise: a message the target sent in a
    /// connection the caller belongs to.
    pub message_id: Option<Uuid>,
    /// A `report_reason` code (05 section 2.42).
    #[schema(value_type = ReportReason)]
    pub reason: String,
    /// Optional, at most 1,000 characters. Length is the only rule: a report may need to quote
    /// a phone number or abusive words (13 section 3.1, "Not checked").
    pub details: Option<String>,
    /// Block the target in the same transaction. Default `false`.
    pub also_block: Option<bool>,
}

/// The filed report.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReportFiled {
    pub id: Uuid,
}

/// A body that passed validation.
struct Checked {
    subject: Subject,
    reason: ReportReason,
    details: Option<String>,
}

/// Field rules of the body: the reason code, the subject and its id, the length of `details`.
fn check(body: &FileReportBody) -> ApiResult<Checked> {
    let mut errors = FieldErrors::new();
    let reason = ReportReason::parse(&body.reason);
    if reason.is_none() {
        errors.add("reason", FieldCode::UnknownCode);
    }
    let kind = body.subject_type;
    if kind == ReportSubject::Photo && body.photo_id.is_none() {
        errors.add("photo_id", FieldCode::Required);
    }
    if kind == ReportSubject::Message && body.message_id.is_none() {
        errors.add("message_id", FieldCode::Required);
    }
    if kind != ReportSubject::Photo && body.photo_id.is_some() {
        errors.add("photo_id", FieldCode::NotAllowed);
    }
    if kind != ReportSubject::Message && body.message_id.is_some() {
        errors.add("message_id", FieldCode::NotAllowed);
    }
    let details = body
        .details
        .as_deref()
        .map(tidy_multiline)
        .filter(|details| !details.is_empty());
    if details
        .as_deref()
        .is_some_and(|details| details.chars().count() > DETAILS_MAX_CHARS)
    {
        errors.add("details", FieldCode::TooLong);
    }
    errors.finish()?;

    let subject = match kind {
        ReportSubject::Profile => Some(Subject::Profile),
        ReportSubject::Photo => body.photo_id.map(Subject::Photo),
        ReportSubject::Message => body.message_id.map(Subject::Message),
    };
    // Both are present once no field error was added.
    let (Some(subject), Some(reason)) = (subject, reason) else {
        return Err(ApiError::BadRequest("invalid report".to_owned()));
    };
    Ok(Checked {
        subject,
        reason,
        details,
    })
}

/// Report a member, a photo or a message. The caller must be able to see the subject, else
/// `404 not_found` (13 section 6.1): the target through the visibility rules for a profile or
/// a photo (an `approved` photo of the target), a connection the caller belongs to for a
/// message (one the target sent; an ended connection counts).
///
/// The context is captured at filing time (13 section 6.3): the profile text fields, the photo
/// keys, or for a message the 20 messages before it, the message and the 5 after it from that
/// connection only. At most `limits.reports_per_day` reports a day (`429 limit_reached`); a
/// report on a subject the caller already has an `open` or `in_review` report on returns that
/// report's id and creates nothing. With `also_block` the block is applied in the same
/// transaction, also for that repeated report. Answers `201` with the report id. The reported
/// member is not told and nothing changes for them.
#[utoipa::path(
    post,
    path = "/reports",
    tag = "relations",
    security(("bearer" = [])),
    request_body = FileReportBody,
    responses(
        (status = 201, body = ReportFiled),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn file_report(
    State(state): State<AppState>,
    account: Connected,
    ApiJson(body): ApiJson<FileReportBody>,
) -> ApiResult<(StatusCode, Json<ReportFiled>)> {
    let checked = check(&body)?;
    let target = body.target_profile_id;
    // Step 1 for the profile and its photos: the target must be one the caller can open (a
    // member cannot report themselves: `can_open` answers `None` for their own profile). A
    // message is judged by its connection instead, so a member can still report what an
    // ex-connection or a since-hidden member said.
    if target == account.profile_id {
        return Err(ApiError::NotFound);
    }
    if !matches!(checked.subject, Subject::Message(_)) {
        let viewer = views::viewer(&state, account.profile_id).await?;
        views::can_open(&state, &viewer, target)
            .await?
            .ok_or(ApiError::NotFound)?;
    }

    let settings = state.settings.get().await?;
    let now = OffsetDateTime::now_utc();
    let filed = db::file(
        &state.db,
        &NewReport {
            reporter: account.profile_id,
            target,
            subject: checked.subject,
            reason: checked.reason,
            details: checked.details.as_deref(),
            also_block: body.also_block.unwrap_or(false),
            today: karachi_date(now),
            daily_limit: settings.reports_per_day,
        },
    )
    .await?;
    match filed {
        Filed::NotFound => Err(ApiError::NotFound),
        Filed::LimitReached { used } => {
            tracing::info!(event = "limit.reached", limit = "reports_per_day");
            Err(ApiError::LimitReached {
                limit: "reports_per_day",
                used,
                resets_at: Some(next_karachi_midnight(now)),
                side: None,
            })
        }
        Filed::Done { id, created, block } => {
            if created {
                tracing::info!(event = "report.filed", reason = %checked.reason);
            }
            if let Some(effects) = block {
                after_block(&state, account.profile_id, target, &effects).await;
            }
            Ok((StatusCode::CREATED, Json(ReportFiled { id })))
        }
    }
}

#[cfg(test)]
#[path = "reports_tests.rs"]
mod tests;
