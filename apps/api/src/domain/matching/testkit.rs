//! Fixtures shared by the matching tests: two ordinary profiles, preferences with nothing set,
//! a small place lookup, and the two people of the worked example (10 section 12).

use time::macros::{date, datetime};
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::matching::subject::{City, Geo, Region, Subject, SubjectRows};
use crate::domain::options::{
    ChildrenAcceptance, EmploymentType, FamilyValues, FieldVisibility, Gender, Importance,
    LivingArrangement, MaritalStatus, MarriageTimeline, PrayerFrequency, Religiosity,
};
use crate::domain::preferences::Preferences;

pub type Rows = SubjectRows;

/// The date every fixture is measured on, in `Asia/Karachi`.
pub const TODAY: Date = date!(2026 - 11 - 20);
/// Noon UTC on [`TODAY`].
pub const NOW: OffsetDateTime = datetime!(2026-11-20 12:00 UTC);

pub const PUNJAB: i32 = 1;
pub const SINDH: i32 = 2;
pub const DUBAI_EMIRATE: i32 = 3;
pub const LAHORE: i32 = 10;
pub const FAISALABAD: i32 = 11;
pub const KARACHI: i32 = 20;
pub const DUBAI: i32 = 30;

/// Lahore and Faisalabad in Punjab, Karachi in Sindh (Pakistan), Dubai in the UAE.
pub fn geo() -> Geo {
    let mut geo = Geo::new();
    let region = |name: &str, country: &str| Region {
        name: name.into(),
        country_code: country.into(),
    };
    let city = |name: &str, region_id: i32, country: &str| City {
        name: name.into(),
        region_id: Some(region_id),
        country_code: country.into(),
    };
    geo.insert_region(PUNJAB, region("Punjab", "PK"));
    geo.insert_region(SINDH, region("Sindh", "PK"));
    geo.insert_region(DUBAI_EMIRATE, region("Dubai", "AE"));
    geo.insert_city(LAHORE, city("Lahore", PUNJAB, "PK"));
    geo.insert_city(FAISALABAD, city("Faisalabad", PUNJAB, "PK"));
    geo.insert_city(KARACHI, city("Karachi", SINDH, "PK"));
    geo.insert_city(DUBAI, city("Dubai", DUBAI_EMIRATE, "AE"));
    geo
}

/// A date of birth that makes the subject exactly `age` on [`TODAY`] (birthday in January).
pub fn born_years_ago(age: i32) -> Date {
    Date::from_calendar_date(TODAY.year() - age, time::Month::January, 15).unwrap_or(TODAY)
}

/// Builds the matchable view on [`TODAY`].
pub fn subject(rows: SubjectRows) -> Subject {
    Subject::from_rows(rows, TODAY)
}

/// A 30-year-old man in Lahore with plain values and every optional value empty.
pub fn man() -> SubjectRows {
    SubjectRows {
        id: Uuid::from_u128(1),
        gender: Gender::Male,
        date_of_birth: born_years_ago(30),
        height_cm: 175,
        marital_status: MaritalStatus::NeverMarried,
        children_status: None,
        religion_code: "islam".into(),
        sect_code: None,
        caste_code: None,
        caste_visibility: FieldVisibility::Members,
        mother_tongue_code: "urdu".into(),
        language_codes: Vec::new(),
        country_code: "PK".into(),
        region_id: Some(PUNJAB),
        city_id: Some(LAHORE),
        origin_city_id: None,
        relocation: None,
        education_rank: Some(5),
        employment_type: EmploymentType::PrivateJob,
        profession_code: None,
        income_rank: None,
        income_visibility: FieldVisibility::Connections,
        religiosity: None,
        prayer_frequency: None,
        hijab: None,
        beard: None,
        smoking: None,
        living_arrangement: None,
        work_after_marriage: None,
        marriage_timeline: None,
        family_values: None,
        family_type: None,
        family_visibility: FieldVisibility::Members,
        hobby_codes: Vec::new(),
        completeness: 50,
        has_approved_photo: false,
        is_phone_verified: false,
        is_photo_verified: false,
        is_id_verified: false,
        last_active_at: None,
        first_activated_at: None,
        show_last_active: true,
    }
}

/// A 26-year-old woman in Lahore, otherwise like [`man`].
pub fn woman() -> SubjectRows {
    SubjectRows {
        id: Uuid::from_u128(2),
        gender: Gender::Female,
        date_of_birth: born_years_ago(26),
        height_cm: 162,
        ..man()
    }
}

