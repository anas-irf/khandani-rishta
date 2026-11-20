//! Runtime configuration, read from environment variables.

use std::fmt;
use std::net::SocketAddr;
use std::str::FromStr;

use anyhow::{Context, bail};
use axum::http::HeaderValue;

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

/// Settings for one running instance of the API.
///
/// `Debug` is not derived on purpose: the database URL contains a password.
#[derive(Clone)]
pub struct Config {
    pub app_env: AppEnv,
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    pub cors_allowed_origins: Vec<HeaderValue>,
    pub log_format: LogFormat,
    pub sentry_dsn: Option<String>,
}

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
            None if app_env == AppEnv::Local => LogFormat::Pretty,
            None => LogFormat::Json,
        };

        Ok(Self {
            app_env,
            bind_addr,
            database_url,
            database_max_connections,
            cors_allowed_origins,
            log_format,
            sentry_dsn: get("SENTRY_DSN"),
        })
    }
}

#[cfg(test)]
impl Config {
    /// Local defaults, for tests that build the app around a test database pool.
    pub fn for_tests() -> Self {
        Self::from_lookup(|key| (key == "DATABASE_URL").then(|| "postgres://unused".to_owned()))
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

    #[test]
    fn uses_local_defaults() {
        let config = config_from(&[("DATABASE_URL", "postgres://localhost/test")]).unwrap();
        assert_eq!(config.app_env, AppEnv::Local);
        assert_eq!(config.bind_addr.to_string(), "127.0.0.1:8080");
        assert_eq!(config.database_max_connections, 10);
        assert_eq!(config.log_format, LogFormat::Pretty);
        assert_eq!(config.cors_allowed_origins, Vec::<HeaderValue>::new());
        assert!(config.sentry_dsn.is_none());
    }

    #[test]
    fn servers_log_json_by_default() {
        let config = config_from(&[
            ("APP_ENV", "production"),
            ("DATABASE_URL", "postgres://db/test"),
        ])
        .unwrap();
        assert_eq!(config.log_format, LogFormat::Json);
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
