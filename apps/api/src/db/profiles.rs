//! SQL for the member's own profile: loading the whole row, writing each section, the privacy
//! default of 09 section 3.5, and the completeness recomputation of 08 section 6.3.

pub mod identity;
pub mod onboarding;
pub mod preferences;

use std::collections::HashMap;

use serde_json::json;
use sqlx::{PgConnection, PgPool};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::completeness::{self, Completeness, CompletenessInput, FamilyColumns};
use crate::domain::options::{DocumentType, Gender, PhotoVisibility};
use crate::domain::types::{IdentityStatus, OnboardingStep, ProfileStatus, TextStatus};
use crate::jobs::{NewJob, enqueue};
use crate::models::photos::{OwnPhoto, PHOTO_COLUMNS, PhotoRow, own_photo};
use crate::models::profile::{
    AccountForSection, BasicsSection, CommunitySection, ContactsSection, EducationCareerSection,
    FamilySection, IdentitySummary, LifestyleSection, LocationSection, OwnLocation, OwnProfile,
    OwnVerification, PendingVerification, TextStatuses,
};
use crate::models::reference::{CityRef, cities_by_ids};
use crate::services::r2::ObjectStore;

/// The identity columns as a `LEFT JOIN` returns them.
#[derive(Debug, Clone, sqlx::FromRow)]
#[expect(
    clippy::struct_field_names,
    reason = "the names are the column aliases of the join in PROFILE_SQL"
)]
pub struct IdentityColumns {
    pub identity_document_type: Option<DocumentType>,
    pub identity_last4: Option<String>,
    pub identity_status: Option<IdentityStatus>,
    pub identity_verified_at: Option<OffsetDateTime>,
}

impl IdentityColumns {
    /// The summary of `OwnProfile.identity`, or `None` when no number was registered.
    pub fn summary(&self) -> Option<IdentitySummary> {
        Some(IdentitySummary {
            document_type: self.identity_document_type?,
            number_masked: crate::domain::identity_number::mask(self.identity_last4.as_deref()?),
            status: self.identity_status?,
            verified_at: self.identity_verified_at,
        })
    }
}

/// Everything about a profile that the own-profile endpoints read, in one query.
#[derive(Debug, Clone, sqlx::FromRow)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the verification flags and row-exists flags of one query"
)]
pub struct ProfileRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub public_code: String,
    pub status: ProfileStatus,
    pub status_reason: Option<String>,
    pub onboarding_step: OnboardingStep,
    pub onboarding_completed_at: Option<OffsetDateTime>,
    pub first_activated_at: Option<OffsetDateTime>,
    pub is_phone_verified: bool,
    pub is_photo_verified: bool,
    pub is_id_verified: bool,
    pub completeness: i16,
    pub about_me_status: TextStatus,
    pub about_family_status: TextStatus,
    pub notes_status: TextStatus,
    /// The profile has a `profile_family` row.
    pub has_family_row: bool,
    /// The profile has a `partner_preferences` row.
    pub has_preferences: bool,
    pub approved_photos: i64,
    #[sqlx(flatten)]
    pub account_for: AccountForSection,
    #[sqlx(flatten)]
    pub basics: BasicsSection,
    #[sqlx(flatten)]
    pub community: CommunitySection,
    #[sqlx(flatten)]
    pub location: LocationSection,
    #[sqlx(flatten)]
    pub education_career: EducationCareerSection,
    #[sqlx(flatten)]
    pub family: FamilySection,
    #[sqlx(flatten)]
    pub lifestyle: LifestyleSection,
    #[sqlx(flatten)]
    pub contacts: ContactsSection,
    #[sqlx(flatten)]
    pub identity: IdentityColumns,
}

