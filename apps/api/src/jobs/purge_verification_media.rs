//! The `purge_verification_media` job (19 section 2.11, 12 section 6): deletes the identity and
//! selfie images of decided requests once their retention has passed. The decision itself stays.

use uuid::Uuid;

use crate::jobs::{ClaimedJob, JobOutcome};
use crate::state::AppState;

/// Requests handled per round trip.
const BATCH: i64 = 100;

#[derive(Debug, sqlx::FromRow)]
struct Due {
    id: Uuid,
    front_key: Option<String>,
    back_key: Option<String>,
    selfie_key: Option<String>,
}

pub async fn run(state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let mut purged = 0_usize;
    loop {
        let due: Vec<Due> = sqlx::query_as(
            "SELECT id, front_key, back_key, selfie_key FROM verification_requests
             WHERE media_purge_after <= now() AND media_purged_at IS NULL
             ORDER BY media_purge_after, id LIMIT $1",
        )
        .bind(BATCH)
        .fetch_all(&state.db)
        .await?;
        if due.is_empty() {
            break;
        }
        for request in &due {
            let keys: Vec<String> = [&request.front_key, &request.back_key, &request.selfie_key]
                .into_iter()
                .flatten()
                .cloned()
                .collect();
            if !keys.is_empty() {
                state.storage.delete(&keys).await?;
            }
            sqlx::query(
                "UPDATE verification_requests
                 SET front_key = NULL, back_key = NULL, selfie_key = NULL, media_purged_at = now()
                 WHERE id = $1",
            )
            .bind(request.id)
            .execute(&state.db)
            .await?;
            purged += 1;
        }
    }
    tracing::info!(purged, "verification media purged");
    Ok(JobOutcome::Done)
}
