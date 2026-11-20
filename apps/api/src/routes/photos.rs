//! Own photos (15 section 8, 08 section 5): upload tickets, confirmation, listing, choosing the
//! primary photo, ordering and deleting.
//!
//! The pipeline after a confirmation (decode, variants, automatic check, status) is the
//! `process_photo` job in [`crate::jobs::process_photo`].

use std::collections::{BTreeMap, HashSet};
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::Open;
use crate::db::photos as db;
use crate::domain::types::PhotoStatus;
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath};
use crate::jobs::{NewJob, enqueue};
use crate::models::photos::{OwnPhoto, PhotoRow, own_photo};
use crate::state::AppState;

/// Largest uploaded file: 10 MiB (08 section 5.1, "10 MB"). A presigned `PUT` cannot enforce
/// it, so the confirmation checks the size of the stored object.
pub const MAX_UPLOAD_BYTES: u64 = 10 * 1024 * 1024;
/// Validity of an upload URL (08 section 5.2).
const UPLOAD_TTL: Duration = Duration::from_mins(10);
/// The content types a client may declare (08 section 5.1).
pub const ALLOWED_CONTENT_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];
/// The name of the limit in `limit_reached` (03 section 7).
const PHOTOS_LIMIT: &str = "limits.photos_max";

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_upload))
        .routes(routes!(confirm_photo, list_photos))
        .routes(routes!(put_order))
        .routes(routes!(patch_photo, delete_photo))
}

// ---------------------------------------------------------------------------------------------
// Upload tickets, shared with the verification uploads
// ---------------------------------------------------------------------------------------------

/// Where and how to `PUT` a file (15 section 8).
#[derive(Debug, Serialize, ToSchema)]
pub struct UploadTicket {
    /// The key to send back when confirming.
    pub upload_key: String,
    /// A presigned `PUT` URL, valid for 10 minutes.
    pub upload_url: String,
    /// Exactly these headers must be sent with the `PUT`.
    pub headers: BTreeMap<String, String>,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
}

/// Checks a declared content type and size: `validation_failed` for an unknown type or a size
/// that is not positive, `payload_too_large` over 10 MiB.
pub fn validate_upload(content_type: &str, size_bytes: i64) -> ApiResult<()> {
    let mut errors = crate::error::FieldErrors::new();
    if !ALLOWED_CONTENT_TYPES.contains(&content_type) {
        errors.add("content_type", FieldCode::Invalid);
    }
    let size = u64::try_from(size_bytes).unwrap_or_default();
    if size == 0 {
        errors.add("size_bytes", FieldCode::OutOfRange);
    }
    errors.finish()?;
    if size > MAX_UPLOAD_BYTES {
        return Err(ApiError::PayloadTooLarge {
            max_bytes: MAX_UPLOAD_BYTES,
        });
    }
    Ok(())
}

/// Presigns the upload of `key`. `503` when storage is not configured or failing.
pub async fn issue_upload(
    state: &AppState,
    key: String,
    content_type: &str,
) -> ApiResult<UploadTicket> {
    if !state.storage.is_available() {
        return Err(ApiError::ServiceUnavailable);
    }
    let presigned = state
        .storage
        .presign_put(&key, content_type, UPLOAD_TTL)
        .await?;
    Ok(UploadTicket {
        upload_key: key,
        upload_url: presigned.url,
        headers: presigned.headers.into_iter().collect(),
        expires_at: OffsetDateTime::now_utc() + UPLOAD_TTL,
    })
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UploadRequest {
    /// `image/jpeg`, `image/png` or `image/webp`.
    pub content_type: String,
    /// The size of the file in bytes, at most 10 MiB.
    pub size_bytes: i64,
}

/// Asks for an upload URL. The key is `tmp/photos/{profile_id}/{uuid}`.
///
/// Answers `payload_too_large` over 10 MiB, `limit_reached` when the profile already holds
/// `limits.photos_max` photos that are not `rejected` or `failed`, and `503` when storage is
/// not available.
#[utoipa::path(
    post,
    path = "/me/photos/uploads",
    tag = "photos",
    security(("bearer" = [])),
    request_body = UploadRequest,
    responses(
        (status = 200, body = UploadTicket),
        (status = 400, body = ErrorBody),
        (status = 413, body = ErrorBody),
        (status = 429, body = ErrorBody),
        (status = 503, body = ErrorBody)
    )
)]
async fn create_upload(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<UploadRequest>,
) -> ApiResult<Json<UploadTicket>> {
    validate_upload(&body.content_type, body.size_bytes)?;
    if !state.storage.is_available() {
        return Err(ApiError::ServiceUnavailable);
    }
    let settings = state.settings.get().await?;
    let used = db::count_counted(&state.db, account.profile_id).await?;
    if used >= settings.photos_max {
        return Err(ApiError::limit(PHOTOS_LIMIT, used));
    }
    let key = format!("tmp/photos/{}/{}", account.profile_id, Uuid::now_v7());
    Ok(Json(issue_upload(&state, key, &body.content_type).await?))
}

