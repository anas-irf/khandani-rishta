//! The `send_push` job (19 section 2.6, 14 section 4): one push type to every Android device of
//! a user.
//!
//! Payload: `{ "user_id", "type", "data", "collapse_key", "ttl_seconds" }`. `type` is a
//! `notifications.type` value or `message` for chat. The job re-checks everything that may have
//! changed since it was enqueued: the account status, the preference, the quiet hours and, for
//! chat, the connection, the mute flag, the unread count and the open socket.

use serde::Deserialize;
use serde_json::{Map, Value};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime, PrimitiveDateTime, Time};
use uuid::Uuid;

use crate::db::notifications::{self as store, PrefsRow};
use crate::domain::types::UserStatus;
use crate::jobs::{ClaimedJob, JobOutcome, payload};
use crate::notify::catalogue::{self, APP_NAME};
use crate::realtime::hub::Realtime;
use crate::services::fcm::{PushError, PushMessage};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct Payload {
    user_id: Uuid,
    #[serde(rename = "type")]
    push_type: String,
    #[serde(default)]
    data: Value,
    collapse_key: Option<String>,
    ttl_seconds: Option<u32>,
}

#[derive(Debug, sqlx::FromRow)]
struct Recipient {
    status: UserStatus,
    timezone: String,
    profile_id: Uuid,
}

/// When the quiet window that contains `now` ends, in the same local time, or `None` when `now`
/// is outside the window (14 section 6.2). `start > end` crosses midnight; `start == end` is an
/// empty window.
pub fn quiet_window_end(
    now: PrimitiveDateTime,
    start: Time,
    end: Time,
) -> Option<PrimitiveDateTime> {
    if start == end {
        return None;
    }
    let clock = now.time();
    let inside = if start < end {
        clock >= start && clock < end
    } else {
        clock >= start || clock < end
    };
    if !inside {
        return None;
    }
    let today_end = now.date().with_time(end);
    Some(if today_end > now {
        today_end
    } else {
        today_end + Duration::days(1)
    })
}

/// The instant the quiet hours of the user end, when they are in effect now.
async fn quiet_hours_end(
    db: &PgPool,
    timezone: &str,
    prefs: &PrefsRow,
) -> sqlx::Result<Option<OffsetDateTime>> {
    let (Some(start), Some(end)) = (prefs.quiet_hours_start, prefs.quiet_hours_end) else {
        return Ok(None);
    };
    let local_now = store::local_now(db, timezone).await?;
    match quiet_window_end(local_now, start, end) {
        Some(local_end) => Ok(Some(store::local_to_utc(db, timezone, local_end).await?)),
        None => Ok(None),
    }
}

/// The unread count of the user for an active, unmuted connection, or why there is nothing to
/// push (14 section 4.3 rule 2).
async fn chat_unread(
    db: &PgPool,
    profile_id: Uuid,
    data: &Value,
) -> sqlx::Result<Result<i32, &'static str>> {
    let Some(connection_id) = data
        .get("connection_id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(Err("no_connection"));
    };
    let unread: Option<i32> = sqlx::query_scalar(
        "SELECT m.unread_count
         FROM connection_members m JOIN connections c ON c.id = m.connection_id
         WHERE m.connection_id = $1 AND m.profile_id = $2
           AND c.status = 'active' AND NOT m.is_muted",
    )
    .bind(connection_id)
    .bind(profile_id)
    .fetch_optional(db)
    .await?;
    Ok(match unread {
        Some(count) if count > 0 => Ok(count),
        Some(_) => Err("no_unread"),
        None => Err("connection_unavailable"),
    })
}

