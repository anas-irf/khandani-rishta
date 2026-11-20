//! Test helpers shared by the photo, verification and staff review tests.

use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::db::photos as db;
use crate::jobs::process_photo::tests::{jpeg_bytes, test_picture};
use crate::realtime::hub::Registration;
use crate::services::r2::ObjectStore;
use crate::test_support::{TestApp, TestResponse, TestUser};

/// The names of the five variants, as in the R2 key layout of 08 section 5.3.
pub const VARIANTS: [&str; 5] = ["large", "medium", "thumb", "blur_medium", "blur_thumb"];

/// A real JPEG of the given size.
pub fn jpeg(width: u32, height: u32) -> Vec<u8> {
    jpeg_bytes(&test_picture(width, height))
}

/// The client side of 08 section 5.2 steps 3 to 5: ask for a ticket, `PUT` the file, confirm.
/// Returns the answer of the confirmation.
pub async fn upload(app: &TestApp, user: &TestUser, bytes: Vec<u8>) -> TestResponse {
    let ticket = app
        .post(
            "/v1/me/photos/uploads",
            Some(&user.token),
            json!({ "content_type": "image/jpeg", "size_bytes": bytes.len() }),
        )
        .await;
    assert_eq!(ticket.status.as_u16(), 200, "ticket: {}", ticket.text);
    let key = ticket.json["upload_key"].as_str().unwrap().to_owned();
    app.storage.put(&key, bytes, "image/jpeg").await.unwrap();
    app.post(
        "/v1/me/photos",
        Some(&user.token),
        json!({ "upload_key": key }),
    )
    .await
}

/// A photo already processed to `status`, with its five files in storage, as the job leaves it.
/// An approved photo goes through the same bookkeeping as a real approval (primary photo,
/// `has_approved_photo`, completeness).
pub async fn add_photo(app: &TestApp, user: &TestUser, status: &str) -> Uuid {
    let id = Uuid::now_v7();
    let base = format!("photos/{}/{id}", user.profile_id);
    let mut tx = app.db().begin().await.unwrap();
    sqlx::query(
        "INSERT INTO profile_photos
             (id, profile_id, status, position, upload_key, key_large, key_medium, key_thumb,
              key_blur_medium, key_blur_thumb, width, height, moderation)
         VALUES ($1, $2, $3,
                 (SELECT COALESCE(max(position) + 1, 0) FROM profile_photos WHERE profile_id = $2),
                 $4, $5, $6, $7, $8, $9, 1000, 800, '{\"result\": \"unavailable\"}'::jsonb)",
    )
    .bind(id)
    .bind(user.profile_id)
    .bind(status)
    .bind(format!("tmp/photos/{}/{id}", user.profile_id))
    .bind(format!("{base}/large.jpg"))
    .bind(format!("{base}/medium.jpg"))
    .bind(format!("{base}/thumb.jpg"))
    .bind(format!("{base}/blur_medium.jpg"))
    .bind(format!("{base}/blur_thumb.jpg"))
    .execute(&mut *tx)
    .await
    .unwrap();
    if status == "approved" {
        db::settle(&mut tx, user.profile_id, false).await.unwrap();
    }
    tx.commit().await.unwrap();
    for name in VARIANTS {
        app.storage
            .put(&format!("{base}/{name}.jpg"), vec![1, 2, 3], "image/jpeg")
            .await
            .unwrap();
    }
    id
}

/// `GET /v1/me/photos` as JSON.
pub async fn list(app: &TestApp, user: &TestUser) -> Vec<Value> {
    let response = app.get("/v1/me/photos", Some(&user.token)).await;
    assert_eq!(response.status.as_u16(), 200, "{}", response.text);
    response.json.as_array().unwrap().clone()
}

