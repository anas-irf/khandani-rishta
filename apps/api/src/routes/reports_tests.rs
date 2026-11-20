//! Tests of member reports (T-504, member side): each subject type with its context, subjects
//! the caller cannot see, validation, the daily limit, `also_block`, the access levels, and
//! that filing changes nothing for the reported member.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::test_support::{TestApp, TestResponse, TestUser};
use crate::views::testing::{
    add_photo, block_row, connect, exec, interest, set_prefs, set_privacy, set_profile,
};

/// A male reporter and a female target with a primary photo.
struct World {
    app: TestApp,
    reporter: TestUser,
    target: TestUser,
    photo: Uuid,
}

async fn world(db: PgPool) -> World {
    let app = TestApp::new(db).await;
    let reporter = app.member().await;
    let target = app.member_of(Gender::Female).await;
    let photo = add_photo(&app, target.profile_id).await;
    World {
        app,
        reporter,
        target,
        photo,
    }
}

/// The columns of a report row that the tests compare.
#[derive(sqlx::FromRow)]
struct ReportRow {
    source: String,
    reporter: Uuid,
    target: Uuid,
    subject: String,
    photo_id: Option<Uuid>,
    message_id: Option<Uuid>,
    reason: String,
    details: Option<String>,
    status: String,
}

/// A report of the target's profile with a reason, which tests extend or override.
fn profile_body(target: &TestUser) -> Value {
    json!({
        "target_profile_id": target.profile_id,
        "subject_type": "profile",
        "reason": "harassment",
    })
}

impl World {
    async fn report(&self, body: Value) -> TestResponse {
        self.app
            .post("/v1/reports", Some(&self.reporter.token), body)
            .await
    }

    /// Files a report that must succeed and returns its id.
    async fn file(&self, body: Value) -> Uuid {
        let response = self.report(body).await;
        assert_eq!(response.status, StatusCode::CREATED, "{}", response.text);
        response.json["id"].as_str().unwrap().parse().unwrap()
    }

    async fn context(&self, id: Uuid) -> Value {
        sqlx::query_scalar("SELECT context FROM reports WHERE id = $1")
            .bind(id)
            .fetch_one(self.app.db())
            .await
            .unwrap()
    }

    async fn count(&self, sql: &str) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
            .fetch_one(self.app.db())
            .await
            .unwrap()
    }

    /// The target's profile as the reporter sees it.
    async fn target_visible(&self) -> bool {
        self.app
            .get(
                &format!("/v1/profiles/{}", self.target.profile_id),
                Some(&self.reporter.token),
            )
            .await
            .status
            == StatusCode::OK
    }
}

/// Inserts `count` text messages into `connection`, oldest first, alternating between the two
/// senders starting with `first`. Returns their ids in order. Ids are created up front and
/// sorted so that id order is insertion order whatever the clock does.
async fn talk(
    app: &TestApp,
    connection: Uuid,
    first: Uuid,
    second: Uuid,
    count: usize,
) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = (0..count).map(|_| Uuid::now_v7()).collect();
    ids.sort();
    for (index, id) in ids.iter().enumerate() {
        let sender = if index % 2 == 0 { first } else { second };
        sqlx::query(
            "INSERT INTO messages (id, connection_id, sender_profile_id, kind, body)
             VALUES ($1, $2, $3, 'text', $4)",
        )
        .bind(id)
        .bind(connection)
        .bind(sender)
        .bind(format!("message {index}"))
        .execute(app.db())
        .await
        .unwrap();
    }
    ids
}

