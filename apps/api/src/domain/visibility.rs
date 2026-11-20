//! Who may open a profile, and which parts of it a viewer receives (09).
//!
//! Pure functions over facts the handler has already loaded; nothing here touches the database
//! (09 section 13.1). Handlers load the facts, call these functions and serialise the result.
//! Every refusal of [`relation`] is answered as `404 not_found`, exactly as if the profile did
//! not exist.
//!
//! Must-have matching (`passes_must_haves`, 10 section 3.2) lives in the matching module. Where
//! a rule here depends on it, the caller passes the result in as a boolean.

use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::domain::display;
use crate::domain::options::{
    DiscoveryVisibility, FieldVisibility, Gender, InterestPermission, MaritalStatus,
    PhotoVisibility,
};
use crate::domain::preferences::Preferences;
use crate::domain::privacy::Privacy;
use crate::domain::text_enum;
use crate::domain::time::karachi_date;
use crate::domain::types::{
    ContactShareStatus, InterestStatus, LastActive, LockedGroup, PhotoAccessStatus, ProfileStatus,
    TextStatus, Tier, UserStatus,
};

// -------------------------------------------------------------------------------------------
// Section 2: who can open a profile
// -------------------------------------------------------------------------------------------

text_enum! {
    /// Direction of an interest seen from the viewer: `sent` by the viewer to the owner, or
    /// `received` by the viewer from the owner (15 section 4.6 `interest_direction`).
    InterestDirection { Sent = "sent", Received = "received" }
}

/// The viewer's own profile, as far as 09 section 2 needs it.
#[derive(Debug, Clone, Copy)]
pub struct ViewerFacts {
    pub id: Uuid,
    pub gender: Option<Gender>,
    pub status: ProfileStatus,
    pub marital_status: Option<MaritalStatus>,
    /// The viewer's `partner_preferences.marital_statuses` contains `married`
    /// ([`accepts_married`]).
    pub accepts_married: bool,
}

/// The owner's profile and account, as far as 09 section 2 needs them.
#[derive(Debug, Clone, Copy)]
pub struct OwnerFacts {
    pub id: Uuid,
    pub gender: Option<Gender>,
    pub status: ProfileStatus,
    /// `users.status` of the owner's account.
    pub user_status: UserStatus,
    pub marital_status: Option<MaritalStatus>,
    /// The owner's `partner_preferences.marital_statuses` contains `married`
    /// ([`accepts_married`]).
    pub accepts_married: bool,
    pub discovery_visibility: DiscoveryVisibility,
}

/// What links the two profiles (part of `PairLink`, 09 section 13.1), loaded in one query.
#[derive(Debug, Clone, Copy, Default)]
pub struct PairFacts {
    /// A `blocks` row exists in either direction.
    pub blocked: bool,
    /// A `connections` row for the pair has `status = 'active'`.
    pub active_connection: bool,
    /// The `interests` row between the pair with `status = 'pending'`, if any. A declined
    /// interest that the sender still sees as pending (11 section 3.5) is not pending here.
    pub pending_interest: Option<InterestDirection>,
    /// `passes_must_haves(O.preferences, V)` (10 section 3.2), computed by the caller. Read only
    /// when the owner's `discovery_visibility` is `preference_match`.
    pub viewer_fits_owner_must_haves: bool,
}

/// Why a viewer may not open a profile: the row of 09 section 2.2 that refused. The API
/// answers every refusal as `404 not_found`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// Row 1: the viewer's own profile. The owner uses `GET /v1/me/profile` and the preview.
    SameProfile,
    /// Row 2: the same gender, or a gender that is not yet set.
    NotOppositeGender,
    /// Row 3: a block in either direction.
    Blocked,
    /// Row 4: the owner's account is not `active`, or the profile is `draft`,
    /// `pending_review`, `changes_requested`, `suspended` or `deleted`.
    OwnerUnavailable,
    /// Row 8: no relation applies and the viewer or the owner is not `active`.
    NotActive,
    /// Row 9: the second-marriage rule fails in either direction.
    SecondMarriage,
    /// Row 10: the owner's `discovery_visibility` is `hidden`.
    DiscoveryHidden,
    /// Row 11: `preference_match` and the viewer fails one of the owner's must-haves.
    MustHavesNotMet,
}

/// Whether a profile's partner preferences accept a `married` partner. A missing preferences row
/// counts as an empty array (09 section 2.4).
pub fn accepts_married(preferences: Option<&Preferences>) -> bool {
    preferences.is_some_and(|prefs| prefs.marital_statuses.contains(&MaritalStatus::Married))
}

/// The decision table of 09 section 2.2: the tier the viewer has with the owner, or why the
/// owner does not exist for the viewer. Rows are evaluated top to bottom on current data.
///
/// The owner's own profile is refused (row 1): the preview passes its tier explicitly instead.
pub fn relation(
    viewer: &ViewerFacts,
    owner: &OwnerFacts,
    pair: PairFacts,
) -> Result<Tier, Refusal> {
    use ProfileStatus::{Active, Closed, Paused};

    if viewer.id == owner.id {
        return Err(Refusal::SameProfile);
    }
    match (viewer.gender, owner.gender) {
        (Some(viewer_gender), Some(owner_gender)) if viewer_gender != owner_gender => {}
        _ => return Err(Refusal::NotOppositeGender),
    }
    if pair.blocked {
        return Err(Refusal::Blocked);
    }
    if owner.user_status != UserStatus::Active || !matches!(owner.status, Active | Paused | Closed)
    {
        return Err(Refusal::OwnerUnavailable);
    }

    // Rows 5 to 7: relation paths, which ignore `discovery_visibility`.
    let viewer_linked = matches!(viewer.status, Active | Paused | Closed);
    if pair.active_connection && viewer_linked {
        return Ok(Tier::Connection);
    }
    let both_engaged =
        matches!(owner.status, Active | Paused) && matches!(viewer.status, Active | Paused);
    match pair.pending_interest {
        Some(InterestDirection::Received) if both_engaged => return Ok(Tier::InterestFromOwner),
        Some(InterestDirection::Sent) if both_engaged => return Ok(Tier::InterestToOwner),
        _ => {}
    }

    // Rows 8 to 12: no relation.
    if viewer.status != Active || owner.status != Active {
        return Err(Refusal::NotActive);
    }
    if !second_marriage_ok(viewer, owner) {
        return Err(Refusal::SecondMarriage);
    }
    match owner.discovery_visibility {
        DiscoveryVisibility::Hidden => Err(Refusal::DiscoveryHidden),
        DiscoveryVisibility::PreferenceMatch if !pair.viewer_fits_owner_must_haves => {
            Err(Refusal::MustHavesNotMet)
        }
        DiscoveryVisibility::Everyone | DiscoveryVisibility::PreferenceMatch => Ok(Tier::Member),
    }
}

/// `can_open` (09 section 2.4): the owner may appear as a card for the viewer and
/// `GET /v1/profiles/{id}` returns the profile.
pub fn can_open(viewer: &ViewerFacts, owner: &OwnerFacts, pair: PairFacts) -> bool {
    relation(viewer, owner, pair).is_ok()
}

/// Whether the owner may appear in the viewer's discovery lists (recommendations, search,
/// `new_members`, `nearby`): only through row 12, tier `member` (09 section 2.3). The extra
/// exclusions of 10 section 3 (passes, cooldowns) are applied by the list queries.
pub fn discoverable(viewer: &ViewerFacts, owner: &OwnerFacts, pair: PairFacts) -> bool {
    relation(viewer, owner, pair) == Ok(Tier::Member)
}

/// The second-marriage rule in both directions (09 section 2.4, 10 section 3.1 rule E9): a
/// `married` side needs the other side to accept `married`.
pub fn second_marriage_ok(viewer: &ViewerFacts, owner: &OwnerFacts) -> bool {
    let married = Some(MaritalStatus::Married);
    let owner_admitted = owner.marital_status != married || viewer.accepts_married;
    let viewer_admitted = viewer.marital_status != married || owner.accepts_married;
    owner_admitted && viewer_admitted
}

/// The relation tier by the evaluation order of 03 section 6 alone: `self`, `connection`,
/// `interest_from_owner`, `interest_to_owner`, `member`. `None` when a block exists, because
/// the owner then does not exist for the viewer.
///
/// This ignores the status rules of 09 section 2.2; use [`relation`] to decide access. Whenever
/// [`relation`] grants access, both give the same tier.
pub fn tier(viewer_id: Uuid, owner_id: Uuid, pair: PairFacts) -> Option<Tier> {
    if viewer_id == owner_id {
        return Some(Tier::SelfTier);
    }
    if pair.blocked {
        return None;
    }
    Some(if pair.active_connection {
        Tier::Connection
    } else {
        match pair.pending_interest {
            Some(InterestDirection::Received) => Tier::InterestFromOwner,
            Some(InterestDirection::Sent) => Tier::InterestToOwner,
            None => Tier::Member,
        }
    })
}

// -------------------------------------------------------------------------------------------
// Section 5: field groups
// -------------------------------------------------------------------------------------------

/// Whether a group with this setting is visible at this tier (09 section 5.1). The owner
/// (`self`) sees everything; the two interest tiers count as `member`.
pub fn group_visible(setting: FieldVisibility, tier: Tier) -> bool {
    match tier {
        Tier::SelfTier => true,
        Tier::Connection => setting != FieldVisibility::Nobody,
        Tier::InterestFromOwner | Tier::InterestToOwner | Tier::Member => {
            setting == FieldVisibility::Members
        }
    }
}

/// Whether values of a group with this setting take part in matching and search (09 section
/// 5.4): only when the setting is `members`. Otherwise they are treated as unknown, for every
/// viewer and at every tier.
pub fn matchable(setting: FieldVisibility) -> bool {
    setting == FieldVisibility::Members
}

