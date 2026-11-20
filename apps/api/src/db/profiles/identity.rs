//! SQL of the identity document number (12 section 3, 04 section 5.4).

use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::options::DocumentType;
use crate::domain::types::IdentityStatus;

/// The stored identity row, without the encrypted number.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IdentityRow {
    pub document_type: DocumentType,
    pub number_last4: String,
    pub status: IdentityStatus,
    pub verified_at: Option<OffsetDateTime>,
}

/// Reads the profile's identity, taking a row lock when it exists.
pub async fn load_for_update(
    conn: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<Option<IdentityRow>> {
    sqlx::query_as(
        "SELECT document_type, number_last4, status, verified_at
         FROM profile_identity WHERE profile_id = $1 FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_optional(conn)
    .await
}

/// Whether the hash is on the ban list (12 section 3.4 check 1).
pub async fn is_banned(conn: &mut PgConnection, hash: &[u8]) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM banned_identities
                         WHERE kind = 'identity_document' AND value_hash = $1)",
    )
    .bind(hash)
    .fetch_one(conn)
    .await
}

/// Whether another profile already holds the hash (12 section 3.4 check 2).
pub async fn is_taken_by_other(
    conn: &mut PgConnection,
    hash: &[u8],
    profile_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM profile_identity
                         WHERE number_hash = $1 AND profile_id <> $2)",
    )
    .bind(hash)
    .bind(profile_id)
    .fetch_one(conn)
    .await
}

/// Inserts or replaces the identity row with `status = 'unverified'` (12 section 3.5). The
/// unique index on `number_hash` is the last guard against two requests at once: the caller
/// maps its violation to `identity_already_registered`.
pub async fn upsert(
    conn: &mut PgConnection,
    profile_id: Uuid,
    document_type: DocumentType,
    encrypted: &[u8],
    hash: &[u8],
    last4: &str,
) -> sqlx::Result<IdentityRow> {
    sqlx::query_as(
        "INSERT INTO profile_identity
             (profile_id, document_type, number_encrypted, number_hash, number_last4)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (profile_id) DO UPDATE SET
             document_type = EXCLUDED.document_type,
             number_encrypted = EXCLUDED.number_encrypted,
             number_hash = EXCLUDED.number_hash,
             number_last4 = EXCLUDED.number_last4,
             status = 'unverified',
             verified_at = NULL
         RETURNING document_type, number_last4, status, verified_at",
    )
    .bind(profile_id)
    .bind(document_type)
    .bind(encrypted)
    .bind(hash)
    .bind(last4)
    .fetch_one(conn)
    .await
}

/// The summary of the stored identity, or `None` when no number was registered.
pub async fn summary(
    conn: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<Option<IdentityRow>> {
    sqlx::query_as(
        "SELECT document_type, number_last4, status, verified_at
         FROM profile_identity WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_optional(conn)
    .await
}
