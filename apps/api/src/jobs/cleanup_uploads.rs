//! The `cleanup_uploads` job (19 section 2.12, 12 section 6): removes uploads nobody confirmed
//! and gives up on photos that never finished processing.

use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::db::photos as db;
use crate::jobs::{ClaimedJob, JobOutcome};
use crate::services::r2::ObjectMeta;
use crate::state::AppState;

/// Objects younger than this may still be waiting for their confirmation.
const UPLOAD_GRACE: Duration = Duration::hours(24);
/// A photo still `processing` after this long has lost its job.
const PROCESSING_LIMIT: &str = "1 hour";
/// Keys deleted per call.
const BATCH: usize = 1_000;

pub async fn run(state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let cutoff = OffsetDateTime::now_utc() - UPLOAD_GRACE;
    if state.storage.is_available() {
        // 1. Temporary photo uploads that were never confirmed or were left behind.
        let abandoned = older_than(state.storage.list("tmp/").await?, cutoff);
        delete_all(state, &abandoned).await?;

        // 2. Verification images that no request refers to.
        let candidates = older_than(state.storage.list("verification/").await?, cutoff);
        let referenced = referenced_verification_keys(state, &candidates).await?;
        let orphans: Vec<String> = candidates
            .into_iter()
            .filter(|key| !referenced.contains(key))
            .collect();
        delete_all(state, &orphans).await?;
        tracing::info!(
            temporary = abandoned.len(),
            verification = orphans.len(),
            "stale uploads removed"
        );
    }

    // 3. Photos whose processing never finished.
    let lost: Vec<(Uuid, Uuid)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "UPDATE profile_photos SET status = 'failed'
         WHERE status = 'processing' AND created_at < now() - interval '{PROCESSING_LIMIT}'
         RETURNING id, profile_id"
    )))
    .fetch_all(&state.db)
    .await?;
    for (photo_id, profile_id) in &lost {
        tracing::warn!(photo_id = %photo_id, "photo never finished processing");
        db::announce(state, *profile_id, &[*photo_id]).await;
    }
    Ok(JobOutcome::Done)
}

/// The keys of objects last modified before `cutoff`. An object without a time is kept.
fn older_than(objects: Vec<ObjectMeta>, cutoff: OffsetDateTime) -> Vec<String> {
    objects
        .into_iter()
        .filter(|object| object.last_modified.is_some_and(|at| at < cutoff))
        .map(|object| object.key)
        .collect()
}

async fn delete_all(state: &AppState, keys: &[String]) -> anyhow::Result<()> {
    for chunk in keys.chunks(BATCH) {
        state.storage.delete(chunk).await?;
    }
    Ok(())
}

/// Which of `keys` some `verification_requests` row still names.
async fn referenced_verification_keys(
    state: &AppState,
    keys: &[String],
) -> sqlx::Result<std::collections::HashSet<String>> {
    let mut referenced = std::collections::HashSet::new();
    for chunk in keys.chunks(BATCH) {
        let found: Vec<String> = sqlx::query_scalar(
            "SELECT k FROM unnest($1::text[]) AS k
             WHERE EXISTS (SELECT 1 FROM verification_requests v
                            WHERE v.front_key = k OR v.back_key = k OR v.selfie_key = k)",
        )
        .bind(chunk)
        .fetch_all(&state.db)
        .await?;
        referenced.extend(found);
    }
    Ok(referenced)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use crate::jobs::{NewJob, enqueue};
    use crate::test_support::TestApp;

    fn hours_ago(hours: i64) -> time::OffsetDateTime {
        time::OffsetDateTime::now_utc() - time::Duration::hours(hours)
    }

    #[sqlx::test]
    async fn stale_uploads_go_and_referenced_or_fresh_ones_stay(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let old = hours_ago(30);
        let fresh = hours_ago(2);
        for (key, at) in [
            ("tmp/photos/p/old", old),
            ("tmp/photos/p/fresh", fresh),
            ("verification/p/orphan", old),
            ("verification/p/used", old),
            ("verification/p/new", fresh),
            ("photos/p/1/large.jpg", old),
        ] {
            app.storage.insert_at(key, vec![1], "image/jpeg", at);
        }
        sqlx::query(
            "INSERT INTO verification_requests (profile_id, kind, selfie_key, gesture)
             VALUES ($1, 'selfie', 'verification/p/used', 'peace_sign')",
        )
        .bind(user.profile_id)
        .execute(app.db())
        .await
        .unwrap();

        enqueue(app.db(), NewJob::new("cleanup_uploads", json!({})))
            .await
            .unwrap();
        app.drain_jobs().await;
        let mut keys = app.storage.keys();
        keys.sort();
        assert_eq!(
            keys,
            vec![
                "photos/p/1/large.jpg",
                "tmp/photos/p/fresh",
                "verification/p/new",
                "verification/p/used",
            ]
        );
    }

    #[sqlx::test]
    async fn photos_stuck_in_processing_fail(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let stuck: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO profile_photos (profile_id, upload_key, created_at)
             VALUES ($1, 'tmp/photos/p/stuck', now() - interval '2 hours') RETURNING id",
        )
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        let recent: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO profile_photos (profile_id, upload_key, position)
             VALUES ($1, 'tmp/photos/p/recent', 1) RETURNING id",
        )
        .bind(user.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();

        enqueue(app.db(), NewJob::new("cleanup_uploads", json!({})))
            .await
            .unwrap();
        app.drain_jobs().await;
        let status = |id: uuid::Uuid| {
            let db = app.db().clone();
            async move {
                sqlx::query_scalar::<_, String>("SELECT status FROM profile_photos WHERE id = $1")
                    .bind(id)
                    .fetch_one(&db)
                    .await
                    .unwrap()
            }
        };
        assert_eq!(status(stuck).await, "failed");
        assert_eq!(status(recent).await, "processing");
    }
}
