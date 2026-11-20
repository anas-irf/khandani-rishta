//! SQL for the notification feed, notification preferences and push devices (04 section 10,
//! 15 sections 6 and 14).

use serde_json::Value;
use sqlx::PgPool;
use time::{OffsetDateTime, PrimitiveDateTime, Time};
use uuid::Uuid;

use crate::domain::options::EmailMatchDigest;
use crate::domain::types::{DevicePlatform, NotificationType};
use crate::models::notifications::ValidPreferences;

/// A feed row as stored.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FeedRow {
    pub id: Uuid,
    pub kind: NotificationType,
    pub actor_profile_id: Option<Uuid>,
    pub data: Value,
    pub read_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

/// The sort key of a feed row: `(created_at, id)`, newest first (14 section 7.3 rule 8).
pub type FeedKey = (OffsetDateTime, Uuid);

/// Up to `limit` rows of the user's feed older than `after`, newest first. The caller filters
/// out rows whose actor can no longer be opened (14 section 7.3 rule 3).
pub async fn feed_rows(
    db: &PgPool,
    user_id: Uuid,
    after: Option<FeedKey>,
    limit: i64,
) -> sqlx::Result<Vec<FeedRow>> {
    sqlx::query_as(
        "SELECT id, type AS kind, actor_profile_id, data, read_at, created_at
         FROM notifications
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3))
         ORDER BY created_at DESC, id DESC
         LIMIT $4",
    )
    .bind(user_id)
    .bind(after.map(|key| key.0))
    .bind(after.map(|key| key.1))
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Marks the listed rows of this user as read. Ids of other users are ignored. Returns the
/// number of rows that changed.
pub async fn mark_read(db: &PgPool, user_id: Uuid, ids: &[Uuid]) -> sqlx::Result<u64> {
    let result = sqlx::query(
        "UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL",
    )
    .bind(user_id)
    .bind(ids)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

/// Marks every unread row of this user as read.
pub async fn mark_all_read(db: &PgPool, user_id: Uuid) -> sqlx::Result<u64> {
    let result = sqlx::query(
        "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

/// `notification_preferences` as stored.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch per column of notification_preferences (14 section 6.1)"
)]
pub struct PrefsRow {
    pub push_interests: bool,
    pub push_messages: bool,
    pub push_photo_requests: bool,
    pub push_profile_views: bool,
    pub push_matches: bool,
    pub email_interests: bool,
    pub email_messages: bool,
    pub email_match_digest: EmailMatchDigest,
    pub email_announcements: bool,
    pub quiet_hours_start: Option<Time>,
    pub quiet_hours_end: Option<Time>,
}

impl Default for PrefsRow {
    /// The column defaults (14 section 6.1), used when a user has no row yet.
    fn default() -> Self {
        Self {
            push_interests: true,
            push_messages: true,
            push_photo_requests: true,
            push_profile_views: false,
            push_matches: true,
            email_interests: true,
            email_messages: false,
            email_match_digest: EmailMatchDigest::Weekly,
            email_announcements: true,
            quiet_hours_start: None,
            quiet_hours_end: None,
        }
    }
}

const PREF_COLUMNS: &str = "push_interests, push_messages, push_photo_requests, \
     push_profile_views, push_matches, email_interests, email_messages, email_match_digest, \
     email_announcements, quiet_hours_start, quiet_hours_end";

/// The user's preferences, or the defaults when the row is missing.
pub async fn preferences(db: &PgPool, user_id: Uuid) -> sqlx::Result<PrefsRow> {
    let row: Option<PrefsRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PREF_COLUMNS} FROM notification_preferences WHERE user_id = $1"
    )))
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    Ok(row.unwrap_or_default())
}

