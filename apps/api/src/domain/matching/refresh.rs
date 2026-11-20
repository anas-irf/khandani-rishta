//! The recommendations refresh (10 section 8) as pure steps: the parameters of the candidate
//! pool query, the scoring pass over the pool, relaxation hints, `pool_exhausted`, staleness
//! and the `shown_count` guard. The caller runs the SQL and writes the rows.

use std::collections::HashSet;

use serde::Serialize;
use time::{Date, Duration, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::matching::dimensions::{Dimension, is_set};
use crate::domain::matching::eligibility::second_marriage_ok;
use crate::domain::matching::fit::{Pair, Side};
use crate::domain::matching::rank::{RankFactors, RankKey, RankSignals, compare, rank_score};
use crate::domain::matching::reasons::{ReasonCode, reasons};
use crate::domain::matching::subject::{Geo, Subject};
use crate::domain::options::{DiscoveryVisibility, Importance, MaritalStatus};
use crate::domain::preferences::Preferences;

/// `pool_exhausted` rule 1: fewer eligible candidates than this at the last refresh.
pub const POOL_EXHAUSTED_BELOW: u32 = 10;

/// `pool_exhausted` rule 2: every cached row has been shown at least this often.
pub const POOL_EXHAUSTED_SHOWN: i16 = 3;

/// At most this many relaxation hints (10 section 8.7).
pub const MAX_RELAXATION_HINTS: usize = 2;

/// `shown_count` grows only when the row was last shown longer ago than this (10 section 8.6
/// step 5), so quick reloads do not inflate fatigue.
pub const SHOWN_GUARD: Duration = Duration::hours(6);

/// A refresh with `notify = true` counts new candidates at or above this `compat`
/// (10 section 8.6; 19 section 2.5).
pub const NEW_MATCH_MIN_COMPAT: u8 = 70;

/// The viewer-dependent parameters `$3` to `$10` of the candidate pool query (10 section 8.4).
/// The profile id, gender, cooldowns and pool size come straight from the profile and the
/// settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolQueryParams {
    /// `$3`: place hints for pre-ranking. V's preferred `city_ids` when V's `location`
    /// dimension is set, otherwise V's own city (or none).
    pub city_ids: Vec<i32>,
    /// `$4`: V's preferred `region_ids`, or V's own region.
    pub region_ids: Vec<i32>,
    /// `$5`: V's preferred `country_codes`, or V's own country.
    pub country_codes: Vec<String>,
    /// `$6`: V's `marital_statuses` contains `married`.
    pub viewer_accepts_married: bool,
    /// `$7`: `V.marital_status = 'married'`.
    pub viewer_is_married: bool,
    /// `$8`: exclusive lower bound of `date_of_birth`, today minus (`age_max` + 1) years.
    /// Set only when V's `age` dimension is set and `must`.
    pub born_after: Option<Date>,
    /// `$9`: inclusive upper bound of `date_of_birth`, today minus `age_min` years.
    pub born_on_or_before: Option<Date>,
    /// `$10`: V's `religion_codes` when V's `religion` dimension is set and `must`.
    pub religion_codes: Option<Vec<String>>,
}

