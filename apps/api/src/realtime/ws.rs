//! The WebSocket session loop (19 sections 4 and 5).
//!
//! The socket delivers events to an open app; it never accepts product actions. A client
//! authenticates with its first frame, then pings every 30 seconds. Everything a client sends
//! besides `auth`, `ping` and `typing` is a protocol error.

use std::collections::VecDeque;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::time::{Instant, sleep, sleep_until, timeout};
use uuid::Uuid;

use crate::auth::account::AccountSnapshot;
use crate::auth::provisioning::resolve_account;
use crate::auth::token::verify;
use crate::db::counters;
use crate::domain::types::{ProfileStatus, UserStatus};
use crate::realtime::hub::{Realtime, ServerEvent, close_code};
use crate::state::AppState;

/// The client must authenticate within this time (19 section 4.2 rule 1).
pub const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
/// Interval the client pings at, announced in `ready`.
pub const HEARTBEAT_SECONDS: u64 = 30;
/// No frame for this long closes the socket with 4408 (19 section 4.3).
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(75);
/// Sockets are closed after this age with 4440 (19 section 4.2 rule 3).
pub const MAX_AGE: Duration = Duration::from_hours(6);
/// Largest client frame; larger closes with 1009 (19 section 4.4).
pub const MAX_CLIENT_FRAME: usize = 4 * 1024;
/// Client frames allowed per window before 4429.
const FRAME_LIMIT: usize = 30;
const FRAME_WINDOW: Duration = Duration::from_secs(10);
/// Malformed or unknown frames tolerated per connection before 4400.
const MAX_BAD_FRAMES: u32 = 3;
/// Delay before announcing that a profile went offline (19 section 5 rule 2).
pub const OFFLINE_DELAY: Duration = Duration::from_secs(30);
/// Minimum time between relayed `typing` frames of one socket.
const TYPING_INTERVAL: Duration = Duration::from_secs(3);

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientFrame {
    Auth { token: String },
    Ping,
    Typing { connection_id: Uuid },
}

/// What arrived from the client.
enum Inbound {
    Frame(ClientFrame),
    Bad,
    TooLarge,
    Binary,
    Closed,
    Ignore,
}

fn parse(message: Option<Result<Message, axum::Error>>) -> Inbound {
    match message {
        None | Some(Err(_) | Ok(Message::Close(_))) => Inbound::Closed,
        Some(Ok(Message::Text(text))) => {
            if text.len() > MAX_CLIENT_FRAME {
                Inbound::TooLarge
            } else {
                serde_json::from_str(text.as_str()).map_or(Inbound::Bad, Inbound::Frame)
            }
        }
        Some(Ok(Message::Binary(_))) => Inbound::Binary,
        Some(Ok(Message::Ping(_) | Message::Pong(_))) => Inbound::Ignore,
    }
}

fn close_message(code: u16) -> Message {
    Message::Close(Some(CloseFrame {
        code,
        reason: Utf8Bytes::from_static(""),
    }))
}

