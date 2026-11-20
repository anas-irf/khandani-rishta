//! The `sync_clerk_user` job: keeps `users` in step with Clerk (06 section 7.3, 19 section 2.19).
//!
//! It fetches the current state from Clerk instead of trusting the event payload, so old or
//! reordered events cannot overwrite newer data.

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::provisioning::{BANNED_AT_CREATION_REASON, is_banned_identity, provision};
use crate::domain::types::UserStatus;
use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue, payload};
use crate::realtime::hub::{Realtime, close_code};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct Payload {
    clerk_user_id: String,
    #[serde(default)]
    deleted: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    status: UserStatus,
    email: Option<String>,
    email_verified: bool,
    phone_e164: Option<String>,
    phone_verified: bool,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    let user: Option<UserRow> = sqlx::query_as(
        "SELECT id, status, email, email_verified, phone_e164, phone_verified
         FROM users WHERE clerk_user_id = $1",
    )
    .bind(&payload.clerk_user_id)
    .fetch_optional(&state.db)
    .await?;

    if payload.deleted {
        return removed_on_clerk(state, user).await;
    }

    let Some(clerk_user) = state.clerk.get_user(&payload.clerk_user_id).await? else {
        return Ok(JobOutcome::Skipped("clerk user not found".to_owned()));
    };
    let Some(user) = user else {
        provision(&state.db, &state.crypto, &clerk_user)
            .await
            .map_err(|error| anyhow::anyhow!("provisioning failed: {error}"))?;
        return Ok(JobOutcome::Done);
    };

    let changed = user.email != clerk_user.email
        || user.email_verified != clerk_user.email_verified
        || user.phone_e164 != clerk_user.phone_e164
        || user.phone_verified != clerk_user.phone_verified;
    if changed {
        sqlx::query(
            "UPDATE users SET email = $2, email_verified = $3, phone_e164 = $4, phone_verified = $5
             WHERE id = $1",
        )
        .bind(user.id)
        .bind(&clerk_user.email)
        .bind(clerk_user.email_verified)
        .bind(&clerk_user.phone_e164)
        .bind(clerk_user.phone_verified)
        .execute(&state.db)
        .await?;
    }
    sqlx::query(
        "UPDATE profiles SET is_phone_verified = $2, match_stale = true
         WHERE user_id = $1 AND is_phone_verified <> $2",
    )
    .bind(user.id)
    .bind(clerk_user.phone_verified)
    .execute(&state.db)
    .await?;

    if user.status == UserStatus::Active
        && is_banned_identity(
            &state.db,
            &state.crypto,
            clerk_user.email.as_deref(),
            clerk_user.phone_e164.as_deref(),
        )
        .await?
    {
        crate::sanctions::apply_ban(state, user.id, BANNED_AT_CREATION_REASON, None, None).await?;
    }
    state.accounts.invalidate(user.id);
    Ok(JobOutcome::Done)
}

/// The account was removed on Clerk's side: start the purge at once (06 section 7.3).
async fn removed_on_clerk(state: &AppState, user: Option<UserRow>) -> anyhow::Result<JobOutcome> {
    let Some(user) = user else {
        return Ok(JobOutcome::Skipped("no such user".to_owned()));
    };
    if user.status == UserStatus::Deleted {
        return Ok(JobOutcome::Skipped("already deleted".to_owned()));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "UPDATE users
         SET deletion_requested_at = now(), purge_after = now(),
             status = CASE WHEN status IN ('banned', 'suspended') THEN status ELSE 'deletion_scheduled' END
         WHERE id = $1",
    )
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    enqueue(&mut *tx, NewJob::new("purge_accounts", json!({}))).await?;
    tx.commit().await?;

    state.accounts.invalidate(user.id);
    state.hub.close_user(user.id, close_code::NOT_ALLOWED);
    state.jobs.wake();
    tracing::info!(event = "account.deletion_requested", user_id = %user.id, source = "clerk", "account removed in Clerk");
    Ok(JobOutcome::Done)
}
