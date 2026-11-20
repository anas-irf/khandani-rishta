//! Tests of connections (T-402, T-404): the chat list, mute and archive, ending, every route's
//! refusal for a non-member and for the access levels. Messages are in [`chat`], contact
//! sharing and stages in [`sharing`].

mod chat;
mod sharing;

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::domain::types::{ProfileStatus, UserStatus};
use crate::realtime::hub::Registration;
use crate::test_support::{TestApp, TestResponse, TestUser};
use crate::views::testing::exec;

/// A man and a woman connected through the API: he sends an interest, she accepts.
pub(super) struct Pair {
    pub man: TestUser,
    pub woman: TestUser,
    pub id: Uuid,
}

impl Pair {
    pub fn path(&self, rest: &str) -> String {
        format!("/v1/connections/{}{rest}", self.id)
    }
}

pub(super) async fn connect_through_api(app: &TestApp, man: TestUser, woman: TestUser) -> Pair {
    let sent = app
        .post(
            "/v1/interests",
            Some(&man.token),
            json!({ "receiver_profile_id": woman.profile_id }),
        )
        .await;
    assert_eq!(sent.status, StatusCode::CREATED, "{}", sent.text);
    let id = sent.json["interest"]["id"].as_str().unwrap();
    let accepted = app
        .post_empty(&format!("/v1/interests/{id}/accept"), Some(&woman.token))
        .await;
    assert_eq!(accepted.status, StatusCode::OK, "{}", accepted.text);
    let id = accepted.json["connection"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    Pair { man, woman, id }
}

pub(super) async fn pair(app: &TestApp) -> Pair {
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    connect_through_api(app, man, woman).await
}

pub(super) async fn say(app: &TestApp, pair: &Pair, from: &TestUser, body: &str) -> TestResponse {
    app.post(
        &pair.path("/messages"),
        Some(&from.token),
        json!({ "body": body, "client_message_id": Uuid::now_v7() }),
    )
    .await
}

pub(super) async fn scalar(app: &TestApp, sql: &str, id: Uuid) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .bind(id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

pub(super) async fn text(app: &TestApp, sql: &str, id: Uuid) -> Option<String> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .bind(id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

/// Registers a fake socket for a member, to read the events sent to them.
pub(super) fn listen(app: &TestApp, user: &TestUser) -> Registration {
    app.state.hub.register(user.profile_id, user.user_id)
}

pub(super) fn events(socket: &mut Registration) -> Vec<Value> {
    let mut events = Vec::new();
    while let Ok(text) = socket.receiver.try_recv() {
        events.push(serde_json::from_str(&text).unwrap());
    }
    events
}

pub(super) fn of_type<'a>(events: &'a [Value], kind: &str) -> Vec<&'a Value> {
    events.iter().filter(|e| e["type"] == kind).collect()
}

/// The counters as the one query of 14 section 8.1 computes them.
pub(super) async fn counters(app: &TestApp, user: &TestUser) -> crate::db::counters::Counters {
    crate::db::counters::load(app.db(), user.profile_id, user.user_id)
        .await
        .unwrap()
}

#[sqlx::test]
async fn the_chat_list_renders_each_members_side(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;

    let his = app.get("/v1/connections", Some(&pair.man.token)).await;
    assert_eq!(his.status, StatusCode::OK, "{}", his.text);
    let item = &his.json["items"][0];
    assert_eq!(item["id"], json!(pair.id));
    assert_eq!(item["status"], "active");
    assert_eq!(item["stage"], "chatting");
    assert_eq!(item["other"]["id"], json!(pair.woman.profile_id));
    assert_eq!(item["other"]["relation"]["tier"], "connection");
    assert_eq!(
        item["last_message_preview"],
        Value::Null,
        "only a system message so far"
    );
    assert!(item["last_message_at"].is_string());
    assert_eq!(item["unread_count"], 0);
    assert_eq!(item["pending_stage_proposal"], Value::Null);
    assert_eq!(item["ended_by"], Value::Null);
    assert_eq!(item["my_contact_share"], Value::Null);
    assert_eq!(item["their_contact"], Value::Null);
    let hers = app.get(&pair.path(""), Some(&pair.woman.token)).await;
    assert_eq!(hers.json["other"]["id"], json!(pair.man.profile_id));

    // A newer conversation comes first; ended ones only under `ended`.
    let other_woman = app.member_of(Gender::Female).await;
    let man = pair.man.clone();
    let newer = connect_through_api(&app, man, other_woman).await;
    let list = app
        .get("/v1/connections?limit=1", Some(&pair.man.token))
        .await;
    assert_eq!(list.json["items"][0]["id"], json!(newer.id));
    let cursor = list.json["next_cursor"].as_str().unwrap();
    let next = app
        .get(
            &format!("/v1/connections?limit=1&cursor={cursor}"),
            Some(&pair.man.token),
        )
        .await;
    assert_eq!(next.json["items"][0]["id"], json!(pair.id));
    assert_eq!(next.json["next_cursor"], Value::Null);
    say(&app, &pair, &pair.woman, "Assalam-o-Alaikum").await;
    let reordered = app.get("/v1/connections", Some(&pair.man.token)).await;
    assert_eq!(reordered.json["items"][0]["id"], json!(pair.id));
    assert_eq!(
        reordered.json["items"][0]["last_message_preview"],
        "Assalam-o-Alaikum"
    );
    assert_eq!(reordered.json["items"][0]["unread_count"], 1);
    let ended = app
        .get("/v1/connections?filter=ended", Some(&pair.man.token))
        .await;
    assert_eq!(ended.json["items"], json!([]));
}

#[sqlx::test]
async fn mute_and_archive_are_per_member(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let mut his_socket = listen(&app, &pair.man);
    let mut her_socket = listen(&app, &pair.woman);

    let archived = app
        .patch(
            &pair.path(""),
            Some(&pair.man.token),
            json!({ "is_archived": true, "is_muted": true }),
        )
        .await;
    assert_eq!(archived.status, StatusCode::OK, "{}", archived.text);
    assert_eq!(archived.json["is_archived"], true);
    assert_eq!(archived.json["is_muted"], true);
    assert_eq!(
        of_type(&events(&mut his_socket), "connection.updated").len(),
        1
    );
    assert!(
        events(&mut her_socket).is_empty(),
        "the other member never knows"
    );
    let hers = app.get(&pair.path(""), Some(&pair.woman.token)).await;
    assert_eq!(hers.json["is_archived"], false);
    assert_eq!(hers.json["is_muted"], false);

    let active = app.get("/v1/connections", Some(&pair.man.token)).await;
    assert_eq!(active.json["items"], json!([]));
    let in_archive = app
        .get("/v1/connections?filter=archived", Some(&pair.man.token))
        .await;
    assert_eq!(in_archive.json["items"][0]["id"], json!(pair.id));

    // A muted chat does not count in unread_chats, but its own row still shows the count.
    say(&app, &pair, &pair.woman, "Salaam").await;
    assert_eq!(counters(&app, &pair.man).await.unread_chats, 0);
    let row = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(row.json["unread_count"], 1);
    // A new message cleared the archive flag.
    assert_eq!(row.json["is_archived"], false);
    app.patch(
        &pair.path(""),
        Some(&pair.man.token),
        json!({ "is_muted": false }),
    )
    .await;
    assert_eq!(counters(&app, &pair.man).await.unread_chats, 1);
    let unknown = app
        .patch(
            &pair.path(""),
            Some(&pair.man.token),
            json!({ "pinned": true }),
        )
        .await;
    assert_eq!(unknown.code(), "bad_request");
}

/// T-404: ending a connection revokes both shares (and the rest of 11 section 5.4).
#[sqlx::test]
async fn ending_a_connection_revokes_both_shares(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    for user in [&pair.man, &pair.woman] {
        exec(
            &app,
            "INSERT INTO profile_contacts (profile_id, phone_e164) VALUES ($1, '+923001234567')",
            user.profile_id,
        )
        .await;
        let shared = app
            .put(
                &pair.path("/contact-share"),
                Some(&user.token),
                json!({ "share_phone": true, "share_whatsapp": false, "share_email": false, "share_guardian": false }),
            )
            .await;
        assert_eq!(shared.status, StatusCode::OK, "{}", shared.text);
    }
    exec(
        &app,
        "INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status)
         SELECT $1, p.id, 'granted' FROM profiles p WHERE p.gender = 'male'",
        pair.woman.profile_id,
    )
    .await;
    let proposed = app
        .post(
            &pair.path("/stage-proposals"),
            Some(&pair.woman.token),
            json!({ "stage": "families_talking" }),
        )
        .await;
    assert_eq!(proposed.status, StatusCode::OK, "{}", proposed.text);
    let mut her_socket = listen(&app, &pair.woman);

    let ended = app
        .post(
            &pair.path("/end"),
            Some(&pair.man.token),
            json!({ "reason": "not_compatible" }),
        )
        .await;
    assert_eq!(ended.status, StatusCode::OK, "{}", ended.text);
    assert_eq!(ended.json["status"], "ended");
    assert_eq!(ended.json["ended_by"], "me");
    assert_eq!(ended.json["ended_reason"], "not_compatible");
    assert!(ended.json["ended_at"].is_string());
    assert_eq!(ended.json["my_contact_share"]["status"], "revoked");
    assert_eq!(ended.json["their_contact"], Value::Null);
    assert_eq!(ended.json["pending_stage_proposal"], Value::Null);

    assert_eq!(
        scalar(
            &app,
            "SELECT count(*) FROM contact_shares WHERE connection_id = $1 AND status = 'revoked'",
            pair.id
        )
        .await,
        2
    );
    assert_eq!(
        text(
            &app,
            "SELECT status FROM photo_access WHERE owner_profile_id = $1",
            pair.woman.profile_id
        )
        .await
        .as_deref(),
        Some("revoked")
    );
    assert_eq!(
        text(
            &app,
            "SELECT status FROM connection_stage_proposals WHERE connection_id = $1",
            pair.id
        )
        .await
        .as_deref(),
        Some("cancelled")
    );
    assert_eq!(
        text(
            &app,
            "SELECT system_event FROM messages WHERE connection_id = $1 ORDER BY id DESC LIMIT 1",
            pair.id
        )
        .await
        .as_deref(),
        Some("connection_ended")
    );

    // She sees that it ended, never why, and is not notified.
    let hers = app.get(&pair.path(""), Some(&pair.woman.token)).await;
    assert_eq!(hers.json["ended_by"], "them");
    assert_eq!(hers.json["ended_reason"], Value::Null);
    assert_eq!(hers.json["their_contact"], Value::Null);
    let seen = events(&mut her_socket);
    assert_eq!(of_type(&seen, "connection.updated").len(), 1);
    assert_eq!(of_type(&seen, "message.new").len(), 1);
    assert_eq!(of_type(&seen, "notification.new"), Vec::<&Value>::new());
    let list = app
        .get("/v1/connections?filter=ended", Some(&pair.woman.token))
        .await;
    assert_eq!(list.json["items"][0]["id"], json!(pair.id));

    // Read-only, and 90 days before either may send an interest.
    assert_eq!(
        say(&app, &pair, &pair.woman, "Salaam").await.code(),
        "connection_ended"
    );
    let again = app
        .post(
            &pair.path("/end"),
            Some(&pair.woman.token),
            json!({ "reason": "other" }),
        )
        .await;
    assert_eq!(again.code(), "connection_ended");
    for (from, to) in [(&pair.man, &pair.woman), (&pair.woman, &pair.man)] {
        let refused = app
            .post(
                "/v1/interests",
                Some(&from.token),
                json!({ "receiver_profile_id": to.profile_id }),
            )
            .await;
        assert_eq!(refused.code(), "cooldown_active", "{}", refused.text);
    }
    let history = app
        .get(&pair.path("/messages"), Some(&pair.woman.token))
        .await;
    assert_eq!(history.status, StatusCode::OK, "history stays readable");
}

#[sqlx::test]
async fn ending_can_also_block(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let reasons = app
        .post(
            &pair.path("/end"),
            Some(&pair.woman.token),
            json!({ "reason": "blocked" }),
        )
        .await;
    assert_eq!(
        reasons.code(),
        "bad_request",
        "system reasons are not for members"
    );

    let ended = app
        .post(
            &pair.path("/end"),
            Some(&pair.woman.token),
            json!({ "reason": "inappropriate_behaviour", "also_block": true }),
        )
        .await;
    assert_eq!(ended.status, StatusCode::OK, "{}", ended.text);
    assert_eq!(ended.json["ended_reason"], "inappropriate_behaviour");
    assert_eq!(ended.json["other"], Value::Null);
    assert_eq!(
        scalar(
            &app,
            "SELECT count(*) FROM blocks WHERE blocker_profile_id = $1",
            pair.woman.profile_id
        )
        .await,
        1
    );
    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(
        his.json["ended_by"], "them",
        "a block looks like any other ending"
    );
}

/// Every connection route answers `404` to a member of neither side, and for an unknown id.
#[sqlx::test]
async fn a_non_member_gets_404_everywhere(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let said = say(&app, &pair, &pair.man, "Salaam").await;
    let message_id = said.json["id"].as_str().unwrap().to_owned();
    let proposal = app
        .post(
            &pair.path("/stage-proposals"),
            Some(&pair.man.token),
            json!({ "stage": "engaged" }),
        )
        .await;
    let proposal_id = proposal.json["pending_stage_proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let stranger = app.member_of(Gender::Female).await;
    let share = json!({ "share_phone": true, "share_whatsapp": false, "share_email": false, "share_guardian": false });

    for id in [pair.id, Uuid::now_v7()] {
        let base = format!("/v1/connections/{id}");
        let requests: Vec<(&str, String, Option<Value>)> = vec![
            ("GET", base.clone(), None),
            ("PATCH", base.clone(), Some(json!({ "is_muted": true }))),
            (
                "POST",
                format!("{base}/end"),
                Some(json!({ "reason": "other" })),
            ),
            ("GET", format!("{base}/messages"), None),
            (
                "POST",
                format!("{base}/messages"),
                Some(json!({ "body": "hi", "client_message_id": Uuid::now_v7() })),
            ),
            ("DELETE", format!("{base}/messages/{message_id}"), None),
            (
                "POST",
                format!("{base}/read"),
                Some(json!({ "up_to_message_id": message_id })),
            ),
            ("PUT", format!("{base}/contact-share"), Some(share.clone())),
            ("DELETE", format!("{base}/contact-share"), None),
            (
                "POST",
                format!("{base}/stage-proposals"),
                Some(json!({ "stage": "nikah_done" })),
            ),
            (
                "POST",
                format!("{base}/stage-proposals/{proposal_id}/confirm"),
                None,
            ),
            (
                "POST",
                format!("{base}/stage-proposals/{proposal_id}/decline"),
                None,
            ),
            (
                "DELETE",
                format!("{base}/stage-proposals/{proposal_id}"),
                None,
            ),
        ];
        for (method, path, body) in requests {
            let response = app
                .request(method, &path, Some(&stranger.token), body)
                .await;
            assert_eq!(
                response.status,
                StatusCode::NOT_FOUND,
                "{method} {path}: {}",
                response.text
            );
        }
    }
    let list = app.get("/v1/connections", Some(&stranger.token)).await;
    assert_eq!(list.json["items"], json!([]));
    // Nothing changed for the members.
    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(his.json["status"], "active");
    assert_eq!(his.json["is_muted"], false);
}

#[sqlx::test]
async fn access_levels_are_enforced(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let body = || json!({ "body": "Salaam", "client_message_id": Uuid::now_v7() });

    assert_eq!(
        app.get("/v1/connections", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    // `connected`: a closed profile still reads and may end, but `engage` routes refuse it.
    exec(
        &app,
        "UPDATE profiles SET status = 'closed', closed_reason = 'other', closed_at = now() WHERE id = $1",
        pair.man.profile_id,
    )
    .await;
    app.state.accounts.invalidate(pair.man.user_id);
    assert_eq!(
        app.get(&pair.path(""), Some(&pair.man.token)).await.status,
        StatusCode::OK
    );
    assert_eq!(
        app.get(&pair.path("/messages"), Some(&pair.man.token))
            .await
            .status,
        StatusCode::OK
    );
    let engage_routes: Vec<(&str, String, Option<Value>)> = vec![
        ("POST", pair.path("/messages"), Some(body())),
        (
            "DELETE",
            pair.path(&format!("/messages/{}", Uuid::now_v7())),
            None,
        ),
        (
            "PUT",
            pair.path("/contact-share"),
            Some(
                json!({ "share_phone": true, "share_whatsapp": false, "share_email": false, "share_guardian": false }),
            ),
        ),
        (
            "POST",
            pair.path("/stage-proposals"),
            Some(json!({ "stage": "engaged" })),
        ),
        (
            "POST",
            pair.path(&format!("/stage-proposals/{}/confirm", Uuid::now_v7())),
            None,
        ),
        (
            "POST",
            pair.path(&format!("/stage-proposals/{}/decline", Uuid::now_v7())),
            None,
        ),
        (
            "DELETE",
            pair.path(&format!("/stage-proposals/{}", Uuid::now_v7())),
            None,
        ),
    ];
    for (method, path, payload) in engage_routes {
        let response = app
            .request(method, &path, Some(&pair.man.token), payload)
            .await;
        assert_eq!(response.code(), "profile_not_active", "{method} {path}");
    }
    // A paused profile may still chat.
    exec(
        &app,
        "UPDATE profiles SET status = 'paused', paused_at = now() WHERE id = $1",
        pair.woman.profile_id,
    )
    .await;
    app.state.accounts.invalidate(pair.woman.user_id);
    let sent = app
        .post(&pair.path("/messages"), Some(&pair.woman.token), body())
        .await;
    assert_eq!(sent.status, StatusCode::CREATED, "{}", sent.text);

    let draft = app.draft_user().await;
    assert_eq!(
        app.get("/v1/connections", Some(&draft.token)).await.code(),
        "onboarding_required"
    );
    let suspended = app
        .member_with(|spec| spec.user_status = UserStatus::Suspended)
        .await;
    assert_eq!(
        app.get("/v1/connections", Some(&suspended.token))
            .await
            .code(),
        "account_suspended"
    );
    let no_consent = app.member_with(|spec| spec.consents = false).await;
    assert_eq!(
        app.get("/v1/connections", Some(&no_consent.token))
            .await
            .code(),
        "consent_required"
    );
    let review = app
        .member_with(|spec| spec.status = ProfileStatus::PendingReview)
        .await;
    assert_eq!(
        app.get("/v1/connections", Some(&review.token)).await.code(),
        "profile_not_active"
    );
}

/// 03 section 8 invariant 9: a message can only be created in an active connection by one of
/// its two members.
#[sqlx::test]
async fn invariant_9_chat_needs_a_connection(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let stranger = app.member().await;
    let body = json!({ "body": "Salaam", "client_message_id": Uuid::now_v7() });
    let outsider = app
        .post(&pair.path("/messages"), Some(&stranger.token), body.clone())
        .await;
    assert_eq!(outsider.status, StatusCode::NOT_FOUND);
    app.post(
        &pair.path("/end"),
        Some(&pair.man.token),
        json!({ "reason": "no_response" }),
    )
    .await;
    let after_end = app
        .post(&pair.path("/messages"), Some(&pair.man.token), body)
        .await;
    assert_eq!(after_end.code(), "connection_ended");
    let texts = scalar(
        &app,
        "SELECT count(*) FROM messages WHERE connection_id = $1 AND kind = 'text'",
        pair.id,
    )
    .await;
    assert_eq!(texts, 0);
    let strays: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM messages m
         JOIN connections c ON c.id = m.connection_id
         WHERE m.kind = 'text'
           AND m.sender_profile_id NOT IN (c.profile_low_id, c.profile_high_id)",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(strays, 0);
}
