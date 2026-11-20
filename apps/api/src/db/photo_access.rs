//! SQL for photo access requests and grants (09 section 6.3, 03 section 4.9).
//!
//! One row per (owner, viewer) pair (`UNIQUE (owner_profile_id, viewer_profile_id)`), so every
//! transition below is an update of that row, and every function that changes a row first reads
//! it `FOR UPDATE`: two requests on the same pair take turns. `updated_at` is maintained by the
//! table trigger and doubles as "when the row last changed status", which is what the retry
//! period of `photo_access.retry_days` counts from. No function here touches a row it does not
//! change, so reading and listing never restart a cooldown.
//!
//! The transitions of 03 section 4.9 and the function that makes each:
//!
//! | From | To | By |
//! |---|---|---|
//! | none, `denied`, `revoked` | `pending` | [`request`] (viewer; `denied` and `revoked` only after the retry period) |
//! | `pending` | `granted` | [`decide`] or [`grant`] (owner approves) |
//! | `pending` | `denied` | [`decide`] (owner denies) |
//! | none, `denied`, `revoked` | `granted` | [`grant`] (owner, without a request) |
//! | `granted` | `revoked` | [`revoke`] (owner) |

use sqlx::{PgConnection, PgPool};
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::time::karachi_date;
use crate::domain::types::{PhotoAccessStatus, UsageCounter};

/// One `photo_access` row as the owner or the viewer sees it in their lists.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AccessRow {
    pub id: Uuid,
    /// The other profile: the viewer in the owner's `received` box, the owner in the viewer's
    /// `sent` box.
    pub profile_id: Uuid,
    pub status: PhotoAccessStatus,
    pub created_at: OffsetDateTime,
}

/// The user that owns a profile, for notifications.
pub async fn user_of(db: &PgPool, profile_id: Uuid) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar("SELECT user_id FROM profiles WHERE id = $1")
        .bind(profile_id)
        .fetch_optional(db)
        .await
}

// -------------------------------------------------------------------------------------------
// Daily usage counters (shared with `db::reports`)
// -------------------------------------------------------------------------------------------

/// Adds one to today's `usage_counters` row of a profile unless it already holds `limit`.
/// `Ok(count)` is the new count; `Err(used)` means the limit was reached and nothing changed.
///
/// A single conditional upsert, so concurrent callers cannot both pass the limit: the second
/// waits for the first on the row and then fails the `WHERE`. A limit below one refuses
/// everything.
pub(crate) async fn bump_daily_usage(
    tx: &mut PgConnection,
    profile_id: Uuid,
    counter: UsageCounter,
    day: Date,
    limit: i64,
) -> sqlx::Result<Result<i64, i64>> {
    if limit < 1 {
        return Ok(Err(0));
    }
    let bumped: Option<i32> = sqlx::query_scalar(
        "INSERT INTO usage_counters (profile_id, counter, day, count) VALUES ($1, $2, $3, 1)
         ON CONFLICT (profile_id, counter, day)
         DO UPDATE SET count = usage_counters.count + 1
         WHERE usage_counters.count < $4
         RETURNING count",
    )
    .bind(profile_id)
    .bind(counter)
    .bind(day)
    .bind(limit)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(count) = bumped {
        return Ok(Ok(i64::from(count)));
    }
    let used: Option<i32> = sqlx::query_scalar(
        "SELECT count FROM usage_counters WHERE profile_id = $1 AND counter = $2 AND day = $3",
    )
    .bind(profile_id)
    .bind(counter)
    .bind(day)
    .fetch_optional(&mut *tx)
    .await?;
    Ok(Err(used.map_or(limit, i64::from)))
}

// -------------------------------------------------------------------------------------------
// The viewer asks
// -------------------------------------------------------------------------------------------

/// The result of [`request`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requested {
    /// The row is now `pending`; `id` goes into the `photo_request_received` notification.
    Created { id: Uuid },
    /// A `pending` row already exists (check 4 of 09 section 6.3).
    AlreadyPending,
    /// A `granted` row exists: the viewer can already see the photos.
    AlreadyGranted,
    /// A `denied` or `revoked` row is younger than the retry period (check 5). The date is the
    /// day in `Asia/Karachi` on which asking is possible again.
    Cooldown { retry_after: Date },
    /// The viewer sent `limit` requests today (check 6); `used` is today's count.
    LimitReached { used: i64 },
}

