//! Starting values: the computed partner preferences of a profile that has no
//! `partner_preferences` row (07 section 12), and the privacy defaults that depend on gender
//! (09 section 3.5, decision D-10 in 02).

use crate::domain::options::{
    ChildrenAcceptance, Gender, Importance, MaritalStatus, PhotoVisibility,
};
use crate::domain::preferences::Preferences;
use crate::domain::privacy::Privacy;
use crate::domain::types::ProfileStatus;

/// Lowest age a preference may ask for, and the fallback of `age_min` (07 section 12).
pub const AGE_FLOOR: i16 = 18;
/// Highest age a preference may ask for, and the fallback of `age_max` (07 section 12).
pub const AGE_CEILING: i16 = 80;

/// The facts of the profile that the defaults depend on (07 section 12). Any of them may still
/// be missing while the profile is in onboarding.
#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultsInput<'a> {
    pub gender: Option<Gender>,
    /// The candidate's age (`own_age`), see [`crate::domain::time::age_now`].
    pub age: Option<i32>,
    pub marital_status: Option<MaritalStatus>,
    pub religion_code: Option<&'a str>,
    pub country_code: Option<&'a str>,
}

/// The preferences `GET /v1/me/preferences` returns while the profile has no
/// `partner_preferences` row (07 section 12). Matching uses the same values for such a profile.
pub fn default_preferences(input: &DefaultsInput<'_>) -> Preferences {
    let (age_min, age_max) = default_age_range(input.gender, input.age);
    let marital_statuses = match input.marital_status {
        Some(MaritalStatus::NeverMarried) | None => vec![MaritalStatus::NeverMarried],
        Some(_) => vec![
            MaritalStatus::NeverMarried,
            MaritalStatus::Divorced,
            MaritalStatus::Widowed,
            MaritalStatus::NikahEndedBeforeRukhsati,
        ],
    };
    Preferences {
        age_min,
        age_max,
        age_importance: Importance::High,
        height_min_cm: None,
        height_max_cm: None,
        height_importance: Importance::Low,
        marital_statuses,
        marital_status_importance: Importance::High,
        children_acceptance: ChildrenAcceptance::Any,
        children_importance: Importance::Medium,
        religion_codes: own_code(input.religion_code),
        religion_importance: Importance::Must,
        sect_codes: Vec::new(),
        sect_importance: Importance::Medium,
        caste_codes: Vec::new(),
        caste_importance: Importance::Low,
        mother_tongue_codes: Vec::new(),
        mother_tongue_importance: Importance::Low,
        country_codes: own_code(input.country_code),
        region_ids: Vec::new(),
        city_ids: Vec::new(),
        location_importance: Importance::Medium,
        education_min_rank: None,
        education_importance: Importance::Medium,
        employment_types: Vec::new(),
        profession_codes: Vec::new(),
        profession_importance: Importance::Low,
        income_min_rank: None,
        income_importance: Importance::Low,
        religiosity_levels: Vec::new(),
        religiosity_importance: Importance::Medium,
        hijab_types: Vec::new(),
        beard_types: Vec::new(),
        appearance_importance: Importance::Low,
        family_values: Vec::new(),
        family_types: Vec::new(),
        family_importance: Importance::Low,
        living_arrangements: Vec::new(),
        living_arrangement_importance: Importance::Low,
        work_after_marriage_options: Vec::new(),
        work_after_marriage_importance: Importance::Low,
        smoking_options: Vec::new(),
        smoking_importance: Importance::Low,
        notes: None,
    }
}

/// `age_min` and `age_max` (07 section 12): a man looks from 8 years younger to 1 year older,
/// a woman from 1 year younger to 8 years older, within 18 to 80. Without a gender or an age
/// the range is 18 to 80.
fn default_age_range(gender: Option<Gender>, age: Option<i32>) -> (i16, i16) {
    let (Some(gender), Some(age)) = (gender, age) else {
        return (AGE_FLOOR, AGE_CEILING);
    };
    let (younger, older) = match gender {
        Gender::Male => (8, 1),
        Gender::Female => (1, 8),
    };
    (
        clamp_age(age.saturating_sub(younger)),
        clamp_age(age.saturating_add(older)),
    )
}

/// Limits an age to 18..=80.
fn clamp_age(age: i32) -> i16 {
    i16::try_from(age.clamp(i32::from(AGE_FLOOR), i32::from(AGE_CEILING))).unwrap_or(AGE_FLOOR)
}

