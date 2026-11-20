//! Account routes (15 section 6): `GET` and `PATCH /v1/me`, consents and client events.

use std::net::IpAddr;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Map, Value};
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::{Auth, Open};
use crate::domain::types::{ConsentDocument, Locale};
use crate::error::{ApiResult, ErrorBody, FieldCode, FieldErrors};
use crate::extract::ApiJson;
use crate::models::me::{self, Me};
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(get_me, patch_me))
        .routes(routes!(post_consents))
        .routes(routes!(post_events))
}

/// Session bootstrap: user, profile summary, gate, counters. Never fails with a gate error;
/// creates the account rows on the first call (06 section 5).
#[utoipa::path(
    get,
    path = "/me",
    tag = "account",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Me),
        (status = 401, body = ErrorBody),
        (status = 503, body = ErrorBody)
    )
)]
async fn get_me(State(state): State<AppState>, account: Auth) -> ApiResult<Json<Me>> {
    Ok(Json(me::load(&state, &account).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PatchMe {
    pub locale: Option<Locale>,
    /// An IANA time zone name such as `Asia/Karachi`.
    pub timezone: Option<String>,
}

/// Whether a value looks like an IANA zone name (`Area/Location`, or `UTC`).
fn is_time_zone_name(value: &str) -> bool {
    static PATTERN: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+\-]+){1,2})$").expect("valid regex")
    });
    value.len() <= 64 && PATTERN.is_match(value)
}

/// Change `locale` or `timezone`.
#[utoipa::path(
    patch,
    path = "/me",
    tag = "account",
    security(("bearer" = [])),
    request_body = PatchMe,
    responses(
        (status = 200, body = Me),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn patch_me(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<PatchMe>,
) -> ApiResult<Json<Me>> {
    let mut errors = FieldErrors::new();
    if let Some(timezone) = &body.timezone
        && !is_time_zone_name(timezone)
    {
        errors.add("timezone", FieldCode::Invalid);
    }
    errors.finish()?;
    sqlx::query(
        "UPDATE users SET locale = COALESCE($2, locale), timezone = COALESCE($3, timezone)
         WHERE id = $1",
    )
    .bind(account.user_id)
    .bind(body.locale)
    .bind(&body.timezone)
    .execute(&state.db)
    .await?;
    Ok(Json(me::load(&state, &account).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ConsentsBody {
    pub documents: Vec<ConsentDocument>,
}

/// The client IP and user agent recorded with a consent (20 section 3.3).
pub fn consent_context(headers: &HeaderMap) -> (Option<String>, Option<String>) {
    let ip = headers
        .get("cf-connecting-ip")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<IpAddr>().ok())
        .map(|ip| ip.to_string());
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(500).collect());
    (ip, user_agent)
}

/// Records each listed document at its current version. `age_declaration` and
/// `candidate_consent` are recorded with the current terms version (15 section 6).
pub async fn record_consents(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    documents: &[ConsentDocument],
    settings: &crate::settings::AppSettings,
    headers: &HeaderMap,
) -> sqlx::Result<()> {
    let (ip, user_agent) = consent_context(headers);
    for document in documents {
        let version = match document {
            ConsentDocument::Privacy => &settings.privacy_version,
            ConsentDocument::CommunityGuidelines => &settings.guidelines_version,
            ConsentDocument::Terms
            | ConsentDocument::AgeDeclaration
            | ConsentDocument::CandidateConsent => &settings.terms_version,
        };
        sqlx::query(
            "INSERT INTO user_consents (id, user_id, document, version, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5::inet, $6)
             ON CONFLICT (user_id, document, version) DO NOTHING",
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(document)
        .bind(version)
        .bind(&ip)
        .bind(&user_agent)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Accept new versions of legal documents.
#[utoipa::path(
    post,
    path = "/me/consents",
    tag = "account",
    security(("bearer" = [])),
    request_body = ConsentsBody,
    responses((status = 200, body = Me), (status = 400, body = ErrorBody), (status = 403, body = ErrorBody))
)]
async fn post_consents(
    State(state): State<AppState>,
    account: Open,
    headers: HeaderMap,
    ApiJson(body): ApiJson<ConsentsBody>,
) -> ApiResult<Json<Me>> {
    let settings = state.settings.get().await?;
    let mut conn = state.db.acquire().await?;
    record_consents(
        &mut conn,
        account.user_id,
        &body.documents,
        &settings,
        &headers,
    )
    .await?;
    drop(conn);
    Ok(Json(me::reload(&state, &account).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EventsBody {
    #[schema(value_type = Vec<Object>)]
    pub events: Vec<Value>,
}

const MAX_EVENTS: usize = 20;
const MAX_PROPERTIES: usize = 10;
const MAX_PROPERTY_TEXT: usize = 100;

/// Checks one client event against 15 section 6. Returns its name and properties when valid.
fn valid_event(event: &Value) -> Option<(String, Map<String, Value>)> {
    static NAME: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new("^[a-z][a-z0-9_]{2,49}$").expect("valid regex")
    });
    let object = event.as_object()?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "name" | "properties" | "occurred_at"))
    {
        return None;
    }
    let name = object.get("name")?.as_str()?;
    if !NAME.is_match(name) {
        return None;
    }
    if let Some(occurred_at) = object.get("occurred_at")
        && !occurred_at.is_null()
    {
        let text = occurred_at.as_str()?;
        OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).ok()?;
    }
    let properties = match object.get("properties") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(map)) => map.clone(),
        Some(_) => return None,
    };
    if properties.len() > MAX_PROPERTIES {
        return None;
    }
    let values_ok = properties.values().all(|value| match value {
        Value::String(text) => text.chars().count() <= MAX_PROPERTY_TEXT,
        Value::Number(_) | Value::Bool(_) => true,
        _ => false,
    });
    values_ok.then(|| (name.to_owned(), properties))
}

