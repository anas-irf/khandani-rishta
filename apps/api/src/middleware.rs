//! Cross-cutting request steps that run before the extractors: the Android version check
//! (15 section 3, 06 section 6.4) and per-IP rate limits for requests without a token.

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::AUTHORIZATION;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use moka::sync::Cache;
use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;

use crate::error::ApiError;
use crate::ratelimit::Group;
use crate::state::AppState;

/// The newest Android release (04 section 11, `app_releases`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema, sqlx::FromRow)]
pub struct AppRelease {
    pub version_code: i32,
    pub version_name: String,
    pub min_supported_version_code: i32,
    pub download_url: String,
    pub release_notes: Option<String>,
}

/// The newest release, cached for 5 minutes.
pub struct ReleaseCache {
    latest: Cache<(), Option<AppRelease>>,
}

impl Default for ReleaseCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ReleaseCache {
    pub fn new() -> Self {
        Self {
            latest: Cache::builder()
                .max_capacity(1)
                .time_to_live(Duration::from_mins(5))
                .build(),
        }
    }

    pub async fn latest(&self, db: &PgPool) -> sqlx::Result<Option<AppRelease>> {
        if let Some(cached) = self.latest.get(&()) {
            return Ok(cached);
        }
        let release: Option<AppRelease> = sqlx::query_as(
            "SELECT version_code, version_name, min_supported_version_code, download_url, release_notes
             FROM app_releases WHERE platform = 'android'
             ORDER BY version_code DESC LIMIT 1",
        )
        .fetch_optional(db)
        .await?;
        self.latest.insert((), release.clone());
        Ok(release)
    }

    /// Call after publishing a release.
    pub fn invalidate(&self) {
        self.latest.invalidate_all();
    }
}

/// Answers `426 upgrade_required` to Android builds older than the newest
/// `min_supported_version_code`, on every `/v1` route except `/v1/meta/*`.
pub async fn android_version_check(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    let checked = path.starts_with("/v1/") && !path.starts_with("/v1/meta");
    let is_android = request
        .headers()
        .get("x-app-platform")
        .is_some_and(|value| value.as_bytes().eq_ignore_ascii_case(b"android"));
    let version_code = request
        .headers()
        .get("x-app-version-code")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<i32>().ok());
    if checked
        && is_android
        && let Some(version_code) = version_code
    {
        match state.releases.latest(&state.db).await {
            Ok(Some(release)) if version_code < release.min_supported_version_code => {
                return ApiError::UpgradeRequired {
                    download_url: release.download_url,
                }
                .into_response();
            }
            Ok(_) => {}
            Err(error) => tracing::warn!(%error, "could not read the latest release"),
        }
    }
    next.run(request).await
}

/// The client IP: Cloudflare's `CF-Connecting-IP`, else the socket peer.
pub fn client_ip(request: &Request) -> String {
    request
        .headers()
        .get("cf-connecting-ip")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .or_else(|| {
            request
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|info| info.0.ip().to_string())
        })
        .unwrap_or_else(|| "unknown".to_owned())
}

/// Per-IP limits (15 section 3.1): webhooks, the WebSocket upgrade, and every request without
/// a bearer token. Authenticated requests are limited per user in the extractors.
pub async fn ip_rate_limit(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    let group = if path.starts_with("/webhooks/") {
        Some(Group::Webhooks)
    } else if path == "/v1/ws" {
        Some(Group::WebSocket)
    } else if path == "/healthz"
        || path == "/readyz"
        || request.headers().contains_key(AUTHORIZATION)
    {
        None
    } else if path == "/v1/reference/cities" {
        Some(Group::Search)
    } else {
        Some(Group::Unauthenticated)
    };
    if let Some(group) = group {
        let ip = client_ip(&request);
        if let Err(retry_after_seconds) = state.limiter.check(group, &ip) {
            return ApiError::RateLimited {
                retry_after_seconds,
            }
            .into_response();
        }
        if group == Group::Search
            && let Err(retry_after_seconds) = state.limiter.check(Group::Unauthenticated, &ip)
        {
            return ApiError::RateLimited {
                retry_after_seconds,
            }
            .into_response();
        }
    }
    next.run(request).await
}
