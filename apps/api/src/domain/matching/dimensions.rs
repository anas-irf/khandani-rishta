//! The 18 matching dimensions (10 section 4) and the must-have test (10 section 3.2).
//!
//! For every dimension the module answers three questions about one member's preferences and
//! a subject: is the dimension set ([`is_set`]), how well does the subject score
//! ([`score`], 0 to 1), and does the subject pass it as a must-have ([`must_test`]).
//! [`evaluate`] answers all three at once.

use crate::domain::matching::scales;
use crate::domain::matching::subject::{Geo, Subject};
use crate::domain::options::{
    ChildrenAcceptance, ChildrenStatus, Gender, Importance, LivingArrangement, Relocation,
    WorkAfterMarriage,
};
use crate::domain::preferences::Preferences;
use crate::domain::text_enum;

text_enum! {
    /// A matching dimension (10 section 4). The key equals the prefix of its `_importance`
    /// column in `partner_preferences`. [`Dimension::ALL`] is the fixed order of
    /// 10 section 11.1, used for `LookingFor` lines and `Compatibility` dimensions.
    Dimension {
        Age = "age",
        Height = "height",
        MaritalStatus = "marital_status",
        Children = "children",
        Religion = "religion",
        Sect = "sect",
        Caste = "caste",
        MotherTongue = "mother_tongue",
        Location = "location",
        Education = "education",
        Profession = "profession",
        Income = "income",
        Religiosity = "religiosity",
        Appearance = "appearance",
        Family = "family",
        LivingArrangement = "living_arrangement",
        WorkAfterMarriage = "work_after_marriage",
        Smoking = "smoking",
    }
}

impl Dimension {
    /// The number of dimensions.
    pub const COUNT: usize = 18;

    /// Position in [`Dimension::ALL`].
    pub const fn index(self) -> usize {
        self as usize
    }
}

/// `age_min` and `age_max` at these values mean "no age preference" (10 section 4.4).
pub const AGE_OPEN_MIN: i16 = 18;
/// See [`AGE_OPEN_MIN`].
pub const AGE_OPEN_MAX: i16 = 80;

/// The preference owner's importance for a dimension: the `<key>_importance` column.
pub const fn importance(prefs: &Preferences, dimension: Dimension) -> Importance {
    match dimension {
        Dimension::Age => prefs.age_importance,
        Dimension::Height => prefs.height_importance,
        Dimension::MaritalStatus => prefs.marital_status_importance,
        Dimension::Children => prefs.children_importance,
        Dimension::Religion => prefs.religion_importance,
        Dimension::Sect => prefs.sect_importance,
        Dimension::Caste => prefs.caste_importance,
        Dimension::MotherTongue => prefs.mother_tongue_importance,
        Dimension::Location => prefs.location_importance,
        Dimension::Education => prefs.education_importance,
        Dimension::Profession => prefs.profession_importance,
        Dimension::Income => prefs.income_importance,
        Dimension::Religiosity => prefs.religiosity_importance,
        Dimension::Appearance => prefs.appearance_importance,
        Dimension::Family => prefs.family_importance,
        Dimension::LivingArrangement => prefs.living_arrangement_importance,
        Dimension::WorkAfterMarriage => prefs.work_after_marriage_importance,
        Dimension::Smoking => prefs.smoking_importance,
    }
}

/// The outcome of one set dimension of one member's preferences against a subject.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Evaluation {
    /// The preference owner's importance for the dimension.
    pub importance: Importance,
    /// The sub-score `s`, 0 to 1 (10 sections 4.3 and 4.4). An unknown value scores 0.5.
    pub score: f64,
    /// `Some(true)` when the subject fully satisfies the preference. For every dimension this
    /// is exactly the must test of 10 section 4.4, and exactly `s = 1`. `Some(false)` when a
    /// known value falls short. `None` when the outcome depends on a value that is unknown:
    /// a null value, or a group the subject hides from members (10 section 3.2 rule 2).
    pub verdict: Option<bool>,
}

impl Evaluation {
    /// The must test of 10 section 4.4. Unknown fails (10 section 3.2 rule 2).
    pub fn passes(&self) -> bool {
        self.verdict == Some(true)
    }
}

/// Whether the dimension is set in `prefs` (10 section 4.4, "Set when"). A dimension that is
/// not set is skipped everywhere: it adds nothing to a fit, filters nothing as a must-have and
/// produces no line. Only `appearance` depends on the subject: it reads `hijab_types` for a
/// woman and `beard_types` for a man.
pub fn is_set(prefs: &Preferences, dimension: Dimension, subject: &Subject) -> bool {
    match dimension {
        Dimension::Age => !(prefs.age_min == AGE_OPEN_MIN && prefs.age_max == AGE_OPEN_MAX),
        Dimension::Height => prefs.height_min_cm.is_some() || prefs.height_max_cm.is_some(),
        Dimension::MaritalStatus => !prefs.marital_statuses.is_empty(),
        Dimension::Children => prefs.children_acceptance != ChildrenAcceptance::Any,
        Dimension::Religion => !prefs.religion_codes.is_empty(),
        Dimension::Sect => !prefs.sect_codes.is_empty(),
        Dimension::Caste => !prefs.caste_codes.is_empty(),
        Dimension::MotherTongue => !prefs.mother_tongue_codes.is_empty(),
        Dimension::Location => {
            !prefs.country_codes.is_empty()
                || !prefs.region_ids.is_empty()
                || !prefs.city_ids.is_empty()
        }
        Dimension::Education => prefs.education_min_rank.is_some(),
        Dimension::Profession => {
            !prefs.employment_types.is_empty() || !prefs.profession_codes.is_empty()
        }
        Dimension::Income => prefs.income_min_rank.is_some(),
        Dimension::Religiosity => !prefs.religiosity_levels.is_empty(),
        Dimension::Appearance => match subject.gender {
            Gender::Female => !prefs.hijab_types.is_empty(),
            Gender::Male => !prefs.beard_types.is_empty(),
        },
        Dimension::Family => !prefs.family_values.is_empty() || !prefs.family_types.is_empty(),
        Dimension::LivingArrangement => !prefs.living_arrangements.is_empty(),
        Dimension::WorkAfterMarriage => !prefs.work_after_marriage_options.is_empty(),
        Dimension::Smoking => !prefs.smoking_options.is_empty(),
    }
}

