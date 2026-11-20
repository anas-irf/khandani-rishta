//! `GET /v1/me/profile` and `PUT /v1/me/profile/sections/{section}` (T-102).

use serde_json::{Value, json};
use sqlx::PgPool;

use super::{
    account_for_body, basics_body, city, community_body, dob, education_body, fields,
    location_body, profile_of, put_section, save,
};
use crate::domain::options::Gender;
use crate::domain::types::{ProfileStatus, UserRole};
use crate::test_support::TestApp;

#[sqlx::test]
async fn a_new_draft_profile_is_empty(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let profile = profile_of(&app, &user).await;

    assert_eq!(profile["status"], "draft");
    assert_eq!(profile["onboarding_step"], "account_for");
    assert_eq!(profile["completeness"], 0);
    assert_eq!(profile["missing"][0], "core");
    assert_eq!(profile["locked_fields"], json!([]));
    assert_eq!(profile["photos"], json!([]));
    assert_eq!(profile["identity"], Value::Null);
    assert_eq!(profile["basics"]["first_name"], Value::Null);
    assert_eq!(profile["community"]["language_codes"], json!([]));
    assert_eq!(profile["lifestyle"]["hobby_codes"], json!([]));
    assert_eq!(profile["contacts"]["preferred_contact"], "self");
    assert_eq!(profile["location"]["city"], Value::Null);
    assert_eq!(
        profile["verification"],
        json!({
            "phone_verified": false,
            "photo_verified": false,
            "id_verified": false,
            "pending": { "id_document": false, "selfie": false }
        })
    );
    assert_eq!(
        profile["text_status"],
        json!({ "about_me": "approved", "about_family": "approved", "partner_notes": "approved" })
    );
}

#[sqlx::test]
async fn the_profile_needs_a_token_and_an_open_account(db: PgPool) {
    let app = TestApp::new(db).await;
    assert_eq!(
        app.get("/v1/me/profile", None).await.code(),
        "unauthenticated"
    );
    assert_eq!(
        app.put("/v1/me/profile/sections/basics", None, json!({}))
            .await
            .code(),
        "unauthenticated"
    );

    let suspended = app
        .member_with(|spec| spec.status = ProfileStatus::Suspended)
        .await;
    let response = app.get("/v1/me/profile", Some(&suspended.token)).await;
    assert_eq!(response.code(), "account_suspended");
    let response = put_section(&app, &suspended, "basics", json!({})).await;
    assert_eq!(response.code(), "account_suspended");
}

#[sqlx::test]
async fn an_unknown_section_is_not_found(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let response = put_section(&app, &user, "photos", json!({})).await;
    assert_eq!(response.status, 404);
    assert_eq!(response.code(), "not_found");
}

#[sqlx::test]
async fn unknown_keys_and_values_outside_a_closed_list_are_bad_requests(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let mut body = basics_body(Gender::Male);
    body["nickname"] = json!("Ahmi");
    assert_eq!(
        put_section(&app, &user, "basics", body).await.code(),
        "bad_request"
    );

    let mut body = basics_body(Gender::Male);
    body["marital_status"] = json!("complicated");
    assert_eq!(
        put_section(&app, &user, "basics", body).await.code(),
        "bad_request"
    );

    let response = app
        .raw(
            "PUT",
            "/v1/me/profile/sections/basics",
            Some(&user.token),
            Some("{not json".to_owned()),
        )
        .await;
    assert_eq!(response.code(), "bad_request");
}

#[sqlx::test]
async fn account_for_saves_the_section_and_records_the_consents(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let mut body = account_for_body();
    body["managed_by"] = json!("parent");
    body["manager_name"] = json!("  Rukhsana   Khan ");
    body["consents"] = json!([
        "terms",
        "privacy",
        "community_guidelines",
        "age_declaration",
        "candidate_consent"
    ]);
    let response = put_section(&app, &user, "account_for", body).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(
        response.json["account_for"],
        json!({ "managed_by": "parent", "manager_name": "Rukhsana Khan" })
    );

    let recorded: Vec<String> = sqlx::query_scalar(
        "SELECT document FROM user_consents WHERE user_id = $1 ORDER BY document",
    )
    .bind(user.user_id)
    .fetch_all(app.db())
    .await
    .unwrap();
    assert_eq!(
        recorded,
        [
            "age_declaration",
            "candidate_consent",
            "community_guidelines",
            "privacy",
            "terms"
        ]
    );

    // For `self` the name is dropped whatever was sent (07 section 3.4 rule 2).
    let mut body = account_for_body();
    body["manager_name"] = json!("Someone Else");
    let response = put_section(&app, &user, "account_for", body).await;
    assert_eq!(response.json["account_for"]["manager_name"], Value::Null);

    // Saving the same consents again records nothing twice.
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM user_consents WHERE user_id = $1")
        .bind(user.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(count, 5);
}

#[sqlx::test]
async fn account_for_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    let mut body = account_for_body();
    body["managed_by"] = json!("parent");
    body["manager_name"] = json!("R2D2");
    let response = put_section(&app, &user, "account_for", body).await;
    assert_eq!(fields(&response), ["manager_name:invalid"]);

    let mut body = account_for_body();
    body["managed_by"] = json!("parent");
    body["manager_name"] = json!("R");
    let response = put_section(&app, &user, "account_for", body).await;
    assert_eq!(fields(&response), ["manager_name:too_short"]);

    // A draft may leave the required fields empty.
    let response = put_section(&app, &user, "account_for", json!({})).await;
    assert_eq!(response.status, 200, "{}", response.text);

    // After onboarding they cannot be cleared, and a profile that was for the candidate needs
    // the candidate's consent before another person manages it (07 section 3.4 rule 5).
    let member = app.member().await;
    let response = put_section(&app, &member, "account_for", json!({})).await;
    assert_eq!(fields(&response), ["managed_by:required"]);

    let body = json!({ "managed_by": "parent", "manager_name": "Rukhsana Khan" });
    let response = put_section(&app, &member, "account_for", body).await;
    assert_eq!(fields(&response), ["consents:required"]);

    let body = json!({
        "managed_by": "parent", "manager_name": "Rukhsana Khan", "consents": ["candidate_consent"]
    });
    let response = put_section(&app, &member, "account_for", body).await;
    assert_eq!(response.status, 200, "{}", response.text);

    let body = json!({ "managed_by": "sibling", "manager_name": null });
    let response = put_section(&app, &member, "account_for", body).await;
    assert_eq!(fields(&response), ["manager_name:required"]);
}

