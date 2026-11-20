//! Privacy settings of a profile (04 section 5.7, 09 section 3, 15 section 4.5).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::options::{
    DiscoveryVisibility, FieldVisibility, InterestPermission, NameDisplay, PhotoVisibility,
};

/// Every column of `profile_privacy` except `profile_id` and the timestamps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the boolean columns of profile_privacy"
)]
pub struct Privacy {
    pub discovery_visibility: DiscoveryVisibility,
    pub interest_permission: InterestPermission,
    pub name_display: NameDisplay,
    pub photo_visibility: PhotoVisibility,
    pub caste_visibility: FieldVisibility,
    pub income_visibility: FieldVisibility,
    pub family_visibility: FieldVisibility,
    /// Job title, employer, institute.
    pub career_details_visibility: FieldVisibility,
    /// Home ownership, type, size.
    pub home_visibility: FieldVisibility,
    /// Neighbourhood; the city is always visible.
    pub area_visibility: FieldVisibility,
    /// Disability, blood group.
    pub health_visibility: FieldVisibility,
    pub show_last_active: bool,
    pub show_online_status: bool,
    /// `false`: browse privately.
    pub record_my_visits: bool,
    pub send_read_receipts: bool,
    pub allow_photo_requests: bool,
}

impl Default for Privacy {
    /// The column defaults of `profile_privacy` (04 section 5.7).
    fn default() -> Self {
        Self {
            discovery_visibility: DiscoveryVisibility::Everyone,
            interest_permission: InterestPermission::Everyone,
            name_display: NameDisplay::FirstNameLastInitial,
            photo_visibility: PhotoVisibility::Members,
            caste_visibility: FieldVisibility::Members,
            income_visibility: FieldVisibility::Connections,
            family_visibility: FieldVisibility::Members,
            career_details_visibility: FieldVisibility::Connections,
            home_visibility: FieldVisibility::Connections,
            area_visibility: FieldVisibility::Connections,
            health_visibility: FieldVisibility::Connections,
            show_last_active: true,
            show_online_status: true,
            record_my_visits: true,
            send_read_receipts: true,
            allow_photo_requests: true,
        }
    }
}
