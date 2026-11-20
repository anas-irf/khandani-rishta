//! The `send_email` job (19 section 2.7, 14 section 5), the `match_digest` job (19 section 2.15)
//! and the `profile_views_summary` job (19 section 2.17).

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{World, add_interest, block, connect, emails_for, feed, set_flag};
use crate::domain::options::Gender;
use crate::domain::types::UserStatus;
use crate::jobs::send_email::{self, Ceilings};
use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue, worker};
use crate::notify::{queue_email, queue_unread_email};
use crate::services::ServiceError;
use crate::services::resend::{DisabledEmail, EmailSender, OutgoingEmail};
use crate::test_support::TestUser;

/// `(status, last_error, run_at, attempts, payload)` of the newest `send_email` job.
async fn last_email_job(w: &World) -> (String, Option<String>, OffsetDateTime, i16, Value) {
    sqlx::query_as(
        "SELECT status, last_error, run_at, attempts, payload FROM jobs
         WHERE kind = 'send_email' ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .fetch_one(w.app.db())
    .await
    .expect("an email job exists")
}

async fn queue(w: &World, user: &TestUser, template: &'static str, data: Value) {
    queue_email(w.app.db(), user.user_id, template, data, None)
        .await
        .expect("the job is queued");
}

/// A `send_email` job with an explicit priority, whatever the template says.
async fn queue_with_priority(w: &World, user: &TestUser, template: &str, priority: i16) {
    sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('send_email', $1)")
        .bind(json!({
            "user_id": user.user_id,
            "template": template,
            "priority": priority,
            "data": { "text_en": "News" },
        }))
        .execute(w.app.db())
        .await
        .expect("the job inserts");
}

/// `count` emails already sent today (succeeded without a note), for the daily budget.
async fn seed_sent(w: &World, count: i32) {
    sqlx::query(
        "INSERT INTO jobs (kind, status, finished_at, payload)
         SELECT 'send_email', 'succeeded', now(), '{}'::jsonb FROM generate_series(1, $1)",
    )
    .bind(count)
    .execute(w.app.db())
    .await
    .expect("the rows insert");
}

fn sent_count(w: &World) -> usize {
    w.app.email.sent.lock().unwrap().len()
}

fn clear_sent(w: &World) {
    w.app.email.sent.lock().unwrap().clear();
}

async fn email_of(w: &World, user: &TestUser) -> String {
    sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user.user_id)
        .fetch_one(w.app.db())
        .await
        .unwrap()
}

#[sqlx::test]
async fn an_email_is_rendered_and_sent_with_the_job_id_as_idempotency_key(db: PgPool) {
    let w = World::new(db).await;
    queue(
        &w,
        &w.him,
        "account_warning",
        json!({ "reason": "Please <b>be</b> respectful & kind" }),
    )
    .await;
    w.app.drain_jobs().await;

    let sent = w.app.email.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    let email = &sent[0];
    assert_eq!(email.to, email_of(&w, &w.him).await);
    assert_eq!(email.subject, "A notice about your Khandani Rishta account");
    assert_eq!(
        email.reply_to.as_deref(),
        Some("support@khandanirishta.app")
    );
    assert!(email.text.contains("Please <b>be</b> respectful & kind"));
    assert!(
        email
            .html
            .contains("Please &lt;b&gt;be&lt;/b&gt; respectful &amp; kind")
    );
    assert!(!email.html.contains("<b>be</b>"));
    assert!(
        email
            .text
            .contains("http://localhost:3000/community-guidelines")
    );
    let job_id: Uuid = sqlx::query_scalar("SELECT id FROM jobs WHERE kind = 'send_email'")
        .fetch_one(w.app.db())
        .await
        .unwrap();
    assert_eq!(email.idempotency_key, job_id.to_string());
    let (status, error, ..) = last_email_job(&w).await;
    assert_eq!((status.as_str(), error), ("succeeded", None));
}

