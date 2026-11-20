//! The `announcement_fanout` job (19 section 2.18, 14 section 2 row 31): one `announcement`
//! notification for every `active` user whose profile is `active` or `paused`, in batches of 500
//! in user id order.
//!
//! Each batch is one transaction: the notifications, a `send_push` job per user, a `send_email`
//! job (priority 6, the lowest) per user who allows announcement emails, and the job for the
//! next batch. A user who already has the announcement is skipped, so a retry never doubles it.

use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::db::counters;
use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue, payload};
use crate::realtime::hub::{Realtime, ServerEvent};
use crate::state::AppState;

/// Users per batch (19 section 2.18). Tests use a tiny batch to exercise the continuation.
#[cfg(not(test))]
const BATCH: i64 = 500;
#[cfg(test)]
const BATCH: i64 = 2;

/// Email priority of an announcement (14 section 5.2).
const EMAIL_PRIORITY: i16 = 6;

/// The `data` of the `announcement` notification (14 section 3).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, serde::Serialize)]
struct Announcement {
    text_en: String,
    text_ur: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Payload {
    announcement: Announcement,
    after_user_id: Option<Uuid>,
    #[serde(default)]
    send_email: bool,
}

#[allow(clippy::too_many_lines)] // One transaction per batch, in the order of 19 section 2.18.
pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    let data = serde_json::to_value(&payload.announcement)?;

    let mut tx = state.db.begin().await?;
    let batch: Vec<(Uuid, Uuid, bool)> = sqlx::query_as(
        "SELECT u.id, p.id, COALESCE(np.email_announcements, true)
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.status = 'active' AND p.status IN ('active', 'paused')
           AND ($1::uuid IS NULL OR u.id > $1)
         ORDER BY u.id LIMIT $2",
    )
    .bind(payload.after_user_id)
    .bind(BATCH)
    .fetch_all(&mut *tx)
    .await?;
    let Some(last) = batch.last().map(|(user_id, _, _)| *user_id) else {
        return Ok(JobOutcome::Done);
    };
    let user_ids: Vec<Uuid> = batch.iter().map(|(user_id, _, _)| *user_id).collect();

    // Step 2: one multi-row insert. Users who already have this announcement are left out.
    let created: Vec<(Uuid, Uuid, OffsetDateTime)> = sqlx::query_as(
        "INSERT INTO notifications (id, user_id, type, data)
         SELECT uuidv7(), t.user_id, 'announcement', $2::jsonb
         FROM unnest($1::uuid[]) AS t(user_id)
         WHERE NOT EXISTS (SELECT 1 FROM notifications n
                            WHERE n.user_id = t.user_id AND n.type = 'announcement' AND n.data = $2::jsonb)
         RETURNING id, user_id, created_at",
    )
    .bind(&user_ids)
    .bind(&data)
    .fetch_all(&mut *tx)
    .await?;

    // One push per user, and (when asked) one email per user who allows it.
    let (push_users, push_notifications): (Vec<Uuid>, Vec<Uuid>) = created
        .iter()
        .map(|(id, user_id, _)| (*user_id, *id))
        .unzip();
    sqlx::query(
        "INSERT INTO jobs (id, kind, payload, max_attempts)
         SELECT uuidv7(), 'send_push',
                jsonb_build_object('user_id', t.user_id, 'type', 'announcement',
                                   'data', jsonb_build_object('notification_id', t.notification_id),
                                   'collapse_key', 'announcement', 'ttl_seconds', 86400),
                4
         FROM unnest($1::uuid[], $2::uuid[]) AS t(user_id, notification_id)",
    )
    .bind(&push_users)
    .bind(&push_notifications)
    .execute(&mut *tx)
    .await?;
    if payload.send_email {
        let wants_email: Vec<Uuid> = batch
            .iter()
            .filter(|(_, _, allowed)| *allowed)
            .map(|(user_id, _, _)| *user_id)
            .collect();
        sqlx::query(
            "INSERT INTO jobs (id, kind, payload, max_attempts, dedupe_key)
             SELECT uuidv7(), 'send_email',
                    jsonb_build_object('user_id', t.user_id, 'template', 'announcement',
                                       'priority', $3::int, 'data', $4::jsonb),
                    5, 'announcement:' || t.notification_id::text
             FROM unnest($1::uuid[], $2::uuid[]) AS t(user_id, notification_id)
             WHERE t.user_id = ANY($5::uuid[])",
        )
        .bind(&push_users)
        .bind(&push_notifications)
        .bind(i32::from(EMAIL_PRIORITY))
        .bind(&data)
        .bind(&wants_email)
        .execute(&mut *tx)
        .await?;
    }

    // Step 4: a full batch means more users are waiting.
    if i64::try_from(batch.len()).is_ok_and(|count| count == BATCH) {
        enqueue(
            &mut *tx,
            NewJob::new(
                "announcement_fanout",
                json!({
                    "announcement": data,
                    "after_user_id": last,
                    "send_email": payload.send_email,
                }),
            ),
        )
        .await?;
    }
    tx.commit().await?;