fn message_ids(context: &Value) -> Vec<Uuid> {
    context["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["id"].as_str().unwrap().parse().unwrap())
        .collect()
}

// -------------------------------------------------------------------------------------------
// Profile reports
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn a_profile_report_stores_the_snapshot_and_changes_nothing_for_the_target(db: PgPool) {
    let w = world(db).await;
    exec(
        &w.app,
        "UPDATE profiles SET about_me = 'I like long walks and quiet evenings with family.',
             job_title = 'Engineer', employer_name = 'Acme', manager_name = 'Mr Malik'
         WHERE id = $1",
        w.target.profile_id,
    )
    .await;
    exec(
        &w.app,
        "INSERT INTO profile_family (profile_id, about_family) VALUES ($1, 'A close family.')",
        w.target.profile_id,
    )
    .await;
    set_prefs(&w.app, w.target.profile_id, "notes = 'Someone kind.'").await;

    let mut body = profile_body(&w.target);
    body["details"] = json!("  He sent\n\n\nrude   messages. Call 0300 1234567.  ");
    let id = w.file(body).await;

    let row: ReportRow = sqlx::query_as(
        "SELECT source, reporter_profile_id AS reporter, target_profile_id AS target,
                subject_type AS subject, photo_id, message_id, reason, details, status
         FROM reports WHERE id = $1",
    )
    .bind(id)
    .fetch_one(w.app.db())
    .await
    .unwrap();
    let ReportRow {
        source,
        reporter,
        target,
        subject,
        photo_id,
        message_id,
        reason,
        details,
        status,
    } = row;
    assert_eq!(source, "member");
    assert_eq!(reporter, w.reporter.profile_id);
    assert_eq!(target, w.target.profile_id);
    assert_eq!(subject, "profile");
    assert_eq!((photo_id, message_id), (None, None));
    assert_eq!(reason, "harassment");
    // Tidied like other text, and not run through the contact rules (13 section 3.1).
    assert_eq!(
        details.as_deref(),
        Some("He sent\n\nrude messages. Call 0300 1234567.")
    );
    assert_eq!(status, "open");
    assert_eq!(
        w.context(id).await,
        json!({
            "first_name": "Ayesha",
            "last_name": "Malik",
            "managed_by": "self",
            "manager_name": "Mr Malik",
            "marital_status": "never_married",
            "about_me": "I like long walks and quiet evenings with family.",
            "about_family": "A close family.",
            "partner_notes": "Someone kind.",
            "primary_photo_id": w.photo,
            "job_title": "Engineer",
            "employer_name": "Acme",
        })
    );

    // Nothing changed for the reported member: no notification, no sanction, no block, the
    // same status, still visible to the reporter, and the counter of the reporter moved.
    assert!(w.target_visible().await);
    let feed = w.app.get("/v1/notifications", Some(&w.target.token)).await;
    assert_eq!(feed.json["items"], json!([]));
    assert_eq!(w.count("SELECT count(*) FROM sanctions").await, 0);
    assert_eq!(w.count("SELECT count(*) FROM blocks").await, 0);
    let me = w.app.get("/v1/me", Some(&w.target.token)).await;
    assert_eq!(me.json["profile"]["status"], "active");
    assert_eq!(
        w.count("SELECT count::bigint FROM usage_counters WHERE counter = 'reports_filed'")
            .await,
        1
    );
}

#[sqlx::test]
async fn reporting_the_same_subject_again_returns_the_open_report(db: PgPool) {
    let w = world(db).await;
    let first = w.file(profile_body(&w.target)).await;

    // The same subject, even with another reason: the report that is still open comes back,
    // nothing is created and the daily counter does not move.
    let mut again = profile_body(&w.target);
    again["reason"] = json!("fake_profile");
    let response = w.report(again).await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.text);
    assert_eq!(response.json["id"], json!(first));
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 1);
    assert_eq!(
        w.count("SELECT count::bigint FROM usage_counters WHERE counter = 'reports_filed'")
            .await,
        1
    );

    // A different subject of the same member is a new report.
    let photo = w
        .file(json!({
            "target_profile_id": w.target.profile_id,
            "subject_type": "photo",
            "photo_id": w.photo,
            "reason": "inappropriate_photo",
        }))
        .await;
    assert_ne!(photo, first);

    // Once a moderator has decided, the member may report again.
    exec(
        &w.app,
        "UPDATE reports SET status = 'dismissed' WHERE reporter_profile_id = $1",
        w.reporter.profile_id,
    )
    .await;
    let next = w.file(profile_body(&w.target)).await;
    assert_ne!(next, first);
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 3);

    // Another reporter's report does not count as the caller's.
    let other = w.app.member().await;
    let theirs = w
        .app
        .post("/v1/reports", Some(&other.token), profile_body(&w.target))
        .await;
    assert_eq!(theirs.status, StatusCode::CREATED);
    assert_ne!(theirs.json["id"], json!(next));
}