#[sqlx::test]
async fn basics_saves_the_section_and_the_account_sees_the_gender(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let mut body = basics_body(Gender::Male);
    body["first_name"] = json!("  Muhammad   Ali ");
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(response.status, 200, "{}", response.text);
    let basics = &response.json["basics"];
    assert_eq!(basics["first_name"], "Muhammad Ali");
    assert_eq!(basics["gender"], "male");
    assert_eq!(basics["date_of_birth"], dob(28));
    assert_eq!(basics["height_cm"], 170);
    assert!(response.json["completeness"].as_i64().unwrap() == 0);

    let me = app.get("/v1/me", Some(&user.token)).await;
    assert_eq!(me.json["profile"]["gender"], "male");
    assert_eq!(me.json["profile"]["first_name"], "Muhammad Ali");
}

#[sqlx::test]
async fn basics_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = basics_body(Gender::Male);
        change(&mut body);
        body
    };

    let cases: Vec<(Value, &str)> = vec![
        (
            with(&|b| b["date_of_birth"] = json!(dob(17))),
            "date_of_birth:too_young",
        ),
        (
            with(&|b| b["date_of_birth"] = json!(dob(81))),
            "date_of_birth:out_of_range",
        ),
        (
            with(&|b| b["date_of_birth"] = json!("2000-02-30")),
            "date_of_birth:invalid",
        ),
        (
            with(&|b| b["date_of_birth"] = json!("yesterday")),
            "date_of_birth:invalid",
        ),
        (
            with(&|b| b["first_name"] = json!("A")),
            "first_name:too_short",
        ),
        (
            with(&|b| b["first_name"] = json!("Ahmed1")),
            "first_name:invalid",
        ),
        (
            with(&|b| b["last_name"] = json!("K".repeat(41))),
            "last_name:too_long",
        ),
        (
            with(&|b| b["height_cm"] = json!(100)),
            "height_cm:out_of_range",
        ),
        (
            with(&|b| b["height_cm"] = json!(214)),
            "height_cm:out_of_range",
        ),
        // The wives count goes with `married`, also in a draft (07 section 4.2 rule 4).
        (
            with(&|b| b["marital_status"] = json!("married")),
            "current_wives_count:required",
        ),
        (
            with(&|b| {
                b["marital_status"] = json!("married");
                b["current_wives_count"] = json!(4);
            }),
            "current_wives_count:out_of_range",
        ),
        (
            with(&|b| {
                b["marital_status"] = json!("divorced");
                b["children_status"] = json!("living_with_me");
            }),
            "children_count:required",
        ),
        (
            with(&|b| {
                b["marital_status"] = json!("divorced");
                b["children_status"] = json!("living_with_me");
                b["children_count"] = json!(16);
            }),
            "children_count:out_of_range",
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &user, "basics", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), [expected], "{body}");
    }

    // `married` is for men only.
    let mut body = basics_body(Gender::Female);
    body["marital_status"] = json!("married");
    body["current_wives_count"] = json!(1);
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(fields(&response), ["marital_status:not_allowed"]);

    // Several problems come back together.
    let mut body = basics_body(Gender::Male);
    body["first_name"] = json!("A");
    body["height_cm"] = json!(1);
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(
        fields(&response),
        ["first_name:too_short", "height_cm:out_of_range"]
    );

    // A draft may leave the required fields empty.
    let response = put_section(&app, &user, "basics", json!({})).await;
    assert_eq!(response.status, 200, "{}", response.text);
}

#[sqlx::test]
async fn basics_normalises_marital_status_and_children(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    // Never married: no children, whatever was sent (rule 5).
    let mut body = basics_body(Gender::Male);
    body["children_status"] = json!("living_with_me");
    body["children_count"] = json!(2);
    body["current_wives_count"] = json!(2);
    let basics = put_section(&app, &user, "basics", body).await.json["basics"].clone();
    assert_eq!(basics["children_status"], "none");
    assert_eq!(basics["children_count"], Value::Null);
    assert_eq!(basics["current_wives_count"], Value::Null);

    // No children: no count (rule 6).
    let mut body = basics_body(Gender::Male);
    body["marital_status"] = json!("divorced");
    body["children_status"] = json!("none");
    body["children_count"] = json!(3);
    let basics = put_section(&app, &user, "basics", body).await.json["basics"].clone();
    assert_eq!(basics["children_count"], Value::Null);

    // A second marriage keeps its wives count; a children count goes with children.
    let mut body = basics_body(Gender::Male);
    body["marital_status"] = json!("married");
    body["current_wives_count"] = json!(2);
    body["children_status"] = json!("not_living_with_me");
    body["children_count"] = json!(4);
    let basics = put_section(&app, &user, "basics", body).await.json["basics"].clone();
    assert_eq!(basics["marital_status"], "married");
    assert_eq!(basics["current_wives_count"], 2);
    assert_eq!(basics["children_count"], 4);
}

#[sqlx::test]
async fn a_gender_change_in_a_draft_clears_what_depends_on_it(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    save(&app, &user, "basics", basics_body(Gender::Female)).await;
    let lifestyle = json!({
        "religiosity": "practising", "prayer_frequency": null, "hijab": "hijab", "beard": null,
        "religious_education": null, "smoking": null, "living_arrangement": null,
        "work_after_marriage": null, "marriage_timeline": null, "jahez_stance": null,
        "weight_kg": null, "complexion": null, "body_type": null, "blood_group": null,
        "disability": null, "disability_details": null, "hobby_codes": [], "about_me": null
    });
    save(&app, &user, "lifestyle", lifestyle).await;
    assert_eq!(profile_of(&app, &user).await["lifestyle"]["hijab"], "hijab");

    let profile = put_section(&app, &user, "basics", basics_body(Gender::Male))
        .await
        .json;
    assert_eq!(profile["basics"]["gender"], "male");
    assert_eq!(profile["lifestyle"]["hijab"], Value::Null);

    // And the other way round.
    let mut lifestyle_male = json!({ "beard": "full" });
    lifestyle_male["hobby_codes"] = json!([]);
    save(&app, &user, "lifestyle", lifestyle_male).await;
    let profile = put_section(&app, &user, "basics", basics_body(Gender::Female))
        .await
        .json;
    assert_eq!(profile["lifestyle"]["beard"], Value::Null);
}

