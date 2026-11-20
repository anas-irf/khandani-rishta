//! Caste suggestions and the caste list (18 section 6, 05 section 13).
//!
//! Every function that changes a caste reloads the reference cache after the commit
//! (`state.reference.reload()`), so the pickers show the change at once.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, json};
use sqlx::PgPool;
use sqlx::types::Json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::types::{AuditTargetType, CasteSuggestionStatus};
use crate::error::{ApiError, FieldCode, FieldErrors};
use crate::models::admin::{AdminCaste, CasteSimilar, CasteSuggestionItem, PromotedCaste};
use crate::reference::normalize_name;
use crate::state::AppState;

static CODE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new("^[a-z][a-z0-9_]*$").expect("valid regex"));

const MAX_CODE_CHARS: usize = 60;
const MAX_NAME_CHARS: usize = 60;
const MAX_ALIASES: usize = 20;

// ---- Suggestions ----

#[derive(Debug, sqlx::FromRow)]
pub struct SuggestionRow {
    id: Uuid,
    name: String,
    normalized_name: String,
    parent_code: Option<String>,
    parent_name: Option<String>,
    usage_count: i32,
    status: CasteSuggestionStatus,
    created_at: OffsetDateTime,
    similar: Json<Vec<CasteSimilar>>,
}

impl SuggestionRow {
    /// The keyset of the list: `(usage_count, id)`.
    pub fn cursor(&self) -> (i32, Uuid) {
        (self.usage_count, self.id)
    }

    pub fn item(self) -> CasteSuggestionItem {
        CasteSuggestionItem {
            id: self.id,
            name: self.name,
            normalized_name: self.normalized_name,
            parent_code: self.parent_code,
            parent_name: self.parent_name,
            usage_count: self.usage_count,
            status: self.status,
            similar: self.similar.0,
            created_at: self.created_at,
        }
    }
}

const SUGGESTION_SELECT: &str = "SELECT s.id, s.name, s.normalized_name, s.parent_code,
        pc.name AS parent_name, s.usage_count, s.status, s.created_at,
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) ORDER BY c.name)
            FROM castes c
            WHERE c.is_active
              AND (similarity(lower(c.name), s.normalized_name) >= 0.4
                   OR EXISTS (SELECT 1 FROM unnest(c.aliases) a
                               WHERE similarity(lower(a), s.normalized_name) >= 0.4))
        ), '[]'::jsonb) AS similar
     FROM caste_suggestions s
     LEFT JOIN castes pc ON pc.code = s.parent_code";

/// Suggestions of one status by usage, most used first. Fetches `limit + 1` rows.
pub async fn suggestions(
    db: &PgPool,
    status: CasteSuggestionStatus,
    cursor: Option<(i32, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<SuggestionRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SUGGESTION_SELECT}
         WHERE s.status = $1
           AND ($2::int IS NULL OR (s.usage_count, s.id) < ($2, $3))
         ORDER BY s.usage_count DESC, s.id DESC LIMIT $4"
    )))
    .bind(status)
    .bind(cursor.map(|(usage, _)| usage))
    .bind(cursor.map(|(_, id)| id))
    .bind(limit + 1)
    .fetch_all(db)
    .await
}

pub async fn suggestion(db: &PgPool, id: Uuid) -> sqlx::Result<Option<SuggestionRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SUGGESTION_SELECT} WHERE s.id = $1"
    )))
    .bind(id)
    .fetch_optional(db)
    .await
}