// -------------------------------------------------------------------------------------------
// Photo reports
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn a_photo_report_stores_the_keys_and_needs_an_approved_photo_of_the_target(db: PgPool) {
    let w = world(db).await;
    let report = |photo: Uuid| {
        json!({
            "target_profile_id": w.target.profile_id,
            "subject_type": "photo",
            "photo_id": photo,
            "reason": "inappropriate_photo",
        })
    };

    let id = w.file(report(w.photo)).await;
    let (subject, photo_id): (String, Option<Uuid>) =
        sqlx::query_as("SELECT subject_type, photo_id FROM reports WHERE id = $1")
            .bind(id)
            .fetch_one(w.app.db())
            .await
            .unwrap();
    assert_eq!((subject.as_str(), photo_id), ("photo", Some(w.photo)));
    let base = format!("photos/{}/{}", w.target.profile_id, w.photo);
    assert_eq!(
        w.context(id).await,
        json!({
            "photo_id": w.photo,
            "status": "approved",
            "is_primary": true,
            "key_large": format!("{base}/large.jpg"),
            "key_medium": format!("{base}/medium.jpg"),
        })
    );
    // A blurred photo can be reported too: the viewer sees it (09 section 6.2).
    set_privacy(
        &w.app,
        w.target.profile_id,
        "photo_visibility = 'approved_only'",
    )
    .await;
    let second = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO profile_photos (id, profile_id, status, position, upload_key, key_large, key_medium)
         VALUES ($1, $2, 'approved', 1, 'tmp/second', 'second/large.jpg', 'second/medium.jpg')",
    )
    .bind(second)
    .bind(w.target.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();
    let id = w.file(report(second)).await;
    assert_eq!(w.context(id).await["is_primary"], false);

    // Photos that are not an approved photo of the target do not exist for the reporter.
    let pending = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO profile_photos (id, profile_id, status, position, upload_key)
         VALUES ($1, $2, 'pending_review', 2, 'tmp/pending')",
    )
    .bind(pending)
    .bind(w.target.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();
    let rejected = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO profile_photos (id, profile_id, status, position, upload_key, rejection_reason)
         VALUES ($1, $2, 'rejected', 3, 'tmp/rejected', 'inappropriate')",
    )
    .bind(rejected)
    .bind(w.target.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();
    let elsewhere = w.app.member_of(Gender::Female).await;
    let others_photo = add_photo(&w.app, elsewhere.profile_id).await;
    for photo in [pending, rejected, others_photo, Uuid::now_v7()] {
        let refused = w.report(report(photo)).await;
        assert_eq!(refused.status, StatusCode::NOT_FOUND, "{photo}");
        assert_eq!(refused.code(), "not_found");
    }

    // A photo of a target the reporter cannot open is not visible either.
    set_privacy(
        &w.app,
        w.target.profile_id,
        "discovery_visibility = 'hidden'",
    )
    .await;
    assert_eq!(
        w.report(report(w.photo)).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 2);
}