impl PoolQueryParams {
    /// Derives the parameters from the viewer. `today` is the current date in `Asia/Karachi`.
    ///
    /// The date bounds select exactly the profiles whose age on `today`
    /// ([`crate::domain::time::age_on`]) is inside `age_min..=age_max`, including birthdays on
    /// 29 February (a year subtracted from 29 February gives 28 February, as in PostgreSQL).
    pub fn new(viewer: &Subject, prefs: &Preferences, today: Date) -> Self {
        let location_set = !prefs.city_ids.is_empty()
            || !prefs.region_ids.is_empty()
            || !prefs.country_codes.is_empty();
        let (city_ids, region_ids, country_codes) = if location_set {
            (
                prefs.city_ids.clone(),
                prefs.region_ids.clone(),
                prefs.country_codes.clone(),
            )
        } else {
            (
                viewer.city_id.into_iter().collect(),
                viewer.region_id.into_iter().collect(),
                vec![viewer.country_code.clone()],
            )
        };

        let age_must =
            prefs.age_importance == Importance::Must && is_set(prefs, Dimension::Age, viewer);
        let age_bounds = if age_must {
            years_before(today, i32::from(prefs.age_max) + 1)
                .zip(years_before(today, i32::from(prefs.age_min)))
        } else {
            None
        };
        let religion_codes = (prefs.religion_importance == Importance::Must
            && !prefs.religion_codes.is_empty())
        .then(|| prefs.religion_codes.clone());

        Self {
            city_ids,
            region_ids,
            country_codes,
            viewer_accepts_married: prefs.marital_statuses.contains(&MaritalStatus::Married),
            viewer_is_married: viewer.marital_status == MaritalStatus::Married,
            born_after: age_bounds.map(|(after, _)| after),
            born_on_or_before: age_bounds.map(|(_, on_or_before)| on_or_before),
            religion_codes,
        }
    }
}

/// `date - make_interval(years => years)` as PostgreSQL computes it: 29 February becomes
/// 28 February in a year that is not a leap year. `None` outside the supported date range.
fn years_before(date: Date, years: i32) -> Option<Date> {
    let year = date.year().checked_sub(years)?;
    Date::from_calendar_date(year, date.month(), date.day())
        .or_else(|_| Date::from_calendar_date(year, date.month(), date.day().saturating_sub(1)))
        .ok()
}

/// One row of the candidate pool with everything the Rust pass needs.
#[derive(Debug, Clone)]
pub struct PoolCandidate {
    /// The matchable view ([`Subject::from_rows`]).
    pub subject: Subject,
    /// The candidate's preferences; the defaults of 07 section 12 when there is no row.
    pub prefs: Preferences,
    /// `profile_privacy.discovery_visibility` (E8).
    pub discovery_visibility: DiscoveryVisibility,
    /// Exposure, fatigue and conduct inputs.
    pub signals: RankSignals,
}

/// A row to write to `match_recommendations` (10 section 8.5 step 7). `shown_count` and
/// `last_shown_at` are carried over from the old rows by the caller.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Recommendation {
    pub candidate_profile_id: Uuid,
    pub compat: u8,
    pub rank_score: f32,
    pub reasons: Vec<ReasonCode>,
}

/// The result of a scoring pass.
#[derive(Debug, Clone, PartialEq)]
pub struct PoolOutcome {
    /// Best first, at most `keep` rows.
    pub recommendations: Vec<Recommendation>,
    /// Candidates that passed steps 2 to 4 of 10 section 8.5. Kept in the in-process cache
    /// for `pool_exhausted`.
    pub eligible_count: u32,
    /// At most two (10 section 8.7). Kept in the in-process cache with `eligible_count`.
    pub relaxation_hints: Vec<RelaxationHint>,
}