// ---------------------------------------------------------------------------------------------
// Confirming, listing
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ConfirmRequest {
    /// The `upload_key` returned by `POST /v1/me/photos/uploads`.
    pub upload_key: String,
}

/// Renders rows for the owner, signing the URLs of the clear variants.
async fn render(state: &AppState, rows: &[PhotoRow]) -> Vec<OwnPhoto> {
    let mut photos = Vec::with_capacity(rows.len());
    for row in rows {
        photos.push(own_photo(state.storage.as_ref(), row).await);
    }
    photos
}

/// Whether `key` is `tmp/photos/{profile_id}/{uuid}` for this profile.
fn is_own_upload_key(profile_id: Uuid, key: &str) -> bool {
    key.strip_prefix(&format!("tmp/photos/{profile_id}/"))
        .is_some_and(|rest| Uuid::parse_str(rest).is_ok_and(|id| id.to_string() == rest))
}

/// Confirms an upload and starts processing.
///
/// The key must be one this profile was given (anything else is `404`), and the object must
/// exist and be at most 10 MiB (`404` and `413`; an oversized object is deleted). Confirming
/// the same key again returns the existing photo with `200`; a new photo is `201` with status
/// `processing` and a `process_photo` job.
#[utoipa::path(
    post,
    path = "/me/photos",
    tag = "photos",
    security(("bearer" = [])),
    request_body = ConfirmRequest,
    responses(
        (status = 201, body = OwnPhoto),
        (status = 200, body = OwnPhoto),
        (status = 404, body = ErrorBody),
        (status = 413, body = ErrorBody),
        (status = 429, body = ErrorBody),
        (status = 503, body = ErrorBody)
    )
)]
async fn confirm_photo(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<ConfirmRequest>,
) -> ApiResult<(StatusCode, Json<OwnPhoto>)> {
    let upload_key = body.upload_key;
    if !is_own_upload_key(account.profile_id, &upload_key) {
        return Err(ApiError::NotFound);
    }
    // The temporary object is gone once the photo has been processed, so a repeated
    // confirmation is answered from the row before storage is asked.
    if let Some(existing) = db::by_upload_key(&state.db, account.profile_id, &upload_key).await? {
        let photo = own_photo(state.storage.as_ref(), &existing).await;
        return Ok((StatusCode::OK, Json(photo)));
    }

    let Some(object) = state.storage.head(&upload_key).await? else {
        return Err(ApiError::NotFound);
    };
    if object.size > MAX_UPLOAD_BYTES {
        if let Err(error) = state
            .storage
            .delete(std::slice::from_ref(&upload_key))
            .await
        {
            tracing::warn!(%error, "could not delete an oversized upload");
        }
        return Err(ApiError::PayloadTooLarge {
            max_bytes: MAX_UPLOAD_BYTES,
        });
    }

    let settings = state.settings.get().await?;
    let mut tx = state.db.begin().await?;
    db::lock_profile(&mut tx, account.profile_id).await?;
    if let Some(existing) = db::by_upload_key(&mut *tx, account.profile_id, &upload_key).await? {
        let photo = own_photo(state.storage.as_ref(), &existing).await;
        return Ok((StatusCode::OK, Json(photo)));
    }
    let used = db::count_counted(&mut *tx, account.profile_id).await?;
    if used >= settings.photos_max {
        return Err(ApiError::limit(PHOTOS_LIMIT, used));
    }
    let row = db::insert_processing(&mut *tx, account.profile_id, &upload_key).await?;
    enqueue(
        &mut *tx,
        NewJob::new("process_photo", json!({ "photo_id": row.id })).dedupe(row.id.to_string()),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();

    tracing::info!(event = "photo.uploaded", photo_id = %row.id, profile_id = %account.profile_id, "photo uploaded");
    let photo = own_photo(state.storage.as_ref(), &row).await;
    Ok((StatusCode::CREATED, Json(photo)))
}

/// The caller's photos in display order, every status, with signed URLs for the clear
/// variants (`null` while processing and after a failure).
#[utoipa::path(
    get,
    path = "/me/photos",
    tag = "photos",
    security(("bearer" = [])),
    responses((status = 200, body = Vec<OwnPhoto>))
)]
async fn list_photos(
    State(state): State<AppState>,
    account: Open,
) -> ApiResult<Json<Vec<OwnPhoto>>> {
    let rows = db::list(&state.db, account.profile_id).await?;
    Ok(Json(render(&state, &rows).await))
}

