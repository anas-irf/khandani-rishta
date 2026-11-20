//! The `lift_suspensions` job (19 section 2). Not implemented yet.

use crate::jobs::{ClaimedJob, JobOutcome};
use crate::state::AppState;

#[allow(clippy::unused_async)] // Stub until the job is built.
pub async fn run(_state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    Ok(JobOutcome::Skipped("not implemented".to_owned()))
}
