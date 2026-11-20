//! The API error type and its JSON body (15 section 2).
//!
//! Every non-2xx response has the shape
//! `{ "error": { "code", "message", "fields", "details", "request_id" } }`. Handlers return
//! `Result<_, ApiError>`; extractors in [`crate::extract`] map their rejections to it too.

use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::{Value, json};
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::types::{ConsentDocument, OnboardingStep, ProfileStatus};

tokio::task_local! {
    /// The `x-request-id` of the request being handled, for error bodies and logs.
    static REQUEST_ID: String;
}

/// Runs the rest of the request inside a scope that knows its request id, so that every
/// error body can carry it.
pub async fn scope_request_id(request: Request, next: Next) -> Response {
    let id = request
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    REQUEST_ID.scope(id, next.run(request)).await
}

/// The current request id, or an empty string outside a request.
pub fn current_request_id() -> String {
    REQUEST_ID.try_with(Clone::clone).unwrap_or_default()
}

/// Field error codes (15 section 2.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FieldCode {
    Required,
    Invalid,
    TooShort,
    TooLong,
    OutOfRange,
    UnknownCode,
    NotAllowed,
    TooYoung,
    ContainsContactInfo,
    Inappropriate,
    Mismatch,
    Locked,
}

impl FieldCode {
    /// English fallback text shown when the client has no better message.
    pub fn default_message(self) -> &'static str {
        match self {
            Self::Required => "This field is required.",
            Self::Invalid => "This value is not valid.",
            Self::TooShort => "This value is too short.",
            Self::TooLong => "This value is too long.",
            Self::OutOfRange => "This value is out of range.",
            Self::UnknownCode => "This option is not available.",
            Self::NotAllowed => "This value is not allowed here.",
            Self::TooYoung => "The candidate must be at least 18 years old.",
            Self::ContainsContactInfo => {
                "Please remove phone numbers, email addresses, links and social media handles."
            }
            Self::Inappropriate => "Please remove inappropriate language.",
            Self::Mismatch => "This value does not match.",
            Self::Locked => "This field can no longer be changed. Please contact support.",
        }
    }
}

/// One invalid field of a request body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct FieldError {
    /// JSON key of the request body, dot-separated for nested keys.
    pub field: String,
    pub code: FieldCode,
    pub message: String,
}

impl FieldError {
    pub fn new(field: impl Into<String>, code: FieldCode) -> Self {
        Self {
            field: field.into(),
            code,
            message: code.default_message().to_owned(),
        }
    }

    pub fn with_message(
        field: impl Into<String>,
        code: FieldCode,
        message: impl Into<String>,
    ) -> Self {
        Self {
            field: field.into(),
            code,
            message: message.into(),
        }
    }
}

/// Collects field errors while validating a body, then turns into `validation_failed`.
#[derive(Debug, Default)]
pub struct FieldErrors(Vec<FieldError>);

impl FieldErrors {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, field: impl Into<String>, code: FieldCode) {
        self.0.push(FieldError::new(field, code));
    }

    pub fn push(&mut self, error: FieldError) {
        self.0.push(error);
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// True when the field already has an error, so later checks can skip it.
    pub fn has(&self, field: &str) -> bool {
        self.0.iter().any(|error| error.field == field)
    }

    pub fn into_inner(self) -> Vec<FieldError> {
        self.0
    }

    /// `Ok(())` when nothing was added, otherwise `validation_failed` with every field.
    pub fn finish(self) -> Result<(), ApiError> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(ApiError::Validation(self.0))
        }
    }
}

