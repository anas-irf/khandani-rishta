//! The endpoints of 15 sections 6 and 14: the feed, marking as read, notification preferences
//! and push devices.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::{World, add_interest, block};
use crate::domain::types::{NotificationType as T, UserStatus};
use crate::notify::notify;
use crate::test_support::{TestApp, TestUser};

/// Inserts a system notification of `photo_approved` `minutes` ago and returns its id.
async fn system_row(app: &TestApp, user: &TestUser, minutes: i32, read: bool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO notifications (id, user_id, type, data, read_at, created_at)
         VALUES ($1, $2, 'photo_approved', $3,
                 CASE WHEN $4 THEN now() END, now() - make_interval(mins => $5))",
    )
    .bind(id)
    .bind(user.user_id)
    .bind(json!({ "photo_id": Uuid::now_v7() }))
    .bind(read)
    .bind(minutes)
    .execute(app.db())
    .await
    .expect("the row inserts");
    id
}

fn ids(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| item["id"].as_str().expect("an id").to_owned())
        .collect()
}

#[sqlx::test]
async fn the_feed_is_paged_newest_first(db: PgPool) {
    let w = World::new(db).await;
    let mut created = Vec::new();
    for minutes in [50, 40, 30, 20, 10] {
        created.push(system_row(&w.app, &w.him, minutes, minutes == 30).await);
    }
    let newest_first: Vec<String> = created.iter().rev().map(Uuid::to_string).collect();

    let first = w
        .app
        .get("/v1/notifications?limit=2", Some(&w.him.token))
        .await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(ids(&first.json), newest_first[..2]);
    let cursor = first.json["next_cursor"]
        .as_str()
        .expect("more pages")
        .to_owned();

    let second = w
        .app
        .get(
            &format!("/v1/notifications?limit=2&cursor={cursor}"),
            Some(&w.him.token),
        )
        .await;
    assert_eq!(ids(&second.json), newest_first[2..4]);
    let cursor = second.json["next_cursor"]
        .as_str()
        .expect("one more")
        .to_owned();

    let last = w
        .app
        .get(
            &format!("/v1/notifications?limit=2&cursor={cursor}"),
            Some(&w.him.token),
        )
        .await;
    assert_eq!(ids(&last.json), newest_first[4..]);
    assert_eq!(last.json["next_cursor"], Value::Null);

    // The item shape of 15 section 14, with every optional key present.
    let item = &first.json["items"][0];
    assert_eq!(item["type"], "photo_approved");
    assert_eq!(item["actor"], Value::Null);
    assert_eq!(item["is_read"], false);
    assert!(item["data"]["photo_id"].is_string());
    assert!(
        item["created_at"]
            .as_str()
            .is_some_and(|t| t.ends_with('Z'))
    );
    assert_eq!(
        second.json["items"][0]["is_read"], true,
        "the row read 30 minutes ago"
    );

    // The feed is the caller's own: she sees nothing of his.
    let hers = w.app.get("/v1/notifications", Some(&w.her.token)).await;
    assert_eq!(hers.json["items"], json!([]));
    assert_eq!(hers.json["next_cursor"], Value::Null);

    let bad = w
        .app
        .get("/v1/notifications?cursor=!!!", Some(&w.him.token))
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.code(), "bad_request");
    let anonymous = w.app.get("/v1/notifications", None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn rows_whose_actor_can_no_longer_be_opened_are_left_out(db: PgPool) {
    let w = World::new(db).await;
    let interest = add_interest(&w.app, &w.her, &w.him).await;
    notify(
        &w.app.state,
        w.him.user_id,
        T::InterestReceived,
        Some(w.her.profile_id),
        json!({ "interest_id": interest, "reminder": false, "count": 1 }),
    )
    .await
    .unwrap()
    .expect("a row");
    let older = system_row(&w.app, &w.him, 60, false).await;

    let visible = w.app.get("/v1/notifications", Some(&w.him.token)).await;
    assert_eq!(visible.json["items"].as_array().unwrap().len(), 2);
    assert_eq!(
        visible.json["items"][0]["actor"]["display_name"],
        "Ayesha M."
    );

    // A block hides her rows, and the page is filled from the rows behind them.
    block(&w.app, &w.him, &w.her).await;
    let page = w
        .app
        .get("/v1/notifications?limit=1", Some(&w.him.token))
        .await;
    assert_eq!(ids(&page.json), [older.to_string()]);
    assert_eq!(page.json["next_cursor"], Value::Null);
    // They are still in the database, and come back when the block is lifted.
    sqlx::query("DELETE FROM blocks")
        .execute(w.app.db())
        .await
        .unwrap();
    let again = w.app.get("/v1/notifications", Some(&w.him.token)).await;
    assert_eq!(again.json["items"].as_array().unwrap().len(), 2);
}

#[sqlx::test]
async fn a_long_run_of_hidden_rows_does_not_hide_the_page_behind_it(db: PgPool) {
    let w = World::new(db).await;
    // Three newer rows from a blocked actor, then two system rows.
    for _ in 0..3 {
        let interest = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO notifications (user_id, type, actor_profile_id, data)
             VALUES ($1, 'interest_received', $2, $3)",
        )
        .bind(w.him.user_id)
        .bind(w.her.profile_id)
        .bind(json!({ "interest_id": interest }))
        .execute(w.app.db())
        .await
        .unwrap();
    }
    block(&w.app, &w.him, &w.her).await;
    let first = system_row(&w.app, &w.him, 2, false).await;
    let second = system_row(&w.app, &w.him, 1, false).await;
    sqlx::query("UPDATE notifications SET created_at = now() + interval '1 minute' WHERE actor_profile_id IS NOT NULL")
        .execute(w.app.db())
        .await
        .unwrap();
    let page = w
        .app
        .get("/v1/notifications?limit=2", Some(&w.him.token))
        .await;
    assert_eq!(ids(&page.json), [second.to_string(), first.to_string()]);
    assert_eq!(page.json["next_cursor"], Value::Null);
}

