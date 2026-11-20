//! Interests (15 section 11, 11 sections 2 to 4).
//!
//! Sending runs the nine checks of 15 section 11 in their order. Checks 1 to 8 come from the
//! views (`views::screen`, whose `can_send` is `domain::visibility::can_send_interest`), so the
//! answer always agrees with `Relation.can_send_interest` on the profile screen (09 section
//! 7.2). The write then happens under the pair's advisory lock and both profile row locks,
//! where the pair state and the limits are checked once more (11 section 13 rule 1).

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use crate::auth::{Browse, Engage};
use crate::db::connections::{self as connections_db, MessageRow};
use crate::db::counters;
use crate::db::interests::{self as db, ListScope, LockedInterest, NewInterest};
use crate::db::pagination::Page;
use crate::db::relations;
use crate::domain::options::InterestPermission;
use crate::domain::text_rules::{self, TextField, TextViolation};
use crate::domain::time::{karachi_date, next_karachi_midnight};
use crate::domain::types::{
    InterestStatus, NotificationType, ProfileStatus, UsageCounter, UserStatus,
};
use crate::domain::visibility::{
    self, CannotSend, ClosedInterest, InterestDirection, InterestFacts, InterestSettings,
    InterestUsage, SenderFacts,
};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode, FieldError};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::models::connections::{self as connection_models, Connection};
use crate::models::interests::{
    AcceptedInterest, DeclineBody, Interest, InterestBox, InterestFilter, InterestListQuery,
    InterestPage, SEEN_MAX_IDS, SeenBody, SendInterestBody, SentInterest, render,
    shown_as_withdrawn, shown_status,
};
use crate::notify;
use crate::realtime::hub::{Realtime, ServerEvent};
use crate::settings::AppSettings;
use crate::state::AppState;
use crate::views::{self, Assessed, ViewSettings};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(send_interest, list_interests))
        .routes(routes!(mark_seen))
        .routes(routes!(get_interest))
        .routes(routes!(accept_interest))
        .routes(routes!(decline_interest))
        .routes(routes!(withdraw_interest))
}

/// Keyset of the interest lists: `(created_at, id)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CreatedCursor {
    #[serde(with = "time::serde::rfc3339")]
    t: OffsetDateTime,
    i: Uuid,
}

// -------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------

/// One interest rendered for a member, or `None` when they are not one of its two members.
async fn render_for(
    state: &AppState,
    profile_id: Uuid,
    interest_id: Uuid,
) -> ApiResult<Option<Interest>> {
    let Some(row) = db::get(&state.db, profile_id, interest_id).await? else {
        return Ok(None);
    };
    let viewer = views::viewer(state, profile_id).await?;
    let other = row.other(profile_id);
    let card = views::cards(state, &viewer, &[other]).await?.remove(&other);
    Ok(Some(render(&row, profile_id, card, viewer.now)))
}

/// Reads an optional JSON body: an empty body is the default value.
fn optional_json<T: DeserializeOwned + Default>(bytes: &Bytes) -> ApiResult<T> {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(T::default());
    }
    serde_json::from_slice(bytes).map_err(|error| ApiError::BadRequest(error.to_string()))
}

/// The field error code of a text rule violation.
fn violation_code(violation: TextViolation) -> FieldCode {
    match violation {
        TextViolation::TooShort => FieldCode::TooShort,
        TextViolation::TooLong => FieldCode::TooLong,
        TextViolation::Invalid => FieldCode::Invalid,
        TextViolation::ContainsContactInfo => FieldCode::ContainsContactInfo,
        TextViolation::Inappropriate => FieldCode::Inappropriate,
    }
}

/// Check 9: the message passes the text rules (13 section 3). An empty message is no message.
fn checked_message(raw: Option<&str>) -> ApiResult<Option<String>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    text_rules::validate(TextField::InterestMessage, raw).map_err(|violation| {
        ApiError::Validation(vec![FieldError::with_message(
            TextField::InterestMessage.name(),
            violation_code(violation),
            violation.message(TextField::InterestMessage),
        )])
    })
}

// -------------------------------------------------------------------------------------------
// Checks 2 to 8
// -------------------------------------------------------------------------------------------

/// The setting key of the daily interest limit that applies to the sender.
fn daily_limit_key(verified: bool) -> &'static str {
    if verified {
        "limits.interests_per_day_verified"
    } else {
        "limits.interests_per_day"
    }
}

