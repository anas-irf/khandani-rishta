//! Operational settings from `app_settings`, with the defaults of 03 section 7 coded here.
//!
//! The table is read as a whole and cached for 60 seconds. A missing key or a value of the wrong
//! type falls back to the coded default, so the product never depends on the seed.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use utoipa::ToSchema;

/// How long a loaded copy of the settings is used before reading the table again.
const CACHE_TTL: Duration = Duration::from_secs(60);

/// `"auto"` or `"manual"` review for profiles, photos and texts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewMode {
    Auto,
    Manual,
}

/// The optional home-screen banner (`announcement.banner`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AnnouncementBanner {
    pub text_en: String,
    pub text_ur: Option<String>,
    pub url: Option<String>,
}

/// Every setting of 03 section 7, typed.
#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::struct_excessive_bools)]
pub struct AppSettings {
    pub interests_per_day: i64,
    pub interests_per_day_verified: i64,
    pub pending_interests_max: i64,
    pub profile_views_per_day: i64,
    pub photo_requests_per_day: i64,
    pub messages_per_minute: i64,
    pub messages_per_day: i64,
    pub reports_per_day: i64,
    pub photos_max: i64,
    pub saved_searches_max: i64,
    pub active_connections_max: i64,
    pub interest_expiry_days: i64,
    pub cooldown_after_decline_days: i64,
    pub cooldown_after_expiry_days: i64,
    pub cooldown_after_withdraw_days: i64,
    pub connection_cooldown_after_end_days: i64,
    pub pass_duration_days: i64,
    pub photo_access_retry_days: i64,
    pub profile_review: ReviewMode,
    pub photo_review: ReviewMode,
    pub text_review: ReviewMode,
    pub identity_required: bool,
    pub photo_required: bool,
    pub candidate_pool_size: i64,
    pub recommendations_size: i64,
    pub refresh_hours: i64,
    pub deletion_grace_days: i64,
    pub media_retention_days: i64,
    pub terms_version: String,
    pub privacy_version: String,
    pub guidelines_version: String,
    pub support_email: String,
    pub announcement_banner: Option<AnnouncementBanner>,
}

/// Keys and coded defaults, in the order of 03 section 7.
pub fn defaults() -> Vec<(&'static str, Value)> {
    vec![
        ("limits.interests_per_day", json!(10)),
        ("limits.interests_per_day_verified", json!(20)),
        ("limits.pending_interests_max", json!(50)),
        ("limits.profile_views_per_day", json!(150)),
        ("limits.photo_requests_per_day", json!(10)),
        ("limits.messages_per_minute", json!(20)),
        ("limits.messages_per_day", json!(500)),
        ("limits.reports_per_day", json!(10)),
        ("limits.photos_max", json!(6)),
        ("limits.saved_searches_max", json!(10)),
        ("limits.active_connections_max", json!(30)),
        ("interest.expiry_days", json!(21)),
        ("interest.cooldown_after_decline_days", json!(90)),
        ("interest.cooldown_after_expiry_days", json!(30)),
        ("interest.cooldown_after_withdraw_days", json!(7)),
        ("connection.cooldown_after_end_days", json!(90)),
        ("pass.duration_days", json!(180)),
        ("photo_access.retry_days", json!(30)),
        ("moderation.profile_review", json!("auto")),
        ("moderation.photo_review", json!("manual")),
        ("moderation.text_review", json!("auto")),
        ("onboarding.identity_required", json!(true)),
        ("onboarding.photo_required", json!(false)),
        ("matching.candidate_pool_size", json!(600)),
        ("matching.recommendations_size", json!(200)),
        ("matching.refresh_hours", json!(24)),
        ("account.deletion_grace_days", json!(30)),
        ("verification.media_retention_days", json!(30)),
        ("legal.terms_version", json!("2026-11-20")),
        ("legal.privacy_version", json!("2026-11-20")),
        ("legal.guidelines_version", json!("2026-11-20")),
        ("support.email", json!("support@khandanirishta.app")),
        ("announcement.banner", Value::Null),
    ]
}

