//! HTTP routes and the middleware stack. One file per row of 15 section 17; handlers are thin.

mod account;
mod admin;
mod connections;
mod discovery;
mod health;
mod interests;
pub mod me;
mod meta;
mod notifications;
mod photo_access;
mod photos;
mod profile;
mod reference;
mod relations;
mod reports;
mod verifications;
mod webhooks;
mod ws;

use std::time::Duration;

use axum::Router;
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::response::IntoResponse;
use tower::ServiceBuilder;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::error::ApiError;
use crate::extract::BODY_LIMIT_BYTES;
use crate::openapi::ApiDoc;
use crate::state::AppState;

/// Header carrying a unique ID for every request. It is also returned to the client.
const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

/// Longest a request may run before the API answers 408.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// All routes with their OpenAPI metadata. Product routes go under `/v1`.
pub fn api_router() -> OpenApiRouter<AppState> {
    let v1 = OpenApiRouter::new()
        .merge(meta::router())
        .merge(reference::router())
        .merge(me::router())
        .merge(account::router())
        .merge(notifications::router())
        .merge(profile::router())
        .merge(photos::router())
        .merge(verifications::router())
        .merge(discovery::router())
        .merge(interests::router())
        .merge(connections::router())
        .merge(relations::router())
        .merge(photo_access::router())
        .merge(reports::router())
        .merge(ws::router())
        .nest("/admin", admin::router());

    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health::healthz))
        .routes(routes!(health::readyz))
        .nest("/v1", v1)
        .nest("/webhooks", webhooks::router())
}

/// The complete application: routes, middleware and shared state.
pub fn app(state: AppState) -> Router {
    let (router, _) = api_router().split_for_parts();

    // Layers run top to bottom on the way in, and in reverse on the way out.
    let middleware = ServiceBuilder::new()
        .layer(SetRequestIdLayer::new(REQUEST_ID_HEADER, MakeRequestUuid))
        .layer(PropagateRequestIdLayer::new(REQUEST_ID_HEADER))
        .layer(sentry_tower::NewSentryLayer::<Request>::new_from_top())
        .layer(sentry_tower::SentryHttpLayer::new().enable_transaction())
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request| {
                let request_id = request
                    .headers()
                    .get(&REQUEST_ID_HEADER)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("-");
                tracing::info_span!(
                    "request",
                    method = %request.method(),
                    path = %request.uri().path(),
                    request_id = %request_id,
                )
            }),
        )
        .layer(cors_layer(state.config.cors_allowed_origins.clone()))
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        .layer(CatchPanicLayer::custom(|_| {
            ApiError::Internal(anyhow::anyhow!("handler panicked")).into_response()
        }))
        .layer(axum::middleware::from_fn(crate::error::scope_request_id))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::ip_rate_limit,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::android_version_check,
        ));

    router
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
        .fallback(crate::middleware::unmatched)
        .layer(middleware)
        .with_state(state)
}

