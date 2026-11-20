//! The response types of other members' profiles (15 section 4.6). They are built only by this
//! module, from the rules of 09, so no handler assembles them by hand (09 section 13.1).

use serde::Serialize;
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::matching::explain::{Compatibility, LookingFor};
use crate::domain::matching::reasons::ReasonCode;
use crate::domain::options::{
    Beard, BloodGroup, BodyType, ChildrenStatus, Complexion, Disability, EmploymentType,
    FamilyClass, FamilyType, FamilyValues, Gender, Hijab, HomeOwnership, HomeSizeUnit, HomeType,
    JahezStance, LivingArrangement, ManagedBy, MaritalStatus, MarriageTimeline, ParentStatus,
    PrayerFrequency, Religiosity, ReligiousEducation, Relocation, ResidencyStatus, Smoking,
    WorkAfterMarriage,
};
use crate::domain::types::{Badge, InterestStatus, LastActive, LockedGroup, Tier};
use crate::domain::visibility::{
    CannotSendDetail, CannotSendReason, InterestDirection, RelationPhotoAccess,
};

/// Another member's photo as the viewer may see it (15 section 4.4). In blurred mode the URLs
/// point at the separate blurred files and `large_url` is `null` (09 section 6.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PhotoView {
    pub id: Uuid,
    pub is_primary: bool,
    pub is_blurred: bool,
    /// The blurred variant when `is_blurred`.
    pub thumb_url: String,
    /// The blurred variant when `is_blurred`.
    pub medium_url: String,
    /// `null` when `is_blurred`.
    pub large_url: Option<String>,
}

/// `ProfileCard.relation`: the short form of [`Relation`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct CardRelation {
    pub tier: Tier,
    /// `pending` or `null`.
    pub interest_status: Option<InterestStatus>,
    pub interest_direction: Option<InterestDirection>,
    pub connection_id: Option<Uuid>,
    pub is_shortlisted: bool,
    /// The same result as `Relation.can_send_interest`, so lists can offer "Send interest".
    pub can_send_interest: bool,
}

/// The compact form of another member's profile, used in every list (15 section 4.6).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ProfileCard {
    pub id: Uuid,
    pub public_code: String,
    /// Already reduced according to the owner's `name_display` (09 section 4).
    pub display_name: String,
    pub age: i32,
    pub gender: Gender,
    pub managed_by: ManagedBy,
    pub height_cm: i16,
    pub marital_status: MaritalStatus,
    pub religion_code: String,
    pub sect_code: Option<String>,
    /// The caste name or the owner's typed value; `null` when hidden or not stated.
    pub caste_label: Option<String>,
    pub mother_tongue_code: String,
    pub city_name: String,
    pub region_name: Option<String>,
    pub country_code: String,
    pub education_level_code: String,
    pub employment_type: EmploymentType,
    pub profession_code: Option<String>,
    /// The primary photo; `null` when the profile has no approved photo.
    pub photo: Option<PhotoView>,
    /// Approved photos, in both modes.
    pub photo_count: i64,
    pub badges: Vec<Badge>,
    /// `null` unless both members show when they were last active (09 section 9).
    pub last_active: Option<LastActive>,
    /// 0..100 (10 section 5.3), computed at read time.
    pub compat: Option<u8>,
    /// Reason codes, at most 3 (10 section 7).
    #[schema(value_type = Vec<String>)]
    pub reasons: Vec<ReasonCode>,
    pub relation: CardRelation,
}

/// `ProfileDetail.basics`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DetailBasics {
    pub marital_status: MaritalStatus,
    pub children_status: Option<ChildrenStatus>,
    pub children_count: Option<i16>,
    pub current_wives_count: Option<i16>,
    pub height_cm: i16,
    pub weight_kg: Option<i16>,
    pub complexion: Option<Complexion>,
    pub body_type: Option<BodyType>,
}

/// `ProfileDetail.community`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DetailCommunity {
    pub religion_code: String,
    pub sect_code: Option<String>,
    /// Group `caste`.
    pub caste_label: Option<String>,
    /// Group `caste`.
    pub sub_caste_label: Option<String>,
    pub mother_tongue_code: String,
    pub language_codes: Vec<String>,
}

