//! The `delete_objects` job (19 section 2.3): removes R2 objects, by key or by prefix. A missing
//! object is not an error, so the job can be repeated.

use serde::Deserialize;

use crate::jobs::{ClaimedJob, JobOutcome, payload};
use crate::state::AppState;

/// Keys deleted per call (19 section 2.3).
const BATCH: usize = 1_000;

#[derive(Debug, Deserialize)]
struct Payload {
    #[serde(default)]
    keys: Vec<String>,
    #[serde(default)]
    prefix: Option<String>,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    if !state.storage.is_available() {
        return Ok(JobOutcome::Skipped("storage is not configured".to_owned()));
    }
    for chunk in payload.keys.chunks(BATCH) {
        state.storage.delete(chunk).await?;
    }
    if let Some(prefix) = payload.prefix.as_deref() {
        // An empty prefix would match the whole bucket.
        anyhow::ensure!(
            !prefix.is_empty(),
            "delete_objects needs a non-empty prefix"
        );
        let deleted = state.storage.delete_prefix(prefix).await?;
        tracing::info!(deleted, "objects deleted by prefix");
    }
    Ok(JobOutcome::Done)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use crate::jobs::{NewJob, enqueue};
    use crate::services::r2::ObjectStore;
    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn keys_and_prefixes_are_deleted_and_missing_objects_are_fine(db: PgPool) {
        let app = TestApp::new(db).await;
        for key in [
            "photos/a/1/large.jpg",
            "photos/a/2/large.jpg",
            "tmp/x",
            "keep/me",
        ] {
            app.storage.put(key, vec![1], "image/jpeg").await.unwrap();
        }
        enqueue(
            app.db(),
            NewJob::new(
                "delete_objects",
                json!({ "keys": ["tmp/x", "never/existed"], "prefix": "photos/a/" }),
            ),
        )
        .await
        .unwrap();
        assert_eq!(app.drain_jobs().await, 1);
        assert_eq!(app.storage.keys(), vec!["keep/me".to_owned()]);
        let status: String =
            sqlx::query_scalar("SELECT status FROM jobs WHERE kind = 'delete_objects'")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(status, "succeeded");
    }

    #[sqlx::test]
    async fn an_empty_prefix_never_empties_the_bucket(db: PgPool) {
        let app = TestApp::new(db).await;
        app.storage
            .put("photos/a/1.jpg", vec![1], "image/jpeg")
            .await
            .unwrap();
        enqueue(
            app.db(),
            NewJob::new("delete_objects", json!({ "prefix": "" })),
        )
        .await
        .unwrap();
        app.drain_jobs().await;
        assert_eq!(app.storage.keys().len(), 1);
        let status: String =
            sqlx::query_scalar("SELECT status FROM jobs WHERE kind = 'delete_objects'")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(status, "queued", "the attempt failed and will be retried");
    }
}
