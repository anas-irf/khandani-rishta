//! Constant weights of the matching formulas. They are code, not settings (10 section 4.1).

use crate::domain::matching::dimensions::Dimension;
use crate::domain::options::Importance;

/// `base_weight(d)` (10 section 4.1).
pub const fn base_weight(dimension: Dimension) -> f64 {
    match dimension {
        Dimension::Religion => 10.0,
        Dimension::Age => 9.0,
        Dimension::Sect | Dimension::MaritalStatus => 8.0,
        Dimension::Location | Dimension::Education => 7.0,
        Dimension::Religiosity | Dimension::Children => 6.0,
        Dimension::Caste | Dimension::Profession | Dimension::Income | Dimension::Family => 5.0,
        Dimension::MotherTongue | Dimension::LivingArrangement => 4.0,
        Dimension::Height | Dimension::Appearance | Dimension::WorkAfterMarriage => 3.0,
        Dimension::Smoking => 2.0,
    }
}

/// `multiplier(importance)` (10 section 4.1). `must` weighs like `high` and is also a hard
/// filter (10 section 3.2).
pub const fn multiplier(importance: Importance) -> f64 {
    match importance {
        Importance::Must | Importance::High => 1.5,
        Importance::Medium => 1.0,
        Importance::Low => 0.5,
    }
}

/// `weight(d) = base_weight(d) * multiplier(importance)` (10 section 4.1). Every product is a
/// multiple of 0.5, so sums of weights are exact in floating point.
pub const fn weight(dimension: Dimension, importance: Importance) -> f64 {
    base_weight(dimension) * multiplier(importance)
}

/// Similarity feature weights (10 section 5.2). They sum to 20.
pub mod similarity {
    pub const PLACE: f64 = 3.0;
    pub const MOTHER_TONGUE: f64 = 2.0;
    pub const SECT: f64 = 2.0;
    pub const RELIGIOSITY: f64 = 2.0;
    pub const EDUCATION: f64 = 2.0;
    pub const AGE_GAP: f64 = 2.0;
    pub const CASTE: f64 = 1.5;
    pub const FAMILY_VALUES: f64 = 1.5;
    pub const PRAYER: f64 = 1.0;
    pub const HOBBIES: f64 = 1.0;
    pub const MARRIAGE_TIMELINE: f64 = 1.0;
    pub const LIVING_ARRANGEMENT: f64 = 1.0;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::matching::testkit::assert_close;

    #[test]
    fn worked_example_weights() {
        // 10 section 12: the weight column of both preference tables.
        assert_close(weight(Dimension::Age, Importance::High), 13.5);
        assert_close(weight(Dimension::Religion, Importance::Must), 15.0);
        assert_close(weight(Dimension::Sect, Importance::Medium), 8.0);
        assert_close(weight(Dimension::MaritalStatus, Importance::High), 12.0);
        assert_close(weight(Dimension::Education, Importance::Must), 10.5);
        assert_close(weight(Dimension::Income, Importance::Medium), 5.0);
        assert_close(weight(Dimension::Location, Importance::Low), 3.5);
    }

    #[test]
    fn every_importance_has_its_multiplier() {
        assert_close(multiplier(Importance::Must), 1.5);
        assert_close(multiplier(Importance::High), 1.5);
        assert_close(multiplier(Importance::Medium), 1.0);
        assert_close(multiplier(Importance::Low), 0.5);
    }

    #[test]
    fn base_weights_match_the_table() {
        let total: f64 = Dimension::ALL.iter().map(|d| base_weight(*d)).sum();
        // 10 + 9 + 8 + 8 + 7 + 7 + 6 + 6 + 5 + 5 + 5 + 5 + 4 + 4 + 3 + 3 + 3 + 2
        assert_close(total, 100.0);
    }

    #[test]
    fn similarity_weights_sum_to_twenty() {
        use similarity::*;
        let total = PLACE
            + MOTHER_TONGUE
            + SECT
            + RELIGIOSITY
            + EDUCATION
            + AGE_GAP
            + CASTE
            + FAMILY_VALUES
            + PRAYER
            + HOBBIES
            + MARRIAGE_TIMELINE
            + LIVING_ARRANGEMENT;
        assert_close(total, 20.0);
    }
}
