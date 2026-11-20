//! Ordered scales (10 section 4.2), used for "adjacent" partial credit and for similarity.
//! Position 1 is the lowest. Education and income use the ranks of `education_levels` and
//! `income_bands`, which the caller resolves.

use crate::domain::options::{FamilyValues, MarriageTimeline, PrayerFrequency, Religiosity};

/// `religiosity`: `not_practising` 1 to `very_practising` 4.
pub const fn religiosity(value: Religiosity) -> i32 {
    match value {
        Religiosity::NotPractising => 1,
        Religiosity::ModeratelyPractising => 2,
        Religiosity::Practising => 3,
        Religiosity::VeryPractising => 4,
    }
}

/// `family_values`: `liberal` 1 to `religious` 4.
pub const fn family_values(value: FamilyValues) -> i32 {
    match value {
        FamilyValues::Liberal => 1,
        FamilyValues::Moderate => 2,
        FamilyValues::Traditional => 3,
        FamilyValues::Religious => 4,
    }
}

/// `prayer_frequency`: `rarely` 1 to `five_times` 5.
pub const fn prayer_frequency(value: PrayerFrequency) -> i32 {
    match value {
        PrayerFrequency::Rarely => 1,
        PrayerFrequency::JummahOnly => 2,
        PrayerFrequency::Sometimes => 3,
        PrayerFrequency::MostPrayers => 4,
        PrayerFrequency::FiveTimes => 5,
    }
}

/// `marriage_timeline`: `within_6_months` 1 to `within_2_years` 3. `not_decided` has no
/// position.
pub const fn marriage_timeline(value: MarriageTimeline) -> Option<i32> {
    match value {
        MarriageTimeline::Within6Months => Some(1),
        MarriageTimeline::Within1Year => Some(2),
        MarriageTimeline::Within2Years => Some(3),
        MarriageTimeline::NotDecided => None,
    }
}

/// Two positions are adjacent when they differ by exactly 1 (10 section 4.2).
pub const fn adjacent(a: i32, b: i32) -> bool {
    (a - b).abs() == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjacency_is_a_difference_of_one() {
        assert!(adjacent(
            religiosity(Religiosity::Practising),
            religiosity(Religiosity::VeryPractising)
        ));
        assert!(!adjacent(
            religiosity(Religiosity::ModeratelyPractising),
            religiosity(Religiosity::VeryPractising)
        ));
        assert!(adjacent(
            family_values(FamilyValues::Traditional),
            family_values(FamilyValues::Religious)
        ));
        assert_eq!(marriage_timeline(MarriageTimeline::NotDecided), None);
        assert_eq!(prayer_frequency(PrayerFrequency::FiveTimes), 5);
    }
}
