//! The staff text queue, end to end (15 section 16, 18 section 4.3).
#![expect(
    clippy::assert_is_empty,
    reason = "`assert!(list.is_empty())` reads better than comparing with a typed empty array"
)]

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::review::{ModeratedField, text_sha256};
use crate::domain::types::UserRole;
use crate::jobs::{NewJob, enqueue};
use crate::routes::photos::fixtures::{audit_count, audit_rows, notification_types, profile_state};
use crate::test_support::{TestApp, TestUser};

const ABOUT_ME: &str = "I work as an engineer and enjoy cricket, reading and long walks.";
const ABOUT_FAMILY: &str = "We are a small family living together in Lahore.";
const NOTES: &str = "Looking for someone kind, educated and family oriented.";

/// A member with all three texts waiting, as saving them leaves the profile.
async fn member_with_texts(app: &TestApp) -> TestUser {
    let member = app.member().await;
    sqlx::query("UPDATE profiles SET about_me = $2, about_me_status = 'pending' WHERE id = $1")
        .bind(member.profile_id)
        .bind(ABOUT_ME)
        .execute(app.db())
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO profile_family (profile_id, about_family, about_family_status)
         VALUES ($1, $2, 'pending')",
    )
    .bind(member.profile_id)
    .bind(ABOUT_FAMILY)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE partner_preferences SET notes = $2, notes_status = 'pending' WHERE profile_id = $1",
    )
    .bind(member.profile_id)
    .bind(NOTES)
    .execute(app.db())
    .await
    .unwrap();
    member
}

fn path(profile: Uuid, field: &str, action: &str) -> String {
    format!("/v1/admin/texts/{profile}/{field}/{action}")
}

