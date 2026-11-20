//! Discovery: home, recommendations, search, profiles, visitors, saved searches (15 section 10),
//! and the owner's preview (15 section 7).
//!
//! Every card and profile comes from [`crate::views`]; this file decides which ids to show and
//! in what order.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration as StdDuration, Instant};

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use moka::sync::Cache;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::{Browse, Connected, Open};
use crate::db::counters;
use crate::db::discovery::{self as db, KeysetSort, SearchRow, SearchScope};
use crate::db::pagination::{PageParams, decode_cursor, encode_cursor};
use crate::domain::matching::home::{NudgeInput, nudges};
use crate::domain::matching::refresh::{PoolQueryParams, pool_exhausted, recommendations_stale};
use crate::domain::matching::search::{OverFetch, normalize_public_code};
use crate::domain::time::next_karachi_midnight;
use crate::domain::visibility::{self, ViewFacts, ViewRecord};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode, FieldErrors};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::jobs::refresh_recommendations::{self, pool_summary};
use crate::jobs::{NewJob, enqueue};
use crate::models::discovery::{
    Home, NewSavedSearch, PreviewQuery, ProfileIdResponse, RecommendationsPage, SavedSearch,
    SavedSearchPatch, SavedSearchesPage, SearchFilters, SearchRequest, SearchResults, SearchSort,
    VisitedPage, VisitorItem, VisitorsPage,
};
use crate::state::AppState;
use crate::views::{self, Assessed, ProfileCard, ProfileDetail, ViewSettings, Viewer};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(get_profile))
        .routes(routes!(get_profile_by_code))
        .routes(routes!(get_preview))
        .routes(routes!(get_visitors))
        .routes(routes!(get_visited))
        .routes(routes!(get_recommendations))
        .routes(routes!(post_refresh))
        .routes(routes!(get_home))
        .routes(routes!(post_search))
        .routes(routes!(list_saved_searches, create_saved_search))
        .routes(routes!(patch_saved_search, delete_saved_search))
}

// -------------------------------------------------------------------------------------------
// Other members' profiles (15 section 10, 09 sections 2 and 8)
// -------------------------------------------------------------------------------------------

