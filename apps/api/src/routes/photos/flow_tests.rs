//! The photo endpoints and the `process_photo` job, end to end (15 section 8, 08 section 5).
#![expect(
    clippy::assert_is_empty,
    reason = "`assert!(list.is_empty())` reads better than comparing with a typed empty array"
)]

use std::sync::Arc;

use axum::http::StatusCode;
use image::GenericImageView;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::fixtures::{
    VARIANTS, add_photo, frames, frames_of, is_between, jpeg, list, notification_types,
    profile_state, status_of, upload,
};
use crate::domain::types::{ProfileStatus, UserStatus};
use crate::routes::photos::MAX_UPLOAD_BYTES;
use crate::services::r2::{DisabledStore, ObjectStore};
use crate::test_support::TestApp;

fn decoded_size(bytes: &[u8]) -> (u32, u32) {
    image::load_from_memory(bytes).unwrap().dimensions()
}

async fn upload_key_of(app: &TestApp, photo_id: &Value) -> String {
    sqlx::query_scalar("SELECT upload_key FROM profile_photos WHERE id = $1")
        .bind(Uuid::parse_str(photo_id.as_str().unwrap()).unwrap())
        .fetch_one(app.db())
        .await
        .unwrap()
}

// ---- Upload tickets ----

#[sqlx::test]
async fn an_upload_ticket_names_a_private_key_and_expires_in_ten_minutes(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let before = OffsetDateTime::now_utc();
    let ticket = app
        .post(
            "/v1/me/photos/uploads",
            Some(&user.token),
            json!({ "content_type": "image/png", "size_bytes": 1234 }),
        )
        .await;
    assert_eq!(ticket.status, StatusCode::OK, "{}", ticket.text);
    let key = ticket.json["upload_key"].as_str().unwrap();
    assert!(key.starts_with(&format!("tmp/photos/{}/", user.profile_id)));
    assert!(ticket.json["upload_url"].as_str().unwrap().contains(key));
    assert_eq!(
        ticket.json["headers"],
        json!({ "Content-Type": "image/png" })
    );
    assert!(is_between(
        &ticket.json["expires_at"],
        before + Duration::minutes(9),
        OffsetDateTime::now_utc() + Duration::minutes(10),
    ));
}

