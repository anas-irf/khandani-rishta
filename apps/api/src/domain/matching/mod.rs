//! Matching and ranking (10). Pure functions over profile and preference snapshots.
//!
//! One implementation serves recommendations, search, the home lists and the profile page
//! (10 section 1, principle 7). Nothing here reads the database: the caller loads the rows,
//! resolves reference values (education and income ranks, place parents and names) and passes
//! plain values in.
//!
//! | Module | Spec |
//! |---|---|
//! | [`subject`] | The matchable view of a profile and the place lookup (10 sections 3.2 and 4.5) |
//! | [`dimensions`] | The 18 dimensions: `is_set`, `score`, `must_test`, `passes_must_haves` (10 sections 3 and 4) |
//! | [`fit`] | Directional fit, similarity, `compat`, the pair of both directions (10 section 5) |
//! | [`rank`] | Ranking factors and `rank_score` (10 section 6) |
//! | [`reasons`] | Reason codes (10 section 7) |
//! | [`explain`] | `LookingFor` and `Compatibility` (10 section 11) |
//! | [`eligibility`] | The eligibility rules that are pure: E4 to E9 (10 section 3.1) |
//! | [`refresh`] | Pool query parameters, the scoring pass, relaxation hints, `pool_exhausted`, staleness (10 section 8) |
//! | [`search`] | Profile code normalisation and the keyset over-fetch loop (10 section 9) |
//! | [`home`] | Nudges (10 section 10.1) |
//! | [`weights`] | Base weights, importance multipliers, similarity weights (10 sections 4.1 and 5.2) |
//!
//! # Numbers
//!
//! Every score is computed in `f64`. Partial-credit steps are written as small integer
//! fractions (for example `(5 - k) / 5` for `1 - 0.2 * k`), so a score such as 0.6 is the
//! nearest `f64` to 0.6 and serialises as `0.6`. The only rounding is to whole percentages
//! ([`fit::round_percent`]): round half up, clamped to 0..=100. `rank_score` is returned as
//! `f32` because it is stored in a `real` column.

pub mod dimensions;
pub mod eligibility;
pub mod explain;
pub mod fit;
pub mod home;
pub mod rank;
pub mod reasons;
pub mod refresh;
mod scales;
pub mod search;
pub mod subject;
pub mod weights;

#[cfg(test)]
mod testkit;
