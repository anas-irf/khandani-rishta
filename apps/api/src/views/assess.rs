//! The decision for one (viewer, owner) pair: the tier of 09 section 2, the disclosure of 09
//! sections 4 to 6, the matching numbers of 10 sections 5 and 7, and the relation facts of
//! 15 section 4.6. Pure: every input has been loaded by the caller.

use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::matching::eligibility::{
    ConnectionLink, Cooldowns, InterestLink, PairLinks, excluded_by_pair_links,
};
use crate::domain::matching::explain::{self, Compatibility};
use crate::domain::matching::fit::{Pair, Side};
use crate::domain::matching::reasons::{ReasonCode, reasons};
use crate::domain::matching::subject::Geo;
use crate::domain::types::{InterestStatus, Tier};
use crate::domain::visibility::{
    self, CannotSend, ClosedInterest, Disclosure, InterestDirection, InterestFacts,
    InterestSettings, PairFacts, PhotoAccessRow, Refusal, RelationPhotoAccess, SenderFacts,
};
use crate::settings::AppSettings;
use crate::views::load::{InterestRow, PairRows};
use crate::views::member::{Member, Viewer};

/// The settings the views depend on (03 section 7).
#[derive(Debug, Clone, Copy)]
pub struct ViewSettings {
    pub interests: InterestSettings,
    pub cooldowns: Cooldowns,
    /// `photo_access.retry_days`.
    pub photo_access_retry_days: i64,
}

impl ViewSettings {
    pub fn new(settings: &AppSettings) -> Self {
        let days = |value: i64| u32::try_from(value.max(0)).unwrap_or(u32::MAX);
        Self {
            interests: InterestSettings {
                pending_interests_max: settings.pending_interests_max,
                active_connections_max: settings.active_connections_max,
                interests_per_day: settings.interests_per_day,
                interests_per_day_verified: settings.interests_per_day_verified,
                cooldown_after_decline_days: settings.cooldown_after_decline_days,
                cooldown_after_expiry_days: settings.cooldown_after_expiry_days,
                cooldown_after_withdraw_days: settings.cooldown_after_withdraw_days,
                connection_cooldown_after_end_days: settings.connection_cooldown_after_end_days,
            },
            cooldowns: Cooldowns {
                decline: days(settings.cooldown_after_decline_days),
                expiry: days(settings.cooldown_after_expiry_days),
                withdraw: days(settings.cooldown_after_withdraw_days),
                connection_end: days(settings.connection_cooldown_after_end_days),
            },
            photo_access_retry_days: settings.photo_access_retry_days,
        }
    }
}

/// The matching numbers of a pair, from matchable values only (09 section 5.4).
#[derive(Debug, Clone)]
pub struct MatchFacts {
    pub compat: u8,
    pub reasons: Vec<ReasonCode>,
    /// Built only for the profile page.
    pub compatibility: Option<Compatibility>,
    /// M1: the owner passes the viewer's must-haves.
    pub owner_meets_viewer_must_haves: bool,
    /// M2: the viewer passes the owner's must-haves (also E8 for `preference_match`).
    pub viewer_meets_owner_must_haves: bool,
}

/// Everything decided about one pair.
#[derive(Debug, Clone)]
pub struct Assessed {
    pub owner_id: Uuid,
    /// The tier shown to the viewer. Equal to the real tier, except that a declined interest
    /// the sender must still see as pending (11 section 3.5) is shown as `interest_to_owner`;
    /// that tier discloses exactly what `member` does (09 sections 5.1 and 6.1).
    pub tier: Tier,
    pub disclosure: Disclosure,
    pub matching: Option<MatchFacts>,
    /// The pending interest as the viewer may see it (masked for a quiet decline).
    pub interest: Option<(InterestDirection, InterestRow)>,
    pub connection_id: Option<Uuid>,
    pub is_shortlisted: bool,
    pub shortlist_note: Option<String>,
    pub is_passed: bool,
    pub photo_access: RelationPhotoAccess,
    pub can_send: Result<(), CannotSend>,
    /// E4 to E7 remove the owner from the viewer's recommendations and search (10 section 3.1).
    pub excluded_from_discovery: bool,
}

impl Assessed {
    /// Whether the owner may appear in the viewer's discovery lists: tier `member` only
    /// (09 section 2.3) and no E4 to E7 exclusion.
    pub fn discoverable(&self) -> bool {
        self.tier == Tier::Member && !self.excluded_from_discovery
    }

    pub fn compat(&self) -> Option<u8> {
        self.matching.as_ref().map(|facts| facts.compat)
    }
}

