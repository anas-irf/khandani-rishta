//! SQL for connections, messages, contact shares and stage proposals (04 sections 7.2 to 7.5).
//!
//! Every read is scoped to the caller: a connection is found only through the caller's own
//! `connection_members` row, so a non-member gets nothing (15 section 12, 20 S-03).
//!
//! Locks, in the order every transaction here takes them: the pair's advisory lock, then
//! profile rows (in id order), then the connection row, then proposal and member rows.

use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::chat_safety::{FlaggedMessage, MoneyFlagCounts, MoneyReport};
use crate::domain::options::{
    ConnectionEndReason, ConnectionStage, GuardianRelation, PreferredContact,
};
use crate::domain::types::{
    ConnectionStatus, ContactShareStatus, MessageKind, ProfileStatus, ProposalStatus, SafetyFlag,
    SystemEvent,
};
use crate::lifecycle::{self, EndedConnection, ordered_pair};

// -------------------------------------------------------------------------------------------
// Connections
// -------------------------------------------------------------------------------------------

/// One connection with everything `Connection` needs for one member (15 section 4.7), except
/// the other member's card, which comes from the views.
#[derive(Debug, Clone, sqlx::FromRow)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors boolean columns of connection_members and contact_shares"
)]
pub struct ConnectionRow {
    pub id: Uuid,
    pub status: ConnectionStatus,
    pub stage: ConnectionStage,
    pub ended_by_profile_id: Option<Uuid>,
    pub ended_reason: Option<ConnectionEndReason>,
    pub ended_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub last_message_at: Option<OffsetDateTime>,
    pub last_message_preview: Option<String>,
    /// `last_message_at`, or `created_at` for a connection without messages: the list order.
    pub sort_at: OffsetDateTime,
    pub other_id: Uuid,
    pub unread_count: i32,
    pub is_muted: bool,
    pub is_archived: bool,
    pub their_last_read_message_id: Option<Uuid>,
    /// `send_read_receipts` of the caller.
    pub my_receipts: bool,
    /// `send_read_receipts` of the other member.
    pub their_receipts: bool,
    pub proposal_id: Option<Uuid>,
    pub proposal_stage: Option<ConnectionStage>,
    pub proposal_by: Option<Uuid>,
    pub proposal_created_at: Option<OffsetDateTime>,
    pub my_share_phone: Option<bool>,
    pub my_share_whatsapp: Option<bool>,
    pub my_share_email: Option<bool>,
    pub my_share_guardian: Option<bool>,
    pub my_share_status: Option<ContactShareStatus>,
    pub my_share_created_at: Option<OffsetDateTime>,
    /// The other member's share, loaded only while it is `active` on an `active` connection.
    pub their_share_phone: Option<bool>,
    pub their_share_whatsapp: Option<bool>,
    pub their_share_email: Option<bool>,
    pub their_share_guardian: Option<bool>,
    pub their_share_status: Option<ContactShareStatus>,
    /// The other member's `profile_contacts`, loaded only with an active share (03 section 8
    /// invariant 4).
    pub phone_e164: Option<String>,
    pub whatsapp_e164: Option<String>,
    pub contact_email: Option<String>,
    pub guardian_name: Option<String>,
    pub guardian_relation: Option<GuardianRelation>,
    pub guardian_phone_e164: Option<String>,
    pub preferred_contact: Option<PreferredContact>,
    pub best_time_to_call: Option<String>,
}

/// `$1` is the caller's profile id.
const CONNECTION_SELECT: &str = "SELECT
    c.id, c.status, c.stage, c.ended_by_profile_id, c.ended_reason, c.ended_at, c.created_at,
    c.last_message_at, c.last_message_preview,
    COALESCE(c.last_message_at, c.created_at) AS sort_at,
    them.profile_id AS other_id, me.unread_count, me.is_muted, me.is_archived,
    them.last_read_message_id AS their_last_read_message_id,
    mp.send_read_receipts AS my_receipts, tp.send_read_receipts AS their_receipts,
    sp.id AS proposal_id, sp.stage AS proposal_stage, sp.proposed_by_profile_id AS proposal_by,
    sp.created_at AS proposal_created_at,
    ms.share_phone AS my_share_phone, ms.share_whatsapp AS my_share_whatsapp,
    ms.share_email AS my_share_email, ms.share_guardian AS my_share_guardian,
    ms.status AS my_share_status, ms.created_at AS my_share_created_at,
    ts.share_phone AS their_share_phone, ts.share_whatsapp AS their_share_whatsapp,
    ts.share_email AS their_share_email, ts.share_guardian AS their_share_guardian,
    ts.status AS their_share_status,
    pc.phone_e164, pc.whatsapp_e164, pc.contact_email, pc.guardian_name, pc.guardian_relation,
    pc.guardian_phone_e164, pc.preferred_contact, pc.best_time_to_call