#[sqlx::test]
async fn a_woman_starts_with_her_photos_shown_to_people_she_contacts(db: PgPool) {
    let app = TestApp::new(db).await;

    let woman = app.draft_user().await;
    save(&app, &woman, "basics", basics_body(Gender::Female)).await;
    let privacy = app.get("/v1/me/privacy", Some(&woman.token)).await;
    assert_eq!(
        privacy.json["photo_visibility"],
        "interests_and_connections"
    );

    let man = app.draft_user().await;
    save(&app, &man, "basics", basics_body(Gender::Male)).await;
    let privacy = app.get("/v1/me/privacy", Some(&man.token)).await;
    assert_eq!(privacy.json["photo_visibility"], "members");

    // A choice of the owner is never overwritten (09 section 3.5).
    let chooser = app.draft_user().await;
    let response = app
        .patch(
            "/v1/me/privacy",
            Some(&chooser.token),
            json!({ "photo_visibility": "members" }),
        )
        .await;
    assert_eq!(response.status, 200);
    save(&app, &chooser, "basics", basics_body(Gender::Female)).await;
    let privacy = app.get("/v1/me/privacy", Some(&chooser.token)).await;
    assert_eq!(privacy.json["photo_visibility"], "members");

    // And saving the basics again does not undo a later choice.
    let again = app.draft_user().await;
    save(&app, &again, "basics", basics_body(Gender::Female)).await;
    app.patch(
        "/v1/me/privacy",
        Some(&again.token),
        json!({ "photo_visibility": "members" }),
    )
    .await;
    save(&app, &again, "basics", basics_body(Gender::Female)).await;
    let privacy = app.get("/v1/me/privacy", Some(&again.token)).await;
    assert_eq!(privacy.json["photo_visibility"], "members");
}

#[sqlx::test]
async fn community_saves_and_checks_reference_codes(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    let mut body = community_body();
    body["language_codes"] = json!(["punjabi", "urdu", "punjabi", "pashto"]);
    let response = put_section(&app, &user, "community", body).await;
    assert_eq!(response.status, 200, "{}", response.text);
    // The mother tongue and duplicates are dropped silently (rule 7).
    assert_eq!(
        response.json["community"]["language_codes"],
        json!(["pashto", "punjabi"])
    );
    assert_eq!(response.json["community"]["sect_code"], "sunni");

    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = community_body();
        change(&mut body);
        body
    };
    let cases: Vec<(Value, &str)> = vec![
        (
            with(&|b| b["religion_code"] = json!("jedi")),
            "religion_code:unknown_code",
        ),
        (
            with(&|b| b["mother_tongue_code"] = json!("klingon")),
            "mother_tongue_code:unknown_code",
        ),
        (
            with(&|b| b["sect_code"] = json!("catholic")),
            "sect_code:mismatch",
        ),
        (
            with(&|b| b["sect_code"] = json!("made_up")),
            "sect_code:unknown_code",
        ),
        (
            with(&|b| b["language_codes"] = json!(["klingon"])),
            "language_codes:unknown_code",
        ),
        (
            with(&|b| {
                b["language_codes"] = json!([
                    "punjabi", "pashto", "sindhi", "saraiki", "balochi", "hindko", "brahui"
                ]);
            }),
            "language_codes:too_long",
        ),
        // A religion without sects takes none.
        (
            with(&|b| {
                b["religion_code"] = json!("hinduism");
                b["sect_code"] = json!("sunni");
            }),
            "sect_code:mismatch",
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &user, "community", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), [expected], "{body}");
    }

    let mut body = community_body();
    body["religion_code"] = json!("hinduism");
    body["sect_code"] = Value::Null;
    let response = put_section(&app, &user, "community", body).await;
    assert_eq!(response.status, 200, "{}", response.text);
}

#[sqlx::test]
async fn a_sect_is_required_once_the_profile_has_left_draft(db: PgPool) {
    let app = TestApp::new(db).await;
    // The religion has sects, so the sect is required after the draft (07 section 5.3 rule 2).
    let member = app.member().await;
    let mut body = community_body();
    body["sect_code"] = Value::Null;
    let response = put_section(&app, &member, "community", body).await;
    assert_eq!(fields(&response), ["sect_code:required"]);

    for field in ["religion_code", "mother_tongue_code"] {
        let mut body = community_body();
        body[field] = Value::Null;
        if field == "religion_code" {
            body["sect_code"] = Value::Null;
        }
        let response = put_section(&app, &member, "community", body).await;
        assert_eq!(fields(&response), [format!("{field}:required")]);
    }
}

#[sqlx::test]
async fn caste_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = community_body();
        change(&mut body);
        body
    };

    let response = put_section(
        &app,
        &user,
        "community",
        with(&|b| {
            b["caste_code"] = json!("rajput");
            b["sub_caste_code"] = json!("rajput_bhatti");
        }),
    )
    .await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(
        response.json["community"]["sub_caste_code"],
        "rajput_bhatti"
    );

    let cases: Vec<(Value, &str)> = vec![
        (
            with(&|b| {
                b["caste_code"] = json!("arain");
                b["caste_other"] = json!("Something");
            }),
            "caste_other:not_allowed",
        ),
        (
            with(&|b| {
                b["caste_code"] = json!("arain");
                b["sub_caste_code"] = json!("rajput_bhatti");
            }),
            "sub_caste_code:mismatch",
        ),
        (
            with(&|b| b["sub_caste_code"] = json!("rajput_bhatti")),
            "sub_caste_code:not_allowed",
        ),
        (
            with(&|b| b["sub_caste_other"] = json!("Some clan")),
            "sub_caste_other:not_allowed",
        ),
        (
            with(&|b| b["caste_code"] = json!("rajput_bhatti")),
            "caste_code:mismatch",
        ),
        (
            with(&|b| b["caste_code"] = json!("not_a_caste")),
            "caste_code:unknown_code",
        ),
        (
            with(&|b| b["caste_other"] = json!("X")),
            "caste_other:too_short",
        ),
        (
            with(&|b| b["caste_other"] = json!("Zorgon 0300 1234567")),
            "caste_other:contains_contact_info",
        ),
        (
            with(&|b| {
                b["caste_code"] = json!("rajput");
                b["sub_caste_code"] = json!("rajput_bhatti");
                b["sub_caste_other"] = json!("Bhatti clan");
            }),
            "sub_caste_other:not_allowed",
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &user, "community", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), [expected], "{body}");
    }
}

