//! Shortlist, pass and block (15 section 13, 09 section 11, 11 section 12).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::{Browse, Connected};
use crate::db::counters;
use crate::db::pagination::{PageParams, encode_cursor};
use crate::db::relations::{self as db, SHORTLIST_MAX};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::state::AppState;
use crate::views::{self, ProfileCard};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_shortlist))
        .routes(routes!(put_shortlist, delete_shortlist))
        .routes(routes!(put_pass, delete_pass))
        .routes(routes!(list_blocks))
        .routes(routes!(put_block, delete_block))
}

/// Keyset of the shortlist and block lists: `(created_at, profile id)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CreatedCursor {
    #[serde(with = "time::serde::rfc3339")]
    t: OffsetDateTime,
    i: Uuid,
}

/// Answers `404` unless the caller may open the target (09 section 2): shortlisting and
/// passing need an openable target (11 section 12).
async fn require_openable(state: &AppState, viewer_id: Uuid, target: Uuid) -> ApiResult<()> {
    let viewer = views::viewer(state, viewer_id).await?;
    views::can_open(state, &viewer, target)
        .await?
        .map(|_| ())
        .ok_or(ApiError::NotFound)
}

// -------------------------------------------------------------------------------------------
// Shortlist
// -------------------------------------------------------------------------------------------

/// `PUT /v1/shortlist/{profile_id}`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ShortlistBody {
    /// A private note, at most 300 characters. `null` or missing clears it.
    pub note: Option<String>,
}