/// The setting that controls a group (09 section 5.2). `None` for `full_name` and `photos`,
/// which follow sections 4 and 6.
pub fn group_setting(privacy: &Privacy, group: LockedGroup) -> Option<FieldVisibility> {
    match group {
        LockedGroup::FullName | LockedGroup::Photos => None,
        LockedGroup::Caste => Some(privacy.caste_visibility),
        LockedGroup::Income => Some(privacy.income_visibility),
        LockedGroup::Family => Some(privacy.family_visibility),
        LockedGroup::CareerDetails => Some(privacy.career_details_visibility),
        LockedGroup::Home => Some(privacy.home_visibility),
        LockedGroup::Area => Some(privacy.area_visibility),
        LockedGroup::Health => Some(privacy.health_visibility),
    }
}

/// A moderated text (`about_me`, `about_family`, partner `notes`) as other members receive it:
/// only when approved (09 section 5.3, 03 section 4.5). `about_family` additionally needs the
/// `family` group to be visible.
pub fn moderated_text(text: Option<&str>, status: TextStatus) -> Option<&str> {
    text.filter(|_| status == TextStatus::Approved)
}

/// A set of field groups (09 section 5.2).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GroupSet(u16);

impl GroupSet {
    pub const EMPTY: Self = Self(0);

    pub const fn contains(self, group: LockedGroup) -> bool {
        self.0 & group_bit(group) != 0
    }

    /// This set plus `group`.
    #[must_use]
    pub const fn with(self, group: LockedGroup) -> Self {
        Self(self.0 | group_bit(group))
    }

    /// This set plus `group` when `present` is true.
    #[must_use]
    pub const fn with_if(self, group: LockedGroup, present: bool) -> Self {
        if present { self.with(group) } else { self }
    }

    /// The groups in the order of [`LockedGroup::ALL`].
    pub fn iter(self) -> impl Iterator<Item = LockedGroup> {
        LockedGroup::ALL
            .iter()
            .copied()
            .filter(move |group| self.contains(*group))
    }
}

impl FromIterator<LockedGroup> for GroupSet {
    fn from_iter<I: IntoIterator<Item = LockedGroup>>(groups: I) -> Self {
        groups.into_iter().fold(Self::EMPTY, Self::with)
    }
}

const fn group_bit(group: LockedGroup) -> u16 {
    1 << match group {
        LockedGroup::FullName => 0,
        LockedGroup::Photos => 1,
        LockedGroup::Caste => 2,
        LockedGroup::Income => 3,
        LockedGroup::Family => 4,
        LockedGroup::CareerDetails => 5,
        LockedGroup::Home => 6,
        LockedGroup::Area => 7,
        LockedGroup::Health => 8,
    }
}

/// Facts about the owner's content that the rules of 09 section 5.5 depend on.
#[derive(Debug, Clone, Copy, Default)]
pub struct OwnerContent {
    /// The controlled groups in which the owner has at least one non-null value (rule 3). For
    /// `family`, count `about_family` only when it is approved. `full_name` and `photos` are
    /// ignored here.
    pub filled: GroupSet,
    /// A `profile_family` row exists (rule 4).
    pub has_family_row: bool,
    /// At least one photo is `approved` (`profiles.has_approved_photo`).
    pub has_approved_photo: bool,
}

/// What one viewer receives of one owner's profile at one tier (09 sections 4 to 6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Disclosure {
    pub tier: Tier,
    /// Groups whose values are sent unreduced. For a controlled group not in the set, every
    /// field is `null` (rule 2 of 5.5). Without `full_name` the display name is reduced
    /// (section 4); without `photos` the viewer gets blurred variants (section 6).
    pub visible: GroupSet,
    /// `ProfileDetail.family` is an object rather than `null` (rule 4 of 5.5): the owner has a
    /// `profile_family` row and `family` or `home` is visible.
    pub family_object: bool,
    /// How photos are sent, or `None` when the owner has no approved photo (`photo = null`,
    /// `photos = []`, 09 section 6.2 rule 6).
    pub photos: Option<PhotoMode>,
    /// `ProfileDetail.locked` in the order of [`LockedGroup::ALL`] (rules 3, 5 and 6 of 5.5).
    /// A `ProfileCard` carries no `locked` array.
    pub locked: Vec<LockedGroup>,
}

/// Applies 09 sections 4.1, 5 and 6.1 for one viewer.
///
/// `photo_access` is the status of the `photo_access` row for (owner, viewer), if any. The
/// preview as tier `member` passes `None` (08 section 4.1).
pub fn disclosure(
    privacy: &Privacy,
    tier: Tier,
    content: OwnerContent,
    photo_access: Option<PhotoAccessStatus>,
) -> Disclosure {
    let photos = content
        .has_approved_photo
        .then(|| photo_mode(privacy.photo_visibility, tier, photo_access));
    let visible: GroupSet = LockedGroup::ALL
        .iter()
        .copied()
        .filter(|group| match group {
            LockedGroup::FullName => display::shows_full_name(privacy.name_display, tier),
            LockedGroup::Photos => photos != Some(PhotoMode::Blurred),
            _ => group_setting(privacy, *group).is_some_and(|setting| group_visible(setting, tier)),
        })
        .collect();
    let locked = LockedGroup::ALL
        .iter()
        .copied()
        .filter(|group| !visible.contains(*group))
        .filter(|group| match group {
            // Rules 5 and 6: hidden means a reduced name, or blurred variants of real photos.
            LockedGroup::FullName | LockedGroup::Photos => true,
            // Rule 3: "you would see this after connecting". `nobody` is never listed.
            _ => {
                group_setting(privacy, *group) == Some(FieldVisibility::Connections)
                    && content.filled.contains(*group)
            }
        })
        .collect();
    let family_object = content.has_family_row
        && (visible.contains(LockedGroup::Family) || visible.contains(LockedGroup::Home));
    Disclosure {
        tier,
        visible,
        family_object,
        photos,
        locked,
    }
}

// -------------------------------------------------------------------------------------------
// Section 6: photos
// -------------------------------------------------------------------------------------------

/// Whether a viewer gets the clear or the blurred variants of the owner's photos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhotoMode {
    Clear,
    Blurred,
}

/// `photo_mode` (09 section 6.1). A `granted` `photo_access` row gives clear photos in every
/// mode; the owner always sees their own photos clear.
pub fn photo_mode(
    photo_visibility: PhotoVisibility,
    tier: Tier,
    access: Option<PhotoAccessStatus>,
) -> PhotoMode {
    if tier == Tier::SelfTier || access == Some(PhotoAccessStatus::Granted) {
        return PhotoMode::Clear;
    }
    let clear = match photo_visibility {
        PhotoVisibility::Members => true,
        PhotoVisibility::InterestsAndConnections => {
            matches!(tier, Tier::InterestFromOwner | Tier::Connection)
        }
        PhotoVisibility::Connections => tier == Tier::Connection,
        PhotoVisibility::ApprovedOnly => false,
    };
    if clear {
        PhotoMode::Clear
    } else {
        PhotoMode::Blurred
    }
}

/// The R2 object keys of one approved photo (`profile_photos.key_*`, 04 section 6).
#[derive(Debug, Clone, Copy)]
pub struct PhotoKeys<'a> {
    pub thumb: &'a str,
    pub medium: &'a str,
    pub large: &'a str,
    pub blur_thumb: &'a str,
    pub blur_medium: &'a str,
}

/// The keys to sign for one `PhotoView` (09 section 6.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhotoVariants<'a> {
    pub is_blurred: bool,
    pub thumb: &'a str,
    pub medium: &'a str,
    /// `None` when blurred: `large_url` is then `null`.
    pub large: Option<&'a str>,
}

