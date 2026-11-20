//! The queries behind `GET /v1/admin/overview` (18 section 9).

use sqlx::PgPool;
use time::OffsetDateTime;

use crate::domain::time::karachi_day_start;
use crate::models::admin::{
    AdminOverview, OldestWaiting, OverviewMetrics, OverviewQueues, ProfilesByStatus, StageCounts,
};

type Count = i64;
type Oldest = Option<OffsetDateTime>;

/// Computes the whole overview with the queries of 18 section 9. "Today" starts at midnight in
/// `Asia/Karachi`.
#[allow(clippy::too_many_lines)] // One query per block of 18 section 9.
pub async fn compute(db: &PgPool, now: OffsetDateTime) -> sqlx::Result<AdminOverview> {
    let today = karachi_day_start(now);

    let (profiles_pending, oldest_profile): (Count, Oldest) = sqlx::query_as(
        "SELECT count(*), min(onboarding_completed_at) FROM profiles WHERE status = 'pending_review'",
    )
    .fetch_one(db)
    .await?;
    let (photos_pending, photos_flagged, oldest_photo): (Count, Count, Oldest) = sqlx::query_as(
        "SELECT count(*), count(*) FILTER (WHERE moderation ->> 'result' = 'flag'), min(created_at)
         FROM profile_photos WHERE status = 'pending_review'",
    )
    .fetch_one(db)
    .await?;
    // Texts waiting for a person: pending, and no moderate_text job still queued or running.
    let texts_pending: Count = sqlx::query_scalar(
        "SELECT
           (SELECT count(*) FROM profiles p
              WHERE p.about_me_status = 'pending' AND p.status <> 'deleted'
                AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'moderate_text'
                                  AND j.status IN ('queued', 'running')
                                  AND j.dedupe_key = p.id::text || ':about_me'))
         + (SELECT count(*) FROM profile_family f
              WHERE f.about_family_status = 'pending'
                AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'moderate_text'
                                  AND j.status IN ('queued', 'running')
                                  AND j.dedupe_key = f.profile_id::text || ':about_family'))
         + (SELECT count(*) FROM partner_preferences pp
              WHERE pp.notes_status = 'pending'
                AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'moderate_text'
                                  AND j.status IN ('queued', 'running')
                                  AND j.dedupe_key = pp.profile_id::text || ':partner_notes'))",
    )
    .fetch_one(db)
    .await?;
    let (verifications_pending, oldest_verification): (Count, Oldest) = sqlx::query_as(
        "SELECT count(*), min(created_at) FROM verification_requests WHERE status = 'pending'",
    )
    .fetch_one(db)
    .await?;
    let (reports_open, reports_in_review, oldest_report): (Count, Count, Oldest) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE status = 'open'),
                    count(*) FILTER (WHERE status = 'in_review'),
                    min(created_at)
             FROM reports WHERE status IN ('open', 'in_review')",
    )
    .fetch_one(db)
    .await?;
    let caste_suggestions_pending: Count =
        sqlx::query_scalar("SELECT count(*) FROM caste_suggestions WHERE status = 'pending'")
            .fetch_one(db)
            .await?;

    let (users_total, signups_today, signups_7d, users_suspended, users_banned, deletions): (
        Count,
        Count,
        Count,
        Count,
        Count,
        Count,
    ) = sqlx::query_as(
        "SELECT count(*),
                count(*) FILTER (WHERE created_at >= $1),
                count(*) FILTER (WHERE created_at > now() - interval '7 days'),
                count(*) FILTER (WHERE status = 'suspended'),
                count(*) FILTER (WHERE status = 'banned'),
                count(*) FILTER (WHERE status = 'deletion_scheduled')
         FROM users WHERE status <> 'deleted'",
    )
    .bind(today)
    .fetch_one(db)
    .await?;

    let by_status: Vec<(String, Count)> = sqlx::query_as(
        "SELECT status, count(*) FROM profiles WHERE status <> 'deleted' GROUP BY status",
    )
    .fetch_all(db)
    .await?;
    let mut profiles_by_status = ProfilesByStatus::default();
    for (status, count) in by_status {
        match status.as_str() {
            "draft" => profiles_by_status.draft = count,
            "pending_review" => profiles_by_status.pending_review = count,
            "changes_requested" => profiles_by_status.changes_requested = count,
            "active" => profiles_by_status.active = count,
            "paused" => profiles_by_status.paused = count,
            "closed" => profiles_by_status.closed = count,
            "suspended" => profiles_by_status.suspended = count,
            _ => {}
        }
    }

    let (active_male, active_female, active_id_verified, active_photo_verified, active_last_7d): (
        Count,
        Count,
        Count,
        Count,
        Count,
    ) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE gender = 'male'),
                count(*) FILTER (WHERE gender = 'female'),
                count(*) FILTER (WHERE is_id_verified),
                count(*) FILTER (WHERE is_photo_verified),
                count(*) FILTER (WHERE last_active_at > now() - interval '7 days')
         FROM profiles WHERE status = 'active'",
    )
    .fetch_one(db)
    .await?;

    let (interests_sent_today, interests_sent_7d): (Count, Count) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE created_at >= $1), count(*)
         FROM interests WHERE created_at > now() - interval '7 days'",
    )
    .bind(today)
    .fetch_one(db)
    .await?;
    let interests_accepted_7d: Count = sqlx::query_scalar(
        "SELECT count(*) FROM interests
         WHERE status = 'accepted' AND responded_at > now() - interval '7 days'",
    )
    .fetch_one(db)
    .await?;
    let (connections_active, connections_created_7d): (Count, Count) = sqlx::query_as(
        "SELECT count(*), count(*) FILTER (WHERE created_at > now() - interval '7 days')
         FROM connections WHERE status = 'active'",
    )
    .fetch_one(db)
    .await?;
    let stages: Vec<(String, Count)> = sqlx::query_as(
        "SELECT stage, count(*) FROM connections WHERE status = 'active' GROUP BY stage",
    )
    .fetch_all(db)
    .await?;
    let mut stage_counts = StageCounts::default();
    for (stage, count) in stages {
        match stage.as_str() {
            "chatting" => stage_counts.chatting = count,
            "families_talking" => stage_counts.families_talking = count,
            "engaged" => stage_counts.engaged = count,
            "nikah_done" => stage_counts.nikah_done = count,
            _ => {}
        }
    }
    let messages_7d: Count = sqlx::query_scalar(
        "SELECT count(*) FROM messages WHERE kind = 'text' AND created_at > now() - interval '7 days'",
    )
    .fetch_one(db)
    .await?;
    let reports_filed_7d: Count = sqlx::query_scalar(
        "SELECT count(*) FROM reports WHERE created_at > now() - interval '7 days'",
    )
    .fetch_one(db)
    .await?;
    let jobs_dead: Count = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE status = 'dead'")
        .fetch_one(db)
        .await?;

    Ok(AdminOverview {
        generated_at: now,
        queues: OverviewQueues {
            profiles_pending,
            photos_pending,
            photos_flagged,
            texts_pending,
            verifications_pending,
            reports_open,
            reports_in_review,
            caste_suggestions_pending,
            oldest_waiting: OldestWaiting {
                profiles: oldest_profile,
                photos: oldest_photo,
                verifications: oldest_verification,
                reports: oldest_report,
            },
        },
        metrics: OverviewMetrics {
            users_total,
            signups_today,
            signups_7d,
            profiles_by_status,
            active_male,
            active_female,
            active_id_verified,
            active_photo_verified,
            active_last_7d,
            interests_sent_today,
            interests_sent_7d,
            interests_accepted_7d,
            connections_active,
            connections_created_7d,
            stage_counts,
            messages_7d,
            reports_filed_7d,
            users_suspended,
            users_banned,
            deletions_scheduled: deletions,
            jobs_dead,
        },
    })
}
