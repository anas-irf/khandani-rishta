//! Stages of a rishta (11 section 9, 03 section 4.8, 15 section 12): proposals and their
//! answers.

use axum::Json;
use axum::extract::State;
use serde_json::json;
use time::OffsetDateTime;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use super::{member_of, rendered};
use crate::auth::Engage;
use crate::db::connections::{self as db, MessageRow, ProposalRow};
use crate::db::counters;
use crate::domain::options::{ConnectionEndReason, ConnectionStage};
use crate::domain::time::karachi_date;
use crate::domain::types::{
    ConnectionStatus, NotificationType, ProfileStatus, ProposalStatus, SystemEvent,
};
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::extract::{ApiJson, ApiPath};
use crate::lifecycle::{self, EndedConnection};
use crate::models::connections::{
    Connection, StageProposalBody, publish_messages, publish_updated,
};
use crate::notify;
use crate::state::AppState;

pub(super) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(propose_stage))
        .routes(routes!(cancel_proposal))
        .routes(routes!(confirm_proposal))
        .routes(routes!(decline_proposal))
}

/// After a member's proposal was declined, they may propose the same stage again only after
/// this long (11 section 9.2 rule 3). A fixed rule, not a setting.
pub const REPROPOSE_AFTER: time::Duration = time::Duration::days(7);