/// Every error the API returns (15 section 2.1).
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("validation failed")]
    Validation(Vec<FieldError>),
    #[error("unauthenticated")]
    Unauthenticated,
    #[error("forbidden")]
    Forbidden,
    #[error("account banned")]
    AccountBanned { reason: Option<String> },
    #[error("account suspended")]
    AccountSuspended {
        reason: Option<String>,
        suspended_until: Option<OffsetDateTime>,
    },
    #[error("account deletion scheduled")]
    AccountDeletionScheduled { purge_after: Option<OffsetDateTime> },
    #[error("consent required")]
    ConsentRequired { documents: Vec<ConsentDocument> },
    #[error("onboarding required")]
    OnboardingRequired { onboarding_step: OnboardingStep },
    #[error("profile not active")]
    ProfileNotActive { status: ProfileStatus },
    #[error("not found")]
    NotFound,
    #[error("invalid state")]
    InvalidState { details: Value },
    #[error("already exists")]
    AlreadyExists,
    #[error("identity already registered")]
    IdentityAlreadyRegistered,
    #[error("interest already pending")]
    InterestAlreadyPending { interest_id: Uuid },
    #[error("already connected")]
    AlreadyConnected { connection_id: Uuid },
    #[error("cooldown active")]
    CooldownActive { retry_after_date: Date },
    #[error("not permitted by member")]
    NotPermittedByMember { reason: &'static str },
    #[error("connection ended")]
    ConnectionEnded,
    #[error("payload too large")]
    PayloadTooLarge { max_bytes: u64 },
    #[error("upgrade required")]
    UpgradeRequired { download_url: String },
    #[error("rate limited")]
    RateLimited { retry_after_seconds: u64 },
    #[error("limit reached: {limit}")]
    LimitReached {
        limit: &'static str,
        used: i64,
        resets_at: Option<OffsetDateTime>,
        /// For the connection cap: `you` or `them`, whose cap is full.
        side: Option<&'static str>,
    },
    #[error("internal error: {0:#}")]
    Internal(#[from] anyhow::Error),
    #[error("service unavailable")]
    ServiceUnavailable,
}

impl ApiError {
    /// `409 invalid_state` with `details.status`.
    pub fn invalid_state(status: impl Serialize) -> Self {
        Self::InvalidState {
            details: json!({ "status": status }),
        }
    }

    /// `400 validation_failed` for a single field.
    pub fn field(field: impl Into<String>, code: FieldCode) -> Self {
        Self::Validation(vec![FieldError::new(field, code)])
    }

    /// `429 limit_reached` without a reset time (total limits such as photos or saved searches).
    pub fn limit(limit: &'static str, used: i64) -> Self {
        Self::LimitReached {
            limit,
            used,
            resets_at: None,
            side: None,
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) | Self::Validation(_) => StatusCode::BAD_REQUEST,
            Self::Unauthenticated => StatusCode::UNAUTHORIZED,
            Self::Forbidden
            | Self::AccountBanned { .. }
            | Self::AccountSuspended { .. }
            | Self::AccountDeletionScheduled { .. }
            | Self::ConsentRequired { .. }
            | Self::OnboardingRequired { .. }
            | Self::ProfileNotActive { .. } => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::InvalidState { .. }
            | Self::AlreadyExists
            | Self::IdentityAlreadyRegistered
            | Self::InterestAlreadyPending { .. }
            | Self::AlreadyConnected { .. }
            | Self::CooldownActive { .. }
            | Self::NotPermittedByMember { .. }
            | Self::ConnectionEnded => StatusCode::CONFLICT,
            Self::PayloadTooLarge { .. } => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UpgradeRequired { .. } => StatusCode::UPGRADE_REQUIRED,
            Self::RateLimited { .. } | Self::LimitReached { .. } => StatusCode::TOO_MANY_REQUESTS,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::ServiceUnavailable => StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    /// The stable code clients branch on.
    pub fn code(&self) -> &'static str {
        match self {
            Self::BadRequest(_) => "bad_request",
            Self::Validation(_) => "validation_failed",
            Self::Unauthenticated => "unauthenticated",
            Self::Forbidden => "forbidden",
            Self::AccountBanned { .. } => "account_banned",
            Self::AccountSuspended { .. } => "account_suspended",
            Self::AccountDeletionScheduled { .. } => "account_deletion_scheduled",
            Self::ConsentRequired { .. } => "consent_required",
            Self::OnboardingRequired { .. } => "onboarding_required",
            Self::ProfileNotActive { .. } => "profile_not_active",
            Self::NotFound => "not_found",
            Self::InvalidState { .. } => "invalid_state",
            Self::AlreadyExists => "already_exists",
            Self::IdentityAlreadyRegistered => "identity_already_registered",
            Self::InterestAlreadyPending { .. } => "interest_already_pending",
            Self::AlreadyConnected { .. } => "already_connected",
            Self::CooldownActive { .. } => "cooldown_active",
            Self::NotPermittedByMember { .. } => "not_permitted_by_member",
            Self::ConnectionEnded => "connection_ended",
            Self::PayloadTooLarge { .. } => "payload_too_large",
            Self::UpgradeRequired { .. } => "upgrade_required",
            Self::RateLimited { .. } => "rate_limited",
            Self::LimitReached { .. } => "limit_reached",
            Self::Internal(_) => "internal_error",
            Self::ServiceUnavailable => "service_unavailable",
        }
    }

    fn message(&self) -> String {
        match self {
            Self::BadRequest(_) => "The request could not be read.",
            Self::Validation(_) => "Some fields need your attention.",
            Self::Unauthenticated => "Please sign in again.",
            Self::Forbidden => "You are not allowed to do this.",
            Self::AccountBanned { .. } => "This account has been closed.",
            Self::AccountSuspended { .. } => "This account is suspended.",
            Self::AccountDeletionScheduled { .. } => "This account is scheduled for deletion.",
            Self::ConsentRequired { .. } => "Please accept the updated terms to continue.",
            Self::OnboardingRequired { .. } => "Please finish setting up your profile first.",
            Self::ProfileNotActive { .. } => "Your profile cannot do this in its current state.",
            Self::NotFound => "This could not be found.",
            Self::InvalidState { .. } => "This action is not possible right now.",
            Self::AlreadyExists => "This already exists.",
            Self::IdentityAlreadyRegistered => {
                "This identity document is already registered on another profile."
            }
            Self::InterestAlreadyPending { .. } => {
                "You have already sent an interest to this profile."
            }
            Self::AlreadyConnected { .. } => "You are already connected with this member.",
            Self::CooldownActive { .. } => "Please wait before trying this again.",
            Self::NotPermittedByMember { .. } => "This member's settings do not allow this.",
            Self::ConnectionEnded => "This conversation has ended.",
            Self::PayloadTooLarge { .. } => "This is too large.",
            Self::UpgradeRequired { .. } => "Please update the app to continue.",
            Self::RateLimited { .. } => "Too many requests. Please slow down.",
            Self::LimitReached { .. } => "You have reached the limit for now.",
            Self::Internal(_) => "Something went wrong on our side.",
            Self::ServiceUnavailable => "The service is temporarily unavailable. Please try again.",
        }
        .to_owned()
    }

    fn details(&self) -> Value {
        match self {
            Self::AccountBanned { reason } => json!({ "reason": reason }),
            Self::AccountSuspended {
                reason,
                suspended_until,
            } => json!({ "reason": reason, "suspended_until": rfc3339(*suspended_until) }),
            Self::AccountDeletionScheduled { purge_after } => {
                json!({ "purge_after": rfc3339(*purge_after) })
            }
            Self::ConsentRequired { documents } => json!({ "documents": documents }),
            Self::OnboardingRequired { onboarding_step } => {
                json!({ "onboarding_step": onboarding_step })
            }
            Self::ProfileNotActive { status } => json!({ "status": status }),
            Self::InvalidState { details } => details.clone(),
            Self::InterestAlreadyPending { interest_id } => json!({ "interest_id": interest_id }),
            Self::AlreadyConnected { connection_id } => json!({ "connection_id": connection_id }),
            Self::CooldownActive { retry_after_date } => {
                json!({ "retry_after_date": retry_after_date.to_string() })
            }
            Self::NotPermittedByMember { reason } => json!({ "reason": reason }),
            Self::PayloadTooLarge { max_bytes } => json!({ "max_bytes": max_bytes }),
            Self::UpgradeRequired { download_url } => json!({ "download_url": download_url }),
            Self::RateLimited {
                retry_after_seconds,
            } => json!({ "retry_after_seconds": retry_after_seconds }),
            Self::LimitReached {
                limit,
                used,
                resets_at,
                side,
            } => {
                let mut details =
                    json!({ "limit": limit, "used": used, "resets_at": rfc3339(*resets_at) });
                if let Some(side) = side {
                    details["side"] = json!(side);
                }
                details
            }
            _ => json!({}),
        }
    }

    /// The JSON body, for responses and tests.
    pub fn body(&self) -> ErrorBody {
        ErrorBody {
            error: ErrorDetail {
                code: self.code().to_owned(),
                message: self.message(),
                fields: match self {
                    Self::Validation(fields) => Some(fields.clone()),
                    _ => None,
                },
                details: self.details(),
                request_id: current_request_id(),
            },
        }
    }
}

fn rfc3339(value: Option<OffsetDateTime>) -> Option<String> {
    value.and_then(|at| {
        at.format(&time::format_description::well_known::Rfc3339)
            .ok()
    })
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        match error {
            sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed | sqlx::Error::Io(_) => {
                tracing::error!(%error, "database unavailable");
                Self::ServiceUnavailable
            }
            other => Self::Internal(anyhow::Error::new(other)),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match &self {
            Self::Internal(error) => {
                tracing::error!(error = %format!("{error:#}"), "internal error");
            }
            Self::BadRequest(reason) => tracing::debug!(%reason, "bad request"),
            _ => {}
        }
        let status = self.status();
        let mut response = (status, axum::Json(self.body())).into_response();
        if let Self::RateLimited {
            retry_after_seconds,
        } = self
            && let Ok(value) = HeaderValue::from_str(&retry_after_seconds.to_string())
        {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        response
    }
}

/// The error body (15 section 2).
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorDetail {
    /// Stable code clients branch on (15 section 2.1).
    pub code: String,
    /// English text suitable for display as a fallback.
    pub message: String,
    /// Present only for `validation_failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<FieldError>>,
    /// Extra data for some codes.
    #[schema(value_type = Object)]
    pub details: Value,
    pub request_id: String,
}

/// Result type of every handler.
pub type ApiResult<T> = Result<T, ApiError>;

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    async fn render(error: ApiError) -> (StatusCode, Value) {
        let response = REQUEST_ID
            .scope("req-1".to_owned(), async move { error.into_response() })
            .await;
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[tokio::test]
    async fn validation_failed_lists_fields() {
        let (status, body) = render(ApiError::field("date_of_birth", FieldCode::TooYoung)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            body,
            json!({
                "error": {
                    "code": "validation_failed",
                    "message": "Some fields need your attention.",
                    "fields": [{
                        "field": "date_of_birth",
                        "code": "too_young",
                        "message": "The candidate must be at least 18 years old."
                    }],
                    "details": {},
                    "request_id": "req-1"
                }
            })
        );
    }

    #[tokio::test]
    async fn not_found_has_no_fields() {
        let (status, body) = render(ApiError::NotFound).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            body,
            json!({
                "error": {
                    "code": "not_found",
                    "message": "This could not be found.",
                    "details": {},
                    "request_id": "req-1"
                }
            })
        );
    }

    #[tokio::test]
    async fn limit_reached_carries_details() {
        let (status, body) = render(ApiError::LimitReached {
            limit: "limits.active_connections_max",
            used: 30,
            resets_at: None,
            side: Some("them"),
        })
        .await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            body["error"]["details"],
            json!({ "limit": "limits.active_connections_max", "used": 30, "resets_at": null, "side": "them" })
        );
    }

    #[tokio::test]
    async fn rate_limited_sets_retry_after() {
        let response = ApiError::RateLimited {
            retry_after_seconds: 7,
        }
        .into_response();
        assert_eq!(response.headers()[header::RETRY_AFTER], "7");
    }

    #[test]
    fn every_status_matches_the_contract() {
        assert_eq!(ApiError::Forbidden.status(), StatusCode::FORBIDDEN);
        assert_eq!(ApiError::AlreadyExists.status(), StatusCode::CONFLICT);
        assert_eq!(
            ApiError::UpgradeRequired {
                download_url: String::new()
            }
            .status()
            .as_u16(),
            426
        );
        assert_eq!(ApiError::ServiceUnavailable.status().as_u16(), 503);
    }
}
