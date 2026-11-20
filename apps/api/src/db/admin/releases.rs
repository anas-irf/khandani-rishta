//! Android release records (18 section 7.2). Rows are never edited or deleted.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::types::AuditTargetType;
use crate::error::{ApiError, FieldCode, FieldErrors};
use crate::models::admin::AdminRelease;
use crate::state::AppState;

static VERSION_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$").expect("valid regex"));

const DOWNLOAD_PREFIX: &str = "https://download.";
const MAX_URL_CHARS: usize = 500;
const MAX_NOTES_CHARS: usize = 1000;

/// A release to record.
#[derive(Debug, Clone)]
pub struct NewRelease {
    pub version_code: i32,
    pub version_name: String,
    pub min_supported_version_code: i32,
    pub download_url: String,
    pub release_notes: Option<String>,
}

/// Every release, newest first.
pub async fn list(db: &PgPool) -> sqlx::Result<Vec<AdminRelease>> {
    sqlx::query_as(
        "SELECT id, platform, version_code, version_name, min_supported_version_code,
                download_url, release_notes, released_at
         FROM app_releases ORDER BY version_code DESC",
    )
    .fetch_all(db)
    .await
}

/// Records a release that CI has already uploaded. `version_code` must be greater than every
/// existing one, `min_supported_version_code` not greater than `version_code` and not lower
/// than the current minimum, and the download URL must start with `https://download.`.
/// The cached latest release is cleared after the commit.
pub async fn publish(
    state: &AppState,
    actor: Uuid,
    new: &NewRelease,
) -> Result<AdminRelease, ApiError> {
    let mut errors = FieldErrors::new();
    let version_name = new.version_name.trim();
    if version_name.is_empty() {
        errors.add("version_name", FieldCode::Required);
    } else if !VERSION_NAME.is_match(version_name) {
        errors.add("version_name", FieldCode::Invalid);
    }
    let url = new.download_url.trim();
    if !url.starts_with(DOWNLOAD_PREFIX)
        || url.len() == DOWNLOAD_PREFIX.len()
        || url.chars().count() > MAX_URL_CHARS
        || url.chars().any(char::is_whitespace)
    {
        errors.add("download_url", FieldCode::Invalid);
    }
    let notes = new
        .release_notes
        .as_deref()
        .map(str::trim)
        .filter(|notes| !notes.is_empty());
    if notes.is_some_and(|notes| notes.chars().count() > MAX_NOTES_CHARS) {
        errors.add("release_notes", FieldCode::TooLong);
    }
    if new.version_code < 1 {
        errors.add("version_code", FieldCode::OutOfRange);
    }
    if new.min_supported_version_code > new.version_code || new.min_supported_version_code < 1 {
        errors.add("min_supported_version_code", FieldCode::OutOfRange);
    }

    let mut tx = state.db.begin().await?;
    // Two releases published at once take turns, so the ordering rules hold.
    sqlx::query("LOCK TABLE app_releases IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    let (newest, minimum): (Option<i32>, Option<i32>) = sqlx::query_as(
        "SELECT max(version_code), max(min_supported_version_code)
         FROM app_releases WHERE platform = 'android'",
    )
    .fetch_one(&mut *tx)
    .await?;
    if newest.is_some_and(|newest| new.version_code <= newest) {
        errors.add("version_code", FieldCode::OutOfRange);
    }
    if minimum.is_some_and(|minimum| new.min_supported_version_code < minimum) {
        errors.add("min_supported_version_code", FieldCode::OutOfRange);
    }
    errors.finish()?;

    let release: AdminRelease = sqlx::query_as(
        "INSERT INTO app_releases
             (platform, version_code, version_name, min_supported_version_code, download_url, release_notes)
         VALUES ('android', $1, $2, $3, $4, $5)
         RETURNING id, platform, version_code, version_name, min_supported_version_code,
                   download_url, release_notes, released_at",
    )
    .bind(new.version_code)
    .bind(version_name)
    .bind(new.min_supported_version_code)
    .bind(url)
    .bind(notes)
    .fetch_one(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "release.create",
        AuditTargetType::AppRelease,
        &release.id.to_string(),
        json!({
            "version_code": release.version_code,
            "min_supported_version_code": release.min_supported_version_code,
        }),
    )
    .await?;
    tx.commit().await?;
    state.releases.invalidate();
    Ok(release)
}
