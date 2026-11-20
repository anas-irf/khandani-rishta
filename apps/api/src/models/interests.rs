//! API types for interests (15 sections 4.7 and 11) and the sender-side masking of a quiet
//! decline (11 section 3.5).

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::db::interests::InterestRow;
use crate::db::pagination::PageParams;
use crate::domain::privacy::Privacy;
use crate::domain::types::InterestStatus;
use crate::domain::visibility::{self, InterestDirection};
use crate::models::connections::Connection;
use crate::views::ProfileCard;

/// `Interest.display_status` (15 section 4.7): what the client shows. Declines are hidden from
/// senders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DisplayStatus {
    Pending,
    Accepted,
    NoResponse,
    Closed,
    Withdrawn,
    Declined,
}

/// An interest as one of its two members sees it (15 section 4.7).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Interest {
    pub id: Uuid,
    pub direction: InterestDirection,
    /// For the sender a `declined` interest is reported as `pending` until `expires_at`, then as
    /// `expired`: the real value never reaches the sender.
    pub status: InterestStatus,
    pub display_status: DisplayStatus,
    pub message: Option<String>,
    /// The compatibility of the pair when the interest was sent (0..100).
    pub compat_score: Option<i16>,
    /// The receiver always sees their own state; the sender sees `true` only when both members
    /// send read receipts (09 section 9).
    pub seen: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// `null` for the sender of a declined interest, which must still look unanswered.
    #[serde(with = "time::serde::rfc3339::option")]
    pub responded_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    /// The connection created when the interest was accepted.
    pub connection_id: Option<Uuid>,
    /// The other profile; `null` when it is no longer visible to the caller (09 section 2).
    pub profile: Option<ProfileCard>,
}

/// The status pair a member is shown for an interest (15 section 4.7 table).
///
/// The sender of a declined interest sees `pending` / `no_response` until `expires_at`, then
/// `expired` / `closed`; an expired interest is `closed` for both members.
pub fn shown_status(
    status: InterestStatus,
    direction: InterestDirection,
    expires_at: OffsetDateTime,
    now: OffsetDateTime,
) -> (InterestStatus, DisplayStatus) {
    use InterestStatus as S;
    match (status, direction) {
        (S::Declined, InterestDirection::Sent) if now < expires_at => {
            (S::Pending, DisplayStatus::NoResponse)
        }
        (S::Declined, InterestDirection::Sent) | (S::Expired, _) => {
            (S::Expired, DisplayStatus::Closed)
        }
        (S::Declined, InterestDirection::Received) => (S::Declined, DisplayStatus::Declined),
        (S::Pending, _) => (S::Pending, DisplayStatus::Pending),
        (S::Accepted, _) => (S::Accepted, DisplayStatus::Accepted),
        (S::Withdrawn, _) => (S::Withdrawn, DisplayStatus::Withdrawn),
    }
}

/// Renders an interest for the member `viewer_id`. `card` is the other profile as the viewer
/// may see it (`None` when it can no longer be opened).
pub fn render(
    row: &InterestRow,
    viewer_id: Uuid,
    card: Option<ProfileCard>,
    now: OffsetDateTime,
) -> Interest {
    let direction = if row.sender_profile_id == viewer_id {
        InterestDirection::Sent
    } else {
        InterestDirection::Received
    };
    let (status, display_status) = shown_status(row.status, direction, row.expires_at, now);
    let seen_at_all = row.seen_at.is_some();
    let seen = match direction {
        InterestDirection::Received => seen_at_all,
        InterestDirection::Sent => visibility::interest_seen_for_sender(
            seen_at_all,
            &receipts(row.sender_receipts),
            &receipts(row.receiver_receipts),
        ),
    };
    // A decline must not show through the answer time either.
    let responded_at =
        if direction == InterestDirection::Sent && row.status == InterestStatus::Declined {
            None
        } else {
            row.responded_at
        };
    Interest {
        id: row.id,
        direction,
        status,
        display_status,
        message: row.message.clone(),
        compat_score: row.compat_score,
        seen,
        created_at: row.created_at,
        responded_at,
        expires_at: row.expires_at,
        connection_id: row.connection_id,
        profile: card,
    }
}

