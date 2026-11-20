//! Staff routes: the free-text review queue (15 section 16, 18 section 4.3).

#[cfg(test)]
mod flow_tests;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::audit;
use crate::auth::Moderator;
use crate::db::pagination::{Page, PageParams};
use crate::db::review::{self, ModeratedField, TextCursor, TextRow, text_sha256};
use crate::domain::options::Gender;
use crate::domain::types::{AuditTargetType, NotificationType, TextStatus};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::notify::notify;
use crate::state::AppState;

/// Longest note to the member (18 section 4.3 rule 2).
const MAX_NOTE_CHARS: usize = 300;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_texts))
        .routes(routes!(approve_text))
        .routes(routes!(reject_text))
}

/// A text waiting for a person (18 section 4.3).
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminTextItem {
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    pub gender: Option<Gender>,
    pub field: ModeratedField,
    pub text: String,
    /// Hex SHA-256 of `text`. Send it back with the decision.
    pub text_sha256: String,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct TextQuery {
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
}

/// Pending texts that no queued or running `moderate_text` job is about to decide, oldest
/// first. Cursor pagination.
#[utoipa::path(
    get,
    path = "/texts",
    tag = "admin",
    security(("bearer" = [])),
    params(TextQuery),
    responses((status = 200, body = Page<AdminTextItem>), (status = 403, body = ErrorBody))
)]
async fn list_texts(
    State(state): State<AppState>,
    _moderator: Moderator,
    ApiQuery(query): ApiQuery<TextQuery>,
) -> ApiResult<Json<Page<AdminTextItem>>> {
    let page = PageParams {
        limit: query.limit,
        cursor: query.cursor,
    };
    let limit = page.limit();
    let after: Option<TextCursor> = page.cursor()?;
    let rows = review::text_queue(&state.db, after.as_ref(), limit + 1).await?;
    Ok(Json(Page::from_rows(
        rows,
        limit,
        |row| TextCursor {
            updated_at: row.updated_at,
            profile_id: row.profile_id,
            field: row.field.as_str().to_owned(),
        },
        |row| {
            let text = row.text.unwrap_or_default();
            AdminTextItem {
                profile_id: row.profile_id,
                public_code: row.public_code,
                first_name: row.first_name,
                gender: row.gender,
                field: row.field,
                text_sha256: text_sha256(&text),
                text,
                updated_at: row.updated_at,
            }
        },
    )))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ApproveText {
    /// The hash of the text the moderator read.
    pub text_sha256: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RejectText {
    /// The hash of the text the moderator read.
    pub text_sha256: String,
    /// Shown to the member, at most 300 characters.
    pub note: Option<String>,
}

/// Loads the text under lock and checks that it is still the one the moderator read and still
/// waiting (18 section 4.3 rule 1): otherwise `409 invalid_state` and the screen reloads.
async fn lock_text_for_decision(
    tx: &mut sqlx::PgConnection,
    profile_id: Uuid,
    field: ModeratedField,
    text_sha256_read: &str,
) -> ApiResult<TextRow> {
    let row = review::load_text(&mut *tx, profile_id, field, true)
        .await?
        .ok_or(ApiError::NotFound)?;
    let current = row.text.as_deref().unwrap_or_default();
    if row.status != TextStatus::Pending || text_sha256(current) != text_sha256_read {
        return Err(ApiError::invalid_state(row.status));
    }
    Ok(row)
}

/// Approves a pending text. No notification (18 section 4.3); `text.approve` is audited.
/// Answers `204`. `409 invalid_state` when the text changed or was decided already.
#[utoipa::path(
    post,
    path = "/texts/{profile_id}/{field}/approve",
    tag = "admin",
    security(("bearer" = [])),
    params(
        ("profile_id" = Uuid, Path, description = "The profile"),
        ("field" = ModeratedField, Path, description = "about_me, about_family or partner_notes")
    ),
    request_body = ApproveText,
    responses(
        (status = 204),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn approve_text(
    State(state): State<AppState>,
    moderator: Moderator,
    ApiPath((profile_id, field)): ApiPath<(Uuid, ModeratedField)>,
    ApiJson(body): ApiJson<ApproveText>,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    let row = lock_text_for_decision(&mut tx, profile_id, field, &body.text_sha256).await?;
    review::set_text_status_if_unchanged(
        &mut tx,
        profile_id,
        field,
        row.text.as_deref(),
        TextStatus::Approved,
    )
    .await?;
    audit::record(
        &mut tx,
        moderator.user_id,
        "text.approve",
        AuditTargetType::Profile,
        &profile_id.to_string(),
        json!({ "field": field, "text_sha256": body.text_sha256 }),
    )
    .await?;
    tx.commit().await?;
    tracing::info!(profile_id = %profile_id, %field, result = "approved", source = "moderator", "text decided");
    Ok(StatusCode::NO_CONTENT)
}

/// Rejects a pending text. The owner gets a `text_rejected` notification carrying the field and
/// the note; `text.reject` is audited. Answers `204`. `409 invalid_state` when the text changed
/// or was decided already.
#[utoipa::path(
    post,
    path = "/texts/{profile_id}/{field}/reject",
    tag = "admin",
    security(("bearer" = [])),
    params(
        ("profile_id" = Uuid, Path, description = "The profile"),
        ("field" = ModeratedField, Path, description = "about_me, about_family or partner_notes")
    ),
    request_body = RejectText,
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn reject_text(
    State(state): State<AppState>,
    moderator: Moderator,
    ApiPath((profile_id, field)): ApiPath<(Uuid, ModeratedField)>,
    ApiJson(body): ApiJson<RejectText>,
) -> ApiResult<StatusCode> {
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_owned);
    if note
        .as_ref()
        .is_some_and(|note| note.chars().count() > MAX_NOTE_CHARS)
    {
        return Err(ApiError::field("note", FieldCode::TooLong));
    }

    let mut tx = state.db.begin().await?;
    let row = lock_text_for_decision(&mut tx, profile_id, field, &body.text_sha256).await?;
    review::set_text_status_if_unchanged(
        &mut tx,
        profile_id,
        field,
        row.text.as_deref(),
        TextStatus::Rejected,
    )
    .await?;
    audit::record(
        &mut tx,
        moderator.user_id,
        "text.reject",
        AuditTargetType::Profile,
        &profile_id.to_string(),
        json!({ "field": field, "text_sha256": body.text_sha256, "note": note }),
    )
    .await?;
    tx.commit().await?;

    tracing::info!(profile_id = %profile_id, %field, result = "rejected", source = "moderator", "text decided");
    if let Err(error) = notify(
        &state,
        row.user_id,
        NotificationType::TextRejected,
        None,
        json!({ "field": field, "note": note }),
    )
    .await
    {
        tracing::warn!(%error, "could not notify about a rejected text");
    }
    Ok(StatusCode::NO_CONTENT)
}
