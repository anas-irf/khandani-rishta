//! The `notify` helper: every feed notification goes through it (14 section 7.1), and the
//! email queue helpers used by account actions (14 section 5).
//!
//! Called after the transaction that caused the event has committed. A failure here never
//! undoes that event; it is logged and the caller carries on (14 section 7.3 rule 9).
//!
//! | Module | Content |
//! |---|---|
//! | [`actor`] | The actor of a notification as the recipient may see it (09 sections 2, 4 and 6) |
//! | [`catalogue`] | The event catalogue of 14 section 2: push and email of every event |
//! | [`feed`] | `GET /v1/notifications` with the read-time filter (14 section 7.3 rule 3) |
//! | [`templates`] | The email templates (14 section 5.3) |

pub mod actor;
pub mod catalogue;
pub mod feed;
pub mod templates;


use serde_json::{Value, json};
use sqlx::{PgExecutor, PgPool};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::db::counters;
use crate::db::notifications as store;
use crate::domain::time::karachi_day_start;
use crate::domain::types::{NotificationType, ProfileStatus, UserStatus};
use crate::jobs::{NewJob, enqueue};
use crate::models::notifications::Notification;
use crate::realtime::hub::{Realtime, ServerEvent};
use crate::state::AppState;

/// What a recipient receives of an event (14 section 7.3 rule 5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reception {
    /// The feed row, the live events, the push and the email.
    Full,
    /// A suspended or banned user receives only email.
    EmailOnly,
    /// Nothing: a deleted user, or an event a closed profile does not receive.
    Nothing,
}

/// Applies the profile status rule of 14 section 7.3 rule 5: a `paused` profile receives
/// everything; a `closed` profile receives account notices and events on its existing
/// connections; a suspended or banned user receives only email.
fn reception(kind: NotificationType, user: UserStatus, profile: ProfileStatus) -> Reception {
    match (user, profile) {
        (UserStatus::Deleted, _) => Reception::Nothing,
        (UserStatus::Suspended | UserStatus::Banned, _) | (_, ProfileStatus::Suspended) => {
            Reception::EmailOnly
        }
        (_, ProfileStatus::Closed) if !catalogue::closed_profile_receives(kind) => {
            Reception::Nothing
        }
        _ => Reception::Full,
    }
}

