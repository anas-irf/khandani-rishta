//! `continue`, `complete` and `resubmit` (T-106).

use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};

use super::{
    STEPS, advance, basics_body, continue_step, do_step, fields, onboard_through, onboarded,
    profile_of, put_section, save,
};
use crate::domain::options::Gender;
use crate::domain::time::karachi_date;
use crate::domain::types::ProfileStatus;
use crate::test_support::{TestApp, TestUser};

async fn set_step(app: &TestApp, user: &TestUser, step: &str) {
    sqlx::query("UPDATE profiles SET onboarding_step = $2 WHERE id = $1")
        .bind(user.profile_id)
        .bind(step)
        .execute(app.db())
        .await
        .unwrap();
    app.state.accounts.invalidate(user.user_id);
}

async fn complete(app: &TestApp, user: &TestUser) -> crate::test_support::TestResponse {
    app.post_empty("/v1/me/onboarding/complete", Some(&user.token))
        .await
}

async fn setting(app: &TestApp, key: &str, value: Value) {
    app.state
        .settings
        .put(key, &value, None)
        .await
        .expect("the setting saves");
}

#[sqlx::test]
async fn a_scripted_run_through_every_step_ends_active(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let me = app.get("/v1/me", Some(&user.token)).await;
    assert_eq!(me.json["gate"], "onboarding");
    assert_eq!(me.json["profile"]["onboarding_step"], "account_for");

    for (index, step) in STEPS.iter().enumerate() {
        do_step(&app, &user, Gender::Male, step).await;
        let me = advance(&app, &user, step).await;
        let next = STEPS.get(index + 1).copied().unwrap_or("review");
        assert_eq!(me["profile"]["onboarding_step"], next, "after {step}");
        assert_eq!(me["gate"], "onboarding");
        assert_eq!(me["profile"]["status"], "draft");
    }

    let done = complete(&app, &user).await;
    assert_eq!(done.status, 200, "{}", done.text);
    assert_eq!(done.json["gate"], "ok");
    assert_eq!(done.json["profile"]["status"], "active");
    assert_eq!(done.json["profile"]["onboarding_step"], "done");
    assert_eq!(done.json["profile"]["first_name"], "Ahmed");
    assert!(done.json["profile"]["completeness"].as_i64().unwrap() > 20);

    // The first activation, the first refresh and the welcome email (15 section 7, 14).
    let (activated, completed, stale): (Option<OffsetDateTime>, Option<OffsetDateTime>, bool) =
        sqlx::query_as(
            "SELECT first_activated_at, onboarding_completed_at, match_stale
             FROM profiles WHERE id = $1",
        )
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert!(activated.is_some() && completed.is_some() && stale);
    assert_eq!(
        app.queued_jobs("refresh_recommendations").await,
        [json!({ "profile_id": user.profile_id, "notify": false })]
    );
    let emails = app.queued_jobs("send_email").await;
    assert_eq!(emails.len(), 1);
    assert_eq!(emails[0]["template"], "welcome");
    assert_eq!(emails[0]["user_id"], json!(user.user_id));

    // The profile now shows what a finished one shows.
    let profile = profile_of(&app, &user).await;
    assert_eq!(profile["status"], "active");
    assert_eq!(profile["locked_fields"], json!(["gender", "date_of_birth"]));
    assert_eq!(profile["identity"]["document_type"], "cnic");
    assert_eq!(profile["identity"]["status"], "unverified");
    let missing = profile["missing"].as_array().unwrap();
    assert!(
        !missing
            .iter()
            .any(|item| item == "core" || item == "identity")
    );
    assert!(!missing.iter().any(|item| item == "partner_preferences"));

    // It cannot be completed or continued again.
    assert_eq!(complete(&app, &user).await.code(), "invalid_state");
    assert_eq!(
        continue_step(&app, &user, "done").await.code(),
        "invalid_state"
    );
}