fn skipped(reason: &str) -> JobOutcome {
    JobOutcome::Skipped(reason.to_owned())
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    if !state.push.is_enabled() {
        tracing::debug!("push is off; the job is skipped");
        return Ok(skipped("push_disabled"));
    }

    // 1. The user must be active. A suspended, banned or deleted user, or one whose deletion is
    // scheduled, gets no push (04 section 12, 06 section 9.2).
    let recipient: Option<Recipient> = sqlx::query_as(
        "SELECT u.status, u.timezone, p.id AS profile_id
         FROM users u JOIN profiles p ON p.user_id = u.id
         WHERE u.id = $1",
    )
    .bind(payload.user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(recipient) = recipient.filter(|r| r.status == UserStatus::Active) else {
        return Ok(skipped("user_not_active"));
    };

    // 2. The preference of the event, if it has one.
    let prefs = store::preferences(&state.db, payload.user_id).await?;
    if catalogue::push_pref(&payload.push_type).is_some_and(|pref| !pref.allows(&prefs)) {
        return Ok(skipped("preference"));
    }

    // 3. Quiet hours: run again when they end, without counting the attempt (14 section 6.2).
    if let Some(end) = quiet_hours_end(&state.db, &recipient.timezone, &prefs).await? {
        return Ok(JobOutcome::Postpone(end));
    }

    // 4. Chat: only while there is something unread and the member is not in the app.
    let unread = if payload.push_type == "message" {
        match chat_unread(&state.db, recipient.profile_id, &payload.data).await? {
            Ok(count) => {
                if state.hub.is_online(recipient.profile_id) {
                    return Ok(skipped("online"));
                }
                Some(count)
            }
            Err(reason) => return Ok(skipped(reason)),
        }
    } else {
        None
    };

    let Some(content) = catalogue::content(&payload.push_type, &payload.data) else {
        anyhow::bail!("unknown push type {:?}", payload.push_type);
    };

    // 5. The Android devices.
    let devices = store::android_devices(&state.db, payload.user_id).await?;
    if devices.is_empty() {
        return Ok(skipped("no_devices"));
    }

    let mut fields: Map<String, Value> = payload.data.as_object().cloned().unwrap_or_default();
    fields.insert("type".to_owned(), Value::String(payload.push_type.clone()));
    if let Some(count) = unread {
        fields.insert("count".to_owned(), Value::String(count.to_string()));
    }
    if !fields.contains_key("sent_at") {
        let now = OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        fields.insert("sent_at".to_owned(), Value::String(now));
    }
    let message = PushMessage {
        title: APP_NAME.to_owned(),
        body: content.body.to_owned(),
        channel_id: content.channel.to_owned(),
        collapse_key: Some(payload.collapse_key.unwrap_or(content.collapse_key)),
        ttl_seconds: Some(payload.ttl_seconds.unwrap_or(content.ttl_seconds)),
        data: Value::Object(fields),
    };

    // 6 to 8. One call per device; a dead token deletes the device, a temporary failure fails
    // the attempt (devices that succeeded may get the push twice, which the collapse key makes
    // harmless).
    let mut temporary = 0_usize;
    for device in &devices {
        match state.push.send(&device.push_token, &message).await {
            Ok(()) => {}
            Err(PushError::Unregistered) => {
                store::delete_device_by_id(&state.db, device.id).await?;
                tracing::info!(user_id = %payload.user_id, device_id = %device.id, "removed an unregistered device");
            }
            Err(PushError::Service(error)) if error.is_temporary() => {
                temporary += 1;
                tracing::warn!(%error, device_id = %device.id, "push failed, will retry");
            }
            Err(PushError::Service(error)) => {
                // A refusal that will not fix itself (credentials, project settings).
                tracing::error!(%error, device_id = %device.id, "push was refused");
            }
        }
    }
    if temporary > 0 {
        anyhow::bail!(
            "push failed temporarily for {temporary} of {} devices",
            devices.len()
        );
    }
    Ok(JobOutcome::Done)
}

#[cfg(test)]
mod tests {
    use time::macros::{datetime, time};

    use super::*;

    #[test]
    fn a_window_across_midnight_ends_at_the_next_morning() {
        let (start, end) = (time!(23:00), time!(07:00));
        // Late evening: ends tomorrow morning.
        assert_eq!(
            quiet_window_end(datetime!(2026-11-20 23:30), start, end),
            Some(datetime!(2026-11-21 07:00))
        );
        // After midnight: ends this morning.
        assert_eq!(
            quiet_window_end(datetime!(2026-11-21 02:00), start, end),
            Some(datetime!(2026-11-21 07:00))
        );
        // Daytime: no quiet hours.
        assert_eq!(
            quiet_window_end(datetime!(2026-11-21 07:00), start, end),
            None
        );
        assert_eq!(
            quiet_window_end(datetime!(2026-11-21 12:00), start, end),
            None
        );
        assert_eq!(
            quiet_window_end(datetime!(2026-11-21 22:59), start, end),
            None
        );
        assert_eq!(
            quiet_window_end(datetime!(2026-11-21 23:00), start, end),
            Some(datetime!(2026-11-22 07:00))
        );
    }

    #[test]
    fn a_window_inside_one_day_and_an_empty_window() {
        let (start, end) = (time!(13:00), time!(15:00));
        assert_eq!(
            quiet_window_end(datetime!(2026-11-20 14:00), start, end),
            Some(datetime!(2026-11-20 15:00))
        );
        assert_eq!(
            quiet_window_end(datetime!(2026-11-20 15:00), start, end),
            None
        );
        assert_eq!(
            quiet_window_end(datetime!(2026-11-20 14:00), time!(14:00), time!(14:00)),
            None
        );
    }
}
