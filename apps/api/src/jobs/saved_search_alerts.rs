//! The `saved_search_alerts` job (19 section 2.16, 10 section 9.5): once a day, for each saved
//! search with `notify_new = true` whose profile is `active`, run the search for profiles first
//! activated since the last alert and, when at least one matches, create one `new_matches`
//! notification with `source = 'saved_search'`.

use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::db::discovery::{self as db, KeysetSort, SearchScope};
use crate::domain::options::MaritalStatus;
use crate::domain::types::NotificationType;
use crate::jobs::{ClaimedJob, JobOutcome};
use crate::models::discovery::SearchFilters;
use crate::notify::notify;
use crate::state::AppState;
use crate::views::{self, ViewSettings};

/// Saved searches handled per run, oldest alert first (19 section 2.16).
const PER_RUN: i64 = 500;

/// New profiles examined per saved search.
const SCAN: usize = 500;

#[derive(Debug, sqlx::FromRow)]
struct Due {
    id: Uuid,
    profile_id: Uuid,
    user_id: Uuid,
    name: String,
    filters: serde_json::Value,
    since: OffsetDateTime,
}

pub async fn run(state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let due: Vec<Due> = sqlx::query_as(
        "SELECT s.id, s.profile_id, p.user_id, s.name, s.filters,
                COALESCE(s.last_notified_at, s.created_at) AS since
         FROM saved_searches s
         JOIN profiles p ON p.id = s.profile_id
         JOIN users u ON u.id = p.user_id
         WHERE s.notify_new AND p.status = 'active' AND u.status = 'active'
         ORDER BY s.last_notified_at NULLS FIRST, s.created_at
         LIMIT $1",
    )
    .bind(PER_RUN)
    .fetch_all(&state.db)
    .await?;
    let mut notified = 0_u32;
    for search in due {
        match alert(state, &search).await {
            Ok(true) => notified += 1,
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(error = %format!("{error:#}"), saved_search_id = %search.id, "saved search alert failed");
            }
        }
    }
    tracing::info!(notified, "saved search alerts");
    Ok(JobOutcome::Done)
}

/// Runs one saved search for new profiles. Returns whether a notification was created.
async fn alert(state: &AppState, search: &Due) -> anyhow::Result<bool> {
    let Ok(filters) = serde_json::from_value::<SearchFilters>(search.filters.clone()) else {
        return Ok(false);
    };
    // A search by code finds one known profile, never new members.
    if filters.public_code.is_some() {
        return Ok(false);
    }
    let viewer = views::viewer(state, search.profile_id).await?;
    let Some(gender) = viewer.gender() else {
        return Ok(false);
    };
    let settings = state.settings.get().await?;
    let scope = SearchScope {
        viewer_id: viewer.id(),
        viewer_gender: gender,
        viewer_accepts_married: viewer.member.accepts_married(),
        viewer_is_married: viewer.row().marital_status == Some(MaritalStatus::Married),
        cooldowns: ViewSettings::new(&settings).cooldowns,
        today: viewer.today(),
        filters: &filters,
        activated_after: Some(search.since),
    };
    let rows = db::search_page(&state.db, &scope, KeysetSort::Newest, None, SCAN).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let screened = views::screen(state, &viewer, &ids).await?;
    let count = screened.values().filter(|seen| seen.discoverable()).count();
    if count == 0 {
        return Ok(false);
    }
    sqlx::query("UPDATE saved_searches SET last_notified_at = now() WHERE id = $1")
        .bind(search.id)
        .execute(&state.db)
        .await?;
    if recently_notified(&state.db, search.user_id, search.id).await? {
        return Ok(false);
    }
    let created = notify(
        state,
        search.user_id,
        NotificationType::NewMatches,
        None,
        json!({
            "source": "saved_search",
            "count": count,
            "saved_search_id": search.id,
            "saved_search_name": search.name,
        }),
    )
    .await?;
    Ok(created.is_some())
}

/// At most one `new_matches` notification per saved search every 20 hours (14 section 7.2).
async fn recently_notified(
    db: &PgPool,
    user_id: Uuid,
    saved_search_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM notifications
                        WHERE user_id = $1 AND type = 'new_matches'
                          AND data->>'source' = 'saved_search'
                          AND data->>'saved_search_id' = $2
                          AND created_at > now() - interval '20 hours')",
    )
    .bind(user_id)
    .bind(saved_search_id.to_string())
    .fetch_one(db)
    .await
}