// -------------------------------------------------------------------------------------------
// Message reports
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn a_message_report_captures_the_window_of_that_connection_only(db: PgPool) {
    let w = world(db).await;
    let connection = connect(&w.app, w.reporter.profile_id, w.target.profile_id).await;
    // A second chat of the reporter, written at the same time, must not leak in.
    let other = w.app.member_of(Gender::Female).await;
    let other_connection = connect(&w.app, w.reporter.profile_id, other.profile_id).await;

    // 40 messages in the reported chat, the reporter first, with noise from the other chat
    // created between them (the ids interleave).
    let ids = talk(
        &w.app,
        connection,
        w.reporter.profile_id,
        w.target.profile_id,
        40,
    )
    .await;
    let noise = talk(
        &w.app,
        other_connection,
        w.reporter.profile_id,
        other.profile_id,
        40,
    )
    .await;
    assert_eq!(noise.len(), 40);
    // Message 25 is the target's (odd index); mark the neighbours to check the shape.
    exec(
        &w.app,
        "UPDATE messages SET safety_flag = 'money' WHERE body = 'message 24'
           AND sender_profile_id = $1",
        w.reporter.profile_id,
    )
    .await;
    exec(
        &w.app,
        "UPDATE messages SET deleted_at = now(), body = NULL WHERE body = 'message 26'
           AND sender_profile_id = $1",
        w.reporter.profile_id,
    )
    .await;
    // A system message inside the window.
    sqlx::query(
        "INSERT INTO messages (id, connection_id, kind, system_event) VALUES ($1, $2, 'system', 'connected')",
    )
    .bind(Uuid::now_v7())
    .bind(connection)
    .execute(w.app.db())
    .await
    .unwrap();

    let report = |message: Uuid| {
        json!({
            "target_profile_id": w.target.profile_id,
            "subject_type": "message",
            "message_id": message,
            "reason": "asking_for_money",
        })
    };
    let reported = ids[25];
    let id = w.file(report(reported)).await;
    let (subject, message_id): (String, Option<Uuid>) =
        sqlx::query_as("SELECT subject_type, message_id FROM reports WHERE id = $1")
            .bind(id)
            .fetch_one(w.app.db())
            .await
            .unwrap();
    assert_eq!((subject.as_str(), message_id), ("message", Some(reported)));

    let context = w.context(id).await;
    assert_eq!(context["connection_id"], json!(connection));
    assert_eq!(context["reported_message_id"], json!(reported));
    // 20 before (indexes 5 to 24), the message, and 5 after (26 to 30): 26 messages, oldest
    // first, none of them from the other chat. The system message was created last, so it is
    // outside the window here.
    let window = message_ids(&context);
    assert_eq!(window, ids[5..=30]);
    assert_eq!(window.len(), 26);
    let messages = context["messages"].as_array().unwrap();
    let senders: Vec<&str> = messages
        .iter()
        .map(|message| message["sender"].as_str().unwrap())
        .collect();
    assert_eq!(senders[0], "target", "index 5 is odd, so the target's");
    assert_eq!(senders[1], "reporter");
    assert_eq!(messages[20]["id"], json!(reported));
    assert_eq!(messages[20]["sender"], "target");
    assert_eq!(messages[20]["body"], "message 25");
    assert_eq!(messages[20]["safety_flag"], Value::Null);
    // `message 24` carries its flag, and the deleted `message 26` has no body.
    assert_eq!(messages[19]["safety_flag"], "money");
    assert_eq!(messages[21]["body"], Value::Null);
    assert!(messages[20]["created_at"].as_str().unwrap().ends_with('Z'));

    // Near the start only the messages that exist are kept; near the end likewise, and a
    // system message in the window is `system` with no body.
    let early = w.file(report(ids[3])).await;
    assert_eq!(message_ids(&w.context(early).await), ids[0..=8]);
    // Message 39 is the target's; index 38 is the reporter's. The system message follows.
    let late = w.file(report(ids[39])).await;
    let context = w.context(late).await;
    let window = message_ids(&context);
    assert_eq!(window.len(), 20 + 1 + 1);
    assert_eq!(window[..21], ids[19..=39]);
    let last = context["messages"].as_array().unwrap().last().unwrap();
    assert_eq!(last["sender"], "system");
    assert_eq!(last["body"], Value::Null);

    // Filing does not touch the chat.
    assert_eq!(
        w.count("SELECT count(*) FROM messages WHERE kind = 'text'")
            .await,
        80
    );
}