#[sqlx::test]
async fn the_actor_photo_is_blurred_unless_the_rules_of_09_allow_it(db: PgPool) {
    let w = World::new(db).await;
    sqlx::query(
        "INSERT INTO profile_photos (profile_id, status, position, is_primary, upload_key,
                                     key_large, key_medium, key_thumb, key_blur_medium, key_blur_thumb)
         VALUES ($1, 'approved', 0, true, 'u', 'p/large.jpg', 'p/medium.jpg', 'p/thumb.jpg',
                 'p/blur_medium.jpg', 'p/blur_thumb.jpg')",
    )
    .bind(w.her.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();
    let interest = add_interest(&w.app, &w.her, &w.him).await;
    notify(
        &w.app.state,
        w.him.user_id,
        T::InterestReceived,
        Some(w.her.profile_id),
        json!({ "interest_id": interest, "reminder": false, "count": 1 }),
    )
    .await
    .unwrap()
    .expect("a row");
    let photo_of = |page: &Value| page["items"][0]["actor"]["photo"].clone();

    // `members` (the default): everyone sees the clear photo.
    let clear = photo_of(
        &w.app
            .get("/v1/notifications", Some(&w.him.token))
            .await
            .json,
    );
    assert_eq!(clear["is_blurred"], false);
    assert_eq!(clear["is_primary"], true);
    assert!(clear["thumb_url"].as_str().unwrap().contains("p/thumb.jpg"));
    assert!(clear["large_url"].as_str().unwrap().contains("p/large.jpg"));

    // `connections` and no connection: blurred files only, and no clear key is ever signed.
    sqlx::query(
        "UPDATE profile_privacy SET photo_visibility = 'connections' WHERE profile_id = $1",
    )
    .bind(w.her.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();
    let blurred = photo_of(
        &w.app
            .get("/v1/notifications", Some(&w.him.token))
            .await
            .json,
    );
    assert_eq!(blurred["is_blurred"], true);
    assert!(
        blurred["thumb_url"]
            .as_str()
            .unwrap()
            .contains("blur_thumb")
    );
    assert!(
        blurred["medium_url"]
            .as_str()
            .unwrap()
            .contains("blur_medium")
    );
    assert_eq!(blurred["large_url"], Value::Null);
    assert!(!blurred.to_string().contains("p/large.jpg"));

    // A granted photo request gives the clear photo in every mode.
    sqlx::query(
        "INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status) VALUES ($1, $2, 'granted')",
    )
    .bind(w.her.profile_id)
    .bind(w.him.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();
    let granted = photo_of(
        &w.app
            .get("/v1/notifications", Some(&w.him.token))
            .await
            .json,
    );
    assert_eq!(granted["is_blurred"], false);
}

#[sqlx::test]
async fn reading_marks_the_callers_rows_and_pushes_counters(db: PgPool) {
    let w = World::new(db).await;
    let a = system_row(&w.app, &w.him, 3, false).await;
    let b = system_row(&w.app, &w.him, 2, false).await;
    let c = system_row(&w.app, &w.him, 1, false).await;
    let hers = system_row(&w.app, &w.her, 1, false).await;
    let mut socket = w.app.state.hub.register(w.him.profile_id, w.him.user_id);

    let response = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "ids": [a, hers] }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    let counters: Value = serde_json::from_str(&socket.receiver.recv().await.unwrap()).unwrap();
    assert_eq!(counters["type"], "counters");
    assert_eq!(counters["data"]["unread_notifications"], 2);

    // Her row was not his to read.
    let unread_hers: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(w.her.user_id)
    .fetch_one(w.app.db())
    .await
    .unwrap();
    assert_eq!(unread_hers, 1);

    // Reading what is read changes nothing and sends nothing.
    let again = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "ids": [a] }),
        )
        .await;
    assert_eq!(again.status, StatusCode::NO_CONTENT);
    assert!(socket.receiver.try_recv().is_err());

    let all = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "all": true }),
        )
        .await;
    assert_eq!(all.status, StatusCode::NO_CONTENT);
    let counters: Value = serde_json::from_str(&socket.receiver.recv().await.unwrap()).unwrap();
    assert_eq!(counters["data"]["unread_notifications"], 0);
    let rows = w.app.get("/v1/notifications", Some(&w.him.token)).await;
    assert!(
        rows.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["is_read"] == true)
    );
    let _ = (b, c);
}

