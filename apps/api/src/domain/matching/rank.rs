//! The ranking score (10 section 6). It orders recommendations and is never shown; it never
//! changes `compat`.

use std::cmp::Ordering;

use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::matching::subject::Subject;

/// How long a new member gets the `newness` boost and the `new_member` reason (10 sections 6
/// and 7; "is new" in 03 section 6).
pub const NEW_MEMBER_WINDOW: Duration = Duration::days(7);

/// Ranking inputs that are not facts of the candidate's profile. The caller loads them with
/// the follow-up queries of 10 section 8.4.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RankSignals {
    /// `p`: interests received by the candidate with `status = 'pending'` created within the
    /// last 14 days (`exposure`).
    pub pending_interests: u32,
    /// `shown_count` on the viewer's existing `match_recommendations` row for the candidate,
    /// or 0 (`fatigue`).
    pub shown_count: i16,
    /// A report with `target_profile_id` = the candidate, `status = 'actioned'` and
    /// `handled_at` within 90 days exists (`conduct`).
    pub recently_actioned_report: bool,
}

/// The six factors of 10 section 6.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RankFactors {
    /// 0.70 to 1.00.
    pub quality: f64,
    /// 0.30 to 1.00.
    pub activity: f64,
    /// 0.50 to 1.00.
    pub exposure: f64,
    /// 0.50 to 1.00.
    pub fatigue: f64,
    /// 1.00 or 1.10.
    pub newness: f64,
    /// 0.80 or 1.00.
    pub conduct: f64,
}

impl RankFactors {
    /// Computes every factor for a candidate at `now`.
    pub fn new(candidate: &Subject, signals: RankSignals, now: OffsetDateTime) -> Self {
        Self {
            quality: quality(candidate),
            activity: activity(candidate.last_active_at, now),
            exposure: exposure(signals.pending_interests),
            fatigue: fatigue(signals.shown_count),
            newness: newness(candidate.first_activated_at, now),
            conduct: conduct(signals.recently_actioned_report),
        }
    }

    /// `quality * activity * exposure * fatigue * newness * conduct`.
    pub fn product(&self) -> f64 {
        self.quality * self.activity * self.exposure * self.fatigue * self.newness * self.conduct
    }
}

/// `rank_score = (compat / 100) * quality * activity * exposure * fatigue * newness * conduct`
/// (10 section 6). Returned as `f32`, the type of `match_recommendations.rank_score`, so that
/// ordering in memory and in the database agree.
pub fn rank_score(compat: u8, factors: &RankFactors) -> f32 {
    let score = f64::from(compat) / 100.0 * factors.product();
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the score is between 0 and 1.1; f32 is the storage type"
    )]
    let score = score as f32;
    score
}

/// `quality` (10 section 6), from 0.70 to 1.00:
///
/// ```text
/// 0.70 + 0.10 * completeness / 100 + 0.08 * has_approved_photo + 0.06 * is_id_verified
///      + 0.04 * is_photo_verified + 0.02 * is_phone_verified
/// ```
///
/// Booleans count as 0 or 1. Completeness is clamped to 0..=100.
pub fn quality(candidate: &Subject) -> f64 {
    0.70 + 0.10 * f64::from(candidate.completeness.clamp(0, 100)) / 100.0
        + 0.08 * flag(candidate.has_approved_photo)
        + 0.06 * flag(candidate.is_id_verified)
        + 0.04 * flag(candidate.is_photo_verified)
        + 0.02 * flag(candidate.is_phone_verified)
}

/// `activity` by the age of `last_active_at`: up to 24 hours 1.00, up to 7 days 0.95, up to
/// 30 days 0.80, up to 90 days 0.50, older or null 0.30. A time in the future counts as now.
pub fn activity(last_active_at: Option<OffsetDateTime>, now: OffsetDateTime) -> f64 {
    let Some(last_active_at) = last_active_at else {
        return 0.30;
    };
    let idle = now - last_active_at;
    if idle <= Duration::hours(24) {
        1.00
    } else if idle <= Duration::days(7) {
        0.95
    } else if idle <= Duration::days(30) {
        0.80
    } else if idle <= Duration::days(90) {
        0.50
    } else {
        0.30
    }
}

/// `exposure = max(0.5, 1 / (1 + p / 25))`.
pub fn exposure(pending_interests: u32) -> f64 {
    (1.0 / (1.0 + f64::from(pending_interests) / 25.0)).max(0.5)
}

/// `fatigue = max(0.5, 0.92 ^ shown_count)`. A negative count counts as 0.
pub fn fatigue(shown_count: i16) -> f64 {
    0.92_f64.powi(i32::from(shown_count.max(0))).max(0.5)
}

/// `newness`: 1.10 when `first_activated_at` is within 7 days, else 1.00.
pub fn newness(first_activated_at: Option<OffsetDateTime>, now: OffsetDateTime) -> f64 {
    if is_new(first_activated_at, now) {
        1.10
    } else {
        1.00
    }
}

/// `conduct`: 0.80 after an actioned report within 90 days, else 1.00.
pub fn conduct(recently_actioned_report: bool) -> f64 {
    if recently_actioned_report { 0.80 } else { 1.00 }
}

