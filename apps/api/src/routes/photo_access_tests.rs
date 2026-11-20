//! Tests of photo access (T-405): the request and its refusals, every transition of 03 section
//! 4.9 allowed and refused, ownership, the daily limit, the lists, the notifications and
//! `counters`, and that a grant and a revocation change the photos of
//! `GET /v1/profiles/{id}`.

use std::time::Duration as StdDuration;

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::domain::time::karachi_date;
use crate::realtime::hub::Registration;
use crate::test_support::{TestApp, TestResponse, TestUser};
use crate::views::testing::{add_photo, block_row, connect, exec, set_privacy, set_profile};

/// A female owner whose photos are blurred for strangers, and a male viewer.
struct World {
    app: TestApp,
    owner: TestUser,
    viewer: TestUser,
}

/// A female member with an approved photo that only connections see clear.
async fn private_owner(app: &TestApp) -> TestUser {
    let owner = app.member_of(Gender::Female).await;
    add_photo(app, owner.profile_id).await;
    set_privacy(app, owner.profile_id, "photo_visibility = 'connections'").await;
    owner
}

async fn world(db: PgPool) -> World {
    let app = TestApp::new(db).await;
    let owner = private_owner(&app).await;
    let viewer = app.member().await;
    World { app, owner, viewer }
}

/// `viewer` asks to see `owner`'s photos.
async fn ask_for(app: &TestApp, viewer: &TestUser, owner: &TestUser) -> TestResponse {
    app.post_empty(
        &format!("/v1/profiles/{}/photo-access", owner.profile_id),
        Some(&viewer.token),
    )
    .await
}

impl World {
    /// The viewer asks to see the owner's photos.
    async fn ask(&self) -> TestResponse {
        ask_for(&self.app, &self.viewer, &self.owner).await
    }

    /// `GET /v1/profiles/{owner}` as the viewer.
    async fn profile(&self) -> Value {
        let response = self
            .app
            .get(
                &format!("/v1/profiles/{}", self.owner.profile_id),
                Some(&self.viewer.token),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        response.json
    }

    /// The `photo_access.status` of the pair.
    async fn status(&self) -> Option<String> {
        sqlx::query_scalar(
            "SELECT status FROM photo_access WHERE owner_profile_id = $1 AND viewer_profile_id = $2",
        )
        .bind(self.owner.profile_id)
        .bind(self.viewer.profile_id)
        .fetch_optional(self.app.db())
        .await
        .unwrap()
    }

    /// The id of the pair's row.
    async fn access_id(&self) -> Uuid {
        sqlx::query_scalar(
            "SELECT id FROM photo_access WHERE owner_profile_id = $1 AND viewer_profile_id = $2",
        )
        .bind(self.owner.profile_id)
        .bind(self.viewer.profile_id)
        .fetch_one(self.app.db())
        .await
        .unwrap()
    }

    /// The owner answers a request: `grant` or `deny`.
    async fn answer(&self, id: Uuid, verb: &str) -> TestResponse {
        self.app
            .post_empty(
                &format!("/v1/me/photo-access/{id}/{verb}"),
                Some(&self.owner.token),
            )
            .await
    }

    fn grant_path(&self) -> String {
        format!("/v1/me/photo-access/grants/{}", self.viewer.profile_id)
    }

    /// The owner grants without a request.
    async fn grant(&self) -> TestResponse {
        self.app
            .put(&self.grant_path(), Some(&self.owner.token), json!({}))
            .await
    }

    /// The owner revokes.
    async fn revoke(&self) -> TestResponse {
        self.app
            .delete(&self.grant_path(), Some(&self.owner.token))
            .await
    }

    /// Moves every row, and every notification, back in time. The table trigger sets
    /// `updated_at` on each update, so it is switched off for the change.
    async fn age(&self, days: i32) {
        let db = self.app.db();
        sqlx::query("ALTER TABLE photo_access DISABLE TRIGGER photo_access_set_updated_at")
            .execute(db)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE photo_access SET updated_at = updated_at - make_interval(days => $1),
                 created_at = created_at - make_interval(days => $1)",
        )
        .bind(days)
        .execute(db)
        .await
        .unwrap();
        sqlx::query("ALTER TABLE photo_access ENABLE TRIGGER photo_access_set_updated_at")
            .execute(db)
            .await
            .unwrap();
        sqlx::query("UPDATE notifications SET created_at = created_at - make_interval(days => $1)")
            .bind(days)
            .execute(db)
            .await
            .unwrap();
    }
}

