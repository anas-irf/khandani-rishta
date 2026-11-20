//! Photo response types (15 section 4.4) and URL signing for the owner (08 section 5.4).

use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::options::PhotoRejectionReason;
use crate::domain::types::PhotoStatus;
use crate::services::r2::ObjectStore;

/// A member's own photo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct OwnPhoto {
    pub id: Uuid,
    pub status: PhotoStatus,
    pub rejection_reason: Option<PhotoRejectionReason>,
    pub is_primary: bool,
    pub position: i16,
    /// `null` while processing or after a failure.
    pub thumb_url: Option<String>,
    pub medium_url: Option<String>,
    pub large_url: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// The columns of `profile_photos` that responses need.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PhotoRow {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub status: PhotoStatus,
    pub rejection_reason: Option<PhotoRejectionReason>,
    pub position: i16,
    pub is_primary: bool,
    pub key_large: Option<String>,
    pub key_medium: Option<String>,
    pub key_thumb: Option<String>,
    pub key_blur_medium: Option<String>,
    pub key_blur_thumb: Option<String>,
    pub created_at: OffsetDateTime,
}

/// The column list matching [`PhotoRow`], for `SELECT` statements.
pub const PHOTO_COLUMNS: &str = "id, profile_id, status, rejection_reason, position, is_primary, \
     key_large, key_medium, key_thumb, key_blur_medium, key_blur_thumb, created_at";

/// Signs a key, or `None` when there is no key or signing fails (the client shows a
/// placeholder).
pub async fn sign(storage: &dyn ObjectStore, key: Option<&str>) -> Option<String> {
    let key = key?;
    match storage.presign_photo(key).await {
        Ok(url) => Some(url),
        Err(error) => {
            tracing::warn!(%error, "could not sign a photo URL");
            None
        }
    }
}

/// The owner's view of a photo: always the clear variants, except while `processing` or
/// after `failed` (08 section 5.4 rule 7).
pub async fn own_photo(storage: &dyn ObjectStore, row: &PhotoRow) -> OwnPhoto {
    let has_files = !matches!(row.status, PhotoStatus::Processing | PhotoStatus::Failed);
    let (thumb_url, medium_url, large_url) = if has_files {
        (
            sign(storage, row.key_thumb.as_deref()).await,
            sign(storage, row.key_medium.as_deref()).await,
            sign(storage, row.key_large.as_deref()).await,
        )
    } else {
        (None, None, None)
    };
    OwnPhoto {
        id: row.id,
        status: row.status,
        rejection_reason: row.rejection_reason,
        is_primary: row.is_primary,
        position: row.position,
        thumb_url,
        medium_url,
        large_url,
        created_at: row.created_at,
    }
}
