//! The event catalogue of 14 section 2, row by row: the feed row, the push job and the email job
//! of every event that creates a notification.
//!
//! Rows that notify nobody (4, 5, 9, 11, 14, 15, 20, 29, 30, 32, 33 and row 17, which has only
//! the `welcome` email) have no `notifications.type`, so no code path of this module exists for
//! them; `every_type_has_its_catalogue_row` pins the types that do.

use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::{World, add_device, add_interest, connect, emails_for, feed, pushes_for, set_flag};
use crate::domain::types::NotificationType as T;
use crate::notify::catalogue::{EmailPref, PushPref, email_plan, push_pref, pushes};
use crate::notify::notify;
use crate::test_support::TestUser;

async fn emit(
    w: &World,
    to: &TestUser,
    kind: T,
    actor: Option<&TestUser>,
    data: Value,
) -> Option<Uuid> {
    notify(
        &w.app.state,
        to.user_id,
        kind,
        actor.map(|a| a.profile_id),
        data,
    )
    .await
    .expect("notify does not fail")
}

/// One row of 14 section 2: type, push, push preference, email template, email preference.
type CatalogueRow = (
    T,
    bool,
    Option<PushPref>,
    Option<&'static str>,
    Option<EmailPref>,
);

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "a table with one row per notification type"
)]
fn every_type_has_its_catalogue_row() {
    let table: [CatalogueRow; 18] = [
        (
            T::InterestReceived,
            true,
            Some(PushPref::Interests),
            Some("interest_digest"),
            Some(EmailPref::Interests),
        ),
        (
            T::InterestAccepted,
            true,
            Some(PushPref::Interests),
            Some("interest_accepted"),
            Some(EmailPref::Interests),
        ),
        (
            T::PhotoRequestReceived,
            true,
            Some(PushPref::PhotoRequests),
            None,
            None,
        ),
        (
            T::PhotoRequestGranted,
            true,
            Some(PushPref::PhotoRequests),
            None,
            None,
        ),
        (T::ContactShared, true, Some(PushPref::Messages), None, None),
        (T::StageProposed, true, Some(PushPref::Messages), None, None),
        (
            T::StageConfirmed,
            true,
            Some(PushPref::Messages),
            None,
            None,
        ),
        (T::ProfileApproved, true, None, Some("welcome"), None),
        (
            T::ProfileChangesRequested,
            true,
            None,
            Some("profile_changes_requested"),
            None,
        ),
        (T::PhotoApproved, false, None, None, None),
        (T::PhotoRejected, true, None, None, None),
        (T::TextRejected, true, None, None, None),
        (
            T::VerificationApproved,
            true,
            None,
            Some("verification_result"),
            None,
        ),
        (
            T::VerificationRejected,
            true,
            None,
            Some("verification_result"),
            None,
        ),
        (T::NewMatches, true, Some(PushPref::Matches), None, None),
        (
            T::ProfileViewsSummary,
            true,
            Some(PushPref::ProfileViews),
            None,
            None,
        ),
        (T::AccountWarning, true, None, Some("account_warning"), None),
        (
            T::Announcement,
            true,
            None,
            Some("announcement"),
            Some(EmailPref::Announcements),
        ),
    ];
    assert_eq!(table.len(), T::ALL.len(), "every type has a row");
    for (kind, has_push, push_preference, template, email_preference) in table {
        assert_eq!(pushes(kind), has_push, "{kind} push");
        if has_push {
            assert_eq!(
                push_pref(kind.as_str()),
                push_preference,
                "{kind} push pref"
            );
        }
        let plan = email_plan(
            kind,
            Uuid::now_v7(),
            None,
            &json!({ "reminder": false }),
            time::OffsetDateTime::now_utc(),
        );
        assert_eq!(plan.as_ref().map(|p| p.template), template, "{kind} email");
        assert_eq!(
            plan.and_then(|p| p.pref),
            email_preference,
            "{kind} email pref"
        );
    }
}

