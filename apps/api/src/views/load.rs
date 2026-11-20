//! The queries behind the views: profile rows, preferences, photos, pair links, places and the
//! viewer's interest usage. Each takes a whole page of profile ids, so a list costs a fixed
//! number of queries however long it is (20 section 4, rule 4).

use std::collections::HashMap;

use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::matching::subject::{City, Geo, GeoIds, Region};
use crate::domain::options::{
    Beard, BloodGroup, BodyType, ChildrenStatus, Complexion, Disability, EmploymentType,
    FamilyClass, FamilyType, FamilyValues, Gender, Hijab, HomeOwnership, HomeSizeUnit, HomeType,
    JahezStance, LivingArrangement, ManagedBy, MaritalStatus, MarriageTimeline, ParentStatus,
    PrayerFrequency, Religiosity, ReligiousEducation, Relocation, ResidencyStatus, Smoking,
    WorkAfterMarriage,
};
use crate::domain::preferences::Preferences;
use crate::domain::privacy::Privacy;
use crate::domain::time::karachi_date;
use crate::domain::types::{
    ConnectionStatus, InterestStatus, PhotoAccessStatus, ProfileStatus, TextStatus, UserStatus,
};
use crate::domain::visibility::InterestUsage;

/// Every column of `partner_preferences` that [`Preferences`] holds, for `SELECT` statements
/// (the type has `deny_unknown_fields`, so columns are always listed explicitly).
pub const PREFERENCE_COLUMNS: &str = "age_min, age_max, age_importance, \
     height_min_cm, height_max_cm, height_importance, marital_statuses, marital_status_importance, \
     children_acceptance, children_importance, religion_codes, religion_importance, \
     sect_codes, sect_importance, caste_codes, caste_importance, \
     mother_tongue_codes, mother_tongue_importance, \
     country_codes, region_ids, city_ids, location_importance, \
     education_min_rank, education_importance, employment_types, profession_codes, \
     profession_importance, income_min_rank, income_importance, \
     religiosity_levels, religiosity_importance, hijab_types, beard_types, appearance_importance, \
     family_values, family_types, family_importance, living_arrangements, \
     living_arrangement_importance, work_after_marriage_options, work_after_marriage_importance, \
     smoking_options, smoking_importance, notes";

/// One profile with its account status, privacy, family row, places and languages: everything
/// a card, a profile page and the matching view need (04 sections 5.1 to 5.7).
#[derive(Debug, Clone, sqlx::FromRow)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors boolean columns of profiles"
)]
pub struct ProfileRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub public_code: String,
    pub status: ProfileStatus,
    pub user_status: UserStatus,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub managed_by: Option<ManagedBy>,
    pub gender: Option<Gender>,
    pub date_of_birth: Option<Date>,
    pub marital_status: Option<MaritalStatus>,
    pub children_status: Option<ChildrenStatus>,
    pub children_count: Option<i16>,
    pub current_wives_count: Option<i16>,
    pub height_cm: Option<i16>,
    pub weight_kg: Option<i16>,
    pub complexion: Option<Complexion>,
    pub body_type: Option<BodyType>,
    pub blood_group: Option<BloodGroup>,
    pub disability: Option<Disability>,
    pub disability_details: Option<String>,
    pub religion_code: Option<String>,
    pub sect_code: Option<String>,
    pub caste_code: Option<String>,
    pub sub_caste_code: Option<String>,
    pub caste_other: Option<String>,
    pub sub_caste_other: Option<String>,
    pub mother_tongue_code: Option<String>,
    pub nationality_code: Option<String>,
    pub country_code: Option<String>,
    pub region_id: Option<i32>,
    pub region_name: Option<String>,
    pub city_id: Option<i32>,
    /// `cities.name` of `city_id`, or `city_other`.
    pub city_name: Option<String>,
    pub area: Option<String>,
    pub residency_status: Option<ResidencyStatus>,
    pub origin_city_id: Option<i32>,
    /// `cities.name` of `origin_city_id`, or `origin_other`.
    pub origin_label: Option<String>,
    pub relocation: Option<Relocation>,
    pub education_level_code: Option<String>,
    pub education_field_code: Option<String>,
    pub degree_title: Option<String>,
    pub institute_name: Option<String>,
    pub employment_type: Option<EmploymentType>,
    pub profession_code: Option<String>,
    pub job_title: Option<String>,
    pub employer_name: Option<String>,
    pub income_band_code: Option<String>,
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
    pub about_me: Option<String>,
    pub about_me_status: TextStatus,
    pub completeness: i16,
    pub has_approved_photo: bool,
    pub is_phone_verified: bool,
    pub is_photo_verified: bool,
    pub is_id_verified: bool,
    pub last_active_at: Option<OffsetDateTime>,
    pub first_activated_at: Option<OffsetDateTime>,
    pub match_stale: bool,
    pub match_refreshed_at: Option<OffsetDateTime>,
    pub has_family_row: bool,
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
    pub family_city_name: Option<String>,
    pub home_ownership: Option<HomeOwnership>,
    pub home_type: Option<HomeType>,
    pub home_size_value: Option<f64>,
    pub home_size_unit: Option<HomeSizeUnit>,
    pub about_family: Option<String>,
    pub about_family_status: Option<TextStatus>,
    pub language_codes: Vec<String>,
    pub hobby_codes: Vec<String>,
    #[sqlx(flatten)]
    pub privacy: Privacy,
}

