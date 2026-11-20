//! SQL for the staff review queues (18 section 4): photos, moderated texts and verification
//! requests, and the writes of their decisions. Kept apart from `db/admin.rs`, which belongs to
//! the rest of the console.
//!
//! The decision functions run inside the caller's transaction. The route that calls them also
//! writes the audit row in that transaction (03 section 8 rule 13) and sends the notification
//! after the commit.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgExecutor};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::db::photos as photos_db;
use crate::domain::options::{
    DocumentType, Gender, ManagedBy, MaritalStatus, PhotoRejectionReason,
    VerificationRejectionReason,
};
use crate::domain::text_enum;
use crate::domain::types::{
    Gesture, IdentityStatus, PhotoStatus, TextStatus, VerificationKind, VerificationStatus,
};

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

/// One row of the photo queue, with the profile facts a moderator needs (18 section 4.2).
#[derive(Debug, sqlx::FromRow)]
pub struct PhotoQueueRow {
    pub photo_id: Uuid,
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    pub gender: Option<Gender>,
    pub date_of_birth: Option<Date>,
    pub status: PhotoStatus,
    pub created_at: OffsetDateTime,
    pub key_large: Option<String>,
    pub moderation: Option<Value>,
    pub has_approved_photo: bool,
    pub is_photo_verified: bool,
    /// 0 for a photo the automatic check flagged, 1 for the others: flagged photos come first.
    pub flag_rank: i16,
}

/// Where the previous page of the photo queue ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoCursor {
    pub flag_rank: i16,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub id: Uuid,
}

/// Photos with a status that have processed files, flagged ones first, then oldest first.
pub async fn photo_queue<'e>(
    db: impl PgExecutor<'e>,
    status: PhotoStatus,
    after: Option<&PhotoCursor>,
    limit: i64,
) -> sqlx::Result<Vec<PhotoQueueRow>> {
    sqlx::query_as(
        "SELECT q.* FROM (
             SELECT ph.id AS photo_id, ph.profile_id, pr.public_code, pr.first_name, pr.gender,
                    pr.date_of_birth, ph.status, ph.created_at, ph.key_large, ph.moderation,
                    pr.has_approved_photo, pr.is_photo_verified,
                    (CASE WHEN ph.moderation ->> 'result' = 'flag' THEN 0 ELSE 1 END)::smallint
                        AS flag_rank
             FROM profile_photos ph JOIN profiles pr ON pr.id = ph.profile_id
             WHERE ph.status = $1 AND ph.key_large IS NOT NULL
         ) q
         WHERE $2::smallint IS NULL OR (q.flag_rank, q.created_at, q.photo_id) > ($2, $3, $4)
         ORDER BY q.flag_rank, q.created_at, q.photo_id
         LIMIT $5",
    )
    .bind(status)
    .bind(after.map(|c| c.flag_rank))
    .bind(after.map(|c| c.created_at))
    .bind(after.map(|c| c.id))
    .bind(limit)
    .fetch_all(db)
    .await
}

/// A photo shown beside the one under review.
#[derive(Debug, sqlx::FromRow)]
pub struct SiblingPhoto {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub status: PhotoStatus,
    pub is_primary: bool,
    pub key_medium: Option<String>,
}

/// The photos of several profiles that have a medium variant, in display order.
pub async fn sibling_photos<'e>(
    db: impl PgExecutor<'e>,
    profile_ids: &[Uuid],
) -> sqlx::Result<Vec<SiblingPhoto>> {
    sqlx::query_as(
        "SELECT id, profile_id, status, is_primary, key_medium FROM profile_photos
         WHERE profile_id = ANY($1) AND key_medium IS NOT NULL
         ORDER BY profile_id, position, created_at, id",
    )
    .bind(profile_ids)
    .fetch_all(db)
    .await
}

/// The owner of a photo: `(profile_id, user_id)`.
pub async fn photo_owner<'e>(
    db: impl PgExecutor<'e>,
    photo_id: Uuid,
) -> sqlx::Result<Option<(Uuid, Uuid)>> {
    sqlx::query_as(
        "SELECT ph.profile_id, p.user_id FROM profile_photos ph
         JOIN profiles p ON p.id = ph.profile_id WHERE ph.id = $1",
    )
    .bind(photo_id)
    .fetch_optional(db)
    .await
}

