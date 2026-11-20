//! Tests of chat messages (T-402, T-403): idempotent sends, unread counters (03 section 8
//! invariant 14), history, read receipts, removal, limits, safety notices and the automatic
//! money report, pushes, and a message travelling from REST to the other member's socket.

use axum::http::StatusCode;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use uuid::Uuid;

use super::{Pair, connect_through_api, counters, events, listen, of_type, pair, say, scalar};
use crate::domain::options::Gender;
use crate::test_support::{TestApp, TestUser};
use crate::views::testing::{exec, set_privacy};

/// Invariant 14: each member's `unread_count` equals the number of messages from the other
/// member with an id greater than their `last_read_message_id`.
async fn assert_unread_matches_data(app: &TestApp, pair: &Pair) {
    let mismatches: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM connection_members m
         WHERE m.connection_id = $1
           AND m.unread_count <> (
               SELECT count(*) FROM messages x
               WHERE x.connection_id = m.connection_id
                 AND x.sender_profile_id IS NOT NULL
                 AND x.sender_profile_id <> m.profile_id
                 AND (m.last_read_message_id IS NULL OR x.id > m.last_read_message_id))",
    )
    .bind(pair.id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(mismatches, 0, "unread counters disagree with the data");
}

async fn clear_jobs(app: &TestApp) {
    sqlx::query("DELETE FROM jobs")
        .execute(app.db())
        .await
        .unwrap();
}

async fn unread_of(app: &TestApp, pair: &Pair, user: &TestUser) -> i64 {
    let row = app.get(&pair.path(""), Some(&user.token)).await;
    row.json["unread_count"].as_i64().unwrap()
}

async fn read(app: &TestApp, pair: &Pair, user: &TestUser, up_to: &Value) -> StatusCode {
    app.post(
        &pair.path("/read"),
        Some(&user.token),
        json!({ "up_to_message_id": up_to }),
    )
    .await
    .status
}

/// T-402: sending twice with one `client_message_id` creates one message.
#[sqlx::test]
async fn one_client_message_id_creates_one_message(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let client_id = Uuid::now_v7();
    let body = json!({ "body": "  Assalam-o-Alaikum  ", "client_message_id": client_id });

    let first = app
        .post(&pair.path("/messages"), Some(&pair.man.token), body.clone())
        .await;
    assert_eq!(first.status, StatusCode::CREATED, "{}", first.text);
    assert_eq!(first.json["sender"], "me");
    assert_eq!(first.json["kind"], "text");
    assert_eq!(first.json["body"], "Assalam-o-Alaikum");
    assert_eq!(first.json["client_message_id"], json!(client_id));
    assert_eq!(first.json["is_deleted"], false);
    let retry = app
        .post(&pair.path("/messages"), Some(&pair.man.token), body)
        .await;
    assert_eq!(retry.status, StatusCode::OK, "{}", retry.text);
    assert_eq!(retry.json["id"], first.json["id"]);

    assert_eq!(
        scalar(
            &app,
            "SELECT count(*) FROM messages WHERE connection_id = $1 AND kind = 'text'",
            pair.id
        )
        .await,
        1
    );
    assert_eq!(
        unread_of(&app, &pair, &pair.woman).await,
        1,
        "no second unread"
    );
    assert_eq!(
        scalar(
            &app,
            "SELECT count::bigint FROM usage_counters WHERE profile_id = $1 AND counter = 'messages_sent'",
            pair.man.profile_id
        )
        .await,
        1
    );
    // The same key from the other member is a different message.
    let hers = app
        .post(
            &pair.path("/messages"),
            Some(&pair.woman.token),
            json!({ "body": "Walaikum Assalam", "client_message_id": client_id }),
        )
        .await;
    assert_eq!(hers.status, StatusCode::CREATED);
    let bad = app
        .post(
            &pair.path("/messages"),
            Some(&pair.man.token),
            json!({ "body": "hi", "client_message_id": "not-a-uuid" }),
        )
        .await;
    assert_eq!(bad.field_errors(), ["client_message_id:invalid"]);
    let empty = app
        .post(
            &pair.path("/messages"),
            Some(&pair.man.token),
            json!({ "body": "   ", "client_message_id": Uuid::now_v7() }),
        )
        .await;
    assert_eq!(empty.field_errors(), ["body:required"]);
    let long = app
        .post(
            &pair.path("/messages"),
            Some(&pair.man.token),
            json!({ "body": "a".repeat(2001), "client_message_id": Uuid::now_v7() }),
        )
        .await;
    assert_eq!(long.field_errors(), ["body:too_long"]);
}