/// Replaces the user's preferences (creating the row when it is missing) and returns them.
pub async fn save_preferences(
    db: &PgPool,
    user_id: Uuid,
    prefs: &ValidPreferences,
) -> sqlx::Result<PrefsRow> {
    let (start, end) = prefs.quiet_hours.unzip();
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO notification_preferences
             (user_id, push_interests, push_messages, push_photo_requests, push_profile_views,
              push_matches, email_interests, email_messages, email_match_digest,
              email_announcements, quiet_hours_start, quiet_hours_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id) DO UPDATE SET
             push_interests = EXCLUDED.push_interests,
             push_messages = EXCLUDED.push_messages,
             push_photo_requests = EXCLUDED.push_photo_requests,
             push_profile_views = EXCLUDED.push_profile_views,
             push_matches = EXCLUDED.push_matches,
             email_interests = EXCLUDED.email_interests,
             email_messages = EXCLUDED.email_messages,
             email_match_digest = EXCLUDED.email_match_digest,
             email_announcements = EXCLUDED.email_announcements,
             quiet_hours_start = EXCLUDED.quiet_hours_start,
             quiet_hours_end = EXCLUDED.quiet_hours_end
         RETURNING {PREF_COLUMNS}"
    )))
    .bind(user_id)
    .bind(prefs.push_interests)
    .bind(prefs.push_messages)
    .bind(prefs.push_photo_requests)
    .bind(prefs.push_profile_views)
    .bind(prefs.push_matches)
    .bind(prefs.email_interests)
    .bind(prefs.email_messages)
    .bind(prefs.email_match_digest)
    .bind(prefs.email_announcements)
    .bind(start)
    .bind(end)
    .fetch_one(db)
    .await
}

/// Devices kept per user. A user who registers more loses the least recently seen ones, so a
/// `send_push` job never loops over an unbounded list.
pub const MAX_DEVICES_PER_USER: i64 = 10;

/// Registers a push token for a user. The token is unique: a token already registered to
/// another user moves to this one (14 section 4.4, "Same phone, another account signs in").
pub async fn upsert_device(
    db: &PgPool,
    user_id: Uuid,
    platform: DevicePlatform,
    push_token: &str,
    app_version: Option<&str>,
    device_model: Option<&str>,
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO user_devices (id, user_id, platform, push_token, app_version, device_model)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (push_token) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             platform = EXCLUDED.platform,
             app_version = EXCLUDED.app_version,
             device_model = EXCLUDED.device_model,
             last_seen_at = now()",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(platform)
    .bind(push_token)
    .bind(app_version)
    .bind(device_model)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM user_devices
         WHERE user_id = $1
           AND id NOT IN (SELECT id FROM user_devices WHERE user_id = $1
                          ORDER BY last_seen_at DESC, id DESC LIMIT $2)",
    )
    .bind(user_id)
    .bind(MAX_DEVICES_PER_USER)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Removes the caller's own registration of a token. A token that is not registered, or that
/// belongs to someone else, changes nothing.
pub async fn delete_device(db: &PgPool, user_id: Uuid, push_token: &str) -> sqlx::Result<u64> {
    let result = sqlx::query("DELETE FROM user_devices WHERE user_id = $1 AND push_token = $2")
        .bind(user_id)
        .bind(push_token)
        .execute(db)
        .await?;
    Ok(result.rows_affected())
}

/// One Android registration to send a push to.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DeviceRow {
    pub id: Uuid,
    pub push_token: String,
}

/// The Android devices of a user, most recently seen first (19 section 2.6 step 5).
pub async fn android_devices(db: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<DeviceRow>> {
    sqlx::query_as(
        "SELECT id, push_token FROM user_devices
         WHERE user_id = $1 AND platform = 'android'
         ORDER BY last_seen_at DESC, id DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(MAX_DEVICES_PER_USER)
    .fetch_all(db)
    .await
}

/// Deletes one registration whose token FCM no longer accepts.
pub async fn delete_device_by_id(db: &PgPool, device_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM user_devices WHERE id = $1")
        .bind(device_id)
        .execute(db)
        .await?;
    Ok(())
}

/// The wall-clock time now in an IANA time zone, from the database's zone data (the crate has
/// none). An unknown zone name falls back to `Asia/Karachi`.
pub async fn local_now(db: &PgPool, timezone: &str) -> sqlx::Result<PrimitiveDateTime> {
    sqlx::query_scalar(
        "SELECT now() AT TIME ZONE
                COALESCE((SELECT name FROM pg_timezone_names WHERE name = $1), 'Asia/Karachi')",
    )
    .bind(timezone)
    .fetch_one(db)
    .await
}

/// The instant at which a wall-clock time in an IANA time zone happens.
pub async fn local_to_utc(
    db: &PgPool,
    timezone: &str,
    local: PrimitiveDateTime,
) -> sqlx::Result<OffsetDateTime> {
    sqlx::query_scalar(
        "SELECT $2::timestamp AT TIME ZONE
                COALESCE((SELECT name FROM pg_timezone_names WHERE name = $1), 'Asia/Karachi')",
    )
    .bind(timezone)
    .bind(local)
    .fetch_one(db)
    .await
}
