//! Request and response types of onboarding and the member's own profile (15 sections 4.3 and
//! 7).
//!
//! The section types are both what `GET /v1/me/profile` returns and what
//! `PUT /v1/me/profile/sections/{section}` accepts (15 section 4.3): a key sent as `null` (or
//! left out) clears the value. Every request type refuses unknown keys.
//!
//! Closed option lists are typed enumerations, so a value outside the list is refused as
//! `400 bad_request` before validation starts. Reference codes (religion, language, profession
//! and so on) are strings checked against the reference cache, which gives the field code
//! `unknown_code` (07 section 16.3).

use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::domain::completeness::CompletenessItem;
use crate::domain::options::{
    Beard, BloodGroup, BodyType, ChildrenStatus, ClosedReason, Complexion, Disability,
    DocumentType, EmploymentType, FamilyClass, FamilyType, FamilyValues, Gender, GuardianRelation,
    Hijab, HomeOwnership, HomeSizeUnit, HomeType, JahezStance, LivingArrangement, ManagedBy,
    MaritalStatus, MarriageTimeline, ParentStatus, PrayerFrequency, PreferredContact, Religiosity,
    ReligiousEducation, Relocation, ResidencyStatus, Smoking, WorkAfterMarriage,
};
use crate::domain::types::{
    ConsentDocument, IdentityStatus, OnboardingStep, ProfileStatus, TextStatus,
};
use crate::models::photos::OwnPhoto;
use crate::models::reference::CityRef;

/// The eight sections of 15 section 7, as they appear in the path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Section {
    AccountFor,
    Basics,
    Community,
    Location,
    EducationCareer,
    Family,
    Lifestyle,
    Contacts,
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/// Who manages the profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct AccountForSection {
    pub managed_by: Option<ManagedBy>,
    /// Never shown to other members. Always `null` when `managed_by` is `self`.
    pub manager_name: Option<String>,
}