#[sqlx::test]
async fn a_woman_completes_onboarding_with_a_female_number(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = onboarded(&app, Gender::Female).await;
    let me = app.get("/v1/me", Some(&user.token)).await;
    assert_eq!(me.json["gate"], "ok");
    assert_eq!(me.json["profile"]["gender"], "female");
    let privacy = app.get("/v1/me/privacy", Some(&user.token)).await;
    assert_eq!(
        privacy.json["photo_visibility"],
        "interests_and_connections"
    );
}

#[sqlx::test]
async fn continue_needs_the_current_step(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    let response = continue_step(&app, &user, "basics").await;
    assert_eq!(response.status, 409);
    assert_eq!(response.code(), "invalid_state");
    assert_eq!(
        response.json["error"]["details"]["onboarding_step"],
        "account_for"
    );
    assert_eq!(
        continue_step(&app, &user, "nonsense").await.code(),
        "invalid_state"
    );

    // `review` and `done` are not continued: `complete` finishes onboarding.
    for step in ["review", "done"] {
        set_step(&app, &user, step).await;
        let response = continue_step(&app, &user, step).await;
        assert_eq!(response.code(), "invalid_state", "{step}");
    }

    // A profile that is not a draft has nothing to continue.
    let member = app.member().await;
    let response = continue_step(&app, &member, "done").await;
    assert_eq!(response.code(), "invalid_state");
    assert_eq!(response.json["error"]["details"]["status"], "active");
}

#[sqlx::test]
async fn onboarding_endpoints_need_an_open_account(db: PgPool) {
    let app = TestApp::new(db).await;
    let body = json!({ "step": "account_for" });
    let response = app
        .post("/v1/me/onboarding/continue", None, body.clone())
        .await;
    assert_eq!(response.code(), "unauthenticated");
    assert_eq!(
        app.post_empty("/v1/me/onboarding/complete", None)
            .await
            .code(),
        "unauthenticated"
    );
    let suspended = app
        .member_with(|spec| spec.status = ProfileStatus::Suspended)
        .await;
    let response = app
        .post("/v1/me/onboarding/continue", Some(&suspended.token), body)
        .await;
    assert_eq!(response.code(), "account_suspended");
    assert_eq!(complete(&app, &suspended).await.code(), "account_suspended");
    let response = app
        .post_empty("/v1/me/profile/resubmit", Some(&suspended.token))
        .await;
    assert_eq!(response.code(), "account_suspended");

    // Unknown keys are refused.
    let user = app.draft_user().await;
    let response = app
        .post(
            "/v1/me/onboarding/continue",
            Some(&user.token),
            json!({ "step": "account_for", "skip": true }),
        )
        .await;
    assert_eq!(response.code(), "bad_request");
}

#[sqlx::test]
async fn continue_names_the_missing_fields_of_each_step(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    let cases: [(&str, &[&str]); 7] = [
        ("account_for", &["consents:required", "managed_by:required"]),
        (
            "basics",
            &[
                "date_of_birth:required",
                "first_name:required",
                "gender:required",
                "height_cm:required",
                "last_name:required",
                "marital_status:required",
            ],
        ),
        (
            "community",
            &["mother_tongue_code:required", "religion_code:required"],
        ),
        ("location", &["city_id:required", "country_code:required"]),
        (
            "education_career",
            &["education_level_code:required", "employment_type:required"],
        ),
        ("preferences", &["preferences:required"]),
        ("identity", &["number:required"]),
    ];
    for (step, expected) in cases {
        set_step(&app, &user, step).await;
        let response = continue_step(&app, &user, step).await;
        assert_eq!(response.status, 400, "{step}: {}", response.text);
        assert_eq!(response.code(), "validation_failed");
        assert_eq!(fields(&response), expected, "{step}");
    }

    // The messages of 07 section 16.8.
    set_step(&app, &user, "identity").await;
    let response = continue_step(&app, &user, "identity").await;
    assert_eq!(
        response.json["error"]["fields"][0]["message"],
        "Enter the identity number to continue."
    );

    // Family and lifestyle have no requirement.
    for step in ["family", "lifestyle"] {
        set_step(&app, &user, step).await;
        let me = advance(&app, &user, step).await;
        assert_ne!(me["profile"]["onboarding_step"], step);
    }
}