#[sqlx::test]
async fn reading_needs_ids_or_all(db: PgPool) {
    let w = World::new(db).await;
    let empty = w
        .app
        .post("/v1/notifications/read", Some(&w.him.token), json!({}))
        .await;
    assert_eq!(empty.status, StatusCode::BAD_REQUEST);
    assert_eq!(empty.field_errors(), ["ids:required"]);
    let none = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "all": false }),
        )
        .await;
    assert_eq!(none.field_errors(), ["ids:required"]);
    let many: Vec<Uuid> = (0..201).map(|_| Uuid::now_v7()).collect();
    let too_many = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "ids": many }),
        )
        .await;
    assert_eq!(too_many.field_errors(), ["ids:too_long"]);
    let unknown = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "ids": [], "x": 1 }),
        )
        .await;
    assert_eq!(unknown.code(), "bad_request");
    let bad_id = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "ids": ["nope"] }),
        )
        .await;
    assert_eq!(bad_id.code(), "bad_request");
    // An empty list is valid and changes nothing.
    let nothing = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&w.him.token),
            json!({ "ids": [] }),
        )
        .await;
    assert_eq!(nothing.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn the_feed_needs_an_open_account(db: PgPool) {
    let w = World::new(db).await;
    let suspended = w
        .app
        .member_with(|spec| spec.user_status = UserStatus::Suspended)
        .await;
    let response = w.app.get("/v1/notifications", Some(&suspended.token)).await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(response.code(), "account_suspended");
    let response = w
        .app
        .post(
            "/v1/notifications/read",
            Some(&suspended.token),
            json!({ "all": true }),
        )
        .await;
    assert_eq!(response.code(), "account_suspended");
}

fn default_preferences() -> Value {
    json!({
        "push_interests": true,
        "push_messages": true,
        "push_photo_requests": true,
        "push_profile_views": false,
        "push_matches": true,
        "email_interests": true,
        "email_messages": false,
        "email_match_digest": "weekly",
        "email_announcements": true,
        "quiet_hours_start": null,
        "quiet_hours_end": null,
    })
}

#[sqlx::test]
async fn preferences_start_with_the_defaults_and_are_replaced_whole(db: PgPool) {
    let w = World::new(db).await;
    let defaults = w
        .app
        .get("/v1/me/notification-preferences", Some(&w.him.token))
        .await;
    assert_eq!(defaults.status, StatusCode::OK);
    assert_eq!(defaults.json, default_preferences());

    let mut changed = default_preferences();
    changed["push_interests"] = json!(false);
    changed["push_profile_views"] = json!(true);
    changed["email_match_digest"] = json!("daily");
    changed["quiet_hours_start"] = json!("22:00");
    changed["quiet_hours_end"] = json!("07:00");
    let saved = w
        .app
        .put(
            "/v1/me/notification-preferences",
            Some(&w.him.token),
            changed.clone(),
        )
        .await;
    assert_eq!(saved.status, StatusCode::OK);
    assert_eq!(saved.json, changed);
    let read = w
        .app
        .get("/v1/me/notification-preferences", Some(&w.him.token))
        .await;
    assert_eq!(read.json, changed);

    // Her settings are her own.
    let hers = w
        .app
        .get("/v1/me/notification-preferences", Some(&w.her.token))
        .await;
    assert_eq!(hers.json, default_preferences());

    // Clearing the quiet hours sends both as null; seconds are accepted on input.
    let mut cleared = changed.clone();
    cleared["quiet_hours_start"] = Value::Null;
    cleared["quiet_hours_end"] = Value::Null;
    let saved = w
        .app
        .put(
            "/v1/me/notification-preferences",
            Some(&w.him.token),
            cleared.clone(),
        )
        .await;
    assert_eq!(saved.json, cleared);
    let mut with_seconds = changed;
    with_seconds["quiet_hours_start"] = json!("23:30:00");
    let saved = w
        .app
        .put(
            "/v1/me/notification-preferences",
            Some(&w.him.token),
            with_seconds,
        )
        .await;
    assert_eq!(saved.json["quiet_hours_start"], "23:30");
}

#[sqlx::test]
async fn preferences_are_validated(db: PgPool) {
    let w = World::new(db).await;
    let put = |body: Value| {
        let app = &w.app;
        let token = w.him.token.clone();
        async move {
            app.put("/v1/me/notification-preferences", Some(&token), body)
                .await
        }
    };

    // Quiet hours are both set or both null (14 section 6.2 rule 1).
    let mut only_start = default_preferences();
    only_start["quiet_hours_start"] = json!("22:00");
    let response = put(only_start).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.code(), "validation_failed");
    assert_eq!(response.field_errors(), ["quiet_hours_end:required"]);
    let mut only_end = default_preferences();
    only_end["quiet_hours_end"] = json!("07:00");
    assert_eq!(
        put(only_end).await.field_errors(),
        ["quiet_hours_start:required"]
    );

    let mut bad_time = default_preferences();
    bad_time["quiet_hours_start"] = json!("25:00");
    bad_time["quiet_hours_end"] = json!("07:00");
    assert_eq!(
        put(bad_time).await.field_errors(),
        ["quiet_hours_start:invalid"]
    );

    let mut bad_digest = default_preferences();
    bad_digest["email_match_digest"] = json!("monthly");
    assert_eq!(
        put(bad_digest).await.field_errors(),
        ["email_match_digest:unknown_code"]
    );

    // The call replaces the whole object, so a missing switch is an error.
    let mut missing = default_preferences();
    missing.as_object_mut().unwrap().remove("push_matches");
    assert_eq!(put(missing).await.field_errors(), ["push_matches:required"]);

    let mut unknown_key = default_preferences();
    unknown_key["push_everything"] = json!(true);
    assert_eq!(put(unknown_key).await.code(), "bad_request");
    let mut wrong_type = default_preferences();
    wrong_type["push_matches"] = json!("yes");
    assert_eq!(put(wrong_type).await.code(), "bad_request");

    // Nothing was stored by the refused calls.
    let read = w
        .app
        .get("/v1/me/notification-preferences", Some(&w.him.token))
        .await;
    assert_eq!(read.json, default_preferences());
}

