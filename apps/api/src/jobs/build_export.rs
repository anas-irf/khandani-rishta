//! The `build_export` job (19 section 2.14): collects the data of 09 section 12.1 into one JSON
//! file at `exports/{user_id}/{export_id}.json`, marks the export `ready` for 7 days, and
//! enqueues the `export_ready` email.
//!
//! Identity numbers never leave: only the document type, the last four characters, the status
//! and the verification date of `profile_identity` are included (03 section 8 rule 5).

use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::domain::display::{NameParts, display_name};
use crate::domain::options::NameDisplay;
use crate::domain::types::{ExportStatus, Tier};
use crate::jobs::{ClaimedJob, JobOutcome, payload};
use crate::notify::queue_email;
use crate::state::AppState;

/// How long the signed link of an approved photo in the file stays valid (09 section 12.1).
const PHOTO_LINK_TTL: Duration = Duration::from_hours(7 * 24);

#[derive(Debug, Deserialize)]
struct Payload {
    export_id: Uuid,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    let row: Option<(Uuid, ExportStatus)> =
        sqlx::query_as("SELECT user_id, status FROM data_exports WHERE id = $1")
            .bind(payload.export_id)
            .fetch_optional(&state.db)
            .await?;
    let Some((user_id, status)) = row else {
        return Ok(JobOutcome::Skipped("no such export".to_owned()));
    };
    if status != ExportStatus::Queued {
        return Ok(JobOutcome::Skipped("not queued".to_owned()));
    }
    match build(state, user_id, payload.export_id).await {
        Ok(()) => Ok(JobOutcome::Done),
        Err(error) => {
            if job.is_last_attempt() {
                sqlx::query(
                    "UPDATE data_exports SET status = 'failed' WHERE id = $1 AND status = 'queued'",
                )
                .bind(payload.export_id)
                .execute(&state.db)
                .await?;
            }
            Err(error)
        }
    }
}

async fn build(state: &AppState, user_id: Uuid, export_id: Uuid) -> anyhow::Result<()> {
    let document = collect(state, user_id).await?;
    let key = format!("exports/{user_id}/{export_id}.json");
    state
        .storage
        .put(
            &key,
            serde_json::to_vec_pretty(&document)?,
            "application/json",
        )
        .await?;

    let mut tx = state.db.begin().await?;
    let expires_at: Option<OffsetDateTime> = sqlx::query_scalar(
        "UPDATE data_exports
         SET status = 'ready', file_key = $2, expires_at = now() + interval '7 days'
         WHERE id = $1 AND status = 'queued'
         RETURNING expires_at",
    )
    .bind(export_id)
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(expires_at) = expires_at else {
        return Ok(());
    };
    queue_email(
        &mut *tx,
        user_id,
        "export_ready",
        json!({ "export_id": export_id, "expires_at": expires_at.unix_timestamp() }),
        Some(format!("export_ready:{export_id}")),
    )
    .await?;
    tx.commit().await?;
    state.jobs.wake();
    tracing::info!(event = "account.export_ready", %user_id, %export_id, "data export ready");
    Ok(())
}

/// One JSON value from a query that selects a single `jsonb` column (`null` when no row).
async fn one(db: &PgPool, sql: &'static str, id: Uuid) -> sqlx::Result<Value> {
    let row: Option<Option<Value>> = sqlx::query_scalar::<_, Option<Value>>(sql)
        .bind(id)
        .fetch_optional(db)
        .await?;
    Ok(row.flatten().unwrap_or(Value::Null))
}

fn rfc3339(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap_or_default()
}