/// The `SELECT` of [`ProfileRow`]. Fixed text, so it can be extended with fixed suffixes only.
const PROFILE_SQL: &str = "SELECT
    p.id, p.user_id, p.public_code, p.status, p.status_reason, p.onboarding_step,
    p.onboarding_completed_at, p.first_activated_at,
    p.is_phone_verified, p.is_photo_verified, p.is_id_verified, p.completeness,
    p.about_me_status,
    COALESCE(f.about_family_status, 'approved') AS about_family_status,
    COALESCE(pp.notes_status, 'approved') AS notes_status,
    (f.profile_id IS NOT NULL) AS has_family_row,
    (pp.profile_id IS NOT NULL) AS has_preferences,
    (SELECT count(*) FROM profile_photos ph
      WHERE ph.profile_id = p.id AND ph.status = 'approved') AS approved_photos,
    p.managed_by, p.manager_name,
    p.first_name, p.last_name, p.gender, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
    p.marital_status, p.children_status, p.children_count, p.current_wives_count, p.height_cm,
    p.religion_code, p.sect_code, p.caste_code, p.caste_other, p.sub_caste_code, p.sub_caste_other,
    p.mother_tongue_code,
    ARRAY(SELECT l.language_code FROM profile_languages l
           WHERE l.profile_id = p.id ORDER BY l.language_code) AS language_codes,
    p.nationality_code, p.country_code, p.region_id, p.city_id, p.city_other, p.area,
    p.residency_status, p.origin_city_id, p.origin_other, p.relocation,
    p.education_level_code, p.education_field_code, p.degree_title, p.institute_name,
    p.employment_type, p.profession_code, p.job_title, p.employer_name, p.income_band_code,
    f.father_status, f.father_occupation, f.mother_status, f.mother_occupation,
    f.brothers_count, f.brothers_married, f.sisters_count, f.sisters_married,
    f.family_type, f.family_class, f.family_values, f.family_country_code, f.family_city_id,
    f.home_ownership, f.home_type, f.home_size_value::float8 AS home_size_value, f.home_size_unit,
    f.about_family,
    p.religiosity, p.prayer_frequency, p.hijab, p.beard, p.religious_education, p.smoking,
    p.living_arrangement, p.work_after_marriage, p.marriage_timeline, p.jahez_stance,
    p.weight_kg, p.complexion, p.body_type, p.blood_group, p.disability, p.disability_details,
    ARRAY(SELECT h.hobby_code FROM profile_hobbies h
           WHERE h.profile_id = p.id ORDER BY h.hobby_code) AS hobby_codes,
    p.about_me,
    c.phone_e164, c.whatsapp_e164, c.contact_email, c.guardian_name, c.guardian_relation,
    c.guardian_phone_e164, COALESCE(c.preferred_contact, 'self') AS preferred_contact,
    c.best_time_to_call,
    i.document_type AS identity_document_type, i.number_last4 AS identity_last4,
    i.status AS identity_status, i.verified_at AS identity_verified_at
  FROM profiles p
  LEFT JOIN profile_family f ON f.profile_id = p.id
  LEFT JOIN profile_contacts c ON c.profile_id = p.id
  LEFT JOIN partner_preferences pp ON pp.profile_id = p.id
  LEFT JOIN profile_identity i ON i.profile_id = p.id
  WHERE p.id = $1";

/// Reads a profile. `lock` takes a row lock on `profiles` until the transaction ends, which
/// serialises concurrent writes of one profile.
pub async fn load_profile(
    conn: &mut PgConnection,
    profile_id: Uuid,
    lock: bool,
) -> sqlx::Result<ProfileRow> {
    let sql = if lock {
        format!("{PROFILE_SQL} FOR UPDATE OF p")
    } else {
        PROFILE_SQL.to_owned()
    };
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(profile_id)
        .fetch_one(conn)
        .await
}

impl ProfileRow {
    /// The date of birth, when set.
    pub fn date_of_birth(&self) -> Option<Date> {
        self.basics.date_of_birth.as_deref().and_then(parse_date)
    }

    /// Onboarding is completed once the pointer reached `done` (03 section 8 rule 15).
    pub fn onboarding_is_done(&self) -> bool {
        self.onboarding_step == OnboardingStep::Done
    }

