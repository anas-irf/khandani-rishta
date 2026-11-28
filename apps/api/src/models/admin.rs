//! Response types of the staff console (18). Request bodies live next to their routes.
//!
//! Optional values are always present as `null`, timestamps are RFC 3339 and every list is a
//! `Page` (cursor pagination) unless the spec gives the whole set (settings, releases, castes).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::completeness::CompletenessItem;
use crate::domain::options::{Gender, ManagedBy, ReportReason, VerificationRejectionReason};
use crate::domain::preferences::Preferences;
use crate::domain::privacy::Privacy;
use crate::domain::types::{
    AuditTargetType, CasteSuggestionStatus, ConsentDocument, DevicePlatform, Locale,
    OnboardingStep, ProfileStatus, ReleasePlatform, ReportSource, ReportStatus, ReportSubject,
    SanctionType, UserRole, UserStatus, VerificationKind, VerificationStatus,
};
use crate::models::photos::OwnPhoto;
use crate::models::profile::{
    AccountForSection, BasicsSection, CommunitySection, ContactsSection, EducationCareerSection,
    FamilySection, IdentitySummary, LifestyleSection, OwnLocation, OwnProfile, OwnVerification,
    TextStatuses,
};

/// A list that is returned whole instead of paged (`GET /castes`, `/settings`, `/releases`).
#[derive(Debug, Serialize, ToSchema)]
pub struct Items<T> {
    pub items: Vec<T>,
}

// ---- Overview (18 section 9) ----

/// `GET /v1/admin/overview`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminOverview {
    #[serde(with = "time::serde::rfc3339")]
    pub generated_at: OffsetDateTime,
    pub queues: OverviewQueues,
    pub metrics: OverviewMetrics,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OverviewQueues {
    pub profiles_pending: i64,
    pub photos_pending: i64,
    /// Subset of `photos_pending` whose automatic result is `flag`.
    pub photos_flagged: i64,
    pub texts_pending: i64,
    pub verifications_pending: i64,
    pub reports_open: i64,
    pub reports_in_review: i64,
    pub caste_suggestions_pending: i64,
    pub oldest_waiting: OldestWaiting,
}