#[sqlx::test]
async fn account_emails_always_go_but_engagement_emails_need_an_active_user(db: PgPool) {
    let w = World::new(db).await;
    let suspended = w
        .app
        .member_with(|spec| spec.user_status = UserStatus::Suspended)
        .await;
    let leaving = w
        .app
        .member_with(|spec| spec.user_status = UserStatus::DeletionScheduled)
        .await;
    queue(
        &w,
        &suspended,
        "account_suspended",
        json!({ "form": "suspended", "reason": "Rude messages" }),
    )
    .await;
    queue(
        &w,
        &leaving,
        "account_deletion",
        json!({ "form": "scheduled", "purge_after": "2026-12-20T10:00:00Z" }),
    )
    .await;
    queue(&w, &suspended, "announcement", json!({ "text_en": "News" })).await;
    queue(&w, &leaving, "announcement", json!({ "text_en": "News" })).await;
    w.app.drain_jobs().await;

    let subjects: Vec<String> = w
        .app
        .email
        .sent
        .lock()
        .unwrap()
        .iter()
        .map(|e| e.subject.clone())
        .collect();
    assert_eq!(
        subjects,
        [
            "Your Khandani Rishta account has been suspended",
            "Your account will be deleted on 20 December 2026"
        ]
    );
    let notes: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT last_error FROM jobs WHERE payload->>'template' = 'announcement' ORDER BY id",
    )
    .fetch_all(w.app.db())
    .await
    .unwrap();
    let skipped = Some("skipped:user_not_active".to_owned());
    assert_eq!(notes, [skipped.clone(), skipped]);
}

#[sqlx::test]
async fn users_without_an_address_and_deleted_users_are_skipped(db: PgPool) {
    let w = World::new(db).await;
    let nameless = w.app.member().await;
    sqlx::query("UPDATE users SET email = NULL WHERE id = $1")
        .bind(nameless.user_id)
        .execute(w.app.db())
        .await
        .unwrap();
    let gone = w
        .app
        .member_with(|spec| spec.user_status = UserStatus::Deleted)
        .await;
    queue(&w, &nameless, "account_warning", json!({})).await;
    queue(&w, &gone, "account_warning", json!({})).await;
    w.app.drain_jobs().await;
    assert_eq!(sent_count(&w), 0);
    let notes: Vec<Option<String>> =
        sqlx::query_scalar("SELECT last_error FROM jobs WHERE kind = 'send_email' ORDER BY id")
            .fetch_all(w.app.db())
            .await
            .unwrap();
    assert_eq!(
        notes,
        [
            Some("skipped:no_email".to_owned()),
            Some("skipped:user_missing".to_owned())
        ]
    );
}

#[sqlx::test]
async fn without_a_resend_key_the_job_succeeds_without_sending(db: PgPool) {
    let w = World::new(db).await;
    let mut state = w.app.state.clone();
    state.email = Arc::new(DisabledEmail);
    queue(&w, &w.him, "account_warning", json!({})).await;
    worker::drain(&state).await.unwrap();
    assert_eq!(sent_count(&w), 0);
    let (status, error, ..) = last_email_job(&w).await;
    assert_eq!(status, "succeeded");
    assert_eq!(
        error.as_deref(),
        Some("skipped:email_disabled"),
        "not counted as sent"
    );
}

struct FailingEmail(Mutex<Option<ServiceError>>);

#[async_trait]
impl EmailSender for FailingEmail {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn send(&self, _: &OutgoingEmail) -> Result<(), ServiceError> {
        match self.0.lock().unwrap().as_ref() {
            Some(error) => Err(ServiceError::Temporary(error.to_string())),
            None => Ok(()),
        }
    }
}

#[sqlx::test]
async fn a_rate_limit_or_server_error_fails_the_attempt_for_a_retry(db: PgPool) {
    let w = World::new(db).await;
    let failing = Arc::new(FailingEmail(Mutex::new(Some(ServiceError::Temporary(
        "HTTP 429".to_owned(),
    )))));
    let mut state = w.app.state.clone();
    state.email = failing.clone();
    queue(&w, &w.him, "account_warning", json!({})).await;
    worker::drain(&state).await.unwrap();
    let (status, error, _, attempts, _) = last_email_job(&w).await;
    assert_eq!((status.as_str(), attempts), ("queued", 1));
    assert!(error.is_some_and(|e| e.contains("429")));
}