/// Runs one socket from the upgrade to its close.
#[expect(
    clippy::too_many_lines,
    reason = "one select loop over every frame kind of 19 section 4, easier to follow in one place"
)]
pub async fn run(state: AppState, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();

    // Authentication: the first frame, within 10 seconds.
    let token = match timeout(AUTH_TIMEOUT, stream.next()).await {
        Ok(message) => match parse(message) {
            Inbound::Frame(ClientFrame::Auth { token }) => token,
            Inbound::Closed => return,
            Inbound::TooLarge => {
                let _ = sink.send(close_message(close_code::TOO_LARGE)).await;
                return;
            }
            _ => {
                let _ = sink.send(close_message(close_code::UNAUTHENTICATED)).await;
                return;
            }
        },
        Err(_elapsed) => {
            let _ = sink.send(close_message(close_code::UNAUTHENTICATED)).await;
            return;
        }
    };
    let account = match authenticate(&state, &token).await {
        Ok(account) => account,
        Err(code) => {
            let _ = sink.send(close_message(code)).await;
            return;
        }
    };

    let mut registration = state.hub.register(account.profile_id, account.user_id);
    let socket_id = registration.socket_id;
    state
        .activity
        .touch(&state.db, account.user_id, account.profile_id);

    let counters = counters::load(&state.db, account.profile_id, account.user_id)
        .await
        .unwrap_or_default();
    let ready = ServerEvent::new(
        "ready",
        json!({
            "profile_id": account.profile_id,
            "server_time": OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            "heartbeat_seconds": HEARTBEAT_SECONDS,
            "counters": counters,
        }),
    );
    let ready = serde_json::to_string(&ready).unwrap_or_default();
    if sink.send(Message::Text(ready.into())).await.is_err() {
        finish(&state, &account, socket_id);
        return;
    }
    if registration.first_for_profile {
        announce_presence(&state, account.profile_id, true).await;
    }

    let closer = registration.closer.clone();
    let opened_at = Instant::now();
    let mut idle_deadline = Instant::now() + IDLE_TIMEOUT;
    let mut recent_frames: VecDeque<Instant> = VecDeque::with_capacity(FRAME_LIMIT + 1);
    let mut bad_frames = 0_u32;
    let mut last_typing: Option<Instant> = None;

    let close_with = loop {
        tokio::select! {
            outbound = registration.receiver.recv() => {
                let Some(text) = outbound else { break None };
                if sink.send(Message::Text(text.into())).await.is_err() {
                    break None;
                }
            }
            code = closer.closed() => break Some(code),
            () = sleep_until(idle_deadline) => break Some(close_code::HEARTBEAT_TIMEOUT),
            () = sleep_until(opened_at + MAX_AGE) => break Some(close_code::MAX_AGE),
            message = stream.next() => {
                let now = Instant::now();
                idle_deadline = now + IDLE_TIMEOUT;
                recent_frames.push_back(now);
                while recent_frames
                    .front()
                    .is_some_and(|at| now.duration_since(*at) > FRAME_WINDOW)
                {
                    recent_frames.pop_front();
                }
                if recent_frames.len() > FRAME_LIMIT {
                    break Some(close_code::TOO_MANY_FRAMES);
                }
                match parse(message) {
                    Inbound::Closed => break None,
                    Inbound::TooLarge => break Some(close_code::TOO_LARGE),
                    Inbound::Binary => break Some(close_code::BAD_FRAMES),
                    // A second `auth` on the same socket is ignored (19 section 4.5).
                    Inbound::Ignore | Inbound::Frame(ClientFrame::Auth { .. }) => {}
                    Inbound::Bad => {
                        bad_frames += 1;
                        if bad_frames >= MAX_BAD_FRAMES {
                            break Some(close_code::BAD_FRAMES);
                        }
                    }
                    Inbound::Frame(ClientFrame::Ping) => {
                        state.activity.touch(&state.db, account.user_id, account.profile_id);
                        let pong = serde_json::to_string(&ServerEvent::new("pong", Value::Null))
                            .unwrap_or_default();
                        if sink.send(Message::Text(pong.into())).await.is_err() {
                            break None;
                        }
                    }
                    Inbound::Frame(ClientFrame::Typing { connection_id }) => {
                        if last_typing.is_none_or(|at| now.duration_since(at) >= TYPING_INTERVAL) {
                            last_typing = Some(now);
                            relay_typing(&state, account.profile_id, connection_id).await;
                        }
                    }
                }
            }
        }
    };
    if let Some(code) = close_with {
        let _ = sink.send(close_message(code)).await;
    }
    let _ = sink.close().await;
    finish(&state, &account, socket_id);
}

/// Verifies the token like a REST bearer token and requires access level `open`. Returns the
/// close code on refusal: 4401 for a bad token, 4403 when the account may not connect.
async fn authenticate(state: &AppState, token: &str) -> Result<AccountSnapshot, u16> {
    let claims = verify(token, &state.jwks, &state.config.clerk)
        .await
        .map_err(|reason| {
            tracing::debug!(%reason, "socket token refused");
            close_code::UNAUTHENTICATED
        })?;
    let account = resolve_account(state, &claims.sub)
        .await
        .map_err(|_| close_code::UNAUTHENTICATED)?;
    if account.user_status != UserStatus::Active
        || account.profile_status == ProfileStatus::Suspended
    {
        return Err(close_code::NOT_ALLOWED);
    }
    Ok((*account).clone())
}

/// Removes the socket and, when it was the profile's last, announces offline after 30 seconds
/// unless a new socket appeared meanwhile.
fn finish(state: &AppState, account: &AccountSnapshot, socket_id: Uuid) {
    if !state.hub.unregister(account.profile_id, socket_id) {
        return;
    }
    let state = state.clone();
    let profile_id = account.profile_id;
    tokio::spawn(async move {
        sleep(OFFLINE_DELAY).await;
        if !state.hub.is_online(profile_id) {
            announce_presence(&state, profile_id, false).await;
        }
    });
}

