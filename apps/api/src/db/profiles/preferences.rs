//! SQL of partner preferences and privacy settings (04 sections 5.6 and 5.7).

use std::sync::OnceLock;

use sqlx::PgConnection;
use uuid::Uuid;

use crate::domain::preferences::Preferences;
use crate::domain::privacy::Privacy;
use crate::domain::types::TextStatus;

/// The columns of `partner_preferences` that `Preferences` holds, in the order of its fields and
/// of the binds in [`upsert`].
pub const COLUMNS: [&str; 44] = [
    "age_min",
    "age_max",
    "age_importance",
    "height_min_cm",
    "height_max_cm",
    "height_importance",
    "marital_statuses",
    "marital_status_importance",
    "children_acceptance",
    "children_importance",
    "religion_codes",
    "religion_importance",
    "sect_codes",
    "sect_importance",
    "caste_codes",
    "caste_importance",
    "mother_tongue_codes",
    "mother_tongue_importance",
    "country_codes",
    "region_ids",
    "city_ids",
    "location_importance",
    "education_min_rank",
    "education_importance",
    "employment_types",
    "profession_codes",
    "profession_importance",
    "income_min_rank",
    "income_importance",
    "religiosity_levels",
    "religiosity_importance",
    "hijab_types",
    "beard_types",
    "appearance_importance",
    "family_values",
    "family_types",
    "family_importance",
    "living_arrangements",
    "living_arrangement_importance",
    "work_after_marriage_options",
    "work_after_marriage_importance",
    "smoking_options",
    "smoking_importance",
    "notes",
];

