//! Staff routes: the verification review queue (15 section 16, 18 section 4.4, 12).
//!
//! The detail route is the only place an identity number is decrypted, and every call to it
//! writes a `verification.view` audit row before anything is returned (20 section 1, S-14).

use std::time::Duration;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::{Date, OffsetDateTime};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::audit;
use crate::auth::Moderator;
use crate::db::pagination::{Page, PageParams};
use crate::db::photos as photos_db;
use crate::db::review::{
    self, Approval, VerificationCursor, VerificationQueueRow, VerificationRow,
};
use crate::domain::options::{
    DocumentType, Gender, ManagedBy, MaritalStatus, VerificationRejectionReason,
};
use crate::domain::time::{age_now, karachi_date};
use crate::domain::types::{
    AuditTargetType, IdentityStatus, NotificationType, PhotoStatus, VerificationKind,
    VerificationStatus,
};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::verifications::challenge_for;
use crate::notify::{notify, queue_email};
use crate::state::AppState;

// `time` writes a `Date` as `[year, ordinal]` unless told otherwise; the API contract has
// `YYYY-MM-DD` (15 section 1).
time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// Validity of the signed image URLs (12 section 6).
const IMAGE_URL_TTL: Duration = Duration::from_mins(10);
/// Longest staff-only note.
const MAX_NOTE_CHARS: usize = 500;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_verifications))
        .routes(routes!(get_verification))
        .routes(routes!(approve_verification))
        .routes(routes!(reject_verification))
}

// ---------------------------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------------------------

/// A request in the queue (18 section 4.4).
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminVerificationListItem {
    pub request_id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<VerificationQueueRow> for AdminVerificationListItem {
    fn from(row: VerificationQueueRow) -> Self {
        Self {
            request_id: row.request_id,
            kind: row.kind,
            status: row.status,
            profile_id: row.profile_id,
            public_code: row.public_code,
            first_name: row.first_name,
            created_at: row.created_at,
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct VerificationQuery {
    /// `pending` (default), `approved`, `rejected` or `cancelled`.
    pub status: Option<VerificationStatus>,
    pub kind: Option<VerificationKind>,
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
}

/// The verification queue, oldest first. Cursor pagination.
#[utoipa::path(
    get,
    path = "/verifications",
    tag = "admin",
    security(("bearer" = [])),
    params(VerificationQuery),
    responses((status = 200, body = Page<AdminVerificationListItem>), (status = 403, body = ErrorBody))
)]
async fn list_verifications(
    State(state): State<AppState>,
    _moderator: Moderator,
    ApiQuery(query): ApiQuery<VerificationQuery>,
) -> ApiResult<Json<Page<AdminVerificationListItem>>> {
    let page = PageParams {
        limit: query.limit,
        cursor: query.cursor,
    };
    let limit = page.limit();
    let after: Option<VerificationCursor> = page.cursor()?;
    let rows = review::verification_queue(
        &state.db,
        query.status.unwrap_or(VerificationStatus::Pending),
        query.kind,
        after.as_ref(),
        limit + 1,
    )
    .await?;
    Ok(Json(Page::from_rows(
        rows,
        limit,
        |row| VerificationCursor {
            created_at: row.created_at,
            id: row.request_id,
        },
        AdminVerificationListItem::from,
    )))
}

// ---------------------------------------------------------------------------------------------
// The detail
// ---------------------------------------------------------------------------------------------

/// Signed image URLs, valid for 10 minutes. `null` when the slot was not used or the image has
/// been purged.
#[derive(Debug, Serialize, ToSchema)]
#[expect(
    clippy::struct_field_names,
    reason = "the field names are the API contract of 18 section 4.4"
)]
pub struct AdminVerificationImages {
    pub front_url: Option<String>,
    pub back_url: Option<String>,
    pub selfie_url: Option<String>,
}

