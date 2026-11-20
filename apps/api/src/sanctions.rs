//! Warnings, suspensions and bans, and lifting them (06 section 8, 13 section 7). The database
//! is the authority: a sanction takes effect when the transaction commits and the account
//! snapshot is invalidated, whatever Clerk thinks.
//!
//! Every function here runs one transaction that locks the user row, checks the starting status
//! (`409 invalid_state` through [`SanctionError::InvalidState`]), changes everything the spec
//! lists for the sanction, and writes the audit row when a staff user acts (18 section 8.1: the
//! system writes none).

use serde_json::json;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::types::{
    AuditTargetType, BannedIdentityKind, Gate, NotificationType, UserStatus,
};
use crate::error::ApiError;
use crate::jobs::{NewJob, enqueue};
use crate::lifecycle;
use crate::notify::{notify, queue_email};
use crate::realtime::hub::{Realtime, ServerEvent, close_code};
use crate::state::AppState;

/// Why a sanction could not be applied or lifted.
#[derive(Debug, thiserror::Error)]
pub enum SanctionError {
    #[error("user not found")]
    NotFound,
    /// The user's status does not allow this action (18 section 5.3, "Allowed when").
    #[error("the user is {0}")]
    InvalidState(UserStatus),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

impl From<SanctionError> for ApiError {
    fn from(error: SanctionError) -> Self {
        match error {
            SanctionError::NotFound => Self::NotFound,
            SanctionError::InvalidState(status) => Self::invalid_state(status),
            SanctionError::Database(error) => error.into(),
        }
    }
}

/// What to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SanctionKind {
    Suspension { days: i64 },
    Ban,
}

/// The result of a lift, for the audit row and the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lifted {
    /// True when a ban was lifted, false for a suspension.
    pub was_ban: bool,
    /// The newest open sanction that was revoked. `None` when the lift ran out of time (the job
    /// does not revoke) or when no sanction row existed.
    pub sanction_id: Option<Uuid>,
}

fn rfc3339(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap_or_default()
}