async fn suggestions(app: &TestApp) -> Vec<(Option<String>, String, String, i32)> {
    sqlx::query_as(
        "SELECT parent_code, name, normalized_name, usage_count FROM caste_suggestions
         ORDER BY normalized_name",
    )
    .fetch_all(app.db())
    .await
    .unwrap()
}

#[sqlx::test]
async fn a_typed_caste_is_recorded_once_per_new_value(db: PgPool) {
    let app = TestApp::new(db).await;
    let first = app.draft_user().await;
    let second = app.draft_user().await;
    let mut body = community_body();
    body["caste_other"] = json!("  Zorgon   Clan ");
    body["sub_caste_other"] = json!("Deep Sea");

    let response = put_section(&app, &first, "community", body.clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["community"]["caste_other"], "Zorgon Clan");
    // The sub-caste of a typed caste has no parent code to record under.
    assert_eq!(
        suggestions(&app).await,
        [(None, "Zorgon Clan".to_owned(), "zorgon clan".to_owned(), 1)]
    );

    // Saving the same value again counts nothing; another member typing it counts once.
    put_section(&app, &first, "community", body.clone()).await;
    assert_eq!(suggestions(&app).await[0].3, 1);
    body["caste_other"] = json!("ZORGON clan");
    put_section(&app, &second, "community", body).await;
    assert_eq!(suggestions(&app).await[0].3, 2);
}

#[sqlx::test]
async fn a_typed_caste_that_names_an_existing_one_becomes_that_one(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    // "Rajpoot" is an alias of Rajput, and "Chohan" of its sub-caste Chauhan (05 section 13).
    let mut body = community_body();
    body["caste_other"] = json!("Rajpoot");
    body["sub_caste_other"] = json!("chohan");
    let community = put_section(&app, &user, "community", body).await.json["community"].clone();
    assert_eq!(community["caste_code"], "rajput");
    assert_eq!(community["caste_other"], Value::Null);
    assert_eq!(community["sub_caste_code"], "rajput_chauhan");
    assert_eq!(community["sub_caste_other"], Value::Null);
    assert!(suggestions(&app).await.is_empty());

    // A new sub-caste under a listed caste is suggested with that parent.
    let mut body = community_body();
    body["caste_code"] = json!("rajput");
    body["sub_caste_other"] = json!("Zed Clan");
    let response = put_section(&app, &user, "community", body).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(
        suggestions(&app).await,
        [(
            Some("rajput".to_owned()),
            "Zed Clan".to_owned(),
            "zed clan".to_owned(),
            1
        )]
    );
}

#[sqlx::test]
async fn location_saves_a_listed_city_and_takes_its_region(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let (lahore, punjab) = city(&app, "PK", "Lahore").await;
    let (karachi, _) = city(&app, "PK", "Karachi").await;

    let mut body = location_body(&app).await;
    body["region_id"] = json!(1); // Whatever was sent is replaced by the region of the city.
    body["origin_city_id"] = json!(karachi);
    body["area"] = json!("  DHA   Phase 5 ");
    body["relocation"] = json!("anywhere");
    // Residency is `citizen` when the nationality is the country, whatever was sent.
    body["residency_status"] = json!("work_visa");
    let response = put_section(&app, &user, "location", body).await;
    assert_eq!(response.status, 200, "{}", response.text);
    let location = &response.json["location"];
    assert_eq!(location["region_id"], json!(punjab));
    assert_eq!(location["city"]["id"], lahore);
    assert_eq!(location["city"]["name"], "Lahore");
    assert_eq!(location["city"]["region_name"], "Punjab");
    assert_eq!(location["origin_city"]["name"], "Karachi");
    assert_eq!(location["area"], "DHA Phase 5");
    assert_eq!(location["residency_status"], "citizen");
}

#[sqlx::test]
async fn location_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let (lahore, _) = city(&app, "PK", "Lahore").await;
    let (london, _) = city(&app, "GB", "London").await;
    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = json!({
            "nationality_code": "PK", "country_code": "PK", "region_id": null, "city_id": null,
            "city_other": null, "area": null, "residency_status": null, "origin_city_id": null,
            "origin_other": null, "relocation": null
        });
        change(&mut body);
        body
    };

    let cases: Vec<(Value, &str)> = vec![
        (
            with(&|b| b["country_code"] = json!("ZZ")),
            "country_code:unknown_code",
        ),
        (
            with(&|b| b["nationality_code"] = json!("ZZ")),
            "nationality_code:unknown_code",
        ),
        (
            with(&|b| {
                b["city_id"] = json!(london);
            }),
            "city_id:mismatch",
        ),
        (
            with(&|b| b["city_id"] = json!(999_999_999)),
            "city_id:unknown_code",
        ),
        (
            with(&|b| {
                b["city_id"] = json!(lahore);
                b["city_other"] = json!("Lahore Cantt");
            }),
            "city_other:not_allowed",
        ),
        (
            with(&|b| b["city_other"] = json!("X")),
            "city_other:too_short",
        ),
        (
            with(&|b| b["region_id"] = json!(999_999_999)),
            "region_id:unknown_code",
        ),
        (
            with(&|b| {
                b["city_id"] = json!(lahore);
                b["origin_city_id"] = json!(london);
            }),
            "origin_city_id:mismatch",
        ),
        (
            with(&|b| {
                b["city_id"] = json!(lahore);
                b["origin_city_id"] = json!(lahore);
                b["origin_other"] = json!("Somewhere");
            }),
            "origin_other:not_allowed",
        ),
        (
            with(&|b| {
                b["city_id"] = json!(lahore);
                b["area"] = json!("call 0300 1234567");
            }),
            "area:contains_contact_info",
        ),
        (
            with(&|b| {
                b["city_id"] = json!(lahore);
                b["origin_other"] = json!("a".repeat(61));
            }),
            "origin_other:too_long",
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &user, "location", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), [expected], "{body}");
    }
}

