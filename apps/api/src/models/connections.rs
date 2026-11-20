//! API types for connections and chat (15 sections 4.7 and 12), their rendering for one member,
//! and the realtime events that carry them (19 section 4.6).
//!
//! The same fact looks different to each member (`sender: "me"` or `"them"`, the privacy of
//! the ending reason, read receipts, contact details), so every event is rendered per
//! recipient before it is handed to the hub (19 section 6.1). [`publish_updated`] is the one
//! way to send `connection.updated`; other features that change a connection (a block, an
//! account closure) can call it after their commit.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::db::connections::{self as db, ConnectionRow, MessageRow};
use crate::db::pagination::PageParams;
use crate::domain::chat_safety;
use crate::domain::options::{
    ConnectionEndReason, ConnectionStage, GuardianRelation, PreferredContact,
};
use crate::domain::privacy::Privacy;
use crate::domain::types::{
    ConnectionStatus, ContactShareStatus, MessageKind, SafetyFlag, SystemEvent,
};
use crate::domain::visibility;
use crate::error::ApiResult;
use crate::realtime::hub::{Realtime, ServerEvent};
use crate::state::AppState;
use crate::views::{self, ProfileCard, Viewer};

// -------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------

/// Which member did something, seen from the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Party {
    Me,
    Them,
}

/// `Connection.ended_by`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EndedBy {
    Me,
    Them,
    /// An account closure, ban or purge ended it.
    System,
}

/// `Message.sender`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MessageSender {
    Me,
    Them,
    System,
}

/// The pending stage proposal of a connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PendingStageProposal {
    pub id: Uuid,
    pub stage: ConnectionStage,
    pub proposed_by: Party,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// The caller's own contact share on a connection (15 section 4.7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the share flags of contact_shares"
)]
pub struct ContactShare {
    pub share_phone: bool,
    pub share_whatsapp: bool,
    pub share_email: bool,
    pub share_guardian: bool,
    pub status: ContactShareStatus,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// The guardian item of a shared contact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SharedGuardian {
    pub name: Option<String>,
    pub relation: Option<GuardianRelation>,
    pub phone_e164: Option<String>,
}

/// The other member's contact details shared with the caller: only the selected items, the
/// others `null` (09 section 10.2 rule 4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SharedContact {
    pub phone_e164: Option<String>,
    pub whatsapp_e164: Option<String>,
    pub contact_email: Option<String>,
    pub guardian: Option<SharedGuardian>,
    /// `self` or `guardian`: whom to call first.
    pub preferred_contact: PreferredContact,
    pub best_time_to_call: Option<String>,
}

/// A connection as one of its members sees it (15 section 4.7).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Connection {
    pub id: Uuid,
    pub status: ConnectionStatus,
    pub stage: ConnectionStage,
    pub pending_stage_proposal: Option<PendingStageProposal>,
    /// Returned only to the member who ended it; `null` for the other member.
    pub ended_reason: Option<ConnectionEndReason>,
    pub ended_by: Option<EndedBy>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ended_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// `null`: the other account is deleted, scheduled for deletion, suspended or banned, or
    /// the profile can no longer be opened; the client shows "Member no longer available".
    pub other: Option<ProfileCard>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_message_at: Option<OffsetDateTime>,
    pub last_message_preview: Option<String>,
    pub unread_count: i32,
    pub is_muted: bool,
    pub is_archived: bool,
    /// `null` unless both members have `send_read_receipts` on (09 section 9).
    pub their_last_read_message_id: Option<Uuid>,
    pub my_contact_share: Option<ContactShare>,
    pub their_contact: Option<SharedContact>,
}

/// A chat message as one member sees it (15 section 4.7).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Message {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub sender: MessageSender,
    pub kind: MessageKind,
    /// `null` when deleted, and for system messages.
    pub body: Option<String>,
    pub is_deleted: bool,
    pub system_event: Option<SystemEvent>,
    #[schema(value_type = Option<Object>)]
    pub system_data: Option<Value>,
    /// The sender's idempotency key; set only on the caller's own messages.
    pub client_message_id: Option<String>,
    /// Only on messages from `them` (13 section 5.1 rule 3).
    pub safety_notice: Option<SafetyFlag>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

// -------------------------------------------------------------------------------------------
// Requests and pages
// -------------------------------------------------------------------------------------------