#[sqlx::test]
async fn the_daily_budget_follows_the_ceilings_of_each_priority(db: PgPool) {
    let w = World::new(db).await;
    // (priority, ceiling): below the ceiling an email goes; at the ceiling it does not.
    for (priority, ceiling) in [(1_i16, 95), (2, 85), (3, 70), (4, 55), (5, 45), (6, 25)] {
        sqlx::query("DELETE FROM jobs")
            .execute(w.app.db())
            .await
            .unwrap();
        clear_sent(&w);
        seed_sent(&w, ceiling - 1).await;
        queue_with_priority(&w, &w.him, "announcement", priority).await;
        queue_with_priority(&w, &w.him, "announcement", priority).await;
        w.app.drain_jobs().await;
        assert_eq!(sent_count(&w), 1, "priority {priority}: the one that fits");

        let (status, error, run_at, attempts, payload) = last_email_job(&w).await;
        if priority >= 3 {
            // Dropped: finished as succeeded with a note, so that it is not counted as sent.
            assert_eq!(status, "succeeded", "priority {priority}");
            assert_eq!(
                error.as_deref(),
                Some("skipped:budget"),
                "priority {priority}"
            );
        } else {
            // Priorities 1 and 2 are rescheduled to the next UTC midnight plus 0 to 30 minutes.
            assert_eq!(
                (status.as_str(), attempts),
                ("queued", 0),
                "priority {priority}"
            );
            let midnight = (OffsetDateTime::now_utc().date() + Duration::days(1))
                .midnight()
                .assume_utc();
            assert!(
                run_at >= midnight && run_at < midnight + Duration::minutes(30),
                "priority {priority}: {run_at}"
            );
            assert_eq!(
                payload.get("budget_deferred").is_some(),
                priority == 2,
                "priority {priority}"
            );
        }
    }
}

#[sqlx::test]
async fn welcome_and_accepted_interest_emails_are_deferred_once_and_then_dropped(db: PgPool) {
    let w = World::new(db).await;
    seed_sent(&w, 85).await;
    queue(&w, &w.him, "welcome", json!({})).await;
    w.app.drain_jobs().await;
    assert_eq!(sent_count(&w), 0);
    let (status, _, run_at, attempts, payload) = last_email_job(&w).await;
    assert_eq!((status.as_str(), attempts), ("queued", 0));
    assert_eq!(payload["budget_deferred"], true);
    assert!(run_at > OffsetDateTime::now_utc());

    // The next day it is over the ceiling again: dropped, not deferred a second time.
    sqlx::query("UPDATE jobs SET run_at = now() WHERE status = 'queued'")
        .execute(w.app.db())
        .await
        .unwrap();
    w.app.drain_jobs().await;
    assert_eq!(sent_count(&w), 0);
    let (status, error, ..) = last_email_job(&w).await;
    assert_eq!(status, "succeeded");
    assert_eq!(error.as_deref(), Some("skipped:budget"));
}

#[sqlx::test]
async fn account_emails_wait_for_the_next_day_however_often_they_are_over(db: PgPool) {
    let w = World::new(db).await;
    seed_sent(&w, 95).await;
    queue(&w, &w.him, "account_suspended", json!({ "form": "banned" })).await;
    for _ in 0..2 {
        w.app.drain_jobs().await;
        let (status, _, _, attempts, _) = last_email_job(&w).await;
        assert_eq!((status.as_str(), attempts), ("queued", 0));
        sqlx::query("UPDATE jobs SET run_at = now() WHERE status = 'queued'")
            .execute(w.app.db())
            .await
            .unwrap();
    }
    assert_eq!(sent_count(&w), 0);
    // Yesterday's emails and skipped jobs do not count: with a free budget it goes.
    sqlx::query(
        "UPDATE jobs SET finished_at = now() - interval '2 days' WHERE status = 'succeeded'",
    )
    .execute(w.app.db())
    .await
    .unwrap();
    w.app.drain_jobs().await;
    assert_eq!(sent_count(&w), 1);
}

