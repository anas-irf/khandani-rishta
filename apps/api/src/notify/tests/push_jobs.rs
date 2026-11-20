//! The `send_push` job (19 section 2.6): chat pushes, quiet hours, dead tokens, and failures.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::json;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{World, add_device, connect, pushes_for, set_flag};
use crate::db::notifications::local_now;
use crate::domain::types::NotificationType as T;
use crate::jobs::worker;
use crate::notify::{notify, queue_message_push};
use crate::services::ServiceError;
use crate::services::fcm::{DisabledPush, PushError, PushMessage, PushSender};

/// The `last_error` of the newest `send_push` job, and its status.
async fn last_push_job(w: &World) -> (String, Option<String>) {
    sqlx::query_as(
        "SELECT status, last_error FROM jobs WHERE kind = 'send_push' ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .fetch_one(w.app.db())
    .await
    .expect("a push job exists")
}

/// A connection between the two where he has `unread` unread messages from her, as after a
/// message was created. Returns the connection id.
async fn chat_with_unread(w: &World, unread: i32) -> Uuid {
    let (_, connection) = connect(&w.app, &w.her, &w.him).await;
    sqlx::query(
        "INSERT INTO messages (id, connection_id, sender_profile_id, kind, body)
         VALUES ($1, $2, $3, 'text', 'Assalamu alaikum, how are you?')",
    )
    .bind(Uuid::now_v7())
    .bind(connection)
    .bind(w.her.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE connection_members SET unread_count = $3 WHERE connection_id = $1 AND profile_id = $2",
    )
    .bind(connection)
    .bind(w.him.profile_id)
    .bind(unread)
    .execute(w.app.db())
    .await
    .unwrap();
    connection
}

/// Enqueues the chat push for him and makes it due now.
async fn queue_chat_push(w: &World, connection: Uuid) {
    assert!(
        queue_message_push(w.app.db(), w.him.user_id, connection)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE jobs SET run_at = now() WHERE kind = 'send_push'")
        .execute(w.app.db())
        .await
        .unwrap();
}

#[sqlx::test]
async fn a_chat_push_to_an_offline_device_has_no_message_text(db: PgPool) {
    let w = World::new(db).await;
    add_device(&w.app, w.him.user_id, "token-him").await;
    let connection = chat_with_unread(&w, 2).await;

    // While the job is queued, further messages add nothing (14 section 4.3 rule 1).
    assert!(
        queue_message_push(w.app.db(), w.him.user_id, connection)
            .await
            .unwrap()
    );
    assert!(
        !queue_message_push(w.app.db(), w.him.user_id, connection)
            .await
            .unwrap()
    );
    let (dedupe, delay): (String, f64) = sqlx::query_as(
        "SELECT dedupe_key, EXTRACT(epoch FROM run_at - created_at)::float8 FROM jobs WHERE kind = 'send_push'",
    )
    .fetch_one(w.app.db())
    .await
    .unwrap();
    assert_eq!(dedupe, format!("msg:{connection}:{}", w.him.user_id));
    assert!(
        (9.0..=11.0).contains(&delay),
        "due in 10 seconds, was {delay}"
    );
    assert_eq!(w.app.drain_jobs().await, 0, "not due yet");

    sqlx::query("UPDATE jobs SET run_at = now()")
        .execute(w.app.db())
        .await
        .unwrap();
    assert_eq!(w.app.drain_jobs().await, 1);
    let sent = w.app.push.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    let (token, message) = &sent[0];
    assert_eq!(token, "token-him");
    assert_eq!(message.title, "Khandani Rishta");
    assert_eq!(message.body, "You have a new message");
    assert_eq!(message.channel_id, "messages");
    assert_eq!(
        message.collapse_key.as_deref(),
        Some(format!("msg_{connection}").as_str())
    );
    assert_eq!(message.ttl_seconds, Some(86_400));
    let data = message.data.as_object().unwrap();
    assert_eq!(data["type"], "message");
    assert_eq!(data["target"], "APP-CHAT");
    assert_eq!(data["connection_id"], json!(connection));
    assert_eq!(data["count"], "2");
    assert!(data["sent_at"].as_str().is_some_and(|t| t.ends_with('Z')));
    let everything = format!("{message:?}");
    for private in ["Assalamu", "Ayesha", "Malik", "how are you"] {
        assert!(!everything.contains(private), "the push leaks {private:?}");
    }
    assert_eq!(last_push_job(&w).await, ("succeeded".to_owned(), None));
}

#[sqlx::test]
async fn a_chat_push_is_skipped_when_there_is_nothing_to_say(db: PgPool) {
    let w = World::new(db).await;
    add_device(&w.app, w.him.user_id, "token-him").await;
    let connection = chat_with_unread(&w, 1).await;
    let members = |sql: &'static str| {
        let (app, connection, profile) = (&w.app, connection, w.him.profile_id);
        async move {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE connection_members SET {sql} WHERE connection_id = $1 AND profile_id = $2"
            )))
            .bind(connection)
            .bind(profile)
            .execute(app.db())
            .await
            .unwrap();
        }
    };

    // Muted by him.
    members("is_muted = true").await;
    queue_chat_push(&w, connection).await;
    w.app.drain_jobs().await;
    assert_eq!(
        last_push_job(&w).await.1.as_deref(),
        Some("skipped:connection_unavailable")
    );
    members("is_muted = false").await;

    // He has read everything.
    members("unread_count = 0").await;
    queue_chat_push(&w, connection).await;
    w.app.drain_jobs().await;
    assert_eq!(
        last_push_job(&w).await.1.as_deref(),
        Some("skipped:no_unread")
    );
    members("unread_count = 1").await;

    // He opened the app in the meantime (a socket is open).
    let socket = w.app.state.hub.register(w.him.profile_id, w.him.user_id);
    queue_chat_push(&w, connection).await;
    w.app.drain_jobs().await;
    assert_eq!(last_push_job(&w).await.1.as_deref(), Some("skipped:online"));
    w.app
        .state
        .hub
        .unregister(w.him.profile_id, socket.socket_id);

    // push_messages is off.
    set_flag(&w.app, w.him.user_id, "push_messages", false).await;
    queue_chat_push(&w, connection).await;
    w.app.drain_jobs().await;
    assert_eq!(
        last_push_job(&w).await.1.as_deref(),
        Some("skipped:preference")
    );
    set_flag(&w.app, w.him.user_id, "push_messages", true).await;

    // The connection ended.
    sqlx::query(
        "UPDATE connections SET status = 'ended', ended_at = now(), ended_reason = 'other'",
    )
    .execute(w.app.db())
    .await
    .unwrap();
    queue_chat_push(&w, connection).await;
    w.app.drain_jobs().await;
    assert_eq!(
        last_push_job(&w).await.1.as_deref(),
        Some("skipped:connection_unavailable")
    );
    assert!(
        w.app.push.sent.lock().unwrap().is_empty(),
        "nothing was pushed"
    );

    // And when everything is in order, it is pushed.
    sqlx::query("UPDATE connections SET status = 'active', ended_at = NULL, ended_reason = NULL")
        .execute(w.app.db())
        .await
        .unwrap();
    queue_chat_push(&w, connection).await;
    w.app.drain_jobs().await;
    assert_eq!(w.app.push.sent.lock().unwrap().len(), 1);
}

