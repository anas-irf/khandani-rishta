//! `POST /webhooks/clerk` (06 section 7, 15 section 15). Outside `/v1`, authenticated by its
//! Svix signature, never by a bearer token.

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::json;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::jobs::{NewJob, enqueue};
use crate::state::AppState;

/// Largest webhook body (06 section 7.1 step 1).
const WEBHOOK_BODY_LIMIT: usize = 256 * 1024;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(clerk_webhook))
        .layer(DefaultBodyLimit::max(WEBHOOK_BODY_LIMIT))
}

#[derive(Debug, Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    kind: String,
    data: EnvelopeData,
}

#[derive(Debug, Deserialize)]
struct EnvelopeData {
    #[serde(default)]
    id: Option<String>,
}

/// Clerk user events. `204` on success and on duplicates; `400` on a bad signature.
#[utoipa::path(
    post,
    path = "/clerk",
    tag = "webhooks",
    request_body(content = String, description = "Svix-signed Clerk event", content_type = "application/json"),
    responses((status = 204, description = "Handled"), (status = 400, body = ErrorBody))
)]
async fn clerk_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<StatusCode> {
    // Step 2: verify before parsing.
    let Some(secret) = state.config.clerk.webhook_secret.as_deref() else {
        tracing::error!("CLERK_WEBHOOK_SECRET is not set; refusing a webhook");
        return Err(ApiError::BadRequest("webhook secret missing".to_owned()));
    };
    let verified = svix::webhooks::Webhook::new(secret)
        .and_then(|webhook| webhook.verify(&body, &headers))
        .is_ok();
    if !verified {
        tracing::warn!("Clerk webhook signature refused");
        return Err(ApiError::BadRequest("invalid signature".to_owned()));
    }
    let svix_id = headers
        .get("svix-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let envelope: Envelope = serde_json::from_slice(&body)
        .map_err(|_| ApiError::BadRequest("unreadable event".to_owned()))?;

    // Step 3: deduplicate deliveries, then step 5: dispatch only enqueues.
    let mut tx = state.db.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO webhook_events (id, source, event_type) VALUES ($1, 'clerk', $2)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(&svix_id)
    .bind(&envelope.kind)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(StatusCode::NO_CONTENT);
    }
    let clerk_user_id = envelope.data.id.unwrap_or_default();
    let job = match envelope.kind.as_str() {
        "user.created" | "user.updated" if !clerk_user_id.is_empty() => Some(
            NewJob::new("sync_clerk_user", json!({ "clerk_user_id": clerk_user_id }))
                .dedupe(clerk_user_id.clone()),
        ),
        "user.deleted" if !clerk_user_id.is_empty() => Some(
            NewJob::new(
                "sync_clerk_user",
                json!({ "clerk_user_id": clerk_user_id, "deleted": true }),
            )
            .dedupe(format!("{clerk_user_id}:deleted")),
        ),
        _ => None,
    };
    if let Some(job) = job {
        enqueue(&mut *tx, job).await?;
    }
    tx.commit().await?;
    state.jobs.wake();
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use hmac::{Hmac, KeyInit, Mac};
    use serde_json::{Value, json};
    use sha2::Sha256;
    use sqlx::PgPool;
    use time::OffsetDateTime;

    use crate::services::clerk::ClerkUser;
    use crate::test_support::{TEST_WEBHOOK_SECRET, TestApp, TestResponse};

    fn signature(id: &str, timestamp: i64, body: &str) -> String {
        let secret = BASE64
            .decode(TEST_WEBHOOK_SECRET.trim_start_matches("whsec_"))
            .unwrap();
        let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&secret).unwrap();
        mac.update(format!("{id}.{timestamp}.{body}").as_bytes());
        format!("v1,{}", BASE64.encode(mac.finalize().into_bytes()))
    }

    async fn deliver(app: &TestApp, id: &str, event: &Value, signed: bool) -> TestResponse {
        let body = event.to_string();
        let timestamp = OffsetDateTime::now_utc().unix_timestamp();
        let signature = if signed {
            signature(id, timestamp, &body)
        } else {
            "v1,bm90IGEgc2lnbmF0dXJl".to_owned()
        };
        let timestamp = timestamp.to_string();
        app.request_with_headers(
            "POST",
            "/webhooks/clerk",
            None,
            Some(body),
            &[
                ("svix-id", id),
                ("svix-timestamp", &timestamp),
                ("svix-signature", &signature),
            ],
        )
        .await
    }

    #[sqlx::test]
    async fn a_bad_signature_is_refused(db: PgPool) {
        let app = TestApp::new(db).await;
        let event = json!({ "type": "user.created", "data": { "id": "user_1" } });
        let response = deliver(&app, "msg_1", &event, false).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(app.queued_jobs("sync_clerk_user").await, Vec::<Value>::new());
    }

    #[sqlx::test]
    async fn replaying_a_delivery_changes_nothing(db: PgPool) {
        let app = TestApp::new(db).await;
        let event = json!({ "type": "user.updated", "data": { "id": "user_1" } });
        assert_eq!(
            deliver(&app, "msg_1", &event, true).await.status,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            deliver(&app, "msg_1", &event, true).await.status,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            app.queued_jobs("sync_clerk_user").await,
            vec![json!({ "clerk_user_id": "user_1" })]
        );
        let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM webhook_events")
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(stored, 1);
    }

    #[sqlx::test]
    async fn other_events_are_ignored(db: PgPool) {
        let app = TestApp::new(db).await;
        let event = json!({ "type": "session.created", "data": { "id": "sess_1" } });
        assert_eq!(
            deliver(&app, "msg_2", &event, true).await.status,
            StatusCode::NO_CONTENT
        );
        assert_eq!(app.queued_jobs("sync_clerk_user").await, Vec::<Value>::new());
    }

    #[sqlx::test]
    async fn the_sync_job_provisions_and_updates(db: PgPool) {
        let app = TestApp::new(db).await;
        let (clerk_user_id, _) = app.clerk_user("first@example.com");
        let event = json!({ "type": "user.created", "data": { "id": clerk_user_id } });
        deliver(&app, "msg_a", &event, true).await;
        app.drain_jobs().await;
        let email: String = sqlx::query_scalar("SELECT email FROM users WHERE clerk_user_id = $1")
            .bind(&clerk_user_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(email, "first@example.com");

        // The newest state from Clerk wins, whatever the event said.
        app.clerk.add_user(ClerkUser {
            id: clerk_user_id.clone(),
            email: Some("second@example.com".to_owned()),
            email_verified: true,
            phone_e164: Some("+923001234567".to_owned()),
            phone_verified: true,
        });
        let event = json!({ "type": "user.updated", "data": { "id": clerk_user_id } });
        deliver(&app, "msg_b", &event, true).await;
        app.drain_jobs().await;
        let (email, phone_verified): (String, bool) = sqlx::query_as(
            "SELECT u.email, p.is_phone_verified FROM users u JOIN profiles p ON p.user_id = u.id
             WHERE u.clerk_user_id = $1",
        )
        .bind(&clerk_user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(email, "second@example.com");
        assert!(phone_verified);
    }

    #[sqlx::test]
    async fn a_user_deleted_in_clerk_is_purged_at_once(db: PgPool) {
        let app = TestApp::new(db).await;
        let user = app.member().await;
        let event = json!({ "type": "user.deleted", "data": { "id": user.clerk_user_id } });
        deliver(&app, "msg_d", &event, true).await;
        // Run only the sync job: the purge job it enqueues is checked separately.
        let job = crate::jobs::worker::claim(app.db()).await.unwrap().unwrap();
        assert_eq!(job.kind, "sync_clerk_user");
        crate::jobs::worker::execute(&app.state, job).await.unwrap();

        let status: String = sqlx::query_scalar("SELECT status FROM users WHERE id = $1")
            .bind(user.user_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(status, "deletion_scheduled");
        assert_eq!(app.queued_jobs("purge_accounts").await.len(), 1);
    }
}
