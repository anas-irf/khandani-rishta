//! Outbound integrations. Only this module makes HTTP calls to other services
//! (21 section 2). Each integration is a trait so tests and local development can swap in a
//! fake or a disabled implementation; a feature whose variables are empty degrades instead of
//! failing (20 section 2.2).

pub mod clerk;
pub mod content_safety;
pub mod crypto;
pub mod fcm;
pub mod r2;
pub mod resend;

use std::time::Duration;

/// Connect timeout for every outbound call (20 section 10).
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Total timeout for every outbound call (20 section 10).
pub const TOTAL_TIMEOUT: Duration = Duration::from_secs(15);

/// A failure of an outbound integration.
#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    /// The integration is not configured in this environment.
    #[error("the integration is not configured")]
    Disabled,
    /// Worth retrying later: timeouts, connection errors, 429 and 5xx.
    #[error("temporary failure: {0}")]
    Temporary(String),
    /// Retrying will not help: the request was refused.
    #[error("permanent failure: {0}")]
    Permanent(String),
}

impl ServiceError {
    /// Classifies an HTTP status that is not a success.
    pub fn from_status(status: reqwest::StatusCode, context: &str) -> Self {
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            Self::Temporary(format!("{context}: HTTP {status}"))
        } else {
            Self::Permanent(format!("{context}: HTTP {status}"))
        }
    }

    /// Whether a later attempt may succeed.
    pub fn is_temporary(&self) -> bool {
        matches!(self, Self::Temporary(_))
    }
}

impl From<reqwest::Error> for ServiceError {
    fn from(error: reqwest::Error) -> Self {
        // Without the URL, which can carry keys or presigned signatures.
        let error = error.without_url();
        if error.is_timeout() || error.is_connect() || error.is_request() {
            Self::Temporary(error.to_string())
        } else if let Some(status) = error.status() {
            Self::from_status(status, "request failed")
        } else {
            Self::Temporary(error.to_string())
        }
    }
}

/// The HTTP client shared by all integrations, with the standard timeouts.
pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .user_agent(concat!("khandani-api/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("the HTTP client configuration is valid")
}
