//! Liveness and readiness checks, used by deploys and uptime checks.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;

#[derive(Serialize, ToSchema)]
pub struct Health {
    /// `ok` when healthy, `unavailable` otherwise.
    status: &'static str,
}

/// The API process is running.
#[utoipa::path(
    get,
    path = "/healthz",
    tag = "health",
    responses((status = 200, description = "The process is up", body = Health))
)]
pub async fn healthz() -> Json<Health> {
    Json(Health { status: "ok" })
}

/// The API can reach the database and is ready for traffic.
#[utoipa::path(
    get,
    path = "/readyz",
    tag = "health",
    responses(
        (status = 200, description = "Ready to serve traffic", body = Health),
        (status = 503, description = "The database is unreachable", body = Health)
    )
)]
pub async fn readyz(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (StatusCode::OK, Json(Health { status: "ok" })),
        Err(error) => {
            tracing::warn!(%error, "readiness check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(Health {
                    status: "unavailable",
                }),
            )
        }
    }
}
