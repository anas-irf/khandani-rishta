//! Clerk's signing keys, cached in memory by `kid` (06 section 6.2, "JWKS handling").
//!
//! Loaded at startup (a failure does not stop the API), refreshed every 60 minutes in the
//! background, and refreshed on an unknown `kid` at most once per 60 seconds for the process.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use jsonwebtoken::DecodingKey;
use jsonwebtoken::jwk::JwkSet;

use crate::services::{ServiceError, http_client};

/// Background refresh interval.
pub const REFRESH_INTERVAL: Duration = Duration::from_hours(1);
/// Minimum time between refreshes caused by unknown key ids.
pub const MISS_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

pub struct Jwks {
    url: Option<String>,
    client: reqwest::Client,
    keys: RwLock<HashMap<String, DecodingKey>>,
    last_miss_refresh: Mutex<Option<Instant>>,
}

impl Jwks {
    /// A key set fetched from `url`. Nothing is fetched until [`Jwks::refresh`] is called.
    pub fn new(url: String) -> Self {
        Self {
            url: Some(url),
            client: http_client(),
            keys: RwLock::new(HashMap::new()),
            last_miss_refresh: Mutex::new(None),
        }
    }

    /// A fixed key set that never refreshes, for tests.
    pub fn fixed(keys: HashMap<String, DecodingKey>) -> Self {
        Self {
            url: None,
            client: http_client(),
            keys: RwLock::new(keys),
            last_miss_refresh: Mutex::new(None),
        }
    }

    fn cached(&self, kid: &str) -> Option<DecodingKey> {
        self.keys
            .read()
            .ok()
            .and_then(|keys| keys.get(kid).cloned())
    }

    /// The key for `kid`, refreshing once (rate-limited) when it is unknown.
    pub async fn key(&self, kid: &str) -> Option<DecodingKey> {
        if let Some(key) = self.cached(kid) {
            return Some(key);
        }
        let may_refresh = self.last_miss_refresh.lock().is_ok_and(|mut last| {
            let due = last.is_none_or(|at| at.elapsed() >= MISS_REFRESH_INTERVAL);
            if due {
                *last = Some(Instant::now());
            }
            due
        });
        if may_refresh && let Err(error) = self.refresh().await {
            tracing::warn!(%error, "JWKS refresh failed");
        }
        self.cached(kid)
    }

    /// Fetches the key set and replaces the cached keys.
    pub async fn refresh(&self) -> Result<(), ServiceError> {
        let Some(url) = &self.url else {
            return Ok(());
        };
        let response = self.client.get(url).send().await?;
        if !response.status().is_success() {
            return Err(ServiceError::from_status(response.status(), "JWKS"));
        }
        let set: JwkSet = response.json().await?;
        let mut keys = HashMap::new();
        for jwk in &set.keys {
            let Some(kid) = jwk.common.key_id.clone() else {
                continue;
            };
            match DecodingKey::from_jwk(jwk) {
                Ok(key) => {
                    keys.insert(kid, key);
                }
                Err(error) => tracing::warn!(%error, %kid, "skipping unusable JWK"),
            }
        }
        if let Ok(mut cached) = self.keys.write() {
            *cached = keys;
        }
        Ok(())
    }
}

/// Loads the keys once and then refreshes them every 60 minutes.
pub fn spawn_refresher(jwks: Arc<Jwks>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(REFRESH_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = jwks.refresh().await {
                tracing::warn!(%error, "JWKS refresh failed; requests may answer 401 until it succeeds");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::path;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::test_support::{TEST_KID, test_jwk};

    #[tokio::test]
    async fn fetches_keys_by_kid_and_limits_refreshes() {
        let server = MockServer::start().await;
        Mock::given(path("/.well-known/jwks.json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "keys": [test_jwk()] })))
            .expect(1)
            .mount(&server)
            .await;
        let jwks = Jwks::new(format!("{}/.well-known/jwks.json", server.uri()));

        assert!(jwks.key(TEST_KID).await.is_some(), "a miss refreshes");
        assert!(
            jwks.key("other").await.is_none(),
            "a second miss within 60 s does not"
        );
    }
}
