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