#[sqlx::test]
async fn with_a_budget_of_two_the_third_low_priority_email_is_dropped_and_a_high_one_sends(
    db: PgPool,
) {
    let w = World::new(db).await;
    // The roadmap check of T-503: a small budget, set through the ceilings of the job.
    let ceilings = Ceilings::new([95, 4, 3, 2, 2, 2]);
    let third = w.app.member().await;
    let users = [&w.him, &w.her, &third];
    let mut outcomes = Vec::new();
    for (index, user) in users.iter().enumerate() {
        queue_with_priority(&w, user, "announcement", 6).await;
        let job = worker::claim(w.app.db()).await.unwrap().expect("a job");
        let outcome = send_email::run_with(&w.app.state, &job, ceilings)
            .await
            .unwrap();
        if outcome == JobOutcome::Done {
            sqlx::query("UPDATE jobs SET status = 'succeeded', finished_at = now(), last_error = NULL WHERE id = $1")
                .bind(job.id)
                .execute(w.app.db())
                .await
                .unwrap();
        }
        outcomes.push((index, outcome));
    }
    assert_eq!(
        outcomes,
        [
            (0, JobOutcome::Done),
            (1, JobOutcome::Done),
            (2, JobOutcome::Skipped("budget".to_owned()))
        ]
    );
    assert_eq!(sent_count(&w), 2);

    // An account email (priority 1) still goes: its ceiling is higher.
    queue_with_priority(&w, &w.him, "account_warning", 1).await;
    let job = worker::claim(w.app.db()).await.unwrap().expect("a job");
    assert_eq!(
        send_email::run_with(&w.app.state, &job, ceilings)
            .await
            .unwrap(),
        JobOutcome::Done
    );
    assert_eq!(sent_count(&w), 3);
}

#[sqlx::test]
async fn the_interest_digest_counts_new_interests_the_member_can_still_open(db: PgPool) {
    let w = World::new(db).await;
    let second = w.app.member_of(Gender::Female).await;
    let blocked = w.app.member_of(Gender::Female).await;
    let old = w.app.member_of(Gender::Female).await;

    // Nothing pending: the digest is skipped.
    queue(&w, &w.him, "interest_digest", json!({})).await;
    w.app.drain_jobs().await;
    let (_, error, ..) = last_email_job(&w).await;
    assert_eq!(error.as_deref(), Some("skipped:no_interests"));

    add_interest(&w.app, &w.her, &w.him).await;
    add_interest(&w.app, &second, &w.him).await;
    add_interest(&w.app, &blocked, &w.him).await;
    let stale = add_interest(&w.app, &old, &w.him).await;
    sqlx::query("UPDATE interests SET created_at = now() - interval '25 hours' WHERE id = $1")
        .bind(stale)
        .execute(w.app.db())
        .await
        .unwrap();
    block(&w.app, &w.him, &blocked).await;

    queue(&w, &w.him, "interest_digest", json!({})).await;
    w.app.drain_jobs().await;
    let sent = w.app.email.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].subject, "You have 2 new interests");
    assert!(sent[0].text.contains("Ayesha M., 2"), "{}", sent[0].text);
    assert!(sent[0].text.contains("/interests"));
    assert!(sent[0].text.contains("Change email preferences"));
    assert!(
        !sent[0].text.contains("Malik"),
        "names follow name_display before a connection"
    );

    // email_interests off.
    set_flag(&w.app, w.him.user_id, "email_interests", false).await;
    queue(&w, &w.him, "interest_digest", json!({})).await;
    w.app.drain_jobs().await;
    let (_, error, ..) = last_email_job(&w).await;
    assert_eq!(error.as_deref(), Some("skipped:preference"));
}

