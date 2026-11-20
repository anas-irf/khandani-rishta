//! Staff routes: profile review and the profile view (15 section 16, 18 sections 4.1 and 5.4).

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use time::{Date, OffsetDateTime};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::{Admin, Moderator};
use crate::db::admin::profiles::{self, LockedFieldsChange, ProfileSearch};
use crate::db::pagination::{Page, PageParams};
use crate::domain::options::Gender;
use crate::domain::types::{ProfileStatus, UserRole};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::admin::{AdminProfile, AdminProfileListItem, from_micros, to_micros};
use crate::models::photos::sign;
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_profiles))
        .routes(routes!(get_profile))
        .routes(routes!(approve_profile))
        .routes(routes!(request_changes))
        .routes(routes!(change_locked_fields))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ProfilesQuery {
    /// Any profile status. Without `q` the default is `pending_review`, the review queue.
    pub status: Option<ProfileStatus>,
    /// A profile code, or the start of a first or last name.
    pub q: Option<String>,
}

/// The review queue and profile search, longest waiting first.
#[utoipa::path(
    get,
    path = "/profiles",
    tag = "admin",
    security(("bearer" = [])),
    params(ProfilesQuery, PageParams),
    responses(
        (status = 200, body = Page<AdminProfileListItem>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_profiles(
    State(state): State<AppState>,
    _staff: Moderator,
    ApiQuery(query): ApiQuery<ProfilesQuery>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<Page<AdminProfileListItem>>> {
    let limit = page.limit();
    let cursor = page
        .cursor::<(i64, Uuid)>()?
        .map(|(micros, id)| (from_micros(micros), id));
    let q = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(str::to_owned);
    // The console has no "browse everyone" screen: without a search the list is the queue.
    let status = query
        .status
        .or_else(|| q.is_none().then_some(ProfileStatus::PendingReview));
    let filter = ProfileSearch { status, q };
    let rows = profiles::list(&state.db, &filter, cursor, limit).await?;

    let mut signed = Vec::with_capacity(rows.len());
    for row in rows {
        let url = sign(state.storage.as_ref(), row.thumb_key.as_deref()).await;
        signed.push((row, url));
    }
    let now = OffsetDateTime::now_utc();
    Ok(Json(Page::from_rows(
        signed,
        limit,
        |(row, _)| (to_micros(row.sort_key), row.profile_id),
        |(row, url)| row.into_item(url, now),
    )))
}

async fn detail(
    state: &AppState,
    profile_id: Uuid,
    viewer_role: UserRole,
) -> ApiResult<Json<AdminProfile>> {
    profiles::load_detail(state, profile_id, viewer_role)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

/// One profile in full: private fields, history, reports, sanctions. Contact details are
/// included for admins only.
#[utoipa::path(
    get,
    path = "/profiles/{profile_id}",
    tag = "admin",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "Profile id")),
    responses(
        (status = 200, body = AdminProfile),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_profile(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<Json<AdminProfile>> {
    detail(&state, profile_id, staff.role).await
}

/// `pending_review` to `active`.
#[utoipa::path(
    post,
    path = "/profiles/{profile_id}/approve",
    tag = "admin",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "Profile id")),
    responses(
        (status = 200, body = AdminProfile),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn approve_profile(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<Json<AdminProfile>> {
    profiles::approve(&state, staff.user_id, profile_id).await?;
    detail(&state, profile_id, staff.role).await
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RequestChangesBody {
    /// Shown to the member on the fix-your-profile screen. 10 to 500 characters.
    pub reason: String,
}

/// Checks a staff-written reason against its length limits.
pub fn check_reason(reason: &str, min: usize, max: usize) -> Result<String, ApiError> {
    let reason = reason.trim();
    match reason.chars().count() {
        0 => Err(ApiError::field("reason", FieldCode::Required)),
        n if n < min => Err(ApiError::field("reason", FieldCode::TooShort)),
        n if n > max => Err(ApiError::field("reason", FieldCode::TooLong)),
        _ => Ok(reason.to_owned()),
    }
}

/// `pending_review` to `changes_requested`.
#[utoipa::path(
    post,
    path = "/profiles/{profile_id}/request-changes",
    tag = "admin",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "Profile id")),
    request_body = RequestChangesBody,
    responses(
        (status = 200, body = AdminProfile),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn request_changes(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(profile_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RequestChangesBody>,
) -> ApiResult<Json<AdminProfile>> {
    let reason = check_reason(&body.reason, 10, 500)?;
    profiles::request_changes(&state, staff.user_id, profile_id, &reason).await?;
    detail(&state, profile_id, staff.role).await
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LockedFieldsBody {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    /// `YYYY-MM-DD`. The candidate must be 18 or older today.
    pub date_of_birth: Option<String>,
    /// Staff only. 10 to 500 characters.
    pub reason: String,
}

/// Corrects name, gender or date of birth on the owner's behalf (admin only).
#[utoipa::path(
    patch,
    path = "/profiles/{profile_id}/locked-fields",
    tag = "admin",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "Profile id")),
    request_body = LockedFieldsBody,
    responses(
        (status = 200, body = AdminProfile),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn change_locked_fields(
    State(state): State<AppState>,
    admin: Admin,
    ApiPath(profile_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LockedFieldsBody>,
) -> ApiResult<Json<AdminProfile>> {
    if body.first_name.is_none()
        && body.last_name.is_none()
        && body.gender.is_none()
        && body.date_of_birth.is_none()
    {
        return Err(ApiError::BadRequest("no field to change".to_owned()));
    }
    let date_of_birth = body
        .date_of_birth
        .as_deref()
        .map(|text| {
            Date::parse(
                text.trim(),
                time::macros::format_description!("[year]-[month]-[day]"),
            )
            .map_err(|_| ApiError::field("date_of_birth", FieldCode::Invalid))
        })
        .transpose()?;
    let change = LockedFieldsChange {
        first_name: body.first_name,
        last_name: body.last_name,
        gender: body.gender,
        date_of_birth,
        reason: body.reason,
    };
    profiles::change_locked_fields(&state, admin.user_id, profile_id, change).await?;
    detail(&state, profile_id, admin.role).await
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::db::admin::test_util::{audit_details, audit_total, notifications, queued_emails};
    use crate::domain::options::Gender;
    use crate::domain::types::{ProfileStatus, UserRole};
    use crate::test_support::{MemberSpec, TestApp};

    fn pending(spec: &mut MemberSpec) {
        spec.status = ProfileStatus::PendingReview;
    }

    #[sqlx::test]
    async fn approving_activates_the_profile_notifies_the_member_and_writes_one_audit_row(
        db: PgPool,
    ) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member_with(pending).await;
        sqlx::query(
            "UPDATE profiles SET status_reason = 'old note', match_stale = false WHERE id = $1",
        )
        .bind(member.profile_id)
        .execute(app.db())
        .await
        .unwrap();
        let path = format!("/v1/admin/profiles/{}/approve", member.profile_id);

        // Members and anonymous callers are refused, and nothing changes.
        let other = app.member().await;
        let refused = app.post_empty(&path, Some(&other.token)).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(refused.code(), "forbidden");
        assert_eq!(
            app.post_empty(&path, None).await.status,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(audit_total(app.db()).await, 0);

        let waiting = app.get("/v1/me", Some(&member.token)).await;
        assert_eq!(waiting.json["gate"], "pending_review");

        let response = app.post_empty(&path, Some(&moderator.token)).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["profile"]["status"], "active");
        assert_eq!(response.json["audit"][0]["action"], "profile.approve");

        let (status, reason, first_activated, stale): (String, Option<String>, bool, bool) =
            sqlx::query_as(
                "SELECT status, status_reason, first_activated_at IS NOT NULL, match_stale
                 FROM profiles WHERE id = $1",
            )
            .bind(member.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(status, "active");
        assert_eq!(reason, None, "the reason is cleared");
        assert!(first_activated);
        assert!(stale, "recommendations must be recomputed");
        assert_eq!(
            app.queued_jobs("refresh_recommendations").await,
            vec![json!({ "profile_id": member.profile_id, "notify": false })]
        );
        assert_eq!(
            notifications(app.db(), member.user_id, "profile_approved").await,
            vec![json!({})]
        );
        assert_eq!(
            queued_emails(app.db(), member.user_id, "welcome")
                .await
                .len(),
            1
        );
        assert_eq!(
            audit_details(app.db(), "profile.approve").await,
            vec![json!({})]
        );
        assert_eq!(audit_total(app.db()).await, 1, "exactly one audit row");
        let me = app.get("/v1/me", Some(&member.token)).await;
        assert_eq!(me.json["gate"], "ok", "the snapshot was invalidated");
        assert_eq!(me.json["counters"]["unread_notifications"], 1);

        // Only a profile in review can be approved.
        let again = app.post_empty(&path, Some(&moderator.token)).await;
        assert_eq!(again.status, StatusCode::CONFLICT);
        assert_eq!(again.code(), "invalid_state");
        assert_eq!(again.json["error"]["details"]["status"], "active");
        let draft = app.draft_user().await;
        let draft_path = format!("/v1/admin/profiles/{}/approve", draft.profile_id);
        assert_eq!(
            app.post_empty(&draft_path, Some(&moderator.token))
                .await
                .status,
            StatusCode::CONFLICT
        );
        let unknown = format!("/v1/admin/profiles/{}/approve", Uuid::now_v7());
        assert_eq!(
            app.post_empty(&unknown, Some(&moderator.token))
                .await
                .status,
            StatusCode::NOT_FOUND
        );
        assert_eq!(audit_total(app.db()).await, 1);
    }

    #[sqlx::test]
    async fn requesting_changes_tells_the_member_why(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member_with(pending).await;
        let path = format!("/v1/admin/profiles/{}/request-changes", member.profile_id);
        let reason = "Please enter the candidate's real first and last name.";

        let member_try = app
            .post(&path, Some(&member.token), json!({ "reason": reason }))
            .await;
        assert_eq!(member_try.status, StatusCode::FORBIDDEN);

        let short = app
            .post(
                &path,
                Some(&moderator.token),
                json!({ "reason": "too short" }),
            )
            .await;
        assert_eq!(short.status, StatusCode::BAD_REQUEST);
        assert_eq!(short.field_errors(), vec!["reason:too_short"]);
        let long = app
            .post(
                &path,
                Some(&moderator.token),
                json!({ "reason": "x".repeat(501) }),
            )
            .await;
        assert_eq!(long.field_errors(), vec!["reason:too_long"]);
        let unknown_key = app
            .post(
                &path,
                Some(&moderator.token),
                json!({ "reason": reason, "note": 1 }),
            )
            .await;
        assert_eq!(unknown_key.code(), "bad_request");
        assert_eq!(audit_total(app.db()).await, 0);

        let response = app
            .post(&path, Some(&moderator.token), json!({ "reason": reason }))
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["profile"]["status"], "changes_requested");
        assert_eq!(response.json["profile"]["status_reason"], reason);

        let me = app.get("/v1/me", Some(&member.token)).await;
        assert_eq!(me.json["gate"], "changes_requested");
        assert_eq!(me.json["profile"]["status_reason"], reason);
        assert_eq!(
            notifications(app.db(), member.user_id, "profile_changes_requested").await,
            vec![json!({ "reason": reason })]
        );
        let emails = queued_emails(app.db(), member.user_id, "profile_changes_requested").await;
        assert_eq!(emails.len(), 1);
        assert_eq!(emails[0]["data"]["reason"], reason);
        assert_eq!(
            audit_details(app.db(), "profile.request_changes").await,
            vec![json!({ "reason": reason })]
        );
        assert_eq!(audit_total(app.db()).await, 1);

        // It is no longer in review.
        let again = app
            .post(&path, Some(&moderator.token), json!({ "reason": reason }))
            .await;
        assert_eq!(again.status, StatusCode::CONFLICT);
        assert_eq!(
            app.post_empty(
                &format!("/v1/admin/profiles/{}/approve", member.profile_id),
                Some(&moderator.token)
            )
            .await
            .status,
            StatusCode::CONFLICT
        );
    }

    #[sqlx::test]
    async fn the_queue_lists_the_longest_waiting_first_and_search_finds_any_profile(db: PgPool) {
        let app = TestApp::new(db).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let first = app
            .member_with(|s| {
                pending(s);
                s.first_name = "Bilal".to_owned();
            })
            .await;
        let second = app
            .member_with(|s| {
                pending(s);
                s.first_name = "Bilqis".to_owned();
            })
            .await;
        let third = app
            .member_with(|s| {
                pending(s);
                s.first_name = "Carim".to_owned();
            })
            .await;
        let active = app.member_of(Gender::Female).await;
        for (user, hours) in [(&first, 3), (&second, 2), (&third, 1)] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE profiles SET onboarding_completed_at = now() - interval '{hours} hours' WHERE id = $1"
            )))
            .bind(user.profile_id)
            .execute(app.db())
            .await
            .unwrap();
        }
        sqlx::query("INSERT INTO reports (source, target_profile_id, subject_type, reason) VALUES ('system', $1, 'profile', 'fake_profile')")
            .bind(first.profile_id)
            .execute(app.db())
            .await
            .unwrap();
        sqlx::query("INSERT INTO profile_photos (profile_id, status, upload_key, key_thumb) VALUES ($1, 'pending_review', 'tmp/a', 'photos/p/thumb.jpg')")
            .bind(first.profile_id)
            .execute(app.db())
            .await
            .unwrap();

        // The default is the review queue.
        let queue = app.get("/v1/admin/profiles", Some(&moderator.token)).await;
        assert_eq!(queue.status, StatusCode::OK, "{}", queue.text);
        let ids: Vec<String> = queue.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["profile_id"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            ids,
            vec![
                first.profile_id.to_string(),
                second.profile_id.to_string(),
                third.profile_id.to_string()
            ]
        );
        assert!(queue.json["next_cursor"].is_null());
        let item = &queue.json["items"][0];
        assert_eq!(item["first_name"], "Bilal");
        assert_eq!(item["age"], 28);
        assert_eq!(item["gender"], "male");
        assert_eq!(item["managed_by"], "self");
        assert_eq!(item["status"], "pending_review");
        assert!(item["city_name"].is_string());
        assert_eq!(item["open_system_reports"], 1);
        assert!(
            item["photo_thumb_url"]
                .as_str()
                .unwrap()
                .contains("photos/p/thumb.jpg")
        );
        assert!(queue.json["items"][1]["photo_thumb_url"].is_null());

        // Pages follow the same order.
        let page = app
            .get("/v1/admin/profiles?limit=2", Some(&moderator.token))
            .await;
        assert_eq!(page.json["items"].as_array().unwrap().len(), 2);
        let cursor = page.json["next_cursor"].as_str().unwrap().to_owned();
        let rest = app
            .get(
                &format!("/v1/admin/profiles?limit=2&cursor={cursor}"),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(rest.json["items"].as_array().unwrap().len(), 1);
        assert_eq!(
            rest.json["items"][0]["profile_id"],
            third.profile_id.to_string()
        );
        assert!(rest.json["next_cursor"].is_null());

        // Search by name prefix, by code and by status.
        let by_name = app
            .get("/v1/admin/profiles?q=bil", Some(&moderator.token))
            .await;
        assert_eq!(by_name.json["items"].as_array().unwrap().len(), 2);
        let code: String = sqlx::query_scalar("SELECT public_code FROM profiles WHERE id = $1")
            .bind(active.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        let by_code = app
            .get(
                &format!("/v1/admin/profiles?q={}", code.to_lowercase()),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(by_code.json["items"].as_array().unwrap().len(), 1);
        assert_eq!(
            by_code.json["items"][0]["profile_id"],
            active.profile_id.to_string()
        );
        let active_only = app
            .get("/v1/admin/profiles?status=active", Some(&moderator.token))
            .await;
        assert_eq!(
            active_only.json["items"].as_array().unwrap().len(),
            2,
            "the moderator and the member"
        );
        let bad = app
            .get("/v1/admin/profiles?status=bogus", Some(&moderator.token))
            .await;
        assert_eq!(bad.status, StatusCode::BAD_REQUEST);
        // A percent sign is not a wildcard.
        let wildcard = app
            .get("/v1/admin/profiles?q=%25", Some(&moderator.token))
            .await;
        assert_eq!(wildcard.json["items"].as_array().unwrap().len(), 0);
        assert_eq!(
            app.get("/v1/admin/profiles", Some(&active.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
    }

    #[sqlx::test]
    async fn the_detail_shows_private_fields_and_hides_contacts_from_moderators(db: PgPool) {
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
        sqlx::query("INSERT INTO profile_contacts (profile_id, phone_e164, guardian_name) VALUES ($1, '+923004445555', 'Father')")
            .bind(member.profile_id).execute(db).await.unwrap();
        sqlx::query("INSERT INTO profile_photos (profile_id, status, upload_key, key_large, key_thumb, is_primary) VALUES ($1, 'approved', 'tmp/a', 'photos/p/large.jpg', 'photos/p/thumb.jpg', true)")
            .bind(member.profile_id).execute(db).await.unwrap();
        sqlx::query("INSERT INTO profile_identity (profile_id, document_type, number_encrypted, number_hash, number_last4, status) VALUES ($1, 'cnic', $2, $3, '5671', 'verified')")
            .bind(member.profile_id)
            .bind(app.state.crypto.encrypt_identity(member.profile_id, "3520212345671"))
            .bind(app.state.crypto.keyed_hash("pk_id", "3520212345671"))
            .execute(db).await.unwrap();
        sqlx::query("INSERT INTO verification_requests (profile_id, kind, status) VALUES ($1, 'selfie', 'pending')")
            .bind(member.profile_id).execute(db).await.unwrap();
        // Two interests sent (one accepted), one received, and one block against the member.
        for (sender, receiver, status) in [
            (member.profile_id, other.profile_id, "accepted"),
            (member.profile_id, other.profile_id, "declined"),
            (other.profile_id, member.profile_id, "pending"),
        ] {
            sqlx::query("INSERT INTO interests (sender_profile_id, receiver_profile_id, status, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')")
                .bind(sender).bind(receiver).bind(status).execute(db).await.unwrap();
        }
        sqlx::query("INSERT INTO blocks (blocker_profile_id, blocked_profile_id) VALUES ($1, $2)")
            .bind(other.profile_id)
            .bind(member.profile_id)
            .execute(db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason) VALUES ($1, $2, 'profile', 'other')")
            .bind(other.profile_id).bind(member.profile_id).execute(db).await.unwrap();
        let path = format!("/v1/admin/profiles/{}", member.profile_id);

        let as_admin = app.get(&path, Some(&admin.token)).await;
        assert_eq!(as_admin.status, StatusCode::OK, "{}", as_admin.text);
        assert_eq!(as_admin.json["user"]["phone_e164"], "+923001112222");
        assert_eq!(
            as_admin.json["profile"]["contacts"]["phone_e164"],
            "+923004445555"
        );
        assert_eq!(
            as_admin.json["profile"]["contacts"]["preferred_contact"],
            "self"
        );

        let as_moderator = app.get(&path, Some(&moderator.token)).await;
        assert_eq!(as_moderator.status, StatusCode::OK);
        assert!(as_moderator.json["user"]["phone_e164"].is_null());
        assert!(as_moderator.json["profile"]["contacts"].is_null());
        assert!(
            !as_moderator.text.contains("+9230"),
            "no phone number reaches a moderator"
        );
        assert_eq!(
            as_moderator.json["user"]["email"],
            as_admin.json["user"]["email"]
        );

        let json = &as_moderator.json;
        assert_eq!(json["profile"]["basics"]["first_name"], "Ahmed");
        assert_eq!(json["profile"]["basics"]["marital_status"], "never_married");
        assert_eq!(json["profile"]["account_for"]["managed_by"], "self");
        assert_eq!(json["profile"]["community"]["religion_code"], "islam");
        assert_eq!(json["profile"]["community"]["language_codes"], json!([]));
        assert!(json["profile"]["location"]["city"]["name"].is_string());
        assert!(
            json["profile"]["family"]["father_status"].is_null(),
            "present as null without a row"
        );
        assert_eq!(
            json["profile"]["locked_fields"],
            json!(["gender", "date_of_birth"])
        );
        assert!(
            json["profile"]["missing"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item == "about_me")
        );
        assert_eq!(json["profile"]["photos"][0]["status"], "approved");
        assert!(
            json["profile"]["photos"][0]["large_url"]
                .as_str()
                .unwrap()
                .contains("photos/p/large.jpg")
        );
        assert_eq!(
            json["profile"]["identity"]["number_masked"],
            "*********5671"
        );
        assert!(!as_moderator.text.contains("3520212345671"));
        assert_eq!(
            json["profile"]["verification"]["pending"],
            json!({ "id_document": false, "selfie": true })
        );
        assert_eq!(json["profile"]["text_status"]["about_me"], "approved");
        assert_eq!(json["privacy"]["name_display"], "first_name_last_initial");
        assert!(json["privacy"].get("profile_id").is_none());
        assert_eq!(json["preferences"]["age_min"], 18);
        assert!(json["preferences"].get("notes_status").is_none());
        assert_eq!(json["stats"]["interests_sent"], 2);
        assert_eq!(json["stats"]["interests_received"], 1);
        assert_eq!(json["stats"]["interests_accepted_by_others"], 1);
        assert_eq!(json["stats"]["blocks_received"], 1);
        assert_eq!(json["reports_against"].as_array().unwrap().len(), 1);
        assert_eq!(
            json["reports_against"][0]["reporter"]["public_code"]
                .as_str()
                .unwrap()
                .len(),
            10
        );
        assert_eq!(
            json["reports_filed"],
            json!({ "total": 0, "actioned": 0, "dismissed": 0 })
        );
        assert_eq!(json["verification_requests"][0]["kind"], "selfie");
        assert_eq!(json["sanctions"], json!([]));
        assert_eq!(json["audit"], json!([]));

        assert_eq!(
            app.get(&path, Some(&member.token)).await.status,
            StatusCode::FORBIDDEN
        );
        let unknown = app
            .get(
                &format!("/v1/admin/profiles/{}", Uuid::now_v7()),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(unknown.status, StatusCode::NOT_FOUND);
        assert_eq!(
            app.get("/v1/admin/profiles/not-a-uuid", Some(&moderator.token))
                .await
                .status,
            StatusCode::NOT_FOUND
        );
    }

    #[sqlx::test]
    async fn locked_fields_are_corrected_by_admins_only_with_a_reason_and_one_audit_row(
        db: PgPool,
    ) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let path = format!("/v1/admin/profiles/{}/locked-fields", member.profile_id);
        let reason = "Name corrected after the document was checked again";

        let refused = app
            .patch(
                &path,
                Some(&moderator.token),
                json!({ "first_name": "Ahmad", "reason": reason }),
            )
            .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(
            app.patch(
                &path,
                Some(&member.token),
                json!({ "first_name": "Ahmad", "reason": reason })
            )
            .await
            .status,
            StatusCode::FORBIDDEN
        );

        // Validation: reason, names, date of birth, nothing to change.
        let short = app
            .patch(
                &path,
                Some(&admin.token),
                json!({ "first_name": "Ahmad", "reason": "typo" }),
            )
            .await;
        assert_eq!(short.field_errors(), vec!["reason:too_short"]);
        let digits = app
            .patch(
                &path,
                Some(&admin.token),
                json!({ "first_name": "A1", "reason": reason }),
            )
            .await;
        assert_eq!(digits.field_errors(), vec!["first_name:invalid"]);
        let contact = app
            .patch(
                &path,
                Some(&admin.token),
                json!({ "last_name": "Khan 0300 1234567", "reason": reason }),
            )
            .await;
        assert_eq!(contact.status, StatusCode::BAD_REQUEST);
        let underage =
            (time::OffsetDateTime::now_utc().date() - time::Duration::days(17 * 365)).to_string();
        let too_young = app
            .patch(
                &path,
                Some(&admin.token),
                json!({ "date_of_birth": underage, "reason": reason }),
            )
            .await;
        assert_eq!(too_young.field_errors(), vec!["date_of_birth:too_young"]);
        let format = app
            .patch(
                &path,
                Some(&admin.token),
                json!({ "date_of_birth": "20-01-1990", "reason": reason }),
            )
            .await;
        assert_eq!(format.field_errors(), vec!["date_of_birth:invalid"]);
        let nothing = app
            .patch(&path, Some(&admin.token), json!({ "reason": reason }))
            .await;
        assert_eq!(nothing.code(), "bad_request");
        assert_eq!(audit_total(app.db()).await, 0);

        // A correction.
        let old_dob: String =
            sqlx::query_scalar("SELECT date_of_birth::text FROM profiles WHERE id = $1")
                .bind(member.profile_id)
                .fetch_one(app.db())
                .await
                .unwrap();
        let response = app
            .patch(
                &path,
                Some(&admin.token),
                json!({ "first_name": "Ahmad", "date_of_birth": "1990-05-17", "reason": reason }),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["profile"]["basics"]["first_name"], "Ahmad");
        assert_eq!(
            response.json["profile"]["basics"]["date_of_birth"],
            "1990-05-17"
        );
        assert_eq!(
            audit_details(app.db(), "profile.locked_fields_change").await,
            vec![json!({
                "reason": reason,
                "changes": {
                    "first_name": { "from": "Ahmed", "to": "Ahmad" },
                    "date_of_birth": { "from": old_dob, "to": "1990-05-17" },
                },
            })]
        );
        assert_eq!(audit_total(app.db()).await, 1, "exactly one audit row");

        // The same values again change nothing and write nothing.
        let same = app
            .patch(
                &path,
                Some(&admin.token),
                json!({ "first_name": "Ahmad", "reason": reason }),
            )
            .await;
        assert_eq!(same.status, StatusCode::OK);
        assert_eq!(audit_total(app.db()).await, 1);
    }

    #[sqlx::test]
    async fn a_gender_correction_follows_its_rules(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let reason = "Gender was entered wrongly, confirmed with the family";
        let patch = |profile_id: Uuid| format!("/v1/admin/profiles/{profile_id}/locked-fields");
        let body = json!({ "gender": "female", "reason": reason });

        // A married man cannot become a woman.
        let married = app.member_with(|s| s.marital_status = "married").await;
        let response = app
            .patch(&patch(married.profile_id), Some(&admin.token), body.clone())
            .await;
        assert_eq!(response.field_errors(), vec!["gender:not_allowed"]);

        // A CNIC number ending in an odd digit stays male.
        let with_id = app.member().await;
        sqlx::query("INSERT INTO profile_identity (profile_id, document_type, number_encrypted, number_hash, number_last4) VALUES ($1, 'cnic', $2, $3, '5671')")
            .bind(with_id.profile_id)
            .bind(app.state.crypto.encrypt_identity(with_id.profile_id, "3520212345671"))
            .bind(app.state.crypto.keyed_hash("pk_id", "3520212345671"))
            .execute(app.db()).await.unwrap();
        let response = app
            .patch(&patch(with_id.profile_id), Some(&admin.token), body.clone())
            .await;
        assert_eq!(response.field_errors(), vec!["gender:mismatch"]);

        // A pending interest blocks the change; once it is over the change goes through.
        let member = app.member().await;
        let other = app.member_of(Gender::Female).await;
        let interest: Uuid = sqlx::query_scalar("INSERT INTO interests (sender_profile_id, receiver_profile_id, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id")
            .bind(other.profile_id).bind(member.profile_id).fetch_one(app.db()).await.unwrap();
        sqlx::query("UPDATE profiles SET beard = 'full' WHERE id = $1")
            .bind(member.profile_id)
            .execute(app.db())
            .await
            .unwrap();
        sqlx::query("INSERT INTO match_recommendations (profile_id, candidate_profile_id, compat, rank_score) VALUES ($1, $2, 70, 0.4), ($2, $1, 70, 0.4)")
            .bind(member.profile_id).bind(other.profile_id).execute(app.db()).await.unwrap();
        sqlx::query("UPDATE profiles SET match_stale = false WHERE id = $1")
            .bind(member.profile_id)
            .execute(app.db())
            .await
            .unwrap();
        let blocked = app
            .patch(&patch(member.profile_id), Some(&admin.token), body.clone())
            .await;
        assert_eq!(blocked.status, StatusCode::CONFLICT);
        assert_eq!(blocked.code(), "invalid_state");
        assert_eq!(audit_total(app.db()).await, 0);

        sqlx::query("UPDATE interests SET status = 'expired' WHERE id = $1")
            .bind(interest)
            .execute(app.db())
            .await
            .unwrap();
        // The snapshot is cached before the change and must be dropped by it.
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["profile"]["gender"],
            "male"
        );
        let done = app
            .patch(&patch(member.profile_id), Some(&admin.token), body)
            .await;
        assert_eq!(done.status, StatusCode::OK, "{}", done.text);
        assert_eq!(done.json["profile"]["basics"]["gender"], "female");
        let (gender, beard, stale): (String, Option<String>, bool) =
            sqlx::query_as("SELECT gender, beard, match_stale FROM profiles WHERE id = $1")
                .bind(member.profile_id)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!((gender.as_str(), beard, stale), ("female", None, true));
        let recommendations: i64 = sqlx::query_scalar("SELECT count(*) FROM match_recommendations")
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(
            recommendations, 0,
            "recommendations in both directions are deleted"
        );
        assert_eq!(
            app.get("/v1/me", Some(&member.token)).await.json["profile"]["gender"],
            "female"
        );
        let rows = audit_details(app.db(), "profile.locked_fields_change").await;
        assert_eq!(
            rows[0]["changes"]["gender"],
            json!({ "from": "male", "to": "female" })
        );
    }
}
