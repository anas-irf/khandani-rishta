//! The `revoke_clerk_sessions` job (06 section 8.2, 19 section 2.20).
//!
//! Signing the person out everywhere is a courtesy, not the control: every request is refused
//! by the access-level extractors whatever Clerk thinks.

use serde::Deserialize;
use uuid::Uuid;

use crate::jobs::{ClaimedJob, JobOutcome, payload};
use crate::realtime::hub::{Realtime, close_code};
use crate::services::clerk::BanOutcome;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct Payload {
    clerk_user_id: String,
    #[serde(default)]
    ban: bool,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    for session_id in state.clerk.active_sessions(&payload.clerk_user_id).await? {
        state.clerk.revoke_session(&session_id).await?;
    }
    if payload.ban
        && state.config.clerk.ban_enabled
        && state.clerk.ban_user(&payload.clerk_user_id).await? == BanOutcome::NotIncluded
    {
        tracing::warn!("the Clerk plan does not include bans; CLERK_BAN_ENABLED should be false");
    }
    let user_id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE clerk_user_id = $1")
        .bind(&payload.clerk_user_id)
        .fetch_optional(&state.db)
        .await?;
    if let Some(user_id) = user_id {
        state.hub.close_user(user_id, close_code::NOT_ALLOWED);
    }
    Ok(JobOutcome::Done)
}