#[sqlx::test]
async fn the_unread_email_follows_the_rules_of_14_section_5_4(db: PgPool) {
    let w = World::new(db).await;
    // email_messages is off by default.
    assert_eq!(
        run_unread_email(&w).await.as_deref(),
        Some("skipped:preference")
    );
    set_flag(&w.app, w.him.user_id, "email_messages", true).await;
    // No chat with unread messages.
    assert_eq!(
        run_unread_email(&w).await.as_deref(),
        Some("skipped:no_unread")
    );

    let (_, connection) = connect(&w.app, &w.her, &w.him).await;
    sqlx::query("UPDATE connection_members SET unread_count = 3 WHERE connection_id = $1 AND profile_id = $2")
        .bind(connection)
        .bind(w.him.profile_id)
        .execute(w.app.db())
        .await
        .unwrap();
    // He has been in the app since the job was created.
    queue_unread_email(w.app.db(), w.him.user_id).await.unwrap();
    sqlx::query("UPDATE jobs SET run_at = now() WHERE status = 'queued'")
        .execute(w.app.db())
        .await
        .unwrap();
    sqlx::query("UPDATE users SET last_seen_at = now() + interval '1 second' WHERE id = $1")
        .bind(w.him.user_id)
        .execute(w.app.db())
        .await
        .unwrap();
    w.app.drain_jobs().await;
    assert_eq!(last_email_job(&w).await.1.as_deref(), Some("skipped:seen"));
    sqlx::query("UPDATE users SET last_seen_at = NULL WHERE id = $1")
        .bind(w.him.user_id)
        .execute(w.app.db())
        .await
        .unwrap();

    // Otherwise it goes, with the number of chats and no names or content.
    assert_eq!(run_unread_email(&w).await, None);
    let sent = w.app.email.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].subject, "You have unread messages");
    assert!(sent[0].text.contains("unread messages in 1 chat."));
    assert!(!sent[0].text.contains("Ayesha"));

    // One in 24 hours: the next one is skipped.
    assert_eq!(
        run_unread_email(&w).await.as_deref(),
        Some("skipped:recent")
    );
    // Muted chats do not count.
    sqlx::query("UPDATE jobs SET finished_at = now() - interval '25 hours' WHERE last_error IS NULL AND status = 'succeeded'")
        .execute(w.app.db())
        .await
        .unwrap();
    sqlx::query("UPDATE connection_members SET is_muted = true WHERE connection_id = $1 AND profile_id = $2")
        .bind(connection)
        .bind(w.him.profile_id)
        .execute(w.app.db())
        .await
        .unwrap();
    assert_eq!(
        run_unread_email(&w).await.as_deref(),
        Some("skipped:no_unread")
    );
}

#[sqlx::test]
async fn welcome_is_sent_once_and_the_accepted_email_names_the_member(db: PgPool) {
    let w = World::new(db).await;
    queue(&w, &w.him, "welcome", json!({})).await;
    w.app.drain_jobs().await;
    assert_eq!(sent_count(&w), 1);
    assert_eq!(
        w.app.email.sent.lock().unwrap()[0].subject,
        "Your profile is live"
    );
    queue(&w, &w.him, "welcome", json!({})).await;
    w.app.drain_jobs().await;
    assert_eq!(
        sent_count(&w),
        1,
        "only when the profile becomes active for the first time"
    );
    assert_eq!(
        last_email_job(&w).await.1.as_deref(),
        Some("skipped:already_sent")
    );

    // `interest_accepted`: skipped when the member can no longer be opened.
    queue(
        &w,
        &w.him,
        "interest_accepted",
        json!({ "actor_profile_id": w.her.profile_id }),
    )
    .await;
    block(&w.app, &w.her, &w.him).await;
    w.app.drain_jobs().await;
    assert_eq!(
        last_email_job(&w).await.1.as_deref(),
        Some("skipped:actor_unavailable")
    );
}

/// Queues the unread email of 14 section 5.4 for him, makes it due, runs it and returns the
/// note of the job (`None` when the email was sent).
async fn run_unread_email(w: &World) -> Option<String> {
    queue_unread_email(w.app.db(), w.him.user_id).await.unwrap();
    sqlx::query("UPDATE jobs SET run_at = now() WHERE status = 'queued'")
        .execute(w.app.db())
        .await
        .unwrap();
    w.app.drain_jobs().await;
    last_email_job(w).await.1
}

