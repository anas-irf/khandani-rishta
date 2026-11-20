//! Staff routes: the photo review queue (15 section 16, 18 section 4.2).

#[cfg(test)]
mod flow_tests;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::audit;
use crate::auth::Moderator;
use crate::db::pagination::{Page, PageParams, encode_cursor};
use crate::db::photos as photos_db;
use crate::db::review::{self, PhotoCursor, PhotoQueueRow};
use crate::domain::options::{Gender, PhotoRejectionReason};
use crate::domain::time::age_now;
use crate::domain::types::{AuditTargetType, NotificationType, PhotoStatus};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::jobs::{NewJob, enqueue};
use crate::notify::notify;
use crate::state::AppState;

/// A rejected photo's files stay this long in case of an appeal (08 section 5.3).
const APPEAL_RETENTION: time::Duration = time::Duration::days(30);

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_photos))
        .routes(routes!(approve_photo))
        .routes(routes!(reject_photo))
}

/// Another photo of the same profile, shown beside the one under review.
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminOtherPhoto {
    pub photo_id: Uuid,
    pub status: PhotoStatus,
    pub is_primary: bool,
    pub medium_url: String,
}

/// A photo in the review queue (18 section 4.2).
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminPhotoItem {
    pub photo_id: Uuid,
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    pub gender: Option<Gender>,
    pub age: Option<i32>,
    pub status: PhotoStatus,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// The unblurred large variant, signed.
    pub large_url: String,
    /// `profile_photos.moderation` (13 section 4.2).
    #[schema(value_type = Option<Object>)]
    pub moderation: Option<Value>,
    /// The profile has no approved photo yet, so approving this one makes it the main photo.
    pub would_be_primary: bool,
    pub profile_is_photo_verified: bool,
    pub other_photos: Vec<AdminOtherPhoto>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PhotoQuery {
    /// `pending_review` (default), `approved`, `rejected`, `processing` or `failed`. Photos
    /// without processed files are never listed.
    pub status: Option<PhotoStatus>,
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
}

/// The photo queue: photos the automatic check flagged first, then oldest first. Cursor
/// pagination.
#[utoipa::path(
    get,
    operation_id = "admin_list_photos",
    path = "/photos",
    tag = "admin",
    security(("bearer" = [])),
    params(PhotoQuery),
    responses((status = 200, body = Page<AdminPhotoItem>), (status = 403, body = ErrorBody))
)]
async fn list_photos(
    State(state): State<AppState>,
    _moderator: Moderator,
    ApiQuery(query): ApiQuery<PhotoQuery>,
) -> ApiResult<Json<Page<AdminPhotoItem>>> {
    let page = PageParams {
        limit: query.limit,
        cursor: query.cursor,
    };
    let limit = page.limit();
    let after: Option<PhotoCursor> = page.cursor()?;
    let status = query.status.unwrap_or(PhotoStatus::PendingReview);
    let mut rows = review::photo_queue(&state.db, status, after.as_ref(), limit + 1).await?;
    let has_more = rows.len() > usize::try_from(limit).unwrap_or_default();
    rows.truncate(usize::try_from(limit).unwrap_or_default());
    let next_cursor = rows.last().filter(|_| has_more).map(|row| {
        encode_cursor(&PhotoCursor {
            flag_rank: row.flag_rank,
            created_at: row.created_at,
            id: row.photo_id,
        })
    });

    let profile_ids: Vec<Uuid> = rows.iter().map(|row| row.profile_id).collect();
    let siblings = review::sibling_photos(&state.db, &profile_ids).await?;
    let now = OffsetDateTime::now_utc();
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let mut other_photos = Vec::new();
        for sibling in siblings
            .iter()
            .filter(|s| s.profile_id == row.profile_id && s.id != row.photo_id)
        {
            if let Some(key) = &sibling.key_medium {
                other_photos.push(AdminOtherPhoto {
                    photo_id: sibling.id,
                    status: sibling.status,
                    is_primary: sibling.is_primary,
                    medium_url: state.storage.presign_photo(key).await?,
                });
            }
        }
        items.push(item(&state, row, other_photos, now).await?);
    }
    Ok(Json(Page { items, next_cursor }))
}

async fn item(
    state: &AppState,
    row: PhotoQueueRow,
    other_photos: Vec<AdminOtherPhoto>,
    now: OffsetDateTime,
) -> ApiResult<AdminPhotoItem> {
    let large_url = match &row.key_large {
        Some(key) => state.storage.presign_photo(key).await?,
        None => String::new(),
    };
    Ok(AdminPhotoItem {
        photo_id: row.photo_id,
        profile_id: row.profile_id,
        public_code: row.public_code,
        first_name: row.first_name,
        gender: row.gender,
        age: row.date_of_birth.map(|dob| age_now(dob, now)),
        status: row.status,
        created_at: row.created_at,
        large_url,
        moderation: row.moderation,
        would_be_primary: !row.has_approved_photo,
        profile_is_photo_verified: row.is_photo_verified,
        other_photos,
    })
}