#[sqlx::test]
async fn row_1_an_interest_is_a_row_a_push_and_a_daily_digest(db: PgPool) {
    let w = World::new(db).await;
    let interest = add_interest(&w.app, &w.her, &w.him).await;
    let data = json!({ "interest_id": interest, "reminder": false, "count": 1 });
    let id = emit(&w, &w.him, T::InterestReceived, Some(&w.her), data.clone())
        .await
        .expect("a row is created");

    let rows = feed(&w.app, w.him.user_id).await;
    assert_eq!(rows, [("interest_received".to_owned(), data.clone())]);

    let pushes = pushes_for(&w.app, w.him.user_id).await;
    assert_eq!(pushes.len(), 1);
    let push = &pushes[0];
    assert_eq!(push["type"], "interest_received");
    assert_eq!(push["data"]["target"], "APP-PROFILE");
    assert_eq!(push["data"]["profile_id"], json!(w.her.profile_id));
    assert_eq!(push["data"]["interest_id"], json!(interest));
    assert_eq!(push["data"]["notification_id"], json!(id));
    assert_eq!(push["collapse_key"], "interest");
    assert_eq!(push["ttl_seconds"], 3 * 86_400);
    assert!(!push.to_string().contains("Ayesha"), "no name in a push");

    let emails = emails_for(&w.app, w.him.user_id).await;
    assert_eq!(emails.len(), 1);
    assert_eq!(emails[0]["template"], "interest_digest");
    assert_eq!(emails[0]["priority"], 3);
    // Due at the next 18:00 in Karachi, with one job per user.
    let (dedupe, hour, in_future): (String, i32, bool) = sqlx::query_as(
        "SELECT dedupe_key, EXTRACT(hour FROM run_at AT TIME ZONE 'Asia/Karachi')::int, run_at > now()
         FROM jobs WHERE kind = 'send_email'",
    )
    .fetch_one(w.app.db())
    .await
    .unwrap();
    assert_eq!(dedupe, format!("interest_digest:{}", w.him.user_id));
    assert_eq!(hour, 18);
    assert!(in_future);

    // A second interest is a second row and push, but the digest stays one job.
    let another = w
        .app
        .member_of(crate::domain::options::Gender::Female)
        .await;
    let second = add_interest(&w.app, &another, &w.him).await;
    emit(
        &w,
        &w.him,
        T::InterestReceived,
        Some(&another),
        json!({ "interest_id": second, "reminder": false, "count": 1 }),
    )
    .await
    .expect("a second row");
    assert_eq!(pushes_for(&w.app, w.him.user_id).await.len(), 2);
    assert_eq!(emails_for(&w.app, w.him.user_id).await.len(), 1);

    // The same interest again creates nothing.
    assert!(
        emit(&w, &w.him, T::InterestReceived, Some(&w.her), data)
            .await
            .is_none()
    );
    assert_eq!(feed(&w.app, w.him.user_id).await.len(), 2);
}

#[sqlx::test]
async fn row_1_preferences_switch_the_push_and_the_email_off_but_not_the_row(db: PgPool) {
    let w = World::new(db).await;
    set_flag(&w.app, w.him.user_id, "push_interests", false).await;
    set_flag(&w.app, w.him.user_id, "email_interests", false).await;
    let interest = add_interest(&w.app, &w.her, &w.him).await;
    emit(
        &w,
        &w.him,
        T::InterestReceived,
        Some(&w.her),
        json!({ "interest_id": interest, "reminder": false, "count": 1 }),
    )
    .await
    .expect("the feed row is still created");
    assert_eq!(feed(&w.app, w.him.user_id).await.len(), 1);
    assert!(
        pushes_for(&w.app, w.him.user_id).await.is_empty(),
        "no push is queued"
    );
    assert!(
        emails_for(&w.app, w.him.user_id).await.is_empty(),
        "no email is queued"
    );
}