/// Rejects a pending suggestion (18 section 6.1).
pub async fn reject(state: &AppState, actor: Uuid, id: Uuid) -> Result<(), ApiError> {
    let mut tx = state.db.begin().await?;
    let current: Option<(String, CasteSuggestionStatus)> =
        sqlx::query_as("SELECT name, status FROM caste_suggestions WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((name, status)) = current else {
        return Err(ApiError::NotFound);
    };
    if status != CasteSuggestionStatus::Pending {
        return Err(ApiError::invalid_state(status));
    }
    sqlx::query("UPDATE caste_suggestions SET status = 'rejected' WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "caste_suggestion.reject",
        AuditTargetType::CasteSuggestion,
        &id.to_string(),
        json!({ "name": name }),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

// ---- Castes ----

pub async fn list_castes(db: &PgPool) -> sqlx::Result<Vec<AdminCaste>> {
    sqlx::query_as(
        "SELECT code, parent_code, name, name_ur, aliases, sort_order, is_active
         FROM castes ORDER BY COALESCE(parent_code, code), parent_code NULLS FIRST, sort_order, name",
    )
    .fetch_all(db)
    .await
}

pub async fn get_caste(db: &PgPool, code: &str) -> sqlx::Result<Option<AdminCaste>> {
    sqlx::query_as(
        "SELECT code, parent_code, name, name_ur, aliases, sort_order, is_active
         FROM castes WHERE code = $1",
    )
    .bind(code)
    .fetch_optional(db)
    .await
}

/// A caste to insert.
#[derive(Debug, Default, Clone)]
pub struct NewCaste {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub parent_code: Option<String>,
    pub aliases: Vec<String>,
    pub sort_order: Option<i32>,
}

fn clean_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Trims, collapses whitespace and drops duplicates (after normalising) from alias lists.
fn clean_aliases(aliases: &[String], errors: &mut FieldErrors) -> Vec<String> {
    let mut cleaned: Vec<String> = Vec::new();
    for alias in aliases {
        let alias = clean_text(alias);
        let length = alias.chars().count();
        if !(2..=MAX_NAME_CHARS).contains(&length) {
            errors.add("aliases", FieldCode::Invalid);
            continue;
        }
        if !cleaned
            .iter()
            .any(|existing| normalize_name(existing) == normalize_name(&alias))
        {
            cleaned.push(alias);
        }
    }
    if cleaned.len() > MAX_ALIASES {
        errors.add("aliases", FieldCode::TooLong);
    }
    cleaned
}

fn check_name(name: &str, errors: &mut FieldErrors) -> String {
    let name = clean_text(name);
    match name.chars().count() {
        0..=1 => errors.add("name", FieldCode::TooShort),
        2..=MAX_NAME_CHARS => {}
        _ => errors.add("name", FieldCode::TooLong),
    }
    name
}

/// Validates a new caste (18 section 6.1 rules) and returns the cleaned value.
/// Field problems answer `400 validation_failed`; a code in use answers `409 already_exists`.
async fn validate_new(tx: &mut sqlx::PgConnection, new: &NewCaste) -> Result<NewCaste, ApiError> {
    let mut errors = FieldErrors::new();
    let code = new.code.trim().to_owned();
    if code.is_empty() || code.chars().count() > MAX_CODE_CHARS || !CODE_PATTERN.is_match(&code) {
        errors.add("code", FieldCode::Invalid);
    }
    let name = check_name(&new.name, &mut errors);
    let name_ur = new
        .name_ur
        .as_deref()
        .map(clean_text)
        .filter(|text| !text.is_empty());
    if name_ur
        .as_ref()
        .is_some_and(|text| text.chars().count() > MAX_NAME_CHARS)
    {
        errors.add("name_ur", FieldCode::TooLong);
    }
    let aliases = clean_aliases(&new.aliases, &mut errors);
    if new
        .sort_order
        .is_some_and(|order| !(0..=100_000).contains(&order))
    {
        errors.add("sort_order", FieldCode::OutOfRange);
    }
    let parent_code = new
        .parent_code
        .as_deref()
        .map(str::trim)
        .filter(|parent| !parent.is_empty())
        .map(str::to_owned);
    if let Some(parent) = &parent_code {
        let row: Option<Option<String>> =
            sqlx::query_scalar("SELECT parent_code FROM castes WHERE code = $1")
                .bind(parent)
                .fetch_optional(&mut *tx)
                .await?;
        match row {
            None => errors.add("parent_code", FieldCode::UnknownCode),
            // Two levels only.
            Some(Some(_)) => errors.add("parent_code", FieldCode::Invalid),
            Some(None) => {
                if !code.starts_with(&format!("{parent}_")) {
                    errors.add("code", FieldCode::Invalid);
                }
            }
        }
    }
    errors.finish()?;

    let taken: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM castes WHERE code = $1)")
        .bind(&code)
        .fetch_one(&mut *tx)
        .await?;
    if taken {
        return Err(ApiError::AlreadyExists);
    }
    Ok(NewCaste {
        code,
        name,
        name_ur,
        parent_code,
        aliases,
        sort_order: new.sort_order,
    })
}

async fn insert_caste(tx: &mut sqlx::PgConnection, new: &NewCaste) -> Result<AdminCaste, ApiError> {
    Ok(sqlx::query_as(
        "INSERT INTO castes (code, parent_code, name, name_ur, aliases, sort_order)
         VALUES ($1, $2, $3, $4, $5,
                 COALESCE($6, (SELECT max(sort_order) + 10 FROM castes
                                WHERE parent_code IS NOT DISTINCT FROM $2), 100))
         RETURNING code, parent_code, name, name_ur, aliases, sort_order, is_active",
    )
    .bind(&new.code)
    .bind(&new.parent_code)
    .bind(&new.name)
    .bind(&new.name_ur)
    .bind(&new.aliases)
    .bind(new.sort_order)
    .fetch_one(&mut *tx)
    .await?)
}

/// Adds a caste or sub-caste (18 section 6.2).
pub async fn create(state: &AppState, actor: Uuid, new: &NewCaste) -> Result<AdminCaste, ApiError> {
    let mut tx = state.db.begin().await?;
    let new = validate_new(&mut tx, new).await?;
    let caste = insert_caste(&mut tx, &new).await?;
    crate::audit::record(
        &mut tx,
        actor,
        "caste.create",
        AuditTargetType::Caste,
        &caste.code,
        json!({ "name": caste.name, "parent_code": caste.parent_code }),
    )
    .await?;
    tx.commit().await?;
    reload_reference(state).await;
    Ok(caste)
}

/// The fields `PATCH /v1/admin/castes/{code}` may change. Codes never change.
#[derive(Debug, Default)]
pub struct CastePatch {
    pub name: Option<String>,
    /// An empty string clears the Urdu name.
    pub name_ur: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub sort_order: Option<i32>,
    pub is_active: Option<bool>,
}

/// Renames, re-orders, changes the aliases of, or (de)activates a caste (18 section 6.2).
/// Deactivating a caste that has active sub-castes answers `409 invalid_state`. When nothing
/// differs from the stored row nothing is written and no audit row is added.
#[allow(clippy::too_many_lines)] // Validation, the diff and the update.
pub async fn patch(
    state: &AppState,
    actor: Uuid,
    code: &str,
    patch: CastePatch,
) -> Result<AdminCaste, ApiError> {
    let mut tx = state.db.begin().await?;
    let current: Option<AdminCaste> = sqlx::query_as(
        "SELECT code, parent_code, name, name_ur, aliases, sort_order, is_active
         FROM castes WHERE code = $1 FOR UPDATE",
    )
    .bind(code)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(current) = current else {
        return Err(ApiError::NotFound);
    };

    let mut errors = FieldErrors::new();
    let name = patch
        .name
        .as_deref()
        .map(|name| check_name(name, &mut errors));
    let name_ur = patch.name_ur.as_deref().map(clean_text);
    if name_ur
        .as_ref()
        .is_some_and(|text| text.chars().count() > MAX_NAME_CHARS)
    {
        errors.add("name_ur", FieldCode::TooLong);
    }
    let aliases = patch
        .aliases
        .as_ref()
        .map(|aliases| clean_aliases(aliases, &mut errors));
    if patch
        .sort_order
        .is_some_and(|order| !(0..=100_000).contains(&order))
    {
        errors.add("sort_order", FieldCode::OutOfRange);
    }
    errors.finish()?;

    let mut changes = Map::new();
    let mut next = current.clone();
    if let Some(name) = name
        && name != current.name
    {
        changes.insert(
            "name".to_owned(),
            json!({ "from": current.name, "to": name }),
        );
        next.name = name;
    }
    if let Some(text) = name_ur {
        let new_value = (!text.is_empty()).then_some(text);
        if new_value != current.name_ur {
            changes.insert(
                "name_ur".to_owned(),
                json!({ "from": current.name_ur, "to": new_value }),
            );
            next.name_ur = new_value;
        }
    }
    if let Some(aliases) = aliases
        && aliases != current.aliases
    {
        changes.insert(
            "aliases".to_owned(),
            json!({ "from": current.aliases, "to": aliases }),
        );
        next.aliases = aliases;
    }
    if let Some(order) = patch.sort_order
        && order != current.sort_order
    {
        changes.insert(
            "sort_order".to_owned(),
            json!({ "from": current.sort_order, "to": order }),
        );
        next.sort_order = order;
    }
    if let Some(active) = patch.is_active
        && active != current.is_active
    {
        if !active {
            let active_children: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM castes WHERE parent_code = $1 AND is_active)",
            )
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;
            if active_children {
                return Err(ApiError::InvalidState {
                    details: json!({ "reason": "has_active_sub_castes" }),
                });
            }
        }
        changes.insert(
            "is_active".to_owned(),
            json!({ "from": current.is_active, "to": active }),
        );
        next.is_active = active;
    }
    if changes.is_empty() {
        return Ok(current);
    }

    sqlx::query(
        "UPDATE castes SET name = $2, name_ur = $3, aliases = $4, sort_order = $5, is_active = $6
         WHERE code = $1",
    )
    .bind(code)
    .bind(&next.name)
    .bind(&next.name_ur)
    .bind(&next.aliases)
    .bind(next.sort_order)
    .bind(next.is_active)
    .execute(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "caste.update",
        AuditTargetType::Caste,
        code,
        json!({ "changes": changes }),
    )
    .await?;
    tx.commit().await?;
    reload_reference(state).await;
    Ok(next)
}