/// The members of a profile's active connections who may see its presence: both sides have
/// `show_online_status` (19 section 5).
async fn presence_audience(db: &PgPool, profile_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT other.profile_id
         FROM connections c
         CROSS JOIN LATERAL (
             SELECT CASE WHEN c.profile_low_id = $1 THEN c.profile_high_id ELSE c.profile_low_id END
                 AS profile_id
         ) other
         JOIN profile_privacy mine ON mine.profile_id = $1
         JOIN profile_privacy theirs ON theirs.profile_id = other.profile_id
         WHERE c.status = 'active' AND (c.profile_low_id = $1 OR c.profile_high_id = $1)
           AND mine.show_online_status AND theirs.show_online_status",
    )
    .bind(profile_id)
    .fetch_all(db)
    .await
}

async fn announce_presence(state: &AppState, profile_id: Uuid, is_online: bool) {
    match presence_audience(&state.db, profile_id).await {
        Ok(audience) => {
            let event = ServerEvent::new(
                "presence",
                json!({ "profile_id": profile_id, "is_online": is_online }),
            );
            for other in audience {
                if state.hub.is_online(other) {
                    state.hub.send_to_profile(other, &event);
                }
            }
        }
        Err(error) => tracing::warn!(%error, "could not load the presence audience"),
    }
}

/// Relays `typing` to the other member when the sender belongs to that active connection.
async fn relay_typing(state: &AppState, sender: Uuid, connection_id: Uuid) {
    let other: Option<Uuid> = sqlx::query_scalar(
        "SELECT CASE WHEN profile_low_id = $2 THEN profile_high_id ELSE profile_low_id END
         FROM connections
         WHERE id = $1 AND status = 'active' AND (profile_low_id = $2 OR profile_high_id = $2)",
    )
    .bind(connection_id)
    .bind(sender)
    .fetch_optional(&state.db)
    .await
    .unwrap_or_else(|error| {
        tracing::debug!(%error, "typing lookup failed");
        None
    });
    if let Some(other) = other {
        state.hub.send_to_profile(
            other,
            &ServerEvent::new("typing", json!({ "connection_id": connection_id })),
        );
    }
}

#[cfg(test)]
mod tests {
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use tokio_tungstenite::tungstenite::Message as WsMessage;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use uuid::Uuid;

    use crate::domain::options::Gender;
    use crate::domain::types::UserStatus;
    use crate::lifecycle::ordered_pair;
    use crate::realtime::hub::close_code;
    use crate::test_support::{TestApp, TestUser};

    type Client = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    async fn connect(address: std::net::SocketAddr) -> Client {
        let (client, _) = tokio_tungstenite::connect_async(format!("ws://{address}/v1/ws"))
            .await
            .expect("the upgrade succeeds");
        client
    }

    async fn next_json(client: &mut Client) -> Value {
        loop {
            match client
                .next()
                .await
                .expect("a frame")
                .expect("a valid frame")
            {
                WsMessage::Text(text) => return serde_json::from_str(text.as_str()).unwrap(),
                WsMessage::Ping(_) | WsMessage::Pong(_) => {}
                other => panic!("unexpected frame {other:?}"),
            }
        }
    }

    async fn close_code_of(client: &mut Client) -> u16 {
        loop {
            match client.next().await {
                Some(Ok(WsMessage::Close(Some(frame)))) => return u16::from(frame.code),
                Some(Ok(_)) => {}
                other => panic!("expected a close frame, got {other:?}"),
            }
        }
    }

    async fn authenticated(address: std::net::SocketAddr, user: &TestUser) -> Client {
        let mut client = connect(address).await;
        let auth = json!({ "type": "auth", "token": user.token }).to_string();
        client.send(WsMessage::text(auth)).await.unwrap();
        let ready = next_json(&mut client).await;
        assert_eq!(ready["type"], "ready");
        assert_eq!(ready["data"]["profile_id"], user.profile_id.to_string());
        assert_eq!(ready["data"]["heartbeat_seconds"], 30);
        assert!(ready["data"]["counters"]["unread_chats"].is_number());
        client
    }

