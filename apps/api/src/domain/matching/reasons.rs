//! Reason codes (10 section 7): up to three plain reasons on a card, from the viewer's point of
//! view about the candidate, computed from matchable values only.

use time::{Duration, OffsetDateTime};

use crate::domain::matching::dimensions::Dimension;
use crate::domain::matching::fit::{Pair, shared_count};
use crate::domain::matching::rank::is_new;
use crate::domain::text_enum;

/// At most this many reasons per card.
pub const MAX_REASONS: usize = 3;

/// `you_meet_their_preferences` needs at least this many dimensions set by the candidate.
const MIN_SET_DIMENSIONS: usize = 3;

/// `you_meet_their_preferences` needs at least this `fit_CV`.
const MIN_OWNER_FIT: f64 = 0.85;

/// `recently_active`: active within this window.
const RECENTLY_ACTIVE: Duration = Duration::hours(24);

text_enum! {
    /// A reason code (10 section 7). [`ReasonCode::ALL`] is in priority order. The list is
    /// closed; clients map each code to a string and ignore codes they do not know.
    ReasonCode {
        SameCity = "same_city",
        SameCaste = "same_caste",
        SameSect = "same_sect",
        YouMeetTheirPreferences = "you_meet_their_preferences",
        AgeFits = "age_fits",
        EducationFits = "education_fits",
        ReligiosityFits = "religiosity_fits",
        FamilyValuesFit = "family_values_fit",
        ProfessionFits = "profession_fits",
        SameMotherTongue = "same_mother_tongue",
        SameRegion = "same_region",
        SharedHobbies = "shared_hobbies",
        MeetsYourMustHaves = "meets_your_must_haves",
        Verified = "verified",
        NewMember = "new_member",
        RecentlyActive = "recently_active",
    }
}

impl ReasonCode {
    /// The English text of 10 section 7, for emails and digests. Clients use their own
    /// translations.
    pub const fn english(self) -> &'static str {
        match self {
            Self::SameCity => "Lives in your city",
            Self::SameCaste => "Same caste",
            Self::SameSect => "Same sect",
            Self::YouMeetTheirPreferences => "You fit what they are looking for",
            Self::AgeFits => "Age suits you both",
            Self::EducationFits => "Education matches your preference",
            Self::ReligiosityFits => "Religious practice matches your preference",
            Self::FamilyValuesFit => "Family values match your preference",
            Self::ProfessionFits => "Profession matches your preference",
            Self::SameMotherTongue => "Speaks your mother tongue",
            Self::SameRegion => "Lives in your province",
            Self::SharedHobbies => "Shared interests",
            Self::MeetsYourMustHaves => "Meets all your must-haves",
            Self::Verified => "Verified profile",
            Self::NewMember => "New member",
            Self::RecentlyActive => "Active recently",
        }
    }
}

/// The reasons for the candidate's card as seen by the viewer (10 section 7): walk the table
/// in priority order and take the first [`MAX_REASONS`] codes whose condition holds.
pub fn reasons(pair: &Pair<'_>, now: OffsetDateTime) -> Vec<ReasonCode> {
    ReasonCode::ALL
        .iter()
        .copied()
        .filter(|code| holds(*code, pair, now))
        .take(MAX_REASONS)
        .collect()
}