/// Everything of 09 section 12.1, in one document.
#[allow(clippy::too_many_lines)] // One query per row of the table of 12.1.
async fn collect(state: &AppState, user_id: Uuid) -> anyhow::Result<Value> {
    let db = &state.db;
    let profile_id: Uuid = sqlx::query_scalar("SELECT id FROM profiles WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(db)
        .await?;

    let user = one(
        db,
        "SELECT to_jsonb(u) - 'clerk_user_id' FROM users u WHERE u.id = $1",
        user_id,
    )
    .await?;
    let consents = one(
        db,
        "SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.accepted_at, c.id), '[]'::jsonb)
         FROM user_consents c WHERE c.user_id = $1",
        user_id,
    )
    .await?;
    let profile = one(
        db,
        "SELECT to_jsonb(p) FROM profiles p WHERE p.id = $1",
        profile_id,
    )
    .await?;
    let family = one(
        db,
        "SELECT to_jsonb(f) FROM profile_family f WHERE f.profile_id = $1",
        profile_id,
    )
    .await?;
    let contacts = one(
        db,
        "SELECT to_jsonb(c) FROM profile_contacts c WHERE c.profile_id = $1",
        profile_id,
    )
    .await?;
    let preferences = one(
        db,
        "SELECT to_jsonb(p) FROM partner_preferences p WHERE p.profile_id = $1",
        profile_id,
    )
    .await?;
    let privacy = one(
        db,
        "SELECT to_jsonb(p) FROM profile_privacy p WHERE p.profile_id = $1",
        profile_id,
    )
    .await?;
    let identity = one(
        db,
        "SELECT jsonb_build_object('document_type', document_type, 'number_last4', number_last4,
                                   'status', status, 'verified_at', verified_at)
         FROM profile_identity WHERE profile_id = $1",
        profile_id,
    )
    .await?;
    let languages = one(
        db,
        "SELECT COALESCE(jsonb_agg(language_code ORDER BY language_code), '[]'::jsonb)
         FROM profile_languages WHERE profile_id = $1",
        profile_id,
    )
    .await?;
    let hobbies = one(
        db,
        "SELECT COALESCE(jsonb_agg(hobby_code ORDER BY hobby_code), '[]'::jsonb)
         FROM profile_hobbies WHERE profile_id = $1",
        profile_id,
    )
    .await?;
    let photos = photos(state, profile_id).await?;
    let verification_requests = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', id, 'kind', kind, 'status', status, 'rejection_reason', rejection_reason,
                'created_at', created_at, 'reviewed_at', reviewed_at) ORDER BY created_at, id), '[]'::jsonb)
         FROM verification_requests WHERE profile_id = $1",
        profile_id,
    )
    .await?;
    let interests = interests(db, profile_id).await?;
    let connections = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', c.id, 'status', c.status, 'stage', c.stage, 'ended_reason', c.ended_reason,
                'created_at', c.created_at, 'ended_at', c.ended_at,
                'other_profile_code', o.public_code) ORDER BY c.created_at, c.id), '[]'::jsonb)
         FROM connections c
         JOIN profiles o ON o.id = CASE WHEN c.profile_low_id = $1 THEN c.profile_high_id
                                        ELSE c.profile_low_id END
         WHERE c.profile_low_id = $1 OR c.profile_high_id = $1",
        profile_id,
    )
    .await?;
    let stage_proposals = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', p.id, 'connection_id', p.connection_id, 'stage', p.stage, 'status', p.status,
                'proposed_by_me', p.proposed_by_profile_id = $1,
                'created_at', p.created_at, 'responded_at', p.responded_at)
                ORDER BY p.created_at, p.id), '[]'::jsonb)
         FROM connection_stage_proposals p JOIN connections c ON c.id = p.connection_id
         WHERE c.profile_low_id = $1 OR c.profile_high_id = $1",
        profile_id,
    )
    .await?;
    let contact_shares = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'connection_id', s.connection_id, 'share_phone', s.share_phone,
                'share_whatsapp', s.share_whatsapp, 'share_email', s.share_email,
                'share_guardian', s.share_guardian, 'status', s.status,
                'created_at', s.created_at, 'revoked_at', s.revoked_at)
                ORDER BY s.created_at, s.id), '[]'::jsonb)
         FROM contact_shares s WHERE s.sharer_profile_id = $1",
        profile_id,
    )
    .await?;
    let messages = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', m.id, 'connection_id', m.connection_id,
                'sender', CASE WHEN m.kind = 'system' THEN 'system'
                               WHEN m.sender_profile_id = $1 THEN 'me' ELSE 'them' END,
                'kind', m.kind, 'body', m.body, 'system_event', m.system_event,
                'created_at', m.created_at) ORDER BY m.connection_id, m.id), '[]'::jsonb)
         FROM messages m JOIN connections c ON c.id = m.connection_id
         WHERE (c.profile_low_id = $1 OR c.profile_high_id = $1) AND m.deleted_at IS NULL",
        profile_id,
    )
    .await?;
    let shortlists = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'profile_code', o.public_code, 'note', s.note, 'created_at', s.created_at)
                ORDER BY s.created_at, o.public_code), '[]'::jsonb)
         FROM shortlists s JOIN profiles o ON o.id = s.target_profile_id WHERE s.profile_id = $1",
        profile_id,
    )
    .await?;
    let passes = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'profile_code', o.public_code, 'expires_at', s.expires_at, 'created_at', s.created_at)
                ORDER BY s.created_at, o.public_code), '[]'::jsonb)
         FROM passes s JOIN profiles o ON o.id = s.target_profile_id WHERE s.profile_id = $1",
        profile_id,
    )
    .await?;
    let blocks = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'profile_code', o.public_code, 'created_at', b.created_at)
                ORDER BY b.created_at, o.public_code), '[]'::jsonb)
         FROM blocks b JOIN profiles o ON o.id = b.blocked_profile_id
         WHERE b.blocker_profile_id = $1",
        profile_id,
    )
    .await?;
    let saved_searches = one(
        db,
        "SELECT COALESCE(jsonb_agg(to_jsonb(s) - 'profile_id' ORDER BY s.created_at, s.id), '[]'::jsonb)
         FROM saved_searches s WHERE s.profile_id = $1",
        profile_id,
    )
    .await?;
    let profile_views = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'profile_code', o.public_code, 'viewed_on', v.viewed_on,
                'view_count', v.view_count, 'last_viewed_at', v.last_viewed_at)
                ORDER BY v.viewed_on, o.public_code), '[]'::jsonb)
         FROM profile_views v JOIN profiles o ON o.id = v.viewed_profile_id
         WHERE v.viewer_profile_id = $1",
        profile_id,
    )
    .await?;
    let photo_access = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'role', CASE WHEN a.owner_profile_id = $1 THEN 'owner' ELSE 'viewer' END,
                'profile_code', o.public_code, 'status', a.status,
                'decided_at', a.decided_at, 'created_at', a.created_at)
                ORDER BY a.created_at, a.id), '[]'::jsonb)
         FROM photo_access a
         JOIN profiles o ON o.id = CASE WHEN a.owner_profile_id = $1 THEN a.viewer_profile_id
                                        ELSE a.owner_profile_id END
         WHERE a.owner_profile_id = $1 OR a.viewer_profile_id = $1",
        profile_id,
    )
    .await?;
    let notifications = one(
        db,
        "SELECT COALESCE(jsonb_agg(to_jsonb(n) - 'user_id' ORDER BY n.created_at, n.id), '[]'::jsonb)
         FROM notifications n WHERE n.user_id = $1",
        user_id,
    )
    .await?;
    let notification_preferences = one(
        db,
        "SELECT to_jsonb(p) - 'user_id' FROM notification_preferences p WHERE p.user_id = $1",
        user_id,
    )
    .await?;
    let reports_filed = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id, 'subject_type', r.subject_type, 'reason', r.reason,
                'details', r.details, 'status', r.status, 'created_at', r.created_at)
                ORDER BY r.created_at, r.id), '[]'::jsonb)
         FROM reports r WHERE r.reporter_profile_id = $1",
        profile_id,
    )
    .await?;
    let sanctions = one(
        db,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'type', s.type, 'reason', s.reason, 'starts_at', s.starts_at,
                'ends_at', s.ends_at, 'revoked_at', s.revoked_at)
                ORDER BY s.created_at, s.id), '[]'::jsonb)
         FROM sanctions s WHERE s.user_id = $1",
        user_id,
    )
    .await?;

    Ok(json!({
        "generated_at": rfc3339(OffsetDateTime::now_utc()),
        "users": user,
        "user_consents": consents,
        "profiles": profile,
        "profile_family": family,
        "profile_contacts": contacts,
        "partner_preferences": preferences,
        "profile_privacy": privacy,
        "profile_identity": identity,
        "profile_languages": languages,
        "profile_hobbies": hobbies,
        "profile_photos": photos,
        "verification_requests": verification_requests,
        "interests": interests,
        "connections": connections,
        "connection_stage_proposals": stage_proposals,
        "contact_shares": contact_shares,
        "messages": messages,
        "shortlists": shortlists,
        "passes": passes,
        "blocks": blocks,
        "saved_searches": saved_searches,
        "profile_views": profile_views,
        "photo_access": photo_access,
        "notifications": notifications,
        "notification_preferences": notification_preferences,
        "reports": reports_filed,
        "sanctions": sanctions,
    }))
}