/// `[own code]`, or `[]` when the profile has none yet.
fn own_code(code: Option<&str>) -> Vec<String> {
    code.filter(|code| !code.trim().is_empty())
        .map(str::to_owned)
        .into_iter()
        .collect()
}

/// The privacy settings a profile starts with once its gender is known (09 section 3.5).
///
/// These are the column defaults of 04 section 5.7, except that a female profile's photos are
/// visible only to people she sends an interest to and to connections (D-10). No other default
/// depends on gender.
pub fn default_privacy(gender: Option<Gender>) -> Privacy {
    let defaults = Privacy::default();
    match gender {
        Some(Gender::Female) => Privacy {
            photo_visibility: PhotoVisibility::InterestsAndConnections,
            ..defaults
        },
        Some(Gender::Male) | None => defaults,
    }
}

/// The new `photo_visibility` when the basics section is saved (09 section 3.5 rule 2, 07
/// section 4.2 rule 9), or `None` to leave it unchanged.
///
/// It changes only while the profile is `draft`, the saved gender is female, the value is still
/// the column default `members`, and the owner has not yet saved a choice of their own
/// (`owner_has_chosen`, for example through the onboarding photos step).
pub fn photo_visibility_after_basics(
    status: ProfileStatus,
    gender: Gender,
    current: PhotoVisibility,
    owner_has_chosen: bool,
) -> Option<PhotoVisibility> {
    let applies = status == ProfileStatus::Draft
        && gender == Gender::Female
        && current == PhotoVisibility::Members
        && !owner_has_chosen;
    applies.then_some(PhotoVisibility::InterestsAndConnections)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    /// Every column at its default; only the five computed columns differ between profiles.
    fn expected(
        age_min: i16,
        age_max: i16,
        marital_statuses: Vec<MaritalStatus>,
        religion_codes: &[&str],
        country_codes: &[&str],
    ) -> Preferences {
        Preferences {
            age_min,
            age_max,
            age_importance: Importance::High,
            height_min_cm: None,
            height_max_cm: None,
            height_importance: Importance::Low,
            marital_statuses,
            marital_status_importance: Importance::High,
            children_acceptance: ChildrenAcceptance::Any,
            children_importance: Importance::Medium,
            religion_codes: codes(religion_codes),
            religion_importance: Importance::Must,
            sect_codes: Vec::new(),
            sect_importance: Importance::Medium,
            caste_codes: Vec::new(),
            caste_importance: Importance::Low,
            mother_tongue_codes: Vec::new(),
            mother_tongue_importance: Importance::Low,
            country_codes: codes(country_codes),
            region_ids: Vec::new(),
            city_ids: Vec::new(),
            location_importance: Importance::Medium,
            education_min_rank: None,
            education_importance: Importance::Medium,
            employment_types: Vec::new(),
            profession_codes: Vec::new(),
            profession_importance: Importance::Low,
            income_min_rank: None,
            income_importance: Importance::Low,
            religiosity_levels: Vec::new(),
            religiosity_importance: Importance::Medium,
            hijab_types: Vec::new(),
            beard_types: Vec::new(),
            appearance_importance: Importance::Low,
            family_values: Vec::new(),
            family_types: Vec::new(),
            family_importance: Importance::Low,
            living_arrangements: Vec::new(),
            living_arrangement_importance: Importance::Low,
            work_after_marriage_options: Vec::new(),
            work_after_marriage_importance: Importance::Low,
            smoking_options: Vec::new(),
            smoking_importance: Importance::Low,
            notes: None,
        }
    }

    fn previously_married() -> Vec<MaritalStatus> {
        vec![
            MaritalStatus::NeverMarried,
            MaritalStatus::Divorced,
            MaritalStatus::Widowed,
            MaritalStatus::NikahEndedBeforeRukhsati,
        ]
    }

    #[test]
    fn man_29_never_married_muslim_in_pakistan() {
        let input = DefaultsInput {
            gender: Some(Gender::Male),
            age: Some(29),
            marital_status: Some(MaritalStatus::NeverMarried),
            religion_code: Some("islam"),
            country_code: Some("PK"),
        };
        assert_eq!(
            default_preferences(&input),
            expected(
                21,
                30,
                vec![MaritalStatus::NeverMarried],
                &["islam"],
                &["PK"]
            )
        );
    }

    #[test]
    fn woman_26_never_married_muslim_in_the_united_kingdom() {
        let input = DefaultsInput {
            gender: Some(Gender::Female),
            age: Some(26),
            marital_status: Some(MaritalStatus::NeverMarried),
            religion_code: Some("islam"),
            country_code: Some("GB"),
        };
        assert_eq!(
            default_preferences(&input),
            expected(
                25,
                34,
                vec![MaritalStatus::NeverMarried],
                &["islam"],
                &["GB"]
            )
        );
    }

    #[test]
    fn man_41_divorced_muslim_in_pakistan() {
        let input = DefaultsInput {
            gender: Some(Gender::Male),
            age: Some(41),
            marital_status: Some(MaritalStatus::Divorced),
            religion_code: Some("islam"),
            country_code: Some("PK"),
        };
        assert_eq!(
            default_preferences(&input),
            expected(33, 42, previously_married(), &["islam"], &["PK"])
        );
    }

    #[test]
    fn woman_18_never_married_christian_in_pakistan() {
        let input = DefaultsInput {
            gender: Some(Gender::Female),
            age: Some(18),
            marital_status: Some(MaritalStatus::NeverMarried),
            religion_code: Some("christianity"),
            country_code: Some("PK"),
        };
        assert_eq!(
            default_preferences(&input),
            expected(
                18,
                26,
                vec![MaritalStatus::NeverMarried],
                &["christianity"],
                &["PK"]
            )
        );
    }

    #[test]
    fn missing_facts_use_the_fallbacks() {
        assert_eq!(
            default_preferences(&DefaultsInput::default()),
            expected(18, 80, vec![MaritalStatus::NeverMarried], &[], &[])
        );
        // An age without a gender cannot choose a direction.
        let no_gender = DefaultsInput {
            age: Some(30),
            ..DefaultsInput::default()
        };
        let prefs = default_preferences(&no_gender);
        assert_eq!((prefs.age_min, prefs.age_max), (18, 80));
    }

    #[test]
    fn ages_stay_within_18_and_80() {
        let at = |gender, age| {
            let prefs = default_preferences(&DefaultsInput {
                gender: Some(gender),
                age: Some(age),
                ..DefaultsInput::default()
            });
            (prefs.age_min, prefs.age_max)
        };
        assert_eq!(at(Gender::Male, 80), (72, 80));
        assert_eq!(at(Gender::Female, 79), (78, 80));
        assert_eq!(at(Gender::Male, 18), (18, 19));
    }

    #[test]
    fn defaults_never_accept_married_or_separated() {
        for status in MaritalStatus::ALL {
            let prefs = default_preferences(&DefaultsInput {
                marital_status: Some(*status),
                ..DefaultsInput::default()
            });
            assert!(!prefs.marital_statuses.contains(&MaritalStatus::Married));
            assert!(!prefs.marital_statuses.contains(&MaritalStatus::Separated));
        }
        // A married man looking for another marriage gets the wider default too.
        let married = default_preferences(&DefaultsInput {
            marital_status: Some(MaritalStatus::Married),
            ..DefaultsInput::default()
        });
        assert_eq!(married.marital_statuses, previously_married());
    }

    #[test]
    fn female_profiles_start_with_photos_for_interests_and_connections() {
        let female = default_privacy(Some(Gender::Female));
        assert_eq!(
            female.photo_visibility,
            PhotoVisibility::InterestsAndConnections
        );
        assert_eq!(
            Privacy {
                photo_visibility: PhotoVisibility::Members,
                ..female
            },
            Privacy::default()
        );
        assert_eq!(default_privacy(Some(Gender::Male)), Privacy::default());
        assert_eq!(default_privacy(None), Privacy::default());
    }

    #[test]
    fn saving_basics_as_female_in_draft_sets_the_photo_default_once() {
        let save = |status, gender, current, chosen| {
            photo_visibility_after_basics(status, gender, current, chosen)
        };
        assert_eq!(
            save(
                ProfileStatus::Draft,
                Gender::Female,
                PhotoVisibility::Members,
                false
            ),
            Some(PhotoVisibility::InterestsAndConnections)
        );
        // Male profiles keep the column default.
        assert_eq!(
            save(
                ProfileStatus::Draft,
                Gender::Male,
                PhotoVisibility::Members,
                false
            ),
            None
        );
        // Never after the owner has chosen, even if the choice was `members`.
        assert_eq!(
            save(
                ProfileStatus::Draft,
                Gender::Female,
                PhotoVisibility::Members,
                true
            ),
            None
        );
        // Never outside onboarding.
        assert_eq!(
            save(
                ProfileStatus::Active,
                Gender::Female,
                PhotoVisibility::Members,
                false
            ),
            None
        );
        // Already changed from the column default.
        assert_eq!(
            save(
                ProfileStatus::Draft,
                Gender::Female,
                PhotoVisibility::Connections,
                false
            ),
            None
        );
    }
}
