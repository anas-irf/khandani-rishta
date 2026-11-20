//! `LookingFor` and `Compatibility` on the profile screen (10 section 11, 15 section 4.6).
//! O is the owner of the profile being viewed and V the viewer.

use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::domain::matching::dimensions::{Assessment, Dimension};
use crate::domain::matching::fit::Pair;
use crate::domain::matching::reasons::{ReasonCode, reasons};
use crate::domain::matching::subject::{Geo, Subject};
use crate::domain::options::{Gender, Importance};
use crate::domain::preferences::Preferences;

/// `Compatibility.dimensions[].matched` is `score >= 0.999` (10 section 11.2).
pub const MATCHED_THRESHOLD: f64 = 0.999;

/// What the owner is looking for, as display lines, each marked with whether the viewer fits
/// (15 section 4.6 `LookingFor`).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct LookingFor {
    pub lines: Vec<LookingForLine>,
    /// Lines where `viewer_matches` is `true`.
    pub matched: u32,
    /// Lines where `viewer_matches` is not `null`.
    pub total: u32,
}

/// One line of [`LookingFor`].
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct LookingForLine {
    /// Dimension key from 10 section 4, for example `age`.
    #[schema(value_type = String)]
    pub dimension: Dimension,
    /// Codes or formatted values, for example `["25", "32"]` for an age range (10 section 11.1).
    pub summary_values: Vec<String>,
    /// The owner's importance for the dimension.
    pub importance: Importance,
    /// `true` when the viewer scores 1 on it, `null` when the viewer's value is unknown,
    /// otherwise `false`.
    pub viewer_matches: Option<bool>,
}

/// The compatibility block of the profile screen (15 section 4.6 `Compatibility`).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Compatibility {
    /// 0..100 (10 section 5.3).
    pub compat: u8,
    /// Reason codes, at most 3 (10 section 7).
    #[schema(value_type = Vec<String>)]
    pub reasons: Vec<ReasonCode>,
    /// 0..100: how well the owner fits the viewer's preferences.
    pub viewer_fit: u8,
    /// 0..100: how well the viewer fits the owner's preferences.
    pub owner_fit: u8,
    /// One entry per dimension set in the viewer's preferences, in the fixed order.
    pub dimensions: Vec<CompatibilityDimension>,
}

/// One entry of [`Compatibility::dimensions`].
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct CompatibilityDimension {
    /// Dimension key from 10 section 4.
    #[schema(value_type = String)]
    pub dimension: Dimension,
    /// The viewer's importance for it.
    pub importance: Importance,
    /// 0..1: how well the owner satisfies the viewer on it.
    pub score: f64,
    /// `score >= 0.999`.
    pub matched: bool,
}

/// `Compatibility` for viewer V looking at owner O (10 section 11.2). In `pair`, the viewer is
/// V and the candidate is O.
///
/// Because hidden groups are unknown to the engine, a dimension over a group O hides scores
/// 0.5 and is not matched, for everyone; it reveals nothing about the hidden value.
pub fn compatibility(pair: &Pair<'_>, now: OffsetDateTime) -> Compatibility {
    Compatibility {
        compat: pair.compat(),
        reasons: reasons(pair, now),
        viewer_fit: pair.viewer_fit(),
        owner_fit: pair.owner_fit(),
        dimensions: pair
            .forward()
            .iter()
            .map(|(dimension, evaluation)| CompatibilityDimension {
                dimension,
                importance: evaluation.importance,
                score: evaluation.score,
                matched: evaluation.score >= MATCHED_THRESHOLD,
            })
            .collect(),
    }
}