/// Promotes a suggestion to a caste (18 section 6.1, 05 section 13): inserts the row, marks the
/// suggestion `promoted`, and rewrites every profile whose typed caste normalises to the
/// suggestion's name from free text to the new code.
///
/// A top-level suggestion rewrites `caste_other`. A sub-caste suggestion (with a parent)
/// rewrites `sub_caste_other` of the profiles whose `caste_code` is that parent. A `parent_code`
/// in the body must agree with the suggestion's own parent; when it is left out, the
/// suggestion's parent is used.
#[allow(clippy::too_many_lines)] // One transaction: validate, insert, rewrite, audit.
pub async fn promote(
    state: &AppState,
    actor: Uuid,
    suggestion_id: Uuid,
    new: &NewCaste,
) -> Result<PromotedCaste, ApiError> {
    let mut tx = state.db.begin().await?;
    let suggestion: Option<(String, Option<String>, CasteSuggestionStatus)> = sqlx::query_as(
        "SELECT normalized_name, parent_code, status
         FROM caste_suggestions WHERE id = $1 FOR UPDATE",
    )
    .bind(suggestion_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((normalized_name, suggested_parent, status)) = suggestion else {
        return Err(ApiError::NotFound);
    };
    if status != CasteSuggestionStatus::Pending {
        return Err(ApiError::invalid_state(status));
    }
    let requested_parent = new
        .parent_code
        .as_deref()
        .map(str::trim)
        .filter(|parent| !parent.is_empty());
    if requested_parent.is_some() && requested_parent != suggested_parent.as_deref() {
        return Err(ApiError::field("parent_code", FieldCode::Mismatch));
    }
    let mut new = new.clone();
    new.parent_code.clone_from(&suggested_parent);
    let new = validate_new(&mut tx, &new).await?;
    let caste = insert_caste(&mut tx, &new).await?;

    // Profiles whose typed value normalises to the suggestion's name.
    let candidates: Vec<(Uuid, String)> = match &suggested_parent {
        None => {
            sqlx::query_as(
                "SELECT id, caste_other FROM profiles
                 WHERE caste_other IS NOT NULL AND caste_code IS NULL",
            )
            .fetch_all(&mut *tx)
            .await?
        }
        Some(parent) => {
            sqlx::query_as(
                "SELECT id, sub_caste_other FROM profiles
                 WHERE sub_caste_other IS NOT NULL AND sub_caste_code IS NULL AND caste_code = $1",
            )
            .bind(parent)
            .fetch_all(&mut *tx)
            .await?
        }
    };
    let ids: Vec<Uuid> = candidates
        .into_iter()
        .filter(|(_, typed)| normalize_name(typed) == normalized_name)
        .map(|(id, _)| id)
        .collect();
    let updated = if ids.is_empty() {
        0
    } else if suggested_parent.is_none() {
        sqlx::query(
            "UPDATE profiles SET caste_code = $2, caste_other = NULL, match_stale = true
             WHERE id = ANY($1)",
        )
        .bind(&ids)
        .bind(&caste.code)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE profiles SET sub_caste_code = $2, sub_caste_other = NULL, match_stale = true
             WHERE id = ANY($1)",
        )
        .bind(&ids)
        .bind(&caste.code)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    };
    let profiles_updated = i64::try_from(updated).unwrap_or(i64::MAX);

    sqlx::query(
        "UPDATE caste_suggestions SET status = 'promoted', promoted_code = $2 WHERE id = $1",
    )
    .bind(suggestion_id)
    .bind(&caste.code)
    .execute(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "caste_suggestion.promote",
        AuditTargetType::CasteSuggestion,
        &suggestion_id.to_string(),
        json!({ "code": caste.code, "profiles_updated": profiles_updated }),
    )
    .await?;
    tx.commit().await?;
    reload_reference(state).await;
    Ok(PromotedCaste {
        caste,
        profiles_updated,
    })
}

async fn reload_reference(state: &AppState) {
    if let Err(error) = state.reference.reload().await {
        tracing::warn!(%error, "reference data reload failed after a caste change");
    }
}
