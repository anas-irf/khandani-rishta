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
    require_response_fields(&mut api)?;
    Ok(api.to_pretty_json()?)
}

/// Response properties the API leaves out instead of sending `null`.
const OMITTED_WHEN_EMPTY: &[(&str, &str)] = &[("ErrorDetail", "fields")];

/// Marks every property of response-only schemas as required.
///
/// utoipa documents an `Option` field as not required, but responses always carry every field,
/// with `null` for "no value" (15 section 1). Without this, generated clients would type each
/// such field as possibly missing. Schemas that also appear in a request body or parameter keep
/// utoipa's reading, because there a missing field is allowed.
fn require_response_fields(api: &mut utoipa::openapi::OpenApi) -> anyhow::Result<()> {
    use std::collections::BTreeSet;
    use utoipa::openapi::{RefOr, schema::Schema};

    let document = serde_json::to_value(&*api)?;
    let schemas = &document["components"]["schemas"];
    let mut in_requests = BTreeSet::new();
    let mut in_responses = BTreeSet::new();
    for path in document["paths"]
        .as_object()
        .into_iter()
        .flat_map(|paths| paths.values())
    {
        for operation in path.as_object().into_iter().flat_map(|item| item.values()) {
            schema_names(&operation["requestBody"], schemas, &mut in_requests);
            schema_names(&operation["parameters"], schemas, &mut in_requests);
            schema_names(&operation["responses"], schemas, &mut in_responses);
        }
    }

    let Some(components) = api.components.as_mut() else {
        return Ok(());
    };
    for (name, schema) in &mut components.schemas {
        if !in_responses.contains(name) || in_requests.contains(name) {
            continue;
        }
        if let RefOr::T(Schema::Object(object)) = schema {
            object.required = object
                .properties
                .keys()
                .filter(|property| {
                    !OMITTED_WHEN_EMPTY.contains(&(name.as_str(), property.as_str()))
                })
                .cloned()
                .collect();
        }
    }
    Ok(())
}

/// Collects the names of the component schemas `value` refers to, directly or through other
/// schemas.
fn schema_names(
    value: &serde_json::Value,
    schemas: &serde_json::Value,
    names: &mut std::collections::BTreeSet<String>,
) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, inner) in map {
                if key == "$ref"
                    && let Some(name) = inner
                        .as_str()
                        .and_then(|target| target.strip_prefix("#/components/schemas/"))
                {
                    if names.insert(name.to_owned()) {
                        schema_names(&schemas[name], schemas, names);
                    }
                } else {
                    schema_names(inner, schemas, names);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                schema_names(item, schemas, names);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::Value;

    fn collect_refs(value: &Value, refs: &mut BTreeSet<String>) {
        match value {
            Value::Object(map) => {
                for (key, inner) in map {
                    if key == "$ref"
                        && let Some(target) = inner.as_str()
                    {
                        refs.insert(target.to_owned());
                    } else {
                        collect_refs(inner, refs);
                    }
                }
            }
            Value::Array(items) => items.iter().for_each(|item| collect_refs(item, refs)),
            _ => {}
        }
    }

    /// Generated clients refuse a document with a dangling `$ref` (for example an enum used only
    /// as a path or query parameter, which utoipa does not register by itself).
    #[test]
    fn every_schema_reference_resolves() {
        let document: Value = serde_json::from_str(&super::spec_json().unwrap()).unwrap();
        let mut refs = BTreeSet::new();
        collect_refs(&document, &mut refs);
        let schemas = document["components"]["schemas"].as_object().unwrap();
        let dangling: Vec<&String> = refs
            .iter()
            .filter(|target| {
                target
                    .strip_prefix("#/components/schemas/")
                    .is_none_or(|name| !schemas.contains_key(name))
            })
            .collect();
        assert!(dangling.is_empty(), "unresolved references: {dangling:?}");
    }

    /// Every operation is documented with a tag, so generated clients group it.
    #[test]
    fn every_operation_has_a_tag() {
        let document: Value = serde_json::from_str(&super::spec_json().unwrap()).unwrap();
        for (path, operations) in document["paths"].as_object().unwrap() {
            for (method, operation) in operations.as_object().unwrap() {
                assert!(
                    operation["tags"]
                        .as_array()
                        .is_some_and(|tags| !tags.is_empty()),
                    "{method} {path} has no tag"
                );
            }
        }
    }

    /// Response-only schemas require every property (nullable ones included), because the API
    /// sends `null` instead of leaving a field out. Request schemas keep optional fields.
    #[test]
    fn response_fields_are_required_and_request_fields_are_not() {
        let document: Value = serde_json::from_str(&super::spec_json().unwrap()).unwrap();
        let schemas = &document["components"]["schemas"];
        let required = |name: &str| -> BTreeSet<String> {
            schemas[name]["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect()
        };
        let properties = |name: &str| -> BTreeSet<String> {
            schemas[name]["properties"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect()
        };
        assert_eq!(required("MeUser"), properties("MeUser"));
        assert!(required("MeUser").contains("phone_e164"));
        assert!(!required("ErrorDetail").contains("fields"));
        assert!(required("PatchMe").len() < properties("PatchMe").len());
    }

    /// String enums list the codes sent on the wire, not the Rust variant names. The schema of a
    /// `text_enum!` type once showed `Male`/`Female` while the API sent `male`/`female`.
    #[test]
    fn enums_list_their_wire_codes() {
        let document: Value = serde_json::from_str(&super::spec_json().unwrap()).unwrap();
        let schemas = &document["components"]["schemas"];
        assert_eq!(
            schemas["Gender"]["enum"],
            serde_json::json!(["male", "female"])
        );
        assert_eq!(schemas["ManagedBy"]["enum"][0], "self");
        for (name, schema) in schemas.as_object().unwrap() {
            for value in schema["enum"].as_array().into_iter().flatten() {
                let code = value.as_str().unwrap_or_default();
                assert_eq!(
                    code,
                    code.to_lowercase(),
                    "{name} lists {code:?}, which is not a lower-case wire code"
                );
            }
        }
    }
}
