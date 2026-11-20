//! SQL for interests (04 section 7.1) and the daily usage counters (04 section 8).
//!
//! Reads are scoped to the caller: an interest is found only when the caller sent or received
//! it (20 S-03).

use sqlx::{PgConnection, PgPool};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::types::{InterestStatus, UsageCounter};
use crate::domain::visibility::InterestUsage;
use crate::lifecycle::ordered_pair;

/// One interest with what `Interest` needs besides the other member's card.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct InterestRow {
    pub id: Uuid,
    pub sender_profile_id: Uuid,
    pub receiver_profile_id: Uuid,
    pub status: InterestStatus,
    pub message: Option<String>,
    pub compat_score: Option<i16>,
    pub seen_at: Option<OffsetDateTime>,
    pub responded_at: Option<OffsetDateTime>,
    pub expires_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
    /// The connection created from it, if it was accepted.
    pub connection_id: Option<Uuid>,
    /// `send_read_receipts` of the sender and of the receiver (09 section 9).
    pub sender_receipts: bool,
    pub receiver_receipts: bool,
}

impl InterestRow {
    /// The member of the pair who is not `profile_id`.
    pub fn other(&self, profile_id: Uuid) -> Uuid {
        if self.sender_profile_id == profile_id {
            self.receiver_profile_id
        } else {
            self.sender_profile_id
        }
    }
}

const INTEREST_SELECT: &str = "SELECT i.id, i.sender_profile_id, i.receiver_profile_id, i.status,
        i.message, i.compat_score, i.seen_at, i.responded_at, i.expires_at, i.created_at,
        (SELECT c.id FROM connections c WHERE c.interest_id = i.id
          ORDER BY c.created_at DESC LIMIT 1) AS connection_id,
        sp.send_read_receipts AS sender_receipts, rp.send_read_receipts AS receiver_receipts
     FROM interests i
     JOIN profile_privacy sp ON sp.profile_id = i.sender_profile_id
     JOIN profile_privacy rp ON rp.profile_id = i.receiver_profile_id";

/// An interest the caller sent or received, or `None`.
pub async fn get(
    db: impl sqlx::PgExecutor<'_>,
    viewer_id: Uuid,
    interest_id: Uuid,
) -> sqlx::Result<Option<InterestRow>> {
    let sql = format!(
        "{INTEREST_SELECT}
         WHERE i.id = $1 AND (i.sender_profile_id = $2 OR i.receiver_profile_id = $2)"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(interest_id)
        .bind(viewer_id)
        .fetch_optional(db)
        .await
}

/// Which rows one tab of `GET /v1/interests` shows (11 section 3.1). For the sender a declined
/// interest stays under "Waiting" until `expires_at`, then moves to "Closed" (11 section 3.5).
#[derive(Debug, Clone)]
pub struct ListScope {
    /// `true`: the caller's sent interests; `false`: received.
    pub sent: bool,
    /// Statuses shown as they are.
    pub statuses: Vec<InterestStatus>,
    /// Declined interests are also shown: `Some(true)` those still before `expires_at`,
    /// `Some(false)` those past it.
    pub declined_before_expiry: Option<bool>,
}

/// One page of interests, newest first, after the keyset `(created_at, id)`.
pub async fn page(
    db: &PgPool,
    viewer_id: Uuid,
    scope: &ListScope,
    now: OffsetDateTime,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<InterestRow>> {
    let side = if scope.sent {
        "i.sender_profile_id = $1"
    } else {
        "i.receiver_profile_id = $1"
    };
    let sql = format!(
        "{INTEREST_SELECT}
         WHERE {side}
           AND (i.status = ANY($2)
                OR (i.status = 'declined' AND $3::boolean IS NOT NULL
                    AND (i.expires_at > $4) = $3))
           AND ($5::timestamptz IS NULL OR (i.created_at, i.id) < ($5, $6))
         ORDER BY i.created_at DESC, i.id DESC
         LIMIT $7"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(viewer_id)
        .bind(&scope.statuses)
        .bind(scope.declined_before_expiry)
        .bind(now)
        .bind(after.map(|(at, _)| at))
        .bind(after.map(|(_, id)| id))
        .bind(limit)
        .fetch_all(db)
        .await
}

/// Takes the advisory lock of a pair and then locks both profile rows in id order, so that
/// sends, mutual interests and accepts between the same two members run one at a time
/// (11 section 13 rule 1), and the limits of each member are counted without a race.
pub async fn lock_pair(conn: &mut PgConnection, a: Uuid, b: Uuid) -> sqlx::Result<()> {
    let (low, high) = ordered_pair(a, b);
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('interest_pair:' || $1::text || ':' || $2::text, 0))",
    )
    .bind(low)
    .bind(high)
    .execute(&mut *conn)
    .await?;
    sqlx::query("SELECT id FROM profiles WHERE id = ANY($1) ORDER BY id FOR UPDATE")
        .bind([low, high].as_slice())
        .execute(conn)
        .await?;
    Ok(())
}

/// The id of the pending interest from `sender` to `receiver`, if any.
pub async fn pending_from(
    conn: &mut PgConnection,
    sender: Uuid,
    receiver: Uuid,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(
        "SELECT id FROM interests
         WHERE sender_profile_id = $1 AND receiver_profile_id = $2 AND status = 'pending'",
    )
    .bind(sender)
    .bind(receiver)
    .fetch_optional(conn)
    .await
}

/// The id of the active connection between the pair, if any.
pub async fn active_connection(
    conn: &mut PgConnection,
    a: Uuid,
    b: Uuid,
) -> sqlx::Result<Option<Uuid>> {
    let (low, high) = ordered_pair(a, b);
    sqlx::query_scalar(
        "SELECT id FROM connections
         WHERE profile_low_id = $1 AND profile_high_id = $2 AND status = 'active'",
    )
    .bind(low)
    .bind(high)
    .fetch_optional(conn)
    .await
}

/// The sender's interest counts inside a transaction (09 section 7.2): pending sent interests,
/// active connections and today's `interests_sent`.
pub async fn usage(
    conn: &mut PgConnection,
    profile_id: Uuid,
    today: Date,
) -> sqlx::Result<InterestUsage> {
    let (pending_sent, active_connections, sent_today): (i64, i64, i64) = sqlx::query_as(
        "SELECT
           (SELECT count(*) FROM interests
             WHERE sender_profile_id = $1 AND status = 'pending'),
           (SELECT count(*) FROM connections
             WHERE status = 'active' AND (profile_low_id = $1 OR profile_high_id = $1)),
           COALESCE((SELECT count::bigint FROM usage_counters
             WHERE profile_id = $1 AND counter = 'interests_sent' AND day = $2), 0)",
    )
    .bind(profile_id)
    .bind(today)
    .fetch_one(conn)
    .await?;
    Ok(InterestUsage {
        pending_sent,
        active_connections,
        sent_today,
    })
}

/// A new pending interest (11 section 2.3 step 3).
#[derive(Debug, Clone)]
pub struct NewInterest<'a> {
    pub sender: Uuid,
    pub receiver: Uuid,
    pub message: Option<&'a str>,
    pub compat_score: Option<i16>,
    pub expiry_days: i64,
}

