//! Tests of shortlist, pass and block (T-306): every effect of a block, and that afterwards
//! neither member appears in any list of the other (03 section 8 rule 3).

use std::collections::HashSet;

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::test_support::{TestApp, TestUser};
use crate::views::testing::{
    add_photo, candidates, connect, exec, ids, interest, set_privacy, set_profile,
};

fn path(prefix: &str, user: &TestUser) -> String {
    format!("/v1/{prefix}/{}", user.profile_id)
}

async fn count(app: &TestApp, sql: &str, a: Uuid, b: Uuid) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .bind(a)
        .bind(b)
        .fetch_one(app.db())
        .await
        .unwrap()
}

#[sqlx::test]
async fn shortlist_entries_are_added_listed_limited_and_removed(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;

    let added = app
        .put(
            &path("shortlist", &woman),
            Some(&man.token),
            json!({ "note": "Ask parents" }),
        )
        .await;
    assert_eq!(added.status, StatusCode::NO_CONTENT, "{}", added.text);
    let updated = app
        .put(
            &path("shortlist", &woman),
            Some(&man.token),
            json!({ "note": "Call on Friday" }),
        )
        .await;
    assert_eq!(updated.status, StatusCode::NO_CONTENT);
    let list = app.get("/v1/shortlist", Some(&man.token)).await;
    assert_eq!(list.status, StatusCode::OK, "{}", list.text);
    assert_eq!(list.json["items"].as_array().unwrap().len(), 1);
    let item = &list.json["items"][0];
    assert_eq!(item["profile_id"], json!(woman.profile_id));
    assert_eq!(item["note"], "Call on Friday");
    assert_eq!(item["profile"]["relation"]["is_shortlisted"], true);
    let detail = app.get(&path("profiles", &woman), Some(&man.token)).await;
    assert_eq!(detail.json["relation"]["shortlist_note"], "Call on Friday");

    let long = app
        .put(
            &path("shortlist", &woman),
            Some(&man.token),
            json!({ "note": "a".repeat(301) }),
        )
        .await;
    assert_eq!(long.field_errors(), ["note:too_long"]);
    let same_gender = app.member().await;
    let refused = app
        .put(
            &path("shortlist", &same_gender),
            Some(&man.token),
            json!({}),
        )
        .await;
    assert_eq!(refused.status, StatusCode::NOT_FOUND);
    let hidden = app.member_of(Gender::Female).await;
    set_privacy(&app, hidden.profile_id, "discovery_visibility = 'hidden'").await;
    let refused = app
        .put(&path("shortlist", &hidden), Some(&man.token), json!({}))
        .await;
    assert_eq!(refused.status, StatusCode::NOT_FOUND);

    // A profile that is no longer visible stays listed with `profile: null` and can be removed.
    exec(
        &app,
        "UPDATE users SET status = 'suspended' WHERE id = (SELECT user_id FROM profiles WHERE id = $1)",
        woman.profile_id,
    )
    .await;
    let list = app.get("/v1/shortlist", Some(&man.token)).await;
    assert_eq!(list.json["items"][0]["profile"], Value::Null);
    let removed = app
        .delete(&path("shortlist", &woman), Some(&man.token))
        .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
    let list = app.get("/v1/shortlist", Some(&man.token)).await;
    assert_eq!(list.json["items"], json!([]));

    // At most 200 entries.
    let others = candidates(&app, Gender::Female, 201, |_, _| {}).await;
    exec(
        &app,
        "INSERT INTO shortlists (profile_id, target_profile_id)
         SELECT $1, p.id FROM profiles p
         WHERE p.gender = 'female' AND p.id IN (SELECT unnest(ARRAY(
             SELECT id FROM profiles WHERE gender = 'female' AND status = 'active'
             ORDER BY id LIMIT 200)))",
        man.profile_id,
    )
    .await;
    let listed: HashSet<Uuid> =
        sqlx::query_scalar("SELECT target_profile_id FROM shortlists WHERE profile_id = $1")
            .bind(man.profile_id)
            .fetch_all(app.db())
            .await
            .unwrap()
            .into_iter()
            .collect();
    assert_eq!(listed.len(), 200);
    let outside = others
        .iter()
        .find(|id| !listed.contains(id))
        .copied()
        .unwrap();
    let full = app
        .put(
            &format!("/v1/shortlist/{outside}"),
            Some(&man.token),
            json!({}),
        )
        .await;
    assert_eq!(full.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(full.json["error"]["details"]["limit"], "shortlist_max");
    let existing = listed.iter().next().unwrap();
    let note = app
        .put(
            &format!("/v1/shortlist/{existing}"),
            Some(&man.token),
            json!({ "note": "Still allowed" }),
        )
        .await;
    assert_eq!(
        note.status,
        StatusCode::NO_CONTENT,
        "updating a note is not a new entry"
    );

    // Pages do not repeat entries.
    let first = app.get("/v1/shortlist?limit=50", Some(&man.token)).await;
    let cursor = first.json["next_cursor"].as_str().unwrap();
    let second = app
        .get(
            &format!("/v1/shortlist?limit=50&cursor={cursor}"),
            Some(&man.token),
        )
        .await;
    let a: HashSet<Value> = first.json["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["profile_id"].clone())
        .collect();
    let b: HashSet<Value> = second.json["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["profile_id"].clone())
        .collect();
    assert_eq!(a.len(), 50);
    assert!(a.is_disjoint(&b));
}

#[sqlx::test]
async fn a_pass_hides_the_profile_and_removes_its_shortlist_entry(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let other = app.member_of(Gender::Female).await;
    let before = app.get("/v1/recommendations", Some(&man.token)).await;
    assert_eq!(ids(&before.json["items"]).len(), 2);
    app.put(&path("shortlist", &woman), Some(&man.token), json!({}))
        .await;

    let passed = app
        .put(&path("passes", &woman), Some(&man.token), json!(null))
        .await;
    assert_eq!(passed.status, StatusCode::NO_CONTENT, "{}", passed.text);
    let days: f64 = sqlx::query_scalar(
        "SELECT (extract(epoch FROM expires_at - now()) / 86400)::float8 FROM passes
         WHERE profile_id = $1 AND target_profile_id = $2",
    )
    .bind(man.profile_id)
    .bind(woman.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!((179.9..180.1).contains(&days), "{days}");
    assert_eq!(
        count(
            &app,
            "SELECT (SELECT count(*) FROM shortlists WHERE profile_id = $1 AND target_profile_id = $2)
                  + (SELECT count(*) FROM match_recommendations WHERE profile_id = $1 AND candidate_profile_id = $2)",
            man.profile_id,
            woman.profile_id,
        )
        .await,
        0
    );
    let after = app.get("/v1/recommendations", Some(&man.token)).await;
    assert_eq!(ids(&after.json["items"]), [other.profile_id]);
    let search = app
        .post("/v1/search", Some(&man.token), json!({ "sort": "newest" }))
        .await;
    assert_eq!(ids(&search.json["items"]), [other.profile_id]);
    // She can still be opened, and knows nothing.
    let opened = app.get(&path("profiles", &woman), Some(&man.token)).await;
    assert_eq!(opened.json["relation"]["is_passed"], true);
    let her_view = app.get(&path("profiles", &man), Some(&woman.token)).await;
    assert_eq!(her_view.status, StatusCode::OK);
    assert!(!her_view.text.contains("is_passed\":true"));

    let undone = app.delete(&path("passes", &woman), Some(&man.token)).await;
    assert_eq!(undone.status, StatusCode::NO_CONTENT);
    let again = app.get("/v1/recommendations", Some(&man.token)).await;
    let shown: HashSet<Uuid> = ids(&again.json["items"]).into_iter().collect();
    assert_eq!(shown, HashSet::from([woman.profile_id, other.profile_id]));
}

#[sqlx::test]
async fn a_block_ends_everything_between_the_two_in_one_go(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    add_photo(&app, woman.profile_id).await;
    let connection = connect(&app, man.profile_id, woman.profile_id).await;
    exec(
        &app,
        "INSERT INTO contact_shares (connection_id, sharer_profile_id, share_phone)
         SELECT $1, profile_low_id, true FROM connections WHERE id = $1",
        connection,
    )
    .await;
    sqlx::query(
        "INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status)
         VALUES ($1, $2, 'granted'), ($2, $1, 'pending')",
    )
    .bind(woman.profile_id)
    .bind(man.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO shortlists (profile_id, target_profile_id) VALUES ($1, $2), ($2, $1);
         ",
    )
    .bind(man.profile_id)
    .bind(woman.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO match_recommendations (profile_id, candidate_profile_id, compat, rank_score)
         VALUES ($1, $2, 80, 0.5), ($2, $1, 80, 0.5)",
    )
    .bind(man.profile_id)
    .bind(woman.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO notifications (user_id, type, actor_profile_id, data)
         SELECT u, 'interest_accepted', a, '{}' FROM (VALUES
             ((SELECT user_id FROM profiles WHERE id = $1), $2::uuid),
             ((SELECT user_id FROM profiles WHERE id = $2), $1::uuid),
             ((SELECT user_id FROM profiles WHERE id = $1), NULL::uuid)) AS t(u, a)",
    )
    .bind(man.profile_id)
    .bind(woman.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    // She looked at his profile while they were connected; then connect visits count.
    exec(
        &app,
        "INSERT INTO profile_views (viewer_profile_id, viewed_profile_id, viewed_on)
         SELECT id, $1, current_date FROM profiles WHERE gender = 'female'",
        man.profile_id,
    )
    .await;

    let blocked = app
        .put(&path("blocks", &woman), Some(&man.token), json!(null))
        .await;
    assert_eq!(blocked.status, StatusCode::NO_CONTENT, "{}", blocked.text);

    let (status, reason, ended_by): (String, String, Uuid) = sqlx::query_as(
        "SELECT status, ended_reason, ended_by_profile_id FROM connections WHERE id = $1",
    )
    .bind(connection)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(
        (status.as_str(), reason.as_str(), ended_by),
        ("ended", "blocked", man.profile_id)
    );
    let system: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM messages WHERE connection_id = $1 AND system_event = 'connection_ended'",
    )
    .bind(connection)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(system, 1);
    let share: String =
        sqlx::query_scalar("SELECT status FROM contact_shares WHERE connection_id = $1")
            .bind(connection)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(share, "revoked");
    let access: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT owner_profile_id, status FROM photo_access ORDER BY owner_profile_id = $1 DESC",
    )
    .bind(woman.profile_id)
    .fetch_all(app.db())
    .await
    .unwrap();
    assert_eq!(
        access,
        [
            (woman.profile_id, "revoked".to_owned()),
            (man.profile_id, "denied".to_owned())
        ]
    );
    let (m, w) = (man.profile_id, woman.profile_id);
    for table in [
        "SELECT count(*) FROM shortlists WHERE (profile_id = $1 AND target_profile_id = $2) OR (profile_id = $2 AND target_profile_id = $1)",
        "SELECT count(*) FROM match_recommendations WHERE (profile_id = $1 AND candidate_profile_id = $2) OR (profile_id = $2 AND candidate_profile_id = $1)",
        "SELECT count(*) FROM notifications WHERE actor_profile_id IN ($1, $2)",
    ] {
        assert_eq!(count(&app, table, m, w).await, 0, "{table}");
    }
    assert_eq!(
        count(
            &app,
            "SELECT count(*) FROM notifications WHERE actor_profile_id IS NULL AND user_id = (SELECT user_id FROM profiles WHERE id = $1) AND $2 IS NOT NULL",
            m,
            w
        )
        .await,
        1,
        "unrelated notifications stay"
    );

    // Neither appears anywhere for the other.
    for (viewer, other) in [(&man, &woman), (&woman, &man)] {
        let opened = app.get(&path("profiles", other), Some(&viewer.token)).await;
        assert_eq!(opened.status, StatusCode::NOT_FOUND);
        let recommendations = app.get("/v1/recommendations", Some(&viewer.token)).await;
        assert!(!ids(&recommendations.json["items"]).contains(&other.profile_id));
        let search = app
            .post(
                "/v1/search",
                Some(&viewer.token),
                json!({ "sort": "newest" }),
            )
            .await;
        assert!(!ids(&search.json["items"]).contains(&other.profile_id));
        let home = app.get("/v1/home", Some(&viewer.token)).await;
        assert!(
            !home.text.contains(&other.profile_id.to_string()),
            "home mentions the other"
        );
        let visitors = app.get("/v1/me/visitors", Some(&viewer.token)).await;
        assert!(!ids(&visitors.json["items"]).contains(&other.profile_id));
        let shortlist = app
            .put(&path("shortlist", other), Some(&viewer.token), json!({}))
            .await;
        assert_eq!(shortlist.status, StatusCode::NOT_FOUND);
    }

    let list = app.get("/v1/blocks", Some(&man.token)).await;
    assert_eq!(list.status, StatusCode::OK, "{}", list.text);
    let item = &list.json["items"][0];
    assert_eq!(item["profile_id"], json!(woman.profile_id));
    assert_eq!(item["display_name"], "Ayesha M.", "always at tier member");
    assert!(item["public_code"].as_str().unwrap().starts_with("KR"));
    assert_eq!(
        item.as_object().unwrap().len(),
        4,
        "no photo, no other data"
    );
    let theirs = app.get("/v1/blocks", Some(&woman.token)).await;
    assert_eq!(
        theirs.json["items"],
        json!([]),
        "the other side is not told"
    );

    // Blocking again changes nothing.
    let again = app
        .put(&path("blocks", &woman), Some(&man.token), json!(null))
        .await;
    assert_eq!(again.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn a_block_closes_pending_interests_in_both_directions(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let sent_to = app.member_of(Gender::Female).await;
    let received_from = app.member_of(Gender::Female).await;
    let sent = interest(&app, man.profile_id, sent_to.profile_id, "pending", 0).await;
    let received = interest(&app, received_from.profile_id, man.profile_id, "pending", 0).await;

    for target in [&sent_to, &received_from] {
        let response = app
            .put(&path("blocks", target), Some(&man.token), json!(null))
            .await;
        assert_eq!(response.status, StatusCode::NO_CONTENT);
    }
    let statuses: Vec<(Uuid, String, bool)> =
        sqlx::query_as("SELECT id, status, responded_at IS NOT NULL FROM interests ORDER BY id")
            .fetch_all(app.db())
            .await
            .unwrap();
    let mut expected = vec![
        (sent, "withdrawn".to_owned(), true),
        (received, "declined".to_owned(), true),
    ];
    expected.sort();
    assert_eq!(statuses, expected);

    let list = app.get("/v1/blocks", Some(&man.token)).await;
    assert_eq!(
        ids(&list.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| json!({ "id": i["profile_id"] }))
            .collect::<Value>()),
        [received_from.profile_id, sent_to.profile_id],
        "newest first"
    );
}

#[sqlx::test]
async fn blocks_need_an_existing_profile_of_the_other_gender(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let other_man = app.member().await;
    for target in [other_man.profile_id, man.profile_id, Uuid::now_v7()] {
        let response = app
            .put(
                &format!("/v1/blocks/{target}"),
                Some(&man.token),
                json!(null),
            )
            .await;
        assert_eq!(response.status, StatusCode::NOT_FOUND);
    }
}

#[sqlx::test]
async fn unblocking_removes_only_the_block(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let connection = connect(&app, man.profile_id, woman.profile_id).await;
    app.put(&path("blocks", &woman), Some(&man.token), json!(null))
        .await;
    set_profile(&app, man.profile_id, "match_stale = false").await;

    let removed = app.delete(&path("blocks", &woman), Some(&man.token)).await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
    let (blocks, status, stale): (i64, String, bool) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM blocks),
                (SELECT status FROM connections WHERE id = $1),
                (SELECT match_stale FROM profiles WHERE id = $2)",
    )
    .bind(connection)
    .bind(man.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!((blocks, status.as_str(), stale), (0, "ended", true));
    let opened = app.get(&path("profiles", &woman), Some(&man.token)).await;
    assert_eq!(opened.status, StatusCode::OK);
    assert_eq!(opened.json["relation"]["tier"], "member");
    assert_eq!(opened.json["relation"]["cannot_send_reason"], "cooldown");
}

#[sqlx::test]
async fn paused_members_may_block_but_not_shortlist_or_pass(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    set_profile(&app, man.profile_id, "status = 'paused'").await;
    app.state.accounts.invalidate(man.user_id);

    for (method, prefix) in [
        ("PUT", "shortlist"),
        ("PUT", "passes"),
        ("GET", "shortlist"),
    ] {
        let path = if method == "GET" {
            "/v1/shortlist".to_owned()
        } else {
            path(prefix, &woman)
        };
        let response = app
            .request(method, &path, Some(&man.token), Some(json!({})))
            .await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{method} {path}");
        assert_eq!(response.code(), "profile_not_active");
    }
    let blocked = app
        .put(&path("blocks", &woman), Some(&man.token), json!(null))
        .await;
    assert_eq!(blocked.status, StatusCode::NO_CONTENT);
    let list = app.get("/v1/blocks", Some(&man.token)).await;
    assert_eq!(list.status, StatusCode::OK);
    let draft = app.draft_user().await;
    let refused = app
        .put(&path("blocks", &woman), Some(&draft.token), json!(null))
        .await;
    assert_eq!(refused.code(), "onboarding_required");
}
