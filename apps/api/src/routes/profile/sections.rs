//! `PUT /v1/me/profile/sections/{section}`: validation and normalisation of the eight sections
//! (15 section 7, 07 sections 3 to 9, 08 section 3), and the transaction that saves one.
//!
//! Each `plan_*` function is pure: it takes the stored profile, the reference cache and the
//! geography facts that were loaded for the body, and returns the normalised section or every
//! field error. [`save`] runs them inside one transaction with the profile row locked, so that
//! locked fields and "new value must be active" are judged against the row that gets
//! overwritten.

use std::collections::HashMap;

use axum::http::HeaderMap;
use serde::de::DeserializeOwned;
use serde_json::Value;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::db::profiles::{self, CityFact, ModeratedText, ProfileRow, text_status_after_save};
use crate::domain::options::{
    ChildrenStatus, DocumentType, EmploymentType, Gender, ManagedBy, MaritalStatus,
    PreferredContact,
};
use crate::domain::text_rules::{TextField, suggestion_key};
use crate::domain::time::{age_on, karachi_date};
use crate::domain::types::{ConsentDocument, ProfileStatus, TextStatus};
use crate::error::{ApiError, ApiResult, FieldCode};
use crate::models::profile::{
    AccountForBody, AccountForSection, BasicsSection, CommunitySection, ContactsSection,
    EducationCareerSection, FamilySection, LifestyleSection, LocationSection, Section,
};
use crate::reference::ReferenceData;
use crate::routes::profile::rules::{Checker, dedupe, in_range};
use crate::state::AppState;

/// Youngest and oldest candidate (07 section 4.2 rule 2).
const AGE_MIN: i32 = 18;
const AGE_MAX: i32 = 80;
/// Limits of 07 section 5.3 rule 7 and section 9.4 rule 4.
const LANGUAGES_MAX: usize = 6;
const HOBBIES_MAX: usize = 10;
/// Largest `home_size_value` (`numeric(7, 2)`).
const HOME_SIZE_MAX: f64 = 99_999.99;

/// What a validator needs besides the body.
pub struct Ctx<'a> {
    pub reference: &'a ReferenceData,
    pub current: &'a ProfileRow,
    pub now: OffsetDateTime,
}

impl Ctx<'_> {
    fn draft(&self) -> bool {
        self.current.status == ProfileStatus::Draft
    }

    fn checker(&self) -> Checker {
        Checker::new(self.draft())
    }
}

/// Geography rows that the validators of `location` and `family` read.
#[derive(Debug, Default)]
pub struct GeoFacts {
    pub cities: HashMap<i32, CityFact>,
    pub region_countries: HashMap<i32, String>,
    pub country_has_regions: bool,
}

// ---------------------------------------------------------------------------------------------
// account_for
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub struct AccountForPlan {
    pub section: AccountForSection,
    pub consents: Vec<ConsentDocument>,
}

/// 07 section 3.4. `candidate_consent_recorded` tells whether the user already accepted it.
pub fn plan_account_for(
    ctx: &Ctx<'_>,
    body: &AccountForBody,
    candidate_consent_recorded: bool,
) -> ApiResult<AccountForPlan> {
    let mut c = ctx.checker();
    c.require("managed_by", body.managed_by.is_some());
    let manager_name = if body.managed_by == Some(ManagedBy::Candidate) {
        // For `self` the API stores NULL whatever was sent (rule 2).
        None
    } else {
        let name = c.text(TextField::ManagerName, body.manager_name.as_deref());
        if body.managed_by.is_some() {
            c.require("manager_name", name.is_some());
        }
        name
    };

    // Rule 5: after onboarding, a profile that was `self` and becomes managed by someone else
    // needs the candidate's consent, recorded or sent now.
    let was_self = ctx.current.account_for.managed_by == Some(ManagedBy::Candidate);
    let becomes_managed = body
        .managed_by
        .is_some_and(|managed_by| managed_by != ManagedBy::Candidate);
    if !ctx.draft()
        && was_self
        && becomes_managed
        && !candidate_consent_recorded
        && !body.consents.contains(&ConsentDocument::CandidateConsent)
    {
        c.fail("consents", FieldCode::Required);
    }
    c.finish()?;
    Ok(AccountForPlan {
        section: AccountForSection {
            managed_by: body.managed_by,
            manager_name,
        },
        consents: dedupe(&body.consents),
    })
}

// ---------------------------------------------------------------------------------------------
// basics
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub struct BasicsPlan {
    pub section: BasicsSection,
    pub date_of_birth: Option<Date>,
    pub clear_hijab: bool,
    pub clear_beard: bool,
}

