//! Report queue, detail and the claim and resolve transitions (18 section 4.5, 13 section 6).

use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, QueryBuilder};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::options::ReportReason;
use crate::domain::types::{
    AuditTargetType, ReportSource, ReportStatus, ReportSubject, UserStatus,
};
use crate::error::ApiError;
use crate::models::admin::{
    AdminReportListItem, ReportReporter, ReportTarget, ReportTargetSummary, ReportsFiled,
};
use crate::state::AppState;

/// Priority of a report (13 section 6.5): 1 for `underage`, `asking_for_money` and every system
/// report, and for a target with three or more open reports from different reporters; 2 for
/// harassment, inappropriate photo, offensive content and impersonation; 3 for the rest.
const BASE: &str = "SELECT r.id AS report_id, r.source,
        CASE
          WHEN r.source = 'system' OR r.reason IN ('underage', 'asking_for_money') THEN 1
          WHEN (SELECT count(DISTINCT o.reporter_profile_id) FROM reports o
                 WHERE o.target_profile_id = r.target_profile_id
                   AND o.status IN ('open', 'in_review')) >= 3 THEN 1
          WHEN r.reason IN ('harassment', 'inappropriate_photo', 'offensive_content', 'impersonation') THEN 2
          ELSE 3
        END AS priority,
        r.reason, r.subject_type, r.status,
        tp.id AS target_profile_id, tp.user_id AS target_user_id,
        tp.public_code AS target_public_code, tp.first_name AS target_first_name,
        rp.id AS reporter_profile_id, rp.public_code AS reporter_public_code,
        rp.first_name AS reporter_first_name,
        (SELECT count(*) FROM reports o
          WHERE o.target_profile_id = r.target_profile_id
            AND o.status IN ('open', 'in_review')) AS open_reports_on_target,
        hb.email AS handled_by_email, r.created_at,
        r.details, r.context, r.photo_id, r.resolution_note, r.handled_at
     FROM reports r
     JOIN profiles tp ON tp.id = r.target_profile_id
     LEFT JOIN profiles rp ON rp.id = r.reporter_profile_id
     LEFT JOIN users hb ON hb.id = r.handled_by";

/// One report with everything the list and the detail need.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ReportRow {
    pub report_id: Uuid,
    pub source: ReportSource,
    pub priority: i32,
    pub reason: ReportReason,
    pub subject_type: ReportSubject,
    pub status: ReportStatus,
    pub target_profile_id: Uuid,
    pub target_user_id: Uuid,
    pub target_public_code: String,
    pub target_first_name: Option<String>,
    pub reporter_profile_id: Option<Uuid>,
    pub reporter_public_code: Option<String>,
    pub reporter_first_name: Option<String>,
    pub open_reports_on_target: i64,
    pub handled_by_email: Option<String>,
    pub created_at: OffsetDateTime,
    pub details: Option<String>,
    pub context: Option<Value>,
    pub photo_id: Option<Uuid>,
    pub resolution_note: Option<String>,
    pub handled_at: Option<OffsetDateTime>,
}

impl ReportRow {
    pub fn item(&self) -> AdminReportListItem {
        let reporter = match (self.reporter_profile_id, self.reporter_public_code.clone()) {
            (Some(profile_id), Some(public_code)) => Some(ReportReporter {
                profile_id,
                public_code,
                first_name: self.reporter_first_name.clone(),
            }),
            _ => None,
        };
        AdminReportListItem {
            report_id: self.report_id,
            source: self.source,
            priority: self.priority,
            reason: self.reason,
            subject_type: self.subject_type,
            status: self.status,
            target: ReportTarget {
                profile_id: self.target_profile_id,
                user_id: self.target_user_id,
                public_code: self.target_public_code.clone(),
                first_name: self.target_first_name.clone(),
            },
            reporter,
            open_reports_on_target: self.open_reports_on_target,
            handled_by_email: self.handled_by_email.clone(),
            created_at: self.created_at,
        }
    }
}

/// The keyset of the queue: `(priority, created_at, id)`.
pub type QueueCursor = (i32, OffsetDateTime, Uuid);

/// The queue of one status, ordered by priority and then age. Fetches `limit + 1` rows.
pub async fn queue(
    db: &PgPool,
    status: ReportStatus,
    cursor: Option<QueueCursor>,
    limit: i64,
) -> sqlx::Result<Vec<ReportRow>> {
    let mut query =
        QueryBuilder::<Postgres>::new(format!("SELECT * FROM ({BASE}) q WHERE q.status = "));
    query.push_bind(status);
    if let Some((priority, created_at, id)) = cursor {
        query
            .push(" AND (q.priority, q.created_at, q.report_id) > (")
            .push_bind(priority)
            .push(", ")
            .push_bind(created_at)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    query
        .push(" ORDER BY q.priority, q.created_at, q.report_id LIMIT ")
        .push_bind(limit + 1);
    query.build_query_as::<ReportRow>().fetch_all(db).await
}

/// One report, or `None`.
pub async fn get(db: &PgPool, report_id: Uuid) -> sqlx::Result<Option<ReportRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT * FROM ({BASE}) q WHERE q.report_id = $1"
    )))
    .bind(report_id)
    .fetch_optional(db)
    .await
}