/// Preferences with no dimension set and every importance `medium`.
pub fn no_preferences() -> Preferences {
    let medium = Importance::Medium;
    Preferences {
        age_min: 18,
        age_max: 80,
        age_importance: medium,
        height_min_cm: None,
        height_max_cm: None,
        height_importance: medium,
        marital_statuses: Vec::new(),
        marital_status_importance: medium,
        children_acceptance: ChildrenAcceptance::Any,
        children_importance: medium,
        religion_codes: Vec::new(),
        religion_importance: medium,
        sect_codes: Vec::new(),
        sect_importance: medium,
        caste_codes: Vec::new(),
        caste_importance: medium,
        mother_tongue_codes: Vec::new(),
        mother_tongue_importance: medium,
        country_codes: Vec::new(),
        region_ids: Vec::new(),
        city_ids: Vec::new(),
        location_importance: medium,
        education_min_rank: None,
        education_importance: medium,
        employment_types: Vec::new(),
        profession_codes: Vec::new(),
        profession_importance: medium,
        income_min_rank: None,
        income_importance: medium,
        religiosity_levels: Vec::new(),
        religiosity_importance: medium,
        hijab_types: Vec::new(),
        beard_types: Vec::new(),
        appearance_importance: medium,
        family_values: Vec::new(),
        family_types: Vec::new(),
        family_importance: medium,
        living_arrangements: Vec::new(),
        living_arrangement_importance: medium,
        work_after_marriage_options: Vec::new(),
        work_after_marriage_importance: medium,
        smoking_options: Vec::new(),
        smoking_importance: medium,
        notes: None,
    }
}

/// 10 section 12, V: Ahmed, man, 29, Lahore (Punjab, PK). Income is stated but kept at the
/// default `connections` visibility, so it is unknown to matching.
pub fn ahmed() -> SubjectRows {
    SubjectRows {
        id: Uuid::from_u128(0xA),
        date_of_birth: born_years_ago(29),
        sect_code: Some("sunni".into()),
        caste_code: Some("arain".into()),
        caste_visibility: FieldVisibility::Members,
        mother_tongue_code: "punjabi".into(),
        city_id: Some(LAHORE),
        region_id: Some(PUNJAB),
        education_rank: Some(6),
        income_rank: Some(5),
        income_visibility: FieldVisibility::Connections,
        religiosity: Some(Religiosity::Practising),
        prayer_frequency: Some(PrayerFrequency::MostPrayers),
        family_values: Some(FamilyValues::Moderate),
        family_visibility: FieldVisibility::Members,
        hobby_codes: vec!["cricket".into(), "reading".into(), "travel".into()],
        marriage_timeline: Some(MarriageTimeline::Within1Year),
        living_arrangement: Some(LivingArrangement::WithFamily),
        ..man()
    }
}

/// 10 section 12, V's preferences.
pub fn ahmed_prefs() -> Preferences {
    Preferences {
        age_min: 23,
        age_max: 28,
        age_importance: Importance::High,
        religion_codes: vec!["islam".into()],
        religion_importance: Importance::Must,
        sect_codes: vec!["sunni".into()],
        sect_importance: Importance::Medium,
        marital_statuses: vec![MaritalStatus::NeverMarried],
        marital_status_importance: Importance::High,
        city_ids: vec![LAHORE],
        location_importance: Importance::Medium,
        education_min_rank: Some(5),
        education_importance: Importance::Medium,
        religiosity_levels: vec![Religiosity::Practising, Religiosity::ModeratelyPractising],
        religiosity_importance: Importance::Medium,
        ..no_preferences()
    }
}

/// 10 section 12, C: Fatima, woman, 26, Faisalabad (Punjab, PK).
pub fn fatima() -> SubjectRows {
    SubjectRows {
        id: Uuid::from_u128(0xF),
        gender: Gender::Female,
        date_of_birth: born_years_ago(26),
        height_cm: 162,
        marital_status: MaritalStatus::NeverMarried,
        sect_code: Some("sunni".into()),
        caste_code: Some("rajput".into()),
        caste_visibility: FieldVisibility::Members,
        mother_tongue_code: "punjabi".into(),
        city_id: Some(FAISALABAD),
        region_id: Some(PUNJAB),
        education_rank: Some(6),
        religiosity: Some(Religiosity::Practising),
        prayer_frequency: Some(PrayerFrequency::FiveTimes),
        family_values: Some(FamilyValues::Traditional),
        family_visibility: FieldVisibility::Members,
        hobby_codes: vec![
            "reading".into(),
            "cooking".into(),
            "travel".into(),
            "calligraphy".into(),
        ],
        marriage_timeline: Some(MarriageTimeline::Within6Months),
        living_arrangement: Some(LivingArrangement::Flexible),
        completeness: 80,
        has_approved_photo: true,
        is_id_verified: true,
        last_active_at: Some(NOW - Duration::days(3)),
        first_activated_at: Some(NOW - Duration::days(60)),
        ..man()
    }
}

/// 10 section 12, C's preferences.
pub fn fatima_prefs() -> Preferences {
    Preferences {
        age_min: 27,
        age_max: 33,
        age_importance: Importance::High,
        religion_codes: vec!["islam".into()],
        religion_importance: Importance::Must,
        education_min_rank: Some(6),
        education_importance: Importance::Must,
        income_min_rank: Some(4),
        income_importance: Importance::Medium,
        country_codes: vec!["PK".into()],
        location_importance: Importance::Low,
        marital_statuses: vec![MaritalStatus::NeverMarried],
        marital_status_importance: Importance::Must,
        ..no_preferences()
    }
}

/// Asserts two floats are equal up to rounding noise.
#[track_caller]
pub fn assert_close(actual: f64, expected: f64) {
    assert_near(actual, expected, 1e-9);
}

/// Asserts two floats are within `tolerance`.
#[track_caller]
pub fn assert_near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "expected {expected} (within {tolerance}), got {actual}"
    );
}
