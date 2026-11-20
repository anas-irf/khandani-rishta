//! Shared state handed to every request handler and job.

use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::account::AccountCache;
use crate::auth::extractors::ActivityTracker;
use crate::auth::jwks::Jwks;
use crate::config::Config;
use crate::jobs::JobQueue;
use crate::middleware::ReleaseCache;
use crate::ratelimit::RateLimiter;
use crate::realtime::hub::LocalHub;
use crate::reference::Reference;
use crate::services::clerk::{ClerkApi, HttpClerk};
use crate::services::content_safety::ContentSafety;
use crate::services::crypto::Crypto;
use crate::services::fcm::PushSender;
use crate::services::r2::{DisabledStore, ObjectStore, R2Store};
use crate::services::resend::EmailSender;
use crate::services::{content_safety, fcm, resend};
use crate::settings::Settings;

/// The outbound integrations, chosen from the configuration or replaced in tests.
#[derive(Clone)]
pub struct Integrations {
    pub jwks: Arc<Jwks>,
    pub clerk: Arc<dyn ClerkApi>,
    pub storage: Arc<dyn ObjectStore>,
    pub content_safety: Arc<dyn ContentSafety>,
    pub email: Arc<dyn EmailSender>,
    pub push: Arc<dyn PushSender>,
}

impl Integrations {
    /// The real integrations for the configured environment; missing configuration selects the
    /// disabled implementation (20 section 2.2).
    pub fn from_config(config: &Config) -> Self {
        let storage: Arc<dyn ObjectStore> = if let Some(r2) = &config.r2 {
            Arc::new(R2Store::new(r2))
        } else {
            tracing::warn!("R2 is not configured; photo and verification uploads are off");
            Arc::new(DisabledStore)
        };
        Self {
            jwks: Arc::new(Jwks::new(config.clerk.jwks_url.clone())),
            clerk: Arc::new(HttpClerk::new(&config.clerk)),
            storage,
            content_safety: content_safety::from_config(config),
            email: resend::from_config(config),
            push: fcm::from_config(config),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: PgPool,
    pub settings: Arc<Settings>,
    pub reference: Arc<Reference>,
    pub accounts: Arc<AccountCache>,
    pub activity: Arc<ActivityTracker>,
    pub limiter: Arc<RateLimiter>,
    pub releases: Arc<ReleaseCache>,
    pub crypto: Arc<Crypto>,
    pub hub: Arc<LocalHub>,
    pub jobs: Arc<JobQueue>,
    pub jwks: Arc<Jwks>,
    pub clerk: Arc<dyn ClerkApi>,
    pub storage: Arc<dyn ObjectStore>,
    pub content_safety: Arc<dyn ContentSafety>,
    pub email: Arc<dyn EmailSender>,
    pub push: Arc<dyn PushSender>,
}

impl AppState {
    /// Builds the state and loads the reference data cache.
    pub async fn new(config: Config, db: PgPool, integrations: Integrations) -> sqlx::Result<Self> {
        let reference = Reference::load(db.clone()).await?;
        Ok(Self {
            crypto: Arc::new(Crypto::new(&config.identity)),
            config: Arc::new(config),
            settings: Arc::new(Settings::new(db.clone())),
            reference: Arc::new(reference),
            accounts: Arc::new(AccountCache::new()),
            activity: Arc::new(ActivityTracker::new()),
            limiter: Arc::new(RateLimiter::new()),
            releases: Arc::new(ReleaseCache::new()),
            hub: Arc::new(LocalHub::new()),
            jobs: Arc::new(JobQueue::new()),
            jwks: integrations.jwks,
            clerk: integrations.clerk,
            storage: integrations.storage,
            content_safety: integrations.content_safety,
            email: integrations.email,
            push: integrations.push,
            db,
        })
    }
}