FROM connections c
JOIN connection_members me ON me.connection_id = c.id AND me.profile_id = $1
JOIN connection_members them ON them.connection_id = c.id AND them.profile_id <> $1
JOIN profile_privacy mp ON mp.profile_id = me.profile_id
JOIN profile_privacy tp ON tp.profile_id = them.profile_id
LEFT JOIN connection_stage_proposals sp ON sp.connection_id = c.id AND sp.status = 'pending'
LEFT JOIN contact_shares ms ON ms.connection_id = c.id AND ms.sharer_profile_id = me.profile_id
LEFT JOIN contact_shares ts ON ts.connection_id = c.id AND ts.sharer_profile_id = them.profile_id
     AND ts.status = 'active' AND c.status = 'active'
LEFT JOIN profile_contacts pc ON pc.profile_id = them.profile_id AND ts.id IS NOT NULL";

/// One connection of the caller, or `None` when the caller is not a member.
pub async fn get(
    db: &PgPool,
    viewer_id: Uuid,
    connection_id: Uuid,
) -> sqlx::Result<Option<ConnectionRow>> {
    let sql = format!("{CONNECTION_SELECT} WHERE c.id = $2");
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(viewer_id)
        .bind(connection_id)
        .fetch_optional(db)
        .await
}

/// The tabs of the chat list (11 section 5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListFilter {
    /// Active and not archived.
    Active,
    /// Active and archived.
    Archived,
    Ended,
}

/// One page of the caller's connections, newest activity first, after the keyset
/// `(sort_at, id)`.
pub async fn page(
    db: &PgPool,
    viewer_id: Uuid,
    filter: ListFilter,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<ConnectionRow>> {
    let condition = match filter {
        ListFilter::Active => "c.status = 'active' AND NOT me.is_archived",
        ListFilter::Archived => "c.status = 'active' AND me.is_archived",
        ListFilter::Ended => "c.status = 'ended'",
    };
    let sql = format!(
        "{CONNECTION_SELECT}
         WHERE {condition}
           AND ($2::timestamptz IS NULL
                OR (COALESCE(c.last_message_at, c.created_at), c.id) < ($2, $3))
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
         LIMIT $4"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(viewer_id)
        .bind(after.map(|(at, _)| at))
        .bind(after.map(|(_, id)| id))
        .bind(limit)
        .fetch_all(db)
        .await
}

/// The caller's membership of a connection: the facts most chat actions start from.
#[derive(Debug, Clone, Copy, sqlx::FromRow)]
pub struct Membership {
    pub connection_id: Uuid,
    pub status: ConnectionStatus,
    pub stage: ConnectionStage,
    pub other_id: Uuid,
    pub other_user_id: Uuid,
    /// The other member's mute flag for this connection.
    pub other_is_muted: bool,
}

const MEMBERSHIP_SELECT: &str = "SELECT c.id AS connection_id, c.status, c.stage,
        them.profile_id AS other_id, op.user_id AS other_user_id,
        them.is_muted AS other_is_muted
     FROM connections c
     JOIN connection_members me ON me.connection_id = c.id AND me.profile_id = $2
     JOIN connection_members them ON them.connection_id = c.id AND them.profile_id <> $2
     JOIN profiles op ON op.id = them.profile_id
     WHERE c.id = $1";

/// The caller's membership, or `None` when the caller is not a member (answer `404`).
pub async fn membership(
    db: &PgPool,
    viewer_id: Uuid,
    connection_id: Uuid,
) -> sqlx::Result<Option<Membership>> {
    sqlx::query_as(MEMBERSHIP_SELECT)
        .bind(connection_id)
        .bind(viewer_id)
        .fetch_optional(db)
        .await
}

/// The membership with the connection row locked until the transaction ends, so the status
/// and stage cannot change underneath (11 section 13 rule 16).
pub async fn lock_membership(
    conn: &mut PgConnection,
    viewer_id: Uuid,
    connection_id: Uuid,
) -> sqlx::Result<Option<Membership>> {
    let sql = format!("{MEMBERSHIP_SELECT} FOR UPDATE OF c");
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(connection_id)
        .bind(viewer_id)
        .fetch_optional(conn)
        .await
}

/// The two member profile ids of a connection, whoever asks (for events).
pub async fn members(db: &PgPool, connection_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT profile_id FROM connection_members WHERE connection_id = $1 ORDER BY profile_id",
    )
    .bind(connection_id)
    .fetch_all(db)
    .await
}

/// Changes the caller's mute and archive flags; `None` leaves a flag as it is.
pub async fn set_flags(
    db: &PgPool,
    viewer_id: Uuid,
    connection_id: Uuid,
    is_muted: Option<bool>,
    is_archived: Option<bool>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE connection_members
         SET is_muted = COALESCE($3, is_muted), is_archived = COALESCE($4, is_archived)
         WHERE connection_id = $1 AND profile_id = $2",
    )
    .bind(connection_id)
    .bind(viewer_id)
    .bind(is_muted)
    .bind(is_archived)
    .execute(db)
    .await?;
    Ok(())
}