    #[sqlx::test]
    async fn authenticates_with_the_first_frame_and_answers_pings(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let address = app.serve().await;
        let mut client = authenticated(address, &user).await;
        assert_eq!(app.state.hub.socket_count(user.profile_id), 1);

        client
            .send(WsMessage::text(r#"{"type":"ping"}"#))
            .await
            .unwrap();
        assert_eq!(next_json(&mut client).await, json!({ "type": "pong" }));
    }

    #[sqlx::test]
    async fn a_bad_first_frame_or_token_closes_with_4401(db: PgPool) {
        let app = TestApp::new(db).await;
        let address = app.serve().await;

        let mut client = connect(address).await;
        client
            .send(WsMessage::text(r#"{"type":"ping"}"#))
            .await
            .unwrap();
        assert_eq!(
            close_code_of(&mut client).await,
            close_code::UNAUTHENTICATED
        );

        let mut client = connect(address).await;
        let auth = r#"{"type":"auth","token":"nonsense"}"#;
        client.send(WsMessage::text(auth)).await.unwrap();
        assert_eq!(
            close_code_of(&mut client).await,
            close_code::UNAUTHENTICATED
        );
    }

    #[sqlx::test]
    async fn a_socket_that_never_authenticates_is_closed_after_ten_seconds(db: PgPool) {
        let app = TestApp::new(db).await;
        let address = app.serve().await;
        let mut client = connect(address).await;
        let started = std::time::Instant::now();
        assert_eq!(
            close_code_of(&mut client).await,
            close_code::UNAUTHENTICATED
        );
        assert!(started.elapsed() >= std::time::Duration::from_secs(9));
    }

    #[sqlx::test]
    async fn blocked_accounts_may_not_connect(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app
            .member_with(|spec| spec.user_status = UserStatus::Suspended)
            .await;
        let address = app.serve().await;
        let mut client = connect(address).await;
        let auth = json!({ "type": "auth", "token": user.token }).to_string();
        client.send(WsMessage::text(auth)).await.unwrap();
        assert_eq!(close_code_of(&mut client).await, close_code::NOT_ALLOWED);
    }

    #[sqlx::test]
    async fn bad_binary_and_oversized_frames_close_the_socket(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let address = app.serve().await;

        let mut client = authenticated(address, &user).await;
        for _ in 0..3 {
            client.send(WsMessage::text("{not json")).await.unwrap();
        }
        assert_eq!(close_code_of(&mut client).await, close_code::BAD_FRAMES);

        let mut client = authenticated(address, &user).await;
        client.send(WsMessage::binary(vec![1, 2, 3])).await.unwrap();
        assert_eq!(close_code_of(&mut client).await, close_code::BAD_FRAMES);

        let mut client = authenticated(address, &user).await;
        let big = json!({ "type": "ping", "padding": "x".repeat(5000) }).to_string();
        client.send(WsMessage::text(big)).await.unwrap();
        assert_eq!(close_code_of(&mut client).await, close_code::TOO_LARGE);
    }

    #[sqlx::test]
    async fn presence_and_typing_flow_only_inside_an_active_connection(db: PgPool) {
        let app = TestApp::new(db).await;
        let man = app.member().await;
        let woman = app.member_of(Gender::Female).await;
        let (low, high) = ordered_pair(man.profile_id, woman.profile_id);
        let interest_id: Uuid = sqlx::query_scalar(
            "INSERT INTO interests (sender_profile_id, receiver_profile_id, status, expires_at)
             VALUES ($1, $2, 'accepted', now()) RETURNING id",
        )
        .bind(man.profile_id)
        .bind(woman.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        let connection_id: Uuid = sqlx::query_scalar(
            "INSERT INTO connections (profile_low_id, profile_high_id, interest_id)
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(low)
        .bind(high)
        .bind(interest_id)
        .fetch_one(app.db())
        .await
        .unwrap();

        let address = app.serve().await;
        let mut his = authenticated(address, &man).await;
        let mut hers = authenticated(address, &woman).await;
        // Her first socket announces presence to him: both show online status by default.
        let presence = next_json(&mut his).await;
        assert_eq!(presence["type"], "presence");
        assert_eq!(presence["data"]["is_online"], true);

        let typing = json!({ "type": "typing", "connection_id": connection_id }).to_string();
        his.send(WsMessage::text(typing)).await.unwrap();
        assert_eq!(
            next_json(&mut hers).await,
            json!({ "type": "typing", "data": { "connection_id": connection_id } })
        );

        // A connection the sender does not belong to is ignored without an error.
        let stranger = json!({ "type": "typing", "connection_id": Uuid::now_v7() }).to_string();
        his.send(WsMessage::text(stranger)).await.unwrap();
        his.send(WsMessage::text(r#"{"type":"ping"}"#))
            .await
            .unwrap();
        assert_eq!(next_json(&mut his).await["type"], "pong");
    }

    #[sqlx::test]
    async fn foreign_origins_are_refused(db: PgPool) {
        let app = TestApp::new(db).await;
        let address = app.serve().await;
        let url = format!("ws://{address}/v1/ws");

        let mut foreign = url.clone().into_client_request().unwrap();
        foreign
            .headers_mut()
            .insert("origin", "https://evil.example".parse().unwrap());
        assert!(tokio_tungstenite::connect_async(foreign).await.is_err());

        let mut allowed = url.into_client_request().unwrap();
        allowed
            .headers_mut()
            .insert("origin", "http://localhost:3000".parse().unwrap());
        assert!(tokio_tungstenite::connect_async(allowed).await.is_ok());
    }
}