/// The body of `PUT .../sections/account_for`: the section plus the consents ticked on the
/// screen, recorded at their current versions (07 section 3.4 rule 3).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AccountForBody {
    pub managed_by: Option<ManagedBy>,
    pub manager_name: Option<String>,
    #[serde(default)]
    pub consents: Vec<ConsentDocument>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct BasicsSection {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    /// `YYYY-MM-DD`. A string in the request so that an impossible date is a field error
    /// (`invalid`) and not a malformed body.
    #[schema(value_type = Option<String>, format = Date, example = "1998-04-12")]
    pub date_of_birth: Option<String>,
    pub marital_status: Option<MaritalStatus>,
    pub children_status: Option<ChildrenStatus>,
    pub children_count: Option<i16>,
    pub current_wives_count: Option<i16>,
    pub height_cm: Option<i16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct CommunitySection {
    pub religion_code: Option<String>,
    pub sect_code: Option<String>,
    pub caste_code: Option<String>,
    pub caste_other: Option<String>,
    pub sub_caste_code: Option<String>,
    pub sub_caste_other: Option<String>,
    pub mother_tongue_code: Option<String>,
    /// Languages besides the mother tongue, at most 6.
    #[serde(default)]
    pub language_codes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct LocationSection {
    pub nationality_code: Option<String>,
    pub country_code: Option<String>,
    /// Overwritten with the region of `city_id` when a listed city is chosen.
    pub region_id: Option<i32>,
    pub city_id: Option<i32>,
    pub city_other: Option<String>,
    pub area: Option<String>,
    pub residency_status: Option<ResidencyStatus>,
    pub origin_city_id: Option<i32>,
    pub origin_other: Option<String>,
    pub relocation: Option<Relocation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct EducationCareerSection {
    pub education_level_code: Option<String>,
    pub education_field_code: Option<String>,
    pub degree_title: Option<String>,
    pub institute_name: Option<String>,
    pub employment_type: Option<EmploymentType>,
    pub profession_code: Option<String>,
    pub job_title: Option<String>,
    pub employer_name: Option<String>,
    pub income_band_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct FamilySection {
    pub father_status: Option<ParentStatus>,
    pub father_occupation: Option<String>,
    pub mother_status: Option<ParentStatus>,
    pub mother_occupation: Option<String>,
    pub brothers_count: Option<i16>,
    pub brothers_married: Option<i16>,
    pub sisters_count: Option<i16>,
    pub sisters_married: Option<i16>,
    pub family_type: Option<FamilyType>,
    pub family_class: Option<FamilyClass>,
    pub family_values: Option<FamilyValues>,
    pub family_country_code: Option<String>,
    pub family_city_id: Option<i32>,
    pub home_ownership: Option<HomeOwnership>,
    pub home_type: Option<HomeType>,
    /// Greater than 0, at most 99,999.99, at most two decimal places.
    pub home_size_value: Option<f64>,
    pub home_size_unit: Option<HomeSizeUnit>,
    pub about_family: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct LifestyleSection {
    pub religiosity: Option<Religiosity>,
    pub prayer_frequency: Option<PrayerFrequency>,
    /// Female profiles only.
    pub hijab: Option<Hijab>,
    /// Male profiles only.
    pub beard: Option<Beard>,
    pub religious_education: Option<ReligiousEducation>,
    pub smoking: Option<Smoking>,
    pub living_arrangement: Option<LivingArrangement>,
    pub work_after_marriage: Option<WorkAfterMarriage>,
    pub marriage_timeline: Option<MarriageTimeline>,
    pub jahez_stance: Option<JahezStance>,
    pub weight_kg: Option<i16>,
    pub complexion: Option<Complexion>,
    pub body_type: Option<BodyType>,
    pub blood_group: Option<BloodGroup>,
    pub disability: Option<Disability>,
    pub disability_details: Option<String>,
    /// At most 10.
    #[serde(default)]
    pub hobby_codes: Vec<String>,
    pub about_me: Option<String>,
}

/// Private contact details (08 section 3). Never part of another member's response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct ContactsSection {
    pub phone_e164: Option<String>,
    pub whatsapp_e164: Option<String>,
    pub contact_email: Option<String>,
    pub guardian_name: Option<String>,
    pub guardian_relation: Option<GuardianRelation>,
    pub guardian_phone_e164: Option<String>,
    /// `self` when left out.
    #[serde(default = "default_preferred_contact")]
    pub preferred_contact: PreferredContact,
    pub best_time_to_call: Option<String>,
}

fn default_preferred_contact() -> PreferredContact {
    PreferredContact::Candidate
}

/// `LocationSection` with the two cities resolved, as `OwnProfile.location` shows it.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OwnLocation {
    #[serde(flatten)]
    pub section: LocationSection,
    pub city: Option<CityRef>,
    pub origin_city: Option<CityRef>,
}

/// An identity document the owner registered. The number is never returned (12 section 2.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct IdentitySummary {
    pub document_type: DocumentType,
    /// For example `*********1234`.
    pub number_masked: String,
    pub status: IdentityStatus,
    #[serde(with = "time::serde::rfc3339::option")]
    pub verified_at: Option<OffsetDateTime>,
}

/// Verification flags and the requests still waiting for a moderator.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OwnVerification {
    pub phone_verified: bool,
    pub photo_verified: bool,
    pub id_verified: bool,
    pub pending: PendingVerification,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
pub struct PendingVerification {
    pub id_document: bool,
    pub selfie: bool,
}

/// The status of each moderated text (03 section 4.5).
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
pub struct TextStatuses {
    pub about_me: TextStatus,
    pub about_family: TextStatus,
    pub partner_notes: TextStatus,
}

/// The owner's complete view of the profile (15 section 4.3).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OwnProfile {
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
    pub contacts: ContactsSection,
    pub photos: Vec<OwnPhoto>,
    pub identity: Option<IdentitySummary>,
    pub verification: OwnVerification,
    pub text_status: TextStatuses,
}

// ---------------------------------------------------------------------------------------------
// Other requests
// ---------------------------------------------------------------------------------------------

/// Documentation only: the body of `PUT .../sections/{section}` is the section type named in
/// the path. The handler picks the type itself, so that a body that does not fit its section
/// is reported as such.
#[derive(Serialize, ToSchema)]
#[serde(untagged)]
pub enum SectionBody {
    AccountFor(AccountForBody),
    Basics(BasicsSection),
    Community(CommunitySection),
    Location(LocationSection),
    EducationCareer(EducationCareerSection),
    Family(FamilySection),
    Lifestyle(LifestyleSection),
    Contacts(ContactsSection),
}

/// The body of `POST /v1/me/onboarding/continue`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ContinueBody {
    /// Must equal the current `onboarding_step`, and must not be `review` or `done`.
    #[schema(value_type = OnboardingStep)]
    pub step: String,
}

/// The body of `POST /v1/me/profile/close`.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CloseBody {
    pub reason: ClosedReason,
}

/// The body of `POST /v1/me/profile/reopen`.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReopenBody {
    /// Must be `true`.
    pub confirm: bool,
}

