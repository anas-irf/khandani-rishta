//! Azure AI Content Safety: automatic text and image checks (13 sections 3, 4 and 12).
//!
//! With no endpoint configured, automatic moderation is off: texts stay `pending` and photos
//! go to `pending_review` for a moderator (20 section 10). The same happens while the service is
//! down or its monthly quota is used up: those failures are reported as
//! [`ServiceError::Temporary`] and callers fall back to the manual queue.
//!
//! This module also holds the severity tables of 13 sections 3.7 and 4.2, because they are the
//! other half of the service: the client returns severities, [`text_verdict`] and
//! [`image_verdict`] turn them into a decision.

use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;

use crate::config::{Config, ContentSafetyConfig};
use crate::services::{ServiceError, http_client};

/// The REST API version of the text and image analyze operations.
const API_VERSION: &str = "2023-10-01";
/// Longest piece of an error body kept in an error message.
const MAX_ERROR_TEXT: usize = 200;
/// The harm categories asked for, in the order of 13 section 3.7.
const CATEGORIES: [&str; 4] = ["Hate", "Sexual", "Violence", "SelfHarm"];

/// The severity the service gave one harm category.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CategorySeverity {
    pub category: String,
    pub severity: u8,
}

/// The result of one check: per-category severities plus the raw response, stored in
/// `profile_photos.moderation` for photos.
#[derive(Debug, Clone, PartialEq)]
pub struct SafetyAnalysis {
    pub categories: Vec<CategorySeverity>,
    pub raw: Value,
}

impl SafetyAnalysis {
    /// The highest severity of any category.
    pub fn max_severity(&self) -> u8 {
        self.categories
            .iter()
            .map(|c| c.severity)
            .max()
            .unwrap_or(0)
    }

    /// The severity of one category, matched without regard to case or underscores, so
    /// `SelfHarm`, `selfharm` and `self_harm` are the same category. `0` when absent.
    pub fn severity_of(&self, category: &str) -> u8 {
        let wanted = normalise_category(category);
        self.categories
            .iter()
            .filter(|c| normalise_category(&c.category) == wanted)
            .map(|c| c.severity)
            .max()
            .unwrap_or(0)
    }
}

#[async_trait]
pub trait ContentSafety: Send + Sync {
    fn is_enabled(&self) -> bool;
    async fn analyze_text(&self, text: &str) -> Result<SafetyAnalysis, ServiceError>;
    async fn analyze_image(&self, image: &[u8]) -> Result<SafetyAnalysis, ServiceError>;
}

/// Automatic moderation switched off.
pub struct DisabledContentSafety;

#[async_trait]
impl ContentSafety for DisabledContentSafety {
    fn is_enabled(&self) -> bool {
        false
    }

    async fn analyze_text(&self, _: &str) -> Result<SafetyAnalysis, ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn analyze_image(&self, _: &[u8]) -> Result<SafetyAnalysis, ServiceError> {
        Err(ServiceError::Disabled)
    }
}

/// The implementation for this environment: the Azure client when an endpoint and key are
/// configured, otherwise manual moderation.
pub fn from_config(config: &Config) -> Arc<dyn ContentSafety> {
    if let Some(azure) = &config.content_safety {
        Arc::new(AzureContentSafety::new(azure))
    } else {
        tracing::warn!("Azure Content Safety is not configured; moderation is manual");
        Arc::new(DisabledContentSafety)
    }
}

// ---------------------------------------------------------------------------------------------
// The Azure client
// ---------------------------------------------------------------------------------------------

/// The Azure AI Content Safety REST client.
pub struct AzureContentSafety {
    client: reqwest::Client,
    endpoint: String,
    key: String,
}

impl AzureContentSafety {
    pub fn new(config: &ContentSafetyConfig) -> Self {
        Self {
            client: http_client(),
            endpoint: config.endpoint.trim_end_matches('/').to_owned(),
            key: config.key.clone(),
        }
    }

