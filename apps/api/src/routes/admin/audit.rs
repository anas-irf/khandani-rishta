//! Staff routes: the audit log (15 section 16, 18 section 8).

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use utoipa::IntoParams;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::Admin;
use crate::db::admin::audit::{self, AuditFilter};
use crate::db::pagination::{Page, PageParams};
use crate::domain::types::AuditTargetType;
use crate::error::{ApiResult, ErrorBody};
use crate::extract::ApiQuery;
use crate::models::admin::{AuditEntry, from_micros, to_micros};
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_audit_log))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AuditQuery {
    /// Only entries written by this staff user.
    pub actor_user_id: Option<Uuid>,
    pub target_type: Option<AuditTargetType>,
    pub target_id: Option<String>,
    /// An action code of 18 section 8.3, for example `user.ban`.
    pub action: Option<String>,
}

/// Audit entries, newest first.
#[utoipa::path(
    get,
    path = "/audit-log",
    tag = "admin",
    security(("bearer" = [])),
    params(AuditQuery, PageParams),
    responses(
        (status = 200, body = Page<AuditEntry>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_audit_log(
    State(state): State<AppState>,
    _admin: Admin,
    ApiQuery(query): ApiQuery<AuditQuery>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<Page<AuditEntry>>> {
    let limit = page.limit();
    let cursor = page
        .cursor::<(i64, Uuid)>()?
        .map(|(micros, id)| (from_micros(micros), id));
    let filter = AuditFilter {
        actor_user_id: query.actor_user_id,
        target_type: query.target_type,
        target_id: query.target_id.filter(|id| !id.is_empty()),
        action: query.action.filter(|action| !action.is_empty()),
    };
    let rows = audit::list(&state.db, &filter, cursor, limit).await?;
    Ok(Json(Page::from_rows(
        rows,
        limit,
        |row| (to_micros(row.created_at), row.id),
        AuditEntry::from,
    )))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::db::admin::test_util::email_of;
    use crate::domain::options::Gender;
    use crate::domain::types::UserRole;
    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn the_log_is_read_by_admins_filtered_and_paged_newest_first(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let first = app.member().await;
        let second = app.member_of(Gender::Female).await;

        let warn = app
            .post(
                &format!("/v1/admin/users/{}/warn", first.user_id),
                Some(&moderator.token),
                json!({ "reason": "Please keep chats respectful" }),
            )
            .await;
        assert_eq!(warn.status, StatusCode::OK, "{}", warn.text);
        let suspend = app
            .post(
                &format!("/v1/admin/users/{}/suspend", second.user_id),
                Some(&admin.token),
                json!({ "reason": "Repeated rudeness in chat", "days": 3 }),
            )
            .await;
        assert_eq!(suspend.status, StatusCode::OK);
        let setting = app
            .put(
                "/v1/admin/settings/limits.photos_max",
                Some(&admin.token),
                json!({ "value": 4 }),
            )
            .await;
        assert_eq!(setting.status, StatusCode::OK);

        let all = app.get("/v1/admin/audit-log", Some(&admin.token)).await;
        assert_eq!(all.status, StatusCode::OK, "{}", all.text);
        let actions: Vec<&str> = all.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["action"].as_str().unwrap())
            .collect();
        assert_eq!(
            actions,
            vec!["setting.update", "user.suspend", "user.warn"],
            "newest first"
        );
        let entry = &all.json["items"][2];
        assert_eq!(entry["actor"]["user_id"], moderator.user_id.to_string());
        assert_eq!(
            entry["actor"]["email"],
            email_of(app.db(), moderator.user_id).await
        );
        assert_eq!(entry["target_type"], "user");
        assert_eq!(entry["target_id"], first.user_id.to_string());
        assert_eq!(entry["details"]["reason"], "Please keep chats respectful");
        assert!(entry["created_at"].is_string());
        assert!(entry["id"].is_string());

        let ids = |response: &crate::test_support::TestResponse| -> Vec<String> {
            response.json["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| e["action"].as_str().unwrap().to_owned())
                .collect()
        };
        let by_action = app
            .get("/v1/admin/audit-log?action=user.warn", Some(&admin.token))
            .await;
        assert_eq!(ids(&by_action), vec!["user.warn"]);
        let by_actor = app
            .get(
                &format!("/v1/admin/audit-log?actor_user_id={}", admin.user_id),
                Some(&admin.token),
            )
            .await;
        assert_eq!(ids(&by_actor), vec!["setting.update", "user.suspend"]);
        let by_type = app
            .get(
                "/v1/admin/audit-log?target_type=app_setting",
                Some(&admin.token),
            )
            .await;
        assert_eq!(ids(&by_type), vec!["setting.update"]);
        let by_target = app
            .get(
                &format!(
                    "/v1/admin/audit-log?target_type=user&target_id={}",
                    second.user_id
                ),
                Some(&admin.token),
            )
            .await;
        assert_eq!(ids(&by_target), vec!["user.suspend"]);
        let none = app
            .get(
                &format!("/v1/admin/audit-log?target_id={}", Uuid::now_v7()),
                Some(&admin.token),
            )
            .await;
        assert_eq!(none.json["items"], json!([]));
        assert_eq!(
            app.get("/v1/admin/audit-log?target_type=planet", Some(&admin.token))
                .await
                .status,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            app.get(
                "/v1/admin/audit-log?actor_user_id=nobody",
                Some(&admin.token)
            )
            .await
            .status,
            StatusCode::BAD_REQUEST
        );

        // Pages follow the same order without repeats.
        let page = app
            .get("/v1/admin/audit-log?limit=2", Some(&admin.token))
            .await;
        assert_eq!(ids(&page), vec!["setting.update", "user.suspend"]);
        let cursor = page.json["next_cursor"].as_str().unwrap().to_owned();
        let rest = app
            .get(
                &format!("/v1/admin/audit-log?limit=2&cursor={cursor}"),
                Some(&admin.token),
            )
            .await;
        assert_eq!(ids(&rest), vec!["user.warn"]);
        assert!(rest.json["next_cursor"].is_null());
        assert_eq!(
            app.get("/v1/admin/audit-log?cursor=garbage", Some(&admin.token))
                .await
                .status,
            StatusCode::BAD_REQUEST
        );

        // Only admins read it.
        assert_eq!(
            app.get("/v1/admin/audit-log", Some(&moderator.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.get("/v1/admin/audit-log", Some(&first.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.get("/v1/admin/audit-log", None).await.status,
            StatusCode::UNAUTHORIZED
        );
    }

    async fn call(
        app: &TestApp,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<&Value>,
    ) -> crate::test_support::TestResponse {
        app.request(method, path, token, body.cloned()).await
    }

    /// Every staff route refuses a member with 403, and the admin-only routes refuse a moderator.
    #[sqlx::test]
    async fn every_staff_route_refuses_members_and_admin_routes_refuse_moderators(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let id = Uuid::now_v7();
        let release = json!({
            "platform": "android", "version_code": 5, "version_name": "1.0.0",
            "min_supported_version_code": 1, "download_url": "https://download.example.com/a.apk",
        });

        // (method, path, body, admin only)
        let routes: Vec<(&str, String, Option<Value>, bool)> = vec![
            ("GET", "/v1/admin/overview".into(), None, false),
            ("GET", "/v1/admin/profiles".into(), None, false),
            ("GET", format!("/v1/admin/profiles/{id}"), None, false),
            (
                "POST",
                format!("/v1/admin/profiles/{id}/approve"),
                None,
                false,
            ),
            (
                "POST",
                format!("/v1/admin/profiles/{id}/request-changes"),
                Some(json!({ "reason": "Please add a clear photo." })),
                false,
            ),
            (
                "PATCH",
                format!("/v1/admin/profiles/{id}/locked-fields"),
                Some(json!({ "first_name": "Ahmad", "reason": "Name corrected after check" })),
                true,
            ),
            ("GET", "/v1/admin/reports".into(), None, false),
            ("GET", format!("/v1/admin/reports/{id}"), None, false),
            ("POST", format!("/v1/admin/reports/{id}/claim"), None, false),
            (
                "POST",
                format!("/v1/admin/reports/{id}/resolve"),
                Some(json!({ "outcome": "dismissed", "note": "Duplicate of another report" })),
                false,
            ),
            ("GET", "/v1/admin/users?q=abcd".into(), None, false),
            ("GET", format!("/v1/admin/users/{id}"), None, false),
            (
                "POST",
                format!("/v1/admin/users/{id}/warn"),
                Some(json!({ "reason": "Please be polite" })),
                false,
            ),
            (
                "POST",
                format!("/v1/admin/users/{id}/suspend"),
                Some(json!({ "reason": "Please be polite", "days": 7 })),
                false,
            ),
            (
                "POST",
                format!("/v1/admin/users/{id}/unsuspend"),
                None,
                false,
            ),
            (
                "POST",
                format!("/v1/admin/users/{id}/ban"),
                Some(json!({ "reason": "Fraud attempt" })),
                true,
            ),
            ("POST", format!("/v1/admin/users/{id}/unban"), None, true),
            (
                "PATCH",
                format!("/v1/admin/users/{id}/role"),
                Some(json!({ "role": "member" })),
                true,
            ),
            ("GET", "/v1/admin/caste-suggestions".into(), None, false),
            (
                "POST",
                format!("/v1/admin/caste-suggestions/{id}/promote"),
                Some(json!({ "code": "abc", "name": "Abc" })),
                true,
            ),
            (
                "POST",
                format!("/v1/admin/caste-suggestions/{id}/reject"),
                None,
                false,
            ),
            ("GET", "/v1/admin/castes".into(), None, false),
            (
                "POST",
                "/v1/admin/castes".into(),
                Some(json!({ "code": "abc", "name": "Abc" })),
                true,
            ),
            (
                "PATCH",
                "/v1/admin/castes/abc".into(),
                Some(json!({ "name": "Abcd" })),
                true,
            ),
            ("GET", "/v1/admin/settings".into(), None, true),
            (
                "PUT",
                "/v1/admin/settings/limits.photos_max".into(),
                Some(json!({ "value": 3 })),
                true,
            ),
            ("GET", "/v1/admin/releases".into(), None, true),
            ("POST", "/v1/admin/releases".into(), Some(release), true),
            (
                "POST",
                "/v1/admin/announcements".into(),
                Some(json!({ "text_en": "Hello" })),
                true,
            ),
            ("GET", "/v1/admin/audit-log".into(), None, true),
        ];

        for (method, path, body, admin_only) in &routes {
            let label = format!("{method} {path}");

            let anonymous = call(&app, method, path, None, body.as_ref()).await;
            assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED, "{label}");
            let as_member = call(&app, method, path, Some(&member.token), body.as_ref()).await;
            assert_eq!(as_member.status, StatusCode::FORBIDDEN, "{label}");
            assert_eq!(as_member.code(), "forbidden", "{label}");
            let as_moderator =
                call(&app, method, path, Some(&moderator.token), body.as_ref()).await;
            if *admin_only {
                assert_eq!(as_moderator.status, StatusCode::FORBIDDEN, "{label}");
            } else {
                assert_ne!(as_moderator.status, StatusCode::FORBIDDEN, "{label}");
                assert_ne!(as_moderator.status, StatusCode::UNAUTHORIZED, "{label}");
            }
            let as_admin = call(&app, method, path, Some(&admin.token), body.as_ref()).await;
            assert_ne!(as_admin.status, StatusCode::FORBIDDEN, "{label}");
            assert_ne!(as_admin.status, StatusCode::UNAUTHORIZED, "{label}");
            assert!(as_admin.status.as_u16() < 500, "{label}: {}", as_admin.text);
        }
    }

    /// Every route of this area is registered, so it reaches the OpenAPI document.
    #[test]
    fn the_openapi_document_lists_the_staff_and_account_routes() {
        let spec: Value = serde_json::from_str(&crate::openapi::spec_json().unwrap()).unwrap();
        let paths = spec["paths"].as_object().unwrap();
        for (path, methods) in [
            ("/v1/admin/overview", vec!["get"]),
            ("/v1/admin/profiles", vec!["get"]),
            ("/v1/admin/profiles/{profile_id}", vec!["get"]),
            ("/v1/admin/profiles/{profile_id}/approve", vec!["post"]),
            (
                "/v1/admin/profiles/{profile_id}/request-changes",
                vec!["post"],
            ),
            (
                "/v1/admin/profiles/{profile_id}/locked-fields",
                vec!["patch"],
            ),
            ("/v1/admin/reports", vec!["get"]),
            ("/v1/admin/reports/{report_id}", vec!["get"]),
            ("/v1/admin/reports/{report_id}/claim", vec!["post"]),
            ("/v1/admin/reports/{report_id}/resolve", vec!["post"]),
            ("/v1/admin/users", vec!["get"]),
            ("/v1/admin/users/{user_id}", vec!["get"]),
            ("/v1/admin/users/{user_id}/warn", vec!["post"]),
            ("/v1/admin/users/{user_id}/suspend", vec!["post"]),
            ("/v1/admin/users/{user_id}/unsuspend", vec!["post"]),
            ("/v1/admin/users/{user_id}/ban", vec!["post"]),
            ("/v1/admin/users/{user_id}/unban", vec!["post"]),
            ("/v1/admin/users/{user_id}/role", vec!["patch"]),
            ("/v1/admin/caste-suggestions", vec!["get"]),
            ("/v1/admin/caste-suggestions/{id}/promote", vec!["post"]),
            ("/v1/admin/caste-suggestions/{id}/reject", vec!["post"]),
            ("/v1/admin/castes", vec!["get", "post"]),
            ("/v1/admin/castes/{code}", vec!["patch"]),
            ("/v1/admin/settings", vec!["get"]),
            ("/v1/admin/settings/{key}", vec!["put"]),
            ("/v1/admin/releases", vec!["get", "post"]),
            ("/v1/admin/announcements", vec!["post"]),
            ("/v1/admin/audit-log", vec!["get"]),
            ("/v1/me/deletion", vec!["post", "delete"]),
            ("/v1/me/exports", vec!["post"]),
            ("/v1/me/exports/latest", vec!["get"]),
        ] {
            let item = paths
                .get(path)
                .unwrap_or_else(|| panic!("{path} is missing"));
            for method in methods {
                assert!(item.get(method).is_some(), "{method} {path} is missing");
            }
        }
    }
}
