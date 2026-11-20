//! Connections and chat (15 section 12, 11 sections 5 to 9).
//!
//! Every route answers `404 not_found` when the caller is not one of the two members: the
//! connection is always loaded through the caller's own `connection_members` row (20 S-03).
//! `GET /v1/ws` lives in `routes/ws.rs`.
//!
//! | Module | Routes |
//! |---|---|
//! | this file | list, one connection, mute and archive, end |
//! | [`messages`] | history, send, delete own message, read |
//! | [`contact`] | contact share and its revocation |
//! | [`stages`] | stage proposals and their answers |

mod contact;
mod messages;
mod stages;

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::Connected;
use crate::db::connections::{self as db, ListFilter, Membership};
use crate::db::counters;
use crate::db::pagination::encode_cursor;
use crate::db::relations;
use crate::domain::types::ConnectionStatus;
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::connections::{
    self as models, Connection, ConnectionFilter, ConnectionListQuery, ConnectionPage,
    EndConnectionBody, PatchConnectionBody,
};
use crate::state::AppState;
use crate::views;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_connections))
        .routes(routes!(get_connection, patch_connection))
        .routes(routes!(end_connection))
        .merge(messages::router())
        .merge(contact::router())
        .merge(stages::router())
}

/// The caller's membership of a connection, or `404 not_found`.
async fn member_of(state: &AppState, me: Uuid, connection_id: Uuid) -> ApiResult<Membership> {
    db::membership(&state.db, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)
}

/// The connection as the caller sees it: the answer of most connection routes.
async fn rendered(state: &AppState, me: Uuid, connection_id: Uuid) -> ApiResult<Json<Connection>> {
    models::load(state, me, connection_id)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

/// Keyset of the chat list: `(last_message_at or created_at, id)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActivityCursor {
    #[serde(with = "time::serde::rfc3339")]
    t: OffsetDateTime,
    i: Uuid,
}

/// The chat list. `filter` is `active` (default, without archived chats), `archived` or
/// `ended`. Ordered by `last_message_at` descending; connections without messages by
/// `created_at`.
#[utoipa::path(
    get,
    path = "/connections",
    tag = "connections",
    security(("bearer" = [])),
    params(ConnectionListQuery),
    responses(
        (status = 200, body = ConnectionPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_connections(
    State(state): State<AppState>,
    account: Connected,
    ApiQuery(query): ApiQuery<ConnectionListQuery>,
) -> ApiResult<Json<ConnectionPage>> {
    let me = account.profile_id;
    let page = query.page();
    let after = page.cursor::<ActivityCursor>()?.map(|c| (c.t, c.i));
    let limit = page.limit();
    let filter = match query.filter.unwrap_or_default() {
        ConnectionFilter::Active => ListFilter::Active,
        ConnectionFilter::Archived => ListFilter::Archived,
        ConnectionFilter::Ended => ListFilter::Ended,
    };
    let mut rows = db::page(&state.db, me, filter, after, limit + 1).await?;
    let size = usize::try_from(limit).unwrap_or(0);
    let has_more = rows.len() > size;
    rows.truncate(size);
    let next_cursor = rows.last().filter(|_| has_more).map(|row| {
        encode_cursor(&ActivityCursor {
            t: row.sort_at,
            i: row.id,
        })
    });
    let viewer = views::viewer(&state, me).await?;
    let items = models::render_rows(&state, &viewer, &rows).await?;
    Ok(Json(ConnectionPage { items, next_cursor }))
}

/// One connection of the caller.
#[utoipa::path(
    get,
    path = "/connections/{connection_id}",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    responses(
        (status = 200, body = Connection),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_connection(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(connection_id): ApiPath<Uuid>,
) -> ApiResult<Json<Connection>> {
    rendered(&state, account.profile_id, connection_id).await
}

/// Mute or archive a chat. Both flags are the caller's own and invisible to the other member.
/// A muted chat sends no push and does not count in `counters.unread_chats`; an archived chat
/// moves to the Archived tab until the next message arrives.
#[utoipa::path(
    patch,
    path = "/connections/{connection_id}",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    request_body = PatchConnectionBody,
    responses(
        (status = 200, body = Connection),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn patch_connection(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(connection_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PatchConnectionBody>,
) -> ApiResult<Json<Connection>> {
    let me = account.profile_id;
    member_of(&state, me, connection_id).await?;
    db::set_flags(
        &state.db,
        me,
        connection_id,
        body.is_muted,
        body.is_archived,
    )
    .await?;
    // Only the member who changed it hears about it (19 section 4.6).
    models::publish_updated_to(&state, connection_id, me).await;
    if body.is_muted.is_some() {
        counters::push(&state, me).await;
    }
    rendered(&state, me, connection_id).await
}

/// End the connection with a reason, and optionally block the other member.
///
/// Both contact shares and the photo access between the pair are revoked, a pending stage
/// proposal is cancelled and a `connection_ended` system message is posted. The other member is
/// not notified and never sees the reason. Neither may send the other an interest for
/// `connection.cooldown_after_end_days` (90).
#[utoipa::path(
    post,
    path = "/connections/{connection_id}/end",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    request_body = EndConnectionBody,
    responses(
        (status = 200, body = Connection),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn end_connection(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(connection_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<EndConnectionBody>,
) -> ApiResult<Json<Connection>> {
    let me = account.profile_id;
    let reason = body.reason.stored();
    let mut tx = state.db.begin().await?;
    let membership = db::lock_membership(&mut tx, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if membership.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    let (_, message) = db::end(&mut tx, connection_id, me, reason)
        .await?
        .ok_or(ApiError::ConnectionEnded)?;
    tx.commit().await?;
    tracing::info!(
        event = "connection.ended",
        %connection_id,
        reason = %reason
    );

    let other = membership.other_id;
    // The block is applied after the ending, so the stored reason is the member's own; the
    // connection is already ended when the block's own effects run.
    if body.also_block == Some(true) {
        let effects = relations::block(&state.db, me, other).await?;
        for interest_id in &effects.withdrawn {
            tracing::info!(event = "interest.withdrawn", %interest_id);
        }
        for interest_id in &effects.declined {
            tracing::info!(event = "interest.declined", %interest_id);
        }
    }
    models::publish_messages(&state, [me, other], &[message]);
    models::publish_updated(&state, connection_id).await;
    counters::push(&state, me).await;
    counters::push(&state, other).await;
    rendered(&state, me, connection_id).await
}

#[cfg(test)]
mod tests;
