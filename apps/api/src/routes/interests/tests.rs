//! Tests of interests (T-401): the check order of 15 section 11 one check at a time, mutual
//! interest, the quiet decline (a sender never receives `declined`), accept and its caps,
//! withdraw, seen, the lists, the access levels, and invariant 8 of 03 section 8.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::domain::types::ProfileStatus;
use crate::realtime::hub::Registration;
use crate::test_support::{TestApp, TestResponse, TestUser};
use crate::views::testing::{connect, exec, interest, set_privacy, set_profile};

async fn send(
    app: &TestApp,
    from: &TestUser,
    to: &TestUser,
    message: Option<&str>,
) -> TestResponse {
    let mut body = json!({ "receiver_profile_id": to.profile_id });
    if let Some(message) = message {
        body["message"] = json!(message);
    }
    app.post("/v1/interests", Some(&from.token), body).await
}

async fn act(app: &TestApp, user: &TestUser, interest_id: &Value, action: &str) -> TestResponse {
    let id = interest_id.as_str().unwrap();
    app.post_empty(&format!("/v1/interests/{id}/{action}"), Some(&user.token))
        .await
}

async fn scalar_i64(app: &TestApp, sql: &str, id: Uuid) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .bind(id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

async fn status_of(app: &TestApp, interest_id: &Value) -> String {
    let id: Uuid = interest_id.as_str().unwrap().parse().unwrap();
    sqlx::query_scalar("SELECT status FROM interests WHERE id = $1")
        .bind(id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

async fn setting(app: &TestApp, key: &str, value: Value) {
    app.state.settings.put(key, &value, None).await.unwrap();
}

/// Registers a fake socket for a member, to read the events sent to them.
fn listen(app: &TestApp, user: &TestUser) -> Registration {
    app.state.hub.register(user.profile_id, user.user_id)
}

fn events(socket: &mut Registration) -> Vec<Value> {
    let mut events = Vec::new();
    while let Ok(text) = socket.receiver.try_recv() {
        events.push(serde_json::from_str(&text).unwrap());
    }
    events
}

fn types(events: &[Value]) -> Vec<&str> {
    events.iter().filter_map(|e| e["type"].as_str()).collect()
}

#[sqlx::test]
async fn sending_creates_a_pending_interest_and_tells_the_receiver(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let mut her_socket = listen(&app, &woman);

    let sent = send(
        &app,
        &man,
        &woman,
        Some("Assalam-o-Alaikum. I liked your profile."),
    )
    .await;
    assert_eq!(sent.status, StatusCode::CREATED, "{}", sent.text);
    let interest = &sent.json["interest"];
    assert_eq!(sent.json["connection"], Value::Null);
    assert_eq!(interest["direction"], "sent");
    assert_eq!(interest["status"], "pending");
    assert_eq!(interest["display_status"], "pending");
    assert_eq!(
        interest["message"],
        "Assalam-o-Alaikum. I liked your profile."
    );
    assert!(interest["compat_score"].is_number(), "{interest}");
    assert_eq!(interest["seen"], false);
    assert_eq!(interest["responded_at"], Value::Null);
    assert_eq!(interest["profile"]["id"], json!(woman.profile_id));
    let created = OffsetDateTime::parse(
        interest["created_at"].as_str().unwrap(),
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    let expires = OffsetDateTime::parse(
        interest["expires_at"].as_str().unwrap(),
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    assert_eq!((expires - created).whole_days(), 21);

    // The daily counter, the notification, its push and the digest email.
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count::bigint FROM usage_counters WHERE profile_id = $1 AND counter = 'interests_sent'",
            man.profile_id
        )
        .await,
        1
    );
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM notifications WHERE user_id = $1 AND type = 'interest_received'",
            woman.user_id
        )
        .await,
        1
    );
    assert_eq!(app.queued_jobs("send_push").await.len(), 1);
    let emails = app.queued_jobs("send_email").await;
    assert_eq!(emails[0]["template"], "interest_digest");
    let seen = types(&events(&mut her_socket)).join(",");
    assert_eq!(seen, "interest.received,notification.new,counters");

    let received = app
        .get("/v1/interests?box=received", Some(&woman.token))
        .await;
    assert_eq!(received.status, StatusCode::OK, "{}", received.text);
    let item = &received.json["items"][0];
    assert_eq!(item["id"], interest["id"]);
    assert_eq!(item["direction"], "received");
    assert_eq!(item["profile"]["id"], json!(man.profile_id));
    assert_eq!(item["profile"]["relation"]["tier"], "interest_from_owner");
    let one = app
        .get(
            &format!("/v1/interests/{}", interest["id"].as_str().unwrap()),
            Some(&woman.token),
        )
        .await;
    assert_eq!(one.json["id"], interest["id"]);

    // Somebody else cannot read it.
    let stranger = app.member().await;
    let hidden = app
        .get(
            &format!("/v1/interests/{}", interest["id"].as_str().unwrap()),
            Some(&stranger.token),
        )
        .await;
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);
}