/// Marks a photo approved by a moderator (18 section 4.2). The caller then calls
/// [`photos_db::settle`] for the primary photo, `has_approved_photo` and `completeness`.
pub async fn mark_photo_approved(
    tx: &mut PgConnection,
    photo_id: Uuid,
    reviewer: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profile_photos
         SET status = 'approved', rejection_reason = NULL, reviewed_by = $2, reviewed_at = now()
         WHERE id = $1",
    )
    .bind(photo_id)
    .bind(reviewer)
    .execute(tx)
    .await?;
    Ok(())
}

/// Marks a photo rejected by a moderator. A primary photo stops being primary when the caller
/// calls [`photos_db::settle`].
pub async fn mark_photo_rejected(
    tx: &mut PgConnection,
    photo_id: Uuid,
    reason: PhotoRejectionReason,
    reviewer: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE profile_photos
         SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = now()
         WHERE id = $1",
    )
    .bind(photo_id)
    .bind(reason)
    .bind(reviewer)
    .execute(tx)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Moderated texts
// ---------------------------------------------------------------------------------------------

text_enum! {
    /// The three moderated free-text fields (13 section 3.7).
    ModeratedField {
        AboutMe = "about_me",
        AboutFamily = "about_family",
        PartnerNotes = "partner_notes",
    }
}

impl ModeratedField {
    /// The table that holds the field.
    const fn table(self) -> &'static str {
        match self {
            Self::AboutMe => "profiles",
            Self::AboutFamily => "profile_family",
            Self::PartnerNotes => "partner_preferences",
        }
    }

    /// The column that holds the profile id in that table.
    const fn key_column(self) -> &'static str {
        match self {
            Self::AboutMe => "id",
            Self::AboutFamily | Self::PartnerNotes => "profile_id",
        }
    }

    const fn text_column(self) -> &'static str {
        match self {
            Self::AboutMe => "about_me",
            Self::AboutFamily => "about_family",
            Self::PartnerNotes => "notes",
        }
    }

    const fn status_column(self) -> &'static str {
        match self {
            Self::AboutMe => "about_me_status",
            Self::AboutFamily => "about_family_status",
            Self::PartnerNotes => "notes_status",
        }
    }

    /// The `dedupe_key` of the field's `moderate_text` job (19 section 2.1).
    pub fn job_key(self, profile_id: Uuid) -> String {
        format!("{profile_id}:{self}")
    }
}

/// The hex SHA-256 of a text: what a moderator reads is identified by it, so a decision cannot
/// land on text that changed in the meantime (18 section 4.3 rule 1).
pub fn text_sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

/// A moderated text with its status and owner.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TextRow {
    pub profile_id: Uuid,
    pub user_id: Uuid,
    pub text: Option<String>,
    pub status: TextStatus,
}

/// Loads one moderated text. With `lock` the row stays locked until the transaction ends.
pub async fn load_text<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
    field: ModeratedField,
    lock: bool,
) -> sqlx::Result<Option<TextRow>> {
    let (table, key, text, status) = (
        field.table(),
        field.key_column(),
        field.text_column(),
        field.status_column(),
    );
    let lock = if lock { "FOR UPDATE OF t" } else { "" };
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT p.id AS profile_id, p.user_id, t.{text} AS text, t.{status} AS status
         FROM {table} t JOIN profiles p ON p.id = t.{key}
         WHERE t.{key} = $1 {lock}"
    )))
    .bind(profile_id)
    .fetch_optional(db)
    .await
}

/// Changes the status of a text that is still `pending` and still reads `text`. Returns false
/// when the member saved again or a moderator decided first, so nothing was written.
pub async fn set_text_status_if_unchanged(
    tx: &mut PgConnection,
    profile_id: Uuid,
    field: ModeratedField,
    text: Option<&str>,
    status: TextStatus,
) -> sqlx::Result<bool> {
    let (table, key, column, status_column) = (
        field.table(),
        field.key_column(),
        field.text_column(),
        field.status_column(),
    );
    let result = sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {table} SET {status_column} = $2
         WHERE {key} = $1 AND {status_column} = 'pending' AND {column} IS NOT DISTINCT FROM $3"
    )))
    .bind(profile_id)
    .bind(status)
    .bind(text)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        return Ok(false);
    }
    // A decided text changes what the profile shows, so recommendations and completeness follow.
    sqlx::query("UPDATE profiles SET match_stale = true WHERE id = $1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    photos_db::recompute_completeness(tx, profile_id).await?;
    Ok(true)
}

