//! Turns an assessed pair into the response types of 15 section 4.6. Only values the
//! disclosure allows are copied; everything else stays `null` (03 section 8 rule 6).

use crate::domain::display::{self, BadgeFacts, NameParts};
use crate::domain::matching::explain::{self, Compatibility, LookingFor};
use crate::domain::matching::reasons::ReasonCode;
use crate::domain::matching::subject::{Geo, Subject};
use crate::domain::types::{InterestStatus, LockedGroup, Tier};
use crate::domain::visibility::{
    Activity, CannotSend, Disclosure, PhotoKeys, PhotoMode, RelationPhotoAccess, moderated_text,
};
use crate::models::photos::sign;
use crate::reference::ReferenceData;
use crate::services::r2::ObjectStore;
use crate::views::assess::Assessed;
use crate::views::load::ApprovedPhoto;
use crate::views::member::Member;
use crate::views::types::{
    CardRelation, DetailBasics, DetailCommunity, DetailEducationCareer, DetailFamily,
    DetailLifestyle, DetailLocation, PhotoView, ProfileCard, ProfileDetail, Relation,
    RelationInterest,
};

/// The primary photo: the one marked primary, else the first in display order.
pub fn primary(photos: &[ApprovedPhoto]) -> Option<&ApprovedPhoto> {
    photos
        .iter()
        .find(|photo| photo.is_primary)
        .or_else(|| photos.first())
}

/// Signs the variants that `mode` allows (09 section 6.2). A photo whose keys are missing or
/// cannot be signed is left out; a blurred photo never has a clear key signed.
pub async fn photo_view(
    storage: &dyn ObjectStore,
    mode: PhotoMode,
    photo: &ApprovedPhoto,
) -> Option<PhotoView> {
    let keys = PhotoKeys {
        thumb: photo.key_thumb.as_deref()?,
        medium: photo.key_medium.as_deref()?,
        large: photo.key_large.as_deref()?,
        blur_thumb: photo.key_blur_thumb.as_deref()?,
        blur_medium: photo.key_blur_medium.as_deref()?,
    };
    let variants = mode.variants(keys);
    let thumb_url = sign(storage, Some(variants.thumb)).await?;
    let medium_url = sign(storage, Some(variants.medium)).await?;
    let large_url = match variants.large {
        Some(key) => Some(sign(storage, Some(key)).await?),
        None => None,
    };
    Some(PhotoView {
        id: photo.id,
        is_primary: photo.is_primary,
        is_blurred: variants.is_blurred,
        thumb_url,
        medium_url,
        large_url,
    })
}

/// Every approved photo as the viewer may see it, in display order.
pub async fn photo_views(
    storage: &dyn ObjectStore,
    mode: Option<PhotoMode>,
    photos: &[ApprovedPhoto],
) -> Vec<PhotoView> {
    let Some(mode) = mode else {
        return Vec::new();
    };
    let mut views = Vec::with_capacity(photos.len());
    for photo in photos {
        if let Some(view) = photo_view(storage, mode, photo).await {
            views.push(view);
        }
    }
    views
}

/// The values of a card besides the profile row.
pub struct CardInput<'a> {
    pub owner: &'a Member,
    pub disclosure: &'a Disclosure,
    pub activity: Activity,
    pub compat: Option<u8>,
    pub reasons: Vec<ReasonCode>,
    pub relation: CardRelation,
    pub photo: Option<PhotoView>,
    pub photo_count: usize,
    pub now: time::OffsetDateTime,
}

/// Builds a `ProfileCard`, or `None` when the owner lacks a value every non-draft profile has
/// (only possible for a `draft`, which no other member can open).
pub fn card(input: CardInput<'_>, reference: &ReferenceData) -> Option<ProfileCard> {
    let row = &input.owner.row;
    let caste_visible = input.disclosure.visible.contains(LockedGroup::Caste);
    Some(ProfileCard {
        id: row.id,
        public_code: row.public_code.clone(),
        display_name: display_name(input.owner, input.disclosure.tier),
        age: display::age(row.date_of_birth?, input.now),
        gender: row.gender?,
        managed_by: row.managed_by?,
        height_cm: row.height_cm?,
        marital_status: row.marital_status?,
        religion_code: row.religion_code.clone()?,
        sect_code: row.sect_code.clone(),
        caste_label: caste_visible
            .then(|| {
                label(
                    row.caste_code.as_deref(),
                    row.caste_other.as_deref(),
                    reference,
                )
            })
            .flatten(),
        mother_tongue_code: row.mother_tongue_code.clone()?,
        city_name: row.city_name.clone()?,
        region_name: row.region_name.clone(),
        country_code: row.country_code.clone()?,
        education_level_code: row.education_level_code.clone()?,
        employment_type: row.employment_type?,
        profession_code: row.profession_code.clone(),
        photo: input.photo,
        photo_count: i64::try_from(input.photo_count).unwrap_or(i64::MAX),
        badges: display::badges(
            BadgeFacts {
                is_phone_verified: row.is_phone_verified,
                is_photo_verified: row.is_photo_verified,
                is_id_verified: row.is_id_verified,
                first_activated_at: row.first_activated_at,
            },
            input.now,
        ),
        last_active: input.activity.last_active,
        compat: input.compat,
        reasons: input.reasons,
        relation: input.relation,
    })
}