/// T-401: the nine checks of 15 section 11, one at a time. Every check fails at the start;
/// each step repairs the check that answered, and the next one answers.
#[sqlx::test]
async fn the_checks_run_in_order_one_at_a_time(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let third = app.member_of(Gender::Female).await;
    let fourth = app.member_of(Gender::Female).await;

    // 1: the receiver is paused (not openable for a new interest).
    set_profile(&app, woman.profile_id, "status = 'paused'").await;
    // 2: an active connection with her.
    let connection = connect(&app, man.profile_id, woman.profile_id).await;
    // 3: a pending interest from him to her.
    let pending = interest(&app, man.profile_id, woman.profile_id, "pending", 0).await;
    // 4: the cooldown is set up when check 3 is repaired (a recent withdrawal).
    // 5: she accepts interests only from verified members.
    set_privacy(
        &app,
        woman.profile_id,
        "interest_permission = 'verified_only'",
    )
    .await;
    // 6: one pending interest is the most he may have.
    setting(&app, "limits.pending_interests_max", json!(1)).await;
    interest(&app, man.profile_id, third.profile_id, "pending", 0).await;
    // 7: one active connection is the most he may have (another one besides hers).
    setting(&app, "limits.active_connections_max", json!(1)).await;
    let other_connection = connect(&app, man.profile_id, fourth.profile_id).await;
    // 8: today's interests are used up.
    setting(&app, "limits.interests_per_day", json!(1)).await;
    exec(
        &app,
        "INSERT INTO usage_counters (profile_id, counter, day, count)
         VALUES ($1, 'interests_sent', (now() AT TIME ZONE 'Asia/Karachi')::date, 1)",
        man.profile_id,
    )
    .await;
    // 9: the message carries a phone number.
    let bad_message = Some("Call me on 0300 1234567");

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(attempt.status, StatusCode::NOT_FOUND, "1: {}", attempt.text);
    set_profile(&app, woman.profile_id, "status = 'active'").await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(attempt.code(), "already_connected", "2: {}", attempt.text);
    assert_eq!(
        attempt.json["error"]["details"]["connection_id"],
        json!(connection)
    );
    exec(
        &app,
        "UPDATE connections SET status = 'ended', ended_reason = 'other',
             ended_at = now() - interval '100 days' WHERE id = $1",
        connection,
    )
    .await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(
        attempt.code(),
        "interest_already_pending",
        "3: {}",
        attempt.text
    );
    assert_eq!(
        attempt.json["error"]["details"]["interest_id"],
        json!(pending)
    );
    exec(
        &app,
        "UPDATE interests SET status = 'withdrawn', responded_at = now() - interval '1 day'
         WHERE id = $1",
        pending,
    )
    .await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(attempt.code(), "cooldown_active", "4: {}", attempt.text);
    assert!(attempt.json["error"]["details"]["retry_after_date"].is_string());
    exec(
        &app,
        "UPDATE interests SET responded_at = now() - interval '10 days' WHERE id = $1",
        pending,
    )
    .await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(
        attempt.code(),
        "not_permitted_by_member",
        "5: {}",
        attempt.text
    );
    assert_eq!(attempt.json["error"]["details"]["reason"], "verified_only");
    set_privacy(&app, woman.profile_id, "interest_permission = 'everyone'").await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(attempt.code(), "limit_reached", "6: {}", attempt.text);
    assert_eq!(
        attempt.json["error"]["details"]["limit"],
        "limits.pending_interests_max"
    );
    assert_eq!(attempt.json["error"]["details"]["resets_at"], Value::Null);
    exec(
        &app,
        "UPDATE interests SET status = 'withdrawn', responded_at = now() - interval '30 days'
         WHERE sender_profile_id = $1 AND status = 'pending'",
        man.profile_id,
    )
    .await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(attempt.code(), "limit_reached", "7: {}", attempt.text);
    assert_eq!(
        attempt.json["error"]["details"]["limit"],
        "limits.active_connections_max"
    );
    assert_eq!(attempt.json["error"]["details"]["side"], "you");
    exec(
        &app,
        "UPDATE connections SET status = 'ended', ended_reason = 'other', ended_at = now()
         WHERE id = $1",
        other_connection,
    )
    .await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(attempt.code(), "limit_reached", "8: {}", attempt.text);
    assert_eq!(
        attempt.json["error"]["details"]["limit"],
        "limits.interests_per_day"
    );
    assert!(attempt.json["error"]["details"]["resets_at"].is_string());
    exec(
        &app,
        "DELETE FROM usage_counters WHERE profile_id = $1",
        man.profile_id,
    )
    .await;

    let attempt = send(&app, &man, &woman, bad_message).await;
    assert_eq!(
        attempt.field_errors(),
        ["message:contains_contact_info"],
        "9"
    );
    let attempt = send(&app, &man, &woman, Some("hookup")).await;
    assert_eq!(attempt.field_errors(), ["message:inappropriate"], "9");

    let attempt = send(&app, &man, &woman, Some("Assalam-o-Alaikum")).await;
    assert_eq!(attempt.status, StatusCode::CREATED, "{}", attempt.text);
}