/// The answer the sender gets when withdrawing an interest that was quietly declined: it looks
/// withdrawn, while the row stays `declined` (11 section 3.5 rule 2).
pub fn shown_as_withdrawn(mut interest: Interest, now: OffsetDateTime) -> Interest {
    interest.status = InterestStatus::Withdrawn;
    interest.display_status = DisplayStatus::Withdrawn;
    interest.responded_at = Some(now);
    interest
}

/// A privacy value carrying only `send_read_receipts`, for the read-receipt rule.
fn receipts(send_read_receipts: bool) -> Privacy {
    Privacy {
        send_read_receipts,
        ..Privacy::default()
    }
}

/// `POST /v1/interests`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SendInterestBody {
    pub receiver_profile_id: Uuid,
    /// At most 300 characters; the text rules apply (13 section 3).
    pub message: Option<String>,
}

/// The answer of `POST /v1/interests`: `connection` is set when a mutual interest created one.
#[derive(Debug, Serialize, ToSchema)]
pub struct SentInterest {
    pub interest: Interest,
    pub connection: Option<Connection>,
}

/// The answer of `POST /v1/interests/{interest_id}/accept`.
#[derive(Debug, Serialize, ToSchema)]
pub struct AcceptedInterest {
    pub interest: Interest,
    pub connection: Connection,
}

/// `POST /v1/interests/{interest_id}/decline`.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DeclineBody {
    /// Also block the sender (15 section 13).
    pub also_block: Option<bool>,
}

/// `POST /v1/interests/seen`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SeenBody {
    /// Ids of received interests that were rendered on screen; at most 100.
    pub interest_ids: Vec<Uuid>,
}

/// Most ids in one `POST /v1/interests/seen`: one screen of interests is far fewer.
pub const SEEN_MAX_IDS: usize = 100;

/// `box` of `GET /v1/interests`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InterestBox {
    Received,
    Sent,
}

/// `status` of `GET /v1/interests`. `closed` covers declined, withdrawn and expired.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InterestFilter {
    #[default]
    Pending,
    Accepted,
    Closed,
}

/// Query of `GET /v1/interests`.
#[derive(Debug, Clone, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct InterestListQuery {
    /// `received` or `sent`.
    #[serde(rename = "box")]
    #[param(rename = "box")]
    pub mailbox: InterestBox,
    /// `pending` (default), `accepted` or `closed`.
    pub status: Option<InterestFilter>,
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
}

impl InterestListQuery {
    pub fn page(&self) -> PageParams {
        PageParams {
            limit: self.limit,
            cursor: self.cursor.clone(),
        }
    }
}

/// A page of interests, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct InterestPage {
    pub items: Vec<Interest>,
    /// `null` on the last page.
    pub next_cursor: Option<String>,
}

#[cfg(test)]
mod tests {
    use time::Duration;

    use super::*;

    #[test]
    fn a_sender_never_sees_a_decline() {
        let now = OffsetDateTime::now_utc();
        let later = now + Duration::days(3);
        let earlier = now - Duration::days(3);
        for expires_at in [later, earlier] {
            let (status, display) = shown_status(
                InterestStatus::Declined,
                InterestDirection::Sent,
                expires_at,
                now,
            );
            assert_ne!(status, InterestStatus::Declined);
            assert_ne!(display, DisplayStatus::Declined);
        }
        assert_eq!(
            shown_status(
                InterestStatus::Declined,
                InterestDirection::Sent,
                later,
                now
            ),
            (InterestStatus::Pending, DisplayStatus::NoResponse)
        );
        assert_eq!(
            shown_status(
                InterestStatus::Declined,
                InterestDirection::Sent,
                earlier,
                now
            ),
            (InterestStatus::Expired, DisplayStatus::Closed)
        );
    }

    #[test]
    fn the_receiver_sees_the_real_status() {
        let now = OffsetDateTime::now_utc();
        let at = now + Duration::days(1);
        let received = InterestDirection::Received;
        assert_eq!(
            shown_status(InterestStatus::Declined, received, at, now),
            (InterestStatus::Declined, DisplayStatus::Declined)
        );
        assert_eq!(
            shown_status(InterestStatus::Expired, received, at, now),
            (InterestStatus::Expired, DisplayStatus::Closed)
        );
        for status in [
            InterestStatus::Pending,
            InterestStatus::Accepted,
            InterestStatus::Withdrawn,
        ] {
            for direction in [InterestDirection::Sent, received] {
                assert_eq!(shown_status(status, direction, at, now).0, status);
            }
        }
    }
}