/// Creates a feed notification for a user and delivers it (14 section 7.1). Returns the new
/// row id, or `None` when nothing was created (actor not visible, duplicate, the recipient is
/// the actor, the profile status does not receive it).
///
/// Steps: the actor must be openable by the recipient (09 section 2); the duplicate rule of the
/// type (14 section 7.2); the `notifications` row; `notification.new` and `counters` to the
/// recipient's sockets; `send_push` and `send_email` jobs as the catalogue says (14 section 2)
/// and the preferences allow.
pub async fn notify(
    state: &AppState,
    recipient_user_id: Uuid,
    kind: NotificationType,
    actor_profile_id: Option<Uuid>,
    data: Value,
) -> anyhow::Result<Option<Uuid>> {
    let recipient: Option<(Uuid, UserStatus, ProfileStatus)> = sqlx::query_as(
        "SELECT p.id, u.status, p.status
         FROM users u JOIN profiles p ON p.user_id = u.id
         WHERE u.id = $1",
    )
    .bind(recipient_user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((recipient_profile_id, user_status, profile_status)) = recipient else {
        return Ok(None);
    };
    let reception = reception(kind, user_status, profile_status);
    if reception == Reception::Nothing {
        return Ok(None);
    }

    // Rule 7.3.1: never notify the actor about their own action.
    let actor = match actor_profile_id {
        Some(actor) if actor == recipient_profile_id => return Ok(None),
        // Step 1: the actor must still be openable by the recipient.
        Some(actor) => {
            let Some(actor) = actor::load_one(&state.db, recipient_profile_id, actor).await? else {
                return Ok(None);
            };
            Some(actor)
        }
        None => None,
    };

    if reception == Reception::EmailOnly {
        deliver_out_of_app(
            state,
            recipient_user_id,
            kind,
            actor_profile_id,
            &data,
            None,
            reception,
        )
        .await?;
        return Ok(None);
    }

    // Step 2: duplicate rules (14 section 7.2).
    if is_duplicate(state, recipient_user_id, kind, actor_profile_id, &data).await? {
        return Ok(None);
    }

    // Step 3.
    let id = Uuid::now_v7();
    let created_at: OffsetDateTime = sqlx::query_scalar(
        "INSERT INTO notifications (id, user_id, type, actor_profile_id, data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING created_at",
    )
    .bind(id)
    .bind(recipient_user_id)
    .bind(kind)
    .bind(actor_profile_id)
    .bind(&data)
    .fetch_one(&state.db)
    .await?;

    // Step 4.
    if state.hub.is_online(recipient_profile_id) {
        let notification = Notification {
            id,
            kind,
            actor: match &actor {
                Some(actor) => Some(actor.view(state.storage.as_ref()).await),
                None => None,
            },
            data: data.clone(),
            is_read: false,
            created_at,
        };
        state.hub.send_to_profile(
            recipient_profile_id,
            &ServerEvent::new("notification.new", json!({ "notification": notification })),
        );
        counters::push(state, recipient_profile_id).await;
    }

    // Steps 5 and 6.
    if let Err(error) = deliver_out_of_app(
        state,
        recipient_user_id,
        kind,
        actor_profile_id,
        &data,
        Some(id),
        reception,
    )
    .await
    {
        // The row exists and the member sees it in the app; push and email are best effort.
        tracing::warn!(%error, notification_id = %id, "could not queue push or email");
    }
    Ok(Some(id))
}

/// What a duplicate probe looks for among the recipient's rows of one type.
#[derive(Debug, Default)]
struct Probe {
    /// Only rows created at or after this time.
    since: Option<OffsetDateTime>,
    actor: Option<Uuid>,
    /// Keys and values the row's `data` must contain (`null` for none).
    contains: Value,
    /// `Some(true)` for reminder rows only, `Some(false)` for everything else.
    reminder: Option<bool>,
}

async fn exists(
    db: &PgPool,
    user_id: Uuid,
    kind: NotificationType,
    probe: &Probe,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.user_id = $1 AND n.type = $2
               AND ($3::timestamptz IS NULL OR n.created_at >= $3)
               AND ($4::uuid IS NULL OR n.actor_profile_id = $4)
               AND n.data @> $5::jsonb
               AND ($6::boolean IS NULL OR (n.data @> '{\"reminder\": true}'::jsonb) = $6))",
    )
    .bind(user_id)
    .bind(kind)
    .bind(probe.since)
    .bind(probe.actor)
    .bind(if probe.contains.is_null() {
        json!({})
    } else {
        probe.contains.clone()
    })
    .bind(probe.reminder)
    .fetch_one(db)
    .await
}

/// An object holding the listed keys of `data`, or `None` when one of them is missing.
fn keys_of(data: &Value, keys: &[&str]) -> Option<Value> {
    let mut object = serde_json::Map::new();
    for key in keys {
        let value = data.get(*key)?.as_str()?;
        object.insert((*key).to_owned(), Value::String(value.to_owned()));
    }
    Some(Value::Object(object))
}

/// How long an identical decision notification is treated as a repeat of the same call. The
/// types of "one per decision" carry no decision id (14 section 7.2), so only a repeat within
/// this window counts as a duplicate.
const REPEAT_WINDOW: Duration = Duration::minutes(1);

/// The duplicate rule of a type (14 section 7.2). `true` means do not create another row.
async fn is_duplicate(
    state: &AppState,
    recipient_user_id: Uuid,
    kind: NotificationType,
    actor_profile_id: Option<Uuid>,
    data: &Value,
) -> anyhow::Result<bool> {
    let retry_days = state.settings.get().await?.photo_access_retry_days;
    let probe = probe_for(
        kind,
        actor_profile_id,
        data,
        OffsetDateTime::now_utc(),
        retry_days,
    );
    Ok(exists(&state.db, recipient_user_id, kind, &probe).await?)
}