#[sqlx::test]
async fn only_a_message_the_target_sent_in_the_callers_connection_can_be_reported(db: PgPool) {
    let w = world(db).await;
    let connection = connect(&w.app, w.reporter.profile_id, w.target.profile_id).await;
    let ids = talk(
        &w.app,
        connection,
        w.reporter.profile_id,
        w.target.profile_id,
        4,
    )
    .await;
    let report = |target: &TestUser, message: Uuid| {
        json!({
            "target_profile_id": target.profile_id,
            "subject_type": "message",
            "message_id": message,
            "reason": "harassment",
        })
    };

    // Index 1 was sent by the target.
    let id = w.file(report(&w.target, ids[1])).await;
    assert_eq!(w.context(id).await["messages"].as_array().unwrap().len(), 4);

    // The reporter's own message, a message that does not exist, and a message with a target
    // who is not its sender do not exist for the reporter.
    let third = w.app.member_of(Gender::Female).await;
    let system = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO messages (id, connection_id, kind, system_event) VALUES ($1, $2, 'system', 'connected')",
    )
    .bind(system)
    .bind(connection)
    .execute(w.app.db())
    .await
    .unwrap();
    for (target, message) in [
        (&w.target, ids[0]),
        (&w.target, Uuid::now_v7()),
        (&third, ids[1]),
        (&w.target, system),
    ] {
        let refused = w.report(report(target, message)).await;
        assert_eq!(refused.status, StatusCode::NOT_FOUND, "{message}");
    }

    // A chat between two other members is not the caller's, even when the target is a member
    // of it.
    let stranger = w.app.member().await;
    let other_connection = connect(&w.app, stranger.profile_id, w.target.profile_id).await;
    let theirs = talk(
        &w.app,
        other_connection,
        stranger.profile_id,
        w.target.profile_id,
        2,
    )
    .await;
    assert_eq!(
        w.report(report(&w.target, theirs[1])).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 1);

    // The chat having ended, and the reporter having blocked the target since, change
    // nothing: the history stays theirs to report.
    exec(
        &w.app,
        "UPDATE connections SET status = 'ended', ended_reason = 'other', ended_at = now()
         WHERE profile_low_id = $1 OR profile_high_id = $1",
        w.reporter.profile_id,
    )
    .await;
    block_row(&w.app, w.reporter.profile_id, w.target.profile_id).await;
    let later = w.file(report(&w.target, ids[3])).await;
    assert_eq!(
        w.context(later).await["messages"].as_array().unwrap().len(),
        5
    );
    // But the profile itself no longer exists for a member who blocked it.
    assert_eq!(
        w.report(profile_body(&w.target)).await.status,
        StatusCode::NOT_FOUND
    );
}

// -------------------------------------------------------------------------------------------
// Visibility, validation, access levels and the limit
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn a_subject_the_caller_cannot_see_answers_not_found(db: PgPool) {
    let w = world(db).await;
    // Unknown, own, same gender, hidden and blocked members.
    let man = w.app.member().await;
    let hidden = w.app.member_of(Gender::Female).await;
    set_privacy(&w.app, hidden.profile_id, "discovery_visibility = 'hidden'").await;
    let blocker = w.app.member_of(Gender::Female).await;
    block_row(&w.app, blocker.profile_id, w.reporter.profile_id).await;
    let suspended = w.app.member_of(Gender::Female).await;
    exec(
        &w.app,
        "UPDATE users SET status = 'suspended' WHERE id = (SELECT user_id FROM profiles WHERE id = $1)",
        suspended.profile_id,
    )
    .await;
    let unknown = json!({
        "target_profile_id": Uuid::now_v7(),
        "subject_type": "profile",
        "reason": "other",
    });
    assert_eq!(w.report(unknown).await.status, StatusCode::NOT_FOUND);
    for target in [&w.reporter, &man, &hidden, &blocker, &suspended] {
        let refused = w.report(profile_body(target)).await;
        assert_eq!(refused.status, StatusCode::NOT_FOUND);
        assert_eq!(refused.code(), "not_found");
    }
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 0);
    assert_eq!(
        w.count("SELECT count(*) FROM usage_counters WHERE counter = 'reports_filed'")
            .await,
        0
    );

    // A hidden member stays reportable by the members they contacted (09 section 2.2 row 6).
    interest(
        &w.app,
        hidden.profile_id,
        w.reporter.profile_id,
        "pending",
        0,
    )
    .await;
    assert_eq!(
        w.report(profile_body(&hidden)).await.status,
        StatusCode::CREATED
    );
}

