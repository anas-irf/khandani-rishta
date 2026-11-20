//! The `match_digest` job (19 section 2.15, 14 section 5.4): enqueues one `match_digest` email
//! for every member who chose this frequency and has fresh matches.
//!
//! Payload: `{ "frequency": "daily" | "weekly" }`. A member qualifies with an email address, an
//! `active` account and profile, `email_match_digest` equal to the frequency and at least 3
//! cached recommendations with `shown_count = 0`. The email carries the ids of the top 5 of
//! those by `rank_score`; the `send_email` job renders names and cities at send time and leaves
//! out candidates who can no longer be opened.

use serde::Deserialize;

use crate::domain::options::EmailMatchDigest;
use crate::jobs::{ClaimedJob, JobOutcome, kind_spec, payload};
use crate::notify::email_priority;
use crate::state::AppState;

/// Fewest unseen recommendations a member needs to get a digest (19 section 2.15).
pub const MIN_UNSEEN: i64 = 3;

/// Most matches an email lists.
pub const LISTED: i64 = 5;

#[derive(Debug, Deserialize)]
struct Payload {
    frequency: EmailMatchDigest,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    if payload.frequency == EmailMatchDigest::Off {
        anyhow::bail!("match_digest frequency must be daily or weekly");
    }
    let max_attempts = kind_spec("send_email").map_or(5, |spec| spec.max_attempts);

    // One statement enqueues every email. A member who already has a digest job from the last
    // 12 hours is left out, so that running the job twice for a period sends nothing twice.
    let queued = sqlx::query(
        "INSERT INTO jobs (id, kind, payload, run_at, max_attempts, dedupe_key)
         SELECT uuidv7(), 'send_email',
                jsonb_build_object(
                    'user_id', u.id,
                    'template', 'match_digest',
                    'priority', $3::int,
                    'data', jsonb_build_object('candidate_ids', to_jsonb(fresh.top_ids))),
                now(), $2::smallint, 'match_digest:' || u.id
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         CROSS JOIN LATERAL (
             SELECT count(*) AS unseen,
                    (SELECT array_agg(t.candidate_profile_id ORDER BY t.rank_score DESC, t.candidate_profile_id)
                       FROM (SELECT candidate_profile_id, rank_score
                               FROM match_recommendations
                              WHERE profile_id = p.id AND shown_count = 0
                              ORDER BY rank_score DESC, candidate_profile_id
                              LIMIT $5) t) AS top_ids
               FROM match_recommendations r
              WHERE r.profile_id = p.id AND r.shown_count = 0) fresh
         WHERE COALESCE(np.email_match_digest, 'weekly') = $1
           AND u.email IS NOT NULL AND u.status = 'active' AND p.status = 'active'
           AND fresh.unseen >= $4
           AND NOT EXISTS (
               SELECT 1 FROM jobs j
               WHERE j.kind = 'send_email' AND j.dedupe_key = 'match_digest:' || u.id
                 AND j.created_at >= now() - interval '12 hours')
         ORDER BY u.id
         ON CONFLICT (kind, dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL
         DO NOTHING",
    )
    .bind(payload.frequency)
    .bind(max_attempts)
    .bind(i32::from(email_priority("match_digest")))
    .bind(MIN_UNSEEN)
    .bind(LISTED)
    .execute(&state.db)
    .await?
    .rows_affected();

    tracing::info!(frequency = %payload.frequency, queued, "match digest emails queued");
    if queued > 0 {
        state.jobs.wake();
    }
    Ok(JobOutcome::Done)
}
