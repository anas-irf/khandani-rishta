//! State transitions that several features share. Each function runs inside the caller's
//! transaction; the caller sends realtime events after commit.

use serde_json::json;
use sqlx::PgConnection;
use uuid::Uuid;

/// Pairs of `(sender, receiver)` profile ids whose pending interests were expired.
pub type ExpiredInterests = Vec<(Uuid, Uuid)>;

/// Expires every `pending` interest sent or received by a profile that leaves `active` for
/// `closed`, `suspended` or `deleted` (03 section 4.2). `expires_at` is set to now, which starts
/// the expiry cooldown (03 section 4.7).
pub async fn expire_pending_interests(
    tx: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<ExpiredInterests> {
    sqlx::query_as(
        "UPDATE interests SET status = 'expired', expires_at = now()
         WHERE status = 'pending' AND (sender_profile_id = $1 OR receiver_profile_id = $1)
         RETURNING sender_profile_id, receiver_profile_id",
    )
    .bind(profile_id)
    .fetch_all(tx)
    .await
}

/// The two members of an ended connection, for the events sent after commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::FromRow)]
#[allow(clippy::struct_field_names)] // Column names.
pub struct EndedConnection {
    pub connection_id: Uuid,
    pub profile_low_id: Uuid,
    pub profile_high_id: Uuid,
}

/// Ends an `active` connection with the effects of 03 section 4.8 and 11 section 5.4 steps 1 to
/// 5: status and reason, both contact shares revoked, photo access between the pair revoked,
/// a pending stage proposal cancelled, and a `connection_ended` system message.
///
/// `ended_by` is `None` for system endings (account closure, ban, purge). Returns `None` when
/// the connection was not active.
pub async fn end_connection(
    tx: &mut PgConnection,
    connection_id: Uuid,
    ended_by: Option<Uuid>,
    reason: &str,
) -> sqlx::Result<Option<EndedConnection>> {
    let ended: Option<EndedConnection> = sqlx::query_as(
        "UPDATE connections
         SET status = 'ended', ended_by_profile_id = $2, ended_reason = $3, ended_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING id AS connection_id, profile_low_id, profile_high_id",
    )
    .bind(connection_id)
    .bind(ended_by)
    .bind(reason)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(ended) = ended else {
        return Ok(None);
    };

    sqlx::query(
        "UPDATE contact_shares SET status = 'revoked', revoked_at = now()
         WHERE connection_id = $1 AND status = 'active'",
    )
    .bind(connection_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE photo_access SET status = 'revoked', decided_at = now()
         WHERE status = 'granted'
           AND ((owner_profile_id = $1 AND viewer_profile_id = $2)
             OR (owner_profile_id = $2 AND viewer_profile_id = $1))",
    )
    .bind(ended.profile_low_id)
    .bind(ended.profile_high_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE connection_stage_proposals SET status = 'cancelled', responded_at = now()
         WHERE connection_id = $1 AND status = 'pending'",
    )
    .bind(connection_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO messages (id, connection_id, kind, system_event, system_data)
         VALUES ($1, $2, 'system', 'connection_ended', $3)",
    )
    .bind(Uuid::now_v7())
    .bind(connection_id)
    .bind(json!({}))
    .execute(&mut *tx)
    .await?;
    Ok(Some(ended))
}

/// Ends every active connection of a profile (account closure, ban or purge), as the system.
pub async fn end_all_connections(
    tx: &mut PgConnection,
    profile_id: Uuid,
    reason: &str,
) -> sqlx::Result<Vec<EndedConnection>> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM connections
         WHERE status = 'active' AND (profile_low_id = $1 OR profile_high_id = $1)
         FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut ended = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(connection) = end_connection(&mut *tx, id, None, reason).await? {
            ended.push(connection);
        }
    }
    Ok(ended)
}

/// Orders a pair the way `connections` stores it (04 section 1, "Pairs").
pub fn ordered_pair(a: Uuid, b: Uuid) -> (Uuid, Uuid) {
    if a < b { (a, b) } else { (b, a) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairs_are_ordered() {
        let (a, b) = (Uuid::now_v7(), Uuid::now_v7());
        assert_eq!(ordered_pair(a, b), ordered_pair(b, a));
        assert!(ordered_pair(b, a).0 < ordered_pair(b, a).1);
    }
}