/// `LookingFor` (10 section 11.1): one line per dimension set in the owner's preferences, in
/// the fixed order, each with the owner's importance and whether the viewer fits.
///
/// `education_code` is the code of the first education level, in picker order, whose rank
/// equals `owner_prefs.education_min_rank` (05 section 7); the caller resolves it from the
/// reference cache. When it is `None` the education line has no summary values. Location
/// lines name regions and cities from `geo`; an id missing from `geo` is left out of the
/// summary.
pub fn looking_for(
    owner_prefs: &Preferences,
    viewer: &Subject,
    geo: &Geo,
    education_code: Option<&str>,
) -> LookingFor {
    let assessment = Assessment::new(owner_prefs, viewer, geo);
    let lines: Vec<LookingForLine> = assessment
        .iter()
        .map(|(dimension, evaluation)| LookingForLine {
            dimension,
            summary_values: summary_values(owner_prefs, dimension, viewer, geo, education_code),
            importance: evaluation.importance,
            viewer_matches: evaluation.verdict,
        })
        .collect();
    let matched = lines
        .iter()
        .filter(|line| line.viewer_matches == Some(true))
        .count();
    let total = lines
        .iter()
        .filter(|line| line.viewer_matches.is_some())
        .count();
    LookingFor {
        lines,
        matched: u32::try_from(matched).unwrap_or(u32::MAX),
        total: u32::try_from(total).unwrap_or(u32::MAX),
    }
}

/// `summary_values` of one line (10 section 11.1, the table).
fn summary_values(
    prefs: &Preferences,
    dimension: Dimension,
    viewer: &Subject,
    geo: &Geo,
    education_code: Option<&str>,
) -> Vec<String> {
    match dimension {
        Dimension::Age => vec![prefs.age_min.to_string(), prefs.age_max.to_string()],
        Dimension::Height => vec![
            prefs.height_min_cm.map_or_default(|cm| cm.to_string()),
            prefs.height_max_cm.map_or_default(|cm| cm.to_string()),
        ],
        Dimension::MaritalStatus => codes(&prefs.marital_statuses),
        Dimension::Children => vec![prefs.children_acceptance.to_string()],
        Dimension::Religion => prefs.religion_codes.clone(),
        Dimension::Sect => prefs.sect_codes.clone(),
        Dimension::Caste => prefs.caste_codes.clone(),
        Dimension::MotherTongue => prefs.mother_tongue_codes.clone(),
        Dimension::Location => location_summary(prefs, geo),
        Dimension::Education => education_code.map(String::from).into_iter().collect(),
        Dimension::Profession => prefixed("employment", &codes(&prefs.employment_types))
            .chain(prefixed("profession", &prefs.profession_codes))
            .collect(),
        Dimension::Income => prefs
            .income_min_rank
            .map(|rank| rank.to_string())
            .into_iter()
            .collect(),
        Dimension::Religiosity => codes(&prefs.religiosity_levels),
        Dimension::Appearance => match viewer.gender {
            Gender::Female => codes(&prefs.hijab_types),
            Gender::Male => codes(&prefs.beard_types),
        },
        Dimension::Family => prefixed("values", &codes(&prefs.family_values))
            .chain(prefixed("type", &codes(&prefs.family_types)))
            .collect(),
        Dimension::LivingArrangement => codes(&prefs.living_arrangements),
        Dimension::WorkAfterMarriage => codes(&prefs.work_after_marriage_options),
        Dimension::Smoking => codes(&prefs.smoking_options),
    }
}

/// `country:<code>`, then `region:<name>`, then `city:<name>`, one per listed entry.
fn location_summary(prefs: &Preferences, geo: &Geo) -> Vec<String> {
    let countries = prefs
        .country_codes
        .iter()
        .map(|code| format!("country:{code}"));
    let regions = prefs
        .region_ids
        .iter()
        .filter_map(|id| geo.region(*id))
        .map(|region| format!("region:{}", region.name));
    let cities = prefs
        .city_ids
        .iter()
        .filter_map(|id| geo.city(*id))
        .map(|city| format!("city:{}", city.name));
    countries.chain(regions).chain(cities).collect()
}

fn codes<T: std::fmt::Display>(values: &[T]) -> Vec<String> {
    values.iter().map(ToString::to_string).collect()
}