/// A name that becomes locked once the identity is verified (08 section 2.2).
fn name_field(
    c: &mut Checker,
    ctx: &Ctx<'_>,
    field: TextField,
    raw: Option<&str>,
    stored: Option<&str>,
) -> Option<String> {
    let key = field.name();
    if ctx.current.is_locked(key) {
        let sent = raw
            .map(|text| field.tidy(text))
            .filter(|text| !text.is_empty());
        if sent.as_deref() != stored {
            c.fail(key, FieldCode::Locked);
        }
        return stored.map(str::to_owned);
    }
    let value = c.text(field, raw);
    c.require(key, value.is_some());
    value
}

/// 07 section 4.2.
pub fn plan_basics(ctx: &Ctx<'_>, body: &BasicsSection) -> ApiResult<BasicsPlan> {
    let stored = &ctx.current.basics;
    let mut c = ctx.checker();

    let first_name = name_field(
        &mut c,
        ctx,
        TextField::FirstName,
        body.first_name.as_deref(),
        stored.first_name.as_deref(),
    );
    let last_name = name_field(
        &mut c,
        ctx,
        TextField::LastName,
        body.last_name.as_deref(),
        stored.last_name.as_deref(),
    );

    let gender = body.gender;
    if ctx.current.is_locked("gender") && gender != stored.gender {
        c.fail("gender", FieldCode::Locked);
    }
    c.require("gender", gender.is_some());

    let date_of_birth = plan_date_of_birth(&mut c, ctx, body.date_of_birth.as_deref());

    let marital_status = body.marital_status;
    c.require("marital_status", marital_status.is_some());
    if marital_status == Some(MaritalStatus::Married) && gender == Some(Gender::Female) {
        c.fail("marital_status", FieldCode::NotAllowed);
    }

    // Rule 4: the wives count goes with `married`, also while the profile is a draft.
    let current_wives_count = if marital_status == Some(MaritalStatus::Married) {
        match body.current_wives_count {
            None => {
                c.need("current_wives_count", false);
                None
            }
            Some(count) if !in_range(count, 1, 3) => {
                c.fail("current_wives_count", FieldCode::OutOfRange);
                None
            }
            Some(count) => Some(count),
        }
    } else {
        None
    };

    // Rules 5 and 6.
    let (children_status, children_count) = if marital_status == Some(MaritalStatus::NeverMarried) {
        (Some(ChildrenStatus::None), None)
    } else {
        if marital_status.is_some() {
            c.require("children_status", body.children_status.is_some());
        }
        match body.children_status {
            Some(ChildrenStatus::None) | None => (body.children_status, None),
            Some(status) => {
                let count = match body.children_count {
                    None => {
                        c.need("children_count", false);
                        None
                    }
                    Some(count) if !in_range(count, 1, 15) => {
                        c.fail("children_count", FieldCode::OutOfRange);
                        None
                    }
                    Some(count) => Some(count),
                };
                (Some(status), count)
            }
        }
    };

    // Rule 7.
    let height_cm = body.height_cm;
    c.require("height_cm", height_cm.is_some());
    if height_cm.is_some_and(|height| !in_range(height, 122, 213)) {
        c.fail("height_cm", FieldCode::OutOfRange);
    }

    // A CNIC or NICOP number carries the gender in its last digit (12 section 3.3 rule 5). The
    // number was checked against the gender when it was saved, so a changed gender must still
    // agree with it.
    if gender != stored.gender
        && let Some(new_gender) = gender
        && identity_disagrees_with(ctx.current, new_gender)
    {
        c.fail("gender", FieldCode::Mismatch);
    }

    c.finish()?;
    Ok(BasicsPlan {
        section: BasicsSection {
            first_name,
            last_name,
            gender,
            date_of_birth: date_of_birth.map(|date| date.to_string()),
            marital_status,
            children_status,
            children_count,
            current_wives_count,
            height_cm,
        },
        date_of_birth,
        // The columns `profiles_hijab_only_female` and `profiles_beard_only_male` guard.
        clear_hijab: gender == Some(Gender::Male),
        clear_beard: gender == Some(Gender::Female),
    })
}

fn plan_date_of_birth(c: &mut Checker, ctx: &Ctx<'_>, raw: Option<&str>) -> Option<Date> {
    let raw = raw.map(str::trim).filter(|text| !text.is_empty());
    if ctx.current.is_locked("date_of_birth") {
        if raw != ctx.current.basics.date_of_birth.as_deref() {
            c.fail("date_of_birth", FieldCode::Locked);
        }
        return ctx.current.date_of_birth();
    }
    let date = match raw {
        None => None,
        Some(text) => match profiles::parse_date(text) {
            None => {
                c.fail("date_of_birth", FieldCode::Invalid);
                None
            }
            Some(date) => {
                let age = age_on(date, karachi_date(ctx.now));
                if age < AGE_MIN {
                    c.fail("date_of_birth", FieldCode::TooYoung);
                    None
                } else if age > AGE_MAX {
                    c.fail("date_of_birth", FieldCode::OutOfRange);
                    None
                } else {
                    Some(date)
                }
            }
        },
    };
    c.require("date_of_birth", date.is_some());
    date
}

