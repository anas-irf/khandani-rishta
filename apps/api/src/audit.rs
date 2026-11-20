//! The staff audit log (04 section 9.4, 18 section 8). Every state change made through an admin
//! route writes one row in the same transaction (03 section 8 rule 13).

use serde_json::Value;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::domain::types::AuditTargetType;

/// Appends one audit row. `action` is one of the codes of 18 section 8.
pub async fn record(
    tx: &mut PgConnection,
    actor_user_id: Uuid,
    action: &str,
    target_type: AuditTargetType,
    target_id: &str,
    details: Value,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO admin_audit_log (id, actor_user_id, action, target_type, target_id, details)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::now_v7())
    .bind(actor_user_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(details)
    .execute(tx)
    .await?;
    Ok(())
}