/// The condition of one reason (10 section 7).
pub fn holds(code: ReasonCode, pair: &Pair<'_>, now: OffsetDateTime) -> bool {
    let v = pair.viewer().subject;
    let c = pair.candidate().subject;
    let v_prefs = pair.viewer().prefs;
    let forward = pair.forward();
    let backward = pair.backward();
    let viewer_dimension_passes = |dimension: Dimension| {
        forward
            .get(dimension)
            .is_some_and(|evaluation| evaluation.passes())
    };
    let both_equal = |a: Option<&String>, b: Option<&String>| a.is_some() && a == b;
    let same_city = v.city_id.is_some() && v.city_id == c.city_id;

    match code {
        ReasonCode::SameCity => same_city,
        ReasonCode::SameCaste => both_equal(v.caste_code.as_ref(), c.caste_code.as_ref()),
        ReasonCode::SameSect => both_equal(v.sect_code.as_ref(), c.sect_code.as_ref()),
        ReasonCode::YouMeetTheirPreferences => {
            backward.set_count() >= MIN_SET_DIMENSIONS && pair.fit_cv() >= MIN_OWNER_FIT
        }
        ReasonCode::AgeFits => {
            viewer_dimension_passes(Dimension::Age)
                && backward
                    .get(Dimension::Age)
                    .is_none_or(|evaluation| evaluation.passes())
        }
        ReasonCode::EducationFits => viewer_dimension_passes(Dimension::Education),
        ReasonCode::ReligiosityFits => viewer_dimension_passes(Dimension::Religiosity),
        ReasonCode::FamilyValuesFit => c
            .family_values
            .is_some_and(|values| v_prefs.family_values.contains(&values)),
        ReasonCode::ProfessionFits => viewer_dimension_passes(Dimension::Profession),
        ReasonCode::SameMotherTongue => v.mother_tongue_code == c.mother_tongue_code,
        ReasonCode::SameRegion => !same_city && v.region_id.is_some() && v.region_id == c.region_id,
        ReasonCode::SharedHobbies => shared_count(&v.hobby_codes, &c.hobby_codes) >= 2,
        ReasonCode::MeetsYourMustHaves => {
            forward.has_set_must() && pair.candidate_meets_viewer_must_haves()
        }
        ReasonCode::Verified => c.is_id_verified || c.is_photo_verified,
        ReasonCode::NewMember => is_new(c.first_activated_at, now),
        ReasonCode::RecentlyActive => {
            v.show_last_active
                && c.show_last_active
                && c.last_active_at
                    .is_some_and(|at| now - at <= RECENTLY_ACTIVE)
        }
    }
}

#[cfg(test)]
mod tests {
    use time::Duration;

    use super::*;
    use crate::domain::matching::fit::Side;
    use crate::domain::matching::subject::{Subject, SubjectRows};
    use crate::domain::matching::testkit::{
        self, NOW, ahmed, ahmed_prefs, fatima, fatima_prefs, subject,
    };
    use crate::domain::options::{
        EmploymentType, FamilyValues, FieldVisibility, Importance, Religiosity,
    };
    use crate::domain::preferences::Preferences;

    fn reasons_for(
        viewer: &Subject,
        viewer_prefs: &Preferences,
        candidate: &Subject,
        candidate_prefs: &Preferences,
    ) -> Vec<ReasonCode> {
        let geo = testkit::geo();
        let pair = Pair::new(
            Side {
                subject: viewer,
                prefs: viewer_prefs,
            },
            Side {
                subject: candidate,
                prefs: candidate_prefs,
            },
            &geo,
        );
        reasons(&pair, NOW)
    }

    /// Every reason that holds, not only the first three.
    fn all_holding(
        viewer: SubjectRows,
        viewer_prefs: &Preferences,
        candidate: SubjectRows,
        candidate_prefs: &Preferences,
    ) -> Vec<ReasonCode> {
        let (viewer, candidate) = (subject(viewer), subject(candidate));
        let geo = testkit::geo();
        let pair = Pair::new(
            Side {
                subject: &viewer,
                prefs: viewer_prefs,
            },
            Side {
                subject: &candidate,
                prefs: candidate_prefs,
            },
            &geo,
        );
        ReasonCode::ALL
            .iter()
            .copied()
            .filter(|code| holds(*code, &pair, NOW))
            .collect()
    }

    #[test]
    fn case_43_worked_example_reasons() {
        let reasons = reasons_for(
            &subject(ahmed()),
            &ahmed_prefs(),
            &subject(fatima()),
            &fatima_prefs(),
        );
        assert_eq!(
            reasons,
            [
                ReasonCode::SameSect,
                ReasonCode::YouMeetTheirPreferences,
                ReasonCode::AgeFits
            ]
        );
    }

    #[test]
    fn case_44_hidden_caste_never_gives_same_caste() {
        let mut viewer = testkit::man();
        viewer.caste_code = Some("arain".into());
        let mut candidate = testkit::woman();
        candidate.caste_code = Some("arain".into());
        let prefs = testkit::no_preferences();
        assert!(
            all_holding(viewer.clone(), &prefs, candidate.clone(), &prefs)
                .contains(&ReasonCode::SameCaste)
        );
        candidate.caste_visibility = FieldVisibility::Connections;
        assert!(!all_holding(viewer, &prefs, candidate, &prefs).contains(&ReasonCode::SameCaste));
    }

