//! Scheduled work: one task that wakes every 30 seconds, enqueues each due entry once per
//! period, and recovers stuck jobs every minute (19 sections 1.6 and 3).

use std::time::Duration;

use serde_json::{Value, json};
use sqlx::PgPool;
use time::{OffsetDateTime, Time, Weekday};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::domain::time::KARACHI;
use crate::jobs::kind_spec;

const TICK: Duration = Duration::from_secs(30);

/// When an entry is due.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Schedule {
    EveryMinutes(i64),
    /// Daily at this `Asia/Karachi` time.
    Daily(u8, u8),
    /// Weekly on this day at this `Asia/Karachi` time.
    Weekly(Weekday, u8, u8),
}

/// One row of the schedule (19 section 3.3).
#[derive(Debug, Clone)]
pub struct Entry {
    pub name: &'static str,
    pub kind: &'static str,
    pub payload: fn() -> Value,
    pub schedule: Schedule,
}

/// The schedule of 19 section 3.3.
pub fn entries() -> Vec<Entry> {
    use Schedule::{Daily, EveryMinutes, Weekly};
    let empty: fn() -> Value = || json!({});
    vec![
        Entry {
            name: "expire_interests",
            kind: "expire_interests",
            payload: empty,
            schedule: EveryMinutes(15),
        },
        Entry {
            name: "lift_suspensions",
            kind: "lift_suspensions",
            payload: empty,
            schedule: EveryMinutes(15),
        },
        Entry {
            name: "interest_reminders",
            kind: "expire_interests",
            payload: || json!({ "remind": true }),
            schedule: Daily(10, 0),
        },
        Entry {
            name: "purge_accounts",
            kind: "purge_accounts",
            payload: empty,
            schedule: Daily(3, 0),
        },
        Entry {
            name: "purge_verification_media",
            kind: "purge_verification_media",
            payload: empty,
            schedule: Daily(3, 10),
        },
        Entry {
            name: "cleanup_uploads",
            kind: "cleanup_uploads",
            payload: empty,
            schedule: Daily(3, 20),
        },
        Entry {
            name: "cleanup_old_rows",
            kind: "cleanup_old_rows",
            payload: empty,
            schedule: Daily(3, 30),
        },
        Entry {
            name: "recommendations_fanout",
            kind: "refresh_recommendations",
            payload: || json!({ "fanout": true }),
            schedule: Daily(4, 0),
        },
        Entry {
            name: "match_digest_daily",
            kind: "match_digest",
            payload: || json!({ "frequency": "daily" }),
            schedule: Daily(9, 0),
        },
        Entry {
            name: "match_digest_weekly",
            kind: "match_digest",
            payload: || json!({ "frequency": "weekly" }),
            schedule: Weekly(Weekday::Sunday, 10, 0),
        },
        Entry {
            name: "saved_search_alerts",
            kind: "saved_search_alerts",
            payload: empty,
            schedule: Daily(18, 0),
        },
        Entry {
            name: "profile_views_summary",
            kind: "profile_views_summary",
            payload: empty,
            schedule: Daily(19, 0),
        },
    ]
}

/// The period key of an entry at `now`, or `None` when it is not due (19 section 3.2).
///
/// A daily or weekly entry is due from its time until the end of that `Asia/Karachi` day; an
/// interval entry during its whole period.
pub fn period_key(schedule: Schedule, now: OffsetDateTime) -> Option<String> {
    let local = now.to_offset(KARACHI);
    let at = |hour: u8, minute: u8| Time::from_hms(hour, minute, 0).unwrap_or(Time::MIDNIGHT);
    match schedule {
        Schedule::EveryMinutes(minutes) => {
            let unix_minutes = now.unix_timestamp().div_euclid(60);
            Some(unix_minutes.div_euclid(minutes).to_string())
        }
        Schedule::Daily(hour, minute) => {
            (local.time() >= at(hour, minute)).then(|| local.date().to_string())
        }
        Schedule::Weekly(day, hour, minute) => {
            if local.weekday() == day && local.time() >= at(hour, minute) {
                let (year, week, _) = local.date().to_iso_week_date();
                Some(format!("{year}-W{week:02}"))
            } else {
                None
            }
        }
    }
}

/// Enqueues every due entry whose period has not produced a job yet. Returns how many were
/// enqueued.
pub async fn tick(db: &PgPool, now: OffsetDateTime) -> sqlx::Result<usize> {
    let mut enqueued = 0;
    for entry in entries() {
        let Some(period) = period_key(entry.schedule, now) else {
            continue;
        };
        let dedupe_key = format!("{}:{period}", entry.name);
        let max_attempts = kind_spec(entry.kind).map_or(3, |spec| spec.max_attempts);
        let inserted = sqlx::query(
            "INSERT INTO jobs (id, kind, payload, dedupe_key, max_attempts)
             SELECT $1, $2, $3, $4, $5
             WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind = $2 AND dedupe_key = $4)
             ON CONFLICT (kind, dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL
             DO NOTHING",
        )
        .bind(Uuid::now_v7())
        .bind(entry.kind)
        .bind((entry.payload)())
        .bind(&dedupe_key)
        .bind(max_attempts)
        .execute(db)
        .await?
        .rows_affected();
        enqueued += usize::try_from(inserted).unwrap_or(0);
    }
    Ok(enqueued)
}