/// `ProfileDetail.location`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DetailLocation {
    pub country_code: String,
    pub region_name: Option<String>,
    pub city_name: String,
    /// Group `area`.
    pub area: Option<String>,
    pub nationality_code: Option<String>,
    pub residency_status: Option<ResidencyStatus>,
    /// The family's home town: a city name or the owner's typed value.
    pub origin_label: Option<String>,
    pub relocation: Option<Relocation>,
}

/// `ProfileDetail.education_career`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DetailEducationCareer {
    pub education_level_code: String,
    pub education_field_code: Option<String>,
    /// Group `career_details`.
    pub degree_title: Option<String>,
    /// Group `career_details`.
    pub institute_name: Option<String>,
    pub employment_type: EmploymentType,
    pub profession_code: Option<String>,
    /// Group `career_details`.
    pub job_title: Option<String>,
    /// Group `career_details`.
    pub employer_name: Option<String>,
    /// Group `income`.
    pub income_band_code: Option<String>,
}

/// `ProfileDetail.family`: the fields of group `family`, except `about_family`, and the home
/// fields of group `home`. A hidden group's fields are `null`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct DetailFamily {
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
    pub family_city_name: Option<String>,
    pub home_ownership: Option<HomeOwnership>,
    pub home_type: Option<HomeType>,
    pub home_size_value: Option<f64>,
    pub home_size_unit: Option<HomeSizeUnit>,
}

/// `ProfileDetail.lifestyle`: the lifestyle section without the appearance fields and
/// `about_me`. The health fields belong to group `health`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DetailLifestyle {
    pub religiosity: Option<Religiosity>,
    pub prayer_frequency: Option<PrayerFrequency>,
    pub hijab: Option<Hijab>,
    pub beard: Option<Beard>,
    pub religious_education: Option<ReligiousEducation>,
    pub smoking: Option<Smoking>,
    pub living_arrangement: Option<LivingArrangement>,
    pub work_after_marriage: Option<WorkAfterMarriage>,
    pub marriage_timeline: Option<MarriageTimeline>,
    pub jahez_stance: Option<JahezStance>,
    pub blood_group: Option<BloodGroup>,
    pub disability: Option<Disability>,
    pub disability_details: Option<String>,
    pub hobby_codes: Vec<String>,
}

/// `Relation.interest`: the pending interest between the two members.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct RelationInterest {
    pub id: Uuid,
    pub direction: InterestDirection,
    /// Always `pending`.
    pub status: InterestStatus,
    pub message: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
}

/// What links the viewer to the owner, and what the viewer may do next (15 section 4.6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Relation {
    pub tier: Tier,
    pub interest: Option<RelationInterest>,
    pub connection_id: Option<Uuid>,
    pub is_shortlisted: bool,
    pub shortlist_note: Option<String>,
    pub is_passed: bool,
    pub photo_access: RelationPhotoAccess,
    pub can_send_interest: bool,
    pub cannot_send_reason: Option<CannotSendReason>,
    /// Set only with `not_permitted_by_member` (09 section 7).
    pub cannot_send_detail: Option<CannotSendDetail>,
    /// The date the cooldown ends, for `cooldown` (`YYYY-MM-DD`).
    #[serde(with = "crate::models::iso_date::option")]
    #[schema(value_type = Option<String>, format = Date)]
    pub can_send_interest_after: Option<Date>,
}

/// The full form of another member's profile (15 section 4.6). A hidden value is `null`; the
/// groups listed in `locked` are those that connecting would reveal (09 section 5.5).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ProfileDetail {
    pub card: ProfileCard,
    pub is_online: Option<bool>,
    pub photos: Vec<PhotoView>,
    pub basics: DetailBasics,
    pub community: DetailCommunity,
    pub location: DetailLocation,
    pub education_career: DetailEducationCareer,
    pub family: Option<DetailFamily>,
    pub lifestyle: DetailLifestyle,
    pub about_me: Option<String>,
    pub about_family: Option<String>,
    pub partner_notes: Option<String>,
    pub looking_for: LookingFor,
    /// `null` only in the owner's own preview (15 section 7).
    pub compatibility: Option<Compatibility>,
    pub locked: Vec<LockedGroup>,
    pub relation: Relation,
}
