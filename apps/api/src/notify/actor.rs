//! The actor of a notification as the recipient may see it (09 sections 2, 4 and 6).
//!
//! An actor is a member who caused the event: the sender of an interest, the requester of
//! photos, the confirmer of a stage. The recipient sees `{ profile_id, display_name, photo }`
//! rendered under the rules of 09:
//!
//! 1. The actor must be openable by the recipient (09 section 2.2). Otherwise the notification
//!    is not created ([`super::notify`]) and an existing row is left out of the feed (14 section
//!    7.3 rule 3).
//! 2. The display name follows the actor's `name_display` and the relation tier (09 section 4).
//! 3. The photo is the actor's primary approved photo, clear or blurred by `photo_mode`
//!    (09 section 6).
//!
//! The shared profile views module is built in parallel, so this module carries its own small
//! loader over the pure functions of [`crate::domain::visibility`] and [`crate::domain::display`].
//!
//! The must-have check of 09 section 2.2 row 11 (`passes_must_haves`) needs the recipient's
//! full matching subject, which a notification does not load. It is treated as passed: an actor
//! with `discovery_visibility = preference_match` stays visible. The gap is narrow, because the
//! relation rows 5 to 7 that carry most notifications ignore discovery settings anyway.

use std::collections::HashMap;

use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::display::{self, NameParts};
use crate::domain::options::{
    DiscoveryVisibility, Gender, MaritalStatus, NameDisplay, PhotoVisibility,
};
use crate::domain::types::{PhotoAccessStatus, ProfileStatus, Tier, UserStatus};
use crate::domain::visibility::{
    self, InterestDirection, OwnerFacts, PairFacts, PhotoKeys, ViewerFacts,
};
use crate::models::notifications::{ActorPhoto, NotificationActor};
use crate::models::photos::sign;
use crate::services::r2::ObjectStore;

/// The viewer (the recipient's profile) facts of 09 section 2.1.
#[derive(Debug, sqlx::FromRow)]
struct ViewerRow {
    id: Uuid,
    gender: Option<Gender>,
    status: ProfileStatus,
    marital_status: Option<MaritalStatus>,
    accepts_married: bool,
}

/// One actor with everything the decision table, the name rules and the photo rules need.
#[derive(Debug, sqlx::FromRow)]
struct ActorRow {
    id: Uuid,
    public_code: String,
    first_name: Option<String>,
    last_name: Option<String>,
    date_of_birth: Option<Date>,
    city_id: Option<i32>,
    city_other: Option<String>,
    gender: Option<Gender>,
    status: ProfileStatus,
    marital_status: Option<MaritalStatus>,
    user_status: UserStatus,
    accepts_married: bool,
    discovery_visibility: DiscoveryVisibility,
    name_display: NameDisplay,
    photo_visibility: PhotoVisibility,
    blocked: bool,
    active_connection: bool,
    /// `received` when the actor has a pending interest to the viewer, `sent` for the reverse.
    pending_interest: Option<String>,
    access_status: Option<PhotoAccessStatus>,
    photo_id: Option<Uuid>,
    photo_is_primary: Option<bool>,
    key_thumb: Option<String>,
    key_medium: Option<String>,
    key_large: Option<String>,
    key_blur_thumb: Option<String>,
    key_blur_medium: Option<String>,
}

/// The photo keys chosen for this viewer.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ChosenPhoto {
    id: Uuid,
    is_primary: bool,
    is_blurred: bool,
    thumb: String,
    medium: String,
    large: Option<String>,
}

/// An actor the recipient may open, with the values rendered for them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    pub profile_id: Uuid,
    pub tier: Tier,
    /// 09 section 4.1 at this tier.
    pub display_name: String,
    pub age: Option<i32>,
    pub city_id: Option<i32>,
    pub city_other: Option<String>,
    photo: Option<ChosenPhoto>,
}

impl Actor {
    /// The `actor` object of a feed row or of `notification.new`, with the photo URLs signed.
    pub async fn view(&self, storage: &dyn ObjectStore) -> NotificationActor {
        NotificationActor {
            profile_id: self.profile_id,
            display_name: self.display_name.clone(),
            photo: match &self.photo {
                Some(photo) => sign_photo(storage, photo).await,
                None => None,
            },
        }
    }
}

async fn sign_photo(storage: &dyn ObjectStore, photo: &ChosenPhoto) -> Option<ActorPhoto> {
    let thumb_url = sign(storage, Some(&photo.thumb)).await?;
    let medium_url = sign(storage, Some(&photo.medium)).await?;
    let large_url = match &photo.large {
        Some(key) => Some(sign(storage, Some(key)).await?),
        None => None,
    };
    Some(ActorPhoto {
        id: photo.id,
        is_primary: photo.is_primary,
        is_blurred: photo.is_blurred,
        thumb_url,
        medium_url,
        large_url,
    })
}

/// The photo this viewer receives: only an approved photo with all its variants, clear or
/// blurred by `photo_mode`. In blurred mode no clear key is ever chosen (09 section 6.2).
fn choose_photo(row: &ActorRow, tier: Tier) -> Option<ChosenPhoto> {
    let id = row.photo_id?;
    let keys = PhotoKeys {
        thumb: row.key_thumb.as_deref()?,
        medium: row.key_medium.as_deref()?,
        large: row.key_large.as_deref()?,
        blur_thumb: row.key_blur_thumb.as_deref()?,
        blur_medium: row.key_blur_medium.as_deref()?,
    };
    let mode = visibility::photo_mode(row.photo_visibility, tier, row.access_status);
    let variants = mode.variants(keys);
    Some(ChosenPhoto {
        id,
        is_primary: row.photo_is_primary.unwrap_or(false),
        is_blurred: variants.is_blurred,
        thumb: variants.thumb.to_owned(),
        medium: variants.medium.to_owned(),
        large: variants.large.map(str::to_owned),
    })
}

