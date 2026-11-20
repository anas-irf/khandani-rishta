//! The in-process registry of open WebSockets and the only way code sends realtime events
//! (19 section 6).
//!
//! The registry lock is held only for short map operations, never across an `.await`, so every
//! method is a plain synchronous function. A slow client never delays others: a full channel
//! closes that one socket with 4413.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::{Notify, mpsc};
use uuid::Uuid;

/// Frames queued per socket before it counts as too slow (19 section 6.1).
pub const SOCKET_BUFFER: usize = 64;
/// Authenticated sockets per user; a fourth closes the oldest with 4409 (19 section 4.2).
pub const MAX_SOCKETS_PER_USER: usize = 3;

/// Close codes of 19 section 4.7.
pub mod close_code {
    pub const GOING_AWAY: u16 = 1001;
    pub const TOO_LARGE: u16 = 1009;
    pub const BAD_FRAMES: u16 = 4400;
    pub const UNAUTHENTICATED: u16 = 4401;
    pub const NOT_ALLOWED: u16 = 4403;
    pub const HEARTBEAT_TIMEOUT: u16 = 4408;
    pub const REPLACED: u16 = 4409;
    pub const TOO_SLOW: u16 = 4413;
    pub const TOO_MANY_FRAMES: u16 = 4429;
    pub const MAX_AGE: u16 = 4440;
}

/// A server-to-client frame: `{ "type": ..., "data": ... }` (19 section 4.4).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ServerEvent {
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Value::is_null")]
    pub data: Value,
}

impl ServerEvent {
    pub fn new(kind: &'static str, data: impl Serialize) -> Self {
        Self {
            kind,
            data: serde_json::to_value(data).unwrap_or(Value::Null),
        }
    }

    /// `gate.changed` (19 section 4.6).
    pub fn gate_changed(gate: crate::domain::types::Gate) -> Self {
        Self::new("gate.changed", serde_json::json!({ "gate": gate }))
    }
}

/// What the hub needs to deliver to one socket.
#[derive(Debug)]
pub struct SocketHandle {
    pub socket_id: Uuid,
    pub user_id: Uuid,
    pub connected_at: Instant,
    sender: mpsc::Sender<String>,
    close: Arc<SocketCloser>,
}

/// Lets the hub ask a socket's session loop to close with a code.
#[derive(Debug, Default)]
pub struct SocketCloser {
    code: AtomicU16,
    notify: Notify,
}

impl SocketCloser {
    pub fn close(&self, code: u16) {
        // The first close wins.
        let _ = self
            .code
            .compare_exchange(0, code, Ordering::SeqCst, Ordering::SeqCst);
        self.notify.notify_one();
    }

    /// Resolves with the close code once [`SocketCloser::close`] was called.
    pub async fn closed(&self) -> u16 {
        loop {
            let code = self.code.load(Ordering::SeqCst);
            if code != 0 {
                return code;
            }
            self.notify.notified().await;
        }
    }
}

/// Returned to the session loop when a socket registers.
pub struct Registration {
    pub socket_id: Uuid,
    /// Frames to write to the socket.
    pub receiver: mpsc::Receiver<String>,
    /// Resolves when the hub wants the socket closed.
    pub closer: Arc<SocketCloser>,
    /// True when this is the profile's only socket (presence goes online).
    pub first_for_profile: bool,
}

/// How the rest of the code sends realtime events (19 section 6.1). A second API instance would
/// implement this over a shared pub/sub.
pub trait Realtime: Send + Sync {
    /// Queues an event for every socket of a profile. Never blocks.
    fn send_to_profile(&self, profile_id: Uuid, event: &ServerEvent);
    /// True when the profile has at least one authenticated socket.
    fn is_online(&self, profile_id: Uuid) -> bool;
    /// Closes every socket of a user with the given close code.
    fn close_user(&self, user_id: Uuid, code: u16);
}

/// The launch implementation: one process, sockets in a map keyed by profile id.
#[derive(Default)]
pub struct LocalHub {
    sockets: RwLock<HashMap<Uuid, Vec<SocketHandle>>>,
}