#[sqlx::test]
async fn a_mutual_interest_accepts_the_pending_one(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let first = send(&app, &woman, &man, Some("Assalam-o-Alaikum")).await;
    assert_eq!(first.status, StatusCode::CREATED);
    // Checks 5 and 8 do not apply to a mutual interest: his permission rule and her daily
    // limit would refuse a new interest.
    set_privacy(
        &app,
        man.profile_id,
        "interest_permission = 'verified_only'",
    )
    .await;
    setting(&app, "limits.interests_per_day", json!(1)).await;
    let mut her_socket = listen(&app, &woman);

    let mutual = send(&app, &man, &woman, Some("This message is ignored")).await;
    assert_eq!(mutual.status, StatusCode::CREATED, "{}", mutual.text);
    let interest = &mutual.json["interest"];
    assert_eq!(interest["id"], first.json["interest"]["id"]);
    assert_eq!(interest["direction"], "received");
    assert_eq!(interest["status"], "accepted");
    assert_eq!(interest["message"], "Assalam-o-Alaikum");
    let connection = &mutual.json["connection"];
    assert_eq!(connection["status"], "active");
    assert_eq!(connection["stage"], "chatting");
    assert_eq!(connection["other"]["id"], json!(woman.profile_id));
    assert_eq!(interest["connection_id"], connection["id"]);

    // No new row, and his counter did not move.
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM interests WHERE sender_profile_id = $1 OR receiver_profile_id = $1",
            man.profile_id
        )
        .await,
        1
    );
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT COALESCE(sum(count), 0)::bigint FROM usage_counters WHERE profile_id = $1",
            man.profile_id
        )
        .await,
        0
    );
    let seen = events(&mut her_socket);
    let kinds = types(&seen);
    assert!(kinds.contains(&"interest.accepted"), "{kinds:?}");
    assert!(kinds.contains(&"connection.updated"), "{kinds:?}");
    assert!(kinds.contains(&"message.new"), "{kinds:?}");
    let accepted = seen
        .iter()
        .find(|e| e["type"] == "interest.accepted")
        .unwrap();
    assert_eq!(accepted["data"]["interest"]["direction"], "sent");
    assert_eq!(
        accepted["data"]["connection"]["other"]["id"],
        json!(man.profile_id)
    );
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM notifications WHERE user_id = $1 AND type = 'interest_accepted'",
            woman.user_id
        )
        .await,
        1
    );
}