/// The types of a user's notifications, newest first.
async fn notification_types(app: &TestApp, user: &TestUser) -> Vec<String> {
    let response = app.get("/v1/notifications", Some(&user.token)).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    response.json["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["type"].as_str().unwrap().to_owned())
        .collect()
}

async fn pending_requests(app: &TestApp, user: &TestUser) -> i64 {
    let me = app.get("/v1/me", Some(&user.token)).await;
    me.json["counters"]["pending_photo_requests"]
        .as_i64()
        .unwrap()
}

async fn requests_sent_today(app: &TestApp, viewer: &TestUser) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(sum(count), 0)::bigint FROM usage_counters
         WHERE profile_id = $1 AND counter = 'photo_requests_sent'",
    )
    .bind(viewer.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap()
}

fn photo(detail: &Value) -> &Value {
    &detail["photos"][0]
}

// -------------------------------------------------------------------------------------------
// The "Done when" of T-405
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn a_granted_viewer_sees_clear_photos_and_a_revocation_blurs_them_again(db: PgPool) {
    let w = world(db).await;

    // Before: blurred, and the viewer may ask.
    let detail = w.profile().await;
    assert_eq!(photo(&detail)["is_blurred"], true);
    assert_eq!(photo(&detail)["large_url"], Value::Null);
    assert!(
        photo(&detail)["thumb_url"]
            .as_str()
            .unwrap()
            .contains("blur_thumb")
    );
    assert_eq!(detail["relation"]["photo_access"], "can_request");
    assert!(
        detail["locked"]
            .as_array()
            .unwrap()
            .contains(&json!("photos"))
    );

    // The request: 201 and pending.
    let asked = w.ask().await;
    assert_eq!(asked.status, StatusCode::CREATED, "{}", asked.text);
    assert_eq!(asked.json, json!({ "status": "pending" }));
    assert_eq!(w.status().await.as_deref(), Some("pending"));
    assert_eq!(w.profile().await["relation"]["photo_access"], "requested");
    assert_eq!(requests_sent_today(&w.app, &w.viewer).await, 1);

    // The owner sees it, is notified, and her counter shows it.
    assert_eq!(pending_requests(&w.app, &w.owner).await, 1);
    assert_eq!(
        notification_types(&w.app, &w.owner).await,
        ["photo_request_received"]
    );
    let feed = w
        .app
        .get("/v1/notifications", Some(&w.owner.token))
        .await
        .json;
    let access_id = w.access_id().await;
    assert_eq!(
        feed["items"][0]["actor"]["profile_id"],
        json!(w.viewer.profile_id)
    );
    assert_eq!(
        feed["items"][0]["data"],
        json!({ "photo_access_id": access_id })
    );

    // She approves: the viewer gets clear URLs and a notification.
    let granted = w.answer(access_id, "grant").await;
    assert_eq!(granted.status, StatusCode::NO_CONTENT, "{}", granted.text);
    assert_eq!(w.status().await.as_deref(), Some("granted"));
    let detail = w.profile().await;
    assert_eq!(photo(&detail)["is_blurred"], false);
    assert!(
        photo(&detail)["large_url"]
            .as_str()
            .unwrap()
            .contains("large.jpg")
    );
    assert_eq!(detail["relation"]["photo_access"], "visible");
    assert!(
        !detail["locked"]
            .as_array()
            .unwrap()
            .contains(&json!("photos"))
    );
    assert_eq!(detail["card"]["photo"]["is_blurred"], false);
    assert_eq!(
        notification_types(&w.app, &w.viewer).await,
        ["photo_request_granted"]
    );
    assert_eq!(pending_requests(&w.app, &w.owner).await, 0);

    // A viewer who can see the photos cannot ask.
    let again = w.ask().await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(again.code(), "invalid_state");

    // She revokes: blurred again at once, with no notification, and the viewer waits.
    let revoked = w.revoke().await;
    assert_eq!(revoked.status, StatusCode::NO_CONTENT, "{}", revoked.text);
    assert_eq!(w.status().await.as_deref(), Some("revoked"));
    let detail = w.profile().await;
    assert_eq!(photo(&detail)["is_blurred"], true);
    assert_eq!(photo(&detail)["large_url"], Value::Null);
    assert_eq!(detail["card"]["photo"]["is_blurred"], true);
    assert_eq!(detail["relation"]["photo_access"], "denied");
    assert_eq!(
        notification_types(&w.app, &w.viewer).await,
        ["photo_request_granted"]
    );
    let waiting = w.ask().await;
    assert_eq!(waiting.status, StatusCode::CONFLICT);
    assert_eq!(waiting.code(), "cooldown_active");
}