#[sqlx::test]
async fn pushes_go_only_to_android_devices_of_active_users(db: PgPool) {
    let w = World::new(db).await;
    let send_matches = || async {
        notify(
            &w.app.state,
            w.him.user_id,
            T::NewMatches,
            None,
            json!({ "source": "recommendations", "count": 2, "saved_search_id": null, "nonce": Uuid::now_v7() }),
        )
        .await
        .unwrap()
        .expect("a row");
        w.app.drain_jobs().await;
        last_push_job(&w).await.1
    };
    // No devices at all, then only a web device.
    assert_eq!(send_matches().await.as_deref(), Some("skipped:no_devices"));
    sqlx::query(
        "INSERT INTO user_devices (user_id, platform, push_token) VALUES ($1, 'web', 'web-token')",
    )
    .bind(w.him.user_id)
    .execute(w.app.db())
    .await
    .unwrap();
    sqlx::query("DELETE FROM notifications")
        .execute(w.app.db())
        .await
        .unwrap();
    assert_eq!(send_matches().await.as_deref(), Some("skipped:no_devices"));

    add_device(&w.app, w.him.user_id, "android-token").await;
    sqlx::query("DELETE FROM notifications")
        .execute(w.app.db())
        .await
        .unwrap();
    assert_eq!(send_matches().await, None);
    let sent = w.app.push.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, "android-token");
    assert_eq!(sent[0].1.channel_id, "activity");
    assert_eq!(sent[0].1.data["target"], "APP-MATCHES");

    // Once his account is not active, the job skips (06 section 9.2).
    for status in ["suspended", "deletion_scheduled", "banned"] {
        sqlx::query("UPDATE users SET status = $2 WHERE id = $1")
            .bind(w.him.user_id)
            .bind(status)
            .execute(w.app.db())
            .await
            .unwrap();
        sqlx::query("DELETE FROM notifications")
            .execute(w.app.db())
            .await
            .unwrap();
        // notify itself creates no push for suspended or banned users; a job enqueued earlier
        // still runs, so queue one by hand.
        sqlx::query(
            "INSERT INTO jobs (kind, payload) VALUES ('send_push', jsonb_build_object('user_id', $1::uuid, 'type', 'new_matches', 'data', '{}'::jsonb))",
        )
        .bind(w.him.user_id)
        .execute(w.app.db())
        .await
        .unwrap();
        w.app.drain_jobs().await;
        assert_eq!(
            last_push_job(&w).await.1.as_deref(),
            Some("skipped:user_not_active"),
            "{status}"
        );
    }
    assert_eq!(
        w.app.push.sent.lock().unwrap().len(),
        1,
        "nothing more was sent"
    );
}

