//! SQL for relations: shortlist, pass and block (15 section 13, 09 section 11).

use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::lifecycle::{self, EndedConnection, ordered_pair};

/// Most entries in a shortlist (03 section 7: a fixed limit, not a setting).
pub const SHORTLIST_MAX: i64 = 200;

/// The gender of a profile, when it exists.
pub async fn profile_gender(db: &PgPool, profile_id: Uuid) -> sqlx::Result<Option<Option<Gender>>> {
    sqlx::query_scalar("SELECT gender FROM profiles WHERE id = $1")
        .bind(profile_id)
        .fetch_optional(db)
        .await
}

// -------------------------------------------------------------------------------------------
// Shortlist
// -------------------------------------------------------------------------------------------

/// Adds a profile to the shortlist or replaces its note. `Err(used)` when the shortlist is full
/// and the target is not already on it. The owner's profile row is locked so two concurrent
/// additions cannot pass the limit together.
pub async fn shortlist_put(
    db: &PgPool,
    profile_id: Uuid,
    target: Uuid,
    note: Option<&str>,
) -> sqlx::Result<Result<(), i64>> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    let (count, present): (i64, bool) = sqlx::query_as(
        "SELECT count(*), bool_or(target_profile_id = $2) IS TRUE
         FROM shortlists WHERE profile_id = $1",
    )
    .bind(profile_id)
    .bind(target)
    .fetch_one(&mut *tx)
    .await?;
    if !present && count >= SHORTLIST_MAX {
        return Ok(Err(count));
    }
    sqlx::query(
        "INSERT INTO shortlists (profile_id, target_profile_id, note) VALUES ($1, $2, $3)
         ON CONFLICT (profile_id, target_profile_id) DO UPDATE SET note = EXCLUDED.note",
    )
    .bind(profile_id)
    .bind(target)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Ok(()))
}

/// Removes a profile from the shortlist. Removing an absent entry is not an error.
pub async fn shortlist_delete(db: &PgPool, profile_id: Uuid, target: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM shortlists WHERE profile_id = $1 AND target_profile_id = $2")
        .bind(profile_id)
        .bind(target)
        .execute(db)
        .await?;
    Ok(())
}

/// A shortlist entry.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ShortlistRow {
    pub target_profile_id: Uuid,
    pub note: Option<String>,
    pub created_at: OffsetDateTime,
}

/// One page of the shortlist, newest first, after the keyset `(created_at, target id)`.
pub async fn shortlist_page(
    db: &PgPool,
    profile_id: Uuid,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<ShortlistRow>> {
    sqlx::query_as(
        "SELECT target_profile_id, note, created_at FROM shortlists
         WHERE profile_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, target_profile_id) < ($2, $3))
         ORDER BY created_at DESC, target_profile_id DESC
         LIMIT $4",
    )
    .bind(profile_id)
    .bind(after.map(|(at, _)| at))
    .bind(after.map(|(_, id)| id))
    .bind(limit)
    .fetch_all(db)
    .await
}

// -------------------------------------------------------------------------------------------
// Pass
// -------------------------------------------------------------------------------------------