impl PhotoMode {
    /// Chooses the keys to sign (09 section 6.2). In blurred mode no clear key is ever chosen,
    /// so the blur cannot be removed on the client.
    pub fn variants(self, keys: PhotoKeys<'_>) -> PhotoVariants<'_> {
        match self {
            Self::Clear => PhotoVariants {
                is_blurred: false,
                thumb: keys.thumb,
                medium: keys.medium,
                large: Some(keys.large),
            },
            Self::Blurred => PhotoVariants {
                is_blurred: true,
                thumb: keys.blur_thumb,
                medium: keys.blur_medium,
                large: None,
            },
        }
    }
}

text_enum! {
    /// `Relation.photo_access` (09 section 6.4, 15 section 4.6).
    RelationPhotoAccess {
        Visible = "visible",
        CanRequest = "can_request",
        Requested = "requested",
        Denied = "denied",
        RequestsOff = "requests_off",
    }
}

/// Default of the `photo_access.retry_days` setting (03 section 7).
pub const PHOTO_ACCESS_RETRY_DAYS: i64 = 30;

/// The `photo_access` row for (owner, viewer).
#[derive(Debug, Clone, Copy)]
pub struct PhotoAccessRow {
    pub status: PhotoAccessStatus,
    pub updated_at: OffsetDateTime,
}

/// `photo_access_state` (09 section 6.4), rows evaluated top to bottom.
///
/// `photos` is [`Disclosure::photos`]: `None` when the owner has no approved photo.
/// `retry_days` is the `photo_access.retry_days` setting.
pub fn photo_access_state(
    photos: Option<PhotoMode>,
    allow_photo_requests: bool,
    row: Option<PhotoAccessRow>,
    retry_days: i64,
    now: OffsetDateTime,
) -> RelationPhotoAccess {
    if photos != Some(PhotoMode::Blurred) {
        return RelationPhotoAccess::Visible;
    }
    if row.is_some_and(|row| row.status == PhotoAccessStatus::Pending) {
        return RelationPhotoAccess::Requested;
    }
    if !allow_photo_requests {
        return RelationPhotoAccess::RequestsOff;
    }
    let waiting = row.is_some_and(|row| {
        matches!(
            row.status,
            PhotoAccessStatus::Denied | PhotoAccessStatus::Revoked
        ) && now < row.updated_at + Duration::days(retry_days)
    });
    if waiting {
        RelationPhotoAccess::Denied
    } else {
        RelationPhotoAccess::CanRequest
    }
}

// -------------------------------------------------------------------------------------------
// Section 7: who may send an interest
// -------------------------------------------------------------------------------------------

text_enum! {
    /// `Relation.cannot_send_reason` (09 section 7.2, 15 section 4.6).
    CannotSendReason {
        AlreadyPending = "already_pending",
        AlreadyConnected = "already_connected",
        Cooldown = "cooldown",
        DailyLimit = "daily_limit",
        PendingLimit = "pending_limit",
        ConnectionLimit = "connection_limit",
        NotPermittedByMember = "not_permitted_by_member",
        OwnProfileNotActive = "own_profile_not_active",
    }
}

text_enum! {
    /// `Relation.cannot_send_detail`, and `details.reason` of `409 not_permitted_by_member`
    /// (09 section 7).
    CannotSendDetail { VerifiedOnly = "verified_only", PreferenceMatch = "preference_match" }
}

/// The sender of an interest, as far as the receiver's `interest_permission` needs it.
#[derive(Debug, Clone, Copy, Default)]
pub struct SenderFacts {
    pub is_id_verified: bool,
    pub is_photo_verified: bool,
    /// `passes_must_haves(R.preferences, S)` (10 section 3.2), computed by the caller. True when
    /// the receiver has no must-have dimension.
    pub fits_receiver_must_haves: bool,
}

impl SenderFacts {
    /// Verified for interests: a verified ID or a verified photo (03 section 7).
    pub fn is_verified(self) -> bool {
        self.is_id_verified || self.is_photo_verified
    }
}

/// The receiver's `interest_permission` (09 section 7.1): check 5 of `POST /v1/interests`.
///
/// `receiver_has_pending_to_sender` is the mutual interest bypass: when the receiver already
/// has a pending interest to the sender, the check is skipped.
pub fn interest_permitted(
    permission: InterestPermission,
    sender: SenderFacts,
    receiver_has_pending_to_sender: bool,
) -> Result<(), CannotSendDetail> {
    if receiver_has_pending_to_sender {
        return Ok(());
    }
    match permission {
        InterestPermission::Everyone => Ok(()),
        InterestPermission::VerifiedOnly if sender.is_verified() => Ok(()),
        InterestPermission::VerifiedOnly => Err(CannotSendDetail::VerifiedOnly),
        InterestPermission::PreferenceMatch if sender.fits_receiver_must_haves => Ok(()),
        InterestPermission::PreferenceMatch => Err(CannotSendDetail::PreferenceMatch),
    }
}

/// The settings behind interest limits and cooldowns (03 section 7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InterestSettings {
    /// `limits.pending_interests_max`.
    pub pending_interests_max: i64,
    /// `limits.active_connections_max`.
    pub active_connections_max: i64,
    /// `limits.interests_per_day`.
    pub interests_per_day: i64,
    /// `limits.interests_per_day_verified`.
    pub interests_per_day_verified: i64,
    /// `interest.cooldown_after_decline_days`.
    pub cooldown_after_decline_days: i64,
    /// `interest.cooldown_after_expiry_days`.
    pub cooldown_after_expiry_days: i64,
    /// `interest.cooldown_after_withdraw_days`.
    pub cooldown_after_withdraw_days: i64,
    /// `connection.cooldown_after_end_days`.
    pub connection_cooldown_after_end_days: i64,
}

impl Default for InterestSettings {
    /// The defaults of 03 section 7.
    fn default() -> Self {
        Self {
            pending_interests_max: 50,
            active_connections_max: 30,
            interests_per_day: 10,
            interests_per_day_verified: 20,
            cooldown_after_decline_days: 90,
            cooldown_after_expiry_days: 30,
            cooldown_after_withdraw_days: 7,
            connection_cooldown_after_end_days: 90,
        }
    }
}

/// The viewer's latest interest to the owner that is no longer pending.
#[derive(Debug, Clone, Copy)]
pub struct ClosedInterest {
    pub status: InterestStatus,
    pub responded_at: Option<OffsetDateTime>,
    pub expires_at: OffsetDateTime,
}

/// Whether the viewer's own interest was declined but must still look pending to them: before
/// `expires_at` the sender is never told of a decline (11 section 3.5).
pub fn decline_shown_as_pending(latest_sent: Option<&ClosedInterest>, now: OffsetDateTime) -> bool {
    latest_sent.is_some_and(|interest| {
        interest.status == InterestStatus::Declined && now < interest.expires_at
    })
}

/// When the viewer may send the owner an interest again, if a cooldown applies now (03
/// sections 4.7 and 4.8, 11 section 4).
///
/// The interest cooldowns bind only the sender, so `latest_sent` is the viewer's latest closed
/// interest to the owner. An ended connection binds both members.
pub fn interest_cooldown_end(
    latest_sent: Option<&ClosedInterest>,
    connection_ended_at: Option<OffsetDateTime>,
    settings: &InterestSettings,
    now: OffsetDateTime,
) -> Option<OffsetDateTime> {
    let after_interest = latest_sent.and_then(|interest| match interest.status {
        InterestStatus::Declined => interest
            .responded_at
            .map(|at| at + Duration::days(settings.cooldown_after_decline_days)),
        InterestStatus::Expired => {
            Some(interest.expires_at + Duration::days(settings.cooldown_after_expiry_days))
        }
        InterestStatus::Withdrawn => interest
            .responded_at
            .map(|at| at + Duration::days(settings.cooldown_after_withdraw_days)),
        InterestStatus::Pending | InterestStatus::Accepted => None,
    });
    let after_connection = connection_ended_at
        .map(|at| at + Duration::days(settings.connection_cooldown_after_end_days));
    after_interest
        .into_iter()
        .chain(after_connection)
        .filter(|end| *end > now)
        .max()
}

/// The viewer's current interest counts.
#[derive(Debug, Clone, Copy, Default)]
pub struct InterestUsage {
    /// Sent interests with `status = 'pending'`.
    pub pending_sent: i64,
    /// Active connections.
    pub active_connections: i64,
    /// The `interests_sent` counter for today in `Asia/Karachi`.
    pub sent_today: i64,
}

/// Everything 09 section 7.2 needs about the viewer and the pair.
#[derive(Debug, Clone, Copy)]
pub struct InterestFacts {
    pub viewer_status: ProfileStatus,
    /// The viewer as a sender, judged against the owner's preferences.
    pub viewer: SenderFacts,
    /// The owner's `interest_permission`.
    pub owner_permission: InterestPermission,
    pub active_connection: bool,
    /// The real pending interest between the pair, if any.
    pub pending_interest: Option<InterestDirection>,
    /// The viewer's latest closed interest to the owner.
    pub latest_sent: Option<ClosedInterest>,
    /// `ended_at` of the latest ended connection between the pair.
    pub connection_ended_at: Option<OffsetDateTime>,
    pub usage: InterestUsage,
}

/// Why the viewer cannot send the owner an interest (09 section 7.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CannotSend {
    OwnProfileNotActive,
    AlreadyConnected,
    /// A pending interest in either direction. With `received`, the client offers Accept and
    /// Decline instead of Send.
    AlreadyPending,
    /// `until` is `can_send_interest_after`: the date in `Asia/Karachi` on which it ends.
    Cooldown {
        until: Date,
    },
    NotPermittedByMember(CannotSendDetail),
    PendingLimit,
    ConnectionLimit,
    DailyLimit,
}

impl CannotSend {
    /// `Relation.cannot_send_reason`.
    pub fn reason(self) -> CannotSendReason {
        match self {
            Self::OwnProfileNotActive => CannotSendReason::OwnProfileNotActive,
            Self::AlreadyConnected => CannotSendReason::AlreadyConnected,
            Self::AlreadyPending => CannotSendReason::AlreadyPending,
            Self::Cooldown { .. } => CannotSendReason::Cooldown,
            Self::NotPermittedByMember(_) => CannotSendReason::NotPermittedByMember,
            Self::PendingLimit => CannotSendReason::PendingLimit,
            Self::ConnectionLimit => CannotSendReason::ConnectionLimit,
            Self::DailyLimit => CannotSendReason::DailyLimit,
        }
    }

    /// `Relation.cannot_send_detail`: set only with `not_permitted_by_member`.
    pub fn detail(self) -> Option<CannotSendDetail> {
        match self {
            Self::NotPermittedByMember(detail) => Some(detail),
            _ => None,
        }
    }

    /// `Relation.can_send_interest_after`: set only with `cooldown`.
    pub fn send_after(self) -> Option<Date> {
        match self {
            Self::Cooldown { until } => Some(until),
            _ => None,
        }
    }
}

/// `can_send_interest` (09 section 7.2): the rows in order, the first failing row decides.
/// `Ok` means `can_send_interest = true` and every `cannot_send_*` field is `null`.
pub fn can_send_interest(
    facts: &InterestFacts,
    settings: &InterestSettings,
    now: OffsetDateTime,
) -> Result<(), CannotSend> {
    if facts.viewer_status != ProfileStatus::Active {
        return Err(CannotSend::OwnProfileNotActive);
    }
    if facts.active_connection {
        return Err(CannotSend::AlreadyConnected);
    }
    if facts.pending_interest.is_some() || decline_shown_as_pending(facts.latest_sent.as_ref(), now)
    {
        return Err(CannotSend::AlreadyPending);
    }
    if let Some(end) = interest_cooldown_end(
        facts.latest_sent.as_ref(),
        facts.connection_ended_at,
        settings,
        now,
    ) {
        return Err(CannotSend::Cooldown {
            until: karachi_date(end),
        });
    }
    let receiver_has_pending = facts.pending_interest == Some(InterestDirection::Received);
    interest_permitted(facts.owner_permission, facts.viewer, receiver_has_pending)
        .map_err(CannotSend::NotPermittedByMember)?;
    if facts.usage.pending_sent >= settings.pending_interests_max {
        return Err(CannotSend::PendingLimit);
    }
    if facts.usage.active_connections >= settings.active_connections_max {
        return Err(CannotSend::ConnectionLimit);
    }
    let daily_limit = if facts.viewer.is_verified() {
        settings.interests_per_day_verified
    } else {
        settings.interests_per_day
    };
    if facts.usage.sent_today >= daily_limit {
        return Err(CannotSend::DailyLimit);
    }
    Ok(())
}

