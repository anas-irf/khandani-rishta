//! Staff routes: the overview (15 section 16, 18 section 9).

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use moka::sync::Cache;
use time::OffsetDateTime;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Moderator;
use crate::error::{ApiResult, ErrorBody};
use crate::models::admin::AdminOverview;
use crate::state::AppState;

/// How long a computed overview is reused (18 section 9).
const OVERVIEW_TTL: Duration = Duration::from_mins(1);

/// The computed overview per database. One process serves one database, so the key only keeps
/// the separate databases of parallel tests apart.
static CACHE: LazyLock<Cache<String, Arc<AdminOverview>>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(64)
        .time_to_live(OVERVIEW_TTL)
        .build()
});

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_overview))
}

/// Queue sizes and headline numbers, cached in memory for 60 seconds.
#[utoipa::path(
    get,
    path = "/overview",
    tag = "admin",
    security(("bearer" = [])),
    responses(
        (status = 200, body = AdminOverview),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn get_overview(
    State(state): State<AppState>,
    _staff: Moderator,
) -> ApiResult<Json<AdminOverview>> {
    let key = state
        .db
        .connect_options()
        .get_database()
        .unwrap_or_default()
        .to_owned();
    if let Some(cached) = CACHE.get(&key) {
        return Ok(Json((*cached).clone()));
    }
    let overview =
        crate::db::admin::overview::compute(&state.db, OffsetDateTime::now_utc()).await?;
    CACHE.insert(key, Arc::new(overview.clone()));
    Ok(Json(overview))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;

    use crate::domain::options::Gender;
    use crate::domain::types::{ProfileStatus, UserRole};
    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn the_overview_counts_the_queues_and_the_headline_numbers(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let pending = app
            .member_with(|s| s.status = ProfileStatus::PendingReview)
            .await;
        let woman = app.member_of(Gender::Female).await;
        let suspended = app
            .member_with(|s| s.status = ProfileStatus::Suspended)
            .await;
        let db = app.db();
        sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
            .bind(suspended.user_id)
            .execute(db)
            .await
            .unwrap();
        sqlx::query("UPDATE profiles SET is_id_verified = true WHERE id = $1")
            .bind(woman.profile_id)
            .execute(db)
            .await
            .unwrap();

        // Queues: two photos in review (one flagged), a text, a verification, a report, a suggestion.
        sqlx::query("INSERT INTO profile_photos (profile_id, status, upload_key, moderation) VALUES ($1, 'pending_review', 'tmp/a', $2), ($1, 'pending_review', 'tmp/b', $3)")
            .bind(pending.profile_id).bind(json!({ "result": "flag" })).bind(json!({ "result": "pass" }))
            .execute(db).await.unwrap();
        sqlx::query(
            "UPDATE profiles SET about_me = 'x', about_me_status = 'pending' WHERE id = $1",
        )
        .bind(pending.profile_id)
        .execute(db)
        .await
        .unwrap();
        // A text whose automatic check is still queued does not wait for a person.
        sqlx::query(
            "UPDATE profiles SET about_me = 'y', about_me_status = 'pending' WHERE id = $1",
        )
        .bind(woman.profile_id)
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO jobs (kind, payload, dedupe_key) VALUES ('moderate_text', '{}', $1)",
        )
        .bind(format!("{}:about_me", woman.profile_id))
        .execute(db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO verification_requests (profile_id, kind, status) VALUES ($1, 'selfie', 'pending')").bind(pending.profile_id).execute(db).await.unwrap();
        sqlx::query("INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason) VALUES ($1, $2, 'profile', 'other'), ($1, $3, 'profile', 'other')")
            .bind(woman.profile_id).bind(pending.profile_id).bind(suspended.profile_id).execute(db).await.unwrap();
        sqlx::query("UPDATE reports SET status = 'in_review' WHERE target_profile_id = $1")
            .bind(suspended.profile_id)
            .execute(db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO caste_suggestions (name, normalized_name) VALUES ('Mirasi', 'mirasi')",
        )
        .execute(db)
        .await
        .unwrap();
        // Activity: an interest accepted today, a connection, a message, a dead job.
        let interest: uuid::Uuid = sqlx::query_scalar("INSERT INTO interests (sender_profile_id, receiver_profile_id, status, responded_at, expires_at) VALUES ($1, $2, 'accepted', now(), now()) RETURNING id")
            .bind(moderator.profile_id).bind(woman.profile_id).fetch_one(db).await.unwrap();
        let (low, high) = crate::lifecycle::ordered_pair(moderator.profile_id, woman.profile_id);
        let connection: uuid::Uuid = sqlx::query_scalar("INSERT INTO connections (profile_low_id, profile_high_id, interest_id, stage) VALUES ($1, $2, $3, 'engaged') RETURNING id")
            .bind(low).bind(high).bind(interest).fetch_one(db).await.unwrap();
        sqlx::query("INSERT INTO messages (id, connection_id, sender_profile_id, body) VALUES ($1, $2, $3, 'salam')")
            .bind(uuid::Uuid::now_v7()).bind(connection).bind(woman.profile_id).execute(db).await.unwrap();
        sqlx::query(
            "INSERT INTO jobs (kind, status, finished_at) VALUES ('send_push', 'dead', now())",
        )
        .execute(db)
        .await
        .unwrap();

        let response = app.get("/v1/admin/overview", Some(&moderator.token)).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        let json = &response.json;
        assert!(json["generated_at"].is_string());

        let queues = &json["queues"];
        assert_eq!(queues["profiles_pending"], 1);
        assert_eq!(queues["photos_pending"], 2);
        assert_eq!(queues["photos_flagged"], 1);
        assert_eq!(queues["texts_pending"], 1);
        assert_eq!(queues["verifications_pending"], 1);
        assert_eq!(queues["reports_open"], 1);
        assert_eq!(queues["reports_in_review"], 1);
        assert_eq!(queues["caste_suggestions_pending"], 1);
        assert!(queues["oldest_waiting"]["profiles"].is_string());
        assert!(queues["oldest_waiting"]["photos"].is_string());
        assert!(queues["oldest_waiting"]["verifications"].is_string());
        assert!(queues["oldest_waiting"]["reports"].is_string());

        let metrics = &json["metrics"];
        assert_eq!(metrics["users_total"], 4);
        assert_eq!(metrics["signups_today"], 4);
        assert_eq!(metrics["signups_7d"], 4);
        assert_eq!(
            metrics["profiles_by_status"],
            json!({ "draft": 0, "pending_review": 1, "changes_requested": 0, "active": 2, "paused": 0, "closed": 0, "suspended": 1 })
        );
        assert_eq!(metrics["active_male"], 1, "the moderator");
        assert_eq!(metrics["active_female"], 1);
        assert_eq!(metrics["active_id_verified"], 1);
        assert_eq!(metrics["active_photo_verified"], 0);
        assert_eq!(metrics["active_last_7d"], 2);
        assert_eq!(metrics["interests_sent_today"], 1);
        assert_eq!(metrics["interests_sent_7d"], 1);
        assert_eq!(metrics["interests_accepted_7d"], 1);
        assert_eq!(metrics["connections_active"], 1);
        assert_eq!(metrics["connections_created_7d"], 1);
        assert_eq!(
            metrics["stage_counts"],
            json!({ "chatting": 0, "families_talking": 0, "engaged": 1, "nikah_done": 0 })
        );
        assert_eq!(metrics["messages_7d"], 1);
        assert_eq!(metrics["reports_filed_7d"], 2);
        assert_eq!(metrics["users_suspended"], 1);
        assert_eq!(metrics["users_banned"], 0);
        assert_eq!(metrics["deletions_scheduled"], 0);
        assert_eq!(metrics["jobs_dead"], 1);

        assert_eq!(
            app.get("/v1/admin/overview", Some(&woman.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.get("/v1/admin/overview", None).await.status,
            StatusCode::UNAUTHORIZED
        );
        // A second request inside the minute answers from the cache.
        sqlx::query("DELETE FROM jobs WHERE status = 'dead'")
            .execute(app.db())
            .await
            .unwrap();
        let cached = app.get("/v1/admin/overview", Some(&moderator.token)).await;
        assert_eq!(cached.json["metrics"]["jobs_dead"], 1);
        assert_eq!(cached.json["generated_at"], json["generated_at"]);
    }
}
