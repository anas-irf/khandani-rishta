//! SQL for photos (08 section 5, 03 section 4.4), plus the profile bookkeeping that every
//! photo or verification decision shares: primary photo, `has_approved_photo`, badges and
//! `completeness`.
//!
//! Every change of a profile's photos runs inside a transaction that first calls
//! [`lock_profile`], so two requests cannot both pass the photo limit, pick the same position
//! or leave two primary photos.

use serde_json::json;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::photos::{OwnPhoto, PHOTO_COLUMNS, PhotoRow, own_photo};
use crate::realtime::hub::{Realtime, ServerEvent};
use crate::state::AppState;

/// Serialises photo changes of one profile until the transaction ends.
pub async fn lock_profile(tx: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('profile_photos:' || $1::text, 0))")
        .bind(profile_id)
        .execute(tx)
        .await?;
    Ok(())
}

/// How many photos count against `limits.photos_max`: every status except `rejected` and
/// `failed` (08 section 5.1).
pub async fn count_counted<'e>(db: impl PgExecutor<'e>, profile_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM profile_photos
         WHERE profile_id = $1 AND status NOT IN ('rejected', 'failed')",
    )
    .bind(profile_id)
    .fetch_one(db)
    .await
}

/// The profile's photo that was created from an upload, if any (confirmations are idempotent).
pub async fn by_upload_key<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
    upload_key: &str,
) -> sqlx::Result<Option<PhotoRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PHOTO_COLUMNS} FROM profile_photos WHERE profile_id = $1 AND upload_key = $2"
    )))
    .bind(profile_id)
    .bind(upload_key)
    .fetch_optional(db)
    .await
}

/// Inserts a `processing` photo one position after the highest (08 section 5.2 rule 6).
pub async fn insert_processing<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
    upload_key: &str,
) -> sqlx::Result<PhotoRow> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO profile_photos (id, profile_id, status, position, upload_key)
         VALUES ($1, $2, 'processing',
                 (SELECT COALESCE(max(position) + 1, 0) FROM profile_photos WHERE profile_id = $2),
                 $3)
         RETURNING {PHOTO_COLUMNS}"
    )))
    .bind(Uuid::now_v7())
    .bind(profile_id)
    .bind(upload_key)
    .fetch_one(db)
    .await
}

/// The profile's photos in display order.
pub async fn list<'e>(db: impl PgExecutor<'e>, profile_id: Uuid) -> sqlx::Result<Vec<PhotoRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PHOTO_COLUMNS} FROM profile_photos
         WHERE profile_id = $1 ORDER BY position, created_at, id"
    )))
    .bind(profile_id)
    .fetch_all(db)
    .await
}

/// One photo of the profile, locked for the rest of the transaction. The caller's profile id is
/// part of the `WHERE` clause (20 section 1, S-03).
pub async fn get_owned_for_update(
    tx: &mut PgConnection,
    photo_id: Uuid,
    profile_id: Uuid,
) -> sqlx::Result<Option<PhotoRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PHOTO_COLUMNS} FROM profile_photos WHERE id = $1 AND profile_id = $2 FOR UPDATE"
    )))
    .bind(photo_id)
    .bind(profile_id)
    .fetch_optional(tx)
    .await
}

/// One photo by id, whoever owns it. For staff routes and jobs only.
pub async fn get<'e>(db: impl PgExecutor<'e>, photo_id: Uuid) -> sqlx::Result<Option<PhotoRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PHOTO_COLUMNS} FROM profile_photos WHERE id = $1"
    )))
    .bind(photo_id)
    .fetch_optional(db)
    .await
}

/// The id of the profile's primary photo.
pub async fn primary_id<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar("SELECT id FROM profile_photos WHERE profile_id = $1 AND is_primary")
        .bind(profile_id)
        .fetch_optional(db)
        .await
}

/// Makes one photo the primary one. The current primary is cleared first because the unique
/// index allows a single primary per profile at every moment.
pub async fn set_primary(
    tx: &mut PgConnection,
    profile_id: Uuid,
    photo_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profile_photos SET is_primary = false WHERE profile_id = $1 AND is_primary",
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE profile_photos SET is_primary = true WHERE id = $1 AND profile_id = $2")
        .bind(photo_id)
        .bind(profile_id)
        .execute(tx)
        .await?;
    Ok(())
}

/// A photo that was deleted, with every key that has an object in R2.
#[derive(Debug, sqlx::FromRow)]
pub struct DeletedPhoto {
    #[sqlx(flatten)]
    pub photo: PhotoRow,
    pub upload_key: String,
}

impl DeletedPhoto {
    /// Every R2 key the photo may own: the processed variants and the temporary upload.
    pub fn object_keys(&self) -> Vec<String> {
        let mut keys = variant_keys(&self.photo);
        keys.push(self.upload_key.clone());
        keys
    }
}

/// The R2 keys of the five processed variants of a photo (none while `processing` or `failed`).
pub fn variant_keys(photo: &PhotoRow) -> Vec<String> {
    [
        &photo.key_large,
        &photo.key_medium,
        &photo.key_thumb,
        &photo.key_blur_medium,
        &photo.key_blur_thumb,
    ]
    .into_iter()
    .flatten()
    .cloned()
    .collect()
}