/// One text waiting for a person (18 section 4.3).
#[derive(Debug, sqlx::FromRow)]
pub struct TextQueueRow {
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    pub gender: Option<Gender>,
    pub field: ModeratedField,
    pub text: Option<String>,
    pub updated_at: OffsetDateTime,
}

/// Where the previous page of the text queue ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextCursor {
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub profile_id: Uuid,
    pub field: String,
}

/// Pending texts with no `moderate_text` job still queued or running for them, oldest first.
pub async fn text_queue<'e>(
    db: impl PgExecutor<'e>,
    after: Option<&TextCursor>,
    limit: i64,
) -> sqlx::Result<Vec<TextQueueRow>> {
    sqlx::query_as(
        "SELECT q.profile_id, q.public_code, q.first_name, q.gender, q.field, q.text, q.updated_at
         FROM (
             SELECT p.id AS profile_id, p.public_code, p.first_name, p.gender,
                    'about_me'::text AS field, p.about_me AS text, p.updated_at
             FROM profiles p
             WHERE p.about_me_status = 'pending' AND p.status <> 'deleted'
               AND NOT EXISTS (SELECT 1 FROM jobs j
                                WHERE j.kind = 'moderate_text' AND j.status IN ('queued', 'running')
                                  AND j.dedupe_key = p.id::text || ':about_me')
             UNION ALL
             SELECT p.id, p.public_code, p.first_name, p.gender,
                    'about_family', f.about_family, f.updated_at
             FROM profile_family f JOIN profiles p ON p.id = f.profile_id
             WHERE f.about_family_status = 'pending' AND p.status <> 'deleted'
               AND NOT EXISTS (SELECT 1 FROM jobs j
                                WHERE j.kind = 'moderate_text' AND j.status IN ('queued', 'running')
                                  AND j.dedupe_key = f.profile_id::text || ':about_family')
             UNION ALL
             SELECT p.id, p.public_code, p.first_name, p.gender,
                    'partner_notes', pp.notes, pp.updated_at
             FROM partner_preferences pp JOIN profiles p ON p.id = pp.profile_id
             WHERE pp.notes_status = 'pending' AND p.status <> 'deleted'
               AND NOT EXISTS (SELECT 1 FROM jobs j
                                WHERE j.kind = 'moderate_text' AND j.status IN ('queued', 'running')
                                  AND j.dedupe_key = pp.profile_id::text || ':partner_notes')
         ) q
         WHERE $1::timestamptz IS NULL OR (q.updated_at, q.profile_id, q.field) > ($1, $2, $3)
         ORDER BY q.updated_at, q.profile_id, q.field
         LIMIT $4",
    )
    .bind(after.map(|c| c.updated_at))
    .bind(after.map(|c| c.profile_id))
    .bind(after.map(|c| c.field.as_str()))
    .bind(limit)
    .fetch_all(db)
    .await
}

// ---------------------------------------------------------------------------------------------
// Verification requests
// ---------------------------------------------------------------------------------------------

/// A request with the owner's user id, as the review routes load it.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct VerificationRow {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub user_id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub front_key: Option<String>,
    pub back_key: Option<String>,
    pub selfie_key: Option<String>,
    pub gesture: Option<Gesture>,
    pub created_at: OffsetDateTime,
    pub media_purged_at: Option<OffsetDateTime>,
}

