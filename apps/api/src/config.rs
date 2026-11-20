//! Runtime configuration, read from environment variables.

use std::fmt;
use std::net::SocketAddr;
use std::str::FromStr;

use anyhow::{Context, bail};
use axum::http::HeaderValue;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

/// Which deployment the process runs in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppEnv {
    Local,
    Staging,
    Production,
}

impl AppEnv {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Staging => "staging",
            Self::Production => "production",
        }
    }
}

impl fmt::Display for AppEnv {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AppEnv {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> anyhow::Result<Self> {
        match value {
            "local" => Ok(Self::Local),
            "staging" => Ok(Self::Staging),
            "production" => Ok(Self::Production),
            other => bail!("APP_ENV must be local, staging or production, got {other:?}"),
        }
    }
}

/// Output format for logs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogFormat {
    /// Human-readable, for local development.
    Pretty,
    /// One JSON object per line, for journald on the servers.
    Json,
}

/// Clerk settings (06 section 13.1).
#[derive(Clone)]
pub struct ClerkConfig {
    /// Frontend API URL of the instance; must equal the token's `iss`. No trailing slash.
    pub issuer: String,
    /// Where the signing keys are published.
    pub jwks_url: String,
    /// Web origins accepted in the `azp` claim.
    pub authorized_parties: Vec<String>,
    /// Backend API key.
    pub secret_key: String,
    /// Backend API base, overridden in tests.
    pub api_base_url: String,
    /// Signing secret of the webhook endpoint. Empty only locally; the webhook then answers 400.
    pub webhook_secret: Option<String>,
    /// Whether the plan includes user bans.
    pub ban_enabled: bool,
}

/// Keys protecting identity numbers (20 section 2.1).
#[derive(Clone)]
pub struct IdentityKeys {
    pub encryption_key: [u8; 32],
    pub encryption_key_previous: Option<[u8; 32]>,
    pub hash_pepper: [u8; 32],
}

/// Cloudflare R2 through its S3 API (20 section 2.2).
#[derive(Clone)]
pub struct R2Config {
    pub endpoint: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

/// Azure AI Content Safety. Absent: automatic moderation is off (13 section 12).
#[derive(Clone)]
pub struct ContentSafetyConfig {
    pub endpoint: String,
    pub key: String,
}

/// Firebase Cloud Messaging. Absent: push is off.
#[derive(Clone)]
pub struct FcmConfig {
    pub project_id: String,
    pub service_account_json: String,
}

/// Settings for one running instance of the API.
///
/// `Debug` is not derived on purpose: the struct holds passwords and keys.
#[derive(Clone)]
pub struct Config {
    pub app_env: AppEnv,
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    pub cors_allowed_origins: Vec<HeaderValue>,
    pub log_format: LogFormat,
    pub sentry_dsn: Option<String>,
    pub clerk: ClerkConfig,
    pub identity: IdentityKeys,
    /// Absent: object storage is unavailable and upload endpoints answer 503.
    pub r2: Option<R2Config>,
    pub content_safety: Option<ContentSafetyConfig>,
    /// Absent: email is off (jobs succeed without sending and log a warning).
    pub resend_api_key: Option<String>,
    pub email_from: String,
    pub fcm: Option<FcmConfig>,
    /// Origin of the web app, used in emails and share links.
    pub web_base_url: String,
}

/// Development-only fallback for `IDENTITY_ENCRYPTION_KEY` (20 section 2.1).
const LOCAL_ENCRYPTION_KEY: [u8; 32] = *b"local-dev-identity-encrypt-key!!";
/// Development-only fallback for `IDENTITY_HASH_PEPPER`.
const LOCAL_HASH_PEPPER: [u8; 32] = *b"local-dev-identity-hash-pepper!!";

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Builds the config from any key lookup, so tests don't touch the process environment.
    fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let get = |key: &str| {
            lookup(key)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };

        let app_env: AppEnv = get("APP_ENV").as_deref().unwrap_or("local").parse()?;
        let is_local = app_env == AppEnv::Local;

        let bind_addr = get("BIND_ADDR")
            .as_deref()
            .unwrap_or("127.0.0.1:8080")
            .parse()
            .context("BIND_ADDR must be an address such as 127.0.0.1:8080")?;