const PROFILE_SELECT: &str = "SELECT
    p.id, p.user_id, p.public_code, p.status, u.status AS user_status,
    p.first_name, p.last_name, p.managed_by, p.gender, p.date_of_birth, p.marital_status,
    p.children_status, p.children_count, p.current_wives_count, p.height_cm, p.weight_kg,
    p.complexion, p.body_type, p.blood_group, p.disability, p.disability_details,
    p.religion_code, p.sect_code, p.caste_code, p.sub_caste_code, p.caste_other, p.sub_caste_other,
    p.mother_tongue_code, p.nationality_code, p.country_code, p.region_id, r.name AS region_name,
    p.city_id, COALESCE(c.name, p.city_other) AS city_name, p.area, p.residency_status,
    p.origin_city_id, COALESCE(oc.name, p.origin_other) AS origin_label, p.relocation,
    p.education_level_code, p.education_field_code, p.degree_title, p.institute_name,
    p.employment_type, p.profession_code, p.job_title, p.employer_name, p.income_band_code,
    p.religiosity, p.prayer_frequency, p.hijab, p.beard, p.religious_education, p.smoking,
    p.living_arrangement, p.work_after_marriage, p.marriage_timeline, p.jahez_stance,
    p.about_me, p.about_me_status, p.completeness, p.has_approved_photo, p.is_phone_verified,
    p.is_photo_verified, p.is_id_verified, p.last_active_at, p.first_activated_at,
    p.match_stale, p.match_refreshed_at,
    (pf.profile_id IS NOT NULL) AS has_family_row,
    pf.father_status, pf.father_occupation, pf.mother_status, pf.mother_occupation,
    pf.brothers_count, pf.brothers_married, pf.sisters_count, pf.sisters_married,
    pf.family_type, pf.family_class, pf.family_values, pf.family_country_code,
    pf.family_city_id, fc.name AS family_city_name, pf.home_ownership, pf.home_type,
    pf.home_size_value::float8 AS home_size_value, pf.home_size_unit,
    pf.about_family, pf.about_family_status,
    ARRAY(SELECT l.language_code FROM profile_languages l
          WHERE l.profile_id = p.id ORDER BY l.language_code) AS language_codes,
    ARRAY(SELECT h.hobby_code FROM profile_hobbies h
          WHERE h.profile_id = p.id ORDER BY h.hobby_code) AS hobby_codes,
    pv.discovery_visibility, pv.interest_permission, pv.name_display, pv.photo_visibility,
    pv.caste_visibility, pv.income_visibility, pv.family_visibility,
    pv.career_details_visibility, pv.home_visibility, pv.area_visibility, pv.health_visibility,
    pv.show_last_active, pv.show_online_status, pv.record_my_visits, pv.send_read_receipts,
    pv.allow_photo_requests