async fn status_of(app: &TestApp, member: &TestUser, field: ModeratedField) -> String {
    let sql = match field {
        ModeratedField::AboutMe => "SELECT about_me_status FROM profiles WHERE id = $1",
        ModeratedField::AboutFamily => {
            "SELECT about_family_status FROM profile_family WHERE profile_id = $1"
        }
        ModeratedField::PartnerNotes => {
            "SELECT notes_status FROM partner_preferences WHERE profile_id = $1"
        }
    };
    sqlx::query_scalar(sql)
        .bind(member.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

#[sqlx::test]
async fn the_queue_holds_pending_texts_nobody_is_about_to_check(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = member_with_texts(&app).await;
    let token = Some(moderator.token.as_str());

    let response = app.get("/v1/admin/texts", token).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    let items = response.json["items"].as_array().unwrap();
    let mut fields: Vec<&str> = items.iter().map(|i| i["field"].as_str().unwrap()).collect();
    fields.sort_unstable();
    assert_eq!(fields, ["about_family", "about_me", "partner_notes"]);
    let about_me = items.iter().find(|i| i["field"] == "about_me").unwrap();
    assert_eq!(about_me["profile_id"], member.profile_id.to_string());
    assert!(about_me["public_code"].as_str().unwrap().starts_with("KR"));
    assert_eq!(about_me["first_name"], "Ahmed");
    assert_eq!(about_me["gender"], "male");
    assert_eq!(about_me["text"], ABOUT_ME);
    assert_eq!(about_me["text_sha256"], text_sha256(ABOUT_ME));
    assert!(about_me["updated_at"].is_string());

    // A text whose automatic check is still queued is not the moderators' yet.
    enqueue(
        app.db(),
        NewJob::new(
            "moderate_text",
            json!({ "profile_id": member.profile_id, "field": "about_family" }),
        )
        .dedupe(ModeratedField::AboutFamily.job_key(member.profile_id)),
    )
    .await
    .unwrap();
    let response = app.get("/v1/admin/texts", token).await;
    let fields: Vec<&str> = response.json["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["field"].as_str().unwrap())
        .collect();
    assert!(!fields.contains(&"about_family"));
    assert_eq!(fields.len(), 2);

    // Approved and rejected texts are not listed, and pages follow the cursor.
    let page = app.get("/v1/admin/texts?limit=1", token).await;
    assert_eq!(page.json["items"].as_array().unwrap().len(), 1);
    let cursor = page.json["next_cursor"].as_str().unwrap();
    let rest = app
        .get(&format!("/v1/admin/texts?limit=1&cursor={cursor}"), token)
        .await;
    assert_eq!(rest.json["items"].as_array().unwrap().len(), 1);
    assert_eq!(rest.json["next_cursor"], Value::Null);
}

#[sqlx::test]
async fn approving_a_text_changes_it_and_is_audited_once_without_a_notification(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = member_with_texts(&app).await;
    let token = Some(moderator.token.as_str());
    sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
        .bind(member.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    for (field, text) in [
        ("about_me", ABOUT_ME),
        ("about_family", ABOUT_FAMILY),
        ("partner_notes", NOTES),
    ] {
        let before = audit_count(&app).await;
        let response = app
            .post(
                &path(member.profile_id, field, "approve"),
                token,
                json!({ "text_sha256": text_sha256(text) }),
            )
            .await;
        assert_eq!(
            response.status,
            StatusCode::NO_CONTENT,
            "{field}: {}",
            response.text
        );
        assert_eq!(
            status_of(&app, &member, ModeratedField::parse(field).unwrap()).await,
            "approved"
        );
        assert_eq!(
            audit_count(&app).await,
            before + 1,
            "{field}: one audit row"
        );
    }
    assert!(profile_state(&app, &member).await.match_stale);
    assert!(
        notification_types(&app, &member).await.is_empty(),
        "approval is silent"
    );
    let audit = audit_rows(&app, "text.approve").await;
    assert_eq!(audit.len(), 3);
    assert_eq!(audit[0].actor_user_id, moderator.user_id);
    assert_eq!(audit[0].target_type, "profile");
    assert_eq!(audit[0].target_id, member.profile_id.to_string());
    assert_eq!(
        audit[0].details,
        json!({ "field": "about_me", "text_sha256": text_sha256(ABOUT_ME) })
    );

    // Decided texts leave the queue and cannot be decided again.
    let response = app.get("/v1/admin/texts", token).await;
    assert!(response.json["items"].as_array().unwrap().is_empty());
    let again = app
        .post(
            &path(member.profile_id, "about_me", "approve"),
            token,
            json!({ "text_sha256": text_sha256(ABOUT_ME) }),
        )
        .await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(again.code(), "invalid_state");
    assert_eq!(again.json["error"]["details"]["status"], "approved");
    assert_eq!(audit_count(&app).await, 3);
}

#[sqlx::test]
async fn a_decision_on_text_that_changed_is_refused(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = member_with_texts(&app).await;
    let token = Some(moderator.token.as_str());
    let read = text_sha256(ABOUT_ME);

    // The member saved again after the moderator opened the item.
    sqlx::query("UPDATE profiles SET about_me = 'Something else entirely' WHERE id = $1")
        .bind(member.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    for action in ["approve", "reject"] {
        let response = app
            .post(
                &path(member.profile_id, "about_me", action),
                token,
                json!({ "text_sha256": read }),
            )
            .await;
        assert_eq!(response.status, StatusCode::CONFLICT, "{action}");
        assert_eq!(response.code(), "invalid_state", "{action}");
    }
    assert_eq!(
        status_of(&app, &member, ModeratedField::AboutMe).await,
        "pending"
    );
    assert_eq!(audit_count(&app).await, 0);
    assert!(notification_types(&app, &member).await.is_empty());

    // The hash of the new text is accepted.
    let response = app
        .post(
            &path(member.profile_id, "about_me", "approve"),
            token,
            json!({ "text_sha256": text_sha256("Something else entirely") }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn rejecting_a_text_notifies_with_the_note_and_is_audited_once(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = member_with_texts(&app).await;
    let token = Some(moderator.token.as_str());

    let too_long = app
        .post(
            &path(member.profile_id, "about_me", "reject"),
            token,
            json!({ "text_sha256": text_sha256(ABOUT_ME), "note": "x".repeat(301) }),
        )
        .await;
    assert_eq!(too_long.field_errors(), ["note:too_long"]);
    assert_eq!(audit_count(&app).await, 0);

    let response = app
        .post(
            &path(member.profile_id, "about_me", "reject"),
            token,
            json!({ "text_sha256": text_sha256(ABOUT_ME), "note": "  Please keep the wording respectful. " }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT, "{}", response.text);
    assert_eq!(
        status_of(&app, &member, ModeratedField::AboutMe).await,
        "rejected"
    );
    assert_eq!(notification_types(&app, &member).await, ["text_rejected"]);
    let data: Value = sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
        .bind(member.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(
        data,
        json!({ "field": "about_me", "note": "Please keep the wording respectful." })
    );
    let audit = audit_rows(&app, "text.reject").await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit_count(&app).await, 1);
    assert_eq!(
        audit[0].details,
        json!({
            "field": "about_me", "text_sha256": text_sha256(ABOUT_ME),
            "note": "Please keep the wording respectful.",
        })
    );

    // Without a note the note is null; the other fields work the same way.
    let response = app
        .post(
            &path(member.profile_id, "partner_notes", "reject"),
            token,
            json!({ "text_sha256": text_sha256(NOTES) }),
        )
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(
        status_of(&app, &member, ModeratedField::PartnerNotes).await,
        "rejected"
    );
    let data: Value = sqlx::query_scalar(
        "SELECT data FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1",
    )
    .bind(member.user_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(data, json!({ "field": "partner_notes", "note": null }));
    assert_eq!(
        status_of(&app, &member, ModeratedField::AboutFamily).await,
        "pending",
        "the other text is untouched"
    );
}

#[sqlx::test]
async fn unknown_targets_and_members_are_refused(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let member = member_with_texts(&app).await;
    let hash = json!({ "text_sha256": text_sha256(ABOUT_ME) });

    let unknown_field = app
        .post(
            &path(member.profile_id, "bio", "approve"),
            Some(&moderator.token),
            hash.clone(),
        )
        .await;
    assert_eq!(unknown_field.status, StatusCode::NOT_FOUND);
    let unknown_profile = app
        .post(
            &path(Uuid::now_v7(), "about_me", "approve"),
            Some(&moderator.token),
            hash.clone(),
        )
        .await;
    assert_eq!(unknown_profile.status, StatusCode::NOT_FOUND);
    // The text exists only where the member has a row for it.
    let someone = app.member().await;
    let no_family = app
        .post(
            &path(someone.profile_id, "about_family", "approve"),
            Some(&moderator.token),
            hash.clone(),
        )
        .await;
    assert_eq!(no_family.status, StatusCode::NOT_FOUND);

    let by_member = app
        .post(
            &path(member.profile_id, "about_me", "approve"),
            Some(&member.token),
            hash.clone(),
        )
        .await;
    assert_eq!(by_member.status, StatusCode::FORBIDDEN);
    assert_eq!(by_member.code(), "forbidden");
    assert_eq!(
        app.get("/v1/admin/texts", Some(&member.token)).await.status,
        StatusCode::FORBIDDEN
    );
    let reject_by_member = app
        .post(
            &path(member.profile_id, "about_me", "reject"),
            Some(&member.token),
            hash,
        )
        .await;
    assert_eq!(reject_by_member.status, StatusCode::FORBIDDEN);
    assert_eq!(
        status_of(&app, &member, ModeratedField::AboutMe).await,
        "pending"
    );
    assert_eq!(audit_count(&app).await, 0);
}
