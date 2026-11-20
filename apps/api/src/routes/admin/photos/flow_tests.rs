//! The staff photo queue, end to end (15 section 16, 18 section 4.2).
#![expect(
    clippy::assert_is_empty,
    reason = "`assert!(list.is_empty())` reads better than comparing with a typed empty array"
)]

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::types::UserRole;
use crate::routes::photos::fixtures::{
    add_photo, audit_count, audit_rows, frames, frames_of, notification_types, profile_state,
    status_of,
};
use crate::test_support::TestApp;

fn path(photo: Uuid, action: &str) -> String {
    format!("/v1/admin/photos/{photo}/{action}")
}

#[sqlx::test]
async fn the_queue_lists_flagged_photos_first_with_what_a_moderator_needs(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let anna = app.member().await;
    let bela = app.member().await;
    let oldest = add_photo(&app, &anna, "pending_review").await;
    let sibling = add_photo(&app, &anna, "approved").await;
    let second = add_photo(&app, &anna, "pending_review").await;
    let flagged = add_photo(&app, &bela, "pending_review").await;
    let processing = add_photo(&app, &bela, "processing").await;
    sqlx::query(
        "UPDATE profile_photos SET key_large = NULL, key_medium = NULL, key_thumb = NULL,
             key_blur_medium = NULL, key_blur_thumb = NULL WHERE id = $1",
    )
    .bind(processing)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE profile_photos SET moderation = '{\"result\": \"flag\", \"categories\": {\"sexual\": 2}}'
         WHERE id = $1",
    )
    .bind(flagged)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query("UPDATE profiles SET is_photo_verified = true WHERE id = $1")
        .bind(anna.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    let response = app.get("/v1/admin/photos", Some(&moderator.token)).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    let items = response.json["items"].as_array().unwrap();
    let ids: Vec<&str> = items
        .iter()
        .map(|i| i["photo_id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [flagged.to_string(), oldest.to_string(), second.to_string()],
        "flagged first, then oldest first; only pending photos with files"
    );
    assert_eq!(response.json["next_cursor"], Value::Null);

    let first = &items[0];
    assert_eq!(first["profile_id"], bela.profile_id.to_string());
    assert!(first["public_code"].as_str().unwrap().starts_with("KR"));
    assert_eq!(first["first_name"], "Ahmed");
    assert_eq!(first["gender"], "male");
    assert!(first["age"].as_i64().unwrap() >= 27);
    assert_eq!(first["status"], "pending_review");
    assert!(first["large_url"].as_str().unwrap().contains("large.jpg"));
    assert_eq!(first["moderation"]["result"], "flag");
    assert_eq!(
        first["would_be_primary"], true,
        "bela has no approved photo yet"
    );
    assert_eq!(first["profile_is_photo_verified"], false);
    assert_eq!(
        first["other_photos"],
        json!([]),
        "the processing photo has no files"
    );

    let second_item = &items[1];
    assert_eq!(
        second_item["would_be_primary"], false,
        "anna already has an approved photo"
    );
    assert_eq!(second_item["profile_is_photo_verified"], true);
    let others: Vec<(&str, &str, bool)> = second_item["other_photos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| {
            (
                o["photo_id"].as_str().unwrap(),
                o["status"].as_str().unwrap(),
                o["is_primary"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        others,
        [
            (sibling.to_string().as_str(), "approved", true),
            (second.to_string().as_str(), "pending_review", false)
        ]
    );
    assert!(
        second_item["other_photos"][0]["medium_url"]
            .as_str()
            .unwrap()
            .contains("medium.jpg")
    );
}

#[sqlx::test]
async fn the_queue_pages_and_filters_by_status(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let anna = app.member().await;
    let mut pending = Vec::new();
    for _ in 0..3 {
        pending.push(add_photo(&app, &anna, "pending_review").await);
    }
    let approved = add_photo(&app, &anna, "approved").await;
    let token = Some(moderator.token.as_str());

    let first = app.get("/v1/admin/photos?limit=2", token).await;
    assert_eq!(first.json["items"].as_array().unwrap().len(), 2);
    let cursor = first.json["next_cursor"].as_str().unwrap().to_owned();
    let second = app
        .get(&format!("/v1/admin/photos?limit=2&cursor={cursor}"), token)
        .await;
    let items = second.json["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["photo_id"], pending[2].to_string());
    assert_eq!(second.json["next_cursor"], Value::Null);

    let approved_list = app.get("/v1/admin/photos?status=approved", token).await;
    let items = approved_list.json["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["photo_id"], approved.to_string());
    assert_eq!(items[0]["would_be_primary"], false);

    assert_eq!(
        app.get("/v1/admin/photos?status=nonsense", token)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.get("/v1/admin/photos?cursor=%21%21", token)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test]
async fn approving_a_photo_changes_it_notifies_and_is_audited_once(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    let first = add_photo(&app, &member, "pending_review").await;
    let second = add_photo(&app, &member, "pending_review").await;
    let mut socket = app.state.hub.register(member.profile_id, member.user_id);
    sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
        .bind(member.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    let response = app
        .post_empty(&path(first, "approve"), Some(&moderator.token))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);

    assert_eq!(status_of(&app, first).await, "approved");
    let (primary, reviewer, reviewed): (bool, Option<Uuid>, bool) = sqlx::query_as(
        "SELECT is_primary, reviewed_by, reviewed_at IS NOT NULL FROM profile_photos WHERE id = $1",
    )
    .bind(first)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!(primary, "the first approved photo is the main photo");
    assert_eq!(reviewer, Some(moderator.user_id));
    assert!(reviewed);
    let state = profile_state(&app, &member).await;
    assert!(state.has_approved_photo);
    assert!(state.match_stale);
    assert_eq!(
        state.completeness, 39,
        "core 20, photo 15, partner preferences 4"
    );

    assert_eq!(notification_types(&app, &member).await, ["photo_approved"]);
    let data: Value = sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
        .bind(member.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(data, json!({ "photo_id": first }));
    let audit = audit_rows(&app, "photo.approve").await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit_count(&app).await, 1);
    assert_eq!(audit[0].actor_user_id, moderator.user_id);
    assert_eq!(audit[0].target_type, "photo");
    assert_eq!(audit[0].target_id, first.to_string());
    assert_eq!(audit[0].details, json!({ "profile_id": member.profile_id }));
    let updates = frames_of(&frames(&mut socket), "photo.updated");
    assert!(
        updates
            .iter()
            .any(|e| e["data"]["photo"]["id"] == first.to_string()
                && e["data"]["photo"]["status"] == "approved"
                && e["data"]["photo"]["is_primary"] == true),
        "{updates:?}"
    );

    // A second approved photo does not take the main photo.
    let response = app
        .post_empty(&path(second, "approve"), Some(&moderator.token))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    let primary: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM profile_photos WHERE is_primary")
        .fetch_all(app.db())
        .await
        .unwrap();
    assert_eq!(primary, [first]);
    assert_eq!(audit_count(&app).await, 2);
}

#[sqlx::test]
async fn only_photos_in_review_or_approved_can_be_decided(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    let token = Some(moderator.token.as_str());
    for status in ["processing", "failed", "rejected"] {
        let photo = add_photo(&app, &member, status).await;
        for action in ["approve", "reject"] {
            let response = if action == "approve" {
                app.post_empty(&path(photo, action), token).await
            } else {
                app.post(&path(photo, action), token, json!({ "reason": "other" }))
                    .await
            };
            assert_eq!(response.status, StatusCode::CONFLICT, "{status} {action}");
            assert_eq!(response.code(), "invalid_state");
            assert_eq!(response.json["error"]["details"]["status"], status);
        }
        assert_eq!(status_of(&app, photo).await, status);
    }
    assert_eq!(audit_count(&app).await, 0);
    assert!(notification_types(&app, &member).await.is_empty());

    let unknown = app
        .post_empty(&path(Uuid::now_v7(), "approve"), token)
        .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    let unknown = app
        .post(
            &path(Uuid::now_v7(), "reject"),
            token,
            json!({ "reason": "other" }),
        )
        .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn rejecting_a_photo_changes_it_notifies_and_is_audited_once(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    let photo = add_photo(&app, &member, "pending_review").await;
    let token = Some(moderator.token.as_str());

    let bad = app
        .post(&path(photo, "reject"), token, json!({ "reason": "ugly" }))
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.field_errors(), ["reason:unknown_code"]);
    let missing = app.post(&path(photo, "reject"), token, json!({})).await;
    assert_eq!(missing.status, StatusCode::BAD_REQUEST);
    assert_eq!(audit_count(&app).await, 0);

    let response = app
        .post(
            &path(photo, "reject"),
            token,
            json!({ "reason": "face_not_visible" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);
    assert_eq!(status_of(&app, photo).await, "rejected");
    let (reason, reviewer): (Option<String>, Option<Uuid>) =
        sqlx::query_as("SELECT rejection_reason, reviewed_by FROM profile_photos WHERE id = $1")
            .bind(photo)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(reason.as_deref(), Some("face_not_visible"));
    assert_eq!(reviewer, Some(moderator.user_id));

    assert_eq!(notification_types(&app, &member).await, ["photo_rejected"]);
    let data: Value = sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
        .bind(member.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(
        data,
        json!({ "photo_id": photo, "rejection_reason": "face_not_visible" })
    );
    let audit = audit_rows(&app, "photo.reject").await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit_count(&app).await, 1);
    assert_eq!(audit[0].target_id, photo.to_string());
    assert_eq!(
        audit[0].details,
        json!({ "profile_id": member.profile_id, "reason": "face_not_visible" })
    );
    // The files stay for an appeal and go after 30 days.
    let delayed: bool = sqlx::query_scalar(
        "SELECT run_at > now() + interval '29 days' FROM jobs WHERE kind = 'delete_objects'",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!(delayed);
    let owner_view = app.get("/v1/me/photos", Some(&member.token)).await;
    assert_eq!(owner_view.json[0]["status"], "rejected");
    assert_eq!(owner_view.json[0]["rejection_reason"], "face_not_visible");
}

#[sqlx::test]
async fn removing_an_approved_main_photo_promotes_the_next_one(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    let main = add_photo(&app, &member, "approved").await;
    let next = add_photo(&app, &member, "approved").await;
    sqlx::query("UPDATE profiles SET is_photo_verified = true WHERE id = $1")
        .bind(member.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    let token = Some(moderator.token.as_str());

    let response = app
        .post(
            &path(main, "reject"),
            token,
            json!({ "reason": "not_the_candidate" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);
    let primary: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM profile_photos WHERE is_primary")
        .fetch_all(app.db())
        .await
        .unwrap();
    assert_eq!(primary, [next]);
    let state = profile_state(&app, &member).await;
    assert!(state.has_approved_photo);
    assert!(
        !state.is_photo_verified,
        "a different main photo clears the badge"
    );

    let response = app
        .post(&path(next, "reject"), token, json!({ "reason": "other" }))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    let state = profile_state(&app, &member).await;
    assert!(!state.has_approved_photo);
    assert_eq!(state.completeness, 24);
    let primary: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM profile_photos WHERE is_primary")
        .fetch_all(app.db())
        .await
        .unwrap();
    assert!(primary.is_empty());
}

#[sqlx::test]
async fn members_cannot_use_the_photo_queue(db: PgPool) {
    let app = TestApp::new(db).await;
    let member = app.member().await;
    let moderator = app.staff(UserRole::Moderator).await;
    let admin = app.staff(UserRole::Admin).await;
    let photo = add_photo(&app, &member, "pending_review").await;
    let token = Some(member.token.as_str());

    assert_eq!(
        app.get("/v1/admin/photos", token).await.status,
        StatusCode::FORBIDDEN
    );
    let response = app.post_empty(&path(photo, "approve"), token).await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(response.code(), "forbidden");
    let response = app
        .post(&path(photo, "reject"), token, json!({ "reason": "other" }))
        .await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(
        app.get("/v1/admin/photos", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(status_of(&app, photo).await, "pending_review");
    assert_eq!(audit_count(&app).await, 0);

    // Moderators and admins both may.
    for staff in [&moderator, &admin] {
        let response = app.get("/v1/admin/photos", Some(&staff.token)).await;
        assert_eq!(response.status, StatusCode::OK);
    }
}