/// T-402: unread counters match the data (03 section 8 rule 14) through sends and reads.
#[sqlx::test]
async fn unread_counters_match_the_data(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    assert_unread_matches_data(&app, &pair).await;

    let mut ids = Vec::new();
    for body in ["one", "two", "three"] {
        let sent = say(&app, &pair, &pair.man, body).await;
        ids.push(sent.json["id"].clone());
        assert_unread_matches_data(&app, &pair).await;
    }
    say(&app, &pair, &pair.woman, "reply").await;
    assert_unread_matches_data(&app, &pair).await;
    assert_eq!(unread_of(&app, &pair, &pair.woman).await, 3);
    assert_eq!(unread_of(&app, &pair, &pair.man).await, 1);
    assert_eq!(counters(&app, &pair.woman).await.unread_chats, 1);

    assert_eq!(
        read(&app, &pair, &pair.woman, &ids[1]).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(unread_of(&app, &pair, &pair.woman).await, 1);
    assert_unread_matches_data(&app, &pair).await;
    // An older id never moves the pointer back.
    assert_eq!(
        read(&app, &pair, &pair.woman, &ids[0]).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(unread_of(&app, &pair, &pair.woman).await, 1);
    assert_unread_matches_data(&app, &pair).await;

    // System messages never count as unread.
    let proposal = app
        .post(
            &pair.path("/stage-proposals"),
            Some(&pair.man.token),
            json!({ "stage": "families_talking" }),
        )
        .await;
    assert_eq!(proposal.status, StatusCode::OK);
    assert_eq!(unread_of(&app, &pair, &pair.woman).await, 1);
    assert_unread_matches_data(&app, &pair).await;

    assert_eq!(
        read(&app, &pair, &pair.woman, &ids[2]).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(unread_of(&app, &pair, &pair.woman).await, 0);
    assert_eq!(counters(&app, &pair.woman).await.unread_chats, 0);
    assert_unread_matches_data(&app, &pair).await;
    // Reading needs a message of this connection.
    assert_eq!(
        read(&app, &pair, &pair.woman, &json!(Uuid::now_v7())).await,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test]
async fn history_pages_before_and_after(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let mut ids = Vec::new();
    for n in 0..5 {
        let sent = say(&app, &pair, &pair.man, &format!("message {n}")).await;
        ids.push(sent.json["id"].as_str().unwrap().to_owned());
    }
    // Six messages: the `connected` system message and five texts.
    let newest = app
        .get(&pair.path("/messages?limit=2"), Some(&pair.woman.token))
        .await;
    assert_eq!(newest.status, StatusCode::OK, "{}", newest.text);
    assert_eq!(newest.json["has_more"], true);
    assert_eq!(newest.json["items"][0]["id"], ids[4]);
    assert_eq!(newest.json["items"][1]["id"], ids[3]);
    assert_eq!(newest.json["items"][0]["sender"], "them");
    assert_eq!(newest.json["items"][0]["client_message_id"], Value::Null);

    let older = app
        .get(
            &pair.path(&format!("/messages?limit=10&before={}", ids[3])),
            Some(&pair.woman.token),
        )
        .await;
    let older_ids: Vec<&str> = older.json["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(older_ids.len(), 4);
    assert_eq!(&older_ids[..3], [&ids[2], &ids[1], &ids[0]]);
    assert_eq!(older.json["items"][3]["sender"], "system");
    assert_eq!(older.json["items"][3]["system_event"], "connected");
    assert_eq!(older.json["has_more"], false);

    let newer = app
        .get(
            &pair.path(&format!("/messages?limit=2&after={}", ids[1])),
            Some(&pair.woman.token),
        )
        .await;
    assert_eq!(newer.json["items"][0]["id"], ids[2], "oldest first");
    assert_eq!(newer.json["items"][1]["id"], ids[3]);
    assert_eq!(newer.json["has_more"], true);

    let both = app
        .get(
            &pair.path(&format!("/messages?before={}&after={}", ids[3], ids[1])),
            Some(&pair.woman.token),
        )
        .await;
    assert_eq!(both.code(), "bad_request");
}

#[sqlx::test]
async fn read_receipts_need_both_members(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let sent = say(&app, &pair, &pair.man, "Salaam").await;
    let mut his_socket = listen(&app, &pair.man);
    let mut her_socket = listen(&app, &pair.woman);

    read(&app, &pair, &pair.woman, &sent.json["id"]).await;
    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(his.json["their_last_read_message_id"], sent.json["id"]);
    let receipt = events(&mut his_socket);
    let read_event = of_type(&receipt, "message.read");
    assert_eq!(read_event.len(), 1);
    assert_eq!(read_event[0]["data"]["reader"], "them");
    assert_eq!(read_event[0]["data"]["up_to_message_id"], sent.json["id"]);
    let own = events(&mut her_socket);
    assert_eq!(of_type(&own, "message.read")[0]["data"]["reader"], "me");

    // He turns receipts off: neither side sees the other's.
    set_privacy(&app, pair.man.profile_id, "send_read_receipts = false").await;
    let second = say(&app, &pair, &pair.man, "Are you there?").await;
    events(&mut his_socket);
    read(&app, &pair, &pair.woman, &second.json["id"]).await;
    assert_eq!(
        of_type(&events(&mut his_socket), "message.read"),
        Vec::<&Value>::new()
    );
    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(his.json["their_last_read_message_id"], Value::Null);
    // Her own unread state is unaffected (09 section 9 rule 3).
    assert_eq!(unread_of(&app, &pair, &pair.woman).await, 0);
}

#[sqlx::test]
async fn own_messages_can_be_removed_for_15_minutes(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let older = say(&app, &pair, &pair.man, "first").await;
    let latest = say(&app, &pair, &pair.man, "second").await;
    let theirs = say(&app, &pair, &pair.woman, "reply").await;
    let mut her_socket = listen(&app, &pair.woman);
    let path =
        |message: &Value| pair.path(&format!("/messages/{}", message["id"].as_str().unwrap()));

    assert_eq!(
        app.delete(&path(&theirs.json), Some(&pair.man.token))
            .await
            .status,
        StatusCode::NOT_FOUND,
        "only the sender"
    );
    let removed = app.delete(&path(&latest.json), Some(&pair.man.token)).await;
    assert_eq!(removed.status, StatusCode::OK, "{}", removed.text);
    assert_eq!(removed.json["body"], Value::Null);
    assert_eq!(removed.json["is_deleted"], true);
    let deleted = of_type(&events(&mut her_socket), "message.deleted")
        .first()
        .map(|e| e["data"].clone());
    assert_eq!(
        deleted,
        Some(json!({ "connection_id": pair.id, "message_id": latest.json["id"] }))
    );
    // Not the latest message: the preview stays.
    let row = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(row.json["last_message_preview"], "reply");
    let removed_latest = app
        .delete(&path(&theirs.json), Some(&pair.woman.token))
        .await;
    assert_eq!(removed_latest.status, StatusCode::OK);
    let row = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(row.json["last_message_preview"], Value::Null);
    let history = app
        .get(&pair.path("/messages"), Some(&pair.woman.token))
        .await;
    let shown = history.json["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == latest.json["id"])
        .unwrap()
        .clone();
    assert_eq!(shown["is_deleted"], true);
    assert_eq!(shown["body"], Value::Null);

    let id: Uuid = older.json["id"].as_str().unwrap().parse().unwrap();
    exec(
        &app,
        "UPDATE messages SET created_at = now() - interval '16 minutes' WHERE id = $1",
        id,
    )
    .await;
    let late = app.delete(&path(&older.json), Some(&pair.man.token)).await;
    assert_eq!(late.code(), "invalid_state");
    assert_eq!(
        late.json["error"]["details"]["status"],
        "delete_window_passed"
    );
}

#[sqlx::test]
async fn message_limits_answer_rate_limited_and_limit_reached(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    app.state
        .settings
        .put("limits.messages_per_day", &json!(2), None)
        .await
        .unwrap();
    assert_eq!(
        say(&app, &pair, &pair.man, "one").await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        say(&app, &pair, &pair.man, "two").await.status,
        StatusCode::CREATED
    );
    let third = say(&app, &pair, &pair.man, "three").await;
    assert_eq!(third.code(), "limit_reached", "{}", third.text);
    assert_eq!(
        third.json["error"]["details"]["limit"],
        "limits.messages_per_day"
    );
    assert_eq!(third.json["error"]["details"]["used"], 2);
    assert!(third.json["error"]["details"]["resets_at"].is_string());

    app.state
        .settings
        .put("limits.messages_per_minute", &json!(1), None)
        .await
        .unwrap();
    assert_eq!(
        say(&app, &pair, &pair.woman, "one").await.status,
        StatusCode::CREATED
    );
    let second = say(&app, &pair, &pair.woman, "two").await;
    assert_eq!(second.code(), "rate_limited", "{}", second.text);
    assert!(second.headers.contains_key("retry-after"));
    assert!(second.json["error"]["details"]["retry_after_seconds"].is_number());
}

#[sqlx::test]
async fn a_member_who_became_unavailable_cannot_be_messaged(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(pair.woman.user_id)
        .execute(app.db())
        .await
        .unwrap();
    let refused = say(&app, &pair, &pair.man, "Salaam").await;
    assert_eq!(refused.code(), "invalid_state", "{}", refused.text);
    assert_eq!(
        refused.json["error"]["details"]["status"],
        "other_unavailable"
    );
    let row = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(row.json["status"], "active", "the connection stays");
    assert_eq!(row.json["other"], Value::Null);
}

#[sqlx::test]
async fn safety_notices_reach_only_the_receiver(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let sent = say(&app, &pair, &pair.man, "Please send money to my easypaisa").await;
    assert_eq!(sent.status, StatusCode::CREATED, "{}", sent.text);
    assert_eq!(sent.json["safety_notice"], Value::Null);
    let hers = app
        .get(&pair.path("/messages"), Some(&pair.woman.token))
        .await;
    assert_eq!(hers.json["items"][0]["safety_notice"], "money");
    let his = app
        .get(&pair.path("/messages"), Some(&pair.man.token))
        .await;
    assert_eq!(his.json["items"][0]["safety_notice"], Value::Null);
    let contact = say(&app, &pair, &pair.man, "My number is 0300 1234567").await;
    assert_eq!(
        contact.status,
        StatusCode::CREATED,
        "chat may carry contact details"
    );
    let hers = app
        .get(&pair.path("/messages"), Some(&pair.woman.token))
        .await;
    assert_eq!(hers.json["items"][0]["safety_notice"], "contact_info");
}

/// 13 section 5.5: five money messages over three connections in a week file one system
/// report against the sender, with only the sender's own flagged messages as context.
#[sqlx::test]
async fn repeated_money_messages_file_one_system_report(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let mut pairs = Vec::new();
    for _ in 0..3 {
        let woman = app.member_of(Gender::Female).await;
        pairs.push(connect_through_api(&app, man.clone(), woman).await);
    }
    let reports = |app: &TestApp| {
        let db = app.db().clone();
        async move {
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reports")
                .fetch_one(&db)
                .await
                .unwrap()
        }
    };
    for (index, pair) in pairs.iter().enumerate() {
        say(&app, pair, &pair.woman, "Salaam, how are you?").await;
        say(&app, pair, &man, &format!("I need money urgently {index}")).await;
    }
    say(&app, &pairs[0], &man, "please lend me some").await;
    assert_eq!(reports(&app).await, 0, "four flags are not enough");
    say(&app, &pairs[1], &man, "send money via jazzcash").await;
    assert_eq!(reports(&app).await, 1);

    let (source, reporter, target, subject, reason, context): (
        String,
        Option<Uuid>,
        Uuid,
        String,
        String,
        Value,
    ) = sqlx::query_as(
        "SELECT source, reporter_profile_id, target_profile_id, subject_type, reason, context
         FROM reports",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(source, "system");
    assert_eq!(reporter, None);
    assert_eq!(target, man.profile_id);
    assert_eq!(subject, "profile");
    assert_eq!(reason, "asking_for_money");
    assert_eq!(context["trigger"], "money_flags");
    assert_eq!(context["flags"], 5);
    assert_eq!(context["connections"], 3);
    let messages = context["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 5);
    assert!(
        messages
            .iter()
            .all(|m| !m["body"].as_str().unwrap().contains("Salaam")),
        "never the other members' replies"
    );
    // Another one within the week files nothing new.
    say(&app, &pairs[2], &man, "send money again").await;
    assert_eq!(reports(&app).await, 1);
}

#[sqlx::test]
async fn offline_members_get_a_push_unless_muted(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    clear_jobs(&app).await;

    say(&app, &pair, &pair.man, "one").await;
    say(&app, &pair, &pair.man, "two").await;
    let pushes = app.queued_jobs("send_push").await;
    assert_eq!(pushes.len(), 1, "one push job per connection while queued");
    assert_eq!(pushes[0]["type"], "message");
    assert_eq!(pushes[0]["user_id"], json!(pair.woman.user_id));
    assert_eq!(pushes[0]["data"]["connection_id"], json!(pair.id));
    let emails = app.queued_jobs("send_email").await;
    assert_eq!(emails.len(), 1);
    assert_eq!(emails[0]["template"], "unread_messages");

    // Muted by the man: his offline copy gets no push, only the delayed email check.
    app.patch(
        &pair.path(""),
        Some(&pair.man.token),
        json!({ "is_muted": true }),
    )
    .await;
    say(&app, &pair, &pair.woman, "reply").await;
    let pushes = app.queued_jobs("send_push").await;
    assert!(
        pushes
            .iter()
            .all(|p| p["user_id"] != json!(pair.man.user_id))
    );
    // Online members get no push at all.
    let _socket = listen(&app, &pair.woman);
    clear_jobs(&app).await;
    say(&app, &pair, &pair.man, "three").await;
    assert_eq!(app.queued_jobs("send_push").await, Vec::<Value>::new());
}

// -------------------------------------------------------------------------------------------
// T-403: a message sent over REST arrives on the other member's socket
// -------------------------------------------------------------------------------------------

type Client =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn socket(address: std::net::SocketAddr, user: &TestUser) -> Client {
    let (mut client, _) = tokio_tungstenite::connect_async(format!("ws://{address}/v1/ws"))
        .await
        .expect("the upgrade succeeds");
    let auth = json!({ "type": "auth", "token": user.token }).to_string();
    client.send(WsMessage::text(auth)).await.unwrap();
    assert_eq!(next_of(&mut client, "ready").await["type"], "ready");
    client
}

/// The next frame of a type, skipping others (presence, counters).
async fn next_of(client: &mut Client, kind: &str) -> Value {
    let wait = async {
        loop {
            let frame = client
                .next()
                .await
                .expect("a frame")
                .expect("a valid frame");
            if let WsMessage::Text(text) = frame {
                let value: Value = serde_json::from_str(text.as_str()).unwrap();
                if value["type"] == kind {
                    return value;
                }
            }
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), wait)
        .await
        .unwrap_or_else(|_| panic!("no {kind} frame"))
}

#[sqlx::test]
async fn a_message_sent_over_rest_arrives_on_the_other_socket(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let address = app.serve().await;
    let mut his = socket(address, &pair.man).await;
    let mut hers = socket(address, &pair.woman).await;

    let sent = say(&app, &pair, &pair.man, "Assalam-o-Alaikum").await;
    assert_eq!(sent.status, StatusCode::CREATED);
    let arrived = next_of(&mut hers, "message.new").await;
    assert_eq!(arrived["data"]["message"]["id"], sent.json["id"]);
    assert_eq!(arrived["data"]["message"]["sender"], "them");
    assert_eq!(arrived["data"]["message"]["body"], "Assalam-o-Alaikum");
    let counters = next_of(&mut hers, "counters").await;
    assert_eq!(counters["data"]["unread_chats"], 1);
    let echoed = next_of(&mut his, "message.new").await;
    assert_eq!(echoed["data"]["message"]["sender"], "me");

    // A connection change reaches both, each rendered for its reader.
    app.post(
        &pair.path("/stage-proposals"),
        Some(&pair.woman.token),
        json!({ "stage": "families_talking" }),
    )
    .await;
    let updated = next_of(&mut his, "connection.updated").await;
    assert_eq!(
        updated["data"]["connection"]["pending_stage_proposal"]["proposed_by"],
        "them"
    );
    let updated = next_of(&mut hers, "connection.updated").await;
    assert_eq!(
        updated["data"]["connection"]["pending_stage_proposal"]["proposed_by"],
        "me"
    );
}
