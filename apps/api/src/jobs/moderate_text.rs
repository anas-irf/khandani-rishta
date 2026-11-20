//! The `moderate_text` job (19 section 2.4, 13 section 3.7): the automatic check of one moderated
//! free-text field after the member changed it.
//!
//! The text is read first, checked with no transaction open, and the result is written only if
//! the stored text still equals the text that was checked. A text the service cannot judge, or
//! that it holds back, stays `pending` and appears in the moderator queue.

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::db::review::{self, ModeratedField, TextRow};
use crate::domain::types::{NotificationType, TextStatus};
use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue, payload};
use crate::notify::notify;
use crate::services::content_safety::{TextVerdict, text_verdict};
use crate::settings::ReviewMode;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct Payload {
    profile_id: Uuid,
    field: ModeratedField,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let Payload { profile_id, field } = payload(job)?;

    // Steps 1 and 2: load the text; only a pending one is checked, and this is the text that is.
    let Some(row) = review::load_text(&state.db, profile_id, field, false).await? else {
        return Ok(JobOutcome::Skipped("no such text".to_owned()));
    };
    if row.status != TextStatus::Pending {
        return Ok(JobOutcome::Skipped("not pending".to_owned()));
    }
    let Some(checked) = row.text.clone().filter(|text| !text.trim().is_empty()) else {
        return conclude(state, &row, field, TextStatus::Approved).await;
    };

    // Step 3: manual review waits for a moderator, and so does a service that is not there.
    let settings = state.settings.get().await?;
    if settings.text_review == ReviewMode::Manual {
        return Ok(JobOutcome::Skipped("manual review".to_owned()));
    }
    if !state.content_safety.is_enabled() {
        return Ok(JobOutcome::Skipped(
            "content safety is not configured".to_owned(),
        ));
    }

    // Steps 4 to 6.
    let verdict = match state.content_safety.analyze_text(&checked).await {
        Ok(analysis) => text_verdict(&analysis),
        Err(error) if error.is_temporary() && !job.is_last_attempt() => {
            // Down or over quota: fail the attempt so the runner tries again later.
            return Err(anyhow::anyhow!("text check unavailable: {error}"));
        }
        Err(error) => {
            // Out of attempts, or refused: the text stays pending for a moderator.
            tracing::warn!(%error, %profile_id, %field, "the automatic text check gave no answer");
            return Ok(JobOutcome::Skipped("held for a moderator".to_owned()));
        }
    };
    match verdict {
        TextVerdict::Approve => conclude(state, &row, field, TextStatus::Approved).await,
        TextVerdict::Reject => conclude(state, &row, field, TextStatus::Rejected).await,
        TextVerdict::Hold => Ok(JobOutcome::Skipped("held for a moderator".to_owned())),
    }
}