async fn devices_of(app: &TestApp, user: &TestUser) -> Vec<String> {
    sqlx::query_scalar("SELECT push_token FROM user_devices WHERE user_id = $1 ORDER BY push_token")
        .bind(user.user_id)
        .fetch_all(app.db())
        .await
        .unwrap()
}

#[sqlx::test]
async fn a_device_token_moves_to_the_user_who_registers_it(db: PgPool) {
    let w = World::new(db).await;
    let body = json!({ "platform": "android", "push_token": "fcm-token-1", "app_version": "1.2.0", "device_model": "Pixel 8" });
    let response = w.app.post("/v1/me/devices", Some(&w.him.token), body).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(devices_of(&w.app, &w.him).await, ["fcm-token-1"]);

    // The same phone, another account signs in: the token moves (upsert on push_token).
    let again =
        json!({ "platform": "android", "push_token": "fcm-token-1", "app_version": "1.3.0" });
    let response = w
        .app
        .post("/v1/me/devices", Some(&w.her.token), again)
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert!(
        devices_of(&w.app, &w.him).await.is_empty(),
        "no device is registered"
    );
    assert_eq!(devices_of(&w.app, &w.her).await, ["fcm-token-1"]);
    let (count, version, model): (i64, Option<String>, Option<String>) =
        sqlx::query_as("SELECT count(*), max(app_version), max(device_model) FROM user_devices")
            .fetch_one(w.app.db())
            .await
            .unwrap();
    assert_eq!(count, 1);
    assert_eq!(version.as_deref(), Some("1.3.0"));
    assert_eq!(model, None, "the registration replaces the old details");

    // Registering again by the same user keeps one row.
    let response = w
        .app
        .post(
            "/v1/me/devices",
            Some(&w.her.token),
            json!({ "platform": "android", "push_token": "fcm-token-1" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(devices_of(&w.app, &w.her).await.len(), 1);
}

#[sqlx::test]
async fn devices_are_validated(db: PgPool) {
    let w = World::new(db).await;
    let post = |body: Value| {
        let app = &w.app;
        let token = w.him.token.clone();
        async move { app.post("/v1/me/devices", Some(&token), body).await }
    };
    assert_eq!(
        post(json!({ "platform": "android", "push_token": "  " }))
            .await
            .field_errors(),
        ["push_token:required"]
    );
    assert_eq!(
        post(json!({ "platform": "android", "push_token": "has space" }))
            .await
            .field_errors(),
        ["push_token:invalid"]
    );
    assert_eq!(
        post(json!({ "platform": "android", "push_token": "x".repeat(2000) }))
            .await
            .field_errors(),
        ["push_token:invalid"]
    );
    assert_eq!(
        post(json!({ "platform": "android", "push_token": "ok", "app_version": "v".repeat(60) }))
            .await
            .field_errors(),
        ["app_version:too_long"]
    );
    assert_eq!(
        post(json!({ "platform": "ios", "push_token": "ok" }))
            .await
            .code(),
        "bad_request"
    );
    assert_eq!(
        post(json!({ "push_token": "ok" })).await.code(),
        "bad_request"
    );
    assert_eq!(
        post(json!({ "platform": "web", "push_token": "ok", "extra": 1 }))
            .await
            .code(),
        "bad_request"
    );
    assert!(
        devices_of(&w.app, &w.him).await.is_empty(),
        "no device is registered"
    );
    let anonymous = w
        .app
        .post(
            "/v1/me/devices",
            None,
            json!({ "platform": "android", "push_token": "ok" }),
        )
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn a_user_keeps_at_most_ten_devices(db: PgPool) {
    let w = World::new(db).await;
    for n in 0..12 {
        let response = w
            .app
            .post(
                "/v1/me/devices",
                Some(&w.him.token),
                json!({ "platform": "android", "push_token": format!("token-{n:02}") }),
            )
            .await;
        assert_eq!(response.status, StatusCode::NO_CONTENT);
        // Distinct times, so that "least recently seen" is well defined.
        sqlx::query("UPDATE user_devices SET last_seen_at = now() - make_interval(secs => $1) WHERE push_token = $2")
            .bind(f64::from(12 - n))
            .bind(format!("token-{n:02}"))
            .execute(w.app.db())
            .await
            .unwrap();
    }
    let devices = devices_of(&w.app, &w.him).await;
    assert_eq!(devices.len(), 10);
    assert!(
        !devices.contains(&"token-00".to_owned()),
        "the oldest went first"
    );
}

#[sqlx::test]
async fn signing_out_removes_only_the_callers_token(db: PgPool) {
    let w = World::new(db).await;
    for (user, token) in [(&w.him, "his-token"), (&w.her, "her-token")] {
        w.app
            .post(
                "/v1/me/devices",
                Some(&user.token),
                json!({ "platform": "android", "push_token": token }),
            )
            .await;
    }
    // Someone else's token, and one that is not registered: 204, nothing removed.
    for token in ["her-token", "unknown"] {
        let response = w
            .app
            .delete(&format!("/v1/me/devices/{token}"), Some(&w.him.token))
            .await;
        assert_eq!(response.status, StatusCode::NO_CONTENT);
    }
    assert_eq!(devices_of(&w.app, &w.her).await, ["her-token"]);
    assert_eq!(devices_of(&w.app, &w.him).await, ["his-token"]);

    let response = w
        .app
        .delete("/v1/me/devices/his-token", Some(&w.him.token))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert!(
        devices_of(&w.app, &w.him).await.is_empty(),
        "no device is registered"
    );
    assert_eq!(
        w.app.delete("/v1/me/devices/her-token", None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn removing_a_device_needs_only_a_valid_token_but_registering_needs_an_open_account(
    db: PgPool,
) {
    let w = World::new(db).await;
    let suspended = w
        .app
        .member_with(|spec| spec.user_status = UserStatus::Suspended)
        .await;
    sqlx::query(
        "INSERT INTO user_devices (user_id, platform, push_token) VALUES ($1, 'android', 'old')",
    )
    .bind(suspended.user_id)
    .execute(w.app.db())
    .await
    .unwrap();
    let register = w
        .app
        .post(
            "/v1/me/devices",
            Some(&suspended.token),
            json!({ "platform": "android", "push_token": "new" }),
        )
        .await;
    assert_eq!(register.status, StatusCode::FORBIDDEN);
    assert_eq!(register.code(), "account_suspended");
    let remove = w
        .app
        .delete("/v1/me/devices/old", Some(&suspended.token))
        .await;
    assert_eq!(remove.status, StatusCode::NO_CONTENT);
    assert!(
        devices_of(&w.app, &suspended).await.is_empty(),
        "no device is registered"
    );
}

#[test]
fn the_openapi_document_describes_the_notification_endpoints() {
    let spec: Value =
        serde_json::from_str(&crate::openapi::spec_json().expect("the spec builds")).unwrap();
    for (path, methods) in [
        ("/v1/notifications", vec!["get"]),
        ("/v1/notifications/read", vec!["post"]),
        ("/v1/me/notification-preferences", vec!["get", "put"]),
        ("/v1/me/devices", vec!["post"]),
        ("/v1/me/devices/{push_token}", vec!["delete"]),
    ] {
        for method in methods {
            assert!(
                spec["paths"][path][method].is_object(),
                "{method} {path} is documented"
            );
        }
    }
    let schemas = spec["components"]["schemas"].as_object().unwrap();
    for name in [
        "Notification",
        "NotificationActor",
        "NotificationPreferences",
        "PreferencesBody",
    ] {
        assert!(schemas.contains_key(name), "schema {name}");
    }
    // The key of a feed item is `type`, as in 15 section 14.
    assert!(schemas["Notification"]["properties"]["type"].is_object());
}