#[sqlx::test]
async fn continue_checks_the_conditional_requirements(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    // A managed profile needs the manager's name and the candidate's consent (rule 4).
    save(
        &app,
        &user,
        "account_for",
        json!({
            "managed_by": "parent",
            "manager_name": null,
            "consents": ["terms", "privacy", "community_guidelines", "age_declaration"]
        }),
    )
    .await;
    let response = continue_step(&app, &user, "account_for").await;
    assert_eq!(
        fields(&response),
        ["consents:required", "manager_name:required"]
    );
    save(
        &app,
        &user,
        "account_for",
        json!({
            "managed_by": "parent",
            "manager_name": "Rukhsana Khan",
            "consents": ["candidate_consent"]
        }),
    )
    .await;
    advance(&app, &user, "account_for").await;

    // Children go with a past marriage.
    let mut body = basics_body(Gender::Male);
    body["marital_status"] = json!("divorced");
    body["children_status"] = Value::Null;
    save(&app, &user, "basics", body).await;
    let response = continue_step(&app, &user, "basics").await;
    assert_eq!(fields(&response), ["children_status:required"]);
    let mut body = basics_body(Gender::Male);
    body["marital_status"] = json!("divorced");
    body["children_status"] = json!("living_with_me");
    body["children_count"] = json!(1);
    save(&app, &user, "basics", body).await;
    advance(&app, &user, "basics").await;

    // A religion with sects needs one.
    let mut body = super::community_body();
    body["sect_code"] = Value::Null;
    save(&app, &user, "community", body).await;
    assert_eq!(
        fields(&continue_step(&app, &user, "community").await),
        ["sect_code:required"]
    );
    save(&app, &user, "community", super::community_body()).await;
    advance(&app, &user, "community").await;

    // A typed city in a country with regions needs a region; living abroad needs a status.
    let typed = json!({
        "nationality_code": "PK", "country_code": "PK", "region_id": null, "city_id": null,
        "city_other": "Smalltown", "area": null, "residency_status": null,
        "origin_city_id": null, "origin_other": null, "relocation": null
    });
    save(&app, &user, "location", typed).await;
    assert_eq!(
        fields(&continue_step(&app, &user, "location").await),
        ["region_id:required"]
    );
    let (london, _) = super::city(&app, "GB", "London").await;
    let abroad = json!({
        "nationality_code": "PK", "country_code": "GB", "region_id": null, "city_id": london,
        "city_other": null, "area": null, "residency_status": null,
        "origin_city_id": null, "origin_other": null, "relocation": null
    });
    save(&app, &user, "location", abroad).await;
    assert_eq!(
        fields(&continue_step(&app, &user, "location").await),
        ["residency_status:required"]
    );
}

#[sqlx::test]
async fn the_photo_and_identity_steps_are_skippable_unless_the_settings_say_otherwise(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    // Photos are optional at launch, and the identity number is required.
    set_step(&app, &user, "photos").await;
    advance(&app, &user, "photos").await;

    setting(&app, "onboarding.photo_required", json!(true)).await;
    set_step(&app, &user, "photos").await;
    let response = continue_step(&app, &user, "photos").await;
    assert_eq!(fields(&response), ["photos:required"]);
    assert_eq!(
        response.json["error"]["fields"][0]["message"],
        "Add at least one photo to continue."
    );

    // A photo that is rejected or failed does not count; one that is still being processed does.
    for status in ["rejected", "failed"] {
        sqlx::query(
            "INSERT INTO profile_photos (profile_id, status, upload_key) VALUES ($1, $2, $3)",
        )
        .bind(user.profile_id)
        .bind(status)
        .bind(format!("uploads/{status}"))
        .execute(app.db())
        .await
        .unwrap();
    }
    assert_eq!(
        fields(&continue_step(&app, &user, "photos").await),
        ["photos:required"]
    );
    sqlx::query("INSERT INTO profile_photos (profile_id, status, upload_key) VALUES ($1, 'processing', 'uploads/p')")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    advance(&app, &user, "photos").await;

    setting(&app, "onboarding.identity_required", json!(false)).await;
    set_step(&app, &user, "identity").await;
    advance(&app, &user, "identity").await;
    let me = app.get("/v1/me", Some(&user.token)).await;
    assert_eq!(me.json["profile"]["onboarding_step"], "review");
}

