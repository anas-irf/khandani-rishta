//! Android push through Firebase Cloud Messaging (14 section 4, 19 section 2.6).
//! Without FCM credentials push is off.

use async_trait::async_trait;
use serde_json::Value;

use crate::services::ServiceError;

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

/// The implementation for this environment. Without FCM credentials, push is off.
pub fn from_config(config: &crate::config::Config) -> std::sync::Arc<dyn PushSender> {
    if config.fcm.is_some() {
        tracing::warn!("FCM client is not built yet; push is off");
    }
    std::sync::Arc::new(DisabledPush)
}
