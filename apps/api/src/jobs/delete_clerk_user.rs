//! The `delete_clerk_user` job: removes the login of a purged account (06 section 9.4,
//! 19 section 2.21). A 404 from Clerk counts as success.

use serde::Deserialize;

use crate::jobs::{ClaimedJob, JobOutcome, payload};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct Payload {
    clerk_user_id: String,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    state.clerk.delete_user(&payload.clerk_user_id).await?;
    Ok(JobOutcome::Done)
}
