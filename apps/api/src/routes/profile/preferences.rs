//! Partner preferences and privacy settings (15 section 7, 07 sections 11 and 12, 09 section
//! 3).

use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use time::OffsetDateTime;

use crate::auth::Open;
use crate::db::profiles::preferences as sql;
use crate::db::profiles::{self, ModeratedText, ProfileRow, text_status_after_save};
use crate::domain::options::{Beard, Gender, Hijab, MaritalStatus};
use crate::domain::preference_defaults::{DefaultsInput, default_preferences};
use crate::domain::preferences::{Preferences, limits};
use crate::domain::privacy::Privacy;
use crate::domain::text_rules::TextField;
use crate::domain::time::age_now;
use crate::domain::types::TextStatus;
use crate::error::{ApiResult, ErrorBody, FieldCode};
use crate::extract::ApiJson;
use crate::models::profile::PrivacyPatch;
use crate::reference::ReferenceData;
use crate::routes::profile::rules::{Checker, dedupe, in_range};
use crate::state::AppState;

/// Heights a preference may ask for (07 section 11.4 rule 2).
const HEIGHT_RANGE: (i16, i16) = (122, 213);
/// Ages a preference may ask for (07 section 11.4 rule 1).
const AGE_RANGE: (i16, i16) = (18, 80);

/// Geography rows that the validation of `region_ids` and `city_ids` reads.
#[derive(Debug, Default)]
pub struct PreferenceGeo {
    pub region_countries: HashMap<i32, String>,
    pub city_countries: HashMap<i32, String>,
}

#[derive(Debug)]
pub struct PreferencesPlan {
    pub preferences: Preferences,
    pub notes_status: TextStatus,
}

/// What the validation compares the body with.
pub struct PreferenceCtx<'a> {
    pub reference: &'a ReferenceData,
    /// The candidate's gender (`married` is a choice of women only, and only one of the two
    /// appearance lists applies).
    pub gender: Option<Gender>,
    /// The stored row, when there is one.
    pub stored: Option<&'a Preferences>,
    pub stored_notes_status: TextStatus,
}

fn stored_codes<'a>(
    ctx: &'a PreferenceCtx<'_>,
    pick: impl Fn(&'a Preferences) -> &'a [String],
) -> Vec<&'a str> {
    ctx.stored
        .map_or_default(pick)
        .iter()
        .map(String::as_str)
        .collect()
}

/// Whether a minimum rank is one of the ranks of the list, or already stored.
fn rank_is_valid(rank: i16, ranks: impl Iterator<Item = (i16, bool)>, stored: Option<i16>) -> bool {
    stored == Some(rank)
        || ranks
            .into_iter()
            .any(|(value, active)| active && value == rank)
}

