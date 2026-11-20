//! Photo access requests and grants (15 section 13, 09 section 6.3, 03 section 4.9).
//!
//! Who sees clear photos is decided by [`crate::domain::visibility::photo_mode`], which every
//! view of another member calls with the `photo_access` row of the pair. These routes only
//! move that row between its states, so a grant gives clear photos and a revocation returns the
//! blurred ones through `GET /v1/profiles/{id}` with no other change.

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

use crate::auth::{Browse, Engage};
use crate::db::counters;
use crate::db::pagination::{Page, PageParams};
use crate::db::photo_access::{self as db, Decided, Granted, Requested, Revoked};
use crate::domain::time::next_karachi_midnight;
use crate::domain::types::{NotificationType, PhotoAccessStatus};
use crate::domain::visibility::{PhotoMode, RelationPhotoAccess};
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::extract::{ApiPath, ApiQuery};
use crate::notify::notify;
use crate::state::AppState;
use crate::views::{self, ProfileCard};

/// The `reason` of `409 not_permitted_by_member` when the owner switched photo requests off.
/// 15 section 2.1 gives the code a `reason` and 09 section 7 defines its values only for
/// interests, so this reuses the value `Relation.photo_access` has for the same condition
/// (09 section 6.4 row 3).
const REQUESTS_OFF: &str = "requests_off";

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(request_access))
        .routes(routes!(list_access))
        .routes(routes!(grant_request))
        .routes(routes!(deny_request))
        .routes(routes!(put_grant, delete_grant))
}

// -------------------------------------------------------------------------------------------
// The viewer asks
// -------------------------------------------------------------------------------------------

/// The answer to a photo request: always `pending`.
#[derive(Debug, Serialize, ToSchema)]
pub struct PhotoRequested {
    pub status: PhotoAccessStatus,
}

/// Ask to see a member's photos. The checks run in the order of 09 section 6.3:
///
/// 1. The caller is `active` (access level `browse`) and may open the owner (`404` otherwise).
/// 2. The caller currently gets blurred photos and the owner has an approved photo, otherwise
///    `409 invalid_state` with `details.status = "visible"`.
/// 3. The owner accepts requests, otherwise `409 not_permitted_by_member` with
///    `details.reason = "requests_off"`.
/// 4. No request is pending (`409 already_exists`).
/// 5. A denial or revocation is older than `photo_access.retry_days`
///    (`409 cooldown_active` with `retry_after_date`).
/// 6. Fewer than `limits.photo_requests_per_day` requests were sent today
///    (`429 limit_reached`).
///
/// The owner receives a `photo_request_received` notification and a `counters` event.
#[utoipa::path(
    post,
    path = "/profiles/{profile_id}/photo-access",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The owner of the photos")),
    responses(
        (status = 201, body = PhotoRequested),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn request_access(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(owner_id): ApiPath<Uuid>,
) -> ApiResult<(StatusCode, Json<PhotoRequested>)> {
    let viewer = views::viewer(&state, account.profile_id).await?;
    // Check 1. `screen` also answers `None` for the caller's own profile.
    let assessed = views::screen(&state, &viewer, &[owner_id])
        .await?
        .remove(&owner_id)
        .ok_or(ApiError::NotFound)?;
    // Check 2: `photos` is `None` when the owner has no approved photo.
    if assessed.disclosure.photos != Some(PhotoMode::Blurred) {
        return Err(ApiError::invalid_state(RelationPhotoAccess::Visible));
    }
    // Check 3 reads the raw setting: `Assessed::photo_access` reports a pending request before
    // it reports `requests_off` (09 section 6.4), but 09 section 6.3 checks the setting first.
    let owner = views::members(&state, &[owner_id], viewer.now)
        .await?
        .remove(&owner_id)
        .ok_or(ApiError::NotFound)?;
    if !owner.privacy().allow_photo_requests {
        return Err(ApiError::NotPermittedByMember {
            reason: REQUESTS_OFF,
        });
    }

    // Checks 4 to 6 and the write, in one transaction.
    let settings = state.settings.get().await?;
    let outcome = db::request(
        &state.db,
        account.profile_id,
        owner_id,
        settings.photo_access_retry_days,
        settings.photo_requests_per_day,
        viewer.now,
    )
    .await?;
    let id = match outcome {
        Requested::Created { id } => id,
        Requested::AlreadyPending => return Err(ApiError::AlreadyExists),
        Requested::AlreadyGranted => {
            return Err(ApiError::invalid_state(PhotoAccessStatus::Granted));
        }
        Requested::Cooldown { retry_after } => {
            return Err(ApiError::CooldownActive {
                retry_after_date: retry_after,
            });
        }
        Requested::LimitReached { used } => {
            tracing::info!(event = "limit.reached", limit = "photo_requests_per_day");
            return Err(ApiError::LimitReached {
                limit: "photo_requests_per_day",
                used,
                resets_at: Some(next_karachi_midnight(viewer.now)),
                side: None,
            });
        }
    };

    // After the commit. `notify` pushes the owner's counters when it creates the row; when it
    // creates nothing (for example the owner's profile is closed) the pending count still
    // changed, so push it here.
    let created = notify(
        &state,
        owner.row.user_id,
        NotificationType::PhotoRequestReceived,
        Some(account.profile_id),
        json!({ "photo_access_id": id }),
    )
    .await;
    if !matches!(created, Ok(Some(_))) {
        if let Err(error) = created {
            tracing::warn!(%error, "could not notify about a photo request");
        }
        counters::push(&state, owner_id).await;
    }
    Ok((
        StatusCode::CREATED,
        Json(PhotoRequested {
            status: PhotoAccessStatus::Pending,
        }),
    ))
}

// -------------------------------------------------------------------------------------------
// Lists
// -------------------------------------------------------------------------------------------

/// Which side of the requests a list shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Mailbox {
    /// Requests for the caller's photos, and the access the caller gave.
    Received,
    /// Requests the caller made.
    Sent,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AccessQuery {
    /// `received` (default) or `sent`.
    #[serde(rename = "box")]
    #[param(inline)]
    pub mailbox: Option<Mailbox>,
    /// `pending` (default), `granted`, `denied` or `revoked`.
    pub status: Option<PhotoAccessStatus>,
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
}

/// One request or grant.
#[derive(Debug, Serialize, ToSchema)]
pub struct PhotoAccessItem {
    /// The `photo_access` row, for `POST /v1/me/photo-access/{id}/grant` and `.../deny`.
    pub id: Uuid,
    /// The other profile: the requester in `received`, the owner in `sent`. Present even when
    /// `profile` is `null`, so a grant can still be revoked.
    pub profile_id: Uuid,
    pub status: PhotoAccessStatus,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// `null` when the other profile can no longer be opened.
    pub profile: Option<ProfileCard>,
}

/// Keyset of the list: `(created_at, id)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AccessCursor {
    #[serde(with = "time::serde::rfc3339")]
    t: OffsetDateTime,
    i: Uuid,
}