    fn url(&self, operation: &str) -> String {
        format!(
            "{}/contentsafety/{operation}?api-version={API_VERSION}",
            self.endpoint
        )
    }

    /// Posts one analyze request and parses the answer.
    async fn analyze(
        &self,
        operation: &str,
        subject: Value,
    ) -> Result<SafetyAnalysis, ServiceError> {
        let mut body = subject;
        body["categories"] = json!(CATEGORIES);
        body["outputType"] = json!("FourSeverityLevels");
        let response = self
            .client
            .post(self.url(operation))
            .header("Ocp-Apim-Subscription-Key", &self.key)
            .json(&body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(classify_failure(status, &text));
        }
        let raw: Value = response
            .json()
            .await
            .map_err(|_| ServiceError::Permanent("content safety: unreadable answer".to_owned()))?;
        parse_analysis(raw)
    }
}

#[async_trait]
impl ContentSafety for AzureContentSafety {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn analyze_text(&self, text: &str) -> Result<SafetyAnalysis, ServiceError> {
        self.analyze("text:analyze", json!({ "text": text })).await
    }

    async fn analyze_image(&self, image: &[u8]) -> Result<SafetyAnalysis, ServiceError> {
        self.analyze(
            "image:analyze",
            json!({ "image": { "content": BASE64.encode(image) } }),
        )
        .await
    }
}

#[derive(Debug, Deserialize)]
struct AnalyzeResponse {
    #[serde(rename = "categoriesAnalysis", default)]
    categories_analysis: Vec<CategoryAnalysis>,
}

#[derive(Debug, Deserialize)]
struct CategoryAnalysis {
    category: String,
    #[serde(default)]
    severity: Option<u32>,
}

/// Reads the `categoriesAnalysis` array of a successful answer.
fn parse_analysis(raw: Value) -> Result<SafetyAnalysis, ServiceError> {
    let parsed: AnalyzeResponse = serde_json::from_value(raw.clone())
        .map_err(|_| ServiceError::Permanent("content safety: unexpected answer".to_owned()))?;
    if parsed.categories_analysis.is_empty() {
        return Err(ServiceError::Permanent(
            "content safety: no categories in the answer".to_owned(),
        ));
    }
    let categories = parsed
        .categories_analysis
        .into_iter()
        .map(|c| CategorySeverity {
            category: c.category,
            severity: u8::try_from(c.severity.unwrap_or(0)).unwrap_or(u8::MAX),
        })
        .collect();
    Ok(SafetyAnalysis { categories, raw })
}

/// Classifies a failed answer. A quota that is used up or a busy service is
/// [`ServiceError::Temporary`] (the check is retried or skipped, 13 section 12.2); anything else
/// the service refuses is [`ServiceError::Permanent`].
fn classify_failure(status: reqwest::StatusCode, body: &str) -> ServiceError {
    let detail = error_detail(body);
    let quota = detail.to_ascii_lowercase().contains("quota");
    if quota || status == reqwest::StatusCode::PAYMENT_REQUIRED {
        return ServiceError::Temporary(format!("content safety quota: HTTP {status}"));
    }
    ServiceError::from_status(status, &format!("content safety ({detail})"))
}

/// The `error.code` and `error.message` of an Azure error body, shortened. Never the request.
fn error_detail(body: &str) -> String {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let code = value["error"]["code"].as_str().unwrap_or_default();
    let message = value["error"]["message"].as_str().unwrap_or_default();
    format!("{code} {message}")
        .trim()
        .chars()
        .take(MAX_ERROR_TEXT)
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------

/// A category name without case and separators: `SelfHarm`, `self_harm` and `selfharm` match.
fn normalise_category(category: &str) -> String {
    category
        .chars()
        .filter(char::is_ascii_alphabetic)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// The four severity levels of `FourSeverityLevels` (0, 2, 4, 6). Other values, for example
/// from an eight-level answer, fall into the level below.
const fn level(severity: u8) -> u8 {
    match severity {
        0..=1 => 0,
        2..=3 => 2,
        4..=5 => 4,
        _ => 6,
    }
}

/// The strictest result of the automatic photo check (13 section 4.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ImageVerdict {
    Clean,
    /// A moderator looks at it first.
    Flag,
    /// Rejected automatically.
    Reject,
}

impl ImageVerdict {
    /// The word stored in `profile_photos.moderation.result`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Clean => "clean",
            Self::Flag => "flag",
            Self::Reject => "reject",
        }
    }
}

