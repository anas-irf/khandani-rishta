//! Tests of the discovery routes: profiles (T-303), recommendations and home (T-304), search
//! and saved searches (T-305), and the invariants of 03 section 8 that discovery owns.

use std::collections::HashSet;
use std::time::{Duration as StdDuration, Instant};

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::options::{
    ChildrenStatus, EmploymentType, FamilyType, FamilyValues, FieldVisibility, Gender, Hijab,
    LivingArrangement, ManagedBy, MaritalStatus, Religiosity, Smoking, WorkAfterMarriage,
};
use crate::domain::types::ProfileStatus;
use crate::jobs::refresh_recommendations::{Refreshed, refresh};
use crate::jobs::{NewJob, enqueue};
use crate::seed::FakeFamily;
use crate::test_support::{TestApp, TestUser};
use crate::views::testing::{
    add_photo, block_row, candidates, connect, exec, ids, interest, set_prefs, set_privacy,
    set_profile,
};

const LAHORE: i32 = 1_172_451;
const PUNJAB: i32 = 1_167_710;

fn profile_path(user: &TestUser) -> String {
    format!("/v1/profiles/{}", user.profile_id)
}

fn locked(detail: &Value) -> Vec<String> {
    detail["locked"]
        .as_array()
        .unwrap()
        .iter()
        .map(|group| group.as_str().unwrap().to_owned())
        .collect()
}

async fn view_rows(app: &TestApp, viewer: Uuid) -> Vec<(Uuid, i32, bool)> {
    sqlx::query_as(
        "SELECT viewed_profile_id, view_count, is_private FROM profile_views
         WHERE viewer_profile_id = $1 ORDER BY viewed_profile_id",
    )
    .bind(viewer)
    .fetch_all(app.db())
    .await
    .unwrap()
}

// -------------------------------------------------------------------------------------------
// T-303: other members' profiles
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn opening_a_profile_returns_the_reduced_detail(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;

    let response = app.get(&profile_path(&woman), Some(&man.token)).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    let detail = &response.json;
    assert_eq!(detail["card"]["display_name"], "Ayesha M.");
    assert_eq!(detail["card"]["gender"], "female");
    assert_eq!(detail["card"]["age"], 28);
    assert_eq!(detail["relation"]["tier"], "member");
    assert_eq!(detail["relation"]["can_send_interest"], true);
    assert_eq!(detail["relation"]["cannot_send_reason"], Value::Null);
    assert_eq!(detail["relation"]["photo_access"], "visible");
    assert_eq!(detail["card"]["photo"], Value::Null);
    assert_eq!(detail["photos"], json!([]));
    assert!(detail["card"]["compat"].is_number());
    assert!(detail["compatibility"]["compat"].is_number());
    assert_eq!(locked(detail), ["full_name"]);
    // Never sent to other members (09 section 5.3).
    let text = response.text.as_str();
    for secret in [
        "date_of_birth",
        "first_name",
        "last_name",
        "Malik",
        "completeness",
    ] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    // Every optional field is present.
    assert!(detail["family"].is_null());
    assert!(detail["about_me"].is_null());
    assert!(detail["education_career"]["income_band_code"].is_null());

    // The view was recorded once and counted.
    assert_eq!(
        view_rows(&app, man.profile_id).await,
        [(woman.profile_id, 1, false)]
    );
}

#[sqlx::test]
async fn same_gender_blocked_hidden_and_unavailable_profiles_are_not_found(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let other_man = app.member().await;
    let not_found = |response: &crate::test_support::TestResponse| {
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{}", response.text);
        assert_eq!(response.code(), "not_found");
    };

    not_found(&app.get(&profile_path(&other_man), Some(&man.token)).await);
    not_found(&app.get(&profile_path(&man), Some(&man.token)).await);
    not_found(
        &app.get(
            &format!("/v1/profiles/{}", Uuid::now_v7()),
            Some(&man.token),
        )
        .await,
    );
    not_found(&app.get("/v1/profiles/not-a-uuid", Some(&man.token)).await);

    // Blocks in either direction (03 section 8 rule 3).
    let blocked_by_her = app.member_of(Gender::Female).await;
    block_row(&app, blocked_by_her.profile_id, man.profile_id).await;
    not_found(
        &app.get(&profile_path(&blocked_by_her), Some(&man.token))
            .await,
    );
    not_found(
        &app.get(&profile_path(&man), Some(&blocked_by_her.token))
            .await,
    );
    let blocked_by_him = app.member_of(Gender::Female).await;
    block_row(&app, man.profile_id, blocked_by_him.profile_id).await;
    not_found(
        &app.get(&profile_path(&blocked_by_him), Some(&man.token))
            .await,
    );

    // Hidden: only relation paths open it (09 section 2.2 rows 6 and 10).
    let hidden = app.member_of(Gender::Female).await;
    set_privacy(&app, hidden.profile_id, "discovery_visibility = 'hidden'").await;
    not_found(&app.get(&profile_path(&hidden), Some(&man.token)).await);
    interest(&app, hidden.profile_id, man.profile_id, "pending", 0).await;
    let opened = app.get(&profile_path(&hidden), Some(&man.token)).await;
    assert_eq!(opened.status, StatusCode::OK);
    assert_eq!(opened.json["relation"]["tier"], "interest_from_owner");
    assert_eq!(opened.json["relation"]["interest"]["direction"], "received");

    // Suspended account, paused profile without relation, pending review.
    let suspended = app.member_of(Gender::Female).await;
    exec(&app, "UPDATE users SET status = 'suspended' WHERE id = (SELECT user_id FROM profiles WHERE id = $1)", suspended.profile_id).await;
    not_found(&app.get(&profile_path(&suspended), Some(&man.token)).await);
    let paused = app.member_of(Gender::Female).await;
    set_profile(&app, paused.profile_id, "status = 'paused'").await;
    not_found(&app.get(&profile_path(&paused), Some(&man.token)).await);
    let reviewing = app
        .member_with(|spec| {
            spec.gender = Gender::Female;
            spec.status = ProfileStatus::PendingReview;
        })
        .await;
    not_found(&app.get(&profile_path(&reviewing), Some(&man.token)).await);

    // `preference_match`: a viewer failing a must-have cannot open it.
    let choosy = app.member_of(Gender::Female).await;
    set_privacy(
        &app,
        choosy.profile_id,
        "discovery_visibility = 'preference_match'",
    )
    .await;
    set_prefs(
        &app,
        choosy.profile_id,
        "religion_codes = '{christianity}', religion_importance = 'must'",
    )
    .await;
    not_found(&app.get(&profile_path(&choosy), Some(&man.token)).await);
    set_prefs(&app, choosy.profile_id, "religion_codes = '{islam}'").await;
    assert_eq!(
        app.get(&profile_path(&choosy), Some(&man.token))
            .await
            .status,
        StatusCode::OK
    );

    // Nothing that was refused was recorded as a view.
    let rows = view_rows(&app, man.profile_id).await;
    assert_eq!(rows.len(), 2, "only the two opened profiles: {rows:?}");
}

