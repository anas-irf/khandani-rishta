//! Request and response types (serde, utoipa `ToSchema`), one file per area (21 section 2).

pub mod admin;
pub mod connections;
pub mod discovery;
pub mod interests;
pub mod me;
pub mod notifications;
pub mod photos;
pub mod profile;
pub mod reference;
pub mod verifications;

use time::{Duration, OffsetDateTime};

// `YYYY-MM-DD` for `time::Date` fields (15 section 1). Without this, `time` writes a date as
// `[year, ordinal]`. Use `#[serde(with = "crate::models::iso_date")]` (or `::option`) together
// with `#[schema(value_type = String, format = Date)]`.
time::serde::format_description!(pub iso_date, Date, "[year]-[month]-[day]");

use crate::domain::types::Badge;

/// Badges of a profile (03 section 6): verification flags plus `new` for the first 7 days.
pub fn badges(
    phone_verified: bool,
    photo_verified: bool,
    id_verified: bool,
    first_activated_at: Option<OffsetDateTime>,
) -> Vec<Badge> {
    let mut badges = Vec::new();
    if phone_verified {
        badges.push(Badge::PhoneVerified);
    }
    if photo_verified {
        badges.push(Badge::PhotoVerified);
    }
    if id_verified {
        badges.push(Badge::IdVerified);
    }
    if first_activated_at.is_some_and(|at| OffsetDateTime::now_utc() - at < Duration::days(7)) {
        badges.push(Badge::New);
    }
    badges
}