/// Inserts a pending interest with `expires_at = now() + expiry_days` and returns its id.
pub async fn insert(conn: &mut PgConnection, new: &NewInterest<'_>) -> sqlx::Result<Uuid> {
    let days = i32::try_from(new.expiry_days.max(0)).unwrap_or(i32::MAX);
    sqlx::query_scalar(
        "INSERT INTO interests (sender_profile_id, receiver_profile_id, message, compat_score,
                                expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
         RETURNING id",
    )
    .bind(new.sender)
    .bind(new.receiver)
    .bind(new.message)
    .bind(new.compat_score)
    .bind(days)
    .fetch_one(conn)
    .await
}

/// Deletes the `match_recommendations` rows of the pair in both directions.
pub async fn delete_pair_recommendations(
    conn: &mut PgConnection,
    a: Uuid,
    b: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM match_recommendations
         WHERE (profile_id = $1 AND candidate_profile_id = $2)
            OR (profile_id = $2 AND candidate_profile_id = $1)",
    )
    .bind(a)
    .bind(b)
    .execute(conn)
    .await?;
    Ok(())
}

/// The state of an interest, locked until the transaction ends.
#[derive(Debug, Clone, Copy, sqlx::FromRow)]
pub struct LockedInterest {
    pub id: Uuid,
    pub sender_profile_id: Uuid,
    pub receiver_profile_id: Uuid,
    pub status: InterestStatus,
    pub expires_at: OffsetDateTime,
    pub compat_score: Option<i16>,
}

/// Locks an interest row.
pub async fn lock(
    conn: &mut PgConnection,
    interest_id: Uuid,
) -> sqlx::Result<Option<LockedInterest>> {
    sqlx::query_as(
        "SELECT id, sender_profile_id, receiver_profile_id, status, expires_at, compat_score
         FROM interests WHERE id = $1 FOR UPDATE",
    )
    .bind(interest_id)
    .fetch_optional(conn)
    .await
}

/// Answers a pending interest: `accepted`, `declined` or `withdrawn`, with `responded_at`.
pub async fn respond(
    conn: &mut PgConnection,
    interest_id: Uuid,
    status: InterestStatus,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE interests SET status = $2, responded_at = now() WHERE id = $1 AND status = 'pending'",
    )
    .bind(interest_id)
    .bind(status)
    .execute(conn)
    .await?;
    Ok(())
}

/// Expires a pending interest now: `expires_at` is set to this moment, which starts the expiry
/// cooldown (03 section 4.7).
pub async fn expire_now(db: &PgPool, interest_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE interests SET status = 'expired', expires_at = now()
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(interest_id)
    .execute(db)
    .await?;
    Ok(())
}