/// Record client-side product events as log lines (20 section 8.3). Always `204`.
#[utoipa::path(
    post,
    path = "/events",
    tag = "account",
    security(("bearer" = [])),
    request_body = EventsBody,
    responses((status = 204, description = "Accepted"), (status = 401, body = ErrorBody))
)]
async fn post_events(account: Auth, headers: HeaderMap, body: axum::body::Bytes) -> StatusCode {
    let platform = headers
        .get("x-app-platform")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("web")
        .chars()
        .take(20)
        .collect::<String>();
    let events = serde_json::from_slice::<EventsBody>(&body).map_or_default(|body| body.events);
    for (name, properties) in events.iter().take(MAX_EVENTS).filter_map(valid_event) {
        let properties = Value::Object(properties).to_string();
        tracing::info!(
            event = %format!("client.{name}"),
            platform = %platform,
            user_id = %account.user_id,
            properties = %properties,
            "client event"
        );
    }
    StatusCode::NO_CONTENT
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn time_zone_names() {
        assert!(is_time_zone_name("Asia/Karachi"));
        assert!(is_time_zone_name("America/Argentina/Buenos_Aires"));
        assert!(is_time_zone_name("UTC"));
        assert!(!is_time_zone_name("karachi"));
        assert!(!is_time_zone_name("Asia/Karachi; DROP"));
    }

    #[test]
    fn client_events_follow_the_rules() {
        assert!(valid_event(&json!({ "name": "onboarding_step_viewed", "properties": { "step": "basics", "ms": 1200, "skipped": false } })).is_some());
        assert!(valid_event(&json!({ "name": "ab" })).is_none(), "too short");
        assert!(valid_event(&json!({ "name": "Has_caps" })).is_none());
        assert!(
            valid_event(&json!({ "name": "fine_name", "properties": { "nested": { "a": 1 } } }))
                .is_none()
        );
        assert!(
            valid_event(&json!({ "name": "fine_name", "properties": { "text": "x".repeat(101) } }))
                .is_none()
        );
        assert!(valid_event(&json!({ "name": "fine_name", "extra": 1 })).is_none());
        assert!(valid_event(&json!({ "name": "fine_name", "occurred_at": "yesterday" })).is_none());
        assert!(
            valid_event(&json!({ "name": "fine_name", "occurred_at": "2026-11-20T10:15:00Z" }))
                .is_some()
        );
    }
}
