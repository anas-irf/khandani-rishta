//! The `notify` helper: every feed notification goes through it (14 section 7.1), and the
//! email queue helper used by account actions (14 section 5).
//!
//! Called after the transaction that caused the event has committed. A failure here never
//! undoes that event; it is logged and the caller carries on.

use serde_json::{Value, json};
use sqlx::PgExecutor;
use uuid::Uuid;

use crate::db::counters;
use crate::domain::types::NotificationType;
use crate::jobs::{NewJob, enqueue};
use crate::realtime::hub::{Realtime, ServerEvent};
use crate::state::AppState;

/// Creates a feed notification for a user and delivers it (14 section 7.1). Returns the new
/// row id, or `None` when nothing was created (actor not visible, duplicate, the recipient is
/// the actor).
pub async fn notify(
    state: &AppState,
    recipient_user_id: Uuid,
    kind: NotificationType,
    actor_profile_id: Option<Uuid>,
    data: Value,
) -> anyhow::Result<Option<Uuid>> {
    let recipient: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT p.id, u.status FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
    )
    .bind(recipient_user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((recipient_profile_id, recipient_status)) = recipient else {
        return Ok(None);
    };
    if recipient_status == "deleted" {
        return Ok(None);
    }

    if let Some(actor) = actor_profile_id {
        // Rule 7.3.1: never notify the actor about their own action.
        if actor == recipient_profile_id {
            return Ok(None);
        }
        // Step 1: the actor must still be visible to the recipient (no block, not hidden).
        let visible: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                 SELECT 1 FROM profiles a JOIN users au ON au.id = a.user_id
                 WHERE a.id = $1 AND au.status = 'active'
                   AND a.status IN ('active', 'paused', 'closed')
                   AND NOT EXISTS (SELECT 1 FROM blocks b
                       WHERE (b.blocker_profile_id = $1 AND b.blocked_profile_id = $2)
                          OR (b.blocker_profile_id = $2 AND b.blocked_profile_id = $1)))",
        )
        .bind(actor)
        .bind(recipient_profile_id)
        .fetch_one(&state.db)
        .await?;
        if !visible {
            return Ok(None);
        }
    }

    // Step 2: duplicate rules (14 section 7.2).
    if is_duplicate(state, recipient_user_id, kind, actor_profile_id, &data).await? {
        return Ok(None);
    }

    // Step 3.
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO notifications (id, user_id, type, actor_profile_id, data)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(recipient_user_id)
    .bind(kind)
    .bind(actor_profile_id)
    .bind(&data)
    .execute(&state.db)
    .await?;

    // Step 4.
    if state.hub.is_online(recipient_profile_id) {
        let event = ServerEvent::new(
            "notification.new",
            json!({
                "notification": {
                    "id": id,
                    "type": kind,
                    "actor": render_actor(state, recipient_profile_id, actor_profile_id).await,
                    "data": data,
                    "is_read": false,
                    "created_at": time::OffsetDateTime::now_utc()
                        .format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_default(),
                }
            }),
        );
        state.hub.send_to_profile(recipient_profile_id, &event);
        counters::push(state, recipient_profile_id).await;
    }

    // Steps 5 and 6.
    deliver_out_of_app(state, recipient_user_id, kind, actor_profile_id, &data, id).await?;
    Ok(Some(id))
}

/// The duplicate rule of a type (14 section 7.2). `true` means do not create another row.
#[allow(clippy::unused_async)] // Completed with the notification catalogue.
async fn is_duplicate(
    _state: &AppState,
    _recipient_user_id: Uuid,
    _kind: NotificationType,
    _actor_profile_id: Option<Uuid>,
    _data: &Value,
) -> anyhow::Result<bool> {
    Ok(false)
}

/// The `actor` object of a feed row: `{ profile_id, display_name, photo }` as the recipient may
/// see it, or `null`.
#[allow(clippy::unused_async)] // Completed with the notification catalogue.
async fn render_actor(_state: &AppState, _viewer: Uuid, actor_profile_id: Option<Uuid>) -> Value {
    actor_profile_id.map_or(
        Value::Null,
        |id| json!({ "profile_id": id, "display_name": null, "photo": null }),
    )
}

/// Push and email for the event, per the catalogue of 14 section 2.
#[allow(clippy::unused_async)] // Completed with the notification catalogue.
async fn deliver_out_of_app(
    _state: &AppState,
    _recipient_user_id: Uuid,
    _kind: NotificationType,
    _actor_profile_id: Option<Uuid>,
    _data: &Value,
    _notification_id: Uuid,
) -> anyhow::Result<()> {
    Ok(())
}

/// Email templates and their priorities (14 section 5.3).
pub fn email_priority(template: &str) -> i16 {
    match template {
        "account_suspended"
        | "account_warning"
        | "account_deletion"
        | "export_ready"
        | "profile_changes_requested"
        | "verification_result" => 1,
        "welcome" | "interest_accepted" => 2,
        "interest_digest" => 3,
        "unread_messages" => 4,
        "match_digest" => 5,
        _ => 6,
    }
}

/// Enqueues a `send_email` job (19 section 2.7) inside the caller's transaction or on the pool.
pub async fn queue_email<'e>(
    db: impl PgExecutor<'e>,
    user_id: Uuid,
    template: &'static str,
    data: Value,
    dedupe_key: Option<String>,
) -> sqlx::Result<bool> {
    let mut job = NewJob::new(
        "send_email",
        json!({
            "user_id": user_id,
            "template": template,
            "priority": email_priority(template),
            "data": data,
        }),
    );
    job.dedupe_key = dedupe_key;
    enqueue(db, job).await
}
