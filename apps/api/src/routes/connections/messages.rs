//! Chat messages (11 section 6, 15 section 12): history, send, delete own message, read.

use std::collections::VecDeque;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use moka::sync::Cache;
use serde_json::json;
use time::OffsetDateTime;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use super::member_of;
use crate::auth::{Connected, Engage};
use crate::db::connections::{self as db, HistoryFrom, Membership, MessageRow, NewText};
use crate::db::counters;
use crate::db::interests::{bump_usage, usage_count};
use crate::domain::chat_safety::{self, MONEY_REPORT_MAX_CONTEXT_MESSAGES};
use crate::domain::privacy::Privacy;
use crate::domain::time::{karachi_date, next_karachi_midnight};
use crate::domain::types::{ConnectionStatus, SafetyFlag, Tier, UsageCounter};
use crate::domain::visibility;
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::connections::{
    MESSAGES_DEFAULT_LIMIT, MESSAGES_MAX_LIMIT, Message, MessagesPage, MessagesQuery, ReadBody,
    SendMessageBody, publish_messages, render_message,
};
use crate::notify;
use crate::realtime::hub::{Realtime, ServerEvent};
use crate::settings::AppSettings;
use crate::state::AppState;
use crate::views;

pub(super) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_messages, send_message))
        .routes(routes!(delete_message))
        .routes(routes!(mark_read))
}

/// Longest message body after trimming (04 section 7.3).
pub const BODY_MAX_CHARS: usize = 2000;

/// How long after sending a member may remove a message (11 section 6.7).
pub const DELETE_WINDOW: time::Duration = time::Duration::minutes(15);

// -------------------------------------------------------------------------------------------
// limits.messages_per_minute: an in-memory sliding window per sender (11 section 6.2 step 3)
// -------------------------------------------------------------------------------------------

/// The length of the per-minute window.
const MINUTE: Duration = Duration::from_secs(60);

/// Send times of each sender within the last minute. One API instance runs per environment,
/// so memory is the right place (19 section 6.2); the state is keyed by profile id and needs
/// no shared application state.
static RECENT_SENDS: LazyLock<Cache<Uuid, Arc<Mutex<VecDeque<Instant>>>>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(100_000)
        .time_to_idle(MINUTE * 2)
        .build()
});

/// Counts one message of `sender` against `limit` per minute. `Err(seconds)` says how long to
/// wait before the next message is allowed.
fn per_minute(sender: Uuid, limit: i64, now: Instant) -> Result<(), u64> {
    let limit = usize::try_from(limit.max(0)).unwrap_or(usize::MAX);
    let cell = RECENT_SENDS.get_with(sender, Arc::default);
    let Ok(mut sent) = cell.lock() else {
        return Ok(());
    };
    while sent
        .front()
        .is_some_and(|at| now.saturating_duration_since(*at) >= MINUTE)
    {
        sent.pop_front();
    }
    if sent.len() >= limit {
        let wait = sent.front().map_or(MINUTE, |oldest| {
            MINUTE.saturating_sub(now.saturating_duration_since(*oldest))
        });
        return Err(wait.as_secs().max(1));
    }
    sent.push_back(now);
    Ok(())
}

// -------------------------------------------------------------------------------------------
// History
// -------------------------------------------------------------------------------------------