// -------------------------------------------------------------------------------------------
// Section 8: profile views and private browsing
// -------------------------------------------------------------------------------------------

/// A repeat open counts as another view only after this long (09 section 8.1 step 4).
pub const REPEAT_VIEW_AFTER: Duration = Duration::minutes(30);

/// Default of the `limits.profile_views_per_day` setting (03 section 7).
pub const PROFILE_VIEWS_PER_DAY: i64 = 150;

/// The facts of one profile open that 09 section 8.1 needs.
#[derive(Debug, Clone, Copy)]
pub struct ViewFacts {
    pub tier: Tier,
    /// The viewer's `record_my_visits`.
    pub viewer_records_visits: bool,
    /// `last_viewed_at` of the `profile_views` row for (viewer, owner, today in
    /// `Asia/Karachi`), when that row exists.
    pub last_viewed_today_at: Option<OffsetDateTime>,
    /// The viewer's `profiles_viewed` counter for today.
    pub profiles_viewed_today: i64,
    /// `limits.profile_views_per_day`.
    pub profile_views_per_day: i64,
}

/// What to do with `profile_views` when a profile is opened (09 section 8.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewRecord {
    /// Tier `connection` (or the owner): no row, no counter change.
    Skip,
    /// A new distinct view would pass the daily limit: answer `429 limit_reached` and send no
    /// profile data.
    LimitReached,
    /// Insert today's row with `view_count = 1` and increase the `profiles_viewed` counter.
    Insert { is_private: bool },
    /// Update today's row: `last_viewed_at = now()`, `is_private`, and `view_count + 1` only
    /// when `count_again`. The counter does not change.
    Update { is_private: bool, count_again: bool },
}

/// Decides how a successful `GET /v1/profiles/{profile_id}` is recorded (09 section 8.1).
/// Opening a profile already viewed today never counts against the limit.
pub fn record_view(facts: &ViewFacts, now: OffsetDateTime) -> ViewRecord {
    if matches!(facts.tier, Tier::Connection | Tier::SelfTier) {
        return ViewRecord::Skip;
    }
    let is_private = !facts.viewer_records_visits;
    match facts.last_viewed_today_at {
        Some(last) => ViewRecord::Update {
            is_private,
            count_again: now - last > REPEAT_VIEW_AFTER,
        },
        None if facts.profiles_viewed_today >= facts.profile_views_per_day => {
            ViewRecord::LimitReached
        }
        None => ViewRecord::Insert { is_private },
    }
}

/// Reciprocity of private browsing (09 section 8.2 rule 3): a member who does not record their
/// visits gets an empty visitors list with `hidden_because_private = true`, and
/// `visitors_count_7d = 0`.
pub fn visitors_hidden(viewer: &Privacy) -> bool {
    !viewer.record_my_visits
}

// -------------------------------------------------------------------------------------------
// Section 9: last active, online status, read receipts
// -------------------------------------------------------------------------------------------

/// The activity values sent to a viewer about an owner (09 section 9).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Activity {
    /// `last_active` on cards and detail: `null` unless both show last active.
    pub last_active: Option<LastActive>,
    /// `ProfileDetail.is_online`: `null` unless both show last active and both show online
    /// status.
    pub is_online: Option<bool>,
}

/// The `last_active` label and `is_online` for a viewer (09 section 9). Each signal is shared
/// only when both sides share it.
///
/// `owner_online` is [`display::is_online`]. When the owner is online but online status is not
/// shared, the label falls back to `today`.
pub fn activity(
    owner: &Privacy,
    viewer: &Privacy,
    owner_online: bool,
    last_active_at: Option<OffsetDateTime>,
    now: OffsetDateTime,
) -> Activity {
    if !(owner.show_last_active && viewer.show_last_active) {
        return Activity {
            last_active: None,
            is_online: None,
        };
    }
    let online_shared = owner.show_online_status && viewer.show_online_status;
    let last_active = if owner_online && !online_shared {
        LastActive::Today
    } else {
        display::last_active_label(owner_online, last_active_at, now)
    };
    Activity {
        last_active: Some(last_active),
        is_online: online_shared.then_some(owner_online),
    }
}

/// WebSocket `presence` events between two members (09 section 9, 19 section 5): only between
/// connected members who both show their online status.
pub fn presence_shared(connected: bool, one: &Privacy, other: &Privacy) -> bool {
    connected && one.show_online_status && other.show_online_status
}

/// `Connection.their_last_read_message_id` and WebSocket `message.read`: only when both
/// members send read receipts (09 section 9). Unread counters never depend on this.
pub fn read_receipts_shared(one: &Privacy, other: &Privacy) -> bool {
    one.send_read_receipts && other.send_read_receipts
}

/// `Interest.seen` as shown to the sender: always `false` unless both send read receipts
/// (09 section 9). The receiver always sees their own state.
pub fn interest_seen_for_sender(seen: bool, sender: &Privacy, receiver: &Privacy) -> bool {
    seen && read_receipts_shared(sender, receiver)
}

// -------------------------------------------------------------------------------------------
// Section 10: contact details
// -------------------------------------------------------------------------------------------

/// Whether an owner's contact details may reach the other member of a connection (09 section
/// 10, invariant 4 of 03 section 8): only through an `active` contact share on an `active`
/// connection. `share_status` is the owner's `contact_shares` row for that connection.
///
/// When true, `Connection.their_contact` carries only the selected items plus
/// `preferred_contact` and `best_time_to_call`; otherwise it is `null`.
pub fn contact_visible(connection_active: bool, share_status: Option<ContactShareStatus>) -> bool {
    connection_active && share_status == Some(ContactShareStatus::Active)
}

#[cfg(test)]
mod tests {
    use time::macros::{date, datetime};

    use super::*;
    use crate::domain::options::NameDisplay;
    use crate::domain::preference_defaults::{DefaultsInput, default_preferences};

    const NOW: OffsetDateTime = datetime!(2026-11-20 10:00 UTC);
    const VIEWER_ID: Uuid = Uuid::from_u128(1);
    const OWNER_ID: Uuid = Uuid::from_u128(2);

    // Section 13.2 defaults: both `active`, unblocked, unrelated, default privacy.

    fn man() -> ViewerFacts {
        ViewerFacts {
            id: VIEWER_ID,
            gender: Some(Gender::Male),
            status: ProfileStatus::Active,
            marital_status: Some(MaritalStatus::NeverMarried),
            accepts_married: false,
        }
    }

    fn woman() -> OwnerFacts {
        OwnerFacts {
            id: OWNER_ID,
            gender: Some(Gender::Female),
            status: ProfileStatus::Active,
            user_status: UserStatus::Active,
            marital_status: Some(MaritalStatus::NeverMarried),
            accepts_married: false,
            discovery_visibility: DiscoveryVisibility::Everyone,
        }
    }

    fn unrelated() -> PairFacts {
        PairFacts::default()
    }

    fn opens(owner: &OwnerFacts, pair: PairFacts) -> Result<Tier, Refusal> {
        relation(&man(), owner, pair)
    }

    fn content(filled: &[LockedGroup]) -> OwnerContent {
        OwnerContent {
            filled: filled.iter().copied().collect(),
            has_family_row: true,
            has_approved_photo: true,
        }
    }

    fn privacy_with(change: impl FnOnce(&mut Privacy)) -> Privacy {
        let mut privacy = Privacy::default();
        change(&mut privacy);
        privacy
    }