/// The display name at a tier (09 section 4).
pub fn display_name(owner: &Member, tier: Tier) -> String {
    let row = &owner.row;
    display::display_name(
        NameParts {
            first_name: row.first_name.as_deref().unwrap_or_default(),
            last_name: row.last_name.as_deref().unwrap_or_default(),
            public_code: &row.public_code,
        },
        owner.privacy().name_display,
        tier,
    )
}

/// A caste label: the reference name of the code, or the owner's typed value.
fn label(code: Option<&str>, other: Option<&str>, reference: &ReferenceData) -> Option<String> {
    code.and_then(|code| reference.caste(code).map(|caste| caste.name.clone()))
        .or_else(|| other.map(str::to_owned))
}

/// `ProfileCard.relation` for an assessed pair.
pub fn card_relation(assessed: &Assessed) -> CardRelation {
    CardRelation {
        tier: assessed.tier,
        interest_status: assessed.interest.as_ref().map(|_| InterestStatus::Pending),
        interest_direction: assessed.interest.as_ref().map(|(direction, _)| *direction),
        connection_id: assessed.connection_id,
        is_shortlisted: assessed.is_shortlisted,
        can_send_interest: assessed.can_send.is_ok(),
    }
}

/// `ProfileDetail.relation` for an assessed pair.
pub fn relation(assessed: &Assessed) -> Relation {
    let cannot = assessed.can_send.err();
    Relation {
        tier: assessed.tier,
        interest: assessed
            .interest
            .as_ref()
            .map(|(direction, row)| RelationInterest {
                id: row.id,
                direction: *direction,
                status: InterestStatus::Pending,
                message: row.message.clone(),
                created_at: row.created_at,
                expires_at: row.expires_at,
            }),
        connection_id: assessed.connection_id,
        is_shortlisted: assessed.is_shortlisted,
        shortlist_note: assessed.shortlist_note.clone(),
        is_passed: assessed.is_passed,
        photo_access: assessed.photo_access,
        can_send_interest: cannot.is_none(),
        cannot_send_reason: cannot.map(CannotSend::reason),
        cannot_send_detail: cannot.and_then(CannotSend::detail),
        can_send_interest_after: cannot.and_then(CannotSend::send_after),
    }
}

/// The relation of the owner's own preview: the requested tier and no actions (15 section 7).
pub fn neutral_relation(tier: Tier, photo_access: RelationPhotoAccess) -> Relation {
    Relation {
        tier,
        interest: None,
        connection_id: None,
        is_shortlisted: false,
        shortlist_note: None,
        is_passed: false,
        photo_access,
        can_send_interest: false,
        cannot_send_reason: None,
        cannot_send_detail: None,
        can_send_interest_after: None,
    }
}

/// The parts of a `ProfileDetail` besides the profile row.
pub struct DetailInput<'a> {
    pub owner: &'a Member,
    pub card: ProfileCard,
    pub disclosure: &'a Disclosure,
    pub is_online: Option<bool>,
    pub photos: Vec<PhotoView>,
    pub looking_for: LookingFor,
    pub compatibility: Option<Compatibility>,
    pub relation: Relation,
}

