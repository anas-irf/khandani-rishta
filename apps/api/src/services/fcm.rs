//! Android push through Firebase Cloud Messaging (14 section 4, 19 section 2.6).
//! Without FCM credentials push is off.
//!
//! The client uses the FCM HTTP v1 API with an access token from the service account in
//! `FCM_SERVICE_ACCOUNT_JSON`. `gcp_auth` signs the token request and caches the token until it
//! expires, so the client never caches tokens itself.
//!
//! Pushes are **data messages**: there is no `notification` block, so the app builds the visible
//! notification itself from `type` and `data`, in the device language (14 section 4.1). The
//! payload therefore carries only the allowed keys, all values strings. The `title`, `body` and
//! `channel_id` of a [`PushMessage`] are for logs and tests: they are not sent, because the app
//! owns those texts and channels.

use std::sync::Arc;

use async_trait::async_trait;
use gcp_auth::{CustomServiceAccount, TokenProvider};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::config::FcmConfig;
use crate::services::{ServiceError, http_client};

/// The OAuth scope of the FCM HTTP v1 API.
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
/// The production API origin.
const FCM_BASE_URL: &str = "https://fcm.googleapis.com";

/// The keys of the FCM `data` map (14 section 4.1 rule 2). Nothing else is ever sent, so a name,
/// a photo URL, a reason or a text cannot leak into a lock screen by mistake.
pub const ALLOWED_DATA_KEYS: [&str; 11] = [
    "type",
    "target",
    "notification_id",
    "connection_id",
    "interest_id",
    "profile_id",
    "saved_search_id",
    "field",
    "count",
    "stage",
    "sent_at",
];

/// One push message for one device.
#[derive(Debug, Clone, PartialEq)]
pub struct PushMessage {
    pub title: String,
    pub body: String,
    /// Android notification channel (14 section 4.2).
    pub channel_id: String,
    pub collapse_key: Option<String>,
    pub ttl_seconds: Option<u32>,
    /// String key-value data the app reads when the push is tapped.
    pub data: Value,
}

/// The outcome of sending to one device.
#[derive(Debug, thiserror::Error)]
pub enum PushError {
    /// The token is no longer valid (404 `UNREGISTERED` or 400 `INVALID_ARGUMENT`): delete the device.
    #[error("the device token is no longer registered")]
    Unregistered,
    #[error(transparent)]
    Service(#[from] ServiceError),
}

#[async_trait]
pub trait PushSender: Send + Sync {
    fn is_enabled(&self) -> bool;
    async fn send(&self, push_token: &str, message: &PushMessage) -> Result<(), PushError>;
}

/// Push switched off.
pub struct DisabledPush;

#[async_trait]
impl PushSender for DisabledPush {
    fn is_enabled(&self) -> bool {
        false
    }

    async fn send(&self, _: &str, _: &PushMessage) -> Result<(), PushError> {
        Err(PushError::Service(ServiceError::Disabled))
    }
}

/// The real FCM HTTP v1 client.
pub struct FcmClient {
    client: reqwest::Client,
    /// `https://fcm.googleapis.com`; another origin only in tests.
    base_url: String,
    project_id: String,
    tokens: Arc<dyn TokenProvider>,
}

impl FcmClient {
    /// A client for the configured project. Fails when the service account JSON is not valid.
    pub fn new(config: &FcmConfig) -> Result<Self, gcp_auth::Error> {
        let account = CustomServiceAccount::from_json(&config.service_account_json)?;
        Ok(Self::with_parts(
            FCM_BASE_URL,
            config.project_id.clone(),
            Arc::new(account),
        ))
    }

