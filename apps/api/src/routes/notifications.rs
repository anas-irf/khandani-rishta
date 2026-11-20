//! Notification feed, notification preferences and push devices (15 sections 6 and 14).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::{Auth, Open};
use crate::db::counters;
use crate::db::notifications as store;
use crate::db::pagination::{Page, PageParams};
use crate::error::{ApiResult, ErrorBody};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::notifications::{
    DeviceBody, Notification, NotificationPreferences, PreferencesBody, ReadBody, ReadTarget,
    format_clock,
};
use crate::notify::feed;
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_notifications))
        .routes(routes!(mark_read))
        .routes(routes!(get_preferences, put_preferences))
        .routes(routes!(register_device))
        .routes(routes!(remove_device))
}

/// The notification feed, newest first. Rows whose actor the caller can no longer open are
/// left out (14 section 7.3 rule 3).
#[utoipa::path(
    get,
    path = "/notifications",
    tag = "notifications",
    security(("bearer" = [])),
    params(PageParams),
    responses(
        (status = 200, body = Page<Notification>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_notifications(
    State(state): State<AppState>,
    account: Open,
    ApiQuery(params): ApiQuery<PageParams>,
) -> ApiResult<Json<Page<Notification>>> {
    Ok(Json(
        feed::page(&state, account.user_id, account.profile_id, &params).await?,
    ))
}

/// Marks notifications as read: `{ "ids": [...] }` or `{ "all": true }`. Ids that are not the
/// caller's are ignored. The `counters` event goes to the caller's sockets.
#[utoipa::path(
    post,
    operation_id = "mark_notifications_read",
    path = "/notifications/read",
    tag = "notifications",
    security(("bearer" = [])),
    request_body = ReadBody,
    responses(
        (status = 204, description = "Marked as read"),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn mark_read(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<ReadBody>,
) -> ApiResult<StatusCode> {
    let changed = match body.target()? {
        ReadTarget::All => store::mark_all_read(&state.db, account.user_id).await?,
        ReadTarget::Ids(ids) => store::mark_read(&state.db, account.user_id, &ids).await?,
    };
    if changed > 0 {
        counters::push(&state, account.profile_id).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

impl From<store::PrefsRow> for NotificationPreferences {
    fn from(row: store::PrefsRow) -> Self {
        Self {
            push_interests: row.push_interests,
            push_messages: row.push_messages,
            push_photo_requests: row.push_photo_requests,
            push_profile_views: row.push_profile_views,
            push_matches: row.push_matches,
            email_interests: row.email_interests,
            email_messages: row.email_messages,
            email_match_digest: row.email_match_digest,
            email_announcements: row.email_announcements,
            quiet_hours_start: row.quiet_hours_start.map(format_clock),
            quiet_hours_end: row.quiet_hours_end.map(format_clock),
        }
    }
}

/// The caller's notification settings (14 section 6.1).
#[utoipa::path(
    get,
    operation_id = "get_notification_preferences",
    path = "/me/notification-preferences",
    tag = "notifications",
    security(("bearer" = [])),
    responses(
        (status = 200, body = NotificationPreferences),
        (status = 403, body = ErrorBody)
    )
)]
async fn get_preferences(
    State(state): State<AppState>,
    account: Open,
) -> ApiResult<Json<NotificationPreferences>> {
    Ok(Json(
        store::preferences(&state.db, account.user_id).await?.into(),
    ))
}

/// Replaces the notification settings. Every switch is required; the quiet hours are both set
/// or both `null` (14 section 6.2).
#[utoipa::path(
    put,
    operation_id = "put_notification_preferences",
    path = "/me/notification-preferences",
    tag = "notifications",
    security(("bearer" = [])),
    request_body = PreferencesBody,
    responses(
        (status = 200, body = NotificationPreferences),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn put_preferences(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<PreferencesBody>,
) -> ApiResult<Json<NotificationPreferences>> {
    let valid = body.validate()?;
    Ok(Json(
        store::save_preferences(&state.db, account.user_id, &valid)
            .await?
            .into(),
    ))
}

/// Registers a push token. The token is unique: one already registered to another user moves
/// to the caller (14 section 4.4).
#[utoipa::path(
    post,
    path = "/me/devices",
    tag = "notifications",
    security(("bearer" = [])),
    request_body = DeviceBody,
    responses(
        (status = 204, description = "Registered"),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn register_device(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<DeviceBody>,
) -> ApiResult<StatusCode> {
    let device = body.validate()?;
    store::upsert_device(
        &state.db,
        account.user_id,
        device.platform,
        &device.push_token,
        device.app_version.as_deref(),
        device.device_model.as_deref(),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Removes the caller's registration of a push token, on sign-out. Answers `204` also when the
/// token is not registered, so that signing out never fails.
#[utoipa::path(
    delete,
    path = "/me/devices/{push_token}",
    tag = "notifications",
    security(("bearer" = [])),
    params(("push_token" = String, Path, description = "The FCM registration token")),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, body = ErrorBody)
    )
)]
async fn remove_device(
    State(state): State<AppState>,
    account: Auth,
    ApiPath(push_token): ApiPath<String>,
) -> ApiResult<StatusCode> {
    store::delete_device(&state.db, account.user_id, &push_token).await?;
    Ok(StatusCode::NO_CONTENT)
}