/// The status of a photo row.
pub async fn status_of(app: &TestApp, photo_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM profile_photos WHERE id = $1")
        .bind(photo_id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

/// The derived photo state of a profile.
#[derive(Debug, sqlx::FromRow)]
#[allow(clippy::struct_excessive_bools)] // One field per column.
pub struct ProfileState {
    pub has_approved_photo: bool,
    pub is_photo_verified: bool,
    pub is_id_verified: bool,
    pub completeness: i16,
    pub match_stale: bool,
}

pub async fn profile_state(app: &TestApp, user: &TestUser) -> ProfileState {
    sqlx::query_as(
        "SELECT has_approved_photo, is_photo_verified, is_id_verified, completeness, match_stale
         FROM profiles WHERE id = $1",
    )
    .bind(user.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap()
}

/// The `notifications.type` values of a user, oldest first.
pub async fn notification_types(app: &TestApp, user: &TestUser) -> Vec<String> {
    sqlx::query_scalar("SELECT type FROM notifications WHERE user_id = $1 ORDER BY id")
        .bind(user.user_id)
        .fetch_all(app.db())
        .await
        .unwrap()
}

/// One audit row.
#[derive(Debug, sqlx::FromRow)]
pub struct AuditRow {
    pub actor_user_id: Uuid,
    pub action: String,
    pub target_type: String,
    pub target_id: String,
    pub details: Value,
}

/// Audit rows of an action, oldest first.
pub async fn audit_rows(app: &TestApp, action: &str) -> Vec<AuditRow> {
    sqlx::query_as(
        "SELECT actor_user_id, action, target_type, target_id, details FROM admin_audit_log
         WHERE action = $1 ORDER BY id",
    )
    .bind(action)
    .fetch_all(app.db())
    .await
    .unwrap()
}

/// How many audit rows exist in total.
pub async fn audit_count(app: &TestApp) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM admin_audit_log")
        .fetch_one(app.db())
        .await
        .unwrap()
}

/// Every frame a socket has received so far, parsed.
pub fn frames(socket: &mut Registration) -> Vec<Value> {
    let mut frames = Vec::new();
    while let Ok(frame) = socket.receiver.try_recv() {
        frames.push(serde_json::from_str(&frame).unwrap());
    }
    frames
}

/// The frames of one type.
pub fn frames_of(frames: &[Value], kind: &str) -> Vec<Value> {
    frames
        .iter()
        .filter(|frame| frame["type"] == kind)
        .cloned()
        .collect()
}

/// Whether `at` (an RFC 3339 text) lies between `from` and `to`.
pub fn is_between(at: &Value, from: OffsetDateTime, to: OffsetDateTime) -> bool {
    at.as_str()
        .and_then(|text| {
            OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).ok()
        })
        .is_some_and(|at| at >= from && at <= to)
}

// ---- Verification ----

/// Registers an identity number for the profile, encrypted and hashed as the product does.
pub async fn add_identity(
    app: &TestApp,
    user: &TestUser,
    document_type: &str,
    number: &str,
    status: &str,
) {
    let namespace = match document_type {
        "poc" => "poc",
        "passport" => "passport",
        _ => "pk_id",
    };
    let last4: String = number.chars().skip(number.chars().count() - 4).collect();
    sqlx::query(
        "INSERT INTO profile_identity
             (profile_id, document_type, number_encrypted, number_hash, number_last4, status)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(user.profile_id)
    .bind(document_type)
    .bind(app.state.crypto.encrypt_identity(user.profile_id, number))
    .bind(app.state.crypto.keyed_hash(namespace, number))
    .bind(last4)
    .bind(status)
    .execute(app.db())
    .await
    .unwrap();
}

/// A verification image as the client uploads it: a ticket for the slot, then the file.
pub async fn verification_image(app: &TestApp, user: &TestUser, slot: &str) -> String {
    let ticket = app
        .post(
            "/v1/me/verifications/uploads",
            Some(&user.token),
            json!({ "slot": slot, "content_type": "image/jpeg", "size_bytes": 100 }),
        )
        .await;
    assert_eq!(ticket.status.as_u16(), 200, "ticket: {}", ticket.text);
    let key = ticket.json["upload_key"].as_str().unwrap().to_owned();
    app.storage
        .put(&key, vec![7; 100], "image/jpeg")
        .await
        .unwrap();
    key
}

/// The gesture of today's selfie challenge for a member.
pub fn todays_gesture(user: &TestUser) -> &'static str {
    let today = crate::domain::time::karachi_date(OffsetDateTime::now_utc());
    crate::models::verifications::challenge_for(user.profile_id, today).as_str()
}

/// Submits an identity check with a back image.
pub async fn submit_id_document(app: &TestApp, user: &TestUser) -> TestResponse {
    let front = verification_image(app, user, "front").await;
    let back = verification_image(app, user, "back").await;
    let selfie = verification_image(app, user, "selfie").await;
    app.post(
        "/v1/me/verifications",
        Some(&user.token),
        json!({
            "kind": "id_document", "front_key": front, "back_key": back,
            "selfie_key": selfie, "gesture": todays_gesture(user),
        }),
    )
    .await
}

/// Submits a photo check.
pub async fn submit_selfie(app: &TestApp, user: &TestUser) -> TestResponse {
    let selfie = verification_image(app, user, "selfie").await;
    app.post(
        "/v1/me/verifications",
        Some(&user.token),
        json!({ "kind": "selfie", "selfie_key": selfie, "gesture": todays_gesture(user) }),
    )
    .await
}
