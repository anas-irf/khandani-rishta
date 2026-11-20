//! `Me`: the session bootstrap returned by `GET /v1/me` and by every endpoint that changes the
//! gate (15 section 4.2).

use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::account::AccountSnapshot;
use crate::db::counters::{self, Counters};
use crate::domain::options::{Gender, ManagedBy};
use crate::domain::time::karachi_date;
use crate::domain::types::{
    Badge, ConsentDocument, Gate, Locale, OnboardingStep, ProfileStatus, UserRole, UserStatus,
};
use crate::error::ApiError;
use crate::models::photos::{OwnPhoto, PHOTO_COLUMNS, PhotoRow, own_photo};
use crate::settings::AnnouncementBanner;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct Me {
    pub user: MeUser,
    pub profile: MeProfile,
    pub gate: Gate,
    pub consents_required: Vec<ConsentDocument>,
    pub counters: Counters,
    pub usage: MeUsage,
    pub config: MeConfig,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MeUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub email_verified: bool,
    pub phone_e164: Option<String>,
    pub phone_verified: bool,
    pub role: UserRole,
    pub status: UserStatus,
    pub status_reason: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub suspended_until: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub purge_after: Option<OffsetDateTime>,
    pub locale: Locale,
    pub timezone: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MeProfile {
    pub id: Uuid,
    pub public_code: String,
    pub status: ProfileStatus,
    pub status_reason: Option<String>,
    pub onboarding_step: OnboardingStep,
    pub first_name: Option<String>,
    pub gender: Option<Gender>,
    pub managed_by: Option<ManagedBy>,
    /// The primary photo, if any.
    pub photo: Option<OwnPhoto>,
    pub completeness: i16,
    pub badges: Vec<Badge>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MeUsage {
    pub interests_sent_today: i64,
    /// The daily limit that applies to this profile.
    pub interests_per_day: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MeConfig {
    pub identity_required: bool,
    pub photo_required: bool,
    pub photos_max: i64,
    pub legal: LegalVersions,
    pub support_email: String,
    /// `account.deletion_grace_days`, for the text of the delete dialog.
    pub deletion_grace_days: i64,
    pub announcement: Option<AnnouncementBanner>,
}

#[derive(Debug, Serialize, ToSchema)]
#[allow(clippy::struct_field_names)] // Field names are part of the API contract.
pub struct LegalVersions {
    pub terms_version: String,
    pub privacy_version: String,
    pub guidelines_version: String,
}

#[derive(sqlx::FromRow)]
#[allow(clippy::struct_excessive_bools)] // One field per selected column.
struct MeRow {
    email: Option<String>,
    email_verified: bool,
    phone_e164: Option<String>,
    phone_verified: bool,
    locale: Locale,
    timezone: String,
    user_created_at: OffsetDateTime,
    public_code: String,
    status_reason_profile: Option<String>,
    first_name: Option<String>,
    managed_by: Option<ManagedBy>,
    completeness: i16,
    is_phone_verified: bool,
    is_photo_verified: bool,
    is_id_verified: bool,
    first_activated_at: Option<OffsetDateTime>,
    interests_sent_today: i64,
}

/// Builds `Me` for an account snapshot. The snapshot must be fresh (load it again after any
/// change to the account in the same request).
pub async fn load(state: &AppState, account: &AccountSnapshot) -> Result<Me, ApiError> {
    let settings = state.settings.get().await?;
    let today = karachi_date(OffsetDateTime::now_utc());
    let row: MeRow = sqlx::query_as(
        "SELECT u.email, u.email_verified, u.phone_e164, u.phone_verified, u.locale, u.timezone,
                u.created_at AS user_created_at,
                p.public_code, p.status_reason AS status_reason_profile, p.first_name, p.managed_by,
                p.completeness, p.is_phone_verified, p.is_photo_verified, p.is_id_verified,
                p.first_activated_at,
                COALESCE((SELECT count FROM usage_counters c
                          WHERE c.profile_id = p.id AND c.counter = 'interests_sent' AND c.day = $3), 0)::bigint
                    AS interests_sent_today
         FROM users u JOIN profiles p ON p.user_id = u.id
         WHERE u.id = $1 AND p.id = $2",
    )
    .bind(account.user_id)
    .bind(account.profile_id)
    .bind(today)
    .fetch_one(&state.db)
    .await?;

    let primary: Option<PhotoRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PHOTO_COLUMNS} FROM profile_photos WHERE profile_id = $1 AND is_primary"
    )))
    .bind(account.profile_id)
    .fetch_optional(&state.db)
    .await?;
    let photo = match &primary {
        Some(row) => Some(own_photo(state.storage.as_ref(), row).await),
        None => None,
    };

    let counters = counters::load(&state.db, account.profile_id, account.user_id).await?;
    let verified = row.is_id_verified || row.is_photo_verified;
    let badges = crate::models::badges(
        row.is_phone_verified,
        row.is_photo_verified,
        row.is_id_verified,
        row.first_activated_at,
    );

    // The profile's own status reason is what the owner sees on the changes-requested screen;
    // the account reason is shown on the blocked screen.
    Ok(Me {
        user: MeUser {
            id: account.user_id,
            email: row.email,
            email_verified: row.email_verified,
            phone_e164: row.phone_e164,
            phone_verified: row.phone_verified,
            role: account.role,
            status: account.user_status,
            status_reason: account.status_reason.clone(),
            suspended_until: account.suspended_until,
            purge_after: account.purge_after,
            locale: row.locale,
            timezone: row.timezone,
            created_at: row.user_created_at,
        },
        profile: MeProfile {
            id: account.profile_id,
            public_code: row.public_code,
            status: account.profile_status,
            status_reason: row.status_reason_profile,
            onboarding_step: account.onboarding_step,
            first_name: row.first_name,
            gender: account.gender,
            managed_by: row.managed_by,
            photo,
            completeness: row.completeness,
            badges,
        },
        gate: account.gate(),
        consents_required: account.missing_consents.clone(),
        counters,
        usage: MeUsage {
            interests_sent_today: row.interests_sent_today,
            interests_per_day: settings.interests_limit(verified),
        },
        config: MeConfig {
            identity_required: settings.identity_required,
            photo_required: settings.photo_required,
            photos_max: settings.photos_max,
            legal: LegalVersions {
                terms_version: settings.terms_version.clone(),
                privacy_version: settings.privacy_version.clone(),
                guidelines_version: settings.guidelines_version.clone(),
            },
            support_email: settings.support_email.clone(),
            deletion_grace_days: settings.deletion_grace_days,
            announcement: settings.announcement_banner.clone(),
        },
    })
}

/// Reloads the snapshot without the cache, then builds `Me`. Use after changing the account.
pub async fn reload(state: &AppState, account: &AccountSnapshot) -> Result<Me, ApiError> {
    state.accounts.invalidate(account.user_id);
    let settings = state.settings.get().await?;
    let fresh = crate::auth::account::load(&state.db, &account.clerk_user_id, &settings)
        .await?
        .ok_or(ApiError::Unauthenticated)?;
    load(state, &fresh).await
}