/// True when the registered CNIC or NICOP number cannot belong to `gender`.
fn identity_disagrees_with(current: &ProfileRow, gender: Gender) -> bool {
    let identity = &current.identity;
    if !matches!(
        identity.identity_document_type,
        Some(DocumentType::Cnic | DocumentType::Nicop)
    ) {
        return false;
    }
    let Some(digit) = identity
        .identity_last4
        .as_deref()
        .and_then(|last4| last4.chars().last())
        .and_then(|c| c.to_digit(10))
    else {
        return false;
    };
    let odd = digit % 2 == 1;
    match gender {
        Gender::Male => !odd,
        Gender::Female => odd,
    }
}

// ---------------------------------------------------------------------------------------------
// community
// ---------------------------------------------------------------------------------------------

/// A typed caste or sub-caste to record (05 section 13).
#[derive(Debug, PartialEq, Eq)]
pub struct CasteSuggestion {
    pub parent_code: Option<String>,
    pub name: String,
    pub normalized_name: String,
}

#[derive(Debug)]
pub struct CommunityPlan {
    pub section: CommunitySection,
    pub suggestions: Vec<CasteSuggestion>,
}

/// 07 section 5.3.
#[expect(
    clippy::too_many_lines,
    reason = "one block per rule of 07 section 5.3"
)]
pub fn plan_community(ctx: &Ctx<'_>, body: &CommunitySection) -> ApiResult<CommunityPlan> {
    let stored = &ctx.current.community;
    let reference = ctx.reference;
    let mut c = ctx.checker();

    let religion_code = c.code(
        "religion_code",
        body.religion_code.as_deref(),
        &opt(stored.religion_code.as_ref()),
        |code| reference.religion(code).map(|row| row.is_active),
    );
    c.require("religion_code", religion_code.is_some());

    // Rule 2.
    let sect_code = c.code(
        "sect_code",
        body.sect_code.as_deref(),
        &opt(stored.sect_code.as_ref()),
        |code| reference.sect(code).map(|row| row.is_active),
    );
    if !c.errors.has("religion_code") && !c.errors.has("sect_code") {
        match (&sect_code, &religion_code) {
            (Some(sect), Some(religion)) => {
                if reference
                    .sect(sect)
                    .is_some_and(|row| row.religion_code != *religion)
                {
                    c.fail("sect_code", FieldCode::Mismatch);
                }
            }
            (Some(_), None) => c.fail("sect_code", FieldCode::Mismatch),
            (None, Some(religion)) => {
                if reference.religion_has_sects(religion) {
                    c.require("sect_code", false);
                }
            }
            (None, None) => {}
        }
    }

    // Rules 3 to 6.
    let mut suggestions = Vec::new();
    let mut caste_code = c.code(
        "caste_code",
        body.caste_code.as_deref(),
        &opt(stored.caste_code.as_ref()),
        |code| reference.caste(code).map(|row| row.is_active),
    );
    if caste_code
        .as_deref()
        .and_then(|code| reference.caste(code))
        .is_some_and(|row| row.parent_code.is_some())
    {
        c.fail("caste_code", FieldCode::Mismatch);
    }
    let mut caste_other = c.text(TextField::CasteOther, body.caste_other.as_deref());
    if caste_other.is_some()
        && body
            .caste_code
            .as_deref()
            .is_some_and(|code| !code.is_empty())
    {
        c.fail("caste_other", FieldCode::NotAllowed);
    }
    if caste_code.is_none()
        && let Some(typed) = caste_other.clone()
    {
        let key = suggestion_key(&typed);
        if let Some(existing) = reference.caste_by_normalized_name(None, &key) {
            // 05 section 13: a typed value that names an existing caste becomes that caste.
            caste_code = Some(existing.code.clone());
            caste_other = None;
        } else if stored.caste_other.as_deref().map(suggestion_key).as_deref() != Some(&key) {
            suggestions.push(CasteSuggestion {
                parent_code: None,
                name: typed,
                normalized_name: key,
            });
        }
    }

    let mut sub_caste_code = c.code(
        "sub_caste_code",
        body.sub_caste_code.as_deref(),
        &opt(stored.sub_caste_code.as_ref()),
        |code| reference.caste(code).map(|row| row.is_active),
    );
    let mut sub_caste_other = c.text(TextField::SubCasteOther, body.sub_caste_other.as_deref());
    // A caste that was refused already has its error: do not add one for the sub-caste.
    let has_caste = caste_code.is_some() || caste_other.is_some() || c.errors.has("caste_code");
    if let Some(sub) = sub_caste_code.clone() {
        match (&caste_code, reference.caste(&sub)) {
            (None, _) => {
                if !c.errors.has("caste_code") {
                    c.fail("sub_caste_code", FieldCode::NotAllowed);
                }
            }
            (Some(parent), Some(row)) if row.parent_code.as_deref() != Some(parent.as_str()) => {
                c.fail("sub_caste_code", FieldCode::Mismatch);
            }
            _ => {}
        }
    }
    if sub_caste_other.is_some() {
        // Not together with a listed sub-caste, and not without any caste.
        if body
            .sub_caste_code
            .as_deref()
            .is_some_and(|code| !code.is_empty())
            || !has_caste
        {
            c.fail("sub_caste_other", FieldCode::NotAllowed);
        }
    }
    if sub_caste_code.is_none()
        && let (Some(typed), Some(parent)) = (sub_caste_other.clone(), caste_code.clone())
    {
        let key = suggestion_key(&typed);
        if let Some(existing) = reference.caste_by_normalized_name(Some(&parent), &key) {
            sub_caste_code = Some(existing.code.clone());
            sub_caste_other = None;
        } else if stored
            .sub_caste_other
            .as_deref()
            .map(suggestion_key)
            .as_deref()
            != Some(&key)
        {
            suggestions.push(CasteSuggestion {
                parent_code: Some(parent),
                name: typed,
                normalized_name: key,
            });
        }
    }

    // The mother tongue and the other languages.
    let mother_tongue_code = c.code(
        "mother_tongue_code",
        body.mother_tongue_code.as_deref(),
        &opt(stored.mother_tongue_code.as_ref()),
        |code| reference.language(code).map(|row| row.is_active),
    );
    c.require("mother_tongue_code", mother_tongue_code.is_some());
    let stored_languages: Vec<&str> = stored.language_codes.iter().map(String::as_str).collect();
    let others: Vec<String> = body
        .language_codes
        .iter()
        .filter(|code| Some(code.trim()) != mother_tongue_code.as_deref())
        .cloned()
        .collect();
    let language_codes = c.codes(
        "language_codes",
        &others,
        &stored_languages,
        LANGUAGES_MAX,
        |code| reference.language(code).map(|row| row.is_active),
    );

    c.finish()?;
    Ok(CommunityPlan {
        section: CommunitySection {
            religion_code,
            sect_code,
            caste_code,
            caste_other,
            sub_caste_code,
            sub_caste_other,
            mother_tongue_code,
            language_codes,
        },
        suggestions,
    })
}