/// Decides one pair. `has_approved_photo` is whether the owner has an approved photo (from
/// the loaded photos when the caller has them). `with_compatibility` builds the
/// `Compatibility` block of the profile page.
pub fn assess(
    viewer: &Viewer,
    owner: &Member,
    pair: &PairRows,
    geo: &Geo,
    settings: &ViewSettings,
    has_approved_photo: bool,
    with_compatibility: bool,
) -> Result<Assessed, Refusal> {
    let now = viewer.now;
    let viewer_id = viewer.id();
    let pending = pair
        .interests
        .iter()
        .find(|interest| interest.status == InterestStatus::Pending)
        .map(|interest| (direction(viewer_id, interest), interest));
    let latest_sent_row = pair.interests.iter().find(|interest| {
        interest.sender_profile_id == viewer_id && interest.status != InterestStatus::Pending
    });
    let latest_sent = latest_sent_row.map(|interest| ClosedInterest {
        status: interest.status,
        responded_at: interest.responded_at,
        expires_at: interest.expires_at,
    });
    let active_connection = pair.active_connection();
    let connection_ended_at = pair.connection_ended_at();

    let matching = match_facts(viewer, owner, geo, now, with_compatibility);
    let viewer_fits_owner = matching
        .as_ref()
        .is_some_and(|facts| facts.viewer_meets_owner_must_haves);

    let pair_facts = PairFacts {
        blocked: pair.blocked,
        active_connection: active_connection.is_some(),
        pending_interest: pending.map(|(direction, _)| direction),
        viewer_fits_owner_must_haves: viewer_fits_owner,
    };
    let real_tier = visibility::relation(
        &viewer.member.viewer_facts(),
        &owner.owner_facts(),
        pair_facts,
    )?;

    // A quiet decline stays "pending" for the sender until it would have expired.
    let masked =
        pending.is_none() && visibility::decline_shown_as_pending(latest_sent.as_ref(), now);
    let interest = pending
        .map(|(direction, row)| (direction, row.clone()))
        .or_else(|| {
            masked
                .then_some(latest_sent_row)
                .flatten()
                .map(|row| (InterestDirection::Sent, row.clone()))
        });
    let tier = if masked && real_tier == Tier::Member {
        Tier::InterestToOwner
    } else {
        real_tier
    };

    let disclosure = visibility::disclosure(
        owner.privacy(),
        real_tier,
        owner.content(has_approved_photo),
        pair.photo_access.map(|(status, _)| status),
    );
    let photo_access = visibility::photo_access_state(
        disclosure.photos,
        owner.privacy().allow_photo_requests,
        pair.photo_access
            .map(|(status, updated_at)| PhotoAccessRow { status, updated_at }),
        settings.photo_access_retry_days,
        now,
    );
    let can_send = visibility::can_send_interest(
        &InterestFacts {
            viewer_status: viewer.status(),
            viewer: SenderFacts {
                is_id_verified: viewer.row().is_id_verified,
                is_photo_verified: viewer.row().is_photo_verified,
                fits_receiver_must_haves: viewer_fits_owner,
            },
            owner_permission: owner.privacy().interest_permission,
            active_connection: active_connection.is_some(),
            pending_interest: pending.map(|(direction, _)| direction),
            latest_sent,
            connection_ended_at,
            usage: viewer.usage,
        },
        &settings.interests,
        now,
    );
    let excluded_from_discovery = excluded(pair, settings, now);

    Ok(Assessed {
        owner_id: owner.id(),
        tier,
        disclosure,
        matching,
        interest,
        connection_id: active_connection,
        is_shortlisted: pair.shortlisted,
        shortlist_note: pair.shortlist_note.clone(),
        is_passed: pair.pass_expires_at.is_some_and(|at| at > now),
        photo_access,
        can_send,
        excluded_from_discovery,
    })
}

/// E4 to E7 for the pair (10 section 3.1), from the loaded links.
fn excluded(pair: &PairRows, settings: &ViewSettings, now: OffsetDateTime) -> bool {
    excluded_by_pair_links(
        &PairLinks {
            pass_expires_at: pair.pass_expires_at,
            connections: pair
                .connections
                .iter()
                .map(|connection| ConnectionLink {
                    status: connection.status,
                    ended_at: connection.ended_at,
                })
                .collect(),
            interests: pair
                .interests
                .iter()
                .map(|interest| InterestLink {
                    status: interest.status,
                    responded_at: interest.responded_at,
                    expires_at: interest.expires_at,
                })
                .collect(),
        },
        settings.cooldowns,
        now,
    )
}

/// Direction of an interest seen from the viewer.
fn direction(viewer_id: Uuid, interest: &InterestRow) -> InterestDirection {
    if interest.sender_profile_id == viewer_id {
        InterestDirection::Sent
    } else {
        InterestDirection::Received
    }
}

/// `compat`, reasons and both must-have directions, when both profiles have a matchable view.
fn match_facts(
    viewer: &Viewer,
    owner: &Member,
    geo: &Geo,
    now: OffsetDateTime,
    with_compatibility: bool,
) -> Option<MatchFacts> {
    let viewer_subject = viewer.subject()?;
    let owner_subject = owner.subject.as_ref()?;
    let pair = Pair::new(
        Side {
            subject: viewer_subject,
            prefs: viewer.prefs(),
        },
        Side {
            subject: owner_subject,
            prefs: &owner.prefs,
        },
        geo,
    );
    Some(MatchFacts {
        compat: pair.compat(),
        reasons: reasons(&pair, now),
        compatibility: with_compatibility.then(|| explain::compatibility(&pair, now)),
        owner_meets_viewer_must_haves: pair.candidate_meets_viewer_must_haves(),
        viewer_meets_owner_must_haves: pair.viewer_meets_candidate_must_haves(),
    })
}
