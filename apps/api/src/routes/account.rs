//! Account deletion and data exports (15 section 6, 06 section 9, 09 section 12).

use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::{Auth, Open};
use crate::db::accounts;
use crate::domain::types::ExportStatus;
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode, FieldErrors};
use crate::extract::ApiJson;
use crate::models::me::{self, Me};
use crate::state::AppState;

/// Longest optional reason for a deletion request, in characters (06 section 9.1).
const MAX_REASON_CHARS: usize = 300;
/// How long a download link stays valid. It is also cut off at the export's own expiry.
const DOWNLOAD_LINK_TTL: Duration = Duration::from_hours(1);

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(post_deletion, delete_deletion))
        .routes(routes!(post_export))
        .routes(routes!(get_latest_export))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DeletionBody {
    /// Optional, up to 300 characters. Only logged, never stored.
    pub reason: Option<String>,
    /// Must be the text `DELETE`.
    pub confirm: String,
}

/// Schedules the deletion of the account. The profile is hidden at once and purged after
/// `account.deletion_grace_days`. A banned or suspended account keeps its status.
#[utoipa::path(
    post,
    path = "/me/deletion",
    tag = "account",
    security(("bearer" = [])),
    request_body = DeletionBody,
    responses(
        (status = 200, body = Me),
        (status = 400, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn post_deletion(
    State(state): State<AppState>,
    account: Auth,
    ApiJson(body): ApiJson<DeletionBody>,
) -> ApiResult<Json<Me>> {
    let mut errors = FieldErrors::new();
    if body.confirm != "DELETE" {
        errors.add("confirm", FieldCode::Mismatch);
    }
    let reason = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty());
    if reason.is_some_and(|reason| reason.chars().count() > MAX_REASON_CHARS) {
        errors.add("reason", FieldCode::TooLong);
    }
    errors.finish()?;

    let settings = state.settings.get().await?;
    accounts::request_deletion(&state, account.user_id, settings.deletion_grace_days).await?;
    // The optional reason is logged with the user id and nothing else (06 section 9.2).
    tracing::info!(
        event = "account.deletion_requested",
        user_id = %account.user_id,
        reason = reason.unwrap_or_default(),
        "account deletion requested"
    );
    Ok(Json(me::reload(&state, &account).await?))
}

/// Cancels a scheduled deletion. The account is `active` again; a banned or suspended account
/// keeps that status and only the deletion is cancelled.
#[utoipa::path(
    delete,
    path = "/me/deletion",
    tag = "account",
    security(("bearer" = [])),
    responses((status = 200, body = Me), (status = 409, body = ErrorBody))
)]
async fn delete_deletion(State(state): State<AppState>, account: Auth) -> ApiResult<Json<Me>> {
    accounts::cancel_deletion(&state, account.user_id).await?;
    tracing::info!(
        event = "account.deletion_cancelled",
        user_id = %account.user_id,
        "account deletion cancelled"
    );
    Ok(Json(me::reload(&state, &account).await?))
}

/// The answer of `POST /v1/me/exports`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ExportQueued {
    pub status: ExportStatus,
}