/// "Is new" (03 section 6): `first_activated_at` within the last 7 days.
pub fn is_new(first_activated_at: Option<OffsetDateTime>, now: OffsetDateTime) -> bool {
    first_activated_at.is_some_and(|at| now - at <= NEW_MEMBER_WINDOW)
}

/// The order of recommendations (10 section 6): `rank_score` descending, then higher
/// `compat`, then more recent `last_active_at` (null last), then `id` ascending.
pub fn compare(a: &RankKey, b: &RankKey) -> Ordering {
    b.rank_score
        .total_cmp(&a.rank_score)
        .then_with(|| b.compat.cmp(&a.compat))
        .then_with(|| match (a.last_active_at, b.last_active_at) {
            (Some(a), Some(b)) => b.cmp(&a),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        })
        .then_with(|| a.id.cmp(&b.id))
}

/// The values [`compare`] sorts by.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RankKey {
    pub rank_score: f32,
    pub compat: u8,
    pub last_active_at: Option<OffsetDateTime>,
    pub id: Uuid,
}

fn flag(value: bool) -> f64 {
    f64::from(u8::from(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::matching::testkit::{self, NOW, assert_close, assert_near, subject};

    fn worked_example_factors() -> RankFactors {
        let candidate = subject(testkit::fatima());
        let signals = RankSignals {
            pending_interests: 10,
            shown_count: 2,
            recently_actioned_report: false,
        };
        RankFactors::new(&candidate, signals, NOW)
    }

    #[test]
    fn case_40_worked_example_rank_score() {
        let factors = worked_example_factors();
        assert_close(factors.quality, 0.92);
        assert_close(factors.activity, 0.95);
        assert_near(factors.exposure, 0.714, 0.0005);
        assert_near(factors.fatigue, 0.846, 0.0005);
        assert_close(factors.newness, 1.00);
        assert_close(factors.conduct, 1.00);
        assert_near(f64::from(rank_score(92, &factors)), 0.486, 0.002);
    }

    #[test]
    fn case_41_exposure_floor() {
        assert_close(exposure(100), 0.5);
        assert_close(exposure(0), 1.0);
        assert_close(exposure(25), 0.5);
    }

    #[test]
    fn case_42_fatigue_floor() {
        assert_close(fatigue(20), 0.5);
        assert_close(fatigue(0), 1.0);
        assert_near(fatigue(8), 0.51, 0.005);
        assert_close(fatigue(-3), 1.0);
    }

    #[test]
    fn quality_range() {
        let mut rows = testkit::woman();
        rows.completeness = 0;
        assert_close(quality(&subject(rows.clone())), 0.70);
        rows.completeness = 100;
        rows.has_approved_photo = true;
        rows.is_id_verified = true;
        rows.is_photo_verified = true;
        rows.is_phone_verified = true;
        assert_close(quality(&subject(rows.clone())), 1.00);
        rows.completeness = 400;
        assert_close(quality(&subject(rows)), 1.00);
    }

    #[test]
    fn activity_steps() {
        let ago = |duration: Duration| Some(NOW - duration);
        assert_close(activity(ago(Duration::hours(24)), NOW), 1.00);
        assert_close(activity(ago(Duration::hours(25)), NOW), 0.95);
        assert_close(activity(ago(Duration::days(7)), NOW), 0.95);
        assert_close(activity(ago(Duration::days(8)), NOW), 0.80);
        assert_close(activity(ago(Duration::days(30)), NOW), 0.80);
        assert_close(activity(ago(Duration::days(31)), NOW), 0.50);
        assert_close(activity(ago(Duration::days(90)), NOW), 0.50);
        assert_close(activity(ago(Duration::days(91)), NOW), 0.30);
        assert_close(activity(None, NOW), 0.30);
        assert_close(activity(Some(NOW + Duration::hours(1)), NOW), 1.00);
    }

    #[test]
    fn new_member_boost_lasts_seven_days() {
        assert_close(newness(Some(NOW - Duration::days(6)), NOW), 1.10);
        assert_close(newness(Some(NOW - Duration::days(7)), NOW), 1.10);
        assert_close(newness(Some(NOW - Duration::days(8)), NOW), 1.00);
        assert_close(newness(None, NOW), 1.00);
    }

    #[test]
    fn conduct_penalty() {
        assert_close(conduct(true), 0.80);
        assert_close(conduct(false), 1.00);
    }

    #[test]
    fn ties_break_on_compat_then_activity_then_id() {
        let key = |rank_score: f32, compat: u8, days: Option<i64>, id: u128| RankKey {
            rank_score,
            compat,
            last_active_at: days.map(|days| NOW - Duration::days(days)),
            id: Uuid::from_u128(id),
        };
        let mut keys = [
            key(0.5, 70, None, 1),
            key(0.5, 70, Some(3), 2),
            key(0.5, 80, Some(9), 3),
            key(0.9, 10, None, 4),
            key(0.5, 70, Some(1), 6),
            key(0.5, 70, Some(1), 5),
        ];
        keys.sort_by(compare);
        let ids: Vec<u128> = keys.iter().map(|k| k.id.as_u128()).collect();
        assert_eq!(ids, [4, 3, 5, 6, 2, 1]);
    }
}