// -------------------------------------------------------------------------------------------
// The request and its refusals
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn a_request_is_refused_for_every_reason_of_09_section_6_3(db: PgPool) {
    let w = world(db).await;
    let app = &w.app;

    // Check 1: a profile the caller may not open does not exist for them.
    let missing = app
        .post_empty(
            &format!("/v1/profiles/{}/photo-access", Uuid::now_v7()),
            Some(&w.viewer.token),
        )
        .await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    let own = ask_for(app, &w.viewer, &w.viewer).await;
    assert_eq!(own.status, StatusCode::NOT_FOUND);
    let same_gender = app.member().await;
    add_photo(app, same_gender.profile_id).await;
    let same = ask_for(app, &w.viewer, &same_gender).await;
    assert_eq!(same.status, StatusCode::NOT_FOUND);
    let hidden = private_owner(app).await;
    set_privacy(app, hidden.profile_id, "discovery_visibility = 'hidden'").await;
    assert_eq!(
        ask_for(app, &w.viewer, &hidden).await.status,
        StatusCode::NOT_FOUND
    );
    let blocker = private_owner(app).await;
    block_row(app, blocker.profile_id, w.viewer.profile_id).await;
    assert_eq!(
        ask_for(app, &w.viewer, &blocker).await.status,
        StatusCode::NOT_FOUND
    );
    // Nothing was written by any refusal.
    assert_eq!(requests_sent_today(app, &w.viewer).await, 0);

    // Access level `browse`: a paused caller and a caller without a token.
    let paused = app.member().await;
    set_profile(app, paused.profile_id, "status = 'paused'").await;
    app.state.accounts.invalidate(paused.user_id);
    let refused = ask_for(app, &paused, &w.owner).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "profile_not_active");
    let refused = app
        .post_empty(
            &format!("/v1/profiles/{}/photo-access", w.owner.profile_id),
            None,
        )
        .await;
    assert_eq!(refused.status, StatusCode::UNAUTHORIZED);

    // Check 2: the viewer already sees the photos, whatever the reason.
    let open = app.member_of(Gender::Female).await;
    add_photo(app, open.profile_id).await;
    let visible = ask_for(app, &w.viewer, &open).await;
    assert_eq!(visible.status, StatusCode::CONFLICT);
    assert_eq!(visible.code(), "invalid_state");
    assert_eq!(visible.json["error"]["details"]["status"], "visible");
    let no_photo = app.member_of(Gender::Female).await;
    set_privacy(
        app,
        no_photo.profile_id,
        "photo_visibility = 'approved_only'",
    )
    .await;
    let visible = ask_for(app, &w.viewer, &no_photo).await;
    assert_eq!(visible.status, StatusCode::CONFLICT);
    assert_eq!(visible.code(), "invalid_state");
    // A connection sees `connections` photos clear.
    let friend = private_owner(app).await;
    connect(app, w.viewer.profile_id, friend.profile_id).await;
    let visible = ask_for(app, &w.viewer, &friend).await;
    assert_eq!(visible.status, StatusCode::CONFLICT);
    assert_eq!(visible.code(), "invalid_state");

    // Check 3: the owner switched requests off.
    set_privacy(app, w.owner.profile_id, "allow_photo_requests = false").await;
    let off = w.ask().await;
    assert_eq!(off.status, StatusCode::CONFLICT);
    assert_eq!(off.code(), "not_permitted_by_member");
    assert_eq!(off.json["error"]["details"]["reason"], "requests_off");
    assert_eq!(
        w.profile().await["relation"]["photo_access"],
        "requests_off"
    );
    set_privacy(app, w.owner.profile_id, "allow_photo_requests = true").await;
    assert_eq!(requests_sent_today(app, &w.viewer).await, 0);

    // Check 4: a pending request.
    assert_eq!(w.ask().await.status, StatusCode::CREATED);
    let twice = w.ask().await;
    assert_eq!(twice.status, StatusCode::CONFLICT);
    assert_eq!(twice.code(), "already_exists");
    assert_eq!(requests_sent_today(app, &w.viewer).await, 1);
    // Check 3 comes before check 4 (09 section 6.3), even though the profile then reads
    // `requested`.
    set_privacy(app, w.owner.profile_id, "allow_photo_requests = false").await;
    assert_eq!(w.ask().await.code(), "not_permitted_by_member");
}