#[sqlx::test]
async fn location_needs_a_region_for_a_typed_city_and_a_residency_status_abroad(db: PgPool) {
    let app = TestApp::new(db).await;
    let member = app.member().await;
    let (_, punjab) = city(&app, "PK", "Lahore").await;
    let (_, england) = city(&app, "GB", "London").await;
    let base = json!({
        "nationality_code": "PK", "country_code": "PK", "region_id": null, "city_id": null,
        "city_other": "Smalltown", "area": null, "residency_status": null,
        "origin_city_id": null, "origin_other": null, "relocation": null
    });

    // A typed city in a country with regions needs one of its regions (rule 3).
    let response = put_section(&app, &member, "location", base.clone()).await;
    assert_eq!(fields(&response), ["region_id:required"]);
    let mut body = base.clone();
    body["region_id"] = json!(england);
    let response = put_section(&app, &member, "location", body).await;
    assert_eq!(fields(&response), ["region_id:mismatch"]);
    let mut body = base.clone();
    body["region_id"] = json!(punjab);
    let response = put_section(&app, &member, "location", body).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["location"]["city"], Value::Null);
    assert_eq!(response.json["location"]["city_other"], "Smalltown");

    // Living abroad needs a residency status (rule 4).
    let (london, _) = city(&app, "GB", "London").await;
    let abroad = json!({
        "nationality_code": "PK", "country_code": "GB", "region_id": null, "city_id": london,
        "city_other": null, "area": null, "residency_status": null,
        "origin_city_id": null, "origin_other": null, "relocation": null
    });
    let response = put_section(&app, &member, "location", abroad.clone()).await;
    assert_eq!(fields(&response), ["residency_status:required"]);
    let mut body = abroad;
    body["residency_status"] = json!("work_visa");
    let response = put_section(&app, &member, "location", body).await;
    assert_eq!(response.status, 200, "{}", response.text);

    // The city can be cleared in a draft but not afterwards.
    let draft = app.draft_user().await;
    let mut body = base;
    body["city_other"] = Value::Null;
    assert_eq!(
        put_section(&app, &draft, "location", body.clone())
            .await
            .status,
        200
    );
    assert_eq!(
        fields(&put_section(&app, &member, "location", body).await),
        ["city_id:required"]
    );
}

#[sqlx::test]
async fn education_career_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    let mut body = education_body();
    body["education_field_code"] = json!("computer_science_it");
    body["degree_title"] = json!("BS Computer Science");
    body["job_title"] = json!("Software engineer");
    body["income_band_code"] = json!("pkr_4");
    let response = put_section(&app, &user, "education_career", body.clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(
        response.json["education_career"]["income_band_code"],
        "pkr_4"
    );

    // No work details for these employment types, whatever was sent (rule 2).
    for employment in ["student", "homemaker", "not_working"] {
        body["employment_type"] = json!(employment);
        let response = put_section(&app, &user, "education_career", body.clone()).await;
        let section = &response.json["education_career"];
        assert_eq!(section["profession_code"], Value::Null, "{employment}");
        assert_eq!(section["job_title"], Value::Null);
        assert_eq!(section["income_band_code"], Value::Null);
        assert_eq!(section["degree_title"], "BS Computer Science");
    }

    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = education_body();
        change(&mut body);
        body
    };
    let cases: Vec<(Value, &str)> = vec![
        (
            with(&|b| b["education_level_code"] = json!("wizard")),
            "education_level_code:unknown_code",
        ),
        (
            with(&|b| b["education_field_code"] = json!("alchemy")),
            "education_field_code:unknown_code",
        ),
        (
            with(&|b| b["profession_code"] = json!("alchemist")),
            "profession_code:unknown_code",
        ),
        (
            with(&|b| b["income_band_code"] = json!("gold_1")),
            "income_band_code:unknown_code",
        ),
        (
            with(&|b| b["job_title"] = json!("a".repeat(81))),
            "job_title:too_long",
        ),
        (
            with(&|b| b["employer_name"] = json!("a".repeat(121))),
            "employer_name:too_long",
        ),
        (
            with(&|b| b["degree_title"] = json!("call 0300 1234567 for details")),
            "degree_title:contains_contact_info",
        ),
        (
            with(&|b| b["institute_name"] = json!("hookup university")),
            "institute_name:inappropriate",
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &user, "education_career", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), [expected], "{body}");
    }

    // Required after the draft.
    let member = app.member().await;
    let mut body = education_body();
    body["education_level_code"] = Value::Null;
    body["employment_type"] = Value::Null;
    let response = put_section(&app, &member, "education_career", body).await;
    assert_eq!(
        fields(&response),
        ["education_level_code:required", "employment_type:required"]
    );
}

fn family_body() -> Value {
    json!({
        "father_status": "alive", "father_occupation": "Retired teacher",
        "mother_status": "alive", "mother_occupation": "Homemaker",
        "brothers_count": 2, "brothers_married": 1, "sisters_count": 1, "sisters_married": 0,
        "family_type": "joint", "family_class": "middle", "family_values": "traditional",
        "family_country_code": null, "family_city_id": null,
        "home_ownership": "owned", "home_type": "house", "home_size_value": 10.5,
        "home_size_unit": "marla", "about_family": null
    })
}