    /// A client against another origin and token source, for tests.
    fn with_parts(base_url: &str, project_id: String, tokens: Arc<dyn TokenProvider>) -> Self {
        Self {
            client: http_client(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            project_id,
            tokens,
        }
    }

    fn send_url(&self) -> String {
        format!(
            "{}/v1/projects/{}/messages:send",
            self.base_url, self.project_id
        )
    }
}

/// The `data` map of a message: allowed keys only, every value a string. `null` becomes the empty
/// string ("not applicable"); arrays and objects are dropped.
fn string_data(data: &Value) -> Map<String, Value> {
    let mut map = Map::new();
    let Some(object) = data.as_object() else {
        return map;
    };
    for key in ALLOWED_DATA_KEYS {
        let Some(value) = object.get(key) else {
            continue;
        };
        let text = match value {
            Value::String(text) => text.clone(),
            Value::Number(number) => number.to_string(),
            Value::Bool(flag) => flag.to_string(),
            Value::Null => String::new(),
            Value::Array(_) | Value::Object(_) => continue,
        };
        map.insert(key.to_owned(), Value::String(text));
    }
    map
}

/// FCM delivers high priority messages at once even in Doze. The channels that make a sound
/// are high; the quiet `activity` channel is normal (14 section 4.2).
fn android_priority(channel_id: &str) -> &'static str {
    match channel_id {
        "messages" | "interests" | "account" => "high",
        _ => "normal",
    }
}

/// The request body of 14 section 4.1.
pub fn request_body(push_token: &str, message: &PushMessage) -> Value {
    let mut android = Map::new();
    android.insert(
        "priority".to_owned(),
        json!(android_priority(&message.channel_id)),
    );
    if let Some(key) = &message.collapse_key {
        android.insert("collapse_key".to_owned(), json!(key));
    }
    if let Some(ttl) = message.ttl_seconds {
        android.insert("ttl".to_owned(), json!(format!("{ttl}s")));
    }
    json!({
        "message": {
            "token": push_token,
            "android": android,
            "data": string_data(&message.data),
        }
    })
}

#[derive(Debug, Deserialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Default, Deserialize)]
struct ErrorBody {
    status: Option<String>,
    #[serde(default)]
    details: Vec<ErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    #[serde(rename = "errorCode")]
    error_code: Option<String>,
}

/// Maps a non-success answer of FCM to the error the job acts on (19 section 2.6 step 7):
/// `404 UNREGISTERED` and `400 INVALID_ARGUMENT` mean the token is dead; `429` and `5xx` are
/// temporary; everything else (credentials, quota of the project) will not fix itself.
///
/// A `404` without the `UNREGISTERED` code is not treated as a dead token: a wrong project id
/// also answers `404`, and that must not delete every device.
pub fn classify(status: reqwest::StatusCode, body: &str) -> PushError {
    let error =
        serde_json::from_str::<ErrorEnvelope>(body).map_or_default(|envelope| envelope.error);
    let has_code = |code: &str| {
        error
            .details
            .iter()
            .any(|detail| detail.error_code.as_deref() == Some(code))
    };
    match status.as_u16() {
        404 if has_code("UNREGISTERED") => PushError::Unregistered,
        400 if error.status.as_deref() == Some("INVALID_ARGUMENT")
            || has_code("INVALID_ARGUMENT") =>
        {
            PushError::Unregistered
        }
        _ => PushError::Service(ServiceError::from_status(status, "fcm send")),
    }
}

#[async_trait]
impl PushSender for FcmClient {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn send(&self, push_token: &str, message: &PushMessage) -> Result<(), PushError> {
        let access = self.tokens.token(&[FCM_SCOPE]).await.map_err(|error| {
            // The token request failed: network, or credentials Google refuses.
            PushError::Service(ServiceError::Temporary(format!("fcm auth: {error}")))
        })?;
        let response = self
            .client
            .post(self.send_url())
            .bearer_auth(access.as_str())
            .json(&request_body(push_token, message))
            .send()
            .await
            .map_err(ServiceError::from)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.text().await.unwrap_or_default();
        Err(classify(status, &body))
    }
}

/// The implementation for this environment. Without FCM credentials, push is off; credentials
/// that cannot be read turn it off too, with a warning, so a bad secret never stops the API.
pub fn from_config(config: &crate::config::Config) -> Arc<dyn PushSender> {
    let Some(fcm) = &config.fcm else {
        return Arc::new(DisabledPush);
    };
    match FcmClient::new(fcm) {
        Ok(client) => Arc::new(client),
        Err(error) => {
            tracing::warn!(%error, "FCM_SERVICE_ACCOUNT_JSON is not usable; push is off");
            Arc::new(DisabledPush)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    /// A token source that counts how often it is asked.
    struct StaticToken(AtomicUsize);

    #[async_trait]
    impl TokenProvider for StaticToken {
        async fn token(&self, _: &[&str]) -> Result<Arc<gcp_auth::Token>, gcp_auth::Error> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(
                serde_json::from_value(json!({ "access_token": "test-token", "expires_in": 3600 }))
                    .expect("a token"),
            ))
        }

        async fn project_id(&self) -> Result<Arc<str>, gcp_auth::Error> {
            Ok(Arc::from("kr-test"))
        }
    }

    fn client_for(server: &MockServer) -> FcmClient {
        FcmClient::with_parts(
            &server.uri(),
            "kr-test".to_owned(),
            Arc::new(StaticToken(AtomicUsize::new(0))),
        )
    }

    fn chat_message() -> PushMessage {
        PushMessage {
            title: "Khandani Rishta".to_owned(),
            body: "You have a new message".to_owned(),
            channel_id: "messages".to_owned(),
            collapse_key: Some("msg_0193".to_owned()),
            ttl_seconds: Some(86_400),
            data: json!({
                "type": "message",
                "target": "APP-CHAT",
                "connection_id": "0193",
                "notification_id": "",
                "count": 1,
                "sent_at": "2026-11-20T10:15:00Z",
                "display_name": "Ayesha K.",
                "text": "Assalamu alaikum, how are you?",
                "nested": { "a": 1 },
            }),
        }
    }

    #[test]
    fn the_body_is_a_data_message_with_allowed_keys_only() {
        let body = request_body("device-token", &chat_message());
        assert_eq!(
            body,
            json!({
                "message": {
                    "token": "device-token",
                    "android": { "priority": "high", "collapse_key": "msg_0193", "ttl": "86400s" },
                    "data": {
                        "type": "message",
                        "target": "APP-CHAT",
                        "notification_id": "",
                        "connection_id": "0193",
                        "count": "1",
                        "sent_at": "2026-11-20T10:15:00Z"
                    }
                }
            })
        );
        assert!(body["message"].get("notification").is_none());
        let text = body.to_string();
        assert!(!text.contains("Ayesha") && !text.contains("Assalamu"));
    }

    #[test]
    fn quiet_channels_use_normal_priority_and_optional_fields_are_left_out() {
        let message = PushMessage {
            channel_id: "activity".to_owned(),
            collapse_key: None,
            ttl_seconds: None,
            ..chat_message()
        };
        let body = request_body("t", &message);
        assert_eq!(body["message"]["android"], json!({ "priority": "normal" }));
    }

    #[tokio::test]
    async fn sends_with_the_bearer_token_to_the_project_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/projects/kr-test/messages:send"))
            .and(header("authorization", "Bearer test-token"))
            .and(body_json(request_body("device-token", &chat_message())))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "name": "projects/kr-test/messages/1" })),
            )
            .expect(1)
            .mount(&server)
            .await;
        client_for(&server)
            .send("device-token", &chat_message())
            .await
            .unwrap();
    }

    fn fcm_error(status: u16, status_text: &str, code: Option<&str>) -> ResponseTemplate {
        let details = code.map_or_else(Vec::new, |code| {
            vec![json!({
                "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                "errorCode": code
            })]
        });
        ResponseTemplate::new(status).set_body_json(json!({
            "error": { "code": status, "message": "error", "status": status_text, "details": details }
        }))
    }

    #[tokio::test]
    async fn dead_tokens_are_unregistered_and_server_trouble_is_temporary() {
        let server = MockServer::start().await;
        for (token, response) in [
            ("gone", fcm_error(404, "NOT_FOUND", Some("UNREGISTERED"))),
            (
                "bad",
                fcm_error(400, "INVALID_ARGUMENT", Some("INVALID_ARGUMENT")),
            ),
            (
                "quota",
                fcm_error(429, "RESOURCE_EXHAUSTED", Some("QUOTA_EXCEEDED")),
            ),
            ("down", fcm_error(503, "UNAVAILABLE", Some("UNAVAILABLE"))),
            (
                "denied",
                fcm_error(403, "PERMISSION_DENIED", Some("SENDER_ID_MISMATCH")),
            ),
            ("project", fcm_error(404, "NOT_FOUND", None)),
        ] {
            Mock::given(method("POST"))
                .and(wiremock::matchers::body_partial_json(
                    json!({ "message": { "token": token } }),
                ))
                .respond_with(response)
                .mount(&server)
                .await;
        }
        let client = client_for(&server);
        let send = |token: &'static str| {
            let client = &client;
            async move { client.send(token, &chat_message()).await.unwrap_err() }
        };
        assert!(matches!(send("gone").await, PushError::Unregistered));
        assert!(matches!(send("bad").await, PushError::Unregistered));
        for token in ["quota", "down"] {
            match send(token).await {
                PushError::Service(error) => assert!(error.is_temporary(), "{token}"),
                PushError::Unregistered => panic!("{token} must be temporary"),
            }
        }
        for token in ["denied", "project"] {
            match send(token).await {
                PushError::Service(error) => assert!(!error.is_temporary(), "{token}"),
                PushError::Unregistered => panic!("{token} must not delete the device"),
            }
        }
    }

    #[test]
    fn a_service_account_that_cannot_be_read_turns_push_off() {
        let config = crate::config::FcmConfig {
            project_id: "kr-test".to_owned(),
            service_account_json: "not json".to_owned(),
        };
        assert!(FcmClient::new(&config).is_err());
    }
}