/// `filter` of `GET /v1/connections`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionFilter {
    /// Active connections that are not archived.
    #[default]
    Active,
    Archived,
    Ended,
}

/// Query of `GET /v1/connections`.
#[derive(Debug, Clone, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ConnectionListQuery {
    /// `active` (default), `archived` or `ended`.
    #[param(inline)]
    pub filter: Option<ConnectionFilter>,
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
}

impl ConnectionListQuery {
    pub fn page(&self) -> PageParams {
        PageParams {
            limit: self.limit,
            cursor: self.cursor.clone(),
        }
    }
}

/// A page of connections, latest activity first.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConnectionPage {
    pub items: Vec<Connection>,
    /// `null` on the last page.
    pub next_cursor: Option<String>,
}

/// `PATCH /v1/connections/{connection_id}`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PatchConnectionBody {
    pub is_muted: Option<bool>,
    pub is_archived: Option<bool>,
}

/// The reasons a member may give for ending a connection (15 section 12). `blocked` and
/// `account_closed` are set only by the system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MemberEndReason {
    NotCompatible,
    FamilyDeclined,
    NoResponse,
    FoundSomeoneElse,
    InappropriateBehaviour,
    Other,
}

impl MemberEndReason {
    pub fn stored(self) -> ConnectionEndReason {
        match self {
            Self::NotCompatible => ConnectionEndReason::NotCompatible,
            Self::FamilyDeclined => ConnectionEndReason::FamilyDeclined,
            Self::NoResponse => ConnectionEndReason::NoResponse,
            Self::FoundSomeoneElse => ConnectionEndReason::FoundSomeoneElse,
            Self::InappropriateBehaviour => ConnectionEndReason::InappropriateBehaviour,
            Self::Other => ConnectionEndReason::Other,
        }
    }
}

/// `POST /v1/connections/{connection_id}/end`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EndConnectionBody {
    pub reason: MemberEndReason,
    /// Also block the other member (15 section 13).
    pub also_block: Option<bool>,
}

/// Query of `GET /v1/connections/{connection_id}/messages`.
#[derive(Debug, Clone, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct MessagesQuery {
    /// Messages older than this id, newest first.
    pub before: Option<Uuid>,
    /// Messages newer than this id, oldest first.
    pub after: Option<Uuid>,
    /// 1 to 100, default 30.
    pub limit: Option<i64>,
}

/// Default and largest page of the message history (15 section 12).
pub const MESSAGES_DEFAULT_LIMIT: i64 = 30;
pub const MESSAGES_MAX_LIMIT: i64 = 100;

/// One page of the message history.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessagesPage {
    /// Newest first; oldest first with `after`.
    pub items: Vec<Message>,
    /// More messages exist in the same direction.
    pub has_more: bool,
}

/// `POST /v1/connections/{connection_id}/messages`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SendMessageBody {
    /// 1 to 2000 characters after trimming.
    pub body: String,
    /// A UUID made by the client for each new message and reused on every retry.
    pub client_message_id: String,
}

/// `POST /v1/connections/{connection_id}/read`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReadBody {
    pub up_to_message_id: Uuid,
}

/// `PUT /v1/connections/{connection_id}/contact-share`: at least one item.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[expect(clippy::struct_excessive_bools, reason = "one flag per contact item")]
pub struct ContactShareBody {
    pub share_phone: bool,
    pub share_whatsapp: bool,
    pub share_email: bool,
    pub share_guardian: bool,
}

/// The stages a member may propose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProposableStage {
    FamiliesTalking,
    Engaged,
    NikahDone,
}

impl ProposableStage {
    pub fn stage(self) -> ConnectionStage {
        match self {
            Self::FamiliesTalking => ConnectionStage::FamiliesTalking,
            Self::Engaged => ConnectionStage::Engaged,
            Self::NikahDone => ConnectionStage::NikahDone,
        }
    }
}

/// `POST /v1/connections/{connection_id}/stage-proposals`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StageProposalBody {
    pub stage: ProposableStage,
}

// -------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------

/// `Connection.ended_by` for the viewer (11 section 5.4): `me` for the member who ended it;
/// for the other member `them`, or `system` when an account closure, ban or purge ended it.
pub fn ended_by(row: &ConnectionRow, viewer_id: Uuid) -> Option<EndedBy> {
    if row.status != ConnectionStatus::Ended {
        return None;
    }
    Some(match row.ended_by_profile_id {
        Some(id) if id == viewer_id => EndedBy::Me,
        Some(_) if row.ended_reason != Some(ConnectionEndReason::AccountClosed) => EndedBy::Them,
        _ => EndedBy::System,
    })
}