/// Another member's profile. `404` whenever the caller may not open it (09 section 2). Records
/// a profile view and counts it against `limits.profile_views_per_day`, except for connections
/// (09 section 8.1).
#[utoipa::path(
    get,
    path = "/profiles/{profile_id}",
    tag = "discovery",
    security(("bearer" = [])),
    params(("profile_id" = Uuid, Path, description = "The profile to open")),
    responses(
        (status = 200, body = ProfileDetail),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn get_profile(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(profile_id): ApiPath<Uuid>,
) -> ApiResult<Json<ProfileDetail>> {
    let viewer = views::viewer(&state, account.profile_id).await?;
    let opened = views::open(&state, &viewer, profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let settings = state.settings.get().await?;
    let today = viewer.today();
    let (last_viewed_today_at, profiles_viewed_today) =
        db::view_state(&state.db, viewer.id(), profile_id, today).await?;
    let record = visibility::record_view(
        &ViewFacts {
            tier: opened.tier(),
            viewer_records_visits: viewer.privacy().record_my_visits,
            last_viewed_today_at,
            profiles_viewed_today,
            profile_views_per_day: settings.profile_views_per_day,
        },
        viewer.now,
    );
    if record == ViewRecord::LimitReached {
        tracing::info!(
            event = "limit.reached",
            limit = "limits.profile_views_per_day"
        );
        return Err(ApiError::LimitReached {
            limit: "limits.profile_views_per_day",
            used: profiles_viewed_today,
            resets_at: Some(next_karachi_midnight(viewer.now)),
            side: None,
        });
    }
    db::apply_view(&state.db, viewer.id(), profile_id, today, record).await?;
    Ok(Json(opened.render(&state, &viewer).await?))
}

/// Resolves a profile code to an id, under the same visibility rules (09 section 4.3 rule 8).
#[utoipa::path(
    get,
    path = "/profiles/by-code/{public_code}",
    tag = "discovery",
    security(("bearer" = [])),
    params(("public_code" = String, Path, description = "A profile code such as KR7F3K2QX9")),
    responses(
        (status = 200, body = ProfileIdResponse),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_profile_by_code(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(public_code): ApiPath<String>,
) -> ApiResult<Json<ProfileIdResponse>> {
    let code = normalize_public_code(&public_code);
    let profile_id = db::profile_id_by_code(&state.db, &code)
        .await?
        .ok_or(ApiError::NotFound)?;
    let viewer = views::viewer(&state, account.profile_id).await?;
    views::can_open(&state, &viewer, profile_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(ProfileIdResponse { profile_id }))
}

/// The caller's own profile as another member would see it, at the tier `as` (15 section 7,
/// 08 section 4). Works in every profile status and records no view.
#[utoipa::path(
    get,
    path = "/me/profile/preview",
    tag = "profile",
    security(("bearer" = [])),
    params(PreviewQuery),
    responses(
        (status = 200, body = ProfileDetail),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn get_preview(
    State(state): State<AppState>,
    account: Open,
    ApiQuery(query): ApiQuery<PreviewQuery>,
) -> ApiResult<Json<ProfileDetail>> {
    let tier = query.as_tier.unwrap_or_default().tier();
    Ok(Json(
        views::preview(&state, account.profile_id, tier).await?,
    ))
}

/// Keyset of the visitor lists: `(last_viewed_at, profile id)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct VisitCursor {
    #[serde(with = "time::serde::rfc3339")]
    t: OffsetDateTime,
    i: Uuid,
}

/// Who viewed the caller's profile in the last 30 days, without private visits and without
/// viewers the caller can no longer open (09 section 8.3). Empty with
/// `hidden_because_private` when the caller browses privately (09 section 8.2).
#[utoipa::path(
    get,
    path = "/me/visitors",
    tag = "discovery",
    security(("bearer" = [])),
    params(PageParams),
    responses(
        (status = 200, body = VisitorsPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn get_visitors(
    State(state): State<AppState>,
    account: Browse,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<VisitorsPage>> {
    let viewer = views::viewer(&state, account.profile_id).await?;
    if visibility::visitors_hidden(viewer.privacy()) {
        return Ok(Json(VisitorsPage {
            items: Vec::new(),
            next_cursor: None,
            hidden_because_private: true,
        }));
    }
    let (items, next_cursor) = visit_page(&state, &viewer, &page, VisitList::Visitors).await?;
    Ok(Json(VisitorsPage {
        items,
        next_cursor,
        hidden_because_private: false,
    }))
}

/// The caller's own viewing history for the last 30 days (09 section 8.2 rule 4). Profiles the
/// caller can no longer open are left out.
#[utoipa::path(
    get,
    path = "/me/visited",
    tag = "discovery",
    security(("bearer" = [])),
    params(PageParams),
    responses(
        (status = 200, body = VisitedPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn get_visited(
    State(state): State<AppState>,
    account: Browse,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<VisitedPage>> {
    let viewer = views::viewer(&state, account.profile_id).await?;
    let (items, next_cursor) = visit_page(&state, &viewer, &page, VisitList::Visited).await?;
    Ok(Json(VisitedPage { items, next_cursor }))
}

#[derive(Debug, Clone, Copy)]
enum VisitList {
    Visitors,
    Visited,
}

/// One page of visitors or visited profiles, with the over-fetch loop of 10 section 9.3 so
/// that profiles the caller cannot open do not shorten pages or repeat across them.
async fn visit_page(
    state: &AppState,
    viewer: &Viewer,
    page: &PageParams,
    list: VisitList,
) -> ApiResult<(Vec<VisitorItem>, Option<String>)> {
    let cursor = page
        .cursor::<VisitCursor>()?
        .map(|cursor| (cursor.t, cursor.i));
    let limit = usize::try_from(page.limit()).unwrap_or(20);
    let mut pager = OverFetch::new(limit, cursor);
    let mut cards: HashMap<Uuid, ProfileCard> = HashMap::new();
    while !pager.is_done() {
        let after = pager.after().copied();
        let rows = match list {
            VisitList::Visitors => {
                db::visitors(&state.db, viewer.id(), 30, after, pager.batch_size()).await?
            }
            VisitList::Visited => {
                db::visited(&state.db, viewer.id(), after, pager.batch_size()).await?
            }
        };
        let ids: Vec<Uuid> = rows.iter().map(|row| row.profile_id).collect();
        let mut batch = views::cards(state, viewer, &ids).await?;
        pager.absorb(
            rows,
            |row| (row.last_viewed_at, row.profile_id),
            |row| match batch.remove(&row.profile_id) {
                Some(card) => {
                    cards.insert(row.profile_id, card);
                    true
                }
                None => false,
            },
        );
    }
    let page = pager.finish();
    let items = page
        .items
        .into_iter()
        .filter_map(|row| {
            cards.remove(&row.profile_id).map(|profile| VisitorItem {
                profile,
                last_viewed_at: row.last_viewed_at,
                view_count: row.view_count,
            })
        })
        .collect();
    let next_cursor = page
        .next_cursor
        .map(|(t, i)| encode_cursor(&VisitCursor { t, i }));
    Ok((items, next_cursor))
}

// -------------------------------------------------------------------------------------------
// Recommendations and home (10 sections 8 and 10)
// -------------------------------------------------------------------------------------------

/// How long a stale list is refreshed inline before answering with the old rows (10 section
/// 8.6 step 1).
const INLINE_REFRESH_WAIT: StdDuration = StdDuration::from_secs(2);

/// `POST /v1/recommendations/refresh` is allowed once per this period per profile.
const MANUAL_REFRESH_PERIOD: StdDuration = StdDuration::from_secs(600);

/// When each profile last asked for a manual refresh (one API instance, 19 section 6.2).
static MANUAL_REFRESHES: LazyLock<Cache<Uuid, Instant>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(100_000)
        .time_to_live(MANUAL_REFRESH_PERIOD)
        .build()
});

/// Step 1 of 10 section 8.6: when the list is stale, start a refresh and wait for it for at
/// most 2 seconds. Returns `is_refreshing`: true when the refresh is still running in the
/// background.
async fn refresh_if_stale(state: &AppState, viewer: &Viewer) -> ApiResult<bool> {
    let settings = state.settings.get().await?;
    let refresh_hours = u32::try_from(settings.refresh_hours.max(0)).unwrap_or(u32::MAX);
    let row = viewer.row();
    if !recommendations_stale(
        row.match_stale,
        row.match_refreshed_at,
        refresh_hours,
        viewer.now,
    ) {
        return Ok(false);
    }
    let task_state = state.clone();
    let profile_id = viewer.id();
    let task =
        tokio::spawn(
            async move { refresh_recommendations::refresh(&task_state, profile_id).await },
        );
    match tokio::time::timeout(INLINE_REFRESH_WAIT, task).await {
        Ok(Ok(Ok(_))) => Ok(false),
        Ok(Ok(Err(error))) => {
            tracing::warn!(error = %format!("{error:#}"), "inline recommendations refresh failed");
            Ok(false)
        }
        Ok(Err(error)) => {
            tracing::warn!(%error, "inline recommendations refresh panicked");
            Ok(false)
        }
        Err(_) => Ok(true),
    }
}

/// A cached candidate is served only when the viewer may still open it, no E4 to E7 exclusion
/// applies, and the must-haves still pass in both directions (10 section 8.6 step 3). The
/// must-have re-check keeps 03 section 8 rule 11 true even when the candidate's own values or
/// preferences changed since the last refresh.
fn recommendable(assessed: &Assessed) -> bool {
    assessed.discoverable()
        && assessed.matching.as_ref().is_some_and(|facts| {
            facts.owner_meets_viewer_must_haves && facts.viewer_meets_owner_must_haves
        })
}

/// Keyset of the recommendations: `(rank_score, candidate id)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RankCursor {
    r: f32,
    i: Uuid,
}

/// One page of the cache by `rank_score` with the read-time checks: dropped rows are deleted
/// from the cache and further rows are fetched while the page is short (10 section 8.6 steps
/// 2, 3 and 6).
async fn recommendation_cards(
    state: &AppState,
    viewer: &Viewer,
    after: Option<(f32, Uuid)>,
    limit: usize,
) -> ApiResult<(Vec<ProfileCard>, Option<(f32, Uuid)>)> {
    let mut pager = OverFetch::new(limit, after);
    let mut cards: HashMap<Uuid, ProfileCard> = HashMap::new();
    let mut dropped: Vec<Uuid> = Vec::new();
    while !pager.is_done() {
        let rows = db::recommendation_page(
            &state.db,
            viewer.id(),
            pager.after().copied(),
            pager.batch_size(),
        )
        .await?;
        let ids: Vec<Uuid> = rows.iter().map(|row| row.candidate_profile_id).collect();
        let mut batch = views::discovery_cards(state, viewer, &ids).await?;
        pager.absorb(
            rows,
            |row| (row.rank_score, row.candidate_profile_id),
            |row| match batch.remove(&row.candidate_profile_id) {
                Some((assessed, card)) if recommendable(&assessed) => {
                    cards.insert(row.candidate_profile_id, card);
                    true
                }
                _ => {
                    dropped.push(row.candidate_profile_id);
                    false
                }
            },
        );
    }
    db::delete_recommendations(&state.db, viewer.id(), &dropped).await?;
    let page = pager.finish();
    let items: Vec<ProfileCard> = page
        .items
        .iter()
        .filter_map(|row| cards.remove(&row.candidate_profile_id))
        .collect();
    Ok((items, page.next_cursor))
}

/// `pool_exhausted` and the relaxation hints (10 section 8.7); hints only while exhausted.
async fn exhaustion(
    state: &AppState,
    viewer: &Viewer,
) -> ApiResult<(bool, Vec<crate::domain::matching::refresh::RelaxationHint>)> {
    let summary = pool_summary(viewer.id());
    let shown = db::shown_counts(&state.db, viewer.id()).await?;
    let exhausted = pool_exhausted(summary.as_ref().map(|s| s.eligible_count), &shown);
    let hints = if exhausted {
        summary.map_or_default(|s| s.relaxation_hints)
    } else {
        Vec::new()
    };
    Ok((exhausted, hints))
}

/// Ranked matches, paginated. A stale list is refreshed first when that takes under 2
/// seconds; otherwise the old list is served with `is_refreshing: true` (10 section 8.6).
/// Each returned candidate's `shown_count` grows, at most once every 6 hours.
#[utoipa::path(
    get,
    path = "/recommendations",
    tag = "discovery",
    security(("bearer" = [])),
    params(PageParams),
    responses(
        (status = 200, body = RecommendationsPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn get_recommendations(
    State(state): State<AppState>,
    account: Browse,
    ApiQuery(page): ApiQuery<PageParams>,
) -> ApiResult<Json<RecommendationsPage>> {
    let viewer = views::viewer(&state, account.profile_id).await?;
    let is_refreshing = refresh_if_stale(&state, &viewer).await?;
    let after = page
        .cursor::<RankCursor>()?
        .map(|cursor| (cursor.r, cursor.i));
    let limit = usize::try_from(page.limit()).unwrap_or(20);
    let (items, next) = recommendation_cards(&state, &viewer, after, limit).await?;
    let shown: Vec<Uuid> = items.iter().map(|card| card.id).collect();
    db::mark_shown(&state.db, viewer.id(), &shown).await?;
    let (pool_exhausted, relaxation_hints) = exhaustion(&state, &viewer).await?;
    Ok(Json(RecommendationsPage {
        items,
        next_cursor: next.map(|(r, i)| encode_cursor(&RankCursor { r, i })),
        refreshed_at: db::refreshed_at(&state.db, viewer.id()).await?,
        is_refreshing,
        pool_exhausted,
        relaxation_hints,
    }))
}

/// Recompute recommendations now: marks them stale and enqueues the refresh job. At most once
/// per 10 minutes (`rate_limited`).
#[utoipa::path(
    post,
    path = "/recommendations/refresh",
    tag = "discovery",
    security(("bearer" = [])),
    responses(
        (status = 202, description = "The refresh is queued"),
        (status = 403, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn post_refresh(State(state): State<AppState>, account: Browse) -> ApiResult<StatusCode> {
    let profile_id = account.profile_id;
    if let Some(at) = MANUAL_REFRESHES.get(&profile_id) {
        let elapsed = at.elapsed();
        if elapsed < MANUAL_REFRESH_PERIOD {
            return Err(ApiError::RateLimited {
                retry_after_seconds: MANUAL_REFRESH_PERIOD
                    .saturating_sub(elapsed)
                    .as_secs()
                    .max(1),
            });
        }
    }
    let mut tx = state.db.begin().await?;
    db::mark_stale(&mut *tx, profile_id).await?;
    enqueue(
        &mut *tx,
        NewJob::new(
            "refresh_recommendations",
            json!({ "profile_id": profile_id, "notify": false }),
        )
        .dedupe(profile_id.to_string()),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();
    MANUAL_REFRESHES.insert(profile_id, Instant::now());
    Ok(StatusCode::ACCEPTED)
}

/// How many cache rows to examine for each home list of 10.
const HOME_LIST: usize = 10;
const HOME_FETCH: i64 = 30;

/// Cards for cached candidates in the given order, keeping only those that pass the read-time
/// checks; the others are deleted from the cache.
async fn cached_cards(
    state: &AppState,
    viewer: &Viewer,
    ids: &[Uuid],
    keep: usize,
) -> ApiResult<Vec<ProfileCard>> {
    let mut batch = views::discovery_cards(state, viewer, ids).await?;
    let mut cards = Vec::new();
    let mut dropped = Vec::new();
    for id in ids {
        match batch.remove(id) {
            Some((assessed, card)) if recommendable(&assessed) => {
                if cards.len() < keep {
                    cards.push(card);
                }
            }
            _ => dropped.push(*id),
        }
    }
    db::delete_recommendations(&state.db, viewer.id(), &dropped).await?;
    Ok(cards)
}

/// Everything the home screen needs in one call (15 section 10, 10 section 10).
#[utoipa::path(
    get,
    path = "/home",
    tag = "discovery",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Home),
        (status = 403, body = ErrorBody)
    )
)]
async fn get_home(State(state): State<AppState>, account: Browse) -> ApiResult<Json<Home>> {
    let viewer = views::viewer(&state, account.profile_id).await?;
    refresh_if_stale(&state, &viewer).await?;

    let (recommendations, _) = recommendation_cards(&state, &viewer, None, HOME_LIST).await?;
    let shown: Vec<Uuid> = recommendations.iter().map(|card| card.id).collect();
    db::mark_shown(&state.db, viewer.id(), &shown).await?;

    let new_ids = db::new_member_rows(&state.db, viewer.id(), &shown, HOME_FETCH).await?;
    let new_members = cached_cards(&state, &viewer, &new_ids, HOME_LIST).await?;

    let row = viewer.row();
    let nearby = if row.city_id.is_none() && row.region_id.is_none() {
        Vec::new()
    } else {
        let mut exclude = shown.clone();
        exclude.extend(new_members.iter().map(|card| card.id));
        let ids = db::nearby_rows(
            &state.db,
            viewer.id(),
            row.city_id,
            row.region_id,
            &exclude,
            HOME_FETCH,
        )
        .await?;
        cached_cards(&state, &viewer, &ids, HOME_LIST).await?
    };

    let (recent_visitors, visitors_count_7d) = recent_visitors(&state, &viewer).await?;
    let pending_interests = counters::load(&state.db, viewer.id(), viewer.user_id())
        .await?
        .pending_interests;
    let facts = db::nudge_facts(&state.db, viewer.id()).await?;
    let (pool_exhausted, relaxation_hints) = exhaustion(&state, &viewer).await?;
    Ok(Json(Home {
        recommendations,
        new_members,
        nearby,
        recent_visitors,
        visitors_count_7d,
        pending_interests,
        completeness: row.completeness,
        nudges: nudges(&NudgeInput {
            has_photo_in_progress_or_approved: facts.has_photo_in_progress_or_approved,
            is_id_verified: facts.is_id_verified,
            has_pending_id_document_request: facts.has_pending_id_document_request,
            about_me_item_met: facts.about_me_item_met,
            has_preferences_row: facts.has_preferences_row,
            has_approved_photo: facts.has_approved_photo,
            is_photo_verified: facts.is_photo_verified,
            has_pending_selfie_request: facts.has_pending_selfie_request,
            has_contact_phone: facts.has_contact_phone,
            completeness: facts.completeness,
        }),
        pool_exhausted,
        relaxation_hints,
    }))
}

/// Most visitors counted for `visitors_count_7d`.
const VISITORS_COUNTED: usize = 1000;
/// Visitors shown on home.
const RECENT_VISITORS: usize = 5;

/// Up to 5 recent visitors the viewer can open, newest first, and the number of distinct such
/// visitors in 7 days. Both are empty for a viewer who browses privately (09 section 8.2).
async fn recent_visitors(state: &AppState, viewer: &Viewer) -> ApiResult<(Vec<ProfileCard>, i64)> {
    if visibility::visitors_hidden(viewer.privacy()) {
        return Ok((Vec::new(), 0));
    }
    let rows = db::visitors(&state.db, viewer.id(), 7, None, VISITORS_COUNTED).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.profile_id).collect();
    let openable = views::screen(state, viewer, &ids).await?;
    let visible: Vec<Uuid> = ids
        .into_iter()
        .filter(|id| openable.contains_key(id))
        .collect();
    let first: Vec<Uuid> = visible.iter().copied().take(RECENT_VISITORS).collect();
    let mut cards = views::cards(state, viewer, &first).await?;
    let recent = first.iter().filter_map(|id| cards.remove(id)).collect();
    Ok((recent, i64::try_from(visible.len()).unwrap_or(i64::MAX)))
}

// -------------------------------------------------------------------------------------------
// Search (10 section 9)
// -------------------------------------------------------------------------------------------

/// `best_match` lists are cached for this long (10 section 9.3).
const BEST_MATCH_TTL: StdDuration = StdDuration::from_secs(600);
/// Rows examined for a `best_match` search.
const BEST_MATCH_POOL: i64 = 600;
/// `total_estimate` counts at most this many rows plus one.
const TOTAL_ESTIMATE_CAP: i64 = 500;

/// The ordered ids of a `best_match` search, keyed by viewer and the SHA-256 of the canonical
/// JSON of the filters.
type BestMatchKey = (Uuid, [u8; 32]);
static BEST_MATCH: LazyLock<Cache<BestMatchKey, Arc<Vec<Uuid>>>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(10_000)
        .time_to_live(BEST_MATCH_TTL)
        .build()
});

/// The opaque search cursor: `{"s":"newest","t":"...","i":"..."}` or `{"s":"best_match","o":40}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchCursor {
    s: SearchSort,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "time::serde::rfc3339::option"
    )]
    t: Option<OffsetDateTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    i: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    o: Option<usize>,
}

/// Search with filters (10 section 9). The stored preferences are not applied; E1 to E9 are.
#[utoipa::path(
    post,
    path = "/search",
    tag = "discovery",
    security(("bearer" = [])),
    request_body = SearchRequest,
    responses(
        (status = 200, body = SearchResults),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn post_search(
    State(state): State<AppState>,
    account: Browse,
    ApiJson(request): ApiJson<SearchRequest>,
) -> ApiResult<Json<SearchResults>> {
    let viewer = views::viewer(&state, account.profile_id).await?;
    let limit = usize::try_from(request.limit.unwrap_or(20).clamp(1, 50)).unwrap_or(20);
    if let Some(code) = request
        .filters
        .public_code
        .as_deref()
        .map(normalize_public_code)
        .filter(|code| !code.is_empty())
    {
        return Ok(Json(search_by_code(&state, &viewer, &code).await?));
    }
    validate_filters(&state, &request.filters).await?;
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_cursor::<SearchCursor>)
        .transpose()?;
    if cursor
        .as_ref()
        .is_some_and(|cursor| cursor.s != request.sort)
    {
        return Err(ApiError::BadRequest(
            "the cursor belongs to another sort".to_owned(),
        ));
    }
    let Some(gender) = viewer.gender() else {
        return Ok(Json(SearchResults {
            items: Vec::new(),
            next_cursor: None,
            total_estimate: Some(0),
        }));
    };
    let settings = state.settings.get().await?;
    let scope = SearchScope {
        viewer_id: viewer.id(),
        viewer_gender: gender,
        viewer_accepts_married: viewer.member.accepts_married(),
        viewer_is_married: viewer.row().marital_status
            == Some(crate::domain::options::MaritalStatus::Married),
        cooldowns: ViewSettings::new(&settings).cooldowns,
        today: viewer.today(),
        filters: &request.filters,
        activated_after: None,
    };
    let (items, next_cursor) = match request.sort {
        SearchSort::Newest => {
            keyset_search(&state, &viewer, &scope, KeysetSort::Newest, cursor, limit).await?
        }
        SearchSort::RecentlyActive => {
            keyset_search(
                &state,
                &viewer,
                &scope,
                KeysetSort::RecentlyActive,
                cursor,
                limit,
            )
            .await?
        }
        SearchSort::BestMatch => best_match_search(&state, &viewer, &scope, cursor, limit).await?,
    };
    let total_estimate = if request.cursor.is_none() {
        let count = db::search_count(&state.db, &scope, TOTAL_ESTIMATE_CAP + 1).await?;
        (count <= TOTAL_ESTIMATE_CAP).then_some(count)
    } else {
        None
    };
    Ok(Json(SearchResults {
        items,
        next_cursor,
        total_estimate,
    }))
}

/// A search by profile code ignores every other filter and E4 to E7: the profile is returned
/// whenever the viewer may open it (10 section 9.1 rule 3).
async fn search_by_code(state: &AppState, viewer: &Viewer, code: &str) -> ApiResult<SearchResults> {
    let items = match db::profile_id_by_code(&state.db, code).await? {
        Some(id) => views::cards(state, viewer, &[id])
            .await?
            .remove(&id)
            .into_iter()
            .collect(),
        None => Vec::new(),
    };
    let total = i64::try_from(items.len()).unwrap_or(0);
    Ok(SearchResults {
        items,
        next_cursor: None,
        total_estimate: Some(total),
    })
}

/// The keyset sorts with the over-fetch loop of 10 section 9.3: the cursor is the key of the
/// last row examined, so no row is skipped or repeated even when rows are dropped.
async fn keyset_search(
    state: &AppState,
    viewer: &Viewer,
    scope: &SearchScope<'_>,
    sort: KeysetSort,
    cursor: Option<SearchCursor>,
    limit: usize,
) -> ApiResult<(Vec<ProfileCard>, Option<String>)> {
    let after = cursor.and_then(|cursor| cursor.i.map(|id| (cursor.t, id)));
    let mut pager = OverFetch::new(limit, after);
    let mut cards: HashMap<Uuid, ProfileCard> = HashMap::new();
    while !pager.is_done() {
        let rows = db::search_page(
            &state.db,
            scope,
            sort,
            pager.after().copied(),
            pager.batch_size(),
        )
        .await?;
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let mut batch = views::discovery_cards(state, viewer, &ids).await?;
        pager.absorb(
            rows,
            |row: &SearchRow| sort.key_of(row),
            |row| match batch.remove(&row.id) {
                Some((assessed, card)) if assessed.discoverable() => {
                    cards.insert(row.id, card);
                    true
                }
                _ => false,
            },
        );
    }
    let page = pager.finish();
    let items = page
        .items
        .iter()
        .filter_map(|row| cards.remove(&row.id))
        .collect();
    let s = match sort {
        KeysetSort::Newest => SearchSort::Newest,
        KeysetSort::RecentlyActive => SearchSort::RecentlyActive,
    };
    let next_cursor = page.next_cursor.map(|(t, i)| {
        encode_cursor(&SearchCursor {
            s,
            t,
            i: Some(i),
            o: None,
        })
    });
    Ok((items, next_cursor))
}

/// `best_match` (10 section 9.3): up to 600 filtered rows in the pre-rank order, kept when the
/// viewer may find them, ordered by `compat`, then recent activity, then id, and cached for 10
/// minutes. The cursor is an offset into that list; a missing entry is rebuilt.
async fn best_match_search(
    state: &AppState,
    viewer: &Viewer,
    scope: &SearchScope<'_>,
    cursor: Option<SearchCursor>,
    limit: usize,
) -> ApiResult<(Vec<ProfileCard>, Option<String>)> {
    let offset = cursor.and_then(|cursor| cursor.o).unwrap_or(0);
    let digest: [u8; 32] =
        Sha256::digest(serde_json::to_vec(scope.filters).unwrap_or_default()).into();
    let key = (viewer.id(), digest);
    let ordered = if let Some(ordered) = BEST_MATCH.get(&key) {
        ordered
    } else {
        let ordered = Arc::new(best_match_order(state, viewer, scope).await?);
        BEST_MATCH.insert(key, ordered.clone());
        ordered
    };
    let page_ids: Vec<Uuid> = ordered.iter().skip(offset).take(limit).copied().collect();
    let mut batch = views::discovery_cards(state, viewer, &page_ids).await?;
    let items = page_ids
        .iter()
        .filter_map(|id| match batch.remove(id) {
            Some((assessed, card)) if assessed.discoverable() => Some(card),
            _ => None,
        })
        .collect();
    let next = offset + limit;
    let next_cursor = (next < ordered.len()).then(|| {
        encode_cursor(&SearchCursor {
            s: SearchSort::BestMatch,
            t: None,
            i: None,
            o: Some(next),
        })
    });
    Ok((items, next_cursor))
}

/// Builds the ordered `best_match` list.
async fn best_match_order(
    state: &AppState,
    viewer: &Viewer,
    scope: &SearchScope<'_>,
) -> ApiResult<Vec<Uuid>> {
    let hints = viewer.subject().map_or_else(
        || PoolQueryParams {
            city_ids: Vec::new(),
            region_ids: Vec::new(),
            country_codes: Vec::new(),
            viewer_accepts_married: false,
            viewer_is_married: false,
            born_after: None,
            born_on_or_before: None,
            religion_codes: None,
        },
        |subject| PoolQueryParams::new(subject, viewer.prefs(), viewer.today()),
    );
    let rows = db::search_pool(&state.db, scope, &hints, BEST_MATCH_POOL).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let screened = views::screen(state, viewer, &ids).await?;
    let mut ranked: Vec<(u8, Option<OffsetDateTime>, Uuid)> = rows
        .iter()
        .filter_map(|row| {
            let seen = screened.get(&row.id)?;
            seen.discoverable()
                .then(|| (seen.compat().unwrap_or(0), row.last_active_at, row.id))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    Ok(ranked.into_iter().map(|(_, _, id)| id).collect())
}

/// Validates search filters (10 section 9.2): ages 18 to 80 with `age_min <= age_max`,
/// heights 122 to 213, `active_within_days` 1, 7 or 30, `joined_within_days` 7 or 30, the
/// array sizes of 04 section 5.6, and every code, rank and place id must exist. A filter set
/// with `public_code` ignores the rest and is not validated further.
pub async fn validate_filters(state: &AppState, filters: &SearchFilters) -> ApiResult<()> {
    if filters.public_code.is_some() {
        return Ok(());
    }
    let mut errors = FieldErrors::new();
    validate_ranges(filters, &mut errors);
    validate_codes(filters, &state.reference.get(), &mut errors);
    let cities = filters.city_ids.clone().unwrap_or_default();
    let regions = filters.region_ids.clone().unwrap_or_default();
    if cities.len() > 20 {
        errors.add("filters.city_ids", FieldCode::TooLong);
    }
    if regions.len() > 20 {
        errors.add("filters.region_ids", FieldCode::TooLong);
    }
    if (!cities.is_empty() && cities.len() <= 20) || (!regions.is_empty() && regions.len() <= 20) {
        let distinct = |ids: &[i32]| {
            let mut ids = ids.to_vec();
            ids.sort_unstable();
            ids.dedup();
            i64::try_from(ids.len()).unwrap_or(i64::MAX)
        };
        let (found_cities, found_regions) =
            db::existing_places(&state.db, &cities, &regions).await?;
        if cities.len() <= 20 && found_cities < distinct(&cities) {
            errors.add("filters.city_ids", FieldCode::UnknownCode);
        }
        if regions.len() <= 20 && found_regions < distinct(&regions) {
            errors.add("filters.region_ids", FieldCode::UnknownCode);
        }
    }
    errors.finish()
}

/// The numeric rules of 10 section 9.2.
fn validate_ranges(filters: &SearchFilters, errors: &mut FieldErrors) {
    let mut range = |field: &str, value: Option<i16>, min: i16, max: i16| {
        if value.is_some_and(|value| !(min..=max).contains(&value)) {
            errors.add(format!("filters.{field}"), FieldCode::OutOfRange);
        }
    };
    range("age_min", filters.age_min, 18, 80);
    range("age_max", filters.age_max, 18, 80);
    range("height_min_cm", filters.height_min_cm, 122, 213);
    range("height_max_cm", filters.height_max_cm, 122, 213);
    if let (Some(min), Some(max)) = (filters.age_min, filters.age_max)
        && min > max
    {
        errors.add("filters.age_max", FieldCode::OutOfRange);
    }
    if let (Some(min), Some(max)) = (filters.height_min_cm, filters.height_max_cm)
        && min > max
    {
        errors.add("filters.height_max_cm", FieldCode::OutOfRange);
    }
    if filters
        .active_within_days
        .is_some_and(|days| ![1, 7, 30].contains(&days))
    {
        errors.add("filters.active_within_days", FieldCode::Invalid);
    }
    if filters
        .joined_within_days
        .is_some_and(|days| ![7, 30].contains(&days))
    {
        errors.add("filters.joined_within_days", FieldCode::Invalid);
    }
}

/// Reference codes and ranks must exist; array sizes follow 04 section 5.6.
fn validate_codes(
    filters: &SearchFilters,
    reference: &crate::reference::ReferenceData,
    errors: &mut FieldErrors,
) {
    let mut codes =
        |field: &str, values: Option<&Vec<String>>, max: usize, known: &dyn Fn(&str) -> bool| {
            let Some(values) = values else { return };
            if values.len() > max {
                errors.add(format!("filters.{field}"), FieldCode::TooLong);
            } else if !values.iter().all(|code| known(code)) {
                errors.add(format!("filters.{field}"), FieldCode::UnknownCode);
            }
        };
    let many = usize::MAX;
    codes(
        "religion_codes",
        filters.religion_codes.as_ref(),
        many,
        &|c| reference.religion(c).is_some(),
    );
    codes("sect_codes", filters.sect_codes.as_ref(), many, &|c| {
        reference.sect(c).is_some()
    });
    codes("caste_codes", filters.caste_codes.as_ref(), 30, &|c| {
        reference
            .caste(c)
            .is_some_and(|caste| caste.parent_code.is_none())
    });
    codes(
        "mother_tongue_codes",
        filters.mother_tongue_codes.as_ref(),
        many,
        &|c| reference.language(c).is_some(),
    );
    codes("country_codes", filters.country_codes.as_ref(), 20, &|c| {
        reference.country(c).is_some()
    });
    codes(
        "profession_codes",
        filters.profession_codes.as_ref(),
        20,
        &|c| reference.profession(c).is_some(),
    );
    if filters.education_min_rank.is_some_and(|rank| {
        !reference
            .education_levels
            .iter()
            .any(|level| level.rank == rank)
    }) {
        errors.add("filters.education_min_rank", FieldCode::OutOfRange);
    }
    if filters
        .income_min_rank
        .is_some_and(|rank| !reference.income_bands.iter().any(|band| band.rank == rank))
    {
        errors.add("filters.income_min_rank", FieldCode::OutOfRange);
    }
}

// -------------------------------------------------------------------------------------------
// Saved searches (10 section 9.5)
// -------------------------------------------------------------------------------------------

fn saved_search(row: db::SavedSearchRow) -> SavedSearch {
    SavedSearch {
        id: row.id,
        name: row.name,
        filters: serde_json::from_value(row.filters).unwrap_or_default(),
        notify_new: row.notify_new,
        created_at: row.created_at,
    }
}

/// A saved search name: 1 to 60 characters after trimming.
fn saved_search_name(name: &str) -> ApiResult<String> {
    let name = name.trim();
    let length = name.chars().count();
    if length == 0 {
        return Err(ApiError::field("name", FieldCode::Required));
    }
    if length > 60 {
        return Err(ApiError::field("name", FieldCode::TooLong));
    }
    Ok(name.to_owned())
}

/// The caller's saved searches, newest first.
#[utoipa::path(
    get,
    path = "/me/saved-searches",
    tag = "discovery",
    security(("bearer" = [])),
    responses(
        (status = 200, body = SavedSearchesPage),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_saved_searches(
    State(state): State<AppState>,
    account: Browse,
) -> ApiResult<Json<SavedSearchesPage>> {
    let rows = db::saved_searches(&state.db, account.profile_id).await?;
    Ok(Json(SavedSearchesPage {
        items: rows.into_iter().map(saved_search).collect(),
        next_cursor: None,
    }))
}

/// Save a search. At most `limits.saved_searches_max` (10) per profile (`limit_reached`).
#[utoipa::path(
    post,
    path = "/me/saved-searches",
    tag = "discovery",
    security(("bearer" = [])),
    request_body = NewSavedSearch,
    responses(
        (status = 201, body = SavedSearch),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn create_saved_search(
    State(state): State<AppState>,
    account: Browse,
    ApiJson(body): ApiJson<NewSavedSearch>,
) -> ApiResult<(StatusCode, Json<SavedSearch>)> {
    let name = saved_search_name(&body.name)?;
    validate_filters(&state, &body.filters).await?;
    let settings = state.settings.get().await?;
    let filters = serde_json::to_value(&body.filters).map_err(anyhow::Error::from)?;
    match db::insert_saved_search(
        &state.db,
        account.profile_id,
        &name,
        &filters,
        body.notify_new,
        settings.saved_searches_max,
    )
    .await?
    {
        Ok(row) => Ok((StatusCode::CREATED, Json(saved_search(row)))),
        Err(used) => {
            tracing::info!(event = "limit.reached", limit = "limits.saved_searches_max");
            Err(ApiError::limit("limits.saved_searches_max", used))
        }
    }
}

/// Rename a saved search or switch its notifications.
#[utoipa::path(
    patch,
    path = "/me/saved-searches/{id}",
    tag = "discovery",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "The saved search")),
    request_body = SavedSearchPatch,
    responses(
        (status = 200, body = SavedSearch),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn patch_saved_search(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SavedSearchPatch>,
) -> ApiResult<Json<SavedSearch>> {
    let name = body.name.as_deref().map(saved_search_name).transpose()?;
    db::update_saved_search(
        &state.db,
        account.profile_id,
        id,
        name.as_deref(),
        body.notify_new,
    )
    .await?
    .map(|row| Json(saved_search(row)))
    .ok_or(ApiError::NotFound)
}

/// Delete a saved search.
#[utoipa::path(
    delete,
    path = "/me/saved-searches/{id}",
    tag = "discovery",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "The saved search")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn delete_saved_search(
    State(state): State<AppState>,
    account: Browse,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    if db::delete_saved_search(&state.db, account.profile_id, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

#[cfg(test)]
#[path = "discovery_tests.rs"]
mod tests;