/// Locks the user row and returns its status and Clerk id.
async fn lock_user(
    tx: &mut sqlx::PgConnection,
    user_id: Uuid,
) -> Result<(UserStatus, String), SanctionError> {
    sqlx::query_as("SELECT status, clerk_user_id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_optional(tx)
        .await?
        .ok_or(SanctionError::NotFound)
}

/// Applies a suspension or ban (06 section 8.1). `created_by` is the staff user, or `None`
/// when the system applies it (no audit row then). Returns the sanction id.
///
/// The user must be `active` for a suspension, and `active` or `suspended` for a ban.
#[allow(clippy::too_many_lines)] // One transaction, in the order of 06 section 8.1.
pub async fn apply(
    state: &AppState,
    user_id: Uuid,
    kind: SanctionKind,
    reason: &str,
    report_id: Option<Uuid>,
    created_by: Option<Uuid>,
) -> Result<Uuid, SanctionError> {
    let sanction_id = Uuid::now_v7();
    let ends_at = match kind {
        SanctionKind::Suspension { days } => Some(OffsetDateTime::now_utc() + Duration::days(days)),
        SanctionKind::Ban => None,
    };
    let (type_code, status, action) = match kind {
        SanctionKind::Suspension { .. } => ("suspension", "suspended", "user.suspend"),
        SanctionKind::Ban => ("ban", "banned", "user.ban"),
    };

    let mut tx = state.db.begin().await?;
    let (current, clerk_user_id) = lock_user(&mut tx, user_id).await?;
    let allowed = match kind {
        SanctionKind::Suspension { .. } => current == UserStatus::Active,
        SanctionKind::Ban => matches!(current, UserStatus::Active | UserStatus::Suspended),
    };
    if !allowed {
        return Err(SanctionError::InvalidState(current));
    }

    // Step 1.
    sqlx::query(
        "INSERT INTO sanctions (id, user_id, type, reason, report_id, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(sanction_id)
    .bind(user_id)
    .bind(type_code)
    .bind(reason)
    .bind(report_id)
    .bind(ends_at)
    .bind(created_by)
    .execute(&mut *tx)
    .await?;
    // Step 2.
    sqlx::query(
        "UPDATE users SET status = $2, status_reason = $3, suspended_until = $4 WHERE id = $1",
    )
    .bind(user_id)
    .bind(status)
    .bind(reason)
    .bind(ends_at)
    .execute(&mut *tx)
    .await?;
    // Step 3.
    let profile_id: Uuid = sqlx::query_scalar(
        "UPDATE profiles
         SET status = CASE WHEN status IN ('active', 'paused', 'pending_review') THEN 'suspended'
                           ELSE status END
         WHERE user_id = $1 RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    let expired = lifecycle::expire_pending_interests(&mut tx, profile_id).await?;
    // Step 4.
    let mut ended = Vec::new();
    if kind == SanctionKind::Ban {
        ended = lifecycle::end_all_connections(&mut tx, profile_id, "account_closed").await?;
        let hashes: (Option<Vec<u8>>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT i.number_hash, u.email, u.phone_e164
             FROM users u JOIN profiles p ON p.user_id = u.id
             LEFT JOIN profile_identity i ON i.profile_id = p.id
             WHERE u.id = $1",
        )
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
        let mut entries = Vec::new();
        if let Some(number_hash) = hashes.0 {
            entries.push((BannedIdentityKind::IdentityDocument, number_hash));
        }
        if let Some(email) = hashes.1 {
            entries.push((BannedIdentityKind::Email, state.crypto.email_hash(&email)));
        }
        if let Some(phone) = hashes.2 {
            entries.push((BannedIdentityKind::Phone, state.crypto.phone_hash(&phone)));
        }
        for (kind, hash) in entries {
            sqlx::query(
                "INSERT INTO banned_identities (kind, value_hash, reason, created_by)
                 VALUES ($1, $2, $3, $4) ON CONFLICT (kind, value_hash) DO NOTHING",
            )
            .bind(kind)
            .bind(hash)
            .bind(reason)
            .bind(created_by)
            .execute(&mut *tx)
            .await?;
        }
    }
    // Step 5 (18 section 8.3 for the details).
    if let Some(actor) = created_by {
        let details = match kind {
            SanctionKind::Suspension { days } => json!({
                "reason": reason, "days": days, "ends_at": ends_at.map(rfc3339),
                "report_id": report_id, "sanction_id": sanction_id,
            }),
            SanctionKind::Ban => json!({
                "reason": reason, "report_id": report_id, "sanction_id": sanction_id,
            }),
        };
        crate::audit::record(
            &mut tx,
            actor,
            action,
            AuditTargetType::User,
            &user_id.to_string(),
            details,
        )
        .await?;
    }
    // Steps 8 and 9 are jobs, enqueued in the same transaction.
    enqueue(
        &mut *tx,
        NewJob::new(
            "revoke_clerk_sessions",
            json!({ "clerk_user_id": clerk_user_id, "ban": kind == SanctionKind::Ban }),
        )
        .dedupe(clerk_user_id.clone()),
    )
    .await?;
    queue_email(
        &mut *tx,
        user_id,
        "account_suspended",
        json!({
            "form": status, "reason": reason,
            "suspended_until": ends_at.map(OffsetDateTime::unix_timestamp),
        }),
        None,
    )
    .await?;
    tx.commit().await?;

    // Steps 6 and 7.
    state.accounts.invalidate(user_id);
    let gate = if kind == SanctionKind::Ban {
        Gate::Banned
    } else {
        Gate::Suspended
    };
    state
        .hub
        .send_to_profile(profile_id, &ServerEvent::gate_changed(gate));
    state.hub.close_user(user_id, close_code::NOT_ALLOWED);
    for (sender, receiver) in expired {
        let other = if sender == profile_id {
            receiver
        } else {
            sender
        };
        crate::db::counters::push(state, other).await;
    }
    for connection in ended {
        let other = if connection.profile_low_id == profile_id {
            connection.profile_high_id
        } else {
            connection.profile_low_id
        };
        crate::db::counters::push(state, other).await;
    }
    state.jobs.wake();
    tracing::info!(event = "sanction.applied", %user_id, r#type = type_code, "sanction applied");
    Ok(sanction_id)
}

/// A system ban, for example when a banned email signs up again (06 section 7.3).
pub async fn apply_ban(
    state: &AppState,
    user_id: Uuid,
    reason: &str,
    report_id: Option<Uuid>,
    created_by: Option<Uuid>,
) -> Result<Uuid, SanctionError> {
    apply(
        state,
        user_id,
        SanctionKind::Ban,
        reason,
        report_id,
        created_by,
    )
    .await
}

/// Issues a warning (13 section 7.1): a `sanctions` row of type `warning`, the `account_warning`
/// email in the same transaction, and the `account_warning` notification after the commit. The
/// user's status does not change. The user must be `active`.
pub async fn warn(
    state: &AppState,
    user_id: Uuid,
    reason: &str,
    report_id: Option<Uuid>,
    created_by: Uuid,
) -> Result<Uuid, SanctionError> {
    let sanction_id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    let (current, _) = lock_user(&mut tx, user_id).await?;
    if current != UserStatus::Active {
        return Err(SanctionError::InvalidState(current));
    }
    sqlx::query(
        "INSERT INTO sanctions (id, user_id, type, reason, report_id, created_by)
         VALUES ($1, $2, 'warning', $3, $4, $5)",
    )
    .bind(sanction_id)
    .bind(user_id)
    .bind(reason)
    .bind(report_id)
    .bind(created_by)
    .execute(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        created_by,
        "user.warn",
        AuditTargetType::User,
        &user_id.to_string(),
        json!({ "reason": reason, "report_id": report_id, "sanction_id": sanction_id }),
    )
    .await?;
    queue_email(
        &mut *tx,
        user_id,
        "account_warning",
        json!({ "sanction_id": sanction_id, "reason": reason }),
        Some(format!("account_warning:{sanction_id}")),
    )
    .await?;
    tx.commit().await?;

    if let Err(error) = notify(
        state,
        user_id,
        NotificationType::AccountWarning,
        None,
        json!({ "sanction_id": sanction_id, "reason": reason }),
    )
    .await
    {
        tracing::warn!(%error, "could not create the warning notification");
    }
    state.jobs.wake();
    tracing::info!(event = "sanction.applied", %user_id, r#type = "warning", "sanction applied");
    Ok(sanction_id)
}

/// Lifts a suspension or ban (06 section 8.3). `lifted_by` is `None` when a suspension ran out
/// (the `lift_suspensions` job); then no audit row is written and the sanction is not marked
/// revoked. The user must be `suspended` or `banned`, otherwise
/// [`SanctionError::InvalidState`].
#[allow(clippy::too_many_lines)] // One transaction, in the order of 06 section 8.3.
pub async fn lift(
    state: &AppState,
    user_id: Uuid,
    lifted_by: Option<Uuid>,
) -> Result<Lifted, SanctionError> {
    let mut tx = state.db.begin().await?;
    let current: Option<(UserStatus, Option<OffsetDateTime>, String)> = sqlx::query_as(
        "SELECT status, purge_after, clerk_user_id FROM users WHERE id = $1 FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((status, purge_after, clerk_user_id)) = current else {
        return Err(SanctionError::NotFound);
    };
    let was_ban = match status {
        UserStatus::Banned => true,
        UserStatus::Suspended => false,
        other => return Err(SanctionError::InvalidState(other)),
    };
    // A deletion requested while sanctioned continues (06 section 9.4).
    let new_status = if purge_after.is_some() {
        "deletion_scheduled"
    } else {
        "active"
    };
    sqlx::query(
        "UPDATE users SET status = $2, status_reason = NULL, suspended_until = NULL WHERE id = $1",
    )
    .bind(user_id)
    .bind(new_status)
    .execute(&mut *tx)
    .await?;
    let mut sanction_id = None;
    if let Some(actor) = lifted_by {
        let revoked: Vec<Uuid> = sqlx::query_scalar(
            "UPDATE sanctions SET revoked_at = now(), revoked_by = $2
             WHERE user_id = $1 AND revoked_at IS NULL AND type IN ('suspension', 'ban')
             RETURNING id",
        )
        .bind(user_id)
        .bind(actor)
        .fetch_all(&mut *tx)
        .await?;
        // Ids are UUIDv7, so the largest is the newest.
        sanction_id = revoked.into_iter().max();
    }
    sqlx::query(
        "UPDATE profiles
         SET status = CASE WHEN status <> 'suspended' THEN status
                           WHEN first_activated_at IS NOT NULL THEN 'active'
                           ELSE 'pending_review' END,
             match_stale = true
         WHERE user_id = $1",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    if was_ban {
        let hashes: (Option<Vec<u8>>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT i.number_hash, u.email, u.phone_e164
             FROM users u JOIN profiles p ON p.user_id = u.id
             LEFT JOIN profile_identity i ON i.profile_id = p.id
             WHERE u.id = $1",
        )
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
        let email_hash = hashes.1.map(|email| state.crypto.email_hash(&email));
        let phone_hash = hashes.2.map(|phone| state.crypto.phone_hash(&phone));
        sqlx::query(
            "DELETE FROM banned_identities
             WHERE (kind = 'identity_document' AND value_hash = $1)
                OR (kind = 'email' AND value_hash = $2)
                OR (kind = 'phone' AND value_hash = $3)",
        )
        .bind(hashes.0)
        .bind(email_hash)
        .bind(phone_hash)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(actor) = lifted_by {
        crate::audit::record(
            &mut tx,
            actor,
            if was_ban {
                "user.unban"
            } else {
                "user.unsuspend"
            },
            AuditTargetType::User,
            &user_id.to_string(),
            json!({ "sanction_id": sanction_id }),
        )
        .await?;
    }
    if !was_ban {
        queue_email(
            &mut *tx,
            user_id,
            "account_suspended",
            json!({ "form": "active_again" }),
            None,
        )
        .await?;
    }
    tx.commit().await?;

    if was_ban
        && state.config.clerk.ban_enabled
        && let Err(error) = state.clerk.unban_user(&clerk_user_id).await
    {
        tracing::warn!(%error, "Clerk unban failed");
    }
    state.accounts.invalidate(user_id);
    state.jobs.wake();
    tracing::info!(event = "sanction.lifted", %user_id, was_ban, "sanction lifted");
    Ok(Lifted {
        was_ban,
        sanction_id,
    })
}
