//! Verification requests (15 section 9, 12): the selfie challenge, upload URLs, submitting an
//! identity or photo check, and cancelling. Staff decide in `routes/admin/verifications.rs`.

use std::collections::HashSet;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use time::OffsetDateTime;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::Open;
use crate::db::photos::lock_profile;
use crate::db::verifications as db;
use crate::domain::options::DocumentType;
use crate::domain::time::karachi_date;
use crate::domain::types::{
    Gesture, IdentityStatus, ProfileStatus, VerificationKind, VerificationStatus,
};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode, FieldErrors};
use crate::extract::{ApiJson, ApiPath};
use crate::models::verifications::{
    SelfieChallenge, SubmitVerification, VerificationOverview, VerificationRequestSummary,
    VerificationUploadRequest, challenge_for,
};
use crate::routes::photos::{MAX_UPLOAD_BYTES, UploadTicket, issue_upload, validate_upload};
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(get_verifications, submit))
        .routes(routes!(selfie_challenge))
        .routes(routes!(create_upload))
        .routes(routes!(cancel))
}

/// The state of the caller's checks and their latest requests.
#[utoipa::path(
    get,
    path = "/me/verifications",
    tag = "verification",
    security(("bearer" = [])),
    responses((status = 200, body = VerificationOverview))
)]
async fn get_verifications(
    State(state): State<AppState>,
    account: Open,
) -> ApiResult<Json<VerificationOverview>> {
    let (phone_verified, photo_verified, id_verified) =
        db::badge_flags(&state.db, account.profile_id).await?;
    Ok(Json(VerificationOverview {
        phone_verified,
        photo_verified,
        id_verified,
        identity: db::identity_summary(&state.db, account.profile_id).await?,
        requests: db::recent_requests(&state.db, account.profile_id).await?,
    }))
}

/// The gesture to perform in today's selfie, derived from the profile id and the date in
/// `Asia/Karachi` (12 section 4.2).
#[utoipa::path(
    get,
    path = "/me/verifications/selfie-challenge",
    tag = "verification",
    security(("bearer" = [])),
    responses((status = 200, body = SelfieChallenge))
)]
async fn selfie_challenge(account: Open) -> Json<SelfieChallenge> {
    let today = karachi_date(OffsetDateTime::now_utc());
    Json(SelfieChallenge {
        gesture: challenge_for(account.profile_id, today),
    })
}

/// A presigned `PUT` for one verification image. The key is `verification/{profile_id}/{uuid}`.
/// A profile that is `closed` cannot verify (03 section 5).
#[utoipa::path(
    post,
    operation_id = "create_verification_upload",
    path = "/me/verifications/uploads",
    tag = "verification",
    security(("bearer" = [])),
    request_body = VerificationUploadRequest,
    responses(
        (status = 200, body = UploadTicket),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 413, body = ErrorBody),
        (status = 503, body = ErrorBody)
    )
)]
async fn create_upload(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<VerificationUploadRequest>,
) -> ApiResult<Json<UploadTicket>> {
    require_not_closed(account.profile_status)?;
    validate_upload(&body.content_type, body.size_bytes)?;
    let key = format!("verification/{}/{}", account.profile_id, Uuid::now_v7());
    Ok(Json(issue_upload(&state, key, &body.content_type).await?))
}

fn require_not_closed(status: ProfileStatus) -> ApiResult<()> {
    if status == ProfileStatus::Closed {
        return Err(ApiError::ProfileNotActive { status });
    }
    Ok(())
}

/// `true` when `key` is `verification/{profile_id}/{uuid}` for this profile.
fn is_own_key(profile_id: Uuid, key: &str) -> bool {
    key.strip_prefix(&format!("verification/{profile_id}/"))
        .is_some_and(|rest| Uuid::parse_str(rest).is_ok_and(|id| id.to_string() == rest))
}

/// The gesture of today or of yesterday (12 section 4.2), so a selfie taken just before midnight
/// is not refused.
fn accepted_gesture(profile_id: Uuid, given: &str, now: OffsetDateTime) -> Option<Gesture> {
    let today = karachi_date(now);
    [Some(today), today.previous_day()]
        .into_iter()
        .flatten()
        .map(|day| challenge_for(profile_id, day))
        .find(|gesture| gesture.as_str() == given)
}

