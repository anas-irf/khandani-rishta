//! The member side of verification, end to end (15 section 9, 12).
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
use crate::domain::types::{Gesture, ProfileStatus, UserStatus};
use crate::models::verifications::challenge_for;
use crate::routes::photos::fixtures::{
    add_identity, add_photo, profile_state, submit_id_document, submit_selfie, todays_gesture,
    verification_image,
};
use crate::test_support::{TestApp, TestUser};

const CNIC: &str = "3520212345671";

async fn identity_status(app: &TestApp, user: &TestUser) -> String {
    sqlx::query_scalar("SELECT status FROM profile_identity WHERE profile_id = $1")
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

async fn overview(app: &TestApp, user: &TestUser) -> Value {
    let response = app.get("/v1/me/verifications", Some(&user.token)).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    response.json
}

// ---- The challenge ----

#[sqlx::test]
async fn the_selfie_challenge_follows_the_profile_and_the_day(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    let today = karachi_date(OffsetDateTime::now_utc());

    let response = app
        .get("/v1/me/verifications/selfie-challenge", Some(&user.token))
        .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(
        response.json["gesture"],
        challenge_for(user.profile_id, today).as_str()
    );
    let again = app
        .get("/v1/me/verifications/selfie-challenge", Some(&user.token))
        .await;
    assert_eq!(again.json, response.json, "stable for the day");

    // Each member has their own derivation, and the four gestures are all reachable.
    let theirs = app
        .get("/v1/me/verifications/selfie-challenge", Some(&other.token))
        .await;
    assert_eq!(
        theirs.json["gesture"],
        challenge_for(other.profile_id, today).as_str()
    );
    assert!(
        Gesture::ALL
            .iter()
            .any(|g| g.as_str() == theirs.json["gesture"])
    );

    let anonymous = app.get("/v1/me/verifications/selfie-challenge", None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

// ---- Uploads ----

#[sqlx::test]
async fn verification_uploads_go_under_the_verification_prefix(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let token = Some(user.token.as_str());

    let ticket = app
        .post(
            "/v1/me/verifications/uploads",
            token,
            json!({ "slot": "front", "content_type": "image/png", "size_bytes": 500 }),
        )
        .await;
    assert_eq!(ticket.status, StatusCode::OK, "{}", ticket.text);
    assert!(
        ticket.json["upload_key"]
            .as_str()
            .unwrap()
            .starts_with(&format!("verification/{}/", user.profile_id))
    );
    assert_eq!(
        ticket.json["headers"],
        json!({ "Content-Type": "image/png" })
    );
    assert!(ticket.json["expires_at"].is_string());

    for (name, body, status) in [
        (
            "unknown slot",
            json!({ "slot": "side", "content_type": "image/jpeg", "size_bytes": 5 }),
            StatusCode::BAD_REQUEST,
        ),
        (
            "wrong type",
            json!({ "slot": "back", "content_type": "application/pdf", "size_bytes": 5 }),
            StatusCode::BAD_REQUEST,
        ),
        (
            "too large",
            json!({ "slot": "back", "content_type": "image/jpeg", "size_bytes": 11 * 1024 * 1024 }),
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
    ] {
        let response = app.post("/v1/me/verifications/uploads", token, body).await;
        assert_eq!(response.status, status, "{name}");
    }

    let closed = app
        .member_with(|spec| spec.status = ProfileStatus::Closed)
        .await;
    let response = app
        .post(
            "/v1/me/verifications/uploads",
            Some(&closed.token),
            json!({ "slot": "front", "content_type": "image/jpeg", "size_bytes": 5 }),
        )
        .await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(response.code(), "profile_not_active");
}

// ---- Identity checks ----

#[sqlx::test]
async fn an_identity_check_needs_a_registered_number(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;

    let response = submit_id_document(&app, &user).await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.code(), "invalid_state");

    add_identity(&app, &user, "cnic", CNIC, "verified").await;
    let response = submit_id_document(&app, &user).await;
    assert_eq!(
        response.status,
        StatusCode::CONFLICT,
        "a verified number cannot be checked again"
    );
    assert_eq!(response.json["error"]["details"]["status"], "verified");
    assert!(
        overview(&app, &user).await["requests"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test]
async fn submitting_an_identity_check_marks_the_identity_pending(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    add_identity(&app, &user, "cnic", CNIC, "unverified").await;

    let created = submit_id_document(&app, &user).await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text);
    assert_eq!(created.json["kind"], "id_document");
    assert_eq!(created.json["status"], "pending");
    assert_eq!(created.json["rejection_reason"], Value::Null);
    assert_eq!(created.json["reviewed_at"], Value::Null);
    assert_eq!(identity_status(&app, &user).await, "pending");

    let state = overview(&app, &user).await;
    assert_eq!(state["id_verified"], false);
    assert_eq!(state["photo_verified"], false);
    assert_eq!(state["phone_verified"], false);
    assert_eq!(
        state["identity"],
        json!({
            "document_type": "cnic", "number_masked": "*********5671",
            "status": "pending", "verified_at": null,
        })
    );
    assert_eq!(state["requests"][0]["id"], created.json["id"]);
    assert!(
        !state.to_string().contains(CNIC),
        "the number is never returned"
    );

    // One pending request per kind.
    let second = submit_id_document(&app, &user).await;
    assert_eq!(second.status, StatusCode::CONFLICT);
    assert_eq!(second.code(), "already_exists");
}

#[sqlx::test]
async fn an_identity_check_is_validated_field_by_field(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    add_identity(&app, &user, "cnic", CNIC, "unverified").await;
    let token = Some(user.token.as_str());
    let front = verification_image(&app, &user, "front").await;
    let selfie = verification_image(&app, &user, "selfie").await;
    let theirs = verification_image(&app, &other, "selfie").await;
    let never_uploaded = format!("verification/{}/{}", user.profile_id, Uuid::now_v7());

    // The back of a card is required for a card.
    let response = app
        .post(
            "/v1/me/verifications",
            token,
            json!({
                "kind": "id_document", "front_key": front, "back_key": null,
                "selfie_key": selfie, "gesture": todays_gesture(&user),
            }),
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.field_errors(), ["back_key:required"]);

    // Keys must be the caller's uploads and exist; the gesture must be today's or yesterday's.
    let wrong_gesture = Gesture::ALL
        .iter()
        .map(|g| g.as_str())
        .find(|g| {
            let today = karachi_date(OffsetDateTime::now_utc());
            *g != challenge_for(user.profile_id, today).as_str()
                && *g != challenge_for(user.profile_id, today.previous_day().unwrap()).as_str()
        })
        .unwrap();
    let response = app
        .post(
            "/v1/me/verifications",
            token,
            json!({
                "kind": "id_document", "front_key": theirs, "back_key": never_uploaded,
                "selfie_key": selfie, "gesture": wrong_gesture,
            }),
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    let mut fields = response.field_errors();
    fields.sort();
    assert_eq!(
        fields,
        ["back_key:invalid", "front_key:invalid", "gesture:mismatch"]
    );

    // The same image cannot fill two slots.
    let response = app
        .post(
            "/v1/me/verifications",
            token,
            json!({
                "kind": "id_document", "front_key": front, "back_key": front,
                "selfie_key": selfie, "gesture": todays_gesture(&user),
            }),
        )
        .await;
    assert_eq!(response.field_errors(), ["back_key:invalid"]);

    // Unknown kinds and unknown keys are bad requests.
    for body in [
        json!({ "kind": "passport_scan" }),
        json!({ "kind": "selfie", "selfie_key": selfie, "gesture": "thumbs_up", "front_key": front }),
    ] {
        let response = app.post("/v1/me/verifications", token, body).await;
        assert_eq!(response.code(), "bad_request");
    }
    assert_eq!(
        identity_status(&app, &user).await,
        "unverified",
        "nothing was written"
    );
}

#[sqlx::test]
async fn a_passport_needs_no_back_image_and_a_rejected_check_can_be_repeated(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    add_identity(&app, &user, "passport", "AB1234567", "rejected").await;
    let front = verification_image(&app, &user, "front").await;
    let selfie = verification_image(&app, &user, "selfie").await;
    let response = app
        .post(
            "/v1/me/verifications",
            Some(&user.token),
            json!({
                "kind": "id_document", "front_key": front,
                "selfie_key": selfie, "gesture": todays_gesture(&user),
            }),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.text);
    assert_eq!(identity_status(&app, &user).await, "pending");
}

#[sqlx::test]
async fn yesterdays_gesture_is_accepted(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    add_photo(&app, &user, "approved").await;
    let yesterday = karachi_date(OffsetDateTime::now_utc())
        .previous_day()
        .unwrap();
    let selfie = verification_image(&app, &user, "selfie").await;
    let response = app
        .post(
            "/v1/me/verifications",
            Some(&user.token),
            json!({
                "kind": "selfie", "selfie_key": selfie,
                "gesture": challenge_for(user.profile_id, yesterday).as_str(),
            }),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.text);
}

#[sqlx::test]
async fn a_closed_profile_cannot_submit(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app
        .member_with(|spec| spec.status = ProfileStatus::Closed)
        .await;
    // The upload ticket is already refused, so the request is built by hand.
    let response = app
        .post(
            "/v1/me/verifications",
            Some(&user.token),
            json!({ "kind": "selfie", "selfie_key": "x", "gesture": "thumbs_up" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(response.code(), "profile_not_active");
}

// ---- Photo checks ----

#[sqlx::test]
async fn a_photo_check_needs_an_approved_photo(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    add_photo(&app, &user, "pending_review").await;
    let response = submit_selfie(&app, &user).await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.code(), "invalid_state");

    add_photo(&app, &user, "approved").await;
    let created = submit_selfie(&app, &user).await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text);
    assert_eq!(created.json["kind"], "selfie");
    assert_eq!(created.json["status"], "pending");
    let second = submit_selfie(&app, &user).await;
    assert_eq!(second.status, StatusCode::CONFLICT);
    assert_eq!(second.code(), "already_exists");
}

#[sqlx::test]
async fn the_request_list_is_newest_first_and_at_most_ten(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    for _ in 0..12 {
        sqlx::query(
            "INSERT INTO verification_requests (profile_id, kind, status, selfie_key, gesture)
             VALUES ($1, 'selfie', 'cancelled', 'verification/x/y', 'thumbs_up')",
        )
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    }
    add_photo(&app, &user, "approved").await;
    let newest = submit_selfie(&app, &user).await;
    let state = overview(&app, &user).await;
    let requests = state["requests"].as_array().unwrap();
    assert_eq!(requests.len(), 10);
    assert_eq!(requests[0]["id"], newest.json["id"]);
    for request in requests {
        assert!(request.get("reviewer_note").is_none());
        assert!(request.get("front_key").is_none());
    }
}

// ---- Cancelling ----

#[sqlx::test]
async fn cancelling_a_pending_check_frees_the_identity_and_schedules_the_purge(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let other = app.member().await;
    add_identity(&app, &user, "cnic", CNIC, "unverified").await;
    let created = submit_id_document(&app, &user).await;
    let id = created.json["id"].as_str().unwrap().to_owned();
    let path = format!("/v1/me/verifications/{id}");

    // Not someone else's.
    let response = app.delete(&path, Some(&other.token)).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(identity_status(&app, &user).await, "pending");

    let response = app.delete(&path, Some(&user.token)).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(identity_status(&app, &user).await, "unverified");
    let (status, due): (String, bool) = sqlx::query_as(
        "SELECT status, media_purge_after <= now() FROM verification_requests WHERE id = $1",
    )
    .bind(Uuid::parse_str(&id).unwrap())
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(status, "cancelled");
    assert!(due, "the images are due for deletion at once");

    // A decided request cannot be cancelled again, and a new one can be submitted.
    let response = app.delete(&path, Some(&user.token)).await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.json["error"]["details"]["status"], "cancelled");
    let response = app
        .delete(
            &format!("/v1/me/verifications/{}", Uuid::now_v7()),
            Some(&user.token),
        )
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    let again = submit_id_document(&app, &user).await;
    assert_eq!(again.status, StatusCode::CREATED);

    // Cancelling a photo check changes nothing else.
    add_photo(&app, &user, "approved").await;
    let selfie = submit_selfie(&app, &user).await;
    let response = app
        .delete(
            &format!(
                "/v1/me/verifications/{}",
                selfie.json["id"].as_str().unwrap()
            ),
            Some(&user.token),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(
        identity_status(&app, &user).await,
        "pending",
        "the identity check goes on"
    );
    assert!(!profile_state(&app, &user).await.is_photo_verified);
}

// ---- Access ----

#[sqlx::test]
async fn verification_needs_a_usable_account(db: PgPool) {
    let app = TestApp::new(db).await;
    assert_eq!(
        app.get("/v1/me/verifications", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    let suspended = app
        .member_with(|spec| spec.user_status = UserStatus::Suspended)
        .await;
    let response = app
        .get("/v1/me/verifications", Some(&suspended.token))
        .await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(response.code(), "account_suspended");

    // A draft profile may already verify (03 section 5).
    let draft = app.draft_user().await;
    let state = overview(&app, &draft).await;
    assert_eq!(state["requests"], json!([]));
    assert_eq!(state["identity"], Value::Null);
}