/// Checks that a value has the type of the key's default, for `PUT /v1/admin/settings/{key}`.
/// Returns an English reason on failure.
pub fn validate(key: &str, value: &Value) -> Result<(), String> {
    let Some((_, default)) = defaults().into_iter().find(|(k, _)| *k == key) else {
        return Err(format!("unknown setting {key:?}"));
    };
    match (key, &default) {
        ("announcement.banner", _) => {
            if value.is_null() {
                return Ok(());
            }
            let banner: AnnouncementBanner = serde_json::from_value(value.clone())
                .map_err(|_| "expected null or { text_en, text_ur, url }".to_owned())?;
            if banner.text_en.trim().is_empty() {
                return Err("text_en must not be empty".to_owned());
            }
            Ok(())
        }
        (k, Value::String(_)) if k.starts_with("moderation.") => match value.as_str() {
            Some("auto" | "manual") => Ok(()),
            _ => Err("expected \"auto\" or \"manual\"".to_owned()),
        },
        (_, Value::String(_)) => match value.as_str() {
            Some(text) if !text.trim().is_empty() => Ok(()),
            _ => Err("expected a non-empty string".to_owned()),
        },
        (_, Value::Bool(_)) => value
            .is_boolean()
            .then_some(())
            .ok_or_else(|| "expected true or false".to_owned()),
        (_, Value::Number(_)) => match value.as_i64() {
            Some(n) if n >= 0 => Ok(()),
            _ => Err("expected a whole number of 0 or more".to_owned()),
        },
        _ => Err("unsupported setting type".to_owned()),
    }
}

impl AppSettings {
    /// Builds the typed settings from stored rows, falling back to defaults key by key.
    pub fn from_rows(rows: &HashMap<String, Value>) -> Self {
        let defaults: HashMap<&str, Value> = defaults().into_iter().collect();
        let value = |key: &str| -> Value {
            match rows.get(key) {
                Some(stored) if validate(key, stored).is_ok() => stored.clone(),
                Some(_) => {
                    tracing::warn!(key, "app setting has an invalid value; using the default");
                    defaults[key].clone()
                }
                None => defaults[key].clone(),
            }
        };
        let int = |key: &str| value(key).as_i64().unwrap_or_default();
        let boolean = |key: &str| value(key).as_bool().unwrap_or_default();
        let text = |key: &str| value(key).as_str().unwrap_or_default().to_owned();
        let review = |key: &str| {
            if value(key).as_str() == Some("manual") {
                ReviewMode::Manual
            } else {
                ReviewMode::Auto
            }
        };
        Self {
            interests_per_day: int("limits.interests_per_day"),
            interests_per_day_verified: int("limits.interests_per_day_verified"),
            pending_interests_max: int("limits.pending_interests_max"),
            profile_views_per_day: int("limits.profile_views_per_day"),
            photo_requests_per_day: int("limits.photo_requests_per_day"),
            messages_per_minute: int("limits.messages_per_minute"),
            messages_per_day: int("limits.messages_per_day"),
            reports_per_day: int("limits.reports_per_day"),
            photos_max: int("limits.photos_max"),
            saved_searches_max: int("limits.saved_searches_max"),
            active_connections_max: int("limits.active_connections_max"),
            interest_expiry_days: int("interest.expiry_days"),
            cooldown_after_decline_days: int("interest.cooldown_after_decline_days"),
            cooldown_after_expiry_days: int("interest.cooldown_after_expiry_days"),
            cooldown_after_withdraw_days: int("interest.cooldown_after_withdraw_days"),
            connection_cooldown_after_end_days: int("connection.cooldown_after_end_days"),
            pass_duration_days: int("pass.duration_days"),
            photo_access_retry_days: int("photo_access.retry_days"),
            profile_review: review("moderation.profile_review"),
            photo_review: review("moderation.photo_review"),
            text_review: review("moderation.text_review"),
            identity_required: boolean("onboarding.identity_required"),
            photo_required: boolean("onboarding.photo_required"),
            candidate_pool_size: int("matching.candidate_pool_size"),
            recommendations_size: int("matching.recommendations_size"),
            refresh_hours: int("matching.refresh_hours"),
            deletion_grace_days: int("account.deletion_grace_days"),
            media_retention_days: int("verification.media_retention_days"),
            terms_version: text("legal.terms_version"),
            privacy_version: text("legal.privacy_version"),
            guidelines_version: text("legal.guidelines_version"),
            support_email: text("support.email"),
            announcement_banner: serde_json::from_value(value("announcement.banner")).ok(),
        }
    }

    /// The daily interest limit for a profile (verified profiles get the higher one).
    pub fn interests_limit(&self, verified: bool) -> i64 {
        if verified {
            self.interests_per_day_verified
        } else {
            self.interests_per_day
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self::from_rows(&HashMap::new())
    }
}

/// Cached access to `app_settings`.
pub struct Settings {
    db: PgPool,
    cache: RwLock<Option<(Instant, Arc<AppSettings>)>>,
}

impl Settings {
    pub fn new(db: PgPool) -> Self {
        Self {
            db,
            cache: RwLock::new(None),
        }
    }

