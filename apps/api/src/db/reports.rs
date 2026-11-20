//! SQL for member reports (13 section 6, 04 section 9.1).
//!
//! Filing runs 13 section 6.4 as one transaction: the subject, the daily limit, the duplicate
//! check, the context snapshot, the insert and the optional block. Nothing here changes
//! anything for the reported member: a report is a row for the moderators (03 section 4.11).

use sqlx::{PgConnection, PgPool};
use time::Date;
use uuid::Uuid;

use super::photo_access::bump_daily_usage;
use super::relations::{self, BlockEffects};
use crate::domain::options::ReportReason;
use crate::domain::types::{ReportSubject, UsageCounter};

/// Messages kept before the reported one in a message report's context (13 section 6.3).
pub const MESSAGES_BEFORE: i64 = 20;
/// Messages kept after the reported one.
pub const MESSAGES_AFTER: i64 = 5;

/// What is reported about the target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subject {
    /// The profile itself.
    Profile,
    /// One of the target's photos.
    Photo(Uuid),
    /// One message the target sent in a connection with the reporter.
    Message(Uuid),
}

impl Subject {
    pub fn kind(self) -> ReportSubject {
        match self {
            Self::Profile => ReportSubject::Profile,
            Self::Photo(_) => ReportSubject::Photo,
            Self::Message(_) => ReportSubject::Message,
        }
    }
}

/// A report to file.
#[derive(Debug, Clone)]
pub struct NewReport<'a> {
    pub reporter: Uuid,
    pub target: Uuid,
    pub subject: Subject,
    pub reason: ReportReason,
    pub details: Option<&'a str>,
    /// Block the target in the same transaction (13 section 6.4 step 5).
    pub also_block: bool,
    /// Today in `Asia/Karachi`, for the daily counter.
    pub today: Date,
    /// `limits.reports_per_day`.
    pub daily_limit: i64,
}

/// The result of [`file`].
#[derive(Debug)]
pub enum Filed {
    /// The subject is not visible to the reporter (answer `404`).
    NotFound,
    /// The reporter filed `limit` reports today; `used` is today's count.
    LimitReached { used: i64 },
    Done {
        id: Uuid,
        /// `false` when the reporter already had an `open` or `in_review` report on the same
        /// subject: its id is returned and nothing was created (13 section 6.4 step 3).
        created: bool,
        /// The effects of the block, when `also_block` was set.
        block: Option<BlockEffects>,
    },
}

/// Files a report (13 section 6.4).
///
/// 1. The photo must be an `approved` photo of the target, and the message a text message the
///    target sent in a connection (active or ended) that the reporter belongs to; otherwise
///    [`Filed::NotFound`]. Whether the target profile itself may be opened is decided by the
///    caller for profile and photo reports, with the views.
/// 2. Today's `reports_filed` counter is below the limit, otherwise [`Filed::LimitReached`].
/// 3. An `open` or `in_review` report of the reporter on the same target, subject type and
///    photo or message is returned as it is.
/// 4. Otherwise the context is captured and the report inserted with status `open`, and the
///    counter increases.
/// 5. With `also_block`, the block of [`relations::block_in`], also after step 3: the member
///    asked for it, and a block is idempotent.
///
/// An advisory lock on the reporter makes two simultaneous reports take turns, so neither the
/// limit nor the duplicate check can be passed twice.
pub async fn file(db: &PgPool, report: &NewReport<'_>) -> sqlx::Result<Filed> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('reports:' || $1::text, 0))")
        .bind(report.reporter)
        .execute(&mut *tx)
        .await?;

    // Step 1.
    let Some(subject) = resolve(&mut tx, report).await? else {
        return Ok(Filed::NotFound);
    };

    // Step 2.
    let used: i64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT count::bigint FROM usage_counters
                           WHERE profile_id = $1 AND counter = $2 AND day = $3), 0)",
    )
    .bind(report.reporter)
    .bind(UsageCounter::ReportsFiled)
    .bind(report.today)
    .fetch_one(&mut *tx)
    .await?;
    if used >= report.daily_limit {
        return Ok(Filed::LimitReached { used });
    }

    // Steps 3 and 4.
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM reports
         WHERE reporter_profile_id = $1 AND target_profile_id = $2 AND subject_type = $3
           AND photo_id IS NOT DISTINCT FROM $4 AND message_id IS NOT DISTINCT FROM $5
           AND status IN ('open', 'in_review')
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(report.reporter)
    .bind(report.target)
    .bind(report.subject.kind())
    .bind(subject.photo_id)
    .bind(subject.message_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (id, created) = if let Some(id) = existing {
        (id, false)
    } else {
        let context = snapshot(&mut tx, report, &subject).await?;
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type,
                                  photo_id, message_id, reason, details, context)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id",
        )
        .bind(report.reporter)
        .bind(report.target)
        .bind(report.subject.kind())
        .bind(subject.photo_id)
        .bind(subject.message_id)
        .bind(report.reason)
        .bind(report.details)
        .bind(context)
        .fetch_one(&mut *tx)
        .await?;
        // The advisory lock makes this unable to fail after the check of step 2.
        if let Err(used) = bump_daily_usage(
            &mut tx,
            report.reporter,
            UsageCounter::ReportsFiled,
            report.today,
            report.daily_limit,
        )
        .await?
        {
            return Ok(Filed::LimitReached { used });
        }
        (id, true)
    };

    // Step 5.
    let block = if report.also_block {
        Some(relations::block_in(&mut tx, report.reporter, report.target).await?)
    } else {
        None
    };
    tx.commit().await?;
    Ok(Filed::Done { id, created, block })
}