/// The error of a failed check 2 to 8 (15 section 11). `connection_id` and `interest_id` are
/// the rows behind checks 2 and 3.
fn refusal(
    cannot: CannotSend,
    viewer_status: ProfileStatus,
    connection_id: Option<Uuid>,
    interest_id: Option<Uuid>,
    usage: InterestUsage,
    verified: bool,
    now: OffsetDateTime,
) -> ApiError {
    let error = match cannot {
        CannotSend::OwnProfileNotActive => ApiError::ProfileNotActive {
            status: viewer_status,
        },
        CannotSend::AlreadyConnected => ApiError::AlreadyConnected {
            connection_id: connection_id.unwrap_or_default(),
        },
        CannotSend::AlreadyPending => ApiError::InterestAlreadyPending {
            interest_id: interest_id.unwrap_or_default(),
        },
        CannotSend::Cooldown { until } => ApiError::CooldownActive {
            retry_after_date: until,
        },
        CannotSend::NotPermittedByMember(detail) => ApiError::NotPermittedByMember {
            reason: detail.as_str(),
        },
        CannotSend::PendingLimit => {
            ApiError::limit("limits.pending_interests_max", usage.pending_sent)
        }
        CannotSend::ConnectionLimit => ApiError::LimitReached {
            limit: "limits.active_connections_max",
            used: usage.active_connections,
            resets_at: None,
            side: Some("you"),
        },
        CannotSend::DailyLimit => ApiError::LimitReached {
            limit: daily_limit_key(verified),
            used: usage.sent_today,
            resets_at: Some(next_karachi_midnight(now)),
            side: None,
        },
    };
    if let ApiError::LimitReached { limit, .. } = &error {
        tracing::info!(event = "limit.reached", limit = *limit);
    }
    error
}

/// Checks 6 to 8 alone, on counts read under the locks: `can_send_interest` with every other
/// row passing.
fn limits_only(
    usage: InterestUsage,
    verified: bool,
    settings: &InterestSettings,
    now: OffsetDateTime,
) -> Result<(), CannotSend> {
    visibility::can_send_interest(
        &InterestFacts {
            viewer_status: ProfileStatus::Active,
            viewer: SenderFacts {
                is_id_verified: verified,
                is_photo_verified: false,
                fits_receiver_must_haves: true,
            },
            owner_permission: InterestPermission::Everyone,
            active_connection: false,
            pending_interest: None,
            latest_sent: None,
            connection_ended_at: None,
            usage,
        },
        settings,
        now,
    )
}

/// Check 4 for a mutual interest, whose `can_send` stops at "already pending" (09 section
/// 7.2 row 3): the cooldowns of 03 sections 4.7 and 4.8, through
/// `visibility::interest_cooldown_end`.
async fn mutual_cooldown(
    state: &AppState,
    me: Uuid,
    other: Uuid,
    settings: &InterestSettings,
    now: OffsetDateTime,
) -> ApiResult<Option<Date>> {
    let pair = views::load::pairs(&state.db, me, &[other])
        .await?
        .remove(&other)
        .unwrap_or_default();
    let latest_sent = pair
        .interests
        .iter()
        .find(|interest| {
            interest.sender_profile_id == me && interest.status != InterestStatus::Pending
        })
        .map(|interest| ClosedInterest {
            status: interest.status,
            responded_at: interest.responded_at,
            expires_at: interest.expires_at,
        });
    Ok(visibility::interest_cooldown_end(
        latest_sent.as_ref(),
        pair.connection_ended_at(),
        settings,
        now,
    )
    .map(karachi_date))
}

// -------------------------------------------------------------------------------------------
// Accept (11 section 3.3), shared by the accept endpoint and a mutual interest
// -------------------------------------------------------------------------------------------

