//! Partner preferences and privacy settings (T-104).

use serde_json::{Value, json};
use sqlx::PgPool;
use time::Date;

use super::{city, dob, fields, onboarded, profile_of};
use crate::domain::options::Gender;
use crate::domain::types::ProfileStatus;
use crate::test_support::{TestApp, TestUser};

fn date_of_age(years: i32) -> Date {
    Date::parse(
        &dob(years),
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .unwrap()
}

/// A member without a preferences row.
async fn member_without_preferences(
    app: &TestApp,
    gender: Gender,
    age: i32,
    marital_status: &'static str,
) -> TestUser {
    app.member_with(|spec| {
        spec.gender = gender;
        spec.date_of_birth = date_of_age(age);
        spec.marital_status = marital_status;
        spec.preferences = false;
    })
    .await
}

async fn preferences_of(app: &TestApp, user: &TestUser) -> Value {
    let response = app.get("/v1/me/preferences", Some(&user.token)).await;
    assert_eq!(response.status, 200, "{}", response.text);
    response.json
}

async fn put_preferences(
    app: &TestApp,
    user: &TestUser,
    body: Value,
) -> crate::test_support::TestResponse {
    app.put("/v1/me/preferences", Some(&user.token), body).await
}

#[sqlx::test]
async fn the_defaults_follow_the_worked_examples_of_07_section_12(db: PgPool) {
    let app = TestApp::new(db).await;

    // A man of 29, never married, Muslim, living in Pakistan.
    let man = member_without_preferences(&app, Gender::Male, 29, "never_married").await;
    let prefs = preferences_of(&app, &man).await;
    assert_eq!(
        (prefs["age_min"].as_i64(), prefs["age_max"].as_i64()),
        (Some(21), Some(30))
    );
    assert_eq!(prefs["marital_statuses"], json!(["never_married"]));
    assert_eq!(prefs["religion_codes"], json!(["islam"]));
    assert_eq!(prefs["country_codes"], json!(["PK"]));
    assert_eq!(prefs["religion_importance"], "must");
    assert_eq!(prefs["age_importance"], "high");
    assert_eq!(prefs["children_acceptance"], "any");
    assert_eq!(prefs["notes"], Value::Null);
    assert_eq!(prefs["hijab_types"], json!([]));

    // A woman of 26 in the United Kingdom.
    let woman = member_without_preferences(&app, Gender::Female, 26, "never_married").await;
    sqlx::query("UPDATE profiles SET country_code = 'GB' WHERE id = $1")
        .bind(woman.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    let prefs = preferences_of(&app, &woman).await;
    assert_eq!(
        (prefs["age_min"].as_i64(), prefs["age_max"].as_i64()),
        (Some(25), Some(34))
    );
    assert_eq!(prefs["country_codes"], json!(["GB"]));

    // A divorced man of 41.
    let divorced = member_without_preferences(&app, Gender::Male, 41, "divorced").await;
    let prefs = preferences_of(&app, &divorced).await;
    assert_eq!(
        (prefs["age_min"].as_i64(), prefs["age_max"].as_i64()),
        (Some(33), Some(42))
    );
    assert_eq!(
        prefs["marital_statuses"],
        json!([
            "never_married",
            "divorced",
            "widowed",
            "nikah_ended_before_rukhsati"
        ])
    );

    // A Christian woman of 18.
    let young = member_without_preferences(&app, Gender::Female, 18, "never_married").await;
    sqlx::query(
        "UPDATE profiles SET religion_code = 'christianity', sect_code = NULL WHERE id = $1",
    )
    .bind(young.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    let prefs = preferences_of(&app, &young).await;
    assert_eq!(
        (prefs["age_min"].as_i64(), prefs["age_max"].as_i64()),
        (Some(18), Some(26))
    );
    assert_eq!(prefs["religion_codes"], json!(["christianity"]));

    // A profile that is still empty gets the fallbacks.
    let draft = app.draft_user().await;
    let prefs = preferences_of(&app, &draft).await;
    assert_eq!(
        (prefs["age_min"].as_i64(), prefs["age_max"].as_i64()),
        (Some(18), Some(80))
    );
    assert_eq!(prefs["marital_statuses"], json!(["never_married"]));
    assert_eq!(prefs["religion_codes"], json!([]));
    assert_eq!(prefs["country_codes"], json!([]));
    // Reading the defaults creates nothing.
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM partner_preferences WHERE profile_id = $1")
            .bind(draft.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(rows, 0);
}

#[sqlx::test]
async fn saved_preferences_do_not_follow_the_profile_any_more(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = member_without_preferences(&app, Gender::Male, 29, "never_married").await;
    let defaults = preferences_of(&app, &man).await;
    assert_eq!(
        put_preferences(&app, &man, defaults.clone()).await.status,
        200
    );

    sqlx::query("UPDATE profiles SET country_code = 'GB' WHERE id = $1")
        .bind(man.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    assert_eq!(preferences_of(&app, &man).await, defaults);
}

/// Every preference at a value that is not its default. Built in parts: one `json!` of this
/// size is more than the macro recursion limit allows.
fn full_preferences(punjab: i32, lahore: i32) -> Value {
    let parts = [
        json!({
            "age_min": 24, "age_max": 31, "age_importance": "must",
            "height_min_cm": 150, "height_max_cm": 175, "height_importance": "medium",
            "marital_statuses": ["never_married", "divorced"],
            "marital_status_importance": "low",
            "children_acceptance": "none", "children_importance": "high",
            "religion_codes": ["islam"], "religion_importance": "must",
            "sect_codes": ["sunni", "shia"], "sect_importance": "high",
        }),
        json!({
            "caste_codes": ["arain", "rajput"], "caste_importance": "medium",
            "mother_tongue_codes": ["urdu", "punjabi"], "mother_tongue_importance": "high",
            "country_codes": ["PK", "GB"], "region_ids": [punjab], "city_ids": [lahore],
            "location_importance": "must",
            "education_min_rank": 5, "education_importance": "must",
            "employment_types": ["private_job", "government_job"],
            "profession_codes": ["doctor", "software_it"], "profession_importance": "medium",
        }),
        json!({
            "income_min_rank": 3, "income_importance": "high",
            "religiosity_levels": ["practising", "very_practising"],
            "religiosity_importance": "high",
            "hijab_types": ["hijab", "niqab"], "beard_types": [],
            "appearance_importance": "medium",
            "family_values": ["traditional"], "family_types": ["joint", "nuclear"],
            "family_importance": "medium",
        }),
        json!({
            "living_arrangements": ["with_family"], "living_arrangement_importance": "high",
            "work_after_marriage_options": ["yes", "flexible"],
            "work_after_marriage_importance": "medium",
            "smoking_options": ["no"], "smoking_importance": "must",
            "notes": "Looking for a kind and educated partner from a family that values faith."
        }),
    ];
    let mut all = serde_json::Map::new();
    for part in parts {
        if let Value::Object(map) = part {
            all.extend(map);
        }
    }
    Value::Object(all)
}

#[sqlx::test]
async fn a_full_set_of_preferences_round_trips(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = member_without_preferences(&app, Gender::Male, 29, "never_married").await;
    let (lahore, punjab) = city(&app, "PK", "Lahore").await;
    let body = full_preferences(punjab.unwrap(), lahore);
    assert!(
        profile_of(&app, &man).await["missing"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "partner_preferences")
    );
    sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
        .bind(man.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    let response = put_preferences(&app, &man, body.clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json, body);
    assert_eq!(preferences_of(&app, &man).await, body);

    // The row exists now, the recommendations are stale and the completeness counts it.
    let (stale, notes_status): (bool, String) = sqlx::query_as(
        "SELECT p.match_stale, pp.notes_status
         FROM profiles p JOIN partner_preferences pp ON pp.profile_id = p.id WHERE p.id = $1",
    )
    .bind(man.profile_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!(stale);
    assert_eq!(notes_status, "pending");
    let profile = profile_of(&app, &man).await;
    assert!(
        !profile["missing"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "partner_preferences")
    );
    assert_eq!(profile["text_status"]["partner_notes"], "pending");
    assert_eq!(
        app.queued_jobs("moderate_text").await,
        [json!({ "profile_id": man.profile_id, "field": "partner_notes" })]
    );

    // The body replaces the stored row as a whole.
    let mut again = body.clone();
    again["age_min"] = json!(30);
    again["notes"] = Value::Null;
    again["sect_codes"] = json!([]);
    let response = put_preferences(&app, &man, again.clone()).await;
    assert_eq!(response.status, 200);
    assert_eq!(preferences_of(&app, &man).await, again);
    assert_eq!(
        profile_of(&app, &man).await["text_status"]["partner_notes"],
        "approved"
    );
}

#[sqlx::test]
async fn invalid_preferences_are_refused_field_by_field(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let (lahore, punjab) = city(&app, "PK", "Lahore").await;
    let (london, england) = city(&app, "GB", "London").await;
    let (punjab, england) = (punjab.unwrap(), england.unwrap());
    let base = full_preferences(punjab, lahore);
    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = base.clone();
        change(&mut body);
        body
    };

    let castes: Vec<String> = sqlx::query_scalar(
        "SELECT code FROM castes WHERE parent_code IS NULL AND is_active ORDER BY code LIMIT 31",
    )
    .fetch_all(app.db())
    .await
    .unwrap();
    let countries: Vec<String> =
        sqlx::query_scalar("SELECT code FROM countries WHERE is_active ORDER BY code LIMIT 21")
            .fetch_all(app.db())
            .await
            .unwrap();
    let professions: Vec<String> = sqlx::query_scalar(
        "SELECT code FROM profession_categories WHERE is_active ORDER BY code LIMIT 21",
    )
    .fetch_all(app.db())
    .await
    .unwrap();
    let regions: Vec<i32> = sqlx::query_scalar("SELECT id FROM regions ORDER BY id LIMIT 21")
        .fetch_all(app.db())
        .await
        .unwrap();
    let cities: Vec<i32> = sqlx::query_scalar("SELECT id FROM cities ORDER BY id LIMIT 21")
        .fetch_all(app.db())
        .await
        .unwrap();
    assert_eq!(
        (castes.len(), countries.len(), professions.len()),
        (31, 21, 21)
    );

    let cases: Vec<(Value, &str)> = vec![
        (with(&|b| b["age_min"] = json!(17)), "age_min:out_of_range"),
        (with(&|b| b["age_max"] = json!(81)), "age_max:out_of_range"),
        (
            with(&|b| {
                b["age_min"] = json!(40);
                b["age_max"] = json!(30);
            }),
            "age_min:invalid",
        ),
        (
            with(&|b| b["height_min_cm"] = json!(100)),
            "height_min_cm:out_of_range",
        ),
        (
            with(&|b| b["height_max_cm"] = json!(300)),
            "height_max_cm:out_of_range",
        ),
        (
            with(&|b| {
                b["height_min_cm"] = json!(180);
                b["height_max_cm"] = json!(170);
            }),
            "height_min_cm:invalid",
        ),
        (
            with(&|b| b["religion_codes"] = json!(["jedi"])),
            "religion_codes:unknown_code",
        ),
        (
            with(&|b| b["sect_codes"] = json!(["made_up"])),
            "sect_codes:unknown_code",
        ),
        (
            with(&|b| b["caste_codes"] = json!(["rajput_bhatti"])),
            "caste_codes:unknown_code",
        ),
        (
            with(&|b| b["mother_tongue_codes"] = json!(["klingon"])),
            "mother_tongue_codes:unknown_code",
        ),
        (
            with(&|b| b["country_codes"] = json!(["ZZ"])),
            "country_codes:unknown_code",
        ),
        (
            with(&|b| b["profession_codes"] = json!(["alchemist"])),
            "profession_codes:unknown_code",
        ),
        (
            with(&|b| b["region_ids"] = json!([999_999_999])),
            "region_ids:unknown_code",
        ),
        (
            with(&|b| b["city_ids"] = json!([999_999_999])),
            "city_ids:unknown_code",
        ),
        (
            with(&|b| {
                b["country_codes"] = json!(["PK"]);
                b["region_ids"] = json!([england]);
            }),
            "region_ids:mismatch",
        ),
        (
            with(&|b| {
                b["country_codes"] = json!(["PK"]);
                b["city_ids"] = json!([london]);
            }),
            "city_ids:mismatch",
        ),
        (
            with(&|b| b["education_min_rank"] = json!(99)),
            "education_min_rank:unknown_code",
        ),
        (
            with(&|b| b["income_min_rank"] = json!(99)),
            "income_min_rank:unknown_code",
        ),
        (
            with(&|b| b["marital_statuses"] = json!(["married"])),
            "marital_statuses:not_allowed",
        ),
        (
            with(&|b| b["caste_codes"] = json!(castes)),
            "caste_codes:too_long",
        ),
        (
            with(&|b| {
                b["country_codes"] = json!(countries);
                b["region_ids"] = json!([]);
                b["city_ids"] = json!([]);
            }),
            "country_codes:too_long",
        ),
        (
            with(&|b| b["profession_codes"] = json!(professions)),
            "profession_codes:too_long",
        ),
        (
            with(&|b| b["region_ids"] = json!(regions)),
            "region_ids:too_long",
        ),
        (
            with(&|b| b["city_ids"] = json!(cities)),
            "city_ids:too_long",
        ),
        (
            with(&|b| b["notes"] = json!("Short note.")),
            "notes:too_short",
        ),
        (
            with(&|b| {
                b["notes"] =
                    json!("Please call me on 0300 1234567 if your family is looking for a match.");
            }),
            "notes:contains_contact_info",
        ),
        (
            with(&|b| b["notes"] = json!("n".repeat(1001))),
            "notes:too_long",
        ),
    ];
    for (body, expected) in cases {
        let response = put_preferences(&app, &man, body.clone()).await;
        assert_eq!(response.status, 400, "{expected}: {}", response.text);
        assert_eq!(response.code(), "validation_failed", "{expected}");
        assert_eq!(fields(&response), [expected], "{expected}");
    }

    // With no country selected, any region or city is allowed.
    let open = with(&|b| {
        b["country_codes"] = json!([]);
        b["region_ids"] = json!([england]);
        b["city_ids"] = json!([london]);
    });
    assert_eq!(put_preferences(&app, &man, open).await.status, 200);

    // `married` is something women may ask for.
    let body = with(&|b| b["marital_statuses"] = json!(["never_married", "married"]));
    let response = put_preferences(&app, &woman, body).await;
    assert_eq!(response.status, 200, "{}", response.text);
}

#[sqlx::test]
async fn unknown_keys_missing_keys_and_unknown_values_are_bad_requests(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let (lahore, punjab) = city(&app, "PK", "Lahore").await;
    let base = full_preferences(punjab.unwrap(), lahore);

    let mut body = base.clone();
    body["salary"] = json!(1);
    assert_eq!(
        put_preferences(&app, &man, body).await.code(),
        "bad_request"
    );

    let mut body = base.clone();
    body.as_object_mut().unwrap().remove("age_min");
    assert_eq!(
        put_preferences(&app, &man, body).await.code(),
        "bad_request"
    );

    let mut body = base.clone();
    body["age_importance"] = json!("urgent");
    assert_eq!(
        put_preferences(&app, &man, body).await.code(),
        "bad_request"
    );

    let mut body = base;
    body["religiosity_levels"] = json!(["very_much"]);
    assert_eq!(
        put_preferences(&app, &man, body).await.code(),
        "bad_request"
    );
}

#[sqlx::test]
async fn only_the_appearance_list_of_the_other_gender_is_kept(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let (lahore, punjab) = city(&app, "PK", "Lahore").await;
    let mut body = full_preferences(punjab.unwrap(), lahore);
    body["hijab_types"] = json!(["hijab"]);
    body["beard_types"] = json!(["full", "trimmed"]);

    let saved = put_preferences(&app, &man, body.clone()).await.json;
    assert_eq!(saved["hijab_types"], json!(["hijab"]));
    assert_eq!(saved["beard_types"], json!([]));
    let saved = put_preferences(&app, &woman, body).await.json;
    assert_eq!(saved["hijab_types"], json!([]));
    assert_eq!(saved["beard_types"], json!(["full", "trimmed"]));
}

#[sqlx::test]
async fn duplicates_are_removed_and_the_notes_text_follows_the_rules_of_moderated_text(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let (lahore, punjab) = city(&app, "PK", "Lahore").await;
    let mut body = full_preferences(punjab.unwrap(), lahore);
    body["religiosity_levels"] = json!(["practising", "practising", "very_practising"]);
    body["country_codes"] = json!(["PK", "PK"]);
    let saved = put_preferences(&app, &man, body.clone()).await.json;
    assert_eq!(
        saved["religiosity_levels"],
        json!(["practising", "very_practising"])
    );
    assert_eq!(saved["country_codes"], json!(["PK"]));

    // The same notes again keep their status and queue nothing more.
    sqlx::query("UPDATE partner_preferences SET notes_status = 'rejected' WHERE profile_id = $1")
        .bind(man.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    sqlx::query("DELETE FROM jobs")
        .execute(app.db())
        .await
        .unwrap();
    put_preferences(&app, &man, body.clone()).await;
    assert_eq!(
        profile_of(&app, &man).await["text_status"]["partner_notes"],
        "rejected"
    );
    assert!(
        app.queued_jobs("moderate_text").await.is_empty(),
        "unchanged notes queue nothing"
    );

    // A changed text is held again.
    body["notes"] = json!("Looking for a partner who is kind, educated and close to her family.");
    put_preferences(&app, &man, body).await;
    assert_eq!(
        profile_of(&app, &man).await["text_status"]["partner_notes"],
        "pending"
    );
    assert_eq!(app.queued_jobs("moderate_text").await.len(), 1);
}

#[sqlx::test]
async fn a_draft_can_save_preferences_and_needs_a_token(db: PgPool) {
    let app = TestApp::new(db).await;
    let draft = app.draft_user().await;
    let defaults = preferences_of(&app, &draft).await;
    assert_eq!(
        put_preferences(&app, &draft, defaults.clone()).await.status,
        200
    );
    assert_eq!(preferences_of(&app, &draft).await, defaults);

    assert_eq!(
        app.get("/v1/me/preferences", None).await.code(),
        "unauthenticated"
    );
    assert_eq!(
        app.put("/v1/me/preferences", None, defaults.clone())
            .await
            .code(),
        "unauthenticated"
    );
    let suspended = app
        .member_with(|spec| spec.status = ProfileStatus::Suspended)
        .await;
    assert_eq!(
        app.get("/v1/me/preferences", Some(&suspended.token))
            .await
            .code(),
        "account_suspended"
    );
    assert_eq!(
        put_preferences(&app, &suspended, defaults).await.code(),
        "account_suspended"
    );
}

#[sqlx::test]
async fn each_member_has_their_own_preferences(db: PgPool) {
    let app = TestApp::new(db).await;
    let first = onboarded(&app, Gender::Male).await;
    let second = onboarded(&app, Gender::Female).await;
    let mut body = preferences_of(&app, &first).await;
    body["age_min"] = json!(33);
    body["age_max"] = json!(40);
    assert_eq!(put_preferences(&app, &first, body).await.status, 200);
    let other = preferences_of(&app, &second).await;
    assert_ne!(other["age_min"], json!(33));
}

fn default_privacy() -> Value {
    json!({
        "discovery_visibility": "everyone", "interest_permission": "everyone",
        "name_display": "first_name_last_initial", "photo_visibility": "members",
        "caste_visibility": "members", "income_visibility": "connections",
        "family_visibility": "members", "career_details_visibility": "connections",
        "home_visibility": "connections", "area_visibility": "connections",
        "health_visibility": "connections", "show_last_active": true,
        "show_online_status": true, "record_my_visits": true, "send_read_receipts": true,
        "allow_photo_requests": true
    })
}

#[sqlx::test]
async fn privacy_starts_with_the_defaults_and_takes_any_subset(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let privacy = app.get("/v1/me/privacy", Some(&man.token)).await;
    assert_eq!(privacy.status, 200);
    assert_eq!(privacy.json, default_privacy());

    let response = app
        .patch(
            "/v1/me/privacy",
            Some(&man.token),
            json!({ "name_display": "full_name", "show_last_active": false, "home_visibility": "nobody" }),
        )
        .await;
    assert_eq!(response.status, 200, "{}", response.text);
    let mut expected = default_privacy();
    expected["name_display"] = json!("full_name");
    expected["show_last_active"] = json!(false);
    expected["home_visibility"] = json!("nobody");
    assert_eq!(response.json, expected);
    assert_eq!(
        app.get("/v1/me/privacy", Some(&man.token)).await.json,
        expected
    );

    // A second patch keeps the first one's changes.
    let response = app
        .patch(
            "/v1/me/privacy",
            Some(&man.token),
            json!({ "discovery_visibility": "hidden" }),
        )
        .await;
    expected["discovery_visibility"] = json!("hidden");
    assert_eq!(response.json, expected);

    // An empty patch changes nothing.
    let response = app
        .patch("/v1/me/privacy", Some(&man.token), json!({}))
        .await;
    assert_eq!(response.status, 200);
    assert_eq!(response.json, expected);

    // Other members are not affected.
    let other = app.member_of(Gender::Female).await;
    assert_eq!(
        app.get("/v1/me/privacy", Some(&other.token)).await.json["name_display"],
        "first_name_last_initial"
    );
}

#[sqlx::test]
async fn privacy_refuses_unknown_keys_and_values(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    for body in [
        json!({ "name_display": "nickname" }),
        json!({ "photo_visibility": "everyone" }),
        json!({ "caste_visibility": "friends" }),
        json!({ "show_last_active": "yes" }),
        json!({ "theme": "dark" }),
    ] {
        let response = app
            .patch("/v1/me/privacy", Some(&man.token), body.clone())
            .await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(response.code(), "bad_request");
    }
    assert_eq!(
        app.get("/v1/me/privacy", Some(&man.token)).await.json,
        default_privacy()
    );
    assert_eq!(
        app.get("/v1/me/privacy", None).await.code(),
        "unauthenticated"
    );
    assert_eq!(
        app.patch("/v1/me/privacy", None, json!({})).await.code(),
        "unauthenticated"
    );
}

#[sqlx::test]
async fn only_the_visibility_of_matchable_details_marks_the_recommendations_stale(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let stale = || async {
        let value: bool = sqlx::query_scalar("SELECT match_stale FROM profiles WHERE id = $1")
            .bind(man.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        value
    };
    let reset = || async {
        sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
            .bind(man.profile_id)
            .execute(app.db())
            .await
            .unwrap();
    };

    for patch in [
        json!({ "name_display": "initials" }),
        json!({ "photo_visibility": "connections" }),
        json!({ "show_online_status": false }),
        json!({ "discovery_visibility": "preference_match" }),
        // Unchanged values change nothing.
        json!({ "caste_visibility": "members" }),
    ] {
        reset().await;
        assert_eq!(
            app.patch("/v1/me/privacy", Some(&man.token), patch.clone())
                .await
                .status,
            200
        );
        assert!(!stale().await, "{patch} does not touch matching");
    }
    for patch in [
        json!({ "caste_visibility": "nobody" }),
        json!({ "income_visibility": "members" }),
        json!({ "family_visibility": "connections" }),
    ] {
        reset().await;
        assert_eq!(
            app.patch("/v1/me/privacy", Some(&man.token), patch.clone())
                .await
                .status,
            200
        );
        assert!(
            stale().await,
            "{patch} changes matchable values (10 section 8.2)"
        );
    }
}