/// Builds a `ProfileDetail` (15 section 4.6) under the disclosure (09 section 5.5).
pub fn detail(input: DetailInput<'_>, reference: &ReferenceData) -> ProfileDetail {
    let row = &input.owner.row;
    let card = &input.card;
    let visible = |group: LockedGroup| input.disclosure.visible.contains(group);
    let career = visible(LockedGroup::CareerDetails);
    let health = visible(LockedGroup::Health);
    let family_visible = visible(LockedGroup::Family);
    let caste_visible = visible(LockedGroup::Caste);
    ProfileDetail {
        is_online: input.is_online,
        photos: input.photos,
        basics: DetailBasics {
            marital_status: card.marital_status,
            children_status: row.children_status,
            children_count: row.children_count,
            current_wives_count: row.current_wives_count,
            height_cm: card.height_cm,
            weight_kg: row.weight_kg,
            complexion: row.complexion,
            body_type: row.body_type,
        },
        community: DetailCommunity {
            religion_code: card.religion_code.clone(),
            sect_code: row.sect_code.clone(),
            caste_label: card.caste_label.clone(),
            sub_caste_label: caste_visible
                .then(|| {
                    label(
                        row.sub_caste_code.as_deref(),
                        row.sub_caste_other.as_deref(),
                        reference,
                    )
                })
                .flatten(),
            mother_tongue_code: card.mother_tongue_code.clone(),
            language_codes: row.language_codes.clone(),
        },
        location: DetailLocation {
            country_code: card.country_code.clone(),
            region_name: row.region_name.clone(),
            city_name: card.city_name.clone(),
            area: row.area.clone().filter(|_| visible(LockedGroup::Area)),
            nationality_code: row.nationality_code.clone(),
            residency_status: row.residency_status,
            origin_label: row.origin_label.clone(),
            relocation: row.relocation,
        },
        education_career: DetailEducationCareer {
            education_level_code: card.education_level_code.clone(),
            education_field_code: row.education_field_code.clone(),
            degree_title: row.degree_title.clone().filter(|_| career),
            institute_name: row.institute_name.clone().filter(|_| career),
            employment_type: card.employment_type,
            profession_code: row.profession_code.clone(),
            job_title: row.job_title.clone().filter(|_| career),
            employer_name: row.employer_name.clone().filter(|_| career),
            income_band_code: row
                .income_band_code
                .clone()
                .filter(|_| visible(LockedGroup::Income)),
        },
        family: input
            .disclosure
            .family_object
            .then(|| family(input.owner, family_visible, visible(LockedGroup::Home))),
        lifestyle: DetailLifestyle {
            religiosity: row.religiosity,
            prayer_frequency: row.prayer_frequency,
            hijab: row.hijab,
            beard: row.beard,
            religious_education: row.religious_education,
            smoking: row.smoking,
            living_arrangement: row.living_arrangement,
            work_after_marriage: row.work_after_marriage,
            marriage_timeline: row.marriage_timeline,
            jahez_stance: row.jahez_stance,
            blood_group: row.blood_group.filter(|_| health),
            disability: row.disability.filter(|_| health),
            disability_details: row.disability_details.clone().filter(|_| health),
            hobby_codes: row.hobby_codes.clone(),
        },
        about_me: moderated_text(row.about_me.as_deref(), row.about_me_status).map(str::to_owned),
        about_family: row
            .about_family_status
            .and_then(|status| moderated_text(row.about_family.as_deref(), status))
            .filter(|_| family_visible)
            .map(str::to_owned),
        partner_notes: moderated_text(input.owner.prefs.notes.as_deref(), input.owner.notes_status)
            .filter(|_| input.owner.has_preferences_row)
            .map(str::to_owned),
        looking_for: input.looking_for,
        compatibility: input.compatibility,
        locked: input.disclosure.locked.clone(),
        relation: input.relation,
        card: input.card,
    }
}

/// `ProfileDetail.family`: the family fields when `family` is visible, the home fields when
/// `home` is visible, every other field `null` (09 section 5.5 rule 4).
fn family(owner: &Member, family_visible: bool, home_visible: bool) -> DetailFamily {
    let row = &owner.row;
    let f = family_visible;
    let h = home_visible;
    DetailFamily {
        father_status: row.father_status.filter(|_| f),
        father_occupation: row.father_occupation.clone().filter(|_| f),
        mother_status: row.mother_status.filter(|_| f),
        mother_occupation: row.mother_occupation.clone().filter(|_| f),
        brothers_count: row.brothers_count.filter(|_| f),
        brothers_married: row.brothers_married.filter(|_| f),
        sisters_count: row.sisters_count.filter(|_| f),
        sisters_married: row.sisters_married.filter(|_| f),
        family_type: row.family_type.filter(|_| f),
        family_class: row.family_class.filter(|_| f),
        family_values: row.family_values.filter(|_| f),
        family_country_code: row.family_country_code.clone().filter(|_| f),
        family_city_name: row.family_city_name.clone().filter(|_| f),
        home_ownership: row.home_ownership.filter(|_| h),
        home_type: row.home_type.filter(|_| h),
        home_size_value: row.home_size_value.filter(|_| h),
        home_size_unit: row.home_size_unit.filter(|_| h),
    }
}

/// `LookingFor` for a viewer (10 section 11.1).
pub fn looking_for(
    owner: &Member,
    viewer: &Subject,
    geo: &Geo,
    reference: &ReferenceData,
) -> LookingFor {
    let education_code = owner.prefs.education_min_rank.and_then(|rank| {
        reference
            .education_levels
            .iter()
            .find(|level| level.rank == rank)
            .map(|level| level.code.as_str())
    });
    explain::looking_for(&owner.prefs, viewer, geo, education_code)
}
