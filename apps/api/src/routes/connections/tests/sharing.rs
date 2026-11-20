//! Tests of contact sharing and stages (T-404): required values, what the other member sees,
//! revocation, the proposal rules, and `nikah_done` closing both profiles.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::{Pair, connect_through_api, pair, say, scalar, text};
use crate::domain::options::Gender;
use crate::test_support::{TestApp, TestResponse, TestUser};
use crate::views::testing::{exec, interest};

/// A contact share body selecting the named items.
fn share(items: &[&str]) -> Value {
    let flag = |item: &str| items.contains(&item);
    json!({
        "share_phone": flag("phone"),
        "share_whatsapp": flag("whatsapp"),
        "share_email": flag("email"),
        "share_guardian": flag("guardian"),
    })
}

async fn system_events(app: &TestApp, pair: &Pair) -> Vec<(String, Value)> {
    sqlx::query_as(
        "SELECT system_event, system_data FROM messages
         WHERE connection_id = $1 AND kind = 'system' ORDER BY id",
    )
    .bind(pair.id)
    .fetch_all(app.db())
    .await
    .unwrap()
}

async fn notifications_of(app: &TestApp, user: &TestUser, kind: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM notifications WHERE user_id = $1 AND type = $2")
        .bind(user.user_id)
        .bind(kind)
        .fetch_one(app.db())
        .await
        .unwrap()
}

#[sqlx::test]
async fn contact_details_are_shared_item_by_item(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let path = pair.path("/contact-share");

    let none = app.put(&path, Some(&pair.woman.token), share(&[])).await;
    assert_eq!(none.code(), "validation_failed");
    let empty = app
        .put(
            &path,
            Some(&pair.woman.token),
            share(&["phone", "guardian"]),
        )
        .await;
    assert_eq!(
        empty.field_errors(),
        ["share_phone:required", "share_guardian:required"]
    );
    exec(
        &app,
        "INSERT INTO profile_contacts (profile_id, phone_e164, whatsapp_e164, contact_email,
             guardian_name, guardian_relation, guardian_phone_e164, preferred_contact,
             best_time_to_call)
         VALUES ($1, '+923001112233', '+923004445566', 'family@example.com', 'Tariq', 'father',
                 '+923007778899', 'guardian', 'After 7 pm')",
        pair.woman.profile_id,
    )
    .await;

    let shared = app
        .put(
            &path,
            Some(&pair.woman.token),
            share(&["phone", "guardian"]),
        )
        .await;
    assert_eq!(shared.status, StatusCode::OK, "{}", shared.text);
    assert_eq!(shared.json["my_contact_share"]["status"], "active");
    assert_eq!(shared.json["my_contact_share"]["share_phone"], true);
    assert_eq!(shared.json["my_contact_share"]["share_email"], false);
    assert_eq!(
        shared.json["their_contact"],
        Value::Null,
        "he shared nothing"
    );

    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(
        his.json["their_contact"],
        json!({
            "phone_e164": "+923001112233",
            "whatsapp_e164": null,
            "contact_email": null,
            "guardian": { "name": "Tariq", "relation": "father", "phone_e164": "+923007778899" },
            "preferred_contact": "guardian",
            "best_time_to_call": "After 7 pm",
        })
    );
    assert_eq!(his.json["my_contact_share"], Value::Null);
    assert_eq!(notifications_of(&app, &pair.man, "contact_shared").await, 1);
    let events = system_events(&app, &pair).await;
    let (event, data) = events.last().unwrap();
    assert_eq!(event, "contact_shared");
    assert_eq!(data["items"], json!(["phone", "guardian"]));
    assert_eq!(data["actor_profile_id"], json!(pair.woman.profile_id));

    // An edit after sharing is what he sees next (a reference, not a copy).
    exec(
        &app,
        "UPDATE profile_contacts SET phone_e164 = '+923009990000' WHERE profile_id = $1",
        pair.woman.profile_id,
    )
    .await;
    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(his.json["their_contact"]["phone_e164"], "+923009990000");

    // Revoking hides everything; sharing again reuses the row.
    let revoked = app.delete(&path, Some(&pair.woman.token)).await;
    assert_eq!(revoked.status, StatusCode::OK, "{}", revoked.text);
    assert_eq!(revoked.json["my_contact_share"]["status"], "revoked");
    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(his.json["their_contact"], Value::Null);
    let events = system_events(&app, &pair).await;
    assert_eq!(events.last().unwrap().0, "contact_share_revoked");
    let quiet = app.delete(&path, Some(&pair.woman.token)).await;
    assert_eq!(quiet.status, StatusCode::OK);
    assert_eq!(
        system_events(&app, &pair).await.len(),
        events.len(),
        "nothing to revoke"
    );
    let again = app
        .put(
            &path,
            Some(&pair.woman.token),
            share(&["whatsapp", "email"]),
        )
        .await;
    assert_eq!(again.json["my_contact_share"]["status"], "active");
    assert_eq!(
        scalar(
            &app,
            "SELECT count(*) FROM contact_shares WHERE connection_id = $1",
            pair.id
        )
        .await,
        1
    );
    let his = app.get(&pair.path(""), Some(&pair.man.token)).await;
    assert_eq!(his.json["their_contact"]["phone_e164"], Value::Null);
    assert_eq!(
        his.json["their_contact"]["contact_email"],
        "family@example.com"
    );
    assert_eq!(his.json["their_contact"]["guardian"], Value::Null);
    // Still one notification: one per connection and sharer per 24 hours.
    assert_eq!(notifications_of(&app, &pair.man, "contact_shared").await, 1);
}

