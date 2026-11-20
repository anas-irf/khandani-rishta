//! Other members' profiles as a viewer may see them: the single place where profile rows,
//! relation facts and the visibility rules of 09 meet (20 section 1, S-05).
//!
//! No handler, job or event builds a member-facing profile by hand (09 section 13.1). Every
//! feature that shows another member (discovery, interests, chat, shortlist, notifications,
//! WebSocket events) goes through the functions below, which load the facts for a whole page
//! in a fixed number of queries (20 section 4 rule 4), decide each pair with
//! [`crate::domain::visibility`] and [`crate::domain::matching`], and render the types of
//! 15 section 4.6.
//!
//! # Using it
//!
//! ```text
//! let viewer = views::viewer(&state, account.profile_id).await?;      // once per request
//! let cards = views::cards(&state, &viewer, &ids).await?;              // HashMap<Uuid, ProfileCard>
//! let card = cards.get(&id);                                          // None: not visible to the viewer
//! let tier = views::can_open(&state, &viewer, owner_id).await?;       // None answers 404
//! ```
//!
//! | Function | Use |
//! |---|---|
//! | [`viewer`] | Loads the caller: profile, privacy, preferences, matchable view, interest usage. |
//! | [`cards`] | `ProfileCard`s for a page of ids. Profiles the viewer may not open (09 section 2) are left out, exactly as if they did not exist. Lists built from relations (interests, connections, shortlist, visitors, notifications) use this. |
//! | [`discovery_cards`] | The same, with the decision behind each card: [`Assessed::discoverable`] (tier `member` and no E4 to E7 exclusion, 09 section 2.3) and the must-have results. |
//! | [`screen`] | The decision for each id without photos or rendering: tier, `compat`, must-haves, exclusions. For filtering and ranking large batches (search `best_match`). |
//! | [`detail`] | The `ProfileDetail` of one owner, or `None` (answer `404`). Records no profile view. |
//! | [`open`] then [`Opened::render`] | `GET /v1/profiles/{id}`: decide first (so a view can be recorded or refused), then render the `ProfileDetail`. |
//! | [`can_open`] | The tier, or `None` when the owner does not exist for the viewer. For any action on another profile that must answer `404` otherwise. |
//! | [`preview`] | `GET /v1/me/profile/preview`: the owner's own profile at a forced tier, with the same code. |
//! | [`names_at_member_tier`] | Display names rendered at tier `member` regardless of access, for `GET /v1/blocks` (09 section 4.3 rule 7). |
//!
//! # Recipes for other features
//!
//! - **Interests and connections** (`Interest.profile`, `Connection.other`): `cards` for the
//!   page's other-profile ids; a missing entry is the `null` of 15 section 4.7. Check 1 of
//!   `POST /v1/interests` is `screen` (or `can_open`) with `tier == member` plus the receiver
//!   being `active`; the checks 2 to 8 are already evaluated in
//!   [`Assessed::can_send`] (09 section 7.2) and may be mapped to the error codes of 15
//!   section 11.
//! - **Photo access** (`POST /v1/profiles/{id}/photo-access` checks 1 and 2): `screen`, then
//!   [`Assessed::disclosure`]`.photos == Some(PhotoMode::Blurred)` and
//!   [`Assessed::photo_access`] (09 section 6.4).
//! - **Notifications** (`actor = { profile_id, display_name, photo }`): `cards` for the actor
//!   ids of the page and copy `display_name` and `photo`; a missing card means the row is
//!   left out (14 section 7.3 rule 3).
//! - **Tests**: [`testing`] (test builds only) has row helpers (`connect`, `interest`,
//!   `block_row`, `add_photo`, `set_privacy`, `set_prefs`) and `candidates` for batches.
//!
//! # Rules applied here
//!
//! - Who may open a profile: 09 section 2, through [`crate::domain::visibility::relation`].
//! - Names, field groups, `locked`, photos (blurred or clear, signed only after the mode is
//!   chosen), activity labels: 09 sections 4 to 6 and 9.
//! - `compat`, reasons, `Compatibility` and `LookingFor` from matchable values only:
//!   10 sections 5, 7 and 11.
//! - `Relation`: interest (with the quiet decline of 11 section 3.5 masked for the sender),
//!   connection, shortlist, pass, photo access state (09 section 6.4) and
//!   `can_send_interest` (09 section 7.2).

