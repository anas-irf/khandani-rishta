//! The `cleanup_old_rows` job (19 section 2.13): applies the retention table of 04 section 12.
//!
//! One statement per line of the table, each limited to 5,000 rows per run so that no single
//! transaction is large. What is left over is taken the next day.
//!
//! Two lines of the table are read like this:
//!
//! - `usage_counters` compares `day` with the `Asia/Karachi` date, because that is the time
//!   zone the days are counted in (03 section 7).
//! - `banned_identities` is left alone: its rows carry no owner (only keyed hashes), and a ban
//!   is permanent (06 section 9.4: "The `banned_identities` rows stay after the purge").

use serde_json::json;
use sqlx::PgPool;

use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue};
use crate::state::AppState;

/// Rows one statement may delete per run.
const LIMIT: i64 = 5000;

/// Keys per `delete_objects` job (19 section 2.3).
const KEYS_PER_JOB: usize = 1000;

/// `(what, sql)`: each statement takes the row limit as `$1` and deletes at most that many.
const STATEMENTS: &[(&str, &str)] = &[
    (
        "profile_views",
        "DELETE FROM profile_views WHERE ctid IN (
             SELECT ctid FROM profile_views WHERE last_viewed_at < now() - interval '90 days' LIMIT $1)",
    ),
    (
        "notifications",
        "DELETE FROM notifications WHERE id IN (
             SELECT id FROM notifications WHERE created_at < now() - interval '90 days' LIMIT $1)",
    ),
    (
        "match_recommendations",
        "DELETE FROM match_recommendations WHERE ctid IN (
             SELECT ctid FROM match_recommendations WHERE computed_at < now() - interval '14 days' LIMIT $1)",
    ),
    (
        "usage_counters",
        "DELETE FROM usage_counters WHERE ctid IN (
             SELECT ctid FROM usage_counters
             WHERE day < (now() AT TIME ZONE 'Asia/Karachi')::date - 30 LIMIT $1)",
    ),
    (
        "passes",
        "DELETE FROM passes WHERE ctid IN (
             SELECT ctid FROM passes WHERE expires_at < now() LIMIT $1)",
    ),
    (
        "jobs_succeeded",
        "DELETE FROM jobs WHERE id IN (
             SELECT id FROM jobs
             WHERE status = 'succeeded' AND finished_at < now() - interval '7 days' LIMIT $1)",
    ),
    (
        "jobs_dead",
        "DELETE FROM jobs WHERE id IN (
             SELECT id FROM jobs
             WHERE status = 'dead' AND finished_at < now() - interval '30 days' LIMIT $1)",
    ),
    (
        "webhook_events",
        "DELETE FROM webhook_events WHERE id IN (
             SELECT id FROM webhook_events WHERE received_at < now() - interval '30 days' LIMIT $1)",
    ),
    (
        "messages",
        "DELETE FROM messages WHERE id IN (
             SELECT m.id FROM messages m JOIN connections c ON c.id = m.connection_id
             WHERE c.status = 'ended' AND c.ended_at < now() - interval '12 months' LIMIT $1)",
    ),
    (
        "user_devices",
        "DELETE FROM user_devices WHERE id IN (
             SELECT id FROM user_devices WHERE last_seen_at < now() - interval '90 days' LIMIT $1)",
    ),
    // Records of accounts purged more than 2 years ago. Sanctions first, so that the reports
    // they point at can go too; a report that a remaining sanction still links to stays.
    (
        "user_consents",
        "DELETE FROM user_consents WHERE id IN (
             SELECT c.id FROM user_consents c JOIN users u ON u.id = c.user_id
             WHERE u.deleted_at < now() - interval '2 years' LIMIT $1)",
    ),
    (
        "sanctions",
        "DELETE FROM sanctions WHERE id IN (
             SELECT s.id FROM sanctions s JOIN users u ON u.id = s.user_id
             WHERE u.deleted_at < now() - interval '2 years' LIMIT $1)",
    ),
    (
        "reports",
        "DELETE FROM reports WHERE id IN (
             SELECT r.id FROM reports r
             JOIN profiles p ON p.id = r.target_profile_id
             JOIN users u ON u.id = p.user_id
             WHERE u.deleted_at < now() - interval '2 years'
               AND NOT EXISTS (SELECT 1 FROM sanctions s WHERE s.report_id = r.id)
             LIMIT $1)",
    ),
    (
        "admin_audit_log",
        "DELETE FROM admin_audit_log WHERE id IN (
             SELECT id FROM (
                 SELECT a.id FROM admin_audit_log a
                 JOIN users u ON a.target_type = 'user' AND a.target_id = u.id::text
                 WHERE u.deleted_at < now() - interval '2 years'
                 UNION
                 SELECT a.id FROM admin_audit_log a
                 JOIN profiles p ON a.target_type = 'profile' AND a.target_id = p.id::text
                 JOIN users u ON u.id = p.user_id
                 WHERE u.deleted_at < now() - interval '2 years'
             ) old LIMIT $1)",
    ),
];