/// The parts of a submission, borrowed from the body.
struct Parts<'a> {
    kind: VerificationKind,
    front_key: Option<&'a str>,
    back_key: Option<&'a str>,
    selfie_key: &'a str,
    gesture: &'a str,
}

impl<'a> Parts<'a> {
    fn of(body: &'a SubmitVerification) -> Self {
        match body {
            SubmitVerification::IdDocument {
                front_key,
                back_key,
                selfie_key,
                gesture,
            } => Self {
                kind: VerificationKind::IdDocument,
                front_key: Some(front_key),
                back_key: back_key.as_deref(),
                selfie_key,
                gesture,
            },
            SubmitVerification::Selfie {
                selfie_key,
                gesture,
            } => Self {
                kind: VerificationKind::Selfie,
                front_key: None,
                back_key: None,
                selfie_key,
                gesture,
            },
        }
    }
}

/// The checks that need no database row: the gesture, and every key being one of the caller's
/// uploads, distinct, existing and small enough (12 sections 4.2 and 4.3). Returns the gesture.
async fn check_fields(state: &AppState, profile_id: Uuid, parts: &Parts<'_>) -> ApiResult<Gesture> {
    let mut errors = FieldErrors::new();
    let gesture = accepted_gesture(profile_id, parts.gesture, OffsetDateTime::now_utc());
    if gesture.is_none() {
        errors.add("gesture", FieldCode::Mismatch);
    }
    let keys = [
        ("front_key", parts.front_key),
        ("back_key", parts.back_key),
        ("selfie_key", Some(parts.selfie_key)),
    ];
    let mut seen = HashSet::new();
    for (field, key) in keys {
        let Some(key) = key else { continue };
        if !is_own_key(profile_id, key) || !seen.insert(key) {
            errors.add(field, FieldCode::Invalid);
            continue;
        }
        match state.storage.head(key).await? {
            None => errors.add(field, FieldCode::Invalid),
            Some(object) if object.size > MAX_UPLOAD_BYTES => {
                if let Err(error) = state.storage.delete(&[key.to_owned()]).await {
                    tracing::warn!(%error, "could not delete an oversized verification image");
                }
                return Err(ApiError::PayloadTooLarge {
                    max_bytes: MAX_UPLOAD_BYTES,
                });
            }
            Some(_) => {}
        }
    }
    errors.finish()?;
    // `Some` here: a mismatch was added to `errors` above.
    gesture.ok_or_else(|| ApiError::field("gesture", FieldCode::Mismatch))
}

/// The checks that read the profile, under the profile lock: no pending request of the kind,
/// an identity number to check (and the back image a card needs), or an approved photo.
async fn check_preconditions(
    tx: &mut sqlx::PgConnection,
    profile_id: Uuid,
    parts: &Parts<'_>,
) -> ApiResult<()> {
    if db::pending_exists(tx, profile_id, parts.kind).await? {
        return Err(ApiError::AlreadyExists);
    }
    match parts.kind {
        VerificationKind::IdDocument => {
            let (document_type, status) = db::identity_for_update(tx, profile_id)
                .await?
                .ok_or_else(|| ApiError::invalid_state("no_identity"))?;
            if !matches!(
                status,
                IdentityStatus::Unverified | IdentityStatus::Rejected
            ) {
                return Err(ApiError::invalid_state(status));
            }
            if parts.back_key.is_none() && document_type != DocumentType::Passport {
                return Err(ApiError::field("back_key", FieldCode::Required));
            }
        }
        VerificationKind::Selfie => {
            if !db::has_approved_photo(tx, profile_id).await? {
                return Err(ApiError::invalid_state("no_approved_photo"));
            }
        }
    }
    Ok(())
}