/// The ids a report row stores, and the connection a message report reads its context from.
#[derive(Debug, Clone, Copy)]
#[expect(clippy::struct_field_names, reason = "The fields are column names")]
struct Resolved {
    photo_id: Option<Uuid>,
    message_id: Option<Uuid>,
    connection_id: Option<Uuid>,
}

/// Step 1 of [`file`] for photos and messages; a profile report resolves to nothing but
/// itself. `None` means the subject is not visible to the reporter.
async fn resolve(tx: &mut PgConnection, report: &NewReport<'_>) -> sqlx::Result<Option<Resolved>> {
    let nothing = Resolved {
        photo_id: None,
        message_id: None,
        connection_id: None,
    };
    Ok(match report.subject {
        Subject::Profile => Some(nothing),
        Subject::Photo(id) => approved_photo_of(tx, id, report.target)
            .await?
            .then_some(Resolved {
                photo_id: Some(id),
                ..nothing
            }),
        Subject::Message(id) => connection_of_message(tx, id, report.reporter, report.target)
            .await?
            .map(|connection_id| Resolved {
                message_id: Some(id),
                connection_id: Some(connection_id),
                ..nothing
            }),
    })
}

/// The context snapshot of the subject (13 section 6.3), taken before the block of step 5 so
/// the farewell message of a blocked chat is not in it.
async fn snapshot(
    tx: &mut PgConnection,
    report: &NewReport<'_>,
    resolved: &Resolved,
) -> sqlx::Result<serde_json::Value> {
    match report.subject {
        Subject::Profile => profile_snapshot(tx, report.target).await,
        Subject::Photo(id) => photo_snapshot(tx, id).await,
        Subject::Message(id) => {
            let connection_id = resolved.connection_id.unwrap_or_default();
            message_window(tx, connection_id, id, report.reporter).await
        }
    }
}

/// Whether the photo is an `approved` photo of the profile: the only photos other members can
/// see (09 section 6.2 rule 1).
async fn approved_photo_of(
    tx: &mut PgConnection,
    photo_id: Uuid,
    profile_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM profile_photos
                         WHERE id = $1 AND profile_id = $2 AND status = 'approved')",
    )
    .bind(photo_id)
    .bind(profile_id)
    .fetch_one(tx)
    .await
}

/// The connection of a text message the target sent to the reporter (13 section 6.1: "in a
/// connection with the target, sent by the target"). An ended connection counts: its history
/// stays readable, and a member may report what was said before leaving.
async fn connection_of_message(
    tx: &mut PgConnection,
    message_id: Uuid,
    reporter: Uuid,
    target: Uuid,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(
        "SELECT m.connection_id
         FROM messages m JOIN connections c ON c.id = m.connection_id
         WHERE m.id = $1 AND m.kind = 'text' AND m.sender_profile_id = $3
           AND ((c.profile_low_id = $2 AND c.profile_high_id = $3)
             OR (c.profile_low_id = $3 AND c.profile_high_id = $2))",
    )
    .bind(message_id)
    .bind(reporter)
    .bind(target)
    .fetch_optional(tx)
    .await
}