pub mod assess;
pub mod load;
pub mod member;
mod render;
#[cfg(test)]
pub mod testing;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;

use time::OffsetDateTime;
use uuid::Uuid;

pub use assess::{Assessed, ViewSettings};
pub use load::geo as load_geo;
pub use member::{Member, Viewer};
pub use types::{CardRelation, ProfileCard, ProfileDetail};

use crate::domain::display;
use crate::domain::matching::explain::LookingFor;
use crate::domain::matching::subject::Geo;
use crate::domain::preference_defaults::{DefaultsInput, default_preferences};
use crate::domain::privacy::Privacy;
use crate::domain::time::karachi_date;
use crate::domain::types::{TextStatus, Tier};
use crate::domain::visibility;
use crate::error::{ApiError, ApiResult};
use crate::realtime::hub::Realtime;
use crate::reference::ReferenceData;
use crate::state::AppState;
use crate::views::load::{ApprovedPhoto, PairRows};

/// Loads the caller as a viewer. `404` when the profile does not exist.
pub async fn viewer(state: &AppState, profile_id: Uuid) -> ApiResult<Viewer> {
    let now = OffsetDateTime::now_utc();
    let mut members = members(state, &[profile_id], now).await?;
    let member = members.remove(&profile_id).ok_or(ApiError::NotFound)?;
    let usage = load::interest_usage(&state.db, profile_id, now).await?;
    Ok(Viewer { member, usage, now })
}

/// Loads profiles with their preferences and matchable views, keyed by id (two queries).
pub async fn members(
    state: &AppState,
    ids: &[Uuid],
    now: OffsetDateTime,
) -> ApiResult<HashMap<Uuid, Member>> {
    let rows = load::profiles(&state.db, ids).await?;
    let mut prefs = load::preferences(&state.db, ids).await?;
    let reference = state.reference.get();
    let today = karachi_date(now);
    Ok(rows
        .into_iter()
        .map(|(id, row)| (id, Member::new(row, prefs.remove(&id), &reference, today)))
        .collect())
}

/// The facts of one page of owners for one viewer.
struct Gathered {
    members: HashMap<Uuid, Member>,
    pairs: HashMap<Uuid, PairRows>,
    /// `None` when photos were not requested.
    photos: Option<HashMap<Uuid, Vec<ApprovedPhoto>>>,
    geo: Geo,
    settings: ViewSettings,
    reference: Arc<ReferenceData>,
}

/// Loads every fact of a page: profiles, preferences, pair links (three queries), places and,
/// when asked, photos. Nine queries at most, whatever the page size.
async fn gather(
    state: &AppState,
    viewer: &Viewer,
    ids: &[Uuid],
    with_photos: bool,
) -> ApiResult<Gathered> {
    let ids: Vec<Uuid> = ids
        .iter()
        .copied()
        .filter(|id| *id != viewer.id())
        .collect();
    let members = members(state, &ids, viewer.now).await?;
    let pairs = load::pairs(&state.db, viewer.id(), &ids).await?;
    let photos = if with_photos {
        Some(load::approved_photos(&state.db, &ids).await?)
    } else {
        None
    };
    let geo = load::geo(
        &state.db,
        std::iter::once(viewer.prefs()).chain(members.values().map(|member| &member.prefs)),
    )
    .await?;
    let settings = ViewSettings::new(&*state.settings.get().await?);
    Ok(Gathered {
        members,
        pairs,
        photos,
        geo,
        settings,
        reference: state.reference.get(),
    })
}