impl LocalHub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds an authenticated socket. When the user then has more than three, the oldest is
    /// closed with 4409.
    pub fn register(&self, profile_id: Uuid, user_id: Uuid) -> Registration {
        let (sender, receiver) = mpsc::channel(SOCKET_BUFFER);
        let closer = Arc::new(SocketCloser::default());
        let socket_id = Uuid::now_v7();
        let mut first_for_profile = false;
        if let Ok(mut sockets) = self.sockets.write() {
            let list = sockets.entry(profile_id).or_default();
            first_for_profile = list.is_empty();
            list.push(SocketHandle {
                socket_id,
                user_id,
                connected_at: Instant::now(),
                sender,
                close: closer.clone(),
            });
            let of_user: Vec<usize> = list
                .iter()
                .enumerate()
                .filter(|(_, handle)| handle.user_id == user_id)
                .map(|(index, _)| index)
                .collect();
            if of_user.len() > MAX_SOCKETS_PER_USER
                && let Some(oldest) = of_user
                    .iter()
                    .copied()
                    .min_by_key(|index| list[*index].connected_at)
            {
                let evicted = list.remove(oldest);
                evicted.close.close(close_code::REPLACED);
            }
        }
        Registration {
            socket_id,
            receiver,
            closer,
            first_for_profile,
        }
    }

    /// Removes a socket. Returns true when it was the profile's last one.
    pub fn unregister(&self, profile_id: Uuid, socket_id: Uuid) -> bool {
        let Ok(mut sockets) = self.sockets.write() else {
            return false;
        };
        let Some(list) = sockets.get_mut(&profile_id) else {
            return false;
        };
        let before = list.len();
        list.retain(|handle| handle.socket_id != socket_id);
        let removed = list.len() < before;
        if list.is_empty() {
            sockets.remove(&profile_id);
            return removed;
        }
        false
    }

    /// Number of open sockets of a profile.
    pub fn socket_count(&self, profile_id: Uuid) -> usize {
        self.sockets
            .read()
            .map_or(0, |sockets| sockets.get(&profile_id).map_or(0, Vec::len))
    }

    /// Sends a frame to one socket only (for example `ready` or `pong`).
    pub fn send_to_socket(&self, profile_id: Uuid, socket_id: Uuid, event: &ServerEvent) {
        let Ok(text) = serde_json::to_string(event) else {
            return;
        };
        if let Ok(sockets) = self.sockets.read()
            && let Some(handle) = sockets
                .get(&profile_id)
                .and_then(|list| list.iter().find(|h| h.socket_id == socket_id))
            && handle.sender.try_send(text).is_err()
        {
            handle.close.close(close_code::TOO_SLOW);
        }
    }

    /// Closes every socket, for shutdown (1001).
    pub fn close_all(&self, code: u16) {
        if let Ok(sockets) = self.sockets.read() {
            for handle in sockets.values().flatten() {
                handle.close.close(code);
            }
        }
    }
}

impl Realtime for LocalHub {
    fn send_to_profile(&self, profile_id: Uuid, event: &ServerEvent) {
        let Ok(text) = serde_json::to_string(event) else {
            return;
        };
        if let Ok(sockets) = self.sockets.read()
            && let Some(list) = sockets.get(&profile_id)
        {
            for handle in list {
                if handle.sender.try_send(text.clone()).is_err() {
                    handle.close.close(close_code::TOO_SLOW);
                }
            }
        }
    }

    fn is_online(&self, profile_id: Uuid) -> bool {
        self.socket_count(profile_id) > 0
    }

    fn close_user(&self, user_id: Uuid, code: u16) {
        if let Ok(sockets) = self.sockets.read() {
            for handle in sockets.values().flatten() {
                if handle.user_id == user_id {
                    handle.close.close(code);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn delivers_to_every_socket_of_a_profile() {
        let hub = LocalHub::new();
        let (profile, user) = (Uuid::now_v7(), Uuid::now_v7());
        let mut first = hub.register(profile, user);
        let mut second = hub.register(profile, user);
        assert!(first.first_for_profile);
        assert!(!second.first_for_profile);
        assert!(hub.is_online(profile));

        hub.send_to_profile(
            profile,
            &ServerEvent::new("counters", json!({ "unread_chats": 1 })),
        );
        let frame = first.receiver.recv().await.unwrap();
        assert_eq!(frame, r#"{"type":"counters","data":{"unread_chats":1}}"#);
        assert_eq!(second.receiver.recv().await.unwrap(), frame);

        assert!(!hub.unregister(profile, first.socket_id));
        assert!(hub.unregister(profile, second.socket_id), "the last one");
        assert!(!hub.is_online(profile));
    }

    #[tokio::test]
    async fn a_fourth_socket_replaces_the_oldest() {
        let hub = LocalHub::new();
        let (profile, user) = (Uuid::now_v7(), Uuid::now_v7());
        let oldest = hub.register(profile, user);
        let _b = hub.register(profile, user);
        let _c = hub.register(profile, user);
        let _d = hub.register(profile, user);
        assert_eq!(oldest.closer.closed().await, close_code::REPLACED);
        assert_eq!(hub.socket_count(profile), 3);
    }

    #[tokio::test]
    async fn a_slow_socket_is_closed_without_blocking() {
        let hub = LocalHub::new();
        let (profile, user) = (Uuid::now_v7(), Uuid::now_v7());
        let slow = hub.register(profile, user);
        for _ in 0..=SOCKET_BUFFER {
            hub.send_to_profile(profile, &ServerEvent::new("typing", json!({})));
        }
        assert_eq!(slow.closer.closed().await, close_code::TOO_SLOW);
    }

    #[tokio::test]
    async fn closes_all_sockets_of_a_user() {
        let hub = LocalHub::new();
        let (profile, user) = (Uuid::now_v7(), Uuid::now_v7());
        let socket = hub.register(profile, user);
        hub.close_user(user, close_code::NOT_ALLOWED);
        assert_eq!(socket.closer.closed().await, close_code::NOT_ALLOWED);
    }

    #[test]
    fn events_serialise_like_the_protocol() {
        let pong = ServerEvent::new("pong", Value::Null);
        assert_eq!(serde_json::to_string(&pong).unwrap(), r#"{"type":"pong"}"#);
        let gate = ServerEvent::gate_changed(crate::domain::types::Gate::Banned);
        assert_eq!(
            serde_json::to_string(&gate).unwrap(),
            r#"{"type":"gate.changed","data":{"gate":"banned"}}"#
        );
    }
}
