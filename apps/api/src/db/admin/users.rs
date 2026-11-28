//! User search and the account view (18 sections 5.1 and 5.2), sanction history and role
//! changes.

use sqlx::{PgPool, Postgres, QueryBuilder};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::db::admin::escape_like;
use crate::domain::options::Gender;
use crate::domain::types::{
    AuditTargetType, ConsentDocument, DevicePlatform, Locale, ProfileStatus, SanctionType,
    UserRole, UserStatus,
};
use crate::error::ApiError;
use crate::models::admin::{
    AdminConsent, AdminDevice, AdminSanction, AdminUserListItem, UserFlags,
};
use crate::state::AppState;

/// Rows of the user search and of the account view.
const BASE: &str = "SELECT u.id AS user_id, p.id AS profile_id, p.public_code, u.email, u.role,
        u.status, p.status AS profile_status, p.first_name, p.last_name, p.gender,
        u.created_at, u.last_seen_at, u.email_verified, u.phone_e164, u.phone_verified,
        u.status_reason, u.suspended_until, u.deletion_requested_at, u.purge_after, u.locale
     FROM users u JOIN profiles p ON p.user_id = u.id";

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserRow {
    pub user_id: Uuid,
    pub profile_id: Uuid,
    pub public_code: String,
    pub email: Option<String>,
    pub role: UserRole,
    pub status: UserStatus,
    pub profile_status: ProfileStatus,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    pub created_at: OffsetDateTime,
    pub last_seen_at: Option<OffsetDateTime>,
    pub email_verified: bool,
    pub phone_e164: Option<String>,
    pub phone_verified: bool,
    pub status_reason: Option<String>,
    pub suspended_until: Option<OffsetDateTime>,
    pub deletion_requested_at: Option<OffsetDateTime>,
    pub purge_after: Option<OffsetDateTime>,
    pub locale: Locale,
}

impl UserRow {
    pub fn item(&self) -> AdminUserListItem {
        AdminUserListItem {
            user_id: self.user_id,
            profile_id: self.profile_id,
            public_code: self.public_code.clone(),
            email: self.email.clone(),
            role: self.role,
            status: self.status,
            profile_status: self.profile_status,
            first_name: self.first_name.clone(),
            last_name: self.last_name.clone(),
            gender: self.gender,
            created_at: self.created_at,
            last_seen_at: self.last_seen_at,
        }
    }
}

/// Filters of `GET /v1/admin/users`, all optional.
#[derive(Debug, Default)]
pub struct UserSearch {
    /// At least 3 characters when given (checked by the route).
    pub q: Option<String>,
    pub status: Option<UserStatus>,
    pub role: Option<UserRole>,
}

/// One page of the users matching the filters, newest first, and how many match in all. With no
/// filter it is every account. `q` matches, case-insensitively: the exact email, the phone
/// number (digits only, suffix match of at least 7 digits), the exact profile code, or a prefix
/// of the first or last name.
pub async fn list(
    db: &PgPool,
    filter: &UserSearch,
    offset: i64,
    limit: i64,
) -> sqlx::Result<(Vec<UserRow>, i64)> {
    let mut count = QueryBuilder::<Postgres>::new(
        "SELECT count(*) FROM users u JOIN profiles p ON p.user_id = u.id",
    );
    push_filters(&mut count, filter);
    let total: i64 = count.build_query_scalar().fetch_one(db).await?;

    let mut query = QueryBuilder::<Postgres>::new(BASE);
    push_filters(&mut query, filter);
    query
        .push(" ORDER BY u.created_at DESC, u.id DESC LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    let rows = query.build_query_as::<UserRow>().fetch_all(db).await?;
    Ok((rows, total))
}

/// The `WHERE` clause of [`list`], shared by its count and its page.
fn push_filters(query: &mut QueryBuilder<Postgres>, filter: &UserSearch) {
    query.push(" WHERE TRUE");
    if let Some(status) = filter.status {
        query.push(" AND u.status = ").push_bind(status);
    }
    if let Some(role) = filter.role {
        query.push(" AND u.role = ").push_bind(role);
    }
    if let Some(q) = &filter.q {
        let digits: String = q.chars().filter(char::is_ascii_digit).collect();
        query
            .push(" AND (lower(u.email) = ")
            .push_bind(q.to_lowercase())
            .push(" OR p.public_code = ")
            .push_bind(q.to_uppercase())
            .push(" OR lower(p.first_name) LIKE ")
            .push_bind(format!("{}%", escape_like(&q.to_lowercase())))
            .push(" OR lower(p.last_name) LIKE ")
            .push_bind(format!("{}%", escape_like(&q.to_lowercase())));
        if digits.len() >= 7 {
            query
                .push(" OR regexp_replace(COALESCE(u.phone_e164, ''), '\\D', '', 'g') LIKE ")
                .push_bind(format!("%{digits}"));
        }
        query.push(")");
    }
}

/// One account, or `None`.
pub async fn get(db: &PgPool, user_id: Uuid) -> sqlx::Result<Option<UserRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!("{BASE} WHERE u.id = $1")))
        .bind(user_id)
        .fetch_optional(db)
        .await
}