fn cors_layer(origins: Vec<HeaderValue>) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::IF_NONE_MATCH,
            HeaderName::from_static("x-app-platform"),
            HeaderName::from_static("x-app-version-code"),
        ])
        .expose_headers([REQUEST_ID_HEADER, header::ETAG, header::RETRY_AFTER])
        .max_age(Duration::from_hours(1))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;

    use crate::test_support::{TestApp, TestResponse};

    #[sqlx::test]
    async fn healthz_reports_ok(db: PgPool) {
        let app = TestApp::new(db).await;
        let response = app.get("/healthz", None).await;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(response.json, json!({ "status": "ok" }));
    }

    #[sqlx::test]
    async fn readyz_reports_ok_when_the_database_answers(db: PgPool) {
        let app = TestApp::new(db).await;
        let response = app.get("/readyz", None).await;
        assert_eq!(response.status, StatusCode::OK);
    }

    #[sqlx::test]
    async fn every_response_carries_a_request_id(db: PgPool) {
        let app = TestApp::new(db).await;
        let response = app.get("/healthz", None).await;
        assert!(response.request_id.is_some_and(|id| !id.is_empty()));
    }

    #[sqlx::test]
    async fn unknown_routes_return_the_error_body(db: PgPool) {
        let app = TestApp::new(db).await;
        let response = app.get("/v1/does-not-exist", None).await;
        assert_eq!(response.status, StatusCode::NOT_FOUND);
        assert_eq!(response.json["error"]["code"], "not_found");
        assert_eq!(
            response.json["error"]["request_id"].as_str(),
            response.request_id.as_deref()
        );
    }

    #[sqlx::test]
    async fn malformed_and_unknown_fields_are_bad_requests(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let response = app
            .raw(
                "PATCH",
                "/v1/me",
                Some(&user.token),
                Some("{not json".into()),
            )
            .await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(response.json["error"]["code"], "bad_request");

        let response = app
            .patch(
                "/v1/me",
                Some(&user.token),
                json!({ "locale": "en", "colour": "red" }),
            )
            .await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(response.json["error"]["code"], "bad_request");
    }

    #[sqlx::test]
    async fn oversized_bodies_are_refused(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let big = format!("{{\"timezone\":\"{}\"}}", "a".repeat(70 * 1024));
        let response = app
            .raw("PATCH", "/v1/me", Some(&user.token), Some(big))
            .await;
        assert_eq!(response.status, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(response.json["error"]["code"], "payload_too_large");
    }

    #[sqlx::test]
    async fn old_android_builds_must_upgrade(db: PgPool) {
        let app = TestApp::new(db).await;
        sqlx::query(
            "INSERT INTO app_releases (platform, version_code, version_name, min_supported_version_code, download_url)
             VALUES ('android', 12, '1.3.0', 9, 'https://download.example/kr-1.3.0.apk')",
        )
        .execute(&app.state.db)
        .await
        .unwrap();
        let user = app.member().await;
        let old = app
            .request_with_headers(
                "GET",
                "/v1/me",
                Some(&user.token),
                None,
                &[("x-app-platform", "android"), ("x-app-version-code", "8")],
            )
            .await;
        assert_eq!(old.status.as_u16(), 426);
        assert_eq!(
            old.json["error"]["details"]["download_url"],
            "https://download.example/kr-1.3.0.apk"
        );

        let meta = app
            .request_with_headers(
                "GET",
                "/v1/meta/app-release?platform=android",
                None,
                None,
                &[("x-app-platform", "android"), ("x-app-version-code", "8")],
            )
            .await;
        assert_eq!(meta.status, StatusCode::OK, "meta routes stay open");
        assert_eq!(meta.json["version_code"], 12);

        let current = app
            .request_with_headers(
                "GET",
                "/v1/me",
                Some(&user.token),
                None,
                &[("x-app-platform", "android"), ("x-app-version-code", "9")],
            )
            .await;
        assert_eq!(current.status, StatusCode::OK);
    }

    /// The status codes of `count` GET requests.
    async fn statuses(app: &TestApp, path: &str, token: Option<&str>, count: usize) -> Vec<u16> {
        let mut statuses = Vec::with_capacity(count);
        for _ in 0..count {
            statuses.push(app.get(path, token).await.status.as_u16());
        }
        statuses
    }

    /// The first `429` among up to `attempts` more GET requests. Several attempts rather than
    /// one, so a slow run that earns back part of an allowance between requests still passes.
    async fn first_refusal(
        app: &TestApp,
        path: &str,
        token: Option<&str>,
        attempts: usize,
    ) -> Option<TestResponse> {
        for _ in 0..attempts {
            let response = app.get(path, token).await;
            if response.status == StatusCode::TOO_MANY_REQUESTS {
                return Some(response);
            }
        }
        None
    }

    /// A GET request as if it came through Cloudflare from `ip`.
    async fn get_from(app: &TestApp, ip: &str, path: &str, token: Option<&str>) -> TestResponse {
        app.request_with_headers("GET", path, token, None, &[("cf-connecting-ip", ip)])
            .await
    }

    /// The status codes of `count` GET requests from `ip`.
    async fn statuses_from(
        app: &TestApp,
        ip: &str,
        path: &str,
        token: Option<&str>,
        count: usize,
    ) -> Vec<u16> {
        let mut statuses = Vec::with_capacity(count);
        for _ in 0..count {
            statuses.push(get_from(app, ip, path, token).await.status.as_u16());
        }
        statuses
    }

    /// Whether one of up to `attempts` more GET requests from `ip` is answered `429`.
    async fn refused_from(
        app: &TestApp,
        ip: &str,
        path: &str,
        token: Option<&str>,
        attempts: usize,
    ) -> bool {
        for _ in 0..attempts {
            if get_from(app, ip, path, token).await.status == StatusCode::TOO_MANY_REQUESTS {
                return true;
            }
        }
        false
    }

    #[sqlx::test]
    async fn public_routes_count_bad_tokens_per_ip(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        // A token that does not verify counts as none: 60 a minute per IP (15 section 3.1).
        let answered = statuses(&app, "/v1/meta", Some("not-a-token"), 60).await;
        assert!(answered.iter().all(|status| *status == 200), "{answered:?}");
        let refused = first_refusal(&app, "/v1/meta", Some("not-a-token"), 5)
            .await
            .expect("the IP allowance runs out");
        assert_eq!(refused.code(), "rate_limited");
        assert!(refused.headers.contains_key("retry-after"));
        // A valid token counts per user instead, so the member is not affected.
        let own = app.get("/v1/meta", Some(&user.token)).await;
        assert_eq!(own.status, StatusCode::OK);
    }

    #[sqlx::test]
    async fn bad_token_allowances_are_kept_per_ip(db: PgPool) {
        let app = TestApp::new(db).await;
        let bad = Some("not-a-token");
        let answered = statuses_from(&app, "203.0.113.1", "/v1/meta", bad, 60).await;
        assert!(answered.iter().all(|status| *status == 200), "{answered:?}");
        assert!(refused_from(&app, "203.0.113.1", "/v1/meta", bad, 5).await);
        // Another IP has its own allowance.
        assert_eq!(
            get_from(&app, "203.0.113.2", "/v1/meta", bad).await.status,
            StatusCode::OK
        );
    }

    #[sqlx::test]
    async fn unknown_paths_count_tokens_against_the_ip_once(db: PgPool) {
        let app = TestApp::new(db).await;
        let path = "/v1/no-such-route";
        let bad = Some("not-a-token");
        // With a token, the extractors never run, so the fallback counts the request.
        let answered = statuses_from(&app, "203.0.113.1", path, bad, 60).await;
        assert!(answered.iter().all(|status| *status == 404), "{answered:?}");
        assert!(refused_from(&app, "203.0.113.1", path, bad, 5).await);
        // Without one, the middleware counts it, and the fallback does not count it again.
        let answered = statuses_from(&app, "203.0.113.2", path, None, 60).await;
        assert!(answered.iter().all(|status| *status == 404), "{answered:?}");
        assert!(refused_from(&app, "203.0.113.2", path, None, 5).await);
        // Another IP is not affected.
        assert_eq!(
            get_from(&app, "203.0.113.3", path, bad).await.status,
            StatusCode::NOT_FOUND
        );
    }

    #[sqlx::test]
    async fn public_and_protected_routes_share_a_user_allowance(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let token = Some(user.token.as_str());
        // The default group allows 120 a minute per user: split between the two kinds of route.
        let public = statuses(&app, "/v1/meta", token, 60).await;
        assert!(public.iter().all(|status| *status == 200), "{public:?}");
        let protected = statuses(&app, "/v1/me", token, 60).await;
        assert!(
            protected.iter().all(|status| *status == 200),
            "{protected:?}"
        );
        assert!(first_refusal(&app, "/v1/me", token, 5).await.is_some());
    }

    #[sqlx::test]
    async fn city_search_counts_bad_tokens_per_ip(db: PgPool) {
        let app = TestApp::new(db).await;
        let path = "/v1/reference/cities?country_code=PK&q=la";
        // The search group allows 30 a minute.
        let answered = statuses(&app, path, Some("not-a-token"), 30).await;
        assert!(answered.iter().all(|status| *status == 200), "{answered:?}");
        assert!(
            first_refusal(&app, path, Some("not-a-token"), 5)
                .await
                .is_some()
        );
        // Another IP has its own allowance.
        let other = get_from(&app, "203.0.113.9", path, Some("not-a-token")).await;
        assert_eq!(other.status, StatusCode::OK);
    }

    #[sqlx::test]
    async fn refused_tokens_count_against_the_ip_once(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        // Counted once, by the extractor that refuses the token, not also by the middleware.
        let answered = statuses(&app, "/v1/me", Some("not-a-token"), 60).await;
        assert!(answered.iter().all(|status| *status == 401), "{answered:?}");
        let refused = first_refusal(&app, "/v1/me", Some("not-a-token"), 5)
            .await
            .expect("the IP allowance runs out");
        assert_eq!(refused.code(), "rate_limited");
        // Members with a valid token from the same IP are not affected.
        assert_eq!(
            app.get("/v1/me", Some(&user.token)).await.status,
            StatusCode::OK
        );
    }

    #[sqlx::test]
    async fn requests_without_a_token_count_against_the_ip_once(db: PgPool) {
        let app = TestApp::new(db).await;
        let answered = statuses(&app, "/v1/me", None, 60).await;
        assert!(answered.iter().all(|status| *status == 401), "{answered:?}");
        assert!(first_refusal(&app, "/v1/me", None, 5).await.is_some());
    }
}