async fn propose(app: &TestApp, pair: &Pair, by: &TestUser, stage: &str) -> TestResponse {
    app.post(
        &pair.path("/stage-proposals"),
        Some(&by.token),
        json!({ "stage": stage }),
    )
    .await
}

async fn answer(
    app: &TestApp,
    pair: &Pair,
    by: &TestUser,
    proposal: &TestResponse,
    action: &str,
) -> TestResponse {
    let id = proposal.json["pending_stage_proposal"]["id"]
        .as_str()
        .unwrap();
    let path = pair.path(&format!("/stage-proposals/{id}"));
    if action == "cancel" {
        app.delete(&path, Some(&by.token)).await
    } else {
        app.post_empty(&format!("{path}/{action}"), Some(&by.token))
            .await
    }
}

#[sqlx::test]
async fn stage_proposals_follow_their_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let (man, woman) = (&pair.man, &pair.woman);

    assert_eq!(
        propose(&app, &pair, man, "chatting").await.code(),
        "bad_request"
    );
    let proposed = propose(&app, &pair, man, "families_talking").await;
    assert_eq!(proposed.status, StatusCode::OK, "{}", proposed.text);
    let pending = &proposed.json["pending_stage_proposal"];
    assert_eq!(pending["stage"], "families_talking");
    assert_eq!(pending["proposed_by"], "me");
    let hers = app.get(&pair.path(""), Some(&woman.token)).await;
    assert_eq!(hers.json["pending_stage_proposal"]["proposed_by"], "them");
    assert_eq!(notifications_of(&app, woman, "stage_proposed").await, 1);
    // One pending proposal per connection, whoever asks.
    assert_eq!(
        propose(&app, &pair, man, "engaged").await.code(),
        "already_exists"
    );
    assert_eq!(
        propose(&app, &pair, woman, "engaged").await.code(),
        "already_exists"
    );
    // Only the other member answers.
    assert_eq!(
        answer(&app, &pair, man, &proposed, "confirm").await.code(),
        "forbidden"
    );
    assert_eq!(
        answer(&app, &pair, woman, &proposed, "cancel").await.code(),
        "forbidden"
    );

    let declined = answer(&app, &pair, woman, &proposed, "decline").await;
    assert_eq!(declined.status, StatusCode::OK, "{}", declined.text);
    assert_eq!(declined.json["stage"], "chatting");
    assert_eq!(declined.json["pending_stage_proposal"], Value::Null);
    assert_eq!(
        answer(&app, &pair, woman, &proposed, "decline")
            .await
            .code(),
        "invalid_state"
    );
    let (event, data) = system_events(&app, &pair).await.pop().unwrap();
    assert_eq!(event, "stage_declined");
    assert_eq!(data["cancelled"], false);
    assert_eq!(notifications_of(&app, man, "stage_proposed").await, 0);

    // The proposer waits 7 days for the same stage; another stage, or the other member, may go.
    let cooldown = propose(&app, &pair, man, "families_talking").await;
    assert_eq!(cooldown.code(), "cooldown_active");
    assert!(cooldown.json["error"]["details"]["retry_after_date"].is_string());
    let hers = propose(&app, &pair, woman, "families_talking").await;
    assert_eq!(hers.status, StatusCode::OK, "{}", hers.text);
    let cancelled = answer(&app, &pair, woman, &hers, "cancel").await;
    assert_eq!(cancelled.status, StatusCode::OK, "{}", cancelled.text);
    let (event, data) = system_events(&app, &pair).await.pop().unwrap();
    assert_eq!(event, "stage_declined");
    assert_eq!(data["cancelled"], true);
    assert_eq!(data["actor_profile_id"], json!(woman.profile_id));
    exec(
        &app,
        "UPDATE connection_stage_proposals SET responded_at = now() - interval '8 days'
         WHERE connection_id = $1 AND status = 'declined'",
        pair.id,
    )
    .await;

    // After 7 days he may suggest it again.
    let retried = propose(&app, &pair, man, "families_talking").await;
    assert_eq!(retried.status, StatusCode::OK, "{}", retried.text);
    let confirmed = answer(&app, &pair, woman, &retried, "confirm").await;
    assert_eq!(confirmed.json["stage"], "families_talking");

    // Stages only move forward.
    let engaged = propose(&app, &pair, man, "engaged").await;
    let confirmed = answer(&app, &pair, woman, &engaged, "confirm").await;
    assert_eq!(confirmed.status, StatusCode::OK, "{}", confirmed.text);
    assert_eq!(confirmed.json["stage"], "engaged");
    assert_eq!(notifications_of(&app, man, "stage_confirmed").await, 2);
    let (event, data) = system_events(&app, &pair).await.pop().unwrap();
    assert_eq!(event, "stage_confirmed");
    assert_eq!(data["stage"], "engaged");
    assert_eq!(data["actor_profile_id"], json!(woman.profile_id));
    let back = propose(&app, &pair, man, "families_talking").await;
    assert_eq!(back.code(), "invalid_state");
    assert_eq!(back.json["error"]["details"]["status"], "engaged");
    // `engaged` changes nothing else: both profiles stay active.
    let status = text(
        &app,
        "SELECT status FROM profiles WHERE id = $1",
        man.profile_id,
    )
    .await;
    assert_eq!(status.as_deref(), Some("active"));
}