#[sqlx::test]
async fn row_2_the_reminder_pushes_without_email_and_comes_once_a_day(db: PgPool) {
    let w = World::new(db).await;
    let interest = add_interest(&w.app, &w.her, &w.him).await;
    let data = json!({ "interest_id": interest, "reminder": true, "count": 3 });
    emit(&w, &w.him, T::InterestReceived, Some(&w.her), data.clone())
        .await
        .expect("a reminder row");

    let pushes = pushes_for(&w.app, w.him.user_id).await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0]["data"]["target"], "APP-INTERESTS");
    assert_eq!(pushes[0]["data"]["count"], "3");
    assert_eq!(pushes[0]["collapse_key"], "interest_reminder");
    assert_eq!(pushes[0]["ttl_seconds"], 86_400);
    assert!(
        emails_for(&w.app, w.him.user_id).await.is_empty(),
        "no email is queued"
    );

    // One reminder per recipient per day, whichever interest it names.
    let other = w
        .app
        .member_of(crate::domain::options::Gender::Female)
        .await;
    let other_interest = add_interest(&w.app, &other, &w.him).await;
    assert!(
        emit(
            &w,
            &w.him,
            T::InterestReceived,
            Some(&other),
            json!({ "interest_id": other_interest, "reminder": true, "count": 2 })
        )
        .await
        .is_none()
    );
    // A reminder does not count as the row of its interest, and the other way round.
    assert!(
        emit(
            &w,
            &w.him,
            T::InterestReceived,
            Some(&other),
            json!({ "interest_id": other_interest, "reminder": false, "count": 1 })
        )
        .await
        .is_some()
    );
}

#[sqlx::test]
async fn row_3_an_accepted_interest_reaches_the_sender_by_push_and_email(db: PgPool) {
    let w = World::new(db).await;
    let (interest, connection) = connect(&w.app, &w.him, &w.her).await;
    add_device(&w.app, w.him.user_id, "token-him").await;
    let data = json!({ "interest_id": interest, "connection_id": connection });
    let id = emit(&w, &w.him, T::InterestAccepted, Some(&w.her), data.clone())
        .await
        .expect("a row");

    let pushes = pushes_for(&w.app, w.him.user_id).await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0]["data"]["target"], "APP-CHAT");
    assert_eq!(pushes[0]["data"]["connection_id"], json!(connection));
    assert_eq!(pushes[0]["collapse_key"], format!("accepted_{connection}"));
    let emails = emails_for(&w.app, w.him.user_id).await;
    assert_eq!(emails.len(), 1);
    assert_eq!(emails[0]["template"], "interest_accepted");
    assert_eq!(emails[0]["priority"], 2);
    assert_eq!(
        emails[0]["data"]["actor_profile_id"],
        json!(w.her.profile_id)
    );

    // One per interest.
    assert!(
        emit(&w, &w.him, T::InterestAccepted, Some(&w.her), data)
            .await
            .is_none()
    );

    // The jobs deliver: the push has no name or text, the email names her in full because the
    // two are connected.
    w.app.drain_jobs().await;
    let sent = w.app.push.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    let (token, message) = &sent[0];
    assert_eq!(token, "token-him");
    assert_eq!(message.channel_id, "interests");
    assert_eq!(message.data["notification_id"], json!(id));
    assert!(!message.data.to_string().contains("Ayesha"));
    let mail = w.app.email.sent.lock().unwrap().clone();
    assert_eq!(mail.len(), 1);
    assert_eq!(mail[0].subject, "Ayesha Malik accepted your interest");
    assert!(mail[0].text.contains(&format!("/chats/{connection}")));
}

#[sqlx::test]
async fn row_3_the_email_follows_email_interests(db: PgPool) {
    let w = World::new(db).await;
    set_flag(&w.app, w.him.user_id, "email_interests", false).await;
    let (interest, connection) = connect(&w.app, &w.him, &w.her).await;
    emit(
        &w,
        &w.him,
        T::InterestAccepted,
        Some(&w.her),
        json!({ "interest_id": interest, "connection_id": connection }),
    )
    .await
    .expect("a row");
    assert_eq!(pushes_for(&w.app, w.him.user_id).await.len(), 1);
    assert!(
        emails_for(&w.app, w.him.user_id).await.is_empty(),
        "no email is queued"
    );
}