/// The newest reports about a profile, any status.
pub async fn against(
    db: &PgPool,
    profile_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<AdminReportListItem>> {
    let rows: Vec<ReportRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT * FROM ({BASE}) q WHERE q.target_profile_id = $1
         ORDER BY q.created_at DESC, q.report_id DESC LIMIT $2"
    )))
    .bind(profile_id)
    .bind(limit)
    .fetch_all(db)
    .await?;
    Ok(rows.iter().map(ReportRow::item).collect())
}

/// Other `open` or `in_review` reports on the same target.
pub async fn related(
    db: &PgPool,
    target_profile_id: Uuid,
    except_report_id: Uuid,
) -> sqlx::Result<Vec<AdminReportListItem>> {
    let rows: Vec<ReportRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT * FROM ({BASE}) q
         WHERE q.target_profile_id = $1 AND q.report_id <> $2 AND q.status IN ('open', 'in_review')
         ORDER BY q.priority, q.created_at, q.report_id LIMIT 50"
    )))
    .bind(target_profile_id)
    .bind(except_report_id)
    .fetch_all(db)
    .await?;
    Ok(rows.iter().map(ReportRow::item).collect())
}

/// How many reports a profile filed and how they were decided.
pub async fn filed_by(db: &PgPool, profile_id: Uuid) -> sqlx::Result<ReportsFiled> {
    let (total, actioned, dismissed): (i64, i64, i64) = sqlx::query_as(
        "SELECT count(*), count(*) FILTER (WHERE status = 'actioned'),
                count(*) FILTER (WHERE status = 'dismissed')
         FROM reports WHERE reporter_profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(db)
    .await?;
    Ok(ReportsFiled {
        total,
        actioned,
        dismissed,
    })
}

/// The summary of the reported account shown next to a report.
pub async fn target_summary(db: &PgPool, row: &ReportRow) -> sqlx::Result<ReportTargetSummary> {
    let (user_status, profile_status, is_id_verified, is_photo_verified): (
        UserStatus,
        crate::domain::types::ProfileStatus,
        bool,
        bool,
    ) = sqlx::query_as(
        "SELECT u.status, p.status, p.is_id_verified, p.is_photo_verified
         FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1",
    )
    .bind(row.target_profile_id)
    .fetch_one(db)
    .await?;
    let (total, actioned): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(*) FILTER (WHERE status = 'actioned')
         FROM reports WHERE target_profile_id = $1",
    )
    .bind(row.target_profile_id)
    .fetch_one(db)
    .await?;
    Ok(ReportTargetSummary {
        user_status,
        profile_status,
        reports_against_total: total,
        reports_against_actioned: actioned,
        sanctions: crate::db::admin::users::sanctions(db, row.target_user_id).await?,
        is_id_verified,
        is_photo_verified,
    })
}

/// The photo row behind a `photo` report: `(photo_id, status, key_large)`.
pub async fn photo_of(
    db: &PgPool,
    photo_id: Uuid,
) -> sqlx::Result<Option<(Uuid, String, Option<String>)>> {
    sqlx::query_as("SELECT id, status, key_large FROM profile_photos WHERE id = $1")
        .bind(photo_id)
        .fetch_optional(db)
        .await
}

/// `open` to `in_review` (18 section 4.5 step 1). `409` when it is not `open`.
pub async fn claim(state: &AppState, actor: Uuid, report_id: Uuid) -> Result<(), ApiError> {
    let mut tx = state.db.begin().await?;
    let status: Option<ReportStatus> =
        sqlx::query_scalar("SELECT status FROM reports WHERE id = $1 FOR UPDATE")
            .bind(report_id)
            .fetch_optional(&mut *tx)
            .await?;
    match status {
        None => return Err(ApiError::NotFound),
        Some(ReportStatus::Open) => {}
        Some(other) => return Err(ApiError::invalid_state(other)),
    }
    sqlx::query("UPDATE reports SET status = 'in_review', handled_by = $2 WHERE id = $1")
        .bind(report_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "report.claim",
        AuditTargetType::Report,
        &report_id.to_string(),
        json!({}),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Resolves a report (18 section 4.5 step 4). Allowed from `in_review`, and from `open` only
/// as `dismissed` (bulk dismissal of duplicates). `outcome` is `actioned` or `dismissed`.
pub async fn resolve(
    state: &AppState,
    actor: Uuid,
    report_id: Uuid,
    outcome: ReportStatus,
    note: &str,
) -> Result<(), ApiError> {
    let mut tx = state.db.begin().await?;
    let status: Option<ReportStatus> =
        sqlx::query_scalar("SELECT status FROM reports WHERE id = $1 FOR UPDATE")
            .bind(report_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(status) = status else {
        return Err(ApiError::NotFound);
    };
    let allowed = match status {
        ReportStatus::InReview => true,
        ReportStatus::Open => outcome == ReportStatus::Dismissed,
        ReportStatus::Actioned | ReportStatus::Dismissed => false,
    };
    if !allowed {
        return Err(ApiError::invalid_state(status));
    }
    sqlx::query(
        "UPDATE reports
         SET status = $2, resolution_note = $3, handled_by = $4, handled_at = now()
         WHERE id = $1",
    )
    .bind(report_id)
    .bind(outcome)
    .bind(note)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "report.resolve",
        AuditTargetType::Report,
        &report_id.to_string(),
        json!({ "outcome": outcome, "note": note }),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Whether a report exists, for linking a sanction to it.
pub async fn exists(db: &PgPool, report_id: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM reports WHERE id = $1)")
        .bind(report_id)
        .fetch_one(db)
        .await
}