#[sqlx::test]
async fn nobody_under_eighteen_gets_through(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;

    // The save refuses it.
    let mut body = basics_body(Gender::Male);
    body["date_of_birth"] = json!(super::dob(17));
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(fields(&response), ["date_of_birth:too_young"]);

    // The 18th birthday is the first day that counts, in `Asia/Karachi`.
    let today = karachi_date(OffsetDateTime::now_utc());
    let eighteen = today.replace_year(today.year() - 18).unwrap();
    let mut body = basics_body(Gender::Male);
    body["date_of_birth"] = json!(eighteen.to_string());
    save(&app, &user, "basics", body).await;
    let tomorrow = eighteen + Duration::days(1);
    let mut body = basics_body(Gender::Male);
    body["date_of_birth"] = json!(tomorrow.to_string());
    let response = put_section(&app, &user, "basics", body).await;
    assert_eq!(fields(&response), ["date_of_birth:too_young"]);

    // `continue` and `complete` check the stored value again.
    onboard_through(&app, &user, Gender::Male, "identity").await;
    sqlx::query("UPDATE profiles SET date_of_birth = $2 WHERE id = $1")
        .bind(user.profile_id)
        .bind(tomorrow)
        .execute(app.db())
        .await
        .unwrap();
    let response = complete(&app, &user).await;
    assert_eq!(response.status, 400);
    assert_eq!(fields(&response), ["date_of_birth:too_young"]);
    set_step(&app, &user, "basics").await;
    let response = continue_step(&app, &user, "basics").await;
    assert_eq!(fields(&response), ["date_of_birth:too_young"]);
}

#[sqlx::test]
async fn complete_needs_the_review_step(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    let response = complete(&app, &user).await;
    assert_eq!(response.status, 409);
    assert_eq!(response.code(), "invalid_state");
    assert_eq!(
        response.json["error"]["details"]["onboarding_step"],
        "account_for"
    );
    let status: String = sqlx::query_scalar("SELECT status FROM profiles WHERE id = $1")
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(status, "draft");
}