/// Submits a verification request.
///
/// Field errors: `gesture` must be today's or yesterday's challenge (`mismatch`); every key must
/// be one of the caller's uploads that exists (`invalid`); `back_key` is required for `cnic`,
/// `nicop` and `poc` (`required`). `already_exists` when a request of the kind is pending,
/// `invalid_state` when an identity check has no identity number to check or a selfie has no
/// approved photo to compare with, `profile_not_active` when the profile is `closed`.
#[utoipa::path(
    post,
    path = "/me/verifications",
    tag = "verification",
    security(("bearer" = [])),
    request_body = SubmitVerification,
    responses(
        (status = 201, body = VerificationRequestSummary),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn submit(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<SubmitVerification>,
) -> ApiResult<(StatusCode, Json<VerificationRequestSummary>)> {
    require_not_closed(account.profile_status)?;
    let profile_id = account.profile_id;
    let parts = Parts::of(&body);
    let gesture = check_fields(&state, profile_id, &parts).await?;

    let mut tx = state.db.begin().await?;
    lock_profile(&mut tx, profile_id).await?;
    check_preconditions(&mut tx, profile_id, &parts).await?;
    let kind = parts.kind;
    let request = db::NewRequest {
        kind,
        front_key: parts.front_key,
        back_key: parts.back_key,
        selfie_key: parts.selfie_key,
        gesture,
    };
    let created = db::insert_pending(&mut tx, profile_id, &request)
        .await?
        .ok_or(ApiError::AlreadyExists)?;
    if kind == VerificationKind::IdDocument {
        db::set_identity_status(&mut tx, profile_id, IdentityStatus::Pending).await?;
    }
    tx.commit().await?;

    tracing::info!(event = "verification.submitted", kind = %kind, request_id = %created.id, "verification submitted");
    Ok((StatusCode::CREATED, Json(created)))
}

/// Cancels a pending request. An identity check goes back to `unverified`, and the images are
/// deleted by the next `purge_verification_media` run (12 section 5.4).
#[utoipa::path(
    delete,
    path = "/me/verifications/{request_id}",
    tag = "verification",
    security(("bearer" = [])),
    params(("request_id" = Uuid, Path, description = "The request to cancel")),
    responses((status = 204), (status = 404, body = ErrorBody), (status = 409, body = ErrorBody))
)]
async fn cancel(
    State(state): State<AppState>,
    account: Open,
    ApiPath(request_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    lock_profile(&mut tx, account.profile_id).await?;
    let (kind, status) = db::own_request_for_update(&mut tx, request_id, account.profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if status != VerificationStatus::Pending {
        return Err(ApiError::invalid_state(status));
    }
    db::cancel(&mut tx, request_id).await?;
    if kind == VerificationKind::IdDocument {
        db::set_identity_status(&mut tx, account.profile_id, IdentityStatus::Unverified).await?;
    }
    tx.commit().await?;
    tracing::info!(event = "verification.decided", kind = %kind, result = "cancelled", request_id = %request_id, "verification cancelled");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod flow_tests;

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    #[test]
    fn keys_must_be_the_callers_verification_uploads() {
        let profile = Uuid::now_v7();
        let id = Uuid::now_v7();
        assert!(is_own_key(profile, &format!("verification/{profile}/{id}")));
        assert!(!is_own_key(
            profile,
            &format!("verification/{}/{id}", Uuid::now_v7())
        ));
        assert!(!is_own_key(profile, &format!("tmp/photos/{profile}/{id}")));
        assert!(!is_own_key(
            profile,
            &format!("verification/{profile}/{id}/x")
        ));
        assert!(!is_own_key(profile, &format!("verification/{profile}/..")));
    }

    #[test]
    fn today_and_yesterday_are_accepted_around_midnight() {
        let profile = Uuid::now_v7();
        // 00:30 on 21 November in Karachi is 19:30 on 20 November in UTC.
        let just_after_midnight = datetime!(2026-11-20 19:30 UTC);
        let today = karachi_date(just_after_midnight);
        let yesterday = today.previous_day().unwrap();
        let today_gesture = challenge_for(profile, today);
        let yesterday_gesture = challenge_for(profile, yesterday);
        assert_eq!(
            accepted_gesture(profile, today_gesture.as_str(), just_after_midnight),
            Some(today_gesture)
        );
        assert_eq!(
            accepted_gesture(profile, yesterday_gesture.as_str(), just_after_midnight),
            Some(yesterday_gesture)
        );
        assert_eq!(accepted_gesture(profile, "wave", just_after_midnight), None);
    }
}
