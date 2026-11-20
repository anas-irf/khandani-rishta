//! The staff verification queue and decisions, end to end (15 section 16, 18 section 4.4, 12).
#![expect(
    clippy::assert_is_empty,
    reason = "`assert!(list.is_empty())` reads better than comparing with a typed empty array"
)]

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::time::karachi_date;
use crate::domain::types::{Gesture, UserRole};
use crate::jobs::{NewJob, enqueue};
use crate::models::verifications::challenge_for;
use crate::routes::photos::fixtures::{
    add_identity, add_photo, audit_count, audit_rows, notification_types, profile_state,
    submit_id_document, submit_selfie,
};
use crate::services::r2::ObjectStore;
use crate::test_support::{TestApp, TestUser};

const CNIC: &str = "3520212345671";

/// A member with an approved photo, a registered CNIC (a different one each time, because a
/// number belongs to one profile) and a pending identity check.
async fn member_with_identity_check(app: &TestApp) -> (TestUser, Uuid) {
    let number = format!("35202{:07}1", Uuid::now_v7().as_u128() % 10_000_000);
    member_with_identity_number(app, &number).await
}

async fn member_with_identity_number(app: &TestApp, number: &str) -> (TestUser, Uuid) {
    let member = app.member().await;
    add_photo(app, &member, "approved").await;
    add_identity(app, &member, "cnic", number, "unverified").await;
    let request = submit_id_document(app, &member).await;
    assert_eq!(request.status, StatusCode::CREATED, "{}", request.text);
    let id = Uuid::parse_str(request.json["id"].as_str().unwrap()).unwrap();
    (member, id)
}

fn url(id: Uuid, action: &str) -> String {
    format!("/v1/admin/verifications/{id}/{action}")
}