/// Loads a request by id. With `lock` the row stays locked until the transaction ends.
pub async fn verification<'e>(
    db: impl PgExecutor<'e>,
    request_id: Uuid,
    lock: bool,
) -> sqlx::Result<Option<VerificationRow>> {
    let lock = if lock { "FOR UPDATE OF v" } else { "" };
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT v.id, v.profile_id, p.user_id, v.kind, v.status, v.front_key, v.back_key,
                v.selfie_key, v.gesture, v.created_at, v.media_purged_at
         FROM verification_requests v JOIN profiles p ON p.id = v.profile_id
         WHERE v.id = $1 {lock}"
    )))
    .bind(request_id)
    .fetch_optional(db)
    .await
}

/// One row of the verification queue (18 section 4.4).
#[derive(Debug, sqlx::FromRow)]
pub struct VerificationQueueRow {
    pub request_id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    pub created_at: OffsetDateTime,
}

/// Where the previous page of the verification queue ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationCursor {
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub id: Uuid,
}

/// Requests of a status, optionally of one kind, oldest first.
pub async fn verification_queue<'e>(
    db: impl PgExecutor<'e>,
    status: VerificationStatus,
    kind: Option<VerificationKind>,
    after: Option<&VerificationCursor>,
    limit: i64,
) -> sqlx::Result<Vec<VerificationQueueRow>> {
    sqlx::query_as(
        "SELECT v.id AS request_id, v.kind, v.status, v.profile_id, p.public_code, p.first_name,
                v.created_at
         FROM verification_requests v JOIN profiles p ON p.id = v.profile_id
         WHERE v.status = $1 AND ($2::text IS NULL OR v.kind = $2)
           AND ($3::timestamptz IS NULL OR (v.created_at, v.id) > ($3, $4))
         ORDER BY v.created_at, v.id
         LIMIT $5",
    )
    .bind(status)
    .bind(kind)
    .bind(after.map(|c| c.created_at))
    .bind(after.map(|c| c.id))
    .bind(limit)
    .fetch_all(db)
    .await
}

/// The profile facts a moderator compares with the documents.
#[derive(Debug, sqlx::FromRow)]
pub struct ProfileFacts {
    pub profile_id: Uuid,
    pub public_code: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    pub date_of_birth: Option<Date>,
    pub marital_status: Option<MaritalStatus>,
    pub managed_by: Option<ManagedBy>,
    pub manager_name: Option<String>,
}

pub async fn profile_facts<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
) -> sqlx::Result<Option<ProfileFacts>> {
    sqlx::query_as(
        "SELECT id AS profile_id, public_code, first_name, last_name, gender, date_of_birth,
                marital_status, managed_by, manager_name
         FROM profiles WHERE id = $1",
    )
    .bind(profile_id)
    .fetch_optional(db)
    .await
}

/// The registered identity, still encrypted.
#[derive(Debug, sqlx::FromRow)]
pub struct IdentityRecord {
    pub document_type: DocumentType,
    pub number_encrypted: Vec<u8>,
    pub status: IdentityStatus,
}

pub async fn identity_record<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
) -> sqlx::Result<Option<IdentityRecord>> {
    sqlx::query_as(
        "SELECT document_type, number_encrypted, status FROM profile_identity WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_optional(db)
    .await
}

/// An earlier request of the same profile.
#[derive(Debug, sqlx::FromRow)]
pub struct PreviousRequest {
    pub id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub rejection_reason: Option<VerificationRejectionReason>,
    pub created_at: OffsetDateTime,
}

/// The ten newest other requests of a profile.
pub async fn previous_requests<'e>(
    db: impl PgExecutor<'e>,
    profile_id: Uuid,
    except: Uuid,
) -> sqlx::Result<Vec<PreviousRequest>> {
    sqlx::query_as(
        "SELECT id, kind, status, rejection_reason, created_at FROM verification_requests
         WHERE profile_id = $1 AND id <> $2 ORDER BY created_at DESC, id DESC LIMIT 10",
    )
    .bind(profile_id)
    .bind(except)
    .fetch_all(db)
    .await
}

/// What approving a request did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Approval {
    Approved,
    /// A selfie cannot vouch for photos when the profile has no approved photo left.
    NoApprovedPhoto,
}