    fn ayesha_khan() -> display::NameParts<'static> {
        display::NameParts {
            first_name: "Ayesha",
            last_name: "Khan",
            public_code: "KR7F3K2QX9",
        }
    }

    fn access_row(status: PhotoAccessStatus, days_ago: i64) -> PhotoAccessRow {
        PhotoAccessRow {
            status,
            updated_at: NOW - Duration::days(days_ago),
        }
    }

    fn interest_facts() -> InterestFacts {
        InterestFacts {
            viewer_status: ProfileStatus::Active,
            viewer: SenderFacts {
                fits_receiver_must_haves: true,
                ..SenderFacts::default()
            },
            owner_permission: InterestPermission::Everyone,
            active_connection: false,
            pending_interest: None,
            latest_sent: None,
            connection_ended_at: None,
            usage: InterestUsage::default(),
        }
    }

    fn view(tier: Tier, records: bool, last: Option<OffsetDateTime>, today: i64) -> ViewFacts {
        ViewFacts {
            tier,
            viewer_records_visits: records,
            last_viewed_today_at: last,
            profiles_viewed_today: today,
            profile_views_per_day: PROFILE_VIEWS_PER_DAY,
        }
    }

    // ---- 09 section 13.2, one test per row ------------------------------------------------

    #[test]
    fn case_01_man_views_man() {
        let other_man = OwnerFacts {
            gender: Some(Gender::Male),
            ..woman()
        };
        assert_eq!(
            opens(&other_man, unrelated()),
            Err(Refusal::NotOppositeGender)
        );
    }

    #[test]
    fn case_02_man_views_woman_with_defaults() {
        assert_eq!(opens(&woman(), unrelated()), Ok(Tier::Member));
    }

    #[test]
    fn case_03_woman_blocked_man() {
        let pair = PairFacts {
            blocked: true,
            ..unrelated()
        };
        assert_eq!(opens(&woman(), pair), Err(Refusal::Blocked));
    }

    #[test]
    fn case_04_man_blocked_woman() {
        // The block is checked in either direction; the viewer's own block hides her too.
        let pair = PairFacts {
            blocked: true,
            active_connection: true,
            ..unrelated()
        };
        assert_eq!(opens(&woman(), pair), Err(Refusal::Blocked));
        assert_eq!(tier(VIEWER_ID, OWNER_ID, pair), None);
    }

    #[test]
    fn case_05_paused_without_relation() {
        let paused = OwnerFacts {
            status: ProfileStatus::Paused,
            ..woman()
        };
        assert_eq!(opens(&paused, unrelated()), Err(Refusal::NotActive));
    }

    #[test]
    fn case_06_paused_with_active_connection() {
        let paused = OwnerFacts {
            status: ProfileStatus::Paused,
            ..woman()
        };
        let pair = PairFacts {
            active_connection: true,
            ..unrelated()
        };
        assert_eq!(opens(&paused, pair), Ok(Tier::Connection));
    }

    #[test]
    fn case_07_closed_with_active_connection() {
        let closed = OwnerFacts {
            status: ProfileStatus::Closed,
            ..woman()
        };
        let pair = PairFacts {
            active_connection: true,
            ..unrelated()
        };
        assert_eq!(opens(&closed, pair), Ok(Tier::Connection));
    }

    #[test]
    fn case_08_closed_with_stale_pending_interest() {
        let closed = OwnerFacts {
            status: ProfileStatus::Closed,
            ..woman()
        };
        let pair = PairFacts {
            pending_interest: Some(InterestDirection::Sent),
            ..unrelated()
        };
        assert_eq!(opens(&closed, pair), Err(Refusal::NotActive));
    }

    #[test]
    fn case_09_hidden_without_relation() {
        let hidden = OwnerFacts {
            discovery_visibility: DiscoveryVisibility::Hidden,
            ..woman()
        };
        assert_eq!(opens(&hidden, unrelated()), Err(Refusal::DiscoveryHidden));
    }

    #[test]
    fn case_10_hidden_owner_sent_the_viewer_an_interest() {
        let hidden = OwnerFacts {
            discovery_visibility: DiscoveryVisibility::Hidden,
            ..woman()
        };
        let pair = PairFacts {
            pending_interest: Some(InterestDirection::Received),
            ..unrelated()
        };
        assert_eq!(opens(&hidden, pair), Ok(Tier::InterestFromOwner));
    }

    #[test]
    fn case_11_hidden_owner_received_the_viewers_interest() {
        let hidden = OwnerFacts {
            discovery_visibility: DiscoveryVisibility::Hidden,
            ..woman()
        };
        let pair = PairFacts {
            pending_interest: Some(InterestDirection::Sent),
            ..unrelated()
        };
        assert_eq!(opens(&hidden, pair), Ok(Tier::InterestToOwner));
    }

    #[test]
    fn case_12_preference_match_viewer_fails_religion_must_have() {
        let selective = OwnerFacts {
            discovery_visibility: DiscoveryVisibility::PreferenceMatch,
            ..woman()
        };
        let pair = PairFacts {
            viewer_fits_owner_must_haves: false,
            ..unrelated()
        };
        assert_eq!(opens(&selective, pair), Err(Refusal::MustHavesNotMet));
    }

    #[test]
    fn case_13_preference_match_viewer_passes_every_must_have() {
        let selective = OwnerFacts {
            discovery_visibility: DiscoveryVisibility::PreferenceMatch,
            ..woman()
        };
        let pair = PairFacts {
            viewer_fits_owner_must_haves: true,
            ..unrelated()
        };
        assert_eq!(opens(&selective, pair), Ok(Tier::Member));
    }

    #[test]
    fn case_14_preference_match_without_must_haves() {
        // `passes_must_haves` is true when the owner has no must-have dimension (10 section 3.2).
        let selective = OwnerFacts {
            discovery_visibility: DiscoveryVisibility::PreferenceMatch,
            ..woman()
        };
        let pair = PairFacts {
            viewer_fits_owner_must_haves: true,
            ..unrelated()
        };
        assert_eq!(opens(&selective, pair), Ok(Tier::Member));
    }

    #[test]
    fn case_15_married_man_and_empty_marital_statuses() {
        let mut prefs = default_preferences(&DefaultsInput::default());
        prefs.marital_statuses = Vec::new();
        let married = ViewerFacts {
            marital_status: Some(MaritalStatus::Married),
            ..man()
        };
        let owner = OwnerFacts {
            accepts_married: accepts_married(Some(&prefs)),
            ..woman()
        };
        assert_eq!(
            relation(&married, &owner, unrelated()),
            Err(Refusal::SecondMarriage)
        );
    }

    #[test]
    fn case_16_married_man_and_marital_statuses_with_married() {
        let mut prefs = default_preferences(&DefaultsInput::default());
        prefs.marital_statuses = vec![MaritalStatus::NeverMarried, MaritalStatus::Married];
        let married = ViewerFacts {
            marital_status: Some(MaritalStatus::Married),
            ..man()
        };
        let owner = OwnerFacts {
            accepts_married: accepts_married(Some(&prefs)),
            ..woman()
        };
        assert_eq!(relation(&married, &owner, unrelated()), Ok(Tier::Member));
    }

    #[test]
    fn case_17_owner_account_suspended() {
        let suspended = OwnerFacts {
            user_status: UserStatus::Suspended,
            ..woman()
        };
        assert_eq!(
            opens(&suspended, unrelated()),
            Err(Refusal::OwnerUnavailable)
        );
    }

    #[test]
    fn case_18_man_pending_review() {
        let in_review = ViewerFacts {
            status: ProfileStatus::PendingReview,
            ..man()
        };
        assert_eq!(
            relation(&in_review, &woman(), unrelated()),
            Err(Refusal::NotActive)
        );
        // Nor can anyone open his profile.
        let her = ViewerFacts {
            id: OWNER_ID,
            gender: Some(Gender::Female),
            ..man()
        };
        let him = OwnerFacts {
            id: VIEWER_ID,
            gender: Some(Gender::Male),
            status: ProfileStatus::PendingReview,
            ..woman()
        };
        assert_eq!(
            relation(&her, &him, unrelated()),
            Err(Refusal::OwnerUnavailable)
        );
    }

    #[test]
    fn case_19_first_name_last_initial_for_a_member() {
        let privacy = Privacy::default();
        assert_eq!(privacy.name_display, NameDisplay::FirstNameLastInitial);
        assert_eq!(
            display::display_name(ayesha_khan(), privacy.name_display, Tier::Member),
            "Ayesha K."
        );
        let shown = disclosure(&privacy, Tier::Member, content(&[]), None);
        assert!(shown.locked.contains(&LockedGroup::FullName));
    }

    #[test]
    fn case_20_first_name_last_initial_for_a_connection() {
        let privacy = Privacy::default();
        assert_eq!(
            display::display_name(ayesha_khan(), privacy.name_display, Tier::Connection),
            "Ayesha Khan"
        );
        let shown = disclosure(&privacy, Tier::Connection, content(&[]), None);
        assert!(!shown.locked.contains(&LockedGroup::FullName));
    }

    #[test]
    fn case_21_initials() {
        let name = display::NameParts {
            first_name: "Muhammad Ali",
            last_name: "Raza",
            public_code: "KR2M8PQ4TZ",
        };
        assert_eq!(
            display::display_name(name, NameDisplay::Initials, Tier::Member),
            "M. R."
        );
    }

    #[test]
    fn case_22_code_only_for_interest_from_owner() {
        assert_eq!(
            display::display_name(
                ayesha_khan(),
                NameDisplay::CodeOnly,
                Tier::InterestFromOwner
            ),
            "KR7F3K2QX9"
        );
    }

    #[test]
    fn case_23_caste_for_connections_with_caste_set() {
        let privacy = privacy_with(|p| p.caste_visibility = FieldVisibility::Connections);
        let shown = disclosure(&privacy, Tier::Member, content(&[LockedGroup::Caste]), None);
        assert!(!shown.visible.contains(LockedGroup::Caste));
        assert!(shown.locked.contains(&LockedGroup::Caste));
    }

    #[test]
    fn case_24_caste_for_connections_without_caste() {
        let privacy = privacy_with(|p| p.caste_visibility = FieldVisibility::Connections);
        let shown = disclosure(&privacy, Tier::Member, content(&[]), None);
        assert!(!shown.visible.contains(LockedGroup::Caste));
        assert!(!shown.locked.contains(&LockedGroup::Caste));
    }

    #[test]
    fn case_25_caste_for_nobody_seen_by_a_connection() {
        let privacy = privacy_with(|p| p.caste_visibility = FieldVisibility::Nobody);
        let shown = disclosure(
            &privacy,
            Tier::Connection,
            content(&[LockedGroup::Caste]),
            None,
        );
        assert!(!shown.visible.contains(LockedGroup::Caste));
        assert!(!shown.locked.contains(&LockedGroup::Caste));
    }

    #[test]
    fn case_26_income_for_connections_seen_by_a_connection() {
        let privacy = Privacy::default();
        assert_eq!(privacy.income_visibility, FieldVisibility::Connections);
        let shown = disclosure(
            &privacy,
            Tier::Connection,
            content(&[LockedGroup::Income]),
            None,
        );
        assert!(shown.visible.contains(LockedGroup::Income));
        assert!(!shown.locked.contains(&LockedGroup::Income));
    }

    #[test]
    fn case_27_family_for_nobody_home_for_members() {
        let privacy = privacy_with(|p| {
            p.family_visibility = FieldVisibility::Nobody;
            p.home_visibility = FieldVisibility::Members;
        });
        let shown = disclosure(
            &privacy,
            Tier::Member,
            content(&[LockedGroup::Family, LockedGroup::Home]),
            None,
        );
        assert!(shown.family_object);
        assert!(!shown.visible.contains(LockedGroup::Family));
        assert!(shown.visible.contains(LockedGroup::Home));
        assert!(!shown.locked.contains(&LockedGroup::Family));
    }

    #[test]
    fn case_28_family_and_home_for_connections() {
        let privacy = privacy_with(|p| {
            p.family_visibility = FieldVisibility::Connections;
            p.home_visibility = FieldVisibility::Connections;
        });
        let shown = disclosure(
            &privacy,
            Tier::Member,
            content(&[LockedGroup::Family, LockedGroup::Home]),
            None,
        );
        assert!(!shown.family_object);
        assert!(shown.locked.contains(&LockedGroup::Family));
        assert!(shown.locked.contains(&LockedGroup::Home));
    }

    #[test]
    fn case_29_about_me_pending() {
        let about_me = Some("Assalam-o-Alaikum. I teach mathematics at a college in Multan.");
        // The rule depends only on the status, so no other viewer receives the text.
        assert_eq!(moderated_text(about_me, TextStatus::Pending), None);
        assert_eq!(moderated_text(about_me, TextStatus::Rejected), None);
        assert_eq!(moderated_text(about_me, TextStatus::Approved), about_me);
    }

    #[test]
    fn case_30_interests_and_connections_seen_by_a_member() {
        let privacy = privacy_with(|p| {
            p.photo_visibility = PhotoVisibility::InterestsAndConnections;
        });
        let shown = disclosure(&privacy, Tier::Member, content(&[]), None);
        assert_eq!(shown.photos, Some(PhotoMode::Blurred));
        let keys = PhotoKeys {
            thumb: "t",
            medium: "m",
            large: "l",
            blur_thumb: "bt",
            blur_medium: "bm",
        };
        let variants = PhotoMode::Blurred.variants(keys);
        assert!(variants.is_blurred);
        assert_eq!(variants.large, None);
        assert_eq!((variants.thumb, variants.medium), ("bt", "bm"));
        assert!(shown.locked.contains(&LockedGroup::Photos));
    }

    #[test]
    fn case_31_interests_and_connections_seen_by_interest_from_owner() {
        assert_eq!(
            photo_mode(
                PhotoVisibility::InterestsAndConnections,
                Tier::InterestFromOwner,
                None
            ),
            PhotoMode::Clear
        );
    }

    #[test]
    fn case_32_interests_and_connections_seen_by_interest_to_owner() {
        assert_eq!(
            photo_mode(
                PhotoVisibility::InterestsAndConnections,
                Tier::InterestToOwner,
                None
            ),
            PhotoMode::Blurred
        );
    }

    #[test]
    fn case_33_approved_only_connection_without_grant() {
        assert_eq!(
            photo_mode(PhotoVisibility::ApprovedOnly, Tier::Connection, None),
            PhotoMode::Blurred
        );
    }

    #[test]
    fn case_34_approved_only_member_with_grant() {
        assert_eq!(
            photo_mode(
                PhotoVisibility::ApprovedOnly,
                Tier::Member,
                Some(PhotoAccessStatus::Granted)
            ),
            PhotoMode::Clear
        );
    }

    #[test]
    fn case_35_connections_only_with_pending_request() {
        let row = Some(access_row(PhotoAccessStatus::Pending, 1));
        let mode = photo_mode(
            PhotoVisibility::Connections,
            Tier::Member,
            row.map(|row| row.status),
        );
        assert_eq!(
            photo_access_state(Some(mode), true, row, PHOTO_ACCESS_RETRY_DAYS, NOW),
            RelationPhotoAccess::Requested
        );
    }

    #[test]
    fn case_36_blurred_with_requests_off() {
        assert_eq!(
            photo_access_state(
                Some(PhotoMode::Blurred),
                false,
                None,
                PHOTO_ACCESS_RETRY_DAYS,
                NOW
            ),
            RelationPhotoAccess::RequestsOff
        );
    }

    #[test]
    fn case_37_blurred_denied_10_days_ago() {
        assert_eq!(
            photo_access_state(
                Some(PhotoMode::Blurred),
                true,
                Some(access_row(PhotoAccessStatus::Denied, 10)),
                PHOTO_ACCESS_RETRY_DAYS,
                NOW
            ),
            RelationPhotoAccess::Denied
        );
    }

    #[test]
    fn case_38_blurred_denied_31_days_ago() {
        assert_eq!(
            photo_access_state(
                Some(PhotoMode::Blurred),
                true,
                Some(access_row(PhotoAccessStatus::Denied, 31)),
                PHOTO_ACCESS_RETRY_DAYS,
                NOW
            ),
            RelationPhotoAccess::CanRequest
        );
    }

    #[test]
    fn case_39_no_approved_photos() {
        let privacy = privacy_with(|p| p.photo_visibility = PhotoVisibility::ApprovedOnly);
        let no_photos = OwnerContent {
            has_approved_photo: false,
            ..content(&[])
        };
        let shown = disclosure(&privacy, Tier::Member, no_photos, None);
        assert_eq!(shown.photos, None);
        assert!(!shown.locked.contains(&LockedGroup::Photos));
        assert_eq!(
            photo_access_state(shown.photos, true, None, PHOTO_ACCESS_RETRY_DAYS, NOW),
            RelationPhotoAccess::Visible
        );
    }

    #[test]
    fn case_40_verified_only_and_an_unverified_sender() {
        let facts = InterestFacts {
            owner_permission: InterestPermission::VerifiedOnly,
            ..interest_facts()
        };
        let refusal = can_send_interest(&facts, &InterestSettings::default(), NOW).unwrap_err();
        assert_eq!(refusal.reason(), CannotSendReason::NotPermittedByMember);
        assert_eq!(refusal.detail(), Some(CannotSendDetail::VerifiedOnly));
        assert_eq!(
            interest_permitted(
                InterestPermission::VerifiedOnly,
                SenderFacts::default(),
                false
            ),
            Err(CannotSendDetail::VerifiedOnly)
        );
    }

    #[test]
    fn case_41_verified_only_and_a_photo_verified_sender() {
        let sender = SenderFacts {
            is_photo_verified: true,
            ..SenderFacts::default()
        };
        assert_eq!(
            interest_permitted(InterestPermission::VerifiedOnly, sender, false),
            Ok(())
        );
        let facts = InterestFacts {
            owner_permission: InterestPermission::VerifiedOnly,
            viewer: sender,
            ..interest_facts()
        };
        assert_eq!(
            can_send_interest(&facts, &InterestSettings::default(), NOW),
            Ok(())
        );
    }

    #[test]
    fn case_42_preference_match_bypassed_by_mutual_interest() {
        let failing = SenderFacts {
            fits_receiver_must_haves: false,
            ..SenderFacts::default()
        };
        assert_eq!(
            interest_permitted(InterestPermission::PreferenceMatch, failing, true),
            Ok(())
        );
        assert_eq!(
            interest_permitted(InterestPermission::PreferenceMatch, failing, false),
            Err(CannotSendDetail::PreferenceMatch)
        );
    }

    #[test]
    fn case_43_viewer_hides_last_active() {
        let viewer = privacy_with(|p| p.show_last_active = false);
        let shown = activity(
            &Privacy::default(),
            &viewer,
            false,
            Some(NOW - Duration::hours(1)),
            NOW,
        );
        assert_eq!(shown.last_active, None);
        assert_eq!(shown.is_online, None);
    }

    #[test]
    fn case_44_owner_hides_online_status_while_online() {
        let owner = privacy_with(|p| p.show_online_status = false);
        let shown = activity(&owner, &Privacy::default(), true, Some(NOW), NOW);
        assert_eq!(shown.last_active, Some(LastActive::Today));
        assert_eq!(shown.is_online, None);
    }

    #[test]
    fn case_45_viewer_browses_privately() {
        let viewer = privacy_with(|p| p.record_my_visits = false);
        assert_eq!(
            record_view(&view(Tier::Member, viewer.record_my_visits, None, 0), NOW),
            ViewRecord::Insert { is_private: true }
        );
        assert!(visitors_hidden(&viewer));
        assert!(!visitors_hidden(&Privacy::default()));
    }

    #[test]
    fn case_46_connection_opens_the_profile() {
        assert_eq!(
            record_view(&view(Tier::Connection, true, None, 0), NOW),
            ViewRecord::Skip
        );
    }

    #[test]
    fn case_47_opened_twice_within_30_minutes() {
        assert_eq!(
            record_view(&view(Tier::Member, true, None, 3), NOW),
            ViewRecord::Insert { is_private: false }
        );
        // The second open finds today's row from 10 minutes ago: no new row, no extra count.
        let again = view(Tier::Member, true, Some(NOW - Duration::minutes(10)), 4);
        assert_eq!(
            record_view(&again, NOW),
            ViewRecord::Update {
                is_private: false,
                count_again: false
            }
        );
    }

    #[test]
    fn case_48_daily_view_limit_reached() {
        let new_profile = view(Tier::Member, true, None, PROFILE_VIEWS_PER_DAY);
        assert_eq!(record_view(&new_profile, NOW), ViewRecord::LimitReached);
        let seen_today = view(
            Tier::InterestToOwner,
            true,
            Some(NOW - Duration::hours(2)),
            PROFILE_VIEWS_PER_DAY,
        );
        assert_eq!(
            record_view(&seen_today, NOW),
            ViewRecord::Update {
                is_private: false,
                count_again: true
            }
        );
    }

    // ---- Further rules -------------------------------------------------------------------

    #[test]
    fn own_profile_is_not_opened_through_relation() {
        let me = OwnerFacts {
            id: VIEWER_ID,
            ..woman()
        };
        assert_eq!(opens(&me, unrelated()), Err(Refusal::SameProfile));
        assert_eq!(
            tier(VIEWER_ID, VIEWER_ID, unrelated()),
            Some(Tier::SelfTier)
        );
    }

    #[test]
    fn missing_gender_is_refused() {
        let unknown = OwnerFacts {
            gender: None,
            ..woman()
        };
        assert_eq!(
            opens(&unknown, unrelated()),
            Err(Refusal::NotOppositeGender)
        );
    }

    #[test]
    fn owner_profile_states_that_are_never_visible() {
        for status in [
            ProfileStatus::Draft,
            ProfileStatus::PendingReview,
            ProfileStatus::ChangesRequested,
            ProfileStatus::Suspended,
            ProfileStatus::Deleted,
        ] {
            let owner = OwnerFacts { status, ..woman() };
            let connected = PairFacts {
                active_connection: true,
                ..unrelated()
            };
            assert_eq!(opens(&owner, connected), Err(Refusal::OwnerUnavailable));
        }
        for user_status in [
            UserStatus::Banned,
            UserStatus::DeletionScheduled,
            UserStatus::Deleted,
        ] {
            let owner = OwnerFacts {
                user_status,
                ..woman()
            };
            assert_eq!(opens(&owner, unrelated()), Err(Refusal::OwnerUnavailable));
        }
    }

    #[test]
    fn paused_owner_stays_open_to_interest_counterparts() {
        let paused = OwnerFacts {
            status: ProfileStatus::Paused,
            ..woman()
        };
        let pair = PairFacts {
            pending_interest: Some(InterestDirection::Received),
            ..unrelated()
        };
        assert_eq!(opens(&paused, pair), Ok(Tier::InterestFromOwner));
    }

    #[test]
    fn closed_viewer_sees_only_connections() {
        let closed = ViewerFacts {
            status: ProfileStatus::Closed,
            ..man()
        };
        let connected = PairFacts {
            active_connection: true,
            ..unrelated()
        };
        assert_eq!(relation(&closed, &woman(), connected), Ok(Tier::Connection));
        let pending = PairFacts {
            pending_interest: Some(InterestDirection::Received),
            ..unrelated()
        };
        assert_eq!(
            relation(&closed, &woman(), pending),
            Err(Refusal::NotActive)
        );
    }

    #[test]
    fn second_marriage_rule_applies_in_both_directions() {
        // The owner is married; the viewer must accept it.
        let her_view = ViewerFacts {
            id: OWNER_ID,
            gender: Some(Gender::Female),
            ..man()
        };
        let married_man = OwnerFacts {
            id: VIEWER_ID,
            gender: Some(Gender::Male),
            marital_status: Some(MaritalStatus::Married),
            ..woman()
        };
        assert_eq!(
            relation(&her_view, &married_man, unrelated()),
            Err(Refusal::SecondMarriage)
        );
        let accepting = ViewerFacts {
            accepts_married: true,
            ..her_view
        };
        assert_eq!(
            relation(&accepting, &married_man, unrelated()),
            Ok(Tier::Member)
        );
        // A missing preferences row counts as an empty array.
        assert!(!accepts_married(None));
    }

    #[test]
    fn relation_paths_ignore_the_second_marriage_rule() {
        let married = ViewerFacts {
            marital_status: Some(MaritalStatus::Married),
            ..man()
        };
        let pair = PairFacts {
            pending_interest: Some(InterestDirection::Received),
            ..unrelated()
        };
        assert_eq!(
            relation(&married, &woman(), pair),
            Ok(Tier::InterestFromOwner)
        );
    }

    #[test]
    fn discovery_needs_tier_member() {
        assert!(discoverable(&man(), &woman(), unrelated()));
        let pending = PairFacts {
            pending_interest: Some(InterestDirection::Sent),
            ..unrelated()
        };
        assert!(can_open(&man(), &woman(), pending));
        assert!(!discoverable(&man(), &woman(), pending));
        let hidden = OwnerFacts {
            discovery_visibility: DiscoveryVisibility::Hidden,
            ..woman()
        };
        assert!(!discoverable(&man(), &hidden, unrelated()));
    }

    #[test]
    fn relation_agrees_with_the_tier_order_whenever_it_grants_access() {
        let directions = [
            None,
            Some(InterestDirection::Sent),
            Some(InterestDirection::Received),
        ];
        for viewer_status in ProfileStatus::ALL {
            for owner_status in ProfileStatus::ALL {
                for active_connection in [false, true] {
                    for pending_interest in directions {
                        let viewer = ViewerFacts {
                            status: *viewer_status,
                            ..man()
                        };
                        let owner = OwnerFacts {
                            status: *owner_status,
                            ..woman()
                        };
                        let pair = PairFacts {
                            active_connection,
                            pending_interest,
                            ..unrelated()
                        };
                        if let Ok(granted) = relation(&viewer, &owner, pair) {
                            assert_eq!(Some(granted), tier(viewer.id, owner.id, pair));
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn group_visibility_matrix() {
        use FieldVisibility::{Connections, Members, Nobody};
        for tier in [Tier::Member, Tier::InterestFromOwner, Tier::InterestToOwner] {
            assert!(group_visible(Members, tier));
            assert!(!group_visible(Connections, tier));
            assert!(!group_visible(Nobody, tier));
        }
        assert!(group_visible(Members, Tier::Connection));
        assert!(group_visible(Connections, Tier::Connection));
        assert!(!group_visible(Nobody, Tier::Connection));
        assert!(group_visible(Nobody, Tier::SelfTier));
        assert!(matchable(Members));
        assert!(!matchable(Connections));
        assert!(!matchable(Nobody));
    }

    #[test]
    fn default_privacy_seen_by_a_member() {
        let shown = disclosure(
            &Privacy::default(),
            Tier::Member,
            content(LockedGroup::ALL),
            None,
        );
        assert_eq!(
            shown.locked,
            [
                LockedGroup::FullName,
                LockedGroup::Income,
                LockedGroup::CareerDetails,
                LockedGroup::Home,
                LockedGroup::Area,
                LockedGroup::Health,
            ]
        );
        assert!(shown.visible.contains(LockedGroup::Caste));
        assert!(shown.visible.contains(LockedGroup::Family));
        assert!(shown.visible.contains(LockedGroup::Photos));
        assert!(shown.family_object);
    }

    #[test]
    fn the_owner_sees_everything() {
        let private = privacy_with(|p| {
            p.name_display = NameDisplay::CodeOnly;
            p.photo_visibility = PhotoVisibility::ApprovedOnly;
            p.caste_visibility = FieldVisibility::Nobody;
            p.family_visibility = FieldVisibility::Nobody;
        });
        let shown = disclosure(&private, Tier::SelfTier, content(LockedGroup::ALL), None);
        assert_eq!(shown.locked, Vec::<LockedGroup>::new());
        assert_eq!(shown.photos, Some(PhotoMode::Clear));
        assert!(LockedGroup::ALL.iter().all(|g| shown.visible.contains(*g)));
    }

    #[test]
    fn family_is_null_without_a_family_row() {
        let no_family = OwnerContent {
            has_family_row: false,
            ..content(&[])
        };
        let shown = disclosure(&Privacy::default(), Tier::Connection, no_family, None);
        assert!(!shown.family_object);
    }

    #[test]
    fn photo_mode_table() {
        use PhotoVisibility::{ApprovedOnly, Connections, InterestsAndConnections, Members};
        use Tier::{Connection, InterestFromOwner, InterestToOwner, Member};
        let clear = |visibility, tier| photo_mode(visibility, tier, None) == PhotoMode::Clear;
        for tier in [Member, InterestToOwner, InterestFromOwner, Connection] {
            assert!(clear(Members, tier));
            assert!(!clear(ApprovedOnly, tier));
            assert_eq!(
                clear(InterestsAndConnections, tier),
                matches!(tier, InterestFromOwner | Connection)
            );
            assert_eq!(clear(Connections, tier), tier == Connection);
            for visibility in PhotoVisibility::ALL {
                assert_eq!(
                    photo_mode(*visibility, tier, Some(PhotoAccessStatus::Granted)),
                    PhotoMode::Clear
                );
                // Only a granted row changes the outcome.
                assert_eq!(
                    photo_mode(*visibility, tier, Some(PhotoAccessStatus::Revoked)),
                    photo_mode(*visibility, tier, None)
                );
            }
        }
    }

    #[test]
    fn clear_photos_sign_clear_keys() {
        let keys = PhotoKeys {
            thumb: "t",
            medium: "m",
            large: "l",
            blur_thumb: "bt",
            blur_medium: "bm",
        };
        assert_eq!(
            PhotoMode::Clear.variants(keys),
            PhotoVariants {
                is_blurred: false,
                thumb: "t",
                medium: "m",
                large: Some("l"),
            }
        );
    }

    #[test]
    fn photo_access_rows_in_order() {
        let state = |row, allow| {
            photo_access_state(
                Some(PhotoMode::Blurred),
                allow,
                row,
                PHOTO_ACCESS_RETRY_DAYS,
                NOW,
            )
        };
        // Clear photos are visible whatever the row says.
        assert_eq!(
            photo_access_state(
                Some(PhotoMode::Clear),
                false,
                Some(access_row(PhotoAccessStatus::Denied, 1)),
                PHOTO_ACCESS_RETRY_DAYS,
                NOW
            ),
            RelationPhotoAccess::Visible
        );
        // A pending request outranks requests being turned off.
        assert_eq!(
            state(Some(access_row(PhotoAccessStatus::Pending, 1)), false),
            RelationPhotoAccess::Requested
        );
        assert_eq!(
            state(Some(access_row(PhotoAccessStatus::Revoked, 29)), true),
            RelationPhotoAccess::Denied
        );
        assert_eq!(
            state(Some(access_row(PhotoAccessStatus::Revoked, 30)), true),
            RelationPhotoAccess::CanRequest
        );
        assert_eq!(state(None, true), RelationPhotoAccess::CanRequest);
    }

    #[test]
    fn cannot_send_rows_in_order() {
        let settings = InterestSettings::default();
        let check = |facts: &InterestFacts| can_send_interest(facts, &settings, NOW);
        let everything_wrong = InterestFacts {
            viewer_status: ProfileStatus::Paused,
            active_connection: true,
            pending_interest: Some(InterestDirection::Received),
            owner_permission: InterestPermission::VerifiedOnly,
            usage: InterestUsage {
                pending_sent: 50,
                active_connections: 30,
                sent_today: 10,
            },
            ..interest_facts()
        };
        assert_eq!(
            check(&everything_wrong),
            Err(CannotSend::OwnProfileNotActive)
        );
        let active = InterestFacts {
            viewer_status: ProfileStatus::Active,
            ..everything_wrong
        };
        assert_eq!(check(&active), Err(CannotSend::AlreadyConnected));
        let unconnected = InterestFacts {
            active_connection: false,
            ..active
        };
        assert_eq!(check(&unconnected), Err(CannotSend::AlreadyPending));
        let nothing_pending = InterestFacts {
            pending_interest: None,
            ..unconnected
        };
        assert_eq!(
            check(&nothing_pending),
            Err(CannotSend::NotPermittedByMember(
                CannotSendDetail::VerifiedOnly
            ))
        );
        let open_to_all = InterestFacts {
            owner_permission: InterestPermission::Everyone,
            ..nothing_pending
        };
        assert_eq!(check(&open_to_all), Err(CannotSend::PendingLimit));
        let few_pending = InterestFacts {
            usage: InterestUsage {
                pending_sent: 49,
                ..open_to_all.usage
            },
            ..open_to_all
        };
        assert_eq!(check(&few_pending), Err(CannotSend::ConnectionLimit));
        let few_connections = InterestFacts {
            usage: InterestUsage {
                active_connections: 29,
                ..few_pending.usage
            },
            ..few_pending
        };
        assert_eq!(check(&few_connections), Err(CannotSend::DailyLimit));
        // A verified viewer has the higher daily limit.
        let verified = InterestFacts {
            viewer: SenderFacts {
                is_id_verified: true,
                ..few_connections.viewer
            },
            ..few_connections
        };
        assert_eq!(check(&verified), Ok(()));
        assert_eq!(CannotSend::DailyLimit.detail(), None);
        assert_eq!(CannotSend::DailyLimit.send_after(), None);
    }

    #[test]
    fn a_hidden_decline_looks_pending_to_the_sender() {
        let declined = ClosedInterest {
            status: InterestStatus::Declined,
            responded_at: Some(NOW - Duration::days(2)),
            expires_at: NOW + Duration::days(10),
        };
        let facts = InterestFacts {
            latest_sent: Some(declined),
            ..interest_facts()
        };
        let settings = InterestSettings::default();
        assert_eq!(
            can_send_interest(&facts, &settings, NOW),
            Err(CannotSend::AlreadyPending)
        );
        // After `expires_at` the 90-day decline cooldown shows, counted from `responded_at`.
        let later = NOW + Duration::days(11);
        let refusal = can_send_interest(&facts, &settings, later).unwrap_err();
        assert_eq!(refusal.reason(), CannotSendReason::Cooldown);
        assert_eq!(
            refusal.send_after(),
            Some(karachi_date(NOW + Duration::days(88)))
        );
    }

    #[test]
    fn cooldowns_by_outcome() {
        let settings = InterestSettings::default();
        let closed = |status, responded_days_ago: i64, expires_days_ago: i64| ClosedInterest {
            status,
            responded_at: Some(NOW - Duration::days(responded_days_ago)),
            expires_at: NOW - Duration::days(expires_days_ago),
        };
        let end =
            |interest: ClosedInterest| interest_cooldown_end(Some(&interest), None, &settings, NOW);
        assert_eq!(
            end(closed(InterestStatus::Withdrawn, 6, 0)),
            Some(NOW + Duration::days(1))
        );
        assert_eq!(end(closed(InterestStatus::Withdrawn, 7, 0)), None);
        assert_eq!(
            end(closed(InterestStatus::Expired, 0, 29)),
            Some(NOW + Duration::days(1))
        );
        assert_eq!(end(closed(InterestStatus::Expired, 0, 30)), None);
        assert_eq!(
            end(closed(InterestStatus::Declined, 89, 60)),
            Some(NOW + Duration::days(1))
        );
        assert_eq!(end(closed(InterestStatus::Accepted, 100, 100)), None);
        // An ended connection binds both members for 90 days; the later end wins.
        assert_eq!(
            interest_cooldown_end(
                Some(&closed(InterestStatus::Withdrawn, 1, 0)),
                Some(NOW - Duration::days(10)),
                &settings,
                NOW
            ),
            Some(NOW + Duration::days(80))
        );
        let facts = InterestFacts {
            connection_ended_at: Some(datetime!(2026-11-01 20:00 UTC)),
            ..interest_facts()
        };
        // 2026-11-01 20:00 UTC is 2 November in Karachi; 90 days later is 31 January.
        assert_eq!(
            can_send_interest(&facts, &settings, NOW),
            Err(CannotSend::Cooldown {
                until: date!(2027 - 01 - 31)
            })
        );
    }

    #[test]
    fn interest_permission_everyone_and_preference_match() {
        let fitting = SenderFacts {
            fits_receiver_must_haves: true,
            ..SenderFacts::default()
        };
        assert_eq!(
            interest_permitted(InterestPermission::Everyone, SenderFacts::default(), false),
            Ok(())
        );
        assert_eq!(
            interest_permitted(InterestPermission::PreferenceMatch, fitting, false),
            Ok(())
        );
        let id_verified = SenderFacts {
            is_id_verified: true,
            ..SenderFacts::default()
        };
        assert_eq!(
            interest_permitted(InterestPermission::VerifiedOnly, id_verified, false),
            Ok(())
        );
    }

    #[test]
    fn repeat_views_count_after_30_minutes() {
        let at = |minutes_ago| {
            record_view(
                &view(
                    Tier::Member,
                    true,
                    Some(NOW - Duration::minutes(minutes_ago)),
                    1,
                ),
                NOW,
            )
        };
        assert_eq!(
            at(30),
            ViewRecord::Update {
                is_private: false,
                count_again: false
            }
        );
        assert_eq!(
            at(31),
            ViewRecord::Update {
                is_private: false,
                count_again: true
            }
        );
    }

    #[test]
    fn online_status_is_shared_only_both_ways() {
        let shown = activity(
            &Privacy::default(),
            &Privacy::default(),
            true,
            Some(NOW),
            NOW,
        );
        assert_eq!(shown.last_active, Some(LastActive::Online));
        assert_eq!(shown.is_online, Some(true));
        // The viewer hides their own status, so they do not see the owner's.
        let viewer = privacy_with(|p| p.show_online_status = false);
        let hidden = activity(&Privacy::default(), &viewer, true, Some(NOW), NOW);
        assert_eq!(hidden.last_active, Some(LastActive::Today));
        assert_eq!(hidden.is_online, None);
        // Shared but offline: the normal label and `is_online = false`.
        let offline = activity(
            &Privacy::default(),
            &Privacy::default(),
            false,
            Some(NOW - Duration::days(3)),
            NOW,
        );
        assert_eq!(offline.last_active, Some(LastActive::ThisWeek));
        assert_eq!(offline.is_online, Some(false));
        // The owner hides last active: nothing at all.
        let owner = privacy_with(|p| p.show_last_active = false);
        assert_eq!(
            activity(&owner, &Privacy::default(), true, Some(NOW), NOW),
            Activity {
                last_active: None,
                is_online: None
            }
        );
    }

    #[test]
    fn presence_and_read_receipts_need_both_sides() {
        let quiet = privacy_with(|p| {
            p.show_online_status = false;
            p.send_read_receipts = false;
        });
        let open = Privacy::default();
        assert!(presence_shared(true, &open, &open));
        assert!(!presence_shared(false, &open, &open));
        assert!(!presence_shared(true, &open, &quiet));
        assert!(read_receipts_shared(&open, &open));
        assert!(!read_receipts_shared(&quiet, &open));
        assert!(interest_seen_for_sender(true, &open, &open));
        assert!(!interest_seen_for_sender(true, &open, &quiet));
        assert!(!interest_seen_for_sender(true, &quiet, &open));
        assert!(!interest_seen_for_sender(false, &open, &open));
    }

    #[test]
    fn contact_details_only_through_an_active_share() {
        assert!(contact_visible(true, Some(ContactShareStatus::Active)));
        assert!(!contact_visible(true, Some(ContactShareStatus::Revoked)));
        assert!(!contact_visible(true, None));
        assert!(!contact_visible(false, Some(ContactShareStatus::Active)));
    }

    #[test]
    fn group_set_operations() {
        let set = GroupSet::EMPTY
            .with(LockedGroup::Health)
            .with_if(LockedGroup::Caste, true)
            .with_if(LockedGroup::Income, false);
        assert!(set.contains(LockedGroup::Caste));
        assert!(!set.contains(LockedGroup::Income));
        assert_eq!(
            set.iter().collect::<Vec<_>>(),
            [LockedGroup::Caste, LockedGroup::Health]
        );
        let collected: GroupSet = [LockedGroup::Health, LockedGroup::Caste]
            .into_iter()
            .collect();
        assert_eq!(collected, set);
    }

    #[test]
    fn api_codes() {
        assert_eq!(
            serde_json::to_string(&RelationPhotoAccess::RequestsOff).unwrap(),
            r#""requests_off""#
        );
        assert_eq!(
            serde_json::to_string(&CannotSendReason::OwnProfileNotActive).unwrap(),
            r#""own_profile_not_active""#
        );
        assert_eq!(
            serde_json::to_string(&CannotSendDetail::PreferenceMatch).unwrap(),
            r#""preference_match""#
        );
        assert_eq!(
            serde_json::to_string(&InterestDirection::Received).unwrap(),
            r#""received""#
        );
    }
}
