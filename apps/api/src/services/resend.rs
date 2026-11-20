//! Email through Resend (14 section 5). Without `RESEND_API_KEY` email is off: the
//! `send_email` job succeeds without sending and logs a warning (20 section 2.2).

use async_trait::async_trait;

use crate::services::ServiceError;

/// One rendered email.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingEmail {
    pub to: String,
    pub subject: String,
    pub html: String,
    pub text: String,
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

/// The implementation for this environment. Without `RESEND_API_KEY`, email is off.
pub fn from_config(config: &crate::config::Config) -> std::sync::Arc<dyn EmailSender> {
    if config.resend_api_key.is_some() {
        tracing::warn!("Resend client is not built yet; email is off");
    }
    std::sync::Arc::new(DisabledEmail)
}
