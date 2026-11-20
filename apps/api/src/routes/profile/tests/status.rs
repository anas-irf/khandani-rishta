//! `pause`, `resume`, `close` and `reopen` (15 section 7, 03 section 4.2).

use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::domain::types::ProfileStatus;
use crate::lifecycle::ordered_pair;
use crate::test_support::{TestApp, TestResponse, TestUser};

async fn act(app: &TestApp, user: &TestUser, action: &str) -> TestResponse {
    app.post_empty(&format!("/v1/me/profile/{action}"), Some(&user.token))
        .await
}

async fn close(app: &TestApp, user: &TestUser, reason: &str) -> TestResponse {
    app.post(
        "/v1/me/profile/close",
        Some(&user.token),
        json!({ "reason": reason }),
    )
    .await
}

async fn reopen(app: &TestApp, user: &TestUser) -> TestResponse {
    app.post(
        "/v1/me/profile/reopen",
        Some(&user.token),
        json!({ "confirm": true }),
    )
    .await
}

async fn status_of(app: &TestApp, user: &TestUser) -> String {
    sqlx::query_scalar("SELECT status FROM profiles WHERE id = $1")
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

async fn interest(app: &TestApp, sender: &TestUser, receiver: &TestUser, status: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO interests (sender_profile_id, receiver_profile_id, status, expires_at)
         VALUES ($1, $2, $3, now() + interval '21 days') RETURNING id",
    )
    .bind(sender.profile_id)
    .bind(receiver.profile_id)
    .bind(status)
    .fetch_one(app.db())
    .await
    .unwrap()
}

