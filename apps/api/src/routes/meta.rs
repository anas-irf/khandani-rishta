//! Information about the running API and the latest Android release (15 section 5).

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::extract::ApiQuery;
use crate::middleware::AppRelease;
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
    OpenApiRouter::new()
        .routes(routes!(meta))
        .routes(routes!(app_release))
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

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ReleaseQuery {
    /// Only `android`.
    pub platform: String,
}

/// The latest Android release, for the in-app update prompt.
#[utoipa::path(
    get,
    path = "/meta/app-release",
    tag = "meta",
    params(ReleaseQuery),
    responses((status = 200, body = AppRelease), (status = 404, body = ErrorBody))
)]
async fn app_release(
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<ReleaseQuery>,
) -> ApiResult<Json<AppRelease>> {
    if query.platform != "android" {
        return Err(ApiError::NotFound);
    }
    state
        .releases
        .latest(&state.db)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound)
}