/// Decides whether the viewer may open the actor and renders the actor for them.
fn resolve(viewer: &ViewerFacts, row: &ActorRow, now: OffsetDateTime) -> Option<Actor> {
    let owner = OwnerFacts {
        id: row.id,
        gender: row.gender,
        status: row.status,
        user_status: row.user_status,
        marital_status: row.marital_status,
        accepts_married: row.accepts_married,
        discovery_visibility: row.discovery_visibility,
    };
    let pair = PairFacts {
        blocked: row.blocked,
        active_connection: row.active_connection,
        pending_interest: match row.pending_interest.as_deref() {
            Some("received") => Some(InterestDirection::Received),
            Some("sent") => Some(InterestDirection::Sent),
            _ => None,
        },
        // See the module documentation.
        viewer_fits_owner_must_haves: true,
    };
    let tier = visibility::relation(viewer, &owner, pair).ok()?;
    let name = NameParts {
        first_name: row.first_name.as_deref().unwrap_or_default(),
        last_name: row.last_name.as_deref().unwrap_or_default(),
        public_code: &row.public_code,
    };
    Some(Actor {
        profile_id: row.id,
        tier,
        display_name: display::display_name(name, row.name_display, tier),
        age: row.date_of_birth.map(|dob| display::age(dob, now)),
        city_id: row.city_id,
        city_other: row.city_other.clone(),
        photo: choose_photo(row, tier),
    })
}

/// The actors of `actor_ids` that `viewer_profile_id` may open, keyed by profile id. An id that
/// is missing from the result does not exist for the viewer: blocked, hidden, suspended, not
/// active or not related (09 section 2.2).
pub async fn load(
    db: &PgPool,
    viewer_profile_id: Uuid,
    actor_ids: &[Uuid],
) -> sqlx::Result<HashMap<Uuid, Actor>> {
    if actor_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let viewer: Option<ViewerRow> = sqlx::query_as(
        "SELECT p.id, p.gender, p.status, p.marital_status,
                COALESCE('married' = ANY(pp.marital_statuses), false) AS accepts_married
         FROM profiles p
         LEFT JOIN partner_preferences pp ON pp.profile_id = p.id
         WHERE p.id = $1",
    )
    .bind(viewer_profile_id)
    .fetch_optional(db)
    .await?;
    let Some(viewer) = viewer else {
        return Ok(HashMap::new());
    };
    let viewer = ViewerFacts {
        id: viewer.id,
        gender: viewer.gender,
        status: viewer.status,
        marital_status: viewer.marital_status,
        accepts_married: viewer.accepts_married,
    };

    let rows: Vec<ActorRow> = sqlx::query_as(
        "SELECT p.id, p.public_code, p.first_name, p.last_name, p.date_of_birth, p.city_id,
                p.city_other, p.gender, p.status, p.marital_status, u.status AS user_status,
                COALESCE('married' = ANY(pp.marital_statuses), false) AS accepts_married,
                COALESCE(pr.discovery_visibility, 'everyone') AS discovery_visibility,
                COALESCE(pr.name_display, 'first_name_last_initial') AS name_display,
                COALESCE(pr.photo_visibility, 'members') AS photo_visibility,
                EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker_profile_id = $1 AND b.blocked_profile_id = p.id)
                            OR (b.blocker_profile_id = p.id AND b.blocked_profile_id = $1)) AS blocked,
                EXISTS (SELECT 1 FROM connections c
                         WHERE c.status = 'active'
                           AND c.profile_low_id = LEAST($1, p.id)
                           AND c.profile_high_id = GREATEST($1, p.id)) AS active_connection,
                (SELECT CASE WHEN i.sender_profile_id = p.id THEN 'received' ELSE 'sent' END
                   FROM interests i
                  WHERE i.status = 'pending'
                    AND ((i.sender_profile_id = p.id AND i.receiver_profile_id = $1)
                      OR (i.sender_profile_id = $1 AND i.receiver_profile_id = p.id))
                  ORDER BY (i.sender_profile_id = p.id) DESC
                  LIMIT 1) AS pending_interest,
                (SELECT a.status FROM photo_access a
                  WHERE a.owner_profile_id = p.id AND a.viewer_profile_id = $1) AS access_status,
                ph.id AS photo_id, ph.is_primary AS photo_is_primary, ph.key_thumb, ph.key_medium,
                ph.key_large, ph.key_blur_thumb, ph.key_blur_medium
         FROM profiles p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN profile_privacy pr ON pr.profile_id = p.id
         LEFT JOIN partner_preferences pp ON pp.profile_id = p.id
         LEFT JOIN LATERAL (
             SELECT id, is_primary, key_thumb, key_medium, key_large, key_blur_thumb,
                    key_blur_medium
             FROM profile_photos
             WHERE profile_id = p.id AND status = 'approved'
             ORDER BY is_primary DESC, position, id
             LIMIT 1) ph ON true
         WHERE p.id = ANY($2)",
    )
    .bind(viewer_profile_id)
    .bind(actor_ids)
    .fetch_all(db)
    .await?;

    let now = OffsetDateTime::now_utc();
    Ok(rows
        .iter()
        .filter_map(|row| resolve(&viewer, row, now).map(|actor| (row.id, actor)))
        .collect())
}

/// One actor, or `None` when the viewer may not open them.
pub async fn load_one(
    db: &PgPool,
    viewer_profile_id: Uuid,
    actor_id: Uuid,
) -> sqlx::Result<Option<Actor>> {
    Ok(load(db, viewer_profile_id, &[actor_id])
        .await?
        .remove(&actor_id))
}
