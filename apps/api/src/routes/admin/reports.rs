//! Staff routes: the report queue (15 section 16, 18 section 4.5).

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::Moderator;
use crate::db::admin::reports::{self, QueueCursor, ReportRow};
use crate::db::pagination::{Page, PageParams};
use crate::domain::types::{ReportStatus, ReportSubject};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::admin::{
    AdminReportDetail, AdminReportListItem, ReportPhoto, from_micros, to_micros,
};
use crate::models::photos::sign;
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_reports))
        .routes(routes!(get_report))
        .routes(routes!(claim_report))
        .routes(routes!(resolve_report))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ReportsQuery {
    /// `open` (default), `in_review`, `actioned` or `dismissed`.
    pub status: Option<ReportStatus>,
}

/// The report queue: by priority (13 section 6.5), then oldest first.
#[utoipa::path(
    get,
    path = "/reports",
    tag = "admin",
    security(("bearer" = [])),
    params(ReportsQuery, PageParams),
    responses(
        (status = 200, body = Page<AdminReportListItem>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_reports(
    State(state): State<AppState>,
    _staff: Moderator,
    ApiQuery(query): ApiQuery<ReportsQuery>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<Page<AdminReportListItem>>> {
    let limit = page.limit();
    let cursor: Option<QueueCursor> = page
        .cursor::<(i32, i64, Uuid)>()?
        .map(|(priority, micros, id)| (priority, from_micros(micros), id));
    let status = query.status.unwrap_or(ReportStatus::Open);
    let rows = reports::queue(&state.db, status, cursor, limit).await?;
    Ok(Json(Page::from_rows(
        rows,
        limit,
        |row| (row.priority, to_micros(row.created_at), row.report_id),
        |row| row.item(),
    )))
}

/// The detail of one report row: the photo, the target and reporter summaries and the related
/// reports.
async fn build_detail(state: &AppState, row: ReportRow) -> ApiResult<AdminReportDetail> {
    let db = &state.db;
    let photo = if row.subject_type == ReportSubject::Photo {
        report_photo(state, &row).await?
    } else {
        None
    };
    let reporter_summary = match row.reporter_profile_id {
        Some(profile_id) => Some(reports::filed_by(db, profile_id).await?),
        None => None,
    };
    Ok(AdminReportDetail {
        item: row.item(),
        details: row.details.clone(),
        context: row.context.clone(),
        photo,
        resolution_note: row.resolution_note.clone(),
        handled_at: row.handled_at,
        target_summary: reports::target_summary(db, &row).await?,
        reporter_summary,
        related_reports: reports::related(db, row.target_profile_id, row.report_id).await?,
    })
}

/// The reported photo with an unblurred URL. When the photo row is gone, the keys snapshotted in
/// the report's context are used: the objects are kept 30 more days (13 section 6.3 rule 3).
async fn report_photo(state: &AppState, row: &ReportRow) -> ApiResult<Option<ReportPhoto>> {
    if let Some(photo_id) = row.photo_id
        && let Some((id, status, key_large)) = reports::photo_of(&state.db, photo_id).await?
    {
        return Ok(Some(ReportPhoto {
            photo_id: id,
            status: Some(status),
            large_url: sign(state.storage.as_ref(), key_large.as_deref()).await,
        }));
    }
    let Some(context) = &row.context else {
        return Ok(None);
    };
    let Some(photo_id) = context
        .get("photo_id")
        .and_then(|id| id.as_str())
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(None);
    };
    Ok(Some(ReportPhoto {
        photo_id,
        status: context
            .get("status")
            .and_then(|status| status.as_str())
            .map(str::to_owned),
        large_url: sign(
            state.storage.as_ref(),
            context.get("key_large").and_then(|key| key.as_str()),
        )
        .await,
    }))
}

async fn detail(state: &AppState, report_id: Uuid) -> ApiResult<Json<AdminReportDetail>> {
    let row = reports::get(&state.db, report_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(build_detail(state, row).await?))
}

/// One report with its context, the target's history and related reports.
#[utoipa::path(
    get,
    path = "/reports/{report_id}",
    tag = "admin",
    security(("bearer" = [])),
    params(("report_id" = Uuid, Path, description = "Report id")),
    responses(
        (status = 200, body = AdminReportDetail),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_report(
    State(state): State<AppState>,
    _staff: Moderator,
    ApiPath(report_id): ApiPath<Uuid>,
) -> ApiResult<Json<AdminReportDetail>> {
    detail(&state, report_id).await
}

/// `open` to `in_review`. `409` when someone else claimed it.
#[utoipa::path(
    post,
    path = "/reports/{report_id}/claim",
    tag = "admin",
    security(("bearer" = [])),
    params(("report_id" = Uuid, Path, description = "Report id")),
    responses(
        (status = 200, body = AdminReportDetail),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn claim_report(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(report_id): ApiPath<Uuid>,
) -> ApiResult<Json<AdminReportDetail>> {
    reports::claim(&state, staff.user_id, report_id).await?;
    detail(&state, report_id).await
}

/// How a report was decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Actioned,
    Dismissed,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ResolveBody {
    pub outcome: Outcome,
    /// For staff only. 10 to 1,000 characters.
    pub note: String,
}

/// Decides a report. Allowed from `in_review`, and from `open` only as `dismissed` (bulk
/// dismissal of duplicates).
#[utoipa::path(
    post,
    path = "/reports/{report_id}/resolve",
    tag = "admin",
    security(("bearer" = [])),
    params(("report_id" = Uuid, Path, description = "Report id")),
    request_body = ResolveBody,
    responses(
        (status = 200, body = AdminReportDetail),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn resolve_report(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(report_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ResolveBody>,
) -> ApiResult<Json<AdminReportDetail>> {
    let note = body.note.trim();
    match note.chars().count() {
        0 => return Err(ApiError::field("note", FieldCode::Required)),
        1..=9 => return Err(ApiError::field("note", FieldCode::TooShort)),
        10..=1000 => {}
        _ => return Err(ApiError::field("note", FieldCode::TooLong)),
    }
    let outcome = match body.outcome {
        Outcome::Actioned => ReportStatus::Actioned,
        Outcome::Dismissed => ReportStatus::Dismissed,
    };
    reports::resolve(&state, staff.user_id, report_id, outcome, note).await?;
    detail(&state, report_id).await
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::db::admin::test_util::{audit_details, audit_total, email_of};
    use crate::domain::options::Gender;
    use crate::domain::types::UserRole;
    use crate::test_support::{TestApp, TestUser};

    async fn file_report(
        app: &TestApp,
        reporter: &TestUser,
        target: &TestUser,
        reason: &str,
    ) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason)
             VALUES ($1, $2, 'profile', $3) RETURNING id",
        )
        .bind(reporter.profile_id)
        .bind(target.profile_id)
        .bind(reason)
        .fetch_one(app.db())
        .await
        .unwrap()
    }

    #[sqlx::test]
    async fn the_queue_is_ordered_by_priority_then_age(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let reporters = [
            app.member_of(Gender::Female).await,
            app.member_of(Gender::Female).await,
            app.member_of(Gender::Female).await,
        ];
        let target = app.member().await;
        let other_target = app.member().await;
        let crowded = app.member().await;

        let low = file_report(&app, &reporters[0], &other_target, "other").await;
        let medium = file_report(&app, &reporters[0], &target, "harassment").await;
        let urgent = file_report(&app, &reporters[1], &target, "underage").await;
        let system: Uuid = sqlx::query_scalar(
            "INSERT INTO reports (source, target_profile_id, subject_type, reason)
             VALUES ('system', $1, 'profile', 'fake_profile') RETURNING id",
        )
        .bind(other_target.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        // Three open reports from different reporters move a target to priority 1 (13 section 6.5).
        let mut crowd = Vec::new();
        for reporter in &reporters {
            crowd.push(file_report(&app, reporter, &crowded, "other").await);
        }

        let response = app.get("/v1/admin/reports", Some(&moderator.token)).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        let items = response.json["items"].as_array().unwrap();
        let order: Vec<(String, i64)> = items
            .iter()
            .map(|item| {
                (
                    item["report_id"].as_str().unwrap().to_owned(),
                    item["priority"].as_i64().unwrap(),
                )
            })
            .collect();
        let expected_priority_1: Vec<String> = [urgent, system, crowd[0], crowd[1], crowd[2]]
            .iter()
            .map(ToString::to_string)
            .collect();
        assert_eq!(
            order
                .iter()
                .filter(|(_, priority)| *priority == 1)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>(),
            expected_priority_1,
            "priority 1 first, oldest first"
        );
        assert_eq!(order[5], (medium.to_string(), 2));
        assert_eq!(order[6], (low.to_string(), 3));
        assert_eq!(order.len(), 7);

        let first = &items[0];
        assert_eq!(first["source"], "member");
        assert_eq!(first["reason"], "underage");
        assert_eq!(first["subject_type"], "profile");
        assert_eq!(first["status"], "open");
        assert_eq!(first["target"]["public_code"].as_str().unwrap().len(), 10);
        assert_eq!(first["target"]["first_name"], "Ahmed");
        assert_eq!(first["reporter"]["first_name"], "Ayesha");
        assert_eq!(first["open_reports_on_target"], 2);
        assert!(first["handled_by_email"].is_null());
        assert!(
            items[1]["reporter"].is_null(),
            "a system report has no reporter"
        );

        // Paging keeps the order.
        let page = app
            .get("/v1/admin/reports?limit=3", Some(&moderator.token))
            .await;
        let cursor = page.json["next_cursor"].as_str().unwrap().to_owned();
        let rest = app
            .get(
                &format!("/v1/admin/reports?limit=10&cursor={cursor}"),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(rest.json["items"].as_array().unwrap().len(), 4);
        assert_eq!(rest.json["items"][0]["report_id"], order[3].0);

        assert_eq!(
            app.get("/v1/admin/reports", Some(&reporters[0].token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        let none = app
            .get("/v1/admin/reports?status=actioned", Some(&moderator.token))
            .await;
        assert_eq!(none.json["items"].as_array().unwrap().len(), 0);
    }

    #[sqlx::test]
    async fn claiming_and_resolving_follow_the_workflow_and_write_one_audit_row_each(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let colleague = app.staff(UserRole::Moderator).await;
        let reporter = app.member_of(Gender::Female).await;
        let target = app.member().await;
        let report = file_report(&app, &reporter, &target, "harassment").await;
        let duplicate = file_report(&app, &reporter, &target, "harassment").await;
        let note = "Reviewed the chat excerpt, no violation found";

        // Claim: open to in_review, once.
        let claim = format!("/v1/admin/reports/{report}/claim");
        assert_eq!(
            app.post_empty(&claim, Some(&reporter.token)).await.status,
            StatusCode::FORBIDDEN
        );
        let claimed = app.post_empty(&claim, Some(&moderator.token)).await;
        assert_eq!(claimed.status, StatusCode::OK, "{}", claimed.text);
        assert_eq!(claimed.json["status"], "in_review");
        assert_eq!(
            claimed.json["handled_by_email"],
            email_of(app.db(), moderator.user_id).await
        );
        let taken = app.post_empty(&claim, Some(&colleague.token)).await;
        assert_eq!(taken.status, StatusCode::CONFLICT);
        assert_eq!(taken.code(), "invalid_state");
        assert_eq!(
            audit_details(app.db(), "report.claim").await,
            vec![json!({})]
        );

        // Resolve needs a note of 10 to 1,000 characters.
        let resolve = format!("/v1/admin/reports/{report}/resolve");
        let short = app
            .post(
                &resolve,
                Some(&moderator.token),
                json!({ "outcome": "dismissed", "note": "no" }),
            )
            .await;
        assert_eq!(short.field_errors(), vec!["note:too_short"]);
        let long = app
            .post(
                &resolve,
                Some(&moderator.token),
                json!({ "outcome": "dismissed", "note": "x".repeat(1001) }),
            )
            .await;
        assert_eq!(long.field_errors(), vec!["note:too_long"]);
        let bad_outcome = app
            .post(
                &resolve,
                Some(&moderator.token),
                json!({ "outcome": "banned", "note": note }),
            )
            .await;
        assert_eq!(bad_outcome.code(), "bad_request");
        assert_eq!(audit_total(app.db()).await, 1);

        // A duplicate is dismissed straight from open, but cannot be actioned from open.
        let dup_path = format!("/v1/admin/reports/{duplicate}/resolve");
        let from_open = app
            .post(
                &dup_path,
                Some(&moderator.token),
                json!({ "outcome": "actioned", "note": note }),
            )
            .await;
        assert_eq!(from_open.status, StatusCode::CONFLICT);
        let dismissed = app
            .post(
                &dup_path,
                Some(&moderator.token),
                json!({ "outcome": "dismissed", "note": "Duplicate of the report above" }),
            )
            .await;
        assert_eq!(dismissed.status, StatusCode::OK, "{}", dismissed.text);
        assert_eq!(dismissed.json["status"], "dismissed");
        assert_eq!(
            dismissed.json["resolution_note"],
            "Duplicate of the report above"
        );
        assert!(dismissed.json["handled_at"].is_string());

        let actioned = app
            .post(
                &resolve,
                Some(&colleague.token),
                json!({ "outcome": "actioned", "note": note }),
            )
            .await;
        assert_eq!(actioned.status, StatusCode::OK, "{}", actioned.text);
        assert_eq!(actioned.json["status"], "actioned");
        assert_eq!(
            actioned.json["handled_by_email"],
            email_of(app.db(), colleague.user_id).await
        );
        let twice = app
            .post(
                &resolve,
                Some(&moderator.token),
                json!({ "outcome": "dismissed", "note": note }),
            )
            .await;
        assert_eq!(twice.status, StatusCode::CONFLICT);
        assert_eq!(twice.json["error"]["details"]["status"], "actioned");

        assert_eq!(
            audit_details(app.db(), "report.resolve").await,
            vec![
                json!({ "outcome": "dismissed", "note": "Duplicate of the report above" }),
                json!({ "outcome": "actioned", "note": note }),
            ]
        );
        assert_eq!(audit_total(app.db()).await, 3, "claim and two resolutions");
        let listed = app
            .get("/v1/admin/reports?status=actioned", Some(&moderator.token))
            .await;
        assert_eq!(listed.json["items"].as_array().unwrap().len(), 1);
        let unknown = app
            .post_empty(
                &format!("/v1/admin/reports/{}/claim", Uuid::now_v7()),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn the_detail_carries_the_context_the_photo_and_the_histories(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let reporter = app.member_of(Gender::Female).await;
        let target = app.member().await;
        let admin = app.staff(UserRole::Admin).await;
        let photo_id: Uuid = sqlx::query_scalar(
            "INSERT INTO profile_photos (profile_id, status, upload_key, key_large) VALUES ($1, 'approved', 'tmp/a', 'photos/p/large.jpg') RETURNING id",
        )
        .bind(target.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        let report: Uuid = sqlx::query_scalar(
            "INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, photo_id, reason, details, context)
             VALUES ($1, $2, 'photo', $3, 'inappropriate_photo', 'Not suitable', $4) RETURNING id",
        )
        .bind(reporter.profile_id)
        .bind(target.profile_id)
        .bind(photo_id)
        .bind(json!({ "photo_id": photo_id, "status": "approved", "key_large": "photos/p/large.jpg" }))
        .fetch_one(app.db())
        .await
        .unwrap();
        let related = file_report(&app, &reporter, &target, "other").await;
        // A past warning and an actioned report in the target's history, and a report the
        // reporter filed that was dismissed.
        sqlx::query("INSERT INTO sanctions (user_id, type, reason, created_by) VALUES ($1, 'warning', 'Be polite', $2)")
            .bind(target.user_id).bind(admin.user_id).execute(app.db()).await.unwrap();
        sqlx::query("INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason, status) VALUES ($1, $2, 'profile', 'other', 'actioned'), ($3, $2, 'profile', 'other', 'dismissed')")
            .bind(admin.profile_id).bind(target.profile_id).bind(reporter.profile_id)
            .execute(app.db()).await.unwrap();

        let response = app
            .get(
                &format!("/v1/admin/reports/{report}"),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        let json = &response.json;
        assert_eq!(json["report_id"], report.to_string());
        assert_eq!(json["details"], "Not suitable");
        assert_eq!(json["context"]["key_large"], "photos/p/large.jpg");
        assert_eq!(json["photo"]["photo_id"], photo_id.to_string());
        assert_eq!(json["photo"]["status"], "approved");
        assert!(
            json["photo"]["large_url"]
                .as_str()
                .unwrap()
                .contains("photos/p/large.jpg")
        );
        assert_eq!(json["target_summary"]["user_status"], "active");
        assert_eq!(json["target_summary"]["profile_status"], "active");
        assert_eq!(json["target_summary"]["reports_against_total"], 4);
        assert_eq!(json["target_summary"]["reports_against_actioned"], 1);
        assert_eq!(json["target_summary"]["sanctions"][0]["type"], "warning");
        assert_eq!(
            json["target_summary"]["sanctions"][0]["created_by_email"],
            email_of(app.db(), admin.user_id).await
        );
        assert_eq!(
            json["reporter_summary"],
            json!({ "filed": 3, "actioned": 0, "dismissed": 1 })
        );
        let related_ids: Vec<&str> = json["related_reports"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["report_id"].as_str().unwrap())
            .collect();
        assert_eq!(related_ids, vec![related.to_string()]);
        assert_eq!(
            app.get(&format!("/v1/admin/reports/{report}"), Some(&target.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );

        // When the photo is deleted the snapshot in the context still shows it.
        sqlx::query("DELETE FROM profile_photos WHERE id = $1")
            .bind(photo_id)
            .execute(app.db())
            .await
            .unwrap();
        let after = app
            .get(
                &format!("/v1/admin/reports/{report}"),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(after.json["photo"]["photo_id"], photo_id.to_string());
        assert!(
            after.json["photo"]["large_url"]
                .as_str()
                .unwrap()
                .contains("photos/p/large.jpg")
        );
    }
}