/// Requests received or sent, newest first. `box=received` (default) lists the requests for the
/// caller's photos and, with `status=granted`, the access the caller gave; `box=sent` lists the
/// caller's own requests. `status` defaults to `pending`.
///
/// A member is never told that a request was denied or that access was removed (09 sections
/// 6.3 and 6.4), so `box=sent` lists only `pending` and `granted` rows: with `status=denied` or
/// `status=revoked` it answers an empty page.
#[utoipa::path(
    get,
    path = "/me/photo-access",
    tag = "relations",
    security(("bearer" = [])),
    params(AccessQuery),
    responses(
        (status = 200, body = Page<PhotoAccessItem>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_access(
    State(state): State<AppState>,
    account: Engage,
    ApiQuery(query): ApiQuery<AccessQuery>,
) -> ApiResult<Json<Page<PhotoAccessItem>>> {
    let received = query.mailbox.unwrap_or(Mailbox::Received) == Mailbox::Received;
    let status = query.status.unwrap_or(PhotoAccessStatus::Pending);
    let params = PageParams {
        limit: query.limit,
        cursor: query.cursor,
    };
    let limit = params.limit();
    let after = params.cursor::<AccessCursor>()?.map(|c| (c.t, c.i));
    if !received
        && matches!(
            status,
            PhotoAccessStatus::Denied | PhotoAccessStatus::Revoked
        )
    {
        return Ok(Json(Page {
            items: Vec::new(),
            next_cursor: None,
        }));
    }

    let rows = db::page(
        &state.db,
        account.profile_id,
        received,
        status,
        after,
        limit + 1,
    )
    .await?;
    let viewer = views::viewer(&state, account.profile_id).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.profile_id).collect();
    let mut cards = views::cards(&state, &viewer, &ids).await?;
    Ok(Json(Page::from_rows(
        rows,
        limit,
        |row| AccessCursor {
            t: row.created_at,
            i: row.id,
        },
        |row| PhotoAccessItem {
            id: row.id,
            profile_id: row.profile_id,
            status: row.status,
            created_at: row.created_at,
            profile: cards.remove(&row.profile_id),
        },
    )))
}

// -------------------------------------------------------------------------------------------
// The owner answers
// -------------------------------------------------------------------------------------------

/// After a grant committed: `photo_request_granted` to the viewer (the duplicate rule of 14
/// section 7.2 applies inside `notify`) and, when a pending request was answered, the owner's
/// `counters`.
async fn announce_grant(
    state: &AppState,
    owner_id: Uuid,
    viewer_id: Uuid,
    access_id: Uuid,
    was_pending: bool,
) {
    match db::user_of(&state.db, viewer_id).await {
        Ok(Some(viewer_user_id)) => {
            if let Err(error) = notify(
                state,
                viewer_user_id,
                NotificationType::PhotoRequestGranted,
                Some(owner_id),
                json!({ "photo_access_id": access_id }),
            )
            .await
            {
                tracing::warn!(%error, "could not notify about a photo grant");
            }
        }
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, "could not load the viewer of a photo grant"),
    }
    if was_pending {
        counters::push(state, owner_id).await;
    }
}