        let database_url = get("DATABASE_URL").context("DATABASE_URL must be set")?;

        let database_max_connections = match get("DATABASE_MAX_CONNECTIONS") {
            Some(value) => value
                .parse()
                .context("DATABASE_MAX_CONNECTIONS must be a whole number")?,
            None => 10,
        };

        let cors_allowed_origins = get("CORS_ALLOWED_ORIGINS")
            .map(|value| parse_origins(&value))
            .transpose()?
            .unwrap_or_default();

        let log_format = match get("LOG_FORMAT").as_deref() {
            Some("json") => LogFormat::Json,
            Some("pretty") => LogFormat::Pretty,
            Some(other) => bail!("LOG_FORMAT must be json or pretty, got {other:?}"),
            // Readable logs locally, JSON for journald on the servers.
            None if is_local => LogFormat::Pretty,
            None => LogFormat::Json,
        };

        let clerk = clerk_config(&get, is_local)?;
        let identity = identity_keys(&get, is_local)?;

        let r2 = match (
            get("R2_ENDPOINT"),
            get("R2_BUCKET_MEDIA"),
            get("R2_ACCESS_KEY_ID"),
            get("R2_SECRET_ACCESS_KEY"),
        ) {
            (Some(endpoint), Some(bucket), Some(access_key_id), Some(secret_access_key)) => {
                Some(R2Config {
                    endpoint: endpoint.trim_end_matches('/').to_owned(),
                    bucket,
                    access_key_id,
                    secret_access_key,
                })
            }
            _ => None,
        };

        let content_safety = match (
            get("AZURE_CONTENT_SAFETY_ENDPOINT"),
            get("AZURE_CONTENT_SAFETY_KEY"),
        ) {
            (Some(endpoint), Some(key)) => Some(ContentSafetyConfig {
                endpoint: endpoint.trim_end_matches('/').to_owned(),
                key,
            }),
            _ => None,
        };

        let fcm = match (get("FCM_PROJECT_ID"), get("FCM_SERVICE_ACCOUNT_JSON")) {
            (Some(project_id), Some(service_account_json)) => Some(FcmConfig {
                project_id,
                service_account_json,
            }),
            _ => None,
        };

        Ok(Self {
            app_env,
            bind_addr,
            database_url,
            database_max_connections,
            cors_allowed_origins,
            log_format,
            sentry_dsn: get("SENTRY_DSN"),
            clerk,
            identity,
            r2,
            content_safety,
            resend_api_key: get("RESEND_API_KEY"),
            email_from: get("EMAIL_FROM")
                .unwrap_or_else(|| "Khandani Rishta <no-reply@localhost>".to_owned()),
            fcm,
            web_base_url: get("WEB_BASE_URL")
                .unwrap_or_else(|| "http://localhost:3000".to_owned())
                .trim_end_matches('/')
                .to_owned(),
        })
    }

    /// Web origins as plain strings, for the WebSocket `Origin` check (19 section 4.2).
    pub fn allowed_origins(&self) -> impl Iterator<Item = &str> {
        self.cors_allowed_origins
            .iter()
            .filter_map(|origin| origin.to_str().ok())
    }
}

/// Clerk settings. `CLERK_ISSUER` and `CLERK_SECRET_KEY` are required outside `local`;
/// `CLERK_WEBHOOK_SECRET` may be empty only locally (06 section 13.1).
fn clerk_config(
    get: &impl Fn(&str) -> Option<String>,
    is_local: bool,
) -> anyhow::Result<ClerkConfig> {
    let issuer = match get("CLERK_ISSUER") {
        Some(issuer) => issuer.trim_end_matches('/').to_owned(),
        None if is_local => "https://clerk.localhost".to_owned(),
        None => bail!("CLERK_ISSUER must be set"),
    };
    let secret_key = match get("CLERK_SECRET_KEY") {
        Some(key) => key,
        None if is_local => String::new(),
        None => bail!("CLERK_SECRET_KEY must be set"),
    };
    let webhook_secret = get("CLERK_WEBHOOK_SECRET");
    if webhook_secret.is_none() && !is_local {
        bail!("CLERK_WEBHOOK_SECRET must be set");
    }
    let jwks_url =
        get("CLERK_JWKS_URL").unwrap_or_else(|| format!("{issuer}/.well-known/jwks.json"));
    let authorized_parties = get("CLERK_AUTHORIZED_PARTIES").map_or_default(|value| {
        value
            .split(',')
            .map(|origin| origin.trim().trim_end_matches('/').to_owned())
            .filter(|origin| !origin.is_empty())
            .collect()
    });
    let ban_enabled = match get("CLERK_BAN_ENABLED").as_deref() {
        None | Some("false") => false,
        Some("true") => true,
        Some(other) => bail!("CLERK_BAN_ENABLED must be true or false, got {other:?}"),
    };
    Ok(ClerkConfig {
        issuer,
        jwks_url,
        authorized_parties,
        secret_key,
        api_base_url: get("CLERK_API_BASE_URL")
            .unwrap_or_else(|| "https://api.clerk.com/v1".to_owned())
            .trim_end_matches('/')
            .to_owned(),
        webhook_secret,
        ban_enabled,
    })
}