#[sqlx::test]
async fn rows_7_and_8_photo_requests_push_to_the_owner_and_the_viewer(db: PgPool) {
    let w = World::new(db).await;
    let access = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO photo_access (id, owner_profile_id, viewer_profile_id) VALUES ($1, $2, $3)",
    )
    .bind(access)
    .bind(w.her.profile_id)
    .bind(w.him.profile_id)
    .execute(w.app.db())
    .await
    .unwrap();

    // He asks to see her photos: she is notified, no email.
    let data = json!({ "photo_access_id": access });
    emit(
        &w,
        &w.her,
        T::PhotoRequestReceived,
        Some(&w.him),
        data.clone(),
    )
    .await
    .expect("a row");
    let pushes = pushes_for(&w.app, w.her.user_id).await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0]["data"]["target"], "APP-PHOTO-REQUESTS");
    assert_eq!(pushes[0]["collapse_key"], "photo_request");
    assert!(
        emails_for(&w.app, w.her.user_id).await.is_empty(),
        "no email is queued"
    );
    // One per request.
    assert!(
        emit(&w, &w.her, T::PhotoRequestReceived, Some(&w.him), data)
            .await
            .is_none()
    );

    // She grants: he is notified. A re-grant within 24 hours creates nothing.
    let grant = json!({ "photo_access_id": access });
    emit(
        &w,
        &w.him,
        T::PhotoRequestGranted,
        Some(&w.her),
        grant.clone(),
    )
    .await
    .expect("a row");
    let pushes = pushes_for(&w.app, w.him.user_id).await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0]["data"]["target"], "APP-PROFILE");
    assert_eq!(pushes[0]["data"]["profile_id"], json!(w.her.profile_id));
    assert_eq!(pushes[0]["collapse_key"], "photo_granted");
    assert!(
        emit(&w, &w.him, T::PhotoRequestGranted, Some(&w.her), grant)
            .await
            .is_none()
    );
    assert!(
        emails_for(&w.app, w.him.user_id).await.is_empty(),
        "no email is queued"
    );
}

#[sqlx::test]
async fn rows_7_and_8_follow_push_photo_requests(db: PgPool) {
    let w = World::new(db).await;
    set_flag(&w.app, w.her.user_id, "push_photo_requests", false).await;
    emit(
        &w,
        &w.her,
        T::PhotoRequestReceived,
        Some(&w.him),
        json!({ "photo_access_id": Uuid::now_v7() }),
    )
    .await
    .expect("the row exists");
    assert!(
        pushes_for(&w.app, w.her.user_id).await.is_empty(),
        "no push is queued"
    );
}

