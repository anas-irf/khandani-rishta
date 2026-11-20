//! Staff routes: Android release records (15 section 16, 18 section 7.2).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Admin;
use crate::db::admin::releases::{self, NewRelease};
use crate::error::{ApiResult, ErrorBody};
use crate::extract::ApiJson;
use crate::models::admin::{AdminRelease, Items};
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_releases, create_release))
}

/// The release records, newest first.
#[utoipa::path(
    get,
    path = "/releases",
    tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, body = Items<AdminRelease>), (status = 403, body = ErrorBody))
)]
async fn list_releases(
    State(state): State<AppState>,
    _admin: Admin,
) -> ApiResult<Json<Items<AdminRelease>>> {
    Ok(Json(Items {
        items: releases::list(&state.db).await?,
    }))
}

/// The platforms a release can be for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReleasePlatform {
    Android,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateReleaseBody {
    pub platform: ReleasePlatform,
    /// Must be greater than every existing `version_code`.
    pub version_code: i32,
    /// For example `1.3.0`.
    pub version_name: String,
    /// Not greater than `version_code`, not lower than the current minimum. Builds below it
    /// are forced to update (`426 upgrade_required`).
    pub min_supported_version_code: i32,
    /// Must start with `https://download.`.
    pub download_url: String,
    /// Up to 1,000 characters, shown in the update prompt.
    pub release_notes: Option<String>,
}