/// Created time of the longest-waiting item of each queue, `null` when the queue is empty.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OldestWaiting {
    #[serde(with = "time::serde::rfc3339::option")]
    pub profiles: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub photos: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub verifications: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub reports: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OverviewMetrics {
    pub users_total: i64,
    pub signups_today: i64,
    pub signups_7d: i64,
    pub profiles_by_status: ProfilesByStatus,
    pub active_male: i64,
    pub active_female: i64,
    pub active_id_verified: i64,
    pub active_photo_verified: i64,
    /// Active profiles with `last_active_at` in the last 7 days.
    pub active_last_7d: i64,
    pub interests_sent_today: i64,
    pub interests_sent_7d: i64,
    pub interests_accepted_7d: i64,
    pub connections_active: i64,
    pub connections_created_7d: i64,
    pub stage_counts: StageCounts,
    pub messages_7d: i64,
    pub reports_filed_7d: i64,
    pub users_suspended: i64,
    pub users_banned: i64,
    pub deletions_scheduled: i64,
    /// Above zero means a background job failed permanently and needs a developer.
    pub jobs_dead: i64,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct ProfilesByStatus {
    pub draft: i64,
    pub pending_review: i64,
    pub changes_requested: i64,
    pub active: i64,
    pub paused: i64,
    pub closed: i64,
    pub suspended: i64,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct StageCounts {
    pub chatting: i64,
    pub families_talking: i64,
    pub engaged: i64,
    pub nikah_done: i64,
}

// ---- Audit (18 section 8) ----

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AuditActor {
    pub user_id: Uuid,
    pub email: Option<String>,
}

/// One row of `admin_audit_log`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AuditEntry {
    pub id: Uuid,
    pub actor: AuditActor,
    /// An action code of 18 section 8.3.
    pub action: String,
    pub target_type: AuditTargetType,
    pub target_id: String,
    /// Never holds an identity number, a contact detail or private message text.
    #[schema(value_type = Object)]
    pub details: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

// ---- Reports (18 section 4.5) ----

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReportTarget {
    pub profile_id: Uuid,
    pub user_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReportReporter {
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
}

/// A row of the report queue.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminReportListItem {
    pub report_id: Uuid,
    pub source: ReportSource,
    /// 1 (most urgent) to 3 (13 section 6.5).
    pub priority: i32,
    pub reason: ReportReason,
    pub subject_type: ReportSubject,
    pub status: ReportStatus,
    pub target: ReportTarget,
    /// `null` for a system report.
    pub reporter: Option<ReportReporter>,
    /// Reports on the same target that are `open` or `in_review`.
    pub open_reports_on_target: i64,
    pub handled_by_email: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// The reported photo of a `photo` report.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReportPhoto {
    pub photo_id: Uuid,
    pub status: Option<String>,
    /// Signed, unblurred. `null` when the object is gone.
    pub large_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReportTargetSummary {
    pub user_status: UserStatus,
    pub profile_status: ProfileStatus,
    pub reports_against_total: i64,
    pub reports_against_actioned: i64,
    pub sanctions: Vec<AdminSanction>,
    pub is_id_verified: bool,
    pub is_photo_verified: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReportsFiled {
    pub total: i64,
    pub actioned: i64,
    pub dismissed: i64,
}

/// How many reports a reporter filed and how they were decided (`reporter_summary`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReporterSummary {
    pub filed: i64,
    pub actioned: i64,
    pub dismissed: i64,
}

/// `GET /v1/admin/reports/{report_id}`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminReportDetail {
    #[serde(flatten)]
    pub item: AdminReportListItem,
    pub details: Option<String>,
    /// The snapshot taken at filing time (13 section 6.3 and 5.5).
    #[schema(value_type = Option<Object>)]
    pub context: Option<Value>,
    pub photo: Option<ReportPhoto>,
    pub resolution_note: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub handled_at: Option<OffsetDateTime>,
    pub target_summary: ReportTargetSummary,
    /// `null` for a system report.
    pub reporter_summary: Option<ReporterSummary>,
    /// Other `open` or `in_review` reports on the same target.
    pub related_reports: Vec<AdminReportListItem>,
}

// ---- Sanctions, users and profiles (18 sections 4.1, 5) ----

/// A row of `sanctions` with the staff emails resolved.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminSanction {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub kind: SanctionType,
    pub reason: String,
    pub report_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ends_at: Option<OffsetDateTime>,
    /// `null` when the system applied it.
    pub created_by_email: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub revoked_at: Option<OffsetDateTime>,
    pub revoked_by_email: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminDevice {
    pub platform: DevicePlatform,
    pub app_version: Option<String>,
    pub device_model: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminConsent {
    pub document: ConsentDocument,
    pub version: String,
    #[serde(with = "time::serde::rfc3339")]
    pub accepted_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UserFlags {
    /// 5 or more dismissed reports and none actioned in 30 days (13 section 6.6).
    pub reporter_misuse: bool,
    /// Messages with `safety_flag = 'money'` sent in the last 30 days.
    pub money_flags_30d: i64,
    /// A system report records that the user signed in on a device of a sanctioned account.
    pub shared_device_with_sanctioned_user: bool,
}

/// One numbered page of the users list (18 section 5.1).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminUserPage {
    pub items: Vec<AdminUserListItem>,
    /// Accounts matching the filters, on every page.
    pub total: i64,
    /// The page shown, from 1.
    pub page: i64,
    pub page_size: i64,
}

/// A row of the users list.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminUserListItem {
    pub user_id: Uuid,
    pub profile_id: Uuid,
    pub public_code: String,
    pub email: Option<String>,
    pub role: UserRole,
    pub status: UserStatus,
    pub profile_status: ProfileStatus,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_seen_at: Option<OffsetDateTime>,
}

/// `GET /v1/admin/users/{user_id}`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminUser {
    #[serde(flatten)]
    pub item: AdminUserListItem,
    pub email_verified: bool,
    /// `null` for moderators.
    pub phone_e164: Option<String>,
    pub phone_verified: bool,
    pub status_reason: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub suspended_until: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub deletion_requested_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub purge_after: Option<OffsetDateTime>,
    pub locale: Locale,
    pub devices: Vec<AdminDevice>,
    pub consents: Vec<AdminConsent>,
    pub sanctions: Vec<AdminSanction>,
    /// Newest 20.
    pub reports_against: Vec<AdminReportListItem>,
    pub reports_filed: ReportsFiled,
    pub flags: UserFlags,
    /// Newest 50 entries whose target is this user or their profile.
    pub audit: Vec<AuditEntry>,
}

/// A row of the profile search and review queue.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminProfileListItem {
    pub profile_id: Uuid,
    pub user_id: Uuid,
    pub public_code: String,
    pub status: ProfileStatus,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    pub age: Option<i32>,
    pub city_name: Option<String>,
    pub managed_by: Option<ManagedBy>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub onboarding_completed_at: Option<OffsetDateTime>,
    /// First photo of any status, unblurred.
    pub photo_thumb_url: Option<String>,
    pub open_system_reports: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminProfileUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub email_verified: bool,
    /// `null` for moderators.
    pub phone_e164: Option<String>,
    pub role: UserRole,
    pub status: UserStatus,
    pub status_reason: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub suspended_until: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_seen_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminProfileStats {
    pub interests_sent: i64,
    pub interests_received: i64,
    /// Sent interests that were accepted.
    pub interests_accepted_by_others: i64,
    pub active_connections: i64,
    pub connections_ended_by_others: i64,
    /// Messages with `safety_flag = 'money'` sent in the last 30 days.
    pub money_flags_30d: i64,
    pub blocks_received: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema, sqlx::FromRow)]