/// Scores one dimension of `prefs` against `subject`. `None` when the dimension is not set.
pub fn evaluate(
    prefs: &Preferences,
    dimension: Dimension,
    subject: &Subject,
    geo: &Geo,
) -> Option<Evaluation> {
    if !is_set(prefs, dimension, subject) {
        return None;
    }
    let part = part(prefs, dimension, subject, geo)?;
    Some(Evaluation {
        importance: importance(prefs, dimension),
        score: part.score,
        verdict: part.verdict,
    })
}

/// `score(prefs, d, subject)`, 0 to 1 (10 section 4.4). `None` when the dimension is not set.
pub fn score(
    prefs: &Preferences,
    dimension: Dimension,
    subject: &Subject,
    geo: &Geo,
) -> Option<f64> {
    evaluate(prefs, dimension, subject, geo).map(|evaluation| evaluation.score)
}

/// `must_test(prefs, d, subject)` (10 section 4.4). An unknown value fails (10 section 3.2
/// rule 2). A dimension that is not set filters nothing, so it passes (rule 3).
pub fn must_test(prefs: &Preferences, dimension: Dimension, subject: &Subject, geo: &Geo) -> bool {
    evaluate(prefs, dimension, subject, geo).is_none_or(|evaluation| evaluation.passes())
}

/// `passes_must_haves(prefs, subject)` (10 section 3.2): every dimension marked `must` that is
/// set passes its must test. Call it with (V's preferences, C) and with (C's preferences, V).
///
/// A profile without a `partner_preferences` row must be passed with the default preferences
/// of 07 section 12 (rule 4); building those is the caller's job.
pub fn passes_must_haves(prefs: &Preferences, subject: &Subject, geo: &Geo) -> bool {
    Dimension::ALL.iter().all(|dimension| {
        importance(prefs, *dimension) != Importance::Must
            || must_test(prefs, *dimension, subject, geo)
    })
}

/// `location_score(prefs, subject, geo)` (10 section 4.5). A listed country, region or city
/// fully accepts everything inside it; the three lists are a union.
pub fn location_score(prefs: &Preferences, subject: &Subject, geo: &Geo) -> f64 {
    location_level(prefs, subject, geo).score()
}

/// Every dimension of one member's preferences evaluated against one subject: one direction
/// of a pair. Built once per direction and reused for the fit, the must-haves, the reasons and
/// the `Compatibility` and `LookingFor` lines.
#[derive(Debug, Clone, PartialEq)]
pub struct Assessment {
    evaluations: [Option<Evaluation>; Dimension::COUNT],
}

impl Assessment {
    /// Evaluates all 18 dimensions of `prefs` against `subject`.
    pub fn new(prefs: &Preferences, subject: &Subject, geo: &Geo) -> Self {
        let mut evaluations = [None; Dimension::COUNT];
        for (slot, dimension) in evaluations.iter_mut().zip(Dimension::ALL) {
            *slot = evaluate(prefs, *dimension, subject, geo);
        }
        Self { evaluations }
    }

    /// The evaluation of one dimension; `None` when it is not set.
    pub fn get(&self, dimension: Dimension) -> Option<Evaluation> {
        self.evaluations.get(dimension.index()).copied().flatten()
    }

    /// The set dimensions with their evaluations, in the fixed order of [`Dimension::ALL`].
    pub fn iter(&self) -> impl Iterator<Item = (Dimension, Evaluation)> + '_ {
        Dimension::ALL
            .iter()
            .zip(&self.evaluations)
            .filter_map(|(dimension, evaluation)| evaluation.map(|e| (*dimension, e)))
    }

    /// How many dimensions are set.
    pub fn set_count(&self) -> usize {
        self.iter().count()
    }

    /// The set `must` dimensions the subject fails, in fixed order.
    pub fn failed_must_haves(&self) -> impl Iterator<Item = Dimension> + '_ {
        self.iter()
            .filter(|(_, e)| e.importance == Importance::Must && !e.passes())
            .map(|(dimension, _)| dimension)
    }

    /// `passes_must_haves` for this direction (10 section 3.2).
    pub fn passes_must_haves(&self) -> bool {
        self.failed_must_haves().next().is_none()
    }

    /// Whether at least one `must` dimension is set (reason `meets_your_must_haves`,
    /// 10 section 7).
    pub fn has_set_must(&self) -> bool {
        self.iter().any(|(_, e)| e.importance == Importance::Must)
    }
}

/// A sub-score with its verdict, before the importance is attached.
#[derive(Debug, Clone, Copy)]
struct Part {
    score: f64,
    verdict: Option<bool>,
}

impl Part {
    const PASS: Self = Self {
        score: 1.0,
        verdict: Some(true),
    };

    /// 10 section 4.3 rule 3: a set dimension with an unknown value scores 0.5.
    const UNKNOWN: Self = Self {
        score: 0.5,
        verdict: None,
    };

    const fn fail(score: f64) -> Self {
        Self {
            score,
            verdict: Some(false),
        }
    }

    /// "1 if in the set, else 0"; `None` (no value) is unknown.
    const fn membership(in_set: Option<bool>) -> Self {
        match in_set {
            Some(true) => Self::PASS,
            Some(false) => Self::fail(0.0),
            None => Self::UNKNOWN,
        }
    }
}