/// Number of `active` connections of a profile (the cap of 11 section 5.3).
pub async fn active_count(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM connections
         WHERE status = 'active' AND (profile_low_id = $1 OR profile_high_id = $1)",
    )
    .bind(profile_id)
    .fetch_one(conn)
    .await
}

/// Creates the connection of an accepted interest (11 section 3.3 step 5): the row with
/// `stage = 'chatting'`, both member rows and the `connected` system message, which also sets
/// `last_message_at`.
pub async fn create(
    conn: &mut PgConnection,
    interest_id: Uuid,
    accepting: Uuid,
    other: Uuid,
) -> sqlx::Result<(Uuid, MessageRow)> {
    let (low, high) = ordered_pair(accepting, other);
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO connections (profile_low_id, profile_high_id, interest_id)
         VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(low)
    .bind(high)
    .bind(interest_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO connection_members (connection_id, profile_id) VALUES ($1, $2), ($1, $3)",
    )
    .bind(id)
    .bind(low)
    .bind(high)
    .execute(&mut *conn)
    .await?;
    let message = insert_system_message(
        conn,
        id,
        SystemEvent::Connected,
        json!({ "actor_profile_id": accepting }),
    )
    .await?;
    Ok((id, message))
}

/// Ends a connection as a member (11 section 5.4): [`lifecycle::end_connection`] plus the
/// list fields of the `connection_ended` system message, which it inserts without them.
/// Returns the system message, or `None` when the connection was not active.
pub async fn end(
    conn: &mut PgConnection,
    connection_id: Uuid,
    ended_by: Uuid,
    reason: ConnectionEndReason,
) -> sqlx::Result<Option<(EndedConnection, MessageRow)>> {
    let Some(ended) =
        lifecycle::end_connection(&mut *conn, connection_id, Some(ended_by), reason.as_str())
            .await?
    else {
        return Ok(None);
    };
    let message =
        touch_for_system_message(conn, connection_id, SystemEvent::ConnectionEnded).await?;
    Ok(Some((ended, message)))
}

/// Sets `last_message_at` and clears the preview for the latest system message of `event`
/// (inserted by a shared helper), and returns that message (11 section 6.8).
async fn touch_for_system_message(
    conn: &mut PgConnection,
    connection_id: Uuid,
    event: SystemEvent,
) -> sqlx::Result<MessageRow> {
    let sql = format!(
        "{MESSAGE_SELECT} WHERE connection_id = $1 AND system_event = $2 ORDER BY id DESC LIMIT 1"
    );
    let message: MessageRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(connection_id)
        .bind(event)
        .fetch_one(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE connections SET last_message_at = $2, last_message_preview = NULL WHERE id = $1",
    )
    .bind(connection_id)
    .bind(message.created_at)
    .execute(&mut *conn)
    .await?;
    Ok(message)
}

