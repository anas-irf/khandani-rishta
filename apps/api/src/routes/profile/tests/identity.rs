//! `GET` and `PUT /v1/me/identity` (T-105).

use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::{FEMALE_CNIC, MALE_CNIC, basics_body, fields, profile_of, put_section, save};
use crate::domain::options::Gender;
use crate::models::profile::IdentityBody;
use crate::test_support::{TestApp, TestResponse, TestUser};

const MALE_DIGITS: &str = "3520212345671";

async fn put_identity(
    app: &TestApp,
    user: &TestUser,
    document_type: &str,
    number: &str,
) -> TestResponse {
    app.put(
        "/v1/me/identity",
        Some(&user.token),
        json!({ "document_type": document_type, "number": number }),
    )
    .await
}

async fn stored_hash(app: &TestApp, user: &TestUser) -> Vec<u8> {
    sqlx::query_scalar("SELECT number_hash FROM profile_identity WHERE profile_id = $1")
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

#[sqlx::test]
async fn a_number_is_stored_encrypted_and_never_returned(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;

    // No number yet: a summary of `null`.
    let response = app.get("/v1/me/identity", Some(&man.token)).await;
    assert_eq!(response.status, 200);
    assert_eq!(response.text.trim(), "null");
    let before = profile_of(&app, &man).await;
    assert_eq!(before["identity"], Value::Null);

    let response = put_identity(&app, &man, "cnic", MALE_CNIC).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(
        response.json,
        json!({
            "document_type": "cnic",
            "number_masked": "*********5671",
            "status": "unverified",
            "verified_at": null
        })
    );

    // What is stored: the hash, the last four characters and the encrypted number.
    let (encrypted, last4, status): (Vec<u8>, String, String) = sqlx::query_as(
        "SELECT number_encrypted, number_last4, status FROM profile_identity WHERE profile_id = $1",
    )
    .bind(man.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!((last4.as_str(), status.as_str()), ("5671", "unverified"));
    assert!(
        !encrypted
            .windows(MALE_DIGITS.len())
            .any(|window| window == MALE_DIGITS.as_bytes()),
        "the number is not stored in the clear"
    );
    // Round trip: the profile id is the associated data (20 section 2.1).
    let crypto = &app.state.crypto;
    assert_eq!(
        crypto.decrypt_identity(man.profile_id, &encrypted).unwrap(),
        MALE_DIGITS
    );
    assert!(crypto.decrypt_identity(Uuid::now_v7(), &encrypted).is_err());
    assert_eq!(
        stored_hash(&app, &man).await,
        crypto.keyed_hash("pk_id", MALE_DIGITS)
    );

    // Reading it back shows the summary only, and the profile counts it.
    let read = app.get("/v1/me/identity", Some(&man.token)).await;
    assert_eq!(read.json, response.json);
    let after = profile_of(&app, &man).await;
    assert_eq!(after["identity"], response.json);
    assert_eq!(
        after["completeness"].as_i64().unwrap() - before["completeness"].as_i64().unwrap(),
        3,
        "the identity item is worth 3 points (08 section 6.1)"
    );
    let missing = after["missing"].as_array().unwrap();
    assert!(!missing.iter().any(|item| item == "identity"));
    assert!(missing.iter().any(|item| item == "id_verified"));

    // The number is in no response.
    for text in [
        &response.text,
        &read.text,
        &app.get("/v1/me/profile", Some(&man.token)).await.text,
    ] {
        assert!(
            !text.contains(MALE_DIGITS) && !text.contains(MALE_CNIC),
            "{text}"
        );
    }
    let me = app.get("/v1/me", Some(&man.token)).await;
    assert!(!me.text.contains(MALE_DIGITS));
}

#[sqlx::test]
async fn the_number_is_checked_against_the_document_and_the_gender(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;

    // The last digit of a CNIC or NICOP is odd for men and even for women (12 section 3.3).
    for (user, number) in [(&man, FEMALE_CNIC), (&woman, MALE_CNIC)] {
        for document in ["cnic", "nicop"] {
            let response = put_identity(&app, user, document, number).await;
            assert_eq!(response.status, 400, "{document} {number}");
            assert_eq!(fields(&response), ["number:mismatch"]);
            assert!(
                response.json["error"]["fields"][0]["message"]
                    .as_str()
                    .unwrap()
                    .starts_with("This number does not match the gender on the profile.")
            );
        }
    }
    assert_eq!(
        put_identity(&app, &woman, "cnic", FEMALE_CNIC).await.status,
        200
    );
    // A zero is even.
    let other_woman = app.member_of(Gender::Female).await;
    assert_eq!(
        put_identity(&app, &other_woman, "cnic", "42101-7654321-0")
            .await
            .status,
        200
    );

    let cases = [
        ("cnic", "", "number:required"),
        ("cnic", " - - ", "number:required"),
        ("cnic", "12345", "number:invalid"),
        ("cnic", "352021234567", "number:invalid"),
        ("cnic", "35202123456711", "number:invalid"),
        ("cnic", "3520212345A71", "number:invalid"),
        ("cnic", "9520212345671", "number:invalid"),
        ("cnic", "0520212345671", "number:invalid"),
        ("nicop", "1111111111111", "number:invalid"),
        ("cnic", "1234567890123", "number:invalid"),
        ("poc", "12345", "number:invalid"),
        ("passport", "AB12", "number:invalid"),
        ("passport", "ABCDEFGH", "number:invalid"),
        ("passport", "AB1234567890123", "number:invalid"),
        ("passport", "AB 12-34!", "number:invalid"),
    ];
    for (document, number, expected) in cases {
        let response = put_identity(&app, &man, document, number).await;
        assert_eq!(response.status, 400, "{document} {number:?}");
        assert_eq!(fields(&response), [expected], "{document} {number:?}");
    }
    // The API tells which rule broke (07 section 13.4).
    let response = put_identity(&app, &man, "cnic", "12345").await;
    assert_eq!(
        response.json["error"]["fields"][0]["message"],
        "A CNIC number has 13 digits."
    );
    let response = put_identity(&app, &man, "cnic", "9520212345671").await;
    assert_eq!(
        response.json["error"]["fields"][0]["message"],
        "This does not look like a valid CNIC number."
    );

    // No gender rule for a POC or a passport, and a passport is normalised.
    assert_eq!(
        put_identity(&app, &man, "poc", "1234567890128")
            .await
            .status,
        200
    );
    let response = put_identity(&app, &man, "passport", " ab-1234567 ").await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["number_masked"], "*********4567");
    assert_eq!(response.json["document_type"], "passport");
}

#[sqlx::test]
async fn a_number_belongs_to_one_profile_only(db: PgPool) {
    let app = TestApp::new(db).await;
    let first = app.member().await;
    let second = app.member().await;
    assert_eq!(
        put_identity(&app, &first, "cnic", MALE_CNIC).await.status,
        200
    );

    // The same digits, however they are typed, and as a NICOP (they share a namespace).
    for (document, number) in [
        ("cnic", MALE_CNIC),
        ("cnic", "35202 1234567 1"),
        ("cnic", MALE_DIGITS),
        ("nicop", MALE_CNIC),
    ] {
        let response = put_identity(&app, &second, document, number).await;
        assert_eq!(response.status, 409, "{document} {number}");
        assert_eq!(response.code(), "identity_already_registered");
    }
    // A POC with the same digits is another document.
    assert_eq!(
        put_identity(&app, &second, "poc", MALE_DIGITS).await.status,
        200
    );

    // The same profile can send its own number again.
    assert_eq!(
        put_identity(&app, &first, "cnic", MALE_CNIC).await.status,
        200
    );

    // Replacing the number frees the old one.
    assert_eq!(
        put_identity(&app, &first, "cnic", "35202-7654321-3")
            .await
            .status,
        200
    );
    let response = put_identity(&app, &second, "cnic", MALE_CNIC).await;
    assert_eq!(response.status, 200, "{}", response.text);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM profile_identity")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[sqlx::test]
async fn a_banned_number_cannot_be_registered(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let hash = app.state.crypto.keyed_hash("pk_id", MALE_DIGITS);
    sqlx::query(
        "INSERT INTO banned_identities (kind, value_hash) VALUES ('identity_document', $1)",
    )
    .bind(&hash)
    .execute(app.db())
    .await
    .unwrap();

    let response = put_identity(&app, &man, "cnic", MALE_CNIC).await;
    assert_eq!(response.status, 409);
    // The same answer as a number held by another profile, so a ban reveals nothing.
    assert_eq!(response.code(), "identity_already_registered");
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM profile_identity")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(rows, 0);
}

#[sqlx::test]
async fn a_number_that_needs_the_gender_waits_for_it(db: PgPool) {
    let app = TestApp::new(db).await;
    let draft = app.draft_user().await;
    let response = put_identity(&app, &draft, "cnic", MALE_CNIC).await;
    assert_eq!(response.status, 409);
    assert_eq!(response.code(), "invalid_state");
    // A passport has no gender rule.
    assert_eq!(
        put_identity(&app, &draft, "passport", "AB1234567")
            .await
            .status,
        200
    );
}

#[sqlx::test]
async fn a_pending_or_verified_number_is_not_changed_here(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    assert_eq!(
        put_identity(&app, &man, "cnic", MALE_CNIC).await.status,
        200
    );

    for status in ["pending", "verified"] {
        sqlx::query(
            "UPDATE profile_identity SET status = $2,
                    verified_at = CASE WHEN $2 = 'verified' THEN now() END
             WHERE profile_id = $1",
        )
        .bind(man.profile_id)
        .bind(status)
        .execute(app.db())
        .await
        .unwrap();
        let response = put_identity(&app, &man, "cnic", "35202-7654321-3").await;
        assert_eq!(response.status, 409, "{status}");
        assert_eq!(response.code(), "invalid_state");
        assert_eq!(response.json["error"]["details"]["identity_status"], status);
        // The stored number is untouched.
        let read = app.get("/v1/me/identity", Some(&man.token)).await;
        assert_eq!(read.json["number_masked"], "*********5671");
        assert_eq!(read.json["status"], status);
    }

    // A rejected one is replaced and goes back to `unverified` (12 section 3.6).
    sqlx::query(
        "UPDATE profile_identity SET status = 'rejected', verified_at = NULL WHERE profile_id = $1",
    )
    .bind(man.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    let response = put_identity(&app, &man, "cnic", "35202-7654321-3").await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["status"], "unverified");
    assert_eq!(response.json["number_masked"], "*********3213");
}

#[sqlx::test]
async fn the_request_is_checked_before_the_number_is(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;

    for body in [
        json!({ "document_type": "cnic" }),
        json!({ "number": MALE_CNIC }),
        json!({ "document_type": "driving_licence", "number": MALE_CNIC }),
        json!({ "document_type": "cnic", "number": MALE_CNIC, "country": "PK" }),
    ] {
        let response = app
            .put("/v1/me/identity", Some(&man.token), body.clone())
            .await;
        assert_eq!(response.code(), "bad_request", "{body}");
    }

    // A number of the wrong type is refused without repeating it.
    let response = app
        .raw(
            "PUT",
            "/v1/me/identity",
            Some(&man.token),
            Some(format!(
                r#"{{"document_type":"cnic","number":{MALE_DIGITS}}}"#
            )),
        )
        .await;
    assert_eq!(response.code(), "bad_request");
    assert!(!response.text.contains(MALE_DIGITS), "{}", response.text);

    assert_eq!(
        app.put(
            "/v1/me/identity",
            None,
            json!({ "document_type": "cnic", "number": MALE_CNIC })
        )
        .await
        .code(),
        "unauthenticated"
    );
    assert_eq!(
        app.get("/v1/me/identity", None).await.code(),
        "unauthenticated"
    );
}

#[test]
fn the_request_type_keeps_the_number_out_of_debug_output() {
    let body: IdentityBody = serde_json::from_str(&format!(
        r#"{{"document_type":"cnic","number":"{MALE_DIGITS}"}}"#
    ))
    .unwrap();
    assert_eq!(body.number.expose(), MALE_DIGITS);
    let printed = format!("{body:?}");
    assert!(!printed.contains(MALE_DIGITS), "{printed}");
    assert!(printed.contains("redacted"));
}

#[sqlx::test]
async fn one_member_never_reads_or_replaces_another_members_number(db: PgPool) {
    let app = TestApp::new(db).await;
    let first = app.member().await;
    let second = app.member().await;
    assert_eq!(
        put_identity(&app, &first, "cnic", MALE_CNIC).await.status,
        200
    );
    let hash = stored_hash(&app, &first).await;

    let read = app.get("/v1/me/identity", Some(&second.token)).await;
    assert_eq!(read.json, Value::Null);
    assert_eq!(profile_of(&app, &second).await["identity"], Value::Null);

    // Writing for the second member leaves the first member's row alone.
    assert_eq!(
        put_identity(&app, &second, "cnic", "35202-7654321-3")
            .await
            .status,
        200
    );
    assert_eq!(stored_hash(&app, &first).await, hash);
}

#[sqlx::test]
async fn a_gender_change_in_a_draft_must_still_agree_with_the_number(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    save(&app, &user, "basics", basics_body(Gender::Male)).await;
    assert_eq!(
        put_identity(&app, &user, "cnic", MALE_CNIC).await.status,
        200
    );

    let response = put_section(&app, &user, "basics", basics_body(Gender::Female)).await;
    assert_eq!(fields(&response), ["gender:mismatch"]);
    // The same gender is fine, and so is a passport, which has no gender rule.
    save(&app, &user, "basics", basics_body(Gender::Male)).await;
    assert_eq!(
        put_identity(&app, &user, "passport", "AB1234567")
            .await
            .status,
        200
    );
    save(&app, &user, "basics", basics_body(Gender::Female)).await;
}