/// Checks 4 to 6 of 09 section 6.3 and, when they pass, the upsert of the row to `pending` and
/// the increase of today's `photo_requests_sent` counter, in one transaction.
///
/// The row of the pair is read `FOR UPDATE` first. When the pair has no row yet, two requests
/// race to insert it; the loser's guarded upsert changes nothing and answers
/// [`Requested::AlreadyPending`], and its transaction (counter included) is dropped.
pub async fn request(
    db: &PgPool,
    viewer: Uuid,
    owner: Uuid,
    retry_days: i64,
    daily_limit: i64,
    now: OffsetDateTime,
) -> sqlx::Result<Requested> {
    let mut tx = db.begin().await?;
    let row: Option<(PhotoAccessStatus, OffsetDateTime)> = sqlx::query_as(
        "SELECT status, updated_at FROM photo_access
         WHERE owner_profile_id = $1 AND viewer_profile_id = $2 FOR UPDATE",
    )
    .bind(owner)
    .bind(viewer)
    .fetch_optional(&mut *tx)
    .await?;
    match row {
        Some((PhotoAccessStatus::Pending, _)) => return Ok(Requested::AlreadyPending),
        Some((PhotoAccessStatus::Granted, _)) => return Ok(Requested::AlreadyGranted),
        Some((PhotoAccessStatus::Denied | PhotoAccessStatus::Revoked, since)) => {
            let ends = since + Duration::days(retry_days);
            if now < ends {
                return Ok(Requested::Cooldown {
                    retry_after: karachi_date(ends),
                });
            }
        }
        None => {}
    }

    if let Err(used) = bump_daily_usage(
        &mut tx,
        viewer,
        UsageCounter::PhotoRequestsSent,
        karachi_date(now),
        daily_limit,
    )
    .await?
    {
        return Ok(Requested::LimitReached { used });
    }

    // A re-request reuses the row, so `created_at` restarts: "Asked 2 days ago" must describe
    // this request, not the first one.
    let id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (owner_profile_id, viewer_profile_id) DO UPDATE
            SET status = 'pending', decided_at = NULL, created_at = now()
            WHERE photo_access.status IN ('denied', 'revoked')
         RETURNING id",
    )
    .bind(owner)
    .bind(viewer)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(id) = id else {
        return Ok(Requested::AlreadyPending);
    };
    tx.commit().await?;
    Ok(Requested::Created { id })
}

// -------------------------------------------------------------------------------------------
// The owner answers a request
// -------------------------------------------------------------------------------------------

/// The result of [`decide`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decided {
    /// The request was `pending` and now has the new status. `viewer` is the requester.
    Done { viewer: Uuid },
    /// The caller owns no request with this id (answer `404`).
    Missing,
    /// The request is not `pending` (answer `409 invalid_state`).
    NotPending(PhotoAccessStatus),
}

/// `pending` to `granted` or `denied` for the request `id` that `owner` received. The owner's
/// id is part of the `WHERE` clause (20 section 1, S-03).
pub async fn decide(
    db: &PgPool,
    id: Uuid,
    owner: Uuid,
    to: PhotoAccessStatus,
) -> sqlx::Result<Decided> {
    debug_assert!(matches!(
        to,
        PhotoAccessStatus::Granted | PhotoAccessStatus::Denied
    ));
    let mut tx = db.begin().await?;
    let row: Option<(Uuid, PhotoAccessStatus)> = sqlx::query_as(
        "SELECT viewer_profile_id, status FROM photo_access
         WHERE id = $1 AND owner_profile_id = $2 FOR UPDATE",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((viewer, status)) = row else {
        return Ok(Decided::Missing);
    };
    if status != PhotoAccessStatus::Pending {
        return Ok(Decided::NotPending(status));
    }
    sqlx::query("UPDATE photo_access SET status = $2, decided_at = now() WHERE id = $1")
        .bind(id)
        .bind(to)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Decided::Done { viewer })
}

// -------------------------------------------------------------------------------------------
// The owner grants or revokes without a request
// -------------------------------------------------------------------------------------------

