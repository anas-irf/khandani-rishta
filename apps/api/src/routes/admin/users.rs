//! Staff routes: user search, the account view and sanctions (15 section 16, 18 section 5).

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::account::AccountSnapshot;
use crate::auth::{Admin, Moderator};
use crate::db::admin::users::{self, UserSearch};
use crate::db::admin::{audit, reports};
use crate::db::pagination::{Page, PageParams};
use crate::domain::types::{UserRole, UserStatus};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::admin::{AdminUser, AdminUserListItem, from_micros, to_micros};
use crate::sanctions::{self, SanctionKind};
use crate::state::AppState;

/// Longest suspension a moderator may set, in days (18 section 5.3).
const MAX_SUSPENSION_DAYS: i64 = 365;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(search_users))
        .routes(routes!(get_user))
        .routes(routes!(warn_user))
        .routes(routes!(suspend_user))
        .routes(routes!(unsuspend_user))
        .routes(routes!(ban_user))
        .routes(routes!(unban_user))
        .routes(routes!(change_role))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct UsersQuery {
    /// At least 3 characters: an exact email, a phone number (7 or more digits, suffix match),
    /// an exact profile code, or the start of a first or last name.
    pub q: Option<String>,
    pub status: Option<UserStatus>,
    pub role: Option<UserRole>,
}

