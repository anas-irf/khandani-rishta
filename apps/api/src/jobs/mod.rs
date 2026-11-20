//! Background jobs in PostgreSQL, claimed with `FOR UPDATE SKIP LOCKED` (19 sections 1 to 3).
//!
//! Delivery is at least once, so every handler is idempotent. A handler never holds a
//! transaction open while calling an external service.

pub mod announcement_fanout;
pub mod build_export;
pub mod cleanup_old_rows;
pub mod cleanup_uploads;
pub mod delete_clerk_user;
pub mod delete_objects;
pub mod expire_interests;
pub mod lift_suspensions;
pub mod match_digest;
pub mod moderate_text;
pub mod process_photo;
pub mod profile_views_summary;
pub mod purge_accounts;
pub mod purge_verification_media;
pub mod refresh_recommendations;
pub mod revoke_clerk_sessions;
pub mod saved_search_alerts;
pub mod scheduler;
pub mod send_email;
pub mod send_push;
pub mod sync_clerk_user;
pub mod worker;

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::Value;
use time::OffsetDateTime;
use tokio::sync::Notify;
use uuid::Uuid;

use crate::state::AppState;

/// Every job kind with its attempt limit and timeout (19 section 2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KindSpec {
    pub kind: &'static str,
    pub max_attempts: i16,
    pub timeout: Duration,
}

const fn spec(kind: &'static str, max_attempts: i16, timeout_seconds: u64) -> KindSpec {
    KindSpec {
        kind,
        max_attempts,
        timeout: Duration::from_secs(timeout_seconds),
    }
}

pub const KINDS: &[KindSpec] = &[
    spec("process_photo", 3, 120),
    spec("delete_objects", 5, 120),
    spec("moderate_text", 3, 60),
    spec("refresh_recommendations", 2, 120),
    spec("send_push", 4, 30),
    spec("send_email", 5, 30),
    spec("expire_interests", 3, 120),
    spec("lift_suspensions", 3, 60),
    spec("purge_accounts", 3, 300),
    spec("purge_verification_media", 3, 120),
    spec("cleanup_uploads", 3, 300),
    spec("cleanup_old_rows", 3, 300),
    spec("build_export", 3, 300),
    spec("match_digest", 2, 120),
    spec("saved_search_alerts", 2, 300),
    spec("profile_views_summary", 2, 120),
    spec("announcement_fanout", 3, 120),
    spec("sync_clerk_user", 5, 30),
    spec("revoke_clerk_sessions", 5, 60),
    spec("delete_clerk_user", 8, 30),
];

/// The spec of a kind, or `None` for an unknown kind (such a job becomes `dead` at once).
pub fn kind_spec(kind: &str) -> Option<KindSpec> {
    KINDS.iter().copied().find(|spec| spec.kind == kind)
}

/// A job to enqueue (19 section 1.2).
#[derive(Debug, Clone)]
pub struct NewJob {
    pub kind: &'static str,
    pub payload: Value,
    /// `None`: now.
    pub run_at: Option<OffsetDateTime>,
    pub dedupe_key: Option<String>,
    pub max_attempts: i16,
}

impl NewJob {
    /// A job with the default attempt limit of its kind.
    pub fn new(kind: &'static str, payload: Value) -> Self {
        Self {
            kind,
            payload,
            run_at: None,
            dedupe_key: None,
            max_attempts: kind_spec(kind).map_or(5, |spec| spec.max_attempts),
        }
    }

    #[must_use]
    pub fn dedupe(mut self, key: impl Into<String>) -> Self {
        self.dedupe_key = Some(key.into());
        self
    }

    #[must_use]
    pub fn run_at(mut self, at: OffsetDateTime) -> Self {
        self.run_at = Some(at);
        self
    }
}