    // Realtime: `notification.new` for the members who are online, and fresh counters.
    for (notification_id, user_id, created_at) in &created {
        let Some((_, profile_id, _)) = batch.iter().find(|(id, _, _)| id == user_id) else {
            continue;
        };
        if !state.hub.is_online(*profile_id) {
            continue;
        }
        state.hub.send_to_profile(
            *profile_id,
            &ServerEvent::new(
                "notification.new",
                json!({
                    "notification": {
                        "id": notification_id,
                        "type": "announcement",
                        "actor": Value::Null,
                        "data": data,
                        "is_read": false,
                        "created_at": created_at.format(&Rfc3339).unwrap_or_default(),
                    }
                }),
            ),
        );
        counters::push(state, *profile_id).await;
    }
    state.jobs.wake();
    tracing::info!(
        event = "announcement.batch",
        users = created.len(),
        "announcement batch sent"
    );
    Ok(JobOutcome::Done)
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;

    use crate::domain::options::Gender;
    use crate::domain::types::{ProfileStatus, UserRole, UserStatus};
    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn reaches_every_active_member_once_and_emails_only_those_who_allow_it(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let active = app.member().await;
        let paused = app
            .member_with(|spec| spec.status = ProfileStatus::Paused)
            .await;
        let no_email = app.member_of(Gender::Female).await;
        let draft = app.draft_user().await;
        let suspended = app
            .member_with(|spec| spec.user_status = UserStatus::Suspended)
            .await;
        let closed = app
            .member_with(|spec| spec.status = ProfileStatus::Closed)
            .await;
        sqlx::query(
            "UPDATE notification_preferences SET email_announcements = false WHERE user_id = $1",
        )
        .bind(no_email.user_id)
        .execute(app.db())
        .await
        .unwrap();

        let response = app
            .post(
                "/v1/admin/announcements",
                Some(&admin.token),
                json!({ "text_en": "Eid Mubarak from the team", "url": "https://example.com/eid" }),
            )
            .await;
        assert_eq!(response.status, StatusCode::ACCEPTED, "{}", response.text);
        // The admin, the active, paused and no-email members.
        assert_eq!(response.json["recipients_estimate"], 4);
        assert_eq!(app.queued_jobs("announcement_fanout").await.len(), 1);
        app.drain_jobs().await;

        let recipients: Vec<uuid::Uuid> = sqlx::query_scalar(
            "SELECT user_id FROM notifications WHERE type = 'announcement' ORDER BY user_id",
        )
        .fetch_all(app.db())
        .await
        .unwrap();
        let mut expected = vec![
            admin.user_id,
            active.user_id,
            paused.user_id,
            no_email.user_id,
        ];
        expected.sort();
        assert_eq!(recipients, expected);
        for left_out in [&draft, &suspended, &closed] {
            assert!(!recipients.contains(&left_out.user_id));
        }
        let data: serde_json::Value =
            sqlx::query_scalar("SELECT data FROM notifications WHERE user_id = $1")
                .bind(active.user_id)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(
            data,
            json!({ "text_en": "Eid Mubarak from the team", "text_ur": null, "url": "https://example.com/eid" })
        );

        // A push for everyone, an email (priority 6) for everyone who allows it.
        let pushes: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = 'send_push' AND payload ->> 'type' = 'announcement'")
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(pushes, 4);
        let emailed: Vec<String> = sqlx::query_scalar(
            "SELECT payload ->> 'user_id' FROM jobs
             WHERE kind = 'send_email' AND payload ->> 'template' = 'announcement'
               AND (payload ->> 'priority')::int = 6",
        )
        .fetch_all(app.db())
        .await
        .unwrap();
        assert_eq!(emailed.len(), 3);
        assert!(!emailed.contains(&no_email.user_id.to_string()));

        // The feed shows it to the member.
        let feed = app.get("/v1/me", Some(&active.token)).await;
        assert_eq!(feed.json["counters"]["unread_notifications"], 1);
    }

    #[sqlx::test]
    async fn batches_continue_by_user_id_and_a_rerun_adds_nothing(db: PgPool) {
        let app = TestApp::new(db).await;
        // Five members with a batch size of two: three batches.
        for _ in 0..5 {
            app.member().await;
        }
        let payload = json!({
            "announcement": { "text_en": "Hello", "text_ur": null, "url": null },
            "after_user_id": null,
            "send_email": false,
        });
        for _ in 0..2 {
            sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('announcement_fanout', $1)")
                .bind(&payload)
                .execute(app.db())
                .await
                .unwrap();
            app.drain_jobs().await;
        }
        let notified: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT user_id) FROM notifications WHERE type = 'announcement'",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        let rows: i64 =
            sqlx::query_scalar("SELECT count(*) FROM notifications WHERE type = 'announcement'")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(
            (notified, rows),
            (5, 5),
            "one notification per member, even after a re-run"
        );
        let pushes: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = 'send_push'")
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(pushes, 5);
        let emails: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = 'send_email'")
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(emails, 0, "send_email was false");
    }
}