impl Gathered {
    /// Decides one owner, or `None` when the viewer may not open it.
    fn assess(&self, viewer: &Viewer, id: Uuid, with_compatibility: bool) -> Option<Assessed> {
        let owner = self.members.get(&id)?;
        let pair = self.pairs.get(&id).cloned().unwrap_or_default();
        let has_photo = self
            .photos
            .as_ref()
            .map_or(owner.row.has_approved_photo, |photos| {
                photos.get(&id).is_some_and(|photos| !photos.is_empty())
            });
        assess::assess(
            viewer,
            owner,
            &pair,
            &self.geo,
            &self.settings,
            has_photo,
            with_compatibility,
        )
        .ok()
    }

    fn photos_of(&self, id: Uuid) -> &[ApprovedPhoto] {
        self.photos
            .as_ref()
            .and_then(|photos| photos.get(&id))
            .map_or(&[][..], Vec::as_slice)
    }

    /// Renders the card of an assessed owner.
    async fn card(
        &self,
        state: &AppState,
        viewer: &Viewer,
        assessed: &Assessed,
    ) -> Option<ProfileCard> {
        let owner = self.members.get(&assessed.owner_id)?;
        let photos = self.photos_of(assessed.owner_id);
        let photo = match (assessed.disclosure.photos, render::primary(photos)) {
            (Some(mode), Some(primary)) => {
                render::photo_view(state.storage.as_ref(), mode, primary).await
            }
            _ => None,
        };
        render::card(
            render::CardInput {
                owner,
                disclosure: &assessed.disclosure,
                activity: activity(state, viewer.privacy(), owner, viewer.now),
                compat: assessed.compat(),
                reasons: assessed
                    .matching
                    .as_ref()
                    .map_or_default(|facts| facts.reasons.clone()),
                relation: render::card_relation(assessed),
                photo,
                photo_count: photos.len(),
                now: viewer.now,
            },
            &self.reference,
        )
    }
}

/// The activity values for a viewer (09 section 9).
fn activity(
    state: &AppState,
    viewer_privacy: &Privacy,
    owner: &Member,
    now: OffsetDateTime,
) -> visibility::Activity {
    let last_active_at = owner.row.last_active_at;
    let online = display::is_online(state.hub.is_online(owner.id()), last_active_at, now);
    visibility::activity(owner.privacy(), viewer_privacy, online, last_active_at, now)
}

/// `ProfileCard`s for the ids the viewer may open; the others are left out (09 section 2).
pub async fn cards(
    state: &AppState,
    viewer: &Viewer,
    ids: &[Uuid],
) -> ApiResult<HashMap<Uuid, ProfileCard>> {
    Ok(discovery_cards(state, viewer, ids)
        .await?
        .into_iter()
        .map(|(id, (_, card))| (id, card))
        .collect())
}

/// `ProfileCard`s with the decision behind each, for lists that filter further: discovery
/// lists keep only [`Assessed::discoverable`] owners, recommendations also re-check the
/// must-haves.
pub async fn discovery_cards(
    state: &AppState,
    viewer: &Viewer,
    ids: &[Uuid],
) -> ApiResult<HashMap<Uuid, (Assessed, ProfileCard)>> {
    let gathered = gather(state, viewer, ids, true).await?;
    let mut cards = HashMap::with_capacity(ids.len());
    for id in ids {
        let Some(assessed) = gathered.assess(viewer, *id, false) else {
            continue;
        };
        if let Some(card) = gathered.card(state, viewer, &assessed).await {
            cards.insert(*id, (assessed, card));
        }
    }
    Ok(cards)
}