pub struct AdminVerificationRequest {
    pub id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub rejection_reason: Option<VerificationRejectionReason>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub reviewed_at: Option<OffsetDateTime>,
}

/// `OwnProfile` (15 section 4.3) as the staff console receives it: the same fields, with
/// `contacts` `null` for moderators (18 section 4.1).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminOwnProfile {
    pub id: Uuid,
    pub public_code: String,
    pub status: ProfileStatus,
    pub status_reason: Option<String>,
    pub onboarding_step: OnboardingStep,
    pub completeness: i16,
    /// Completeness items not yet met, most valuable first (08 section 6.2).
    pub missing: Vec<CompletenessItem>,
    /// Fields the owner can no longer edit (03 section 8 rule 15).
    pub locked_fields: Vec<String>,
    pub account_for: AccountForSection,
    pub basics: BasicsSection,
    pub community: CommunitySection,
    pub location: OwnLocation,
    pub education_career: EducationCareerSection,
    pub family: FamilySection,
    pub lifestyle: LifestyleSection,
    /// `null` for moderators: only admins see contact details.
    pub contacts: Option<ContactsSection>,
    pub photos: Vec<OwnPhoto>,
    pub identity: Option<IdentitySummary>,
    pub verification: OwnVerification,
    pub text_status: TextStatuses,
}