pub async fn run(state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    for (what, sql) in STATEMENTS {
        let deleted = sqlx::query(*sql)
            .bind(LIMIT)
            .execute(&state.db)
            .await?
            .rows_affected();
        if deleted > 0 {
            tracing::info!(
                event = "cleanup.deleted",
                what = *what,
                deleted,
                "old rows deleted"
            );
        }
    }
    let expired = expire_exports(&state.db).await?;
    if expired > 0 {
        tracing::info!(
            event = "cleanup.deleted",
            what = "data_exports",
            deleted = expired,
            "exports expired"
        );
        state.jobs.wake();
    }
    Ok(JobOutcome::Done)
}

/// Marks `ready` exports whose link has run out as `expired`, clears the key, and enqueues the
/// deletion of the files. Returns how many were expired.
async fn expire_exports(db: &PgPool) -> anyhow::Result<usize> {
    let mut tx = db.begin().await?;
    // `due.file_key` is the key before the update clears it.
    let keys: Vec<Option<String>> = sqlx::query_scalar(
        "WITH due AS (
             SELECT id, file_key FROM data_exports
             WHERE status = 'ready' AND expires_at < now() ORDER BY expires_at LIMIT $1
             FOR UPDATE)
         UPDATE data_exports d SET status = 'expired', file_key = NULL
         FROM due WHERE d.id = due.id
         RETURNING due.file_key",
    )
    .bind(LIMIT)
    .fetch_all(&mut *tx)
    .await?;
    let count = keys.len();
    let keys: Vec<String> = keys.into_iter().flatten().collect();
    for chunk in keys.chunks(KEYS_PER_JOB) {
        enqueue(
            &mut *tx,
            NewJob::new("delete_objects", json!({ "keys": chunk })),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::test_support::TestApp;

    async fn run_cleanup(app: &TestApp) {
        sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('cleanup_old_rows', '{}')")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;
    }

    async fn count(app: &TestApp, sql: &str) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
            .fetch_one(app.db())
            .await
            .unwrap()
    }

    /// Every line of the retention table: old rows go, recent rows stay.
    #[sqlx::test]
    async fn applies_every_line_of_the_retention_table(db: PgPool) {
        let app = TestApp::new(db).await;
        let a = app.member().await;
        let b = app.member_of(crate::domain::options::Gender::Female).await;
        let db = app.db();

        // profile_views: 90 days.
        for (viewed_on, last_viewed) in [
            ("2026-01-01", "now() - interval '91 days'"),
            ("2026-01-02", "now() - interval '10 days'"),
        ] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "INSERT INTO profile_views (viewer_profile_id, viewed_profile_id, viewed_on, last_viewed_at)
                 VALUES ($1, $2, '{viewed_on}', {last_viewed})"
            )))
            .bind(a.profile_id)
            .bind(b.profile_id)
            .execute(db)
            .await
            .unwrap();
        }
        // notifications: 90 days.
        for age in ["91 days", "1 day"] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "INSERT INTO notifications (user_id, type, created_at)
                 VALUES ($1, 'profile_approved', now() - interval '{age}')"
            )))
            .bind(a.user_id)
            .execute(db)
            .await
            .unwrap();
        }
        // match_recommendations: 14 days.
        sqlx::query(
            "INSERT INTO match_recommendations (profile_id, candidate_profile_id, compat, rank_score, computed_at)
             VALUES ($1, $2, 50, 0.1, now() - interval '15 days'), ($2, $1, 50, 0.1, now())",
        )
        .bind(a.profile_id)
        .bind(b.profile_id)
        .execute(db)
        .await
        .unwrap();
        // usage_counters: 30 days.
        sqlx::query(
            "INSERT INTO usage_counters (profile_id, counter, day, count)
             VALUES ($1, 'interests_sent', (now() AT TIME ZONE 'Asia/Karachi')::date - 31, 1),
                    ($1, 'profiles_viewed', (now() AT TIME ZONE 'Asia/Karachi')::date - 1, 1)",
        )
        .bind(a.profile_id)
        .execute(db)
        .await
        .unwrap();
        // passes: removed once expired.
        sqlx::query(
            "INSERT INTO passes (profile_id, target_profile_id, expires_at)
             VALUES ($1, $2, now() - interval '1 day'), ($2, $1, now() + interval '1 day')",
        )
        .bind(a.profile_id)
        .bind(b.profile_id)
        .execute(db)
        .await
        .unwrap();
        // jobs: succeeded after 7 days, dead after 30 days.
        sqlx::query(
            "INSERT INTO jobs (kind, status, finished_at) VALUES
                ('send_push', 'succeeded', now() - interval '8 days'),
                ('send_push', 'succeeded', now() - interval '6 days'),
                ('send_push', 'dead', now() - interval '31 days'),
                ('send_push', 'dead', now() - interval '29 days')",
        )
        .execute(db)
        .await
        .unwrap();
        // webhook_events: 30 days.
        sqlx::query(
            "INSERT INTO webhook_events (id, source, event_type, received_at) VALUES
                ('old', 'clerk', 'user.updated', now() - interval '31 days'),
                ('new', 'clerk', 'user.updated', now() - interval '29 days')",
        )
        .execute(db)
        .await
        .unwrap();
        // user_devices: 90 days.
        sqlx::query(
            "INSERT INTO user_devices (user_id, platform, push_token, last_seen_at) VALUES
                ($1, 'android', 'old-token', now() - interval '91 days'),
                ($1, 'android', 'new-token', now() - interval '1 day')",
        )
        .bind(a.user_id)
        .execute(db)
        .await
        .unwrap();
        // messages of connections that ended more than 12 months ago.
        let (low, high) = crate::lifecycle::ordered_pair(a.profile_id, b.profile_id);
        let interest_id: Uuid = sqlx::query_scalar(
            "INSERT INTO interests (sender_profile_id, receiver_profile_id, status, expires_at)
             VALUES ($1, $2, 'accepted', now()) RETURNING id",
        )
        .bind(a.profile_id)
        .bind(b.profile_id)
        .fetch_one(db)
        .await
        .unwrap();
        let old_connection: Uuid = sqlx::query_scalar(
            "INSERT INTO connections (profile_low_id, profile_high_id, interest_id, status, ended_reason, ended_at)
             VALUES ($1, $2, $3, 'ended', 'other', now() - interval '13 months') RETURNING id",
        )
        .bind(low)
        .bind(high)
        .bind(interest_id)
        .fetch_one(db)
        .await
        .unwrap();
        let recent_connection: Uuid = sqlx::query_scalar(
            "INSERT INTO connections (profile_low_id, profile_high_id, interest_id, status, ended_reason, ended_at)
             VALUES ($1, $2, $3, 'ended', 'other', now() - interval '2 months') RETURNING id",
        )
        .bind(low)
        .bind(high)
        .bind(interest_id)
        .fetch_one(db)
        .await
        .unwrap();
        for connection in [old_connection, recent_connection] {
            sqlx::query("INSERT INTO messages (id, connection_id, sender_profile_id, body) VALUES ($1, $2, $3, 'hi')")
                .bind(Uuid::now_v7())
                .bind(connection)
                .bind(a.profile_id)
                .execute(db)
                .await
                .unwrap();
        }
        // data_exports: a ready export whose link ran out is expired and its file deleted.
        sqlx::query(
            "INSERT INTO data_exports (user_id, status, file_key, expires_at) VALUES
                ($1, 'ready', 'exports/old.json', now() - interval '1 hour'),
                ($1, 'ready', 'exports/new.json', now() + interval '1 day')",
        )
        .bind(a.user_id)
        .execute(db)
        .await
        .unwrap();
        // Records of an account purged more than 2 years ago go; a recently purged one stays.
        let old = app.member().await;
        let recent = app.member().await;
        for (user, age) in [(&old, "3 years"), (&recent, "1 month")] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE users SET status = 'deleted', deleted_at = now() - interval '{age}' WHERE id = $1"
            )))
            .bind(user.user_id)
            .execute(db)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO sanctions (user_id, type, reason) VALUES ($1, 'warning', 'Be polite')",
            )
            .bind(user.user_id)
            .execute(db)
            .await
            .unwrap();
            sqlx::query("INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason) VALUES ($1, $2, 'profile', 'other')")
                .bind(a.profile_id)
                .bind(user.profile_id)
                .execute(db)
                .await
                .unwrap();
            sqlx::query("INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id) VALUES ($1, 'user.warn', 'user', $2), ($1, 'profile.approve', 'profile', $3)")
                .bind(a.user_id)
                .bind(user.user_id.to_string())
                .bind(user.profile_id.to_string())
                .execute(db)
                .await
                .unwrap();
        }
        // A report linked from a remaining sanction is kept so the foreign key holds.
        let linked_report: Uuid = sqlx::query_scalar(
            "INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason)
             VALUES ($1, $2, 'profile', 'other') RETURNING id",
        )
        .bind(b.profile_id)
        .bind(old.profile_id)
        .fetch_one(db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO sanctions (user_id, type, reason, report_id) VALUES ($1, 'warning', 'Misuse of reports', $2)")
            .bind(a.user_id)
            .bind(linked_report)
            .execute(db)
            .await
            .unwrap();
        // A ban list entry stays whatever its age.
        sqlx::query("INSERT INTO banned_identities (kind, value_hash, created_at) VALUES ('email', '\\x01', now() - interval '5 years')")
            .execute(db)
            .await
            .unwrap();

        run_cleanup(&app).await;

        assert_eq!(count(&app, "SELECT count(*) FROM profile_views").await, 1);
        assert_eq!(count(&app, "SELECT count(*) FROM notifications").await, 1);
        assert_eq!(
            count(&app, "SELECT count(*) FROM match_recommendations").await,
            1
        );
        assert_eq!(count(&app, "SELECT count(*) FROM usage_counters").await, 1);
        assert_eq!(count(&app, "SELECT count(*) FROM passes").await, 1);
        assert_eq!(
            count(&app, "SELECT count(*) FROM jobs WHERE kind = 'send_push'").await,
            2,
            "the 8 day old succeeded job and the 31 day old dead job go"
        );
        assert_eq!(count(&app, "SELECT count(*) FROM webhook_events").await, 1);
        assert_eq!(count(&app, "SELECT count(*) FROM user_devices").await, 1);
        assert_eq!(count(&app, "SELECT count(*) FROM messages").await, 1);
        let kept: Uuid = sqlx::query_scalar("SELECT connection_id FROM messages")
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(kept, recent_connection);

        let statuses: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT status, file_key FROM data_exports ORDER BY status")
                .fetch_all(app.db())
                .await
                .unwrap();
        assert_eq!(
            statuses,
            vec![
                ("expired".to_owned(), None),
                ("ready".to_owned(), Some("exports/new.json".to_owned()))
            ]
        );
        let deletions = app.queued_jobs("delete_objects").await;
        assert_eq!(
            deletions,
            vec![serde_json::json!({ "keys": ["exports/old.json"] })]
        );

        // 2 years after the purge.
        assert_eq!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM user_consents WHERE user_id = '{}'",
                    old.user_id
                )
            )
            .await,
            0
        );
        assert!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM user_consents WHERE user_id = '{}'",
                    recent.user_id
                )
            )
            .await
                > 0
        );
        assert_eq!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM sanctions WHERE user_id = '{}'",
                    old.user_id
                )
            )
            .await,
            0
        );
        assert_eq!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM sanctions WHERE user_id = '{}'",
                    recent.user_id
                )
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM reports WHERE target_profile_id = '{}'",
                    old.profile_id
                )
            )
            .await,
            1,
            "only the report that a sanction still links to stays"
        );
        assert_eq!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM reports WHERE target_profile_id = '{}'",
                    recent.profile_id
                )
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM admin_audit_log WHERE target_id IN ('{}', '{}')",
                    old.user_id, old.profile_id
                )
            )
            .await,
            0
        );
        assert_eq!(
            count(
                &app,
                &format!(
                    "SELECT count(*) FROM admin_audit_log WHERE target_id IN ('{}', '{}')",
                    recent.user_id, recent.profile_id
                )
            )
            .await,
            2
        );
        assert_eq!(
            count(&app, "SELECT count(*) FROM banned_identities").await,
            1
        );
    }
}