/// T-401: a sender never receives the value `declined`, in any response.
#[sqlx::test]
async fn a_sender_never_receives_declined(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let sent = send(&app, &man, &woman, None).await;
    let id = sent.json["interest"]["id"].clone();
    let path = format!("/v1/interests/{}", id.as_str().unwrap());
    let mut his_socket = listen(&app, &man);

    let declined = act(&app, &woman, &id, "decline").await;
    assert_eq!(declined.status, StatusCode::OK, "{}", declined.text);
    assert_eq!(declined.json["status"], "declined");
    assert_eq!(declined.json["display_status"], "declined");
    assert!(events(&mut his_socket).is_empty(), "the sender is not told");

    let mut his_answers: Vec<TestResponse> = Vec::new();
    let one = app.get(&path, Some(&man.token)).await;
    assert_eq!(one.json["status"], "pending");
    assert_eq!(one.json["display_status"], "no_response");
    assert_eq!(one.json["responded_at"], Value::Null);
    his_answers.push(one);
    let waiting = app
        .get("/v1/interests?box=sent&status=pending", Some(&man.token))
        .await;
    assert_eq!(waiting.json["items"][0]["id"], id);
    his_answers.push(waiting);
    let profile = app
        .get(
            &format!("/v1/profiles/{}", woman.profile_id),
            Some(&man.token),
        )
        .await;
    assert_eq!(profile.json["relation"]["interest"]["status"], "pending");
    his_answers.push(profile);
    let again = send(&app, &man, &woman, None).await;
    assert_eq!(again.code(), "interest_already_pending");
    assert_eq!(again.json["error"]["details"]["interest_id"], id);
    his_answers.push(again);
    let withdrawn = act(&app, &man, &id, "withdraw").await;
    assert_eq!(withdrawn.status, StatusCode::OK, "{}", withdrawn.text);
    assert_eq!(withdrawn.json["status"], "withdrawn");
    assert_eq!(
        status_of(&app, &id).await,
        "declined",
        "the row stays declined"
    );
    his_answers.push(withdrawn);

    // Past its expiry date it is closed for him, and the 90-day cooldown applies.
    exec(
        &app,
        "UPDATE interests SET expires_at = now() - interval '1 minute' WHERE sender_profile_id = $1",
        man.profile_id,
    )
    .await;
    let closed = app
        .get("/v1/interests?box=sent&status=closed", Some(&man.token))
        .await;
    assert_eq!(closed.json["items"][0]["status"], "expired");
    assert_eq!(closed.json["items"][0]["display_status"], "closed");
    his_answers.push(closed);
    let waiting = app
        .get("/v1/interests?box=sent&status=pending", Some(&man.token))
        .await;
    assert_eq!(waiting.json["items"], json!([]));
    let cooldown = send(&app, &man, &woman, None).await;
    assert_eq!(cooldown.code(), "cooldown_active");
    his_answers.push(cooldown);
    let late_withdraw = act(&app, &man, &id, "withdraw").await;
    assert_eq!(late_withdraw.code(), "invalid_state");
    assert_eq!(late_withdraw.json["error"]["details"]["status"], "expired");
    his_answers.push(late_withdraw);

    for answer in &his_answers {
        assert!(
            !answer.text.contains("declined"),
            "the sender saw a decline: {}",
            answer.text
        );
    }
    // She still sees the truth.
    let hers = app
        .get(
            "/v1/interests?box=received&status=closed",
            Some(&woman.token),
        )
        .await;
    assert_eq!(hers.json["items"][0]["status"], "declined");
}

#[sqlx::test]
async fn accepting_creates_the_connection(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let sent = send(&app, &man, &woman, None).await;
    let id = sent.json["interest"]["id"].clone();
    exec(
        &app,
        "INSERT INTO match_recommendations (profile_id, candidate_profile_id, compat, rank_score)
         SELECT $1, p.id, 80, 1 FROM profiles p WHERE p.gender = 'female'",
        man.profile_id,
    )
    .await;

    assert_eq!(
        act(&app, &man, &id, "accept").await.status,
        StatusCode::NOT_FOUND
    );
    let accepted = act(&app, &woman, &id, "accept").await;
    assert_eq!(accepted.status, StatusCode::OK, "{}", accepted.text);
    assert_eq!(accepted.json["interest"]["status"], "accepted");
    assert!(accepted.json["interest"]["responded_at"].is_string());
    let connection = &accepted.json["connection"];
    assert_eq!(connection["stage"], "chatting");
    assert_eq!(connection["other"]["id"], json!(man.profile_id));
    assert_eq!(connection["other"]["relation"]["tier"], "connection");
    assert_eq!(connection["unread_count"], 0);
    assert!(connection["last_message_at"].is_string());

    let connection_id: Uuid = connection["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM connection_members WHERE connection_id = $1",
            connection_id
        )
        .await,
        2
    );
    let system: (String, Value) =
        sqlx::query_as("SELECT system_event, system_data FROM messages WHERE connection_id = $1")
            .bind(connection_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(system.0, "connected");
    assert_eq!(system.1["actor_profile_id"], json!(woman.profile_id));
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM match_recommendations WHERE profile_id = $1 AND candidate_profile_id = (
                 SELECT receiver_profile_id FROM interests WHERE sender_profile_id = $1)",
            man.profile_id
        )
        .await,
        0
    );
    let notifications = scalar_i64(
        &app,
        "SELECT count(*) FROM notifications WHERE user_id = $1 AND type = 'interest_accepted'",
        man.user_id,
    )
    .await;
    assert_eq!(notifications, 1);

    // A double tap finds it accepted.
    let again = act(&app, &woman, &id, "accept").await;
    assert_eq!(again.code(), "invalid_state");
    assert_eq!(again.json["error"]["details"]["status"], "accepted");
    let listed = app
        .get("/v1/interests?box=sent&status=accepted", Some(&man.token))
        .await;
    assert_eq!(listed.json["items"][0]["connection_id"], connection["id"]);
}