/// Steps 3 to 6 of 11 section 3.3 inside the caller's transaction. The pair lock is held and
/// the interest is locked and `pending`. Returns the connection id and its `connected`
/// system message.
async fn accept_locked(
    conn: &mut PgConnection,
    interest: &LockedInterest,
    settings: &AppSettings,
) -> ApiResult<(Uuid, MessageRow)> {
    let (receiver, sender) = (interest.receiver_profile_id, interest.sender_profile_id);
    if let Some(connection_id) = db::active_connection(&mut *conn, receiver, sender).await? {
        return Err(ApiError::AlreadyConnected { connection_id });
    }
    let max = settings.active_connections_max;
    for (profile_id, side) in [(receiver, "you"), (sender, "them")] {
        let used = connections_db::active_count(&mut *conn, profile_id).await?;
        if used >= max {
            tracing::info!(
                event = "limit.reached",
                limit = "limits.active_connections_max"
            );
            return Err(ApiError::LimitReached {
                limit: "limits.active_connections_max",
                used,
                resets_at: None,
                side: Some(side),
            });
        }
    }
    db::respond(&mut *conn, interest.id, InterestStatus::Accepted).await?;
    let created = connections_db::create(&mut *conn, interest.id, receiver, sender).await?;
    db::delete_pair_recommendations(&mut *conn, receiver, sender).await?;
    Ok(created)
}

/// What an accepted interest created.
struct Accepted {
    interest_id: Uuid,
    accepter: Uuid,
    sender: Uuid,
    connection_id: Uuid,
    message: MessageRow,
    compat_score: Option<i16>,
}

