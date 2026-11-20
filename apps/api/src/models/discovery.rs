//! API types for discovery (15 sections 4.8 and 10): home, recommendations, search, saved
//! searches, visitors and the profile preview.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::domain::matching::home::Nudge;
use crate::domain::matching::refresh::RelaxationHint;
use crate::domain::options::{
    Beard, ChildrenAcceptance, EmploymentType, FamilyType, FamilyValues, Hijab, LivingArrangement,
    ManagedBy, MaritalStatus, Religiosity, Smoking, WorkAfterMarriage,
};
use crate::domain::types::Tier;
use crate::views::ProfileCard;

/// `?as=` of `GET /v1/me/profile/preview`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PreviewAs {
    /// A member of the opposite gender with no relation to the profile.
    #[default]
    Member,
    /// A member whose interest was accepted.
    Connection,
}

impl PreviewAs {
    pub fn tier(self) -> Tier {
        match self {
            Self::Member => Tier::Member,
            Self::Connection => Tier::Connection,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PreviewQuery {
    /// `member` (default) or `connection`.
    #[serde(rename = "as")]
    #[param(rename = "as", value_type = Option<String>)]
    pub as_tier: Option<PreviewAs>,
}

/// `GET /v1/profiles/by-code/{public_code}`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ProfileIdResponse {
    pub profile_id: Uuid,
}

/// One visitor or one visited profile (15 section 10).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct VisitorItem {
    pub profile: ProfileCard,
    #[serde(with = "time::serde::rfc3339")]
    pub last_viewed_at: OffsetDateTime,
    pub view_count: i64,
}

/// `GET /v1/me/visitors`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct VisitorsPage {
    pub items: Vec<VisitorItem>,
    pub next_cursor: Option<String>,
    /// True when the caller browses privately and therefore sees no visitors (09 section 8.2).
    pub hidden_because_private: bool,
}

/// `GET /v1/me/visited`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct VisitedPage {
    pub items: Vec<VisitorItem>,
    pub next_cursor: Option<String>,
}

/// `GET /v1/recommendations`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RecommendationsPage {
    pub items: Vec<ProfileCard>,
    pub next_cursor: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub refreshed_at: Option<OffsetDateTime>,
    /// The list was stale and is still being recomputed in the background.
    pub is_refreshing: bool,
    pub pool_exhausted: bool,
    /// At most 2; empty unless `pool_exhausted` (10 section 8.7).
    pub relaxation_hints: Vec<RelaxationHint>,
}

/// `GET /v1/home`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Home {
    /// Top 10.
    pub recommendations: Vec<ProfileCard>,
    /// Up to 10, joined in the last 7 days, passing the must-haves in both directions.
    pub new_members: Vec<ProfileCard>,
    /// Up to 10, same city, then same region.
    pub nearby: Vec<ProfileCard>,
    /// Up to 5.
    pub recent_visitors: Vec<ProfileCard>,
    pub visitors_count_7d: i64,
    pub pending_interests: i64,
    pub completeness: i16,
    /// At most 3, highest priority first.
    pub nudges: Vec<Nudge>,
    pub pool_exhausted: bool,
    /// At most 2; empty unless `pool_exhausted`.
    pub relaxation_hints: Vec<RelaxationHint>,
}

/// Search filters (15 section 4.8). Keys match `Preferences`. A missing key, `null` or an
/// empty array means no filter.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SearchFilters {
    /// Exact profile code; when set, every other filter is ignored.
    pub public_code: Option<String>,
    pub age_min: Option<i16>,
    pub age_max: Option<i16>,
    pub height_min_cm: Option<i16>,
    pub height_max_cm: Option<i16>,
    pub marital_statuses: Option<Vec<MaritalStatus>>,
    pub children_acceptance: Option<ChildrenAcceptance>,
    pub religion_codes: Option<Vec<String>>,
    pub sect_codes: Option<Vec<String>>,
    pub caste_codes: Option<Vec<String>>,
    pub mother_tongue_codes: Option<Vec<String>>,
    pub country_codes: Option<Vec<String>>,
    pub region_ids: Option<Vec<i32>>,
    pub city_ids: Option<Vec<i32>>,
    pub education_min_rank: Option<i16>,
    pub employment_types: Option<Vec<EmploymentType>>,
    pub profession_codes: Option<Vec<String>>,
    pub income_min_rank: Option<i16>,
    pub religiosity_levels: Option<Vec<Religiosity>>,
    pub hijab_types: Option<Vec<Hijab>>,
    pub beard_types: Option<Vec<Beard>>,
    pub family_values: Option<Vec<FamilyValues>>,
    pub family_types: Option<Vec<FamilyType>>,
    pub living_arrangements: Option<Vec<LivingArrangement>>,
    pub work_after_marriage_options: Option<Vec<WorkAfterMarriage>>,
    pub smoking_options: Option<Vec<Smoking>>,
    pub managed_by: Option<Vec<ManagedBy>>,
    pub has_photo: Option<bool>,
    /// ID verified or photo verified.
    pub verified_only: Option<bool>,
    /// 1, 7 or 30.
    pub active_within_days: Option<i32>,
    /// 7 or 30.
    pub joined_within_days: Option<i32>,
}

/// The order of search results (10 section 9.3).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchSort {
    #[default]
    BestMatch,
    Newest,
    RecentlyActive,
}

/// `POST /v1/search`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SearchRequest {
    #[serde(default)]
    pub filters: SearchFilters,
    /// `best_match` by default.
    #[serde(default)]
    pub sort: SearchSort,
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// The answer of `POST /v1/search`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SearchResults {
    pub items: Vec<ProfileCard>,
    pub next_cursor: Option<String>,
    /// Exact up to 500, `null` above; computed on the first page only.
    pub total_estimate: Option<i64>,
}

/// A saved search (15 section 10).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SavedSearch {
    pub id: Uuid,
    pub name: String,
    pub filters: SearchFilters,
    pub notify_new: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// `GET /v1/me/saved-searches`: at most 10 entries, so always one page.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SavedSearchesPage {
    pub items: Vec<SavedSearch>,
    pub next_cursor: Option<String>,
}

/// `POST /v1/me/saved-searches`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NewSavedSearch {
    /// 1 to 60 characters.
    pub name: String,
    pub filters: SearchFilters,
    pub notify_new: bool,
}

/// `PATCH /v1/me/saved-searches/{id}`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SavedSearchPatch {
    pub name: Option<String>,
    pub notify_new: Option<bool>,
}