/// Puts jobs left `running` by a stopped worker back in the queue (19 section 1.6).
pub async fn recover_stuck(db: &PgPool) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        "UPDATE jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
             finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
             locked_at = NULL,
             last_error = 'recovered: worker stopped'
         WHERE status = 'running' AND locked_at < now() - interval '10 minutes'",
    )
    .execute(db)
    .await?
    .rows_affected())
}

/// Starts the scheduler task.
pub fn spawn(
    db: PgPool,
    wake: impl Fn() + Send + 'static,
    shutdown: &watch::Receiver<bool>,
) -> JoinHandle<()> {
    let mut shutdown = shutdown.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(TICK);
        let mut last_recovery: Option<std::time::Instant> = None;
        loop {
            tokio::select! {
                _ = interval.tick() => {}
                _ = shutdown.changed() => {}
            }
            if *shutdown.borrow() {
                break;
            }
            match tick(&db, OffsetDateTime::now_utc()).await {
                Ok(0) => {}
                Ok(_) => wake(),
                Err(error) => tracing::warn!(%error, "scheduler tick failed"),
            }
            if last_recovery.is_none_or(|at| at.elapsed() >= Duration::from_secs(60)) {
                last_recovery = Some(std::time::Instant::now());
                match recover_stuck(&db).await {
                    Ok(0) => {}
                    Ok(count) => tracing::warn!(count, "recovered stuck jobs"),
                    Err(error) => tracing::warn!(%error, "stuck job recovery failed"),
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    #[test]
    fn daily_entries_are_due_from_their_time_until_midnight_karachi() {
        let schedule = Schedule::Daily(3, 30);
        // 03:29 Karachi is 22:29 UTC the day before.
        assert_eq!(period_key(schedule, datetime!(2026-11-19 22:29 UTC)), None);
        assert_eq!(
            period_key(schedule, datetime!(2026-11-19 22:30 UTC)).as_deref(),
            Some("2026-11-20")
        );
        assert_eq!(
            period_key(schedule, datetime!(2026-11-20 18:59 UTC)).as_deref(),
            Some("2026-11-20")
        );
        // After midnight Karachi a new day starts and it is not yet 03:30.
        assert_eq!(period_key(schedule, datetime!(2026-11-20 19:00 UTC)), None);
    }

    #[test]
    fn weekly_entries_use_the_iso_week() {
        let schedule = Schedule::Weekly(Weekday::Sunday, 10, 0);
        // Sunday 22 November 2026, 10:00 Karachi = 05:00 UTC.
        assert_eq!(
            period_key(schedule, datetime!(2026-11-22 05:00 UTC)).as_deref(),
            Some("2026-W47")
        );
        assert_eq!(period_key(schedule, datetime!(2026-11-21 05:00 UTC)), None);
    }

    #[test]
    fn interval_entries_use_floored_minutes() {
        let schedule = Schedule::EveryMinutes(15);
        let a = period_key(schedule, datetime!(2026-11-20 10:00 UTC)).unwrap();
        let b = period_key(schedule, datetime!(2026-11-20 10:14 UTC)).unwrap();
        let c = period_key(schedule, datetime!(2026-11-20 10:15 UTC)).unwrap();
        assert_eq!(a, b);
        assert_ne!(b, c);
    }

    #[sqlx::test]
    async fn one_job_per_period_even_after_it_finished(db: PgPool) {
        let now = datetime!(2026-11-20 05:00 UTC); // 10:00 Karachi
        let first = tick(&db, now).await.unwrap();
        assert!(first >= 3, "interval entries and the dailies already due");
        assert_eq!(tick(&db, now).await.unwrap(), 0);

        sqlx::query("UPDATE jobs SET status = 'succeeded', finished_at = now()")
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(
            tick(&db, now).await.unwrap(),
            0,
            "finished jobs still count"
        );
    }

    #[sqlx::test]
    async fn stuck_jobs_are_recovered(db: PgPool) {
        sqlx::query(
            "INSERT INTO jobs (kind, status, attempts, max_attempts, locked_at)
             VALUES ('cleanup_uploads', 'running', 1, 3, now() - interval '11 minutes'),
                    ('cleanup_uploads', 'running', 3, 3, now() - interval '11 minutes'),
                    ('cleanup_uploads', 'running', 1, 3, now() - interval '1 minute')",
        )
        .execute(&db)
        .await
        .unwrap();
        assert_eq!(recover_stuck(&db).await.unwrap(), 2);
        let statuses: Vec<(i16, Option<String>, String)> = sqlx::query_as(
            "SELECT attempts, last_error, status FROM jobs ORDER BY attempts, status",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        let recovered = Some("recovered: worker stopped".to_owned());
        assert_eq!(
            statuses,
            vec![
                (1, recovered.clone(), "queued".to_owned()),
                (1, None, "running".to_owned()),
                (3, recovered, "dead".to_owned()),
            ]
        );
    }
}
