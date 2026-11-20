//! Directional fit, similarity and compatibility (10 section 5), and [`Pair`], which holds
//! both directions of one viewer and candidate so every number is computed once.

use crate::domain::matching::dimensions::{Assessment, Dimension};
use crate::domain::matching::scales;
use crate::domain::matching::subject::{Geo, Subject};
use crate::domain::matching::weights::{self, similarity as feature};
use crate::domain::options::{Gender, LivingArrangement};
use crate::domain::preferences::Preferences;

/// The fit when no dimension is set (10 section 5.1).
pub const NEUTRAL_FIT: f64 = 0.75;

/// The similarity when every feature is skipped (10 section 5.2).
pub const NEUTRAL_SIMILARITY: f64 = 0.5;

/// `fit(prefs, subject)` (10 section 5.1): the weighted mean of the sub-scores of the set
/// dimensions, or [`NEUTRAL_FIT`] when none is set.
pub fn fit(prefs: &Preferences, subject: &Subject, geo: &Geo) -> f64 {
    fit_of(&Assessment::new(prefs, subject, geo))
}

/// [`fit`] over an assessment that is already built.
pub fn fit_of(assessment: &Assessment) -> f64 {
    let (numerator, denominator) =
        assessment
            .iter()
            .fold((0.0, 0.0), |(numerator, denominator), (dimension, e)| {
                let weight = weights::weight(dimension, e.importance);
                (numerator + weight * e.score, denominator + weight)
            });
    if denominator > 0.0 {
        numerator / denominator
    } else {
        NEUTRAL_FIT
    }
}

/// `similarity` (10 section 5.2): shared background, independent of stated preferences and
/// symmetric. Features whose data is missing on either side are skipped; when every feature is
/// skipped the result is [`NEUTRAL_SIMILARITY`].
pub fn similarity(a: &Subject, b: &Subject) -> f64 {
    let features = [
        (feature::PLACE, Some(place(a, b))),
        (feature::MOTHER_TONGUE, Some(mother_tongue(a, b))),
        (
            feature::SECT,
            both(a.sect_code.as_ref(), b.sect_code.as_ref()).map(|(x, y)| same(x, y)),
        ),
        (
            feature::RELIGIOSITY,
            both(a.religiosity, b.religiosity)
                .map(|(x, y)| closeness(scales::religiosity(x), scales::religiosity(y), 3)),
        ),
        (
            feature::EDUCATION,
            both(a.education_rank, b.education_rank).map(|(x, y)| {
                let gap = (i32::from(x) - i32::from(y)).abs().min(4);
                closeness(gap, 0, 4)
            }),
        ),
        (feature::AGE_GAP, age_gap(a, b)),
        (
            feature::CASTE,
            both(a.caste_code.as_ref(), b.caste_code.as_ref()).map(|(x, y)| same(x, y)),
        ),
        (
            feature::FAMILY_VALUES,
            both(a.family_values, b.family_values)
                .map(|(x, y)| closeness(scales::family_values(x), scales::family_values(y), 3)),
        ),
        (
            feature::PRAYER,
            both(a.prayer_frequency, b.prayer_frequency).map(|(x, y)| {
                closeness(scales::prayer_frequency(x), scales::prayer_frequency(y), 4)
            }),
        ),
        (feature::HOBBIES, hobbies(a, b)),
        (
            feature::MARRIAGE_TIMELINE,
            both(a.marriage_timeline, b.marriage_timeline).map(|(x, y)| {
                match (scales::marriage_timeline(x), scales::marriage_timeline(y)) {
                    (Some(x), Some(y)) => closeness(x, y, 2),
                    _ => 0.5,
                }
            }),
        ),
        (
            feature::LIVING_ARRANGEMENT,
            both(a.living_arrangement, b.living_arrangement).map(|(x, y)| {
                if x == y {
                    1.0
                } else if x == LivingArrangement::Flexible || y == LivingArrangement::Flexible {
                    0.7
                } else {
                    0.0
                }
            }),
        ),
    ];
    let (numerator, denominator) = features
        .iter()
        .filter_map(|(weight, value)| value.map(|value| (*weight, value)))
        .fold((0.0, 0.0), |(numerator, denominator), (weight, value)| {
            (numerator + weight * value, denominator + weight)
        });
    if denominator > 0.0 {
        numerator / denominator
    } else {
        NEUTRAL_SIMILARITY
    }
}

