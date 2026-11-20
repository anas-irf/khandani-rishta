//! `Me.counters` (14 section 8.1). Never stored: computed on demand and pushed with a
//! `counters` event after each change that affects them.

use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::realtime::hub::{Realtime, ServerEvent};
use crate::state::AppState;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema, sqlx::FromRow)]
pub struct Counters {
    /// Active, unmuted connections with unread messages.
    pub unread_chats: i64,
    /// Received pending interests whose sender can still be opened.
    pub pending_interests: i64,
    /// Received pending photo access requests.
    pub pending_photo_requests: i64,
    pub unread_notifications: i64,
}

/// The one query of 14 section 8.1.
pub async fn load(db: &PgPool, profile_id: Uuid, user_id: Uuid) -> sqlx::Result<Counters> {
    sqlx::query_as(
        "SELECT
           (SELECT count(*)
              FROM connection_members m
              JOIN connections k ON k.id = m.connection_id
             WHERE m.profile_id = $1 AND k.status = 'active' AND NOT m.is_muted
               AND m.unread_count > 0) AS unread_chats,
           (SELECT count(*)
              FROM interests i
              JOIN profiles s ON s.id = i.sender_profile_id
              JOIN users su ON su.id = s.user_id
             WHERE i.receiver_profile_id = $1 AND i.status = 'pending'
               AND s.status IN ('active', 'paused') AND su.status = 'active'
               AND NOT EXISTS (SELECT 1 FROM blocks b
                                WHERE (b.blocker_profile_id = $1 AND b.blocked_profile_id = s.id)
                                   OR (b.blocker_profile_id = s.id AND b.blocked_profile_id = $1))
           ) AS pending_interests,
           (SELECT count(*) FROM photo_access a
             WHERE a.owner_profile_id = $1 AND a.status = 'pending') AS pending_photo_requests,
           (SELECT count(*) FROM notifications n
             WHERE n.user_id = $2 AND n.read_at IS NULL) AS unread_notifications",
    )
    .bind(profile_id)
    .bind(user_id)
    .fetch_one(db)
    .await
}

/// Sends the current counters to a profile's sockets, if it has any. Never fails the caller.
pub async fn push(state: &AppState, profile_id: Uuid) {
    if !state.hub.is_online(profile_id) {
        return;
    }
    let user_id: Option<Uuid> =
        match sqlx::query_scalar("SELECT user_id FROM profiles WHERE id = $1")
            .bind(profile_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(user_id) => user_id,
            Err(error) => {
                tracing::warn!(%error, "could not load counters");
                return;
            }
        };
    let Some(user_id) = user_id else { return };
    match load(&state.db, profile_id, user_id).await {
        Ok(counters) => state
            .hub
            .send_to_profile(profile_id, &ServerEvent::new("counters", counters)),
        Err(error) => tracing::warn!(%error, "could not load counters"),
    }
}