// -------------------------------------------------------------------------------------------
// Messages
// -------------------------------------------------------------------------------------------

/// One `messages` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MessageRow {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub sender_profile_id: Option<Uuid>,
    pub kind: MessageKind,
    pub body: Option<String>,
    pub system_event: Option<SystemEvent>,
    pub system_data: Option<Value>,
    pub client_message_id: Option<String>,
    pub safety_flag: Option<SafetyFlag>,
    pub deleted_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

const MESSAGE_SELECT: &str =
    "SELECT id, connection_id, sender_profile_id, kind, body, system_event,
        system_data, client_message_id, safety_flag, deleted_at, created_at
     FROM messages";

/// Which part of the history to read (11 section 6.3).
#[derive(Debug, Clone, Copy)]
pub enum HistoryFrom {
    /// The newest messages, newest first.
    Newest,
    /// Messages older than this id, newest first.
    Before(Uuid),
    /// Messages newer than this id, oldest first.
    After(Uuid),
}

/// Up to `limit` messages of a connection in the order of `from`.
pub async fn history(
    db: &PgPool,
    connection_id: Uuid,
    from: HistoryFrom,
    limit: i64,
) -> sqlx::Result<Vec<MessageRow>> {
    let (condition, order, cursor) = match from {
        HistoryFrom::Newest => ("TRUE", "DESC", None),
        HistoryFrom::Before(id) => ("id < $2", "DESC", Some(id)),
        HistoryFrom::After(id) => ("id > $2", "ASC", Some(id)),
    };
    let sql = format!(
        "{MESSAGE_SELECT}
         WHERE connection_id = $1 AND ($2::uuid IS NULL OR {condition})
         ORDER BY id {order} LIMIT $3"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(connection_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(db)
        .await
}

/// One message of a connection.
pub async fn message(
    db: &PgPool,
    connection_id: Uuid,
    message_id: Uuid,
) -> sqlx::Result<Option<MessageRow>> {
    let sql = format!("{MESSAGE_SELECT} WHERE connection_id = $1 AND id = $2");
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(connection_id)
        .bind(message_id)
        .fetch_optional(db)
        .await
}

/// The caller's message with this idempotency key, if it was already created.
pub async fn by_client_id(
    db: impl sqlx::PgExecutor<'_>,
    connection_id: Uuid,
    sender: Uuid,
    client_message_id: &str,
) -> sqlx::Result<Option<MessageRow>> {
    let sql = format!(
        "{MESSAGE_SELECT}
         WHERE connection_id = $1 AND sender_profile_id = $2 AND client_message_id = $3"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(connection_id)
        .bind(sender)
        .bind(client_message_id)
        .fetch_optional(db)
        .await
}

/// A text message to insert (11 section 6.2 step 6).
#[derive(Debug, Clone)]
pub struct NewText<'a> {
    pub connection_id: Uuid,
    pub sender: Uuid,
    pub other: Uuid,
    pub body: &'a str,
    pub client_message_id: &'a str,
    pub safety_flag: Option<SafetyFlag>,
}

/// Longest `last_message_preview` (04 section 7.2).
pub const PREVIEW_CHARS: usize = 80;

/// Inserts a text message with every list effect: `last_message_at` and the preview, one more
/// unread message for the other member, and both archive flags cleared. Returns `None` when a
/// message with the same idempotency key already exists (nothing was changed).
pub async fn insert_text(
    conn: &mut PgConnection,
    new: &NewText<'_>,
) -> sqlx::Result<Option<MessageRow>> {
    let sql = format!(
        "WITH inserted AS (
             INSERT INTO messages (id, connection_id, sender_profile_id, kind, body,
                                   client_message_id, safety_flag)
             VALUES ($1, $2, $3, 'text', $4, $5, $6)
             ON CONFLICT (connection_id, sender_profile_id, client_message_id)
                 WHERE client_message_id IS NOT NULL
             DO NOTHING
             RETURNING *)
         {}",
        MESSAGE_SELECT.replace("FROM messages", "FROM inserted")
    );
    let row: Option<MessageRow> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(Uuid::now_v7())
        .bind(new.connection_id)
        .bind(new.sender)
        .bind(new.body)
        .bind(new.client_message_id)
        .bind(new.safety_flag)
        .fetch_optional(&mut *conn)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let preview: String = new.body.chars().take(PREVIEW_CHARS).collect();
    sqlx::query(
        "UPDATE connections SET last_message_at = $2, last_message_preview = $3 WHERE id = $1",
    )
    .bind(new.connection_id)
    .bind(row.created_at)
    .bind(preview)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE connection_members
         SET unread_count = unread_count + CASE WHEN profile_id = $2 THEN 1 ELSE 0 END,
             is_archived = false
         WHERE connection_id = $1",
    )
    .bind(new.connection_id)
    .bind(new.other)
    .execute(&mut *conn)
    .await?;
    Ok(Some(row))
}