    /// `OwnProfile.locked_fields` (03 section 8 rule 15, 08 section 2.2).
    pub fn locked_fields(&self) -> Vec<String> {
        let mut locked = Vec::new();
        if self.onboarding_is_done() {
            locked.push("gender".to_owned());
            locked.push("date_of_birth".to_owned());
        }
        if self.is_id_verified {
            locked.push("first_name".to_owned());
            locked.push("last_name".to_owned());
        }
        locked
    }

    pub fn is_locked(&self, field: &str) -> bool {
        self.locked_fields().iter().any(|locked| locked == field)
    }

    /// The input of the completeness rules (08 section 6.1).
    pub fn completeness_input(&self) -> CompletenessInput<'_> {
        CompletenessInput {
            managed_by: self.account_for.managed_by,
            first_name: self.basics.first_name.as_deref(),
            last_name: self.basics.last_name.as_deref(),
            gender: self.basics.gender,
            date_of_birth: self.date_of_birth(),
            marital_status: self.basics.marital_status,
            height_cm: self.basics.height_cm,
            religion_code: self.community.religion_code.as_deref(),
            mother_tongue_code: self.community.mother_tongue_code.as_deref(),
            country_code: self.location.country_code.as_deref(),
            city_id: self.location.city_id,
            city_other: self.location.city_other.as_deref(),
            education_level_code: self.education_career.education_level_code.as_deref(),
            employment_type: self.education_career.employment_type,
            approved_photos: usize::try_from(self.approved_photos).unwrap_or(0),
            about_me: self.lifestyle.about_me.as_deref(),
            about_me_status: self.about_me_status,
            education_field_code: self.education_career.education_field_code.as_deref(),
            degree_title: self.education_career.degree_title.as_deref(),
            institute_name: self.education_career.institute_name.as_deref(),
            profession_code: self.education_career.profession_code.as_deref(),
            income_band_code: self.education_career.income_band_code.as_deref(),
            family: FamilyColumns {
                father_status: self.family.father_status,
                mother_status: self.family.mother_status,
                brothers_count: self.family.brothers_count,
                sisters_count: self.family.sisters_count,
                family_type: self.family.family_type,
                family_class: self.family.family_class,
                family_values: self.family.family_values,
                home_ownership: self.family.home_ownership,
            },
            religiosity: self.lifestyle.religiosity,
            prayer_frequency: self.lifestyle.prayer_frequency,
            living_arrangement: self.lifestyle.living_arrangement,
            work_after_marriage: self.lifestyle.work_after_marriage,
            marriage_timeline: self.lifestyle.marriage_timeline,
            relocation: self.location.relocation,
            hobbies: self.lifestyle.hobby_codes.len(),
            has_partner_preferences: self.has_preferences,
            identity: self.identity.identity_status,
            is_id_verified: self.is_id_verified,
            is_photo_verified: self.is_photo_verified,
        }
    }

    pub fn completeness(&self) -> Completeness {
        completeness::compute(&self.completeness_input())
    }
}