/// The strictest result of the automatic text check (13 section 3.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TextVerdict {
    Approve,
    /// The text stays `pending` for a moderator.
    Hold,
    /// Rejected automatically.
    Reject,
}

/// The photo table of 13 section 4.2, strictest result over the categories. A category the
/// table does not list is treated as strictly as `Hate`: flagged from severity 2.
pub fn image_verdict(analysis: &SafetyAnalysis) -> ImageVerdict {
    analysis
        .categories
        .iter()
        .map(|c| {
            let severity = level(c.severity);
            match normalise_category(&c.category).as_str() {
                "sexual" => match severity {
                    4.. => ImageVerdict::Reject,
                    2 => ImageVerdict::Flag,
                    _ => ImageVerdict::Clean,
                },
                "violence" if severity >= 4 => ImageVerdict::Flag,
                "violence" => ImageVerdict::Clean,
                _ if severity >= 2 => ImageVerdict::Flag,
                _ => ImageVerdict::Clean,
            }
        })
        .max()
        .unwrap_or(ImageVerdict::Clean)
}

/// The text table of 13 section 3.7, strictest result over the categories. Self-harm is never
/// rejected automatically: a person should read it.
pub fn text_verdict(analysis: &SafetyAnalysis) -> TextVerdict {
    analysis
        .categories
        .iter()
        .map(|c| {
            let severity = level(c.severity);
            match normalise_category(&c.category).as_str() {
                "hate" | "sexual" => match severity {
                    6.. => TextVerdict::Reject,
                    2.. => TextVerdict::Hold,
                    _ => TextVerdict::Approve,
                },
                "violence" if severity >= 4 => TextVerdict::Hold,
                "violence" => TextVerdict::Approve,
                _ if severity >= 2 => TextVerdict::Hold,
                _ => TextVerdict::Approve,
            }
        })
        .max()
        .unwrap_or(TextVerdict::Approve)
}