/// A request that carries an identity number. The number is kept out of `Debug` output and
/// zeroed on drop (12 section 2.3), and a body of the wrong type is refused without echoing the
/// value.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct IdentityBody {
    pub document_type: DocumentType,
    #[schema(value_type = String, example = "35202-1234567-1")]
    pub number: SecretText,
}

impl fmt::Debug for IdentityBody {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IdentityBody")
            .field("document_type", &self.document_type)
            .field("number", &"<redacted>")
            .finish()
    }
}

/// Text that must never reach a log line or an error message.
pub struct SecretText(Zeroizing<String>);

impl SecretText {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for SecretText {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct SecretVisitor;

        impl Visitor<'_> for SecretVisitor {
            type Value = SecretText;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a string")
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<SecretText, E> {
                Ok(SecretText(Zeroizing::new(value.to_owned())))
            }
        }

        // Anything but a string fails with a fixed message: the serde default messages quote
        // what was received.
        deserializer
            .deserialize_str(SecretVisitor)
            .map_err(|_| de::Error::custom("the number must be a string"))
    }
}

/// The body of `PATCH /v1/me/privacy`: any subset of `Privacy` (15 section 7).
#[derive(Debug, Clone, Copy, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PrivacyPatch {
    pub discovery_visibility: Option<crate::domain::options::DiscoveryVisibility>,
    pub interest_permission: Option<crate::domain::options::InterestPermission>,
    pub name_display: Option<crate::domain::options::NameDisplay>,
    pub photo_visibility: Option<crate::domain::options::PhotoVisibility>,
    pub caste_visibility: Option<crate::domain::options::FieldVisibility>,
    pub income_visibility: Option<crate::domain::options::FieldVisibility>,
    pub family_visibility: Option<crate::domain::options::FieldVisibility>,
    pub career_details_visibility: Option<crate::domain::options::FieldVisibility>,
    pub home_visibility: Option<crate::domain::options::FieldVisibility>,
    pub area_visibility: Option<crate::domain::options::FieldVisibility>,
    pub health_visibility: Option<crate::domain::options::FieldVisibility>,
    pub show_last_active: Option<bool>,
    pub show_online_status: Option<bool>,
    pub record_my_visits: Option<bool>,
    pub send_read_receipts: Option<bool>,
    pub allow_photo_requests: Option<bool>,
}

impl PrivacyPatch {
    /// A patch that names no setting.
    pub fn is_empty(&self) -> bool {
        self.discovery_visibility.is_none()
            && self.interest_permission.is_none()
            && self.name_display.is_none()
            && self.photo_visibility.is_none()
            && self.caste_visibility.is_none()
            && self.income_visibility.is_none()
            && self.family_visibility.is_none()
            && self.career_details_visibility.is_none()
            && self.home_visibility.is_none()
            && self.area_visibility.is_none()
            && self.health_visibility.is_none()
            && self.show_last_active.is_none()
            && self.show_online_status.is_none()
            && self.record_my_visits.is_none()
            && self.send_read_receipts.is_none()
            && self.allow_photo_requests.is_none()
    }

    /// The settings after the patch: a missing key keeps the stored value.
    #[must_use]
    pub fn apply(
        self,
        current: crate::domain::privacy::Privacy,
    ) -> crate::domain::privacy::Privacy {
        crate::domain::privacy::Privacy {
            discovery_visibility: self
                .discovery_visibility
                .unwrap_or(current.discovery_visibility),
            interest_permission: self
                .interest_permission
                .unwrap_or(current.interest_permission),
            name_display: self.name_display.unwrap_or(current.name_display),
            photo_visibility: self.photo_visibility.unwrap_or(current.photo_visibility),
            caste_visibility: self.caste_visibility.unwrap_or(current.caste_visibility),
            income_visibility: self.income_visibility.unwrap_or(current.income_visibility),
            family_visibility: self.family_visibility.unwrap_or(current.family_visibility),
            career_details_visibility: self
                .career_details_visibility
                .unwrap_or(current.career_details_visibility),
            home_visibility: self.home_visibility.unwrap_or(current.home_visibility),
            area_visibility: self.area_visibility.unwrap_or(current.area_visibility),
            health_visibility: self.health_visibility.unwrap_or(current.health_visibility),
            show_last_active: self.show_last_active.unwrap_or(current.show_last_active),
            show_online_status: self
                .show_online_status
                .unwrap_or(current.show_online_status),
            record_my_visits: self.record_my_visits.unwrap_or(current.record_my_visits),
            send_read_receipts: self
                .send_read_receipts
                .unwrap_or(current.send_read_receipts),
            allow_photo_requests: self
                .allow_photo_requests
                .unwrap_or(current.allow_photo_requests),
        }
    }
}