/// The result of [`grant`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Granted {
    /// The row is now `granted`. `id` goes into the `photo_request_granted` notification;
    /// `was_pending` says the owner's pending count dropped.
    Done { id: Uuid, was_pending: bool },
    /// The row was already `granted`: nothing changed.
    Unchanged,
}

/// Upserts the row of (owner, viewer) to `granted`: from no row, `denied`, `revoked`, or
/// `pending` (which is the approval of 03 section 4.9). A row that is already `granted` stays
/// as it is.
pub async fn grant(db: &PgPool, owner: Uuid, viewer: Uuid) -> sqlx::Result<Granted> {
    let mut tx = db.begin().await?;
    let previous: Option<PhotoAccessStatus> = sqlx::query_scalar(
        "SELECT status FROM photo_access
         WHERE owner_profile_id = $1 AND viewer_profile_id = $2 FOR UPDATE",
    )
    .bind(owner)
    .bind(viewer)
    .fetch_optional(&mut *tx)
    .await?;
    if previous == Some(PhotoAccessStatus::Granted) {
        return Ok(Granted::Unchanged);
    }
    let id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status, decided_at)
         VALUES ($1, $2, 'granted', now())
         ON CONFLICT (owner_profile_id, viewer_profile_id) DO UPDATE
            SET status = 'granted', decided_at = now()
            WHERE photo_access.status <> 'granted'
         RETURNING id",
    )
    .bind(owner)
    .bind(viewer)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(id) = id else {
        // A concurrent grant won the race.
        return Ok(Granted::Unchanged);
    };
    tx.commit().await?;
    Ok(Granted::Done {
        id,
        was_pending: previous == Some(PhotoAccessStatus::Pending),
    })
}

/// The result of [`revoke`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Revoked {
    Done,
    /// The owner has no row for this viewer (answer `404`).
    Missing,
    /// The row is not `granted` (answer `409 invalid_state`).
    NotGranted(PhotoAccessStatus),
}

/// `granted` to `revoked`. Takes effect on the viewer's next request (09 section 6.3); the
/// retry period starts now.
pub async fn revoke(db: &PgPool, owner: Uuid, viewer: Uuid) -> sqlx::Result<Revoked> {
    let mut tx = db.begin().await?;
    let status: Option<PhotoAccessStatus> = sqlx::query_scalar(
        "SELECT status FROM photo_access
         WHERE owner_profile_id = $1 AND viewer_profile_id = $2 FOR UPDATE",
    )
    .bind(owner)
    .bind(viewer)
    .fetch_optional(&mut *tx)
    .await?;
    match status {
        None => return Ok(Revoked::Missing),
        Some(PhotoAccessStatus::Granted) => {}
        Some(other) => return Ok(Revoked::NotGranted(other)),
    }
    sqlx::query(
        "UPDATE photo_access SET status = 'revoked', decided_at = now()
         WHERE owner_profile_id = $1 AND viewer_profile_id = $2",
    )
    .bind(owner)
    .bind(viewer)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Revoked::Done)
}

// -------------------------------------------------------------------------------------------
// Lists
// -------------------------------------------------------------------------------------------

/// One page of the requests `profile_id` received (`received`) or sent, newest first, after the
/// keyset `(created_at, id)`. `profile_id` of each row is the other profile.
pub async fn page(
    db: &PgPool,
    profile_id: Uuid,
    received: bool,
    status: PhotoAccessStatus,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<AccessRow>> {
    let sql = if received {
        "SELECT id, viewer_profile_id AS profile_id, status, created_at FROM photo_access
         WHERE owner_profile_id = $1 AND status = $2
           AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
         ORDER BY created_at DESC, id DESC
         LIMIT $5"
    } else {
        "SELECT id, owner_profile_id AS profile_id, status, created_at FROM photo_access
         WHERE viewer_profile_id = $1 AND status = $2
           AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
         ORDER BY created_at DESC, id DESC
         LIMIT $5"
    };
    sqlx::query_as(sql)
        .bind(profile_id)
        .bind(status)
        .bind(after.map(|(at, _)| at))
        .bind(after.map(|(_, id)| id))
        .bind(limit)
        .fetch_all(db)
        .await
}
