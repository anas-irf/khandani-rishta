//! Tests of the notification system: the event catalogue of 14 section 2 row by row, the
//! delivery rules of 14 section 7, the endpoints of 15 sections 6 and 14, and the push and
//! email jobs of 19 sections 2.6, 2.7, 2.15 and 2.17.
//!
//! Where the feature that triggers an event is not built yet, the situation is created with SQL
//! and `notify` is called directly, as the feature will call it after its transaction commits.

mod api;
mod email_jobs;
mod events;
mod push_jobs;
mod rules;

use serde_json::Value;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::lifecycle::ordered_pair;
use crate::test_support::{TestApp, TestUser};

/// A man and a woman, both active, who may open each other.
pub(super) struct World {
    pub app: TestApp,
    /// Ahmed Khan.
    pub him: TestUser,
    /// Ayesha Malik.
    pub her: TestUser,
}

impl World {
    pub async fn new(db: sqlx::PgPool) -> Self {
        let app = TestApp::new(db).await;
        let him = app.member().await;
        let her = app.member_of(Gender::Female).await;
        Self { app, him, her }
    }
}

/// A pending interest from `from` to `to`.
pub(super) async fn add_interest(app: &TestApp, from: &TestUser, to: &TestUser) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO interests (id, sender_profile_id, receiver_profile_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '21 days')",
    )
    .bind(id)
    .bind(from.profile_id)
    .bind(to.profile_id)
    .execute(app.db())
    .await
    .expect("the interest inserts");
    id
}

/// An accepted interest from `sender` and the active connection it created. Returns the
/// interest id and the connection id.
pub(super) async fn connect(app: &TestApp, sender: &TestUser, receiver: &TestUser) -> (Uuid, Uuid) {
    let interest_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO interests (id, sender_profile_id, receiver_profile_id, status, responded_at, expires_at)
         VALUES ($1, $2, $3, 'accepted', now(), now() + interval '21 days')",
    )
    .bind(interest_id)
    .bind(sender.profile_id)
    .bind(receiver.profile_id)
    .execute(app.db())
    .await
    .expect("the interest inserts");
    let connection_id = Uuid::now_v7();
    let (low, high) = ordered_pair(sender.profile_id, receiver.profile_id);
    sqlx::query(
        "INSERT INTO connections (id, profile_low_id, profile_high_id, interest_id)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(connection_id)
    .bind(low)
    .bind(high)
    .bind(interest_id)
    .execute(app.db())
    .await
    .expect("the connection inserts");
    for profile_id in [sender.profile_id, receiver.profile_id] {
        sqlx::query("INSERT INTO connection_members (connection_id, profile_id) VALUES ($1, $2)")
            .bind(connection_id)
            .bind(profile_id)
            .execute(app.db())
            .await
            .expect("the member row inserts");
    }
    (interest_id, connection_id)
}

/// `from` blocks `whom`.
pub(super) async fn block(app: &TestApp, from: &TestUser, whom: &TestUser) {
    sqlx::query("INSERT INTO blocks (blocker_profile_id, blocked_profile_id) VALUES ($1, $2)")
        .bind(from.profile_id)
        .bind(whom.profile_id)
        .execute(app.db())
        .await
        .expect("the block inserts");
}

/// The feed of a user, oldest first: `(type, data)`.
pub(super) async fn feed(app: &TestApp, user_id: Uuid) -> Vec<(String, Value)> {
    sqlx::query_as("SELECT type, data FROM notifications WHERE user_id = $1 ORDER BY id")
        .bind(user_id)
        .fetch_all(app.db())
        .await
        .expect("the feed reads")
}

/// Registers an Android device for a user.
pub(super) async fn add_device(app: &TestApp, user_id: Uuid, token: &str) {
    sqlx::query(
        "INSERT INTO user_devices (user_id, platform, push_token) VALUES ($1, 'android', $2)",
    )
    .bind(user_id)
    .bind(token)
    .execute(app.db())
    .await
    .expect("the device inserts");
}

/// Sets one boolean preference column of a user.
pub(super) async fn set_flag(app: &TestApp, user_id: Uuid, column: &'static str, value: bool) {
    assert!(
        column.starts_with("push_") || column.starts_with("email_"),
        "a preference column"
    );
    sqlx::query(
        "INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .execute(app.db())
    .await
    .expect("the row exists");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE notification_preferences SET {column} = $2 WHERE user_id = $1"
    )))
    .bind(user_id)
    .bind(value)
    .execute(app.db())
    .await
    .expect("the preference updates");
}

/// The `send_push` payloads queued for a user, oldest first.
pub(super) async fn pushes_for(app: &TestApp, user_id: Uuid) -> Vec<Value> {
    app.queued_jobs("send_push")
        .await
        .into_iter()
        .filter(|payload| payload["user_id"] == serde_json::json!(user_id))
        .collect()
}

/// The `send_email` payloads queued for a user, oldest first.
pub(super) async fn emails_for(app: &TestApp, user_id: Uuid) -> Vec<Value> {
    app.queued_jobs("send_email")
        .await
        .into_iter()
        .filter(|payload| payload["user_id"] == serde_json::json!(user_id))
        .collect()
}
