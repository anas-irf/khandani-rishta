//! Staff routes: caste suggestions and the caste list (15 section 16, 18 section 6).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::{Admin, Moderator};
use crate::db::admin::castes::{self, CastePatch, NewCaste};
use crate::db::pagination::{Page, PageParams};
use crate::domain::types::CasteSuggestionStatus;
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::admin::{AdminCaste, CasteSuggestionItem, Items, PromotedCaste};
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_suggestions))
        .routes(routes!(promote_suggestion))
        .routes(routes!(reject_suggestion))
        .routes(routes!(list_castes, create_caste))
        .routes(routes!(patch_caste))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SuggestionsQuery {
    /// `pending` (default), `promoted` or `rejected`.
    pub status: Option<CasteSuggestionStatus>,
}

/// Suggested castes, most used first, with similar existing castes.
#[utoipa::path(
    get,
    path = "/caste-suggestions",
    tag = "admin",
    security(("bearer" = [])),
    params(SuggestionsQuery, PageParams),
    responses(
        (status = 200, body = Page<CasteSuggestionItem>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_suggestions(
    State(state): State<AppState>,
    _staff: Moderator,
    ApiQuery(query): ApiQuery<SuggestionsQuery>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<Page<CasteSuggestionItem>>> {
    let limit = page.limit();
    let cursor = page.cursor::<(i32, Uuid)>()?;
    let status = query.status.unwrap_or(CasteSuggestionStatus::Pending);
    let rows = castes::suggestions(&state.db, status, cursor, limit).await?;
    Ok(Json(Page::from_rows(
        rows,
        limit,
        castes::SuggestionRow::cursor,
        castes::SuggestionRow::item,
    )))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PromoteBody {
    /// Lower case letters, digits and underscores, starting with a letter. A sub-caste's code
    /// starts with `<parent_code>_`.
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    /// Must be the suggestion's own parent, when it has one.
    pub parent_code: Option<String>,
}

/// Promotes a suggestion to a caste (admin only) and rewrites the profiles that typed it.
#[utoipa::path(
    post,
    path = "/caste-suggestions/{id}/promote",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Suggestion id")),
    request_body = PromoteBody,
    responses(
        (status = 200, body = PromotedCaste),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn promote_suggestion(
    State(state): State<AppState>,
    admin: Admin,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PromoteBody>,
) -> ApiResult<Json<PromotedCaste>> {
    let new = NewCaste {
        code: body.code,
        name: body.name,
        name_ur: body.name_ur,
        parent_code: body.parent_code,
        ..NewCaste::default()
    };
    Ok(Json(
        castes::promote(&state, admin.user_id, id, &new).await?,
    ))
}

/// Rejects a pending suggestion.
#[utoipa::path(
    post,
    path = "/caste-suggestions/{id}/reject",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Suggestion id")),
    responses(
        (status = 200, body = CasteSuggestionItem),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn reject_suggestion(
    State(state): State<AppState>,
    staff: Moderator,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<CasteSuggestionItem>> {
    castes::reject(&state, staff.user_id, id).await?;
    castes::suggestion(&state.db, id)
        .await?
        .map(|row| Json(row.item()))
        .ok_or(ApiError::NotFound)
}

/// Every caste and sub-caste, including inactive ones.
#[utoipa::path(
    get,
    path = "/castes",
    tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, body = Items<AdminCaste>), (status = 403, body = ErrorBody))
)]
async fn list_castes(
    State(state): State<AppState>,
    _staff: Moderator,
) -> ApiResult<Json<Items<AdminCaste>>> {
    Ok(Json(Items {
        items: castes::list_castes(&state.db).await?,
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateCasteBody {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    /// A top-level caste: makes this a sub-caste (two levels only).
    pub parent_code: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub sort_order: Option<i32>,
}

/// Adds a caste or sub-caste (admin only).
#[utoipa::path(
    post,
    path = "/castes",
    tag = "admin",
    security(("bearer" = [])),
    request_body = CreateCasteBody,
    responses(
        (status = 201, body = AdminCaste),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn create_caste(
    State(state): State<AppState>,
    admin: Admin,
    ApiJson(body): ApiJson<CreateCasteBody>,
) -> ApiResult<(StatusCode, Json<AdminCaste>)> {
    let new = NewCaste {
        code: body.code,
        name: body.name,
        name_ur: body.name_ur,
        parent_code: body.parent_code,
        aliases: body.aliases,
        sort_order: body.sort_order,
    };
    let caste = castes::create(&state, admin.user_id, &new).await?;
    Ok((StatusCode::CREATED, Json(caste)))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PatchCasteBody {
    pub name: Option<String>,
    /// An empty string removes the Urdu name.
    pub name_ur: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub sort_order: Option<i32>,
    /// Deactivating a caste that has active sub-castes is refused.
    pub is_active: Option<bool>,
}

/// Renames, re-orders, changes the aliases of, or (de)activates a caste (admin only).
#[utoipa::path(
    patch,
    path = "/castes/{code}",
    tag = "admin",
    security(("bearer" = [])),
    params(("code" = String, Path, description = "Caste code")),
    request_body = PatchCasteBody,
    responses(
        (status = 200, body = AdminCaste),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn patch_caste(
    State(state): State<AppState>,
    admin: Admin,
    ApiPath(code): ApiPath<String>,
    ApiJson(body): ApiJson<PatchCasteBody>,
) -> ApiResult<Json<AdminCaste>> {
    let patch = CastePatch {
        name: body.name,
        name_ur: body.name_ur,
        aliases: body.aliases,
        sort_order: body.sort_order,
        is_active: body.is_active,
    };
    Ok(Json(
        castes::patch(&state, admin.user_id, &code, patch).await?,
    ))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::db::admin::test_util::{audit_details, audit_total};
    use crate::domain::types::UserRole;
    use crate::test_support::{TestApp, TestUser};

    async fn suggest(app: &TestApp, name: &str, parent: Option<&str>, usage: i32) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO caste_suggestions (name, normalized_name, parent_code, usage_count)
             VALUES ($1, lower($1), $2, $3) RETURNING id",
        )
        .bind(name)
        .bind(parent)
        .bind(usage)
        .fetch_one(app.db())
        .await
        .unwrap()
    }

    async fn typed_caste(app: &TestApp, user: &TestUser, typed: &str) {
        sqlx::query("UPDATE profiles SET caste_other = $2 WHERE id = $1")
            .bind(user.profile_id)
            .bind(typed)
            .execute(app.db())
            .await
            .unwrap();
    }

    /// T-509: promoting a caste suggestion updates the profiles that used it.
    #[sqlx::test]
    async fn promoting_a_suggestion_updates_the_profiles_that_used_it(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let spaced = app.member().await;
        let upper = app.member().await;
        let plain = app.member().await;
        let other_name = app.member().await;
        let sub_level = app.member().await;
        typed_caste(&app, &plain, "Mirasi").await;
        typed_caste(&app, &spaced, "  mirasi ").await;
        typed_caste(&app, &upper, "MIRASI").await;
        typed_caste(&app, &other_name, "Tarkhi").await;
        // Someone who picked Rajput and typed Mirasi as the sub-caste is a different suggestion.
        sqlx::query(
            "UPDATE profiles SET caste_code = 'rajput', sub_caste_other = 'Mirasi' WHERE id = $1",
        )
        .bind(sub_level.profile_id)
        .execute(app.db())
        .await
        .unwrap();
        sqlx::query("UPDATE profiles SET match_stale = false")
            .execute(app.db())
            .await
            .unwrap();
        let suggestion = suggest(&app, "Mirasi", None, 3).await;
        let path = format!("/v1/admin/caste-suggestions/{suggestion}/promote");
        let body = json!({ "code": "mirasi", "name": "Mirasi", "name_ur": "میراسی" });

        // Only admins promote.
        let refused = app.post(&path, Some(&moderator.token), body.clone()).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(audit_total(app.db()).await, 0);

        let response = app.post(&path, Some(&admin.token), body).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["profiles_updated"], 3);
        assert_eq!(response.json["caste"]["code"], "mirasi");
        assert_eq!(response.json["caste"]["name_ur"], "میراسی");
        assert!(response.json["caste"]["parent_code"].is_null());
        assert_eq!(response.json["caste"]["is_active"], true);

        // The three profiles now carry the code and no free text.
        for user in [&plain, &spaced, &upper] {
            let (code, other, stale): (Option<String>, Option<String>, bool) = sqlx::query_as(
                "SELECT caste_code, caste_other, match_stale FROM profiles WHERE id = $1",
            )
            .bind(user.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
            assert_eq!((code.as_deref(), other), (Some("mirasi"), None));
            assert!(stale);
        }
        let untouched: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT caste_code, caste_other FROM profiles WHERE id = $1")
                .bind(other_name.profile_id)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(untouched, (None, Some("Tarkhi".to_owned())));
        let sub: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT caste_code, sub_caste_code, sub_caste_other FROM profiles WHERE id = $1",
        )
        .bind(sub_level.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(
            sub,
            (Some("rajput".to_owned()), None, Some("Mirasi".to_owned()))
        );

        // The suggestion, the audit row and the reference cache.
        let (status, promoted): (String, Option<String>) =
            sqlx::query_as("SELECT status, promoted_code FROM caste_suggestions WHERE id = $1")
                .bind(suggestion)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(
            (status.as_str(), promoted.as_deref()),
            ("promoted", Some("mirasi"))
        );
        assert_eq!(
            audit_details(app.db(), "caste_suggestion.promote").await,
            vec![json!({ "code": "mirasi", "profiles_updated": 3 })]
        );
        let target: String = sqlx::query_scalar(
            "SELECT target_id FROM admin_audit_log WHERE action = 'caste_suggestion.promote'",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(target, suggestion.to_string());
        assert_eq!(audit_total(app.db()).await, 1);
        let reference = app.state.reference.get();
        assert!(
            reference
                .caste("mirasi")
                .is_some_and(|caste| caste.is_active)
        );
        assert!(
            String::from_utf8_lossy(&reference.bootstrap_json).contains("Mirasi"),
            "the pickers show it at once"
        );

        // A promoted suggestion cannot be promoted again.
        let again = app
            .post(
                &path,
                Some(&admin.token),
                json!({ "code": "mirasi_two", "name": "Mirasi" }),
            )
            .await;
        assert_eq!(again.status, StatusCode::CONFLICT);
        assert_eq!(again.code(), "invalid_state");
    }

    #[sqlx::test]
    async fn promotion_rules_are_enforced(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let promote = |id: Uuid| format!("/v1/admin/caste-suggestions/{id}/promote");

        let top = suggest(&app, "Kamboh", None, 5).await;
        for (code, expected) in [
            ("Kamboh", "code:invalid"),
            ("1kamboh", "code:invalid"),
            ("kam boh", "code:invalid"),
            ("", "code:invalid"),
        ] {
            let response = app
                .post(
                    &promote(top),
                    Some(&admin.token),
                    json!({ "code": code, "name": "Kamboh" }),
                )
                .await;
            assert_eq!(response.field_errors(), vec![expected], "{code:?}");
        }
        let short_name = app
            .post(
                &promote(top),
                Some(&admin.token),
                json!({ "code": "kamboh", "name": "K" }),
            )
            .await;
        assert_eq!(short_name.field_errors(), vec!["name:too_short"]);
        // A code in use answers 409 already_exists.
        let taken = app
            .post(
                &promote(top),
                Some(&admin.token),
                json!({ "code": "rajput", "name": "Kamboh" }),
            )
            .await;
        assert_eq!(taken.status, StatusCode::CONFLICT);
        assert_eq!(taken.code(), "already_exists");
        // The parent must be the suggestion's own parent.
        let wrong_parent = app
            .post(
                &promote(top),
                Some(&admin.token),
                json!({ "code": "awan_kamboh", "name": "Kamboh", "parent_code": "awan" }),
            )
            .await;
        assert_eq!(wrong_parent.field_errors(), vec!["parent_code:mismatch"]);
        assert_eq!(audit_total(app.db()).await, 0);

        // A sub-caste suggestion: its code starts with the parent code, and the parent is top level.
        let sub = suggest(&app, "Kamboh", Some("rajput"), 2).await;
        let no_prefix = app
            .post(
                &promote(sub),
                Some(&admin.token),
                json!({ "code": "kamboh", "name": "Kamboh" }),
            )
            .await;
        assert_eq!(no_prefix.field_errors(), vec!["code:invalid"]);
        sqlx::query(
            "UPDATE profiles SET caste_code = 'rajput', sub_caste_other = 'KAMBOH' WHERE id = $1",
        )
        .bind(app.member().await.profile_id)
        .execute(app.db())
        .await
        .unwrap();
        let ok = app
            .post(
                &promote(sub),
                Some(&admin.token),
                json!({ "code": "rajput_kamboh", "name": "Kamboh", "parent_code": "rajput" }),
            )
            .await;
        assert_eq!(ok.status, StatusCode::OK, "{}", ok.text);
        assert_eq!(ok.json["caste"]["parent_code"], "rajput");
        assert_eq!(ok.json["profiles_updated"], 1);
        let (code, other): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT sub_caste_code, sub_caste_other FROM profiles WHERE sub_caste_code IS NOT NULL",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!((code.as_deref(), other), (Some("rajput_kamboh"), None));

        // Two levels only: a sub-caste cannot be a parent.
        let deep = suggest(&app, "Deep", Some("rajput_chauhan"), 1).await;
        let too_deep = app
            .post(
                &promote(deep),
                Some(&admin.token),
                json!({ "code": "rajput_chauhan_deep", "name": "Deep", "parent_code": "rajput_chauhan" }),
            )
            .await;
        assert_eq!(too_deep.field_errors(), vec!["parent_code:invalid"]);
        let missing = app
            .post(
                &promote(Uuid::now_v7()),
                Some(&admin.token),
                json!({ "code": "x_y", "name": "Xy" }),
            )
            .await;
        assert_eq!(missing.status, StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn suggestions_are_listed_by_usage_with_similar_castes_and_can_be_rejected(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;
        let member = app.member().await;
        let busy = suggest(&app, "Quraishy", None, 9).await;
        let quiet = suggest(&app, "Mirasi", None, 2).await;
        let sub = suggest(&app, "Zebra", Some("rajput"), 4).await;

        assert_eq!(
            app.get("/v1/admin/caste-suggestions", Some(&member.token))
                .await
                .status,
            StatusCode::FORBIDDEN
        );
        let list = app
            .get("/v1/admin/caste-suggestions", Some(&moderator.token))
            .await;
        assert_eq!(list.status, StatusCode::OK, "{}", list.text);
        let ids: Vec<&str> = list.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            vec![busy.to_string(), sub.to_string(), quiet.to_string()]
        );
        let first = &list.json["items"][0];
        assert_eq!(first["name"], "Quraishy");
        assert_eq!(first["normalized_name"], "quraishy");
        assert_eq!(first["usage_count"], 9);
        assert_eq!(first["status"], "pending");
        let similar: Vec<&str> = first["similar"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["code"].as_str().unwrap())
            .collect();
        assert!(similar.contains(&"qureshi"), "{similar:?}");
        assert_eq!(list.json["items"][1]["parent_code"], "rajput");
        assert_eq!(list.json["items"][1]["parent_name"], "Rajput");
        assert!(list.json["items"][2]["similar"].is_array());

        let page = app
            .get(
                "/v1/admin/caste-suggestions?limit=2",
                Some(&moderator.token),
            )
            .await;
        let cursor = page.json["next_cursor"].as_str().unwrap().to_owned();
        let rest = app
            .get(
                &format!("/v1/admin/caste-suggestions?cursor={cursor}"),
                Some(&moderator.token),
            )
            .await;
        assert_eq!(rest.json["items"][0]["id"], quiet.to_string());

        // Moderators reject; the name stays in the table as rejected.
        let reject = format!("/v1/admin/caste-suggestions/{busy}/reject");
        assert_eq!(
            app.post_empty(&reject, Some(&member.token)).await.status,
            StatusCode::FORBIDDEN
        );
        let response = app.post_empty(&reject, Some(&moderator.token)).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert_eq!(response.json["status"], "rejected");
        assert_eq!(
            audit_details(app.db(), "caste_suggestion.reject").await,
            vec![json!({ "name": "Quraishy" })]
        );
        assert_eq!(audit_total(app.db()).await, 1);
        let again = app.post_empty(&reject, Some(&moderator.token)).await;
        assert_eq!(again.status, StatusCode::CONFLICT);
        let promote = app
            .post(
                &format!("/v1/admin/caste-suggestions/{busy}/promote"),
                Some(&admin.token),
                json!({ "code": "quraishy", "name": "Quraishy" }),
            )
            .await;
        assert_eq!(promote.status, StatusCode::CONFLICT);
        let rejected = app
            .get(
                "/v1/admin/caste-suggestions?status=rejected",
                Some(&moderator.token),
            )
            .await;
        assert_eq!(rejected.json["items"].as_array().unwrap().len(), 1);
        let pending = app
            .get("/v1/admin/caste-suggestions", Some(&moderator.token))
            .await;
        assert_eq!(pending.json["items"].as_array().unwrap().len(), 2);
    }

    #[sqlx::test]
    async fn castes_are_added_edited_and_deactivated_with_the_two_level_rule(db: PgPool) {
        let app = TestApp::new(db).await;
        let admin = app.staff(UserRole::Admin).await;
        let moderator = app.staff(UserRole::Moderator).await;

        // Moderators may read the list, only admins change it.
        let list = app.get("/v1/admin/castes", Some(&moderator.token)).await;
        assert_eq!(list.status, StatusCode::OK, "{}", list.text);
        assert!(list.json["items"].as_array().unwrap().len() > 100);
        let rajput = list.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["code"] == "rajput")
            .unwrap();
        assert_eq!(rajput["is_active"], true);
        assert_eq!(rajput["aliases"], json!(["Rajpoot", "Raja"]));
        let create = json!({ "code": "zargar", "name": "  Zargar ", "aliases": ["Zargar2", " zargar2 ", "Sunar"] });
        assert_eq!(
            app.post("/v1/admin/castes", Some(&moderator.token), create.clone())
                .await
                .status,
            StatusCode::FORBIDDEN
        );

        let created = app
            .post("/v1/admin/castes", Some(&admin.token), create)
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{}", created.text);
        assert_eq!(created.json["code"], "zargar");
        assert_eq!(created.json["name"], "Zargar");
        assert_eq!(
            created.json["aliases"],
            json!(["Zargar2", "Sunar"]),
            "trimmed, without duplicates"
        );
        assert!(created.json["sort_order"].as_i64().unwrap() > 100);
        assert!(app.state.reference.get().caste("zargar").is_some());
        assert_eq!(
            audit_details(app.db(), "caste.create").await,
            vec![json!({ "name": "Zargar", "parent_code": null })]
        );

        // Rules for new castes.
        let dup = app
            .post(
                "/v1/admin/castes",
                Some(&admin.token),
                json!({ "code": "zargar", "name": "Again" }),
            )
            .await;
        assert_eq!(dup.status, StatusCode::CONFLICT);
        assert_eq!(dup.code(), "already_exists");
        for (body, expected) in [
            (json!({ "code": "Zargar2", "name": "Name" }), "code:invalid"),
            (
                json!({ "code": "zargar_a", "name": "Name", "parent_code": "nowhere" }),
                "parent_code:unknown_code",
            ),
            (
                json!({ "code": "a_b", "name": "Name", "parent_code": "zargar" }),
                "code:invalid",
            ),
            (
                json!({ "code": "rajput_chauhan_x", "name": "Name", "parent_code": "rajput_chauhan" }),
                "parent_code:invalid",
            ),
            (json!({ "code": "zargar_a", "name": "N" }), "name:too_short"),
            (
                json!({ "code": "zargar_a", "name": "Name", "sort_order": -1 }),
                "sort_order:out_of_range",
            ),
        ] {
            let response = app
                .post("/v1/admin/castes", Some(&admin.token), body.clone())
                .await;
            assert_eq!(response.field_errors(), vec![expected], "{body}");
        }
        let sub = app.post("/v1/admin/castes", Some(&admin.token),
            json!({ "code": "zargar_lahori", "name": "Lahori", "parent_code": "zargar", "sort_order": 5 })).await;
        assert_eq!(sub.status, StatusCode::CREATED, "{}", sub.text);
        assert_eq!(sub.json["parent_code"], "zargar");
        assert_eq!(sub.json["sort_order"], 5);

        // Edit: name, aliases, order. Nothing else changes, and the audit row lists the diff.
        let patch = app
            .patch(
                "/v1/admin/castes/zargar",
                Some(&admin.token),
                json!({ "name": "Zargar Sunar", "aliases": ["Sunar"], "sort_order": 1000 }),
            )
            .await;
        assert_eq!(patch.status, StatusCode::OK, "{}", patch.text);
        assert_eq!(patch.json["name"], "Zargar Sunar");
        let rows = audit_details(app.db(), "caste.update").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0]["changes"]["name"],
            json!({ "from": "Zargar", "to": "Zargar Sunar" })
        );
        assert_eq!(
            rows[0]["changes"]["aliases"],
            json!({ "from": ["Zargar2", "Sunar"], "to": ["Sunar"] })
        );
        assert_eq!(rows[0]["changes"]["sort_order"]["to"], 1000);
        assert!(rows[0]["changes"].get("is_active").is_none());
        assert_eq!(
            app.state.reference.get().caste("zargar").unwrap().name,
            "Zargar Sunar"
        );
        // The same values again write no audit row.
        let same = app
            .patch(
                "/v1/admin/castes/zargar",
                Some(&admin.token),
                json!({ "name": "Zargar Sunar" }),
            )
            .await;
        assert_eq!(same.status, StatusCode::OK);
        assert_eq!(audit_details(app.db(), "caste.update").await.len(), 1);

        // A caste with active sub-castes cannot be deactivated; after the sub-caste, it can.
        let blocked = app
            .patch(
                "/v1/admin/castes/zargar",
                Some(&admin.token),
                json!({ "is_active": false }),
            )
            .await;
        assert_eq!(blocked.status, StatusCode::CONFLICT);
        assert_eq!(blocked.code(), "invalid_state");
        let child = app
            .patch(
                "/v1/admin/castes/zargar_lahori",
                Some(&admin.token),
                json!({ "is_active": false }),
            )
            .await;
        assert_eq!(child.status, StatusCode::OK);
        let parent = app
            .patch(
                "/v1/admin/castes/zargar",
                Some(&admin.token),
                json!({ "is_active": false }),
            )
            .await;
        assert_eq!(parent.status, StatusCode::OK, "{}", parent.text);
        assert_eq!(parent.json["is_active"], false);
        assert!(!app.state.reference.get().caste("zargar").unwrap().is_active);
        let admin_list = app.get("/v1/admin/castes", Some(&moderator.token)).await;
        let inactive = admin_list.json["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["code"] == "zargar")
            .unwrap();
        assert_eq!(
            inactive["is_active"], false,
            "inactive rows stay in the admin list"
        );

        let missing = app
            .patch(
                "/v1/admin/castes/nowhere",
                Some(&admin.token),
                json!({ "name": "Nowhere" }),
            )
            .await;
        assert_eq!(missing.status, StatusCode::NOT_FOUND);
        let unknown_key = app
            .patch(
                "/v1/admin/castes/zargar",
                Some(&admin.token),
                json!({ "code": "zz" }),
            )
            .await;
        assert_eq!(unknown_key.code(), "bad_request", "codes cannot be changed");
        assert_eq!(
            app.patch(
                "/v1/admin/castes/zargar",
                Some(&moderator.token),
                json!({ "name": "Nope" })
            )
            .await
            .status,
            StatusCode::FORBIDDEN
        );
    }
}