FROM profiles p
JOIN users u ON u.id = p.user_id
JOIN profile_privacy pv ON pv.profile_id = p.id
LEFT JOIN profile_family pf ON pf.profile_id = p.id
LEFT JOIN regions r ON r.id = p.region_id
LEFT JOIN cities c ON c.id = p.city_id
LEFT JOIN cities oc ON oc.id = p.origin_city_id
LEFT JOIN cities fc ON fc.id = pf.family_city_id
WHERE p.id = ANY($1)";

/// Loads the profiles with these ids, keyed by id. Missing ids are simply absent.
pub async fn profiles(db: &PgPool, ids: &[Uuid]) -> sqlx::Result<HashMap<Uuid, ProfileRow>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<ProfileRow> = sqlx::query_as(PROFILE_SELECT)
        .bind(ids)
        .fetch_all(db)
        .await?;
    Ok(rows.into_iter().map(|row| (row.id, row)).collect())
}

/// One `partner_preferences` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PreferencesRow {
    pub profile_id: Uuid,
    /// Moderation state of `notes` (13 section 3).
    pub notes_status: TextStatus,
    #[sqlx(flatten)]
    pub prefs: Preferences,
}

/// Loads the stored preferences of these profiles, keyed by profile id. A profile without a
/// row is absent; callers use the defaults of 07 section 12 for it.
pub async fn preferences(db: &PgPool, ids: &[Uuid]) -> sqlx::Result<HashMap<Uuid, PreferencesRow>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = format!(
        "SELECT profile_id, notes_status, {PREFERENCE_COLUMNS}
         FROM partner_preferences WHERE profile_id = ANY($1)"
    );
    let rows: Vec<PreferencesRow> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(ids)
        .fetch_all(db)
        .await?;
    Ok(rows.into_iter().map(|row| (row.profile_id, row)).collect())
}

/// An approved photo with the keys a `PhotoView` signs.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ApprovedPhoto {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub is_primary: bool,
    pub key_large: Option<String>,
    pub key_medium: Option<String>,
    pub key_thumb: Option<String>,
    pub key_blur_medium: Option<String>,
    pub key_blur_thumb: Option<String>,
}

/// The approved photos of these profiles in display order (position, then id), grouped by
/// profile. Other statuses are never listed to other members (09 section 6.2 rule 1).
pub async fn approved_photos(
    db: &PgPool,
    ids: &[Uuid],
) -> sqlx::Result<HashMap<Uuid, Vec<ApprovedPhoto>>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<ApprovedPhoto> = sqlx::query_as(
        "SELECT id, profile_id, is_primary, key_large, key_medium, key_thumb,
                key_blur_medium, key_blur_thumb
         FROM profile_photos
         WHERE profile_id = ANY($1) AND status = 'approved'
         ORDER BY profile_id, position, id",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;
    let mut grouped: HashMap<Uuid, Vec<ApprovedPhoto>> = HashMap::new();
    for row in rows {
        grouped.entry(row.profile_id).or_default().push(row);
    }
    Ok(grouped)
}

/// The per-owner links of a viewer to each owner that are single rows.
#[derive(Debug, Clone, sqlx::FromRow)]
struct LinkRow {
    owner_id: Uuid,
    blocked: bool,
    photo_access_status: Option<PhotoAccessStatus>,
    photo_access_updated_at: Option<OffsetDateTime>,
    shortlisted: bool,
    shortlist_note: Option<String>,
    pass_expires_at: Option<OffsetDateTime>,
}

