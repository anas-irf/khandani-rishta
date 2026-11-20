//! One loaded profile with its preferences and matchable view, and the facts that the viewer
//! side of every check needs.

use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::matching::subject::{Subject, SubjectRows};
use crate::domain::options::{Gender, MaritalStatus};
use crate::domain::preference_defaults::{DefaultsInput, default_preferences};
use crate::domain::preferences::Preferences;
use crate::domain::privacy::Privacy;
use crate::domain::time::{age_on, karachi_date};
use crate::domain::types::{LockedGroup, ProfileStatus, TextStatus};
use crate::domain::visibility::{
    self, GroupSet, InterestUsage, OwnerContent, OwnerFacts, ViewerFacts,
};
use crate::reference::ReferenceData;
use crate::views::load::{PreferencesRow, ProfileRow};

/// A profile as the views use it: the row, the preferences (stored, or the defaults of 07
/// section 12 when there is no row) and the matchable view of 10 section 3.2.
#[derive(Debug, Clone)]
pub struct Member {
    pub row: ProfileRow,
    pub prefs: Preferences,
    /// A `partner_preferences` row exists.
    pub has_preferences_row: bool,
    /// Moderation state of the preference notes; `approved` when there is no row.
    pub notes_status: TextStatus,
    /// `None` only for a `draft` profile that still lacks a value every other profile has.
    pub subject: Option<Subject>,
}

impl Member {
    /// Builds the member from its rows. `today` is the current date in `Asia/Karachi`.
    pub fn new(
        row: ProfileRow,
        prefs: Option<PreferencesRow>,
        reference: &ReferenceData,
        today: Date,
    ) -> Self {
        let subject = subject_rows(&row, reference).map(|rows| Subject::from_rows(rows, today));
        let (prefs, has_preferences_row, notes_status) = match prefs {
            Some(stored) => (stored.prefs, true, stored.notes_status),
            None => (
                default_preferences(&DefaultsInput {
                    gender: row.gender,
                    age: row.date_of_birth.map(|dob| age_on(dob, today)),
                    marital_status: row.marital_status,
                    religion_code: row.religion_code.as_deref(),
                    country_code: row.country_code.as_deref(),
                }),
                false,
                TextStatus::Approved,
            ),
        };
        Self {
            row,
            prefs,
            has_preferences_row,
            notes_status,
            subject,
        }
    }

    pub fn id(&self) -> Uuid {
        self.row.id
    }

    pub fn status(&self) -> ProfileStatus {
        self.row.status
    }

    pub fn privacy(&self) -> &Privacy {
        &self.row.privacy
    }

    /// The member's `marital_statuses` contains `married`. A missing preferences row counts as
    /// an empty array (09 section 2.4).
    pub fn accepts_married(&self) -> bool {
        visibility::accepts_married(self.has_preferences_row.then_some(&self.prefs))
    }

    /// The member as the viewer of 09 section 2.
    pub fn viewer_facts(&self) -> ViewerFacts {
        ViewerFacts {
            id: self.row.id,
            gender: self.row.gender,
            status: self.row.status,
            marital_status: self.row.marital_status,
            accepts_married: self.accepts_married(),
        }
    }

    /// The member as the owner of 09 section 2.
    pub fn owner_facts(&self) -> OwnerFacts {
        OwnerFacts {
            id: self.row.id,
            gender: self.row.gender,
            status: self.row.status,
            user_status: self.row.user_status,
            marital_status: self.row.marital_status,
            accepts_married: self.accepts_married(),
            discovery_visibility: self.row.privacy.discovery_visibility,
        }
    }

    /// The facts of 09 section 5.5 about the owner's content. `has_approved_photo` comes from
    /// the photos actually loaded when the caller has them.
    pub fn content(&self, has_approved_photo: bool) -> OwnerContent {
        let row = &self.row;
        let any = |values: &[bool]| values.iter().any(|present| *present);
        let about_family_shown =
            row.about_family.is_some() && row.about_family_status == Some(TextStatus::Approved);
        let filled = GroupSet::EMPTY
            .with_if(
                LockedGroup::Caste,
                any(&[
                    row.caste_code.is_some(),
                    row.caste_other.is_some(),
                    row.sub_caste_code.is_some(),
                    row.sub_caste_other.is_some(),
                ]),
            )
            .with_if(LockedGroup::Income, row.income_band_code.is_some())
            .with_if(
                LockedGroup::Family,
                any(&[
                    row.father_status.is_some(),
                    row.father_occupation.is_some(),
                    row.mother_status.is_some(),
                    row.mother_occupation.is_some(),
                    row.brothers_count.is_some(),
                    row.brothers_married.is_some(),
                    row.sisters_count.is_some(),
                    row.sisters_married.is_some(),
                    row.family_type.is_some(),
                    row.family_class.is_some(),
                    row.family_values.is_some(),
                    row.family_country_code.is_some(),
                    row.family_city_id.is_some(),
                    about_family_shown,
                ]),
            )
            .with_if(
                LockedGroup::CareerDetails,
                any(&[
                    row.degree_title.is_some(),
                    row.institute_name.is_some(),
                    row.job_title.is_some(),
                    row.employer_name.is_some(),
                ]),
            )
            .with_if(
                LockedGroup::Home,
                any(&[
                    row.home_ownership.is_some(),
                    row.home_type.is_some(),
                    row.home_size_value.is_some(),
                    row.home_size_unit.is_some(),
                ]),
            )
            .with_if(LockedGroup::Area, row.area.is_some())
            .with_if(
                LockedGroup::Health,
                any(&[
                    row.disability.is_some(),
                    row.disability_details.is_some(),
                    row.blood_group.is_some(),
                ]),
            );
        OwnerContent {
            filled,
            has_family_row: row.has_family_row,
            has_approved_photo,
        }
    }
}