// -------------------------------------------------------------------------------------------
// Context snapshots (13 section 6.3)
// -------------------------------------------------------------------------------------------

/// `{ "first_name", "last_name", "managed_by", "manager_name", "marital_status", "about_me",
/// "about_family", "partner_notes", "primary_photo_id", "job_title", "employer_name" }` as they
/// are now, whatever their moderation status: the moderator needs the text the reporter saw or
/// could have seen.
async fn profile_snapshot(
    tx: &mut PgConnection,
    profile_id: Uuid,
) -> sqlx::Result<serde_json::Value> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
                  'first_name', p.first_name,
                  'last_name', p.last_name,
                  'managed_by', p.managed_by,
                  'manager_name', p.manager_name,
                  'marital_status', p.marital_status,
                  'about_me', p.about_me,
                  'about_family', f.about_family,
                  'partner_notes', pp.notes,
                  'primary_photo_id', (SELECT ph.id FROM profile_photos ph
                                        WHERE ph.profile_id = p.id AND ph.is_primary),
                  'job_title', p.job_title,
                  'employer_name', p.employer_name)
         FROM profiles p
         LEFT JOIN profile_family f ON f.profile_id = p.id
         LEFT JOIN partner_preferences pp ON pp.profile_id = p.id
         WHERE p.id = $1",
    )
    .bind(profile_id)
    .fetch_one(tx)
    .await
}

/// `{ "photo_id", "status", "is_primary", "key_large", "key_medium" }`. The keys are kept
/// because the object may be deleted from the profile later (13 section 6.3 rule 3).
async fn photo_snapshot(tx: &mut PgConnection, photo_id: Uuid) -> sqlx::Result<serde_json::Value> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
                  'photo_id', id,
                  'status', status,
                  'is_primary', is_primary,
                  'key_large', key_large,
                  'key_medium', key_medium)
         FROM profile_photos WHERE id = $1",
    )
    .bind(photo_id)
    .fetch_one(tx)
    .await
}

/// `{ "connection_id", "reported_message_id", "messages": [ { "id", "sender", "body",
/// "safety_flag", "created_at" } ] }` holding the [`MESSAGES_BEFORE`] messages before the
/// reported one, the reported one and the [`MESSAGES_AFTER`] after it, oldest first, from that
/// connection only. `sender` is `reporter`, `target` or `system`; a deleted message has
/// `body: null`. Message ids are `UUIDv7`, so id order is time order (19 section 1).
async fn message_window(
    tx: &mut PgConnection,
    connection_id: Uuid,
    message_id: Uuid,
    reporter: Uuid,
) -> sqlx::Result<serde_json::Value> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
                  'connection_id', $1::uuid,
                  'reported_message_id', $2::uuid,
                  'messages', COALESCE(jsonb_agg(jsonb_build_object(
                      'id', w.id,
                      'sender', CASE WHEN w.kind = 'system' OR w.sender_profile_id IS NULL THEN 'system'
                                     WHEN w.sender_profile_id = $3 THEN 'reporter'
                                     ELSE 'target' END,
                      'body', CASE WHEN w.deleted_at IS NULL THEN w.body END,
                      'safety_flag', w.safety_flag,
                      'created_at', to_char(w.created_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')
                  ) ORDER BY w.id), '[]'::jsonb))
         FROM (
           (SELECT id, kind, sender_profile_id, body, deleted_at, safety_flag, created_at
              FROM messages WHERE connection_id = $1 AND id < $2 ORDER BY id DESC LIMIT $4)
           UNION ALL
           (SELECT id, kind, sender_profile_id, body, deleted_at, safety_flag, created_at
              FROM messages WHERE connection_id = $1 AND id = $2)
           UNION ALL
           (SELECT id, kind, sender_profile_id, body, deleted_at, safety_flag, created_at
              FROM messages WHERE connection_id = $1 AND id > $2 ORDER BY id LIMIT $5)
         ) w",
    )
    .bind(connection_id)
    .bind(message_id)
    .bind(reporter)
    .bind(MESSAGES_BEFORE)
    .bind(MESSAGES_AFTER)
    .fetch_one(tx)
    .await
}