/// T-404: confirming `nikah_done` closes both profiles, with every effect of 11 section 9.4.
#[sqlx::test]
async fn confirming_nikah_done_closes_both_profiles(db: PgPool) {
    let app = TestApp::new(db).await;
    let pair = pair(&app).await;
    let (man, woman) = (pair.man.clone(), pair.woman.clone());
    // His other conversation, his pending sent interest, her pending received interest.
    let other_woman = app.member_of(Gender::Female).await;
    let other = connect_through_api(&app, man.clone(), other_woman.clone()).await;
    let third_woman = app.member_of(Gender::Female).await;
    let sent = interest(&app, man.profile_id, third_woman.profile_id, "pending", 0).await;
    let other_man = app.member().await;
    let received = interest(&app, other_man.profile_id, woman.profile_id, "pending", 0).await;
    exec(
        &app,
        "INSERT INTO match_recommendations (profile_id, candidate_profile_id, compat, rank_score)
         SELECT $1, p.id, 70, 1 FROM profiles p WHERE p.gender = 'female'",
        man.profile_id,
    )
    .await;

    let proposed = propose(&app, &pair, &woman, "nikah_done").await;
    assert_eq!(proposed.status, StatusCode::OK, "{}", proposed.text);
    let confirmed = answer(&app, &pair, &man, &proposed, "confirm").await;
    assert_eq!(confirmed.status, StatusCode::OK, "{}", confirmed.text);
    assert_eq!(confirmed.json["stage"], "nikah_done");
    assert_eq!(
        confirmed.json["status"], "active",
        "the couple keep their chat"
    );

    for user in [&man, &woman] {
        let (status, reason): (String, Option<String>) = sqlx::query_as(
            "SELECT status, closed_reason FROM profiles WHERE id = $1 AND closed_at IS NOT NULL",
        )
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(status, "closed");
        assert_eq!(reason.as_deref(), Some("found_match_here"));
    }
    for id in [sent, received] {
        let status = text(&app, "SELECT status FROM interests WHERE id = $1", id).await;
        assert_eq!(status.as_deref(), Some("expired"));
    }
    let (status, reason, by): (String, Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT status, ended_reason, ended_by_profile_id FROM connections WHERE id = $1",
    )
    .bind(other.id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(status, "ended");
    assert_eq!(reason.as_deref(), Some("found_someone_else"));
    assert_eq!(by, Some(man.profile_id));
    let hers = app.get(&other.path(""), Some(&other_woman.token)).await;
    assert_eq!(hers.json["ended_by"], "them");
    assert_eq!(hers.json["ended_reason"], Value::Null);
    assert_eq!(
        scalar(
            &app,
            "SELECT count(*) FROM match_recommendations WHERE profile_id = $1",
            man.profile_id
        )
        .await,
        0
    );
    assert_eq!(notifications_of(&app, &woman, "stage_confirmed").await, 1);

    // The chat is read-only now: closed profiles read but cannot send.
    let readable = app.get(&pair.path("/messages"), Some(&man.token)).await;
    assert_eq!(readable.status, StatusCode::OK);
    assert_eq!(
        say(&app, &pair, &woman, "Alhamdulillah").await.code(),
        "profile_not_active"
    );
    let me = app.get("/v1/me", Some(&man.token)).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.json["gate"], "ok");
}