#[sqlx::test]
async fn a_denial_blocks_asking_again_until_the_retry_period_has_passed(db: PgPool) {
    let w = world(db).await;
    assert_eq!(w.ask().await.status, StatusCode::CREATED);
    let id = w.access_id().await;

    let denied = w.answer(id, "deny").await;
    assert_eq!(denied.status, StatusCode::NO_CONTENT, "{}", denied.text);
    assert_eq!(w.status().await.as_deref(), Some("denied"));
    // Nobody is told, the viewer reads "denied" on the profile and the owner's count drops.
    assert_eq!(
        notification_types(&w.app, &w.viewer).await,
        Vec::<String>::new()
    );
    assert_eq!(pending_requests(&w.app, &w.owner).await, 0);
    let detail = w.profile().await;
    assert_eq!(detail["relation"]["photo_access"], "denied");
    assert_eq!(photo(&detail)["is_blurred"], true);

    // Check 5: `cooldown_active` with the day it ends, and nothing is consumed.
    let waiting = w.ask().await;
    assert_eq!(waiting.status, StatusCode::CONFLICT);
    assert_eq!(waiting.code(), "cooldown_active");
    let ends = karachi_date(OffsetDateTime::now_utc() + Duration::days(30));
    assert_eq!(
        waiting.json["error"]["details"]["retry_after_date"],
        json!(ends.to_string())
    );
    assert_eq!(requests_sent_today(&w.app, &w.viewer).await, 1);

    // 29 days later it is still refused; after 31 it works and is a new request.
    w.age(29).await;
    assert_eq!(w.ask().await.code(), "cooldown_active");
    w.age(2).await;
    assert_eq!(w.profile().await["relation"]["photo_access"], "can_request");
    let again = w.ask().await;
    assert_eq!(again.status, StatusCode::CREATED, "{}", again.text);
    assert_eq!(w.status().await.as_deref(), Some("pending"));
    assert_eq!(w.access_id().await, id, "the row is reused");
    let decided: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT decided_at FROM photo_access WHERE id = $1")
            .bind(id)
            .fetch_one(w.app.db())
            .await
            .unwrap();
    assert_eq!(decided, None);
    assert_eq!(pending_requests(&w.app, &w.owner).await, 1);
    // The earlier request's notification is older than the retry period, so this request
    // notifies again (14 section 7.2).
    assert_eq!(
        notification_types(&w.app, &w.owner).await,
        ["photo_request_received", "photo_request_received"]
    );
    // The row now says when this request was made.
    let listed = w.app.get("/v1/me/photo-access", Some(&w.owner.token)).await;
    let created = OffsetDateTime::parse(
        listed.json["items"][0]["created_at"].as_str().unwrap(),
        &Rfc3339,
    )
    .unwrap();
    assert!(OffsetDateTime::now_utc() - created < Duration::minutes(5));
}

