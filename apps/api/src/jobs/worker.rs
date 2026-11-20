//! The job worker loop (19 sections 1.3 to 1.7).

use std::time::Duration;

use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tracing::Instrument;
use uuid::Uuid;

use crate::jobs::{self, ClaimedJob, JobOutcome, kind_spec};
use crate::state::AppState;

/// Worker tasks per process (19 section 1.4).
pub const WORKER_COUNT: usize = 2;
/// How long an idle worker waits before looking again without a wake-up.
const IDLE_WAIT: Duration = Duration::from_secs(2);
/// Longest `last_error` kept.
const MAX_ERROR_LEN: usize = 2000;

/// Claims the next due job (19 section 1.3).
pub async fn claim(db: &PgPool) -> sqlx::Result<Option<ClaimedJob>> {
    sqlx::query_as(
        "WITH next AS (
             SELECT id FROM jobs
             WHERE status = 'queued' AND run_at <= now()
             ORDER BY run_at, id
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         UPDATE jobs j
         SET status = 'running', locked_at = now(), attempts = j.attempts + 1
         FROM next
         WHERE j.id = next.id
         RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts",
    )
    .fetch_optional(db)
    .await
}

/// Backoff after a failure: `30 s * 4^n`, capped at one hour, where `n` is the number of
/// failures before this one (19 section 1.5).
pub fn backoff(failures_before: i16) -> Duration {
    let exponent = u32::try_from(failures_before.clamp(0, 10)).unwrap_or(0);
    let seconds = 30_u64.saturating_mul(4_u64.saturating_pow(exponent));
    Duration::from_secs(seconds.min(3600))
}

fn truncate(text: &str) -> String {
    text.chars().take(MAX_ERROR_LEN).collect()
}

async fn mark_succeeded(db: &PgPool, id: Uuid, note: Option<String>) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE jobs SET status = 'succeeded', finished_at = now(), locked_at = NULL, last_error = $2
         WHERE id = $1",
    )
    .bind(id)
    .bind(note)
    .execute(db)
    .await?;
    Ok(())
}

async fn mark_postponed(db: &PgPool, id: Uuid, run_at: OffsetDateTime) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE jobs SET status = 'queued', locked_at = NULL, run_at = $2,
                attempts = GREATEST(attempts - 1, 0)
         WHERE id = $1",
    )
    .bind(id)
    .bind(run_at)
    .execute(db)
    .await?;
    Ok(())
}

async fn mark_failed(db: &PgPool, job: &ClaimedJob, error: &str) -> sqlx::Result<()> {
    let error = truncate(error);
    if job.attempts >= job.max_attempts {
        sqlx::query(
            "UPDATE jobs SET status = 'dead', finished_at = now(), locked_at = NULL, last_error = $2
             WHERE id = $1",
        )
        .bind(job.id)
        .bind(&error)
        .execute(db)
        .await?;
        // An ERROR event becomes a Sentry issue (19 section 1.5).
        tracing::error!(job_id = %job.id, kind = %job.kind, last_error = %error, "job is dead");
    } else {
        let delay = backoff(job.attempts - 1);
        sqlx::query(
            "UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = $2,
                    run_at = now() + make_interval(secs => $3)
             WHERE id = $1",
        )
        .bind(job.id)
        .bind(&error)
        .bind(delay.as_secs_f64())
        .execute(db)
        .await?;
        tracing::warn!(job_id = %job.id, kind = %job.kind, attempt = job.attempts, "job failed, will retry");
    }
    Ok(())
}

/// Runs one claimed job to completion and records the result. Panics and timeouts count as
/// failures; an unknown kind is dead at once.
pub async fn execute(state: &AppState, mut job: ClaimedJob) -> sqlx::Result<()> {
    let Some(spec) = kind_spec(&job.kind) else {
        job.attempts = job.max_attempts;
        return mark_failed(&state.db, &job, &format!("unknown job kind {:?}", job.kind)).await;
    };
    let span =
        tracing::info_span!("job", job_id = %job.id, kind = %job.kind, attempt = job.attempts);
    let task_state = state.clone();
    let task_job = job.clone();
    let handle = tokio::spawn(
        async move { tokio::time::timeout(spec.timeout, jobs::run(&task_state, &task_job)).await }
            .instrument(span),
    );
    match handle.await {
        Ok(Ok(Ok(JobOutcome::Done))) => mark_succeeded(&state.db, job.id, None).await,
        Ok(Ok(Ok(JobOutcome::Skipped(reason)))) => {
            mark_succeeded(&state.db, job.id, Some(format!("skipped:{reason}"))).await
        }
        Ok(Ok(Ok(JobOutcome::Postpone(run_at)))) => mark_postponed(&state.db, job.id, run_at).await,
        Ok(Ok(Err(error))) => mark_failed(&state.db, &job, &format!("{error:#}")).await,
        Ok(Err(_elapsed)) => mark_failed(&state.db, &job, "timed out").await,
        Err(join_error) => mark_failed(&state.db, &job, &format!("panicked: {join_error}")).await,
    }
}

/// Claims and runs jobs until no due job is left. Used by tests and by the worker loop.
pub async fn drain(state: &AppState) -> sqlx::Result<usize> {
    let mut ran = 0;
    while let Some(job) = claim(&state.db).await? {
        execute(state, job).await?;
        ran += 1;
    }
    Ok(ran)
}

/// Starts the worker tasks. They stop claiming when `shutdown` turns true; running jobs
/// finish (the caller waits at most 20 seconds, 19 section 1.7).
pub fn spawn(state: &AppState, shutdown: &watch::Receiver<bool>) -> Vec<JoinHandle<()>> {
    (0..WORKER_COUNT)
        .map(|_| {
            let state = state.clone();
            let mut shutdown = shutdown.clone();
            tokio::spawn(async move {
                loop {
                    if *shutdown.borrow() {
                        break;
                    }
                    match claim(&state.db).await {
                        Ok(Some(job)) => {
                            if let Err(error) = execute(&state, job).await {
                                tracing::error!(%error, "could not record a job result");
                            }
                        }
                        Ok(None) => {
                            tokio::select! {
                                () = state.jobs.woken() => {}
                                () = tokio::time::sleep(IDLE_WAIT) => {}
                                _ = shutdown.changed() => {}
                            }
                        }
                        Err(error) => {
                            tracing::warn!(%error, "could not claim a job");
                            tokio::time::sleep(IDLE_WAIT).await;
                        }
                    }
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_by_four_and_caps_at_an_hour() {
        assert_eq!(backoff(0), Duration::from_secs(30));
        assert_eq!(backoff(1), Duration::from_mins(2));
        assert_eq!(backoff(2), Duration::from_mins(8));
        assert_eq!(backoff(3), Duration::from_mins(32));
        assert_eq!(backoff(4), Duration::from_hours(1));
        assert_eq!(backoff(9), Duration::from_hours(1));
    }
}