/// Inserts a system message and moves the list fields: `last_message_at` is set and the
/// preview cleared; unread counts do not change (11 section 6.8).
pub async fn insert_system_message(
    conn: &mut PgConnection,
    connection_id: Uuid,
    event: SystemEvent,
    data: Value,
) -> sqlx::Result<MessageRow> {
    let sql = format!(
        "WITH inserted AS (
             INSERT INTO messages (id, connection_id, kind, system_event, system_data)
             VALUES ($1, $2, 'system', $3, $4)
             RETURNING *)
         {}",
        MESSAGE_SELECT.replace("FROM messages", "FROM inserted")
    );
    let row: MessageRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(Uuid::now_v7())
        .bind(connection_id)
        .bind(event)
        .bind(data)
        .fetch_one(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE connections SET last_message_at = $2, last_message_preview = NULL WHERE id = $1",
    )
    .bind(connection_id)
    .bind(row.created_at)
    .execute(&mut *conn)
    .await?;
    Ok(row)
}

/// Removes the caller's own text message (11 section 6.7): the body is cleared and
/// `deleted_at` set; the preview is cleared when it was the latest message. Returns the row as
/// it was before, or `None` when the caller has no such text message.
pub async fn lock_own_text(
    conn: &mut PgConnection,
    connection_id: Uuid,
    sender: Uuid,
    message_id: Uuid,
) -> sqlx::Result<Option<MessageRow>> {
    let sql = format!(
        "{MESSAGE_SELECT}
         WHERE connection_id = $1 AND id = $2 AND sender_profile_id = $3 AND kind = 'text'
         FOR UPDATE"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(connection_id)
        .bind(message_id)
        .bind(sender)
        .fetch_optional(conn)
        .await
}

/// Clears a message's body. Returns the updated row.
pub async fn remove_text(
    conn: &mut PgConnection,
    connection_id: Uuid,
    message_id: Uuid,
) -> sqlx::Result<MessageRow> {
    let sql = format!(
        "WITH updated AS (
             UPDATE messages SET body = NULL, deleted_at = now()
             WHERE id = $1 RETURNING *)
         {}",
        MESSAGE_SELECT.replace("FROM messages", "FROM updated")
    );
    let row: MessageRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(message_id)
        .fetch_one(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE connections SET last_message_preview = NULL
         WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM messages WHERE connection_id = $1 AND id > $2)",
    )
    .bind(connection_id)
    .bind(message_id)
    .execute(&mut *conn)
    .await?;
    Ok(row)
}

/// What a read changed.
#[derive(Debug, Clone, Copy)]
pub struct ReadState {
    /// The stored `last_read_message_id` after the read.
    pub last_read_message_id: Uuid,
    /// True when the pointer moved forward.
    pub moved: bool,
}

/// Marks messages as read up to `up_to` (11 section 6.5): the pointer never moves backwards,
/// `last_read_at` is set, and `unread_count` is recomputed from the data (03 section 8
/// invariant 14). The member row is locked first, so the count sees every message whose
/// sender already raised the counter.
pub async fn mark_read(
    db: &PgPool,
    connection_id: Uuid,
    reader: Uuid,
    other: Uuid,
    up_to: Uuid,
) -> sqlx::Result<ReadState> {
    let mut tx = db.begin().await?;
    let stored: Option<Uuid> = sqlx::query_scalar(
        "SELECT last_read_message_id FROM connection_members
         WHERE connection_id = $1 AND profile_id = $2 FOR UPDATE",
    )
    .bind(connection_id)
    .bind(reader)
    .fetch_one(&mut *tx)
    .await?;
    let moved = stored.is_none_or(|stored| up_to > stored);
    let last_read = if moved {
        up_to
    } else {
        stored.unwrap_or(up_to)
    };
    sqlx::query(
        "UPDATE connection_members
         SET last_read_message_id = $3, last_read_at = now(),
             unread_count = (SELECT count(*) FROM messages
                              WHERE connection_id = $1 AND sender_profile_id = $4 AND id > $3)
         WHERE connection_id = $1 AND profile_id = $2",
    )
    .bind(connection_id)
    .bind(reader)
    .bind(last_read)
    .bind(other)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ReadState {
        last_read_message_id: last_read,
        moved,
    })
}