#[sqlx::test]
async fn the_daily_limit_counts_requests_and_resets_with_the_day(db: PgPool) {
    let w = world(db).await;
    w.app
        .state
        .settings
        .put("limits.photo_requests_per_day", &json!(2), None)
        .await
        .unwrap();
    let second = private_owner(&w.app).await;
    let third = private_owner(&w.app).await;

    assert_eq!(w.ask().await.status, StatusCode::CREATED);
    assert_eq!(
        ask_for(&w.app, &w.viewer, &second).await.status,
        StatusCode::CREATED
    );
    let refused = ask_for(&w.app, &w.viewer, &third).await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(refused.code(), "limit_reached");
    let details = &refused.json["error"]["details"];
    assert_eq!(details["limit"], "photo_requests_per_day");
    assert_eq!(details["used"], 2);
    assert!(details["resets_at"].is_string());
    // The refused request left no row, and the counter stays at the limit.
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM photo_access WHERE owner_profile_id = $1")
            .bind(third.profile_id)
            .fetch_one(w.app.db())
            .await
            .unwrap();
    assert_eq!(rows, 0);
    assert_eq!(requests_sent_today(&w.app, &w.viewer).await, 2);
    assert_eq!(pending_requests(&w.app, &third).await, 0);

    // Another day, another allowance.
    exec(
        &w.app,
        "UPDATE usage_counters SET day = day - 1 WHERE profile_id = $1",
        w.viewer.profile_id,
    )
    .await;
    assert_eq!(
        ask_for(&w.app, &w.viewer, &third).await.status,
        StatusCode::CREATED
    );
}

// -------------------------------------------------------------------------------------------
// The owner answers
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn every_transition_of_03_section_4_9_is_allowed_and_nothing_else(db: PgPool) {
    let w = world(db).await;
    let ghost = Uuid::now_v7();

    // An unknown request answers 404, and so does revoking where there is no row.
    assert_eq!(w.answer(ghost, "grant").await.status, StatusCode::NOT_FOUND);
    assert_eq!(w.answer(ghost, "deny").await.status, StatusCode::NOT_FOUND);
    assert_eq!(w.revoke().await.status, StatusCode::NOT_FOUND, "no row yet");

    // pending -> denied; a denied request can be neither approved nor denied again.
    w.ask().await;
    let id = w.access_id().await;
    assert_eq!(w.answer(id, "deny").await.status, StatusCode::NO_CONTENT);
    for verb in ["grant", "deny"] {
        let refused = w.answer(id, verb).await;
        assert_eq!(refused.status, StatusCode::CONFLICT, "{verb}");
        assert_eq!(refused.code(), "invalid_state");
        assert_eq!(refused.json["error"]["details"]["status"], "denied");
    }
    let refused = w.revoke().await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    assert_eq!(refused.json["error"]["details"]["status"], "denied");

    // denied -> granted: the owner grants later without a new request.
    assert_eq!(w.grant().await.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("granted"));
    assert_eq!(w.access_id().await, id);

    // granted: neither answer applies; granting again changes nothing.
    for verb in ["grant", "deny"] {
        let refused = w.answer(id, verb).await;
        assert_eq!(refused.status, StatusCode::CONFLICT, "{verb}");
        assert_eq!(refused.json["error"]["details"]["status"], "granted");
    }
    assert_eq!(w.grant().await.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("granted"));

    // granted -> revoked; revoking again is refused.
    assert_eq!(w.revoke().await.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("revoked"));
    let refused = w.revoke().await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    assert_eq!(refused.json["error"]["details"]["status"], "revoked");
    let refused = w.answer(id, "grant").await;
    assert_eq!(refused.json["error"]["details"]["status"], "revoked");

    // revoked -> granted: the owner grants again.
    assert_eq!(w.grant().await.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("granted"));

    // revoked -> pending after the retry period, then pending -> granted by the request.
    assert_eq!(w.revoke().await.status, StatusCode::NO_CONTENT);
    w.age(31).await;
    assert_eq!(w.ask().await.status, StatusCode::CREATED);
    assert_eq!(w.status().await.as_deref(), Some("pending"));
    // A pending request cannot be revoked.
    let refused = w.revoke().await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    assert_eq!(refused.json["error"]["details"]["status"], "pending");
    assert_eq!(w.answer(id, "grant").await.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("granted"));
    // Every step above reused the one row of the pair.
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM photo_access")
        .fetch_one(w.app.db())
        .await
        .unwrap();
    assert_eq!(rows, 1);
}