/// The viewer of a request: their profile and their current interest counts.
#[derive(Debug, Clone)]
pub struct Viewer {
    pub member: Member,
    pub usage: InterestUsage,
    /// When the viewer was loaded; every value of one response uses this instant.
    pub now: OffsetDateTime,
}

impl Viewer {
    pub fn id(&self) -> Uuid {
        self.member.id()
    }

    pub fn user_id(&self) -> Uuid {
        self.member.row.user_id
    }

    pub fn status(&self) -> ProfileStatus {
        self.member.status()
    }

    pub fn gender(&self) -> Option<Gender> {
        self.member.row.gender
    }

    pub fn privacy(&self) -> &Privacy {
        self.member.privacy()
    }

    pub fn prefs(&self) -> &Preferences {
        &self.member.prefs
    }

    pub fn subject(&self) -> Option<&Subject> {
        self.member.subject.as_ref()
    }

    pub fn row(&self) -> &ProfileRow {
        &self.member.row
    }

    /// Today in `Asia/Karachi`.
    pub fn today(&self) -> Date {
        karachi_date(self.now)
    }
}

/// The matchable inputs of a profile (10 section 3.2), or `None` when a value that every
/// non-draft profile has is still missing. Ranks come from the reference cache.
pub fn subject_rows(row: &ProfileRow, reference: &ReferenceData) -> Option<SubjectRows> {
    Some(SubjectRows {
        id: row.id,
        gender: row.gender?,
        date_of_birth: row.date_of_birth?,
        height_cm: row.height_cm?,
        marital_status: row.marital_status?,
        children_status: row.children_status,
        religion_code: row.religion_code.clone()?,
        sect_code: row.sect_code.clone(),
        caste_code: row.caste_code.clone(),
        caste_visibility: row.privacy.caste_visibility,
        mother_tongue_code: row.mother_tongue_code.clone()?,
        language_codes: row.language_codes.clone(),
        country_code: row.country_code.clone()?,
        region_id: row.region_id,
        city_id: row.city_id,
        origin_city_id: row.origin_city_id,
        relocation: row.relocation,
        education_rank: row
            .education_level_code
            .as_deref()
            .and_then(|code| reference.education_level(code))
            .map(|level| level.rank),
        employment_type: row.employment_type?,
        profession_code: row.profession_code.clone(),
        income_rank: row
            .income_band_code
            .as_deref()
            .and_then(|code| reference.income_band(code))
            .map(|band| band.rank),
        income_visibility: row.privacy.income_visibility,
        religiosity: row.religiosity,
        prayer_frequency: row.prayer_frequency,
        hijab: row.hijab,
        beard: row.beard,
        smoking: row.smoking,
        living_arrangement: row.living_arrangement,
        work_after_marriage: row.work_after_marriage,
        marriage_timeline: row.marriage_timeline,
        family_values: row.family_values,
        family_type: row.family_type,
        family_visibility: row.privacy.family_visibility,
        hobby_codes: row.hobby_codes.clone(),
        completeness: row.completeness,
        has_approved_photo: row.has_approved_photo,
        is_phone_verified: row.is_phone_verified,
        is_photo_verified: row.is_photo_verified,
        is_id_verified: row.is_id_verified,
        last_active_at: row.last_active_at,
        first_activated_at: row.first_activated_at,
        show_last_active: row.privacy.show_last_active,
    })
}

/// A stand-in viewer of the opposite gender for the owner's own preview: `LookingFor` lines
/// depend on the viewer only through the gender (the appearance line), and every verdict is
/// cleared afterwards (15 section 7).
pub fn stand_in_viewer(owner: &Subject, today: Date) -> Subject {
    let gender = match owner.gender {
        Gender::Male => Gender::Female,
        Gender::Female => Gender::Male,
    };
    let date_of_birth =
        Date::from_calendar_date(today.year() - owner.age, today.month(), 1).unwrap_or(today);
    Subject::from_rows(
        SubjectRows {
            id: Uuid::nil(),
            gender,
            date_of_birth,
            height_cm: owner.height_cm,
            marital_status: MaritalStatus::NeverMarried,
            children_status: None,
            religion_code: owner.religion_code.clone(),
            sect_code: None,
            caste_code: None,
            caste_visibility: crate::domain::options::FieldVisibility::Nobody,
            mother_tongue_code: owner.mother_tongue_code.clone(),
            language_codes: Vec::new(),
            country_code: owner.country_code.clone(),
            region_id: None,
            city_id: None,
            origin_city_id: None,
            relocation: None,
            education_rank: None,
            employment_type: owner.employment_type,
            profession_code: None,
            income_rank: None,
            income_visibility: crate::domain::options::FieldVisibility::Nobody,
            religiosity: None,
            prayer_frequency: None,
            hijab: None,
            beard: None,
            smoking: None,
            living_arrangement: None,
            work_after_marriage: None,
            marriage_timeline: None,
            family_values: None,
            family_type: None,
            family_visibility: crate::domain::options::FieldVisibility::Nobody,
            hobby_codes: Vec::new(),
            completeness: 0,
            has_approved_photo: false,
            is_phone_verified: false,
            is_photo_verified: false,
            is_id_verified: false,
            last_active_at: None,
            first_activated_at: None,
            show_last_active: false,
        },
        today,
    )
}