/// "Mean of the set parts" (10 section 4.4, `profession` and `family`). The parts pass
/// together only when every part passes; one known failure fails the whole.
fn mean_of_parts(first: Option<Part>, second: Option<Part>) -> Option<Part> {
    match (first, second) {
        (Some(a), Some(b)) => Some(Part {
            score: f64::midpoint(a.score, b.score),
            verdict: match (a.verdict, b.verdict) {
                (Some(false), _) | (_, Some(false)) => Some(false),
                (Some(true), Some(true)) => Some(true),
                _ => None,
            },
        }),
        (Some(part), None) | (None, Some(part)) => Some(part),
        (None, None) => None,
    }
}

/// The sub-score of a set dimension (10 section 4.4). `None` only if the dimension is not set.
fn part(prefs: &Preferences, dimension: Dimension, subject: &Subject, geo: &Geo) -> Option<Part> {
    let part = match dimension {
        Dimension::Age => range(
            subject.age,
            Some(i32::from(prefs.age_min)),
            Some(i32::from(prefs.age_max)),
            5,
        ),
        Dimension::Height => range(
            i32::from(subject.height_cm),
            prefs.height_min_cm.map(i32::from),
            prefs.height_max_cm.map(i32::from),
            10,
        ),
        Dimension::MaritalStatus => Part::membership(Some(
            prefs.marital_statuses.contains(&subject.marital_status),
        )),
        Dimension::Children => children(prefs.children_acceptance, subject.children())?,
        Dimension::Religion => Part::membership(Some(contains(
            &prefs.religion_codes,
            &subject.religion_code,
        ))),
        Dimension::Sect => code_membership(&prefs.sect_codes, subject.sect_code.as_deref()),
        Dimension::Caste => code_membership(&prefs.caste_codes, subject.caste_code.as_deref()),
        Dimension::MotherTongue => mother_tongue(&prefs.mother_tongue_codes, subject),
        Dimension::Location => location_level(prefs, subject, geo).part(),
        Dimension::Education => min_rank(subject.education_rank, prefs.education_min_rank?),
        Dimension::Profession => profession(prefs, subject)?,
        Dimension::Income => min_rank(subject.income_rank, prefs.income_min_rank?),
        Dimension::Religiosity => scaled_membership(
            &prefs.religiosity_levels,
            subject.religiosity,
            scales::religiosity,
        ),
        Dimension::Appearance => match subject.gender {
            Gender::Female => Part::membership(
                subject
                    .hijab
                    .map(|value| prefs.hijab_types.contains(&value)),
            ),
            Gender::Male => Part::membership(
                subject
                    .beard
                    .map(|value| prefs.beard_types.contains(&value)),
            ),
        },
        Dimension::Family => family(prefs, subject)?,
        Dimension::LivingArrangement => flexible_membership(
            &prefs.living_arrangements,
            subject.living_arrangement,
            LivingArrangement::Flexible,
        ),
        Dimension::WorkAfterMarriage => flexible_membership(
            &prefs.work_after_marriage_options,
            subject.work_after_marriage,
            WorkAfterMarriage::Flexible,
        ),
        Dimension::Smoking => Part::membership(
            subject
                .smoking
                .map(|value| prefs.smoking_options.contains(&value)),
        ),
    };
    Some(part)
}

fn contains(codes: &[String], code: &str) -> bool {
    codes.iter().any(|listed| listed == code)
}

fn code_membership(codes: &[String], code: Option<&str>) -> Part {
    Part::membership(code.map(|code| contains(codes, code)))
}

/// `age` and `height`: 1 inside the range; outside, `max(0, 1 - k / steps)` where `k` is the
/// distance beyond the nearer bound. `steps = 5` gives `1 - 0.2 * k` (age), `steps = 10` gives
/// `1 - 0.1 * k` (height). A `None` bound is open.
fn range(value: i32, min: Option<i32>, max: Option<i32>, steps: i32) -> Part {
    let below = min.map_or(0, |min| min - value).max(0);
    let above = max.map_or(0, |max| value - max).max(0);
    let beyond = below.max(above);
    if beyond == 0 {
        Part::PASS
    } else {
        Part::fail(f64::from((steps - beyond).max(0)) / f64::from(steps))
    }
}

/// `children` (10 section 4.4). `None` when the acceptance is `any` (not set).
fn children(acceptance: ChildrenAcceptance, status: Option<ChildrenStatus>) -> Option<Part> {
    let accepted = match acceptance {
        ChildrenAcceptance::Any => return None,
        ChildrenAcceptance::None => status.map(|status| status == ChildrenStatus::None),
        ChildrenAcceptance::NotLivingWithPartner => status.map(|status| {
            matches!(
                status,
                ChildrenStatus::None | ChildrenStatus::NotLivingWithMe
            )
        }),
    };
    Some(Part::membership(accepted))
}

/// `mother_tongue`: 1 if the mother tongue is listed, 0.5 if another language the subject
/// speaks is, else 0. The mother tongue is required, so this is never unknown.
fn mother_tongue(codes: &[String], subject: &Subject) -> Part {
    if contains(codes, &subject.mother_tongue_code) {
        Part::PASS
    } else if subject
        .language_codes
        .iter()
        .any(|code| contains(codes, code))
    {
        Part::fail(0.5)
    } else {
        Part::fail(0.0)
    }
}

/// `education` and `income`: 1 if rank >= minimum, 0.5 if rank = minimum - 1, else 0.
fn min_rank(rank: Option<i16>, minimum: i16) -> Part {
    let Some(rank) = rank else {
        return Part::UNKNOWN;
    };
    let (rank, minimum) = (i32::from(rank), i32::from(minimum));
    if rank >= minimum {
        Part::PASS
    } else if rank == minimum - 1 {
        Part::fail(0.5)
    } else {
        Part::fail(0.0)
    }
}