// -------------------------------------------------------------------------------------------
// Automatic money report (13 section 5.5)
// -------------------------------------------------------------------------------------------

/// Serialises the money report check of one sender, so two flagged messages sent at once
/// cannot both file a report.
pub async fn lock_money_check(conn: &mut PgConnection, sender: Uuid) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('money_report:' || $1::text, 0))")
        .bind(sender)
        .execute(conn)
        .await?;
    Ok(())
}

/// The count query of 13 section 5.5.
pub async fn money_counts(conn: &mut PgConnection, sender: Uuid) -> sqlx::Result<MoneyFlagCounts> {
    let (flags, connections): (i64, i64) = sqlx::query_as(
        "SELECT count(*) AS flags, count(DISTINCT connection_id) AS connections
         FROM messages
         WHERE sender_profile_id = $1
           AND safety_flag = 'money'
           AND created_at > now() - interval '7 days'",
    )
    .bind(sender)
    .fetch_one(conn)
    .await?;
    Ok(MoneyFlagCounts { flags, connections })
}

/// Whether a system report for asking for money was filed against the sender in the last 7
/// days.
pub async fn recent_money_report(conn: &mut PgConnection, target: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM reports
                        WHERE source = 'system' AND reason = 'asking_for_money'
                          AND target_profile_id = $1
                          AND created_at > now() - interval '7 days')",
    )
    .bind(target)
    .fetch_one(conn)
    .await
}

/// The sender's own flagged messages in the window, newest first (never the replies).
pub async fn flagged_messages(
    conn: &mut PgConnection,
    sender: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<FlaggedMessage>> {
    let rows: Vec<(Uuid, Uuid, Option<String>, OffsetDateTime)> = sqlx::query_as(
        "SELECT id, connection_id, body, created_at FROM messages
         WHERE sender_profile_id = $1 AND safety_flag = 'money'
           AND created_at > now() - interval '7 days'
         ORDER BY id DESC LIMIT $2",
    )
    .bind(sender)
    .bind(limit)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, connection_id, body, created_at)| FlaggedMessage {
            id,
            connection_id,
            body,
            created_at,
        })
        .collect())
}

/// Files the automatic report: `source = 'system'`, no reporter, the sender as the target.
pub async fn insert_system_report(
    conn: &mut PgConnection,
    target: Uuid,
    report: &MoneyReport,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar(
        "INSERT INTO reports (source, reporter_profile_id, target_profile_id, subject_type,
                              reason, details, context)
         VALUES ($1, NULL, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(report.source)
    .bind(target)
    .bind(report.subject_type)
    .bind(report.reason)
    .bind(report.details)
    .bind(&report.context)
    .fetch_one(conn)
    .await
}

// -------------------------------------------------------------------------------------------
// Contact sharing (09 section 10)
// -------------------------------------------------------------------------------------------

/// Which of the caller's contact items have a value (09 section 10.2 rule 2).
#[derive(Debug, Clone, Copy, Default, sqlx::FromRow)]
#[expect(clippy::struct_excessive_bools, reason = "one flag per contact item")]
pub struct FilledContacts {
    pub phone: bool,
    pub whatsapp: bool,
    pub email: bool,
    /// `guardian_name` and `guardian_phone_e164` are both set.
    pub guardian: bool,
}

/// The caller's filled contact items; all `false` without a `profile_contacts` row.
pub async fn filled_contacts(db: &PgPool, profile_id: Uuid) -> sqlx::Result<FilledContacts> {
    let filled: Option<FilledContacts> = sqlx::query_as(
        "SELECT phone_e164 IS NOT NULL AS phone, whatsapp_e164 IS NOT NULL AS whatsapp,
                contact_email IS NOT NULL AS email,
                (guardian_name IS NOT NULL AND guardian_phone_e164 IS NOT NULL) AS guardian
         FROM profile_contacts WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_optional(db)
    .await?;
    Ok(filled.unwrap_or_default())
}

/// The items of a share.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the share flags of contact_shares"
)]
pub struct ShareItems {
    pub phone: bool,
    pub whatsapp: bool,
    pub email: bool,
    pub guardian: bool,
}