/// An interest between the viewer and one owner, either direction.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct InterestRow {
    pub id: Uuid,
    pub sender_profile_id: Uuid,
    pub receiver_profile_id: Uuid,
    pub status: InterestStatus,
    pub message: Option<String>,
    pub created_at: OffsetDateTime,
    pub responded_at: Option<OffsetDateTime>,
    pub expires_at: OffsetDateTime,
}

/// A connection between the viewer and one owner.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ConnectionRow {
    pub id: Uuid,
    pub profile_low_id: Uuid,
    pub profile_high_id: Uuid,
    pub status: ConnectionStatus,
    pub ended_at: Option<OffsetDateTime>,
}

/// Everything about one (viewer, owner) pair: `PairLink` of 09 section 13.1.
#[derive(Debug, Clone, Default)]
pub struct PairRows {
    /// A `blocks` row in either direction.
    pub blocked: bool,
    /// The `photo_access` row for (owner, viewer).
    pub photo_access: Option<(PhotoAccessStatus, OffsetDateTime)>,
    pub shortlisted: bool,
    pub shortlist_note: Option<String>,
    /// `expires_at` of the viewer's pass for the owner.
    pub pass_expires_at: Option<OffsetDateTime>,
    /// Interests in both directions, newest first.
    pub interests: Vec<InterestRow>,
    pub connections: Vec<ConnectionRow>,
}

impl PairRows {
    /// The id of the `active` connection between the two, if any.
    pub fn active_connection(&self) -> Option<Uuid> {
        self.connections
            .iter()
            .find(|connection| connection.status == ConnectionStatus::Active)
            .map(|connection| connection.id)
    }

    /// `ended_at` of the latest ended connection between the two (the connection cooldown).
    pub fn connection_ended_at(&self) -> Option<OffsetDateTime> {
        self.connections
            .iter()
            .filter(|connection| connection.status == ConnectionStatus::Ended)
            .filter_map(|connection| connection.ended_at)
            .max()
    }
}

/// Loads the pair links of a viewer with each owner in three queries.
pub async fn pairs(
    db: &PgPool,
    viewer_id: Uuid,
    ids: &[Uuid],
) -> sqlx::Result<HashMap<Uuid, PairRows>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let links: Vec<LinkRow> = sqlx::query_as(
        "SELECT o.id AS owner_id,
                EXISTS (SELECT 1 FROM blocks b
                        WHERE (b.blocker_profile_id = $1 AND b.blocked_profile_id = o.id)
                           OR (b.blocker_profile_id = o.id AND b.blocked_profile_id = $1)) AS blocked,
                pa.status AS photo_access_status, pa.updated_at AS photo_access_updated_at,
                (s.profile_id IS NOT NULL) AS shortlisted, s.note AS shortlist_note,
                ps.expires_at AS pass_expires_at
         FROM unnest($2::uuid[]) AS o(id)
         LEFT JOIN photo_access pa ON pa.owner_profile_id = o.id AND pa.viewer_profile_id = $1
         LEFT JOIN shortlists s ON s.profile_id = $1 AND s.target_profile_id = o.id
         LEFT JOIN passes ps ON ps.profile_id = $1 AND ps.target_profile_id = o.id",
    )
    .bind(viewer_id)
    .bind(ids)
    .fetch_all(db)
    .await?;
    let interests: Vec<InterestRow> = sqlx::query_as(
        "SELECT id, sender_profile_id, receiver_profile_id, status, message, created_at,
                responded_at, expires_at
         FROM interests
         WHERE (sender_profile_id = $1 AND receiver_profile_id = ANY($2))
            OR (receiver_profile_id = $1 AND sender_profile_id = ANY($2))
         ORDER BY created_at DESC, id DESC",
    )
    .bind(viewer_id)
    .bind(ids)
    .fetch_all(db)
    .await?;
    let connections: Vec<ConnectionRow> = sqlx::query_as(
        "SELECT id, profile_low_id, profile_high_id, status, ended_at
         FROM connections
         WHERE (profile_low_id = $1 AND profile_high_id = ANY($2))
            OR (profile_high_id = $1 AND profile_low_id = ANY($2))",
    )
    .bind(viewer_id)
    .bind(ids)
    .fetch_all(db)
    .await?;

    let mut pairs: HashMap<Uuid, PairRows> = links
        .into_iter()
        .map(|link| {
            (
                link.owner_id,
                PairRows {
                    blocked: link.blocked,
                    photo_access: link.photo_access_status.zip(link.photo_access_updated_at),
                    shortlisted: link.shortlisted,
                    shortlist_note: link.shortlist_note,
                    pass_expires_at: link.pass_expires_at,
                    interests: Vec::new(),
                    connections: Vec::new(),
                },
            )
        })
        .collect();
    for interest in interests {
        let other = if interest.sender_profile_id == viewer_id {
            interest.receiver_profile_id
        } else {
            interest.sender_profile_id
        };
        if let Some(pair) = pairs.get_mut(&other) {
            pair.interests.push(interest);
        }
    }
    for connection in connections {
        let other = if connection.profile_low_id == viewer_id {
            connection.profile_high_id
        } else {
            connection.profile_low_id
        };
        if let Some(pair) = pairs.get_mut(&other) {
            pair.connections.push(connection);
        }
    }
    Ok(pairs)
}

