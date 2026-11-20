//! Reading `admin_audit_log` (18 section 8.2). Writing goes through [`crate::audit::record`].

use serde_json::Value;
use sqlx::{PgPool, Postgres, QueryBuilder};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::types::AuditTargetType;
use crate::models::admin::{AuditActor, AuditEntry};

#[derive(Debug, sqlx::FromRow)]
pub struct AuditRow {
    pub id: Uuid,
    pub actor_user_id: Uuid,
    pub actor_email: Option<String>,
    pub action: String,
    pub target_type: AuditTargetType,
    pub target_id: String,
    pub details: Value,
    pub created_at: OffsetDateTime,
}

impl From<AuditRow> for AuditEntry {
    fn from(row: AuditRow) -> Self {
        Self {
            id: row.id,
            actor: AuditActor {
                user_id: row.actor_user_id,
                email: row.actor_email,
            },
            action: row.action,
            target_type: row.target_type,
            target_id: row.target_id,
            details: row.details,
            created_at: row.created_at,
        }
    }
}

const SELECT: &str =
    "SELECT a.id, a.actor_user_id, u.email AS actor_email, a.action, a.target_type,
        a.target_id, a.details, a.created_at
     FROM admin_audit_log a JOIN users u ON u.id = a.actor_user_id";

/// Filters of `GET /v1/admin/audit-log`.
#[derive(Debug, Default)]
pub struct AuditFilter {
    pub actor_user_id: Option<Uuid>,
    pub target_type: Option<AuditTargetType>,
    pub target_id: Option<String>,
    pub action: Option<String>,
}

/// One page of the log, newest first. `cursor` is the `(created_at, id)` of the last row of the
/// previous page. Fetches `limit + 1` rows.
pub async fn list(
    db: &PgPool,
    filter: &AuditFilter,
    cursor: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<AuditRow>> {
    let mut query = QueryBuilder::<Postgres>::new(SELECT);
    query.push(" WHERE TRUE");
    if let Some(actor) = filter.actor_user_id {
        query.push(" AND a.actor_user_id = ").push_bind(actor);
    }
    if let Some(target_type) = filter.target_type {
        query.push(" AND a.target_type = ").push_bind(target_type);
    }
    if let Some(target_id) = &filter.target_id {
        query
            .push(" AND a.target_id = ")
            .push_bind(target_id.clone());
    }
    if let Some(action) = &filter.action {
        query.push(" AND a.action = ").push_bind(action.clone());
    }
    if let Some((created_at, id)) = cursor {
        query
            .push(" AND (a.created_at, a.id) < (")
            .push_bind(created_at)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    query
        .push(" ORDER BY a.created_at DESC, a.id DESC LIMIT ")
        .push_bind(limit + 1);
    query.build_query_as::<AuditRow>().fetch_all(db).await
}

/// The newest entries whose target is the user or their profile, for the account and profile
/// screens.
pub async fn for_user_and_profile(
    db: &PgPool,
    user_id: Uuid,
    profile_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<AuditEntry>> {
    let rows: Vec<AuditRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT}
         WHERE (a.target_type = 'user' AND a.target_id = $1)
            OR (a.target_type = 'profile' AND a.target_id = $2)
         ORDER BY a.created_at DESC, a.id DESC LIMIT $3"
    )))
    .bind(user_id.to_string())
    .bind(profile_id.to_string())
    .bind(limit)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(AuditEntry::from).collect())
}