#[sqlx::test]
async fn locked_groups_are_null_and_listed_until_connected(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    set_profile(
        &app,
        woman.profile_id,
        "caste_code = 'rajput', income_band_code = 'pkr_3', job_title = 'Engineer',
         area = 'Gulberg', blood_group = 'a_pos'",
    )
    .await;
    exec(
        &app,
        "INSERT INTO profile_family (profile_id, family_type, family_values, home_type)
         VALUES ($1, 'joint', 'moderate', 'house')",
        woman.profile_id,
    )
    .await;
    set_privacy(
        &app,
        woman.profile_id,
        "caste_visibility = 'connections', family_visibility = 'connections',
         home_visibility = 'connections', health_visibility = 'nobody'",
    )
    .await;

    let member = app.get(&profile_path(&woman), Some(&man.token)).await;
    assert_eq!(member.status, StatusCode::OK, "{}", member.text);
    let detail = &member.json;
    assert!(detail["card"]["caste_label"].is_null());
    assert!(detail["community"]["caste_label"].is_null());
    assert!(detail["education_career"]["income_band_code"].is_null());
    assert!(detail["education_career"]["job_title"].is_null());
    assert!(detail["location"]["area"].is_null());
    assert!(detail["lifestyle"]["blood_group"].is_null());
    assert!(detail["family"].is_null(), "family and home both hidden");
    assert_eq!(
        locked(detail),
        [
            "full_name",
            "caste",
            "income",
            "family",
            "career_details",
            "home",
            "area"
        ],
        "health is `nobody`, so never listed"
    );
    // Hidden values do not leak through the matching numbers either.
    assert!(!member.text.contains("Rajput") && !member.text.contains("pkr_3"));

    connect(&app, man.profile_id, woman.profile_id).await;
    let connected = app.get(&profile_path(&woman), Some(&man.token)).await;
    let detail = &connected.json;
    assert_eq!(detail["relation"]["tier"], "connection");
    assert_eq!(detail["card"]["display_name"], "Ayesha Malik");
    assert_eq!(detail["community"]["caste_label"], "Rajput");
    assert_eq!(detail["education_career"]["income_band_code"], "pkr_3");
    assert_eq!(detail["education_career"]["job_title"], "Engineer");
    assert_eq!(detail["location"]["area"], "Gulberg");
    assert_eq!(detail["family"]["family_type"], "joint");
    assert_eq!(detail["family"]["home_type"], "house");
    assert!(
        detail["lifestyle"]["blood_group"].is_null(),
        "`nobody` stays hidden"
    );
    assert_eq!(locked(detail), Vec::<String>::new());
    assert_eq!(
        detail["relation"]["cannot_send_reason"],
        "already_connected"
    );

    // Connections are not recorded as views (09 section 8.1 step 1).
    assert_eq!(view_rows(&app, man.profile_id).await.len(), 1);
}

#[sqlx::test]
async fn photos_are_blurred_unless_the_owner_admits_the_viewer(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    add_photo(&app, woman.profile_id).await;
    set_privacy(
        &app,
        woman.profile_id,
        "photo_visibility = 'interests_and_connections'",
    )
    .await;

    let blurred = app.get(&profile_path(&woman), Some(&man.token)).await;
    assert_eq!(blurred.status, StatusCode::OK, "{}", blurred.text);
    let detail = &blurred.json;
    let photo = &detail["photos"][0];
    assert_eq!(photo["is_blurred"], true);
    assert!(
        photo["thumb_url"]
            .as_str()
            .unwrap()
            .contains("blur_thumb.jpg")
    );
    assert!(
        photo["medium_url"]
            .as_str()
            .unwrap()
            .contains("blur_medium.jpg")
    );
    assert!(photo["large_url"].is_null());
    assert_eq!(detail["card"]["photo"], *photo);
    assert_eq!(detail["card"]["photo_count"], 1);
    assert!(locked(detail).contains(&"photos".to_owned()));
    assert_eq!(detail["relation"]["photo_access"], "can_request");
    for clear in ["/large.jpg", "/medium.jpg", "/thumb.jpg"] {
        assert!(
            !blurred.text.contains(clear),
            "a clear key was signed: {clear}"
        );
    }

    // The viewer's own interest does not unblur (09 section 6.1).
    interest(&app, man.profile_id, woman.profile_id, "pending", 0).await;
    let pending = app.get(&profile_path(&woman), Some(&man.token)).await;
    assert_eq!(pending.json["relation"]["tier"], "interest_to_owner");
    assert_eq!(pending.json["photos"][0]["is_blurred"], true);

    // A grant does.
    exec(
        &app,
        "INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status)
         SELECT $1, id, 'granted' FROM profiles WHERE id <> $1 AND gender = 'male'",
        woman.profile_id,
    )
    .await;
    let granted = app.get(&profile_path(&woman), Some(&man.token)).await;
    let photo = &granted.json["photos"][0];
    assert_eq!(photo["is_blurred"], false);
    assert!(photo["large_url"].as_str().unwrap().contains("/large.jpg"));
    assert!(!locked(&granted.json).contains(&"photos".to_owned()));

    // The owner's own interest unblurs for its receiver.
    let other = app.member().await;
    interest(&app, woman.profile_id, other.profile_id, "pending", 0).await;
    let received = app.get(&profile_path(&woman), Some(&other.token)).await;
    assert_eq!(received.json["relation"]["tier"], "interest_from_owner");
    assert_eq!(received.json["photos"][0]["is_blurred"], false);
}