/// `compat` (10 section 5.3):
/// `round(100 * (0.75 * sqrt(fit_VC * fit_CV) + 0.25 * similarity))`, round half up, clamped
/// to 0..=100. Symmetric: swapping the two fits gives the same number.
pub fn compat(fit_vc: f64, fit_cv: f64, similarity: f64) -> u8 {
    let mutual = (fit_vc * fit_cv).max(0.0).sqrt();
    round_percent(100.0 * (0.75 * mutual + 0.25 * similarity))
}

/// Rounds a percentage half up to a whole number and clamps it to 0..=100 (10 section 5.3
/// rule 1). A tolerance of 1e-9 absorbs binary representation error, so a value that is
/// mathematically `x.5` but computed as `x.4999999999` still rounds up. `NaN` gives 0.
pub fn round_percent(value: f64) -> u8 {
    let rounded = (value + 0.5 + 1e-9).floor().clamp(0.0, 100.0);
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "clamped to 0..=100 above; NaN converts to 0"
    )]
    let percent = rounded as u8;
    percent
}

/// One member as one side of a pair: the matchable view and the preferences.
#[derive(Debug, Clone, Copy)]
pub struct Side<'a> {
    /// The matchable view ([`Subject::from_rows`]).
    pub subject: &'a Subject,
    /// The member's `partner_preferences`, or the defaults of 07 section 12 when there is no
    /// row (10 section 3.2 rule 4).
    pub prefs: &'a Preferences,
}

/// A viewer V and a candidate C with both directions evaluated: V's preferences against C
/// (forward, `fit_VC`) and C's preferences against V (backward, `fit_CV`). On the profile
/// screen the candidate is the owner O.
#[derive(Debug, Clone)]
pub struct Pair<'a> {
    viewer: Side<'a>,
    candidate: Side<'a>,
    geo: &'a Geo,
    forward: Assessment,
    backward: Assessment,
    similarity: f64,
}

impl<'a> Pair<'a> {
    /// Evaluates both directions and the similarity.
    pub fn new(viewer: Side<'a>, candidate: Side<'a>, geo: &'a Geo) -> Self {
        Self {
            forward: Assessment::new(viewer.prefs, candidate.subject, geo),
            backward: Assessment::new(candidate.prefs, viewer.subject, geo),
            similarity: similarity(viewer.subject, candidate.subject),
            viewer,
            candidate,
            geo,
        }
    }

