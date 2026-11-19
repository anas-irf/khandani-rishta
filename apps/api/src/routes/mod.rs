//! HTTP routes and the middleware stack.

mod health;
mod meta;

use std::time::Duration;

use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
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

use crate::openapi::ApiDoc;
use crate::state::AppState;

/// Header carrying a unique ID for every request. It is also returned to the client.
const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

/// Longest a request may run before the API answers 408.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// All routes with their OpenAPI metadata. Product routes go under `/v1`.
pub fn api_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health::healthz))
        .routes(routes!(health::readyz))
        .nest("/v1", meta::router())
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
        .layer(CatchPanicLayer::new());

    router.layer(middleware).with_state(state)
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
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .expose_headers([REQUEST_ID_HEADER])
        .max_age(Duration::from_secs(60 * 60))
}