/// Runs a `match_digest` job on its own, so that what it queued can be looked at before the
/// emails are sent.
async fn run_match_digest(w: &World, frequency: &str) {
    let job = ClaimedJob {
        id: Uuid::now_v7(),
        kind: "match_digest".to_owned(),
        payload: json!({ "frequency": frequency }),
        attempts: 1,
        max_attempts: 2,
    };
    let outcome = crate::jobs::match_digest::run(&w.app.state, &job)
        .await
        .unwrap();
    assert_eq!(outcome, JobOutcome::Done);
}

#[sqlx::test]
async fn a_match_digest_is_queued_for_each_member_who_chose_the_frequency(db: PgPool) {
    let w = World::new(db).await;
    // Five women are the candidates; three men have recommendations.
    let mut women = Vec::new();
    for _ in 0..5 {
        women.push(w.app.member_of(Gender::Female).await);
    }
    let daily = w.him.clone();
    let weekly = w.app.member().await;
    let too_few = w.app.member().await;
    set_flag_digest(&w, &daily, "daily").await;
    set_flag_digest(&w, &too_few, "daily").await;
    // The weekly member keeps the default (`weekly`).
    let ranks = [1.0_f32, 0.9, 0.8, 0.7, 0.6];
    let compats = [95_i16, 94, 93, 92, 91];
    for (index, woman) in women.iter().enumerate() {
        add_recommendation(&w, &daily, woman, compats[index], ranks[index], 0).await;
    }
    for woman in &women[..3] {
        add_recommendation(&w, &weekly, woman, 80, 0.5, 0).await;
    }
    for woman in &women[..2] {
        add_recommendation(&w, &too_few, woman, 80, 0.5, 0).await;
    }
    // Recommendations already shown do not count towards the three.
    add_recommendation(&w, &too_few, &women[2], 80, 0.5, 1).await;

    run_match_digest(&w, "daily").await;
    let queued = emails_for(&w.app, daily.user_id).await;
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0]["template"], "match_digest");
    assert_eq!(queued[0]["priority"], 5);
    let candidates = |email: &Value| -> Vec<String> {
        email["data"]["candidate_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap().to_owned())
            .collect()
    };
    let expected: Vec<String> = women.iter().map(|p| p.profile_id.to_string()).collect();
    assert_eq!(
        candidates(&queued[0]),
        expected,
        "the best five by rank_score, best first"
    );
    let dedupe: String = sqlx::query_scalar(
        "SELECT dedupe_key FROM jobs WHERE payload->>'template' = 'match_digest'",
    )
    .fetch_one(w.app.db())
    .await
    .unwrap();
    assert_eq!(dedupe, format!("match_digest:{}", daily.user_id));
    assert!(
        emails_for(&w.app, too_few.user_id).await.is_empty(),
        "fewer than 3 unseen"
    );
    assert!(
        emails_for(&w.app, weekly.user_id).await.is_empty(),
        "weekly is another run"
    );

    // Running the same period again queues nothing, even after the first email went out.
    sqlx::query(
        "UPDATE jobs SET status = 'succeeded', finished_at = now() WHERE kind = 'send_email'",
    )
    .execute(w.app.db())
    .await
    .unwrap();
    run_match_digest(&w, "daily").await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = 'send_email'")
        .fetch_one(w.app.db())
        .await
        .unwrap();
    assert_eq!(count, 1);

    // The weekly run is for the weekly member alone, with the three matches it has.
    run_match_digest(&w, "weekly").await;
    let weekly_emails = emails_for(&w.app, weekly.user_id).await;
    assert_eq!(weekly_emails.len(), 1);
    assert_eq!(candidates(&weekly_emails[0]).len(), 3);

    // Names and match percentages are rendered at send time, and a candidate who can no longer
    // be opened is left out.
    block(&w.app, &daily, &women[0]).await;
    sqlx::query("DELETE FROM jobs WHERE kind = 'send_email' AND status = 'succeeded'")
        .execute(w.app.db())
        .await
        .unwrap();
    run_match_digest(&w, "daily").await;
    w.app.drain_jobs().await;
    let to_daily = email_of(&w, &daily).await;
    let sent = w.app.email.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 2, "the daily and the weekly member");
    let digest = sent
        .iter()
        .find(|e| e.to == to_daily)
        .expect("the daily member's email");
    assert_eq!(digest.subject, "New matches for you");
    assert_eq!(digest.text.matches("% match").count(), 4);
    assert!(digest.text.contains("(94% match)"));
    assert!(!digest.text.contains("(95% match)"));
    assert!(digest.text.contains("/matches"));
    assert!(digest.text.contains("Change email preferences"));
}

