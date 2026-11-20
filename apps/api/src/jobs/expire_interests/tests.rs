//! Tests of both forms of the `expire_interests` job (19 section 2.8).

use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{remind, run};
use crate::domain::options::Gender;
use crate::domain::time::karachi_day_start;
use crate::jobs::{ClaimedJob, JobOutcome};
use crate::test_support::TestApp;
use crate::views::testing::interest;

fn job(payload: Value) -> ClaimedJob {
    ClaimedJob {
        id: Uuid::now_v7(),
        kind: "expire_interests".to_owned(),
        payload,
        attempts: 1,
        max_attempts: 3,
    }
}

async fn status(app: &TestApp, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM interests WHERE id = $1")
        .bind(id)
        .fetch_one(app.db())
        .await
        .unwrap()
}

async fn set_expiry(app: &TestApp, id: Uuid, at: OffsetDateTime) {
    sqlx::query("UPDATE interests SET expires_at = $2 WHERE id = $1")
        .bind(id)
        .bind(at)
        .execute(app.db())
        .await
        .unwrap();
}

#[sqlx::test]
async fn due_interests_expire_quietly(db: PgPool) {
    let app = TestApp::new(db).await;
    let man = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let other = app.member_of(Gender::Female).await;
    let due = interest(&app, man.profile_id, woman.profile_id, "pending", 0).await;
    let later = interest(&app, man.profile_id, other.profile_id, "pending", 0).await;
    let now = OffsetDateTime::now_utc();
    set_expiry(&app, due, now - Duration::minutes(1)).await;
    let mut her_socket = app.state.hub.register(woman.profile_id, woman.user_id);

    assert_eq!(
        run(&app.state, &job(json!({}))).await.unwrap(),
        JobOutcome::Done
    );
    assert_eq!(status(&app, due).await, "expired");
    assert_eq!(status(&app, later).await, "pending");
    // The expiry time is kept, so the 30-day cooldown counts from it.
    let expires_at: OffsetDateTime =
        sqlx::query_scalar("SELECT expires_at FROM interests WHERE id = $1")
            .bind(due)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!((expires_at - (now - Duration::minutes(1))).abs() < Duration::seconds(1));
    // No notification, only fresh counters for the online receiver.
    let notifications: i64 = sqlx::query_scalar("SELECT count(*) FROM notifications")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(notifications, 0);
    let frame: Value = serde_json::from_str(&her_socket.receiver.try_recv().unwrap()).unwrap();
    assert_eq!(frame["type"], "counters");
    assert_eq!(frame["data"]["pending_interests"], 0);

    // Running again changes nothing.
    assert_eq!(
        run(&app.state, &job(json!({}))).await.unwrap(),
        JobOutcome::Done
    );
    assert_eq!(status(&app, later).await, "pending");
}

#[sqlx::test]
async fn receivers_are_reminded_once_three_days_before_expiry(db: PgPool) {
    let app = TestApp::new(db).await;
    let first = app.member().await;
    let second = app.member().await;
    let third = app.member().await;
    let woman = app.member_of(Gender::Female).await;
    let now = OffsetDateTime::now_utc();
    let in_three_days = karachi_day_start(now) + Duration::days(3);

    let earliest = interest(&app, first.profile_id, woman.profile_id, "pending", 0).await;
    let next = interest(&app, second.profile_id, woman.profile_id, "pending", 0).await;
    let not_yet = interest(&app, third.profile_id, woman.profile_id, "pending", 0).await;
    set_expiry(&app, earliest, in_three_days + Duration::hours(1)).await;
    set_expiry(&app, next, in_three_days + Duration::hours(20)).await;
    set_expiry(&app, not_yet, in_three_days + Duration::days(1)).await;

    assert_eq!(remind(&app.state, now).await.unwrap(), JobOutcome::Done);
    let rows: Vec<(Option<Uuid>, Value)> = sqlx::query_as(
        "SELECT actor_profile_id, data FROM notifications
         WHERE user_id = $1 AND type = 'interest_received'",
    )
    .bind(woman.user_id)
    .fetch_all(app.db())
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, Some(first.profile_id));
    assert_eq!(
        rows[0].1,
        json!({ "interest_id": earliest, "reminder": true, "count": 2 })
    );
    let pushes = app.queued_jobs("send_push").await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0]["data"]["target"], "APP-INTERESTS");
    assert!(app.queued_jobs("send_email").await.is_empty(), "no email");

    // One reminder per receiver per day.
    let again = run(&app.state, &job(json!({ "remind": true })))
        .await
        .unwrap();
    assert_eq!(again, JobOutcome::Done);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM notifications WHERE user_id = $1")
        .bind(woman.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(count, 1);
}
