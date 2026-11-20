//! SQL and shared steps of the account lifecycle: deletion requests (06 section 9) and data
//! exports (09 section 12.1).

use serde_json::json;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::types::{ExportStatus, UserStatus};
use crate::error::ApiError;
use crate::jobs::{NewJob, enqueue};
use crate::notify::queue_email;
use crate::realtime::hub::{Realtime, ServerEvent, close_code};
use crate::state::AppState;

/// How soon a member may ask for another export (15 section 6).
pub const EXPORT_INTERVAL: Duration = Duration::hours(24);

/// Drops the user's snapshot, loads the fresh one and sends `gate.changed` with the new gate to
/// the user's sockets (14 section 2, rows 16, 18 and 32). Never fails the caller.
pub async fn push_gate(state: &AppState, user_id: Uuid) {
    state.accounts.invalidate(user_id);
    let clerk_user_id: Option<String> =
        match sqlx::query_scalar("SELECT clerk_user_id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(id) => id,
            Err(error) => {
                tracing::warn!(%error, "could not load the user to push the gate");
                return;
            }
        };
    let Some(clerk_user_id) = clerk_user_id else {
        return;
    };
    let settings = match state.settings.get().await {
        Ok(settings) => settings,
        Err(error) => {
            tracing::warn!(%error, "could not load the settings to push the gate");
            return;
        }
    };
    match crate::auth::account::load(&state.db, &clerk_user_id, &settings).await {
        Ok(Some(snapshot)) => state.hub.send_to_profile(
            snapshot.profile_id,
            &ServerEvent::gate_changed(snapshot.gate()),
        ),
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, "could not load the account to push the gate"),
    }
}

/// Schedules the deletion of an account (06 section 9.2): sets `deletion_requested_at` and
/// `purge_after`, and moves an `active` user to `deletion_scheduled`. A `suspended` or `banned`
/// user keeps that status so the sanction cannot be escaped by cancelling.
///
/// `409 invalid_state` when a deletion is already scheduled. After the commit the snapshot is
/// invalidated and the user's sockets are closed.
pub async fn request_deletion(
    state: &AppState,
    user_id: Uuid,
    grace_days: i64,
) -> Result<(), ApiError> {
    let grace_days = i32::try_from(grace_days).unwrap_or(30);
    let mut tx = state.db.begin().await?;
    crate::sanctions::lock_profile_of(&mut tx, user_id).await?;
    let current: Option<(UserStatus, Option<OffsetDateTime>)> =
        sqlx::query_as("SELECT status, purge_after FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((status, purge_after)) = current else {
        return Err(ApiError::Unauthenticated);
    };
    let allowed = matches!(
        status,
        UserStatus::Active | UserStatus::Suspended | UserStatus::Banned
    );
    if purge_after.is_some() || !allowed {
        return Err(ApiError::invalid_state(status));
    }
    let new_status = match status {
        UserStatus::Suspended | UserStatus::Banned => status,
        _ => UserStatus::DeletionScheduled,
    };
    let purge_after: OffsetDateTime = sqlx::query_scalar(
        "UPDATE users
         SET status = $2, deletion_requested_at = now(),
             purge_after = now() + make_interval(days => $3)
         WHERE id = $1 RETURNING purge_after",
    )
    .bind(user_id)
    .bind(new_status)
    .bind(grace_days)
    .fetch_one(&mut *tx)
    .await?;
    queue_email(
        &mut *tx,
        user_id,
        "account_deletion",
        json!({ "form": "scheduled", "purge_after": purge_after.unix_timestamp() }),
        None,
    )
    .await?;
    tx.commit().await?;

    if new_status == UserStatus::DeletionScheduled {
        push_gate(state, user_id).await;
    } else {
        state.accounts.invalidate(user_id);
    }
    state.hub.close_user(user_id, close_code::NOT_ALLOWED);
    state.jobs.wake();
    Ok(())
}

/// Cancels a scheduled deletion (06 section 9.3). A `deletion_scheduled` user becomes `active`
/// again; a `suspended` or `banned` user keeps that status and only the timestamps are cleared.
/// `409 invalid_state` when no deletion is scheduled.
pub async fn cancel_deletion(state: &AppState, user_id: Uuid) -> Result<(), ApiError> {
    let mut tx = state.db.begin().await?;
    crate::sanctions::lock_profile_of(&mut tx, user_id).await?;
    let current: Option<(UserStatus, Option<OffsetDateTime>)> =
        sqlx::query_as("SELECT status, purge_after FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((status, purge_after)) = current else {
        return Err(ApiError::Unauthenticated);
    };
    if purge_after.is_none() {
        return Err(ApiError::invalid_state(status));
    }
    let new_status = if status == UserStatus::DeletionScheduled {
        UserStatus::Active
    } else {
        status
    };
    sqlx::query(
        "UPDATE users SET status = $2, deletion_requested_at = NULL, purge_after = NULL
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(new_status)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE profiles SET match_stale = true WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    queue_email(
        &mut *tx,
        user_id,
        "account_deletion",
        json!({ "form": "cancelled" }),
        None,
    )
    .await?;
    tx.commit().await?;

    if status == UserStatus::DeletionScheduled {
        push_gate(state, user_id).await;
    } else {
        state.accounts.invalidate(user_id);
    }
    state.jobs.wake();
    Ok(())
}

/// Records an export request and enqueues `build_export` (09 section 12.1). At most one request
/// per 24 hours: otherwise `429 limit_reached` with the time the next one is allowed.
pub async fn create_export(state: &AppState, user_id: Uuid) -> Result<Uuid, ApiError> {
    let mut tx = state.db.begin().await?;
    // The user row lock makes two simultaneous requests of one member take turns.
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
    let recent: Option<OffsetDateTime> = sqlx::query_scalar(
        "SELECT created_at FROM data_exports
         WHERE user_id = $1 AND created_at > now() - make_interval(hours => 24)
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(created_at) = recent {
        return Err(ApiError::LimitReached {
            limit: "data_exports_per_day",
            used: 1,
            resets_at: Some(created_at + EXPORT_INTERVAL),
            side: None,
        });
    }
    let export_id = Uuid::now_v7();
    sqlx::query("INSERT INTO data_exports (id, user_id) VALUES ($1, $2)")
        .bind(export_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    enqueue(
        &mut *tx,
        NewJob::new("build_export", json!({ "export_id": export_id }))
            .dedupe(export_id.to_string()),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();
    Ok(export_id)
}

/// The newest export of a member.
#[derive(Debug, sqlx::FromRow)]
pub struct ExportRow {
    pub id: Uuid,
    pub status: ExportStatus,
    pub file_key: Option<String>,
    pub expires_at: Option<OffsetDateTime>,
}

pub async fn latest_export(db: &sqlx::PgPool, user_id: Uuid) -> sqlx::Result<Option<ExportRow>> {
    sqlx::query_as(
        "SELECT id, status, file_key, expires_at FROM data_exports
         WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
}