/// The scoring pass of 10 section 8.5, steps 1 to 6, for viewer V over the candidate pool.
/// `keep` is `matching.recommendations_size` (200).
///
/// For each candidate C: drop when E8 does not admit V (a `hidden` C, or a `preference_match`
/// C whose must-haves V fails), when V fails C's must-haves (M2), or when C fails V's
/// must-haves (M1, counting C towards the relaxation hint of the dimension when it fails
/// exactly one). Survivors get `compat`, `rank_score` and reasons, are sorted by
/// [`compare`] and cut to `keep`.
///
/// The pool query already applies E1 to E7 and E9. As a guard against a caller mistake the
/// pass also drops the viewer's own profile, a candidate of the same gender and a pair that
/// fails E9; these are never counted.
pub fn score_pool(
    viewer: Side<'_>,
    pool: &[PoolCandidate],
    geo: &Geo,
    now: OffsetDateTime,
    keep: usize,
) -> PoolOutcome {
    let mut relax = RelaxCounts::default();
    let mut eligible_count: u32 = 0;
    let mut ranked: Vec<(RankKey, Recommendation)> = Vec::new();

    for candidate in pool {
        let c = &candidate.subject;
        let v = viewer.subject;
        if c.id == v.id
            || c.gender == v.gender
            || candidate.discovery_visibility == DiscoveryVisibility::Hidden
            || !second_marriage_ok(
                v.marital_status,
                &viewer.prefs.marital_statuses,
                c.marital_status,
                &candidate.prefs.marital_statuses,
            )
        {
            continue;
        }
        let pair = Pair::new(
            viewer,
            Side {
                subject: c,
                prefs: &candidate.prefs,
            },
            geo,
        );
        // Steps 2 and 3. For a `preference_match` candidate, E8 is the same test as M2.
        if !pair.viewer_meets_candidate_must_haves() {
            continue;
        }
        // Step 4.
        if !pair.candidate_meets_viewer_must_haves() {
            relax.record(pair.failed_viewer_must_haves());
            continue;
        }
        eligible_count = eligible_count.saturating_add(1);

        // Step 5.
        let compat = pair.compat();
        let rank_score = rank_score(compat, &RankFactors::new(c, candidate.signals, now));
        ranked.push((
            RankKey {
                rank_score,
                compat,
                last_active_at: c.last_active_at,
                id: c.id,
            },
            Recommendation {
                candidate_profile_id: c.id,
                compat,
                rank_score,
                reasons: reasons(&pair, now),
            },
        ));
    }

    // Step 6.
    ranked.sort_by(|a, b| compare(&a.0, &b.0));
    ranked.truncate(keep);
    PoolOutcome {
        recommendations: ranked.into_iter().map(|(_, row)| row).collect(),
        eligible_count,
        relaxation_hints: relax.hints(),
    }
}

/// `relax_count[d]` (10 section 8.7): the number of candidates who would have qualified if
/// dimension `d` alone were not a must-have.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RelaxCounts {
    counts: [u32; Dimension::COUNT],
}

impl RelaxCounts {
    /// Records a candidate's failed must-have dimensions: counted only when there is exactly
    /// one (10 section 8.5 step 4).
    pub fn record(&mut self, failed: impl IntoIterator<Item = Dimension>) {
        let mut failed = failed.into_iter();
        if let (Some(only), None) = (failed.next(), failed.next())
            && let Some(count) = self.counts.get_mut(only.index())
        {
            *count = count.saturating_add(1);
        }
    }

    /// The count for one dimension.
    pub fn get(&self, dimension: Dimension) -> u32 {
        self.counts.get(dimension.index()).copied().unwrap_or(0)
    }

    /// The two dimensions with the highest non-zero counts, highest first. Equal counts keep
    /// the fixed order of [`Dimension::ALL`].
    pub fn hints(&self) -> Vec<RelaxationHint> {
        let mut hints: Vec<RelaxationHint> = Dimension::ALL
            .iter()
            .map(|dimension| RelaxationHint {
                dimension: *dimension,
                extra_profiles: self.get(*dimension),
            })
            .filter(|hint| hint.extra_profiles > 0)
            .collect();
        hints.sort_by_key(|hint| std::cmp::Reverse(hint.extra_profiles));
        hints.truncate(MAX_RELAXATION_HINTS);
        hints
    }
}

/// Which must-have to loosen, and how many more profiles that would show (15 section 10,
/// `relaxation_hints`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct RelaxationHint {
    /// Dimension key from 10 section 4.
    #[schema(value_type = String)]
    pub dimension: Dimension,
    pub extra_profiles: u32,
}