#[sqlx::test]
async fn the_body_is_validated_field_by_field(db: PgPool) {
    let w = world(db).await;
    let target = w.target.profile_id;
    // The test files a dozen reports.
    w.app
        .state
        .settings
        .put("limits.reports_per_day", &json!(50), None)
        .await
        .unwrap();

    let with = |changes: Value| {
        let mut body = profile_body(&w.target);
        for (key, value) in changes.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    };
    let refused = |response: TestResponse| {
        assert_eq!(
            response.status,
            StatusCode::BAD_REQUEST,
            "{}",
            response.text
        );
        response
    };

    assert_eq!(
        refused(w.report(with(json!({ "reason": "rude" }))).await).field_errors(),
        ["reason:unknown_code"]
    );
    assert_eq!(
        refused(w.report(with(json!({ "details": "a".repeat(1001) }))).await).field_errors(),
        ["details:too_long"]
    );
    // A photo needs `photo_id`, a message needs `message_id`, and neither may carry the
    // other's id.
    let missing_photo =
        json!({ "target_profile_id": target, "subject_type": "photo", "reason": "other" });
    assert_eq!(
        refused(w.report(missing_photo).await).field_errors(),
        ["photo_id:required"]
    );
    let missing_message =
        json!({ "target_profile_id": target, "subject_type": "message", "reason": "other" });
    assert_eq!(
        refused(w.report(missing_message).await).field_errors(),
        ["message_id:required"]
    );
    assert_eq!(
        refused(w.report(with(json!({ "photo_id": w.photo }))).await).field_errors(),
        ["photo_id:not_allowed"]
    );
    assert_eq!(
        refused(
            w.report(with(
                json!({ "message_id": Uuid::now_v7(), "photo_id": w.photo })
            ))
            .await
        )
        .field_errors(),
        ["photo_id:not_allowed", "message_id:not_allowed"]
    );
    let both = json!({
        "target_profile_id": target, "subject_type": "photo", "reason": "other",
        "photo_id": w.photo, "message_id": Uuid::now_v7(),
    });
    assert_eq!(
        refused(w.report(both).await).field_errors(),
        ["message_id:not_allowed"]
    );
    // Wrong types, unknown keys and a missing target are `bad_request`.
    for body in [
        with(json!({ "subject_type": "account" })),
        with(json!({ "target_profile_id": "someone" })),
        with(json!({ "also_block": "yes" })),
        with(json!({ "severity": 3 })),
        json!({ "subject_type": "profile", "reason": "other" }),
    ] {
        let response = w.report(body).await;
        assert_eq!(
            response.status,
            StatusCode::BAD_REQUEST,
            "{}",
            response.text
        );
        assert_eq!(response.code(), "bad_request");
    }

    // The edges that are fine: exactly 1000 characters, no details, an empty string, every
    // reason of the list.
    assert_eq!(
        w.report(with(json!({ "details": "a".repeat(1000) })))
            .await
            .status,
        StatusCode::CREATED
    );
    for (index, reason) in crate::domain::options::ReportReason::ALL.iter().enumerate() {
        let victim = w.app.member_of(Gender::Female).await;
        let mut body = profile_body(&victim);
        body["reason"] = json!(reason.as_str());
        if index % 2 == 0 {
            body["details"] = json!("   ");
        }
        let response = w.report(body).await;
        assert_eq!(
            response.status,
            StatusCode::CREATED,
            "{reason}: {}",
            response.text
        );
    }
    let blank: i64 = sqlx::query_scalar("SELECT count(*) FROM reports WHERE details IS NULL")
        .fetch_one(w.app.db())
        .await
        .unwrap();
    assert!(blank >= 5, "a blank text is stored as no details");
    assert_eq!(
        w.count("SELECT count(*) FROM reports WHERE reason = 'underage'")
            .await,
        1
    );
}