/// `profession`: the mean of the employment part and the profession part, each 1 in the set,
/// 0 not in the set, 0.5 unknown.
fn profession(prefs: &Preferences, subject: &Subject) -> Option<Part> {
    let employment = (!prefs.employment_types.is_empty()).then(|| {
        Part::membership(Some(
            prefs.employment_types.contains(&subject.employment_type),
        ))
    });
    let profession = (!prefs.profession_codes.is_empty())
        .then(|| code_membership(&prefs.profession_codes, subject.profession_code.as_deref()));
    mean_of_parts(employment, profession)
}

/// `family`: the mean of the values part (1 in the set, 0.5 adjacent, else 0) and the type
/// part (1 in the set, else 0). An unknown part scores 0.5.
fn family(prefs: &Preferences, subject: &Subject) -> Option<Part> {
    let values = (!prefs.family_values.is_empty()).then(|| {
        scaled_membership(
            &prefs.family_values,
            subject.family_values,
            scales::family_values,
        )
    });
    let types = (!prefs.family_types.is_empty()).then(|| {
        Part::membership(
            subject
                .family_type
                .map(|value| prefs.family_types.contains(&value)),
        )
    });
    mean_of_parts(values, types)
}

/// 1 if in the set, 0.5 if adjacent to a listed value on its ordered scale, else 0
/// (`religiosity`, family values).
fn scaled_membership<T: Copy + PartialEq>(
    listed: &[T],
    value: Option<T>,
    position: fn(T) -> i32,
) -> Part {
    let Some(value) = value else {
        return Part::UNKNOWN;
    };
    if listed.contains(&value) {
        Part::PASS
    } else if listed
        .iter()
        .any(|item| scales::adjacent(position(*item), position(value)))
    {
        Part::fail(0.5)
    } else {
        Part::fail(0.0)
    }
}

/// 1 if in the set, 0.7 if not but the subject is `flexible`, else 0 (`living_arrangement`,
/// `work_after_marriage`).
fn flexible_membership<T: Copy + PartialEq>(listed: &[T], value: Option<T>, flexible: T) -> Part {
    match value {
        None => Part::UNKNOWN,
        Some(value) if listed.contains(&value) => Part::PASS,
        Some(value) if value == flexible => Part::fail(0.7),
        Some(_) => Part::fail(0.0),
    }
}

/// The steps of the location sub-score (10 section 4.5), from best to worst.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocationLevel {
    /// The subject's city, region or country is listed: 1.0.
    Listed,
    /// The subject's region contains a listed city: 0.7.
    RegionOfListedCity,
    /// The subject's country contains a listed city or region: 0.4.
    CountryOfListedPlace,
    /// Elsewhere, but willing to move abroad (`abroad` or `anywhere`): 0.3.
    WillingToMoveAbroad,
    /// None of the above: 0.
    Elsewhere,
}

impl LocationLevel {
    const fn score(self) -> f64 {
        match self {
            Self::Listed => 1.0,
            Self::RegionOfListedCity => 0.7,
            Self::CountryOfListedPlace => 0.4,
            Self::WillingToMoveAbroad => 0.3,
            Self::Elsewhere => 0.0,
        }
    }

    /// The must test of `location` is `s = 1.0`. The subject's country is always known.
    const fn part(self) -> Part {
        match self {
            Self::Listed => Part::PASS,
            other => Part::fail(other.score()),
        }
    }
}