/// Identity keys. Required and exactly 32 bytes outside `local`; locally a fixed development
/// value is used with a warning (20 section 2.1).
fn identity_keys(
    get: &impl Fn(&str) -> Option<String>,
    is_local: bool,
) -> anyhow::Result<IdentityKeys> {
    let key = |name: &str, fallback: [u8; 32]| -> anyhow::Result<[u8; 32]> {
        match get(name) {
            Some(value) => decode_key(name, &value),
            None if is_local => {
                tracing::warn!("{name} is not set; using the development value");
                Ok(fallback)
            }
            None => bail!("{name} must be set to 32 random bytes in base64"),
        }
    };
    let encryption_key = key("IDENTITY_ENCRYPTION_KEY", LOCAL_ENCRYPTION_KEY)?;
    let hash_pepper = key("IDENTITY_HASH_PEPPER", LOCAL_HASH_PEPPER)?;
    let encryption_key_previous = get("IDENTITY_ENCRYPTION_KEY_PREVIOUS")
        .map(|value| decode_key("IDENTITY_ENCRYPTION_KEY_PREVIOUS", &value))
        .transpose()?;
    Ok(IdentityKeys {
        encryption_key,
        encryption_key_previous,
        hash_pepper,
    })
}

fn decode_key(name: &str, value: &str) -> anyhow::Result<[u8; 32]> {
    let bytes = BASE64
        .decode(value)
        .with_context(|| format!("{name} must be base64"))?;
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("{name} must decode to exactly 32 bytes"))
}

#[cfg(test)]
impl Config {
    /// Local defaults, for tests that build the app around a test database pool.
    pub fn for_tests() -> Self {
        Self::from_lookup(|key| match key {
            "DATABASE_URL" => Some("postgres://unused".to_owned()),
            "CLERK_ISSUER" => Some(crate::test_support::TEST_ISSUER.to_owned()),
            "CLERK_AUTHORIZED_PARTIES" | "CORS_ALLOWED_ORIGINS" => {
                Some("http://localhost:3000".to_owned())
            }
            "CLERK_WEBHOOK_SECRET" => Some(crate::test_support::TEST_WEBHOOK_SECRET.to_owned()),
            _ => None,
        })
        .expect("the test configuration is valid")
    }
}