// ---------------------------------------------------------------------------------------------
// Changing the primary photo, the order, deleting
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PatchPhoto {
    /// Only `true` is accepted: a photo stops being primary when another one becomes it.
    pub is_primary: bool,
}

/// Makes an approved photo the primary one (03 section 4.4). A different primary clears
/// `is_photo_verified`, because the badge vouches for the face others see first (12 section 4.6).
/// Choosing the photo that is already primary changes nothing. Returns every photo.
#[utoipa::path(
    patch,
    path = "/me/photos/{photo_id}",
    tag = "photos",
    security(("bearer" = [])),
    params(("photo_id" = Uuid, Path, description = "The photo to make primary")),
    request_body = PatchPhoto,
    responses(
        (status = 200, body = Vec<OwnPhoto>),
        (status = 400, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn patch_photo(
    State(state): State<AppState>,
    account: Open,
    ApiPath(photo_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PatchPhoto>,
) -> ApiResult<Json<Vec<OwnPhoto>>> {
    if !body.is_primary {
        return Err(ApiError::field("is_primary", FieldCode::Invalid));
    }
    let mut tx = state.db.begin().await?;
    db::lock_profile(&mut tx, account.profile_id).await?;
    let photo = db::get_owned_for_update(&mut tx, photo_id, account.profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if photo.status != PhotoStatus::Approved {
        return Err(ApiError::invalid_state(photo.status));
    }
    let mut changed = Vec::new();
    if !photo.is_primary {
        let previous = db::primary_id(&mut *tx, account.profile_id).await?;
        db::set_primary(&mut tx, account.profile_id, photo.id).await?;
        db::settle(&mut tx, account.profile_id, true).await?;
        changed.push(photo.id);
        changed.extend(previous);
    }
    tx.commit().await?;

    db::announce(&state, account.profile_id, &changed).await;
    let rows = db::list(&state.db, account.profile_id).await?;
    Ok(Json(render(&state, &rows).await))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OrderRequest {
    /// Every photo of the profile exactly once, in the new order.
    pub photo_ids: Vec<Uuid>,
}

/// Sets the display order. The list must name every photo of the profile once; otherwise
/// `validation_failed` on `photo_ids`. Does not change which photo is primary.
#[utoipa::path(
    put,
    path = "/me/photos/order",
    tag = "photos",
    security(("bearer" = [])),
    request_body = OrderRequest,
    responses(
        (status = 200, body = Vec<OwnPhoto>),
        (status = 400, body = ErrorBody)
    )
)]
async fn put_order(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<OrderRequest>,
) -> ApiResult<Json<Vec<OwnPhoto>>> {
    let mut tx = state.db.begin().await?;
    db::lock_profile(&mut tx, account.profile_id).await?;
    let before = db::list(&mut *tx, account.profile_id).await?;
    let known: HashSet<Uuid> = before.iter().map(|row| row.id).collect();
    let given: HashSet<Uuid> = body.photo_ids.iter().copied().collect();
    if given.len() != body.photo_ids.len() || given != known {
        return Err(ApiError::field("photo_ids", FieldCode::Invalid));
    }
    db::reorder(&mut tx, account.profile_id, &body.photo_ids).await?;
    let rows = db::list(&mut *tx, account.profile_id).await?;
    tx.commit().await?;

    let moved: Vec<Uuid> = rows
        .iter()
        .filter(|after| {
            before
                .iter()
                .find(|row| row.id == after.id)
                .is_some_and(|row| row.position != after.position)
        })
        .map(|row| row.id)
        .collect();
    db::announce(&state, account.profile_id, &moved).await;
    Ok(Json(render(&state, &rows).await))
}

/// Deletes a photo. The R2 objects go through a `delete_objects` job. Deleting the primary
/// hands it to the approved photo with the lowest position; a profile left without an approved
/// photo loses `has_approved_photo`; a new primary clears `is_photo_verified`.
#[utoipa::path(
    delete,
    path = "/me/photos/{photo_id}",
    tag = "photos",
    security(("bearer" = [])),
    params(("photo_id" = Uuid, Path, description = "The photo to delete")),
    responses((status = 204), (status = 404, body = ErrorBody))
)]
async fn delete_photo(
    State(state): State<AppState>,
    account: Open,
    ApiPath(photo_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    db::lock_profile(&mut tx, account.profile_id).await?;
    let deleted = db::delete_owned(&mut tx, photo_id, account.profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let settled = db::settle(&mut tx, account.profile_id, deleted.photo.is_primary).await?;
    enqueue(
        &mut *tx,
        NewJob::new("delete_objects", json!({ "keys": deleted.object_keys() })),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();

    db::announce(
        &state,
        account.profile_id,
        &settled.new_primary().into_iter().collect::<Vec<_>>(),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
pub(crate) mod fixtures;
#[cfg(test)]
mod flow_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_keys_of_the_callers_own_uploads_are_accepted() {
        let profile = Uuid::now_v7();
        let other = Uuid::now_v7();
        let id = Uuid::now_v7();
        assert!(is_own_upload_key(
            profile,
            &format!("tmp/photos/{profile}/{id}")
        ));
        assert!(!is_own_upload_key(
            profile,
            &format!("tmp/photos/{other}/{id}")
        ));
        assert!(!is_own_upload_key(
            profile,
            &format!("tmp/photos/{profile}/not-a-uuid")
        ));
        assert!(!is_own_upload_key(
            profile,
            &format!("tmp/photos/{profile}/{id}/extra")
        ));
        assert!(!is_own_upload_key(
            profile,
            &format!("photos/{profile}/{id}/large.jpg")
        ));
        assert!(!is_own_upload_key(
            profile,
            &format!("verification/{profile}/{id}")
        ));
    }

    #[test]
    fn declared_uploads_are_checked() {
        assert!(validate_upload("image/jpeg", 1).is_ok());
        assert!(validate_upload("image/webp", i64::try_from(MAX_UPLOAD_BYTES).unwrap()).is_ok());
        assert!(matches!(
            validate_upload("image/jpeg", i64::try_from(MAX_UPLOAD_BYTES).unwrap() + 1),
            Err(ApiError::PayloadTooLarge { .. })
        ));
        assert!(matches!(
            validate_upload("image/gif", 10),
            Err(ApiError::Validation(_))
        ));
        assert!(matches!(
            validate_upload("image/jpeg", 0),
            Err(ApiError::Validation(_))
        ));
        assert!(matches!(
            validate_upload("image/jpeg", -5),
            Err(ApiError::Validation(_))
        ));
    }
}