    /// The current settings, read from the table at most once every 60 seconds.
    pub async fn get(&self) -> Result<Arc<AppSettings>, sqlx::Error> {
        if let Some((loaded_at, settings)) = self.cache.read().ok().and_then(|guard| guard.clone())
            && loaded_at.elapsed() < CACHE_TTL
        {
            return Ok(settings);
        }
        let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM app_settings")
            .fetch_all(&self.db)
            .await?;
        let settings = Arc::new(AppSettings::from_rows(&rows.into_iter().collect()));
        if let Ok(mut guard) = self.cache.write() {
            *guard = Some((Instant::now(), settings.clone()));
        }
        Ok(settings)
    }

    /// Forgets the cached copy, so the next read sees a change made by an admin at once.
    pub fn invalidate(&self) {
        if let Ok(mut guard) = self.cache.write() {
            *guard = None;
        }
    }

    /// Stores one value (admin route and tests) and invalidates the cache.
    pub async fn put(
        &self,
        key: &str,
        value: &Value,
        updated_by: Option<uuid::Uuid>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
                 updated_by = EXCLUDED.updated_by, updated_at = now()",
        )
        .bind(key)
        .bind(value)
        .bind(updated_by)
        .execute(&self.db)
        .await?;
        self.invalidate();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_keys_use_the_defaults() {
        let settings = AppSettings::default();
        assert_eq!(settings.interests_per_day, 10);
        assert_eq!(settings.interests_per_day_verified, 20);
        assert_eq!(settings.photo_review, ReviewMode::Manual);
        assert_eq!(settings.profile_review, ReviewMode::Auto);
        assert!(settings.identity_required);
        assert!(!settings.photo_required);
        assert_eq!(settings.terms_version, "2026-11-20");
        assert_eq!(settings.announcement_banner, None);
        assert_eq!(settings.interests_limit(true), 20);
    }

    #[test]
    fn invalid_values_fall_back() {
        let rows = HashMap::from([
            ("limits.interests_per_day".to_owned(), json!("ten")),
            ("limits.photos_max".to_owned(), json!(4)),
            ("moderation.photo_review".to_owned(), json!("auto")),
            (
                "announcement.banner".to_owned(),
                json!({ "text_en": "Eid Mubarak", "text_ur": null, "url": null }),
            ),
        ]);
        let settings = AppSettings::from_rows(&rows);
        assert_eq!(settings.interests_per_day, 10);
        assert_eq!(settings.photos_max, 4);
        assert_eq!(settings.photo_review, ReviewMode::Auto);
        assert_eq!(settings.announcement_banner.unwrap().text_en, "Eid Mubarak");
    }

    #[test]
    fn validation_follows_the_default_type() {
        assert!(validate("limits.photos_max", &json!(8)).is_ok());
        assert!(validate("limits.photos_max", &json!(-1)).is_err());
        assert!(validate("limits.photos_max", &json!("8")).is_err());
        assert!(validate("moderation.text_review", &json!("manual")).is_ok());
        assert!(validate("moderation.text_review", &json!("sometimes")).is_err());
        assert!(validate("onboarding.photo_required", &json!(true)).is_ok());
        assert!(validate("legal.terms_version", &json!("")).is_err());
        assert!(validate("announcement.banner", &Value::Null).is_ok());
        assert!(validate("announcement.banner", &json!({ "text_en": "" })).is_err());
        assert!(validate("no.such.key", &json!(1)).is_err());
    }

    #[sqlx::test]
    async fn changed_rows_are_seen_after_invalidation(db: PgPool) {
        let settings = Settings::new(db);
        assert_eq!(settings.get().await.unwrap().photos_max, 6);

        settings
            .put("limits.photos_max", &json!(3), None)
            .await
            .unwrap();
        assert_eq!(settings.get().await.unwrap().photos_max, 3);
    }

    #[sqlx::test]
    async fn the_seed_matches_the_coded_defaults(db: PgPool) {
        let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM app_settings")
            .fetch_all(&db)
            .await
            .unwrap();
        let stored: HashMap<String, Value> = rows.into_iter().collect();
        for (key, default) in defaults() {
            assert_eq!(stored.get(key), Some(&default), "seed for {key}");
        }
        assert_eq!(stored.len(), defaults().len());
    }
}
