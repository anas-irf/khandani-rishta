//! Azure AI Content Safety: automatic text and image checks (13 sections 3, 4 and 12).
//!
//! With no endpoint configured, automatic moderation is off: texts stay `pending` and photos
//! go to `pending_review` for a moderator (20 section 10).

use async_trait::async_trait;
use serde_json::Value;

use crate::services::ServiceError;

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

/// The implementation for this environment. Without an endpoint, moderation is manual.
pub fn from_config(config: &crate::config::Config) -> std::sync::Arc<dyn ContentSafety> {
    if config.content_safety.is_some() {
        tracing::warn!("Azure Content Safety client is not built yet; moderation is manual");
    }
    std::sync::Arc::new(DisabledContentSafety)
}