fn prefixed<'a>(prefix: &'a str, values: &'a [String]) -> impl Iterator<Item = String> + 'a {
    values.iter().map(move |value| format!("{prefix}:{value}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::matching::fit::Side;
    use crate::domain::matching::testkit::{
        self, NOW, ahmed, ahmed_prefs, assert_close, fatima, fatima_prefs, subject,
    };
    use crate::domain::options::{
        Beard, EmploymentType, FamilyType, FamilyValues, FieldVisibility, Hijab,
    };

    #[test]
    fn looking_for_in_the_worked_example() {
        // Ahmed views Fatima's profile: her preferences against him.
        let geo = testkit::geo();
        let looking_for = looking_for(&fatima_prefs(), &subject(ahmed()), &geo, Some("masters"));
        let lines: Vec<(&str, Vec<&str>, Importance, Option<bool>)> = looking_for
            .lines
            .iter()
            .map(|line| {
                (
                    line.dimension.as_str(),
                    line.summary_values.iter().map(String::as_str).collect(),
                    line.importance,
                    line.viewer_matches,
                )
            })
            .collect();
        assert_eq!(
            lines,
            [
                ("age", vec!["27", "33"], Importance::High, Some(true)),
                (
                    "marital_status",
                    vec!["never_married"],
                    Importance::Must,
                    Some(true)
                ),
                ("religion", vec!["islam"], Importance::Must, Some(true)),
                ("location", vec!["country:PK"], Importance::Low, Some(true)),
                ("education", vec!["masters"], Importance::Must, Some(true)),
                // Ahmed hides his income from members: unknown.
                ("income", vec!["4"], Importance::Medium, None),
            ]
        );
        assert_eq!(looking_for.matched, 5);
        assert_eq!(looking_for.total, 5);
    }

    #[test]
    fn compatibility_in_the_worked_example() {
        let geo = testkit::geo();
        let (viewer, owner) = (subject(ahmed()), subject(fatima()));
        let (viewer_prefs, owner_prefs) = (ahmed_prefs(), fatima_prefs());
        let pair = Pair::new(
            Side {
                subject: &viewer,
                prefs: &viewer_prefs,
            },
            Side {
                subject: &owner,
                prefs: &owner_prefs,
            },
            &geo,
        );
        let compatibility = compatibility(&pair, NOW);
        assert_eq!(compatibility.compat, 92);
        assert_eq!(compatibility.viewer_fit, 97);
        assert_eq!(compatibility.owner_fit, 96);
        assert_eq!(
            compatibility.reasons,
            [
                ReasonCode::SameSect,
                ReasonCode::YouMeetTheirPreferences,
                ReasonCode::AgeFits
            ]
        );
        let dimensions: Vec<(Dimension, bool)> = compatibility
            .dimensions
            .iter()
            .map(|d| (d.dimension, d.matched))
            .collect();
        assert_eq!(
            dimensions,
            [
                (Dimension::Age, true),
                (Dimension::MaritalStatus, true),
                (Dimension::Religion, true),
                (Dimension::Sect, true),
                (Dimension::Location, false),
                (Dimension::Education, true),
                (Dimension::Religiosity, true),
            ]
        );
        let location = compatibility
            .dimensions
            .iter()
            .find(|d| d.dimension == Dimension::Location)
            .map(|d| d.score);
        assert_close(location.unwrap_or_default(), 0.7);
    }

    #[test]
    fn compatibility_serialises_with_the_contract_field_names() {
        let geo = testkit::geo();
        let (viewer, owner) = (subject(ahmed()), subject(fatima()));
        let (viewer_prefs, owner_prefs) = (ahmed_prefs(), fatima_prefs());
        let pair = Pair::new(
            Side {
                subject: &viewer,
                prefs: &viewer_prefs,
            },
            Side {
                subject: &owner,
                prefs: &owner_prefs,
            },
            &geo,
        );
        let json = serde_json::to_value(compatibility(&pair, NOW)).unwrap_or_default();
        assert_eq!(json["compat"], 92);
        assert_eq!(json["reasons"][0], "same_sect");
        assert_eq!(json["viewer_fit"], 97);
        assert_eq!(json["owner_fit"], 96);
        assert_eq!(json["dimensions"][0]["dimension"], "age");
        assert_eq!(json["dimensions"][0]["importance"], "high");
        assert_eq!(json["dimensions"][0]["score"], 1.0);
        assert_eq!(json["dimensions"][0]["matched"], true);
        assert_eq!(json["dimensions"][4]["score"], 0.7);

        let looking_for = looking_for(&owner_prefs, &viewer, &geo, None);
        let json = serde_json::to_value(looking_for).unwrap_or_default();
        assert_eq!(json["matched"], 5);
        assert_eq!(json["total"], 5);
        assert_eq!(json["lines"][5]["dimension"], "income");
        assert!(json["lines"][5]["viewer_matches"].is_null());
        assert_eq!(json["lines"][4]["summary_values"], serde_json::json!([]));
    }

    #[test]
    fn hidden_group_scores_half_and_is_never_matched() {
        let geo = testkit::geo();
        let mut viewer_prefs = testkit::no_preferences();
        viewer_prefs.caste_codes = vec!["rajput".into()];
        let viewer = subject(testkit::man());
        let mut rows = testkit::woman();
        rows.caste_code = Some("rajput".into());
        rows.caste_visibility = FieldVisibility::Connections;
        let owner = subject(rows);
        let owner_prefs = testkit::no_preferences();
        let pair = Pair::new(
            Side {
                subject: &viewer,
                prefs: &viewer_prefs,
            },
            Side {
                subject: &owner,
                prefs: &owner_prefs,
            },
            &geo,
        );
        let compatibility = compatibility(&pair, NOW);
        assert_eq!(compatibility.dimensions.len(), 1);
        assert_close(compatibility.dimensions[0].score, 0.5);
        assert!(!compatibility.dimensions[0].matched);
    }

    #[test]
    fn summary_values_for_every_dimension() {
        let mut prefs = testkit::no_preferences();
        prefs.height_min_cm = Some(160);
        prefs.city_ids = vec![testkit::LAHORE, 999];
        prefs.region_ids = vec![testkit::SINDH];
        prefs.country_codes = vec!["AE".into()];
        prefs.employment_types = vec![EmploymentType::GovernmentJob];
        prefs.profession_codes = vec!["doctor".into()];
        prefs.family_values = vec![FamilyValues::Religious];
        prefs.family_types = vec![FamilyType::Joint];
        prefs.hijab_types = vec![Hijab::Hijab];
        prefs.beard_types = vec![Beard::Full];
        let geo = testkit::geo();
        let woman = subject(testkit::woman());
        let man = subject(testkit::man());
        let summary =
            |dimension, viewer: &Subject| summary_values(&prefs, dimension, viewer, &geo, None);
        assert_eq!(summary(Dimension::Height, &woman), ["160", ""]);
        assert_eq!(
            summary(Dimension::Location, &woman),
            ["country:AE", "region:Sindh", "city:Lahore"]
        );
        assert_eq!(
            summary(Dimension::Profession, &woman),
            ["employment:government_job", "profession:doctor"]
        );
        assert_eq!(
            summary(Dimension::Family, &woman),
            ["values:religious", "type:joint"]
        );
        assert_eq!(summary(Dimension::Appearance, &woman), ["hijab"]);
        assert_eq!(summary(Dimension::Appearance, &man), ["full"]);
    }

    #[test]
    fn looking_for_counts_skip_unknown_lines() {
        let mut prefs = testkit::no_preferences();
        prefs.sect_codes = vec!["sunni".into()];
        prefs.smoking_options = vec![crate::domain::options::Smoking::No];
        prefs.religion_codes = vec!["islam".into()];
        let looking_for = looking_for(&prefs, &subject(testkit::man()), &testkit::geo(), None);
        // Religion matches; sect and smoking are unknown for this viewer.
        assert_eq!(looking_for.lines.len(), 3);
        assert_eq!(looking_for.matched, 1);
        assert_eq!(looking_for.total, 1);
    }

    #[test]
    fn nothing_set_gives_no_lines() {
        let looking_for = looking_for(
            &testkit::no_preferences(),
            &subject(testkit::woman()),
            &testkit::geo(),
            None,
        );
        assert_eq!(looking_for.lines, Vec::<LookingForLine>::new());
        assert_eq!((looking_for.matched, looking_for.total), (0, 0));
    }
}