    /// The viewer.
    pub fn viewer(&self) -> Side<'a> {
        self.viewer
    }

    /// The candidate (the owner, on the profile screen).
    pub fn candidate(&self) -> Side<'a> {
        self.candidate
    }

    /// The place lookup the pair was evaluated with.
    pub fn geo(&self) -> &'a Geo {
        self.geo
    }

    /// V's preferences against C.
    pub fn forward(&self) -> &Assessment {
        &self.forward
    }

    /// C's preferences against V.
    pub fn backward(&self) -> &Assessment {
        &self.backward
    }

    /// `fit_VC = fit(V.prefs, C)`: how well the candidate fits the viewer.
    pub fn fit_vc(&self) -> f64 {
        fit_of(&self.forward)
    }

    /// `fit_CV = fit(C.prefs, V)`: how well the viewer fits the candidate.
    pub fn fit_cv(&self) -> f64 {
        fit_of(&self.backward)
    }

    /// `similarity(V, C)`.
    pub fn similarity(&self) -> f64 {
        self.similarity
    }

    /// `compat` (10 section 5.3), the only matching number members see.
    pub fn compat(&self) -> u8 {
        compat(self.fit_vc(), self.fit_cv(), self.similarity)
    }

    /// `round(100 * fit_VC)` (10 section 5.3 rule 5).
    pub fn viewer_fit(&self) -> u8 {
        round_percent(100.0 * self.fit_vc())
    }

    /// `round(100 * fit_CV)` (10 section 5.3 rule 5).
    pub fn owner_fit(&self) -> u8 {
        round_percent(100.0 * self.fit_cv())
    }

    /// M1: `passes_must_haves(V.prefs, C)`.
    pub fn candidate_meets_viewer_must_haves(&self) -> bool {
        self.forward.passes_must_haves()
    }

    /// M2: `passes_must_haves(C.prefs, V)`. Also the E8 test for a `preference_match`
    /// candidate.
    pub fn viewer_meets_candidate_must_haves(&self) -> bool {
        self.backward.passes_must_haves()
    }

    /// The viewer's must-have dimensions the candidate fails (relaxation hints, 10 section 8.7).
    pub fn failed_viewer_must_haves(&self) -> impl Iterator<Item = Dimension> + '_ {
        self.forward.failed_must_haves()
    }
}

fn both<A, B>(a: Option<A>, b: Option<B>) -> Option<(A, B)> {
    a.zip(b)
}

fn same<T: PartialEq>(a: &T, b: &T) -> f64 {
    if a == b { 1.0 } else { 0.0 }
}

/// `1 - abs(a - b) / span`, written as a fraction of integers so that, for example, 2/3 is
/// the nearest `f64` to two thirds. Never negative.
fn closeness(a: i32, b: i32, span: i32) -> f64 {
    f64::from((span - (a - b).abs()).max(0)) / f64::from(span)
}

/// `place`: same city 1.0, else same region 0.6, else same origin city 0.6, else same
/// country 0.3, else 0.
fn place(a: &Subject, b: &Subject) -> f64 {
    let equal = |x: Option<i32>, y: Option<i32>| x.is_some() && x == y;
    if equal(a.city_id, b.city_id) {
        1.0
    } else if equal(a.region_id, b.region_id) || equal(a.origin_city_id, b.origin_city_id) {
        0.6
    } else if a.country_code == b.country_code {
        0.3
    } else {
        0.0
    }
}

/// `mother_tongue`: same 1.0, else one speaks the other's mother tongue 0.3, else 0.
fn mother_tongue(a: &Subject, b: &Subject) -> f64 {
    if a.mother_tongue_code == b.mother_tongue_code {
        1.0
    } else if a.speaks(&b.mother_tongue_code) || b.speaks(&a.mother_tongue_code) {
        0.3
    } else {
        0.0
    }
}

/// `age_gap`: `g` is the man's age minus the woman's age. Skipped for two subjects of the same
/// gender, who are never paired (E1).
fn age_gap(a: &Subject, b: &Subject) -> Option<f64> {
    let gap = match (a.gender, b.gender) {
        (Gender::Male, Gender::Female) => a.age - b.age,
        (Gender::Female, Gender::Male) => b.age - a.age,
        _ => return None,
    };
    Some(match gap {
        0..=5 => 1.0,
        6..=8 | -2..=-1 => 0.7,
        9..=12 | -5..=-3 => 0.4,
        _ => 0.1,
    })
}

/// `hobbies`: `min(1, 2 * jaccard)`, skipped unless both have at least one hobby. Hobby lists
/// are sorted and unique ([`Subject::from_rows`]).
fn hobbies(a: &Subject, b: &Subject) -> Option<f64> {
    if a.hobby_codes.is_empty() || b.hobby_codes.is_empty() {
        return None;
    }
    let shared = shared_count(&a.hobby_codes, &b.hobby_codes);
    let union = a.hobby_codes.len() + b.hobby_codes.len() - shared;
    let jaccard = count(shared) / count(union);
    Some((2.0 * jaccard).min(1.0))
}