#[sqlx::test]
async fn accepting_checks_both_connection_caps(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let sent = send(&app, &man, &woman, None).await;
    let id = sent.json["interest"]["id"].clone();
    setting(&app, "limits.active_connections_max", json!(1)).await;

    let hers = app.member().await;
    let her_connection = connect(&app, hers.profile_id, woman.profile_id).await;
    let refused = act(&app, &woman, &id, "accept").await;
    assert_eq!(refused.code(), "limit_reached", "{}", refused.text);
    assert_eq!(refused.json["error"]["details"]["side"], "you");
    exec(
        &app,
        "UPDATE connections SET status = 'ended', ended_reason = 'other', ended_at = now() WHERE id = $1",
        her_connection,
    )
    .await;

    let his = app.member_of(Gender::Female).await;
    let his_connection = connect(&app, man.profile_id, his.profile_id).await;
    let refused = act(&app, &woman, &id, "accept").await;
    assert_eq!(refused.code(), "limit_reached");
    assert_eq!(refused.json["error"]["details"]["side"], "them");
    assert_eq!(
        status_of(&app, &id).await,
        "pending",
        "the interest stays pending"
    );
    exec(
        &app,
        "UPDATE connections SET status = 'ended', ended_reason = 'other', ended_at = now() WHERE id = $1",
        his_connection,
    )
    .await;
    assert_eq!(
        act(&app, &woman, &id, "accept").await.status,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn accepting_expires_an_interest_whose_sender_is_gone(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let sent = send(&app, &man, &woman, None).await;
    let id = sent.json["interest"]["id"].clone();
    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(man.user_id)
        .execute(app.db())
        .await
        .unwrap();

    let refused = act(&app, &woman, &id, "accept").await;
    assert_eq!(refused.code(), "invalid_state", "{}", refused.text);
    assert_eq!(status_of(&app, &id).await, "expired");
    let closed = app
        .get(
            "/v1/interests?box=received&status=closed",
            Some(&woman.token),
        )
        .await;
    assert_eq!(closed.json["items"][0]["id"], id);
    assert_eq!(closed.json["items"][0]["profile"], Value::Null);
}

#[sqlx::test]
async fn withdrawing_removes_the_receivers_notification(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let sent = send(&app, &man, &woman, None).await;
    let id = sent.json["interest"]["id"].clone();

    assert_eq!(
        act(&app, &woman, &id, "withdraw").await.status,
        StatusCode::NOT_FOUND
    );
    let withdrawn = act(&app, &man, &id, "withdraw").await;
    assert_eq!(withdrawn.status, StatusCode::OK, "{}", withdrawn.text);
    assert_eq!(withdrawn.json["status"], "withdrawn");
    assert_eq!(status_of(&app, &id).await, "withdrawn");
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM notifications WHERE user_id = $1",
            woman.user_id
        )
        .await,
        0
    );
    assert_eq!(
        act(&app, &woman, &id, "accept").await.code(),
        "invalid_state"
    );
    assert_eq!(
        act(&app, &man, &id, "withdraw").await.code(),
        "invalid_state"
    );
    // The 7-day cooldown binds him, not her.
    assert_eq!(
        send(&app, &man, &woman, None).await.code(),
        "cooldown_active"
    );
    assert_eq!(
        send(&app, &woman, &man, None).await.status,
        StatusCode::CREATED
    );
}