/// The role and status of an account, for the permission checks of the sanction routes.
pub async fn role_and_status(
    db: &PgPool,
    user_id: Uuid,
) -> sqlx::Result<Option<(UserRole, UserStatus)>> {
    sqlx::query_as("SELECT role, status FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(db)
        .await
}

#[derive(sqlx::FromRow)]
struct SanctionRow {
    id: Uuid,
    kind: SanctionType,
    reason: String,
    report_id: Option<Uuid>,
    starts_at: OffsetDateTime,
    ends_at: Option<OffsetDateTime>,
    created_by_email: Option<String>,
    revoked_at: Option<OffsetDateTime>,
    revoked_by_email: Option<String>,
}

/// Every sanction of an account, newest first.
pub async fn sanctions(db: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<AdminSanction>> {
    let rows: Vec<SanctionRow> = sqlx::query_as(
        "SELECT s.id, s.type AS kind, s.reason, s.report_id, s.starts_at, s.ends_at,
                cb.email AS created_by_email, s.revoked_at, rb.email AS revoked_by_email
         FROM sanctions s
         LEFT JOIN users cb ON cb.id = s.created_by
         LEFT JOIN users rb ON rb.id = s.revoked_by
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC, s.id DESC",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| AdminSanction {
            id: row.id,
            kind: row.kind,
            reason: row.reason,
            report_id: row.report_id,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
            created_by_email: row.created_by_email,
            revoked_at: row.revoked_at,
            revoked_by_email: row.revoked_by_email,
        })
        .collect())
}

/// Devices without their push tokens, which are never shown.
pub async fn devices(db: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<AdminDevice>> {
    let rows: Vec<(
        DevicePlatform,
        Option<String>,
        Option<String>,
        OffsetDateTime,
    )> = sqlx::query_as(
        "SELECT platform, app_version, device_model, last_seen_at
             FROM user_devices WHERE user_id = $1 ORDER BY last_seen_at DESC",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(platform, app_version, device_model, last_seen_at)| AdminDevice {
                platform,
                app_version,
                device_model,
                last_seen_at,
            },
        )
        .collect())
}

pub async fn consents(db: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<AdminConsent>> {
    let rows: Vec<(ConsentDocument, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT document, version, accepted_at FROM user_consents
         WHERE user_id = $1 ORDER BY accepted_at DESC, id DESC",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(document, version, accepted_at)| AdminConsent {
            document,
            version,
            accepted_at,
        })
        .collect())
}

/// The abuse flags of 18 section 5.2.
pub async fn flags(db: &PgPool, profile_id: Uuid) -> sqlx::Result<UserFlags> {
    let (dismissed, actioned, money, shared): (i64, i64, i64, bool) = sqlx::query_as(
        "SELECT
           (SELECT count(*) FROM reports
             WHERE reporter_profile_id = $1 AND status = 'dismissed'
               AND created_at > now() - interval '30 days'),
           (SELECT count(*) FROM reports
             WHERE reporter_profile_id = $1 AND status = 'actioned'
               AND created_at > now() - interval '30 days'),
           (SELECT count(*) FROM messages
             WHERE sender_profile_id = $1 AND safety_flag = 'money'
               AND created_at > now() - interval '30 days'),
           EXISTS (SELECT 1 FROM reports
                    WHERE target_profile_id = $1 AND source = 'system'
                      AND context ->> 'trigger' = 'device_of_sanctioned_user')",
    )
    .bind(profile_id)
    .fetch_one(db)
    .await?;
    Ok(UserFlags {
        reporter_misuse: dismissed >= 5 && actioned == 0,
        money_flags_30d: money,
        shared_device_with_sanctioned_user: shared,
    })
}

/// Changes a role (18 section 5.3). The target must be `active`. Returns false when the role
/// was already the requested one (nothing changes, so nothing is audited).
pub async fn change_role(
    state: &AppState,
    actor: Uuid,
    user_id: Uuid,
    role: UserRole,
) -> Result<bool, ApiError> {
    let mut tx = state.db.begin().await?;
    let current: Option<(UserRole, UserStatus)> =
        sqlx::query_as("SELECT role, status FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((from, status)) = current else {
        return Err(ApiError::NotFound);
    };
    if status != UserStatus::Active {
        return Err(ApiError::invalid_state(status));
    }
    if from == role {
        return Ok(false);
    }
    sqlx::query("UPDATE users SET role = $2 WHERE id = $1")
        .bind(user_id)
        .bind(role)
        .execute(&mut *tx)
        .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "user.role_change",
        AuditTargetType::User,
        &user_id.to_string(),
        serde_json::json!({ "from": from, "to": role }),
    )
    .await?;
    tx.commit().await?;
    state.accounts.invalidate(user_id);
    Ok(true)
}