#[sqlx::test]
async fn family_saves_and_checks_the_numbers(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let response = put_section(&app, &user, "family", family_body()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    let family = &response.json["family"];
    assert_eq!(family["brothers_count"], 2);
    assert_eq!(family["home_size_value"], 10.5);
    assert_eq!(family["family_type"], "joint");
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM profile_family WHERE profile_id = $1")
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(rows, 1);

    let (london, _) = city(&app, "GB", "London").await;
    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = family_body();
        change(&mut body);
        body
    };
    let cases: Vec<(Value, &str)> = vec![
        (
            with(&|b| b["brothers_married"] = json!(3)),
            "brothers_married:out_of_range",
        ),
        (
            with(&|b| b["sisters_married"] = json!(2)),
            "sisters_married:out_of_range",
        ),
        (
            with(&|b| {
                b["brothers_count"] = Value::Null;
            }),
            "brothers_count:required",
        ),
        (
            with(&|b| b["brothers_count"] = json!(16)),
            "brothers_count:out_of_range",
        ),
        (
            with(&|b| b["home_size_unit"] = Value::Null),
            "home_size_unit:required",
        ),
        (
            with(&|b| b["home_size_value"] = Value::Null),
            "home_size_value:required",
        ),
        (
            with(&|b| b["home_size_value"] = json!(0)),
            "home_size_value:out_of_range",
        ),
        (
            with(&|b| b["home_size_value"] = json!(100_000)),
            "home_size_value:out_of_range",
        ),
        (
            with(&|b| b["home_size_value"] = json!(1.234)),
            "home_size_value:invalid",
        ),
        (
            with(&|b| b["family_city_id"] = json!(london)),
            "family_country_code:required",
        ),
        (
            with(&|b| {
                b["family_country_code"] = json!("PK");
                b["family_city_id"] = json!(london);
            }),
            "family_city_id:mismatch",
        ),
        (
            with(&|b| b["father_occupation"] = json!("a".repeat(81))),
            "father_occupation:too_long",
        ),
        (
            with(&|b| b["about_family"] = json!("We are a small family.")),
            "about_family:too_short",
        ),
        (
            with(&|b| {
                b["about_family"] = json!(
                    "We live nearby, call us on 0300 1234567 any time for more about the family."
                );
            }),
            "about_family:contains_contact_info",
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &user, "family", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), [expected], "{body}");
    }
}

const ABOUT_FAMILY: &str = "We are a close family from Lahore. My father is a retired teacher and my mother runs the home.";