/// The decision for each id without loading photos or rendering anything. Owners the viewer
/// may not open are absent.
pub async fn screen(
    state: &AppState,
    viewer: &Viewer,
    ids: &[Uuid],
) -> ApiResult<HashMap<Uuid, Assessed>> {
    let gathered = gather(state, viewer, ids, false).await?;
    Ok(ids
        .iter()
        .filter_map(|id| gathered.assess(viewer, *id, false).map(|seen| (*id, seen)))
        .collect())
}

/// The tier the viewer has with the owner, or `None` when the owner does not exist for the
/// viewer (09 section 2). Answer `404 not_found` on `None`.
pub async fn can_open(
    state: &AppState,
    viewer: &Viewer,
    owner_id: Uuid,
) -> ApiResult<Option<Tier>> {
    Ok(screen(state, viewer, &[owner_id])
        .await?
        .remove(&owner_id)
        .map(|seen| seen.tier))
}

/// A profile the viewer may open, decided but not yet rendered.
pub struct Opened {
    gathered: Gathered,
    assessed: Assessed,
}

impl Opened {
    /// The tier shown to the viewer.
    pub fn tier(&self) -> Tier {
        self.assessed.tier
    }

    /// The decision behind the page.
    pub fn assessed(&self) -> &Assessed {
        &self.assessed
    }

    /// Renders the `ProfileDetail` (15 section 4.6).
    pub async fn render(self, state: &AppState, viewer: &Viewer) -> ApiResult<ProfileDetail> {
        let gathered = &self.gathered;
        let assessed = &self.assessed;
        let owner = gathered
            .members
            .get(&assessed.owner_id)
            .ok_or(ApiError::NotFound)?;
        let card = gathered
            .card(state, viewer, assessed)
            .await
            .ok_or(ApiError::NotFound)?;
        let looking_for = match (viewer.subject(), owner.subject.as_ref()) {
            (Some(subject), _) => {
                render::looking_for(owner, subject, &gathered.geo, &gathered.reference)
            }
            (None, Some(owner_subject)) => without_verdicts(render::looking_for(
                owner,
                &member::stand_in_viewer(owner_subject, viewer.today()),
                &gathered.geo,
                &gathered.reference,
            )),
            (None, None) => LookingFor {
                lines: Vec::new(),
                matched: 0,
                total: 0,
            },
        };
        Ok(render::detail(
            render::DetailInput {
                owner,
                card,
                disclosure: &assessed.disclosure,
                is_online: activity(state, viewer.privacy(), owner, viewer.now).is_online,
                photos: render::photo_views(
                    state.storage.as_ref(),
                    assessed.disclosure.photos,
                    gathered.photos_of(assessed.owner_id),
                )
                .await,
                looking_for,
                compatibility: assessed
                    .matching
                    .as_ref()
                    .and_then(|facts| facts.compatibility.clone()),
                relation: render::relation(assessed),
            },
            &gathered.reference,
        ))
    }
}

/// Clears every verdict, so no ticks are drawn (15 section 7).
fn without_verdicts(mut looking_for: LookingFor) -> LookingFor {
    for line in &mut looking_for.lines {
        line.viewer_matches = None;
    }
    looking_for.matched = 0;
    looking_for.total = 0;
    looking_for
}

/// The `ProfileDetail` of one owner as the viewer may see it, or `None` when the owner does
/// not exist for the viewer (answer `404 not_found`). Records no profile view; only
/// `GET /v1/profiles/{id}` does, through [`open`].
pub async fn detail(
    state: &AppState,
    viewer: &Viewer,
    owner_id: Uuid,
) -> ApiResult<Option<ProfileDetail>> {
    match open(state, viewer, owner_id).await? {
        Some(opened) => Ok(Some(opened.render(state, viewer).await?)),
        None => Ok(None),
    }
}

/// Decides whether the viewer may open the owner, loading everything the page needs. `None`
/// means `404 not_found`.
pub async fn open(state: &AppState, viewer: &Viewer, owner_id: Uuid) -> ApiResult<Option<Opened>> {
    let gathered = gather(state, viewer, &[owner_id], true).await?;
    Ok(gathered
        .assess(viewer, owner_id, true)
        .map(|assessed| Opened { gathered, assessed }))
}