/// 07 section 11.4. Array limits are checked on the deduplicated lists.
#[expect(
    clippy::too_many_lines,
    reason = "one block per rule of 07 section 11.4"
)]
pub fn plan_preferences(
    ctx: &PreferenceCtx<'_>,
    body: &Preferences,
    geo: &PreferenceGeo,
) -> ApiResult<PreferencesPlan> {
    let reference = ctx.reference;
    let mut c = Checker::new(false);

    // Rule 1.
    for (field, value) in [("age_min", body.age_min), ("age_max", body.age_max)] {
        if !in_range(value, AGE_RANGE.0, AGE_RANGE.1) {
            c.fail(field, FieldCode::OutOfRange);
        }
    }
    if body.age_min > body.age_max {
        c.fail("age_min", FieldCode::Invalid);
    }
    // Rule 2.
    for (field, value) in [
        ("height_min_cm", body.height_min_cm),
        ("height_max_cm", body.height_max_cm),
    ] {
        if value.is_some_and(|height| !in_range(height, HEIGHT_RANGE.0, HEIGHT_RANGE.1)) {
            c.fail(field, FieldCode::OutOfRange);
        }
    }
    if let (Some(low), Some(high)) = (body.height_min_cm, body.height_max_cm)
        && low > high
    {
        c.fail("height_min_cm", FieldCode::Invalid);
    }

    // Rule 4.
    let marital_statuses = dedupe(&body.marital_statuses);
    if marital_statuses.contains(&MaritalStatus::Married) && ctx.gender != Some(Gender::Female) {
        c.fail("marital_statuses", FieldCode::NotAllowed);
    }

    // Rule 3: reference codes, active when new.
    let religion_codes = c.codes(
        "religion_codes",
        &body.religion_codes,
        &stored_codes(ctx, |p| &p.religion_codes),
        usize::MAX,
        |code| reference.religion(code).map(|row| row.is_active),
    );
    let sect_codes = c.codes(
        "sect_codes",
        &body.sect_codes,
        &stored_codes(ctx, |p| &p.sect_codes),
        usize::MAX,
        |code| reference.sect(code).map(|row| row.is_active),
    );
    let caste_codes = c.codes(
        "caste_codes",
        &body.caste_codes,
        &stored_codes(ctx, |p| &p.caste_codes),
        limits::CASTES_MAX,
        |code| {
            reference
                .caste(code)
                .filter(|row| row.parent_code.is_none())
                .map(|row| row.is_active)
        },
    );
    let mother_tongue_codes = c.codes(
        "mother_tongue_codes",
        &body.mother_tongue_codes,
        &stored_codes(ctx, |p| &p.mother_tongue_codes),
        usize::MAX,
        |code| reference.language(code).map(|row| row.is_active),
    );
    let country_codes = c.codes(
        "country_codes",
        &body.country_codes,
        &stored_codes(ctx, |p| &p.country_codes),
        limits::COUNTRIES_MAX,
        |code| reference.country(code).map(|row| row.is_active),
    );
    let profession_codes = c.codes(
        "profession_codes",
        &body.profession_codes,
        &stored_codes(ctx, |p| &p.profession_codes),
        limits::PROFESSIONS_MAX,
        |code| reference.profession(code).map(|row| row.is_active),
    );

    // Rule 6: places must exist and sit inside the selected countries. A list over its limit
    // is refused without looking at its places.
    let region_ids = dedupe(&body.region_ids);
    if region_ids.len() > limits::REGIONS_MAX {
        c.fail("region_ids", FieldCode::TooLong);
    } else {
        check_places(
            &mut c,
            "region_ids",
            &region_ids,
            &geo.region_countries,
            &country_codes,
        );
    }
    let city_ids = dedupe(&body.city_ids);
    if city_ids.len() > limits::CITIES_MAX {
        c.fail("city_ids", FieldCode::TooLong);
    } else {
        check_places(
            &mut c,
            "city_ids",
            &city_ids,
            &geo.city_countries,
            &country_codes,
        );
    }

    // Minimum ranks of the ordered lists.
    let education_min_rank = body.education_min_rank;
    if let Some(rank) = education_min_rank
        && !rank_is_valid(
            rank,
            reference
                .education_levels
                .iter()
                .map(|level| (level.rank, level.is_active)),
            ctx.stored.and_then(|p| p.education_min_rank),
        )
    {
        c.fail("education_min_rank", FieldCode::UnknownCode);
    }
    let income_min_rank = body.income_min_rank;
    if let Some(rank) = income_min_rank
        && !rank_is_valid(
            rank,
            reference
                .income_bands
                .iter()
                .map(|band| (band.rank, band.is_active)),
            ctx.stored.and_then(|p| p.income_min_rank),
        )
    {
        c.fail("income_min_rank", FieldCode::UnknownCode);
    }

    // Rule 5: only the list of the other gender's appearance applies.
    let hijab_types: Vec<Hijab> = if ctx.gender == Some(Gender::Female) {
        Vec::new()
    } else {
        dedupe(&body.hijab_types)
    };
    let beard_types: Vec<Beard> = if ctx.gender == Some(Gender::Male) {
        Vec::new()
    } else {
        dedupe(&body.beard_types)
    };

    // Rule 8.
    let notes = c.text(TextField::PartnerNotes, body.notes.as_deref());
    let stored_notes = ctx.stored.and_then(|p| p.notes.as_deref());
    let notes_status =
        text_status_after_save(stored_notes, ctx.stored_notes_status, notes.as_deref());

    c.finish()?;
    Ok(PreferencesPlan {
        preferences: Preferences {
            marital_statuses,
            religion_codes,
            sect_codes,
            caste_codes,
            mother_tongue_codes,
            country_codes,
            region_ids,
            city_ids,
            profession_codes,
            employment_types: dedupe(&body.employment_types),
            religiosity_levels: dedupe(&body.religiosity_levels),
            hijab_types,
            beard_types,
            family_values: dedupe(&body.family_values),
            family_types: dedupe(&body.family_types),
            living_arrangements: dedupe(&body.living_arrangements),
            work_after_marriage_options: dedupe(&body.work_after_marriage_options),
            smoking_options: dedupe(&body.smoking_options),
            notes,
            ..*body
        },
        notes_status,
    })
}

/// `region_ids` or `city_ids`: each id exists (`unknown_code`) and, when countries are
/// selected, belongs to one of them (`mismatch`).
fn check_places(
    c: &mut Checker,
    field: &str,
    ids: &[i32],
    countries: &HashMap<i32, String>,
    selected: &[String],
) {
    for id in ids {
        match countries.get(id) {
            None => {
                c.fail(field, FieldCode::UnknownCode);
                return;
            }
            Some(country) if !selected.is_empty() && !selected.contains(country) => {
                c.fail(field, FieldCode::Mismatch);
                return;
            }
            Some(_) => {}
        }
    }
}

/// The preferences a profile has before it saves any (07 section 12).
fn defaults_for(row: &ProfileRow, now: OffsetDateTime) -> Preferences {
    default_preferences(&DefaultsInput {
        gender: row.basics.gender,
        age: row.date_of_birth().map(|date| age_now(date, now)),
        marital_status: row.basics.marital_status,
        religion_code: row.community.religion_code.as_deref(),
        country_code: row.location.country_code.as_deref(),
    })
}

