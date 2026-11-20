//! Geography types shared by many responses (15 section 4.1).

use std::collections::HashMap;

use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;

/// A city with its region, as every response shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema, sqlx::FromRow)]
pub struct CityRef {
    pub id: i32,
    pub name: String,
    pub region_id: Option<i32>,
    pub region_name: Option<String>,
    pub country_code: String,
}

/// Loads cities by id in one query, keyed by id.
pub async fn cities_by_ids(db: &PgPool, ids: &[i32]) -> sqlx::Result<HashMap<i32, CityRef>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<CityRef> = sqlx::query_as(
        "SELECT c.id, c.name, c.region_id, r.name AS region_name, c.country_code
         FROM cities c LEFT JOIN regions r ON r.id = c.region_id
         WHERE c.id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|city| (city.id, city)).collect())
}