async fn set_flag_digest(w: &World, user: &TestUser, value: &str) {
    sqlx::query("UPDATE notification_preferences SET email_match_digest = $2 WHERE user_id = $1")
        .bind(user.user_id)
        .bind(value)
        .execute(w.app.db())
        .await
        .unwrap();
}

async fn add_recommendation(
    w: &World,
    member: &TestUser,
    candidate: &TestUser,
    compat: i16,
    rank: f32,
    shown: i16,
) {
    sqlx::query(
        "INSERT INTO match_recommendations (profile_id, candidate_profile_id, compat, rank_score, shown_count)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(member.profile_id)
    .bind(candidate.profile_id)
    .bind(compat)
    .bind(rank)
    .bind(shown)
    .execute(w.app.db())
    .await
    .expect("the recommendation inserts");
}

async fn add_view(w: &World, visitor: &TestUser, host: &TestUser, hours_ago: i32, private: bool) {
    sqlx::query(
        "INSERT INTO profile_views (viewer_profile_id, viewed_profile_id, viewed_on, is_private, last_viewed_at)
         VALUES ($1, $2, CURRENT_DATE, $3, now() - make_interval(hours => $4))",
    )
    .bind(visitor.profile_id)
    .bind(host.profile_id)
    .bind(private)
    .bind(hours_ago)
    .execute(w.app.db())
    .await
    .expect("the view inserts");
}

#[sqlx::test]
async fn the_views_summary_counts_distinct_visible_viewers_once_a_day(db: PgPool) {
    let w = World::new(db).await;
    let second = w.app.member_of(Gender::Female).await;
    let private = w.app.member_of(Gender::Female).await;
    let old = w.app.member_of(Gender::Female).await;
    let blocked = w.app.member_of(Gender::Female).await;
    add_view(&w, &w.her, &w.him, 1, false).await;
    add_view(&w, &second, &w.him, 3, false).await;
    add_view(&w, &private, &w.him, 1, true).await;
    add_view(&w, &old, &w.him, 30, false).await;
    add_view(&w, &blocked, &w.him, 1, false).await;
    block(&w.app, &w.him, &blocked).await;
    // A member who browses privately sees no visitors, so gets no summary either; the same for
    // a member whose only viewer is private.
    let browsing = w.app.member().await;
    sqlx::query("UPDATE profile_privacy SET record_my_visits = false WHERE profile_id = $1")
        .bind(browsing.profile_id)
        .execute(w.app.db())
        .await
        .unwrap();
    add_view(&w, &w.her, &browsing, 1, false).await;
    let nobody = w.app.member().await;
    add_view(&w, &w.her, &nobody, 1, true).await;

    enqueue(w.app.db(), NewJob::new("profile_views_summary", json!({})))
        .await
        .unwrap();
    w.app.drain_jobs().await;

    let rows = feed(&w.app, w.him.user_id).await;
    assert_eq!(
        rows,
        [("profile_views_summary".to_owned(), json!({ "count": 2 }))]
    );
    assert!(
        feed(&w.app, browsing.user_id).await.is_empty(),
        "no feed row"
    );
    assert!(feed(&w.app, nobody.user_id).await.is_empty(), "no feed row");

    // Running again the same day creates nothing (at most one a day, 14 section 7.2).
    enqueue(w.app.db(), NewJob::new("profile_views_summary", json!({})))
        .await
        .unwrap();
    w.app.drain_jobs().await;
    assert_eq!(feed(&w.app, w.him.user_id).await.len(), 1);
}