/// Writes the status if the text is still the one that was checked. If the member saved again
/// meanwhile, nothing is written and the job is queued again (19 section 2.4).
async fn conclude(
    state: &AppState,
    row: &TextRow,
    field: ModeratedField,
    status: TextStatus,
) -> anyhow::Result<JobOutcome> {
    let mut tx = state.db.begin().await?;
    let written = review::set_text_status_if_unchanged(
        &mut tx,
        row.profile_id,
        field,
        row.text.as_deref(),
        status,
    )
    .await?;
    if !written {
        tx.rollback().await?;
        enqueue(
            &state.db,
            NewJob::new(
                "moderate_text",
                json!({ "profile_id": row.profile_id, "field": field }),
            )
            .dedupe(field.job_key(row.profile_id)),
        )
        .await?;
        state.jobs.wake();
        return Ok(JobOutcome::Skipped(
            "text changed, checking again".to_owned(),
        ));
    }
    tx.commit().await?;

    tracing::info!(
        profile_id = %row.profile_id, %field, result = %status, source = "automatic",
        "text checked"
    );
    if status == TextStatus::Rejected
        && let Err(error) = notify(
            state,
            row.user_id,
            NotificationType::TextRejected,
            None,
            json!({ "field": field, "note": null }),
        )
        .await
    {
        tracing::warn!(%error, "could not notify about a rejected text");
    }
    Ok(JobOutcome::Done)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::db::review::ModeratedField;
    use crate::jobs::{NewJob, enqueue};
    use crate::test_support::{TestApp, TestUser};

    /// Gives the member a pending `about_me` and queues its check, as saving the text does.
    async fn save_about_me(app: &TestApp, user: &TestUser, text: &str) {
        sqlx::query("UPDATE profiles SET about_me = $2, about_me_status = 'pending' WHERE id = $1")
            .bind(user.profile_id)
            .bind(text)
            .execute(app.db())
            .await
            .unwrap();
        queue_check(app, user.profile_id, ModeratedField::AboutMe).await;
    }

    async fn queue_check(app: &TestApp, profile_id: Uuid, field: ModeratedField) {
        enqueue(
            app.db(),
            NewJob::new(
                "moderate_text",
                json!({ "profile_id": profile_id, "field": field }),
            )
            .dedupe(field.job_key(profile_id)),
        )
        .await
        .unwrap();
    }

    async fn about_me_status(app: &TestApp, user: &TestUser) -> String {
        sqlx::query_scalar("SELECT about_me_status FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap()
    }

    async fn job_note(app: &TestApp) -> Option<String> {
        sqlx::query_scalar("SELECT last_error FROM jobs WHERE kind = 'moderate_text' ORDER BY created_at DESC LIMIT 1")
            .fetch_one(app.db())
            .await
            .unwrap()
    }

    const TEXT: &str = "I enjoy reading and spending time with my family.";

    #[sqlx::test]
    async fn clean_text_is_approved_and_the_profile_marked_stale(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        *app.content_safety.severity.lock().unwrap() = Some(0);
        save_about_me(&app, &user, TEXT).await;
        sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
            .bind(user.profile_id)
            .execute(app.db())
            .await
            .unwrap();

        app.drain_jobs().await;
        assert_eq!(about_me_status(&app, &user).await, "approved");
        let stale: bool = sqlx::query_scalar("SELECT match_stale FROM profiles WHERE id = $1")
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert!(stale);
    }

    #[sqlx::test]
    async fn a_certain_violation_is_rejected_and_the_member_told(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        *app.content_safety.severity.lock().unwrap() = Some(6);
        save_about_me(&app, &user, TEXT).await;

        app.drain_jobs().await;
        assert_eq!(about_me_status(&app, &user).await, "rejected");
        let data: serde_json::Value = sqlx::query_scalar(
            "SELECT data FROM notifications WHERE user_id = $1 AND type = 'text_rejected'",
        )
        .bind(user.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(data, json!({ "field": "about_me", "note": null }));
    }

    #[sqlx::test]
    async fn flagged_text_is_held_for_a_moderator(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        *app.content_safety.severity.lock().unwrap() = Some(2);
        save_about_me(&app, &user, TEXT).await;

        app.drain_jobs().await;
        assert_eq!(about_me_status(&app, &user).await, "pending");
        assert_eq!(
            job_note(&app).await.as_deref(),
            Some("skipped:held for a moderator")
        );
    }

    #[sqlx::test]
    async fn with_the_service_down_the_text_stays_pending_and_the_check_is_retried(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        // `severity` is None: every call fails as if the service were down.
        save_about_me(&app, &user, TEXT).await;

        app.drain_jobs().await;
        assert_eq!(about_me_status(&app, &user).await, "pending");
        let (status, attempts): (String, i16) =
            sqlx::query_as("SELECT status, attempts FROM jobs WHERE kind = 'moderate_text'")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(
            (status.as_str(), attempts),
            ("queued", 1),
            "failed once, retried later"
        );

        // After the last attempt the text simply stays pending.
        sqlx::query("UPDATE jobs SET attempts = max_attempts - 1, run_at = now() WHERE kind = 'moderate_text'")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;
        let status: String =
            sqlx::query_scalar("SELECT status FROM jobs WHERE kind = 'moderate_text'")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(status, "succeeded");
        assert_eq!(about_me_status(&app, &user).await, "pending");
    }

    #[sqlx::test]
    async fn manual_review_leaves_every_text_to_a_moderator(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        *app.content_safety.severity.lock().unwrap() = Some(0);
        app.state
            .settings
            .put("moderation.text_review", &json!("manual"), None)
            .await
            .unwrap();
        save_about_me(&app, &user, TEXT).await;

        app.drain_jobs().await;
        assert_eq!(about_me_status(&app, &user).await, "pending");
        assert_eq!(
            job_note(&app).await.as_deref(),
            Some("skipped:manual review")
        );
    }

    #[sqlx::test]
    async fn an_edit_during_the_check_is_not_overwritten(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        *app.content_safety.severity.lock().unwrap() = Some(0);
        save_about_me(&app, &user, TEXT).await;
        let row =
            crate::db::review::load_text(app.db(), user.profile_id, ModeratedField::AboutMe, false)
                .await
                .unwrap()
                .unwrap();

        // The member saves again after the job read the text but before it wrote.
        sqlx::query("UPDATE profiles SET about_me = 'A newer text' WHERE id = $1")
            .bind(user.profile_id)
            .execute(app.db())
            .await
            .unwrap();
        let outcome = super::conclude(
            &app.state,
            &row,
            ModeratedField::AboutMe,
            crate::domain::types::TextStatus::Approved,
        )
        .await
        .unwrap();
        assert!(matches!(outcome, crate::jobs::JobOutcome::Skipped(_)));
        assert_eq!(about_me_status(&app, &user).await, "pending");
        let queued = app.queued_jobs("moderate_text").await;
        assert!(
            queued
                .iter()
                .any(|p| p["profile_id"] == json!(user.profile_id)),
            "the check is queued again"
        );
    }

    #[sqlx::test]
    async fn the_other_two_fields_are_checked_too(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        *app.content_safety.severity.lock().unwrap() = Some(0);
        sqlx::query("INSERT INTO profile_family (profile_id, about_family, about_family_status) VALUES ($1, $2, 'pending')")
            .bind(user.profile_id)
            .bind(TEXT)
            .execute(app.db())
            .await
            .unwrap();
        sqlx::query("UPDATE partner_preferences SET notes = $2, notes_status = 'pending' WHERE profile_id = $1")
            .bind(user.profile_id)
            .bind(TEXT)
            .execute(app.db())
            .await
            .unwrap();
        queue_check(&app, user.profile_id, ModeratedField::AboutFamily).await;
        queue_check(&app, user.profile_id, ModeratedField::PartnerNotes).await;

        app.drain_jobs().await;
        let family: String = sqlx::query_scalar(
            "SELECT about_family_status FROM profile_family WHERE profile_id = $1",
        )
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        let notes: String = sqlx::query_scalar(
            "SELECT notes_status FROM partner_preferences WHERE profile_id = $1",
        )
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!((family.as_str(), notes.as_str()), ("approved", "approved"));
    }

    #[sqlx::test]
    async fn texts_that_are_not_pending_or_have_gone_are_skipped(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        *app.content_safety.severity.lock().unwrap() = Some(6);
        // Already approved: nothing to check.
        queue_check(&app, user.profile_id, ModeratedField::AboutMe).await;
        // No profile_family row at all.
        queue_check(&app, user.profile_id, ModeratedField::AboutFamily).await;
        app.drain_jobs().await;
        assert_eq!(about_me_status(&app, &user).await, "approved");
        let notes: Vec<String> = sqlx::query_scalar(
            "SELECT last_error FROM jobs WHERE kind = 'moderate_text' ORDER BY last_error",
        )
        .fetch_all(app.db())
        .await
        .unwrap();
        assert_eq!(notes, vec!["skipped:no such text", "skipped:not pending"]);
    }
}