/// Passes a profile for `days` days: sets `expires_at`, removes the profile from the caller's
/// recommendations (10 section 8.3) and removes the caller's shortlist entry for it (15
/// section 13), in one transaction. Passing again restarts the period.
pub async fn pass_put(db: &PgPool, profile_id: Uuid, target: Uuid, days: i64) -> sqlx::Result<()> {
    let days = i32::try_from(days.max(0)).unwrap_or(i32::MAX);
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO passes (profile_id, target_profile_id, expires_at)
         VALUES ($1, $2, now() + make_interval(days => $3))
         ON CONFLICT (profile_id, target_profile_id)
         DO UPDATE SET expires_at = EXCLUDED.expires_at, created_at = now()",
    )
    .bind(profile_id)
    .bind(target)
    .bind(days)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM match_recommendations WHERE profile_id = $1 AND candidate_profile_id = $2",
    )
    .bind(profile_id)
    .bind(target)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM shortlists WHERE profile_id = $1 AND target_profile_id = $2")
        .bind(profile_id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

/// Undoes a pass and marks the caller's recommendations stale, so the profile may return to
/// the pool (10 section 8.2).
pub async fn pass_delete(db: &PgPool, profile_id: Uuid, target: Uuid) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM passes WHERE profile_id = $1 AND target_profile_id = $2")
        .bind(profile_id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE profiles SET match_stale = true WHERE id = $1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

// -------------------------------------------------------------------------------------------
// Block
// -------------------------------------------------------------------------------------------

/// What a block changed, for the events and log lines sent after commit.
#[derive(Debug, Clone, Default)]
pub struct BlockEffects {
    /// The active connection the block ended, if any.
    pub ended: Option<EndedConnection>,
    /// Pending interests the blocker had sent, now `withdrawn`.
    pub withdrawn: Vec<Uuid>,
    /// Pending interests the blocker had received, now `declined`.
    pub declined: Vec<Uuid>,
}

/// Blocks a profile with every effect of 15 section 13, in one transaction:
///
/// 1. Insert the block (blocking twice changes nothing).
/// 2. End an active connection with `ended_reason = 'blocked'`, ended by the blocker
///    ([`lifecycle::end_connection`]: contact shares and photo grants revoked, pending stage
///    proposal cancelled, system message).
/// 3. Close pending interests (03 section 4.7): `withdrawn` when the blocker sent it,
///    `declined` when the blocker received it, with `responded_at = now()`.
/// 4. Photo access both ways (09 section 6.5): `granted` becomes `revoked`, `pending` becomes
///    `denied`.
/// 5. Delete shortlist entries and `match_recommendations` rows in both directions.
/// 6. Delete each user's notifications whose actor is the other profile (14 section 7.3
///    rule 2).
pub async fn block(db: &PgPool, by: Uuid, target: Uuid) -> sqlx::Result<BlockEffects> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO blocks (blocker_profile_id, blocked_profile_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
    )
    .bind(by)
    .bind(target)
    .execute(&mut *tx)
    .await?;

    let (low, high) = ordered_pair(by, target);
    let connection: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM connections
         WHERE status = 'active' AND profile_low_id = $1 AND profile_high_id = $2
         FOR UPDATE",
    )
    .bind(low)
    .bind(high)
    .fetch_optional(&mut *tx)
    .await?;
    let ended = match connection {
        Some(id) => lifecycle::end_connection(&mut tx, id, Some(by), "blocked").await?,
        None => None,
    };

    let withdrawn: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE interests SET status = 'withdrawn', responded_at = now()
         WHERE status = 'pending' AND sender_profile_id = $1 AND receiver_profile_id = $2
         RETURNING id",
    )
    .bind(by)
    .bind(target)
    .fetch_all(&mut *tx)
    .await?;
    let declined: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE interests SET status = 'declined', responded_at = now()
         WHERE status = 'pending' AND sender_profile_id = $2 AND receiver_profile_id = $1
         RETURNING id",
    )
    .bind(by)
    .bind(target)
    .fetch_all(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE photo_access
         SET status = CASE status WHEN 'granted' THEN 'revoked' ELSE 'denied' END,
             decided_at = now()
         WHERE status IN ('granted', 'pending')
           AND ((owner_profile_id = $1 AND viewer_profile_id = $2)
             OR (owner_profile_id = $2 AND viewer_profile_id = $1))",
    )
    .bind(by)
    .bind(target)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM shortlists
         WHERE (profile_id = $1 AND target_profile_id = $2)
            OR (profile_id = $2 AND target_profile_id = $1)",
    )
    .bind(by)
    .bind(target)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM match_recommendations
         WHERE (profile_id = $1 AND candidate_profile_id = $2)
            OR (profile_id = $2 AND candidate_profile_id = $1)",
    )
    .bind(by)
    .bind(target)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM notifications n
         USING profiles a, profiles b
         WHERE a.id = $1 AND b.id = $2
           AND ((n.user_id = a.user_id AND n.actor_profile_id = b.id)
             OR (n.user_id = b.user_id AND n.actor_profile_id = a.id))",
    )
    .bind(by)
    .bind(target)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(BlockEffects {
        ended,
        withdrawn,
        declined,
    })
}

/// Removes the caller's block and nothing else (15 section 13), and marks the caller's
/// recommendations stale (10 section 8.2).
pub async fn unblock(db: &PgPool, by: Uuid, target: Uuid) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM blocks WHERE blocker_profile_id = $1 AND blocked_profile_id = $2")
        .bind(by)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE profiles SET match_stale = true WHERE id = $1")
        .bind(by)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

/// A block made by the caller.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct BlockRow {
    pub blocked_profile_id: Uuid,
    pub created_at: OffsetDateTime,
}

/// One page of the caller's blocks, newest first, after the keyset `(created_at, blocked id)`.
pub async fn blocks_page(
    db: &PgPool,
    profile_id: Uuid,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<BlockRow>> {
    sqlx::query_as(
        "SELECT blocked_profile_id, created_at FROM blocks
         WHERE blocker_profile_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, blocked_profile_id) < ($2, $3))
         ORDER BY created_at DESC, blocked_profile_id DESC
         LIMIT $4",
    )
    .bind(profile_id)
    .bind(after.map(|(at, _)| at))
    .bind(after.map(|(_, id)| id))
    .bind(limit)
    .fetch_all(db)
    .await
}