/// Records a build that CI has already uploaded (admin only). Rows are never edited or deleted:
/// to correct a mistake, publish a new record.
#[utoipa::path(
    post,
    path = "/releases",
    tag = "admin",
    security(("bearer" = [])),
    request_body = CreateReleaseBody,
    responses(
        (status = 201, body = AdminRelease),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn create_release(
    State(state): State<AppState>,
    admin: Admin,
    ApiJson(body): ApiJson<CreateReleaseBody>,
) -> ApiResult<(StatusCode, Json<AdminRelease>)> {
    let ReleasePlatform::Android = body.platform;
    let release = releases::publish(
        &state,
        admin.user_id,
        &NewRelease {
            version_code: body.version_code,
            version_name: body.version_name,
            min_supported_version_code: body.min_supported_version_code,
            download_url: body.download_url,
            release_notes: body.release_notes,
        },
    )
    .await?;
    Ok((StatusCode::CREATED, Json(release)))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use crate::db::admin::test_util::{audit_details, audit_total};
    use crate::domain::types::UserRole;
    use crate::test_support::{TestApp, TestUser};

    async fn as_android(
        app: &TestApp,
        user: &TestUser,
        version_code: u32,
    ) -> crate::test_support::TestResponse {
        let code = version_code.to_string();
        app.request_with_headers(
            "GET",
            "/v1/me",
            Some(&user.token),
            None,
            &[
                ("x-app-platform", "android"),
                ("x-app-version-code", code.as_str()),
            ],
        )
        .await
    }

    fn release(code: i64, min: i64) -> Value {
        json!({
            "platform": "android",
            "version_code": code,
            "version_name": format!("1.{code}.0"),
            "min_supported_version_code": min,
            "download_url": format!("https://download.example.com/kr-{code}.apk"),
            "release_notes": "Fixes and improvements",
        })
    }

    /// T-510: publishing a release changes the `426 upgrade_required` path.
    #[sqlx::test]
    async fn publishing_a_release_changes_who_must_update(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;

        // No release yet (and the empty answer is now cached): every build is welcome.
        assert_eq!(as_android(&app, &member, 7).await.status, StatusCode::OK);

        assert_eq!(
            app.post("/v1/admin/releases", Some(&moderator.token), release(10, 8))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        let created = app
            .post("/v1/admin/releases", Some(&admin.token), release(10, 8))
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{}", created.text);
        assert_eq!(created.json["platform"], "android");
        assert_eq!(created.json["version_code"], 10);
        assert_eq!(created.json["version_name"], "1.10.0");
        assert_eq!(created.json["min_supported_version_code"], 8);
        assert_eq!(created.json["release_notes"], "Fixes and improvements");
        assert!(created.json["released_at"].is_string());

        // The cached release was cleared: build 7 must update, build 8 may continue.
        let old = as_android(&app, &member, 7).await;
        assert_eq!(old.status.as_u16(), 426);
        assert_eq!(old.code(), "upgrade_required");
        assert_eq!(
            old.json["error"]["details"]["download_url"],
            "https://download.example.com/kr-10.apk"
        );
        assert_eq!(as_android(&app, &member, 8).await.status, StatusCode::OK);

        // A newer release raising the minimum locks build 8 out too.
        let second = app
            .post("/v1/admin/releases", Some(&admin.token), release(12, 11))
            .await;
        assert_eq!(second.status, StatusCode::CREATED, "{}", second.text);
        assert_eq!(as_android(&app, &member, 8).await.status.as_u16(), 426);
        assert_eq!(as_android(&app, &member, 11).await.status, StatusCode::OK);
        let meta = app.get("/v1/meta/app-release?platform=android", None).await;
        assert_eq!(meta.json["version_code"], 12);

        // The list is newest first.
        let list = app.get("/v1/admin/releases", Some(&admin.token)).await;
        let codes: Vec<i64> = list.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["version_code"].as_i64().unwrap())
            .collect();
        assert_eq!(codes, vec![12, 10]);
        assert_eq!(
            app.get("/v1/admin/releases", Some(&moderator.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );

        // One audit row per release, targeting the release.
        assert_eq!(
            audit_details(app.db(), "release.create").await,
            vec![
                json!({ "version_code": 10, "min_supported_version_code": 8 }),
                json!({ "version_code": 12, "min_supported_version_code": 11 }),
            ]
        );
        let target: (String, String) = sqlx::query_as(
            "SELECT target_type, target_id FROM admin_audit_log ORDER BY created_at LIMIT 1",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(target.0, "app_release");
        assert_eq!(target.1, created.json["id"].as_str().unwrap());
        assert_eq!(audit_total(app.db()).await, 2);
    }

    #[sqlx::test]
    async fn releases_follow_the_ordering_and_url_rules(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        assert_eq!(
            app.post("/v1/admin/releases", Some(&admin.token), release(10, 8))
                .await
                .status,
            StatusCode::CREATED
        );

        let mut cases: Vec<(Value, &str)> = vec![
            // The version code must be greater than every existing one.
            (release(10, 8), "version_code:out_of_range"),
            (release(9, 8), "version_code:out_of_range"),
            // The minimum is not greater than the version, and not lower than the current minimum.
            (release(11, 12), "min_supported_version_code:out_of_range"),
            (release(11, 7), "min_supported_version_code:out_of_range"),
        ];
        let mut bad_url = release(11, 8);
        bad_url["download_url"] = json!("https://example.com/kr.apk");
        cases.push((bad_url, "download_url:invalid"));
        let mut http_url = release(11, 8);
        http_url["download_url"] = json!("http://download.example.com/kr.apk");
        cases.push((http_url, "download_url:invalid"));
        let mut long_notes = release(11, 8);
        long_notes["release_notes"] = json!("x".repeat(1001));
        cases.push((long_notes, "release_notes:too_long"));
        let mut bad_name = release(11, 8);
        bad_name["version_name"] = json!("not a version!");
        cases.push((bad_name, "version_name:invalid"));
        for (body, expected) in cases {
            let response = app
                .post("/v1/admin/releases", Some(&admin.token), body.clone())
                .await;
            assert_eq!(response.status, StatusCode::BAD_REQUEST, "{body}");
            assert_eq!(response.field_errors(), vec![expected], "{body}");
        }
        let mut ios = release(11, 8);
        ios["platform"] = json!("ios");
        assert_eq!(
            app.post("/v1/admin/releases", Some(&admin.token), ios)
                .await
                .code(),
            "bad_request"
        );
        let mut extra = release(11, 8);
        extra["channel"] = json!("beta");
        assert_eq!(
            app.post("/v1/admin/releases", Some(&admin.token), extra)
                .await
                .code(),
            "bad_request"
        );
        assert_eq!(
            audit_total(app.db()).await,
            1,
            "only the first release was recorded"
        );

        // Without notes, with the same minimum.
        let mut plain = release(11, 8);
        plain["release_notes"] = Value::Null;
        let ok = app
            .post("/v1/admin/releases", Some(&admin.token), plain)
            .await;
        assert_eq!(ok.status, StatusCode::CREATED, "{}", ok.text);
        assert!(ok.json["release_notes"].is_null());
    }
}