/// The owner's own profile as a viewer at `tier` would see it (15 section 7, 08 section 4):
/// the same disclosure code with the tier forced and no photo access row. `compat`,
/// `compatibility` and the reasons are empty, every `LookingFor` verdict is `null`, the
/// relation is neutral, and no profile view is recorded.
///
/// It works in every profile status. A `draft` that still lacks a value every other profile
/// has cannot be rendered as a `ProfileCard` (whose fields are not nullable) and answers
/// `409 invalid_state` with its status.
pub async fn preview(state: &AppState, profile_id: Uuid, tier: Tier) -> ApiResult<ProfileDetail> {
    let now = OffsetDateTime::now_utc();
    let owner = members(state, &[profile_id], now)
        .await?
        .remove(&profile_id)
        .ok_or(ApiError::NotFound)?;
    let status = owner.status();
    let subject = owner
        .subject
        .clone()
        .ok_or_else(|| ApiError::invalid_state(status))?;
    let photos = load::approved_photos(&state.db, &[profile_id])
        .await?
        .remove(&profile_id)
        .unwrap_or_default();
    let disclosure = visibility::disclosure(
        owner.privacy(),
        tier,
        owner.content(!photos.is_empty()),
        None,
    );
    let settings = ViewSettings::new(&*state.settings.get().await?);
    let reference = state.reference.get();
    let photo_access = visibility::photo_access_state(
        disclosure.photos,
        owner.privacy().allow_photo_requests,
        None,
        settings.photo_access_retry_days,
        now,
    );
    let activity = activity(state, owner.privacy(), &owner, now);
    let photo = match (disclosure.photos, render::primary(&photos)) {
        (Some(mode), Some(primary)) => {
            render::photo_view(state.storage.as_ref(), mode, primary).await
        }
        _ => None,
    };
    let card = render::card(
        render::CardInput {
            owner: &owner,
            disclosure: &disclosure,
            activity,
            compat: None,
            reasons: Vec::new(),
            relation: CardRelation {
                tier,
                interest_status: None,
                interest_direction: None,
                connection_id: None,
                is_shortlisted: false,
                can_send_interest: false,
            },
            photo,
            photo_count: photos.len(),
            now,
        },
        &reference,
    )
    .ok_or_else(|| ApiError::invalid_state(status))?;
    let geo = load::geo(&state.db, std::iter::once(&owner.prefs)).await?;
    let stand_in = member::stand_in_viewer(&subject, karachi_date(now));
    let looking_for = without_verdicts(render::looking_for(&owner, &stand_in, &geo, &reference));
    Ok(render::detail(
        render::DetailInput {
            owner: &owner,
            card,
            disclosure: &disclosure,
            is_online: activity.is_online,
            photos: render::photo_views(state.storage.as_ref(), disclosure.photos, &photos).await,
            looking_for,
            compatibility: None,
            relation: render::neutral_relation(tier, photo_access),
        },
        &reference,
    ))
}

/// Display names rendered at tier `member`, with public codes, whatever the access, keyed by
/// id: the `GET /v1/blocks` list shows only these (09 section 4.3 rule 7).
pub async fn names_at_member_tier(
    state: &AppState,
    ids: &[Uuid],
) -> ApiResult<HashMap<Uuid, (String, String)>> {
    let rows = load::profiles(&state.db, ids).await?;
    Ok(rows
        .into_iter()
        .map(|(id, row)| {
            let member = Member {
                prefs: default_preferences(&DefaultsInput::default()),
                has_preferences_row: false,
                notes_status: TextStatus::Approved,
                subject: None,
                row,
            };
            let name = render::display_name(&member, Tier::Member);
            (id, (name, member.row.public_code))
        })
        .collect())
}