async fn interest_status(app: &TestApp, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM interests WHERE id = $1")
        .bind(id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

/// An active connection between two members at the given stage.
async fn connection(app: &TestApp, a: &TestUser, b: &TestUser, stage: &str) -> Uuid {
    let accepted = interest(app, a, b, "accepted").await;
    let (low, high) = ordered_pair(a.profile_id, b.profile_id);
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO connections (profile_low_id, profile_high_id, interest_id, stage)
         VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(low)
    .bind(high)
    .bind(accepted)
    .bind(stage)
    .fetch_one(app.db())
    .await
    .unwrap();
    for profile in [low, high] {
        sqlx::query("INSERT INTO connection_members (connection_id, profile_id) VALUES ($1, $2)")
            .bind(id)
            .bind(profile)
            .execute(app.db())
            .await
            .unwrap();
    }
    id
}

#[sqlx::test]
async fn pausing_and_resuming(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member_of(Gender::Female).await;
    let pending = interest(&app, &user, &other, "pending").await;

    let response = act(&app, &user, "pause").await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["profile"]["status"], "paused");
    assert_eq!(response.json["gate"], "ok");
    let paused_at: Option<time::OffsetDateTime> =
        sqlx::query_scalar("SELECT paused_at FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(paused_at.is_some());
    // Pending interests are kept (03 section 4.2).
    assert_eq!(interest_status(&app, pending).await, "pending");
    assert_eq!(
        app.get("/v1/me", Some(&user.token)).await.json["profile"]["status"],
        "paused"
    );

    // Only an active profile can be paused.
    let again = act(&app, &user, "pause").await;
    assert_eq!(again.status, 409);
    assert_eq!(again.code(), "invalid_state");
    assert_eq!(again.json["error"]["details"]["status"], "paused");

    sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    let response = act(&app, &user, "resume").await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["profile"]["status"], "active");
    let (paused_at, stale): (Option<time::OffsetDateTime>, bool) =
        sqlx::query_as("SELECT paused_at, match_stale FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(paused_at.is_none());
    assert!(
        stale,
        "a returning member needs fresh recommendations (10 section 8.2)"
    );

    let again = act(&app, &user, "resume").await;
    assert_eq!(again.code(), "invalid_state");
    assert_eq!(again.json["error"]["details"]["status"], "active");
}

#[sqlx::test]
async fn closing_expires_the_pending_interests_and_keeps_the_connections(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let first = app.member_of(Gender::Female).await;
    let second = app.member_of(Gender::Female).await;
    let third = app.member_of(Gender::Female).await;
    let sent = interest(&app, &user, &first, "pending").await;
    let received = interest(&app, &second, &user, "pending").await;
    let unrelated = interest(&app, &first, &second, "pending").await;
    let declined = interest(&app, &third, &user, "declined").await;
    let chat = connection(&app, &user, &third, "chatting").await;

    let response = close(&app, &user, "found_match_elsewhere").await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["profile"]["status"], "closed");
    assert_eq!(response.json["gate"], "ok");

    let (reason, closed_at): (Option<String>, Option<time::OffsetDateTime>) =
        sqlx::query_as("SELECT closed_reason, closed_at FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(reason.as_deref(), Some("found_match_elsewhere"));
    assert!(closed_at.is_some());

    assert_eq!(interest_status(&app, sent).await, "expired");
    assert_eq!(interest_status(&app, received).await, "expired");
    assert_eq!(interest_status(&app, unrelated).await, "pending");
    assert_eq!(interest_status(&app, declined).await, "declined");
    // The expiry starts the cooldown from now (03 section 4.7).
    let expires_at: time::OffsetDateTime =
        sqlx::query_scalar("SELECT expires_at FROM interests WHERE id = $1")
            .bind(sent)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(expires_at <= time::OffsetDateTime::now_utc());
    let connection_status: String =
        sqlx::query_scalar("SELECT status FROM connections WHERE id = $1")
            .bind(chat)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(connection_status, "active");

    let again = close(&app, &user, "other").await;
    assert_eq!(again.code(), "invalid_state");
    assert_eq!(again.json["error"]["details"]["status"], "closed");
    assert_eq!(act(&app, &user, "pause").await.code(), "invalid_state");
    assert_eq!(act(&app, &user, "resume").await.code(), "invalid_state");
}

#[sqlx::test]
async fn a_paused_profile_can_be_closed_and_every_reason_is_accepted(db: PgPool) {
    let app = TestApp::new(db).await;
    for reason in [
        "found_match_here",
        "found_match_elsewhere",
        "taking_a_break",
        "other",
    ] {
        let user = app.member().await;
        assert_eq!(act(&app, &user, "pause").await.status, 200);
        let response = close(&app, &user, reason).await;
        assert_eq!(response.status, 200, "{reason}: {}", response.text);
        assert_eq!(status_of(&app, &user).await, "closed");
        let stored: String = sqlx::query_scalar("SELECT closed_reason FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(stored, reason);
    }

    let user = app.member().await;
    assert_eq!(close(&app, &user, "bored").await.code(), "bad_request");
    let missing = app
        .post("/v1/me/profile/close", Some(&user.token), json!({}))
        .await;
    assert_eq!(missing.code(), "bad_request");
    let extra = app
        .post(
            "/v1/me/profile/close",
            Some(&user.token),
            json!({ "reason": "other", "note": "x" }),
        )
        .await;
    assert_eq!(extra.code(), "bad_request");
    assert_eq!(status_of(&app, &user).await, "active");
}

#[sqlx::test]
async fn reopening_makes_the_profile_active_again(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member_of(Gender::Female).await;
    let sent = interest(&app, &user, &other, "pending").await;
    assert_eq!(close(&app, &user, "taking_a_break").await.status, 200);
    sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    // The body must confirm.
    let response = app
        .post(
            "/v1/me/profile/reopen",
            Some(&user.token),
            json!({ "confirm": false }),
        )
        .await;
    assert_eq!(response.status, 400);
    assert_eq!(response.field_errors(), ["confirm:required"]);
    assert_eq!(
        app.post_empty("/v1/me/profile/reopen", Some(&user.token))
            .await
            .code(),
        "bad_request"
    );
    assert_eq!(status_of(&app, &user).await, "closed");

    let response = reopen(&app, &user).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["profile"]["status"], "active");
    let (reason, closed_at, stale): (Option<String>, Option<time::OffsetDateTime>, bool) =
        sqlx::query_as("SELECT closed_reason, closed_at, match_stale FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(reason.is_none() && closed_at.is_none());
    assert!(stale);
    // The interests that closing expired stay expired.
    assert_eq!(interest_status(&app, sent).await, "expired");

    let again = reopen(&app, &user).await;
    assert_eq!(again.code(), "invalid_state");
    assert_eq!(again.json["error"]["details"]["status"], "active");
}

#[sqlx::test]
async fn reopening_after_a_nikah_ends_that_connection(db: PgPool) {
    let app = TestApp::new(db).await;
    let husband = app.member().await;
    let wife = app.member_of(Gender::Female).await;
    let acquaintance = app.member_of(Gender::Female).await;
    let nikah = connection(&app, &husband, &wife, "nikah_done").await;
    let other = connection(&app, &husband, &acquaintance, "chatting").await;
    for user in [&husband, &wife] {
        sqlx::query(
            "UPDATE profiles SET status = 'closed', closed_at = now(),
                    closed_reason = 'found_match_here' WHERE id = $1",
        )
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
        app.state.accounts.invalidate(user.user_id);
    }

    let response = reopen(&app, &husband).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["profile"]["status"], "active");

    let (status, reason, ended_by): (String, Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT status, ended_reason, ended_by_profile_id FROM connections WHERE id = $1",
    )
    .bind(nikah)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(status, "ended");
    assert_eq!(reason.as_deref(), Some("other"));
    assert_eq!(ended_by, Some(husband.profile_id));
    let notices: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM messages WHERE connection_id = $1 AND system_event = 'connection_ended'",
    )
    .bind(nikah)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(notices, 1);

    // Nothing else changes: the other connection and the wife's closed profile.
    let other_status: String = sqlx::query_scalar("SELECT status FROM connections WHERE id = $1")
        .bind(other)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(other_status, "active");
    assert_eq!(status_of(&app, &wife).await, "closed");
}

#[sqlx::test]
async fn the_status_endpoints_need_a_connected_member(db: PgPool) {
    let app = TestApp::new(db).await;
    let body = json!({ "reason": "other" });
    for action in ["pause", "resume", "close", "reopen"] {
        let path = format!("/v1/me/profile/{action}");
        assert_eq!(
            app.post(&path, None, body.clone()).await.code(),
            "unauthenticated",
            "{action}"
        );
    }

    // A draft has no status to change yet.
    let draft = app.draft_user().await;
    assert_eq!(
        act(&app, &draft, "pause").await.code(),
        "onboarding_required"
    );
    assert_eq!(
        close(&app, &draft, "other").await.code(),
        "onboarding_required"
    );

    // A profile in review is not live.
    for status in [
        ProfileStatus::PendingReview,
        ProfileStatus::ChangesRequested,
    ] {
        let user = app.member_with(|spec| spec.status = status).await;
        let response = act(&app, &user, "pause").await;
        assert_eq!(response.code(), "profile_not_active", "{status}");
        assert_eq!(
            response.json["error"]["details"]["status"],
            json!(status.as_str())
        );
    }

    // Consent comes before the status.
    let unconsented = app.member_with(|spec| spec.consents = false).await;
    assert_eq!(
        act(&app, &unconsented, "pause").await.code(),
        "consent_required"
    );

    let suspended = app
        .member_with(|spec| spec.status = ProfileStatus::Suspended)
        .await;
    assert_eq!(
        act(&app, &suspended, "pause").await.code(),
        "account_suspended"
    );
}

#[sqlx::test]
async fn a_status_change_only_touches_the_caller(db: PgPool) {
    let app = TestApp::new(db).await;
    let first = app.member().await;
    let second = app.member_of(Gender::Female).await;
    assert_eq!(act(&app, &first, "pause").await.status, 200);
    assert_eq!(status_of(&app, &first).await, "paused");
    assert_eq!(status_of(&app, &second).await, "active");
    let me: Value = app.get("/v1/me", Some(&second.token)).await.json;
    assert_eq!(me["profile"]["status"], "active");
}