#[sqlx::test]
async fn only_the_owner_can_answer_a_request(db: PgPool) {
    let w = world(db).await;
    w.ask().await;
    let id = w.access_id().await;

    // Another member, and the viewer who asked, do not own the request: it does not exist
    // for them.
    let stranger = w.app.member_of(Gender::Female).await;
    for (who, token) in [("stranger", &stranger.token), ("viewer", &w.viewer.token)] {
        for verb in ["grant", "deny"] {
            let refused = w
                .app
                .post_empty(&format!("/v1/me/photo-access/{id}/{verb}"), Some(token))
                .await;
            assert_eq!(refused.status, StatusCode::NOT_FOUND, "{who} {verb}");
        }
    }
    assert_eq!(w.status().await.as_deref(), Some("pending"));

    // Another member cannot revoke on the owner's behalf: they reach only their own rows.
    let revoked = w
        .app
        .delete(
            &format!("/v1/me/photo-access/grants/{}", w.viewer.profile_id),
            Some(&stranger.token),
        )
        .await;
    assert_eq!(revoked.status, StatusCode::NOT_FOUND);
    // Their own grant creates a row of theirs and leaves the owner's request alone.
    let granted = w
        .app
        .put(
            &format!("/v1/me/photo-access/grants/{}", w.viewer.profile_id),
            Some(&stranger.token),
            json!({}),
        )
        .await;
    assert_eq!(granted.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("pending"));
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM photo_access")
        .fetch_one(w.app.db())
        .await
        .unwrap();
    assert_eq!(rows, 2);

    // The owner can.
    assert_eq!(w.answer(id, "grant").await.status, StatusCode::NO_CONTENT);

    // The `engage` level: a closed profile may not use any owner endpoint.
    set_profile(&w.app, w.owner.profile_id, "status = 'closed'").await;
    w.app.state.accounts.invalidate(w.owner.user_id);
    for response in [
        w.app.get("/v1/me/photo-access", Some(&w.owner.token)).await,
        w.answer(id, "deny").await,
        w.revoke().await,
        w.grant().await,
    ] {
        assert_eq!(response.status, StatusCode::FORBIDDEN);
        assert_eq!(response.code(), "profile_not_active");
    }
}

#[sqlx::test]
async fn a_grant_without_a_request_needs_a_profile_the_owner_can_open(db: PgPool) {
    let w = world(db).await;

    // Same gender, unknown, own, blocked and hidden members do not exist for the owner.
    let woman = w.app.member_of(Gender::Female).await;
    for path in [
        format!("/v1/me/photo-access/grants/{}", woman.profile_id),
        format!("/v1/me/photo-access/grants/{}", Uuid::now_v7()),
        format!("/v1/me/photo-access/grants/{}", w.owner.profile_id),
    ] {
        let refused = w.app.put(&path, Some(&w.owner.token), json!({})).await;
        assert_eq!(refused.status, StatusCode::NOT_FOUND, "{path}");
    }
    block_row(&w.app, w.viewer.profile_id, w.owner.profile_id).await;
    assert_eq!(w.grant().await.status, StatusCode::NOT_FOUND);
    exec(
        &w.app,
        "DELETE FROM blocks WHERE blocker_profile_id = $1",
        w.viewer.profile_id,
    )
    .await;
    set_privacy(
        &w.app,
        w.viewer.profile_id,
        "discovery_visibility = 'hidden'",
    )
    .await;
    assert_eq!(w.grant().await.status, StatusCode::NOT_FOUND);
    set_privacy(
        &w.app,
        w.viewer.profile_id,
        "discovery_visibility = 'everyone'",
    )
    .await;
    assert_eq!(w.status().await, None);

    // A grant gives clear photos in the strictest mode too, and notifies once.
    set_privacy(
        &w.app,
        w.owner.profile_id,
        "photo_visibility = 'approved_only'",
    )
    .await;
    connect(&w.app, w.viewer.profile_id, w.owner.profile_id).await;
    assert_eq!(photo(&w.profile().await)["is_blurred"], true);
    assert_eq!(w.grant().await.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("granted"));
    assert_eq!(photo(&w.profile().await)["is_blurred"], false);
    assert_eq!(w.grant().await.status, StatusCode::NO_CONTENT);
    assert_eq!(
        notification_types(&w.app, &w.viewer).await,
        ["photo_request_granted"]
    );
    assert_eq!(w.revoke().await.status, StatusCode::NO_CONTENT);
    assert_eq!(photo(&w.profile().await)["is_blurred"], true);

    // Granting over a pending request is its approval: the owner's count drops.
    let other = private_owner(&w.app).await;
    assert_eq!(
        ask_for(&w.app, &w.viewer, &other).await.status,
        StatusCode::CREATED
    );
    assert_eq!(pending_requests(&w.app, &other).await, 1);
    let granted = w
        .app
        .put(
            &format!("/v1/me/photo-access/grants/{}", w.viewer.profile_id),
            Some(&other.token),
            json!({}),
        )
        .await;
    assert_eq!(granted.status, StatusCode::NO_CONTENT, "{}", granted.text);
    assert_eq!(pending_requests(&w.app, &other).await, 0);
    let status: String = sqlx::query_scalar(
        "SELECT status FROM photo_access WHERE owner_profile_id = $1 AND viewer_profile_id = $2",
    )
    .bind(other.profile_id)
    .bind(w.viewer.profile_id)
    .fetch_one(w.app.db())
    .await
    .unwrap();
    assert_eq!(status, "granted");
}