#[sqlx::test]
async fn profile_views_are_recorded_once_and_limited_per_day(db: PgPool) {
    let app = TestApp::new(db).await;
    app.state
        .settings
        .put("limits.profile_views_per_day", &json!(1), None)
        .await
        .unwrap();
    let man = app.member().await;
    let first = app.member_of(Gender::Female).await;
    let second = app.member_of(Gender::Female).await;

    for _ in 0..2 {
        let response = app.get(&profile_path(&first), Some(&man.token)).await;
        assert_eq!(response.status, StatusCode::OK);
    }
    assert_eq!(
        view_rows(&app, man.profile_id).await,
        [(first.profile_id, 1, false)]
    );

    let limited = app.get(&profile_path(&second), Some(&man.token)).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.code(), "limit_reached");
    assert_eq!(
        limited.json["error"]["details"]["limit"],
        "limits.profile_views_per_day"
    );
    assert_eq!(limited.json["error"]["details"]["used"], 1);
    assert!(limited.json["error"]["details"]["resets_at"].is_string());
    assert!(
        limited.json["card"].is_null(),
        "no profile data with the refusal"
    );

    // A profile already viewed today still opens; a later visit counts again.
    exec(
        &app,
        "UPDATE profile_views SET last_viewed_at = now() - interval '31 minutes'
         WHERE viewer_profile_id = $1",
        man.profile_id,
    )
    .await;
    let again = app.get(&profile_path(&first), Some(&man.token)).await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(
        view_rows(&app, man.profile_id).await,
        [(first.profile_id, 2, false)]
    );
    let counter: i32 = sqlx::query_scalar(
        "SELECT count FROM usage_counters WHERE profile_id = $1 AND counter = 'profiles_viewed'",
    )
    .bind(man.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(counter, 1);
}