#[sqlx::test]
async fn rows_10_12_13_connection_events_push_to_the_other_member(db: PgPool) {
    let w = World::new(db).await;
    let (_, connection) = connect(&w.app, &w.him, &w.her).await;

    // Row 10: contact shared. One per connection and sharer per 24 hours.
    let shared = json!({ "connection_id": connection });
    emit(&w, &w.him, T::ContactShared, Some(&w.her), shared.clone())
        .await
        .expect("a row");
    assert!(
        emit(&w, &w.him, T::ContactShared, Some(&w.her), shared.clone())
            .await
            .is_none()
    );
    // The other member sharing is a different sharer.
    assert!(
        emit(&w, &w.her, T::ContactShared, Some(&w.him), shared)
            .await
            .is_some()
    );

    // Rows 12 and 13: one per proposal.
    let proposal = Uuid::now_v7();
    let proposed = json!({ "connection_id": connection, "proposal_id": proposal, "stage": "families_talking" });
    emit(&w, &w.him, T::StageProposed, Some(&w.her), proposed.clone())
        .await
        .expect("a row");
    assert!(
        emit(&w, &w.him, T::StageProposed, Some(&w.her), proposed)
            .await
            .is_none()
    );
    let confirmed = json!({ "connection_id": connection, "stage": "families_talking", "proposal_id": proposal });
    emit(
        &w,
        &w.her,
        T::StageConfirmed,
        Some(&w.him),
        confirmed.clone(),
    )
    .await
    .expect("a row");
    assert!(
        emit(&w, &w.her, T::StageConfirmed, Some(&w.him), confirmed)
            .await
            .is_none()
    );
    // A new proposal of the same stage is a new decision.
    assert!(
        emit(
            &w,
            &w.him,
            T::StageProposed,
            Some(&w.her),
            json!({ "connection_id": connection, "proposal_id": Uuid::now_v7(), "stage": "engaged" })
        )
        .await
        .is_some()
    );

    let to_him = pushes_for(&w.app, w.him.user_id).await;
    let kinds: Vec<&str> = to_him.iter().filter_map(|p| p["type"].as_str()).collect();
    assert_eq!(
        kinds,
        ["contact_shared", "stage_proposed", "stage_proposed"]
    );
    assert_eq!(to_him[0]["data"]["target"], "APP-CONNECTION");
    assert_eq!(to_him[0]["collapse_key"], format!("contact_{connection}"));
    assert_eq!(to_him[1]["data"]["stage"], "families_talking");
    assert_eq!(to_him[1]["collapse_key"], format!("stage_{connection}"));
    let to_her = pushes_for(&w.app, w.her.user_id).await;
    let kinds: Vec<&str> = to_her.iter().filter_map(|p| p["type"].as_str()).collect();
    assert_eq!(kinds, ["contact_shared", "stage_confirmed"]);
    assert!(
        emails_for(&w.app, w.him.user_id).await.is_empty(),
        "no email is queued"
    );
    assert!(
        emails_for(&w.app, w.her.user_id).await.is_empty(),
        "no email is queued"
    );
}

#[sqlx::test]
async fn rows_10_12_13_follow_push_messages(db: PgPool) {
    let w = World::new(db).await;
    set_flag(&w.app, w.him.user_id, "push_messages", false).await;
    let (_, connection) = connect(&w.app, &w.him, &w.her).await;
    for (kind, data) in [
        (T::ContactShared, json!({ "connection_id": connection })),
        (
            T::StageProposed,
            json!({ "connection_id": connection, "proposal_id": Uuid::now_v7(), "stage": "engaged" }),
        ),
    ] {
        emit(&w, &w.him, kind, Some(&w.her), data)
            .await
            .expect("the row exists");
    }
    assert_eq!(feed(&w.app, w.him.user_id).await.len(), 2);
    assert!(
        pushes_for(&w.app, w.him.user_id).await.is_empty(),
        "no push is queued"
    );
}