#[sqlx::test]
async fn dead_tokens_are_deleted_and_the_other_devices_still_get_the_push(db: PgPool) {
    let w = World::new(db).await;
    add_device(&w.app, w.him.user_id, "dead-token").await;
    add_device(&w.app, w.him.user_id, "live-token").await;
    w.app
        .push
        .unregistered
        .lock()
        .unwrap()
        .push("dead-token".to_owned());
    notify(
        &w.app.state,
        w.him.user_id,
        T::AccountWarning,
        None,
        json!({ "sanction_id": Uuid::now_v7(), "reason": "x" }),
    )
    .await
    .unwrap()
    .expect("a row");
    w.app.drain_jobs().await;

    let tokens: Vec<String> =
        sqlx::query_scalar("SELECT push_token FROM user_devices WHERE user_id = $1")
            .bind(w.him.user_id)
            .fetch_all(w.app.db())
            .await
            .unwrap();
    assert_eq!(tokens, ["live-token"]);
    let sent = w.app.push.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, "live-token");
    assert_eq!(sent[0].1.channel_id, "account");
    assert_eq!(last_push_job(&w).await, ("succeeded".to_owned(), None));
}

/// Moves the quiet hours of a user around the current local time of their zone: from an hour
/// ago to an hour ahead, or the other way round when `around_now` is false.
async fn set_quiet_hours(w: &World, timezone: &str, around_now: bool) -> OffsetDateTime {
    let now = local_now(w.app.db(), timezone).await.unwrap().time();
    let (start, end) = if around_now {
        (now - Duration::hours(1), now + Duration::hours(1))
    } else {
        (now + Duration::hours(2), now + Duration::hours(4))
    };
    sqlx::query("UPDATE users SET timezone = $2 WHERE id = $1")
        .bind(w.him.user_id)
        .bind(timezone)
        .execute(w.app.db())
        .await
        .unwrap();
    sqlx::query(
        "UPDATE notification_preferences SET quiet_hours_start = $2, quiet_hours_end = $3 WHERE user_id = $1",
    )
    .bind(w.him.user_id)
    .bind(start)
    .bind(end)
    .execute(w.app.db())
    .await
    .unwrap();
    // The end of the window, as an instant.
    OffsetDateTime::now_utc() + Duration::hours(1)
}

#[sqlx::test]
async fn quiet_hours_hold_the_push_until_the_window_ends(db: PgPool) {
    let w = World::new(db).await;
    add_device(&w.app, w.him.user_id, "token-him").await;
    // Zones with and without a day difference from Karachi, a zone with daylight saving, and a
    // name the database does not know (it falls back to Karachi).
    for (round, timezone) in [
        "Asia/Karachi",
        "America/New_York",
        "Pacific/Auckland",
        "Mars/Phobos",
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query("DELETE FROM notifications")
            .execute(w.app.db())
            .await
            .unwrap();
        sqlx::query("DELETE FROM jobs")
            .execute(w.app.db())
            .await
            .unwrap();
        let expected_end = set_quiet_hours(&w, timezone, true).await;
        notify(
            &w.app.state,
            w.him.user_id,
            T::NewMatches,
            None,
            json!({ "source": "recommendations", "count": round + 1, "saved_search_id": null }),
        )
        .await
        .unwrap()
        .expect("the feed row is created inside quiet hours");
        w.app.drain_jobs().await;

        // Not sent, not failed, not counted as an attempt: held until the window ends.
        assert!(w.app.push.sent.lock().unwrap().is_empty(), "{timezone}");
        let (status, attempts, run_at): (String, i16, OffsetDateTime) =
            sqlx::query_as("SELECT status, attempts, run_at FROM jobs WHERE kind = 'send_push'")
                .fetch_one(w.app.db())
                .await
                .unwrap();
        assert_eq!(status, "queued", "{timezone}");
        assert_eq!(attempts, 0, "{timezone}");
        let drift = (run_at - expected_end).abs();
        assert!(
            drift < Duration::minutes(2),
            "{timezone}: run_at {run_at}, expected {expected_end}"
        );
    }

    // Outside the window the push goes at once, and the window ended: the held job runs.
    sqlx::query("DELETE FROM notifications")
        .execute(w.app.db())
        .await
        .unwrap();
    set_quiet_hours(&w, "Asia/Karachi", false).await;
    notify(
        &w.app.state,
        w.him.user_id,
        T::NewMatches,
        None,
        json!({ "source": "recommendations", "count": 9, "saved_search_id": null }),
    )
    .await
    .unwrap()
    .expect("a row");
    sqlx::query("UPDATE jobs SET run_at = now()")
        .execute(w.app.db())
        .await
        .unwrap();
    w.app.drain_jobs().await;
    assert_eq!(
        w.app.push.sent.lock().unwrap().len(),
        2,
        "the held job and the new one"
    );
    assert_eq!(
        pushes_for(&w.app, w.him.user_id).await.len(),
        0,
        "none left queued"
    );
}