/// A stored optional value as a slice of at most one code.
fn opt(value: Option<&String>) -> Vec<&str> {
    value.map(String::as_str).into_iter().collect()
}

// ---------------------------------------------------------------------------------------------
// location
// ---------------------------------------------------------------------------------------------

/// 07 section 6.2.
pub fn plan_location(
    ctx: &Ctx<'_>,
    body: &LocationSection,
    geo: &GeoFacts,
) -> ApiResult<LocationSection> {
    let stored = &ctx.current.location;
    let reference = ctx.reference;
    let mut c = ctx.checker();

    // Rule 1.
    let country_code = c.code(
        "country_code",
        body.country_code.as_deref(),
        &opt(stored.country_code.as_ref()),
        |code| reference.country(code).map(|row| row.is_active),
    );
    c.require("country_code", country_code.is_some());
    let nationality_code = c.code(
        "nationality_code",
        body.nationality_code.as_deref(),
        &opt(stored.nationality_code.as_ref()),
        |code| reference.country(code).map(|row| row.is_active),
    );

    // Rules 2 and 3: a listed city or a typed one.
    let city_other = c.text(TextField::CityOther, body.city_other.as_deref());
    let mut region_id = body.region_id;
    let mut city_id = None;
    if let Some(id) = body.city_id {
        match geo.cities.get(&id) {
            None => c.fail("city_id", FieldCode::UnknownCode),
            Some(city) => {
                if country_code.as_deref() == Some(city.country_code.as_str()) {
                    city_id = Some(id);
                    // The API overwrites `region_id` with the region of the city.
                    region_id = city.region_id;
                } else if !c.errors.has("country_code") {
                    c.fail("city_id", FieldCode::Mismatch);
                }
            }
        }
        if city_other.is_some() {
            c.fail("city_other", FieldCode::NotAllowed);
        }
    } else if city_other.is_none() {
        c.require("city_id", false);
    }
    let city_other = if body.city_id.is_some() {
        None
    } else {
        city_other
    };

    if body.city_id.is_none()
        && let Some(id) = region_id
    {
        match geo.region_countries.get(&id) {
            None => c.fail("region_id", FieldCode::UnknownCode),
            Some(region_country) => {
                if country_code.as_deref() != Some(region_country.as_str()) {
                    c.fail("region_id", FieldCode::Mismatch);
                }
            }
        }
    }
    if body.city_id.is_none() && city_other.is_some() && geo.country_has_regions {
        c.require("region_id", region_id.is_some());
    }

    // Rule 4.
    let residency_status = match (&country_code, &nationality_code) {
        (Some(country), Some(nationality)) if country == nationality => {
            Some(crate::domain::options::ResidencyStatus::Citizen)
        }
        (Some(_), Some(_)) => {
            c.require("residency_status", body.residency_status.is_some());
            body.residency_status
        }
        _ => body.residency_status,
    };

    // Rules 5 and 6.
    let area = c.text(TextField::Area, body.area.as_deref());
    let origin_other = c.text(TextField::OriginOther, body.origin_other.as_deref());
    let mut origin_city_id = None;
    if let Some(id) = body.origin_city_id {
        match geo.cities.get(&id) {
            None => c.fail("origin_city_id", FieldCode::UnknownCode),
            Some(city) if city.country_code != "PK" => {
                c.fail("origin_city_id", FieldCode::Mismatch);
            }
            Some(_) => origin_city_id = Some(id),
        }
        if origin_other.is_some() {
            c.fail("origin_other", FieldCode::NotAllowed);
        }
    }
    let origin_other = if body.origin_city_id.is_some() {
        None
    } else {
        origin_other
    };

    c.finish()?;
    Ok(LocationSection {
        nationality_code,
        country_code,
        region_id,
        city_id,
        city_other,
        area,
        residency_status,
        origin_city_id,
        origin_other,
        relocation: body.relocation,
    })
}