/// Parses `YYYY-MM-DD`.
pub fn parse_date(text: &str) -> Option<Date> {
    Date::parse(
        text,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .ok()
}

/// Recomputes `profiles.completeness` from the stored rows and returns it (08 section 6.3).
/// Call it inside the transaction of every event that the table of 08 section 6.3 lists, after
/// the change itself.
pub async fn recompute_completeness(
    conn: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<Completeness> {
    let row = load_profile(conn, profile_id, false).await?;
    let result = row.completeness();
    sqlx::query("UPDATE profiles SET completeness = $2 WHERE id = $1 AND completeness <> $2")
        .bind(profile_id)
        .bind(i16::from(result.score))
        .execute(conn)
        .await?;
    Ok(result)
}

// ---------------------------------------------------------------------------------------------
// Own profile
// ---------------------------------------------------------------------------------------------

/// Builds `OwnProfile` for a profile (15 section 4.3).
pub async fn load_own_profile(
    db: &PgPool,
    storage: &dyn ObjectStore,
    profile_id: Uuid,
) -> sqlx::Result<OwnProfile> {
    let mut conn = db.acquire().await?;
    let row = load_profile(&mut conn, profile_id, false).await?;
    drop(conn);

    let photo_rows: Vec<PhotoRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PHOTO_COLUMNS} FROM profile_photos WHERE profile_id = $1
         ORDER BY position, created_at"
    )))
    .bind(profile_id)
    .fetch_all(db)
    .await?;
    let mut photos: Vec<OwnPhoto> = Vec::with_capacity(photo_rows.len());
    for photo in &photo_rows {
        photos.push(own_photo(storage, photo).await);
    }

    let pending_kinds: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM verification_requests WHERE profile_id = $1 AND status = 'pending'",
    )
    .bind(profile_id)
    .fetch_all(db)
    .await?;

    let city_ids: Vec<i32> = [row.location.city_id, row.location.origin_city_id]
        .into_iter()
        .flatten()
        .collect();
    let cities: HashMap<i32, CityRef> = cities_by_ids(db, &city_ids).await?;

    let computed = row.completeness();
    let locked_fields = row.locked_fields();
    let identity = row.identity.summary();
    let city = row.location.city_id.and_then(|id| cities.get(&id).cloned());
    let origin_city = row
        .location
        .origin_city_id
        .and_then(|id| cities.get(&id).cloned());

    Ok(OwnProfile {
        id: row.id,
        public_code: row.public_code,
        status: row.status,
        status_reason: row.status_reason,
        onboarding_step: row.onboarding_step,
        completeness: i16::from(computed.score),
        missing: computed.missing,
        locked_fields,
        account_for: row.account_for,
        basics: row.basics,
        community: row.community,
        location: OwnLocation {
            section: row.location,
            city,
            origin_city,
        },
        education_career: row.education_career,
        family: row.family,
        lifestyle: row.lifestyle,
        contacts: row.contacts,
        photos,
        identity,
        verification: OwnVerification {
            phone_verified: row.is_phone_verified,
            photo_verified: row.is_photo_verified,
            id_verified: row.is_id_verified,
            pending: PendingVerification {
                id_document: pending_kinds.iter().any(|kind| kind == "id_document"),
                selfie: pending_kinds.iter().any(|kind| kind == "selfie"),
            },
        },
        text_status: TextStatuses {
            about_me: row.about_me_status,
            about_family: row.about_family_status,
            partner_notes: row.notes_status,
        },
    })
}

// ---------------------------------------------------------------------------------------------
// Moderated text
// ---------------------------------------------------------------------------------------------

/// The three moderated texts (13 section 3.7). The code is the `field` of the `moderate_text`
/// job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModeratedText {
    AboutMe,
    AboutFamily,
    PartnerNotes,
}

impl ModeratedText {
    pub const fn field(self) -> &'static str {
        match self {
            Self::AboutMe => "about_me",
            Self::AboutFamily => "about_family",
            Self::PartnerNotes => "partner_notes",
        }
    }
}

/// The status a moderated text gets when it is saved (13 section 3.7): unchanged text keeps its
/// status, an empty text is `approved`, a changed text is `pending`.
pub fn text_status_after_save(
    current_text: Option<&str>,
    current_status: TextStatus,
    new_text: Option<&str>,
) -> TextStatus {
    match new_text {
        None => TextStatus::Approved,
        Some(text) if current_text == Some(text) => current_status,
        Some(_) => TextStatus::Pending,
    }
}

/// Enqueues the `moderate_text` job of a text that just became `pending` (13 section 3.7):
/// dedupe key `<profile_id>:<field>`. The caller wakes the workers after commit.
pub async fn enqueue_text_moderation(
    conn: &mut PgConnection,
    profile_id: Uuid,
    text: ModeratedText,
) -> sqlx::Result<bool> {
    enqueue(
        conn,
        NewJob::new(
            "moderate_text",
            json!({ "profile_id": profile_id, "field": text.field() }),
        )
        .dedupe(format!("{profile_id}:{}", text.field())),
    )
    .await
}

// ---------------------------------------------------------------------------------------------
// Section writes
// ---------------------------------------------------------------------------------------------

