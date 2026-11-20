//! The `lift_suspensions` job (19 section 2.9, 06 section 8.3): lifts every suspension whose end
//! date has passed. The system lifts them, so no audit row is written and the sanction is not
//! marked revoked.

use uuid::Uuid;

use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue};
use crate::sanctions::{self, SanctionError};
use crate::state::AppState;

/// Suspensions lifted per run; a full batch continues with a new job.
const BATCH: i64 = 500;

pub async fn run(state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let due: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users
         WHERE status = 'suspended' AND suspended_until <= now()
         ORDER BY suspended_until, id LIMIT $1",
    )
    .bind(BATCH)
    .fetch_all(&state.db)
    .await?;

    let mut failed = 0_usize;
    for user_id in &due {
        // A user someone else lifted or banned between the query and the lift is skipped.
        if let Err(error) = sanctions::lift(state, *user_id, None).await
            && !matches!(
                error,
                SanctionError::InvalidState(_) | SanctionError::NotFound
            )
        {
            failed += 1;
            tracing::error!(%user_id, %error, "could not lift a suspension");
        }
    }
    if i64::try_from(due.len()).is_ok_and(|count| count == BATCH) {
        enqueue(
            &state.db,
            NewJob::new("lift_suspensions", serde_json::json!({})),
        )
        .await?;
        state.jobs.wake();
    }
    if failed > 0 {
        anyhow::bail!("{failed} suspension(s) could not be lifted");
    }
    Ok(JobOutcome::Done)
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn expired_suspensions_are_lifted_and_running_ones_are_kept(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(crate::domain::types::UserRole::Admin).await;
        let ended = app.member().await;
        let running = app.member().await;
        for (user, days) in [(&ended, 7), (&running, 7)] {
            let response = app
                .post(
                    &format!("/v1/admin/users/{}/suspend", user.user_id),
                    Some(&admin.token),
                    serde_json::json!({ "reason": "Repeated rudeness in chat", "days": days }),
                )
                .await;
            assert_eq!(
                response.status,
                axum::http::StatusCode::OK,
                "{}",
                response.text
            );
        }
        // One suspension ran out; the other has days to go.
        sqlx::query("UPDATE users SET suspended_until = now() - interval '1 minute' WHERE id = $1")
            .bind(ended.user_id)
            .execute(app.db())
            .await
            .unwrap();
        // A deletion requested while suspended continues (06 section 9.4).
        let deleting = app.member().await;
        let response = app
            .post(
                &format!("/v1/admin/users/{}/suspend", deleting.user_id),
                Some(&admin.token),
                serde_json::json!({ "reason": "Repeated rudeness in chat", "days": 1 }),
            )
            .await;
        assert_eq!(response.status, axum::http::StatusCode::OK);
        sqlx::query(
            "UPDATE users SET suspended_until = now() - interval '1 minute',
                 deletion_requested_at = now(), purge_after = now() + interval '30 days'
             WHERE id = $1",
        )
        .bind(deleting.user_id)
        .execute(app.db())
        .await
        .unwrap();

        sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('lift_suspensions', '{}')")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;

        let status = |user_id| {
            let db = app.db().clone();
            async move {
                sqlx::query_as::<_, (String, Option<String>, String)>(
                    "SELECT u.status, u.status_reason, p.status
                     FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
                )
                .bind(user_id)
                .fetch_one(&db)
                .await
                .unwrap()
            }
        };
        assert_eq!(
            status(ended.user_id).await,
            ("active".to_owned(), None, "active".to_owned())
        );
        let still = status(running.user_id).await;
        assert_eq!(
            (still.0.as_str(), still.2.as_str()),
            ("suspended", "suspended")
        );
        let deleting_status = status(deleting.user_id).await;
        assert_eq!(deleting_status.0, "deletion_scheduled");
        assert_eq!(deleting_status.2, "active");

        // The lifted user can use the app again. No audit row and no revocation for the system.
        let me = app.get("/v1/me", Some(&ended.token)).await;
        assert_eq!(me.json["gate"], "ok");
        let revoked: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sanctions WHERE user_id = $1 AND revoked_at IS NOT NULL",
        )
        .bind(ended.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(
            revoked, 0,
            "a suspension that ran out is not marked revoked"
        );
        let audits: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM admin_audit_log WHERE action = 'user.unsuspend'",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(audits, 0, "the system writes no audit row");
        let emails: Vec<serde_json::Value> = sqlx::query_scalar(
            "SELECT payload -> 'data' FROM jobs WHERE kind = 'send_email'
               AND payload ->> 'user_id' = $1 AND payload -> 'data' ->> 'form' = 'active_again'",
        )
        .bind(ended.user_id.to_string())
        .fetch_all(app.db())
        .await
        .unwrap();
        assert_eq!(emails.len(), 1, "the active again email is queued");
    }
}