#[sqlx::test]
async fn declining_is_quiet_and_may_block(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let other_man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let first = send(&app, &man, &woman, None).await;
    let second = send(&app, &other_man, &woman, None).await;

    assert_eq!(
        act(&app, &man, &first.json["interest"]["id"], "decline")
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    // No body at all.
    let quiet = act(&app, &woman, &first.json["interest"]["id"], "decline").await;
    assert_eq!(quiet.status, StatusCode::OK, "{}", quiet.text);
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM notifications WHERE user_id = $1",
            man.user_id
        )
        .await,
        0
    );
    let again = act(&app, &woman, &first.json["interest"]["id"], "decline").await;
    assert_eq!(again.code(), "invalid_state");

    let id = second.json["interest"]["id"].as_str().unwrap();
    let blocked = app
        .post(
            &format!("/v1/interests/{id}/decline"),
            Some(&woman.token),
            json!({ "also_block": true }),
        )
        .await;
    assert_eq!(blocked.status, StatusCode::OK, "{}", blocked.text);
    assert_eq!(blocked.json["status"], "declined");
    assert_eq!(
        blocked.json["profile"],
        Value::Null,
        "a blocked member is gone"
    );
    assert_eq!(
        scalar_i64(
            &app,
            "SELECT count(*) FROM blocks WHERE blocker_profile_id = $1",
            woman.profile_id
        )
        .await,
        1
    );
    let unknown = app
        .post(
            &format!("/v1/interests/{id}/decline"),
            Some(&woman.token),
            json!({ "also_block": true, "colour": "red" }),
        )
        .await;
    assert_eq!(unknown.code(), "bad_request");
}

#[sqlx::test]
async fn seen_reaches_the_sender_only_with_read_receipts(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let sent = send(&app, &man, &woman, None).await;
    let id = sent.json["interest"]["id"].clone();
    let path = format!("/v1/interests/{}", id.as_str().unwrap());

    let seen = app
        .post(
            "/v1/interests/seen",
            Some(&woman.token),
            json!({ "interest_ids": [id, Uuid::now_v7()] }),
        )
        .await;
    assert_eq!(seen.status, StatusCode::NO_CONTENT, "{}", seen.text);
    assert_eq!(app.get(&path, Some(&woman.token)).await.json["seen"], true);
    assert_eq!(app.get(&path, Some(&man.token)).await.json["seen"], true);

    set_privacy(&app, woman.profile_id, "send_read_receipts = false").await;
    assert_eq!(app.get(&path, Some(&man.token)).await.json["seen"], false);
    assert_eq!(app.get(&path, Some(&woman.token)).await.json["seen"], true);

    // The sender cannot mark his own interest as seen.
    let fresh = app.member_of(Gender::Female).await;
    let other = send(&app, &man, &fresh, None).await;
    app.post(
        "/v1/interests/seen",
        Some(&man.token),
        json!({ "interest_ids": [other.json["interest"]["id"]] }),
    )
    .await;
    let path = format!(
        "/v1/interests/{}",
        other.json["interest"]["id"].as_str().unwrap()
    );
    assert_eq!(app.get(&path, Some(&fresh.token)).await.json["seen"], false);

    let too_many: Vec<Uuid> = (0..101).map(|_| Uuid::now_v7()).collect();
    let refused = app
        .post(
            "/v1/interests/seen",
            Some(&woman.token),
            json!({ "interest_ids": too_many }),
        )
        .await;
    assert_eq!(refused.field_errors(), ["interest_ids:too_long"]);
}