/// A push sender that can be told to fail.
struct Flaky {
    outcome: Mutex<Option<ServiceError>>,
    refuse_for_good: AtomicBool,
    sent: Mutex<Vec<String>>,
}

#[async_trait]
impl PushSender for Flaky {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn send(&self, push_token: &str, _: &PushMessage) -> Result<(), PushError> {
        if self.refuse_for_good.load(Ordering::SeqCst) {
            return Err(PushError::Service(ServiceError::Permanent(
                "denied".to_owned(),
            )));
        }
        if let Some(error) = self.outcome.lock().unwrap().as_ref() {
            return Err(PushError::Service(ServiceError::Temporary(
                error.to_string(),
            )));
        }
        self.sent.lock().unwrap().push(push_token.to_owned());
        Ok(())
    }
}

#[sqlx::test]
async fn a_temporary_failure_retries_with_backoff_and_a_refusal_does_not(db: PgPool) {
    let w = World::new(db).await;
    add_device(&w.app, w.him.user_id, "token-1").await;
    add_device(&w.app, w.him.user_id, "token-2").await;
    let flaky = Arc::new(Flaky {
        outcome: Mutex::new(Some(ServiceError::Temporary("HTTP 503".to_owned()))),
        refuse_for_good: AtomicBool::new(false),
        sent: Mutex::new(Vec::new()),
    });
    let mut state = w.app.state.clone();
    state.push = flaky.clone();
    notify(
        &state,
        w.him.user_id,
        T::AccountWarning,
        None,
        json!({ "sanction_id": Uuid::now_v7(), "reason": "x" }),
    )
    .await
    .unwrap()
    .expect("a row");

    // 429 and 5xx fail the attempt: back to queued with the first backoff of 30 seconds.
    worker::drain(&state).await.unwrap();
    let (status, attempts, error, seconds): (String, i16, Option<String>, f64) = sqlx::query_as(
        "SELECT status, attempts, last_error, EXTRACT(epoch FROM run_at - now())::float8
         FROM jobs WHERE kind = 'send_push'",
    )
    .fetch_one(w.app.db())
    .await
    .unwrap();
    assert_eq!((status.as_str(), attempts), ("queued", 1));
    assert!(error.is_some_and(|e| e.contains("2 of 2 devices")));
    assert!((20.0..=31.0).contains(&seconds), "backoff was {seconds}");

    // Service is back: the retry sends to both devices.
    *flaky.outcome.lock().unwrap() = None;
    sqlx::query("UPDATE jobs SET run_at = now()")
        .execute(w.app.db())
        .await
        .unwrap();
    worker::drain(&state).await.unwrap();
    assert_eq!(flaky.sent.lock().unwrap().len(), 2);
    assert_eq!(last_push_job(&w).await, ("succeeded".to_owned(), None));

    // A refusal that will not fix itself does not fail the job, so it is not retried.
    flaky.refuse_for_good.store(true, Ordering::SeqCst);
    notify(
        &state,
        w.him.user_id,
        T::AccountWarning,
        None,
        json!({ "sanction_id": Uuid::now_v7(), "reason": "y" }),
    )
    .await
    .unwrap()
    .expect("a row");
    worker::drain(&state).await.unwrap();
    assert_eq!(last_push_job(&w).await, ("succeeded".to_owned(), None));
    assert_eq!(flaky.sent.lock().unwrap().len(), 2);
}

#[sqlx::test]
async fn a_disabled_push_service_skips_the_job(db: PgPool) {
    let w = World::new(db).await;
    add_device(&w.app, w.him.user_id, "token-him").await;
    let mut state = w.app.state.clone();
    state.push = Arc::new(DisabledPush);
    notify(
        &state,
        w.him.user_id,
        T::AccountWarning,
        None,
        json!({ "sanction_id": Uuid::now_v7() }),
    )
    .await
    .unwrap()
    .expect("a row");
    worker::drain(&state).await.unwrap();
    assert_eq!(
        last_push_job(&w).await.1.as_deref(),
        Some("skipped:push_disabled")
    );
}
