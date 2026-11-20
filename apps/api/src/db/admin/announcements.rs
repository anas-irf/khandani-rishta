//! Sending an announcement (18 section 7.3): at most one per 24 hours, fanned out by the
//! `announcement_fanout` job.

use serde_json::json;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::types::AuditTargetType;
use crate::error::ApiError;
use crate::jobs::{NewJob, enqueue};
use crate::state::AppState;

/// How soon another announcement may be sent.
const INTERVAL: Duration = Duration::hours(24);

/// Serialises concurrent sends (an arbitrary constant for `pg_advisory_xact_lock`).
const LOCK_KEY: i64 = 0x4b52_414e_4e4f;

/// What a send was asked to say.
#[derive(Debug, Clone)]
pub struct Announcement {
    pub text_en: String,
    pub text_ur: Option<String>,
    pub url: Option<String>,
}

/// Users who receive an announcement: `active`, with an `active` or `paused` profile.
pub async fn recipients_estimate(db: impl sqlx::PgExecutor<'_>) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM users u JOIN profiles p ON p.user_id = u.id
         WHERE u.status = 'active' AND p.status IN ('active', 'paused')",
    )
    .fetch_one(db)
    .await
}

/// Enqueues the fan-out and writes the audit row (`announcement.send`) in one transaction.
/// Returns the recipient estimate. A second announcement within 24 hours answers
/// `429 limit_reached`.
pub async fn send(
    state: &AppState,
    actor: Uuid,
    announcement: &Announcement,
) -> Result<i64, ApiError> {
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(LOCK_KEY)
        .execute(&mut *tx)
        .await?;
    let last: Option<OffsetDateTime> = sqlx::query_scalar(
        "SELECT created_at FROM admin_audit_log
         WHERE action = 'announcement.send' AND created_at > now() - make_interval(hours => 24)
         ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(last) = last {
        return Err(ApiError::LimitReached {
            limit: "announcements_per_day",
            used: 1,
            resets_at: Some(last + INTERVAL),
            side: None,
        });
    }

    let estimate = recipients_estimate(&mut *tx).await?;
    enqueue(
        &mut *tx,
        NewJob::new(
            "announcement_fanout",
            json!({
                "announcement": {
                    "text_en": announcement.text_en,
                    "text_ur": announcement.text_ur,
                    "url": announcement.url,
                },
                "after_user_id": null,
                "send_email": true,
            }),
        ),
    )
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "announcement.send",
        AuditTargetType::AppSetting,
        "announcement",
        json!({
            "text_en": announcement.text_en,
            "url": announcement.url,
            "recipients_estimate": estimate,
        }),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();
    Ok(estimate)
}
