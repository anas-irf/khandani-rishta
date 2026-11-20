//! The `profile_views_summary` job (19 section 2.17, 09 section 8.4): the daily "people viewed
//! your profile" notification.
//!
//! For each member with `record_my_visits = true` who has at least one non-private view in the
//! last 24 hours, it counts the distinct viewers the member could still open and calls
//! `notify(user, 'profile_views_summary', None, { count })`. The one-per-day duplicate rule of
//! 14 section 7.2 makes a repeated run harmless. A member who browses privately sees nobody's
//! visits, so gets no summary either.

use serde_json::json;
use uuid::Uuid;

use crate::domain::types::NotificationType;
use crate::jobs::{ClaimedJob, JobOutcome};
use crate::notify::notify;
use crate::state::AppState;

/// How far back views count.
const WINDOW_HOURS: i32 = 24;

pub async fn run(state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    // Viewers who are gone, hidden by a block or no longer active are not counted: the member
    // could not open them (09 section 8.3).
    let rows: Vec<(Uuid, i64)> = sqlx::query_as(
        "SELECT p.user_id, count(DISTINCT v.viewer_profile_id) AS viewers
         FROM profile_views v
         JOIN profiles p ON p.id = v.viewed_profile_id
         JOIN users u ON u.id = p.user_id
         JOIN profile_privacy pr ON pr.profile_id = p.id
         JOIN profiles vp ON vp.id = v.viewer_profile_id
         JOIN users vu ON vu.id = vp.user_id
         WHERE NOT v.is_private
           AND v.last_viewed_at >= now() - make_interval(hours => $1)
           AND pr.record_my_visits
           AND u.status = 'active' AND p.status IN ('active', 'paused')
           AND vu.status = 'active' AND vp.status IN ('active', 'paused', 'closed')
           AND NOT EXISTS (
               SELECT 1 FROM blocks b
               WHERE (b.blocker_profile_id = p.id AND b.blocked_profile_id = vp.id)
                  OR (b.blocker_profile_id = vp.id AND b.blocked_profile_id = p.id))
         GROUP BY p.user_id
         ORDER BY p.user_id",
    )
    .bind(WINDOW_HOURS)
    .fetch_all(&state.db)
    .await?;

    let mut created = 0_usize;
    let mut failed = 0_usize;
    for (user_id, count) in rows {
        match notify(
            state,
            user_id,
            NotificationType::ProfileViewsSummary,
            None,
            json!({ "count": count }),
        )
        .await
        {
            Ok(Some(_)) => created += 1,
            Ok(None) => {}
            Err(error) => {
                failed += 1;
                tracing::warn!(%error, %user_id, "could not create a profile views summary");
            }
        }
    }
    tracing::info!(created, failed, "profile views summaries created");
    // A failed member is retried by the next attempt; the one-per-day rule protects the others.
    if failed > 0 {
        anyhow::bail!("{failed} profile views summaries could not be created");
    }
    Ok(JobOutcome::Done)
}