/// The registered identity of an `id_document` request.
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminVerificationIdentity {
    pub document_type: DocumentType,
    /// Decrypted, formatted `#####-#######-#` for the 13-digit document types.
    pub number: String,
    pub status: IdentityStatus,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminApprovedPhoto {
    pub photo_id: Uuid,
    pub status: PhotoStatus,
    pub is_primary: bool,
    pub large_url: String,
}

/// The profile data to compare with the documents.
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminVerificationProfile {
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    /// `YYYY-MM-DD`.
    #[serde(with = "iso_date::option")]
    #[schema(value_type = Option<String>, format = Date)]
    pub date_of_birth: Option<Date>,
    pub age: Option<i32>,
    pub marital_status: Option<MaritalStatus>,
    pub managed_by: Option<ManagedBy>,
    pub manager_name: Option<String>,
    /// The approved photos, for comparison with the selfie.
    pub photos: Vec<AdminApprovedPhoto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminPreviousRequest {
    pub id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub rejection_reason: Option<VerificationRejectionReason>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// One request in full (18 section 4.4).
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminVerificationDetail {
    pub request_id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub gesture: String,
    /// The gesture equals the challenge of the submission day or the day before.
    pub gesture_valid: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub images: AdminVerificationImages,
    pub media_purged: bool,
    /// `null` for a selfie request.
    pub identity: Option<AdminVerificationIdentity>,
    pub profile: AdminVerificationProfile,
    pub previous_requests: Vec<AdminPreviousRequest>,
}

/// `#####-#######-#` for a 13-digit number of a card type; any other number as it is stored.
fn format_number(document_type: DocumentType, number: &str) -> String {
    let is_card = !matches!(document_type, DocumentType::Passport);
    if is_card && number.len() == 13 && number.is_ascii() {
        format!("{}-{}-{}", &number[..5], &number[5..12], &number[12..])
    } else {
        number.to_owned()
    }
}

async fn sign(state: &AppState, key: Option<&str>) -> ApiResult<Option<String>> {
    match key {
        Some(key) => Ok(Some(state.storage.presign_get(key, IMAGE_URL_TTL).await?)),
        None => Ok(None),
    }
}

/// The registered identity of an identity check, decrypted. The only place a number is read.
async fn load_identity(
    state: &AppState,
    request: &VerificationRow,
) -> ApiResult<Option<AdminVerificationIdentity>> {
    if request.kind != VerificationKind::IdDocument {
        return Ok(None);
    }
    let Some(record) = review::identity_record(&state.db, request.profile_id).await? else {
        return Ok(None);
    };
    let number = state
        .crypto
        .decrypt_identity(request.profile_id, &record.number_encrypted)
        .map_err(|_| {
            ApiError::Internal(anyhow::anyhow!("an identity number could not be decrypted"))
        })?;
    Ok(Some(AdminVerificationIdentity {
        document_type: record.document_type,
        number: format_number(record.document_type, &number),
        status: record.status,
    }))
}

/// The profile's approved photos with signed URLs, for comparison with the selfie.
async fn approved_photos(state: &AppState, profile_id: Uuid) -> ApiResult<Vec<AdminApprovedPhoto>> {
    let mut photos = Vec::new();
    for photo in photos_db::list(&state.db, profile_id).await? {
        if photo.status == PhotoStatus::Approved
            && let Some(key) = &photo.key_large
        {
            photos.push(AdminApprovedPhoto {
                photo_id: photo.id,
                status: photo.status,
                is_primary: photo.is_primary,
                large_url: state.storage.presign_photo(key).await?,
            });
        }
    }
    Ok(photos)
}

/// Signed URLs for the images that are still stored.
async fn images_of(
    state: &AppState,
    request: &VerificationRow,
) -> ApiResult<AdminVerificationImages> {
    Ok(AdminVerificationImages {
        front_url: sign(state, request.front_key.as_deref()).await?,
        back_url: sign(state, request.back_key.as_deref()).await?,
        selfie_url: sign(state, request.selfie_key.as_deref()).await?,
    })
}

/// A request with its images, the registered number and the profile to compare with. Every call
/// writes a `verification.view` audit row, also for requests already decided; the row and the
/// response stand or fall together. The response is not cacheable.
#[utoipa::path(
    get,
    path = "/verifications/{request_id}",
    tag = "admin",
    security(("bearer" = [])),
    params(("request_id" = Uuid, Path, description = "The request")),
    responses(
        (status = 200, body = AdminVerificationDetail),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_verification(
    State(state): State<AppState>,
    moderator: Moderator,
    ApiPath(request_id): ApiPath<Uuid>,
) -> ApiResult<Response> {
    let request = review::verification(&state.db, request_id, false)
        .await?
        .ok_or(ApiError::NotFound)?;
    let profile = review::profile_facts(&state.db, request.profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let identity = load_identity(&state, &request).await?;
    let photos = approved_photos(&state, request.profile_id).await?;
    let previous_requests = review::previous_requests(&state.db, request.profile_id, request.id)
        .await?
        .into_iter()
        .map(|previous| AdminPreviousRequest {
            id: previous.id,
            kind: previous.kind,
            status: previous.status,
            rejection_reason: previous.rejection_reason,
            created_at: previous.created_at,
        })
        .collect();

    let submitted_on = karachi_date(request.created_at);
    let gesture_valid = request.gesture.is_some_and(|gesture| {
        [Some(submitted_on), submitted_on.previous_day()]
            .into_iter()
            .flatten()
            .any(|day| challenge_for(request.profile_id, day) == gesture)
    });
    let images = images_of(&state, &request).await?;
    let detail = AdminVerificationDetail {
        request_id: request.id,
        kind: request.kind,
        status: request.status,
        gesture: request
            .gesture
            .map_or_else(String::new, |gesture| gesture.as_str().to_owned()),
        gesture_valid,
        created_at: request.created_at,
        images,
        media_purged: request.media_purged_at.is_some(),
        identity,
        profile: AdminVerificationProfile {
            profile_id: profile.profile_id,
            public_code: profile.public_code,
            first_name: profile.first_name,
            last_name: profile.last_name,
            gender: profile.gender,
            date_of_birth: profile.date_of_birth,
            age: profile
                .date_of_birth
                .map(|dob| age_now(dob, OffsetDateTime::now_utc())),
            marital_status: profile.marital_status,
            managed_by: profile.managed_by,
            manager_name: profile.manager_name,
            photos,
        },
        previous_requests,
    };

    // The audit row is committed before the data leaves.
    let mut tx = state.db.begin().await?;
    audit::record(
        &mut tx,
        moderator.user_id,
        "verification.view",
        AuditTargetType::VerificationRequest,
        &request.id.to_string(),
        json!({ "profile_id": request.profile_id, "kind": request.kind }),
    )
    .await?;
    tx.commit().await?;

    let mut response = Json(detail).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

// ---------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ApproveVerification {
    /// On an `id_document` request: the moderator confirmed that the selfie matches the profile
    /// photos, which also earns the photo badge (12 section 5.4).
    pub photos_match: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RejectVerification {
    /// One of the `verification_rejection_reason` codes (05 section 2).
    pub reason: String,
    /// Staff only, never shown to the member.
    pub note: Option<String>,
}

/// A body that may be absent: an empty body is the default value.
fn optional_body<T: serde::de::DeserializeOwned + Default>(bytes: &Bytes) -> ApiResult<T> {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(T::default());
    }
    serde_json::from_slice(bytes).map_err(|error| ApiError::BadRequest(error.to_string()))
}

/// Loads a pending request under lock. The profile is locked first, in the order the member
/// routes use, so a decision and a cancellation cannot deadlock.
async fn lock_pending(
    state: &AppState,
    tx: &mut sqlx::PgConnection,
    request_id: Uuid,
) -> ApiResult<VerificationRow> {
    let request = review::verification(&state.db, request_id, false)
        .await?
        .ok_or(ApiError::NotFound)?;
    photos_db::lock_profile(tx, request.profile_id).await?;
    let request = review::verification(&mut *tx, request_id, true)
        .await?
        .ok_or(ApiError::NotFound)?;
    if request.status != VerificationStatus::Pending {
        return Err(ApiError::invalid_state(request.status));
    }
    Ok(request)
}

/// Approves a pending request (12 sections 4.5 and 5.4). An identity check verifies the number,
/// sets `is_id_verified` (which also locks the names) and, with `photos_match`, the photo badge;
/// a selfie sets `is_photo_verified` and needs an approved photo. The member gets a
/// `verification_approved` notification and email; `verification.approve` is audited. Answers
/// `204`; `409 invalid_state` unless the request is pending.
#[utoipa::path(
    post,
    path = "/verifications/{request_id}/approve",
    tag = "admin",
    security(("bearer" = [])),
    params(("request_id" = Uuid, Path, description = "The request")),
    request_body(content = ApproveVerification, description = "May be left out"),
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn approve_verification(
    State(state): State<AppState>,
    moderator: Moderator,
    ApiPath(request_id): ApiPath<Uuid>,
    body: Bytes,
) -> ApiResult<StatusCode> {
    let body: ApproveVerification = optional_body(&body)?;
    let settings = state.settings.get().await?;
    let mut tx = state.db.begin().await?;
    let request = lock_pending(&state, &mut tx, request_id).await?;
    let approval = review::approve_verification(
        &mut tx,
        &request,
        moderator.user_id,
        settings.media_retention_days,
        body.photos_match.unwrap_or(false),
    )
    .await?;
    if approval == Approval::NoApprovedPhoto {
        return Err(ApiError::InvalidState {
            details: json!({ "status": request.status, "reason": "no_approved_photo" }),
        });
    }
    let photos_match = (request.kind == VerificationKind::IdDocument)
        .then_some(body.photos_match)
        .flatten();
    audit::record(
        &mut tx,
        moderator.user_id,
        "verification.approve",
        AuditTargetType::VerificationRequest,
        &request.id.to_string(),
        json!({ "profile_id": request.profile_id, "kind": request.kind, "photos_match": photos_match }),
    )
    .await?;
    let outcome = json!({ "request_id": request.id, "kind": request.kind, "result": "approved" });
    queue_email(
        &mut *tx,
        request.user_id,
        "verification_result",
        outcome,
        Some(format!("verification_result:{}", request.id)),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();

    tracing::info!(event = "verification.decided", kind = %request.kind, result = "approved", request_id = %request.id, "verification decided");
    if let Err(error) = notify(
        &state,
        request.user_id,
        NotificationType::VerificationApproved,
        None,
        json!({ "request_id": request.id, "kind": request.kind }),
    )
    .await
    {
        tracing::warn!(%error, "could not notify about an approved verification");
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Rejects a pending request with a reason (12 sections 4.5 and 5.4). A rejected identity check
/// leaves the identity `rejected`; the member may submit again at once. The member gets a
/// `verification_rejected` notification and email with the reason (never the note);
/// `verification.reject` is audited. Answers `204`; `409 invalid_state` unless pending.
#[utoipa::path(
    post,
    path = "/verifications/{request_id}/reject",
    tag = "admin",
    security(("bearer" = [])),
    params(("request_id" = Uuid, Path, description = "The request")),
    request_body = RejectVerification,
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn reject_verification(
    State(state): State<AppState>,
    moderator: Moderator,
    ApiPath(request_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RejectVerification>,
) -> ApiResult<StatusCode> {
    let reason = VerificationRejectionReason::parse(&body.reason)
        .ok_or_else(|| ApiError::field("reason", FieldCode::UnknownCode))?;
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty());
    if note.is_some_and(|note| note.chars().count() > MAX_NOTE_CHARS) {
        return Err(ApiError::field("note", FieldCode::TooLong));
    }

    let settings = state.settings.get().await?;
    let mut tx = state.db.begin().await?;
    let request = lock_pending(&state, &mut tx, request_id).await?;
    review::reject_verification(
        &mut tx,
        &request,
        moderator.user_id,
        settings.media_retention_days,
        reason,
        note,
    )
    .await?;
    audit::record(
        &mut tx,
        moderator.user_id,
        "verification.reject",
        AuditTargetType::VerificationRequest,
        &request.id.to_string(),
        json!({ "profile_id": request.profile_id, "kind": request.kind, "reason": reason }),
    )
    .await?;
    let outcome = json!({
        "request_id": request.id, "kind": request.kind, "result": "rejected",
        "rejection_reason": reason,
    });
    queue_email(
        &mut *tx,
        request.user_id,
        "verification_result",
        outcome,
        Some(format!("verification_result:{}", request.id)),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();

    tracing::info!(event = "verification.decided", kind = %request.kind, result = "rejected", request_id = %request.id, "verification decided");
    if let Err(error) = notify(
        &state,
        request.user_id,
        NotificationType::VerificationRejected,
        None,
        json!({ "request_id": request.id, "kind": request.kind, "rejection_reason": reason }),
    )
    .await
    {
        tracing::warn!(%error, "could not notify about a rejected verification");
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod flow_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_numbers_are_shown_with_hyphens() {
        assert_eq!(
            format_number(DocumentType::Cnic, "3520212345671"),
            "35202-1234567-1"
        );
        assert_eq!(
            format_number(DocumentType::Nicop, "3520212345671"),
            "35202-1234567-1"
        );
        assert_eq!(
            format_number(DocumentType::Poc, "3520212345671"),
            "35202-1234567-1"
        );
        assert_eq!(
            format_number(DocumentType::Passport, "AB1234567"),
            "AB1234567"
        );
        assert_eq!(
            format_number(DocumentType::Passport, "1234567890123"),
            "1234567890123"
        );
    }

    #[test]
    fn an_absent_approve_body_means_no_choice() {
        let none: ApproveVerification = optional_body(&Bytes::new()).unwrap();
        assert_eq!(none.photos_match, None);
        let some: ApproveVerification =
            optional_body(&Bytes::from_static(br#"{"photos_match": true}"#)).unwrap();
        assert_eq!(some.photos_match, Some(true));
        assert!(optional_body::<ApproveVerification>(&Bytes::from_static(b"{\"x\":1}")).is_err());
    }
}