impl ShareItems {
    /// The shared item names of the `contact_shared` system message (11 section 6.8).
    pub fn names(self) -> Vec<&'static str> {
        [
            (self.phone, "phone"),
            (self.whatsapp, "whatsapp"),
            (self.email, "email"),
            (self.guardian, "guardian"),
        ]
        .into_iter()
        .filter_map(|(shared, name)| shared.then_some(name))
        .collect()
    }
}

/// Creates the caller's share for a connection, or sets the existing row back to `active`
/// with the new items (09 section 10.3 rule 3).
pub async fn upsert_share(
    conn: &mut PgConnection,
    connection_id: Uuid,
    sharer: Uuid,
    items: ShareItems,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO contact_shares (connection_id, sharer_profile_id, share_phone,
                                     share_whatsapp, share_email, share_guardian)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (connection_id, sharer_profile_id) DO UPDATE
         SET share_phone = EXCLUDED.share_phone, share_whatsapp = EXCLUDED.share_whatsapp,
             share_email = EXCLUDED.share_email, share_guardian = EXCLUDED.share_guardian,
             status = 'active', revoked_at = NULL",
    )
    .bind(connection_id)
    .bind(sharer)
    .bind(items.phone)
    .bind(items.whatsapp)
    .bind(items.email)
    .bind(items.guardian)
    .execute(conn)
    .await?;
    Ok(())
}

/// Revokes the caller's active share. Returns false when there was none.
pub async fn revoke_share(
    conn: &mut PgConnection,
    connection_id: Uuid,
    sharer: Uuid,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE contact_shares SET status = 'revoked', revoked_at = now()
         WHERE connection_id = $1 AND sharer_profile_id = $2 AND status = 'active'",
    )
    .bind(connection_id)
    .bind(sharer)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() == 1)
}

// -------------------------------------------------------------------------------------------
// Stage proposals (11 section 9)
// -------------------------------------------------------------------------------------------

/// One `connection_stage_proposals` row.
#[derive(Debug, Clone, Copy, sqlx::FromRow)]
pub struct ProposalRow {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub proposed_by_profile_id: Uuid,
    pub stage: ConnectionStage,
    pub status: ProposalStatus,
}

/// Whether a proposal is pending on the connection.
pub async fn has_pending_proposal(
    conn: &mut PgConnection,
    connection_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM connection_stage_proposals
                        WHERE connection_id = $1 AND status = 'pending')",
    )
    .bind(connection_id)
    .fetch_one(conn)
    .await
}

/// When the member's latest declined proposal of this stage on this connection was declined.
pub async fn last_declined(
    conn: &mut PgConnection,
    connection_id: Uuid,
    proposer: Uuid,
    stage: ConnectionStage,
) -> sqlx::Result<Option<OffsetDateTime>> {
    sqlx::query_scalar(
        "SELECT max(responded_at) FROM connection_stage_proposals
         WHERE connection_id = $1 AND proposed_by_profile_id = $2 AND stage = $3
           AND status = 'declined'",
    )
    .bind(connection_id)
    .bind(proposer)
    .bind(stage)
    .fetch_one(conn)
    .await
}

/// Inserts a pending proposal. `None` when another proposal became pending at the same moment
/// (the unique index allows one, 11 section 13 rule 21).
pub async fn insert_proposal(
    conn: &mut PgConnection,
    connection_id: Uuid,
    proposer: Uuid,
    stage: ConnectionStage,
) -> sqlx::Result<Option<ProposalRow>> {
    sqlx::query_as(
        "INSERT INTO connection_stage_proposals (connection_id, proposed_by_profile_id, stage)
         VALUES ($1, $2, $3)
         ON CONFLICT (connection_id) WHERE status = 'pending' DO NOTHING
         RETURNING id, connection_id, proposed_by_profile_id, stage, status",
    )
    .bind(connection_id)
    .bind(proposer)
    .bind(stage)
    .fetch_optional(conn)
    .await
}