/// The value stored in `profile_photos.moderation` (13 section 4.2):
/// `{ provider, checked_at, categories: { sexual, violence, hate, self_harm }, result }`.
/// `result` is `unavailable` (and `categories` null) when no analysis could be made.
pub fn photo_moderation_record(
    analysis: Option<&SafetyAnalysis>,
    verdict: Option<ImageVerdict>,
    checked_at: OffsetDateTime,
) -> Value {
    let checked_at = checked_at
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let categories = analysis.map(|a| {
        json!({
            "sexual": a.severity_of("sexual"),
            "violence": a.severity_of("violence"),
            "hate": a.severity_of("hate"),
            "self_harm": a.severity_of("selfharm"),
        })
    });
    json!({
        "provider": "azure_content_safety",
        "checked_at": checked_at,
        "categories": categories,
        "result": verdict.map_or("unavailable", ImageVerdict::as_str),
    })
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{body_partial_json, header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn analysis(entries: &[(&str, u8)]) -> SafetyAnalysis {
        SafetyAnalysis {
            categories: entries
                .iter()
                .map(|(category, severity)| CategorySeverity {
                    category: (*category).to_owned(),
                    severity: *severity,
                })
                .collect(),
            raw: Value::Null,
        }
    }

    fn client(server: &MockServer) -> AzureContentSafety {
        AzureContentSafety::new(&ContentSafetyConfig {
            endpoint: format!("{}/", server.uri()),
            key: "secret-key".to_owned(),
        })
    }

    fn answer(severities: [u8; 4]) -> Value {
        json!({ "categoriesAnalysis": [
            { "category": "Hate", "severity": severities[0] },
            { "category": "SelfHarm", "severity": severities[1] },
            { "category": "Sexual", "severity": severities[2] },
            { "category": "Violence", "severity": severities[3] },
        ]})
    }

    // ---- The client ----

    #[tokio::test]
    async fn text_is_sent_with_the_key_and_the_four_categories() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/contentsafety/text:analyze"))
            .and(query_param("api-version", API_VERSION))
            .and(header("Ocp-Apim-Subscription-Key", "secret-key"))
            .and(body_partial_json(json!({
                "text": "hello there",
                "categories": ["Hate", "Sexual", "Violence", "SelfHarm"],
                "outputType": "FourSeverityLevels",
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(answer([0, 2, 0, 4])))
            .expect(1)
            .mount(&server)
            .await;

        let result = client(&server).analyze_text("hello there").await.unwrap();
        assert_eq!(result.severity_of("SelfHarm"), 2);
        assert_eq!(result.severity_of("violence"), 4);
        assert_eq!(result.max_severity(), 4);
        assert_eq!(result.raw["categoriesAnalysis"][0]["category"], "Hate");
    }

    #[tokio::test]
    async fn an_image_is_sent_as_base64() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/contentsafety/image:analyze"))
            .and(body_partial_json(json!({
                "image": { "content": BASE64.encode([1_u8, 2, 3]) },
                "outputType": "FourSeverityLevels",
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(answer([0, 0, 0, 0])))
            .expect(1)
            .mount(&server)
            .await;

        let result = client(&server).analyze_image(&[1, 2, 3]).await.unwrap();
        assert_eq!(result.max_severity(), 0);
    }

    #[tokio::test]
    async fn quota_and_service_errors_are_temporary() {
        for (status, body) in [
            (
                429,
                json!({ "error": { "code": "TooManyRequests", "message": "Rate limit" } }),
            ),
            (500, json!({})),
            (503, json!({})),
            (
                403,
                json!({ "error": { "code": "Forbidden", "message": "Out of call volume quota for ContentSafety F0 pricing tier." } }),
            ),
        ] {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(status).set_body_json(body))
                .mount(&server)
                .await;
            let error = client(&server).analyze_text("text").await.unwrap_err();
            assert!(
                error.is_temporary(),
                "HTTP {status} should be temporary: {error}"
            );
        }
    }

    #[tokio::test]
    async fn other_refusals_and_odd_answers_are_permanent() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/contentsafety/text:analyze"))
            .respond_with(ResponseTemplate::new(400).set_body_json(
                json!({ "error": { "code": "InvalidRequestBody", "message": "bad" } }),
            ))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/contentsafety/image:analyze"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "unexpected": true })))
            .mount(&server)
            .await;

        let client = client(&server);
        let refused = client.analyze_text("text").await.unwrap_err();
        assert!(matches!(refused, ServiceError::Permanent(_)), "{refused}");
        let odd = client.analyze_image(&[1]).await.unwrap_err();
        assert!(matches!(odd, ServiceError::Permanent(_)), "{odd}");
    }

    #[tokio::test]
    async fn a_service_that_does_not_answer_is_temporary() {
        // Nothing listens on port 1.
        let client = AzureContentSafety::new(&ContentSafetyConfig {
            endpoint: "http://127.0.0.1:1".to_owned(),
            key: "k".to_owned(),
        });
        let error = client.analyze_text("text").await.unwrap_err();
        assert!(error.is_temporary(), "{error}");
    }

    #[test]
    fn the_error_message_never_holds_the_checked_text() {
        let error = classify_failure(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error":{"code":"InvalidRequestBody","message":"bad"},"echo":"private text"}"#,
        );
        assert!(!error.to_string().contains("private text"));
    }

    #[test]
    fn without_a_configuration_moderation_is_manual() {
        let config = Config::for_tests();
        assert!(config.content_safety.is_none());
        assert!(!from_config(&config).is_enabled());
    }

    // ---- The tables ----

    #[test]
    fn photo_table_of_13_section_4_2() {
        use ImageVerdict::{Clean, Flag, Reject};
        for (category, expected) in [
            // Severity 0, 2, 4, 6.
            ("Sexual", [Clean, Flag, Reject, Reject]),
            ("Violence", [Clean, Clean, Flag, Flag]),
            ("Hate", [Clean, Flag, Flag, Flag]),
            ("SelfHarm", [Clean, Flag, Flag, Flag]),
        ] {
            for (severity, want) in [0_u8, 2, 4, 6].into_iter().zip(expected) {
                assert_eq!(
                    image_verdict(&analysis(&[(category, severity)])),
                    want,
                    "{category} at {severity}"
                );
            }
        }
    }

    #[test]
    fn photo_verdict_takes_the_strictest_category() {
        let result = analysis(&[("Hate", 2), ("Sexual", 4), ("Violence", 0)]);
        assert_eq!(image_verdict(&result), ImageVerdict::Reject);
        assert_eq!(image_verdict(&analysis(&[])), ImageVerdict::Clean);
        assert_eq!(
            image_verdict(&analysis(&[("Mystery", 2)])),
            ImageVerdict::Flag
        );
    }

    #[test]
    fn text_table_of_13_section_3_7() {
        use TextVerdict::{Approve, Hold, Reject};
        for (category, expected) in [
            ("Hate", [Approve, Hold, Hold, Reject]),
            ("Sexual", [Approve, Hold, Hold, Reject]),
            ("Violence", [Approve, Approve, Hold, Hold]),
            ("SelfHarm", [Approve, Hold, Hold, Hold]),
        ] {
            for (severity, want) in [0_u8, 2, 4, 6].into_iter().zip(expected) {
                assert_eq!(
                    text_verdict(&analysis(&[(category, severity)])),
                    want,
                    "{category} at {severity}"
                );
            }
        }
    }

    #[test]
    fn text_verdict_takes_the_strictest_and_never_rejects_self_harm() {
        assert_eq!(
            text_verdict(&analysis(&[("SelfHarm", 6), ("Violence", 2)])),
            TextVerdict::Hold
        );
        assert_eq!(
            text_verdict(&analysis(&[("SelfHarm", 6), ("Hate", 6)])),
            TextVerdict::Reject
        );
        assert_eq!(text_verdict(&analysis(&[])), TextVerdict::Approve);
    }

    #[test]
    fn eight_level_severities_fall_into_the_level_below() {
        assert_eq!(
            image_verdict(&analysis(&[("Sexual", 5)])),
            ImageVerdict::Reject
        );
        assert_eq!(
            image_verdict(&analysis(&[("Sexual", 1)])),
            ImageVerdict::Clean
        );
        assert_eq!(
            image_verdict(&analysis(&[("Sexual", 3)])),
            ImageVerdict::Flag
        );
    }

    #[test]
    fn the_moderation_record_has_the_documented_shape() {
        let at = OffsetDateTime::from_unix_timestamp(1_800_000_000).unwrap();
        let result = analysis(&[("Sexual", 2), ("SelfHarm", 0)]);
        let record = photo_moderation_record(Some(&result), Some(ImageVerdict::Flag), at);
        assert_eq!(record["provider"], "azure_content_safety");
        assert_eq!(record["result"], "flag");
        assert_eq!(
            record["categories"],
            json!({ "sexual": 2, "violence": 0, "hate": 0, "self_harm": 0 })
        );
        assert!(record["checked_at"].as_str().unwrap().ends_with('Z'));

        let unavailable = photo_moderation_record(None, None, at);
        assert_eq!(unavailable["result"], "unavailable");
        assert!(unavailable["categories"].is_null());
    }
}