/// The steps of 10 section 4.5, in order. A subject without a `city_id` (`city_other`) can
/// still match by region or country (note 2).
fn location_level(prefs: &Preferences, subject: &Subject, geo: &Geo) -> LocationLevel {
    let city_listed = subject
        .city_id
        .is_some_and(|id| prefs.city_ids.contains(&id));
    let region_listed = subject
        .region_id
        .is_some_and(|id| prefs.region_ids.contains(&id));
    if city_listed || region_listed || contains(&prefs.country_codes, &subject.country_code) {
        return LocationLevel::Listed;
    }
    if subject
        .region_id
        .is_some_and(|region| geo.region_of_any_city(&prefs.city_ids, region))
    {
        return LocationLevel::RegionOfListedCity;
    }
    if geo.country_of_any(&prefs.city_ids, &prefs.region_ids, &subject.country_code) {
        return LocationLevel::CountryOfListedPlace;
    }
    if matches!(
        subject.relocation,
        Some(Relocation::Abroad | Relocation::Anywhere)
    ) {
        return LocationLevel::WillingToMoveAbroad;
    }
    LocationLevel::Elsewhere
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::matching::testkit::{
        self, DUBAI, DUBAI_EMIRATE, FAISALABAD, KARACHI, LAHORE, SINDH, assert_close, subject,
    };
    use crate::domain::options::{
        Beard, EmploymentType, FamilyType, FamilyValues, FieldVisibility, Hijab, MaritalStatus,
        Religiosity, Smoking,
    };

    fn prefs() -> Preferences {
        testkit::no_preferences()
    }

    fn score_of(prefs: &Preferences, dimension: Dimension, rows: testkit::Rows) -> Option<f64> {
        score(prefs, dimension, &subject(rows), &testkit::geo())
    }

    fn age_prefs(min: i16, max: i16) -> Preferences {
        let mut prefs = prefs();
        prefs.age_min = min;
        prefs.age_max = max;
        prefs
    }

    fn woman_aged(age: i32) -> testkit::Rows {
        let mut rows = testkit::woman();
        rows.date_of_birth = testkit::born_years_ago(age);
        rows
    }

    fn woman_in(city: i32, region: i32, country: &str) -> testkit::Rows {
        let mut rows = testkit::woman();
        rows.city_id = Some(city);
        rows.region_id = Some(region);
        rows.country_code = country.into();
        rows
    }

    fn location_of(prefs: &Preferences, rows: testkit::Rows) -> f64 {
        location_score(prefs, &subject(rows), &testkit::geo())
    }

    // 10 section 13, cases 1 to 28, 33 and 34.

    #[test]
    fn case_01_age_inside_the_range_scores_1() {
        assert_eq!(
            score_of(&age_prefs(25, 30), Dimension::Age, woman_aged(27)),
            Some(1.0)
        );
    }

    #[test]
    fn case_02_age_two_years_above_scores_0_6() {
        let score = score_of(&age_prefs(25, 30), Dimension::Age, woman_aged(32));
        assert_close(score.unwrap_or_default(), 0.6);
    }

    #[test]
    fn case_03_age_six_years_above_scores_0() {
        assert_eq!(
            score_of(&age_prefs(25, 30), Dimension::Age, woman_aged(36)),
            Some(0.0)
        );
    }

    #[test]
    fn case_04_age_18_to_80_is_not_set() {
        let subject = subject(testkit::woman());
        assert!(!is_set(&age_prefs(18, 80), Dimension::Age, &subject));
        assert!(is_set(&age_prefs(18, 79), Dimension::Age, &subject));
        assert!(is_set(&age_prefs(19, 80), Dimension::Age, &subject));
    }

    #[test]
    fn case_05_height_3_cm_below_an_open_ended_range_scores_0_7() {
        let mut prefs = prefs();
        prefs.height_min_cm = Some(160);
        let mut rows = testkit::woman();
        rows.height_cm = 157;
        let score = score_of(&prefs, Dimension::Height, rows);
        assert_close(score.unwrap_or_default(), 0.7);
    }

    #[test]
    fn case_06_marital_status_not_in_the_set_scores_0() {
        let mut prefs = prefs();
        prefs.marital_statuses = vec![MaritalStatus::NeverMarried];
        let mut rows = testkit::woman();
        rows.marital_status = MaritalStatus::Divorced;
        assert_eq!(score_of(&prefs, Dimension::MaritalStatus, rows), Some(0.0));
    }

    #[test]
    fn case_07_children_null_and_never_married_counts_as_none() {
        let mut prefs = prefs();
        prefs.children_acceptance = ChildrenAcceptance::None;
        let mut rows = testkit::woman();
        rows.children_status = None;
        rows.marital_status = MaritalStatus::NeverMarried;
        assert_eq!(score_of(&prefs, Dimension::Children, rows), Some(1.0));
    }

    #[test]
    fn case_08_children_living_with_the_subject_fail_not_living_with_partner() {
        let mut prefs = prefs();
        prefs.children_acceptance = ChildrenAcceptance::NotLivingWithPartner;
        let mut rows = testkit::woman();
        rows.marital_status = MaritalStatus::Divorced;
        rows.children_status = Some(ChildrenStatus::LivingWithMe);
        assert_eq!(score_of(&prefs, Dimension::Children, rows), Some(0.0));
    }

    fn caste_prefs(importance: Importance) -> Preferences {
        let mut prefs = prefs();
        prefs.caste_codes = vec!["rajput".into()];
        prefs.caste_importance = importance;
        prefs
    }

    fn rajput_hidden_from_members() -> testkit::Rows {
        let mut rows = testkit::woman();
        rows.caste_code = Some("rajput".into());
        rows.caste_visibility = FieldVisibility::Connections;
        rows
    }

    #[test]
    fn case_09_hidden_caste_scores_unknown() {
        assert_eq!(
            score_of(
                &caste_prefs(Importance::Medium),
                Dimension::Caste,
                rajput_hidden_from_members()
            ),
            Some(0.5)
        );
    }

    #[test]
    fn case_10_hidden_caste_fails_a_caste_must_have() {
        let subject = subject(rajput_hidden_from_members());
        let prefs = caste_prefs(Importance::Must);
        assert!(!must_test(
            &prefs,
            Dimension::Caste,
            &subject,
            &testkit::geo()
        ));
        assert!(!passes_must_haves(&prefs, &subject, &testkit::geo()));
    }

    #[test]
    fn case_11_typed_caste_only_scores_unknown() {
        let mut rows = testkit::woman();
        rows.caste_code = None; // `caste_other` is set instead
        assert_eq!(
            score_of(&caste_prefs(Importance::Low), Dimension::Caste, rows),
            Some(0.5)
        );
    }

    #[test]
    fn case_12_other_spoken_language_scores_0_5() {
        let mut prefs = prefs();
        prefs.mother_tongue_codes = vec!["urdu".into()];
        let mut rows = testkit::woman();
        rows.mother_tongue_code = "punjabi".into();
        rows.language_codes = vec!["urdu".into()];
        assert_eq!(score_of(&prefs, Dimension::MotherTongue, rows), Some(0.5));
    }

    fn lahore_prefs() -> Preferences {
        let mut prefs = prefs();
        prefs.city_ids = vec![LAHORE];
        prefs
    }

    fn pk_prefs() -> Preferences {
        let mut prefs = prefs();
        prefs.country_codes = vec!["PK".into()];
        prefs
    }

    #[test]
    fn case_13_listed_city_scores_1() {
        let rows = woman_in(LAHORE, testkit::PUNJAB, "PK");
        assert_close(location_of(&lahore_prefs(), rows), 1.0);
    }

    #[test]
    fn case_14_city_in_the_region_of_a_listed_city_scores_0_7() {
        let rows = woman_in(FAISALABAD, testkit::PUNJAB, "PK");
        assert_close(location_of(&lahore_prefs(), rows), 0.7);
    }

    #[test]
    fn case_15_city_in_the_country_of_a_listed_city_scores_0_4() {
        let rows = woman_in(KARACHI, SINDH, "PK");
        assert_close(location_of(&lahore_prefs(), rows), 0.4);
    }

    #[test]
    fn case_16_abroad_but_willing_to_move_anywhere_scores_0_3() {
        let mut rows = woman_in(DUBAI, DUBAI_EMIRATE, "AE");
        rows.relocation = Some(Relocation::Anywhere);
        assert_close(location_of(&pk_prefs(), rows), 0.3);
    }

    #[test]
    fn case_17_abroad_and_not_willing_to_move_scores_0() {
        let mut rows = woman_in(DUBAI, DUBAI_EMIRATE, "AE");
        rows.relocation = Some(Relocation::NotWilling);
        assert_close(location_of(&pk_prefs(), rows), 0.0);
    }

    #[test]
    fn case_18_a_listed_country_accepts_every_city_in_it() {
        let mut prefs = pk_prefs();
        prefs.city_ids = vec![LAHORE];
        let rows = woman_in(KARACHI, SINDH, "PK");
        assert_close(location_of(&prefs, rows), 1.0);
    }

    #[test]
    fn case_19_education_one_rank_below_scores_0_5() {
        let mut prefs = prefs();
        prefs.education_min_rank = Some(5);
        let mut rows = testkit::woman();
        rows.education_rank = Some(4);
        assert_eq!(score_of(&prefs, Dimension::Education, rows), Some(0.5));
    }

    fn income_prefs() -> Preferences {
        let mut prefs = prefs();
        prefs.income_min_rank = Some(4);
        prefs
    }

    #[test]
    fn case_20_visible_income_above_the_minimum_scores_1() {
        let mut rows = testkit::woman();
        rows.income_rank = Some(5);
        rows.income_visibility = FieldVisibility::Members;
        assert_eq!(
            score_of(&income_prefs(), Dimension::Income, rows),
            Some(1.0)
        );
    }

    #[test]
    fn case_21_missing_income_scores_unknown() {
        let mut rows = testkit::woman();
        rows.income_rank = None;
        rows.income_visibility = FieldVisibility::Members;
        assert_eq!(
            score_of(&income_prefs(), Dimension::Income, rows),
            Some(0.5)
        );
    }

    fn very_practising_prefs() -> Preferences {
        let mut prefs = prefs();
        prefs.religiosity_levels = vec![Religiosity::VeryPractising];
        prefs
    }

    #[test]
    fn case_22_adjacent_religiosity_scores_0_5() {
        let mut rows = testkit::woman();
        rows.religiosity = Some(Religiosity::Practising);
        assert_eq!(
            score_of(&very_practising_prefs(), Dimension::Religiosity, rows),
            Some(0.5)
        );
    }

    #[test]
    fn case_23_religiosity_two_steps_away_scores_0() {
        let mut rows = testkit::woman();
        rows.religiosity = Some(Religiosity::ModeratelyPractising);
        assert_eq!(
            score_of(&very_practising_prefs(), Dimension::Religiosity, rows),
            Some(0.0)
        );
    }

    #[test]
    fn case_24_hijab_type_not_listed_scores_0() {
        // The viewer is a man, so the subject is a woman and `hijab_types` applies.
        let mut prefs = prefs();
        prefs.hijab_types = vec![Hijab::Hijab, Hijab::Niqab];
        let mut rows = testkit::woman();
        rows.hijab = Some(Hijab::Dupatta);
        assert_eq!(score_of(&prefs, Dimension::Appearance, rows), Some(0.0));
    }

    #[test]
    fn case_25_appearance_is_not_set_without_beard_types_for_a_man() {
        // The viewer is a woman, so the subject is a man and only `beard_types` counts.
        let mut prefs = prefs();
        prefs.hijab_types = vec![Hijab::Hijab];
        let man = subject(testkit::man());
        assert!(!is_set(&prefs, Dimension::Appearance, &man));
        assert!(is_set(
            &prefs,
            Dimension::Appearance,
            &subject(testkit::woman())
        ));
    }

    #[test]
    fn case_26_profession_with_one_unknown_part_scores_0_75() {
        let mut prefs = prefs();
        prefs.employment_types = vec![EmploymentType::GovernmentJob];
        prefs.profession_codes = vec!["doctor".into()];
        let mut rows = testkit::woman();
        rows.employment_type = EmploymentType::GovernmentJob;
        rows.profession_code = None;
        assert_eq!(score_of(&prefs, Dimension::Profession, rows), Some(0.75));
    }

    #[test]
    fn case_27_adjacent_family_values_score_0_5() {
        let mut prefs = prefs();
        prefs.family_values = vec![FamilyValues::Religious];
        let mut rows = testkit::woman();
        rows.family_values = Some(FamilyValues::Traditional);
        rows.family_visibility = FieldVisibility::Members;
        assert_eq!(score_of(&prefs, Dimension::Family, rows), Some(0.5));
    }

    #[test]
    fn case_28_flexible_living_arrangement_scores_0_7() {
        let mut prefs = prefs();
        prefs.living_arrangements = vec![LivingArrangement::Separate];
        let mut rows = testkit::woman();
        rows.living_arrangement = Some(LivingArrangement::Flexible);
        let score = score_of(&prefs, Dimension::LivingArrangement, rows);
        assert_close(score.unwrap_or_default(), 0.7);
    }

    #[test]
    fn case_33_a_must_have_with_no_values_filters_nothing() {
        let mut prefs = prefs();
        prefs.religion_importance = Importance::Must;
        prefs.religion_codes = Vec::new();
        let mut rows = testkit::woman();
        rows.religion_code = "christianity".into();
        assert!(passes_must_haves(&prefs, &subject(rows), &testkit::geo()));
    }

    #[test]
    fn case_34_an_unknown_sect_fails_a_sect_must_have() {
        let mut prefs = prefs();
        prefs.sect_importance = Importance::Must;
        prefs.sect_codes = vec!["sunni".into()];
        let mut rows = testkit::woman();
        rows.sect_code = None;
        assert!(!passes_must_haves(&prefs, &subject(rows), &testkit::geo()));
    }

    // Further edge cases.

    #[test]
    fn nothing_is_set_in_empty_preferences() {
        let prefs = prefs();
        for rows in [testkit::man(), testkit::woman()] {
            let subject = subject(rows);
            for dimension in Dimension::ALL {
                assert!(!is_set(&prefs, *dimension, &subject), "{dimension}");
                assert_eq!(score(&prefs, *dimension, &subject, &testkit::geo()), None);
                assert!(must_test(&prefs, *dimension, &subject, &testkit::geo()));
            }
        }
    }

    #[test]
    fn dimension_keys_and_order_match_the_spec() {
        assert_eq!(Dimension::ALL.len(), Dimension::COUNT);
        let keys: Vec<&str> = Dimension::ALL.iter().map(|d| d.as_str()).collect();
        assert_eq!(
            keys,
            [
                "age",
                "height",
                "marital_status",
                "children",
                "religion",
                "sect",
                "caste",
                "mother_tongue",
                "location",
                "education",
                "profession",
                "income",
                "religiosity",
                "appearance",
                "family",
                "living_arrangement",
                "work_after_marriage",
                "smoking",
            ]
        );
        for (index, dimension) in Dimension::ALL.iter().enumerate() {
            assert_eq!(dimension.index(), index);
        }
    }

    #[test]
    fn age_below_the_range_counts_years_to_the_lower_bound() {
        let score = score_of(&age_prefs(25, 30), Dimension::Age, woman_aged(24));
        assert_close(score.unwrap_or_default(), 0.8);
    }

    #[test]
    fn height_bounds_are_open_when_null() {
        let mut prefs = prefs();
        prefs.height_max_cm = Some(170);
        let mut rows = testkit::woman();
        rows.height_cm = 150;
        assert_eq!(score_of(&prefs, Dimension::Height, rows.clone()), Some(1.0));
        rows.height_cm = 185;
        assert_eq!(score_of(&prefs, Dimension::Height, rows), Some(0.0));
    }

    #[test]
    fn children_unknown_when_null_and_previously_married() {
        let mut prefs = prefs();
        prefs.children_acceptance = ChildrenAcceptance::None;
        prefs.children_importance = Importance::Must;
        let mut rows = testkit::woman();
        rows.children_status = None;
        rows.marital_status = MaritalStatus::Widowed;
        let subject = subject(rows);
        assert_eq!(
            score(&prefs, Dimension::Children, &subject, &testkit::geo()),
            Some(0.5)
        );
        assert!(!passes_must_haves(&prefs, &subject, &testkit::geo()));
    }

    #[test]
    fn children_not_living_with_the_subject_are_accepted() {
        let mut prefs = prefs();
        prefs.children_acceptance = ChildrenAcceptance::NotLivingWithPartner;
        let mut rows = testkit::woman();
        rows.marital_status = MaritalStatus::Divorced;
        rows.children_status = Some(ChildrenStatus::NotLivingWithMe);
        assert_eq!(score_of(&prefs, Dimension::Children, rows), Some(1.0));
    }

    #[test]
    fn region_listed_directly_scores_1_and_city_other_matches_by_region() {
        let mut prefs = prefs();
        prefs.region_ids = vec![testkit::PUNJAB];
        let mut rows = woman_in(FAISALABAD, testkit::PUNJAB, "PK");
        rows.city_id = None;
        assert_close(location_of(&prefs, rows), 1.0);
    }

    #[test]
    fn country_of_a_listed_region_scores_0_4() {
        let mut prefs = prefs();
        prefs.region_ids = vec![testkit::PUNJAB];
        let rows = woman_in(KARACHI, SINDH, "PK");
        assert_close(location_of(&prefs, rows), 0.4);
    }

    #[test]
    fn relocation_within_country_does_not_earn_the_abroad_step() {
        let mut rows = woman_in(DUBAI, DUBAI_EMIRATE, "AE");
        rows.relocation = Some(Relocation::WithinCountry);
        assert_close(location_of(&pk_prefs(), rows.clone()), 0.0);
        rows.relocation = Some(Relocation::Abroad);
        assert_close(location_of(&pk_prefs(), rows), 0.3);
    }

    #[test]
    fn location_is_a_must_only_at_full_score() {
        let mut prefs = lahore_prefs();
        prefs.location_importance = Importance::Must;
        let geo = testkit::geo();
        let faisalabad = subject(woman_in(FAISALABAD, testkit::PUNJAB, "PK"));
        let lahore = subject(woman_in(LAHORE, testkit::PUNJAB, "PK"));
        assert!(!passes_must_haves(&prefs, &faisalabad, &geo));
        assert!(passes_must_haves(&prefs, &lahore, &geo));
    }

    #[test]
    fn education_unknown_rank_and_far_below() {
        let mut prefs = prefs();
        prefs.education_min_rank = Some(6);
        let mut rows = testkit::woman();
        rows.education_rank = None;
        assert_eq!(
            score_of(&prefs, Dimension::Education, rows.clone()),
            Some(0.5)
        );
        rows.education_rank = Some(4);
        assert_eq!(
            score_of(&prefs, Dimension::Education, rows.clone()),
            Some(0.0)
        );
        rows.education_rank = Some(8);
        assert_eq!(score_of(&prefs, Dimension::Education, rows), Some(1.0));
    }

    #[test]
    fn income_hidden_from_members_is_unknown_even_when_stated() {
        let mut rows = testkit::woman();
        rows.income_rank = Some(7);
        rows.income_visibility = FieldVisibility::Connections;
        assert_eq!(
            score_of(&income_prefs(), Dimension::Income, rows),
            Some(0.5)
        );
    }

    #[test]
    fn profession_parts() {
        let mut prefs = prefs();
        prefs.employment_types = vec![EmploymentType::GovernmentJob];
        prefs.profession_codes = vec!["doctor".into()];
        let mut rows = testkit::woman();
        rows.employment_type = EmploymentType::PrivateJob;
        rows.profession_code = Some("doctor".into());
        assert_eq!(
            score_of(&prefs, Dimension::Profession, rows.clone()),
            Some(0.5)
        );
        rows.employment_type = EmploymentType::GovernmentJob;
        assert_eq!(
            score_of(&prefs, Dimension::Profession, rows.clone()),
            Some(1.0)
        );

        // Only the profession part set: the unknown profession is the whole score.
        prefs.employment_types.clear();
        rows.profession_code = None;
        assert_eq!(score_of(&prefs, Dimension::Profession, rows), Some(0.5));
    }

    #[test]
    fn profession_must_fails_when_a_part_is_unknown() {
        let mut prefs = prefs();
        prefs.profession_importance = Importance::Must;
        prefs.employment_types = vec![EmploymentType::GovernmentJob];
        prefs.profession_codes = vec!["doctor".into()];
        let mut rows = testkit::woman();
        rows.employment_type = EmploymentType::GovernmentJob;
        rows.profession_code = None;
        let subject = subject(rows);
        let evaluation = evaluate(&prefs, Dimension::Profession, &subject, &testkit::geo());
        assert_eq!(evaluation.and_then(|e| e.verdict), None);
        assert!(!passes_must_haves(&prefs, &subject, &testkit::geo()));
    }

    #[test]
    fn family_type_part_and_hidden_family() {
        let mut prefs = prefs();
        prefs.family_values = vec![FamilyValues::Moderate];
        prefs.family_types = vec![FamilyType::Nuclear];
        let mut rows = testkit::woman();
        rows.family_values = Some(FamilyValues::Moderate);
        rows.family_type = Some(FamilyType::Joint);
        assert_eq!(score_of(&prefs, Dimension::Family, rows.clone()), Some(0.5));
        rows.family_type = Some(FamilyType::Nuclear);
        assert_eq!(score_of(&prefs, Dimension::Family, rows.clone()), Some(1.0));
        rows.family_visibility = FieldVisibility::Nobody;
        assert_eq!(score_of(&prefs, Dimension::Family, rows), Some(0.5));
    }

    #[test]
    fn beard_types_apply_to_a_man() {
        let mut prefs = prefs();
        prefs.beard_types = vec![Beard::Full, Beard::Trimmed];
        let mut rows = testkit::man();
        rows.beard = Some(Beard::Trimmed);
        assert_eq!(
            score_of(&prefs, Dimension::Appearance, rows.clone()),
            Some(1.0)
        );
        rows.beard = None;
        assert_eq!(score_of(&prefs, Dimension::Appearance, rows), Some(0.5));
    }

    #[test]
    fn work_after_marriage_and_smoking() {
        let mut prefs = prefs();
        prefs.work_after_marriage_options = vec![WorkAfterMarriage::Yes];
        prefs.smoking_options = vec![Smoking::No];
        let mut rows = testkit::woman();
        rows.work_after_marriage = Some(WorkAfterMarriage::Flexible);
        rows.smoking = Some(Smoking::Occasionally);
        let score = score_of(&prefs, Dimension::WorkAfterMarriage, rows.clone());
        assert_close(score.unwrap_or_default(), 0.7);
        assert_eq!(
            score_of(&prefs, Dimension::Smoking, rows.clone()),
            Some(0.0)
        );
        rows.work_after_marriage = Some(WorkAfterMarriage::No);
        rows.smoking = None;
        assert_eq!(
            score_of(&prefs, Dimension::WorkAfterMarriage, rows.clone()),
            Some(0.0)
        );
        assert_eq!(score_of(&prefs, Dimension::Smoking, rows), Some(0.5));
    }

    #[test]
    fn every_importance_level_is_attached_and_only_must_filters() {
        let geo = testkit::geo();
        let mut rows = testkit::woman();
        rows.sect_code = Some("shia".into());
        let subject = subject(rows);
        for level in Importance::ALL {
            let mut prefs = prefs();
            prefs.sect_codes = vec!["sunni".into()];
            prefs.sect_importance = *level;
            let evaluation = evaluate(&prefs, Dimension::Sect, &subject, &geo);
            assert_eq!(evaluation.map(|e| e.importance), Some(*level));
            assert_eq!(
                passes_must_haves(&prefs, &subject, &geo),
                *level != Importance::Must
            );
        }
    }

    #[test]
    fn assessment_lists_set_dimensions_and_failed_musts() {
        let mut prefs = prefs();
        prefs.religion_codes = vec!["islam".into()];
        prefs.religion_importance = Importance::Must;
        prefs.caste_codes = vec!["arain".into()];
        prefs.caste_importance = Importance::Must;
        prefs.smoking_options = vec![Smoking::No];
        prefs.smoking_importance = Importance::Low;
        let mut rows = testkit::woman();
        rows.caste_code = Some("jutt".into());
        rows.smoking = Some(Smoking::Yes);
        let assessment = Assessment::new(&prefs, &subject(rows), &testkit::geo());
        assert_eq!(assessment.set_count(), 3);
        assert!(assessment.has_set_must());
        assert_eq!(
            assessment.failed_must_haves().collect::<Vec<_>>(),
            [Dimension::Caste]
        );
        assert!(!assessment.passes_must_haves());
        assert_eq!(assessment.get(Dimension::Age), None);
        assert_eq!(
            assessment.iter().map(|(d, _)| d).collect::<Vec<_>>(),
            [Dimension::Religion, Dimension::Caste, Dimension::Smoking]
        );
    }
}