#[sqlx::test]
async fn complete_checks_every_requirement_again(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app.draft_user().await;
    onboard_through(&app, &user, Gender::Male, "identity").await;

    // Things that went wrong after their step was continued.
    sqlx::query(
        "UPDATE profiles SET religion_code = NULL, sect_code = NULL, height_cm = NULL WHERE id = $1",
    )
    .bind(user.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    setting(&app, "onboarding.photo_required", json!(true)).await;
    sqlx::query("DELETE FROM profile_identity WHERE profile_id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    let response = complete(&app, &user).await;
    assert_eq!(response.status, 400);
    assert_eq!(
        fields(&response),
        [
            "height_cm:required",
            "number:required",
            "photos:required",
            "religion_code:required"
        ]
    );
    let me = app.get("/v1/me", Some(&user.token)).await;
    assert_eq!(me.json["profile"]["status"], "draft");
    assert_eq!(me.json["profile"]["onboarding_step"], "review");
}

#[sqlx::test]
async fn a_profile_goes_to_review_when_the_setting_or_a_signal_says_so(db: PgPool) {
    let app = TestApp::new(db).await;

    // `moderation.profile_review = manual` holds every new profile (13 section 2.2).
    setting(&app, "moderation.profile_review", json!("manual")).await;
    let held = app.draft_user().await;
    onboard_through(&app, &held, Gender::Male, "identity").await;
    let done = complete(&app, &held).await;
    assert_eq!(done.status, 200, "{}", done.text);
    assert_eq!(done.json["gate"], "pending_review");
    assert_eq!(done.json["profile"]["status"], "pending_review");
    assert_eq!(done.json["profile"]["onboarding_step"], "done");
    let activated: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT first_activated_at FROM profiles WHERE id = $1")
            .bind(held.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(
        activated.is_none(),
        "a profile in review has not been active yet"
    );
    assert!(
        app.queued_jobs("send_email").await.is_empty(),
        "no welcome email until it is live"
    );

    // An open system report about the profile does the same under `auto` (13 section 2.3).
    setting(&app, "moderation.profile_review", json!("auto")).await;
    let flagged = app.draft_user().await;
    onboard_through(&app, &flagged, Gender::Female, "identity").await;
    sqlx::query(
        "INSERT INTO reports (source, target_profile_id, subject_type, reason)
         VALUES ('system', $1, 'profile', 'other')",
    )
    .bind(flagged.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    let done = complete(&app, &flagged).await;
    assert_eq!(done.json["profile"]["status"], "pending_review");

    // A handled report no longer counts.
    let cleared = app.draft_user().await;
    onboard_through(&app, &cleared, Gender::Male, "identity").await;
    sqlx::query(
        "INSERT INTO reports (source, target_profile_id, subject_type, reason, status)
         VALUES ('system', $1, 'profile', 'other', 'dismissed')",
    )
    .bind(cleared.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    assert_eq!(
        complete(&app, &cleared).await.json["profile"]["status"],
        "active"
    );
}

#[sqlx::test]
async fn a_profile_with_changes_requested_can_be_resubmitted(db: PgPool) {
    let app = TestApp::new(db).await;
    setting(&app, "onboarding.identity_required", json!(false)).await;
    let user = app
        .member_with(|spec| spec.status = ProfileStatus::ChangesRequested)
        .await;
    sqlx::query(
        "UPDATE profiles SET status_reason = 'Please add a clearer description.' WHERE id = $1",
    )
    .bind(user.profile_id)
    .execute(app.db())
    .await
    .unwrap();
    let me = app.get("/v1/me", Some(&user.token)).await;
    assert_eq!(me.json["gate"], "changes_requested");
    assert_eq!(
        me.json["profile"]["status_reason"],
        "Please add a clearer description."
    );

    // A missing requirement stops it, the same way as `complete` (15 section 7).
    sqlx::query("UPDATE profiles SET sect_code = NULL WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();
    let response = app
        .post_empty("/v1/me/profile/resubmit", Some(&user.token))
        .await;
    assert_eq!(response.status, 400);
    assert_eq!(fields(&response), ["sect_code:required"]);
    sqlx::query("UPDATE profiles SET sect_code = 'sunni' WHERE id = $1")
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();

    let response = app
        .post_empty("/v1/me/profile/resubmit", Some(&user.token))
        .await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["gate"], "pending_review");
    assert_eq!(response.json["profile"]["status"], "pending_review");
    assert_eq!(response.json["profile"]["status_reason"], Value::Null);

    // Only a profile with changes requested can be resubmitted.
    let response = app
        .post_empty("/v1/me/profile/resubmit", Some(&user.token))
        .await;
    assert_eq!(response.code(), "invalid_state");
    assert_eq!(
        response.json["error"]["details"]["status"],
        "pending_review"
    );
    let active = app.member().await;
    let response = app
        .post_empty("/v1/me/profile/resubmit", Some(&active.token))
        .await;
    assert_eq!(response.code(), "invalid_state");
}

#[sqlx::test]
async fn editing_after_review_does_not_resubmit(db: PgPool) {
    let app = TestApp::new(db).await;
    let user = app
        .member_with(|spec| spec.status = ProfileStatus::ChangesRequested)
        .await;
    let profile = profile_of(&app, &user).await;
    let response = put_section(&app, &user, "community", profile["community"].clone()).await;
    assert_eq!(response.status, 200, "{}", response.text);
    assert_eq!(response.json["status"], "changes_requested");
}