/// `pool_exhausted` (10 section 8.7): fewer than 10 eligible candidates at the last refresh,
/// or a non-empty cache in which every row has `shown_count >= 3`.
///
/// `eligible_count` is `None` when the in-process cache no longer holds it; rule 1 is then not
/// applied. `relaxation_hints` are returned only while this is true (15 section 10).
pub fn pool_exhausted(eligible_count: Option<u32>, shown_counts: &[i16]) -> bool {
    eligible_count.is_some_and(|count| count < POOL_EXHAUSTED_BELOW)
        || (!shown_counts.is_empty()
            && shown_counts
                .iter()
                .all(|shown| *shown >= POOL_EXHAUSTED_SHOWN))
}

/// Whether V's recommendations are stale (10 section 8.1): `match_stale` is set, they were
/// never refreshed, or the last refresh is older than `matching.refresh_hours`.
pub fn recommendations_stale(
    match_stale: bool,
    match_refreshed_at: Option<OffsetDateTime>,
    refresh_hours: u32,
    now: OffsetDateTime,
) -> bool {
    match_stale
        || match_refreshed_at.is_none_or(|at| at < now - Duration::hours(i64::from(refresh_hours)))
}

/// Whether serving a cached row increases its `shown_count` (10 section 8.6 step 5): never
/// shown, or last shown more than 6 hours ago.
pub fn should_count_shown(last_shown_at: Option<OffsetDateTime>, now: OffsetDateTime) -> bool {
    last_shown_at.is_none_or(|at| now - at > SHOWN_GUARD)
}