    #[test]
    fn at_most_three_in_priority_order() {
        // Same city, same mother tongue, verified, new, recently active: five hold.
        let viewer = testkit::man();
        let mut candidate = testkit::woman();
        candidate.is_id_verified = true;
        candidate.first_activated_at = Some(NOW - Duration::days(2));
        candidate.last_active_at = Some(NOW - Duration::hours(2));
        let prefs = testkit::no_preferences();
        assert_eq!(
            all_holding(viewer.clone(), &prefs, candidate.clone(), &prefs),
            [
                ReasonCode::SameCity,
                ReasonCode::SameMotherTongue,
                ReasonCode::Verified,
                ReasonCode::NewMember,
                ReasonCode::RecentlyActive,
            ]
        );
        assert_eq!(
            reasons_for(&subject(viewer), &prefs, &subject(candidate), &prefs),
            [
                ReasonCode::SameCity,
                ReasonCode::SameMotherTongue,
                ReasonCode::Verified
            ]
        );
    }

    #[test]
    fn a_card_may_have_no_reason() {
        let viewer = testkit::man();
        let mut candidate = testkit::woman();
        candidate.city_id = Some(testkit::DUBAI);
        candidate.region_id = Some(testkit::DUBAI_EMIRATE);
        candidate.country_code = "AE".into();
        candidate.mother_tongue_code = "arabic".into();
        let prefs = testkit::no_preferences();
        assert_eq!(
            reasons_for(&subject(viewer), &prefs, &subject(candidate), &prefs),
            Vec::<ReasonCode>::new()
        );
    }

    #[test]
    fn same_region_only_without_same_city() {
        let viewer = testkit::man();
        let mut candidate = testkit::woman();
        candidate.city_id = Some(testkit::FAISALABAD);
        let prefs = testkit::no_preferences();
        let holding = all_holding(viewer.clone(), &prefs, candidate, &prefs);
        assert!(holding.contains(&ReasonCode::SameRegion));
        assert!(!holding.contains(&ReasonCode::SameCity));
        let holding = all_holding(viewer, &prefs, testkit::woman(), &prefs);
        assert!(holding.contains(&ReasonCode::SameCity));
        assert!(!holding.contains(&ReasonCode::SameRegion));
    }

    #[test]
    fn age_fits_needs_both_ranges_or_an_unset_candidate_range() {
        let mut viewer_prefs = testkit::no_preferences();
        viewer_prefs.age_min = 24;
        viewer_prefs.age_max = 28;
        let mut candidate_prefs = testkit::no_preferences();
        let holds_age = |candidate_prefs: &Preferences| {
            all_holding(
                testkit::man(),
                &viewer_prefs,
                testkit::woman(),
                candidate_prefs,
            )
            .contains(&ReasonCode::AgeFits)
        };
        // The candidate's age is not set.
        assert!(holds_age(&candidate_prefs));
        // The viewer (30) is inside the candidate's range.
        candidate_prefs.age_min = 28;
        candidate_prefs.age_max = 34;
        assert!(holds_age(&candidate_prefs));
        // The viewer is outside it.
        candidate_prefs.age_max = 29;
        assert!(!holds_age(&candidate_prefs));
    }

    #[test]
    fn preference_reasons_need_a_full_score() {
        let mut viewer_prefs = testkit::no_preferences();
        viewer_prefs.education_min_rank = Some(5);
        viewer_prefs.religiosity_levels = vec![Religiosity::Practising];
        viewer_prefs.family_values = vec![FamilyValues::Moderate];
        viewer_prefs.employment_types = vec![EmploymentType::PrivateJob];
        let mut candidate = testkit::woman();
        candidate.religiosity = Some(Religiosity::Practising);
        candidate.family_values = Some(FamilyValues::Moderate);
        let prefs = testkit::no_preferences();
        let holding = all_holding(testkit::man(), &viewer_prefs, candidate.clone(), &prefs);
        for code in [
            ReasonCode::EducationFits,
            ReasonCode::ReligiosityFits,
            ReasonCode::FamilyValuesFit,
            ReasonCode::ProfessionFits,
        ] {
            assert!(holding.contains(&code), "{code}");
        }

        candidate.education_rank = Some(4);
        candidate.religiosity = Some(Religiosity::VeryPractising);
        candidate.family_visibility = FieldVisibility::Connections;
        candidate.employment_type = EmploymentType::Student;
        let holding = all_holding(testkit::man(), &viewer_prefs, candidate, &prefs);
        for code in [
            ReasonCode::EducationFits,
            ReasonCode::ReligiosityFits,
            ReasonCode::FamilyValuesFit,
            ReasonCode::ProfessionFits,
        ] {
            assert!(!holding.contains(&code), "{code}");
        }
    }