#[sqlx::test]
async fn rows_16_to_28_account_notices_always_push_and_email_where_the_catalogue_says(db: PgPool) {
    let w = World::new(db).await;
    // Every switch off: account notices ignore the preferences (14 section 1.2 rule 6).
    for column in [
        "push_interests",
        "push_messages",
        "push_photo_requests",
        "push_matches",
        "email_interests",
        "email_announcements",
    ] {
        set_flag(&w.app, w.him.user_id, column, false).await;
    }
    let photo = Uuid::now_v7();
    let request = Uuid::now_v7();
    let sanction = Uuid::now_v7();
    // (type, data, push target, email template)
    let cases: Vec<(T, Value, Option<&str>, Option<&str>)> = vec![
        (
            T::ProfileApproved,
            json!({}),
            Some("APP-HOME"),
            Some("welcome"),
        ),
        (
            T::ProfileChangesRequested,
            json!({ "reason": "Please add your education" }),
            Some("GATE-CHANGES"),
            Some("profile_changes_requested"),
        ),
        (T::PhotoApproved, json!({ "photo_id": photo }), None, None),
        (
            T::PhotoRejected,
            json!({ "photo_id": photo, "rejection_reason": "face_not_visible" }),
            Some("ME-PHOTOS"),
            None,
        ),
        (
            T::TextRejected,
            json!({ "field": "about_me", "note": null }),
            Some("ME-EDIT"),
            None,
        ),
        (
            T::VerificationApproved,
            json!({ "request_id": request, "kind": "id_document" }),
            Some("ME-VERIFY"),
            Some("verification_result"),
        ),
        (
            T::VerificationRejected,
            json!({ "request_id": Uuid::now_v7(), "kind": "selfie", "rejection_reason": "face_mismatch" }),
            Some("ME-VERIFY"),
            Some("verification_result"),
        ),
        (
            T::AccountWarning,
            json!({ "sanction_id": sanction, "reason": "Please be respectful" }),
            Some("PUB-GUIDELINES"),
            Some("account_warning"),
        ),
    ];
    for (kind, data, target, template) in &cases {
        emit(&w, &w.him, *kind, None, data.clone())
            .await
            .unwrap_or_else(|| panic!("{kind} creates a row"));
        let pushes = pushes_for(&w.app, w.him.user_id).await;
        let last = pushes.iter().rfind(|p| p["type"] == kind.as_str());
        match target {
            Some(target) => {
                let push = last.unwrap_or_else(|| panic!("{kind} has a push"));
                assert_eq!(push["data"]["target"], *target, "{kind}");
                assert!(
                    push["data"].get("reason").is_none(),
                    "{kind} never sends reasons"
                );
            }
            None => assert!(last.is_none(), "{kind} has no push"),
        }
        let emails = emails_for(&w.app, w.him.user_id).await;
        let sent = emails
            .iter()
            .rfind(|e| template.is_some_and(|t| e["template"] == t));
        assert_eq!(sent.is_some(), template.is_some(), "{kind} email");
    }
    assert_eq!(feed(&w.app, w.him.user_id).await.len(), cases.len());

    // The decision data reaches the emails; the verification result says which way it went.
    let emails = emails_for(&w.app, w.him.user_id).await;
    let results: Vec<&str> = emails
        .iter()
        .filter(|e| e["template"] == "verification_result")
        .filter_map(|e| e["data"]["result"].as_str())
        .collect();
    assert_eq!(results, ["approved", "rejected"]);
    let changes = emails
        .iter()
        .find(|e| e["template"] == "profile_changes_requested")
        .unwrap();
    assert_eq!(changes["data"]["reason"], "Please add your education");
    assert!(emails.iter().all(|e| e["priority"].as_i64().is_some()));

    // One per decision: the same warning or photo decision again creates nothing.
    assert!(
        emit(
            &w,
            &w.him,
            T::AccountWarning,
            None,
            json!({ "sanction_id": sanction, "reason": "Please be respectful" })
        )
        .await
        .is_none()
    );
    assert!(
        emit(
            &w,
            &w.him,
            T::PhotoRejected,
            None,
            json!({ "photo_id": photo, "rejection_reason": "face_not_visible" })
        )
        .await
        .is_none()
    );
    // Texts have no decision id: a second rejection of another field is a second decision.
    assert!(
        emit(
            &w,
            &w.him,
            T::TextRejected,
            None,
            json!({ "field": "about_family", "note": null })
        )
        .await
        .is_some()
    );
}

#[sqlx::test]
async fn row_22_the_push_of_a_rejected_partner_note_opens_preferences(db: PgPool) {
    let w = World::new(db).await;
    emit(
        &w,
        &w.him,
        T::TextRejected,
        None,
        json!({ "field": "partner_notes", "note": "Please remove the phone number" }),
    )
    .await
    .expect("a row");
    let push = &pushes_for(&w.app, w.him.user_id).await[0];
    assert_eq!(push["data"]["target"], "ME-PREFS");
    assert_eq!(push["data"]["field"], "partner_notes");
    assert!(
        !push.to_string().contains("phone number"),
        "no moderator note in a push"
    );
}