// ---------------------------------------------------------------------------------------------
// education_career
// ---------------------------------------------------------------------------------------------

/// 07 section 7.3.
pub fn plan_education_career(
    ctx: &Ctx<'_>,
    body: &EducationCareerSection,
) -> ApiResult<EducationCareerSection> {
    let stored = &ctx.current.education_career;
    let reference = ctx.reference;
    let mut c = ctx.checker();

    let education_level_code = c.code(
        "education_level_code",
        body.education_level_code.as_deref(),
        &opt(stored.education_level_code.as_ref()),
        |code| reference.education_level(code).map(|row| row.is_active),
    );
    c.require("education_level_code", education_level_code.is_some());
    let education_field_code = c.code(
        "education_field_code",
        body.education_field_code.as_deref(),
        &opt(stored.education_field_code.as_ref()),
        |code| reference.education_field(code).map(|row| row.is_active),
    );
    let degree_title = c.text(TextField::DegreeTitle, body.degree_title.as_deref());
    let institute_name = c.text(TextField::InstituteName, body.institute_name.as_deref());
    let employment_type = body.employment_type;
    c.require("employment_type", employment_type.is_some());

    // Rule 2: no work details for these employment types, whatever was sent.
    let no_work = matches!(
        employment_type,
        Some(EmploymentType::Student | EmploymentType::Homemaker | EmploymentType::NotWorking)
    );
    let (profession_code, job_title, employer_name, income_band_code) = if no_work {
        (None, None, None, None)
    } else {
        (
            c.code(
                "profession_code",
                body.profession_code.as_deref(),
                &opt(stored.profession_code.as_ref()),
                |code| reference.profession(code).map(|row| row.is_active),
            ),
            c.text(TextField::JobTitle, body.job_title.as_deref()),
            c.text(TextField::EmployerName, body.employer_name.as_deref()),
            c.code(
                "income_band_code",
                body.income_band_code.as_deref(),
                &opt(stored.income_band_code.as_ref()),
                |code| reference.income_band(code).map(|row| row.is_active),
            ),
        )
    };

    c.finish()?;
    Ok(EducationCareerSection {
        education_level_code,
        education_field_code,
        degree_title,
        institute_name,
        employment_type,
        profession_code,
        job_title,
        employer_name,
        income_band_code,
    })
}

// ---------------------------------------------------------------------------------------------
// family
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub struct FamilyPlan {
    pub section: FamilySection,
    pub about_family_status: TextStatus,
}

/// Counts of siblings and the married ones among them (07 section 8.2 rule 1).
fn plan_siblings(c: &mut Checker, kind: &str, total: Option<i16>, married: Option<i16>) {
    let total_field = format!("{kind}_count");
    let married_field = format!("{kind}_married");
    if total.is_some_and(|count| !in_range(count, 0, 15)) {
        c.fail(&total_field, FieldCode::OutOfRange);
    }
    if let Some(married_count) = married {
        if !in_range(married_count, 0, 15) {
            c.fail(&married_field, FieldCode::OutOfRange);
        }
        match total {
            None => c.need(&total_field, false),
            Some(count) if married_count > count => {
                c.fail(&married_field, FieldCode::OutOfRange);
            }
            Some(_) => {}
        }
    }
}