/// Propose the next stage: later than the current one (`invalid_state`), with no proposal
/// pending (`already_exists`), and not a stage this member proposed and saw declined in the
/// last 7 days (`cooldown_active`). Posts a `stage_proposed` system message and notifies the
/// other member.
#[utoipa::path(
    post,
    path = "/connections/{connection_id}/stage-proposals",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    request_body = StageProposalBody,
    responses(
        (status = 200, body = Connection),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn propose_stage(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(connection_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<StageProposalBody>,
) -> ApiResult<Json<Connection>> {
    let me = account.profile_id;
    let wanted = body.stage.stage();
    let mut tx = state.db.begin().await?;
    let membership = db::lock_membership(&mut tx, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if membership.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    if wanted <= membership.stage {
        return Err(ApiError::invalid_state(membership.stage));
    }
    if db::has_pending_proposal(&mut tx, connection_id).await? {
        return Err(ApiError::AlreadyExists);
    }
    if let Some(declined_at) = db::last_declined(&mut tx, connection_id, me, wanted).await? {
        let ends = declined_at + REPROPOSE_AFTER;
        if ends > OffsetDateTime::now_utc() {
            return Err(ApiError::CooldownActive {
                retry_after_date: karachi_date(ends),
            });
        }
    }
    let proposal = db::insert_proposal(&mut tx, connection_id, me, wanted)
        .await?
        .ok_or(ApiError::AlreadyExists)?;
    let message = db::insert_system_message(
        &mut tx,
        connection_id,
        SystemEvent::StageProposed,
        json!({ "actor_profile_id": me, "proposal_id": proposal.id, "stage": wanted }),
    )
    .await?;
    tx.commit().await?;

    publish_messages(&state, [me, membership.other_id], &[message]);
    if let Err(error) = notify::notify(
        &state,
        membership.other_user_id,
        NotificationType::StageProposed,
        Some(me),
        json!({ "connection_id": connection_id, "proposal_id": proposal.id, "stage": wanted }),
    )
    .await
    {
        tracing::warn!(error = %format!("{error:#}"), "could not notify stage_proposed");
    }
    publish_updated(&state, connection_id).await;
    rendered(&state, me, connection_id).await
}

/// The proposal, locked, after the connection checks every answer shares: the caller is a
/// member (`404`), the connection is active (`connection_ended`), the proposal belongs to it
/// (`404`), the caller is (`proposer = true`) or is not the proposer (`forbidden`), and it is
/// still pending (`invalid_state`).
async fn locked_pending(
    conn: &mut sqlx::PgConnection,
    me: Uuid,
    connection_id: Uuid,
    proposal_id: Uuid,
    proposer: bool,
) -> ApiResult<(db::Membership, ProposalRow)> {
    let membership = db::lock_membership(&mut *conn, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if membership.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    let proposal = db::lock_proposal(&mut *conn, connection_id, proposal_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if (proposal.proposed_by_profile_id == me) != proposer {
        return Err(ApiError::Forbidden);
    }
    if proposal.status != ProposalStatus::Pending {
        return Err(ApiError::invalid_state(proposal.status));
    }
    Ok((membership, proposal))
}

/// What the effects of `nikah_done` changed (11 section 9.4).
#[derive(Default)]
struct NikahEffects {
    /// `(user_id, profile_id, previous status)` of each member whose profile was closed.
    closed: Vec<(Uuid, Uuid, ProfileStatus)>,
    /// Receivers of pending interests that expired.
    receivers: Vec<Uuid>,
    /// Other connections ended with `found_someone_else`, with their system messages.
    ended: Vec<(EndedConnection, MessageRow)>,
}

/// The effects of reaching `nikah_done`, for both members, in the confirming transaction:
/// both profiles closed with `found_match_here`, every pending interest expired, every other
/// active connection ended with `found_someone_else`, and the recommendations deleted. The
/// couple's own connection stays active, so they keep their chat (read-only from now on).
async fn nikah_done(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
    profiles: &[(Uuid, Uuid, ProfileStatus)],
) -> ApiResult<NikahEffects> {
    let mut effects = NikahEffects::default();
    for &(profile_id, user_id, status) in profiles {
        if matches!(
            status,
            ProfileStatus::Active | ProfileStatus::Paused | ProfileStatus::Closed
        ) {
            db::close_for_nikah(&mut *conn, profile_id).await?;
            effects.closed.push((user_id, profile_id, status));
        }
        let expired = lifecycle::expire_pending_interests(&mut *conn, profile_id).await?;
        effects
            .receivers
            .extend(expired.into_iter().map(|(_, receiver)| receiver));
        for other in db::other_active(&mut *conn, profile_id, connection_id).await? {
            if let Some(ended) = db::end(
                &mut *conn,
                other,
                profile_id,
                ConnectionEndReason::FoundSomeoneElse,
            )
            .await?
            {
                effects.ended.push(ended);
            }
        }
        db::delete_recommendations_of(&mut *conn, profile_id).await?;
    }
    Ok(effects)
}

/// After a confirmed `nikah_done` committed: caches, logs, events and counters of everything
/// the effects touched.
async fn after_nikah(state: &AppState, effects: NikahEffects) {
    for (user_id, profile_id, from) in &effects.closed {
        state.accounts.invalidate(*user_id);
        tracing::info!(
            event = "profile.status_changed",
            %profile_id,
            from = %from,
            to = %ProfileStatus::Closed
        );
    }
    let mut touched: Vec<Uuid> = effects.receivers.clone();
    for (ended, message) in &effects.ended {
        tracing::info!(
            event = "connection.ended",
            connection_id = %ended.connection_id,
            reason = "found_someone_else"
        );
        let members = [ended.profile_low_id, ended.profile_high_id];
        publish_messages(state, members, std::slice::from_ref(message));
        publish_updated(state, ended.connection_id).await;
        touched.extend(members);
    }
    touched.sort_unstable();
    touched.dedup();
    for profile_id in touched {
        counters::push(state, profile_id).await;
    }
}

/// Confirm the other member's proposal: the connection moves to its stage. Reaching
/// `nikah_done` closes both profiles (`found_match_here`), expires their pending interests and
/// ends their other connections (`found_someone_else`); the couple's chat stays readable.
/// Reaching `engaged` only makes the clients suggest pausing the profile.
#[utoipa::path(
    post,
    path = "/connections/{connection_id}/stage-proposals/{proposal_id}/confirm",
    tag = "connections",
    security(("bearer" = [])),
    params(
        ("connection_id" = Uuid, Path, description = "The connection"),
        ("proposal_id" = Uuid, Path, description = "The other member's proposal")
    ),
    responses(
        (status = 200, body = Connection),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn confirm_proposal(
    State(state): State<AppState>,
    account: Engage,
    ApiPath((connection_id, proposal_id)): ApiPath<(Uuid, Uuid)>,
) -> ApiResult<Json<Connection>> {
    let me = account.profile_id;
    let membership = member_of(&state, me, connection_id).await?;
    let planned = db::proposal(&state.db, connection_id, proposal_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let nikah = planned.stage == ConnectionStage::NikahDone;

    let mut tx = state.db.begin().await?;
    // Profile rows are locked before the connection row (the lock order of db::connections).
    let profiles = if nikah {
        db::lock_profiles(&mut tx, &[me, membership.other_id]).await?
    } else {
        Vec::new()
    };
    let (_, proposal) = locked_pending(&mut tx, me, connection_id, proposal_id, false).await?;
    db::set_proposal_status(&mut tx, proposal_id, ProposalStatus::Confirmed).await?;
    db::set_stage(&mut tx, connection_id, proposal.stage).await?;
    let message = db::insert_system_message(
        &mut tx,
        connection_id,
        SystemEvent::StageConfirmed,
        json!({ "actor_profile_id": me, "proposal_id": proposal_id, "stage": proposal.stage }),
    )
    .await?;
    let effects = if nikah {
        nikah_done(&mut tx, connection_id, &profiles).await?
    } else {
        NikahEffects::default()
    };
    tx.commit().await?;
    tracing::info!(
        event = "connection.stage_changed",
        %connection_id,
        stage = %proposal.stage
    );

    publish_messages(&state, [me, membership.other_id], &[message]);
    after_nikah(&state, effects).await;
    if let Err(error) = notify::notify(
        &state,
        membership.other_user_id,
        NotificationType::StageConfirmed,
        Some(me),
        json!({
            "connection_id": connection_id,
            "proposal_id": proposal_id,
            "stage": proposal.stage,
        }),
    )
    .await
    {
        tracing::warn!(error = %format!("{error:#}"), "could not notify stage_confirmed");
    }
    publish_updated(&state, connection_id).await;
    rendered(&state, me, connection_id).await
}

/// Decline the other member's proposal. The stage stays; a `stage_declined` system message is
/// posted and nobody is notified. The proposer may suggest the same stage again after 7 days.
#[utoipa::path(
    post,
    path = "/connections/{connection_id}/stage-proposals/{proposal_id}/decline",
    tag = "connections",
    security(("bearer" = [])),
    params(
        ("connection_id" = Uuid, Path, description = "The connection"),
        ("proposal_id" = Uuid, Path, description = "The other member's proposal")
    ),
    responses(
        (status = 200, body = Connection),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn decline_proposal(
    State(state): State<AppState>,
    account: Engage,
    ApiPath((connection_id, proposal_id)): ApiPath<(Uuid, Uuid)>,
) -> ApiResult<Json<Connection>> {
    close_proposal(
        &state,
        account.profile_id,
        connection_id,
        proposal_id,
        false,
    )
    .await
}

/// Withdraw the caller's own pending proposal. Posts a `stage_declined` system message with
/// `cancelled: true`.
#[utoipa::path(
    delete,
    path = "/connections/{connection_id}/stage-proposals/{proposal_id}",
    tag = "connections",
    security(("bearer" = [])),
    params(
        ("connection_id" = Uuid, Path, description = "The connection"),
        ("proposal_id" = Uuid, Path, description = "The caller's proposal")
    ),
    responses(
        (status = 200, body = Connection),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn cancel_proposal(
    State(state): State<AppState>,
    account: Engage,
    ApiPath((connection_id, proposal_id)): ApiPath<(Uuid, Uuid)>,
) -> ApiResult<Json<Connection>> {
    close_proposal(&state, account.profile_id, connection_id, proposal_id, true).await
}

/// Declines (by the other member) or cancels (by the proposer) a pending proposal.
async fn close_proposal(
    state: &AppState,
    me: Uuid,
    connection_id: Uuid,
    proposal_id: Uuid,
    cancelled: bool,
) -> ApiResult<Json<Connection>> {
    let mut tx = state.db.begin().await?;
    let (membership, proposal) =
        locked_pending(&mut tx, me, connection_id, proposal_id, cancelled).await?;
    let status = if cancelled {
        ProposalStatus::Cancelled
    } else {
        ProposalStatus::Declined
    };
    db::set_proposal_status(&mut tx, proposal_id, status).await?;
    let message = db::insert_system_message(
        &mut tx,
        connection_id,
        SystemEvent::StageDeclined,
        json!({
            "actor_profile_id": me,
            "proposal_id": proposal_id,
            "stage": proposal.stage,
            "cancelled": cancelled,
        }),
    )
    .await?;
    tx.commit().await?;

    publish_messages(state, [me, membership.other_id], &[message]);
    publish_updated(state, connection_id).await;
    rendered(state, me, connection_id).await
}