/// Deletes a photo of the profile and returns it.
pub async fn delete_owned(
    tx: &mut PgConnection,
    photo_id: Uuid,
    profile_id: Uuid,
) -> sqlx::Result<Option<DeletedPhoto>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "DELETE FROM profile_photos WHERE id = $1 AND profile_id = $2
         RETURNING {PHOTO_COLUMNS}, upload_key"
    )))
    .bind(photo_id)
    .bind(profile_id)
    .fetch_optional(tx)
    .await
}

/// Writes the display order: `photo_ids[0]` gets position 0, and so on.
pub async fn reorder(
    tx: &mut PgConnection,
    profile_id: Uuid,
    photo_ids: &[Uuid],
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profile_photos p SET position = (o.ord - 1)::smallint
         FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, ord)
         WHERE p.id = o.id AND p.profile_id = $1 AND p.position <> (o.ord - 1)::smallint",
    )
    .bind(profile_id)
    .bind(photo_ids)
    .execute(tx)
    .await?;
    Ok(())
}

/// What [`settle`] found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settled {
    /// The primary photo before the call (a deleted primary is already gone, so `None`).
    pub previous_primary: Option<Uuid>,
    /// The primary photo after the call.
    pub primary: Option<Uuid>,
}

impl Settled {
    /// The photo that became primary, if the primary changed during the call.
    pub fn new_primary(&self) -> Option<Uuid> {
        self.primary.filter(|id| Some(*id) != self.previous_primary)
    }
}

/// Brings the profile's derived photo state in line with its photos after any change to their
/// statuses or to the set of photos (03 section 4.4, 12 section 4.6):
///
/// 1. a primary photo that is no longer `approved` stops being primary;
/// 2. a profile with an approved photo and no primary gets the approved photo with the lowest
///    `position` as primary;
/// 3. `has_approved_photo` follows the existence of an approved photo;
/// 4. `is_photo_verified` is cleared when no approved photo is left, and also when
///    `primary_changed` says the face other members see first is different now (the caller knows:
///    a deleted or rejected primary, or an explicit change);
/// 5. `match_stale` is set and `completeness` recomputed.
pub async fn settle(
    tx: &mut PgConnection,
    profile_id: Uuid,
    primary_changed: bool,
) -> sqlx::Result<Settled> {
    let previous_primary = primary_id(&mut *tx, profile_id).await?;
    sqlx::query(
        "UPDATE profile_photos SET is_primary = false
         WHERE profile_id = $1 AND is_primary AND status <> 'approved'",
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE profile_photos SET is_primary = true
         WHERE id = (SELECT id FROM profile_photos
                      WHERE profile_id = $1 AND status = 'approved'
                        AND NOT EXISTS (SELECT 1 FROM profile_photos
                                         WHERE profile_id = $1 AND is_primary)
                      ORDER BY position, created_at, id LIMIT 1)",
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    let primary = primary_id(&mut *tx, profile_id).await?;
    let has_approved: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM profile_photos WHERE profile_id = $1 AND status = 'approved')",
    )
    .bind(profile_id)
    .fetch_one(&mut *tx)
    .await?;
    let lost_primary = previous_primary.is_some() && previous_primary != primary;
    sqlx::query(
        "UPDATE profiles
         SET has_approved_photo = $2,
             is_photo_verified = is_photo_verified AND $2 AND NOT $3,
             match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(has_approved)
    .bind(primary_changed || lost_primary)
    .execute(&mut *tx)
    .await?;
    recompute_completeness(tx, profile_id).await?;
    Ok(Settled {
        previous_primary,
        primary,
    })
}

/// Recomputes `profiles.completeness` (08 section 6.3). Delegates to the single loader in
/// [`crate::db::profiles::recompute_completeness`]; returns the new score, or `None` for an
/// unknown profile.
pub async fn recompute_completeness(
    tx: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<Option<i16>> {
    match crate::db::profiles::recompute_completeness(tx, profile_id).await {
        Ok(result) => Ok(Some(i16::from(result.score))),
        Err(sqlx::Error::RowNotFound) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Sends `photo.updated` (19 section 4.6) to the owner for each photo, after the transaction
/// that changed them has committed. Failures only log: the client refetches on reconnect.
pub async fn announce(state: &AppState, profile_id: Uuid, photo_ids: &[Uuid]) {
    if photo_ids.is_empty() || !state.hub.is_online(profile_id) {
        return;
    }
    for photo_id in photo_ids {
        match get(&state.db, *photo_id).await {
            Ok(Some(row)) => announce_row(state, &row).await,
            Ok(None) => {}
            Err(error) => tracing::warn!(%error, "could not load a photo for an event"),
        }
    }
}

/// Sends `photo.updated` for a row that is already loaded.
pub async fn announce_row(state: &AppState, row: &PhotoRow) {
    if !state.hub.is_online(row.profile_id) {
        return;
    }
    let photo: OwnPhoto = own_photo(state.storage.as_ref(), row).await;
    state.hub.send_to_profile(
        row.profile_id,
        &ServerEvent::new("photo.updated", json!({ "photo": photo })),
    );
}