/// A proposal of the connection, without a lock (to plan the locks).
pub async fn proposal(
    db: &PgPool,
    connection_id: Uuid,
    proposal_id: Uuid,
) -> sqlx::Result<Option<ProposalRow>> {
    sqlx::query_as(
        "SELECT id, connection_id, proposed_by_profile_id, stage, status
         FROM connection_stage_proposals WHERE id = $1 AND connection_id = $2",
    )
    .bind(proposal_id)
    .bind(connection_id)
    .fetch_optional(db)
    .await
}

/// A proposal of the connection, locked until the transaction ends.
pub async fn lock_proposal(
    conn: &mut PgConnection,
    connection_id: Uuid,
    proposal_id: Uuid,
) -> sqlx::Result<Option<ProposalRow>> {
    sqlx::query_as(
        "SELECT id, connection_id, proposed_by_profile_id, stage, status
         FROM connection_stage_proposals WHERE id = $1 AND connection_id = $2 FOR UPDATE",
    )
    .bind(proposal_id)
    .bind(connection_id)
    .fetch_optional(conn)
    .await
}

/// Answers a proposal.
pub async fn set_proposal_status(
    conn: &mut PgConnection,
    proposal_id: Uuid,
    status: ProposalStatus,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE connection_stage_proposals SET status = $2, responded_at = now() WHERE id = $1",
    )
    .bind(proposal_id)
    .bind(status)
    .execute(conn)
    .await?;
    Ok(())
}

/// Moves the connection to a stage.
pub async fn set_stage(
    conn: &mut PgConnection,
    connection_id: Uuid,
    stage: ConnectionStage,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE connections SET stage = $2, stage_updated_at = now() WHERE id = $1")
        .bind(connection_id)
        .bind(stage)
        .execute(conn)
        .await?;
    Ok(())
}

// -------------------------------------------------------------------------------------------
// Nikah (11 section 9.4)
// -------------------------------------------------------------------------------------------

/// Locks profile rows in id order (the lock order of every transaction here) and returns
/// their statuses with their user ids.
pub async fn lock_profiles(
    conn: &mut PgConnection,
    ids: &[Uuid],
) -> sqlx::Result<Vec<(Uuid, Uuid, ProfileStatus)>> {
    sqlx::query_as(
        "SELECT id, user_id, status FROM profiles WHERE id = ANY($1) ORDER BY id FOR UPDATE",
    )
    .bind(ids)
    .fetch_all(conn)
    .await
}

/// Closes a profile after a confirmed nikah (`closed_reason = 'found_match_here'`).
pub async fn close_for_nikah(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET status = 'closed', closed_at = now(),
                closed_reason = 'found_match_here', paused_at = NULL
         WHERE id = $1",
    )
    .bind(profile_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// The member's other active connections, locked.
pub async fn other_active(
    conn: &mut PgConnection,
    profile_id: Uuid,
    except: Uuid,
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT id FROM connections
         WHERE status = 'active' AND id <> $2
           AND (profile_low_id = $1 OR profile_high_id = $1)
         ORDER BY id FOR UPDATE",
    )
    .bind(profile_id)
    .bind(except)
    .fetch_all(conn)
    .await
}

/// Deletes the member's `match_recommendations` rows, in both roles.
pub async fn delete_recommendations_of(
    conn: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM match_recommendations WHERE profile_id = $1 OR candidate_profile_id = $1",
    )
    .bind(profile_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// `send_read_receipts` of two members, in the order asked.
pub async fn read_receipts(db: &PgPool, a: Uuid, b: Uuid) -> sqlx::Result<(bool, bool)> {
    sqlx::query_as(
        "SELECT
           COALESCE((SELECT send_read_receipts FROM profile_privacy WHERE profile_id = $1), false),
           COALESCE((SELECT send_read_receipts FROM profile_privacy WHERE profile_id = $2), false)",
    )
    .bind(a)
    .bind(b)
    .fetch_one(db)
    .await
}
