//! Email through Resend (14 section 5). Without `RESEND_API_KEY` email is off: the
//! `send_email` job succeeds without sending and logs a warning (20 section 2.2).
//!
//! Every send carries the job id as the provider's idempotency key (19 section 2.7), so a job
//! that runs twice after a crash does not send twice within the provider's window of 24 hours.

use async_trait::async_trait;
use reqwest::StatusCode;
use serde_json::json;

use crate::services::{ServiceError, http_client};

/// The production API origin.
const RESEND_BASE_URL: &str = "https://api.resend.com";

/// One rendered email.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingEmail {
    pub to: String,
    pub subject: String,
    pub html: String,
    pub text: String,
    /// `Reply-To`: the `support.email` setting (14 section 5.1).
    pub reply_to: Option<String>,
    /// Sent as the provider's idempotency key; the job id (19 section 2.7).
    pub idempotency_key: String,
}

#[async_trait]
pub trait EmailSender: Send + Sync {
    fn is_enabled(&self) -> bool;
    async fn send(&self, email: &OutgoingEmail) -> Result<(), ServiceError>;
}

/// Email switched off.
pub struct DisabledEmail;

#[async_trait]
impl EmailSender for DisabledEmail {
    fn is_enabled(&self) -> bool {
        false
    }

    async fn send(&self, _: &OutgoingEmail) -> Result<(), ServiceError> {
        Err(ServiceError::Disabled)
    }
}

/// The real Resend client.
pub struct ResendClient {
    client: reqwest::Client,
    /// `https://api.resend.com`; another origin only in tests.
    base_url: String,
    api_key: String,
    /// `EMAIL_FROM`, for example `Khandani Rishta <no-reply@example.com>`.
    from: String,
}

impl ResendClient {
    pub fn new(api_key: &str, from: &str) -> Self {
        Self::with_base_url(RESEND_BASE_URL, api_key, from)
    }

    fn with_base_url(base_url: &str, api_key: &str, from: &str) -> Self {
        Self {
            client: http_client(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key: api_key.to_owned(),
            from: from.to_owned(),
        }
    }
}

/// Maps a non-success answer of Resend: a rate limit, a server error and an idempotency key that
/// is still being processed (`409`) are worth retrying; the rest was refused for good.
fn classify(status: StatusCode) -> ServiceError {
    if status == StatusCode::CONFLICT {
        ServiceError::Temporary(format!("resend send: HTTP {status}"))
    } else {
        ServiceError::from_status(status, "resend send")
    }
}

#[async_trait]
impl EmailSender for ResendClient {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn send(&self, email: &OutgoingEmail) -> Result<(), ServiceError> {
        let mut body = json!({
            "from": self.from,
            "to": [email.to],
            "subject": email.subject,
            "html": email.html,
            "text": email.text,
        });
        if let Some(reply_to) = &email.reply_to {
            body["reply_to"] = json!(reply_to);
        }
        let response = self
            .client
            .post(format!("{}/emails", self.base_url))
            .bearer_auth(&self.api_key)
            .header("Idempotency-Key", &email.idempotency_key)
            .json(&body)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(classify(status))
        }
    }
}

/// The implementation for this environment. Without `RESEND_API_KEY`, email is off.
pub fn from_config(config: &crate::config::Config) -> std::sync::Arc<dyn EmailSender> {
    match &config.resend_api_key {
        Some(key) => std::sync::Arc::new(ResendClient::new(key, &config.email_from)),
        None => std::sync::Arc::new(DisabledEmail),
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn email() -> OutgoingEmail {
        OutgoingEmail {
            to: "ayesha@example.com".to_owned(),
            subject: "Your profile is live".to_owned(),
            html: "<p>Hello</p>".to_owned(),
            text: "Hello".to_owned(),
            reply_to: Some("support@example.com".to_owned()),
            idempotency_key: "0193a2c4-job".to_owned(),
        }
    }

    #[tokio::test]
    async fn sends_json_with_the_key_and_the_idempotency_header() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/emails"))
            .and(header("authorization", "Bearer re_test"))
            .and(header("idempotency-key", "0193a2c4-job"))
            .and(body_json(json!({
                "from": "Khandani Rishta <no-reply@example.com>",
                "to": ["ayesha@example.com"],
                "subject": "Your profile is live",
                "html": "<p>Hello</p>",
                "text": "Hello",
                "reply_to": "support@example.com",
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": "abc" })))
            .expect(1)
            .mount(&server)
            .await;
        ResendClient::with_base_url(
            &server.uri(),
            "re_test",
            "Khandani Rishta <no-reply@example.com>",
        )
        .send(&email())
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn rate_limits_and_server_errors_are_temporary_and_refusals_are_not() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(429))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(409))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(422))
            .mount(&server)
            .await;
        let client = ResendClient::with_base_url(&server.uri(), "re_test", "from@example.com");
        for _ in 0..3 {
            assert!(client.send(&email()).await.unwrap_err().is_temporary());
        }
        assert!(!client.send(&email()).await.unwrap_err().is_temporary());
    }

    #[tokio::test]
    async fn reply_to_is_left_out_when_unset() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_json(json!({
                "from": "from@example.com",
                "to": ["ayesha@example.com"],
                "subject": "Your profile is live",
                "html": "<p>Hello</p>",
                "text": "Hello",
            })))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        let email = OutgoingEmail {
            reply_to: None,
            ..email()
        };
        ResendClient::with_base_url(&server.uri(), "k", "from@example.com")
            .send(&email)
            .await
            .unwrap();
    }
}
