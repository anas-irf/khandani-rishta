//! Logging, tracing and error reporting.

use sentry::integrations::tracing::{BreadcrumbLayer, ErrorLayer, SpanLayer};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer, fmt};

use crate::config::{Config, LogFormat};

/// Log filter used when `RUST_LOG` is not set.
const DEFAULT_LOG_FILTER: &str = "info,tower_http=info";

/// Starts the Sentry client when `SENTRY_DSN` is set. Keep the returned guard alive for the
/// lifetime of the process so queued events are sent before it exits.
pub fn init_sentry(config: &Config) -> Option<sentry::ClientInitGuard> {
    let dsn = config.sentry_dsn.as_deref()?;
    let options = sentry::ClientOptions::new()
        .dsn(dsn)
        .maybe_release(sentry::release_name!())
        .environment(config.app_env.as_str())
        // Trace a share of requests to stay inside the free quota.
        .traces_sample_rate(0.1);
    Some(sentry::init(options))
}

/// Installs the global subscriber. Logs go to stdout. Sentry receives request spans,
/// breadcrumbs, and an issue for every `ERROR` event. Without a DSN the Sentry layers do nothing.
pub fn init_tracing(config: &Config) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));
    let registry = tracing_subscriber::registry()
        .with(filter)
        .with(SpanLayer::new().with_filter(LevelFilter::INFO))
        .with(BreadcrumbLayer::new().with_filter(LevelFilter::INFO))
        .with(ErrorLayer::new().with_filter(LevelFilter::ERROR));

    match config.log_format {
        LogFormat::Json => registry.with(fmt::layer().json()).init(),
        LogFormat::Pretty => registry.with(fmt::layer()).init(),
    }
}