impl AdminOwnProfile {
    /// The owner's view of the profile, with the contact details only when `include_contacts`.
    pub fn new(profile: OwnProfile, include_contacts: bool) -> Self {
        // Every field is named, so a field added to `OwnProfile` must be added here too.
        let OwnProfile {
            id,
            public_code,
            status,
            status_reason,
            onboarding_step,
            completeness,
            missing,
            locked_fields,
            account_for,
            basics,
            community,
            location,
            education_career,
            family,
            lifestyle,
            contacts,
            photos,
            identity,
            verification,
            text_status,
        } = profile;
        Self {
            id,
            public_code,
            status,
            status_reason,
            onboarding_step,
            completeness,
            missing,
            locked_fields,
            account_for,
            basics,
            community,
            location,
            education_career,
            family,
            lifestyle,
            contacts: include_contacts.then_some(contacts),
            photos,
            identity,
            verification,
            text_status,
        }
    }
}

/// `GET /v1/admin/profiles/{profile_id}`.
///
/// `profile`, `preferences` and `privacy` carry the objects of 15 sections 4.3 and 4.5
/// (`OwnProfile`, `Preferences`, `Privacy`), with the unblurred photo URLs and, for admins only,
/// the contact details.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminProfile {
    pub user: AdminProfileUser,
    pub profile: AdminOwnProfile,
    /// `null` when the profile has no partner preferences yet.
    pub preferences: Option<Preferences>,
    /// `null` only after the account was purged.
    pub privacy: Option<Privacy>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub first_activated_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_active_at: Option<OffsetDateTime>,
    pub stats: AdminProfileStats,
    /// Newest 10.
    pub reports_against: Vec<AdminReportListItem>,
    pub reports_filed: ReportsFiled,
    pub sanctions: Vec<AdminSanction>,
    pub verification_requests: Vec<AdminVerificationRequest>,
    /// Newest 20 entries whose target is this profile or its user.
    pub audit: Vec<AuditEntry>,
}

// ---- Reference data (18 section 6) ----

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CasteSimilar {
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct CasteSuggestionItem {
    pub id: Uuid,
    pub name: String,
    pub normalized_name: String,
    pub parent_code: Option<String>,
    pub parent_name: Option<String>,
    pub usage_count: i32,
    pub status: CasteSuggestionStatus,
    /// Existing castes whose name or alias has a trigram similarity of 0.4 or more.
    pub similar: Vec<CasteSimilar>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// A caste or sub-caste, active or not.
#[derive(Debug, Clone, Serialize, ToSchema, sqlx::FromRow)]
pub struct AdminCaste {
    pub code: String,
    pub parent_code: Option<String>,
    pub name: String,
    pub name_ur: Option<String>,
    pub aliases: Vec<String>,
    pub sort_order: i32,
    pub is_active: bool,
}

/// The result of promoting a caste suggestion.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PromotedCaste {
    pub caste: AdminCaste,
    /// Profiles whose typed caste was replaced by the new code.
    pub profiles_updated: i64,
}

// ---- Settings, releases, announcements (18 section 7) ----

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SettingItem {
    pub key: String,
    /// Any JSON value; its type depends on the key (18 section 7.1).
    pub value: Value,
    /// The value used while no row exists.
    pub default: Value,
    pub updated_by_email: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub updated_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, ToSchema, sqlx::FromRow)]
pub struct AdminRelease {
    pub id: Uuid,
    pub platform: ReleasePlatform,
    pub version_code: i32,
    pub version_name: String,
    pub min_supported_version_code: i32,
    pub download_url: String,
    pub release_notes: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub released_at: OffsetDateTime,
}

/// The answer of `POST /v1/admin/announcements` (`202`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AnnouncementAccepted {
    /// Users who are `active` with an `active` or `paused` profile.
    pub recipients_estimate: i64,
}

// ---- Cursors ----

/// A timestamp as it goes into a cursor: microseconds since the Unix epoch, which is the
/// precision of `timestamptz`, so a cursor round-trips without loss.
pub fn to_micros(at: OffsetDateTime) -> i64 {
    i64::try_from(at.unix_timestamp_nanos() / 1000).unwrap_or_default()
}

/// The inverse of [`to_micros`].
pub fn from_micros(micros: i64) -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(micros) * 1000)
        .unwrap_or(OffsetDateTime::UNIX_EPOCH)
}
