//! SQL for the member side of verification (12 sections 4 to 6, 15 section 9). The staff side
//! is in `db/review.rs`.

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::identity_number::mask;
use crate::domain::options::DocumentType;
use crate::domain::types::{Gesture, IdentityStatus, VerificationKind, VerificationStatus};
use crate::models::verifications::{IdentitySummary, VerificationRequestSummary};

/// The columns of [`VerificationRequestSummary`].
const SUMMARY_COLUMNS: &str = "id, kind, status, rejection_reason, created_at, reviewed_at";

/// The newest requests of a profile, at most ten (15 section 9).
pub async fn recent_requests<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
) -> sqlx::Result<Vec<VerificationRequestSummary>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SUMMARY_COLUMNS} FROM verification_requests
         WHERE profile_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10"
    )))
    .bind(profile_id)
    .fetch_all(db)
    .await
}

#[derive(Debug, sqlx::FromRow)]
struct IdentityRow {
    document_type: DocumentType,
    number_last4: String,
    status: IdentityStatus,
    verified_at: Option<OffsetDateTime>,
}

/// The registered identity as its owner may see it: the type, the mask and the status.
pub async fn identity_summary<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
) -> sqlx::Result<Option<IdentitySummary>> {
    let row: Option<IdentityRow> = sqlx::query_as(
        "SELECT document_type, number_last4, status, verified_at
         FROM profile_identity WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|row| IdentitySummary {
        document_type: row.document_type,
        number_masked: mask(&row.number_last4),
        status: row.status,
        verified_at: row.verified_at,
    }))
}

/// `(phone, photo, id)` verification flags of a profile.
pub async fn badge_flags<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
) -> sqlx::Result<(bool, bool, bool)> {
    sqlx::query_as(
        "SELECT is_phone_verified, is_photo_verified, is_id_verified FROM profiles WHERE id = $1",
    )
    .bind(profile_id)
    .fetch_one(db)
    .await
}

/// Whether the profile has a `pending` request of this kind.
pub async fn pending_exists(
    tx: &mut PgConnection,
    profile_id: Uuid,
    kind: VerificationKind,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM verification_requests
                         WHERE profile_id = $1 AND kind = $2 AND status = 'pending')",
    )
    .bind(profile_id)
    .bind(kind)
    .fetch_one(tx)
    .await
}

/// The registered document type and status, locked for the transaction.
pub async fn identity_for_update(
    tx: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<Option<(DocumentType, IdentityStatus)>> {
    sqlx::query_as(
        "SELECT document_type, status FROM profile_identity WHERE profile_id = $1 FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_optional(tx)
    .await
}

/// Whether the profile has an `approved` photo to compare a selfie with.
pub async fn has_approved_photo(tx: &mut PgConnection, profile_id: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT has_approved_photo FROM profiles WHERE id = $1")
        .bind(profile_id)
        .fetch_one(tx)
        .await
}

pub async fn set_identity_status(
    tx: &mut PgConnection,
    profile_id: Uuid,
    status: IdentityStatus,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE profile_identity SET status = $2 WHERE profile_id = $1")
        .bind(profile_id)
        .bind(status)
        .execute(tx)
        .await?;
    Ok(())
}

/// The images of a new request.
pub struct NewRequest<'a> {
    pub kind: VerificationKind,
    pub front_key: Option<&'a str>,
    pub back_key: Option<&'a str>,
    pub selfie_key: &'a str,
    pub gesture: Gesture,
}

/// Inserts a `pending` request. `None` when the profile already has a pending request of the
/// kind (the unique index of 04 section 6 settles a race).
pub async fn insert_pending(
    tx: &mut PgConnection,
    profile_id: Uuid,
    request: &NewRequest<'_>,
) -> sqlx::Result<Option<VerificationRequestSummary>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO verification_requests
             (id, profile_id, kind, front_key, back_key, selfie_key, gesture)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (profile_id, kind) WHERE status = 'pending' DO NOTHING
         RETURNING {SUMMARY_COLUMNS}"
    )))
    .bind(Uuid::now_v7())
    .bind(profile_id)
    .bind(request.kind)
    .bind(request.front_key)
    .bind(request.back_key)
    .bind(request.selfie_key)
    .bind(request.gesture)
    .fetch_optional(tx)
    .await
}

/// A request of the caller that may be cancelled, locked for the transaction.
pub async fn own_request_for_update(
    tx: &mut PgConnection,
    request_id: Uuid,
    profile_id: Uuid,
) -> sqlx::Result<Option<(VerificationKind, VerificationStatus)>> {
    sqlx::query_as(
        "SELECT kind, status FROM verification_requests
         WHERE id = $1 AND profile_id = $2 FOR UPDATE",
    )
    .bind(request_id)
    .bind(profile_id)
    .fetch_optional(tx)
    .await
}

/// Cancels a pending request. Its images are due for deletion at once (12 section 5.4).
pub async fn cancel(tx: &mut PgConnection, request_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE verification_requests SET status = 'cancelled', media_purge_after = now()
         WHERE id = $1",
    )
    .bind(request_id)
    .execute(tx)
    .await?;
    Ok(())
}