/// Message history: the newest `limit` (default 30, at most 100) messages newest first, or
/// those older than `before` (newest first), or those newer than `after` (oldest first; repeat
/// while `has_more`). Ended connections stay readable.
#[utoipa::path(
    get,
    path = "/connections/{connection_id}/messages",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection"), MessagesQuery),
    responses(
        (status = 200, body = MessagesPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn list_messages(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(connection_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<MessagesQuery>,
) -> ApiResult<Json<MessagesPage>> {
    let me = account.profile_id;
    member_of(&state, me, connection_id).await?;
    let from = match (query.before, query.after) {
        (Some(_), Some(_)) => {
            return Err(ApiError::BadRequest(
                "use either before or after, not both".to_owned(),
            ));
        }
        (Some(id), None) => HistoryFrom::Before(id),
        (None, Some(id)) => HistoryFrom::After(id),
        (None, None) => HistoryFrom::Newest,
    };
    let limit = query
        .limit
        .unwrap_or(MESSAGES_DEFAULT_LIMIT)
        .clamp(1, MESSAGES_MAX_LIMIT);
    let mut rows = db::history(&state.db, connection_id, from, limit + 1).await?;
    let size = usize::try_from(limit).unwrap_or(0);
    let has_more = rows.len() > size;
    rows.truncate(size);
    Ok(Json(MessagesPage {
        items: rows.iter().map(|row| render_message(row, me)).collect(),
        has_more,
    }))
}

// -------------------------------------------------------------------------------------------
// Send
// -------------------------------------------------------------------------------------------

/// `client_message_id` in its stored form: a UUID in lowercase hyphenated text.
fn client_id(raw: &str) -> ApiResult<String> {
    Uuid::parse_str(raw.trim())
        .map(|id| id.hyphenated().to_string())
        .map_err(|_| ApiError::field("client_message_id", FieldCode::Invalid))
}

/// The trimmed body, 1 to 2000 characters.
fn checked_body(raw: &str) -> ApiResult<&str> {
    let body = raw.trim();
    if body.is_empty() {
        return Err(ApiError::field("body", FieldCode::Required));
    }
    if body.chars().count() > BODY_MAX_CHARS {
        return Err(ApiError::field("body", FieldCode::TooLong));
    }
    Ok(body)
}

/// Send a text message.
///
/// `client_message_id` is a UUID made by the client and reused on every retry: sending it
/// again returns the original message with `200` and changes nothing. Errors:
/// `connection_ended`; `invalid_state` with `details.status = 'other_unavailable'` when the
/// other member can no longer be opened (suspended, banned, scheduled for deletion);
/// `rate_limited` (`limits.messages_per_minute`) and `limit_reached`
/// (`limits.messages_per_day`). Messages are never blocked for their content: the safety
/// patterns only add a notice for the receiver (13 section 5).
#[utoipa::path(
    post,
    path = "/connections/{connection_id}/messages",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    request_body = SendMessageBody,
    responses(
        (status = 201, body = Message, description = "Sent"),
        (status = 200, body = Message, description = "Already sent with this client_message_id"),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn send_message(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(connection_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SendMessageBody>,
) -> ApiResult<(StatusCode, Json<Message>)> {
    let me = account.profile_id;
    let membership = member_of(&state, me, connection_id).await?;
    let client_message_id = client_id(&body.client_message_id)?;

    // A retry of a message that already exists: the original, with no side effects.
    if let Some(existing) =
        db::by_client_id(&state.db, connection_id, me, &client_message_id).await?
    {
        return Ok((StatusCode::OK, Json(render_message(&existing, me))));
    }

    // Step 1: an active connection.
    if membership.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    // Step 2: the other member must be openable at tier `connection` (09 section 2).
    let other = membership.other_id;
    let viewer = views::viewer(&state, me).await?;
    if views::can_open(&state, &viewer, other).await? != Some(Tier::Connection) {
        return Err(ApiError::invalid_state("other_unavailable"));
    }
    // Step 3: the limits.
    let settings = state.settings.get().await?;
    let now = OffsetDateTime::now_utc();
    let today = karachi_date(now);
    check_limits(&state, me, &settings, now).await?;
    // Step 4: the body.
    let text = checked_body(&body.body)?;
    // Step 5: the safety patterns; detection never blocks a message.
    let safety_flag = chat_safety::classify(text);

    // Step 6.
    let mut tx = state.db.begin().await?;
    let locked = db::lock_membership(&mut tx, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if locked.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    let inserted = db::insert_text(
        &mut tx,
        &NewText {
            connection_id,
            sender: me,
            other,
            body: text,
            client_message_id: &client_message_id,
            safety_flag,
        },
    )
    .await?;
    let Some(message) = inserted else {
        // The same message was created by a concurrent retry.
        drop(tx);
        let existing = db::by_client_id(&state.db, connection_id, me, &client_message_id)
            .await?
            .ok_or(ApiError::NotFound)?;
        return Ok((StatusCode::OK, Json(render_message(&existing, me))));
    };
    if !bump_usage(
        &mut tx,
        me,
        UsageCounter::MessagesSent,
        today,
        settings.messages_per_day,
    )
    .await?
    {
        return Err(daily_limit(settings.messages_per_day, now));
    }
    if safety_flag == Some(SafetyFlag::Money) {
        money_report(&mut tx, me).await?;
    }
    tx.commit().await?;
    tracing::info!(event = "message.sent", safety_flag = ?safety_flag);

    // Step 7.
    after_send(&state, &membership, &message).await;
    Ok((StatusCode::CREATED, Json(render_message(&message, me))))
}

/// `limit_reached` for `limits.messages_per_day`, which resets at midnight in `Asia/Karachi`.
fn daily_limit(used: i64, now: OffsetDateTime) -> ApiError {
    tracing::info!(event = "limit.reached", limit = "limits.messages_per_day");
    ApiError::LimitReached {
        limit: "limits.messages_per_day",
        used,
        resets_at: Some(next_karachi_midnight(now)),
        side: None,
    }
}

/// Step 3 of 11 section 6.2: `limits.messages_per_minute` in memory (`rate_limited`), then
/// `limits.messages_per_day` from `usage_counters` (`limit_reached`).
async fn check_limits(
    state: &AppState,
    me: Uuid,
    settings: &AppSettings,
    now: OffsetDateTime,
) -> ApiResult<()> {
    if let Err(retry_after_seconds) = per_minute(me, settings.messages_per_minute, Instant::now()) {
        tracing::info!(
            event = "limit.reached",
            limit = "limits.messages_per_minute"
        );
        return Err(ApiError::RateLimited {
            retry_after_seconds,
        });
    }
    let sent_today =
        usage_count(&state.db, me, UsageCounter::MessagesSent, karachi_date(now)).await?;
    if sent_today >= settings.messages_per_day {
        return Err(daily_limit(sent_today, now));
    }
    Ok(())
}

/// Step 7 of 11 section 6.2, after the commit: `message.new` to both members and `counters`
/// to the other; for an other member without an open socket, the chat push (unless muted)
/// and the delayed unread email (14 sections 4.3 and 5.4).
async fn after_send(state: &AppState, membership: &Membership, message: &MessageRow) {
    let me = message.sender_profile_id.unwrap_or_default();
    let other = membership.other_id;
    publish_messages(state, [me, other], std::slice::from_ref(message));
    counters::push(state, other).await;
    if state.hub.is_online(other) {
        return;
    }
    let queued = async {
        if !membership.other_is_muted {
            notify::queue_message_push(
                &state.db,
                membership.other_user_id,
                membership.connection_id,
            )
            .await?;
        }
        notify::queue_unread_email(&state.db, membership.other_user_id).await
    };
    match queued.await {
        Ok(_) => state.jobs.wake(),
        Err(error) => tracing::warn!(%error, "could not queue the chat push or email"),
    }
}

/// The automatic report of 13 section 5.5, in the transaction of a `money` message.
async fn money_report(conn: &mut sqlx::PgConnection, sender: Uuid) -> ApiResult<()> {
    db::lock_money_check(&mut *conn, sender).await?;
    let counts = db::money_counts(&mut *conn, sender).await?;
    let recent = db::recent_money_report(&mut *conn, sender).await?;
    if !chat_safety::money_report_due(counts, recent) {
        return Ok(());
    }
    let limit = i64::try_from(MONEY_REPORT_MAX_CONTEXT_MESSAGES).unwrap_or(i64::MAX);
    let flagged = db::flagged_messages(&mut *conn, sender, limit).await?;
    let report = chat_safety::money_report(counts, &flagged);
    let report_id = db::insert_system_report(&mut *conn, sender, &report).await?;
    tracing::info!(
        event = "report.filed",
        %report_id,
        reason = "asking_for_money",
        source = "system"
    );
    Ok(())
}

// -------------------------------------------------------------------------------------------
// Delete own message
// -------------------------------------------------------------------------------------------

/// Remove one of the caller's own text messages, within 15 minutes of sending (`invalid_state`
/// with `details.status = 'delete_window_passed'` after). The body is cleared; both members see
/// "Message removed". A message that is already removed is returned as it is.
#[utoipa::path(
    delete,
    path = "/connections/{connection_id}/messages/{message_id}",
    tag = "connections",
    security(("bearer" = [])),
    params(
        ("connection_id" = Uuid, Path, description = "The connection"),
        ("message_id" = Uuid, Path, description = "The caller's message")
    ),
    responses(
        (status = 200, body = Message),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn delete_message(
    State(state): State<AppState>,
    account: Engage,
    ApiPath((connection_id, message_id)): ApiPath<(Uuid, Uuid)>,
) -> ApiResult<Json<Message>> {
    let me = account.profile_id;
    let mut tx = state.db.begin().await?;
    let membership = db::lock_membership(&mut tx, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let message = db::lock_own_text(&mut tx, connection_id, me, message_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if message.deleted_at.is_some() {
        return Ok(Json(render_message(&message, me)));
    }
    if membership.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    if OffsetDateTime::now_utc() - message.created_at > DELETE_WINDOW {
        return Err(ApiError::invalid_state("delete_window_passed"));
    }
    let removed = db::remove_text(&mut tx, connection_id, message_id).await?;
    tx.commit().await?;

    let event = ServerEvent::new(
        "message.deleted",
        json!({ "connection_id": connection_id, "message_id": message_id }),
    );
    for profile_id in [me, membership.other_id] {
        state.hub.send_to_profile(profile_id, &event);
    }
    Ok(Json(render_message(&removed, me)))
}

// -------------------------------------------------------------------------------------------
// Read
// -------------------------------------------------------------------------------------------

/// Mark messages as read up to a message of this connection. The stored pointer never moves
/// backwards, and `unread_count` is recomputed from the data. `message.read` reaches the other
/// member only when both members send read receipts (09 section 9).
#[utoipa::path(
    post,
    path = "/connections/{connection_id}/read",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    request_body = ReadBody,
    responses(
        (status = 204, description = "Marked"),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn mark_read(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(connection_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ReadBody>,
) -> ApiResult<StatusCode> {
    let me = account.profile_id;
    let membership = member_of(&state, me, connection_id).await?;
    db::message(&state.db, connection_id, body.up_to_message_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let other = membership.other_id;
    let read = db::mark_read(&state.db, connection_id, me, other, body.up_to_message_id).await?;

    if read.moved {
        let event = |reader: &str| {
            ServerEvent::new(
                "message.read",
                json!({
                    "connection_id": connection_id,
                    "reader": reader,
                    "up_to_message_id": read.last_read_message_id,
                }),
            )
        };
        state.hub.send_to_profile(me, &event("me"));
        if state.hub.is_online(other) {
            let receipts = db::read_receipts(&state.db, me, other).await?;
            let shared = visibility::read_receipts_shared(
                &Privacy {
                    send_read_receipts: receipts.0,
                    ..Privacy::default()
                },
                &Privacy {
                    send_read_receipts: receipts.1,
                    ..Privacy::default()
                },
            );
            if shared {
                state.hub.send_to_profile(other, &event("them"));
            }
        }
    }
    counters::push(&state, me).await;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_minute_window_allows_the_limit_then_refuses() {
        let sender = Uuid::now_v7();
        let start = Instant::now();
        for _ in 0..3 {
            assert!(per_minute(sender, 3, start).is_ok());
        }
        let wait = per_minute(sender, 3, start).unwrap_err();
        assert!((59..=60).contains(&wait), "{wait}");
        assert!(
            per_minute(Uuid::now_v7(), 3, start).is_ok(),
            "senders are independent"
        );
        assert!(
            per_minute(sender, 3, start + MINUTE).is_ok(),
            "the window moves on"
        );
    }

    #[test]
    fn bodies_and_client_ids_are_checked() {
        assert_eq!(checked_body("  salaam \n").unwrap(), "salaam");
        assert!(checked_body("   ").is_err());
        assert!(checked_body(&"a".repeat(2000)).is_ok());
        assert!(checked_body(&"a".repeat(2001)).is_err());
        let id = Uuid::now_v7();
        assert_eq!(
            client_id(&id.to_string().to_uppercase()).unwrap(),
            id.to_string()
        );
        assert!(client_id("not-a-uuid").is_err());
    }
}