/// Loads the cities and regions listed in these preferences, with their parents (10 section
/// 4.5 note 1): one query for each table.
pub async fn geo<'a>(
    db: &PgPool,
    preferences: impl IntoIterator<Item = &'a Preferences>,
) -> sqlx::Result<Geo> {
    let ids = GeoIds::collect(preferences);
    let mut geo = Geo::new();
    if !ids.cities.is_empty() {
        let cities: Vec<(i32, String, Option<i32>, String)> = sqlx::query_as(
            "SELECT id, name, region_id, country_code FROM cities WHERE id = ANY($1)",
        )
        .bind(&ids.cities)
        .fetch_all(db)
        .await?;
        for (id, name, region_id, country_code) in cities {
            geo.insert_city(
                id,
                City {
                    name,
                    region_id,
                    country_code,
                },
            );
        }
    }
    if !ids.regions.is_empty() {
        let regions: Vec<(i32, String, String)> =
            sqlx::query_as("SELECT id, name, country_code FROM regions WHERE id = ANY($1)")
                .bind(&ids.regions)
                .fetch_all(db)
                .await?;
        for (id, name, country_code) in regions {
            geo.insert_region(id, Region { name, country_code });
        }
    }
    Ok(geo)
}

/// The viewer's interest counts for `can_send_interest` (09 section 7.2): pending sent
/// interests, active connections and today's `interests_sent` counter.
pub async fn interest_usage(
    db: &PgPool,
    viewer_id: Uuid,
    now: OffsetDateTime,
) -> sqlx::Result<InterestUsage> {
    let (pending_sent, active_connections, sent_today): (i64, i64, i64) = sqlx::query_as(
        "SELECT
           (SELECT count(*) FROM interests
             WHERE sender_profile_id = $1 AND status = 'pending'),
           (SELECT count(*) FROM connections
             WHERE status = 'active' AND (profile_low_id = $1 OR profile_high_id = $1)),
           COALESCE((SELECT count::bigint FROM usage_counters
             WHERE profile_id = $1 AND counter = 'interests_sent' AND day = $2), 0)",
    )
    .bind(viewer_id)
    .bind(karachi_date(now))
    .fetch_one(db)
    .await?;
    Ok(InterestUsage {
        pending_sent,
        active_connections,
        sent_today,
    })
}