fn receipts(send_read_receipts: bool) -> Privacy {
    Privacy {
        send_read_receipts,
        ..Privacy::default()
    }
}

/// The other member's shared details, or `None` (09 section 10, 03 section 8 invariant 4).
///
/// Besides an active share on an active connection, the other member must still be available
/// to the viewer (`other` is not `null`): the details of a suspended or deleted member are not
/// shown next to "Member no longer available".
fn their_contact(row: &ConnectionRow, other_available: bool) -> Option<SharedContact> {
    let visible = visibility::contact_visible(
        row.status == ConnectionStatus::Active,
        row.their_share_status,
    );
    if !(visible && other_available) {
        return None;
    }
    let shared = |flag: Option<bool>, value: &Option<String>| {
        flag.unwrap_or_default().then(|| value.clone()).flatten()
    };
    Some(SharedContact {
        phone_e164: shared(row.their_share_phone, &row.phone_e164),
        whatsapp_e164: shared(row.their_share_whatsapp, &row.whatsapp_e164),
        contact_email: shared(row.their_share_email, &row.contact_email),
        guardian: row
            .their_share_guardian
            .unwrap_or_default()
            .then(|| SharedGuardian {
                name: row.guardian_name.clone(),
                relation: row.guardian_relation,
                phone_e164: row.guardian_phone_e164.clone(),
            }),
        preferred_contact: row.preferred_contact.unwrap_or(PreferredContact::Candidate),
        best_time_to_call: row.best_time_to_call.clone(),
    })
}

/// Renders a connection for the member `viewer_id`; `other` is the other member's card, if the
/// viewer may still open it.
pub fn render(row: &ConnectionRow, viewer_id: Uuid, other: Option<ProfileCard>) -> Connection {
    let ended_by = ended_by(row, viewer_id);
    let receipts_shared =
        visibility::read_receipts_shared(&receipts(row.my_receipts), &receipts(row.their_receipts));
    let pending_stage_proposal = match (
        row.proposal_id,
        row.proposal_stage,
        row.proposal_by,
        row.proposal_created_at,
    ) {
        (Some(id), Some(stage), Some(by), Some(created_at)) => Some(PendingStageProposal {
            id,
            stage,
            proposed_by: if by == viewer_id {
                Party::Me
            } else {
                Party::Them
            },
            created_at,
        }),
        _ => None,
    };
    let my_contact_share = match (row.my_share_status, row.my_share_created_at) {
        (Some(status), Some(created_at)) => Some(ContactShare {
            share_phone: row.my_share_phone.unwrap_or_default(),
            share_whatsapp: row.my_share_whatsapp.unwrap_or_default(),
            share_email: row.my_share_email.unwrap_or_default(),
            share_guardian: row.my_share_guardian.unwrap_or_default(),
            status,
            created_at,
        }),
        _ => None,
    };
    let their_contact = their_contact(row, other.is_some());
    Connection {
        id: row.id,
        status: row.status,
        stage: row.stage,
        pending_stage_proposal,
        ended_reason: if ended_by == Some(EndedBy::Me) {
            row.ended_reason
        } else {
            None
        },
        ended_by,
        ended_at: row.ended_at,
        created_at: row.created_at,
        other,
        last_message_at: row.last_message_at,
        last_message_preview: row.last_message_preview.clone(),
        unread_count: row.unread_count,
        is_muted: row.is_muted,
        is_archived: row.is_archived,
        their_last_read_message_id: if receipts_shared {
            row.their_last_read_message_id
        } else {
            None
        },
        my_contact_share,
        their_contact,
    }
}

/// Renders a page of the viewer's connections, with the other members' cards in one batch.
pub async fn render_rows(
    state: &AppState,
    viewer: &Viewer,
    rows: &[ConnectionRow],
) -> ApiResult<Vec<Connection>> {
    let ids: Vec<Uuid> = rows.iter().map(|row| row.other_id).collect();
    let cards = views::cards(state, viewer, &ids).await?;
    Ok(rows
        .iter()
        .map(|row| render(row, viewer.id(), cards.get(&row.other_id).cloned()))
        .collect())
}