/// Inserts a job, usable inside the caller's transaction so the job exists only if the change
/// commits. Returns false when an identical queued job already existed. Call
/// [`JobQueue::wake`] after commit so an idle worker starts at once.
pub async fn enqueue<'e>(db: impl sqlx::PgExecutor<'e>, job: NewJob) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "INSERT INTO jobs (id, kind, payload, run_at, max_attempts, dedupe_key)
         VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6)
         ON CONFLICT (kind, dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL
         DO NOTHING",
    )
    .bind(Uuid::now_v7())
    .bind(job.kind)
    .bind(&job.payload)
    .bind(job.run_at)
    .bind(job.max_attempts)
    .bind(&job.dedupe_key)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// What a handler decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobOutcome {
    /// The work is done.
    Done,
    /// The job chose not to act; recorded as `skipped:<reason>` in `last_error`.
    Skipped(String),
    /// Run again at this time without counting the attempt (quiet hours, 19 section 2.6).
    Postpone(OffsetDateTime),
}

/// One claimed job.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClaimedJob {
    pub id: Uuid,
    pub kind: String,
    pub payload: Value,
    pub attempts: i16,
    pub max_attempts: i16,
}

impl ClaimedJob {
    /// True on the final allowed attempt, so a handler can record a permanent failure.
    pub fn is_last_attempt(&self) -> bool {
        self.attempts >= self.max_attempts
    }
}

/// Parses a job payload, failing the attempt on a malformed payload.
pub fn payload<T: DeserializeOwned>(job: &ClaimedJob) -> anyhow::Result<T> {
    serde_json::from_value(job.payload.clone())
        .map_err(|error| anyhow::anyhow!("invalid {} payload: {error}", job.kind))
}

/// Runs the handler of a job's kind.
pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    match job.kind.as_str() {
        "process_photo" => process_photo::run(state, job).await,
        "delete_objects" => delete_objects::run(state, job).await,
        "moderate_text" => moderate_text::run(state, job).await,
        "refresh_recommendations" => refresh_recommendations::run(state, job).await,
        "send_push" => send_push::run(state, job).await,
        "send_email" => send_email::run(state, job).await,
        "expire_interests" => expire_interests::run(state, job).await,
        "lift_suspensions" => lift_suspensions::run(state, job).await,
        "purge_accounts" => purge_accounts::run(state, job).await,
        "purge_verification_media" => purge_verification_media::run(state, job).await,
        "cleanup_uploads" => cleanup_uploads::run(state, job).await,
        "cleanup_old_rows" => cleanup_old_rows::run(state, job).await,
        "build_export" => build_export::run(state, job).await,
        "match_digest" => match_digest::run(state, job).await,
        "saved_search_alerts" => saved_search_alerts::run(state, job).await,
        "profile_views_summary" => profile_views_summary::run(state, job).await,
        "announcement_fanout" => announcement_fanout::run(state, job).await,
        "sync_clerk_user" => sync_clerk_user::run(state, job).await,
        "revoke_clerk_sessions" => revoke_clerk_sessions::run(state, job).await,
        "delete_clerk_user" => delete_clerk_user::run(state, job).await,
        other => anyhow::bail!("unknown job kind {other:?}"),
    }
}

/// Wakes idle workers when a job is enqueued outside the scheduler.
#[derive(Debug, Default)]
pub struct JobQueue {
    notify: Notify,
}

impl JobQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Call after a successful enqueue (or after the transaction holding it commits).
    pub fn wake(&self) {
        self.notify.notify_waiters();
    }

    /// Resolves on the next [`JobQueue::wake`].
    pub async fn woken(&self) {
        self.notify.notified().await;
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::*;

    #[sqlx::test]
    async fn dedupe_keeps_one_queued_job_per_key(db: PgPool) {
        let job = NewJob::new("moderate_text", json!({ "field": "about_me" })).dedupe("p:about_me");
        assert!(enqueue(&db, job.clone()).await.unwrap());
        assert!(!enqueue(&db, job.clone()).await.unwrap());

        sqlx::query("UPDATE jobs SET status = 'succeeded'")
            .execute(&db)
            .await
            .unwrap();
        assert!(
            enqueue(&db, job).await.unwrap(),
            "only queued jobs block a new one"
        );
    }

    #[test]
    fn every_kind_has_a_spec() {
        assert_eq!(kind_spec("delete_clerk_user").unwrap().max_attempts, 8);
        assert_eq!(NewJob::new("process_photo", json!({})).max_attempts, 3);
        assert!(kind_spec("nope").is_none());
        assert_eq!(KINDS.len(), 20);
    }
}