#[sqlx::test]
async fn visitors_and_visited_follow_private_browsing_and_blocks(db: PgPool) {
    let app = TestApp::new(db).await;
    let woman = app.member_of(Gender::Female).await;
    let first = app.member().await;
    let second = app.member().await;
    let private = app.member().await;
    set_privacy(&app, private.profile_id, "record_my_visits = false").await;
    for visitor in [&first, &second, &private] {
        let response = app.get(&profile_path(&woman), Some(&visitor.token)).await;
        assert_eq!(response.status, StatusCode::OK);
    }
    exec(
        &app,
        "UPDATE profile_views SET last_viewed_at = now() - interval '1 hour'
         WHERE viewer_profile_id = $1",
        first.profile_id,
    )
    .await;

    let visitors = app.get("/v1/me/visitors", Some(&woman.token)).await;
    assert_eq!(visitors.status, StatusCode::OK, "{}", visitors.text);
    assert_eq!(visitors.json["hidden_because_private"], false);
    assert_eq!(
        ids(&visitors.json["items"]),
        [second.profile_id, first.profile_id],
        "newest first, private visit left out"
    );
    assert_eq!(visitors.json["items"][0]["view_count"], 1);

    // Reciprocity: a member who browses privately sees no visitors.
    let hidden = app.get("/v1/me/visitors", Some(&private.token)).await;
    assert_eq!(
        hidden.json,
        json!({ "items": [], "next_cursor": null, "hidden_because_private": true })
    );
    let row: bool =
        sqlx::query_scalar("SELECT is_private FROM profile_views WHERE viewer_profile_id = $1")
            .bind(private.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(row);
    // Their own history still works.
    let visited = app.get("/v1/me/visited", Some(&private.token)).await;
    assert_eq!(ids(&visited.json["items"]), [woman.profile_id]);

    // A visitor who blocked her disappears from her list.
    block_row(&app, second.profile_id, woman.profile_id).await;
    let visitors = app.get("/v1/me/visitors?limit=1", Some(&woman.token)).await;
    assert_eq!(ids(&visitors.json["items"]), [first.profile_id]);
}

#[sqlx::test]
async fn profile_codes_resolve_under_the_same_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let code: String = sqlx::query_scalar("SELECT public_code FROM profiles WHERE id = $1")
        .bind(woman.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    let messy = format!(" {} ", code.to_lowercase());
    let response = app
        .get(
            &format!("/v1/profiles/by-code/{}", messy.replace(' ', "%20")),
            Some(&man.token),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    assert_eq!(response.json, json!({ "profile_id": woman.profile_id }));

    let other_man = app.member().await;
    let own_code: String = sqlx::query_scalar("SELECT public_code FROM profiles WHERE id = $1")
        .bind(other_man.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    let same_gender = app
        .get(
            &format!("/v1/profiles/by-code/{own_code}"),
            Some(&man.token),
        )
        .await;
    assert_eq!(same_gender.status, StatusCode::NOT_FOUND);
    block_row(&app, woman.profile_id, man.profile_id).await;
    let blocked = app
        .get(&format!("/v1/profiles/by-code/{code}"), Some(&man.token))
        .await;
    assert_eq!(blocked.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn the_preview_shows_the_member_and_connection_views(db: PgPool) {
    let app = TestApp::new(db).await;
    let woman = app.member_of(Gender::Female).await;
    add_photo(&app, woman.profile_id).await;
    set_profile(
        &app,
        woman.profile_id,
        "caste_code = 'arain', status = 'paused'",
    )
    .await;
    set_privacy(
        &app,
        woman.profile_id,
        "caste_visibility = 'connections', photo_visibility = 'connections',
         name_display = 'initials'",
    )
    .await;
    set_prefs(
        &app,
        woman.profile_id,
        "age_min = 27, age_max = 35, religion_codes = '{islam}'",
    )
    .await;

    let member = app.get("/v1/me/profile/preview", Some(&woman.token)).await;
    assert_eq!(member.status, StatusCode::OK, "{}", member.text);
    let detail = &member.json;
    assert_eq!(detail["card"]["display_name"], "A. M.");
    assert!(detail["card"]["caste_label"].is_null());
    assert_eq!(locked(detail), ["full_name", "photos", "caste"]);
    assert_eq!(detail["photos"][0]["is_blurred"], true);
    assert!(detail["card"]["compat"].is_null());
    assert_eq!(detail["card"]["reasons"], json!([]));
    assert!(detail["compatibility"].is_null());
    assert_eq!(detail["relation"]["tier"], "member");
    assert_eq!(detail["relation"]["interest"], Value::Null);
    assert_eq!(detail["relation"]["can_send_interest"], false);
    assert_eq!(detail["relation"]["cannot_send_reason"], Value::Null);
    let lines = detail["looking_for"]["lines"].as_array().unwrap();
    assert_eq!(lines[0]["dimension"], "age");
    assert_eq!(lines[0]["summary_values"], json!(["27", "35"]));
    assert!(lines.iter().all(|line| line["viewer_matches"].is_null()));
    assert_eq!(detail["looking_for"]["total"], 0);

    let connection = app
        .get("/v1/me/profile/preview?as=connection", Some(&woman.token))
        .await;
    let detail = &connection.json;
    assert_eq!(detail["relation"]["tier"], "connection");
    assert_eq!(detail["card"]["display_name"], "Ayesha Malik");
    assert_eq!(detail["card"]["caste_label"], "Arain");
    assert_eq!(detail["photos"][0]["is_blurred"], false);
    assert_eq!(locked(detail), Vec::<String>::new());

    let bad = app
        .get("/v1/me/profile/preview?as=stranger", Some(&woman.token))
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(view_rows(&app, woman.profile_id).await, []);

    // A draft without its basics cannot be shown yet.
    let draft = app.draft_user().await;
    let incomplete = app.get("/v1/me/profile/preview", Some(&draft.token)).await;
    assert_eq!(incomplete.status, StatusCode::CONFLICT);
    assert_eq!(incomplete.code(), "invalid_state");
}

#[sqlx::test]
async fn paused_viewers_open_relations_only_and_drafts_are_refused(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let connection = app.member_of(Gender::Female).await;
    let stranger = app.member_of(Gender::Female).await;
    connect(&app, man.profile_id, connection.profile_id).await;
    set_profile(&app, man.profile_id, "status = 'paused'").await;
    app.state.accounts.invalidate(man.user_id);

    assert_eq!(
        app.get(&profile_path(&connection), Some(&man.token))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        app.get(&profile_path(&stranger), Some(&man.token))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    for path in ["/v1/home", "/v1/recommendations", "/v1/me/visitors"] {
        let response = app.get(path, Some(&man.token)).await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(response.code(), "profile_not_active");
    }
    let search = app
        .post("/v1/search", Some(&man.token), json!({ "filters": {} }))
        .await;
    assert_eq!(search.code(), "profile_not_active");

    let draft = app.draft_user().await;
    let refused = app.get(&profile_path(&stranger), Some(&draft.token)).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "onboarding_required");
    let anonymous = app.get(&profile_path(&stranger), None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

// -------------------------------------------------------------------------------------------
// T-304: recommendations and home
// -------------------------------------------------------------------------------------------

#[sqlx::test]
async fn recommendations_exclude_failed_must_haves_and_report_hints(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    set_prefs(
        &app,
        man.profile_id,
        "religion_codes = '{islam}', religion_importance = 'must',
         sect_codes = '{sunni}', sect_importance = 'must'",
    )
    .await;
    let sunni = candidates(&app, Gender::Female, 5, |_, _| {}).await;
    let christian = candidates(&app, Gender::Female, 3, |_, p| {
        p.religion_code = "christianity".to_owned();
        p.sect_code = Some("catholic".to_owned());
    })
    .await;
    let shia = candidates(&app, Gender::Female, 4, |_, p| {
        p.sect_code = Some("shia".to_owned());
    })
    .await;
    // A man never appears to a man (03 section 8 rule 1).
    let men = candidates(&app, Gender::Male, 2, |_, _| {}).await;

    let response = app.get("/v1/recommendations", Some(&man.token)).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text);
    let page = &response.json;
    let shown: HashSet<Uuid> = ids(&page["items"]).into_iter().collect();
    assert_eq!(
        shown,
        sunni.iter().copied().collect(),
        "only candidates passing every must-have"
    );
    for excluded in christian.iter().chain(&shia).chain(&men) {
        assert!(!shown.contains(excluded));
    }
    assert_eq!(page["is_refreshing"], false);
    assert!(page["refreshed_at"].is_string());
    assert_eq!(page["pool_exhausted"], true, "5 eligible is under 10");
    assert_eq!(
        page["relaxation_hints"],
        json!([{ "dimension": "sect", "extra_profiles": 4 }])
    );
    assert!(page["items"][0]["compat"].is_number());
    assert_eq!(page["items"][0]["relation"]["tier"], "member");

    // Each returned candidate was counted as shown once, and a quick reload does not count.
    app.get("/v1/recommendations", Some(&man.token)).await;
    let shown_counts: Vec<i16> =
        sqlx::query_scalar("SELECT shown_count FROM match_recommendations WHERE profile_id = $1")
            .bind(man.profile_id)
            .fetch_all(app.db())
            .await
            .unwrap();
    assert_eq!(shown_counts, [1; 5]);
}

#[sqlx::test]
async fn married_candidates_appear_only_to_members_who_opted_in(db: PgPool) {
    let app = TestApp::new(db).await;
    let woman = app.member_of(Gender::Female).await;
    let married = candidates(&app, Gender::Male, 1, |_, p| {
        p.marital_status = MaritalStatus::Married;
    })
    .await[0];
    let single = candidates(&app, Gender::Male, 1, |_, _| {}).await[0];

    let before = app.get("/v1/recommendations", Some(&woman.token)).await;
    assert_eq!(ids(&before.json["items"]), [single]);
    let opened = app
        .get(&format!("/v1/profiles/{married}"), Some(&woman.token))
        .await;
    assert_eq!(opened.status, StatusCode::NOT_FOUND, "09 section 2.2 row 9");
    let search = app
        .post(
            "/v1/search",
            Some(&woman.token),
            json!({ "sort": "newest" }),
        )
        .await;
    assert_eq!(ids(&search.json["items"]), [single]);

    set_prefs(
        &app,
        woman.profile_id,
        "marital_statuses = '{never_married,married}'",
    )
    .await;
    set_profile(&app, woman.profile_id, "match_stale = true").await;
    let after = app.get("/v1/recommendations", Some(&woman.token)).await;
    let shown: HashSet<Uuid> = ids(&after.json["items"]).into_iter().collect();
    assert_eq!(shown, HashSet::from([married, single]));
    let opened = app
        .get(&format!("/v1/profiles/{married}"), Some(&woman.token))
        .await;
    assert_eq!(opened.status, StatusCode::OK);
}

#[sqlx::test]
async fn a_refresh_of_600_candidates_takes_under_two_seconds(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let pool = candidates(&app, Gender::Female, 600, |index, p| {
        p.city_id = Some(LAHORE);
        p.region_id = Some(PUNJAB);
        p.city_other = None;
        p.height_cm = 150 + i16::try_from(index % 25).unwrap();
        p.hobby_codes = vec!["reading".to_owned(), "cricket".to_owned()];
        p.last_active_at =
            OffsetDateTime::now_utc() - Duration::hours(i64::try_from(index).unwrap());
    })
    .await;
    assert_eq!(pool.len(), 600);

    let started = Instant::now();
    let outcome = refresh(&app.state, man.profile_id).await.unwrap();
    let elapsed = started.elapsed();
    assert!(
        elapsed < StdDuration::from_secs(2),
        "refresh took {elapsed:?}"
    );
    let Refreshed::Done {
        recommendations, ..
    } = outcome
    else {
        panic!("the refresh ran");
    };
    assert_eq!(recommendations.len(), 200, "matching.recommendations_size");
    let (rows, stale): (i64, bool) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM match_recommendations WHERE profile_id = $1),
                (SELECT match_stale FROM profiles WHERE id = $1)",
    )
    .bind(man.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(rows, 200);
    assert!(!stale);
}

#[sqlx::test]
async fn read_time_checks_drop_rows_that_became_ineligible(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let women = candidates(&app, Gender::Female, 4, |_, _| {}).await;
    let first = app.get("/v1/recommendations", Some(&man.token)).await;
    assert_eq!(ids(&first.json["items"]).len(), 4);

    // Changes made outside the refresh: a block, a pending interest, and a candidate who
    // now requires a religion the viewer does not have.
    block_row(&app, women[0], man.profile_id).await;
    interest(&app, women[1], man.profile_id, "pending", 0).await;
    exec(
        &app,
        "INSERT INTO partner_preferences (profile_id, religion_codes, religion_importance)
         VALUES ($1, '{christianity}', 'must')",
        women[2],
    )
    .await;
    let second = app.get("/v1/recommendations", Some(&man.token)).await;
    assert_eq!(ids(&second.json["items"]), [women[3]]);
    let cached: Vec<Uuid> = sqlx::query_scalar(
        "SELECT candidate_profile_id FROM match_recommendations WHERE profile_id = $1",
    )
    .bind(man.profile_id)
    .fetch_all(app.db())
    .await
    .unwrap();
    assert_eq!(
        cached,
        [women[3]],
        "dropped rows are deleted from the cache"
    );
}

#[sqlx::test]
async fn recommendations_paginate_by_rank_without_duplicates(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let women = candidates(&app, Gender::Female, 25, |index, p| {
        p.last_active_at =
            OffsetDateTime::now_utc() - Duration::hours(i64::try_from(index).unwrap() * 30);
    })
    .await;
    let mut seen = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let path = match &cursor {
            Some(cursor) => format!("/v1/recommendations?limit=10&cursor={cursor}"),
            None => "/v1/recommendations?limit=10".to_owned(),
        };
        let page = app.get(&path, Some(&man.token)).await;
        assert_eq!(page.status, StatusCode::OK, "{}", page.text);
        seen.extend(ids(&page.json["items"]));
        match page.json["next_cursor"].as_str() {
            Some(next) => cursor = Some(next.to_owned()),
            None => break,
        }
    }
    let unique: HashSet<Uuid> = seen.iter().copied().collect();
    assert_eq!(seen.len(), unique.len(), "no duplicates");
    assert_eq!(unique, women.into_iter().collect());
}

#[sqlx::test]
async fn manual_refresh_is_queued_and_limited_to_once_per_ten_minutes(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    set_profile(&app, man.profile_id, "match_stale = false").await;
    let first = app
        .post_empty("/v1/recommendations/refresh", Some(&man.token))
        .await;
    assert_eq!(first.status, StatusCode::ACCEPTED, "{}", first.text);
    let jobs = app.queued_jobs("refresh_recommendations").await;
    assert_eq!(
        jobs,
        [json!({ "profile_id": man.profile_id, "notify": false })]
    );
    let stale: bool = sqlx::query_scalar("SELECT match_stale FROM profiles WHERE id = $1")
        .bind(man.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert!(stale);

    let second = app
        .post_empty("/v1/recommendations/refresh", Some(&man.token))
        .await;
    assert_eq!(second.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(second.code(), "rate_limited");
    assert!(second.headers.contains_key("retry-after"));

    app.drain_jobs().await;
    let refreshed: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT match_refreshed_at FROM profiles WHERE id = $1")
            .bind(man.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(refreshed.is_some());
}

async fn new_matches(app: &TestApp, user: &TestUser) -> Vec<Value> {
    sqlx::query_scalar(
        "SELECT data FROM notifications WHERE user_id = $1 AND type = 'new_matches'
         ORDER BY created_at",
    )
    .bind(user.user_id)
    .fetch_all(app.db())
    .await
    .unwrap()
}

#[sqlx::test]
async fn the_nightly_refresh_notifies_new_matches_once_per_20_hours(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    candidates(&app, Gender::Female, 3, |_, _| {}).await;

    // The fanout enqueues one notifying refresh per recently active profile.
    enqueue(
        app.db(),
        NewJob::new("refresh_recommendations", json!({ "fanout": true })),
    )
    .await
    .unwrap();
    app.drain_jobs().await;
    assert_eq!(
        new_matches(&app, &man).await,
        [json!({ "source": "recommendations", "count": 3, "saved_search_id": null })]
    );

    // A fresh list is skipped by a notifying job.
    enqueue(
        app.db(),
        NewJob::new(
            "refresh_recommendations",
            json!({ "profile_id": man.profile_id, "notify": true }),
        ),
    )
    .await
    .unwrap();
    app.drain_jobs().await;
    let status: String = sqlx::query_scalar(
        "SELECT last_error FROM jobs WHERE kind = 'refresh_recommendations'
         ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(status, "skipped:fresh");

    // A new match within 20 hours of the last notification creates nothing.
    candidates(&app, Gender::Female, 1, |_, _| {}).await;
    set_profile(&app, man.profile_id, "match_stale = true").await;
    enqueue(
        app.db(),
        NewJob::new(
            "refresh_recommendations",
            json!({ "profile_id": man.profile_id, "notify": true }),
        ),
    )
    .await
    .unwrap();
    app.drain_jobs().await;
    assert_eq!(new_matches(&app, &man).await.len(), 1);
    let cached: i64 =
        sqlx::query_scalar("SELECT count(*) FROM match_recommendations WHERE profile_id = $1")
            .bind(man.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(cached, 4, "the refresh itself ran");
}

#[sqlx::test]
async fn home_assembles_every_list(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let city: i32 = sqlx::query_scalar("SELECT city_id FROM profiles WHERE id = $1")
        .bind(man.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    let now = OffsetDateTime::now_utc();
    candidates(&app, Gender::Female, 14, |index, p| {
        if index % 2 == 0 {
            p.city_id = Some(city);
            p.city_other = None;
        }
        p.first_activated_at = if index < 5 {
            now - Duration::days(2)
        } else {
            now - Duration::days(60)
        };
    })
    .await;
    let visitor = app.member_of(Gender::Female).await;
    app.get(&profile_path(&man), Some(&visitor.token)).await;
    interest(&app, visitor.profile_id, man.profile_id, "pending", 0).await;

    let home = app.get("/v1/home", Some(&man.token)).await;
    assert_eq!(home.status, StatusCode::OK, "{}", home.text);
    let json = &home.json;
    let recommendations = ids(&json["recommendations"]);
    let new_members = ids(&json["new_members"]);
    let nearby = ids(&json["nearby"]);
    assert_eq!(recommendations.len(), 10);
    let all: Vec<Uuid> = recommendations
        .iter()
        .chain(&new_members)
        .chain(&nearby)
        .copied()
        .collect();
    let unique: HashSet<Uuid> = all.iter().copied().collect();
    assert_eq!(all.len(), unique.len(), "no profile in two lists");
    for card in json["new_members"].as_array().unwrap() {
        assert!(card["badges"].as_array().unwrap().contains(&json!("new")));
    }
    let city_name = json["recommendations"][0]["city_name"].clone();
    for card in json["nearby"].as_array().unwrap() {
        assert!(
            card["city_name"] == city_name
                || card["region_name"] == json["recommendations"][0]["region_name"]
        );
    }
    assert!(
        !recommendations.contains(&visitor.profile_id),
        "a pending interest excludes her"
    );
    assert_eq!(ids(&json["recent_visitors"]), [visitor.profile_id]);
    assert_eq!(json["visitors_count_7d"], 1);
    assert_eq!(json["pending_interests"], 1);
    assert_eq!(json["completeness"], 60);
    assert_eq!(json["pool_exhausted"], false);
    assert_eq!(json["relaxation_hints"], json!([]));
    let nudges = json["nudges"].as_array().unwrap();
    assert_eq!(nudges.len(), 3);
    assert_eq!(nudges[0], json!({ "code": "add_photo", "priority": 100 }));
    assert_eq!(nudges[1]["code"], "verify_identity");
}

// -------------------------------------------------------------------------------------------
// T-305: search and saved searches
// -------------------------------------------------------------------------------------------

/// 23 women, each different from the plain profile in one way (see the match below).
async fn search_population(app: &TestApp) -> Vec<Uuid> {
    let now = OffsetDateTime::now_utc();
    let today = crate::domain::time::karachi_date(now);
    let women = candidates(app, Gender::Female, 23, |index, p| match index {
        1 => {
            p.date_of_birth =
                time::Date::from_calendar_date(today.year() - 35, today.month(), 1).unwrap();
        }
        2 => p.height_cm = 175,
        3 => {
            p.marital_status = MaritalStatus::Divorced;
            p.children_status = Some(ChildrenStatus::LivingWithMe);
            p.children_count = Some(2);
        }
        4 => {
            p.religion_code = "christianity".to_owned();
            p.sect_code = Some("catholic".to_owned());
        }
        5 => p.caste_code = Some("arain".to_owned()),
        6 => {
            p.caste_code = Some("arain".to_owned());
            p.privacy.caste_visibility = FieldVisibility::Connections;
        }
        7 => p.mother_tongue_code = "punjabi".to_owned(),
        8 => {
            p.city_id = Some(LAHORE);
            p.region_id = Some(PUNJAB);
            p.city_other = None;
        }
        9 => {
            p.country_code = "AE".to_owned();
            p.city_other = Some("Dubai".to_owned());
        }
        10 => p.education_level_code = "masters".to_owned(),
        11 => {
            p.employment_type = EmploymentType::GovernmentJob;
            p.profession_code = Some("doctor".to_owned());
        }
        12 => {
            p.income_band_code = Some("pkr_5".to_owned());
            p.privacy.income_visibility = FieldVisibility::Members;
        }
        13 => p.income_band_code = Some("pkr_6".to_owned()),
        14 => {
            p.religiosity = Some(Religiosity::VeryPractising);
            p.hijab = Some(Hijab::Niqab);
        }
        15 | 16 => {
            p.family = Some(FakeFamily {
                father_status: crate::domain::options::ParentStatus::Alive,
                mother_status: crate::domain::options::ParentStatus::Alive,
                brothers_count: 1,
                sisters_count: 1,
                family_type: FamilyType::Joint,
                family_class: crate::domain::options::FamilyClass::Middle,
                family_values: FamilyValues::Religious,
            });
            if index == 16 {
                p.privacy.family_visibility = FieldVisibility::Connections;
            }
        }
        17 => {
            p.living_arrangement = Some(LivingArrangement::Separate);
            p.work_after_marriage = Some(WorkAfterMarriage::No);
            p.smoking = Some(Smoking::Yes);
        }
        18 => p.managed_by = ManagedBy::Parent,
        20 => p.is_id_verified = true,
        21 => p.last_active_at = now - Duration::days(20),
        22 => p.first_activated_at = now - Duration::days(3),
        _ => {}
    })
    .await;
    add_photo(app, women[19]).await;
    women
}

#[sqlx::test]
async fn every_search_filter_is_exact(db: PgPool) {
    let app = TestApp::new(db).await;
    // Two identical viewers, so the table stays under 30 searches per minute each.
    let viewers = [app.member().await, app.member().await];
    let women = search_population(&app).await;
    let all: HashSet<usize> = (0..women.len()).collect();
    let only = |indexes: &[usize]| indexes.iter().copied().collect::<HashSet<usize>>();
    let except = |indexes: &[usize]| &all - &only(indexes);
    let cases: Vec<(Value, HashSet<usize>)> = vec![
        (json!({ "age_min": 33, "age_max": 36 }), only(&[1])),
        (json!({ "age_max": 30 }), except(&[1])),
        (json!({ "height_min_cm": 170 }), only(&[2])),
        (json!({ "height_max_cm": 165 }), except(&[2])),
        (json!({ "marital_statuses": ["divorced"] }), only(&[3])),
        (json!({ "children_acceptance": "none" }), except(&[3])),
        (
            json!({ "children_acceptance": "not_living_with_partner" }),
            except(&[3]),
        ),
        (json!({ "children_acceptance": "any" }), all.clone()),
        (json!({ "religion_codes": ["christianity"] }), only(&[4])),
        (json!({ "sect_codes": ["catholic"] }), only(&[4])),
        (json!({ "caste_codes": ["arain"] }), only(&[5])),
        (json!({ "mother_tongue_codes": ["punjabi"] }), only(&[7])),
        (json!({ "city_ids": [LAHORE] }), only(&[8])),
        (json!({ "region_ids": [PUNJAB] }), only(&[8])),
        (json!({ "country_codes": ["AE"] }), only(&[9])),
        (
            json!({ "country_codes": ["AE"], "city_ids": [LAHORE] }),
            only(&[8, 9]),
        ),
        (json!({ "education_min_rank": 6 }), only(&[10])),
        (
            json!({ "employment_types": ["government_job"] }),
            only(&[11]),
        ),
        (json!({ "profession_codes": ["doctor"] }), only(&[11])),
        (json!({ "income_min_rank": 4 }), only(&[12])),
        (
            json!({ "religiosity_levels": ["very_practising"] }),
            only(&[14]),
        ),
        (json!({ "hijab_types": ["niqab"] }), only(&[14])),
        (json!({ "beard_types": ["full"] }), all.clone()),
        (json!({ "family_values": ["religious"] }), only(&[15])),
        (json!({ "family_types": ["joint"] }), only(&[15])),
        (json!({ "living_arrangements": ["separate"] }), only(&[17])),
        (
            json!({ "work_after_marriage_options": ["no"] }),
            only(&[17]),
        ),
        (json!({ "smoking_options": ["yes"] }), only(&[17])),
        (json!({ "managed_by": ["parent"] }), only(&[18])),
        (json!({ "has_photo": true }), only(&[19])),
        (json!({ "verified_only": true }), only(&[20])),
        (json!({ "active_within_days": 7 }), except(&[21])),
        (json!({ "joined_within_days": 7 }), only(&[22])),
        (json!({ "religion_codes": [] }), all.clone()),
    ];
    for (case, (filters, expected)) in cases.into_iter().enumerate() {
        let response = app
            .post(
                "/v1/search",
                Some(&viewers[case % 2].token),
                json!({ "filters": filters, "sort": "newest", "limit": 50 }),
            )
            .await;
        assert_eq!(
            response.status,
            StatusCode::OK,
            "{filters}: {}",
            response.text
        );
        let found: HashSet<usize> = ids(&response.json["items"])
            .into_iter()
            .map(|id| women.iter().position(|w| *w == id).expect("a seeded woman"))
            .collect();
        assert_eq!(found, expected, "filter {filters}");
        assert_eq!(
            response.json["total_estimate"],
            json!(expected.len()),
            "filter {filters}"
        );
    }
}

#[sqlx::test]
async fn search_pages_never_skip_or_repeat_rows(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let now = OffsetDateTime::now_utc();
    let women = candidates(&app, Gender::Female, 30, |index, p| {
        let hours = i64::try_from(index).unwrap();
        p.first_activated_at = now - Duration::days(30) - Duration::hours(hours);
        p.last_active_at = now - Duration::hours(hours);
        if index % 2 == 1 {
            // Visible to search SQL, but the viewer fails her must-have (E8).
            p.privacy.discovery_visibility =
                crate::domain::options::DiscoveryVisibility::PreferenceMatch;
            let mut prefs = crate::domain::preference_defaults::default_preferences(
                &crate::domain::preference_defaults::DefaultsInput::default(),
            );
            prefs.religion_codes = vec!["christianity".to_owned()];
            p.preferences = Some(prefs);
        }
    })
    .await;
    let visible: HashSet<Uuid> = women.iter().step_by(2).copied().collect();

    for sort in ["newest", "recently_active", "best_match"] {
        let mut seen = Vec::new();
        let mut cursor = Value::Null;
        let mut pages = 0;
        loop {
            let response = app
                .post(
                    "/v1/search",
                    Some(&man.token),
                    json!({ "filters": {}, "sort": sort, "limit": 10, "cursor": cursor }),
                )
                .await;
            assert_eq!(response.status, StatusCode::OK, "{sort}: {}", response.text);
            pages += 1;
            let items = ids(&response.json["items"]);
            assert!(items.len() <= 10);
            seen.extend(items);
            cursor = response.json["next_cursor"].clone();
            if cursor.is_null() {
                break;
            }
            assert!(pages < 10, "{sort} does not end");
        }
        let unique: HashSet<Uuid> = seen.iter().copied().collect();
        assert_eq!(seen.len(), unique.len(), "{sort}: no duplicates");
        assert_eq!(unique, visible, "{sort}: every visible row exactly once");
    }

    // Newest first means the most recently activated first.
    let newest = app
        .post(
            "/v1/search",
            Some(&man.token),
            json!({ "filters": {}, "sort": "newest", "limit": 3 }),
        )
        .await;
    assert_eq!(ids(&newest.json["items"]), [women[0], women[2], women[4]]);

    // A cursor of another sort is refused.
    let cursor = newest.json["next_cursor"].clone();
    let mixed = app
        .post(
            "/v1/search",
            Some(&man.token),
            json!({ "filters": {}, "sort": "best_match", "cursor": cursor }),
        )
        .await;
    assert_eq!(mixed.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test]
async fn search_by_code_finds_passed_profiles_and_respects_blocks(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let passed = app.member_of(Gender::Female).await;
    let blocked = app.member_of(Gender::Female).await;
    exec(
        &app,
        "INSERT INTO passes (profile_id, target_profile_id, expires_at)
         SELECT $1, id, now() + interval '180 days' FROM profiles WHERE gender = 'female'",
        man.profile_id,
    )
    .await;
    block_row(&app, blocked.profile_id, man.profile_id).await;
    let code = |id: Uuid| {
        let db = app.db().clone();
        async move {
            sqlx::query_scalar::<_, String>("SELECT public_code FROM profiles WHERE id = $1")
                .bind(id)
                .fetch_one(&db)
                .await
                .unwrap()
        }
    };

    let normal = app
        .post("/v1/search", Some(&man.token), json!({ "sort": "newest" }))
        .await;
    assert_eq!(
        ids(&normal.json["items"]),
        Vec::<Uuid>::new(),
        "passes exclude both"
    );
    let by_code = app
        .post(
            "/v1/search",
            Some(&man.token),
            json!({ "filters": { "public_code": code(passed.profile_id).await.to_lowercase(), "age_min": 99 } }),
        )
        .await;
    assert_eq!(by_code.status, StatusCode::OK, "{}", by_code.text);
    assert_eq!(ids(&by_code.json["items"]), [passed.profile_id]);
    let blocked_code = app
        .post(
            "/v1/search",
            Some(&man.token),
            json!({ "filters": { "public_code": code(blocked.profile_id).await } }),
        )
        .await;
    assert_eq!(ids(&blocked_code.json["items"]), Vec::<Uuid>::new());
}

#[sqlx::test]
async fn search_filters_are_validated(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let cases = [
        (
            json!({ "age_min": 30, "age_max": 25 }),
            "filters.age_max:out_of_range",
        ),
        (json!({ "age_min": 17 }), "filters.age_min:out_of_range"),
        (
            json!({ "height_max_cm": 250 }),
            "filters.height_max_cm:out_of_range",
        ),
        (
            json!({ "active_within_days": 3 }),
            "filters.active_within_days:invalid",
        ),
        (
            json!({ "joined_within_days": 1 }),
            "filters.joined_within_days:invalid",
        ),
        (
            json!({ "religion_codes": ["jedi"] }),
            "filters.religion_codes:unknown_code",
        ),
        (
            json!({ "caste_codes": ["nope"] }),
            "filters.caste_codes:unknown_code",
        ),
        (json!({ "city_ids": [-5] }), "filters.city_ids:unknown_code"),
        (
            json!({ "education_min_rank": 42 }),
            "filters.education_min_rank:out_of_range",
        ),
        (
            json!({ "country_codes": vec!["PK"; 21] }),
            "filters.country_codes:too_long",
        ),
    ];
    for (filters, field) in cases {
        let response = app
            .post(
                "/v1/search",
                Some(&man.token),
                json!({ "filters": filters }),
            )
            .await;
        assert_eq!(response.code(), "validation_failed", "{filters}");
        assert_eq!(response.field_errors(), [field], "{filters}");
    }
    let unknown_key = app
        .post(
            "/v1/search",
            Some(&man.token),
            json!({ "filters": { "eye_colour": "green" } }),
        )
        .await;
    assert_eq!(unknown_key.code(), "bad_request");
}

#[sqlx::test]
async fn saved_searches_are_listed_changed_and_limited(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let created = app
        .post(
            "/v1/me/saved-searches",
            Some(&man.token),
            json!({ "name": " Lahore doctors ", "filters": { "city_ids": [LAHORE] }, "notify_new": true }),
        )
        .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text);
    assert_eq!(created.json["name"], "Lahore doctors");
    assert_eq!(created.json["filters"]["city_ids"], json!([LAHORE]));
    assert_eq!(created.json["filters"]["age_min"], Value::Null);
    let id = created.json["id"].as_str().unwrap().to_owned();

    let renamed = app
        .patch(
            &format!("/v1/me/saved-searches/{id}"),
            Some(&man.token),
            json!({ "name": "Lahore", "notify_new": false }),
        )
        .await;
    assert_eq!(renamed.json["name"], "Lahore");
    assert_eq!(renamed.json["notify_new"], false);

    // Another member cannot see, change or delete it.
    let other = app.member().await;
    let foreign = app
        .patch(
            &format!("/v1/me/saved-searches/{id}"),
            Some(&other.token),
            json!({ "name": "Mine" }),
        )
        .await;
    assert_eq!(foreign.status, StatusCode::NOT_FOUND);
    assert_eq!(
        app.delete(&format!("/v1/me/saved-searches/{id}"), Some(&other.token))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    let list = app.get("/v1/me/saved-searches", Some(&other.token)).await;
    assert_eq!(list.json["items"], json!([]));

    let invalid = app
        .post(
            "/v1/me/saved-searches",
            Some(&man.token),
            json!({ "name": "  ", "filters": {}, "notify_new": false }),
        )
        .await;
    assert_eq!(invalid.field_errors(), ["name:required"]);
    for n in 1..10 {
        let response = app
            .post(
                "/v1/me/saved-searches",
                Some(&man.token),
                json!({ "name": format!("Search {n}"), "filters": {}, "notify_new": false }),
            )
            .await;
        assert_eq!(response.status, StatusCode::CREATED);
    }
    let full = app
        .post(
            "/v1/me/saved-searches",
            Some(&man.token),
            json!({ "name": "One too many", "filters": {}, "notify_new": false }),
        )
        .await;
    assert_eq!(full.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        full.json["error"]["details"]["limit"],
        "limits.saved_searches_max"
    );
    assert_eq!(full.json["error"]["details"]["used"], 10);
    let list = app.get("/v1/me/saved-searches", Some(&man.token)).await;
    assert_eq!(list.json["items"].as_array().unwrap().len(), 10);

    let deleted = app
        .delete(&format!("/v1/me/saved-searches/{id}"), Some(&man.token))
        .await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn saved_search_alerts_notify_about_new_profiles_once(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let created = app
        .post(
            "/v1/me/saved-searches",
            Some(&man.token),
            json!({ "name": "Punjabi speakers", "filters": { "mother_tongue_codes": ["punjabi"] }, "notify_new": true }),
        )
        .await;
    let id = created.json["id"].as_str().unwrap().to_owned();
    exec(
        &app,
        "UPDATE saved_searches SET created_at = now() - interval '2 days' WHERE profile_id = $1",
        man.profile_id,
    )
    .await;
    let now = OffsetDateTime::now_utc();
    candidates(&app, Gender::Female, 4, |index, p| {
        p.mother_tongue_code = if index < 3 { "punjabi" } else { "urdu" }.to_owned();
        p.first_activated_at = if index == 0 {
            now - Duration::days(5)
        } else {
            now - Duration::hours(3)
        };
    })
    .await;

    let run = || async {
        enqueue(app.db(), NewJob::new("saved_search_alerts", json!({})))
            .await
            .unwrap();
        app.drain_jobs().await;
    };
    run().await;
    assert_eq!(
        new_matches(&app, &man).await,
        [json!({
            "source": "saved_search",
            "count": 2,
            "saved_search_id": id,
            "saved_search_name": "Punjabi speakers",
        })]
    );
    let notified: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT last_notified_at FROM saved_searches WHERE profile_id = $1")
            .bind(man.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(notified.is_some());

    run().await;
    assert_eq!(
        new_matches(&app, &man).await.len(),
        1,
        "nothing new since the alert"
    );
}