/// After the accept committed: the `interest_accepted` notification and `interest.accepted`
/// for the sender, `message.new`, `connection.updated` and `counters` for both. Returns the
/// interest and the connection rendered for the accepting member.
async fn after_accept(state: &AppState, accepted: Accepted) -> ApiResult<(Interest, Connection)> {
    let Accepted {
        interest_id,
        accepter,
        sender,
        connection_id,
        message,
        compat_score,
    } = accepted;
    tracing::info!(event = "interest.accepted", %interest_id, compat_score = ?compat_score);
    tracing::info!(event = "connection.created", %connection_id, stage = "chatting");

    let sender_user = db::user_id_of(&state.db, sender).await?;
    if let Err(error) = notify::notify(
        state,
        sender_user,
        NotificationType::InterestAccepted,
        Some(accepter),
        json!({ "interest_id": interest_id, "connection_id": connection_id }),
    )
    .await
    {
        tracing::warn!(error = %format!("{error:#}"), "could not notify interest_accepted");
    }
    if state.hub.is_online(sender)
        && let (Some(interest), Some(connection)) = (
            render_for(state, sender, interest_id).await?,
            connection_models::load(state, sender, connection_id).await?,
        )
    {
        state.hub.send_to_profile(
            sender,
            &ServerEvent::new(
                "interest.accepted",
                json!({ "interest": interest, "connection": connection }),
            ),
        );
    }
    connection_models::publish_messages(state, [accepter, sender], &[message]);
    connection_models::publish_updated(state, connection_id).await;
    counters::push(state, accepter).await;
    counters::push(state, sender).await;

    let interest = render_for(state, accepter, interest_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let connection = connection_models::load(state, accepter, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((interest, connection))
}

// -------------------------------------------------------------------------------------------
// Send
// -------------------------------------------------------------------------------------------

/// What one attempt of a send did.
enum SendOutcome {
    /// A new pending interest.
    Sent(Uuid),
    /// The receiver's pending interest was accepted on the caller's behalf.
    Mutual(Box<Accepted>),
    /// The pair changed between the checks and the locks: decide again.
    Changed,
}

/// What checks 1 to 9 decided on current data.
struct Checked {
    receiver_id: Uuid,
    /// The receiver has a pending interest to the caller (11 section 2.3 step 2).
    mutual: bool,
    /// The message to store (check 9); always `None` for a mutual interest.
    message: Option<String>,
    compat_score: Option<i16>,
    verified: bool,
    now: OffsetDateTime,
}

/// Checks 1 to 9 of 15 section 11, in order.
async fn check(
    state: &AppState,
    me: Uuid,
    body: &SendInterestBody,
    settings: &InterestSettings,
) -> ApiResult<Checked> {
    let receiver_id = body.receiver_profile_id;
    // Check 1: the receiver is active and the caller may open it (09 section 2).
    let receiver = db::receiver(&state.db, receiver_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if receiver.status != ProfileStatus::Active || receiver.user_status != UserStatus::Active {
        return Err(ApiError::NotFound);
    }
    let viewer = views::viewer(state, me).await?;
    let now = viewer.now;
    let assessed: Assessed = views::screen(state, &viewer, &[receiver_id])
        .await?
        .remove(&receiver_id)
        .ok_or(ApiError::NotFound)?;
    let verified = viewer.row().is_id_verified || viewer.row().is_photo_verified;

    // A pending interest from the receiver makes this a mutual interest: checks 5, 6 and 8
    // are skipped, and the message is ignored (11 section 2.3 step 2). Its row 3 of
    // `can_send` is "already pending", so check 4 is evaluated on its own; check 7 is the
    // caller's side of the accept procedure's cap check.
    let mutual = matches!(assessed.interest, Some((InterestDirection::Received, _)));
    let message = if mutual {
        if let Some(until) = mutual_cooldown(state, me, receiver_id, settings, now).await? {
            return Err(ApiError::CooldownActive {
                retry_after_date: until,
            });
        }
        None
    } else {
        // Checks 2 to 8, in order.
        if let Err(cannot) = assessed.can_send {
            return Err(refusal(
                cannot,
                viewer.status(),
                assessed.connection_id,
                assessed.interest.as_ref().map(|(_, row)| row.id),
                viewer.usage,
                verified,
                now,
            ));
        }
        // Check 9.
        checked_message(body.message.as_deref())?
    };
    Ok(Checked {
        receiver_id,
        mutual,
        message,
        compat_score: assessed.compat().map(i16::from),
        verified,
        now,
    })
}

/// One attempt: the checks on current data, then the write under the locks, where the pair
/// state and checks 6 to 8 are confirmed.
async fn try_send(
    state: &AppState,
    me: Uuid,
    body: &SendInterestBody,
    settings: &AppSettings,
) -> ApiResult<SendOutcome> {
    let interest_settings = ViewSettings::new(settings).interests;
    let checked = check(state, me, body, &interest_settings).await?;
    let receiver_id = checked.receiver_id;
    let now = checked.now;

    let mut tx = state.db.begin().await?;
    db::lock_pair(&mut tx, me, receiver_id).await?;
    if let Some(connection_id) = db::active_connection(&mut tx, me, receiver_id).await? {
        return Err(ApiError::AlreadyConnected { connection_id });
    }
    if let Some(interest_id) = db::pending_from(&mut tx, me, receiver_id).await? {
        return Err(ApiError::InterestAlreadyPending { interest_id });
    }
    let theirs = db::pending_from(&mut tx, receiver_id, me).await?;
    if theirs.is_some() != checked.mutual {
        return Ok(SendOutcome::Changed);
    }

    if let Some(their_id) = theirs {
        let locked = db::lock(&mut tx, their_id)
            .await?
            .ok_or(ApiError::NotFound)?;
        let (connection_id, message) = accept_locked(&mut tx, &locked, settings).await?;
        tx.commit().await?;
        return Ok(SendOutcome::Mutual(Box::new(Accepted {
            interest_id: their_id,
            accepter: me,
            sender: receiver_id,
            connection_id,
            message,
            compat_score: locked.compat_score,
        })));
    }

    // Checks 6 to 8 once more, on counts no other send of the caller can change now.
    let today = karachi_date(now);
    let usage = db::usage(&mut tx, me, today).await?;
    let refused = |cannot| {
        refusal(
            cannot,
            ProfileStatus::Active,
            None,
            None,
            usage,
            checked.verified,
            now,
        )
    };
    limits_only(usage, checked.verified, &interest_settings, now).map_err(refused)?;
    let interest_id = db::insert(
        &mut tx,
        &NewInterest {
            sender: me,
            receiver: receiver_id,
            message: checked.message.as_deref(),
            compat_score: checked.compat_score,
            expiry_days: settings.interest_expiry_days,
        },
    )
    .await?;
    let daily_limit = settings.interests_limit(checked.verified);
    if !db::bump_usage(&mut tx, me, UsageCounter::InterestsSent, today, daily_limit).await? {
        return Err(refused(CannotSend::DailyLimit));
    }
    db::delete_pair_recommendations(&mut tx, me, receiver_id).await?;
    tx.commit().await?;
    tracing::info!(
        event = "interest.sent",
        %interest_id,
        compat_score = ?checked.compat_score
    );
    Ok(SendOutcome::Sent(interest_id))
}

/// Send an interest.
///
/// The checks of 15 section 11 run in order: the receiver must be `active` and openable
/// (`not_found`), not connected (`already_connected`), no pending interest from the caller
/// (`interest_already_pending`, also during a quiet decline), no cooldown (`cooldown_active`),
/// the receiver's `interest_permission` (`not_permitted_by_member`), the pending, connection and
/// daily limits (`limit_reached`), and the text rules on `message` (`validation_failed`).
///
/// When the receiver already has a pending interest to the caller, that interest is accepted
/// instead (mutual interest): checks 5, 6 and 8 are skipped, the message is ignored, and
/// `connection` is set in the answer.
#[utoipa::path(
    post,
    path = "/interests",
    tag = "interests",
    security(("bearer" = [])),
    request_body = SendInterestBody,
    responses(
        (status = 201, body = SentInterest),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn send_interest(
    State(state): State<AppState>,
    account: Browse,
    ApiJson(body): ApiJson<SendInterestBody>,
) -> ApiResult<(StatusCode, Json<SentInterest>)> {
    let me = account.profile_id;
    let settings = state.settings.get().await?;
    let mut outcome = SendOutcome::Changed;
    for _ in 0..2 {
        outcome = try_send(&state, me, &body, &settings).await?;
        if !matches!(outcome, SendOutcome::Changed) {
            break;
        }
    }
    match outcome {
        SendOutcome::Sent(interest_id) => {
            after_send(&state, me, body.receiver_profile_id, interest_id).await;
            let interest = render_for(&state, me, interest_id)
                .await?
                .ok_or(ApiError::NotFound)?;
            Ok((
                StatusCode::CREATED,
                Json(SentInterest {
                    interest,
                    connection: None,
                }),
            ))
        }
        SendOutcome::Mutual(accepted) => {
            let (interest, connection) = after_accept(&state, *accepted).await?;
            Ok((
                StatusCode::CREATED,
                Json(SentInterest {
                    interest,
                    connection: Some(connection),
                }),
            ))
        }
        // The other member answered twice while this request ran; the client tries again.
        SendOutcome::Changed => Err(ApiError::invalid_state(InterestStatus::Pending)),
    }
}

/// After a new interest committed: `interest.received` and the `interest_received`
/// notification (with its push and the daily email) for the receiver, then `counters`.
async fn after_send(state: &AppState, me: Uuid, receiver: Uuid, interest_id: Uuid) {
    if state.hub.is_online(receiver) {
        match render_for(state, receiver, interest_id).await {
            Ok(Some(interest)) => state.hub.send_to_profile(
                receiver,
                &ServerEvent::new("interest.received", json!({ "interest": interest })),
            ),
            Ok(None) => {}
            Err(error) => tracing::warn!(%error, "could not render interest.received"),
        }
    }
    let notified = match db::user_id_of(&state.db, receiver).await {
        Ok(user_id) => notify::notify(
            state,
            user_id,
            NotificationType::InterestReceived,
            Some(me),
            json!({ "interest_id": interest_id, "reminder": false, "count": 1 }),
        )
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(error = %format!("{error:#}"), "could not notify interest_received");
            None
        }),
        Err(error) => {
            tracing::warn!(%error, "could not load the receiver");
            None
        }
    };
    // `notify` already pushed the counters with the new notification.
    if notified.is_none() {
        counters::push(state, receiver).await;
    }
}

// -------------------------------------------------------------------------------------------
// Lists and reads
// -------------------------------------------------------------------------------------------

/// The rows of one tab (11 section 3.1, with the quiet decline of 11 section 3.5).
fn scope_for(mailbox: InterestBox, filter: InterestFilter) -> ListScope {
    use InterestStatus as S;
    let (statuses, declined_before_expiry) = match (mailbox, filter) {
        (_, InterestFilter::Accepted) => (vec![S::Accepted], None),
        (InterestBox::Received, InterestFilter::Pending) => (vec![S::Pending], None),
        (InterestBox::Received, InterestFilter::Closed) => {
            (vec![S::Declined, S::Withdrawn, S::Expired], None)
        }
        (InterestBox::Sent, InterestFilter::Pending) => (vec![S::Pending], Some(true)),
        (InterestBox::Sent, InterestFilter::Closed) => {
            (vec![S::Withdrawn, S::Expired], Some(false))
        }
    };
    ListScope {
        sent: mailbox == InterestBox::Sent,
        statuses,
        declined_before_expiry,
    }
}

/// Received or sent interests, newest first. `status` is `pending` (default), `accepted` or
/// `closed`. A sender sees a declined interest as "no response" under `pending` until it would
/// have expired, then under `closed`.
#[utoipa::path(
    get,
    path = "/interests",
    tag = "interests",
    security(("bearer" = [])),
    params(InterestListQuery),
    responses(
        (status = 200, body = InterestPage),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn list_interests(
    State(state): State<AppState>,
    account: Engage,
    ApiQuery(query): ApiQuery<InterestListQuery>,
) -> ApiResult<Json<InterestPage>> {
    let me = account.profile_id;
    let page = query.page();
    let after = page.cursor::<CreatedCursor>()?.map(|c| (c.t, c.i));
    let limit = page.limit();
    let scope = scope_for(query.mailbox, query.status.unwrap_or_default());
    let viewer = views::viewer(&state, me).await?;
    let now = viewer.now;
    let rows = db::page(&state.db, me, &scope, now, after, limit + 1).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.other(me)).collect();
    let cards = views::cards(&state, &viewer, &ids).await?;
    let page = Page::from_rows(
        rows,
        limit,
        |row| CreatedCursor {
            t: row.created_at,
            i: row.id,
        },
        |row| render(&row, me, cards.get(&row.other(me)).cloned(), now),
    );
    Ok(Json(InterestPage {
        items: page.items,
        next_cursor: page.next_cursor,
    }))
}

/// One interest the caller sent or received.
#[utoipa::path(
    get,
    path = "/interests/{interest_id}",
    tag = "interests",
    security(("bearer" = [])),
    params(("interest_id" = Uuid, Path, description = "The interest")),
    responses(
        (status = 200, body = Interest),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_interest(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(interest_id): ApiPath<Uuid>,
) -> ApiResult<Json<Interest>> {
    render_for(&state, account.profile_id, interest_id)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

/// Mark received interests as seen (once per id). Ids that are not the caller's received
/// interests are ignored.
#[utoipa::path(
    post,
    path = "/interests/seen",
    tag = "interests",
    security(("bearer" = [])),
    request_body = SeenBody,
    responses(
        (status = 204, description = "Marked"),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn mark_seen(
    State(state): State<AppState>,
    account: Engage,
    ApiJson(body): ApiJson<SeenBody>,
) -> ApiResult<StatusCode> {
    if body.interest_ids.len() > SEEN_MAX_IDS {
        return Err(ApiError::field("interest_ids", FieldCode::TooLong));
    }
    db::mark_seen(&state.db, account.profile_id, &body.interest_ids).await?;
    Ok(StatusCode::NO_CONTENT)
}

// -------------------------------------------------------------------------------------------
// Answers
// -------------------------------------------------------------------------------------------

/// Accept a received interest: only the receiver, only `pending`.
///
/// The sender must still be openable (otherwise the interest expires and `invalid_state`), and
/// both members must be under `limits.active_connections_max` (`limit_reached` with
/// `details.side` `you` or `them`). Creates the connection, both member rows and the
/// `connected` system message in one transaction.
#[utoipa::path(
    post,
    path = "/interests/{interest_id}/accept",
    tag = "interests",
    security(("bearer" = [])),
    params(("interest_id" = Uuid, Path, description = "The received interest")),
    responses(
        (status = 200, body = AcceptedInterest),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 429, body = ErrorBody)
    )
)]
async fn accept_interest(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(interest_id): ApiPath<Uuid>,
) -> ApiResult<Json<AcceptedInterest>> {
    let me = account.profile_id;
    let row = db::get(&state.db, me, interest_id)
        .await?
        .filter(|row| row.receiver_profile_id == me)
        .ok_or(ApiError::NotFound)?;
    if row.status != InterestStatus::Pending {
        return Err(ApiError::invalid_state(row.status));
    }
    let sender = row.sender_profile_id;

    // Step 2: the sender must still be openable by the receiver.
    let viewer = views::viewer(&state, me).await?;
    if views::can_open(&state, &viewer, sender).await?.is_none() {
        db::expire_now(&state.db, interest_id).await?;
        tracing::info!(event = "interest.expired", %interest_id, compat_score = ?row.compat_score);
        counters::push(&state, me).await;
        return Err(ApiError::invalid_state(InterestStatus::Expired));
    }

    let settings = state.settings.get().await?;
    let mut tx = state.db.begin().await?;
    db::lock_pair(&mut tx, me, sender).await?;
    let locked = db::lock(&mut tx, interest_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if locked.status != InterestStatus::Pending {
        return Err(ApiError::invalid_state(locked.status));
    }
    let (connection_id, message) = accept_locked(&mut tx, &locked, &settings).await?;
    tx.commit().await?;

    let (interest, connection) = after_accept(
        &state,
        Accepted {
            interest_id,
            accepter: me,
            sender,
            connection_id,
            message,
            compat_score: locked.compat_score,
        },
    )
    .await?;
    Ok(Json(AcceptedInterest {
        interest,
        connection,
    }))
}

/// Decline a received interest: only the receiver, only `pending`. The sender is not told; they
/// see "No response yet" until the interest would have expired. With `also_block`, the sender
/// is also blocked (15 section 13).
#[utoipa::path(
    post,
    path = "/interests/{interest_id}/decline",
    tag = "interests",
    security(("bearer" = [])),
    params(("interest_id" = Uuid, Path, description = "The received interest")),
    request_body(content = DeclineBody, description = "Optional"),
    responses(
        (status = 200, body = Interest),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn decline_interest(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(interest_id): ApiPath<Uuid>,
    body: Bytes,
) -> ApiResult<Json<Interest>> {
    let body: DeclineBody = optional_json(&body)?;
    let me = account.profile_id;
    let mut tx = state.db.begin().await?;
    let locked = db::lock(&mut tx, interest_id)
        .await?
        .filter(|interest| interest.receiver_profile_id == me)
        .ok_or(ApiError::NotFound)?;
    if locked.status != InterestStatus::Pending {
        return Err(ApiError::invalid_state(locked.status));
    }
    db::respond(&mut tx, interest_id, InterestStatus::Declined).await?;
    tx.commit().await?;
    tracing::info!(event = "interest.declined", %interest_id, compat_score = ?locked.compat_score);

    let sender = locked.sender_profile_id;
    if body.also_block == Some(true) {
        let effects = relations::block(&state.db, me, sender).await?;
        if let Some(ended) = effects.ended {
            tracing::info!(
                event = "connection.ended",
                connection_id = %ended.connection_id,
                reason = "blocked"
            );
        }
        counters::push(&state, sender).await;
    }
    counters::push(&state, me).await;
    render_for(&state, me, interest_id)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

/// Withdraw a sent interest: only the sender, only `pending`. The receiver is not told; their
/// notification for it is removed. An interest that was quietly declined answers as withdrawn
/// too, so the decline never shows (11 section 3.5 rule 2).
#[utoipa::path(
    post,
    path = "/interests/{interest_id}/withdraw",
    tag = "interests",
    security(("bearer" = [])),
    params(("interest_id" = Uuid, Path, description = "The sent interest")),
    responses(
        (status = 200, body = Interest),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn withdraw_interest(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(interest_id): ApiPath<Uuid>,
) -> ApiResult<Json<Interest>> {
    let me = account.profile_id;
    let now = OffsetDateTime::now_utc();
    let mut tx = state.db.begin().await?;
    let locked = db::lock(&mut tx, interest_id)
        .await?
        .filter(|interest| interest.sender_profile_id == me)
        .ok_or(ApiError::NotFound)?;
    match locked.status {
        InterestStatus::Pending => {
            db::respond(&mut tx, interest_id, InterestStatus::Withdrawn).await?;
            db::delete_received_notifications(&mut tx, locked.receiver_profile_id, interest_id)
                .await?;
            tx.commit().await?;
            tracing::info!(
                event = "interest.withdrawn",
                %interest_id,
                compat_score = ?locked.compat_score
            );
            counters::push(&state, locked.receiver_profile_id).await;
            render_for(&state, me, interest_id)
                .await?
                .map(Json)
                .ok_or(ApiError::NotFound)
        }
        InterestStatus::Declined if now < locked.expires_at => {
            drop(tx);
            let interest = render_for(&state, me, interest_id)
                .await?
                .ok_or(ApiError::NotFound)?;
            Ok(Json(shown_as_withdrawn(interest, now)))
        }
        status => Err(ApiError::invalid_state(
            shown_status(status, InterestDirection::Sent, locked.expires_at, now).0,
        )),
    }
}

#[cfg(test)]
mod tests;