// -------------------------------------------------------------------------------------------
// Lists
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn the_lists_show_received_and_sent_requests_by_status(db: PgPool) {
    let w = world(db).await;
    let second = w.app.member().await;
    // Two men ask the same woman.
    w.ask().await;
    assert_eq!(
        ask_for(&w.app, &second, &w.owner).await.status,
        StatusCode::CREATED
    );

    // `received` is the default box and `pending` the default status; newest first.
    let received = w.app.get("/v1/me/photo-access", Some(&w.owner.token)).await;
    assert_eq!(received.status, StatusCode::OK, "{}", received.text);
    let items = received.json["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["profile_id"], json!(second.profile_id));
    assert_eq!(items[1]["profile_id"], json!(w.viewer.profile_id));
    assert_eq!(items[0]["status"], "pending");
    assert_eq!(items[0]["profile"]["id"], json!(second.profile_id));
    assert_eq!(received.json["next_cursor"], Value::Null);
    assert!(items[0]["id"].is_string() && items[0]["created_at"].is_string());

    // Pagination by cursor.
    let first = w
        .app
        .get(
            "/v1/me/photo-access?box=received&status=pending&limit=1",
            Some(&w.owner.token),
        )
        .await;
    assert_eq!(first.json["items"].as_array().unwrap().len(), 1);
    let cursor = first.json["next_cursor"].as_str().unwrap().to_owned();
    let next = w
        .app
        .get(
            &format!("/v1/me/photo-access?limit=1&cursor={cursor}"),
            Some(&w.owner.token),
        )
        .await;
    assert_eq!(
        next.json["items"][0]["profile_id"],
        json!(w.viewer.profile_id)
    );
    assert_eq!(next.json["next_cursor"], Value::Null);

    // The viewer's own list: his request, with the owner's card.
    let sent = w
        .app
        .get("/v1/me/photo-access?box=sent", Some(&w.viewer.token))
        .await;
    let items = sent.json["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["profile_id"], json!(w.owner.profile_id));
    assert_eq!(items[0]["profile"]["id"], json!(w.owner.profile_id));
    assert_eq!(items[0]["profile"]["photo"]["is_blurred"], true);

    // Approve one and deny the other: the filters follow.
    let id = w.access_id().await;
    w.answer(id, "grant").await;
    let denied_id: Uuid =
        sqlx::query_scalar("SELECT id FROM photo_access WHERE viewer_profile_id = $1")
            .bind(second.profile_id)
            .fetch_one(w.app.db())
            .await
            .unwrap();
    w.answer(denied_id, "deny").await;
    let owner_ids = |status: &'static str| {
        let app = &w.app;
        let token = w.owner.token.clone();
        async move {
            app.get(
                &format!("/v1/me/photo-access?box=received&status={status}"),
                Some(&token),
            )
            .await
            .json["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["id"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(owner_ids("pending").await, Vec::<String>::new());
    assert_eq!(owner_ids("granted").await, [id.to_string()]);
    assert_eq!(owner_ids("denied").await, [denied_id.to_string()]);
    assert_eq!(owner_ids("revoked").await, Vec::<String>::new());
    // The sender sees an approved request, but is never shown a denial or a removal.
    let sent_count = |status: &'static str, token: String| {
        let app = &w.app;
        async move {
            app.get(
                &format!("/v1/me/photo-access?box=sent&status={status}"),
                Some(&token),
            )
            .await
            .json["items"]
                .as_array()
                .unwrap()
                .len()
        }
    };
    assert_eq!(sent_count("granted", w.viewer.token.clone()).await, 1);
    assert_eq!(sent_count("denied", second.token.clone()).await, 0);
    assert_eq!(sent_count("pending", second.token.clone()).await, 0);
    w.revoke().await;
    assert_eq!(sent_count("granted", w.viewer.token.clone()).await, 0);
    assert_eq!(sent_count("revoked", w.viewer.token.clone()).await, 0);

    // Bad values are 400.
    for query in ["box=outbox", "status=maybe", "limit=x"] {
        let bad = w
            .app
            .get(
                &format!("/v1/me/photo-access?{query}"),
                Some(&w.owner.token),
            )
            .await;
        assert_eq!(bad.status, StatusCode::BAD_REQUEST, "{query}");
    }
}

#[sqlx::test]
async fn a_member_who_can_no_longer_be_opened_stays_listed_with_a_null_profile(db: PgPool) {
    let w = world(db).await;
    w.ask().await;
    let id = w.access_id().await;
    w.answer(id, "grant").await;
    exec(
        &w.app,
        "UPDATE users SET status = 'suspended' WHERE id = (SELECT user_id FROM profiles WHERE id = $1)",
        w.viewer.profile_id,
    )
    .await;
    w.app.state.accounts.invalidate(w.viewer.user_id);

    let listed = w
        .app
        .get("/v1/me/photo-access?status=granted", Some(&w.owner.token))
        .await;
    let item = &listed.json["items"][0];
    assert_eq!(item["profile_id"], json!(w.viewer.profile_id));
    assert_eq!(item["profile"], Value::Null);
    // So the grant can still be removed.
    assert_eq!(w.revoke().await.status, StatusCode::NO_CONTENT);
    assert_eq!(w.status().await.as_deref(), Some("revoked"));
}

// -------------------------------------------------------------------------------------------
// Real time
// -------------------------------------------------------------------------------------------

/// Reads frames until one of `kind` arrives.
async fn frame_of(socket: &mut Registration, kind: &str) -> Value {
    loop {
        let frame = tokio::time::timeout(StdDuration::from_secs(2), socket.receiver.recv())
            .await
            .expect("a frame arrives in time")
            .expect("the socket is open");
        let frame: Value = serde_json::from_str(&frame).unwrap();
        if frame["type"] == kind {
            return frame;
        }
    }
}

#[sqlx::test]
async fn counters_and_notifications_are_pushed_to_the_right_member(db: PgPool) {
    let w = world(db).await;
    let mut owner_socket = w
        .app
        .state
        .hub
        .register(w.owner.profile_id, w.owner.user_id);
    let mut viewer_socket = w
        .app
        .state
        .hub
        .register(w.viewer.profile_id, w.viewer.user_id);

    // The request reaches the owner as a notification and a count of one.
    w.ask().await;
    let notification = frame_of(&mut owner_socket, "notification.new").await;
    assert_eq!(
        notification["data"]["notification"]["type"],
        "photo_request_received"
    );
    let counters = frame_of(&mut owner_socket, "counters").await;
    assert_eq!(counters["data"]["pending_photo_requests"], 1);

    // Approving sends the owner a count of zero and the viewer a notification.
    let id = w.access_id().await;
    w.answer(id, "grant").await;
    let counters = frame_of(&mut owner_socket, "counters").await;
    assert_eq!(counters["data"]["pending_photo_requests"], 0);
    let notification = frame_of(&mut viewer_socket, "notification.new").await;
    assert_eq!(
        notification["data"]["notification"]["type"],
        "photo_request_granted"
    );
    assert_eq!(
        notification["data"]["notification"]["actor"]["profile_id"],
        json!(w.owner.profile_id)
    );

    // Denying a second request sends the owner the new count.
    let other = w.app.member().await;
    assert_eq!(
        ask_for(&w.app, &other, &w.owner).await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        frame_of(&mut owner_socket, "counters").await["data"]["pending_photo_requests"],
        1
    );
    let denied_id: Uuid =
        sqlx::query_scalar("SELECT id FROM photo_access WHERE viewer_profile_id = $1")
            .bind(other.profile_id)
            .fetch_one(w.app.db())
            .await
            .unwrap();
    w.answer(denied_id, "deny").await;
    assert_eq!(
        frame_of(&mut owner_socket, "counters").await["data"]["pending_photo_requests"],
        0
    );
}