/// One shortlist entry. `profile` is `null` when the profile is no longer visible; the client
/// shows "No longer available" with a remove button.
#[derive(Debug, Serialize, ToSchema)]
pub struct ShortlistItem {
    pub profile_id: Uuid,
    pub profile: Option<ProfileCard>,
    pub note: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShortlistPage {
    pub items: Vec<ShortlistItem>,
    pub next_cursor: Option<String>,
}

/// Shortlisted profiles, newest first.
#[utoipa::path(
    get,
    path = "/shortlist",
    tag = "relations",
    security(("bearer" = [])),
    params(PageParams),
    responses(
        (status = 200, body = ShortlistPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_shortlist(
    State(state): State<AppState>,
    account: Browse,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<ShortlistPage>> {
    let after = page.cursor::<CreatedCursor>()?.map(|c| (c.t, c.i));
    let limit = page.limit();
    let rows = db::shortlist_page(&state.db, account.profile_id, after, limit + 1).await?;
    let viewer = views::viewer(&state, account.profile_id).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.target_profile_id).collect();
    let mut cards = views::cards(&state, &viewer, &ids).await?;
    let page = crate::db::pagination::Page::from_rows(
        rows,
        limit,
        |row| CreatedCursor {
            t: row.created_at,
            i: row.target_profile_id,
        },
        |row| ShortlistItem {
            profile_id: row.target_profile_id,
            profile: cards.remove(&row.target_profile_id),
            note: row.note,
            created_at: row.created_at,
        },
    );
    Ok(Json(ShortlistPage {
        items: page.items,
        next_cursor: page.next_cursor,
    }))
}

/// Add a profile to the shortlist, or replace its note. At most 200 entries (`limit_reached`).
/// The other member is never told.
#[utoipa::path(
    put,
    path = "/shortlist/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The profile to shortlist")),
    request_body = ShortlistBody,
    responses(
        (status = 204, description = "Shortlisted"),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn put_shortlist(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(profile_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ShortlistBody>,
) -> ApiResult<StatusCode> {
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty());
    if note.is_some_and(|note| note.chars().count() > 300) {
        return Err(ApiError::field("note", FieldCode::TooLong));
    }
    require_openable(&state, account.profile_id, profile_id).await?;
    match db::shortlist_put(&state.db, account.profile_id, profile_id, note).await? {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(used) => {
            tracing::info!(event = "limit.reached", limit = "shortlist_max");
            Err(ApiError::limit("shortlist_max", used.max(SHORTLIST_MAX)))
        }
    }
}

/// Remove a profile from the shortlist. Works even when the profile is no longer visible.
#[utoipa::path(
    delete,
    path = "/shortlist/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The shortlisted profile")),
    responses(
        (status = 204, description = "Removed"),
        (status = 403, body = ErrorBody)
    )
)]
async fn delete_shortlist(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    db::shortlist_delete(&state.db, account.profile_id, profile_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// -------------------------------------------------------------------------------------------
// Pass
// -------------------------------------------------------------------------------------------

/// Mark a profile as not interested for `pass.duration_days` (180): it leaves the caller's
/// recommendations and search, and any shortlist entry is removed. A pending sent interest
/// is not withdrawn (11 section 12).
#[utoipa::path(
    put,
    path = "/passes/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The profile to pass")),
    responses(
        (status = 204, description = "Passed"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn put_pass(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    require_openable(&state, account.profile_id, profile_id).await?;
    let settings = state.settings.get().await?;
    db::pass_put(
        &state.db,
        account.profile_id,
        profile_id,
        settings.pass_duration_days,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Undo a pass.
#[utoipa::path(
    delete,
    path = "/passes/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The passed profile")),
    responses(
        (status = 204, description = "Undone"),
        (status = 403, body = ErrorBody)
    )
)]
async fn delete_pass(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    db::pass_delete(&state.db, account.profile_id, profile_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// -------------------------------------------------------------------------------------------
// Block
// -------------------------------------------------------------------------------------------

/// One blocked profile: only the name at tier `member` and the code (15 section 13).
#[derive(Debug, Serialize, ToSchema)]
pub struct BlockItem {
    pub profile_id: Uuid,
    pub display_name: String,
    pub public_code: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BlocksPage {
    pub items: Vec<BlockItem>,
    pub next_cursor: Option<String>,
}

/// Profiles the caller blocked, newest first. No photo and no other data.
#[utoipa::path(
    get,
    path = "/blocks",
    tag = "relations",
    security(("bearer" = [])),
    params(PageParams),
    responses(
        (status = 200, body = BlocksPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_blocks(
    State(state): State<AppState>,
    account: Connected,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<BlocksPage>> {
    let after = page.cursor::<CreatedCursor>()?.map(|c| (c.t, c.i));
    let limit = page.limit();
    let rows = db::blocks_page(&state.db, account.profile_id, after, limit + 1).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.blocked_profile_id).collect();
    let mut names = views::names_at_member_tier(&state, &ids).await?;
    let has_more = rows.len() > usize::try_from(limit).unwrap_or(usize::MAX);
    let rows: Vec<db::BlockRow> = rows
        .into_iter()
        .take(usize::try_from(limit).unwrap_or(usize::MAX))
        .collect();
    let next_cursor = rows.last().filter(|_| has_more).map(|row| {
        encode_cursor(&CreatedCursor {
            t: row.created_at,
            i: row.blocked_profile_id,
        })
    });
    let items = rows
        .into_iter()
        .filter_map(|row| {
            names
                .remove(&row.blocked_profile_id)
                .map(|(display_name, public_code)| BlockItem {
                    profile_id: row.blocked_profile_id,
                    display_name,
                    public_code,
                    created_at: row.created_at,
                })
        })
        .collect();
    Ok(Json(BlocksPage { items, next_cursor }))
}

/// Block a profile. In one transaction: the block, the active connection ended with reason
/// `blocked`, pending interests closed, photo access revoked both ways, shortlist entries and
/// recommendations deleted both ways, notifications about each other removed. The other
/// member is not told; each simply disappears for the other.
#[utoipa::path(
    put,
    path = "/blocks/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The profile to block")),
    responses(
        (status = 204, description = "Blocked"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn put_block(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    // Members only ever deal with the other gender (03 section 8 rule 1): anything else does
    // not exist for the caller.
    let target_gender = db::profile_gender(&state.db, profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if profile_id == account.profile_id
        || target_gender.is_none()
        || account.gender.is_none()
        || target_gender == account.gender
    {
        return Err(ApiError::NotFound);
    }
    let effects = db::block(&state.db, account.profile_id, profile_id).await?;
    after_block(&state, account.profile_id, profile_id, &effects).await;
    Ok(StatusCode::NO_CONTENT)
}

/// What follows a committed block: the log lines of 20 section 8.2 for what it ended or closed,
/// and `counters` for both members (pending interests and unread chats may have changed).
/// Shared with `POST /v1/reports` with `also_block`.
pub(super) async fn after_block(
    state: &AppState,
    by: Uuid,
    target: Uuid,
    effects: &db::BlockEffects,
) {
    if let Some(ended) = effects.ended {
        tracing::info!(
            event = "connection.ended",
            connection_id = %ended.connection_id,
            reason = "blocked"
        );
    }
    for interest_id in &effects.withdrawn {
        tracing::info!(event = "interest.withdrawn", %interest_id);
    }
    for interest_id in &effects.declined {
        tracing::info!(event = "interest.declined", %interest_id);
    }
    counters::push(state, by).await;
    counters::push(state, target).await;
}

/// Remove a block. Nothing else is restored.
#[utoipa::path(
    delete,
    path = "/blocks/{profile_id}",
    tag = "relations",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The blocked profile")),
    responses(
        (status = 204, description = "Unblocked"),
        (status = 403, body = ErrorBody)
    )
)]
async fn delete_block(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    db::unblock(&state.db, account.profile_id, profile_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
#[path = "relations_tests.rs"]
mod tests;