/// One connection rendered for a member, or `None` when they are not a member.
pub async fn load(
    state: &AppState,
    viewer_id: Uuid,
    connection_id: Uuid,
) -> ApiResult<Option<Connection>> {
    let Some(row) = db::get(&state.db, viewer_id, connection_id).await? else {
        return Ok(None);
    };
    let viewer = views::viewer(state, viewer_id).await?;
    Ok(render_rows(state, &viewer, &[row]).await?.pop())
}

/// Renders a message for the member `viewer_id`.
pub fn render_message(row: &MessageRow, viewer_id: Uuid) -> Message {
    let sender = match row.sender_profile_id {
        None => MessageSender::System,
        Some(id) if id == viewer_id => MessageSender::Me,
        Some(_) => MessageSender::Them,
    };
    let is_text = row.kind == MessageKind::Text;
    Message {
        id: row.id,
        connection_id: row.connection_id,
        sender,
        kind: row.kind,
        body: row.body.clone(),
        is_deleted: row.deleted_at.is_some(),
        system_event: row.system_event,
        system_data: row.system_data.clone(),
        client_message_id: if sender == MessageSender::Me {
            row.client_message_id.clone()
        } else {
            None
        },
        safety_notice: if is_text {
            chat_safety::visible_notice(row.safety_flag, sender == MessageSender::Me)
        } else {
            None
        },
        created_at: row.created_at,
    }
}

// -------------------------------------------------------------------------------------------
// Realtime events (19 section 4.6); call only after the transaction committed
// -------------------------------------------------------------------------------------------

/// Sends `connection.updated` to one member, rendered for them, when they are online. Never
/// fails the caller.
pub async fn publish_updated_to(state: &AppState, connection_id: Uuid, profile_id: Uuid) {
    if !state.hub.is_online(profile_id) {
        return;
    }
    match load(state, profile_id, connection_id).await {
        Ok(Some(connection)) => state.hub.send_to_profile(
            profile_id,
            &ServerEvent::new("connection.updated", json!({ "connection": connection })),
        ),
        Ok(None) => {}
        Err(error) => tracing::warn!(error = %error, "could not render connection.updated"),
    }
}

/// Sends `connection.updated` to both members, each with their own rendering: after a
/// connection was created, its stage or proposal changed, a contact share changed, or it
/// ended (19 section 4.6).
pub async fn publish_updated(state: &AppState, connection_id: Uuid) {
    let members = match db::members(&state.db, connection_id).await {
        Ok(members) => members,
        Err(error) => {
            tracing::warn!(%error, "could not load connection members");
            return;
        }
    };
    for profile_id in members {
        publish_updated_to(state, connection_id, profile_id).await;
    }
}

