//! Partner preferences: what the candidate is looking for (04 section 5.6, 15 section 4.5).
//!
//! The same type is the API body of `GET` and `PUT /v1/me/preferences`, the row read from
//! `partner_preferences`, and the input of the matching functions (10).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::options::{
    Beard, ChildrenAcceptance, EmploymentType, FamilyType, FamilyValues, Hijab, Importance,
    LivingArrangement, MaritalStatus, Religiosity, Smoking, WorkAfterMarriage,
};

/// Every column of `partner_preferences` except `profile_id`, `notes_status` and the timestamps.
/// An empty array or a `null` bound means "no preference" for that dimension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct Preferences {
    pub age_min: i16,
    pub age_max: i16,
    pub age_importance: Importance,

    pub height_min_cm: Option<i16>,
    pub height_max_cm: Option<i16>,
    pub height_importance: Importance,

    pub marital_statuses: Vec<MaritalStatus>,
    pub marital_status_importance: Importance,

    pub children_acceptance: ChildrenAcceptance,
    pub children_importance: Importance,

    pub religion_codes: Vec<String>,
    pub religion_importance: Importance,

    pub sect_codes: Vec<String>,
    pub sect_importance: Importance,

    /// Top-level caste codes only.
    pub caste_codes: Vec<String>,
    pub caste_importance: Importance,

    pub mother_tongue_codes: Vec<String>,
    pub mother_tongue_importance: Importance,

    pub country_codes: Vec<String>,
    pub region_ids: Vec<i32>,
    pub city_ids: Vec<i32>,
    pub location_importance: Importance,

    /// `education_levels.rank`.
    pub education_min_rank: Option<i16>,
    pub education_importance: Importance,

    pub employment_types: Vec<EmploymentType>,
    pub profession_codes: Vec<String>,
    pub profession_importance: Importance,

    /// `income_bands.rank`.
    pub income_min_rank: Option<i16>,
    pub income_importance: Importance,

    pub religiosity_levels: Vec<Religiosity>,
    pub religiosity_importance: Importance,

    /// Used when the candidate seeks a woman.
    pub hijab_types: Vec<Hijab>,
    /// Used when the candidate seeks a man.
    pub beard_types: Vec<Beard>,
    pub appearance_importance: Importance,

    pub family_values: Vec<FamilyValues>,
    pub family_types: Vec<FamilyType>,
    pub family_importance: Importance,

    pub living_arrangements: Vec<LivingArrangement>,
    pub living_arrangement_importance: Importance,

    pub work_after_marriage_options: Vec<WorkAfterMarriage>,
    pub work_after_marriage_importance: Importance,

    pub smoking_options: Vec<Smoking>,
    pub smoking_importance: Importance,

    /// "What I am looking for", shown on the profile once approved (13 section 3).
    pub notes: Option<String>,
}

/// Fixed array size limits for preferences (04 section 5.6, 03 section 7).
pub mod limits {
    pub const CASTES_MAX: usize = 30;
    pub const CITIES_MAX: usize = 20;
    pub const REGIONS_MAX: usize = 20;
    pub const COUNTRIES_MAX: usize = 20;
    pub const PROFESSIONS_MAX: usize = 20;
}
