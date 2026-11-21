//! Cross-cutting request steps that run before the extractors: the Android version check
//! (15 section 3, 06 section 6.4) and the rate limits counted before a handler runs
//! (15 section 3.1).

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{Extensions, HeaderMap};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use moka::sync::Cache;
use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;

use crate::auth::token::{bearer_token, verify};
use crate::error::ApiError;
use crate::ratelimit::{Group, user_key};
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
    client_ip_of(request.headers(), request.extensions())
}

/// [`client_ip`] from the parts of a request, for extractors.
pub fn client_ip_of(headers: &HeaderMap, extensions: &Extensions) -> String {
    headers
        .get("cf-connecting-ip")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .or_else(|| {
            extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|info| info.0.ip().to_string())
        })
        .unwrap_or_else(|| "unknown".to_owned())
}

/// Whether a path belongs to a route of level `public` (15 section 3). No access-level
/// extractor runs on these, so nothing after this middleware counts their requests.
fn is_public(path: &str) -> bool {
    path == "/v1/meta" || path.starts_with("/v1/meta/") || path.starts_with("/v1/reference/")
}

/// What a request counts against before its handler runs (15 section 3.1).
enum Charge {
    /// Nothing here: health checks, and requests with a token to routes whose access-level
    /// extractor counts them, per user or, when it refuses the token, per IP. A token sent to
    /// a path with no route is counted by [`unmatched`].
    Nothing,
    /// The client IP, in each of these groups.
    Ip(String, &'static [Group]),
    /// A public route with a bearer token: per user in `user_group` when the token is valid,
    /// otherwise like [`Charge::Ip`].
    Public {
        token: String,
        user_group: Group,
        ip: String,
        ip_groups: &'static [Group],
    },
}

impl Charge {
    fn of(request: &Request) -> Self {
        let path = request.uri().path();
        if path.starts_with("/webhooks/") {
            return Self::Ip(client_ip(request), &[Group::Webhooks]);
        }
        if path == "/v1/ws" {
            return Self::Ip(client_ip(request), &[Group::WebSocket]);
        }
        if path == "/healthz" || path == "/readyz" {
            return Self::Nothing;
        }
        let header = request.headers().get(AUTHORIZATION);
        if is_public(path) {
            let ip_groups: &'static [Group] = if path == "/v1/reference/cities" {
                &[Group::Search, Group::Unauthenticated]
            } else {
                &[Group::Unauthenticated]
            };
            let token = header
                .and_then(|value| value.to_str().ok())
                .and_then(|value| bearer_token(Some(value)).ok());
            return match token {
                Some(token) => Self::Public {
                    token: token.to_owned(),
                    user_group: Group::for_request(request.method(), path),
                    ip: client_ip(request),
                    ip_groups,
                },
                None => Self::Ip(client_ip(request), ip_groups),
            };
        }
        if header.is_some() {
            Self::Nothing
        } else {
            Self::Ip(client_ip(request), &[Group::Unauthenticated])
        }
    }

    /// Counts the request. `Err(seconds)` when one of its limits is used up.
    async fn count(self, state: &AppState) -> Result<(), u64> {
        let per_ip = |ip: &str, groups: &[Group]| {
            groups
                .iter()
                .try_for_each(|group| state.limiter.check(*group, ip))
        };
        match self {
            Self::Nothing => Ok(()),
            Self::Ip(ip, groups) => per_ip(&ip, groups),
            Self::Public {
                token,
                user_group,
                ip,
                ip_groups,
            } => match verify(&token, &state.jwks, &state.config.clerk).await {
                Ok(claims) => state.limiter.check(user_group, &user_key(&claims.sub)),
                Err(_) => per_ip(&ip, ip_groups),
            },
        }
    }
}

/// The rate limits counted before the handler runs (15 section 3.1). Webhooks, the WebSocket
/// upgrade and requests without a token count per IP. Public routes count per user when the
/// token is valid and per IP otherwise. Every other request with a token is counted by its
/// access-level extractor: per user, or per IP when the token is refused.
pub async fn ip_rate_limit(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    match Charge::of(&request).count(&state).await {
        Ok(()) => next.run(request).await,
        Err(retry_after_seconds) => ApiError::RateLimited {
            retry_after_seconds,
        }
        .into_response(),
    }
}

/// Answers `404 not_found` to a path with no route. No access-level extractor runs here, so a
/// request that carries an `Authorization` header, which [`ip_rate_limit`] leaves to the
/// extractors, is counted against its client IP in the `Unauthenticated` group instead.
pub async fn unmatched(State(state): State<AppState>, request: Request) -> Response {
    if request.headers().contains_key(AUTHORIZATION)
        && let Err(retry_after_seconds) = state
            .limiter
            .check(Group::Unauthenticated, &client_ip(&request))
    {
        return ApiError::RateLimited {
            retry_after_seconds,
        }
        .into_response();
    }
    ApiError::NotFound.into_response()
}