/// Sends `message.new` for each message to both members, rendered for each.
pub fn publish_messages(state: &AppState, members: [Uuid; 2], messages: &[MessageRow]) {
    for profile_id in members {
        if !state.hub.is_online(profile_id) {
            continue;
        }
        for message in messages {
            state.hub.send_to_profile(
                profile_id,
                &ServerEvent::new(
                    "message.new",
                    json!({ "message": render_message(message, profile_id) }),
                ),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(viewer: Uuid, other: Uuid) -> ConnectionRow {
        let now = OffsetDateTime::now_utc();
        ConnectionRow {
            id: Uuid::now_v7(),
            status: ConnectionStatus::Active,
            stage: ConnectionStage::Chatting,
            ended_by_profile_id: None,
            ended_reason: None,
            ended_at: None,
            created_at: now,
            last_message_at: Some(now),
            last_message_preview: None,
            sort_at: now,
            other_id: other,
            unread_count: 0,
            is_muted: false,
            is_archived: false,
            their_last_read_message_id: Some(Uuid::now_v7()),
            my_receipts: true,
            their_receipts: true,
            proposal_id: None,
            proposal_stage: None,
            proposal_by: Some(viewer),
            proposal_created_at: None,
            my_share_phone: None,
            my_share_whatsapp: None,
            my_share_email: None,
            my_share_guardian: None,
            my_share_status: None,
            my_share_created_at: None,
            their_share_phone: Some(true),
            their_share_whatsapp: Some(false),
            their_share_email: Some(false),
            their_share_guardian: Some(true),
            their_share_status: Some(ContactShareStatus::Active),
            phone_e164: Some("+923001234567".to_owned()),
            whatsapp_e164: Some("+923001234568".to_owned()),
            contact_email: Some("family@example.com".to_owned()),
            guardian_name: Some("Tariq".to_owned()),
            guardian_relation: Some(GuardianRelation::Father),
            guardian_phone_e164: Some("+923001234569".to_owned()),
            preferred_contact: Some(PreferredContact::Guardian),
            best_time_to_call: None,
        }
    }

    #[test]
    fn the_reason_reaches_only_the_member_who_ended_it() {
        let (me, them) = (Uuid::now_v7(), Uuid::now_v7());
        let mut ended = row(me, them);
        ended.status = ConnectionStatus::Ended;
        ended.ended_by_profile_id = Some(me);
        ended.ended_reason = Some(ConnectionEndReason::NotCompatible);
        let mine = render(&ended, me, None);
        assert_eq!(mine.ended_by, Some(EndedBy::Me));
        assert_eq!(mine.ended_reason, Some(ConnectionEndReason::NotCompatible));
        let theirs = render(&ended, them, None);
        assert_eq!(theirs.ended_by, Some(EndedBy::Them));
        assert_eq!(theirs.ended_reason, None);

        ended.ended_reason = Some(ConnectionEndReason::Blocked);
        assert_eq!(render(&ended, them, None).ended_by, Some(EndedBy::Them));
        ended.ended_reason = Some(ConnectionEndReason::AccountClosed);
        assert_eq!(render(&ended, them, None).ended_by, Some(EndedBy::System));
        ended.ended_by_profile_id = None;
        assert_eq!(render(&ended, me, None).ended_by, Some(EndedBy::System));
        assert_eq!(render(&ended, me, None).ended_reason, None);
        assert_eq!(render(&row(me, them), me, None).ended_by, None);
    }

    #[test]
    fn read_receipts_need_both_members() {
        let (me, them) = (Uuid::now_v7(), Uuid::now_v7());
        let mut shared = row(me, them);
        assert!(
            render(&shared, me, None)
                .their_last_read_message_id
                .is_some()
        );
        shared.my_receipts = false;
        assert!(
            render(&shared, me, None)
                .their_last_read_message_id
                .is_none()
        );
        shared.my_receipts = true;
        shared.their_receipts = false;
        assert!(
            render(&shared, me, None)
                .their_last_read_message_id
                .is_none()
        );
    }

    #[test]
    fn only_selected_items_of_an_active_share_are_shown() {
        let (me, them) = (Uuid::now_v7(), Uuid::now_v7());
        let shared = row(me, them);
        // The other member is unavailable: nothing is shown.
        assert_eq!(render(&shared, me, None).their_contact, None);
        let contact = their_contact(&shared, true).unwrap();
        assert_eq!(contact.phone_e164.as_deref(), Some("+923001234567"));
        assert_eq!(contact.whatsapp_e164, None);
        assert_eq!(contact.contact_email, None);
        assert_eq!(contact.guardian.unwrap().name.as_deref(), Some("Tariq"));
        assert_eq!(contact.preferred_contact, PreferredContact::Guardian);

        let mut ended = shared.clone();
        ended.status = ConnectionStatus::Ended;
        assert_eq!(their_contact(&ended, true), None);
        let mut revoked = shared;
        revoked.their_share_status = None;
        assert_eq!(their_contact(&revoked, true), None);
    }

    #[test]
    fn safety_notices_reach_only_the_receiver() {
        let (me, them) = (Uuid::now_v7(), Uuid::now_v7());
        let message = MessageRow {
            id: Uuid::now_v7(),
            connection_id: Uuid::now_v7(),
            sender_profile_id: Some(them),
            kind: MessageKind::Text,
            body: Some("send money".to_owned()),
            system_event: None,
            system_data: None,
            client_message_id: Some("abc".to_owned()),
            safety_flag: Some(SafetyFlag::Money),
            deleted_at: None,
            created_at: OffsetDateTime::now_utc(),
        };
        let mine = render_message(&message, me);
        assert_eq!(mine.sender, MessageSender::Them);
        assert_eq!(mine.safety_notice, Some(SafetyFlag::Money));
        assert_eq!(mine.client_message_id, None);
        let theirs = render_message(&message, them);
        assert_eq!(theirs.sender, MessageSender::Me);
        assert_eq!(theirs.safety_notice, None);
        assert_eq!(theirs.client_message_id.as_deref(), Some("abc"));
    }
}