/// The stored preferences, or `None` while the profile has no row (07 section 12).
pub async fn load(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<Option<Preferences>> {
    sqlx::query_as("SELECT * FROM partner_preferences WHERE profile_id = $1")
        .bind(profile_id)
        .fetch_optional(conn)
        .await
}

/// The status of the `notes` text, or `Approved` while there is no row.
pub async fn notes_status(conn: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<TextStatus> {
    let status: Option<TextStatus> =
        sqlx::query_scalar("SELECT notes_status FROM partner_preferences WHERE profile_id = $1")
            .bind(profile_id)
            .fetch_optional(conn)
            .await?;
    Ok(status.unwrap_or(TextStatus::Approved))
}

fn upsert_sql() -> &'static str {
    static SQL: OnceLock<String> = OnceLock::new();
    SQL.get_or_init(|| {
        let columns = COLUMNS.join(", ");
        let placeholders = (2..=COLUMNS.len() + 1)
            .map(|index| format!("${index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let updates = COLUMNS
            .iter()
            .map(|column| format!("{column} = EXCLUDED.{column}"))
            .collect::<Vec<_>>()
            .join(", ");
        let status = COLUMNS.len() + 2;
        format!(
            "INSERT INTO partner_preferences (profile_id, {columns}, notes_status)
             VALUES ($1, {placeholders}, ${status})
             ON CONFLICT (profile_id) DO UPDATE SET {updates}, notes_status = EXCLUDED.notes_status"
        )
    })
}

/// Creates or replaces the preferences row (15 section 7, `PUT /v1/me/preferences`).
pub async fn upsert(
    conn: &mut PgConnection,
    profile_id: Uuid,
    prefs: &Preferences,
    notes_status: TextStatus,
) -> sqlx::Result<()> {
    sqlx::query(sqlx::AssertSqlSafe(upsert_sql().to_owned()))
        .bind(profile_id)
        .bind(prefs.age_min)
        .bind(prefs.age_max)
        .bind(prefs.age_importance)
        .bind(prefs.height_min_cm)
        .bind(prefs.height_max_cm)
        .bind(prefs.height_importance)
        .bind(&prefs.marital_statuses)
        .bind(prefs.marital_status_importance)
        .bind(prefs.children_acceptance)
        .bind(prefs.children_importance)
        .bind(&prefs.religion_codes)
        .bind(prefs.religion_importance)
        .bind(&prefs.sect_codes)
        .bind(prefs.sect_importance)
        .bind(&prefs.caste_codes)
        .bind(prefs.caste_importance)
        .bind(&prefs.mother_tongue_codes)
        .bind(prefs.mother_tongue_importance)
        .bind(&prefs.country_codes)
        .bind(&prefs.region_ids)
        .bind(&prefs.city_ids)
        .bind(prefs.location_importance)
        .bind(prefs.education_min_rank)
        .bind(prefs.education_importance)
        .bind(&prefs.employment_types)
        .bind(&prefs.profession_codes)
        .bind(prefs.profession_importance)
        .bind(prefs.income_min_rank)
        .bind(prefs.income_importance)
        .bind(&prefs.religiosity_levels)
        .bind(prefs.religiosity_importance)
        .bind(&prefs.hijab_types)
        .bind(&prefs.beard_types)
        .bind(prefs.appearance_importance)
        .bind(&prefs.family_values)
        .bind(&prefs.family_types)
        .bind(prefs.family_importance)
        .bind(&prefs.living_arrangements)
        .bind(prefs.living_arrangement_importance)
        .bind(&prefs.work_after_marriage_options)
        .bind(prefs.work_after_marriage_importance)
        .bind(&prefs.smoking_options)
        .bind(prefs.smoking_importance)
        .bind(&prefs.notes)
        .bind(notes_status)
        .execute(conn)
        .await?;
    Ok(())
}

/// The privacy settings of the profile. `lock` holds the row until the transaction ends.
pub async fn load_privacy(
    conn: &mut PgConnection,
    profile_id: Uuid,
    lock: bool,
) -> sqlx::Result<Privacy> {
    let sql = if lock {
        "SELECT * FROM profile_privacy WHERE profile_id = $1 FOR UPDATE"
    } else {
        "SELECT * FROM profile_privacy WHERE profile_id = $1"
    };
    sqlx::query_as(sql).bind(profile_id).fetch_one(conn).await
}

/// Replaces every privacy column.
pub async fn write_privacy(
    conn: &mut PgConnection,
    profile_id: Uuid,
    privacy: &Privacy,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profile_privacy SET
             discovery_visibility = $2, interest_permission = $3, name_display = $4,
             photo_visibility = $5, caste_visibility = $6, income_visibility = $7,
             family_visibility = $8, career_details_visibility = $9, home_visibility = $10,
             area_visibility = $11, health_visibility = $12, show_last_active = $13,
             show_online_status = $14, record_my_visits = $15, send_read_receipts = $16,
             allow_photo_requests = $17
         WHERE profile_id = $1",
    )
    .bind(profile_id)
    .bind(privacy.discovery_visibility)
    .bind(privacy.interest_permission)
    .bind(privacy.name_display)
    .bind(privacy.photo_visibility)
    .bind(privacy.caste_visibility)
    .bind(privacy.income_visibility)
    .bind(privacy.family_visibility)
    .bind(privacy.career_details_visibility)
    .bind(privacy.home_visibility)
    .bind(privacy.area_visibility)
    .bind(privacy.health_visibility)
    .bind(privacy.show_last_active)
    .bind(privacy.show_online_status)
    .bind(privacy.record_my_visits)
    .bind(privacy.send_read_receipts)
    .bind(privacy.allow_photo_requests)
    .execute(conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::options::Gender;
    use crate::domain::preference_defaults::{DefaultsInput, default_preferences};

    #[test]
    fn the_columns_are_the_fields_of_preferences() {
        let defaults = default_preferences(&DefaultsInput {
            gender: Some(Gender::Male),
            ..DefaultsInput::default()
        });
        let value = serde_json::to_value(&defaults).unwrap();
        let mut fields: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        let mut columns = COLUMNS.to_vec();
        fields.sort_unstable();
        columns.sort_unstable();
        assert_eq!(fields, columns);
    }

    #[test]
    fn the_upsert_has_one_placeholder_per_bind() {
        let sql = upsert_sql();
        assert!(sql.contains("$46"), "the notes status is the 46th bind");
        assert!(!sql.contains("$47"));
    }
}
