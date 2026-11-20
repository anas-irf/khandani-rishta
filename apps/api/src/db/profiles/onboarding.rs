//! SQL of the onboarding steps and the profile status changes (03 sections 4.2 and 4.3).

use sqlx::PgConnection;
use uuid::Uuid;

use crate::domain::types::{ConsentDocument, OnboardingStep, ProfileStatus};
use crate::settings::AppSettings;

/// Whether the user recorded the document at any version. Used for `candidate_consent`, which
/// has no version of its own (15 section 6).
pub async fn has_consent(
    conn: &mut PgConnection,
    user_id: Uuid,
    document: ConsentDocument,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM user_consents WHERE user_id = $1 AND document = $2)",
    )
    .bind(user_id)
    .bind(document)
    .fetch_one(conn)
    .await
}

/// The documents the user has recorded: `terms`, `privacy` and `community_guidelines` at their
/// current versions, `age_declaration` and `candidate_consent` at any version (07 section 3.4
/// rule 4).
pub async fn recorded_consents(
    conn: &mut PgConnection,
    user_id: Uuid,
    settings: &AppSettings,
) -> sqlx::Result<Vec<ConsentDocument>> {
    sqlx::query_scalar(
        "SELECT DISTINCT document FROM user_consents
         WHERE user_id = $1
           AND ((document = 'terms' AND version = $2)
             OR (document = 'privacy' AND version = $3)
             OR (document = 'community_guidelines' AND version = $4)
             OR document IN ('age_declaration', 'candidate_consent'))",
    )
    .bind(user_id)
    .bind(&settings.terms_version)
    .bind(&settings.privacy_version)
    .bind(&settings.guidelines_version)
    .fetch_all(conn)
    .await
}

/// Photos that are neither `rejected` nor `failed` (03 section 4.3, the `photos` step).
pub async fn live_photo_count(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM profile_photos
         WHERE profile_id = $1 AND status NOT IN ('rejected', 'failed')",
    )
    .bind(profile_id)
    .fetch_one(conn)
    .await
}

/// Every photo of the profile, whatever its status.
pub async fn photo_count(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT count(*) FROM profile_photos WHERE profile_id = $1")
        .bind(profile_id)
        .fetch_one(conn)
        .await
}

/// A system report (suspicion of a returning banned member) that is still open (13 section 2.3).
pub async fn has_open_system_report(
    conn: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM reports
                         WHERE target_profile_id = $1 AND source = 'system'
                           AND status IN ('open', 'in_review'))",
    )
    .bind(profile_id)
    .fetch_one(conn)
    .await
}

/// Moves the onboarding pointer to `step`.
pub async fn set_step(
    conn: &mut PgConnection,
    profile_id: Uuid,
    step: OnboardingStep,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE profiles SET onboarding_step = $2 WHERE id = $1")
        .bind(profile_id)
        .bind(step)
        .execute(conn)
        .await?;
    Ok(())
}

/// Finishes onboarding (15 section 7): the pointer reaches `done` and the profile gets its
/// first status. Entering `active` for the first time sets `first_activated_at`.
pub async fn complete_onboarding(
    conn: &mut PgConnection,
    profile_id: Uuid,
    status: ProfileStatus,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET onboarding_step = 'done', onboarding_completed_at = now(),
                status = $2, match_stale = true,
                first_activated_at = CASE WHEN $2 = 'active'
                                          THEN COALESCE(first_activated_at, now())
                                          ELSE first_activated_at END
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(status)
    .execute(conn)
    .await?;
    Ok(())
}

/// `changes_requested` to `pending_review`, clearing the moderator's note (15 section 7).
pub async fn resubmit(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET status = 'pending_review', status_reason = NULL WHERE id = $1",
    )
    .bind(profile_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// `active` to `paused`.
pub async fn pause(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("UPDATE profiles SET status = 'paused', paused_at = now() WHERE id = $1")
        .bind(profile_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// `paused` to `active`: the profile is a returning member, so its recommendations are stale
/// (10 section 8.2).
pub async fn resume(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET status = 'active', paused_at = NULL, match_stale = true WHERE id = $1",
    )
    .bind(profile_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// `active` or `paused` to `closed`.
pub async fn close(
    conn: &mut PgConnection,
    profile_id: Uuid,
    reason: crate::domain::options::ClosedReason,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET status = 'closed', closed_at = now(), closed_reason = $2,
                paused_at = NULL
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(reason)
    .execute(conn)
    .await?;
    Ok(())
}

/// `closed` to `active`.
pub async fn reopen(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET status = 'active', closed_at = NULL, closed_reason = NULL,
                match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// The active connections of the profile that reached `nikah_done` (03 section 4.2: reopening
/// after a nikah ends them).
pub async fn nikah_connections(
    conn: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT id FROM connections
         WHERE status = 'active' AND stage = 'nikah_done'
           AND (profile_low_id = $1 OR profile_high_id = $1)
         FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_all(conn)
    .await
}

/// Seconds between the creation of the account and now, for the `onboarding.completed` event
/// (20 section 8.2).
pub async fn seconds_since_signup(conn: &mut PgConnection, user_id: Uuid) -> sqlx::Result<i64> {
    let seconds: f64 = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM (now() - created_at))::float8 FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(conn)
    .await?;
    #[expect(
        clippy::cast_possible_truncation,
        reason = "a duration in seconds fits"
    )]
    Ok(seconds as i64)
}
