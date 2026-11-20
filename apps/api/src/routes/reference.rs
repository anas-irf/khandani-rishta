//! Reference data routes (15 section 5): the bootstrap body, regions and city search.

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::extract::ApiQuery;
use crate::models::reference::CityRef;
use crate::reference::ReferenceBootstrap;
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(bootstrap))
        .routes(routes!(regions))
        .routes(routes!(cities))
}

/// All small lookup lists and option labels. Supports `ETag` / `If-None-Match`.
#[utoipa::path(
    get,
    path = "/reference/bootstrap",
    tag = "reference",
    responses(
        (status = 200, body = ReferenceBootstrap),
        (status = 304, description = "Not modified")
    )
)]
async fn bootstrap(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let data = state.reference.get();
    let etag = format!("\"{}\"", data.version);
    let matches = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .map(|tag| tag.trim().trim_start_matches("W/"))
                .any(|tag| tag == etag || tag == "*")
        });
    let mut response = if matches {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        (
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            data.bootstrap_json.clone(),
        )
            .into_response()
    };
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, value);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    response
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct RegionsQuery {
    /// ISO 3166-1 alpha-2, for example `PK`.
    pub country_code: String,
}

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct RegionItem {
    pub id: i32,
    pub name: String,
    pub name_ur: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RegionList {
    pub items: Vec<RegionItem>,
}

/// Regions of a country, sorted by name.
#[utoipa::path(
    get,
    path = "/reference/regions",
    tag = "reference",
    params(RegionsQuery),
    responses((status = 200, body = RegionList), (status = 400, body = ErrorBody))
)]
async fn regions(
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<RegionsQuery>,
) -> ApiResult<Json<RegionList>> {
    let items = sqlx::query_as(
        "SELECT id, name, name_ur FROM regions WHERE country_code = $1 ORDER BY name",
    )
    .bind(query.country_code.to_uppercase())
    .fetch_all(&state.db)
    .await?;
    Ok(Json(RegionList { items }))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CitiesQuery {
    pub country_code: String,
    pub region_id: Option<i32>,
    /// At least 2 characters; prefix and trigram match.
    pub q: Option<String>,
    /// Default 20, maximum 50.
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CityList {
    pub items: Vec<CityRef>,
}

/// Escapes `LIKE` wildcards so a typed `%` or `_` matches literally.
fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// City search. Without `q`: major cities first, then by population. With `q`: names that start
/// with it first, then by similarity (15 section 5).
#[utoipa::path(
    get,
    path = "/reference/cities",
    tag = "reference",
    params(CitiesQuery),
    responses((status = 200, body = CityList), (status = 400, body = ErrorBody))
)]
async fn cities(
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<CitiesQuery>,
) -> ApiResult<Json<CityList>> {
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let q = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());
    if q.is_some_and(|q| q.chars().count() < 2) {
        return Err(ApiError::BadRequest(
            "q must have at least 2 characters".to_owned(),
        ));
    }
    let items: Vec<CityRef> = match q {
        None => {
            sqlx::query_as(
                "SELECT c.id, c.name, c.region_id, r.name AS region_name, c.country_code
                 FROM cities c LEFT JOIN regions r ON r.id = c.region_id
                 WHERE c.country_code = $1 AND ($2::int IS NULL OR c.region_id = $2)
                 ORDER BY c.is_major DESC, c.population DESC NULLS LAST, c.name
                 LIMIT $3",
            )
            .bind(query.country_code.to_uppercase())
            .bind(query.region_id)
            .bind(limit)
            .fetch_all(&state.db)
            .await?
        }
        Some(q) => {
            sqlx::query_as(
                "SELECT c.id, c.name, c.region_id, r.name AS region_name, c.country_code
                 FROM cities c LEFT JOIN regions r ON r.id = c.region_id
                 WHERE c.country_code = $1 AND ($2::int IS NULL OR c.region_id = $2)
                   AND (c.name ILIKE $3 || '%' OR c.name % $4)
                 ORDER BY (c.name ILIKE $3 || '%') DESC, c.is_major DESC,
                          similarity(c.name, $4) DESC, c.population DESC NULLS LAST, c.name
                 LIMIT $5",
            )
            .bind(query.country_code.to_uppercase())
            .bind(query.region_id)
            .bind(escape_like(q))
            .bind(q)
            .bind(limit)
            .fetch_all(&state.db)
            .await?
        }
    };
    Ok(Json(CityList { items }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_wildcards_are_escaped() {
        assert_eq!(escape_like("50%_off"), "50\\%\\_off");
    }
}