#[sqlx::test]
async fn an_upload_request_is_validated(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let token = Some(user.token.as_str());

    let gif = app
        .post(
            "/v1/me/photos/uploads",
            token,
            json!({ "content_type": "image/gif", "size_bytes": 10 }),
        )
        .await;
    assert_eq!(gif.status, StatusCode::BAD_REQUEST);
    assert_eq!(gif.field_errors(), ["content_type:invalid"]);

    let empty = app
        .post(
            "/v1/me/photos/uploads",
            token,
            json!({ "content_type": "image/jpeg", "size_bytes": 0 }),
        )
        .await;
    assert_eq!(empty.field_errors(), ["size_bytes:out_of_range"]);

    let too_big = app
        .post(
            "/v1/me/photos/uploads",
            token,
            json!({ "content_type": "image/jpeg", "size_bytes": MAX_UPLOAD_BYTES + 1 }),
        )
        .await;
    assert_eq!(too_big.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(too_big.code(), "payload_too_large");
    assert_eq!(
        too_big.json["error"]["details"]["max_bytes"],
        MAX_UPLOAD_BYTES
    );

    let exactly = app
        .post(
            "/v1/me/photos/uploads",
            token,
            json!({ "content_type": "image/webp", "size_bytes": MAX_UPLOAD_BYTES }),
        )
        .await;
    assert_eq!(exactly.status, StatusCode::OK);

    let unknown = app
        .post(
            "/v1/me/photos/uploads",
            token,
            json!({ "content_type": "image/jpeg", "size_bytes": 5, "extra": true }),
        )
        .await;
    assert_eq!(unknown.code(), "bad_request");

    let anonymous = app
        .post(
            "/v1/me/photos/uploads",
            None,
            json!({ "content_type": "image/jpeg", "size_bytes": 5 }),
        )
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn without_storage_uploads_answer_503(db: PgPool) {
    let mut app = TestApp::new(db).await;
    let user = app.member().await;
    let mut state = app.state.clone();
    state.storage = Arc::new(DisabledStore);
    app.router = crate::routes::app(state);

    let ticket = app
        .post(
            "/v1/me/photos/uploads",
            Some(&user.token),
            json!({ "content_type": "image/jpeg", "size_bytes": 5 }),
        )
        .await;
    assert_eq!(ticket.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(ticket.code(), "service_unavailable");

    let key = format!("tmp/photos/{}/{}", user.profile_id, Uuid::now_v7());
    let confirm = app
        .post(
            "/v1/me/photos",
            Some(&user.token),
            json!({ "upload_key": key }),
        )
        .await;
    assert_eq!(confirm.status, StatusCode::SERVICE_UNAVAILABLE);
}

// ---- The upload flow ----

#[sqlx::test]
async fn a_real_jpeg_becomes_five_variants_and_waits_for_review(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;

    let created = upload(&app, &user, jpeg(1000, 800)).await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text);
    assert_eq!(created.json["status"], "processing");
    assert_eq!(created.json["is_primary"], false);
    assert_eq!(created.json["position"], 0);
    assert_eq!(created.json["rejection_reason"], Value::Null);
    for field in ["thumb_url", "medium_url", "large_url"] {
        assert_eq!(created.json[field], Value::Null, "{field} while processing");
    }
    let id = created.json["id"].clone();
    let upload_key = upload_key_of(&app, &id).await;
    assert_eq!(
        app.queued_jobs("process_photo").await,
        vec![json!({ "photo_id": id })]
    );

    // Confirming the same upload again changes nothing.
    let again = app
        .post(
            "/v1/me/photos",
            Some(&user.token),
            json!({ "upload_key": upload_key }),
        )
        .await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(again.json["id"], id);
    assert_eq!(app.queued_jobs("process_photo").await.len(), 1);
    assert_eq!(list(&app, &user).await.len(), 1);

    app.drain_jobs().await;

    // Content safety is down in this test, so the photo goes to a moderator.
    let photos = list(&app, &user).await;
    assert_eq!(photos.len(), 1);
    assert_eq!(photos[0]["status"], "pending_review");
    for field in ["thumb_url", "medium_url", "large_url"] {
        assert!(
            photos[0][field].as_str().is_some(),
            "the owner sees {field}"
        );
    }
    assert!(
        photos[0]["large_url"]
            .as_str()
            .unwrap()
            .contains("large.jpg")
    );

    // The five documented variants, the documented sizes, the documented headers.
    let base = format!("photos/{}/{}", user.profile_id, id.as_str().unwrap());
    for (name, size) in [
        ("large", (1000, 800)),
        ("medium", (800, 640)),
        ("thumb", (320, 320)),
        ("blur_medium", (800, 640)),
        ("blur_thumb", (320, 320)),
    ] {
        let key = format!("{base}/{name}.jpg");
        let bytes = app
            .storage
            .get(&key)
            .await
            .unwrap()
            .unwrap_or_else(|| panic!("{key} exists"));
        assert_eq!(decoded_size(&bytes), size, "{name}");
        assert_eq!(
            app.storage.cache_control(&key).as_deref(),
            Some("private, max-age=3600"),
            "{name}"
        );
        assert_eq!(
            image::guess_format(&bytes).unwrap(),
            image::ImageFormat::Jpeg,
            "{name}"
        );
    }
    // The temporary upload is gone and the record is complete.
    assert!(app.storage.head(&upload_key).await.unwrap().is_none());
    let (width, height, moderation): (i32, i32, Value) = sqlx::query_as(
        "SELECT width, height, moderation FROM profile_photos WHERE profile_id = $1",
    )
    .bind(user.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!((width, height), (1000, 800));
    assert_eq!(moderation["result"], "unavailable");
    assert_eq!(moderation["provider"], "azure_content_safety");

    // Confirming once more after processing still answers with the photo.
    let late = app
        .post(
            "/v1/me/photos",
            Some(&user.token),
            json!({ "upload_key": upload_key }),
        )
        .await;
    assert_eq!(late.status, StatusCode::OK);
    assert_eq!(late.json["status"], "pending_review");
}

#[sqlx::test]
async fn a_text_file_renamed_jpg_ends_failed(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let mut socket = app.state.hub.register(user.profile_id, user.user_id);

    let text = upload(
        &app,
        &user,
        b"This is not an image, whatever its name says.".to_vec(),
    )
    .await;
    assert_eq!(text.status, StatusCode::CREATED);
    let too_small = upload(&app, &user, jpeg(300, 300)).await;
    assert_eq!(too_small.status, StatusCode::CREATED);
    app.drain_jobs().await;

    let photos = list(&app, &user).await;
    assert_eq!(photos.len(), 2);
    for photo in &photos {
        assert_eq!(photo["status"], "failed");
        for field in ["thumb_url", "medium_url", "large_url"] {
            assert_eq!(photo[field], Value::Null);
        }
    }
    assert!(app.storage.keys().is_empty(), "uploads are cleaned up");
    let updates = frames_of(&frames(&mut socket), "photo.updated");
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0]["data"]["photo"]["status"], "failed");

    // Failed photos do not count against the limit.
    let ticket = app
        .post(
            "/v1/me/photos/uploads",
            Some(&user.token),
            json!({ "content_type": "image/jpeg", "size_bytes": 10 }),
        )
        .await;
    assert_eq!(ticket.status, StatusCode::OK);
}

#[sqlx::test]
async fn the_seventh_photo_is_refused(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let mut ids = Vec::new();
    for _ in 0..6 {
        ids.push(add_photo(&app, &user, "pending_review").await);
    }
    let ticket_body = json!({ "content_type": "image/jpeg", "size_bytes": 10 });

    let refused = app
        .post(
            "/v1/me/photos/uploads",
            Some(&user.token),
            ticket_body.clone(),
        )
        .await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(refused.code(), "limit_reached");
    assert_eq!(
        refused.json["error"]["details"]["limit"],
        "limits.photos_max"
    );
    assert_eq!(refused.json["error"]["details"]["used"], 6);

    // Rejected and failed photos make room.
    sqlx::query("UPDATE profile_photos SET status = 'rejected' WHERE id = $1")
        .bind(ids[0])
        .execute(app.db())
        .await
        .unwrap();
    sqlx::query("UPDATE profile_photos SET status = 'failed' WHERE id = $1")
        .bind(ids[1])
        .execute(app.db())
        .await
        .unwrap();
    let ticket = app
        .post(
            "/v1/me/photos/uploads",
            Some(&user.token),
            ticket_body.clone(),
        )
        .await;
    assert_eq!(ticket.status, StatusCode::OK);

    // The limit is checked again when the upload is confirmed.
    let key = ticket.json["upload_key"].as_str().unwrap().to_owned();
    app.storage
        .put(&key, jpeg(500, 500), "image/jpeg")
        .await
        .unwrap();
    add_photo(&app, &user, "pending_review").await;
    add_photo(&app, &user, "pending_review").await;
    let confirm = app
        .post(
            "/v1/me/photos",
            Some(&user.token),
            json!({ "upload_key": key }),
        )
        .await;
    assert_eq!(confirm.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(confirm.code(), "limit_reached");

    // `limits.photos_max` is a setting.
    app.state
        .settings
        .put("limits.photos_max", &json!(8), None)
        .await
        .unwrap();
    let allowed = app
        .post(
            "/v1/me/photos",
            Some(&user.token),
            json!({ "upload_key": key }),
        )
        .await;
    assert_eq!(allowed.status, StatusCode::CREATED, "{}", allowed.text);
}

#[sqlx::test]
async fn confirmation_checks_whose_upload_it_is_and_whether_it_is_there(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    let token = Some(user.token.as_str());

    // An object that was never uploaded.
    let missing = format!("tmp/photos/{}/{}", user.profile_id, Uuid::now_v7());
    let response = app
        .post("/v1/me/photos", token, json!({ "upload_key": missing }))
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);

    // Keys that are not tickets of this profile.
    for key in [
        format!("tmp/photos/{}/{}", other.profile_id, Uuid::now_v7()),
        format!("tmp/photos/{}/not-a-uuid", user.profile_id),
        format!("photos/{}/{}/large.jpg", user.profile_id, Uuid::now_v7()),
        format!("verification/{}/{}", user.profile_id, Uuid::now_v7()),
        "tmp/photos/".to_owned(),
    ] {
        let response = app
            .post("/v1/me/photos", token, json!({ "upload_key": key }))
            .await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{key}");
    }

    // Someone else's real upload cannot be claimed.
    let theirs = format!("tmp/photos/{}/{}", other.profile_id, Uuid::now_v7());
    app.storage
        .put(&theirs, jpeg(500, 500), "image/jpeg")
        .await
        .unwrap();
    let response = app
        .post("/v1/me/photos", token, json!({ "upload_key": theirs }))
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert!(list(&app, &user).await.is_empty());

    // An oversized object is deleted and refused.
    let big = format!("tmp/photos/{}/{}", user.profile_id, Uuid::now_v7());
    let size = usize::try_from(MAX_UPLOAD_BYTES).unwrap() + 1;
    app.storage
        .put(&big, vec![0; size], "image/jpeg")
        .await
        .unwrap();
    let response = app
        .post("/v1/me/photos", token, json!({ "upload_key": big }))
        .await;
    assert_eq!(response.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(app.storage.head(&big).await.unwrap().is_none());
    assert!(app.queued_jobs("process_photo").await.is_empty());
}

#[sqlx::test]
async fn a_new_photo_goes_after_the_others(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    add_photo(&app, &user, "approved").await;
    add_photo(&app, &user, "pending_review").await;
    let created = upload(&app, &user, jpeg(500, 500)).await;
    assert_eq!(created.json["position"], 2);
}

// ---- The automatic decision ----

#[sqlx::test]
async fn a_clean_photo_is_approved_automatically_when_photo_review_is_auto(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    app.state
        .settings
        .put("moderation.photo_review", &json!("auto"), None)
        .await
        .unwrap();
    *app.content_safety.severity.lock().unwrap() = Some(0);
    let mut socket = app.state.hub.register(user.profile_id, user.user_id);
    sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    let first = upload(&app, &user, jpeg(500, 500)).await;
    let second = upload(&app, &user, jpeg(500, 500)).await;
    app.drain_jobs().await;

    let photos = list(&app, &user).await;
    assert_eq!(photos.len(), 2);
    assert!(photos.iter().all(|photo| photo["status"] == "approved"));
    let primary: Vec<&Value> = photos.iter().filter(|p| p["is_primary"] == true).collect();
    assert_eq!(primary.len(), 1, "exactly one primary photo");
    assert_eq!(
        primary[0]["id"], first.json["id"],
        "the first approved photo is primary"
    );
    assert_ne!(primary[0]["id"], second.json["id"]);

    let state = profile_state(&app, &user).await;
    assert!(state.has_approved_photo);
    assert!(state.match_stale);
    // Core 20 + photo 15 + partner preferences 4 (08 section 6.1).
    assert_eq!(state.completeness, 39);
    assert!(
        notification_types(&app, &user).await.is_empty(),
        "no notice for an automatic approval"
    );

    let updates = frames_of(&frames(&mut socket), "photo.updated");
    assert!(updates.len() >= 2, "{updates:?}");
    assert!(
        updates
            .iter()
            .any(|e| e["data"]["photo"]["status"] == "approved")
    );
}

#[sqlx::test]
async fn a_certain_violation_is_rejected_and_repeat_offenders_are_reported(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    *app.content_safety.severity.lock().unwrap() = Some(6);
    let mut socket = app.state.hub.register(user.profile_id, user.user_id);

    let first = upload(&app, &user, jpeg(500, 500)).await;
    app.drain_jobs().await;
    let photo = &list(&app, &user).await[0];
    assert_eq!(photo["id"], first.json["id"]);
    assert_eq!(photo["status"], "rejected");
    assert_eq!(photo["rejection_reason"], "inappropriate");
    assert_eq!(photo["is_primary"], false);
    assert_eq!(notification_types(&app, &user).await, ["photo_rejected"]);
    let data: Value = sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
        .bind(user.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(data["photo_id"], first.json["id"]);
    assert_eq!(data["rejection_reason"], "inappropriate");
    assert!(!profile_state(&app, &user).await.has_approved_photo);

    // The files are kept 30 days in case of an appeal, then deleted.
    let (keys, due): (Value, bool) = sqlx::query_as(
        "SELECT payload -> 'keys', run_at > now() + interval '29 days'
         FROM jobs WHERE kind = 'delete_objects' AND status = 'queued'",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!(due);
    assert_eq!(keys.as_array().unwrap().len(), VARIANTS.len());
    assert_eq!(frames_of(&frames(&mut socket), "photo.updated").len(), 1);

    let reports = |app: &TestApp| {
        let db = app.db().clone();
        let profile_id = user.profile_id;
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM reports WHERE source = 'system' AND reason = 'inappropriate_photo'
                   AND target_profile_id = $1",
            )
            .bind(profile_id)
            .fetch_one(&db)
            .await
            .unwrap()
        }
    };
    assert_eq!(reports(&app).await, 0, "one rejection is not a pattern");
    upload(&app, &user, jpeg(500, 500)).await;
    app.drain_jobs().await;
    assert_eq!(
        reports(&app).await,
        1,
        "two within 24 hours file a system report"
    );
    upload(&app, &user, jpeg(500, 500)).await;
    app.drain_jobs().await;
    assert_eq!(reports(&app).await, 1, "and only one");
    let (source, subject, photo_id): (String, String, Option<Uuid>) = sqlx::query_as(
        "SELECT source, subject_type, photo_id FROM reports WHERE reason = 'inappropriate_photo'",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!((source.as_str(), subject.as_str()), ("system", "photo"));
    assert!(photo_id.is_some());
}

#[sqlx::test]
async fn photos_that_are_flagged_unchecked_or_under_manual_review_wait_for_a_moderator(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let settings = &app.state.settings;
    settings
        .put("moderation.photo_review", &json!("auto"), None)
        .await
        .unwrap();

    // Flagged by the check.
    *app.content_safety.severity.lock().unwrap() = Some(2);
    upload(&app, &user, jpeg(500, 500)).await;
    app.drain_jobs().await;
    // The check is down although review is automatic.
    *app.content_safety.severity.lock().unwrap() = None;
    upload(&app, &user, jpeg(500, 500)).await;
    app.drain_jobs().await;
    // Clean, but review is manual.
    settings
        .put("moderation.photo_review", &json!("manual"), None)
        .await
        .unwrap();
    *app.content_safety.severity.lock().unwrap() = Some(0);
    upload(&app, &user, jpeg(500, 500)).await;
    app.drain_jobs().await;

    let results: Vec<(String, String)> = sqlx::query_as(
        "SELECT status, moderation ->> 'result' FROM profile_photos
         WHERE profile_id = $1 ORDER BY position",
    )
    .bind(user.profile_id)
    .fetch_all(app.db())
    .await
    .unwrap();
    let expected = [
        ("pending_review", "flag"),
        ("pending_review", "unavailable"),
        ("pending_review", "clean"),
    ];
    assert_eq!(
        results
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect::<Vec<_>>(),
        expected
    );
    assert!(!profile_state(&app, &user).await.has_approved_photo);
    assert!(notification_types(&app, &user).await.is_empty());
}

#[sqlx::test]
async fn a_photo_deleted_while_processing_is_not_resurrected(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let created = upload(&app, &user, jpeg(500, 500)).await;
    let id = created.json["id"].as_str().unwrap().to_owned();
    let deleted = app
        .delete(&format!("/v1/me/photos/{id}"), Some(&user.token))
        .await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    app.drain_jobs().await;
    assert!(list(&app, &user).await.is_empty());
    assert!(
        app.storage.keys().is_empty(),
        "no variants and no upload are left"
    );
}

// ---- Primary, order, delete ----

#[sqlx::test]
async fn the_primary_photo_can_be_changed_to_an_approved_photo_only(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    let a = add_photo(&app, &user, "approved").await;
    let b = add_photo(&app, &user, "approved").await;
    let c = add_photo(&app, &user, "pending_review").await;
    let foreign = add_photo(&app, &other, "approved").await;
    let token = Some(user.token.as_str());

    let photos = list(&app, &user).await;
    assert_eq!(photos[0]["id"], a.to_string());
    assert_eq!(
        photos[0]["is_primary"], true,
        "the first approved photo became primary"
    );
    assert_eq!(photos[1]["is_primary"], false);

    sqlx::query("UPDATE profiles SET is_photo_verified = true, match_stale = false WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    let changed = app
        .patch(
            &format!("/v1/me/photos/{b}"),
            token,
            json!({ "is_primary": true }),
        )
        .await;
    assert_eq!(changed.status, StatusCode::OK, "{}", changed.text);
    let list_after = changed.json.as_array().unwrap();
    assert_eq!(list_after.len(), 3);
    let primary: Vec<&Value> = list_after
        .iter()
        .filter(|p| p["is_primary"] == true)
        .collect();
    assert_eq!(primary.len(), 1);
    assert_eq!(primary[0]["id"], b.to_string());
    let state = profile_state(&app, &user).await;
    assert!(
        !state.is_photo_verified,
        "a different main photo clears the badge"
    );
    assert!(state.match_stale);

    // The photo that is already primary: nothing changes, the badge stays.
    sqlx::query("UPDATE profiles SET is_photo_verified = true WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    let same = app
        .patch(
            &format!("/v1/me/photos/{b}"),
            token,
            json!({ "is_primary": true }),
        )
        .await;
    assert_eq!(same.status, StatusCode::OK);
    assert!(profile_state(&app, &user).await.is_photo_verified);

    // Only approved photos, only the caller's, only `true`.
    let pending = app
        .patch(
            &format!("/v1/me/photos/{c}"),
            token,
            json!({ "is_primary": true }),
        )
        .await;
    assert_eq!(pending.status, StatusCode::CONFLICT);
    assert_eq!(pending.code(), "invalid_state");
    assert_eq!(pending.json["error"]["details"]["status"], "pending_review");
    for path in [
        format!("/v1/me/photos/{foreign}"),
        format!("/v1/me/photos/{}", Uuid::now_v7()),
        "/v1/me/photos/not-a-uuid".to_owned(),
    ] {
        let response = app.patch(&path, token, json!({ "is_primary": true })).await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
    }
    let off = app
        .patch(
            &format!("/v1/me/photos/{a}"),
            token,
            json!({ "is_primary": false }),
        )
        .await;
    assert_eq!(off.field_errors(), ["is_primary:invalid"]);
    let unknown = app
        .patch(
            &format!("/v1/me/photos/{a}"),
            token,
            json!({ "is_primary": true, "x": 1 }),
        )
        .await;
    assert_eq!(unknown.code(), "bad_request");
    assert_eq!(status_of(&app, foreign).await, "approved");
}

#[sqlx::test]
async fn photos_can_be_reordered_without_changing_the_primary(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    let a = add_photo(&app, &user, "approved").await;
    let b = add_photo(&app, &user, "approved").await;
    let c = add_photo(&app, &user, "rejected").await;
    let foreign = add_photo(&app, &other, "approved").await;
    let token = Some(user.token.as_str());

    let order = |ids: &[Uuid]| json!({ "photo_ids": ids });
    let response = app
        .put("/v1/me/photos/order", token, order(&[c, b, a]))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    let ids: Vec<&str> = response
        .json
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [c.to_string(), b.to_string(), a.to_string()]);
    let positions: Vec<i64> = response
        .json
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["position"].as_i64().unwrap())
        .collect();
    assert_eq!(positions, [0, 1, 2]);
    let primary: Vec<&Value> = response
        .json
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["is_primary"] == true)
        .collect();
    assert_eq!(
        primary[0]["id"],
        a.to_string(),
        "the order does not change the main photo"
    );
    assert_eq!(
        list(&app, &user)
            .await
            .iter()
            .map(|p| p["id"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>(),
        ids
    );

    // Every photo exactly once.
    for (name, body) in [
        ("missing one", order(&[a, b])),
        ("duplicate", order(&[a, a, b])),
        ("foreign photo", order(&[a, b, foreign])),
        ("extra photo", order(&[a, b, c, foreign])),
        ("empty", order(&[])),
    ] {
        let response = app.put("/v1/me/photos/order", token, body).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST, "{name}");
        assert_eq!(response.field_errors(), ["photo_ids:invalid"], "{name}");
    }
}

#[sqlx::test]
async fn deleting_the_primary_hands_it_over_and_deletes_the_files_through_a_job(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    let a = add_photo(&app, &user, "approved").await;
    let b = add_photo(&app, &user, "approved").await;
    let c = add_photo(&app, &user, "pending_review").await;
    let foreign = add_photo(&app, &other, "approved").await;
    let token = Some(user.token.as_str());
    let verified = |app: &TestApp| {
        let app_db = app.db().clone();
        let profile_id = user.profile_id;
        async move {
            sqlx::query_scalar::<_, bool>("SELECT is_photo_verified FROM profiles WHERE id = $1")
                .bind(profile_id)
                .fetch_one(&app_db)
                .await
                .unwrap()
        }
    };
    sqlx::query("UPDATE profiles SET is_photo_verified = true WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    // A photo that is not the primary one: the badge stays.
    let response = app.delete(&format!("/v1/me/photos/{c}"), token).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert!(verified(&app).await);
    let jobs = app.queued_jobs("delete_objects").await;
    assert_eq!(jobs.len(), 1);
    let keys = jobs[0]["keys"].as_array().unwrap();
    assert_eq!(keys.len(), 6, "five variants and the temporary upload");
    assert!(
        keys.iter()
            .any(|k| k.as_str().unwrap().ends_with(&format!("{c}/large.jpg")))
    );
    app.drain_jobs().await;
    assert!(
        app.storage
            .keys()
            .iter()
            .all(|k| !k.contains(&c.to_string())),
        "the files of the deleted photo are gone"
    );
    assert!(
        app.storage
            .keys()
            .iter()
            .any(|k| k.contains(&a.to_string())),
        "the others are not touched"
    );

    // The primary photo: the next approved photo takes over and the badge is cleared.
    let response = app.delete(&format!("/v1/me/photos/{a}"), token).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    let photos = list(&app, &user).await;
    assert_eq!(photos.len(), 1);
    assert_eq!(photos[0]["id"], b.to_string());
    assert_eq!(photos[0]["is_primary"], true);
    assert!(!verified(&app).await);
    assert!(profile_state(&app, &user).await.has_approved_photo);

    // The last approved photo.
    let response = app.delete(&format!("/v1/me/photos/{b}"), token).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    let state = profile_state(&app, &user).await;
    assert!(!state.has_approved_photo);
    // Core 20 + partner preferences 4: the photo points are gone.
    assert_eq!(state.completeness, 24);
    assert!(list(&app, &user).await.is_empty());

    // Not the caller's, or not there.
    for id in [foreign, a, Uuid::now_v7()] {
        let response = app.delete(&format!("/v1/me/photos/{id}"), token).await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{id}");
    }
    assert_eq!(status_of(&app, foreign).await, "approved");
}

// ---- Access ----

#[sqlx::test]
async fn photo_endpoints_need_a_usable_account(db: PgPool) {
    let app = TestApp::new(db).await;
    let anonymous = app.get("/v1/me/photos", None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);

    let draft = app.draft_user().await;
    assert!(
        list(&app, &draft).await.is_empty(),
        "photos are part of onboarding"
    );

    let suspended = app
        .member_with(|spec| spec.user_status = UserStatus::Suspended)
        .await;
    let response = app.get("/v1/me/photos", Some(&suspended.token)).await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(response.code(), "account_suspended");

    let closed = app
        .member_with(|spec| spec.status = ProfileStatus::Closed)
        .await;
    assert!(
        list(&app, &closed).await.is_empty(),
        "closed profiles may still edit photos"
    );
}

#[sqlx::test]
async fn members_only_ever_see_their_own_photos(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    add_photo(&app, &other, "approved").await;
    assert!(list(&app, &user).await.is_empty());
    assert_eq!(list(&app, &other).await.len(), 1);
}

/// 13 section 6.3 rule 3: a deleted photo with an unresolved report keeps its files for 30 days;
/// one without a report, or with a resolved report, has them deleted at once.
#[sqlx::test]
async fn a_reported_photo_keeps_its_files_for_thirty_days(db: PgPool) {
    let app = TestApp::new(db).await;
    let owner = app.member().await;
    let reporter = app.member_of(crate::domain::options::Gender::Female).await;
    let reported = add_photo(&app, &owner, "approved").await;
    let resolved = add_photo(&app, &owner, "approved").await;
    for (photo, status) in [(reported, "open"), (resolved, "dismissed")] {
        sqlx::query(
            "INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, photo_id,
                                  reason, status)
             VALUES ($1, $2, 'photo', $3, 'inappropriate_photo', $4)",
        )
        .bind(reporter.profile_id)
        .bind(owner.profile_id)
        .bind(photo)
        .bind(status)
        .execute(app.db())
        .await
        .unwrap();
    }

    for photo in [reported, resolved] {
        let response = app
            .delete(&format!("/v1/me/photos/{photo}"), Some(&owner.token))
            .await;
        assert_eq!(response.status, StatusCode::NO_CONTENT);
    }
    let due_in_days: Vec<(Value, f64)> = sqlx::query_as(
        "SELECT payload, EXTRACT(EPOCH FROM run_at - now())::float8 / 86400
         FROM jobs WHERE kind = 'delete_objects' ORDER BY created_at",
    )
    .fetch_all(app.db())
    .await
    .unwrap();
    assert_eq!(due_in_days.len(), 2);
    let holds = |(payload, _): &(Value, f64), photo: Uuid| {
        payload["keys"]
            .as_array()
            .unwrap()
            .iter()
            .any(|key| key.as_str().unwrap().contains(&photo.to_string()))
    };
    let kept = due_in_days.iter().find(|job| holds(job, reported)).unwrap();
    assert!((29.9..=30.1).contains(&kept.1), "kept 30 days: {}", kept.1);
    let gone = due_in_days.iter().find(|job| holds(job, resolved)).unwrap();
    assert!(gone.1 < 0.01, "deleted at once: {}", gone.1);
}