/// Elements of `a` also in `b`. Both lists are short (at most 10 hobbies).
pub(crate) fn shared_count(a: &[String], b: &[String]) -> usize {
    a.iter().filter(|item| b.contains(item)).count()
}

/// A small count as `f64`, without a lossy cast.
fn count(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::matching::testkit::{
        self, ahmed, ahmed_prefs, assert_close, assert_near, fatima, fatima_prefs, subject,
    };
    use crate::domain::options::{
        FamilyValues, FieldVisibility, MarriageTimeline, PrayerFrequency, Religiosity,
    };

    fn worked_example() -> (Subject, Preferences, Subject, Preferences) {
        (
            subject(ahmed()),
            ahmed_prefs(),
            subject(fatima()),
            fatima_prefs(),
        )
    }

    #[test]
    fn case_29_no_dimension_set_gives_the_neutral_fit() {
        let geo = testkit::geo();
        assert_close(
            fit(&testkit::no_preferences(), &subject(testkit::woman()), &geo),
            0.75,
        );
    }

    #[test]
    fn case_30_worked_example_fit_of_the_candidate_to_the_viewer() {
        let (_, v_prefs, c, _) = worked_example();
        let fit_vc = fit(&v_prefs, &c, &testkit::geo());
        assert_near(fit_vc, 0.9693, 0.0005);
        assert_close(fit_vc, 66.4 / 68.5);
    }

    #[test]
    fn case_31_worked_example_compat_is_92() {
        let (v, v_prefs, c, c_prefs) = worked_example();
        let geo = testkit::geo();
        let pair = Pair::new(
            Side {
                subject: &v,
                prefs: &v_prefs,
            },
            Side {
                subject: &c,
                prefs: &c_prefs,
            },
            &geo,
        );
        assert_eq!(pair.compat(), 92);
    }

    #[test]
    fn case_32_compat_is_symmetric() {
        let (v, v_prefs, c, c_prefs) = worked_example();
        let geo = testkit::geo();
        let swapped = Pair::new(
            Side {
                subject: &c,
                prefs: &c_prefs,
            },
            Side {
                subject: &v,
                prefs: &v_prefs,
            },
            &geo,
        );
        assert_eq!(swapped.compat(), 92);
        assert_close(swapped.fit_vc(), 57.0 / 59.5);
        assert_close(swapped.fit_cv(), 66.4 / 68.5);
    }

    #[test]
    fn worked_example_reproduces_every_stated_number() {
        let (v, v_prefs, c, c_prefs) = worked_example();
        let geo = testkit::geo();
        let pair = Pair::new(
            Side {
                subject: &v,
                prefs: &v_prefs,
            },
            Side {
                subject: &c,
                prefs: &c_prefs,
            },
            &geo,
        );

        // Must-haves: both remain.
        assert!(pair.candidate_meets_viewer_must_haves());
        assert!(pair.viewer_meets_candidate_must_haves());

        // fit_VC = 66.4 / 68.5 = 0.9693; fit_CV = 57.0 / 59.5 = 0.9580.
        assert_near(pair.fit_vc(), 0.9693, 0.00005);
        assert_near(pair.fit_cv(), 0.9580, 0.00005);
        assert_close(pair.fit_cv(), 57.0 / 59.5);

        // Each line of the fit_VC table.
        let forward = pair.forward();
        let line = |d: Dimension| forward.get(d).map(|e| e.score);
        assert_eq!(line(Dimension::Age), Some(1.0));
        assert_eq!(line(Dimension::Religion), Some(1.0));
        assert_eq!(line(Dimension::Sect), Some(1.0));
        assert_eq!(line(Dimension::MaritalStatus), Some(1.0));
        assert_close(line(Dimension::Location).unwrap_or_default(), 0.7);
        assert_eq!(line(Dimension::Education), Some(1.0));
        assert_eq!(line(Dimension::Religiosity), Some(1.0));
        assert_eq!(forward.set_count(), 7);

        // The income line of fit_CV: V hides income, so it is unknown.
        assert_eq!(
            pair.backward().get(Dimension::Income).map(|e| e.score),
            Some(0.5)
        );
        assert_eq!(pair.backward().set_count(), 6);

        // similarity = 15.55 / 20 = 0.7775.
        assert_close(pair.similarity(), 15.55 / 20.0);

        // sqrt(0.9693 * 0.9580) = 0.9636; compat = round(91.71) = 92.
        let mutual = (pair.fit_vc() * pair.fit_cv()).sqrt();
        assert_near(mutual, 0.9636, 0.00005);
        let raw = 100.0 * (0.75 * mutual + 0.25 * pair.similarity());
        assert_near(raw, 91.71, 0.005);
        assert_eq!(pair.compat(), 92);
        assert_eq!(pair.viewer_fit(), 97);
        assert_eq!(pair.owner_fit(), 96);
    }

    #[test]
    fn worked_example_similarity_features() {
        let (v, _, c, _) = worked_example();
        assert_close(place(&v, &c), 0.6);
        assert_close(mother_tongue(&v, &c), 1.0);
        assert_eq!(age_gap(&v, &c), Some(1.0));
        assert_close(hobbies(&v, &c).unwrap_or_default(), 0.8);
        assert_close(
            closeness(
                scales::family_values(FamilyValues::Moderate),
                scales::family_values(FamilyValues::Traditional),
                3,
            ),
            2.0 / 3.0,
        );
        assert_close(
            closeness(
                scales::prayer_frequency(PrayerFrequency::MostPrayers),
                scales::prayer_frequency(PrayerFrequency::FiveTimes),
                4,
            ),
            0.75,
        );
    }

    #[test]
    fn similarity_is_neutral_when_only_skippable_features_are_missing() {
        // Place and mother tongue are never skipped, so similarity always has data. Two
        // subjects in different countries with different mother tongues score 0.
        let mut a = testkit::man();
        a.country_code = "GB".into();
        a.city_id = None;
        a.region_id = None;
        a.education_rank = None;
        a.mother_tongue_code = "english".into();
        let mut b = testkit::woman();
        b.education_rank = None;
        b.date_of_birth = testkit::born_years_ago(45);
        let value = similarity(&subject(a), &subject(b));
        // Only place (0), mother tongue (0) and age gap (man 30, woman 45: g = -15, 0.1).
        assert_close(value, (2.0 * 0.1) / (3.0 + 2.0 + 2.0));
    }

    #[test]
    fn similarity_is_symmetric() {
        let (v, _, c, _) = worked_example();
        assert_close(similarity(&v, &c), similarity(&c, &v));
    }

    #[test]
    fn age_gap_bands() {
        let gap = |man_age: i32, woman_age: i32| {
            let mut man = testkit::man();
            man.date_of_birth = testkit::born_years_ago(man_age);
            let mut woman = testkit::woman();
            woman.date_of_birth = testkit::born_years_ago(woman_age);
            age_gap(&subject(woman), &subject(man))
        };
        assert_eq!(gap(30, 30), Some(1.0));
        assert_eq!(gap(35, 30), Some(1.0));
        assert_eq!(gap(36, 30), Some(0.7));
        assert_eq!(gap(29, 30), Some(0.7));
        assert_eq!(gap(28, 30), Some(0.7));
        assert_eq!(gap(39, 30), Some(0.4));
        assert_eq!(gap(42, 30), Some(0.4));
        assert_eq!(gap(27, 30), Some(0.4));
        assert_eq!(gap(25, 30), Some(0.4));
        assert_eq!(gap(43, 30), Some(0.1));
        assert_eq!(gap(24, 30), Some(0.1));
        assert_eq!(
            age_gap(&subject(testkit::man()), &subject(testkit::man())),
            None
        );
    }

    #[test]
    fn place_steps() {
        let a = subject(testkit::man());
        let mut rows = testkit::woman();
        assert_close(place(&a, &subject(rows.clone())), 1.0);
        rows.city_id = Some(testkit::KARACHI);
        rows.region_id = Some(testkit::SINDH);
        assert_close(place(&a, &subject(rows.clone())), 0.3);
        rows.origin_city_id = Some(testkit::LAHORE);
        let mut a_rows = testkit::man();
        a_rows.origin_city_id = Some(testkit::LAHORE);
        assert_close(place(&subject(a_rows), &subject(rows.clone())), 0.6);
        rows.country_code = "AE".into();
        rows.origin_city_id = None;
        assert_close(place(&a, &subject(rows)), 0.0);
    }

    #[test]
    fn mother_tongue_spoken_by_the_other_scores_0_3() {
        let mut a = testkit::man();
        a.mother_tongue_code = "punjabi".into();
        let mut b = testkit::woman();
        b.mother_tongue_code = "sindhi".into();
        b.language_codes = vec!["punjabi".into()];
        assert_close(mother_tongue(&subject(a), &subject(b)), 0.3);
    }

    #[test]
    fn hidden_caste_and_family_are_skipped_in_similarity() {
        let mut a = testkit::man();
        a.caste_code = Some("arain".into());
        a.family_values = Some(FamilyValues::Moderate);
        let mut b = testkit::woman();
        b.caste_code = Some("jutt".into());
        b.family_values = Some(FamilyValues::Liberal);
        let visible = similarity(&subject(a.clone()), &subject(b.clone()));
        b.caste_visibility = FieldVisibility::Connections;
        b.family_visibility = FieldVisibility::Nobody;
        let hidden = similarity(&subject(a), &subject(b));
        // Visible: place 1 (3), tongue 1 (2), education 1 (2), age gap 1 (2), caste 0 (1.5),
        // family values 2/3 (1.5). Hidden: the last two are skipped.
        assert_close(visible, (3.0 + 2.0 + 2.0 + 2.0 + 1.0) / 12.0);
        assert_close(hidden, 1.0);
    }

    #[test]
    fn timeline_not_decided_scores_half_and_religiosity_distance() {
        let mut a = testkit::man();
        a.marriage_timeline = Some(MarriageTimeline::NotDecided);
        a.religiosity = Some(Religiosity::VeryPractising);
        let mut b = testkit::woman();
        b.marriage_timeline = Some(MarriageTimeline::Within2Years);
        b.religiosity = Some(Religiosity::NotPractising);
        // place 1 (3), tongue 1 (2), education 1 (2), age gap 1 (2), religiosity 0 (2),
        // timeline 0.5 (1).
        assert_close(
            similarity(&subject(a), &subject(b)),
            (3.0 + 2.0 + 2.0 + 2.0 + 0.5) / 12.0,
        );
    }

    #[test]
    fn compat_rounds_half_up_and_clamps() {
        assert_eq!(round_percent(91.5), 92);
        assert_eq!(round_percent(91.499_999_999_99), 92);
        assert_eq!(round_percent(91.49), 91);
        assert_eq!(round_percent(-3.0), 0);
        assert_eq!(round_percent(250.0), 100);
        assert_eq!(round_percent(f64::NAN), 0);
        assert_eq!(compat(1.0, 1.0, 1.0), 100);
        assert_eq!(compat(0.0, 1.0, 0.0), 0);
        // 10 section 5.3 rule 2: sqrt(1.0 * 0.25) = 0.5, not 0.625.
        assert_eq!(compat(1.0, 0.25, 0.0), round_percent(37.5));
    }

    #[test]
    fn one_sided_fit_scores_low() {
        assert!(compat(1.0, 0.25, 0.5) < compat(0.625, 0.625, 0.5));
    }
}
