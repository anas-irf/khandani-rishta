//! Profile completeness: the score stored in `profiles.completeness` and the ordered `missing`
//! list of `OwnProfile` (08 section 6).

use std::cmp::Reverse;

use time::Date;

use crate::domain::options::{
    EmploymentType, FamilyClass, FamilyType, FamilyValues, Gender, HomeOwnership,
    LivingArrangement, ManagedBy, MaritalStatus, MarriageTimeline, ParentStatus, PrayerFrequency,
    Religiosity, Relocation, WorkAfterMarriage,
};
use crate::domain::text_enum;
use crate::domain::types::{IdentityStatus, TextStatus};

text_enum! {
    /// Completeness items of 08 section 6.1, in table order. The code is the key sent in
    /// `OwnProfile.missing`.
    CompletenessItem {
        Core = "core",
        Photo = "photo",
        MorePhotos = "more_photos",
        AboutMe = "about_me",
        EducationDetails = "education_details",
        CareerDetails = "career_details",
        Income = "income",
        Family = "family",
        ReligiousPractice = "religious_practice",
        Plans = "plans",
        Relocation = "relocation",
        Hobbies = "hobbies",
        PartnerPreferences = "partner_preferences",
        Identity = "identity",
        IdVerified = "id_verified",
        PhotoVerified = "photo_verified",
    }
}

impl CompletenessItem {
    /// Points of the item (08 section 6.1). They add up to exactly 100.
    pub const fn points(self) -> u8 {
        match self {
            Self::Core => 20,
            Self::Photo => 15,
            Self::AboutMe | Self::Family => 10,
            Self::MorePhotos
            | Self::EducationDetails
            | Self::CareerDetails
            | Self::ReligiousPractice
            | Self::Plans => 5,
            Self::PartnerPreferences => 4,
            Self::Income | Self::Hobbies | Self::Identity | Self::IdVerified => 3,
            Self::Relocation | Self::PhotoVerified => 2,
        }
    }

    /// The item that must be met before this one is listed in `missing` (08 section 6.2).
    pub const fn depends_on(self) -> Option<Self> {
        match self {
            Self::MorePhotos | Self::PhotoVerified => Some(Self::Photo),
            Self::IdVerified => Some(Self::Identity),
            _ => None,
        }
    }
}

/// `about_me` needs at least this many characters (08 section 6.1 item 4).
pub const ABOUT_ME_MIN_CHARS: usize = 100;
/// Approved photos needed for `more_photos`.
pub const MORE_PHOTOS_MIN: usize = 3;
/// `profile_hobbies` rows needed for `hobbies`.
pub const HOBBIES_MIN: usize = 3;
/// Of the eight family columns of item 8, at least this many must be set.
pub const FAMILY_COLUMNS_MIN: usize = 6;

/// The eight `profile_family` columns counted by the `family` item. All `None` when the profile
/// has no `profile_family` row.
#[derive(Debug, Clone, Copy, Default)]
pub struct FamilyColumns {
    pub father_status: Option<ParentStatus>,
    pub mother_status: Option<ParentStatus>,
    pub brothers_count: Option<i16>,
    pub sisters_count: Option<i16>,
    pub family_type: Option<FamilyType>,
    pub family_class: Option<FamilyClass>,
    pub family_values: Option<FamilyValues>,
    pub home_ownership: Option<HomeOwnership>,
}

impl FamilyColumns {
    /// How many of the eight columns are set.
    pub fn set_count(&self) -> usize {
        [
            self.father_status.is_some(),
            self.mother_status.is_some(),
            self.brothers_count.is_some(),
            self.sisters_count.is_some(),
            self.family_type.is_some(),
            self.family_class.is_some(),
            self.family_values.is_some(),
            self.home_ownership.is_some(),
        ]
        .into_iter()
        .filter(|set| *set)
        .count()
    }
}