/// Parses a comma-separated list of origins such as `https://example.com,http://localhost:3000`.
fn parse_origins(value: &str) -> anyhow::Result<Vec<HeaderValue>> {
    value
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(|origin| {
            if !(origin.starts_with("https://") || origin.starts_with("http://")) {
                bail!("CORS_ALLOWED_ORIGINS entries must start with http:// or https://, got {origin:?}");
            }
            HeaderValue::from_str(origin.trim_end_matches('/'))
                .with_context(|| format!("invalid origin in CORS_ALLOWED_ORIGINS: {origin:?}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn config_from(pairs: &[(&str, &str)]) -> anyhow::Result<Config> {
        let vars: HashMap<String, String> = pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect();
        Config::from_lookup(|key| vars.get(key).cloned())
    }

    const KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    fn server_vars() -> Vec<(&'static str, &'static str)> {
        vec![
            ("APP_ENV", "production"),
            ("DATABASE_URL", "postgres://db/test"),
            ("CLERK_ISSUER", "https://clerk.example.com/"),
            ("CLERK_SECRET_KEY", "sk_live_x"),
            ("CLERK_WEBHOOK_SECRET", "whsec_x"),
            ("IDENTITY_ENCRYPTION_KEY", KEY),
            ("IDENTITY_HASH_PEPPER", KEY),
        ]
    }

    #[test]
    fn uses_local_defaults() {
        let config = config_from(&[("DATABASE_URL", "postgres://localhost/test")]).unwrap();
        assert_eq!(config.app_env, AppEnv::Local);
        assert_eq!(config.bind_addr.to_string(), "127.0.0.1:8080");
        assert_eq!(config.database_max_connections, 10);
        assert_eq!(config.log_format, LogFormat::Pretty);
        assert_eq!(config.cors_allowed_origins, Vec::<HeaderValue>::new());
        assert!(config.sentry_dsn.is_none());
        assert!(config.r2.is_none());
        assert!(config.content_safety.is_none());
        assert!(config.resend_api_key.is_none());
        assert!(config.fcm.is_none());
        assert!(config.clerk.webhook_secret.is_none());
        assert_eq!(config.identity.encryption_key, LOCAL_ENCRYPTION_KEY);
    }

    #[test]
    fn servers_log_json_by_default() {
        let config = config_from(&server_vars()).unwrap();
        assert_eq!(config.log_format, LogFormat::Json);
        assert_eq!(config.clerk.issuer, "https://clerk.example.com");
        assert_eq!(
            config.clerk.jwks_url,
            "https://clerk.example.com/.well-known/jwks.json"
        );
        assert_eq!(config.clerk.api_base_url, "https://api.clerk.com/v1");
    }

    #[test]
    fn servers_require_clerk_and_identity_secrets() {
        for missing in [
            "CLERK_ISSUER",
            "CLERK_SECRET_KEY",
            "CLERK_WEBHOOK_SECRET",
            "IDENTITY_ENCRYPTION_KEY",
            "IDENTITY_HASH_PEPPER",
        ] {
            let vars: Vec<_> = server_vars()
                .into_iter()
                .filter(|(key, _)| *key != missing)
                .collect();
            assert!(config_from(&vars).is_err(), "{missing} should be required");
        }
    }

    #[test]
    fn identity_keys_must_be_32_bytes() {
        let vars: Vec<_> = server_vars()
            .into_iter()
            .map(|(key, value)| {
                if key == "IDENTITY_HASH_PEPPER" {
                    (key, "c2hvcnQ=")
                } else {
                    (key, value)
                }
            })
            .collect();
        assert!(config_from(&vars).is_err());
    }

    #[test]
    fn requires_database_url() {
        assert!(config_from(&[]).is_err());
    }

    #[test]
    fn rejects_unknown_environment() {
        assert!(
            config_from(&[("APP_ENV", "prod"), ("DATABASE_URL", "postgres://db/test")]).is_err()
        );
    }

    #[test]
    fn optional_integrations_need_all_their_values() {
        let partial = config_from(&[
            ("DATABASE_URL", "postgres://db/test"),
            ("R2_ENDPOINT", "https://acct.r2.cloudflarestorage.com/"),
            ("R2_BUCKET_MEDIA", "kr-dev-media"),
            ("R2_ACCESS_KEY_ID", "id"),
        ])
        .unwrap();
        assert!(partial.r2.is_none());

        let full = config_from(&[
            ("DATABASE_URL", "postgres://db/test"),
            ("R2_ENDPOINT", "https://acct.r2.cloudflarestorage.com/"),
            ("R2_BUCKET_MEDIA", "kr-dev-media"),
            ("R2_ACCESS_KEY_ID", "id"),
            ("R2_SECRET_ACCESS_KEY", "secret"),
        ])
        .unwrap();
        assert_eq!(
            full.r2.unwrap().endpoint,
            "https://acct.r2.cloudflarestorage.com"
        );
    }

    #[test]
    fn parses_cors_origins() {
        let origins = parse_origins("https://example.com/, http://localhost:3000").unwrap();
        assert_eq!(
            origins,
            vec![
                HeaderValue::from_static("https://example.com"),
                HeaderValue::from_static("http://localhost:3000"),
            ]
        );
        assert!(parse_origins("example.com").is_err());
    }
}