#[sqlx::test]
async fn the_access_level_connected_applies(db: PgPool) {
    let w = world(db).await;
    let body = profile_body(&w.target);

    // No token, a draft profile, a suspended user: refused before anything else.
    let anonymous = w.app.post("/v1/reports", None, body.clone()).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
    let draft = w.app.draft_user().await;
    let refused = w
        .app
        .post("/v1/reports", Some(&draft.token), body.clone())
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "onboarding_required");
    let suspended = w.app.member().await;
    exec(
        &w.app,
        "UPDATE users SET status = 'suspended' WHERE id = (SELECT user_id FROM profiles WHERE id = $1)",
        suspended.profile_id,
    )
    .await;
    w.app.state.accounts.invalidate(suspended.user_id);
    let refused = w
        .app
        .post("/v1/reports", Some(&suspended.token), body.clone())
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "account_suspended");
    let pending = w
        .app
        .member_with(|spec| spec.status = crate::domain::types::ProfileStatus::PendingReview)
        .await;
    let refused = w
        .app
        .post("/v1/reports", Some(&pending.token), body.clone())
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "profile_not_active");
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 0);

    // Paused and closed profiles may report: a profile they can still open, here a
    // connection (09 section 2.2 row 5).
    connect(&w.app, w.reporter.profile_id, w.target.profile_id).await;
    for status in ["paused", "closed"] {
        set_profile(
            &w.app,
            w.reporter.profile_id,
            &format!("status = '{status}'"),
        )
        .await;
        w.app.state.accounts.invalidate(w.reporter.user_id);
        exec(
            &w.app,
            "DELETE FROM reports WHERE reporter_profile_id = $1",
            w.reporter.profile_id,
        )
        .await;
        let response = w.report(body.clone()).await;
        assert_eq!(
            response.status,
            StatusCode::CREATED,
            "{status}: {}",
            response.text
        );
    }
}