/// Everything the completeness rules read, as stored (08 section 6.1). Text and code columns are
/// set when they hold a non-blank value.
#[derive(Debug, Clone, Copy)]
pub struct CompletenessInput<'a> {
    // The columns of the `profiles_required_when_submitted` constraint (04 section 5.1).
    pub managed_by: Option<ManagedBy>,
    pub first_name: Option<&'a str>,
    pub last_name: Option<&'a str>,
    pub gender: Option<Gender>,
    pub date_of_birth: Option<Date>,
    pub marital_status: Option<MaritalStatus>,
    pub height_cm: Option<i16>,
    pub religion_code: Option<&'a str>,
    pub mother_tongue_code: Option<&'a str>,
    pub country_code: Option<&'a str>,
    pub city_id: Option<i32>,
    pub city_other: Option<&'a str>,
    pub education_level_code: Option<&'a str>,
    pub employment_type: Option<EmploymentType>,

    /// Number of `approved` photos. `profiles.has_approved_photo` is true exactly when this is
    /// above zero.
    pub approved_photos: usize,

    pub about_me: Option<&'a str>,
    pub about_me_status: TextStatus,

    pub education_field_code: Option<&'a str>,
    pub degree_title: Option<&'a str>,
    pub institute_name: Option<&'a str>,
    pub profession_code: Option<&'a str>,
    pub income_band_code: Option<&'a str>,

    pub family: FamilyColumns,

    pub religiosity: Option<Religiosity>,
    pub prayer_frequency: Option<PrayerFrequency>,
    pub living_arrangement: Option<LivingArrangement>,
    pub work_after_marriage: Option<WorkAfterMarriage>,
    pub marriage_timeline: Option<MarriageTimeline>,
    pub relocation: Option<Relocation>,

    /// Number of `profile_hobbies` rows.
    pub hobbies: usize,
    /// A `partner_preferences` row exists.
    pub has_partner_preferences: bool,
    /// `profile_identity.status`; `None` when the profile has no `profile_identity` row.
    pub identity: Option<IdentityStatus>,
    pub is_id_verified: bool,
    pub is_photo_verified: bool,
}

/// The completeness of a profile (08 section 6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Completeness {
    /// `profiles.completeness`, from 0 to 100.
    pub score: u8,
    /// `OwnProfile.missing`: unmet items, most valuable first (08 section 6.2).
    pub missing: Vec<CompletenessItem>,
}

/// Computes the score and the `missing` list (08 section 6, `compute_completeness`).
///
/// `missing` is sorted by points, highest first, keeping table order among equal points, and
/// leaves out `more_photos` and `photo_verified` while `photo` is missing, and `id_verified`
/// while `identity` is missing.
pub fn compute(input: &CompletenessInput<'_>) -> Completeness {
    let score = CompletenessItem::ALL
        .iter()
        .filter(|item| is_met(**item, input))
        .map(|item| item.points())
        .sum();
    let mut missing: Vec<CompletenessItem> = CompletenessItem::ALL
        .iter()
        .copied()
        .filter(|item| !is_met(*item, input))
        .filter(|item| {
            item.depends_on()
                .is_none_or(|dependency| is_met(dependency, input))
        })
        .collect();
    // A stable sort keeps the table order among items with equal points.
    missing.sort_by_key(|item| Reverse(item.points()));
    Completeness { score, missing }
}

/// Whether the rule of one item is met (08 section 6.1).
pub fn is_met(item: CompletenessItem, input: &CompletenessInput<'_>) -> bool {
    let no_income_expected = matches!(
        input.employment_type,
        Some(EmploymentType::Student | EmploymentType::Homemaker | EmploymentType::NotWorking)
    );
    match item {
        CompletenessItem::Core => core_is_set(input),
        CompletenessItem::Photo => input.approved_photos > 0,
        CompletenessItem::MorePhotos => input.approved_photos >= MORE_PHOTOS_MIN,
        CompletenessItem::AboutMe => {
            input.about_me_status != TextStatus::Rejected
                && input
                    .about_me
                    .is_some_and(|text| text.chars().count() >= ABOUT_ME_MIN_CHARS)
        }
        CompletenessItem::EducationDetails => {
            is_set(input.education_field_code)
                && (is_set(input.degree_title) || is_set(input.institute_name))
        }
        CompletenessItem::CareerDetails => is_set(input.profession_code) || no_income_expected,
        CompletenessItem::Income => is_set(input.income_band_code) || no_income_expected,
        CompletenessItem::Family => input.family.set_count() >= FAMILY_COLUMNS_MIN,
        CompletenessItem::ReligiousPractice => {
            // A missing religion is not "other than islam": only a stated religion waives the
            // prayer question.
            let prayer_not_asked = input
                .religion_code
                .is_some_and(|religion| is_set(Some(religion)) && religion != "islam");
            input.religiosity.is_some() && (input.prayer_frequency.is_some() || prayer_not_asked)
        }
        CompletenessItem::Plans => {
            input.living_arrangement.is_some()
                && input.work_after_marriage.is_some()
                && input.marriage_timeline.is_some()
        }
        CompletenessItem::Relocation => input.relocation.is_some(),
        CompletenessItem::Hobbies => input.hobbies >= HOBBIES_MIN,
        CompletenessItem::PartnerPreferences => input.has_partner_preferences,
        CompletenessItem::Identity => input.identity.is_some(),
        CompletenessItem::IdVerified => input.is_id_verified,
        CompletenessItem::PhotoVerified => input.is_photo_verified,
    }
}