/// Whether a size has at most two decimal places.
fn has_two_decimals(value: f64) -> bool {
    let scaled = value * 100.0;
    (scaled - scaled.round()).abs() < 1e-6
}

/// 07 section 8.2.
pub fn plan_family(ctx: &Ctx<'_>, body: &FamilySection, geo: &GeoFacts) -> ApiResult<FamilyPlan> {
    let stored = &ctx.current.family;
    let reference = ctx.reference;
    let mut c = ctx.checker();

    let father_occupation = c.text(
        TextField::FatherOccupation,
        body.father_occupation.as_deref(),
    );
    let mother_occupation = c.text(
        TextField::MotherOccupation,
        body.mother_occupation.as_deref(),
    );
    plan_siblings(
        &mut c,
        "brothers",
        body.brothers_count,
        body.brothers_married,
    );
    plan_siblings(&mut c, "sisters", body.sisters_count, body.sisters_married);

    // Rule 2: size and unit go together.
    match (body.home_size_value, body.home_size_unit) {
        (Some(value), unit) => {
            if !value.is_finite() || value <= 0.0 || value > HOME_SIZE_MAX {
                c.fail("home_size_value", FieldCode::OutOfRange);
            } else if !has_two_decimals(value) {
                c.fail("home_size_value", FieldCode::Invalid);
            }
            c.need("home_size_unit", unit.is_some());
        }
        (None, Some(_)) => c.need("home_size_value", false),
        (None, None) => {}
    }

    // Rule 3.
    let family_country_code = c.code(
        "family_country_code",
        body.family_country_code.as_deref(),
        &opt(stored.family_country_code.as_ref()),
        |code| reference.country(code).map(|row| row.is_active),
    );
    let mut family_city_id = None;
    if let Some(id) = body.family_city_id {
        match (&family_country_code, geo.cities.get(&id)) {
            (None, _) => c.need("family_country_code", false),
            (Some(_), None) => c.fail("family_city_id", FieldCode::UnknownCode),
            (Some(country), Some(city)) if city.country_code != *country => {
                c.fail("family_city_id", FieldCode::Mismatch);
            }
            (Some(_), Some(_)) => family_city_id = Some(id),
        }
    }

    // Rule 4.
    let about_family = c.text(TextField::AboutFamily, body.about_family.as_deref());
    let about_family_status = text_status_after_save(
        stored.about_family.as_deref(),
        ctx.current.about_family_status,
        about_family.as_deref(),
    );

    c.finish()?;
    Ok(FamilyPlan {
        section: FamilySection {
            father_status: body.father_status,
            father_occupation,
            mother_status: body.mother_status,
            mother_occupation,
            brothers_count: body.brothers_count,
            brothers_married: body.brothers_married,
            sisters_count: body.sisters_count,
            sisters_married: body.sisters_married,
            family_type: body.family_type,
            family_class: body.family_class,
            family_values: body.family_values,
            family_country_code,
            family_city_id,
            home_ownership: body.home_ownership,
            home_type: body.home_type,
            home_size_value: body.home_size_value,
            home_size_unit: body.home_size_unit,
            about_family,
        },
        about_family_status,
    })
}

// ---------------------------------------------------------------------------------------------
// lifestyle
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub struct LifestylePlan {
    pub section: LifestyleSection,
    pub about_me_status: TextStatus,
}

/// 07 section 9.4.
pub fn plan_lifestyle(ctx: &Ctx<'_>, body: &LifestyleSection) -> ApiResult<LifestylePlan> {
    let stored = &ctx.current.lifestyle;
    let reference = ctx.reference;
    let mut c = ctx.checker();
    let gender = ctx.current.basics.gender;

    // Rule 1.
    if body.hijab.is_some() && gender != Some(Gender::Female) {
        c.fail("hijab", FieldCode::NotAllowed);
    }
    if body.beard.is_some() && gender != Some(Gender::Male) {
        c.fail("beard", FieldCode::NotAllowed);
    }
    // Rule 2.
    if body
        .weight_kg
        .is_some_and(|weight| !in_range(weight, 30, 200))
    {
        c.fail("weight_kg", FieldCode::OutOfRange);
    }
    // Rule 3.
    let has_disability = body
        .disability
        .is_some_and(|disability| disability != crate::domain::options::Disability::None);
    let disability_details = if has_disability {
        c.text(
            TextField::DisabilityDetails,
            body.disability_details.as_deref(),
        )
    } else {
        None
    };
    // Rule 4.
    let stored_hobbies: Vec<&str> = stored.hobby_codes.iter().map(String::as_str).collect();
    let hobby_codes = c.codes(
        "hobby_codes",
        &body.hobby_codes,
        &stored_hobbies,
        HOBBIES_MAX,
        |code| reference.hobby(code).map(|row| row.is_active),
    );
    // Rule 5.
    let about_me = c.text(TextField::AboutMe, body.about_me.as_deref());
    let about_me_status = text_status_after_save(
        stored.about_me.as_deref(),
        ctx.current.about_me_status,
        about_me.as_deref(),
    );

    c.finish()?;
    Ok(LifestylePlan {
        section: LifestyleSection {
            disability_details,
            hobby_codes,
            about_me,
            ..*body
        },
        about_me_status,
    })
}