#[sqlx::test]
async fn the_daily_limit_counts_filed_reports_and_resets_with_the_day(db: PgPool) {
    let w = world(db).await;
    w.app
        .state
        .settings
        .put("limits.reports_per_day", &json!(2), None)
        .await
        .unwrap();
    let second = w.app.member_of(Gender::Female).await;
    let third = w.app.member_of(Gender::Female).await;

    w.file(profile_body(&w.target)).await;
    w.file(profile_body(&second)).await;
    // A third report is refused with the numbers, and creates nothing.
    let refused = w.report(profile_body(&third)).await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(refused.code(), "limit_reached");
    let details = &refused.json["error"]["details"];
    assert_eq!(details["limit"], "reports_per_day");
    assert_eq!(details["used"], 2);
    assert!(details["resets_at"].is_string());
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 2);
    // So is a repeat of an open report: the limit is checked before the duplicate (13
    // section 6.4 steps 2 and 3).
    assert_eq!(
        w.report(profile_body(&w.target)).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    // A refused report with `also_block` blocks nobody.
    let mut blocking = profile_body(&third);
    blocking["also_block"] = json!(true);
    assert_eq!(
        w.report(blocking.clone()).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(w.count("SELECT count(*) FROM blocks").await, 0);

    // The next day starts again.
    exec(
        &w.app,
        "UPDATE usage_counters SET day = day - 1 WHERE profile_id = $1",
        w.reporter.profile_id,
    )
    .await;
    w.file(profile_body(&third)).await;
    assert_eq!(
        w.count("SELECT count(*) FROM usage_counters WHERE counter = 'reports_filed'")
            .await,
        2,
        "yesterday's row and today's"
    );
}

// -------------------------------------------------------------------------------------------
// also_block
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn also_block_applies_the_block_in_the_same_transaction(db: PgPool) {
    let w = world(db).await;
    let connection = connect(&w.app, w.reporter.profile_id, w.target.profile_id).await;
    // What a block ends or closes: a connection (above), photo access and a shortlist entry.
    exec(
        &w.app,
        "INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status)
         VALUES ($1, (SELECT id FROM profiles WHERE gender = 'male'), 'granted')",
        w.target.profile_id,
    )
    .await;
    exec(
        &w.app,
        "INSERT INTO shortlists (profile_id, target_profile_id)
         VALUES ((SELECT id FROM profiles WHERE gender = 'male'), $1)",
        w.target.profile_id,
    )
    .await;
    let ids = talk(
        &w.app,
        connection,
        w.reporter.profile_id,
        w.target.profile_id,
        3,
    )
    .await;

    // Without `also_block` (or with `false`) nothing is blocked.
    let mut body = json!({
        "target_profile_id": w.target.profile_id,
        "subject_type": "message",
        "message_id": ids[1],
        "reason": "harassment",
        "also_block": false,
    });
    let id = w.file(body.clone()).await;
    assert_eq!(w.count("SELECT count(*) FROM blocks").await, 0);
    assert!(w.target_visible().await);

    // The same report again with the box ticked returns the same report and blocks.
    body["also_block"] = json!(true);
    let response = w.report(body).await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.text);
    assert_eq!(response.json["id"], json!(id));
    assert_eq!(w.count("SELECT count(*) FROM reports").await, 1);
    assert_eq!(
        w.count("SELECT count(*) FROM blocks WHERE blocker_profile_id = (SELECT reporter_profile_id FROM reports)")
            .await,
        1
    );
    // Every effect of 15 section 13: the connection ended as blocked, access revoked, the
    // shortlist entry gone, and the target gone for the reporter.
    let (status, reason): (String, Option<String>) =
        sqlx::query_as("SELECT status, ended_reason FROM connections WHERE id = $1")
            .bind(connection)
            .fetch_one(w.app.db())
            .await
            .unwrap();
    assert_eq!(
        (status.as_str(), reason.as_deref()),
        ("ended", Some("blocked"))
    );
    assert_eq!(
        w.count("SELECT count(*) FROM photo_access WHERE status = 'granted'")
            .await,
        0
    );
    assert_eq!(w.count("SELECT count(*) FROM shortlists").await, 0);
    assert!(!w.target_visible().await);
    // The context was captured before the block, so the farewell message is not in it.
    let context = w.context(id).await;
    assert_eq!(message_ids(&context), ids);

    // On a fresh report of a profile: report and block together, and the report row stays.
    let fresh = w.app.member_of(Gender::Female).await;
    let mut body = profile_body(&fresh);
    body["also_block"] = json!(true);
    let created = w.file(body).await;
    assert_eq!(
        w.count("SELECT count(*) FROM blocks WHERE blocked_profile_id = (SELECT target_profile_id FROM reports ORDER BY created_at DESC LIMIT 1)")
            .await,
        1
    );
    assert_eq!(
        w.count(&format!(
            "SELECT count(*) FROM reports WHERE id = '{created}'"
        ))
        .await,
        1
    );
}

// -------------------------------------------------------------------------------------------
// The contract
// -------------------------------------------------------------------------------------------

#[test]
fn the_spec_describes_the_route_and_the_reason_codes() {
    let spec: Value = serde_json::from_str(&crate::openapi::spec_json().unwrap()).unwrap();
    assert!(spec["paths"]["/v1/reports"]["post"].is_object());
    let body = &spec["components"]["schemas"]["FileReportBody"];
    let mut properties: Vec<&str> = body["properties"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    properties.sort_unstable();
    assert_eq!(
        properties,
        [
            "also_block",
            "details",
            "message_id",
            "photo_id",
            "reason",
            "subject_type",
            "target_profile_id"
        ]
    );
    // The reason is documented as the `report_reason` enumeration.
    assert!(
        body["properties"]["reason"]["$ref"]
            .as_str()
            .unwrap()
            .ends_with("/ReportReason"),
        "{}",
        body["properties"]["reason"]
    );
}
