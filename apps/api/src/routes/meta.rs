//! Information about the running API.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::state::AppState;

#[derive(Serialize, ToSchema)]
pub struct Meta {
    /// Service name.
    name: &'static str,
    /// Version of the running build.
    version: &'static str,
    /// Deployment the API runs in: `local`, `staging` or `production`.
    environment: &'static str,
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(meta))
}

/// Name, version and environment of the running API.
#[utoipa::path(
    get,
    path = "/meta",
    tag = "meta",
    responses((status = 200, description = "API information", body = Meta))
)]
async fn meta(State(state): State<AppState>) -> Json<Meta> {
    Json(Meta {
        name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        environment: state.config.app_env.as_str(),
    })
}