/// Approve a request: `pending` to `granted`. Any other state answers `409 invalid_state`
/// with the current `status`; a request that is not the caller's answers `404`. The requester
/// receives `photo_request_granted`.
#[utoipa::path(
    post,
    path = "/me/photo-access/{id}/grant",
    tag = "relations",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "The photo access request")),
    responses(
        (status = 204, description = "Granted"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn grant_request(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    match db::decide(
        &state.db,
        id,
        account.profile_id,
        PhotoAccessStatus::Granted,
    )
    .await?
    {
        Decided::Done { viewer } => {
            announce_grant(&state, account.profile_id, viewer, id, true).await;
            Ok(StatusCode::NO_CONTENT)
        }
        Decided::Missing => Err(ApiError::NotFound),
        Decided::NotPending(status) => Err(ApiError::invalid_state(status)),
    }
}

/// Deny a request: `pending` to `denied`. The requester is not told, and may ask again after
/// `photo_access.retry_days`. Any other state answers `409 invalid_state`; a request that is
/// not the caller's answers `404`.
#[utoipa::path(
    post,
    path = "/me/photo-access/{id}/deny",
    tag = "relations",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "The photo access request")),
    responses(
        (status = 204, description = "Denied"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn deny_request(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    match db::decide(&state.db, id, account.profile_id, PhotoAccessStatus::Denied).await? {
        Decided::Done { .. } => {
            counters::push(&state, account.profile_id).await;
            Ok(StatusCode::NO_CONTENT)
        }
        Decided::Missing => Err(ApiError::NotFound),
        Decided::NotPending(status) => Err(ApiError::invalid_state(status)),
    }
}

/// Let a member see the caller's photos without a request. Allowed from no row, `denied`,
/// `revoked` and `pending` (which approves the request), and only when the caller may open the
/// target (`404` otherwise; for a `paused` caller that means members they are related to).
/// Granting twice changes nothing and answers `204`. The target receives
/// `photo_request_granted`.
#[utoipa::path(
    put,
    path = "/me/photo-access/grants/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The member to give access to")),
    responses(
        (status = 204, description = "Granted"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn put_grant(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(viewer_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let owner = views::viewer(&state, account.profile_id).await?;
    views::can_open(&state, &owner, viewer_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if let Granted::Done { id, was_pending } =
        db::grant(&state.db, account.profile_id, viewer_id).await?
    {
        announce_grant(&state, account.profile_id, viewer_id, id, was_pending).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Take access back: `granted` to `revoked`. The viewer is not told; the photos are blurred
/// again on their next request, and they may ask again after `photo_access.retry_days`. `404`
/// when the caller has no row for the member, `409 invalid_state` when the row is not
/// `granted`.
#[utoipa::path(
    delete,
    path = "/me/photo-access/grants/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The member whose access is removed")),
    responses(
        (status = 204, description = "Revoked"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn delete_grant(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(viewer_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    match db::revoke(&state.db, account.profile_id, viewer_id).await? {
        Revoked::Done => Ok(StatusCode::NO_CONTENT),
        Revoked::Missing => Err(ApiError::NotFound),
        Revoked::NotGranted(status) => Err(ApiError::invalid_state(status)),
    }
}

#[cfg(test)]
#[path = "photo_access_tests.rs"]
mod tests;