#[sqlx::test]
async fn the_lists_follow_box_status_and_pages(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let mut women = Vec::new();
    for _ in 0..3 {
        let woman = app.member_of(Gender::Female).await;
        assert_eq!(
            send(&app, &man, &woman, None).await.status,
            StatusCode::CREATED
        );
        women.push(woman);
    }
    let first = app
        .get("/v1/interests?box=sent&limit=2", Some(&man.token))
        .await;
    assert_eq!(first.json["items"].as_array().unwrap().len(), 2);
    // Newest first.
    assert_eq!(
        first.json["items"][0]["profile"]["id"],
        json!(women[2].profile_id)
    );
    let cursor = first.json["next_cursor"].as_str().unwrap();
    let second = app
        .get(
            &format!("/v1/interests?box=sent&limit=2&cursor={cursor}"),
            Some(&man.token),
        )
        .await;
    assert_eq!(second.json["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        second.json["items"][0]["profile"]["id"],
        json!(women[0].profile_id)
    );
    assert_eq!(second.json["next_cursor"], Value::Null);

    let received = app
        .get("/v1/interests?box=received", Some(&women[1].token))
        .await;
    let id = received.json["items"][0]["id"].clone();
    act(&app, &women[1], &id, "accept").await;
    let pending = app
        .get(
            "/v1/interests?box=received&status=pending",
            Some(&women[1].token),
        )
        .await;
    assert_eq!(pending.json["items"], json!([]));
    let accepted = app
        .get(
            "/v1/interests?box=received&status=accepted",
            Some(&women[1].token),
        )
        .await;
    assert_eq!(accepted.json["items"][0]["id"], id);
    let sent_accepted = app
        .get("/v1/interests?box=sent&status=accepted", Some(&man.token))
        .await;
    assert_eq!(sent_accepted.json["items"][0]["id"], id);

    let missing_box = app.get("/v1/interests", Some(&man.token)).await;
    assert_eq!(missing_box.code(), "bad_request");
    let wrong = app
        .get("/v1/interests?box=sent&status=declined", Some(&man.token))
        .await;
    assert_eq!(wrong.code(), "bad_request");
}

#[sqlx::test]
async fn access_levels_are_enforced(db: PgPool) {
    let app = TestApp::new(db).await;
    let woman = app.member_of(Gender::Female).await;
    let target = json!({ "receiver_profile_id": woman.profile_id });

    let anonymous = app.post("/v1/interests", None, target.clone()).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
    // Sending is `browse`: a paused profile may not send.
    let paused = app
        .member_with(|spec| spec.status = ProfileStatus::Paused)
        .await;
    let refused = app
        .post("/v1/interests", Some(&paused.token), target.clone())
        .await;
    assert_eq!(refused.code(), "profile_not_active");
    // Lists and answers are `engage`: paused is fine, closed is not.
    let listed = app
        .get("/v1/interests?box=received", Some(&paused.token))
        .await;
    assert_eq!(listed.status, StatusCode::OK);
    let closed = app
        .member_with(|spec| spec.status = ProfileStatus::Closed)
        .await;
    assert_eq!(
        app.get("/v1/interests?box=received", Some(&closed.token))
            .await
            .code(),
        "profile_not_active"
    );
    let fake = Uuid::now_v7();
    for action in ["accept", "decline", "withdraw"] {
        let response = app
            .post_empty(
                &format!("/v1/interests/{fake}/{action}"),
                Some(&closed.token),
            )
            .await;
        assert_eq!(response.code(), "profile_not_active", "{action}");
    }
    let draft = app.draft_user().await;
    assert_eq!(
        app.post("/v1/interests", Some(&draft.token), target.clone())
            .await
            .code(),
        "onboarding_required"
    );
    let suspended = app
        .member_with(|spec| spec.user_status = crate::domain::types::UserStatus::Suspended)
        .await;
    assert_eq!(
        app.get("/v1/interests?box=sent", Some(&suspended.token))
            .await
            .code(),
        "account_suspended"
    );

    // Paused members can still answer, and a paused receiver cannot get new interests.
    let paused_woman = app
        .member_with(|spec| {
            spec.gender = Gender::Female;
            spec.status = ProfileStatus::Paused;
        })
        .await;
    let man = app.member().await;
    assert_eq!(
        send(&app, &man, &paused_woman, None).await.status,
        StatusCode::NOT_FOUND
    );
    let same_gender = app.member().await;
    assert_eq!(
        send(&app, &man, &same_gender, None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.post(
            "/v1/interests",
            Some(&man.token),
            json!({ "receiver_profile_id": man.profile_id })
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
}

/// 03 section 8 invariant 8: one pending interest per ordered pair, one active connection per
/// pair, and no pending interest between a connected pair.
#[sqlx::test]
async fn invariant_8_one_open_relationship_per_pair(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;

    let first = send(&app, &man, &woman, None).await;
    assert_eq!(first.status, StatusCode::CREATED);
    // A double tap.
    let second = send(&app, &man, &woman, None).await;
    assert_eq!(second.code(), "interest_already_pending");
    // The other direction becomes a mutual acceptance, not a second pending row.
    let mutual = send(&app, &woman, &man, None).await;
    assert_eq!(mutual.status, StatusCode::CREATED);
    assert!(mutual.json["connection"].is_object());

    let pending = scalar_i64(
        &app,
        "SELECT count(*) FROM interests
         WHERE status = 'pending' AND (sender_profile_id = $1 OR receiver_profile_id = $1)",
        man.profile_id,
    )
    .await;
    assert_eq!(pending, 0, "no pending interest between a connected pair");
    for (from, to) in [(&man, &woman), (&woman, &man)] {
        let refused = send(&app, from, to, None).await;
        assert_eq!(refused.code(), "already_connected");
    }
    let active = scalar_i64(
        &app,
        "SELECT count(*) FROM connections
         WHERE status = 'active' AND (profile_low_id = $1 OR profile_high_id = $1)",
        man.profile_id,
    )
    .await;
    assert_eq!(active, 1);
}

#[test]
fn the_openapi_document_describes_interests_and_connections() {
    let spec: Value =
        serde_json::from_str(&crate::openapi::spec_json().expect("the spec builds")).unwrap();
    for (path, methods) in [
        ("/v1/interests", vec!["get", "post"]),
        ("/v1/interests/seen", vec!["post"]),
        ("/v1/interests/{interest_id}", vec!["get"]),
        ("/v1/interests/{interest_id}/accept", vec!["post"]),
        ("/v1/interests/{interest_id}/decline", vec!["post"]),
        ("/v1/interests/{interest_id}/withdraw", vec!["post"]),
        ("/v1/connections", vec!["get"]),
        ("/v1/connections/{connection_id}", vec!["get", "patch"]),
        ("/v1/connections/{connection_id}/end", vec!["post"]),
        (
            "/v1/connections/{connection_id}/messages",
            vec!["get", "post"],
        ),
        (
            "/v1/connections/{connection_id}/messages/{message_id}",
            vec!["delete"],
        ),
        ("/v1/connections/{connection_id}/read", vec!["post"]),
        (
            "/v1/connections/{connection_id}/contact-share",
            vec!["put", "delete"],
        ),
        (
            "/v1/connections/{connection_id}/stage-proposals",
            vec!["post"],
        ),
        (
            "/v1/connections/{connection_id}/stage-proposals/{proposal_id}",
            vec!["delete"],
        ),
        (
            "/v1/connections/{connection_id}/stage-proposals/{proposal_id}/confirm",
            vec!["post"],
        ),
        (
            "/v1/connections/{connection_id}/stage-proposals/{proposal_id}/decline",
            vec!["post"],
        ),
    ] {
        for method in methods {
            assert!(
                spec["paths"][path][method].is_object(),
                "{method} {path} is documented"
            );
        }
    }
    let parameters = spec["paths"]["/v1/interests"]["get"]["parameters"]
        .as_array()
        .unwrap();
    assert!(
        parameters.iter().any(|p| p["name"] == "box"),
        "{parameters:?}"
    );
    let schemas = spec["components"]["schemas"].as_object().unwrap();
    for name in [
        "Interest",
        "Connection",
        "Message",
        "ContactShare",
        "SharedContact",
    ] {
        assert!(schemas.contains_key(name), "{name} is documented");
    }
}

/// 11 section 13 rules 6 and 7: pending interests survive a pause on either side and can
/// still be answered; the paused sender can chat once accepted.
#[sqlx::test]
async fn paused_members_keep_their_pending_interests(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let sent = send(&app, &man, &woman, None).await;
    let id = sent.json["interest"]["id"].clone();
    for user in [&man, &woman] {
        set_profile(
            &app,
            user.profile_id,
            "status = 'paused', paused_at = now()",
        )
        .await;
        app.state.accounts.invalidate(user.user_id);
    }
    let accepted = act(&app, &woman, &id, "accept").await;
    assert_eq!(accepted.status, StatusCode::OK, "{}", accepted.text);
    let connection_id = accepted.json["connection"]["id"].as_str().unwrap();
    let said = app
        .post(
            &format!("/v1/connections/{connection_id}/messages"),
            Some(&man.token),
            json!({ "body": "Assalam-o-Alaikum", "client_message_id": Uuid::now_v7() }),
        )
        .await;
    assert_eq!(said.status, StatusCode::CREATED, "{}", said.text);
}