#[sqlx::test]
async fn a_changed_text_is_held_for_review_and_cleared_text_is_approved(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let mut body = family_body();
    body["about_family"] = json!(ABOUT_FAMILY);

    let response = put_section(&app, &user, "family", body.clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["text_status"]["about_family"], "pending");
    assert_eq!(response.json["family"]["about_family"], ABOUT_FAMILY);
    let jobs = app.queued_jobs("moderate_text").await;
    assert_eq!(
        jobs,
        [json!({ "profile_id": user.profile_id, "field": "about_family" })]
    );

    // The same text again changes nothing and queues nothing more.
    let response = put_section(&app, &user, "family", body.clone()).await;
    assert_eq!(response.json["text_status"]["about_family"], "pending");
    assert_eq!(app.queued_jobs("moderate_text").await.len(), 1);

    // An approved text that is saved unchanged stays approved.
    sqlx::query("UPDATE profile_family SET about_family_status = 'approved' WHERE profile_id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    sqlx::query("DELETE FROM jobs")
        .execute(app.db())
        .await
        .unwrap();
    let response = put_section(&app, &user, "family", body.clone()).await;
    assert_eq!(response.json["text_status"]["about_family"], "approved");
    assert!(app.queued_jobs("moderate_text").await.is_empty());

    // A rejected text stays rejected until it is edited (03 section 4.5).
    sqlx::query("UPDATE profile_family SET about_family_status = 'rejected' WHERE profile_id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    let response = put_section(&app, &user, "family", body.clone()).await;
    assert_eq!(response.json["text_status"]["about_family"], "rejected");
    body["about_family"] = json!(format!(
        "{ABOUT_FAMILY} We are happy to meet other families."
    ));
    let response = put_section(&app, &user, "family", body.clone()).await;
    assert_eq!(response.json["text_status"]["about_family"], "pending");
    assert_eq!(app.queued_jobs("moderate_text").await.len(), 1);

    // Clearing the text approves it.
    body["about_family"] = Value::Null;
    let response = put_section(&app, &user, "family", body).await;
    assert_eq!(response.json["text_status"]["about_family"], "approved");
}

fn lifestyle_body() -> Value {
    json!({
        "religiosity": "practising", "prayer_frequency": "five_times", "hijab": null,
        "beard": "trimmed", "religious_education": "nazra", "smoking": "no",
        "living_arrangement": "with_family", "work_after_marriage": "flexible",
        "marriage_timeline": "within_1_year", "jahez_stance": "no_demand", "weight_kg": 72,
        "complexion": "wheatish", "body_type": "average", "blood_group": "o_pos",
        "disability": "none", "disability_details": null,
        "hobby_codes": ["cricket", "football"], "about_me": null
    })
}

const ABOUT_ME: &str = "I work as a software engineer and spend my weekends with family. \
    Faith and honesty matter most to me, and I enjoy cricket with friends.";

#[sqlx::test]
async fn lifestyle_saves_and_replaces_the_hobbies(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    save(&app, &user, "basics", basics_body(Gender::Male)).await;

    let mut body = lifestyle_body();
    body["about_me"] = json!(ABOUT_ME);
    body["hobby_codes"] = json!(["football", "cricket", "cricket"]);
    let response = put_section(&app, &user, "lifestyle", body.clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    let lifestyle = &response.json["lifestyle"];
    assert_eq!(lifestyle["hobby_codes"], json!(["cricket", "football"]));
    assert_eq!(lifestyle["beard"], "trimmed");
    assert_eq!(lifestyle["weight_kg"], 72);
    assert_eq!(response.json["text_status"]["about_me"], "pending");
    assert_eq!(
        app.queued_jobs("moderate_text").await,
        [json!({ "profile_id": user.profile_id, "field": "about_me" })]
    );

    // The hobbies are replaced as a whole.
    body["hobby_codes"] = json!(["badminton"]);
    let response = put_section(&app, &user, "lifestyle", body.clone()).await;
    assert_eq!(
        response.json["lifestyle"]["hobby_codes"],
        json!(["badminton"])
    );

    // Details of a disability only go with a disability (rule 3).
    body["disability_details"] = json!("None really");
    let response = put_section(&app, &user, "lifestyle", body.clone()).await;
    assert_eq!(
        response.json["lifestyle"]["disability_details"],
        Value::Null
    );
    body["disability"] = json!("hearing");
    body["disability_details"] = json!("Mild hearing loss in one ear");
    let response = put_section(&app, &user, "lifestyle", body).await;
    assert_eq!(
        response.json["lifestyle"]["disability_details"],
        "Mild hearing loss in one ear"
    );
}

#[sqlx::test]
async fn lifestyle_rules(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.draft_user().await;
    save(&app, &man, "basics", basics_body(Gender::Male)).await;
    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = lifestyle_body();
        change(&mut body);
        body
    };

    let cases: Vec<(Value, &str)> = vec![
        (with(&|b| b["hijab"] = json!("hijab")), "hijab:not_allowed"),
        (
            with(&|b| b["weight_kg"] = json!(29)),
            "weight_kg:out_of_range",
        ),
        (
            with(&|b| b["weight_kg"] = json!(201)),
            "weight_kg:out_of_range",
        ),
        (
            with(&|b| b["hobby_codes"] = json!(["knitting_on_mars"])),
            "hobby_codes:unknown_code",
        ),
        (
            with(&|b| b["about_me"] = json!("Too short to count.")),
            "about_me:too_short",
        ),
        (
            with(&|b| {
                b["about_me"] = json!(format!("{ABOUT_ME} Message me on whatsapp 0300 1234567."));
            }),
            "about_me:contains_contact_info",
        ),
        (
            with(&|b| {
                b["about_me"] = json!(format!("{ABOUT_ME} I want a hookup, nothing serious."))
            }),
            "about_me:inappropriate",
        ),
        (
            with(&|b| b["about_me"] = json!("a ".repeat(800))),
            "about_me:too_long",
        ),
        (
            with(&|b| {
                b["disability"] = json!("other");
                b["disability_details"] = json!("x".repeat(301));
            }),
            "disability_details:too_long",
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &man, "lifestyle", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), [expected], "{body}");
    }

    // Eleven hobbies are one too many; ten are fine.
    let hobbies: Vec<String> =
        sqlx::query_scalar("SELECT code FROM hobbies ORDER BY code LIMIT 11")
            .fetch_all(app.db())
            .await
            .unwrap();
    let response = put_section(
        &app,
        &man,
        "lifestyle",
        with(&|b| b["hobby_codes"] = json!(hobbies)),
    )
    .await;
    assert_eq!(fields(&response), ["hobby_codes:too_long"]);
    let response = put_section(
        &app,
        &man,
        "lifestyle",
        with(&|b| b["hobby_codes"] = json!(&hobbies[..10])),
    )
    .await;
    assert_eq!(response.status, 200, "{}", response.text);

    // A beard is for men only.
    let woman = app.draft_user().await;
    save(&app, &woman, "basics", basics_body(Gender::Female)).await;
    let response = put_section(&app, &woman, "lifestyle", lifestyle_body()).await;
    assert_eq!(fields(&response), ["beard:not_allowed"]);
    let mut body = lifestyle_body();
    body["beard"] = Value::Null;
    body["hijab"] = json!("hijab");
    assert_eq!(
        put_section(&app, &woman, "lifestyle", body).await.status,
        200
    );
}

#[sqlx::test]
async fn contacts_are_saved_and_checked(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let body = json!({
        "phone_e164": "+923001234567", "whatsapp_e164": "+923001234567",
        "contact_email": "ahmed@example.com", "guardian_name": "Imran Khan",
        "guardian_relation": "father", "guardian_phone_e164": "+923331234567",
        "preferred_contact": "guardian", "best_time_to_call": "Evenings after 7 pm"
    });
    let response = put_section(&app, &user, "contacts", body.clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["contacts"], body);
    assert_eq!(profile_of(&app, &user).await["contacts"], body);

    // Everything can be cleared again, and the preferred contact defaults to `self`.
    let response = put_section(&app, &user, "contacts", json!({})).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["contacts"]["phone_e164"], Value::Null);
    assert_eq!(response.json["contacts"]["preferred_contact"], "self");

    let with = |change: &dyn Fn(&mut Value)| {
        let mut body = json!({ "preferred_contact": "self" });
        change(&mut body);
        body
    };
    let cases: Vec<(Value, Vec<&str>)> = vec![
        (
            with(&|b| b["phone_e164"] = json!("03001234567")),
            vec!["phone_e164:invalid"],
        ),
        (
            with(&|b| b["phone_e164"] = json!("+9230012345")),
            vec!["phone_e164:invalid"],
        ),
        (
            with(&|b| b["whatsapp_e164"] = json!("+92 300 1234567")),
            vec!["whatsapp_e164:invalid"],
        ),
        (
            with(&|b| b["phone_e164"] = json!("+0123456789")),
            vec!["phone_e164:invalid"],
        ),
        (
            with(&|b| b["contact_email"] = json!("ahmed.example.com")),
            vec!["contact_email:invalid"],
        ),
        (
            with(&|b| b["contact_email"] = json!("a@b")),
            vec!["contact_email:invalid"],
        ),
        (
            with(&|b| b["contact_email"] = json!(format!("{}@example.com", "a".repeat(250)))),
            vec!["contact_email:too_long"],
        ),
        (
            with(&|b| b["best_time_to_call"] = json!("a".repeat(81))),
            vec!["best_time_to_call:too_long"],
        ),
        (
            with(&|b| b["best_time_to_call"] = json!("call 0300 1234567")),
            vec!["best_time_to_call:contains_contact_info"],
        ),
        // The guardian fields go together (3.4 rule 1) and `guardian` needs them (rule 2).
        (
            with(&|b| b["guardian_name"] = json!("Imran Khan")),
            vec!["guardian_phone_e164:required", "guardian_relation:required"],
        ),
        (
            with(&|b| b["preferred_contact"] = json!("guardian")),
            vec![
                "guardian_name:required",
                "guardian_phone_e164:required",
                "guardian_relation:required",
            ],
        ),
        (
            with(&|b| {
                b["guardian_name"] = json!("I1");
                b["guardian_relation"] = json!("father");
                b["guardian_phone_e164"] = json!("+923331234567");
            }),
            vec!["guardian_name:invalid"],
        ),
    ];
    for (body, expected) in cases {
        let response = put_section(&app, &user, "contacts", body.clone()).await;
        assert_eq!(response.status, 400, "{body}");
        assert_eq!(fields(&response), expected, "{body}");
    }
    // Phones of other countries only need to be E.164.
    let body = with(&|b| b["phone_e164"] = json!("+447911123456"));
    assert_eq!(put_section(&app, &user, "contacts", body).await.status, 200);
}