    #[test]
    fn meets_your_must_haves_needs_a_set_must() {
        let prefs = testkit::no_preferences();
        assert!(
            !all_holding(testkit::man(), &prefs, testkit::woman(), &prefs)
                .contains(&ReasonCode::MeetsYourMustHaves)
        );
        let mut viewer_prefs = testkit::no_preferences();
        viewer_prefs.religion_codes = vec!["islam".into()];
        viewer_prefs.religion_importance = Importance::Must;
        assert!(
            all_holding(testkit::man(), &viewer_prefs, testkit::woman(), &prefs)
                .contains(&ReasonCode::MeetsYourMustHaves)
        );
    }

    #[test]
    fn you_meet_their_preferences_needs_three_set_dimensions() {
        let mut candidate_prefs = testkit::no_preferences();
        candidate_prefs.religion_codes = vec!["islam".into()];
        candidate_prefs.mother_tongue_codes = vec!["urdu".into()];
        let prefs = testkit::no_preferences();
        let holds = |candidate_prefs: &Preferences| {
            all_holding(testkit::man(), &prefs, testkit::woman(), candidate_prefs)
                .contains(&ReasonCode::YouMeetTheirPreferences)
        };
        assert!(!holds(&candidate_prefs));
        candidate_prefs.city_ids = vec![testkit::LAHORE];
        assert!(holds(&candidate_prefs));
        candidate_prefs.city_ids = vec![testkit::KARACHI];
        // fit_CV = (10 + 4 + 0.4 * 7) / (10 + 4 + 7) = 0.8 at medium importance: below 0.85.
        assert!(!holds(&candidate_prefs));
    }

    #[test]
    fn recently_active_needs_both_to_show_last_active() {
        let mut candidate = testkit::woman();
        candidate.last_active_at = Some(NOW - Duration::hours(3));
        let prefs = testkit::no_preferences();
        assert!(
            all_holding(testkit::man(), &prefs, candidate.clone(), &prefs)
                .contains(&ReasonCode::RecentlyActive)
        );
        let mut viewer = testkit::man();
        viewer.show_last_active = false;
        assert!(
            !all_holding(viewer, &prefs, candidate.clone(), &prefs)
                .contains(&ReasonCode::RecentlyActive)
        );
        candidate.last_active_at = Some(NOW - Duration::hours(30));
        assert!(
            !all_holding(testkit::man(), &prefs, candidate, &prefs)
                .contains(&ReasonCode::RecentlyActive)
        );
    }

    #[test]
    fn shared_hobbies_need_two_in_common() {
        let mut viewer = testkit::man();
        viewer.hobby_codes = vec!["cricket".into(), "reading".into()];
        let mut candidate = testkit::woman();
        candidate.hobby_codes = vec!["reading".into(), "cooking".into()];
        let prefs = testkit::no_preferences();
        assert!(
            !all_holding(viewer.clone(), &prefs, candidate.clone(), &prefs)
                .contains(&ReasonCode::SharedHobbies)
        );
        candidate.hobby_codes.push("cricket".into());
        assert!(
            all_holding(viewer, &prefs, candidate, &prefs).contains(&ReasonCode::SharedHobbies)
        );
    }

    #[test]
    fn codes_and_texts() {
        assert_eq!(ReasonCode::ALL.len(), 16);
        assert_eq!(ReasonCode::FamilyValuesFit.as_str(), "family_values_fit");
        assert_eq!(ReasonCode::SameRegion.english(), "Lives in your province");
    }
}
