//! Staff routes: `app_settings` (15 section 16, 18 section 7.1).

use std::sync::LazyLock;

use axum::Json;
use axum::extract::State;
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use time::Date;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Admin;
use crate::db::admin::settings as db;
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath};
use crate::models::admin::{Items, SettingItem};
use crate::settings::{self, AnnouncementBanner, AppSettings};
use crate::state::AppState;

static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").expect("valid regex"));

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_settings))
        .routes(routes!(put_setting))
}

/// The value stored for a key when it is valid, otherwise the default (what the API applies).
fn effective(key: &str, stored: Option<&db::StoredSetting>, default: &Value) -> Value {
    match stored {
        Some(row) if settings::validate(key, &row.value).is_ok() => row.value.clone(),
        _ => default.clone(),
    }
}

/// Every setting of 03 section 7, whether or not a row exists yet.
#[utoipa::path(
    get,
    path = "/settings",
    tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, body = Items<SettingItem>), (status = 403, body = ErrorBody))
)]
async fn list_settings(
    State(state): State<AppState>,
    _admin: Admin,
) -> ApiResult<Json<Items<SettingItem>>> {
    let stored = db::stored(&state.db).await?;
    let items = settings::defaults()
        .into_iter()
        .map(|(key, default)| {
            let row = stored.get(key);
            SettingItem {
                key: key.to_owned(),
                value: effective(key, row, &default),
                default,
                updated_by_email: row.and_then(|row| row.updated_by_email.clone()),
                updated_at: row.map(|row| row.updated_at),
            }
        })
        .collect();
    Ok(Json(Items { items }))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PutSettingBody {
    /// The new value; its type depends on the key (18 section 7.1).
    #[schema(value_type = Object)]
    pub value: Value,
}

/// An integer in `min..=max`.
fn int_in(value: &Value, min: i64, max: i64) -> Result<i64, FieldCode> {
    let number = value.as_i64().ok_or(FieldCode::Invalid)?;
    if (min..=max).contains(&number) {
        Ok(number)
    } else {
        Err(FieldCode::OutOfRange)
    }
}

/// A `YYYY-MM-DD` date that is not earlier than `current`.
fn legal_version(value: &Value, current: &str) -> Result<(), FieldCode> {
    let text = value.as_str().ok_or(FieldCode::Invalid)?;
    Date::parse(
        text,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .map_err(|_| FieldCode::Invalid)?;
    if text < current {
        return Err(FieldCode::OutOfRange);
    }
    Ok(())
}

fn banner(value: &Value) -> Result<(), FieldCode> {
    if value.is_null() {
        return Ok(());
    }
    let banner: AnnouncementBanner =
        serde_json::from_value(value.clone()).map_err(|_| FieldCode::Invalid)?;
    let length = banner.text_en.trim().chars().count();
    if !(1..=200).contains(&length) {
        return Err(FieldCode::OutOfRange);
    }
    if banner
        .text_ur
        .as_ref()
        .is_some_and(|text| text.chars().count() > 200)
    {
        return Err(FieldCode::TooLong);
    }
    if banner
        .url
        .as_ref()
        .is_some_and(|url| !url.starts_with("https://") || url.chars().count() > 500)
    {
        return Err(FieldCode::Invalid);
    }
    Ok(())
}

/// The ranges and cross-key rules of 18 section 7.1, on top of the type check of
/// [`settings::validate`]. `current` holds the values in force now.
#[allow(clippy::too_many_lines)] // One arm per row of the table.
pub fn validate_value(key: &str, value: &Value, current: &AppSettings) -> Result<(), FieldCode> {
    settings::validate(key, value).map_err(|_| FieldCode::Invalid)?;
    match key {
        "limits.interests_per_day" => {
            let limit = int_in(value, 1, 200)?;
            if limit > current.interests_per_day_verified {
                return Err(FieldCode::OutOfRange);
            }
            Ok(())
        }
        "limits.interests_per_day_verified" => {
            let limit = int_in(value, 1, 200)?;
            if limit < current.interests_per_day {
                return Err(FieldCode::OutOfRange);
            }
            Ok(())
        }
        "limits.pending_interests_max" => int_in(value, 5, 500).map(drop),
        "limits.profile_views_per_day" => int_in(value, 10, 2000).map(drop),
        "limits.photo_requests_per_day" => int_in(value, 1, 100).map(drop),
        "limits.messages_per_minute" => int_in(value, 5, 120).map(drop),
        "limits.messages_per_day" => int_in(value, 50, 5000).map(drop),
        "limits.reports_per_day" | "limits.saved_searches_max" => int_in(value, 1, 50).map(drop),
        "limits.photos_max" => int_in(value, 1, 10).map(drop),
        "limits.active_connections_max" => int_in(value, 5, 200).map(drop),
        "interest.expiry_days" => int_in(value, 3, 90).map(drop),
        "interest.cooldown_after_decline_days"
        | "interest.cooldown_after_expiry_days"
        | "interest.cooldown_after_withdraw_days"
        | "connection.cooldown_after_end_days"
        | "photo_access.retry_days" => int_in(value, 0, 365).map(drop),
        "pass.duration_days" => int_in(value, 7, 730).map(drop),
        "matching.candidate_pool_size" => {
            let size = int_in(value, 100, 2000)?;
            if size < current.recommendations_size {
                return Err(FieldCode::OutOfRange);
            }
            Ok(())
        }
        "matching.recommendations_size" => {
            let size = int_in(value, 20, 500)?;
            if size > current.candidate_pool_size {
                return Err(FieldCode::OutOfRange);
            }
            Ok(())
        }
        "matching.refresh_hours" => int_in(value, 1, 168).map(drop),
        "account.deletion_grace_days" => int_in(value, 1, 90).map(drop),
        "verification.media_retention_days" => int_in(value, 1, 180).map(drop),
        "legal.terms_version" => legal_version(value, &current.terms_version),
        "legal.privacy_version" => legal_version(value, &current.privacy_version),
        "legal.guidelines_version" => legal_version(value, &current.guidelines_version),
        "support.email" => {
            let email = value.as_str().ok_or(FieldCode::Invalid)?;
            if email.chars().count() <= 254 && EMAIL.is_match(email) {
                Ok(())
            } else {
                Err(FieldCode::Invalid)
            }
        }
        "announcement.banner" => banner(value),
        // The review modes and the onboarding switches are fully checked by the type check.
        _ => Ok(()),
    }
}

/// Changes one setting (admin only): validates it, stores it, refreshes the settings cache at
/// once and, for a legal version, drops every account snapshot so members are asked to accept
/// the new document. An unknown key answers `404`.
#[utoipa::path(
    put,
    path = "/settings/{key}",
    tag = "admin",
    security(("bearer" = [])),
    params(("key" = String, Path, description = "Setting key, for example limits.photos_max")),
    request_body = PutSettingBody,
    responses(
        (status = 200, body = SettingItem),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn put_setting(
    State(state): State<AppState>,
    admin: Admin,
    ApiPath(key): ApiPath<String>,
    ApiJson(body): ApiJson<PutSettingBody>,
) -> ApiResult<Json<SettingItem>> {
    let (key, default) = settings::defaults()
        .into_iter()
        .find(|(known, _)| *known == key)
        .ok_or(ApiError::NotFound)?;
    // The settings in force now, read fresh so a change made a moment ago counts.
    state.settings.invalidate();
    let current = state.settings.get().await?;
    validate_value(key, &body.value, &current).map_err(|code| ApiError::field("value", code))?;
    db::put(&state, admin.user_id, key, &body.value, &default).await?;

    let stored = db::stored(&state.db).await?;
    let row = stored.get(key);
    Ok(Json(SettingItem {
        key: key.to_owned(),
        value: effective(key, row, &default),
        default,
        updated_by_email: row.and_then(|row| row.updated_by_email.clone()),
        updated_at: row.map(|row| row.updated_at),
    }))
}

#[cfg(test)]
mod unit_tests {
    use serde_json::json;

    use super::*;

    fn check(key: &str, value: &Value) -> Result<(), FieldCode> {
        validate_value(key, value, &AppSettings::default())
    }

    #[test]
    fn integer_keys_follow_their_ranges() {
        assert_eq!(check("limits.photos_max", &json!(10)), Ok(()));
        assert_eq!(
            check("limits.photos_max", &json!(11)),
            Err(FieldCode::OutOfRange)
        );
        assert_eq!(
            check("limits.photos_max", &json!(0)),
            Err(FieldCode::OutOfRange)
        );
        assert_eq!(
            check("limits.photos_max", &json!("6")),
            Err(FieldCode::Invalid)
        );
        assert_eq!(
            check("interest.cooldown_after_decline_days", &json!(0)),
            Ok(())
        );
        assert_eq!(
            check("interest.cooldown_after_decline_days", &json!(366)),
            Err(FieldCode::OutOfRange)
        );
        assert_eq!(
            check("account.deletion_grace_days", &json!(0)),
            Err(FieldCode::OutOfRange)
        );
    }

    #[test]
    fn related_keys_must_agree() {
        // Defaults: 10 and 20, pool 600 and recommendations 200.
        assert_eq!(
            check("limits.interests_per_day", &json!(25)),
            Err(FieldCode::OutOfRange)
        );
        assert_eq!(check("limits.interests_per_day", &json!(20)), Ok(()));
        assert_eq!(
            check("limits.interests_per_day_verified", &json!(5)),
            Err(FieldCode::OutOfRange)
        );
        assert_eq!(
            check("matching.recommendations_size", &json!(601)),
            Err(FieldCode::OutOfRange)
        );
        assert_eq!(check("matching.candidate_pool_size", &json!(150)), Ok(()));
    }

    #[test]
    fn text_keys_are_checked() {
        assert_eq!(check("moderation.photo_review", &json!("auto")), Ok(()));
        assert_eq!(
            check("moderation.photo_review", &json!("maybe")),
            Err(FieldCode::Invalid)
        );
        assert_eq!(check("onboarding.identity_required", &json!(false)), Ok(()));
        assert_eq!(check("support.email", &json!("help@example.com")), Ok(()));
        assert_eq!(
            check("support.email", &json!("not an email")),
            Err(FieldCode::Invalid)
        );
        assert_eq!(check("legal.terms_version", &json!("2026-12-01")), Ok(()));
        assert_eq!(
            check("legal.terms_version", &json!("2026-11-19")),
            Err(FieldCode::OutOfRange)
        );
        assert_eq!(
            check("legal.terms_version", &json!("2026-13-01")),
            Err(FieldCode::Invalid)
        );
        assert_eq!(check("announcement.banner", &Value::Null), Ok(()));
        assert_eq!(
            check(
                "announcement.banner",
                &json!({ "text_en": "Eid", "text_ur": null, "url": "http://x.example" })
            ),
            Err(FieldCode::Invalid)
        );
        assert_eq!(
            check(
                "announcement.banner",
                &json!({ "text_en": "Eid", "text_ur": null, "url": "https://x.example" })
            ),
            Ok(())
        );
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;

    use crate::db::admin::test_util::{audit_details, audit_total, email_of};
    use crate::domain::types::UserRole;
    use crate::settings;
    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn the_list_has_every_key_and_a_change_applies_at_once(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;

        let list = app.get("/v1/admin/settings", Some(&admin.token)).await;
        assert_eq!(list.status, StatusCode::OK, "{}", list.text);
        let items = list.json["items"].as_array().unwrap();
        assert_eq!(items.len(), settings::defaults().len());
        assert_eq!(items[0]["key"], "limits.interests_per_day");
        assert_eq!(items[0]["value"], 10);
        assert_eq!(items[0]["default"], 10);
        assert!(items[0]["updated_by_email"].is_null());
        assert!(items[0]["updated_at"].is_null());
        assert_eq!(
            app.get("/v1/admin/settings", Some(&moderator.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.get("/v1/admin/settings", Some(&member.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );

        // The member's bootstrap reads the old value, then the new one right after the change.
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["config"]["photos_max"],
            6
        );
        let put = app
            .put(
                "/v1/admin/settings/limits.photos_max",
                Some(&admin.token),
                json!({ "value": 3 }),
            )
            .await;
        assert_eq!(put.status, StatusCode::OK, "{}", put.text);
        assert_eq!(put.json["key"], "limits.photos_max");
        assert_eq!(put.json["value"], 3);
        assert_eq!(put.json["default"], 6);
        assert_eq!(
            put.json["updated_by_email"],
            email_of(app.db(), admin.user_id).await
        );
        assert!(put.json["updated_at"].is_string());
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["config"]["photos_max"],
            3
        );
        assert_eq!(app.state.settings.get().await.unwrap().photos_max, 3);

        // A second change reports the previous stored value, and "reset to default" writes it.
        app.put(
            "/v1/admin/settings/limits.photos_max",
            Some(&admin.token),
            json!({ "value": 5 }),
        )
        .await;
        let reset = app
            .put(
                "/v1/admin/settings/limits.photos_max",
                Some(&admin.token),
                json!({ "value": 6 }),
            )
            .await;
        assert_eq!(reset.json["value"], 6);
        assert_eq!(
            audit_details(app.db(), "setting.update").await,
            vec![
                json!({ "from": 6, "to": 3 }),
                json!({ "from": 3, "to": 5 }),
                json!({ "from": 5, "to": 6 }),
            ]
        );
        let target: (String, String) =
            sqlx::query_as("SELECT target_type, target_id FROM admin_audit_log LIMIT 1")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(
            target,
            ("app_setting".to_owned(), "limits.photos_max".to_owned())
        );
        let listed = app.get("/v1/admin/settings", Some(&admin.token)).await;
        let photos = listed.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["key"] == "limits.photos_max")
            .unwrap();
        assert_eq!(photos["value"], 6);
        assert!(photos["updated_at"].is_string());
    }

    #[sqlx::test]
    async fn values_are_validated_per_key(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let put = |key: &str, value: serde_json::Value| {
            let url = format!("/v1/admin/settings/{key}");
            let token = admin.token.clone();
            let app = &app;
            async move { app.put(&url, Some(&token), json!({ "value": value })).await }
        };

        for (key, value, expected) in [
            ("limits.photos_max", json!(11), "value:out_of_range"),
            ("limits.photos_max", json!("six"), "value:invalid"),
            ("limits.photos_max", json!(2.5), "value:invalid"),
            ("limits.interests_per_day", json!(25), "value:out_of_range"),
            (
                "limits.interests_per_day_verified",
                json!(5),
                "value:out_of_range",
            ),
            (
                "matching.recommendations_size",
                json!(601),
                "value:out_of_range",
            ),
            (
                "moderation.photo_review",
                json!("sometimes"),
                "value:invalid",
            ),
            ("onboarding.identity_required", json!("no"), "value:invalid"),
            ("support.email", json!("not-an-email"), "value:invalid"),
            (
                "legal.terms_version",
                json!("2026-11-19"),
                "value:out_of_range",
            ),
            ("legal.terms_version", json!("tomorrow"), "value:invalid"),
            (
                "announcement.banner",
                json!({ "text_en": "", "text_ur": null, "url": null }),
                "value:invalid",
            ),
            (
                "announcement.banner",
                json!({ "text_en": "Hi", "text_ur": null, "url": "http://example.com" }),
                "value:invalid",
            ),
            (
                "account.deletion_grace_days",
                json!(0),
                "value:out_of_range",
            ),
        ] {
            let response = put(key, value.clone()).await;
            assert_eq!(response.status, StatusCode::BAD_REQUEST, "{key} {value}");
            assert_eq!(response.field_errors(), vec![expected], "{key} {value}");
        }
        assert_eq!(
            put("no.such.key", json!(1)).await.status,
            StatusCode::NOT_FOUND
        );
        let missing = app
            .put(
                "/v1/admin/settings/limits.photos_max",
                Some(&admin.token),
                json!({}),
            )
            .await;
        assert_eq!(missing.code(), "bad_request");
        let extra = app
            .put(
                "/v1/admin/settings/limits.photos_max",
                Some(&admin.token),
                json!({ "value": 3, "key": "x" }),
            )
            .await;
        assert_eq!(extra.code(), "bad_request");
        let by_moderator = app
            .put(
                "/v1/admin/settings/limits.photos_max",
                Some(&moderator.token),
                json!({ "value": 3 }),
            )
            .await;
        assert_eq!(by_moderator.status, StatusCode::FORBIDDEN);
        assert_eq!(
            audit_total(app.db()).await,
            0,
            "refused changes write nothing"
        );

        // Valid changes of every other kind of key.
        for (key, value) in [
            ("moderation.photo_review", json!("auto")),
            ("onboarding.photo_required", json!(true)),
            ("support.email", json!("help@example.com")),
            ("interest.cooldown_after_decline_days", json!(0)),
            ("limits.interests_per_day", json!(20)),
            ("matching.candidate_pool_size", json!(250)),
            (
                "announcement.banner",
                json!({ "text_en": "Eid Mubarak", "text_ur": null, "url": "https://example.com/eid" }),
            ),
        ] {
            let response = put(key, value.clone()).await;
            assert_eq!(response.status, StatusCode::OK, "{key}: {}", response.text);
            assert_eq!(response.json["value"], value);
        }
        let member = app.member().await;
        let me = app.get("/v1/me", Some(&member.token)).await;
        assert_eq!(me.json["config"]["support_email"], "help@example.com");
        assert_eq!(me.json["config"]["announcement"]["text_en"], "Eid Mubarak");
        assert_eq!(
            put("announcement.banner", serde_json::Value::Null)
                .await
                .status,
            StatusCode::OK
        );
        let me = app.get("/v1/me", Some(&member.token)).await;
        assert!(me.json["config"]["announcement"].is_null());
        assert_eq!(audit_total(app.db()).await, 8);
    }

    #[sqlx::test]
    async fn a_new_legal_version_asks_every_member_to_accept_it_at_once(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let member = app.member().await;
        // The snapshot is cached with current consents.
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["gate"],
            "ok"
        );

        let put = app
            .put(
                "/v1/admin/settings/legal.terms_version",
                Some(&admin.token),
                json!({ "value": "2026-12-01" }),
            )
            .await;
        assert_eq!(put.status, StatusCode::OK, "{}", put.text);
        let me = app.get("/v1/me", Some(&member.token)).await;
        assert_eq!(
            me.json["gate"], "consent_required",
            "every snapshot was dropped"
        );
        assert_eq!(me.json["consents_required"], json!(["terms"]));
        assert_eq!(me.json["config"]["legal"]["terms_version"], "2026-12-01");
        let blocked = app.get("/v1/admin/overview", Some(&admin.token)).await;
        assert_eq!(
            blocked.status,
            StatusCode::OK,
            "staff levels do not check consents"
        );

        let accept = app
            .post(
                "/v1/me/consents",
                Some(&member.token),
                json!({ "documents": ["terms"] }),
            )
            .await;
        assert_eq!(accept.json["gate"], "ok");
        assert_eq!(
            audit_details(app.db(), "setting.update").await,
            vec![json!({ "from": "2026-11-20", "to": "2026-12-01" })]
        );
    }
}
