//! OpenAPI description of the API, generated from the route handlers.

use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Khandani Rishta API",
        description = "HTTP API used by the Khandani Rishta web and Android apps."
    ),
    modifiers(&BearerAuth),
    tags(
        (name = "health", description = "Liveness and readiness checks"),
        (name = "meta", description = "Information about the running API"),
        (name = "reference", description = "Option lists and lookup data"),
        (name = "account", description = "The signed-in user's account"),
        (name = "profile", description = "Onboarding and the member's own profile"),
        (name = "photos", description = "The member's own photos"),
        (name = "verification", description = "Identity and selfie verification"),
        (name = "discovery", description = "Recommendations, search and other members' profiles"),
        (name = "interests", description = "Rishta requests"),
        (name = "connections", description = "Accepted interests and chat"),
        (name = "relations", description = "Shortlist, pass, block, photo access and reports"),
        (name = "notifications", description = "In-app notifications and push devices"),
        (name = "admin", description = "Staff console"),
        (name = "webhooks", description = "Inbound webhooks")
    )
)]
pub struct ApiDoc;

/// Declares the `bearer` scheme: a Clerk session token in `Authorization: Bearer <token>`.
struct BearerAuth;

impl Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .description(Some("Clerk session token"))
                    .build(),
            ),
        );
    }
}

/// Returns the OpenAPI document as pretty-printed JSON.
pub fn spec_json() -> anyhow::Result<String> {
    let (_, mut api) = crate::routes::api_router().split_for_parts();
    // utoipa fills the license from Cargo.toml, which has none.
    api.info.license = None;
    Ok(api.to_pretty_json()?)
}
