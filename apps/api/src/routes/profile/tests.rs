//! Tests of onboarding and the member's own profile (roadmap tasks T-102 to T-106).
//!
//! The helpers here build valid request bodies and script a member through onboarding. The
//! tests are grouped by area in the modules below.

mod identity;
mod onboarding;
mod preferences;
mod sections;
mod status;

use serde_json::{Value, json};
use time::{Date, Duration, OffsetDateTime};

use crate::domain::options::Gender;
use crate::domain::time::karachi_date;
use crate::test_support::{TestApp, TestResponse, TestUser};

/// A male CNIC (the last digit is odd) and a female one (even).
pub const MALE_CNIC: &str = "35202-1234567-1";
pub const FEMALE_CNIC: &str = "35202-1234567-2";

/// A CNIC that no other call returned, with the last digit of the gender (12 section 3.3).
pub fn unique_cnic(gender: Gender) -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let serial = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let check = if gender == Gender::Male { 1 } else { 2 };
    format!("35{serial:010}{check}")
}

/// A date of birth for someone who is `years` old today in `Asia/Karachi` (and a month into the
/// year, so that rounding never changes the age).
pub fn dob(years: i32) -> String {
    let today = karachi_date(OffsetDateTime::now_utc());
    let born: Date = today
        .replace_year(today.year() - years)
        .unwrap_or(today)
        .saturating_sub(Duration::days(30));
    born.to_string()
}

/// The id and region id of a seeded city.
pub async fn city(app: &TestApp, country: &str, name: &str) -> (i32, Option<i32>) {
    sqlx::query_as(
        "SELECT id, region_id FROM cities WHERE country_code = $1 AND name = $2
         ORDER BY population DESC NULLS LAST LIMIT 1",
    )
    .bind(country)
    .bind(name)
    .fetch_one(app.db())
    .await
    .expect("the city is in the seed")
}

pub fn consents() -> Value {
    json!([
        "terms",
        "privacy",
        "community_guidelines",
        "age_declaration"
    ])
}

pub fn account_for_body() -> Value {
    json!({ "managed_by": "self", "manager_name": null, "consents": consents() })
}

pub fn basics_body(gender: Gender) -> Value {
    let (first, last) = match gender {
        Gender::Male => ("Ahmed", "Khan"),
        Gender::Female => ("Ayesha", "Malik"),
    };
    json!({
        "first_name": first,
        "last_name": last,
        "gender": gender.as_str(),
        "date_of_birth": dob(28),
        "marital_status": "never_married",
        "children_status": "none",
        "children_count": null,
        "current_wives_count": null,
        "height_cm": 170,
    })
}

pub fn community_body() -> Value {
    json!({
        "religion_code": "islam",
        "sect_code": "sunni",
        "caste_code": null,
        "caste_other": null,
        "sub_caste_code": null,
        "sub_caste_other": null,
        "mother_tongue_code": "urdu",
        "language_codes": [],
    })
}

pub async fn location_body(app: &TestApp) -> Value {
    let (lahore, _) = city(app, "PK", "Lahore").await;
    json!({
        "nationality_code": "PK",
        "country_code": "PK",
        "region_id": null,
        "city_id": lahore,
        "city_other": null,
        "area": null,
        "residency_status": null,
        "origin_city_id": null,
        "origin_other": null,
        "relocation": null,
    })
}

pub fn education_body() -> Value {
    json!({
        "education_level_code": "bachelors",
        "education_field_code": null,
        "degree_title": null,
        "institute_name": null,
        "employment_type": "private_job",
        "profession_code": "software_it",
        "job_title": null,
        "employer_name": null,
        "income_band_code": null,
    })
}

pub async fn put_section(
    app: &TestApp,
    user: &TestUser,
    section: &str,
    body: Value,
) -> TestResponse {
    app.put(
        &format!("/v1/me/profile/sections/{section}"),
        Some(&user.token),
        body,
    )
    .await
}

pub async fn continue_step(app: &TestApp, user: &TestUser, step: &str) -> TestResponse {
    app.post(
        "/v1/me/onboarding/continue",
        Some(&user.token),
        json!({ "step": step }),
    )
    .await
}

/// Saves a section and expects `200`.
pub async fn save(app: &TestApp, user: &TestUser, section: &str, body: Value) {
    let response = put_section(app, user, section, body).await;
    assert_eq!(
        response.status, 200,
        "saving {section} failed: {}",
        response.text
    );
}

/// Continues a step and expects `200`.
pub async fn advance(app: &TestApp, user: &TestUser, step: &str) -> Value {
    let response = continue_step(app, user, step).await;
    assert_eq!(
        response.status, 200,
        "continuing {step} failed: {}",
        response.text
    );
    response.json
}

/// The steps of onboarding in order, with the work each one needs.
pub const STEPS: [&str; 10] = [
    "account_for",
    "basics",
    "community",
    "location",
    "education_career",
    "family",
    "lifestyle",
    "photos",
    "preferences",
    "identity",
];

/// Saves what one step needs (nothing for the skippable steps), without continuing it.
pub async fn do_step(app: &TestApp, user: &TestUser, gender: Gender, step: &str) {
    match step {
        "account_for" => save(app, user, "account_for", account_for_body()).await,
        "basics" => save(app, user, "basics", basics_body(gender)).await,
        "community" => save(app, user, "community", community_body()).await,
        "location" => save(app, user, "location", location_body(app).await).await,
        "education_career" => save(app, user, "education_career", education_body()).await,
        "preferences" => {
            let defaults = app.get("/v1/me/preferences", Some(&user.token)).await;
            assert_eq!(defaults.status, 200);
            let saved = app
                .put("/v1/me/preferences", Some(&user.token), defaults.json)
                .await;
            assert_eq!(saved.status, 200, "{}", saved.text);
        }
        "identity" => {
            let saved = app
                .put(
                    "/v1/me/identity",
                    Some(&user.token),
                    json!({ "document_type": "cnic", "number": unique_cnic(gender) }),
                )
                .await;
            assert_eq!(saved.status, 200, "{}", saved.text);
        }
        _ => {}
    }
}

/// Scripts a draft user through every step up to and including `last` (a step name from
/// [`STEPS`]), saving valid data and continuing each time.
pub async fn onboard_through(app: &TestApp, user: &TestUser, gender: Gender, last: &str) {
    for step in STEPS {
        do_step(app, user, gender, step).await;
        advance(app, user, step).await;
        if step == last {
            return;
        }
    }
}

/// A new member who finished onboarding through the API.
pub async fn onboarded(app: &TestApp, gender: Gender) -> TestUser {
    let user = app.draft_user().await;
    onboard_through(app, &user, gender, "identity").await;
    let done = app
        .post_empty("/v1/me/onboarding/complete", Some(&user.token))
        .await;
    assert_eq!(done.status, 200, "{}", done.text);
    user
}

/// `GET /v1/me/profile`.
pub async fn profile_of(app: &TestApp, user: &TestUser) -> Value {
    let response = app.get("/v1/me/profile", Some(&user.token)).await;
    assert_eq!(response.status, 200, "{}", response.text);
    response.json
}

/// The fields of a `validation_failed` answer, sorted.
pub fn fields(response: &TestResponse) -> Vec<String> {
    let mut fields = response.field_errors();
    fields.sort();
    fields
}