/// Approves a photo that is `pending_review` or `approved` (18 section 4.2). The profile's first
/// approved photo becomes its main photo; completeness and recommendations are refreshed; the
/// owner gets a `photo_approved` notification; `photo.approve` is audited. Answers `204`.
#[utoipa::path(
    post,
    path = "/photos/{photo_id}/approve",
    tag = "admin",
    security(("bearer" = [])),
    params(("photo_id" = Uuid, Path, description = "The photo")),
    responses(
        (status = 204),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn approve_photo(
    State(state): State<AppState>,
    moderator: Moderator,
    ApiPath(photo_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let (profile_id, user_id) = review::photo_owner(&state.db, photo_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let mut tx = state.db.begin().await?;
    photos_db::lock_profile(&mut tx, profile_id).await?;
    let photo = photos_db::get_owned_for_update(&mut tx, photo_id, profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    ensure_reviewable(photo.status)?;
    review::mark_photo_approved(&mut tx, photo_id, moderator.user_id).await?;
    let settled = photos_db::settle(&mut tx, profile_id, false).await?;
    audit::record(
        &mut tx,
        moderator.user_id,
        "photo.approve",
        AuditTargetType::Photo,
        &photo_id.to_string(),
        json!({ "profile_id": profile_id }),
    )
    .await?;
    tx.commit().await?;

    let mut changed = vec![photo_id];
    changed.extend(settled.new_primary().filter(|id| *id != photo_id));
    photos_db::announce(&state, profile_id, &changed).await;
    tracing::info!(event = "photo.approved", photo_id = %photo_id, source = "moderator", "photo approved");
    if let Err(error) = notify(
        &state,
        user_id,
        NotificationType::PhotoApproved,
        None,
        json!({ "photo_id": photo_id }),
    )
    .await
    {
        tracing::warn!(%error, "could not notify about an approved photo");
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Only photos waiting for review, or already approved ones a report brought back, can be
/// decided (18 section 4.2).
fn ensure_reviewable(status: PhotoStatus) -> ApiResult<()> {
    match status {
        PhotoStatus::PendingReview | PhotoStatus::Approved => Ok(()),
        other => Err(ApiError::invalid_state(other)),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RejectPhoto {
    /// One of the `photo_rejection_reason` codes (05 section 2.43). Parsed by the handler, so an
    /// unknown code is a validation error rather than a malformed body.
    #[schema(value_type = PhotoRejectionReason)]
    pub reason: String,
}

/// Rejects a photo that is `pending_review` or `approved`. A rejected main photo is replaced by
/// the next approved photo; the files are deleted after 30 days; the owner gets a
/// `photo_rejected` notification; `photo.reject` is audited. Answers `204`.
#[utoipa::path(
    post,
    path = "/photos/{photo_id}/reject",
    tag = "admin",
    security(("bearer" = [])),
    params(("photo_id" = Uuid, Path, description = "The photo")),
    request_body = RejectPhoto,
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn reject_photo(
    State(state): State<AppState>,
    moderator: Moderator,
    ApiPath(photo_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RejectPhoto>,
) -> ApiResult<StatusCode> {
    let reason = PhotoRejectionReason::parse(&body.reason)
        .ok_or_else(|| ApiError::field("reason", FieldCode::UnknownCode))?;
    let (profile_id, user_id) = review::photo_owner(&state.db, photo_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let mut tx = state.db.begin().await?;
    photos_db::lock_profile(&mut tx, profile_id).await?;
    let photo = photos_db::get_owned_for_update(&mut tx, photo_id, profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    ensure_reviewable(photo.status)?;
    review::mark_photo_rejected(&mut tx, photo_id, reason, moderator.user_id).await?;
    let settled = photos_db::settle(&mut tx, profile_id, photo.is_primary).await?;
    let keys = photos_db::variant_keys(&photo);
    if !keys.is_empty() {
        enqueue(
            &mut *tx,
            NewJob::new("delete_objects", json!({ "keys": keys }))
                .run_at(OffsetDateTime::now_utc() + APPEAL_RETENTION),
        )
        .await?;
    }
    audit::record(
        &mut tx,
        moderator.user_id,
        "photo.reject",
        AuditTargetType::Photo,
        &photo_id.to_string(),
        json!({ "profile_id": profile_id, "reason": reason }),
    )
    .await?;
    tx.commit().await?;

    let mut changed = vec![photo_id];
    changed.extend(settled.new_primary());
    photos_db::announce(&state, profile_id, &changed).await;
    tracing::info!(event = "photo.rejected", photo_id = %photo_id, %reason, source = "moderator", "photo rejected");
    if let Err(error) = notify(
        &state,
        user_id,
        NotificationType::PhotoRejected,
        None,
        json!({ "photo_id": photo_id, "rejection_reason": reason }),
    )
    .await
    {
        tracing::warn!(%error, "could not notify about a rejected photo");
    }
    Ok(StatusCode::NO_CONTENT)
}