// ---------------------------------------------------------------------------------------------
// contacts
// ---------------------------------------------------------------------------------------------

/// E.164 with the extra rule for `+92` (08 section 3.3 rules 4 and 5).
pub fn is_valid_phone(value: &str) -> bool {
    let digits = value.strip_prefix('+').unwrap_or("");
    let shape_ok = value.starts_with('+')
        && (8..=15).contains(&digits.len())
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && !digits.starts_with('0');
    if !shape_ok {
        return false;
    }
    match digits.strip_prefix("92") {
        Some(national) => national.len() == 10 && national.starts_with('3'),
        None => true,
    }
}

/// One `@`, something before it, a dot inside the domain, no spaces (08 section 3.2).
pub fn is_valid_email(value: &str) -> bool {
    if value.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

/// A phone number, or `None` for an empty value (08 section 3.3 rule 7).
fn phone_field(c: &mut Checker, field: &str, raw: Option<&str>) -> Option<String> {
    let value = raw.map(str::trim).filter(|text| !text.is_empty())?;
    if is_valid_phone(value) {
        Some(value.to_owned())
    } else {
        c.fail(field, FieldCode::Invalid);
        None
    }
}

/// 08 sections 3.2 to 3.4.
pub fn plan_contacts(ctx: &Ctx<'_>, body: &ContactsSection) -> ApiResult<ContactsSection> {
    let mut c = ctx.checker();

    let phone_e164 = phone_field(&mut c, "phone_e164", body.phone_e164.as_deref());
    let whatsapp_e164 = phone_field(&mut c, "whatsapp_e164", body.whatsapp_e164.as_deref());
    let guardian_phone_e164 = phone_field(
        &mut c,
        "guardian_phone_e164",
        body.guardian_phone_e164.as_deref(),
    );

    let contact_email = body
        .contact_email
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned);
    if let Some(email) = &contact_email {
        if email.chars().count() > 254 {
            c.fail("contact_email", FieldCode::TooLong);
        } else if !is_valid_email(email) {
            c.fail("contact_email", FieldCode::Invalid);
        }
    }

    let guardian_name = c.text(TextField::GuardianName, body.guardian_name.as_deref());
    let best_time_to_call = c.text(TextField::BestTimeToCall, body.best_time_to_call.as_deref());

    // 3.4: the three guardian fields go together, and `guardian` as the preferred contact
    // needs all of them.
    let guardian_given = body
        .guardian_name
        .as_deref()
        .is_some_and(|name| !name.trim().is_empty())
        || body.guardian_relation.is_some()
        || body
            .guardian_phone_e164
            .as_deref()
            .is_some_and(|phone| !phone.trim().is_empty());
    if guardian_given || body.preferred_contact == PreferredContact::Guardian {
        c.need("guardian_name", guardian_name.is_some());
        c.need("guardian_relation", body.guardian_relation.is_some());
        c.need("guardian_phone_e164", guardian_phone_e164.is_some());
    }

    c.finish()?;
    Ok(ContactsSection {
        phone_e164,
        whatsapp_e164,
        contact_email,
        guardian_name,
        guardian_relation: body.guardian_relation,
        guardian_phone_e164,
        preferred_contact: body.preferred_contact,
        best_time_to_call,
    })
}

// ---------------------------------------------------------------------------------------------
// The transaction
// ---------------------------------------------------------------------------------------------

/// What the caller does after the commit.
#[derive(Debug, Default, Clone, Copy)]
pub struct Saved {
    /// The account snapshot changed (gender, consents): drop the cached copy.
    pub invalidate_account: bool,
    /// A job was enqueued: wake the workers.
    pub wake_jobs: bool,
}

fn parse_body<T: DeserializeOwned>(body: Value) -> ApiResult<T> {
    serde_json::from_value(body).map_err(|error| ApiError::BadRequest(error.to_string()))
}