/// Requests a download of the member's data. At most one request per 24 hours.
#[utoipa::path(
    post,
    path = "/me/exports",
    tag = "account",
    security(("bearer" = [])),
    responses(
        (status = 202, body = ExportQueued),
        (status = 403, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn post_export(
    State(state): State<AppState>,
    account: Open,
) -> ApiResult<(StatusCode, Json<ExportQueued>)> {
    let export_id = accounts::create_export(&state, account.user_id).await?;
    tracing::info!(
        event = "account.export_requested",
        user_id = %account.user_id,
        %export_id,
        "data export requested"
    );
    Ok((
        StatusCode::ACCEPTED,
        Json(ExportQueued {
            status: ExportStatus::Queued,
        }),
    ))
}

/// The status of the latest export, with a download link once it is ready.
#[derive(Debug, Serialize, ToSchema)]
pub struct LatestExport {
    pub status: ExportStatus,
    /// A signed link, only while `status` is `ready`.
    pub download_url: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
}

/// Status and download link of the latest export.
#[utoipa::path(
    get,
    path = "/me/exports/latest",
    tag = "account",
    security(("bearer" = [])),
    responses(
        (status = 200, body = LatestExport),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_latest_export(
    State(state): State<AppState>,
    account: Open,
) -> ApiResult<Json<LatestExport>> {
    let export = accounts::latest_export(&state.db, account.user_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let now = OffsetDateTime::now_utc();
    // The cleanup job only marks old exports `expired` once a day.
    let expired = export.expires_at.is_some_and(|at| at <= now);
    let status = match export.status {
        ExportStatus::Ready if expired => ExportStatus::Expired,
        other => other,
    };
    let download_url = match (status, &export.file_key, export.expires_at) {
        (ExportStatus::Ready, Some(key), expires_at) => {
            let remaining = expires_at.map_or(DOWNLOAD_LINK_TTL, |at| {
                Duration::from_secs(u64::try_from((at - now).whole_seconds()).unwrap_or(0))
            });
            Some(
                state
                    .storage
                    .presign_get(key, remaining.min(DOWNLOAD_LINK_TTL))
                    .await?,
            )
        }
        _ => None,
    };
    Ok(Json(LatestExport {
        status,
        download_url,
        expires_at: export.expires_at,
    }))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use time::format_description::well_known::Rfc3339;
    use time::{Duration, OffsetDateTime};

    use crate::db::admin::test_util::{audit_total, queued_emails};
    use crate::domain::types::UserRole;
    use crate::realtime::hub::close_code;
    use crate::test_support::TestApp;

    fn confirm(reason: Option<&str>) -> Value {
        json!({ "reason": reason, "confirm": "DELETE" })
    }

    #[sqlx::test]
    async fn requesting_deletion_hides_the_account_until_it_is_cancelled(db: PgPool) {
        let app = TestApp::new(db).await;
        let member = app.member().await;
        let mut socket = app.state.hub.register(member.profile_id, member.user_id);
        let url = "/v1/me/deletion";

        // The typed confirmation and the reason length are checked.
        let wrong = app
            .post(url, Some(&member.token), json!({ "confirm": "delete" }))
            .await;
        assert_eq!(wrong.field_errors(), vec!["confirm:mismatch"]);
        let missing = app.post(url, Some(&member.token), json!({})).await;
        assert_eq!(missing.code(), "bad_request");
        let long = app
            .post(
                url,
                Some(&member.token),
                json!({ "reason": "x".repeat(301), "confirm": "DELETE" }),
            )
            .await;
        assert_eq!(long.field_errors(), vec!["reason:too_long"]);
        assert_eq!(
            app.post(url, None, confirm(None)).await.status,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["gate"],
            "ok"
        );

        let response = app
            .post(
                url,
                Some(&member.token),
                confirm(Some("Found a match elsewhere")),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["user"]["status"], "deletion_scheduled");
        assert_eq!(response.json["gate"], "deletion_scheduled");
        let purge_after = OffsetDateTime::parse(
            response.json["user"]["purge_after"].as_str().unwrap(),
            &Rfc3339,
        )
        .unwrap();
        let wait = purge_after - OffsetDateTime::now_utc();
        assert!(
            wait > Duration::days(30) - Duration::minutes(5) && wait <= Duration::days(30),
            "{wait}"
        );

        // The profile row is untouched, so cancelling restores the exact previous state.
        let (profile_status, requested): (String, bool) = sqlx::query_as(
            "SELECT p.status, u.deletion_requested_at IS NOT NULL FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(member.user_id).fetch_one(app.db()).await.unwrap();
        assert_eq!((profile_status.as_str(), requested), ("active", true));
        let emails = queued_emails(app.db(), member.user_id, "account_deletion").await;
        assert_eq!(emails.len(), 1);
        assert_eq!(emails[0]["data"]["form"], "scheduled");
        assert!(emails[0]["data"]["purge_after"].is_i64());
        assert_eq!(emails[0]["priority"], 1);

        // Sockets are told and closed.
        assert_eq!(socket.closer.closed().await, close_code::NOT_ALLOWED);
        let frame: Value = serde_json::from_str(&socket.receiver.try_recv().unwrap()).unwrap();
        assert_eq!(
            frame,
            json!({ "type": "gate.changed", "data": { "gate": "deletion_scheduled" } })
        );

        // Only `auth` routes work; everything else says why.
        let blocked = app
            .patch("/v1/me", Some(&member.token), json!({ "locale": "ur" }))
            .await;
        assert_eq!(blocked.status, StatusCode::FORBIDDEN);
        assert_eq!(blocked.code(), "account_deletion_scheduled");
        assert!(blocked.json["error"]["details"]["purge_after"].is_string());
        assert_eq!(
            app.post_empty("/v1/me/exports", Some(&member.token))
                .await
                .code(),
            "account_deletion_scheduled"
        );
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["gate"],
            "deletion_scheduled"
        );
        let twice = app.post(url, Some(&member.token), confirm(None)).await;
        assert_eq!(twice.status, StatusCode::CONFLICT);
        assert_eq!(twice.code(), "invalid_state");

        // Cancelling.
        sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
            .bind(member.profile_id)
            .execute(app.db())
            .await
            .unwrap();
        let cancelled = app.delete(url, Some(&member.token)).await;
        assert_eq!(cancelled.status, StatusCode::OK, "{}", cancelled.text);
        assert_eq!(cancelled.json["user"]["status"], "active");
        assert_eq!(cancelled.json["gate"], "ok");
        assert!(cancelled.json["user"]["purge_after"].is_null());
        let (requested, stale): (bool, bool) = sqlx::query_as(
            "SELECT u.deletion_requested_at IS NOT NULL, p.match_stale FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(member.user_id).fetch_one(app.db()).await.unwrap();
        assert_eq!((requested, stale), (false, true));
        assert_eq!(
            app.patch("/v1/me", Some(&member.token), json!({ "locale": "ur" }))
                .await
                .status,
            StatusCode::OK
        );
        let emails = queued_emails(app.db(), member.user_id, "account_deletion").await;
        assert_eq!(emails[1]["data"]["form"], "cancelled");
        let nothing = app.delete(url, Some(&member.token)).await;
        assert_eq!(nothing.status, StatusCode::CONFLICT);
        assert_eq!(
            audit_total(app.db()).await,
            0,
            "a member action is not audited"
        );
    }

    #[sqlx::test]
    async fn the_grace_period_comes_from_the_setting(db: PgPool) {
        let app = TestApp::new(db).await;
        let member = app.member().await;
        app.state
            .settings
            .put("account.deletion_grace_days", &json!(7), None)
            .await
            .unwrap();
        let response = app
            .post("/v1/me/deletion", Some(&member.token), confirm(None))
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        let purge_after = OffsetDateTime::parse(
            response.json["user"]["purge_after"].as_str().unwrap(),
            &Rfc3339,
        )
        .unwrap();
        let wait = purge_after - OffsetDateTime::now_utc();
        assert!(
            wait > Duration::days(7) - Duration::minutes(5) && wait <= Duration::days(7),
            "{wait}"
        );
        assert_eq!(response.json["config"]["deletion_grace_days"], 7);
    }

    #[sqlx::test]
    async fn suspended_and_banned_members_keep_their_status_when_they_ask_for_deletion(db: PgPool) {
        let app = TestApp::new(db).await;
        for (status, code) in [
            ("suspended", "account_suspended"),
            ("banned", "account_banned"),
        ] {
            let member = app.member().await;
            sqlx::query("UPDATE users SET status = $2, status_reason = 'Reason shown to the member' WHERE id = $1")
                .bind(member.user_id).bind(status).execute(app.db()).await.unwrap();
            sqlx::query("UPDATE profiles SET status = 'suspended' WHERE id = $1")
                .bind(member.profile_id)
                .execute(app.db())
                .await
                .unwrap();
            app.state.accounts.invalidate(member.user_id);

            // A sanctioned member cannot use other routes, but may export nothing either.
            assert_eq!(
                app.post_empty("/v1/me/exports", Some(&member.token))
                    .await
                    .code(),
                code
            );
            let response = app
                .post("/v1/me/deletion", Some(&member.token), confirm(None))
                .await;
            assert_eq!(
                response.status,
                StatusCode::OK,
                "{status}: {}",
                response.text
            );
            assert_eq!(
                response.json["user"]["status"], status,
                "the sanction cannot be escaped"
            );
            assert_eq!(response.json["gate"], status);
            assert!(response.json["user"]["purge_after"].is_string());
            assert_eq!(
                app.patch("/v1/me", Some(&member.token), json!({ "locale": "ur" }))
                    .await
                    .code(),
                code
            );
            let twice = app
                .post("/v1/me/deletion", Some(&member.token), confirm(None))
                .await;
            assert_eq!(twice.status, StatusCode::CONFLICT);

            let cancelled = app.delete("/v1/me/deletion", Some(&member.token)).await;
            assert_eq!(cancelled.status, StatusCode::OK, "{}", cancelled.text);
            assert_eq!(
                cancelled.json["user"]["status"], status,
                "cancelling never lifts a sanction"
            );
            assert!(cancelled.json["user"]["purge_after"].is_null());
            let (user, profile): (String, String) = sqlx::query_as(
                "SELECT u.status, p.status FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
            )
            .bind(member.user_id).fetch_one(app.db()).await.unwrap();
            assert_eq!((user.as_str(), profile.as_str()), (status, "suspended"));
        }
    }

    /// The ban list survives the purge of a banned account (06 section 9.4).
    #[sqlx::test]
    async fn a_banned_member_who_asked_for_deletion_is_purged_and_stays_on_the_ban_list(
        db: PgPool,
    ) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let member = app.member().await;
        sqlx::query("INSERT INTO profile_identity (profile_id, document_type, number_encrypted, number_hash, number_last4) VALUES ($1, 'cnic', $2, $3, '5671')")
            .bind(member.profile_id)
            .bind(app.state.crypto.encrypt_identity(member.profile_id, "3520212345671"))
            .bind(app.state.crypto.keyed_hash("pk_id", "3520212345671"))
            .execute(app.db()).await.unwrap();
        let banned = app
            .post(
                &format!("/v1/admin/users/{}/ban", member.user_id),
                Some(&admin.token),
                json!({ "reason": "This account was closed for fraud." }),
            )
            .await;
        assert_eq!(banned.status, StatusCode::OK, "{}", banned.text);
        let response = app
            .post("/v1/me/deletion", Some(&member.token), confirm(None))
            .await;
        assert_eq!(response.status, StatusCode::OK);

        // Not due yet: a purge run leaves the account alone.
        sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('purge_accounts', '{}')")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;
        let status: String = sqlx::query_scalar("SELECT status FROM users WHERE id = $1")
            .bind(member.user_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(status, "banned");

        sqlx::query("UPDATE users SET purge_after = now() - interval '1 minute' WHERE id = $1")
            .bind(member.user_id)
            .execute(app.db())
            .await
            .unwrap();
        sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('purge_accounts', '{}')")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;
        let (status, email, profile): (String, Option<String>, String) = sqlx::query_as(
            "SELECT u.status, u.email, p.status FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(member.user_id).fetch_one(app.db()).await.unwrap();
        assert_eq!(
            (status.as_str(), email, profile.as_str()),
            ("deleted", None, "deleted")
        );
        let listed: i64 = sqlx::query_scalar("SELECT count(*) FROM banned_identities")
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(
            listed, 2,
            "the identity number and the email stay on the block list"
        );
    }

    /// T-506: with the grace period at zero, a request is purged by the next run.
    #[sqlx::test]
    async fn with_no_grace_period_the_next_purge_removes_the_account(db: PgPool) {
        let app = TestApp::new(db).await;
        let member = app.member().await;
        app.state
            .settings
            .put("account.deletion_grace_days", &json!(0), None)
            .await
            .unwrap();
        let response = app
            .post("/v1/me/deletion", Some(&member.token), confirm(None))
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["user"]["status"], "deletion_scheduled");

        sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('purge_accounts', '{}')")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;
        let (status, email, first_name): (String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT u.status, u.email, p.first_name
             FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(member.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(
            (status.as_str(), email, first_name),
            ("deleted", None, None)
        );
    }
}