#[sqlx::test]
async fn every_section_but_contacts_marks_the_recommendations_stale(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let stale = || async {
        let value: bool = sqlx::query_scalar("SELECT match_stale FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        value
    };
    let reset = || async {
        sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
            .bind(user.profile_id)
            .execute(app.db())
            .await
            .unwrap();
    };

    reset().await;
    save(
        &app,
        &user,
        "contacts",
        json!({ "phone_e164": "+923001234567" }),
    )
    .await;
    assert!(
        !stale().await,
        "contacts do not feed matching (10 section 8.2)"
    );

    for (section, body) in [
        ("account_for", json!({ "managed_by": "self" })),
        ("basics", profile_of(&app, &user).await["basics"].clone()),
        ("community", community_body()),
        ("location", location_body(&app).await),
        ("education_career", education_body()),
        ("family", family_body()),
        ("lifestyle", lifestyle_body()),
    ] {
        reset().await;
        save(&app, &user, section, body).await;
        assert!(stale().await, "{section} marks the recommendations stale");
    }
}

#[sqlx::test]
async fn the_own_profile_round_trips_through_its_own_sections(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let profile = profile_of(&app, &user).await;
    // "Section objects are exactly the bodies accepted by PUT" (15 section 4.3).
    for section in [
        "account_for",
        "basics",
        "community",
        "education_career",
        "family",
        "lifestyle",
        "contacts",
    ] {
        let response = put_section(&app, &user, section, profile[section].clone()).await;
        assert_eq!(response.status, 200, "{section}: {}", response.text);
    }
    let mut location = profile["location"].clone();
    location.as_object_mut().unwrap().remove("city");
    location.as_object_mut().unwrap().remove("origin_city");
    let response = put_section(&app, &user, "location", location).await;
    assert_eq!(response.status, 200, "{}", response.text);
}

#[sqlx::test]
async fn gender_and_date_of_birth_are_locked_after_onboarding(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let profile = profile_of(&app, &user).await;
    assert_eq!(profile["locked_fields"], json!(["gender", "date_of_birth"]));

    // The current values are accepted.
    let response = put_section(&app, &user, "basics", profile["basics"].clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);

    let mut body = profile["basics"].clone();
    body["gender"] = json!("female");
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(fields(&response), ["gender:locked"]);

    let mut body = profile["basics"].clone();
    body["date_of_birth"] = json!(dob(30));
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(fields(&response), ["date_of_birth:locked"]);

    // A locked field cannot be cleared either: it is `locked`, not `required`.
    let mut body = profile["basics"].clone();
    body["date_of_birth"] = Value::Null;
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(fields(&response), ["date_of_birth:locked"]);

    // The names are not locked until the identity is verified (03 section 8 rule 15).
    let mut body = profile["basics"].clone();
    body["first_name"] = json!("Ahmad");
    assert_eq!(
        put_section(&app, &user, "basics", body.clone())
            .await
            .status,
        200
    );
    sqlx::query("UPDATE profiles SET is_id_verified = true WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    assert_eq!(
        profile_of(&app, &user).await["locked_fields"],
        json!(["gender", "date_of_birth", "first_name", "last_name"])
    );
    body["first_name"] = json!("Ahmed");
    body["last_name"] = json!("Raza");
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(fields(&response), ["first_name:locked", "last_name:locked"]);
}

#[sqlx::test]
async fn required_fields_cannot_be_cleared_after_the_draft(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let mut body = profile_of(&app, &user).await["basics"].clone();
    for field in ["first_name", "last_name", "marital_status", "height_cm"] {
        body[field] = Value::Null;
    }
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(
        fields(&response),
        [
            "first_name:required",
            "height_cm:required",
            "last_name:required",
            "marital_status:required"
        ]
    );
    // Nothing was written.
    assert_eq!(
        profile_of(&app, &user).await["basics"]["first_name"],
        "Ahmed"
    );
}

#[sqlx::test]
async fn saving_recomputes_the_completeness(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.member().await;
    let before = profile_of(&app, &user).await;
    assert!(
        before["missing"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "about_me")
    );

    let mut body = lifestyle_body();
    body["about_me"] = json!(format!(
        "{ABOUT_ME} I also volunteer at a local school on Sundays."
    ));
    let response = put_section(&app, &user, "lifestyle", body).await;
    let after = &response.json;
    assert!(after["completeness"].as_i64() > before["completeness"].as_i64());
    assert!(
        !after["missing"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "about_me")
    );
    assert!(
        !after["missing"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "religious_practice")
    );

    // The stored column agrees with the answer.
    let stored: i16 = sqlx::query_scalar("SELECT completeness FROM profiles WHERE id = $1")
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(i64::from(stored), after["completeness"].as_i64().unwrap());
}

#[sqlx::test]
async fn a_member_only_reaches_their_own_profile(db: PgPool) {
    let app = TestApp::new(db).await;
    let first = app.member().await;
    let second = app.member_of(Gender::Female).await;

    let first_profile = profile_of(&app, &first).await;
    let second_profile = profile_of(&app, &second).await;
    assert_eq!(first_profile["id"], json!(first.profile_id));
    assert_eq!(second_profile["id"], json!(second.profile_id));
    assert_ne!(first_profile["public_code"], second_profile["public_code"]);

    // Saving a section changes the caller's profile only.
    let mut body = lifestyle_body();
    body["beard"] = Value::Null;
    body["about_me"] = json!(ABOUT_ME);
    save(&app, &second, "lifestyle", body).await;
    let other = profile_of(&app, &first).await;
    assert_eq!(other["lifestyle"]["about_me"], Value::Null);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM profiles WHERE about_me IS NOT NULL AND id <> $1")
            .bind(second.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
async fn staff_have_a_profile_like_anyone_else(db: PgPool) {
    let app = TestApp::new(db).await;
    let moderator = app.staff(UserRole::Moderator).await;
    let profile = profile_of(&app, &moderator).await;
    assert_eq!(profile["id"], json!(moderator.profile_id));
}