/// Writes `account_for` (07 section 3).
pub async fn write_account_for(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &AccountForSection,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET managed_by = $2, manager_name = $3, match_stale = true WHERE id = $1",
    )
    .bind(profile_id)
    .bind(section.managed_by)
    .bind(&section.manager_name)
    .execute(conn)
    .await?;
    Ok(())
}

/// Writes `basics` (07 section 4). `clear_hijab` and `clear_beard` apply 07 section 4.2 rule 8.
pub async fn write_basics(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &BasicsSection,
    date_of_birth: Option<Date>,
    clear_hijab: bool,
    clear_beard: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET first_name = $2, last_name = $3, gender = $4, date_of_birth = $5,
                marital_status = $6, children_status = $7, children_count = $8,
                current_wives_count = $9, height_cm = $10,
                hijab = CASE WHEN $11 THEN NULL ELSE hijab END,
                beard = CASE WHEN $12 THEN NULL ELSE beard END,
                match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(&section.first_name)
    .bind(&section.last_name)
    .bind(section.gender)
    .bind(date_of_birth)
    .bind(section.marital_status)
    .bind(section.children_status)
    .bind(section.children_count)
    .bind(section.current_wives_count)
    .bind(section.height_cm)
    .bind(clear_hijab)
    .bind(clear_beard)
    .execute(conn)
    .await?;
    Ok(())
}

