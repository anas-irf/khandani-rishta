//! `app_settings` as the admin console reads and writes it (18 section 7.1).

use std::collections::HashMap;

use serde_json::{Value, json};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::types::AuditTargetType;
use crate::error::ApiError;
use crate::state::AppState;

/// A stored row with the email of whoever last changed it.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct StoredSetting {
    pub key: String,
    pub value: Value,
    pub updated_by_email: Option<String>,
    pub updated_at: OffsetDateTime,
}

/// Every stored row by key. Keys without a row use their default.
pub async fn stored(db: &PgPool) -> sqlx::Result<HashMap<String, StoredSetting>> {
    let rows: Vec<StoredSetting> = sqlx::query_as(
        "SELECT s.key, s.value, u.email AS updated_by_email, s.updated_at
         FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by",
    )
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|row| (row.key.clone(), row)).collect())
}

/// Upserts one value and writes the audit row (`setting.update`, `{ from, to }`) in one
/// transaction. `default` is what `from` shows when no row existed. Refreshes the settings
/// cache at once, and drops every account snapshot when a legal version changed (the consent
/// gate depends on them).
pub async fn put(
    state: &AppState,
    actor: Uuid,
    key: &str,
    value: &Value,
    default: &Value,
) -> Result<(), ApiError> {
    let mut tx = state.db.begin().await?;
    let previous: Option<Value> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1 FOR UPDATE")
            .bind(key)
            .fetch_optional(&mut *tx)
            .await?;
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "setting.update",
        AuditTargetType::AppSetting,
        key,
        json!({ "from": previous.as_ref().unwrap_or(default), "to": value }),
    )
    .await?;
    tx.commit().await?;

    state.settings.invalidate();
    if key.starts_with("legal.") {
        state.accounts.invalidate_all();
    }
    Ok(())
}