/// Approves a pending request with the effects of 12 sections 4.5 and 5.4 and 03 section 4.6:
/// the request, `profile_identity.status` and the badges of the profile, `media_purge_after`,
/// `match_stale` and `completeness`. An approved identity check also sets `is_photo_verified`
/// when the moderator confirmed the selfie matches the photos (`photos_match`) and the profile
/// has an approved photo. Names are locked by `is_id_verified` itself (03 section 8 rule 15).
pub async fn approve_verification(
    tx: &mut PgConnection,
    request: &VerificationRow,
    reviewer: Uuid,
    retention_days: i64,
    photos_match: bool,
) -> sqlx::Result<Approval> {
    let has_photo: bool =
        sqlx::query_scalar("SELECT has_approved_photo FROM profiles WHERE id = $1")
            .bind(request.profile_id)
            .fetch_one(&mut *tx)
            .await?;
    match request.kind {
        VerificationKind::Selfie if !has_photo => return Ok(Approval::NoApprovedPhoto),
        VerificationKind::Selfie => {
            sqlx::query(
                "UPDATE profiles SET is_photo_verified = true, match_stale = true WHERE id = $1",
            )
            .bind(request.profile_id)
            .execute(&mut *tx)
            .await?;
        }
        VerificationKind::IdDocument => {
            sqlx::query(
                "UPDATE profile_identity SET status = 'verified', verified_at = now()
                 WHERE profile_id = $1",
            )
            .bind(request.profile_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE profiles
                 SET is_id_verified = true,
                     is_photo_verified = is_photo_verified OR ($2 AND has_approved_photo),
                     match_stale = true
                 WHERE id = $1",
            )
            .bind(request.profile_id)
            .bind(photos_match)
            .execute(&mut *tx)
            .await?;
        }
    }
    decide_request(
        tx,
        request.id,
        VerificationStatus::Approved,
        None,
        None,
        reviewer,
        retention_days,
    )
    .await?;
    photos_db::recompute_completeness(tx, request.profile_id).await?;
    Ok(Approval::Approved)
}

/// Rejects a pending request (12 sections 4.5 and 5.4): the request keeps the reason and the
/// staff-only note, and a rejected identity check leaves `profile_identity.status = 'rejected'`.
pub async fn reject_verification(
    tx: &mut PgConnection,
    request: &VerificationRow,
    reviewer: Uuid,
    retention_days: i64,
    reason: VerificationRejectionReason,
    note: Option<&str>,
) -> sqlx::Result<()> {
    if request.kind == VerificationKind::IdDocument {
        sqlx::query("UPDATE profile_identity SET status = 'rejected' WHERE profile_id = $1")
            .bind(request.profile_id)
            .execute(&mut *tx)
            .await?;
    }
    decide_request(
        tx,
        request.id,
        VerificationStatus::Rejected,
        Some(reason),
        note,
        reviewer,
        retention_days,
    )
    .await?;
    photos_db::recompute_completeness(tx, request.profile_id)
        .await
        .map(|_| ())
}

/// Writes the decision on the request row and starts the clock of the image retention
/// (12 section 6).
async fn decide_request(
    tx: &mut PgConnection,
    request_id: Uuid,
    status: VerificationStatus,
    reason: Option<VerificationRejectionReason>,
    note: Option<&str>,
    reviewer: Uuid,
    retention_days: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE verification_requests
         SET status = $2, rejection_reason = $3, reviewer_note = $4, reviewed_by = $5,
             reviewed_at = now(), media_purge_after = now() + make_interval(days => $6)
         WHERE id = $1",
    )
    .bind(request_id)
    .bind(status)
    .bind(reason)
    .bind(note)
    .bind(reviewer)
    .bind(i32::try_from(retention_days).unwrap_or(i32::MAX))
    .execute(tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_hash_is_lowercase_hex_sha256() {
        assert_eq!(
            text_sha256("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(text_sha256("abc"), text_sha256("abc "));
    }

    #[test]
    fn job_keys_match_the_dedupe_keys_of_moderate_text() {
        let id = Uuid::nil();
        assert_eq!(
            ModeratedField::PartnerNotes.job_key(id),
            format!("{id}:partner_notes")
        );
        assert_eq!(
            ModeratedField::parse("about_family"),
            Some(ModeratedField::AboutFamily)
        );
        assert_eq!(ModeratedField::parse("notes"), None);
    }
}