/// What to look for among the recipient's rows to find a duplicate of a new notification
/// (14 section 7.2). `retry_days` is the `photo_access.retry_days` setting.
fn probe_for(
    kind: NotificationType,
    actor_profile_id: Option<Uuid>,
    data: &Value,
    now: OffsetDateTime,
    retry_days: i64,
) -> Probe {
    use NotificationType as T;

    let is_reminder = data.get("reminder").and_then(Value::as_bool) == Some(true);
    // The window for repeats of a call of a type that has no better key.
    let repeat = Probe {
        since: Some(now - REPEAT_WINDOW),
        contains: data.clone(),
        ..Probe::default()
    };
    let keyed = |keys: &[&str], fallback: Probe| {
        keys_of(data, keys).map_or(fallback, |contains| Probe {
            contains,
            ..Probe::default()
        })
    };
    match kind {
        // One row per interest. A reminder: one row per recipient per day.
        T::InterestReceived if is_reminder => Probe {
            since: Some(karachi_day_start(now)),
            reminder: Some(true),
            ..Probe::default()
        },
        T::InterestReceived => Probe {
            reminder: Some(false),
            ..keyed(&["interest_id"], repeat)
        },
        // One per interest.
        T::InterestAccepted => keyed(&["interest_id"], repeat),
        // One per request: the row of a request is reused by a new request after the retry
        // period, so only a row from within that period belongs to the same request.
        T::PhotoRequestReceived => Probe {
            since: Some(now - Duration::days(retry_days)),
            actor: actor_profile_id,
            contains: keys_of(data, &["photo_access_id"]).unwrap_or(Value::Null),
            ..Probe::default()
        },
        // One per grant; a re-grant within 24 hours creates nothing.
        T::PhotoRequestGranted => Probe {
            since: Some(now - Duration::hours(24)),
            actor: actor_profile_id,
            ..Probe::default()
        },
        // One per connection and sharer per 24 hours.
        T::ContactShared => Probe {
            since: Some(now - Duration::hours(24)),
            actor: actor_profile_id,
            contains: keys_of(data, &["connection_id"]).unwrap_or(Value::Null),
            ..Probe::default()
        },
        // One per proposal.
        T::StageProposed | T::StageConfirmed => {
            if keys_of(data, &["proposal_id"]).is_some() {
                keyed(&["proposal_id"], repeat)
            } else {
                keyed(&["connection_id", "stage"], repeat)
            }
        }
        // At most one per source (and per saved search) every 20 hours.
        T::NewMatches => {
            let keys: &[&str] =
                if data.get("source").and_then(Value::as_str) == Some("saved_search") {
                    &["source", "saved_search_id"]
                } else {
                    &["source"]
                };
            Probe {
                since: Some(now - Duration::hours(20)),
                contains: keys_of(data, keys).unwrap_or(Value::Null),
                ..Probe::default()
            }
        }
        // At most one per day.
        T::ProfileViewsSummary => Probe {
            since: Some(karachi_day_start(now)),
            ..Probe::default()
        },
        // One per decision, keyed by the decision where there is one.
        T::PhotoApproved | T::PhotoRejected => keyed(&["photo_id"], repeat),
        T::VerificationApproved | T::VerificationRejected => keyed(&["request_id"], repeat),
        T::AccountWarning => keyed(&["sanction_id"], repeat),
        T::ProfileApproved | T::ProfileChangesRequested | T::TextRejected => repeat,
        // One per user per announcement: the same text again within a day is the same one.
        T::Announcement => Probe {
            since: Some(now - Duration::hours(24)),
            contains: data.clone(),
            ..Probe::default()
        },
    }
}

/// Push and email for the event, per the catalogue of 14 section 2 and the preferences of the
/// recipient (14 section 6.1). A push needs the feed row (`notification_id`); a user who only
/// receives email gets no push.
async fn deliver_out_of_app(
    state: &AppState,
    recipient_user_id: Uuid,
    kind: NotificationType,
    actor_profile_id: Option<Uuid>,
    data: &Value,
    notification_id: Option<Uuid>,
    reception: Reception,
) -> anyhow::Result<()> {
    let prefs = store::preferences(&state.db, recipient_user_id).await?;
    let now = OffsetDateTime::now_utc();
    let mut queued_now = false;

    if let (Reception::Full, Some(notification_id), true) =
        (reception, notification_id, catalogue::pushes(kind))
        && catalogue::push_pref(kind.as_str()).is_none_or(|pref| pref.allows(&prefs))
    {
        let mut push = catalogue::push_data(kind, actor_profile_id, data, notification_id);
        push.insert("sent_at".to_owned(), Value::String(rfc3339(now)));
        let payload = catalogue::push_payload(recipient_user_id, kind.as_str(), &push);
        enqueue(&state.db, NewJob::new("send_push", payload)).await?;
        queued_now = true;
    }

    if let Some(plan) = catalogue::email_plan(kind, recipient_user_id, actor_profile_id, data, now)
        && plan.pref.is_none_or(|pref| pref.allows(&prefs))
    {
        let mut job = email_job(
            recipient_user_id,
            plan.template,
            &plan.data,
            plan.dedupe_key,
        );
        job.run_at = plan.run_at;
        queued_now |= plan.run_at.is_none();
        enqueue(&state.db, job).await?;
    }

    if queued_now {
        state.jobs.wake();
    }
    Ok(())
}