async fn request_state(app: &TestApp, id: Uuid) -> (String, Option<String>, Option<Uuid>, bool) {
    sqlx::query_as(
        "SELECT status, rejection_reason, reviewed_by,
                COALESCE(media_purge_after BETWEEN now() + interval '29 days' AND now() + interval '31 days', false)
         FROM verification_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_one(app.db())
    .await
    .unwrap()
}

async fn identity_status(app: &TestApp, user: &TestUser) -> String {
    sqlx::query_scalar("SELECT status FROM profile_identity WHERE profile_id = $1")
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

// ---- The queue ----

#[sqlx::test]
async fn the_queue_lists_pending_requests_oldest_first(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let (first, first_id) = member_with_identity_check(&app).await;
    let second = app.member().await;
    add_photo(&app, &second, "approved").await;
    let second_id = Uuid::parse_str(
        submit_selfie(&app, &second).await.json["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let decided = app.member().await;
    sqlx::query(
        "INSERT INTO verification_requests (profile_id, kind, status, selfie_key, gesture)
         VALUES ($1, 'selfie', 'approved', 'verification/x/y', 'thumbs_up')",
    )
    .bind(decided.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    let token = Some(moderator.token.as_str());

    let response = app.get("/v1/admin/verifications", token).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    let items = response.json["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["request_id"], first_id.to_string());
    assert_eq!(items[0]["kind"], "id_document");
    assert_eq!(items[0]["status"], "pending");
    assert_eq!(items[0]["profile_id"], first.profile_id.to_string());
    assert!(items[0]["public_code"].as_str().unwrap().starts_with("KR"));
    assert_eq!(items[0]["first_name"], "Ahmed");
    assert!(items[0]["created_at"].is_string());
    assert_eq!(items[1]["request_id"], second_id.to_string());

    let selfies = app.get("/v1/admin/verifications?kind=selfie", token).await;
    assert_eq!(selfies.json["items"].as_array().unwrap().len(), 1);
    let approved = app
        .get("/v1/admin/verifications?status=approved", token)
        .await;
    assert_eq!(approved.json["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        app.get("/v1/admin/verifications?status=other", token)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );

    let page = app.get("/v1/admin/verifications?limit=1", token).await;
    assert_eq!(page.json["items"][0]["request_id"], first_id.to_string());
    let cursor = page.json["next_cursor"].as_str().unwrap();
    let next = app
        .get(
            &format!("/v1/admin/verifications?limit=1&cursor={cursor}"),
            token,
        )
        .await;
    assert_eq!(next.json["items"][0]["request_id"], second_id.to_string());
    assert_eq!(next.json["next_cursor"], Value::Null);
}

// ---- The detail ----

#[sqlx::test]
async fn viewing_a_request_shows_the_number_and_images_and_writes_an_audit_row(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let (member, id) = member_with_identity_number(&app, CNIC).await;
    sqlx::query(
        "INSERT INTO verification_requests (profile_id, kind, status, rejection_reason, selfie_key, gesture)
         VALUES ($1, 'id_document', 'rejected', 'unreadable', 'verification/x/y', 'thumbs_up')",
    )
    .bind(member.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    let token = Some(moderator.token.as_str());

    assert_eq!(audit_count(&app).await, 0);
    let response = app
        .get(&format!("/v1/admin/verifications/{id}"), token)
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    assert_eq!(response.headers["cache-control"], "no-store");

    let detail = &response.json;
    assert_eq!(detail["request_id"], id.to_string());
    assert_eq!(detail["kind"], "id_document");
    assert_eq!(detail["status"], "pending");
    assert_eq!(
        detail["gesture"],
        challenge_for(member.profile_id, karachi_date(OffsetDateTime::now_utc())).as_str()
    );
    assert_eq!(detail["gesture_valid"], true);
    assert_eq!(detail["media_purged"], false);
    for slot in ["front_url", "back_url", "selfie_url"] {
        let signed = detail["images"][slot].as_str().unwrap();
        assert!(signed.contains("verification/"), "{slot}");
        assert!(
            signed.contains("expires=600"),
            "{slot} is valid for 10 minutes"
        );
    }
    assert_eq!(
        detail["identity"],
        json!({ "document_type": "cnic", "number": "35202-1234567-1", "status": "pending" })
    );
    let profile = &detail["profile"];
    assert_eq!(profile["profile_id"], member.profile_id.to_string());
    assert_eq!(profile["first_name"], "Ahmed");
    assert_eq!(profile["last_name"], "Khan");
    assert_eq!(profile["gender"], "male");
    assert_eq!(profile["date_of_birth"].as_str().unwrap().len(), 10);
    assert!(profile["age"].as_i64().unwrap() >= 27);
    assert_eq!(profile["marital_status"], "never_married");
    assert_eq!(profile["managed_by"], "self");
    assert_eq!(profile["manager_name"], Value::Null);
    let photos = profile["photos"].as_array().unwrap();
    assert_eq!(photos.len(), 1);
    assert_eq!(photos[0]["status"], "approved");
    assert_eq!(photos[0]["is_primary"], true);
    assert!(
        photos[0]["large_url"]
            .as_str()
            .unwrap()
            .contains("large.jpg")
    );
    let previous = detail["previous_requests"].as_array().unwrap();
    assert_eq!(previous.len(), 1);
    assert_eq!(previous[0]["status"], "rejected");
    assert_eq!(previous[0]["rejection_reason"], "unreadable");

    // Every view is audited, including a second one of the same request.
    let audit = audit_rows(&app, "verification.view").await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].actor_user_id, moderator.user_id);
    assert_eq!(audit[0].target_type, "verification_request");
    assert_eq!(audit[0].target_id, id.to_string());
    assert_eq!(
        audit[0].details,
        json!({ "profile_id": member.profile_id, "kind": "id_document" })
    );
    assert!(
        !audit[0].details.to_string().contains(CNIC),
        "never the number"
    );
    app.get(&format!("/v1/admin/verifications/{id}"), token)
        .await;
    assert_eq!(audit_rows(&app, "verification.view").await.len(), 2);

    // Unknown requests and members get nothing and leave no row.
    let unknown = app
        .get(
            &format!("/v1/admin/verifications/{}", Uuid::now_v7()),
            token,
        )
        .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    let by_member = app
        .get(
            &format!("/v1/admin/verifications/{id}"),
            Some(&member.token),
        )
        .await;
    assert_eq!(by_member.status, StatusCode::FORBIDDEN);
    assert!(!by_member.text.contains("35202"));
    assert_eq!(audit_count(&app).await, 2);
}

#[sqlx::test]
async fn a_selfie_request_has_no_identity_and_the_gesture_is_checked_against_the_day(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    add_photo(&app, &member, "approved").await;
    let id = Uuid::parse_str(
        submit_selfie(&app, &member).await.json["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let token = Some(moderator.token.as_str());

    let detail = app
        .get(&format!("/v1/admin/verifications/{id}"), token)
        .await
        .json;
    assert_eq!(detail["kind"], "selfie");
    assert_eq!(detail["identity"], Value::Null);
    assert_eq!(detail["images"]["front_url"], Value::Null);
    assert_eq!(detail["images"]["back_url"], Value::Null);
    assert!(detail["images"]["selfie_url"].is_string());
    assert_eq!(detail["gesture_valid"], true);

    // Submitted five days ago with a gesture that was neither that day's nor the day before's.
    sqlx::query(
        "UPDATE verification_requests SET created_at = now() - interval '5 days' WHERE id = $1",
    )
    .bind(id)
    .execute(app.db())
    .await
    .unwrap();
    let created: OffsetDateTime =
        sqlx::query_scalar("SELECT created_at FROM verification_requests WHERE id = $1")
            .bind(id)
            .fetch_one(app.db())
            .await
            .unwrap();
    let day = karachi_date(created);
    let valid = [
        challenge_for(member.profile_id, day),
        challenge_for(member.profile_id, day.previous_day().unwrap()),
    ];
    let other = Gesture::ALL.iter().find(|g| !valid.contains(g)).unwrap();
    sqlx::query("UPDATE verification_requests SET gesture = $2 WHERE id = $1")
        .bind(id)
        .bind(other.as_str())
        .execute(app.db())
        .await
        .unwrap();
    let detail = app
        .get(&format!("/v1/admin/verifications/{id}"), token)
        .await
        .json;
    assert_eq!(detail["gesture"], other.as_str());
    assert_eq!(detail["gesture_valid"], false);
}

// ---- Approving ----

#[sqlx::test]
async fn approving_an_identity_check_sets_the_badge_and_locks_the_names(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let (member, id) = member_with_identity_check(&app).await;
    sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
        .bind(member.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    let response = app
        .post(
            &url(id, "approve"),
            Some(&moderator.token),
            json!({ "photos_match": true }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);

    let (status, reason, reviewer, purge_in_30_days) = request_state(&app, id).await;
    assert_eq!((status.as_str(), reason), ("approved", None));
    assert_eq!(reviewer, Some(moderator.user_id));
    assert!(
        purge_in_30_days,
        "images are kept 30 days after the decision"
    );
    assert_eq!(identity_status(&app, &member).await, "verified");
    let verified_at: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT verified_at FROM profile_identity WHERE profile_id = $1")
            .bind(member.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(verified_at.is_some());

    // `is_id_verified` is what locks the names (03 section 8 rule 15), and what the badge reads.
    let state = profile_state(&app, &member).await;
    assert!(state.is_id_verified);
    assert!(
        state.is_photo_verified,
        "the moderator confirmed the selfie matches the photos"
    );
    assert!(state.match_stale);
    // Core 20, photo 15, partner preferences 4, identity 3, id badge 3, photo badge 2.
    assert_eq!(state.completeness, 47);
    let me = app.get("/v1/me", Some(&member.token)).await;
    let badges = me.json["profile"]["badges"].as_array().unwrap().clone();
    assert!(badges.contains(&json!("id_verified")));
    assert!(badges.contains(&json!("photo_verified")));
    let overview = app.get("/v1/me/verifications", Some(&member.token)).await;
    assert_eq!(overview.json["id_verified"], true);
    assert_eq!(overview.json["identity"]["status"], "verified");
    assert_eq!(overview.json["requests"][0]["status"], "approved");

    // The member is told, by notification and by email; one audit row.
    assert_eq!(
        notification_types(&app, &member).await,
        ["verification_approved"]
    );
    let data: Value = sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
        .bind(member.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(data, json!({ "request_id": id, "kind": "id_document" }));
    let emails = app.queued_jobs("send_email").await;
    assert_eq!(emails.len(), 1);
    assert_eq!(emails[0]["template"], "verification_result");
    assert_eq!(emails[0]["user_id"], member.user_id.to_string());
    assert_eq!(emails[0]["data"]["result"], "approved");
    let audit = audit_rows(&app, "verification.approve").await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit_count(&app).await, 1);
    assert_eq!(audit[0].actor_user_id, moderator.user_id);
    assert_eq!(audit[0].target_type, "verification_request");
    assert_eq!(audit[0].target_id, id.to_string());
    assert_eq!(
        audit[0].details,
        json!({ "profile_id": member.profile_id, "kind": "id_document", "photos_match": true })
    );

    // Decided once.
    let again = app
        .post(&url(id, "approve"), Some(&moderator.token), json!({}))
        .await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(again.code(), "invalid_state");
    assert_eq!(again.json["error"]["details"]["status"], "approved");
    let reject = app
        .post(
            &url(id, "reject"),
            Some(&moderator.token),
            json!({ "reason": "other" }),
        )
        .await;
    assert_eq!(reject.status, StatusCode::CONFLICT);
    assert_eq!(audit_count(&app).await, 1);
}

#[sqlx::test]
async fn the_photo_badge_needs_the_moderators_confirmation_and_the_body_may_be_left_out(
    db: PgPool,
) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let (member, id) = member_with_identity_check(&app).await;

    let response = app
        .post_empty(&url(id, "approve"), Some(&moderator.token))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);
    let state = profile_state(&app, &member).await;
    assert!(state.is_id_verified);
    assert!(!state.is_photo_verified, "no confirmation, no photo badge");
    assert_eq!(state.completeness, 45);
    let audit = audit_rows(&app, "verification.approve").await;
    assert_eq!(audit[0].details["photos_match"], Value::Null);

    // Unknown keys in the body are refused.
    let (_, other_id) = member_with_identity_check(&app).await;
    let response = app
        .post(
            &url(other_id, "approve"),
            Some(&moderator.token),
            json!({ "photos_match": true, "x": 1 }),
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(request_state(&app, other_id).await.0, "pending");
}

#[sqlx::test]
async fn approving_a_photo_check_sets_the_photo_badge(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    add_photo(&app, &member, "approved").await;
    let id = Uuid::parse_str(
        submit_selfie(&app, &member).await.json["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();

    let response = app
        .post_empty(&url(id, "approve"), Some(&moderator.token))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);
    let state = profile_state(&app, &member).await;
    assert!(state.is_photo_verified);
    assert!(!state.is_id_verified);
    // Core 20, photo 15, partner preferences 4, photo badge 2.
    assert_eq!(state.completeness, 41);
    assert_eq!(request_state(&app, id).await.0, "approved");
    let data: Value = sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
        .bind(member.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(data, json!({ "request_id": id, "kind": "selfie" }));
    let audit = audit_rows(&app, "verification.approve").await;
    assert_eq!(audit[0].details["kind"], "selfie");
    assert_eq!(audit[0].details["photos_match"], Value::Null);
}

#[sqlx::test]
async fn a_photo_check_cannot_be_approved_when_the_photos_are_gone(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    let photo = add_photo(&app, &member, "approved").await;
    let id = Uuid::parse_str(
        submit_selfie(&app, &member).await.json["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let deleted = app
        .delete(&format!("/v1/me/photos/{photo}"), Some(&member.token))
        .await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    let response = app
        .post_empty(&url(id, "approve"), Some(&moderator.token))
        .await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.code(), "invalid_state");
    assert_eq!(
        response.json["error"]["details"]["reason"],
        "no_approved_photo"
    );
    assert_eq!(
        request_state(&app, id).await.0,
        "pending",
        "nothing was written"
    );
    assert!(!profile_state(&app, &member).await.is_photo_verified);
    assert_eq!(audit_count(&app).await, 0);
    assert!(notification_types(&app, &member).await.is_empty());
}

// ---- Rejecting ----

#[sqlx::test]
async fn rejecting_an_identity_check_keeps_the_reason_for_the_member_and_the_note_for_staff(
    db: PgPool,
) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let (member, id) = member_with_identity_check(&app).await;
    let token = Some(moderator.token.as_str());

    let bad = app
        .post(&url(id, "reject"), token, json!({ "reason": "ugly" }))
        .await;
    assert_eq!(bad.field_errors(), ["reason:unknown_code"]);
    let long = app
        .post(
            &url(id, "reject"),
            token,
            json!({ "reason": "other", "note": "x".repeat(501) }),
        )
        .await;
    assert_eq!(long.field_errors(), ["note:too_long"]);
    assert_eq!(request_state(&app, id).await.0, "pending");
    assert_eq!(audit_count(&app).await, 0);

    let response = app
        .post(
            &url(id, "reject"),
            token,
            json!({ "reason": "document_mismatch", "note": "Date of birth on the card is 1994-02-03" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);
    let (status, reason, reviewer, purge_in_30_days) = request_state(&app, id).await;
    assert_eq!(status, "rejected");
    assert_eq!(reason.as_deref(), Some("document_mismatch"));
    assert_eq!(reviewer, Some(moderator.user_id));
    assert!(purge_in_30_days);
    let note: Option<String> =
        sqlx::query_scalar("SELECT reviewer_note FROM verification_requests WHERE id = $1")
            .bind(id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(
        note.as_deref(),
        Some("Date of birth on the card is 1994-02-03")
    );
    assert_eq!(identity_status(&app, &member).await, "rejected");
    let state = profile_state(&app, &member).await;
    assert!(!state.is_id_verified && !state.is_photo_verified);

    assert_eq!(
        notification_types(&app, &member).await,
        ["verification_rejected"]
    );
    let data: Value = sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
        .bind(member.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(
        data,
        json!({ "request_id": id, "kind": "id_document", "rejection_reason": "document_mismatch" })
    );
    let emails = app.queued_jobs("send_email").await;
    assert_eq!(emails[0]["data"]["rejection_reason"], "document_mismatch");
    assert!(
        !emails[0].to_string().contains("1994"),
        "the staff note stays with staff"
    );
    let audit = audit_rows(&app, "verification.reject").await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit_count(&app).await, 1);
    assert_eq!(
        audit[0].details,
        json!({ "profile_id": member.profile_id, "kind": "id_document", "reason": "document_mismatch" })
    );

    // The member sees the reason, never the note, and may submit again at once.
    let overview = app.get("/v1/me/verifications", Some(&member.token)).await;
    assert_eq!(
        overview.json["requests"][0]["rejection_reason"],
        "document_mismatch"
    );
    assert_eq!(overview.json["identity"]["status"], "rejected");
    assert!(!overview.text.contains("1994"));
    let again = submit_id_document(&app, &member).await;
    assert_eq!(again.status, StatusCode::CREATED, "{}", again.text);
}

#[sqlx::test]
async fn rejecting_a_photo_check_changes_nothing_but_the_request(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = app.member().await;
    add_photo(&app, &member, "approved").await;
    add_identity(&app, &member, "cnic", CNIC, "pending").await;
    let id = Uuid::parse_str(
        submit_selfie(&app, &member).await.json["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();

    let response = app
        .post(
            &url(id, "reject"),
            Some(&moderator.token),
            json!({ "reason": "face_mismatch" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);
    assert_eq!(
        request_state(&app, id).await.1.as_deref(),
        Some("face_mismatch")
    );
    assert_eq!(
        identity_status(&app, &member).await,
        "pending",
        "a selfie says nothing about the identity"
    );
    assert!(!profile_state(&app, &member).await.is_photo_verified);
    assert_eq!(
        notification_types(&app, &member).await,
        ["verification_rejected"]
    );
}

// ---- Access and retention ----

#[sqlx::test]
async fn members_cannot_decide_and_unknown_requests_are_not_found(db: PgPool) {
    let app = TestApp::new(db).await;
    let admin = app.staff(UserRole::Admin).await;
    let (member, id) = member_with_identity_check(&app).await;

    for (action, body) in [
        ("approve", json!({})),
        ("reject", json!({ "reason": "other" })),
    ] {
        let response = app
            .post(&url(id, action), Some(&member.token), body.clone())
            .await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{action}");
        let response = app.post(&url(id, action), None, body.clone()).await;
        assert_eq!(response.status, StatusCode::UNAUTHORIZED, "{action}");
        let response = app
            .post(&url(Uuid::now_v7(), action), Some(&admin.token), body)
            .await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{action}");
    }
    assert_eq!(request_state(&app, id).await.0, "pending");
    assert_eq!(audit_count(&app).await, 0);
    // Admins review too.
    let response = app
        .post_empty(&url(id, "approve"), Some(&admin.token))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn images_are_purged_after_the_retention_period_and_the_decision_stays(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let (kept, kept_id) = member_with_identity_check(&app).await;
    let (purged, purged_id) = member_with_identity_check(&app).await;
    let (waiting, waiting_id) = member_with_identity_check(&app).await;
    let token = Some(moderator.token.as_str());

    // One decision under the default retention of 30 days, one with it shortened to nothing.
    let response = app.post_empty(&url(kept_id, "approve"), token).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    app.state
        .settings
        .put("verification.media_retention_days", &json!(0), None)
        .await
        .unwrap();
    let response = app
        .post(
            &url(purged_id, "reject"),
            token,
            json!({ "reason": "unreadable" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);

    let images = |id: Uuid| {
        let db = app.db().clone();
        async move {
            sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, bool)>(
                "SELECT front_key, back_key, selfie_key, media_purged_at IS NOT NULL
                 FROM verification_requests WHERE id = $1",
            )
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap()
        }
    };
    let (front, back, selfie, _) = images(purged_id).await;
    let keys: Vec<String> = [front, back, selfie].into_iter().flatten().collect();
    assert_eq!(keys.len(), 3);
    for key in &keys {
        assert!(app.storage.head(key).await.unwrap().is_some());
    }

    enqueue(app.db(), NewJob::new("purge_verification_media", json!({})))
        .await
        .unwrap();
    app.drain_jobs().await;

    // The shortened one is gone: objects, keys, and the detail says so.
    for key in &keys {
        assert!(app.storage.head(key).await.unwrap().is_none(), "{key}");
    }
    assert_eq!(images(purged_id).await, (None, None, None, true));
    let (status, reason, _, _) = request_state(&app, purged_id).await;
    assert_eq!(
        (status.as_str(), reason.as_deref()),
        ("rejected", Some("unreadable"))
    );
    let detail = app
        .get(&format!("/v1/admin/verifications/{purged_id}"), token)
        .await
        .json;
    assert_eq!(detail["media_purged"], true);
    assert_eq!(
        detail["images"],
        json!({ "front_url": null, "back_url": null, "selfie_url": null })
    );
    assert_eq!(detail["status"], "rejected");

    // The 30-day one and the undecided one still have their images.
    for (id, owner) in [(kept_id, &kept), (waiting_id, &waiting)] {
        let (front, back, selfie, purged_at) = images(id).await;
        assert!(
            front.is_some() && back.is_some() && selfie.is_some(),
            "{}",
            owner.profile_id
        );
        assert!(!purged_at);
        assert!(app.storage.head(&front.unwrap()).await.unwrap().is_some());
    }
    assert_eq!(identity_status(&app, &purged).await, "rejected");
}

#[sqlx::test]
async fn a_cancelled_request_is_purged_by_the_next_run(db: PgPool) {
    let app = TestApp::new(db).await;
    let (member, id) = member_with_identity_check(&app).await;
    let (front, ..) = sqlx::query_as::<_, (String, String, String)>(
        "SELECT front_key, back_key, selfie_key FROM verification_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_one(app.db())
    .await
    .unwrap();
    let response = app
        .delete(&format!("/v1/me/verifications/{id}"), Some(&member.token))
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert!(app.storage.head(&front).await.unwrap().is_some());

    enqueue(app.db(), NewJob::new("purge_verification_media", json!({})))
        .await
        .unwrap();
    app.drain_jobs().await;
    assert!(app.storage.head(&front).await.unwrap().is_none());
    let purged: bool = sqlx::query_scalar(
        "SELECT media_purged_at IS NOT NULL AND front_key IS NULL FROM verification_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!(purged);
}