/// Every column required by `profiles_required_when_submitted` is set (04 section 5.1).
fn core_is_set(input: &CompletenessInput<'_>) -> bool {
    input.managed_by.is_some()
        && is_set(input.first_name)
        && is_set(input.last_name)
        && input.gender.is_some()
        && input.date_of_birth.is_some()
        && input.marital_status.is_some()
        && input.height_cm.is_some()
        && is_set(input.religion_code)
        && is_set(input.mother_tongue_code)
        && is_set(input.country_code)
        && (input.city_id.is_some() || is_set(input.city_other))
        && is_set(input.education_level_code)
        && input.employment_type.is_some()
}

/// A text or code column holds a non-blank value.
fn is_set(value: Option<&str>) -> bool {
    value.is_some_and(|text| !text.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use time::macros::date;

    use super::*;

    const ABOUT_ME: &str = "We are a close family from Lahore. I work as a software engineer and \
                            enjoy reading, cricket and long walks with my parents.";

    /// A profile that has just finished onboarding: only the required fields, nothing else.
    fn onboarded() -> CompletenessInput<'static> {
        CompletenessInput {
            managed_by: Some(ManagedBy::Candidate),
            first_name: Some("Bilal"),
            last_name: Some("Ahmed"),
            gender: Some(Gender::Male),
            date_of_birth: Some(date!(1997 - 03 - 14)),
            marital_status: Some(MaritalStatus::NeverMarried),
            height_cm: Some(175),
            religion_code: Some("islam"),
            mother_tongue_code: Some("urdu"),
            country_code: Some("PK"),
            city_id: Some(1),
            city_other: None,
            education_level_code: Some("bachelors"),
            employment_type: Some(EmploymentType::PrivateJob),
            approved_photos: 0,
            about_me: None,
            about_me_status: TextStatus::Approved,
            education_field_code: None,
            degree_title: None,
            institute_name: None,
            profession_code: None,
            income_band_code: None,
            family: FamilyColumns::default(),
            religiosity: None,
            prayer_frequency: None,
            living_arrangement: None,
            work_after_marriage: None,
            marriage_timeline: None,
            relocation: None,
            hobbies: 0,
            has_partner_preferences: false,
            identity: None,
            is_id_verified: false,
            is_photo_verified: false,
        }
    }

    /// Every item met.
    fn complete() -> CompletenessInput<'static> {
        CompletenessInput {
            approved_photos: 4,
            about_me: Some(ABOUT_ME),
            education_field_code: Some("computer_science"),
            degree_title: Some("BS Computer Science"),
            institute_name: Some("FAST NUCES"),
            profession_code: Some("software"),
            income_band_code: Some("pkr_150k_250k"),
            family: FamilyColumns {
                father_status: Some(ParentStatus::Alive),
                mother_status: Some(ParentStatus::Alive),
                brothers_count: Some(1),
                sisters_count: Some(2),
                family_type: Some(FamilyType::Joint),
                family_class: Some(FamilyClass::Middle),
                family_values: Some(FamilyValues::Moderate),
                home_ownership: Some(HomeOwnership::Owned),
            },
            religiosity: Some(Religiosity::Practising),
            prayer_frequency: Some(PrayerFrequency::MostPrayers),
            living_arrangement: Some(LivingArrangement::WithFamily),
            work_after_marriage: Some(WorkAfterMarriage::Flexible),
            marriage_timeline: Some(MarriageTimeline::Within1Year),
            relocation: Some(Relocation::WithinCountry),
            hobbies: 5,
            has_partner_preferences: true,
            identity: Some(IdentityStatus::Verified),
            is_id_verified: true,
            is_photo_verified: true,
            ..onboarded()
        }
    }

    #[test]
    fn points_add_up_to_100() {
        let total: u32 = CompletenessItem::ALL
            .iter()
            .map(|item| u32::from(item.points()))
            .sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn a_complete_profile_scores_100() {
        let result = compute(&complete());
        assert_eq!(result.score, 100);
        assert_eq!(result.missing, Vec::<CompletenessItem>::new());
    }

    #[test]
    fn worked_example_a_just_onboarded() {
        // 08 section 6.4 example A: private job with a profession, no field of study, no
        // income, no family, no lifestyle answers, no photo, preferences saved, identity
        // number entered.
        let input = CompletenessInput {
            profession_code: Some("software"),
            has_partner_preferences: true,
            identity: Some(IdentityStatus::Unverified),
            ..onboarded()
        };
        let result = compute(&input);
        assert_eq!(result.score, 32);
        assert_eq!(
            result.missing,
            [
                CompletenessItem::Photo,
                CompletenessItem::AboutMe,
                CompletenessItem::Family,
                CompletenessItem::EducationDetails,
                CompletenessItem::ReligiousPractice,
                CompletenessItem::Plans,
                CompletenessItem::Income,
                CompletenessItem::Hobbies,
                CompletenessItem::IdVerified,
                CompletenessItem::Relocation,
            ]
        );
    }

    #[test]
    fn worked_example_b_two_photos_and_no_verification() {
        // 08 section 6.4 example B: everything filled in, two approved photos, identity number
        // entered but no verification done.
        let input = CompletenessInput {
            approved_photos: 2,
            identity: Some(IdentityStatus::Unverified),
            is_id_verified: false,
            is_photo_verified: false,
            ..complete()
        };
        let result = compute(&input);
        assert_eq!(result.score, 90);
        assert_eq!(
            result.missing,
            [
                CompletenessItem::MorePhotos,
                CompletenessItem::IdVerified,
                CompletenessItem::PhotoVerified,
            ]
        );
    }

    #[test]
    fn full_order_when_everything_is_missing() {
        // 08 section 6.2: the dependent items are left out.
        let input = CompletenessInput {
            managed_by: None,
            employment_type: None,
            ..onboarded()
        };
        let result = compute(&input);
        assert_eq!(result.score, 0);
        assert_eq!(
            result.missing,
            [
                CompletenessItem::Core,
                CompletenessItem::Photo,
                CompletenessItem::AboutMe,
                CompletenessItem::Family,
                CompletenessItem::EducationDetails,
                CompletenessItem::CareerDetails,
                CompletenessItem::ReligiousPractice,
                CompletenessItem::Plans,
                CompletenessItem::PartnerPreferences,
                CompletenessItem::Income,
                CompletenessItem::Hobbies,
                CompletenessItem::Identity,
                CompletenessItem::Relocation,
            ]
        );
    }

    #[test]
    fn dependent_items_appear_once_their_dependency_is_met() {
        let input = CompletenessInput {
            approved_photos: 1,
            is_photo_verified: false,
            ..complete()
        };
        let result = compute(&input);
        assert_eq!(result.score, 100 - 5 - 2);
        // more_photos (5 points) comes before photo_verified (2 points).
        assert_eq!(
            result.missing,
            [
                CompletenessItem::MorePhotos,
                CompletenessItem::PhotoVerified
            ]
        );
    }

    #[test]
    fn core_needs_every_required_column() {
        assert!(is_met(CompletenessItem::Core, &onboarded()));
        let typed_city = CompletenessInput {
            city_id: None,
            city_other: Some("Kot Addu"),
            ..onboarded()
        };
        assert!(is_met(CompletenessItem::Core, &typed_city));
        let no_city = CompletenessInput {
            city_id: None,
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::Core, &no_city));
        let blank_name = CompletenessInput {
            last_name: Some("  "),
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::Core, &blank_name));
    }

    fn with_about_me(text: &str, status: TextStatus) -> CompletenessInput<'_> {
        CompletenessInput {
            about_me: Some(text),
            about_me_status: status,
            ..onboarded()
        }
    }

    #[test]
    fn about_me_needs_100_characters_and_no_rejection() {
        let long = "a".repeat(100);
        let short = "a".repeat(99);
        let with = with_about_me;
        assert!(is_met(
            CompletenessItem::AboutMe,
            &with(&long, TextStatus::Approved)
        ));
        assert!(is_met(
            CompletenessItem::AboutMe,
            &with(&long, TextStatus::Pending)
        ));
        assert!(!is_met(
            CompletenessItem::AboutMe,
            &with(&long, TextStatus::Rejected)
        ));
        assert!(!is_met(
            CompletenessItem::AboutMe,
            &with(&short, TextStatus::Approved)
        ));
        // Characters, not bytes: 100 Urdu letters are enough.
        let urdu = "ب".repeat(100);
        assert!(is_met(
            CompletenessItem::AboutMe,
            &with(&urdu, TextStatus::Approved)
        ));
    }

    #[test]
    fn education_details_need_a_field_and_a_degree_or_institute() {
        let field_only = CompletenessInput {
            education_field_code: Some("medicine"),
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::EducationDetails, &field_only));
        let with_institute = CompletenessInput {
            institute_name: Some("King Edward Medical University"),
            ..field_only
        };
        assert!(is_met(CompletenessItem::EducationDetails, &with_institute));
    }

    #[test]
    fn career_and_income_are_waived_without_paid_work() {
        for employment in [
            EmploymentType::Student,
            EmploymentType::Homemaker,
            EmploymentType::NotWorking,
        ] {
            let input = CompletenessInput {
                employment_type: Some(employment),
                ..onboarded()
            };
            assert!(is_met(CompletenessItem::CareerDetails, &input));
            assert!(is_met(CompletenessItem::Income, &input));
        }
        let retired = CompletenessInput {
            employment_type: Some(EmploymentType::Retired),
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::CareerDetails, &retired));
        assert!(!is_met(CompletenessItem::Income, &retired));
    }

    #[test]
    fn family_needs_six_of_eight_columns() {
        let five = FamilyColumns {
            father_status: Some(ParentStatus::Alive),
            mother_status: Some(ParentStatus::Deceased),
            brothers_count: Some(0),
            sisters_count: Some(1),
            family_type: Some(FamilyType::Nuclear),
            ..FamilyColumns::default()
        };
        let input = |family| CompletenessInput {
            family,
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::Family, &input(five)));
        let six = FamilyColumns {
            family_values: Some(FamilyValues::Traditional),
            ..five
        };
        assert!(is_met(CompletenessItem::Family, &input(six)));
    }

    #[test]
    fn religious_practice_asks_prayer_only_of_muslims() {
        let muslim = CompletenessInput {
            religiosity: Some(Religiosity::Practising),
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::ReligiousPractice, &muslim));
        let praying = CompletenessInput {
            prayer_frequency: Some(PrayerFrequency::FiveTimes),
            ..muslim
        };
        assert!(is_met(CompletenessItem::ReligiousPractice, &praying));
        let christian = CompletenessInput {
            religion_code: Some("christianity"),
            ..muslim
        };
        assert!(is_met(CompletenessItem::ReligiousPractice, &christian));
        let no_religiosity = CompletenessInput {
            religiosity: None,
            ..christian
        };
        assert!(!is_met(
            CompletenessItem::ReligiousPractice,
            &no_religiosity
        ));
    }

    #[test]
    fn plans_need_all_three_answers() {
        let two = CompletenessInput {
            living_arrangement: Some(LivingArrangement::Separate),
            work_after_marriage: Some(WorkAfterMarriage::Yes),
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::Plans, &two));
        let three = CompletenessInput {
            marriage_timeline: Some(MarriageTimeline::NotDecided),
            ..two
        };
        assert!(is_met(CompletenessItem::Plans, &three));
    }

    #[test]
    fn counts_have_thresholds() {
        let at = |approved_photos, hobbies| CompletenessInput {
            approved_photos,
            hobbies,
            ..onboarded()
        };
        assert!(!is_met(CompletenessItem::MorePhotos, &at(2, 0)));
        assert!(is_met(CompletenessItem::MorePhotos, &at(3, 0)));
        assert!(!is_met(CompletenessItem::Hobbies, &at(0, 2)));
        assert!(is_met(CompletenessItem::Hobbies, &at(0, 3)));
    }

    #[test]
    fn missing_keys_serialise_as_spec_keys() {
        let json = serde_json::to_string(&[
            CompletenessItem::MorePhotos,
            CompletenessItem::PartnerPreferences,
        ])
        .unwrap();
        assert_eq!(json, r#"["more_photos","partner_preferences"]"#);
    }
}
