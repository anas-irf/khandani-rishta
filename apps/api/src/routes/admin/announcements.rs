//! Staff routes: announcements (15 section 16, 18 section 7.3).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Admin;
use crate::db::admin::announcements::{self, Announcement};
use crate::error::{ApiResult, ErrorBody, FieldCode, FieldErrors};
use crate::extract::ApiJson;
use crate::models::admin::AnnouncementAccepted;
use crate::state::AppState;

const MAX_TEXT_CHARS: usize = 300;
const MAX_URL_CHARS: usize = 500;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(send_announcement))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AnnouncementBody {
    /// 1 to 300 characters.
    pub text_en: String,
    /// Up to 300 characters, shown to members who use Urdu.
    pub text_ur: Option<String>,
    /// Must start with `https://`.
    pub url: Option<String>,
}

/// Sends one notification to every active member (admin only). At most one per 24 hours; it
/// cannot be recalled. Answers `202`: the `announcement_fanout` job does the work.
#[utoipa::path(
    post,
    path = "/announcements",
    tag = "admin",
    security(("bearer" = [])),
    request_body = AnnouncementBody,
    responses(
        (status = 202, body = AnnouncementAccepted),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn send_announcement(
    State(state): State<AppState>,
    admin: Admin,
    ApiJson(body): ApiJson<AnnouncementBody>,
) -> ApiResult<(StatusCode, Json<AnnouncementAccepted>)> {
    let mut errors = FieldErrors::new();
    let text_en = body.text_en.trim().to_owned();
    match text_en.chars().count() {
        0 => errors.add("text_en", FieldCode::Required),
        1..=MAX_TEXT_CHARS => {}
        _ => errors.add("text_en", FieldCode::TooLong),
    }
    let text_ur = body
        .text_ur
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned);
    if text_ur
        .as_ref()
        .is_some_and(|text| text.chars().count() > MAX_TEXT_CHARS)
    {
        errors.add("text_ur", FieldCode::TooLong);
    }
    let url = body
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_owned);
    if url.as_ref().is_some_and(|url| {
        !url.starts_with("https://")
            || url.chars().count() > MAX_URL_CHARS
            || url.chars().any(char::is_whitespace)
    }) {
        errors.add("url", FieldCode::Invalid);
    }
    errors.finish()?;

    let estimate = announcements::send(
        &state,
        admin.user_id,
        &Announcement {
            text_en,
            text_ur,
            url,
        },
    )
    .await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(AnnouncementAccepted {
            recipients_estimate: estimate,
        }),
    ))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;

    use crate::db::admin::test_util::{audit_details, audit_total};
    use crate::domain::types::UserRole;
    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn an_announcement_is_validated_queued_audited_and_limited_to_one_a_day(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let url = "/v1/admin/announcements";
        let body =
            json!({ "text_en": "Eid Mubarak from the team", "url": "https://example.com/eid" });

        assert_eq!(
            app.post(url, Some(&moderator.token), body.clone())
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.post(url, Some(&member.token), body.clone())
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.post(url, None, body.clone()).await.status,
            StatusCode::UNAUTHORIZED
        );

        for (bad, expected) in [
            (json!({ "text_en": "" }), "text_en:required"),
            (json!({ "text_en": "   " }), "text_en:required"),
            (json!({ "text_en": "x".repeat(301) }), "text_en:too_long"),
            (
                json!({ "text_en": "Hello", "text_ur": "x".repeat(301) }),
                "text_ur:too_long",
            ),
            (
                json!({ "text_en": "Hello", "url": "http://example.com" }),
                "url:invalid",
            ),
            (
                json!({ "text_en": "Hello", "url": "ftp://example.com" }),
                "url:invalid",
            ),
        ] {
            let response = app.post(url, Some(&admin.token), bad.clone()).await;
            assert_eq!(response.status, StatusCode::BAD_REQUEST, "{bad}");
            assert_eq!(response.field_errors(), vec![expected], "{bad}");
        }
        assert_eq!(
            app.post(
                url,
                Some(&admin.token),
                json!({ "text_en": "Hi", "audience": "all" })
            )
            .await
            .code(),
            "bad_request"
        );
        assert_eq!(audit_total(app.db()).await, 0);
        assert_eq!(
            app.queued_jobs("announcement_fanout").await,
            Vec::<serde_json::Value>::new()
        );

        let response = app.post(url, Some(&admin.token), body).await;
        assert_eq!(response.status, StatusCode::ACCEPTED, "{}", response.text);
        assert_eq!(
            response.json["recipients_estimate"], 3,
            "the admin, the moderator and the member"
        );
        assert_eq!(
            app.queued_jobs("announcement_fanout").await,
            vec![json!({
                "announcement": { "text_en": "Eid Mubarak from the team", "text_ur": null, "url": "https://example.com/eid" },
                "after_user_id": null,
                "send_email": true,
            })]
        );
        assert_eq!(
            audit_details(app.db(), "announcement.send").await,
            vec![
                json!({ "text_en": "Eid Mubarak from the team", "url": "https://example.com/eid", "recipients_estimate": 3 })
            ]
        );
        let target: (String, String) =
            sqlx::query_as("SELECT target_type, target_id FROM admin_audit_log")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(
            target,
            ("app_setting".to_owned(), "announcement".to_owned())
        );

        // At most one per 24 hours.
        let again = app
            .post(url, Some(&admin.token), json!({ "text_en": "Another one" }))
            .await;
        assert_eq!(again.status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(again.code(), "limit_reached");
        assert_eq!(
            again.json["error"]["details"]["limit"],
            "announcements_per_day"
        );
        assert!(again.json["error"]["details"]["resets_at"].is_string());
        assert_eq!(app.queued_jobs("announcement_fanout").await.len(), 1);
        assert_eq!(audit_total(app.db()).await, 1);

        sqlx::query("UPDATE admin_audit_log SET created_at = now() - interval '25 hours'")
            .execute(app.db())
            .await
            .unwrap();
        let later = app
            .post(
                url,
                Some(&admin.token),
                json!({ "text_en": "Another one", "text_ur": "ایک اور" }),
            )
            .await;
        assert_eq!(later.status, StatusCode::ACCEPTED, "{}", later.text);
        assert_eq!(audit_total(app.db()).await, 2);
    }
}
