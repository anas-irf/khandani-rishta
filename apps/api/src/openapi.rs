//! OpenAPI description of the API, generated from the route handlers.

use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Khandani Rishta API",
        description = "HTTP API used by the Khandani Rishta web and Android apps."
    ),
    tags(
        (name = "health", description = "Liveness and readiness checks"),
        (name = "meta", description = "Information about the running API")
    )
)]
pub struct ApiDoc;

/// Returns the OpenAPI document as pretty-printed JSON.
pub fn spec_json() -> anyhow::Result<String> {
    let (_, mut api) = crate::routes::api_router().split_for_parts();
    // utoipa fills the license from Cargo.toml, which has none.
    api.info.license = None;
    Ok(api.to_pretty_json()?)
}