/// Validates and saves one section of the caller's profile (15 section 7).
///
/// In one transaction with the profile row locked: validate, write the section, apply the side
/// effects (consents, caste suggestions, moderation jobs, the privacy default for women), and
/// recompute the completeness.
#[expect(clippy::too_many_lines, reason = "one arm per section")]
pub async fn save(
    state: &AppState,
    user_id: Uuid,
    profile_id: Uuid,
    section: Section,
    body: Value,
    headers: &HeaderMap,
) -> ApiResult<Saved> {
    let reference = state.reference.get();
    let now = OffsetDateTime::now_utc();
    let mut tx = state.db.begin().await?;
    let current = profiles::load_profile(&mut tx, profile_id, true).await?;
    let ctx = Ctx {
        reference: &reference,
        current: &current,
        now,
    };
    let mut saved = Saved::default();

    match section {
        Section::AccountFor => {
            let body: AccountForBody = parse_body(body)?;
            let recorded = profiles::onboarding::has_consent(
                &mut tx,
                user_id,
                ConsentDocument::CandidateConsent,
            )
            .await?;
            let plan = plan_account_for(&ctx, &body, recorded)?;
            profiles::write_account_for(&mut tx, profile_id, &plan.section).await?;
            if !plan.consents.is_empty() {
                let settings = state.settings.get().await?;
                crate::routes::me::record_consents(
                    &mut tx,
                    user_id,
                    &plan.consents,
                    &settings,
                    headers,
                )
                .await?;
            }
            // `managed_by` shows on the profile, `manager_name` is only for support: neither
            // feeds matching, but the consents change the account snapshot.
            saved.invalidate_account = true;
        }
        Section::Basics => {
            let body: BasicsSection = parse_body(body)?;
            let plan = plan_basics(&ctx, &body)?;
            profiles::write_basics(
                &mut tx,
                profile_id,
                &plan.section,
                plan.date_of_birth,
                plan.clear_hijab,
                plan.clear_beard,
            )
            .await?;
            if let Some(gender) = plan.section.gender {
                profiles::apply_female_photo_default(&mut tx, profile_id, current.status, gender)
                    .await?;
            }
            saved.invalidate_account = plan.section.gender != current.basics.gender;
        }
        Section::Community => {
            let body: CommunitySection = parse_body(body)?;
            let plan = plan_community(&ctx, &body)?;
            profiles::write_community(&mut tx, profile_id, &plan.section).await?;
            for suggestion in &plan.suggestions {
                profiles::record_caste_suggestion(
                    &mut tx,
                    suggestion.parent_code.as_deref(),
                    &suggestion.name,
                    &suggestion.normalized_name,
                )
                .await?;
            }
        }
        Section::Location => {
            let body: LocationSection = parse_body(body)?;
            let city_ids: Vec<i32> = [body.city_id, body.origin_city_id]
                .into_iter()
                .flatten()
                .collect();
            let region_ids: Vec<i32> = body.region_id.into_iter().collect();
            let geo = GeoFacts {
                cities: profiles::city_facts(&mut tx, &city_ids).await?,
                region_countries: profiles::region_countries(&mut tx, &region_ids).await?,
                country_has_regions: match body.country_code.as_deref() {
                    Some(country) => profiles::country_has_regions(&mut tx, country).await?,
                    None => false,
                },
            };
            let plan = plan_location(&ctx, &body, &geo)?;
            profiles::write_location(&mut tx, profile_id, &plan).await?;
        }
        Section::EducationCareer => {
            let body: EducationCareerSection = parse_body(body)?;
            let plan = plan_education_career(&ctx, &body)?;
            profiles::write_education_career(&mut tx, profile_id, &plan).await?;
        }
        Section::Family => {
            let body: FamilySection = parse_body(body)?;
            let city_ids: Vec<i32> = body.family_city_id.into_iter().collect();
            let geo = GeoFacts {
                cities: profiles::city_facts(&mut tx, &city_ids).await?,
                ..GeoFacts::default()
            };
            let plan = plan_family(&ctx, &body, &geo)?;
            profiles::write_family(&mut tx, profile_id, &plan.section, plan.about_family_status)
                .await?;
            if plan.about_family_status == TextStatus::Pending
                && plan.section.about_family != current.family.about_family
            {
                profiles::enqueue_text_moderation(&mut tx, profile_id, ModeratedText::AboutFamily)
                    .await?;
                saved.wake_jobs = true;
            }
        }
        Section::Lifestyle => {
            let body: LifestyleSection = parse_body(body)?;
            let plan = plan_lifestyle(&ctx, &body)?;
            profiles::write_lifestyle(&mut tx, profile_id, &plan.section, plan.about_me_status)
                .await?;
            if plan.about_me_status == TextStatus::Pending
                && plan.section.about_me != current.lifestyle.about_me
            {
                profiles::enqueue_text_moderation(&mut tx, profile_id, ModeratedText::AboutMe)
                    .await?;
                saved.wake_jobs = true;
            }
        }
        Section::Contacts => {
            let body: ContactsSection = parse_body(body)?;
            let plan = plan_contacts(&ctx, &body)?;
            profiles::write_contacts(&mut tx, profile_id, &plan).await?;
        }
    }

    profiles::recompute_completeness(&mut tx, profile_id).await?;
    tx.commit().await?;
    Ok(saved)
}