#[derive(sqlx::FromRow)]
struct PhotoRow {
    id: Uuid,
    status: String,
    is_primary: bool,
    position: i16,
    rejection_reason: Option<String>,
    created_at: OffsetDateTime,
    reviewed_at: Option<OffsetDateTime>,
    key_large: Option<String>,
}

/// Status, dates and a 7-day signed URL of the large variant of each approved photo.
async fn photos(state: &AppState, profile_id: Uuid) -> anyhow::Result<Value> {
    let rows: Vec<PhotoRow> = sqlx::query_as(
        "SELECT id, status, is_primary, position, rejection_reason, created_at, reviewed_at, key_large
         FROM profile_photos WHERE profile_id = $1 ORDER BY position, created_at, id",
    )
    .bind(profile_id)
    .fetch_all(&state.db)
    .await?;
    let mut photos = Vec::with_capacity(rows.len());
    for photo in rows {
        let url = match (&photo.key_large, photo.status.as_str()) {
            (Some(key), "approved") => match state.storage.presign_get(key, PHOTO_LINK_TTL).await {
                Ok(url) => Some(url),
                Err(error) => {
                    tracing::warn!(%error, "could not sign a photo URL for an export");
                    None
                }
            },
            _ => None,
        };
        photos.push(json!({
            "id": photo.id,
            "status": photo.status,
            "is_primary": photo.is_primary,
            "position": photo.position,
            "rejection_reason": photo.rejection_reason,
            "created_at": rfc3339(photo.created_at),
            "reviewed_at": photo.reviewed_at.map(rfc3339),
            "large_url": url,
        }));
    }
    Ok(Value::Array(photos))
}

