//! `POST /v1/me/profile/pause`, `resume`, `close` and `reopen` (15 section 7, 03 section 4.2,
//! 08 section 7). All four need the level `connected` and return `Me`.

use axum::Json;
use axum::extract::State;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::auth::Connected;
use crate::db::counters;
use crate::db::profiles::onboarding;
use crate::domain::options::ConnectionEndReason;
use crate::domain::types::ProfileStatus;
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::ApiJson;
use crate::lifecycle::{end_connection, expire_pending_interests};
use crate::models::me::{self, Me};
use crate::models::profile::{CloseBody, ReopenBody};
use crate::state::AppState;

/// The stored status, with the row locked until the transaction ends. The cached account
/// snapshot can be up to 30 seconds old, so the transition is judged against this value.
async fn locked_status(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<ProfileStatus> {
    sqlx::query_scalar("SELECT status FROM profiles WHERE id = $1 FOR UPDATE")
        .bind(profile_id)
        .fetch_one(conn)
        .await
}

fn log_status_change(account: &Connected, from: ProfileStatus, to: ProfileStatus) {
    tracing::info!(
        event = "profile.status_changed",
        user_id = %account.user_id,
        profile_id = %account.profile_id,
        from = %from,
        to = %to,
        "profile status changed"
    );
}

/// Hide the profile from discovery: `active` to `paused`.
///
/// Pending interests stay and can still be answered (03 section 4.2). `invalid_state` from any
/// other status.
#[utoipa::path(
    post,
    path = "/me/profile/pause",
    tag = "profile",
    security(("bearer" = [])),
    responses((status = 200, body = Me), (status = 409, body = ErrorBody))
)]
pub async fn post_pause(State(state): State<AppState>, account: Connected) -> ApiResult<Json<Me>> {
    let mut tx = state.db.begin().await?;
    let status = locked_status(&mut tx, account.profile_id).await?;
    if status != ProfileStatus::Active {
        return Err(ApiError::invalid_state(status));
    }
    onboarding::pause(&mut tx, account.profile_id).await?;
    tx.commit().await?;

    state.accounts.invalidate(account.user_id);
    log_status_change(&account, status, ProfileStatus::Paused);
    Ok(Json(me::reload(&state, &account).await?))
}

/// Go live again: `paused` to `active`. The recommendations are marked stale (10 section 8.2).
#[utoipa::path(
    post,
    path = "/me/profile/resume",
    tag = "profile",
    security(("bearer" = [])),
    responses((status = 200, body = Me), (status = 409, body = ErrorBody))
)]
pub async fn post_resume(State(state): State<AppState>, account: Connected) -> ApiResult<Json<Me>> {
    let mut tx = state.db.begin().await?;
    let status = locked_status(&mut tx, account.profile_id).await?;
    if status != ProfileStatus::Paused {
        return Err(ApiError::invalid_state(status));
    }
    onboarding::resume(&mut tx, account.profile_id).await?;
    tx.commit().await?;

    state.accounts.invalidate(account.user_id);
    log_status_change(&account, status, ProfileStatus::Active);
    Ok(Json(me::reload(&state, &account).await?))
}

/// Close the profile: `active` or `paused` to `closed`.
///
/// Every pending interest sent or received by the profile expires (03 section 4.2); the
/// connections stay and become read-only.
#[utoipa::path(
    post,
    path = "/me/profile/close",
    tag = "profile",
    security(("bearer" = [])),
    request_body = CloseBody,
    responses(
        (status = 200, body = Me),
        (status = 400, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn post_close(
    State(state): State<AppState>,
    account: Connected,
    ApiJson(body): ApiJson<CloseBody>,
) -> ApiResult<Json<Me>> {
    let mut tx = state.db.begin().await?;
    let status = locked_status(&mut tx, account.profile_id).await?;
    if !matches!(status, ProfileStatus::Active | ProfileStatus::Paused) {
        return Err(ApiError::invalid_state(status));
    }
    onboarding::close(&mut tx, account.profile_id, body.reason).await?;
    let expired = expire_pending_interests(&mut tx, account.profile_id).await?;
    tx.commit().await?;

    state.accounts.invalidate(account.user_id);
    log_status_change(&account, status, ProfileStatus::Closed);
    // The receivers of the expired interests have one pending interest fewer (14 section 8.2).
    let mut receivers: Vec<Uuid> = expired.iter().map(|(_, receiver)| *receiver).collect();
    receivers.sort_unstable();
    receivers.dedup();
    for receiver in receivers {
        counters::push(&state, receiver).await;
    }
    Ok(Json(me::reload(&state, &account).await?))
}

/// Open a closed profile again: `closed` to `active`.
///
/// `confirm` must be `true`. When the profile was closed after a confirmed nikah, reopening
/// ends that connection with the reason `other` (03 section 4.2); the clients ask the member to
/// type a confirmation first.
#[utoipa::path(
    post,
    path = "/me/profile/reopen",
    tag = "profile",
    security(("bearer" = [])),
    request_body = ReopenBody,
    responses(
        (status = 200, body = Me),
        (status = 400, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn post_reopen(
    State(state): State<AppState>,
    account: Connected,
    ApiJson(body): ApiJson<ReopenBody>,
) -> ApiResult<Json<Me>> {
    if !body.confirm {
        return Err(ApiError::field("confirm", FieldCode::Required));
    }
    let mut tx = state.db.begin().await?;
    let status = locked_status(&mut tx, account.profile_id).await?;
    if status != ProfileStatus::Closed {
        return Err(ApiError::invalid_state(status));
    }
    let mut ended = Vec::new();
    for connection_id in onboarding::nikah_connections(&mut tx, account.profile_id).await? {
        if let Some(connection) = end_connection(
            &mut tx,
            connection_id,
            Some(account.profile_id),
            ConnectionEndReason::Other.as_str(),
        )
        .await?
        {
            ended.push(connection);
        }
    }
    onboarding::reopen(&mut tx, account.profile_id).await?;
    tx.commit().await?;

    state.accounts.invalidate(account.user_id);
    log_status_change(&account, status, ProfileStatus::Active);
    // Ending a connection changes the unread chats of both members (14 section 8.2).
    for connection in ended {
        crate::models::connections::publish_updated(&state, connection.connection_id).await;
        counters::push(&state, connection.profile_low_id).await;
        counters::push(&state, connection.profile_high_id).await;
    }
    Ok(Json(me::reload(&state, &account).await?))
}