/// Searches accounts. At least one of `q`, `status` and `role` is required: the console has no
/// "browse members" screen on purpose (18 section 10).
#[utoipa::path(
    get,
    path = "/users",
    tag = "admin",
    security(("bearer" = [])),
    params(UsersQuery, PageParams),
    responses(
        (status = 200, body = Page<AdminUserListItem>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn search_users(
    State(state): State<AppState>,
    _staff: Moderator,
    ApiQuery(query): ApiQuery<UsersQuery>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<Page<AdminUserListItem>>> {
    let q = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(str::to_owned);
    if let Some(q) = &q
        && q.chars().count() < 3
    {
        return Err(ApiError::field("q", FieldCode::TooShort));
    }
    if q.is_none() && query.status.is_none() && query.role.is_none() {
        return Err(ApiError::field("q", FieldCode::Required));
    }
    let limit = page.limit();
    let cursor = page
        .cursor::<(i64, Uuid)>()?
        .map(|(micros, id)| (from_micros(micros), id));
    let filter = UserSearch {
        q,
        status: query.status,
        role: query.role,
    };
    let rows = users::search(&state.db, &filter, cursor, limit).await?;
    Ok(Json(Page::from_rows(
        rows,
        limit,
        |row| (to_micros(row.created_at), row.user_id),
        |row| row.item(),
    )))
}

/// The account view. `phone_e164` is only filled in for admins.
async fn load_user(state: &AppState, user_id: Uuid, viewer: UserRole) -> ApiResult<AdminUser> {
    let db = &state.db;
    let row = users::get(db, user_id).await?.ok_or(ApiError::NotFound)?;
    Ok(AdminUser {
        item: row.item(),
        email_verified: row.email_verified,
        phone_e164: if viewer == UserRole::Admin {
            row.phone_e164.clone()
        } else {
            None
        },
        phone_verified: row.phone_verified,
        status_reason: row.status_reason.clone(),
        suspended_until: row.suspended_until,
        deletion_requested_at: row.deletion_requested_at,
        purge_after: row.purge_after,
        locale: row.locale,
        devices: users::devices(db, user_id).await?,
        consents: users::consents(db, user_id).await?,
        sanctions: users::sanctions(db, user_id).await?,
        reports_against: reports::against(db, row.profile_id, 20).await?,
        reports_filed: reports::filed_by(db, row.profile_id).await?,
        flags: users::flags(db, row.profile_id).await?,
        audit: audit::for_user_and_profile(db, user_id, row.profile_id, 50).await?,
    })
}

/// One account: sanctions, devices, consents, reports and history.
#[utoipa::path(
    get,
    path = "/users/{user_id}",
    tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path, description = "User id")),
    responses(
        (status = 200, body = AdminUser),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_user(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(user_id): ApiPath<Uuid>,
) -> ApiResult<Json<AdminUser>> {
    Ok(Json(load_user(&state, user_id, staff.role).await?))
}

/// Who may act on whom (18 section 5.3): nobody on themselves, and only an admin on a staff
/// member. Answers `404` when the target does not exist.
async fn check_target(
    state: &AppState,
    actor: &AccountSnapshot,
    target: Uuid,
) -> ApiResult<(UserRole, UserStatus)> {
    let (role, status) = users::role_and_status(&state.db, target)
        .await?
        .ok_or(ApiError::NotFound)?;
    if target == actor.user_id || (role.is_staff() && actor.role != UserRole::Admin) {
        return Err(ApiError::Forbidden);
    }
    Ok((role, status))
}

/// The reason shown to the member: 3 to 500 characters (the schema limit).
fn check_reason(reason: &str) -> Result<String, ApiError> {
    let reason = reason.trim();
    match reason.chars().count() {
        0 => Err(ApiError::field("reason", FieldCode::Required)),
        1..=2 => Err(ApiError::field("reason", FieldCode::TooShort)),
        3..=500 => Ok(reason.to_owned()),
        _ => Err(ApiError::field("reason", FieldCode::TooLong)),
    }
}

/// A report a sanction is linked to must exist.
async fn check_report(state: &AppState, report_id: Option<Uuid>) -> ApiResult<()> {
    if let Some(report_id) = report_id
        && !reports::exists(&state.db, report_id).await?
    {
        return Err(ApiError::field("report_id", FieldCode::UnknownCode));
    }
    Ok(())
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WarnBody {
    /// Shown to the member. 3 to 500 characters.
    pub reason: String,
    pub report_id: Option<Uuid>,
}

/// Warns an `active` member: a notification and an email, no status change.
#[utoipa::path(
    post,
    path = "/users/{user_id}/warn",
    tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path, description = "User id")),
    request_body = WarnBody,
    responses(
        (status = 200, body = AdminUser),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn warn_user(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(user_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<WarnBody>,
) -> ApiResult<Json<AdminUser>> {
    check_target(&state, &staff, user_id).await?;
    let reason = check_reason(&body.reason)?;
    check_report(&state, body.report_id).await?;
    sanctions::warn(&state, user_id, &reason, body.report_id, staff.user_id).await?;
    Ok(Json(load_user(&state, user_id, staff.role).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SuspendBody {
    /// Shown to the member. 3 to 500 characters.
    pub reason: String,
    /// 1 to 365.
    pub days: i64,
    pub report_id: Option<Uuid>,
}

/// Suspends an `active` member for a number of days.
#[utoipa::path(
    post,
    path = "/users/{user_id}/suspend",
    tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path, description = "User id")),
    request_body = SuspendBody,
    responses(
        (status = 200, body = AdminUser),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn suspend_user(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(user_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SuspendBody>,
) -> ApiResult<Json<AdminUser>> {
    check_target(&state, &staff, user_id).await?;
    let reason = check_reason(&body.reason)?;
    if !(1..=MAX_SUSPENSION_DAYS).contains(&body.days) {
        return Err(ApiError::field("days", FieldCode::OutOfRange));
    }
    check_report(&state, body.report_id).await?;
    sanctions::apply(
        &state,
        user_id,
        SanctionKind::Suspension { days: body.days },
        &reason,
        body.report_id,
        Some(staff.user_id),
    )
    .await?;
    Ok(Json(load_user(&state, user_id, staff.role).await?))
}

/// Lifts a suspension.
#[utoipa::path(
    post,
    path = "/users/{user_id}/unsuspend",
    tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path, description = "User id")),
    responses(
        (status = 200, body = AdminUser),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn unsuspend_user(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(user_id): ApiPath<Uuid>,
) -> ApiResult<Json<AdminUser>> {
    let (_, status) = check_target(&state, &staff, user_id).await?;
    // A banned member is lifted through `unban`, which only admins may call.
    if status != UserStatus::Suspended {
        return Err(ApiError::invalid_state(status));
    }
    sanctions::lift(&state, user_id, Some(staff.user_id)).await?;
    Ok(Json(load_user(&state, user_id, staff.role).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BanBody {
    /// Shown to the member. 3 to 500 characters.
    pub reason: String,
    pub report_id: Option<Uuid>,
}

/// Bans an `active` or `suspended` member (admin only): connections end and the identity
/// number, email and phone go on the block list.
#[utoipa::path(
    post,
    path = "/users/{user_id}/ban",
    tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path, description = "User id")),
    request_body = BanBody,
    responses(
        (status = 200, body = AdminUser),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn ban_user(
    State(state): State<AppState>,
    admin: Admin,
    ApiPath(user_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<BanBody>,
) -> ApiResult<Json<AdminUser>> {
    check_target(&state, &admin, user_id).await?;
    let reason = check_reason(&body.reason)?;
    check_report(&state, body.report_id).await?;
    sanctions::apply(
        &state,
        user_id,
        SanctionKind::Ban,
        &reason,
        body.report_id,
        Some(admin.user_id),
    )
    .await?;
    Ok(Json(load_user(&state, user_id, admin.role).await?))
}

/// Lifts a ban (admin only).
#[utoipa::path(
    post,
    path = "/users/{user_id}/unban",
    tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path, description = "User id")),
    responses(
        (status = 200, body = AdminUser),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn unban_user(
    State(state): State<AppState>,
    admin: Admin,
    ApiPath(user_id): ApiPath<Uuid>,
) -> ApiResult<Json<AdminUser>> {
    let (_, status) = check_target(&state, &admin, user_id).await?;
    if status != UserStatus::Banned {
        return Err(ApiError::invalid_state(status));
    }
    sanctions::lift(&state, user_id, Some(admin.user_id)).await?;
    Ok(Json(load_user(&state, user_id, admin.role).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RoleBody {
    pub role: UserRole,
}

/// Changes a role (admin only). An admin cannot change their own role; the target must be
/// `active`.
#[utoipa::path(
    patch,
    path = "/users/{user_id}/role",
    tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path, description = "User id")),
    request_body = RoleBody,
    responses(
        (status = 200, body = AdminUser),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn change_role(
    State(state): State<AppState>,
    admin: Admin,
    ApiPath(user_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RoleBody>,
) -> ApiResult<Json<AdminUser>> {
    check_target(&state, &admin, user_id).await?;
    users::change_role(&state, admin.user_id, user_id, body.role).await?;
    Ok(Json(load_user(&state, user_id, admin.role).await?))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::db::admin::test_util::{
        audit_details, audit_total, email_of, notifications, queued_emails,
    };
    use crate::domain::options::Gender;
    use crate::domain::types::UserRole;
    use crate::realtime::hub::close_code;
    use crate::services::clerk::ClerkUser;
    use crate::test_support::{TestApp, TestResponse, TestUser, token_for};

    fn path(user: &TestUser, action: &str) -> String {
        format!("/v1/admin/users/{}/{action}", user.user_id)
    }

    async fn user_status(app: &TestApp, user: &TestUser) -> (String, String) {
        sqlx::query_as(
            "SELECT u.status, p.status FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(user.user_id)
        .fetch_one(app.db())
        .await
        .unwrap()
    }

    /// T-504: suspending a user hides the profile, closes their sockets, and makes their next
    /// request return `account_suspended`.
    #[sqlx::test]
    async fn suspending_hides_the_profile_closes_sockets_and_blocks_the_next_request(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let other = app.member_of(Gender::Female).await;
        sqlx::query("INSERT INTO interests (sender_profile_id, receiver_profile_id, expires_at) VALUES ($1, $2, now() + interval '1 day')")
            .bind(other.profile_id)
            .bind(member.profile_id)
            .execute(app.db())
            .await
            .unwrap();
        let mut socket = app.state.hub.register(member.profile_id, member.user_id);
        let ok = app
            .patch("/v1/me", Some(&member.token), json!({ "locale": "ur" }))
            .await;
        assert_eq!(ok.status, StatusCode::OK);

        // Members are refused; moderators succeed.
        let reason = "You continued to contact a member after they asked you to stop.";
        let body = json!({ "reason": reason, "days": 7 });
        let refused = app
            .post(&path(&member, "suspend"), Some(&other.token), body.clone())
            .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        let response = app
            .post(&path(&member, "suspend"), Some(&moderator.token), body)
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        let json = &response.json;
        assert_eq!(json["status"], "suspended");
        assert_eq!(json["profile_status"], "suspended");
        assert!(json["suspended_until"].is_string());
        assert_eq!(json["sanctions"][0]["type"], "suspension");
        assert_eq!(
            json["sanctions"][0]["created_by_email"],
            email_of(app.db(), moderator.user_id).await
        );
        assert_eq!(json["audit"][0]["action"], "user.suspend");

        // The profile is hidden and the pending interest is over (03 section 4.2).
        assert_eq!(
            user_status(&app, &member).await,
            ("suspended".to_owned(), "suspended".to_owned())
        );
        let interest: String =
            sqlx::query_scalar("SELECT status FROM interests WHERE receiver_profile_id = $1")
                .bind(member.profile_id)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(interest, "expired");

        // The sockets get `gate.changed` and are closed with 4403.
        assert_eq!(socket.closer.closed().await, close_code::NOT_ALLOWED);
        let frame: Value = serde_json::from_str(&socket.receiver.try_recv().unwrap()).unwrap();
        assert_eq!(
            frame,
            json!({ "type": "gate.changed", "data": { "gate": "suspended" } })
        );

        // The next request is refused with `account_suspended`; `GET /v1/me` shows the gate.
        let refused = app
            .patch("/v1/me", Some(&member.token), json!({ "locale": "en" }))
            .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(refused.code(), "account_suspended");
        assert_eq!(refused.json["error"]["details"]["reason"], reason);
        assert!(refused.json["error"]["details"]["suspended_until"].is_string());
        let me = app.get("/v1/me", Some(&member.token)).await;
        assert_eq!(me.json["gate"], "suspended");
        assert_eq!(me.json["user"]["status"], "suspended");

        // Sessions are revoked, and the member is emailed.
        let revocations = app.queued_jobs("revoke_clerk_sessions").await;
        assert_eq!(revocations.len(), 1);
        assert_eq!(revocations[0]["ban"], false);
        let emails = queued_emails(app.db(), member.user_id, "account_suspended").await;
        assert_eq!(emails.len(), 1);
        assert_eq!(emails[0]["data"]["form"], "suspended");
        app.drain_jobs().await;
        let calls = app.clerk.calls();
        assert!(
            calls.contains(&format!("revoke_session:sess_{}", member.clerk_user_id)),
            "{calls:?}"
        );

        // One audit row, with the details of 18 section 8.3.
        let sanction_id: Uuid = sqlx::query_scalar("SELECT id FROM sanctions WHERE user_id = $1")
            .bind(member.user_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        let rows = audit_details(app.db(), "user.suspend").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["reason"], reason);
        assert_eq!(rows[0]["days"], 7);
        assert!(rows[0]["ends_at"].is_string());
        assert!(rows[0]["report_id"].is_null());
        assert_eq!(rows[0]["sanction_id"], sanction_id.to_string());
        assert_eq!(audit_total(app.db()).await, 1);

        // Only an active member can be suspended.
        let again = app
            .post(
                &path(&member, "suspend"),
                Some(&moderator.token),
                json!({ "reason": "Again, for no reason", "days": 1 }),
            )
            .await;
        assert_eq!(again.status, StatusCode::CONFLICT);
        assert_eq!(again.json["error"]["details"]["status"], "suspended");

        // Lifting restores everything and records the lift.
        let lifted = app
            .post_empty(&path(&member, "unsuspend"), Some(&moderator.token))
            .await;
        assert_eq!(lifted.status, StatusCode::OK, "{}", lifted.text);
        assert_eq!(lifted.json["status"], "active");
        assert_eq!(lifted.json["status_reason"], Value::Null);
        assert!(lifted.json["sanctions"][0]["revoked_at"].is_string());
        assert_eq!(
            lifted.json["sanctions"][0]["revoked_by_email"],
            email_of(app.db(), moderator.user_id).await
        );
        assert_eq!(
            user_status(&app, &member).await,
            ("active".to_owned(), "active".to_owned())
        );
        let working = app
            .patch("/v1/me", Some(&member.token), json!({ "locale": "ur" }))
            .await;
        assert_eq!(working.status, StatusCode::OK);
        assert_eq!(
            audit_details(app.db(), "user.unsuspend").await,
            vec![json!({ "sanction_id": sanction_id })]
        );
        let emails = queued_emails(app.db(), member.user_id, "account_suspended").await;
        assert_eq!(emails[1]["data"]["form"], "active_again");
        assert_eq!(audit_total(app.db()).await, 2);
        let twice = app
            .post_empty(&path(&member, "unsuspend"), Some(&moderator.token))
            .await;
        assert_eq!(twice.status, StatusCode::CONFLICT);
    }

    #[sqlx::test]
    async fn sanction_requests_are_validated_and_staff_are_protected(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let colleague = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let url = path(&member, "suspend");
        let ok_reason = "Repeated rudeness in chat";

        for days in [0, 366] {
            let response = app
                .post(
                    &url,
                    Some(&moderator.token),
                    json!({ "reason": ok_reason, "days": days }),
                )
                .await;
            assert_eq!(response.field_errors(), vec!["days:out_of_range"]);
        }
        let short = app
            .post(
                &url,
                Some(&moderator.token),
                json!({ "reason": "ab", "days": 7 }),
            )
            .await;
        assert_eq!(short.field_errors(), vec!["reason:too_short"]);
        let long = app
            .post(
                &url,
                Some(&moderator.token),
                json!({ "reason": "x".repeat(501), "days": 7 }),
            )
            .await;
        assert_eq!(long.field_errors(), vec!["reason:too_long"]);
        let report = app
            .post(
                &url,
                Some(&moderator.token),
                json!({ "reason": ok_reason, "days": 7, "report_id": Uuid::now_v7() }),
            )
            .await;
        assert_eq!(report.field_errors(), vec!["report_id:unknown_code"]);
        let unknown_key = app
            .post(
                &url,
                Some(&moderator.token),
                json!({ "reason": ok_reason, "days": 7, "until": "x" }),
            )
            .await;
        assert_eq!(unknown_key.code(), "bad_request");
        assert_eq!(audit_total(app.db()).await, 0);

        // A moderator cannot act on staff or on themselves; an admin cannot act on themselves.
        for target in [&colleague, &admin, &moderator] {
            let response = app
                .post(
                    &path(target, "warn"),
                    Some(&moderator.token),
                    json!({ "reason": ok_reason }),
                )
                .await;
            assert_eq!(
                response.status,
                StatusCode::FORBIDDEN,
                "warn {}",
                target.user_id
            );
            let response = app
                .post(
                    &path(target, "suspend"),
                    Some(&moderator.token),
                    json!({ "reason": ok_reason, "days": 7 }),
                )
                .await;
            assert_eq!(response.status, StatusCode::FORBIDDEN);
        }
        let own = app
            .post(
                &path(&admin, "ban"),
                Some(&admin.token),
                json!({ "reason": ok_reason }),
            )
            .await;
        assert_eq!(own.status, StatusCode::FORBIDDEN);
        let unknown = app
            .post(
                &format!("/v1/admin/users/{}/warn", Uuid::now_v7()),
                Some(&moderator.token),
                json!({ "reason": ok_reason }),
            )
            .await;
        assert_eq!(unknown.status, StatusCode::NOT_FOUND);
        assert_eq!(audit_total(app.db()).await, 0);

        // An admin may suspend a moderator, who then has no staff access any more.
        let response = app
            .post(
                &path(&colleague, "suspend"),
                Some(&admin.token),
                json!({ "reason": ok_reason, "days": 3 }),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        let overview = app.get("/v1/admin/overview", Some(&colleague.token)).await;
        assert_eq!(overview.status, StatusCode::FORBIDDEN);
    }

    #[sqlx::test]
    async fn a_warning_changes_no_status_and_notifies_the_member(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let reporter = app.member_of(Gender::Female).await;
        let report: Uuid = sqlx::query_scalar(
            "INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason)
             VALUES ($1, $2, 'profile', 'harassment') RETURNING id",
        )
        .bind(reporter.profile_id)
        .bind(member.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        let reason = "Your recent messages broke our rule on respectful communication.";

        let refused = app
            .post(
                &path(&member, "warn"),
                Some(&reporter.token),
                json!({ "reason": reason }),
            )
            .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        let response = app
            .post(
                &path(&member, "warn"),
                Some(&moderator.token),
                json!({ "reason": reason, "report_id": report }),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(
            response.json["status"], "active",
            "a warning changes no status"
        );
        assert_eq!(response.json["profile_status"], "active");
        let sanction = &response.json["sanctions"][0];
        assert_eq!(sanction["type"], "warning");
        assert_eq!(sanction["reason"], reason);
        assert_eq!(sanction["report_id"], report.to_string());

        let sanction_id = sanction["id"].as_str().unwrap().to_owned();
        assert_eq!(
            notifications(app.db(), member.user_id, "account_warning").await,
            vec![json!({ "sanction_id": sanction_id, "reason": reason })]
        );
        assert_eq!(
            queued_emails(app.db(), member.user_id, "account_warning")
                .await
                .len(),
            1
        );
        assert_eq!(
            audit_details(app.db(), "user.warn").await,
            vec![json!({ "reason": reason, "report_id": report, "sanction_id": sanction_id })]
        );
        assert_eq!(audit_total(app.db()).await, 1);
        let me = app.get("/v1/me", Some(&member.token)).await;
        assert_eq!(me.json["gate"], "ok");
        assert_eq!(me.json["counters"]["unread_notifications"], 1);

        // Warning a suspended member is refused.
        sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
            .bind(member.user_id)
            .execute(app.db())
            .await
            .unwrap();
        let refused = app
            .post(
                &path(&member, "warn"),
                Some(&moderator.token),
                json!({ "reason": reason }),
            )
            .await;
        assert_eq!(refused.status, StatusCode::CONFLICT);
        assert_eq!(audit_total(app.db()).await, 1);
    }

    /// T-504: a banned identity number, email and phone cannot register again.
    #[sqlx::test]
    async fn a_ban_ends_connections_blocks_the_identifiers_and_is_admin_only(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let other = app.member_of(Gender::Female).await;
        let db = app.db();
        sqlx::query("UPDATE users SET phone_e164 = '+923001112222' WHERE id = $1")
            .bind(member.user_id)
            .execute(db)
            .await
            .unwrap();
        let number_hash = app.state.crypto.keyed_hash("pk_id", "3520212345671");
        sqlx::query(
            "INSERT INTO profile_identity (profile_id, document_type, number_encrypted, number_hash, number_last4)
             VALUES ($1, 'cnic', $2, $3, '5671')",
        )
        .bind(member.profile_id)
        .bind(app.state.crypto.encrypt_identity(member.profile_id, "3520212345671"))
        .bind(&number_hash)
        .execute(db)
        .await
        .unwrap();
        let (low, high) = crate::lifecycle::ordered_pair(member.profile_id, other.profile_id);
        let interest: Uuid = sqlx::query_scalar(
            "INSERT INTO interests (sender_profile_id, receiver_profile_id, status, expires_at)
             VALUES ($1, $2, 'accepted', now()) RETURNING id",
        )
        .bind(member.profile_id)
        .bind(other.profile_id)
        .fetch_one(db)
        .await
        .unwrap();
        let connection: Uuid = sqlx::query_scalar(
            "INSERT INTO connections (profile_low_id, profile_high_id, interest_id)
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(low)
        .bind(high)
        .bind(interest)
        .fetch_one(db)
        .await
        .unwrap();
        let email = email_of(db, member.user_id).await;
        let reason = "This account was closed for asking other members for money.";

        // Moderators cannot ban.
        let refused = app
            .post(
                &path(&member, "ban"),
                Some(&moderator.token),
                json!({ "reason": reason }),
            )
            .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(user_status(&app, &member).await.0, "active");

        let response = app
            .post(
                &path(&member, "ban"),
                Some(&admin.token),
                json!({ "reason": reason }),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["status"], "banned");
        assert_eq!(response.json["sanctions"][0]["type"], "ban");
        assert!(response.json["suspended_until"].is_null());

        // Connections end, and the three identifiers go on the block list.
        let (status, ended_reason): (String, Option<String>) =
            sqlx::query_as("SELECT status, ended_reason FROM connections WHERE id = $1")
                .bind(connection)
                .fetch_one(db)
                .await
                .unwrap();
        assert_eq!(
            (status.as_str(), ended_reason.as_deref()),
            ("ended", Some("account_closed"))
        );
        let mut listed: Vec<(String, Vec<u8>)> =
            sqlx::query_as("SELECT kind, value_hash FROM banned_identities")
                .fetch_all(db)
                .await
                .unwrap();
        listed.sort();
        let mut expected = vec![
            ("email".to_owned(), app.state.crypto.email_hash(&email)),
            ("identity_document".to_owned(), number_hash.clone()),
            (
                "phone".to_owned(),
                app.state.crypto.phone_hash("+923001112222"),
            ),
        ];
        expected.sort();
        assert_eq!(listed, expected);
        assert_eq!(
            app.queued_jobs("revoke_clerk_sessions").await[0]["ban"],
            true
        );
        assert_eq!(
            queued_emails(db, member.user_id, "account_suspended").await[0]["data"]["form"],
            "banned"
        );
        let sanction_id: Uuid = sqlx::query_scalar("SELECT id FROM sanctions WHERE user_id = $1")
            .bind(member.user_id)
            .fetch_one(db)
            .await
            .unwrap();
        assert_eq!(
            audit_details(db, "user.ban").await,
            vec![json!({ "reason": reason, "report_id": null, "sanction_id": sanction_id })]
        );
        let refused = app
            .patch("/v1/me", Some(&member.token), json!({ "locale": "ur" }))
            .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(refused.code(), "account_banned");
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["gate"],
            "banned"
        );

        // The same email signing up again is created banned (06 section 5.1).
        let (_, token) = app.clerk_user(&email);
        let again = app.get("/v1/me", Some(&token)).await;
        assert_eq!(again.json["gate"], "banned");
        assert_eq!(again.json["user"]["status"], "banned");
        // So is a new account with the banned phone number.
        let phone_user = format!("user_{}", Uuid::now_v7().simple());
        app.clerk.add_user(ClerkUser {
            id: phone_user.clone(),
            email: Some("someone.else@example.com".to_owned()),
            email_verified: true,
            phone_e164: Some("+923001112222".to_owned()),
            phone_verified: true,
        });
        let by_phone = app.get("/v1/me", Some(&token_for(&phone_user))).await;
        assert_eq!(by_phone.json["gate"], "banned");

        // A banned account cannot be banned again, and only admins lift bans.
        let twice = app
            .post(
                &path(&member, "ban"),
                Some(&admin.token),
                json!({ "reason": reason }),
            )
            .await;
        assert_eq!(twice.status, StatusCode::CONFLICT);
        let by_moderator = app
            .post_empty(&path(&member, "unban"), Some(&moderator.token))
            .await;
        assert_eq!(by_moderator.status, StatusCode::FORBIDDEN);
        let not_banned = app
            .post_empty(&path(&other, "unban"), Some(&admin.token))
            .await;
        assert_eq!(not_banned.status, StatusCode::CONFLICT);
        let wrong_lift = app
            .post_empty(&path(&member, "unsuspend"), Some(&moderator.token))
            .await;
        assert_eq!(
            wrong_lift.status,
            StatusCode::CONFLICT,
            "a ban is not lifted as a suspension"
        );

        let lifted = app
            .post_empty(&path(&member, "unban"), Some(&admin.token))
            .await;
        assert_eq!(lifted.status, StatusCode::OK, "{}", lifted.text);
        assert_eq!(lifted.json["status"], "active");
        assert_eq!(
            user_status(&app, &member).await,
            ("active".to_owned(), "active".to_owned())
        );
        let remaining: i64 =
            sqlx::query_scalar("SELECT count(*) FROM banned_identities WHERE value_hash = ANY($1)")
                .bind(vec![
                    number_hash,
                    app.state.crypto.email_hash(&email),
                    app.state.crypto.phone_hash("+923001112222"),
                ])
                .fetch_one(db)
                .await
                .unwrap();
        assert_eq!(
            remaining, 0,
            "unbanning removes the block list rows of this user"
        );
        assert_eq!(
            audit_details(db, "user.unban").await,
            vec![json!({ "sanction_id": sanction_id })]
        );
        let status: String = sqlx::query_scalar("SELECT status FROM connections WHERE id = $1")
            .bind(connection)
            .fetch_one(db)
            .await
            .unwrap();
        assert_eq!(
            status, "ended",
            "connections ended by a ban are not restored"
        );
        assert_eq!(audit_total(db).await, 2);
    }

    #[sqlx::test]
    async fn a_suspended_user_can_be_banned(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let member = app.member().await;
        let reason = "Fake profile, impersonating someone else";
        let suspended = app
            .post(
                &path(&member, "suspend"),
                Some(&admin.token),
                json!({ "reason": reason, "days": 30 }),
            )
            .await;
        assert_eq!(suspended.status, StatusCode::OK);
        let banned = app
            .post(
                &path(&member, "ban"),
                Some(&admin.token),
                json!({ "reason": reason }),
            )
            .await;
        assert_eq!(banned.status, StatusCode::OK, "{}", banned.text);
        assert_eq!(banned.json["status"], "banned");
        assert!(banned.json["suspended_until"].is_null());
        // Lifting the ban revokes the suspension that was still open as well.
        let lifted = app
            .post_empty(&path(&member, "unban"), Some(&admin.token))
            .await;
        assert_eq!(lifted.json["status"], "active");
        let open: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sanctions WHERE revoked_at IS NULL")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(open, 0);
    }

    fn found(response: &TestResponse) -> Vec<String> {
        response.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["user_id"].as_str().unwrap().to_owned())
            .collect()
    }

    #[sqlx::test]
    async fn the_search_matches_email_phone_code_and_name(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let admin = app.staff(UserRole::Admin).await;
        let zarmeen = app
            .member_with(|s| {
                s.gender = Gender::Female;
                s.first_name = "Zarmeen".to_owned();
                s.last_name = "Qureshi".to_owned();
            })
            .await;
        let bilal = app
            .member_with(|s| {
                s.first_name = "Bilal".to_owned();
                s.last_name = "Sheikh".to_owned();
            })
            .await;
        sqlx::query("UPDATE users SET phone_e164 = '+923331234567' WHERE id = $1")
            .bind(zarmeen.user_id)
            .execute(app.db())
            .await
            .unwrap();
        sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
            .bind(bilal.user_id)
            .execute(app.db())
            .await
            .unwrap();
        let email = email_of(app.db(), zarmeen.user_id).await;
        let code: String = sqlx::query_scalar("SELECT public_code FROM profiles WHERE id = $1")
            .bind(zarmeen.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();

        for query in [
            email.to_uppercase(),
            "1234567".to_owned(),
            "923331234567".to_owned(),
            code.to_lowercase(),
            "zarm".to_owned(),
            "QURE".to_owned(),
        ] {
            let response = app
                .get(
                    &format!("/v1/admin/users?q={query}"),
                    Some(&moderator.token),
                )
                .await;
            assert_eq!(
                response.status,
                StatusCode::OK,
                "{query}: {}",
                response.text
            );
            assert_eq!(
                found(&response),
                vec![zarmeen.user_id.to_string()],
                "{query}"
            );
        }
        // Too short, a short digit string, a part of an email and a wildcard find nothing.
        let short = app
            .get("/v1/admin/users?q=zz", Some(&moderator.token))
            .await;
        assert_eq!(short.field_errors(), vec!["q:too_short"]);
        for query in ["123456", "example.com", "%25%25%25"] {
            let response = app
                .get(
                    &format!("/v1/admin/users?q={query}"),
                    Some(&moderator.token),
                )
                .await;
            assert!(found(&response).is_empty(), "{query}");
        }
        let response = app
            .get("/v1/admin/users?q=zarm", Some(&moderator.token))
            .await;
        let item = &response.json["items"][0];
        assert_eq!(item["email"], email);
        assert_eq!(item["first_name"], "Zarmeen");
        assert_eq!(item["gender"], "female");
        assert_eq!(item["status"], "active");
        assert_eq!(item["role"], "member");
        assert!(
            item.get("phone_e164").is_none(),
            "the list never shows phone numbers"
        );

        // Filters need no query text, and a bare request is refused.
        let suspended = app
            .get("/v1/admin/users?status=suspended", Some(&moderator.token))
            .await;
        assert_eq!(found(&suspended), vec![bilal.user_id.to_string()]);
        let staff = app
            .get("/v1/admin/users?role=admin", Some(&moderator.token))
            .await;
        assert_eq!(found(&staff), vec![admin.user_id.to_string()]);
        let bare = app.get("/v1/admin/users", Some(&moderator.token)).await;
        assert_eq!(bare.field_errors(), vec!["q:required"]);
        let paged = app
            .get(
                "/v1/admin/users?role=member&limit=1",
                Some(&moderator.token),
            )
            .await;
        assert_eq!(paged.json["items"].as_array().unwrap().len(), 1);
        assert!(paged.json["next_cursor"].is_string());
        let by_member = app
            .get("/v1/admin/users?q=zarmeen", Some(&zarmeen.token))
            .await;
        assert_eq!(by_member.status, StatusCode::FORBIDDEN);
    }

    #[sqlx::test]
    async fn the_account_view_shows_history_and_flags_and_hides_the_phone_from_moderators(
        db: PgPool,
    ) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let other = app.member_of(Gender::Female).await;
        let db = app.db();
        sqlx::query(
            "UPDATE users SET phone_e164 = '+923331234567', phone_verified = true WHERE id = $1",
        )
        .bind(member.user_id)
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_devices (user_id, platform, push_token, app_version, device_model)
             VALUES ($1, 'android', 'secret-push-token', '1.2.0', 'Pixel 8')",
        )
        .bind(member.user_id)
        .execute(db)
        .await
        .unwrap();
        // Five dismissed reports filed in a month and a money flag.
        for _ in 0..5 {
            sqlx::query(
                "INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason, status)
                 VALUES ($1, $2, 'profile', 'other', 'dismissed')",
            )
            .bind(member.profile_id)
            .bind(other.profile_id)
            .execute(db)
            .await
            .unwrap();
        }
        let (low, high) = crate::lifecycle::ordered_pair(member.profile_id, other.profile_id);
        let interest: Uuid = sqlx::query_scalar(
            "INSERT INTO interests (sender_profile_id, receiver_profile_id, status, expires_at)
             VALUES ($1, $2, 'accepted', now()) RETURNING id",
        )
        .bind(member.profile_id)
        .bind(other.profile_id)
        .fetch_one(db)
        .await
        .unwrap();
        let connection: Uuid = sqlx::query_scalar(
            "INSERT INTO connections (profile_low_id, profile_high_id, interest_id)
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(low)
        .bind(high)
        .bind(interest)
        .fetch_one(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO messages (id, connection_id, sender_profile_id, body, safety_flag)
             VALUES ($1, $2, $3, 'send money', 'money')",
        )
        .bind(Uuid::now_v7())
        .bind(connection)
        .bind(member.profile_id)
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reports (source, target_profile_id, subject_type, reason, context)
             VALUES ('system', $1, 'profile', 'fake_profile', $2)",
        )
        .bind(member.profile_id)
        .bind(json!({ "trigger": "device_of_sanctioned_user" }))
        .execute(db)
        .await
        .unwrap();
        let warn = app
            .post(
                &path(&member, "warn"),
                Some(&moderator.token),
                json!({ "reason": "Please keep chats respectful" }),
            )
            .await;
        assert_eq!(warn.status, StatusCode::OK);

        let url = format!("/v1/admin/users/{}", member.user_id);
        let as_admin = app.get(&url, Some(&admin.token)).await;
        assert_eq!(as_admin.status, StatusCode::OK, "{}", as_admin.text);
        assert_eq!(as_admin.json["phone_e164"], "+923331234567");
        let as_moderator = app.get(&url, Some(&moderator.token)).await;
        assert!(as_moderator.json["phone_e164"].is_null());
        assert!(!as_moderator.text.contains("+92333"));
        assert!(
            !as_moderator.text.contains("secret-push-token"),
            "push tokens are never shown"
        );

        let json = &as_moderator.json;
        assert_eq!(json["phone_verified"], true);
        assert_eq!(json["email_verified"], true);
        assert_eq!(json["locale"], "en");
        assert_eq!(json["devices"][0]["platform"], "android");
        assert_eq!(json["devices"][0]["device_model"], "Pixel 8");
        assert!(
            json["consents"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["document"] == "terms")
        );
        assert_eq!(json["sanctions"][0]["type"], "warning");
        assert_eq!(json["reports_against"].as_array().unwrap().len(), 1);
        assert_eq!(
            json["reports_filed"],
            json!({ "total": 5, "actioned": 0, "dismissed": 5 })
        );
        assert_eq!(
            json["flags"],
            json!({ "reporter_misuse": true, "money_flags_30d": 1, "shared_device_with_sanctioned_user": true })
        );
        assert_eq!(json["audit"][0]["action"], "user.warn");
        assert_eq!(
            json["audit"][0]["actor"]["user_id"],
            moderator.user_id.to_string()
        );
        assert_eq!(json["status"], "active");
        assert_eq!(json["profile_status"], "active");

        // A member with none of that has clean flags.
        let clean = app
            .get(
                &format!("/v1/admin/users/{}", other.user_id),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(
            clean.json["flags"],
            json!({ "reporter_misuse": false, "money_flags_30d": 0, "shared_device_with_sanctioned_user": false })
        );
        assert_eq!(
            app.get(&url, Some(&other.token)).await.status,
            StatusCode::FORBIDDEN
        );
        let unknown = app
            .get(
                &format!("/v1/admin/users/{}", Uuid::now_v7()),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn roles_change_only_through_admins_and_take_effect_at_once(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let url = path(&member, "role");

        // Before: the member is refused by the staff routes, and the snapshot is now cached.
        let before = app.get("/v1/admin/overview", Some(&member.token)).await;
        assert_eq!(before.status, StatusCode::FORBIDDEN);
        let by_moderator = app
            .patch(&url, Some(&moderator.token), json!({ "role": "moderator" }))
            .await;
        assert_eq!(by_moderator.status, StatusCode::FORBIDDEN);
        let by_member = app
            .patch(&url, Some(&member.token), json!({ "role": "admin" }))
            .await;
        assert_eq!(by_member.status, StatusCode::FORBIDDEN);
        let bad = app
            .patch(&url, Some(&admin.token), json!({ "role": "owner" }))
            .await;
        assert_eq!(bad.code(), "bad_request");
        assert_eq!(audit_total(app.db()).await, 0);

        let response = app
            .patch(&url, Some(&admin.token), json!({ "role": "moderator" }))
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["role"], "moderator");
        assert_eq!(
            audit_details(app.db(), "user.role_change").await,
            vec![json!({ "from": "member", "to": "moderator" })]
        );
        let after = app.get("/v1/admin/overview", Some(&member.token)).await;
        assert_eq!(after.status, StatusCode::OK, "no 30 second wait");
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["user"]["role"],
            "moderator"
        );

        // The same role again changes nothing and writes nothing.
        let same = app
            .patch(&url, Some(&admin.token), json!({ "role": "moderator" }))
            .await;
        assert_eq!(same.status, StatusCode::OK);
        assert_eq!(audit_total(app.db()).await, 1);

        // An admin cannot change their own role, and the target must be active.
        let own = app
            .patch(
                &path(&admin, "role"),
                Some(&admin.token),
                json!({ "role": "member" }),
            )
            .await;
        assert_eq!(own.status, StatusCode::FORBIDDEN);
        sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
            .bind(moderator.user_id)
            .execute(app.db())
            .await
            .unwrap();
        let suspended = app
            .patch(
                &path(&moderator, "role"),
                Some(&admin.token),
                json!({ "role": "member" }),
            )
            .await;
        assert_eq!(suspended.status, StatusCode::CONFLICT);
        assert_eq!(audit_total(app.db()).await, 1);
    }
}