/// The partner preferences: the stored row, or the computed defaults (07 section 12) until the
/// first `PUT`.
#[utoipa::path(
    get,
    path = "/me/preferences",
    tag = "profile",
    security(("bearer" = [])),
    responses((status = 200, body = Preferences), (status = 403, body = ErrorBody))
)]
pub async fn get_preferences(
    State(state): State<AppState>,
    account: Open,
) -> ApiResult<Json<Preferences>> {
    let mut conn = state.db.acquire().await?;
    if let Some(stored) = sql::load(&mut conn, account.profile_id).await? {
        return Ok(Json(stored));
    }
    let row = profiles::load_profile(&mut conn, account.profile_id, false).await?;
    Ok(Json(defaults_for(&row, OffsetDateTime::now_utc())))
}

/// Replace the partner preferences. Creates the row when it is missing, validates codes, ranges
/// and array sizes, sets `match_stale`, and holds a changed `notes` text for review (13 section
/// 3.7). Returns what was stored.
#[utoipa::path(
    put,
    path = "/me/preferences",
    tag = "profile",
    security(("bearer" = [])),
    request_body = Preferences,
    responses(
        (status = 200, body = Preferences),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn put_preferences(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<Preferences>,
) -> ApiResult<Json<Preferences>> {
    let reference = state.reference.get();
    let mut tx = state.db.begin().await?;
    let row = profiles::load_profile(&mut tx, account.profile_id, true).await?;
    let stored = sql::load(&mut tx, account.profile_id).await?;

    // Only lists within their limits are looked up; the others are refused by the validation.
    let region_ids: &[i32] = if body.region_ids.len() > limits::REGIONS_MAX {
        &[]
    } else {
        &body.region_ids
    };
    let city_ids: &[i32] = if body.city_ids.len() > limits::CITIES_MAX {
        &[]
    } else {
        &body.city_ids
    };
    let geo = PreferenceGeo {
        region_countries: profiles::region_countries(&mut tx, region_ids).await?,
        city_countries: profiles::city_facts(&mut tx, city_ids)
            .await?
            .into_iter()
            .map(|(id, city)| (id, city.country_code))
            .collect(),
    };
    let ctx = PreferenceCtx {
        reference: &reference,
        gender: row.basics.gender,
        stored: stored.as_ref(),
        stored_notes_status: row.notes_status,
    };
    let plan = plan_preferences(&ctx, &body, &geo)?;

    sql::upsert(&mut tx, row.id, &plan.preferences, plan.notes_status).await?;
    sqlx::query("UPDATE profiles SET match_stale = true WHERE id = $1")
        .bind(row.id)
        .execute(&mut *tx)
        .await?;
    let notes_changed =
        plan.preferences.notes.as_deref() != stored.as_ref().and_then(|p| p.notes.as_deref());
    let enqueue_job = plan.notes_status == TextStatus::Pending && notes_changed;
    if enqueue_job {
        profiles::enqueue_text_moderation(&mut tx, row.id, ModeratedText::PartnerNotes).await?;
    }
    profiles::recompute_completeness(&mut tx, row.id).await?;
    tx.commit().await?;

    if enqueue_job {
        state.jobs.wake();
    }
    Ok(Json(plan.preferences))
}

/// The privacy settings (09 section 3).
#[utoipa::path(
    get,
    path = "/me/privacy",
    tag = "profile",
    security(("bearer" = [])),
    responses((status = 200, body = Privacy), (status = 403, body = ErrorBody))
)]
pub async fn get_privacy(State(state): State<AppState>, account: Open) -> ApiResult<Json<Privacy>> {
    let mut conn = state.db.acquire().await?;
    Ok(Json(
        sql::load_privacy(&mut conn, account.profile_id, false).await?,
    ))
}

/// Change some privacy settings. Takes effect immediately for every viewer. Changing the
/// visibility of caste, income or family marks the recommendations stale (10 section 8.2).
/// Returns the full settings.
#[utoipa::path(
    patch,
    path = "/me/privacy",
    tag = "profile",
    security(("bearer" = [])),
    request_body = PrivacyPatch,
    responses(
        (status = 200, body = Privacy),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn patch_privacy(
    State(state): State<AppState>,
    account: Open,
    ApiJson(patch): ApiJson<PrivacyPatch>,
) -> ApiResult<Json<Privacy>> {
    let mut tx = state.db.begin().await?;
    let current = sql::load_privacy(&mut tx, account.profile_id, true).await?;
    if patch.is_empty() {
        return Ok(Json(current));
    }
    let updated = patch.apply(current);
    // A patch is written even when it changes nothing: `updated_at` is how the profile tells
    // that the owner has made a choice (09 section 3.5 rule 2).
    sql::write_privacy(&mut tx, account.profile_id, &updated).await?;
    let matchable_changed = updated.caste_visibility != current.caste_visibility
        || updated.income_visibility != current.income_visibility
        || updated.family_visibility != current.family_visibility;
    if matchable_changed {
        sqlx::query("UPDATE profiles SET match_stale = true WHERE id = $1")
            .bind(account.profile_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(updated))
}