fn rfc3339(at: OffsetDateTime) -> String {
    at.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
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

/// The `send_email` job of 19 section 2.7.
fn email_job(
    user_id: Uuid,
    template: &'static str,
    data: &Value,
    dedupe_key: Option<String>,
) -> NewJob {
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
    job
}

/// Enqueues a `send_email` job (19 section 2.7) inside the caller's transaction or on the pool.
pub async fn queue_email<'e>(
    db: impl PgExecutor<'e>,
    user_id: Uuid,
    template: &'static str,
    data: Value,
    dedupe_key: Option<String>,
) -> sqlx::Result<bool> {
    enqueue(db, email_job(user_id, template, &data, dedupe_key)).await
}

/// Enqueues a `send_email` job to run at `run_at`, for the batched emails of 14 section 5.4.
pub async fn queue_email_at<'e>(
    db: impl PgExecutor<'e>,
    user_id: Uuid,
    template: &'static str,
    data: Value,
    dedupe_key: Option<String>,
    run_at: OffsetDateTime,
) -> sqlx::Result<bool> {
    let mut job = email_job(user_id, template, &data, dedupe_key);
    job.run_at = Some(run_at);
    enqueue(db, job).await
}

/// How long a chat push waits before it is sent, so that a burst of messages is one push
/// (14 section 4.3 rule 1).
pub const CHAT_PUSH_DELAY: Duration = Duration::seconds(10);

/// How long after a message to an offline member the "unread messages" email is considered
/// (14 section 5.4).
pub const UNREAD_EMAIL_DELAY: Duration = Duration::hours(3);

/// Enqueues the chat push of 14 section 4.3 for a recipient without an open socket: one job per
/// connection and recipient while one is queued, due in [`CHAT_PUSH_DELAY`]. Call it after the
/// message committed, then `state.jobs.wake()`.
///
/// The job decides again when it runs whether to send (preference, mute, unread count, socket).
pub async fn queue_message_push<'e>(
    db: impl PgExecutor<'e>,
    recipient_user_id: Uuid,
    connection_id: Uuid,
) -> sqlx::Result<bool> {
    let data = json!({ "target": "APP-CHAT", "connection_id": connection_id });
    let content = catalogue::content("message", &data);
    let payload = json!({
        "user_id": recipient_user_id,
        "type": "message",
        "data": data,
        "collapse_key": content.as_ref().map(|c| c.collapse_key.clone()),
        "ttl_seconds": content.as_ref().map(|c| c.ttl_seconds),
    });
    enqueue(
        db,
        NewJob::new("send_push", payload)
            .dedupe(format!("msg:{connection_id}:{recipient_user_id}"))
            .run_at(OffsetDateTime::now_utc() + CHAT_PUSH_DELAY),
    )
    .await
}

/// Enqueues the delayed "unread messages" email of 14 section 5.4 for a recipient without an
/// open socket: one per user while one is queued, due in [`UNREAD_EMAIL_DELAY`].
pub async fn queue_unread_email<'e>(
    db: impl PgExecutor<'e>,
    recipient_user_id: Uuid,
) -> sqlx::Result<bool> {
    queue_email_at(
        db,
        recipient_user_id,
        "unread_messages",
        json!({}),
        Some(format!("unread:{recipient_user_id}")),
        OffsetDateTime::now_utc() + UNREAD_EMAIL_DELAY,
    )
    .await
}
