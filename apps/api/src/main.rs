//! Khandani Rishta API server.
//!
//! Run without arguments to start the server. Run with `openapi` to print the
//! OpenAPI document and exit (used by CI to keep the API contract up to date).

#![forbid(unsafe_code)]

mod config;
mod domain;
mod openapi;
mod reference;
mod routes;
mod state;
mod telemetry;

use std::time::Duration;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;

use crate::config::Config;
use crate::state::AppState;

fn main() -> anyhow::Result<()> {
    // Local development reads `.env`; on the servers systemd provides the environment.
    let _ = dotenvy::dotenv();

    if std::env::args().nth(1).as_deref() == Some("openapi") {
        println!("{}", openapi::spec_json()?);
        return Ok(());
    }

    let config = Config::from_env()?;

    // Sentry has to start before the async runtime.
    let _sentry = telemetry::init_sentry(&config);
    telemetry::init_tracing(&config);

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("failed to start the Tokio runtime")?
        .block_on(serve(config))
}

async fn serve(config: Config) -> anyhow::Result<()> {
    let db = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
        .context("failed to connect to PostgreSQL")?;

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .context("failed to run database migrations")?;

    let bind_addr = config.bind_addr;
    let app_env = config.app_env;
    let app = routes::app(AppState::new(config, db));

    let listener = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("failed to listen on {bind_addr}"))?;
    tracing::info!(%bind_addr, %app_env, "API listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server stopped with an error")
}

/// Resolves on Ctrl+C or, on Linux, on the SIGTERM that systemd sends when stopping the service.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to listen for Ctrl+C");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to listen for SIGTERM")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    tracing::info!("shutting down");
}