#[derive(sqlx::FromRow)]
struct InterestRow {
    id: Uuid,
    status: String,
    message: Option<String>,
    created_at: OffsetDateTime,
    responded_at: Option<OffsetDateTime>,
    expires_at: OffsetDateTime,
    sent_by_me: bool,
    other_public_code: String,
    first_name: Option<String>,
    last_name: Option<String>,
    name_display: Option<NameDisplay>,
    other_visible: bool,
    active_connection: bool,
}

/// Interests sent and received, with the other profile's code and the display name as it is
/// currently visible to the member. A profile that is gone, hidden or blocked shows no name.
async fn interests(db: &PgPool, profile_id: Uuid) -> anyhow::Result<Value> {
    let rows: Vec<InterestRow> = sqlx::query_as(
        "SELECT i.id, i.status, i.message, i.created_at, i.responded_at, i.expires_at,
                (i.sender_profile_id = $1) AS sent_by_me,
                o.public_code AS other_public_code, o.first_name, o.last_name, pv.name_display,
                (ou.status = 'active' AND o.status IN ('active', 'paused', 'closed')
                 AND NOT EXISTS (SELECT 1 FROM blocks b
                                  WHERE (b.blocker_profile_id = $1 AND b.blocked_profile_id = o.id)
                                     OR (b.blocker_profile_id = o.id AND b.blocked_profile_id = $1))
                ) AS other_visible,
                EXISTS (SELECT 1 FROM connections c
                         WHERE c.status = 'active'
                           AND c.profile_low_id = LEAST($1::uuid, o.id)
                           AND c.profile_high_id = GREATEST($1::uuid, o.id)) AS active_connection
         FROM interests i
         JOIN profiles o ON o.id = CASE WHEN i.sender_profile_id = $1 THEN i.receiver_profile_id
                                        ELSE i.sender_profile_id END
         JOIN users ou ON ou.id = o.user_id
         LEFT JOIN profile_privacy pv ON pv.profile_id = o.id
         WHERE i.sender_profile_id = $1 OR i.receiver_profile_id = $1
         ORDER BY i.created_at, i.id",
    )
    .bind(profile_id)
    .fetch_all(db)
    .await?;
    let items = rows
        .into_iter()
        .map(|row| {
            let tier = if row.active_connection {
                Tier::Connection
            } else if row.status == "pending" {
                if row.sent_by_me {
                    Tier::InterestToOwner
                } else {
                    Tier::InterestFromOwner
                }
            } else {
                Tier::Member
            };
            let name = match (&row.first_name, &row.last_name) {
                (Some(first), Some(last)) if row.other_visible => Some(display_name(
                    NameParts {
                        first_name: first,
                        last_name: last,
                        public_code: &row.other_public_code,
                    },
                    row.name_display
                        .unwrap_or(NameDisplay::FirstNameLastInitial),
                    tier,
                )),
                _ => None,
            };
            json!({
                "id": row.id,
                "direction": if row.sent_by_me { "sent" } else { "received" },
                "status": row.status,
                "message": row.message,
                "profile_code": row.other_public_code,
                "display_name": name,
                "created_at": rfc3339(row.created_at),
                "responded_at": row.responded_at.map(rfc3339),
                "expires_at": rfc3339(row.expires_at),
            })
        })
        .collect();
    Ok(Value::Array(items))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::Value;
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::domain::options::Gender;
    use crate::services::r2::ObjectStore;
    use crate::test_support::TestApp;

    #[sqlx::test]
    async fn the_export_holds_the_member_data_and_no_identity_number(db: PgPool) {
        let app = TestApp::new(db).await;
        let member = app.member().await;
        let other = app.member_of(Gender::Female).await;
        let db = app.db();

        sqlx::query(
            "INSERT INTO profile_identity (profile_id, document_type, number_encrypted, number_hash, number_last4, status)
             VALUES ($1, 'cnic', $2, $3, '5671', 'verified')",
        )
        .bind(member.profile_id)
        .bind(app.state.crypto.encrypt_identity(member.profile_id, "3520212345671"))
        .bind(app.state.crypto.keyed_hash("pk_id", "3520212345671"))
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO profile_contacts (profile_id, phone_e164) VALUES ($1, '+923001234567')",
        )
        .bind(member.profile_id)
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO profile_photos (profile_id, status, upload_key, key_large, is_primary)
             VALUES ($1, 'approved', 'tmp/a', 'photos/p/large.jpg', true),
                    ($1, 'rejected', 'tmp/b', 'photos/p/other.jpg', false)",
        )
        .bind(member.profile_id)
        .execute(db)
        .await
        .unwrap();
        let (low, high) = crate::lifecycle::ordered_pair(member.profile_id, other.profile_id);
        let interest_id: Uuid = sqlx::query_scalar(
            "INSERT INTO interests (sender_profile_id, receiver_profile_id, status, message, expires_at)
             VALUES ($1, $2, 'accepted', 'Salam', now()) RETURNING id",
        )
        .bind(member.profile_id)
        .bind(other.profile_id)
        .fetch_one(db)
        .await
        .unwrap();
        let connection_id: Uuid = sqlx::query_scalar(
            "INSERT INTO connections (profile_low_id, profile_high_id, interest_id) VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(low)
        .bind(high)
        .bind(interest_id)
        .fetch_one(db)
        .await
        .unwrap();
        for (sender, body) in [
            (member.profile_id, "from me"),
            (other.profile_id, "from them"),
        ] {
            sqlx::query("INSERT INTO messages (id, connection_id, sender_profile_id, body) VALUES ($1, $2, $3, $4)")
                .bind(Uuid::now_v7())
                .bind(connection_id)
                .bind(sender)
                .bind(body)
                .execute(db)
                .await
                .unwrap();
        }
        // Data that must not be in the file: reports about the member and moderator notes.
        sqlx::query("INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason, details) VALUES ($1, $2, 'profile', 'other', 'secret complaint')")
            .bind(other.profile_id)
            .bind(member.profile_id)
            .execute(db)
            .await
            .unwrap();

        let response = app.post_empty("/v1/me/exports", Some(&member.token)).await;
        assert_eq!(response.status, StatusCode::ACCEPTED);
        assert_eq!(response.json["status"], "queued");
        app.drain_jobs().await;

        let latest = app.get("/v1/me/exports/latest", Some(&member.token)).await;
        assert_eq!(latest.status, StatusCode::OK);
        assert_eq!(latest.json["status"], "ready");
        assert!(
            latest.json["download_url"]
                .as_str()
                .unwrap()
                .starts_with("https://storage.test/exports/")
        );
        assert!(latest.json["expires_at"].is_string());

        let keys = app.storage.keys();
        assert_eq!(keys.len(), 1);
        assert!(keys[0].starts_with(&format!("exports/{}/", member.user_id)));
        assert!(
            std::path::Path::new(&keys[0])
                .extension()
                .is_some_and(|extension| extension == "json")
        );
        let bytes = app.storage.get(&keys[0]).await.unwrap().unwrap();
        let text = String::from_utf8(bytes).unwrap();
        let document: Value = serde_json::from_str(&text).unwrap();

        // The identity number never leaves; only the last four characters do.
        assert!(!text.contains("3520212345671"));
        assert_eq!(document["profile_identity"]["number_last4"], "5671");
        assert!(
            document["profile_identity"]
                .get("number_encrypted")
                .is_none()
        );
        assert!(document["profile_identity"].get("number_hash").is_none());
        // The Clerk id is not part of the user row.
        assert!(document["users"].get("clerk_user_id").is_none());
        assert_eq!(
            document["profiles"]["public_code"].as_str().unwrap().len(),
            10
        );
        assert_eq!(document["profile_contacts"]["phone_e164"], "+923001234567");
        // Photos: dates and a signed URL for the approved one only.
        let photos = document["profile_photos"].as_array().unwrap();
        assert_eq!(photos.len(), 2);
        let approved = photos.iter().find(|p| p["status"] == "approved").unwrap();
        assert!(
            approved["large_url"]
                .as_str()
                .unwrap()
                .contains("expires=604800")
        );
        assert!(photos.iter().find(|p| p["status"] == "rejected").unwrap()["large_url"].is_null());
        // Interests carry the other profile's code and name as visible to the member.
        let interests = document["interests"].as_array().unwrap();
        assert_eq!(interests.len(), 1);
        assert_eq!(interests[0]["direction"], "sent");
        assert_eq!(
            interests[0]["display_name"], "Ayesha Malik",
            "a connection sees the full name"
        );
        // Messages from both sides, marked me and them.
        let senders: Vec<(&str, &str)> = document["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| (m["sender"].as_str().unwrap(), m["body"].as_str().unwrap()))
            .collect();
        assert!(senders.contains(&("me", "from me")));
        assert!(senders.contains(&("them", "from them")));
        // Not included: reports about the member.
        assert!(!text.contains("secret complaint"));
        assert_eq!(document["reports"].as_array().unwrap().len(), 0);
        assert!(document.get("match_recommendations").is_none());
        assert!(document.get("usage_counters").is_none());
        assert!(document.get("admin_audit_log").is_none());

        // The email job is queued once, and a second request within 24 hours is refused.
        let emails: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM jobs WHERE kind = 'send_email' AND payload ->> 'template' = 'export_ready'",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(emails, 1);
        let again = app.post_empty("/v1/me/exports", Some(&member.token)).await;
        assert_eq!(again.status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(again.code(), "limit_reached");
        assert!(again.json["error"]["details"]["resets_at"].is_string());
    }

    #[sqlx::test]
    async fn the_latest_export_is_expired_after_its_link_runs_out(db: PgPool) {
        let app = TestApp::new(db).await;
        let member = app.member().await;
        let none = app.get("/v1/me/exports/latest", Some(&member.token)).await;
        assert_eq!(none.status, StatusCode::NOT_FOUND);

        app.post_empty("/v1/me/exports", Some(&member.token)).await;
        let queued = app.get("/v1/me/exports/latest", Some(&member.token)).await;
        assert_eq!(queued.json["status"], "queued");
        assert!(queued.json["download_url"].is_null());

        app.drain_jobs().await;
        sqlx::query("UPDATE data_exports SET expires_at = now() - interval '1 minute'")
            .execute(app.db())
            .await
            .unwrap();
        let expired = app.get("/v1/me/exports/latest", Some(&member.token)).await;
        assert_eq!(expired.json["status"], "expired");
        assert!(expired.json["download_url"].is_null());
    }

    #[sqlx::test]
    async fn a_build_that_fails_on_its_last_attempt_marks_the_export_failed(db: PgPool) {
        let app = TestApp::new(db).await;
        let member = app.member().await;
        app.post_empty("/v1/me/exports", Some(&member.token)).await;
        sqlx::query("UPDATE jobs SET max_attempts = 1 WHERE kind = 'build_export'")
            .execute(app.db())
            .await
            .unwrap();
        // Storage is down, so the file cannot be written.
        let mut state = app.state.clone();
        state.storage = std::sync::Arc::new(crate::services::r2::DisabledStore);
        crate::jobs::worker::drain(&state).await.unwrap();

        let latest = app.get("/v1/me/exports/latest", Some(&member.token)).await;
        assert_eq!(latest.json["status"], "failed");
        assert!(latest.json["download_url"].is_null());
        let dead: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM jobs WHERE kind = 'build_export' AND status = 'dead'",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(dead, 1);
    }
}