/// Deletes the receiver's `interest_received` notifications for an interest (14 section 7.3
/// rule 4).
pub async fn delete_received_notifications(
    conn: &mut PgConnection,
    receiver: Uuid,
    interest_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM notifications n
         USING profiles p
         WHERE p.id = $1 AND n.user_id = p.user_id AND n.type = 'interest_received'
           AND n.data ->> 'interest_id' = $2::text",
    )
    .bind(receiver)
    .bind(interest_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Sets `seen_at` on the caller's received interests among `ids` that were not seen yet.
pub async fn mark_seen(db: &PgPool, receiver: Uuid, ids: &[Uuid]) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE interests SET seen_at = now()
         WHERE id = ANY($1) AND receiver_profile_id = $2 AND seen_at IS NULL",
    )
    .bind(ids)
    .bind(receiver)
    .execute(db)
    .await?;
    Ok(())
}

/// The receiver of an interest as the send needs it.
#[derive(Debug, Clone, Copy, sqlx::FromRow)]
pub struct Receiver {
    pub user_id: Uuid,
    pub status: crate::domain::types::ProfileStatus,
    pub user_status: crate::domain::types::UserStatus,
}

/// The receiver's account and profile status, when the profile exists.
pub async fn receiver(db: &PgPool, profile_id: Uuid) -> sqlx::Result<Option<Receiver>> {
    sqlx::query_as(
        "SELECT p.user_id, p.status, u.status AS user_status
         FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1",
    )
    .bind(profile_id)
    .fetch_optional(db)
    .await
}

/// The user id of a profile.
pub async fn user_id_of(db: impl sqlx::PgExecutor<'_>, profile_id: Uuid) -> sqlx::Result<Uuid> {
    sqlx::query_scalar("SELECT user_id FROM profiles WHERE id = $1")
        .bind(profile_id)
        .fetch_one(db)
        .await
}

// -------------------------------------------------------------------------------------------
// Usage counters
// -------------------------------------------------------------------------------------------

/// Today's value of a usage counter (`day` in `Asia/Karachi`).
pub async fn usage_count(
    db: impl sqlx::PgExecutor<'_>,
    profile_id: Uuid,
    counter: UsageCounter,
    day: Date,
) -> sqlx::Result<i64> {
    let count: Option<i32> = sqlx::query_scalar(
        "SELECT count FROM usage_counters WHERE profile_id = $1 AND counter = $2 AND day = $3",
    )
    .bind(profile_id)
    .bind(counter)
    .bind(day)
    .fetch_optional(db)
    .await?;
    Ok(count.map_or(0, i64::from))
}

/// Adds one to a usage counter while it is below `limit`. Returns false (and changes nothing)
/// when the counter has already reached the limit, so two requests at once cannot both pass.
pub async fn bump_usage(
    conn: &mut PgConnection,
    profile_id: Uuid,
    counter: UsageCounter,
    day: Date,
    limit: i64,
) -> sqlx::Result<bool> {
    let limit = i32::try_from(limit.max(0)).unwrap_or(i32::MAX);
    let bumped: Option<i32> = sqlx::query_scalar(
        "INSERT INTO usage_counters (profile_id, counter, day, count)
         SELECT $1, $2, $3, 1 WHERE $4 > 0
         ON CONFLICT (profile_id, counter, day)
         DO UPDATE SET count = usage_counters.count + 1 WHERE usage_counters.count < $4
         RETURNING count",
    )
    .bind(profile_id)
    .bind(counter)
    .bind(day)
    .bind(limit)
    .fetch_optional(conn)
    .await?;
    Ok(bumped.is_some())
}

// -------------------------------------------------------------------------------------------
// The expiry job (19 section 2.8)
// -------------------------------------------------------------------------------------------

/// Expires every pending interest past `expires_at`. Returns `(id, receiver, compat_score)` of
/// each.
pub async fn expire_due(db: &PgPool) -> sqlx::Result<Vec<(Uuid, Uuid, Option<i16>)>> {
    sqlx::query_as(
        "UPDATE interests SET status = 'expired'
         WHERE status = 'pending' AND expires_at <= now()
         RETURNING id, receiver_profile_id, compat_score",
    )
    .fetch_all(db)
    .await
}

/// One receiver to remind: the earliest of their interests that expire on the day, and how
/// many do.
#[derive(Debug, Clone, Copy, sqlx::FromRow)]
pub struct Reminder {
    pub receiver_user_id: Uuid,
    pub interest_id: Uuid,
    pub sender_profile_id: Uuid,
    pub count: i64,
}

/// Receivers with pending interests whose `expires_at` falls in `[from, to)`.
pub async fn reminders(
    db: &PgPool,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> sqlx::Result<Vec<Reminder>> {
    sqlx::query_as(
        "SELECT DISTINCT ON (i.receiver_profile_id)
                p.user_id AS receiver_user_id, i.id AS interest_id, i.sender_profile_id,
                count(*) OVER (PARTITION BY i.receiver_profile_id) AS count
         FROM interests i
         JOIN profiles p ON p.id = i.receiver_profile_id
         WHERE i.status = 'pending' AND i.expires_at >= $1 AND i.expires_at < $2
         ORDER BY i.receiver_profile_id, i.expires_at, i.id",
    )
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
}
