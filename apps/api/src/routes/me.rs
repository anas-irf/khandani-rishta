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

    mod http {
        use axum::http::StatusCode;
        use serde_json::json;
        use sqlx::PgPool;

        use crate::domain::types::{ProfileStatus, UserRole, UserStatus};
        use crate::services::clerk::ClerkUser;
        use crate::test_support::{TestApp, token_for};

        #[sqlx::test]
        async fn the_first_call_creates_the_four_rows(db: PgPool) {
            let app = TestApp::new(db).await;
            let (clerk_user_id, token) = app.clerk_user("Ali@Example.com");

            let response = app.get("/v1/me", Some(&token)).await;
            assert_eq!(response.status, StatusCode::OK);
            let me = &response.json;
            assert_eq!(me["gate"], "onboarding");
            assert_eq!(me["user"]["email"], "ali@example.com");
            assert_eq!(me["user"]["status"], "active");
            assert_eq!(me["profile"]["status"], "draft");
            assert_eq!(me["profile"]["onboarding_step"], "account_for");
            assert!(
                me["profile"]["public_code"]
                    .as_str()
                    .unwrap()
                    .starts_with("KR")
            );
            assert_eq!(me["config"]["photos_max"], 6);
            assert_eq!(me["counters"]["unread_notifications"], 0);
            assert_eq!(me["consents_required"].as_array().unwrap().len(), 3);

            let counts: (i64, i64, i64, i64) = sqlx::query_as(
                "SELECT (SELECT count(*) FROM users WHERE clerk_user_id = $1),
                        (SELECT count(*) FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.clerk_user_id = $1),
                        (SELECT count(*) FROM profile_privacy x JOIN profiles p ON p.id = x.profile_id
                           JOIN users u ON u.id = p.user_id WHERE u.clerk_user_id = $1),
                        (SELECT count(*) FROM notification_preferences n JOIN users u ON u.id = n.user_id
                           WHERE u.clerk_user_id = $1)",
            )
            .bind(&clerk_user_id)
            .fetch_one(app.db())
            .await
            .unwrap();
            assert_eq!(counts, (1, 1, 1, 1));
        }

        #[sqlx::test]
        async fn concurrent_first_calls_do_not_duplicate(db: PgPool) {
            let app = TestApp::new(db).await;
            let (clerk_user_id, token) = app.clerk_user("twice@example.com");
            let (a, b, c) = tokio::join!(
                app.get("/v1/me", Some(&token)),
                app.get("/v1/me", Some(&token)),
                app.get("/v1/me", Some(&token)),
            );
            assert_eq!(
                (a.status, b.status, c.status),
                (StatusCode::OK, StatusCode::OK, StatusCode::OK)
            );
            assert_eq!(a.json["profile"]["id"], b.json["profile"]["id"]);
            assert_eq!(b.json["profile"]["id"], c.json["profile"]["id"]);
            let users: i64 =
                sqlx::query_scalar("SELECT count(*) FROM users WHERE clerk_user_id = $1")
                    .bind(&clerk_user_id)
                    .fetch_one(app.db())
                    .await
                    .unwrap();
            assert_eq!(users, 1);
        }

        #[sqlx::test]
        async fn provisioning_needs_clerk(db: PgPool) {
            let app = TestApp::new(db).await;
            // A valid token for a user Clerk does not know: 401.
            let response = app.get("/v1/me", Some(&token_for("user_unknown"))).await;
            assert_eq!(response.status, StatusCode::UNAUTHORIZED);
            assert_eq!(response.code(), "unauthenticated");

            // Clerk down: 503 and no half-created rows.
            let (clerk_user_id, token) = app.clerk_user("later@example.com");
            *app.clerk.down.lock().unwrap() = true;
            let response = app.get("/v1/me", Some(&token)).await;
            assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE);
            let users: i64 =
                sqlx::query_scalar("SELECT count(*) FROM users WHERE clerk_user_id = $1")
                    .bind(&clerk_user_id)
                    .fetch_one(app.db())
                    .await
                    .unwrap();
            assert_eq!(users, 0);
        }

        #[sqlx::test]
        async fn a_banned_email_is_created_banned(db: PgPool) {
            let app = TestApp::new(db).await;
            let hash = app.state.crypto.email_hash("banned@example.com");
            sqlx::query("INSERT INTO banned_identities (kind, value_hash) VALUES ('email', $1)")
                .bind(hash)
                .execute(app.db())
                .await
                .unwrap();
            let (_, token) = app.clerk_user("Banned@Example.com");
            let response = app.get("/v1/me", Some(&token)).await;
            assert_eq!(
                response.status,
                StatusCode::OK,
                "GET /v1/me never fails on a gate"
            );
            assert_eq!(response.json["gate"], "banned");
            assert_eq!(response.json["user"]["status"], "banned");

            let refused = app
                .patch("/v1/me", Some(&token), json!({ "locale": "ur" }))
                .await;
            assert_eq!(refused.status, StatusCode::FORBIDDEN);
            assert_eq!(refused.code(), "account_banned");
        }

        #[sqlx::test]
        async fn requests_without_a_valid_token_are_refused(db: PgPool) {
            let app = TestApp::new(db).await;
            for token in [None, Some("garbage")] {
                let response = app.get("/v1/me", token).await;
                assert_eq!(response.status, StatusCode::UNAUTHORIZED);
                assert_eq!(response.code(), "unauthenticated");
            }
        }

        #[sqlx::test]
        async fn the_gate_follows_the_account(db: PgPool) {
            let app = TestApp::new(db).await;
            let cases = [
                (
                    UserStatus::Suspended,
                    ProfileStatus::Suspended,
                    true,
                    "suspended",
                ),
                (
                    UserStatus::DeletionScheduled,
                    ProfileStatus::Active,
                    true,
                    "deletion_scheduled",
                ),
                (
                    UserStatus::Active,
                    ProfileStatus::Active,
                    false,
                    "consent_required",
                ),
                (
                    UserStatus::Active,
                    ProfileStatus::ChangesRequested,
                    true,
                    "changes_requested",
                ),
                (
                    UserStatus::Active,
                    ProfileStatus::PendingReview,
                    true,
                    "pending_review",
                ),
                (UserStatus::Active, ProfileStatus::Paused, true, "ok"),
            ];
            for (user_status, status, consents, gate) in cases {
                let user = app
                    .member_with(|spec| {
                        spec.user_status = user_status;
                        spec.status = status;
                        spec.consents = consents;
                    })
                    .await;
                let response = app.get("/v1/me", Some(&user.token)).await;
                assert_eq!(response.status, StatusCode::OK);
                assert_eq!(response.json["gate"], gate, "{user_status:?} {status:?}");
            }
        }

        #[sqlx::test]
        async fn consents_clear_the_consent_gate(db: PgPool) {
            let app = TestApp::new(db).await;
            let user = app.member_with(|spec| spec.consents = false).await;
            let response = app
                .post(
                    "/v1/me/consents",
                    Some(&user.token),
                    json!({ "documents": ["terms", "privacy", "community_guidelines"] }),
                )
                .await;
            assert_eq!(response.status, StatusCode::OK);
            assert_eq!(response.json["gate"], "ok");
            assert_eq!(response.json["consents_required"], json!([]));

            // A new terms version brings the gate back.
            app.state
                .settings
                .put("legal.terms_version", &json!("2027-01-01"), None)
                .await
                .unwrap();
            app.state.accounts.invalidate_all();
            let response = app.get("/v1/me", Some(&user.token)).await;
            assert_eq!(response.json["gate"], "consent_required");
            assert_eq!(response.json["consents_required"], json!(["terms"]));
        }

        #[sqlx::test]
        async fn patch_changes_locale_and_time_zone(db: PgPool) {
            let app = TestApp::new(db).await;
            let user = app.member().await;
            let response = app
                .patch(
                    "/v1/me",
                    Some(&user.token),
                    json!({ "locale": "ur", "timezone": "Europe/London" }),
                )
                .await;
            assert_eq!(response.status, StatusCode::OK);
            assert_eq!(response.json["user"]["locale"], "ur");
            assert_eq!(response.json["user"]["timezone"], "Europe/London");

            let bad = app
                .patch(
                    "/v1/me",
                    Some(&user.token),
                    json!({ "timezone": "nowhere" }),
                )
                .await;
            assert_eq!(bad.code(), "validation_failed");
            assert_eq!(bad.field_errors(), vec!["timezone:invalid"]);
        }

        #[sqlx::test]
        async fn client_events_always_answer_204(db: PgPool) {
            let app = TestApp::new(db).await;
            let user = app.member().await;
            let response = app
                .post(
                    "/v1/events",
                    Some(&user.token),
                    json!({ "events": [{ "name": "onboarding_step_viewed" }, { "name": "X" }] }),
                )
                .await;
            assert_eq!(response.status, StatusCode::NO_CONTENT);
            let garbage = app
                .raw(
                    "POST",
                    "/v1/events",
                    Some(&user.token),
                    Some("nonsense".to_owned()),
                )
                .await;
            assert_eq!(garbage.status, StatusCode::NO_CONTENT);
        }

        #[sqlx::test]
        async fn every_access_level_refuses_the_wrong_caller(db: PgPool) {
            let app = TestApp::new(db).await;
            // Level `open`: a suspended account.
            let suspended = app
                .member_with(|spec| spec.user_status = UserStatus::Suspended)
                .await;
            let response = app
                .patch("/v1/me", Some(&suspended.token), json!({ "locale": "en" }))
                .await;
            assert_eq!(response.code(), "account_suspended");

            // Level `auth`: still answers for a suspended account.
            let response = app.get("/v1/me", Some(&suspended.token)).await;
            assert_eq!(response.status, StatusCode::OK);

            // A staff role alone does not open member routes, and members get 403 on staff
            // routes (checked again in the admin route tests).
            let moderator = app.staff(UserRole::Moderator).await;
            let response = app.get("/v1/me", Some(&moderator.token)).await;
            assert_eq!(response.json["user"]["role"], "moderator");
        }

        #[sqlx::test]
        async fn authenticated_writes_are_rate_limited_per_user(db: PgPool) {
            let app = TestApp::new(db).await;
            let user = app.member().await;
            // Sent together, so the allowance cannot refill in between, even on a loaded machine.
            let responses = futures_util::future::join_all(
                (0..50).map(|_| app.patch("/v1/me", Some(&user.token), json!({ "locale": "en" }))),
            )
            .await;
            let limited: Vec<_> = responses
                .iter()
                .filter(|response| response.status == StatusCode::TOO_MANY_REQUESTS)
                .collect();
            let passed = responses.len() - limited.len();
            assert!(
                (40..=42).contains(&passed),
                "a burst of 40 writes, give or take a refill: {passed}"
            );
            assert_eq!(limited[0].code(), "rate_limited");
            assert!(limited[0].headers.contains_key("retry-after"));

            // Another user is unaffected.
            let other = app.member().await;
            let response = app
                .patch("/v1/me", Some(&other.token), json!({ "locale": "en" }))
                .await;
            assert_eq!(response.status, StatusCode::OK);
        }

        #[sqlx::test]
        async fn a_deleted_clerk_user_mapping_stays_unauthenticated(db: PgPool) {
            let app = TestApp::new(db).await;
            let user = app.member().await;
            sqlx::query("UPDATE users SET status = 'deleted' WHERE id = $1")
                .bind(user.user_id)
                .execute(app.db())
                .await
                .unwrap();
            app.state.accounts.invalidate(user.user_id);
            let response = app.get("/v1/me", Some(&user.token)).await;
            assert_eq!(response.status, StatusCode::UNAUTHORIZED);
            // The fake still knows the Clerk user; provisioning must not run again.
            app.clerk.add_user(ClerkUser {
                id: user.clerk_user_id.clone(),
                email: None,
                email_verified: false,
                phone_e164: None,
                phone_verified: false,
            });
            let users: i64 =
                sqlx::query_scalar("SELECT count(*) FROM users WHERE clerk_user_id = $1")
                    .bind(&user.clerk_user_id)
                    .fetch_one(app.db())
                    .await
                    .unwrap();
            assert_eq!(users, 1);
        }
    }
}