/// Writes `community` and replaces the rows of `profile_languages` (07 section 5).
pub async fn write_community(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &CommunitySection,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET religion_code = $2, sect_code = $3, caste_code = $4, caste_other = $5,
                sub_caste_code = $6, sub_caste_other = $7, mother_tongue_code = $8,
                match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(&section.religion_code)
    .bind(&section.sect_code)
    .bind(&section.caste_code)
    .bind(&section.caste_other)
    .bind(&section.sub_caste_code)
    .bind(&section.sub_caste_other)
    .bind(&section.mother_tongue_code)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM profile_languages WHERE profile_id = $1")
        .bind(profile_id)
        .execute(&mut *conn)
        .await?;
    if !section.language_codes.is_empty() {
        sqlx::query(
            "INSERT INTO profile_languages (profile_id, language_code)
             SELECT $1, code FROM unnest($2::text[]) AS code",
        )
        .bind(profile_id)
        .bind(&section.language_codes)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Records a typed caste or sub-caste (05 section 13, "Record a typed caste"): inserts the
/// suggestion or increases its `usage_count`. A rejected name keeps counting.
pub async fn record_caste_suggestion(
    conn: &mut PgConnection,
    parent_code: Option<&str>,
    name: &str,
    normalized_name: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO caste_suggestions (id, parent_code, name, normalized_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ((COALESCE(parent_code, '')), normalized_name)
         DO UPDATE SET usage_count = caste_suggestions.usage_count + 1",
    )
    .bind(Uuid::now_v7())
    .bind(parent_code)
    .bind(name)
    .bind(normalized_name)
    .execute(conn)
    .await?;
    Ok(())
}

/// Writes `location` (07 section 6).
pub async fn write_location(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &LocationSection,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET nationality_code = $2, country_code = $3, region_id = $4,
                city_id = $5, city_other = $6, area = $7, residency_status = $8,
                origin_city_id = $9, origin_other = $10, relocation = $11, match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(&section.nationality_code)
    .bind(&section.country_code)
    .bind(section.region_id)
    .bind(section.city_id)
    .bind(&section.city_other)
    .bind(&section.area)
    .bind(section.residency_status)
    .bind(section.origin_city_id)
    .bind(&section.origin_other)
    .bind(section.relocation)
    .execute(conn)
    .await?;
    Ok(())
}

/// Writes `education_career` (07 section 7).
pub async fn write_education_career(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &EducationCareerSection,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET education_level_code = $2, education_field_code = $3,
                degree_title = $4, institute_name = $5, employment_type = $6, profession_code = $7,
                job_title = $8, employer_name = $9, income_band_code = $10, match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(&section.education_level_code)
    .bind(&section.education_field_code)
    .bind(&section.degree_title)
    .bind(&section.institute_name)
    .bind(section.employment_type)
    .bind(&section.profession_code)
    .bind(&section.job_title)
    .bind(&section.employer_name)
    .bind(&section.income_band_code)
    .execute(conn)
    .await?;
    Ok(())
}

/// Writes `family`, creating the `profile_family` row on the first save (07 section 8.2 rule
/// 5). `about_family_status` is the status computed by [`text_status_after_save`].
pub async fn write_family(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &FamilySection,
    about_family_status: TextStatus,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO profile_family (
             profile_id, father_status, father_occupation, mother_status, mother_occupation,
             brothers_count, brothers_married, sisters_count, sisters_married,
             family_type, family_class, family_values, family_country_code, family_city_id,
             home_ownership, home_type, home_size_value, home_size_unit,
             about_family, about_family_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17::float8::numeric, $18, $19, $20)
         ON CONFLICT (profile_id) DO UPDATE SET
             father_status = EXCLUDED.father_status,
             father_occupation = EXCLUDED.father_occupation,
             mother_status = EXCLUDED.mother_status,
             mother_occupation = EXCLUDED.mother_occupation,
             brothers_count = EXCLUDED.brothers_count,
             brothers_married = EXCLUDED.brothers_married,
             sisters_count = EXCLUDED.sisters_count,
             sisters_married = EXCLUDED.sisters_married,
             family_type = EXCLUDED.family_type,
             family_class = EXCLUDED.family_class,
             family_values = EXCLUDED.family_values,
             family_country_code = EXCLUDED.family_country_code,
             family_city_id = EXCLUDED.family_city_id,
             home_ownership = EXCLUDED.home_ownership,
             home_type = EXCLUDED.home_type,
             home_size_value = EXCLUDED.home_size_value,
             home_size_unit = EXCLUDED.home_size_unit,
             about_family = EXCLUDED.about_family,
             about_family_status = EXCLUDED.about_family_status",
    )
    .bind(profile_id)
    .bind(section.father_status)
    .bind(&section.father_occupation)
    .bind(section.mother_status)
    .bind(&section.mother_occupation)
    .bind(section.brothers_count)
    .bind(section.brothers_married)
    .bind(section.sisters_count)
    .bind(section.sisters_married)
    .bind(section.family_type)
    .bind(section.family_class)
    .bind(section.family_values)
    .bind(&section.family_country_code)
    .bind(section.family_city_id)
    .bind(section.home_ownership)
    .bind(section.home_type)
    .bind(section.home_size_value)
    .bind(section.home_size_unit)
    .bind(&section.about_family)
    .bind(about_family_status)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE profiles SET match_stale = true WHERE id = $1")
        .bind(profile_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// Writes `lifestyle` and replaces the rows of `profile_hobbies` (07 section 9).
pub async fn write_lifestyle(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &LifestyleSection,
    about_me_status: TextStatus,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profiles SET religiosity = $2, prayer_frequency = $3, hijab = $4, beard = $5,
                religious_education = $6, smoking = $7, living_arrangement = $8,
                work_after_marriage = $9, marriage_timeline = $10, jahez_stance = $11,
                weight_kg = $12, complexion = $13, body_type = $14, blood_group = $15,
                disability = $16, disability_details = $17, about_me = $18,
                about_me_status = $19, match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(section.religiosity)
    .bind(section.prayer_frequency)
    .bind(section.hijab)
    .bind(section.beard)
    .bind(section.religious_education)
    .bind(section.smoking)
    .bind(section.living_arrangement)
    .bind(section.work_after_marriage)
    .bind(section.marriage_timeline)
    .bind(section.jahez_stance)
    .bind(section.weight_kg)
    .bind(section.complexion)
    .bind(section.body_type)
    .bind(section.blood_group)
    .bind(section.disability)
    .bind(&section.disability_details)
    .bind(&section.about_me)
    .bind(about_me_status)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM profile_hobbies WHERE profile_id = $1")
        .bind(profile_id)
        .execute(&mut *conn)
        .await?;
    if !section.hobby_codes.is_empty() {
        sqlx::query(
            "INSERT INTO profile_hobbies (profile_id, hobby_code)
             SELECT $1, code FROM unnest($2::text[]) AS code",
        )
        .bind(profile_id)
        .bind(&section.hobby_codes)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Writes `contacts`, creating the `profile_contacts` row on the first save (08 section 3).
/// Matching does not use these values, so `match_stale` is left alone (10 section 8.2).
pub async fn write_contacts(
    conn: &mut PgConnection,
    profile_id: Uuid,
    section: &ContactsSection,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO profile_contacts (
             profile_id, phone_e164, whatsapp_e164, contact_email, guardian_name,
             guardian_relation, guardian_phone_e164, preferred_contact, best_time_to_call)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (profile_id) DO UPDATE SET
             phone_e164 = EXCLUDED.phone_e164,
             whatsapp_e164 = EXCLUDED.whatsapp_e164,
             contact_email = EXCLUDED.contact_email,
             guardian_name = EXCLUDED.guardian_name,
             guardian_relation = EXCLUDED.guardian_relation,
             guardian_phone_e164 = EXCLUDED.guardian_phone_e164,
             preferred_contact = EXCLUDED.preferred_contact,
             best_time_to_call = EXCLUDED.best_time_to_call",
    )
    .bind(profile_id)
    .bind(&section.phone_e164)
    .bind(&section.whatsapp_e164)
    .bind(&section.contact_email)
    .bind(&section.guardian_name)
    .bind(section.guardian_relation)
    .bind(&section.guardian_phone_e164)
    .bind(section.preferred_contact)
    .bind(&section.best_time_to_call)
    .execute(conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Privacy default for women
// ---------------------------------------------------------------------------------------------

/// Applies 09 section 3.5 rule 2 when `basics` is saved: while the profile is `draft`, a female
/// profile whose `photo_visibility` still has the column default `members` and whose privacy
/// row was never changed by the owner gets `interests_and_connections`.
///
/// "The owner has chosen" is read from the row itself: `profile_privacy.updated_at` moves past
/// `created_at` the first time anything changes it, whether a `PATCH /v1/me/privacy` or this
/// default.
pub async fn apply_female_photo_default(
    conn: &mut PgConnection,
    profile_id: Uuid,
    status: ProfileStatus,
    gender: Gender,
) -> sqlx::Result<()> {
    let row: Option<(PhotoVisibility, bool)> = sqlx::query_as(
        "SELECT photo_visibility, updated_at > created_at FROM profile_privacy
         WHERE profile_id = $1 FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((current, owner_has_chosen)) = row else {
        return Ok(());
    };
    if let Some(new) = crate::domain::preference_defaults::photo_visibility_after_basics(
        status,
        gender,
        current,
        owner_has_chosen,
    ) {
        sqlx::query("UPDATE profile_privacy SET photo_visibility = $2 WHERE profile_id = $1")
            .bind(profile_id)
            .bind(new)
            .execute(conn)
            .await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Geography lookups for validation
// ---------------------------------------------------------------------------------------------

/// What validation needs to know about a city.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CityFact {
    pub id: i32,
    pub country_code: String,
    pub region_id: Option<i32>,
}

/// Cities by id, keyed by id. Unknown ids are absent.
pub async fn city_facts(
    conn: &mut PgConnection,
    ids: &[i32],
) -> sqlx::Result<HashMap<i32, CityFact>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<CityFact> =
        sqlx::query_as("SELECT id, country_code, region_id FROM cities WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(conn)
            .await?;
    Ok(rows.into_iter().map(|city| (city.id, city)).collect())
}

/// The country of each region, keyed by region id. Unknown ids are absent.
pub async fn region_countries(
    conn: &mut PgConnection,
    ids: &[i32],
) -> sqlx::Result<HashMap<i32, String>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(i32, String)> =
        sqlx::query_as("SELECT id, country_code FROM regions WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(conn)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Whether the country has any region (07 section 6.2 rule 3).
pub async fn country_has_regions(
    conn: &mut PgConnection,
    country_code: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM regions WHERE country_code = $1)")
        .bind(country_code)
        .fetch_one(conn)
        .await
}