/// The `new_matches` count of a refresh with `notify = true` (10 section 8.6; 19 section 2.5):
/// candidates in the new list with `compat >= 70` that were not in the previous list.
pub fn count_new_matches(previous: &[Uuid], current: &[Recommendation]) -> u32 {
    let previous: HashSet<&Uuid> = previous.iter().collect();
    let count = current
        .iter()
        .filter(|row| row.compat >= NEW_MATCH_MIN_COMPAT)
        .filter(|row| !previous.contains(&row.candidate_profile_id))
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use time::macros::date;

    use super::*;
    use crate::domain::matching::subject::SubjectRows;
    use crate::domain::matching::testkit::{
        self, KARACHI, LAHORE, NOW, PUNJAB, SINDH, TODAY, ahmed, ahmed_prefs, fatima, fatima_prefs,
        subject,
    };
    use crate::domain::options::{
        EmploymentType, FieldVisibility, Gender, LivingArrangement, PrayerFrequency, Religiosity,
    };

    fn candidate(rows: SubjectRows, prefs: Preferences) -> PoolCandidate {
        PoolCandidate {
            subject: subject(rows),
            prefs,
            discovery_visibility: DiscoveryVisibility::Everyone,
            signals: RankSignals::default(),
        }
    }

    fn woman(id: u128) -> SubjectRows {
        SubjectRows {
            id: Uuid::from_u128(id),
            ..testkit::woman()
        }
    }

    #[test]
    fn case_48_relaxation_hints() {
        let viewer = subject(testkit::man());
        let mut viewer_prefs = testkit::no_preferences();
        viewer_prefs.caste_codes = vec!["arain".into()];
        viewer_prefs.caste_importance = Importance::Must;
        viewer_prefs.city_ids = vec![LAHORE];
        viewer_prefs.location_importance = Importance::Must;

        let mut pool = Vec::new();
        let mut id = 100;
        let mut add = |caste: &str, city: i32, region: i32| {
            id += 1;
            let mut rows = woman(id);
            rows.caste_code = Some(caste.into());
            rows.city_id = Some(city);
            rows.region_id = Some(region);
            pool.push(candidate(rows, testkit::no_preferences()));
        };
        for _ in 0..12 {
            add("jutt", LAHORE, PUNJAB); // fails only caste
        }
        for _ in 0..3 {
            add("arain", KARACHI, SINDH); // fails only location
        }
        for _ in 0..2 {
            add("jutt", KARACHI, SINDH); // fails both: not counted
        }
        for _ in 0..5 {
            add("arain", LAHORE, PUNJAB); // passes
        }

        let outcome = score_pool(
            Side {
                subject: &viewer,
                prefs: &viewer_prefs,
            },
            &pool,
            &testkit::geo(),
            NOW,
            200,
        );
        assert_eq!(
            outcome.relaxation_hints,
            [
                RelaxationHint {
                    dimension: Dimension::Caste,
                    extra_profiles: 12
                },
                RelaxationHint {
                    dimension: Dimension::Location,
                    extra_profiles: 3
                },
            ]
        );
        assert_eq!(outcome.eligible_count, 5);
        assert_eq!(outcome.recommendations.len(), 5);
        let json = serde_json::to_value(&outcome.relaxation_hints).unwrap_or_default();
        assert_eq!(
            json,
            serde_json::json!([
                { "dimension": "caste", "extra_profiles": 12 },
                { "dimension": "location", "extra_profiles": 3 },
            ])
        );
    }

    #[test]
    fn relaxation_hints_keep_two_and_break_ties_in_fixed_order() {
        let mut counts = RelaxCounts::default();
        for dimension in [
            Dimension::Smoking,
            Dimension::Sect,
            Dimension::Smoking,
            Dimension::Sect,
            Dimension::Caste,
        ] {
            counts.record([dimension]);
        }
        counts.record([Dimension::Caste, Dimension::Sect]);
        counts.record([]);
        let hints: Vec<(Dimension, u32)> = counts
            .hints()
            .iter()
            .map(|hint| (hint.dimension, hint.extra_profiles))
            .collect();
        assert_eq!(hints, [(Dimension::Sect, 2), (Dimension::Smoking, 2)]);
        assert_eq!(RelaxCounts::default().hints(), Vec::<RelaxationHint>::new());
    }

    #[test]
    fn worked_example_through_the_pool_pass() {
        let viewer = subject(ahmed());
        let viewer_prefs = ahmed_prefs();
        let mut fatima = candidate(fatima(), fatima_prefs());
        fatima.signals = RankSignals {
            pending_interests: 10,
            shown_count: 2,
            recently_actioned_report: false,
        };
        let outcome = score_pool(
            Side {
                subject: &viewer,
                prefs: &viewer_prefs,
            },
            &[fatima],
            &testkit::geo(),
            NOW,
            200,
        );
        assert_eq!(outcome.eligible_count, 1);
        let row = &outcome.recommendations[0];
        assert_eq!(row.candidate_profile_id, Uuid::from_u128(0xF));
        assert_eq!(row.compat, 92);
        testkit::assert_near(f64::from(row.rank_score), 0.486, 0.002);
        assert_eq!(
            row.reasons,
            [
                ReasonCode::SameSect,
                ReasonCode::YouMeetTheirPreferences,
                ReasonCode::AgeFits
            ]
        );
    }

    #[test]
    fn candidates_failing_either_direction_or_discovery_are_dropped() {
        let viewer = subject(testkit::man());
        let viewer_prefs = testkit::no_preferences();
        let geo = testkit::geo();

        // The candidate requires a sect the viewer does not have.
        let mut strict = testkit::no_preferences();
        strict.sect_codes = vec!["shia".into()];
        strict.sect_importance = Importance::Must;

        let mut hidden = candidate(woman(11), testkit::no_preferences());
        hidden.discovery_visibility = DiscoveryVisibility::Hidden;
        let mut preference_match = candidate(woman(12), strict.clone());
        preference_match.discovery_visibility = DiscoveryVisibility::PreferenceMatch;
        let fails_m2 = candidate(woman(13), strict);
        let same_gender = candidate(
            SubjectRows {
                id: Uuid::from_u128(14),
                ..testkit::man()
            },
            testkit::no_preferences(),
        );
        let mut divorced = woman(15);
        divorced.marital_status = MaritalStatus::Divorced;
        let divorced = candidate(divorced, testkit::no_preferences());
        let mut admitted = candidate(woman(16), testkit::no_preferences());
        admitted.discovery_visibility = DiscoveryVisibility::PreferenceMatch;
        let itself = candidate(
            SubjectRows {
                gender: Gender::Female,
                ..testkit::man()
            },
            testkit::no_preferences(),
        );

        let outcome = score_pool(
            Side {
                subject: &viewer,
                prefs: &viewer_prefs,
            },
            &[
                hidden,
                preference_match,
                fails_m2,
                same_gender,
                divorced,
                admitted,
                itself,
            ],
            &geo,
            NOW,
            200,
        );
        let ids: Vec<u128> = outcome
            .recommendations
            .iter()
            .map(|row| row.candidate_profile_id.as_u128())
            .collect();
        assert_eq!(outcome.eligible_count, 2);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&15) && ids.contains(&16));
        assert_eq!(outcome.relaxation_hints, Vec::<RelaxationHint>::new());
    }

    #[test]
    fn married_candidate_needs_an_opt_in() {
        let mut viewer_rows = testkit::woman();
        viewer_rows.id = Uuid::from_u128(50);
        let viewer = subject(viewer_rows);
        let mut married = testkit::man();
        married.marital_status = MaritalStatus::Married;
        let pool = [candidate(married, testkit::no_preferences())];
        let geo = testkit::geo();

        let mut prefs = testkit::no_preferences();
        prefs.marital_statuses = vec![MaritalStatus::NeverMarried];
        let eligible = |prefs: &Preferences| {
            let viewer = Side {
                subject: &viewer,
                prefs,
            };
            score_pool(viewer, &pool, &geo, NOW, 200).eligible_count
        };
        assert_eq!(eligible(&prefs), 0);
        prefs.marital_statuses.push(MaritalStatus::Married);
        assert_eq!(eligible(&prefs), 1);
    }

    #[test]
    fn keeps_the_best_rows_in_rank_order() {
        let viewer = subject(testkit::man());
        let prefs = testkit::no_preferences();
        let pool: Vec<PoolCandidate> = (0..10_u8)
            .map(|n| {
                let mut rows = woman(u128::from(n) + 101);
                rows.completeness = i16::from(n) * 10;
                candidate(rows, testkit::no_preferences())
            })
            .collect();
        let outcome = score_pool(
            Side {
                subject: &viewer,
                prefs: &prefs,
            },
            &pool,
            &testkit::geo(),
            NOW,
            4,
        );
        assert_eq!(outcome.eligible_count, 10);
        let ids: Vec<u128> = outcome
            .recommendations
            .iter()
            .map(|row| row.candidate_profile_id.as_u128())
            .collect();
        assert_eq!(ids, [110, 109, 108, 107]);
    }

    #[test]
    fn scoring_600_candidates_is_fast() {
        // 10 section 14.1 budgets under 5 ms in release; the refresh must finish within the
        // 2-second serving window (10 section 8.6). Debug builds are slower, so the bound here
        // is generous but still far below 2 seconds.
        let viewer = subject(ahmed());
        let viewer_prefs = ahmed_prefs();
        let pool: Vec<PoolCandidate> = (0..600_u32).map(varied_candidate).collect();
        let geo = testkit::geo();

        let started = Instant::now();
        let outcome = score_pool(
            Side {
                subject: &viewer,
                prefs: &viewer_prefs,
            },
            &pool,
            &geo,
            NOW,
            200,
        );
        let elapsed = started.elapsed();

        assert!(
            elapsed < std::time::Duration::from_millis(500),
            "scoring 600 candidates took {elapsed:?}"
        );
        assert!(outcome.eligible_count > 0);
        assert!(outcome.recommendations.len() <= 200);
        assert!(
            outcome
                .recommendations
                .windows(2)
                .all(|pair| pair[0].rank_score >= pair[1].rank_score)
        );
    }

    /// A deterministic spread of women with different ages, places, sects, castes and
    /// preferences, so that every code path of the pass is exercised.
    fn varied_candidate(n: u32) -> PoolCandidate {
        let pick = |options: u32| n % options;
        let cities = [
            (LAHORE, PUNJAB),
            (testkit::FAISALABAD, PUNJAB),
            (KARACHI, SINDH),
        ];
        let (city, region) = cities[usize::try_from(pick(3)).unwrap_or(0)];
        let mut rows = SubjectRows {
            id: Uuid::from_u128(u128::from(n) + 1000),
            gender: Gender::Female,
            date_of_birth: testkit::born_years_ago(20 + i32::try_from(pick(15)).unwrap_or(0)),
            city_id: Some(city),
            region_id: Some(region),
            sect_code: Some(if pick(4) == 0 { "shia" } else { "sunni" }.into()),
            caste_code: Some(
                ["arain", "rajput", "jutt", "sheikh"][usize::try_from(pick(4)).unwrap_or(0)].into(),
            ),
            caste_visibility: if pick(5) == 0 {
                FieldVisibility::Connections
            } else {
                FieldVisibility::Members
            },
            education_rank: Some(i16::try_from(3 + pick(6)).unwrap_or(5)),
            employment_type: EmploymentType::ALL[usize::try_from(pick(9)).unwrap_or(0)],
            religiosity: Some(Religiosity::ALL[usize::try_from(pick(4)).unwrap_or(0)]),
            prayer_frequency: Some(PrayerFrequency::ALL[usize::try_from(pick(5)).unwrap_or(0)]),
            living_arrangement: Some(LivingArrangement::ALL[usize::try_from(pick(3)).unwrap_or(0)]),
            hobby_codes: vec![
                "reading".into(),
                ["travel", "cooking", "cricket"][usize::try_from(pick(3)).unwrap_or(0)].into(),
            ],
            completeness: i16::try_from(pick(101)).unwrap_or(50),
            has_approved_photo: pick(2) == 0,
            is_id_verified: pick(3) == 0,
            last_active_at: Some(NOW - Duration::hours(i64::from(pick(2400)))),
            first_activated_at: Some(NOW - Duration::days(i64::from(pick(60)))),
            ..fatima()
        };
        if pick(7) == 0 {
            rows.marital_status = MaritalStatus::Divorced;
        }
        let mut prefs = fatima_prefs();
        prefs.age_min = i16::try_from(24 + pick(6)).unwrap_or(27);
        prefs.age_max = prefs.age_min + 8;
        if pick(6) == 0 {
            prefs.sect_codes = vec!["shia".into()];
            prefs.sect_importance = Importance::Must;
        }
        PoolCandidate {
            subject: subject(rows),
            prefs,
            discovery_visibility: if pick(10) == 0 {
                DiscoveryVisibility::PreferenceMatch
            } else {
                DiscoveryVisibility::Everyone
            },
            signals: RankSignals {
                pending_interests: pick(40),
                shown_count: i16::try_from(pick(12)).unwrap_or(0),
                recently_actioned_report: pick(50) == 0,
            },
        }
    }

    #[test]
    fn pool_query_params_follow_the_viewer() {
        let viewer = subject(ahmed());
        let mut prefs = ahmed_prefs();
        let params = PoolQueryParams::new(&viewer, &prefs, TODAY);
        assert_eq!(params.city_ids, [LAHORE]);
        assert_eq!(params.region_ids, Vec::<i32>::new());
        assert_eq!(params.country_codes, Vec::<String>::new());
        assert!(!params.viewer_accepts_married);
        assert!(!params.viewer_is_married);
        // Age is `high`, not `must`: no SQL bounds.
        assert_eq!(params.born_after, None);
        assert_eq!(params.born_on_or_before, None);
        assert_eq!(params.religion_codes, Some(vec!["islam".to_string()]));

        prefs.age_importance = Importance::Must;
        prefs.city_ids.clear();
        prefs.religion_importance = Importance::High;
        let params = PoolQueryParams::new(&viewer, &prefs, TODAY);
        assert_eq!(params.born_after, Some(date!(1997 - 11 - 20)));
        assert_eq!(params.born_on_or_before, Some(date!(2003 - 11 - 20)));
        assert_eq!(params.religion_codes, None);
        // Location not set: the viewer's own places.
        assert_eq!(params.city_ids, [LAHORE]);
        assert_eq!(params.region_ids, [PUNJAB]);
        assert_eq!(params.country_codes, ["PK"]);
    }

    #[test]
    fn pool_age_bounds_agree_with_age_on() {
        let mut prefs = testkit::no_preferences();
        prefs.age_min = 25;
        prefs.age_max = 30;
        prefs.age_importance = Importance::Must;
        let viewer = subject(testkit::man());
        for today in [
            date!(2028 - 02 - 29),
            date!(2027 - 02 - 28),
            date!(2027 - 03 - 01),
            date!(2026 - 11 - 20),
        ] {
            let params = PoolQueryParams::new(&viewer, &prefs, today);
            let (Some(after), Some(on_or_before)) = (params.born_after, params.born_on_or_before)
            else {
                panic!("bounds expected");
            };
            let mut dob = date!(1990 - 01 - 01);
            while dob < date!(2010 - 01 - 01) {
                let age = crate::domain::time::age_on(dob, today);
                let in_sql = dob > after && dob <= on_or_before;
                assert_eq!(in_sql, (25..=30).contains(&age), "{dob} on {today}");
                dob = dob.next_day().unwrap_or(date!(2010 - 01 - 01));
            }
        }
    }

    #[test]
    fn age_must_that_is_not_set_adds_no_bounds() {
        let mut prefs = testkit::no_preferences();
        prefs.age_importance = Importance::Must;
        let params = PoolQueryParams::new(&subject(testkit::man()), &prefs, TODAY);
        assert_eq!((params.born_after, params.born_on_or_before), (None, None));
    }

    #[test]
    fn married_viewer_flags() {
        let mut rows = testkit::man();
        rows.marital_status = MaritalStatus::Married;
        let mut prefs = testkit::no_preferences();
        prefs.marital_statuses = vec![MaritalStatus::Married];
        let params = PoolQueryParams::new(&subject(rows), &prefs, TODAY);
        assert!(params.viewer_is_married);
        assert!(params.viewer_accepts_married);
    }

    #[test]
    fn pool_exhausted_rules() {
        assert!(pool_exhausted(Some(9), &[0, 0]));
        assert!(!pool_exhausted(Some(10), &[0, 5]));
        assert!(pool_exhausted(Some(50), &[3, 4, 3]));
        assert!(!pool_exhausted(Some(50), &[]));
        assert!(!pool_exhausted(None, &[]));
        assert!(pool_exhausted(None, &[3]));
        assert!(pool_exhausted(Some(0), &[]));
    }

    #[test]
    fn staleness() {
        let hours_ago = |hours| Some(NOW - Duration::hours(hours));
        assert!(recommendations_stale(true, hours_ago(1), 24, NOW));
        assert!(recommendations_stale(false, None, 24, NOW));
        assert!(recommendations_stale(false, hours_ago(25), 24, NOW));
        assert!(!recommendations_stale(false, hours_ago(23), 24, NOW));
    }

    #[test]
    fn shown_count_guard() {
        assert!(should_count_shown(None, NOW));
        assert!(should_count_shown(Some(NOW - Duration::hours(7)), NOW));
        assert!(!should_count_shown(Some(NOW - Duration::hours(5)), NOW));
    }

    #[test]
    fn new_matches_are_new_and_at_least_70() {
        let row = |id: u128, compat: u8| Recommendation {
            candidate_profile_id: Uuid::from_u128(id),
            compat,
            rank_score: 0.5,
            reasons: Vec::new(),
        };
        let current = [row(1, 90), row(2, 70), row(3, 69), row(4, 95)];
        assert_eq!(count_new_matches(&[Uuid::from_u128(4)], &current), 2);
        assert_eq!(count_new_matches(&[], &[]), 0);
    }
}