#[sqlx::test]
async fn rows_25_to_27_matches_are_limited_per_source_and_views_follow_their_switch(db: PgPool) {
    let w = World::new(db).await;
    // Row 25: nightly recommendations, once per 20 hours.
    let recommendations =
        json!({ "source": "recommendations", "count": 4, "saved_search_id": null });
    emit(&w, &w.him, T::NewMatches, None, recommendations.clone())
        .await
        .expect("a row");
    assert!(
        emit(&w, &w.him, T::NewMatches, None, recommendations)
            .await
            .is_none()
    );
    // Row 26: a saved search has its own limit per search.
    let (one, two) = (Uuid::now_v7(), Uuid::now_v7());
    let saved = |id: Uuid| json!({ "source": "saved_search", "count": 2, "saved_search_id": id, "saved_search_name": "Lahore doctors" });
    emit(&w, &w.him, T::NewMatches, None, saved(one))
        .await
        .expect("a row");
    assert!(
        emit(&w, &w.him, T::NewMatches, None, saved(one))
            .await
            .is_none()
    );
    assert!(
        emit(&w, &w.him, T::NewMatches, None, saved(two))
            .await
            .is_some()
    );

    let pushes = pushes_for(&w.app, w.him.user_id).await;
    assert_eq!(pushes.len(), 3);
    assert_eq!(pushes[0]["data"]["target"], "APP-MATCHES");
    assert_eq!(pushes[0]["data"]["count"], "4");
    assert_eq!(pushes[0]["collapse_key"], "matches");
    assert_eq!(pushes[1]["data"]["target"], "APP-SEARCH");
    assert_eq!(pushes[1]["data"]["saved_search_id"], json!(one));
    assert!(
        !pushes[1].to_string().contains("Lahore"),
        "no search name in a push"
    );
    assert!(
        emails_for(&w.app, w.him.user_id).await.is_empty(),
        "no email is queued"
    );

    // Row 27: the daily views summary pushes only when push_profile_views is on (default off).
    emit(
        &w,
        &w.him,
        T::ProfileViewsSummary,
        None,
        json!({ "count": 7 }),
    )
    .await
    .expect("a row");
    assert_eq!(
        pushes_for(&w.app, w.him.user_id).await.len(),
        3,
        "off by default"
    );
    assert!(
        emit(
            &w,
            &w.him,
            T::ProfileViewsSummary,
            None,
            json!({ "count": 9 })
        )
        .await
        .is_none(),
        "at most one a day"
    );
    set_flag(&w.app, w.her.user_id, "push_profile_views", true).await;
    emit(
        &w,
        &w.her,
        T::ProfileViewsSummary,
        None,
        json!({ "count": 3 }),
    )
    .await
    .expect("a row");
    let pushes = pushes_for(&w.app, w.her.user_id).await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0]["data"]["target"], "APP-VISITORS");
    assert_eq!(pushes[0]["collapse_key"], "views");
}

#[sqlx::test]
async fn row_31_an_announcement_pushes_and_emails_while_the_switch_is_on(db: PgPool) {
    let w = World::new(db).await;
    let data = json!({ "text_en": "Eid mubarak from the team", "text_ur": null, "url": "https://example.com/eid" });
    emit(&w, &w.him, T::Announcement, None, data.clone())
        .await
        .expect("a row");
    let pushes = pushes_for(&w.app, w.him.user_id).await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0]["collapse_key"], "announcement");
    assert!(
        !pushes[0].to_string().contains("Eid"),
        "no announcement text in a push"
    );
    assert!(!pushes[0].to_string().contains("example.com"));
    let emails = emails_for(&w.app, w.him.user_id).await;
    assert_eq!(emails.len(), 1);
    assert_eq!(emails[0]["template"], "announcement");
    assert_eq!(emails[0]["priority"], 6);

    // One per user per announcement.
    assert!(
        emit(&w, &w.him, T::Announcement, None, data.clone())
            .await
            .is_none()
    );

    // email_announcements off: the row and the push stay, the email does not.
    set_flag(&w.app, w.her.user_id, "email_announcements", false).await;
    emit(&w, &w.her, T::Announcement, None, data)
        .await
        .expect("a row");
    assert_eq!(pushes_for(&w.app, w.her.user_id).await.len(), 1);
    assert!(
        emails_for(&w.app, w.her.user_id).await.is_empty(),
        "no email is queued"
    );
}
