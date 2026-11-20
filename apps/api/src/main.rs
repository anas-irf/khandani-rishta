//! Khandani Rishta API server.
//!
//! Run without arguments to start the server: HTTP and WebSocket handlers, two background job
//! workers and the scheduler, as Tokio tasks of one process (19). Run with `openapi` to print the
//! OpenAPI document and exit (used by CI to keep the API contract up to date).

#![forbid(unsafe_code)]
// Temporary while feature modules land before their callers; removed at integration.
#![allow(dead_code)]

mod audit;
mod auth;
mod config;
mod db;
mod domain;
mod error;
mod extract;
mod jobs;
mod lifecycle;
mod middleware;
mod models;
mod notify;
mod openapi;
mod ratelimit;
mod realtime;
mod reference;
mod routes;
mod sanctions;
mod services;
mod settings;
mod state;
mod telemetry;
#[cfg(test)]
mod test_support;

use std::net::SocketAddr;
use std::time::Duration;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::config::Config;
use crate::realtime::hub::close_code;
use crate::state::{AppState, Integrations};

/// How long running jobs may finish after a shutdown signal (19 section 1.7).
const JOB_SHUTDOWN_GRACE: Duration = Duration::from_secs(20);
/// `statement_timeout` for the API's connections (20 section 4).
const STATEMENT_TIMEOUT: &str = "5s";

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
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::Executor::execute(
                    &mut *connection,
                    sqlx::AssertSqlSafe(format!("SET statement_timeout = '{STATEMENT_TIMEOUT}'")),
                )
                .await?;
                Ok(())
            })
        })
        .connect(&config.database_url)
        .await
        .context("failed to connect to PostgreSQL")?;

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .context("failed to run database migrations")?;

    let bind_addr = config.bind_addr;
    let app_env = config.app_env;
    let integrations = Integrations::from_config(&config);
    let state = AppState::new(config, db.clone(), integrations)
        .await
        .context("failed to load reference data")?;

    // Signing keys: loaded now (a failure does not stop the API) and every hour after.
    if let Err(error) = state.jwks.refresh().await {
        tracing::warn!(%error, "could not load Clerk signing keys; will retry on demand");
    }
    auth::jwks::spawn_refresher(state.jwks.clone());
    reference::spawn_reloader(state.reference.clone());

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let workers = jobs::worker::spawn(&state, &shutdown_rx);
    let queue = state.jobs.clone();
    let scheduler = jobs::scheduler::spawn(db, move || queue.wake(), &shutdown_rx);

    let app = routes::app(state.clone());
    let listener = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("failed to listen on {bind_addr}"))?;
    tracing::info!(%bind_addr, %app_env, "API listening");

    let hub = state.hub.clone();
    let served = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_signal().await;
        // Sockets close with 1001 so clients reconnect after the deploy (19 section 4.7).
        hub.close_all(close_code::GOING_AWAY);
    })
    .await
    .context("server stopped with an error");

    // Stop claiming jobs and let running ones finish for up to 20 seconds.
    let _ = shutdown_tx.send(true);
    let _ = scheduler.await;
    let all_workers = futures_util::future::join_all(workers);
    if tokio::time::timeout(JOB_SHUTDOWN_GRACE, all_workers)
        .await
        .is_err()
    {
        tracing::warn!(
            "jobs still running at shutdown were abandoned; they are recovered on restart"
        );
    }
    served
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
