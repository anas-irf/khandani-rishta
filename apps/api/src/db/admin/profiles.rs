//! Profile review and the profile view of the staff console (18 sections 4.1 and 5.4).

use serde_json::{Map, Value, json};
use sqlx::{PgPool, Postgres, QueryBuilder};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::db::admin::escape_like;
use crate::db::profiles::{load_own_profile, preferences};
use crate::domain::options::{DocumentType, Gender, ManagedBy, MaritalStatus};
use crate::domain::privacy::Privacy;
use crate::domain::time::age_now;
use crate::domain::types::{
    AuditTargetType, NotificationType, ProfileStatus, UserRole, UserStatus,
};
use crate::error::{ApiError, FieldCode, FieldErrors};
use crate::jobs::{NewJob, enqueue};
use crate::models::admin::{
    AdminOwnProfile, AdminProfile, AdminProfileListItem, AdminProfileStats, AdminProfileUser,
    AdminVerificationRequest,
};
use crate::notify::notify;
use crate::state::AppState;

// ---- The queue and the search ----

/// Filters of `GET /v1/admin/profiles`.
#[derive(Debug, Default)]
pub struct ProfileSearch {
    pub status: Option<ProfileStatus>,
    /// A profile code, or a prefix of the first or last name.
    pub q: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct ProfileListRow {
    pub profile_id: Uuid,
    pub user_id: Uuid,
    pub public_code: String,
    pub status: ProfileStatus,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    pub date_of_birth: Option<Date>,
    pub city_name: Option<String>,
    pub managed_by: Option<ManagedBy>,
    pub onboarding_completed_at: Option<OffsetDateTime>,
    pub thumb_key: Option<String>,
    pub open_system_reports: i64,
    pub created_at: OffsetDateTime,
    /// `onboarding_completed_at`, or `created_at` for profiles that never completed onboarding.
    pub sort_key: OffsetDateTime,
}

impl ProfileListRow {
    pub fn into_item(
        self,
        photo_thumb_url: Option<String>,
        now: OffsetDateTime,
    ) -> AdminProfileListItem {
        AdminProfileListItem {
            profile_id: self.profile_id,
            user_id: self.user_id,
            public_code: self.public_code,
            status: self.status,
            first_name: self.first_name,
            last_name: self.last_name,
            gender: self.gender,
            age: self.date_of_birth.map(|dob| age_now(dob, now)),
            city_name: self.city_name,
            managed_by: self.managed_by,
            onboarding_completed_at: self.onboarding_completed_at,
            photo_thumb_url,
            open_system_reports: self.open_system_reports,
            created_at: self.created_at,
        }
    }
}

/// Profiles matching the filters, longest waiting first (`onboarding_completed_at` ascending).
/// `cursor` is the `(sort_key, profile_id)` of the last row of the previous page. Fetches
/// `limit + 1` rows.
pub async fn list(
    db: &PgPool,
    filter: &ProfileSearch,
    cursor: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<ProfileListRow>> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT p.id AS profile_id, p.user_id, p.public_code, p.status, p.first_name, p.last_name,
                p.gender, p.date_of_birth, COALESCE(c.name, p.city_other) AS city_name,
                p.managed_by, p.onboarding_completed_at,
                (SELECT ph.key_thumb FROM profile_photos ph
                  WHERE ph.profile_id = p.id AND ph.key_thumb IS NOT NULL
                  ORDER BY ph.position, ph.created_at LIMIT 1) AS thumb_key,
                (SELECT count(*) FROM reports r
                  WHERE r.target_profile_id = p.id AND r.source = 'system'
                    AND r.status IN ('open', 'in_review')) AS open_system_reports,
                p.created_at,
                COALESCE(p.onboarding_completed_at, p.created_at) AS sort_key
         FROM profiles p LEFT JOIN cities c ON c.id = p.city_id
         WHERE TRUE",
    );
    if let Some(status) = filter.status {
        query.push(" AND p.status = ").push_bind(status);
    }
    if let Some(q) = &filter.q {
        let pattern = format!("{}%", escape_like(q));
        query
            .push(" AND (p.public_code = ")
            .push_bind(q.to_uppercase())
            .push(" OR p.first_name ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR p.last_name ILIKE ")
            .push_bind(pattern)
            .push(")");
    }
    if let Some((sort_key, id)) = cursor {
        query
            .push(" AND (COALESCE(p.onboarding_completed_at, p.created_at), p.id) > (")
            .push_bind(sort_key)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    query
        .push(" ORDER BY sort_key, p.id LIMIT ")
        .push_bind(limit + 1);
    query.build_query_as::<ProfileListRow>().fetch_all(db).await
}

// ---- The detail ----

/// The account columns of one profile.
#[derive(Debug, sqlx::FromRow)]
struct DetailRow {
    user_id: Uuid,
    email: Option<String>,
    email_verified: bool,
    phone_e164: Option<String>,
    role: UserRole,
    user_status: UserStatus,
    user_status_reason: Option<String>,
    suspended_until: Option<OffsetDateTime>,
    user_created_at: OffsetDateTime,
    last_seen_at: Option<OffsetDateTime>,
    first_activated_at: Option<OffsetDateTime>,
    last_active_at: Option<OffsetDateTime>,
}

/// The full profile view (18 section 4.1). `profile` is the owner's own view of 15 section 4.3,
/// built by the same code as `GET /v1/me/profile`. `viewer_role` decides whether contact
/// details are included: only admins see `phone_e164` and `contacts`.
pub async fn load_detail(
    state: &AppState,
    profile_id: Uuid,
    viewer_role: UserRole,
) -> Result<Option<AdminProfile>, ApiError> {
    let db = &state.db;
    let row: Option<DetailRow> = sqlx::query_as(
        "SELECT u.id AS user_id, u.email, u.email_verified, u.phone_e164, u.role,
                u.status AS user_status, u.status_reason AS user_status_reason, u.suspended_until,
                u.created_at AS user_created_at, u.last_seen_at,
                p.first_activated_at, p.last_active_at
         FROM profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.id = $1",
    )
    .bind(profile_id)
    .fetch_optional(db)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let is_admin = viewer_role == UserRole::Admin;
    let profile = AdminOwnProfile::new(
        load_own_profile(db, state.storage.as_ref(), profile_id).await?,
        is_admin,
    );
    let preferences = {
        let mut conn = db.acquire().await?;
        preferences::load(&mut conn, profile_id).await?
    };
    // A purged account has no privacy row any more.
    let privacy: Option<Privacy> =
        sqlx::query_as("SELECT * FROM profile_privacy WHERE profile_id = $1")
            .bind(profile_id)
            .fetch_optional(db)
            .await?;

    let verification_rows: Vec<AdminVerificationRequest> = sqlx::query_as(
        "SELECT id, kind, status, rejection_reason, created_at, reviewed_at
         FROM verification_requests WHERE profile_id = $1
         ORDER BY created_at DESC, id DESC LIMIT 50",
    )
    .bind(profile_id)
    .fetch_all(db)
    .await?;

    Ok(Some(AdminProfile {
        user: AdminProfileUser {
            id: row.user_id,
            email: row.email.clone(),
            email_verified: row.email_verified,
            phone_e164: if is_admin {
                row.phone_e164.clone()
            } else {
                None
            },
            role: row.role,
            status: row.user_status,
            status_reason: row.user_status_reason.clone(),
            suspended_until: row.suspended_until,
            created_at: row.user_created_at,
            last_seen_at: row.last_seen_at,
        },
        profile,
        preferences,
        privacy,
        first_activated_at: row.first_activated_at,
        last_active_at: row.last_active_at,
        stats: stats(db, profile_id).await?,
        reports_against: crate::db::admin::reports::against(db, profile_id, 10).await?,
        reports_filed: crate::db::admin::reports::filed_by(db, profile_id).await?,
        sanctions: crate::db::admin::users::sanctions(db, row.user_id).await?,
        verification_requests: verification_rows,
        audit: crate::db::admin::audit::for_user_and_profile(db, row.user_id, profile_id, 20)
            .await?,
    }))
}

/// The activity counts of the profile view (18 section 4.1).
async fn stats(db: &PgPool, profile_id: Uuid) -> Result<AdminProfileStats, ApiError> {
    let (
        interests_sent,
        interests_received,
        interests_accepted_by_others,
        active_connections,
        connections_ended_by_others,
        money_flags_30d,
        blocks_received,
    ): (i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
           (SELECT count(*) FROM interests WHERE sender_profile_id = $1),
           (SELECT count(*) FROM interests WHERE receiver_profile_id = $1),
           (SELECT count(*) FROM interests WHERE sender_profile_id = $1 AND status = 'accepted'),
           (SELECT count(*) FROM connections
             WHERE status = 'active' AND (profile_low_id = $1 OR profile_high_id = $1)),
           (SELECT count(*) FROM connections
             WHERE status = 'ended' AND ended_by_profile_id IS NOT NULL
               AND ended_by_profile_id <> $1 AND (profile_low_id = $1 OR profile_high_id = $1)),
           (SELECT count(*) FROM messages
             WHERE sender_profile_id = $1 AND safety_flag = 'money'
               AND created_at > now() - interval '30 days'),
           (SELECT count(*) FROM blocks WHERE blocked_profile_id = $1)",
    )
    .bind(profile_id)
    .fetch_one(db)
    .await?;
    Ok(AdminProfileStats {
        interests_sent,
        interests_received,
        interests_accepted_by_others,
        active_connections,
        connections_ended_by_others,
        money_flags_30d,
        blocks_received,
    })
}

// ---- Actions ----

/// Locks a profile and returns `(user_id, status, first_activated_at)`.
async fn lock_profile(
    tx: &mut sqlx::PgConnection,
    profile_id: Uuid,
) -> Result<(Uuid, ProfileStatus, Option<OffsetDateTime>), ApiError> {
    sqlx::query_as(
        "SELECT user_id, status, first_activated_at FROM profiles WHERE id = $1 FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_optional(tx)
    .await?
    .ok_or(ApiError::NotFound)
}

/// `pending_review` to `active` (18 section 4.1). Returns the owner's user id.
pub async fn approve(state: &AppState, actor: Uuid, profile_id: Uuid) -> Result<Uuid, ApiError> {
    let mut tx = state.db.begin().await?;
    let (user_id, status, _first_activated_at) = lock_profile(&mut tx, profile_id).await?;
    if status != ProfileStatus::PendingReview {
        return Err(ApiError::invalid_state(status));
    }
    sqlx::query(
        "UPDATE profiles
         SET status = 'active', first_activated_at = COALESCE(first_activated_at, now()),
             status_reason = NULL, match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "profile.approve",
        AuditTargetType::Profile,
        &profile_id.to_string(),
        json!({}),
    )
    .await?;
    enqueue(
        &mut *tx,
        NewJob::new(
            "refresh_recommendations",
            json!({ "profile_id": profile_id, "notify": false }),
        )
        .dedupe(profile_id.to_string()),
    )
    .await?;
    // The `welcome` email comes from the `profile_approved` notification below (14 section 2).
    tx.commit().await?;

    after_gate_change(state, user_id).await;
    if let Err(error) = notify(
        state,
        user_id,
        NotificationType::ProfileApproved,
        None,
        json!({}),
    )
    .await
    {
        tracing::warn!(%error, "could not create the profile_approved notification");
    }
    state.jobs.wake();
    tracing::info!(event = "profile.approved", %profile_id, "profile approved");
    Ok(user_id)
}

/// `pending_review` to `changes_requested` (18 section 4.1). Returns the owner's user id.
pub async fn request_changes(
    state: &AppState,
    actor: Uuid,
    profile_id: Uuid,
    reason: &str,
) -> Result<Uuid, ApiError> {
    let mut tx = state.db.begin().await?;
    let (user_id, status, _) = lock_profile(&mut tx, profile_id).await?;
    if status != ProfileStatus::PendingReview {
        return Err(ApiError::invalid_state(status));
    }
    sqlx::query(
        "UPDATE profiles SET status = 'changes_requested', status_reason = $2 WHERE id = $1",
    )
    .bind(profile_id)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    crate::audit::record(
        &mut tx,
        actor,
        "profile.request_changes",
        AuditTargetType::Profile,
        &profile_id.to_string(),
        json!({ "reason": reason }),
    )
    .await?;
    // The email comes from the `profile_changes_requested` notification below (14 section 2).
    tx.commit().await?;

    after_gate_change(state, user_id).await;
    if let Err(error) = notify(
        state,
        user_id,
        NotificationType::ProfileChangesRequested,
        None,
        json!({ "reason": reason }),
    )
    .await
    {
        tracing::warn!(%error, "could not create the profile_changes_requested notification");
    }
    state.jobs.wake();
    tracing::info!(event = "profile.changes_requested", %profile_id, "changes requested");
    Ok(user_id)
}

/// Invalidates the snapshot and tells the owner's sockets about the new gate.
async fn after_gate_change(state: &AppState, user_id: Uuid) {
    crate::db::accounts::push_gate(state, user_id).await;
}

/// The columns of a profile that a locked-fields correction reads and compares.
#[derive(Debug, sqlx::FromRow)]
struct LockedRow {
    user_id: Uuid,
    status: ProfileStatus,
    first_name: Option<String>,
    last_name: Option<String>,
    gender: Option<Gender>,
    date_of_birth: Option<Date>,
    marital_status: Option<MaritalStatus>,
}

/// The corrections of 18 section 5.4. At least one of the four fields is set.
#[derive(Debug, Default)]
pub struct LockedFieldsChange {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    pub date_of_birth: Option<Date>,
    /// 10 to 500 characters, staff only.
    pub reason: String,
}

fn name_error(
    field: crate::domain::text_rules::TextField,
    text: &str,
) -> Result<String, FieldErrors> {
    let mut errors = FieldErrors::new();
    match crate::domain::text_rules::validate(field, text) {
        Ok(Some(stored)) => return Ok(stored),
        Ok(None) => errors.add(field.name(), FieldCode::Required),
        Err(violation) => errors.push(crate::error::FieldError::with_message(
            field.name(),
            match violation {
                crate::domain::text_rules::TextViolation::TooShort => FieldCode::TooShort,
                crate::domain::text_rules::TextViolation::TooLong => FieldCode::TooLong,
                crate::domain::text_rules::TextViolation::Invalid => FieldCode::Invalid,
                crate::domain::text_rules::TextViolation::ContainsContactInfo => {
                    FieldCode::ContainsContactInfo
                }
                crate::domain::text_rules::TextViolation::Inappropriate => FieldCode::Inappropriate,
            },
            violation.message(field).into_owned(),
        )),
    }
    Err(errors)
}

/// Corrects the locked fields of a profile (18 section 5.4) and writes one audit row with the
/// old and new values. Returns false when nothing differs from the stored values (nothing is
/// written then).
#[allow(clippy::too_many_lines)] // Validation, the gender rules, the update and the audit row.
pub async fn change_locked_fields(
    state: &AppState,
    actor: Uuid,
    profile_id: Uuid,
    change: LockedFieldsChange,
) -> Result<bool, ApiError> {
    use crate::domain::text_rules::TextField;

    let mut errors = FieldErrors::new();
    let reason = change.reason.trim().to_owned();
    match reason.chars().count() {
        0 => errors.add("reason", FieldCode::Required),
        1..=9 => errors.add("reason", FieldCode::TooShort),
        10..=500 => {}
        _ => errors.add("reason", FieldCode::TooLong),
    }
    let mut first_name = None;
    let mut last_name = None;
    for (field, raw, target) in [
        (TextField::FirstName, &change.first_name, &mut first_name),
        (TextField::LastName, &change.last_name, &mut last_name),
    ] {
        if let Some(raw) = raw {
            match name_error(field, raw) {
                Ok(stored) => *target = Some(stored),
                Err(found) => found.into_inner().into_iter().for_each(|e| errors.push(e)),
            }
        }
    }
    if let Some(date_of_birth) = change.date_of_birth {
        let today = crate::domain::time::karachi_date(OffsetDateTime::now_utc());
        if date_of_birth > today || date_of_birth <= time::macros::date!(1930 - 01 - 01) {
            errors.add("date_of_birth", FieldCode::OutOfRange);
        } else if crate::domain::time::age_on(date_of_birth, today) < 18 {
            errors.add("date_of_birth", FieldCode::TooYoung);
        }
    }

    let mut tx = state.db.begin().await?;
    let current: Option<LockedRow> = sqlx::query_as(
        "SELECT user_id, status, first_name, last_name, gender, date_of_birth, marital_status
         FROM profiles WHERE id = $1 FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(LockedRow {
        user_id,
        status,
        first_name: old_first,
        last_name: old_last,
        gender: old_gender,
        date_of_birth: old_dob,
        marital_status,
    }) = current
    else {
        return Err(ApiError::NotFound);
    };
    if status == ProfileStatus::Deleted {
        return Err(ApiError::invalid_state(status));
    }

    let new_gender = change.gender.filter(|gender| Some(*gender) != old_gender);
    if let Some(gender) = new_gender {
        if marital_status == Some(MaritalStatus::Married) && gender == Gender::Female {
            errors.add("gender", FieldCode::NotAllowed);
        }
        let number: Option<(DocumentType, String)> = sqlx::query_as(
            "SELECT document_type, number_last4 FROM profile_identity WHERE profile_id = $1",
        )
        .bind(profile_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((DocumentType::Cnic | DocumentType::Nicop, last4)) = number
            && let Some(last) = last4.chars().last().and_then(|c| c.to_digit(10))
        {
            let odd = last % 2 == 1;
            if (gender == Gender::Male) != odd {
                errors.add("gender", FieldCode::Mismatch);
            }
        }
    }
    errors.finish()?;

    let new_first = first_name.filter(|name| Some(name) != old_first.as_ref());
    let new_last = last_name.filter(|name| Some(name) != old_last.as_ref());
    let new_dob = change.date_of_birth.filter(|dob| Some(*dob) != old_dob);
    if new_first.is_none() && new_last.is_none() && new_gender.is_none() && new_dob.is_none() {
        return Ok(false);
    }

    if new_gender.is_some() {
        let blocked: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM connections
                             WHERE status = 'active' AND (profile_low_id = $1 OR profile_high_id = $1))
                 OR EXISTS (SELECT 1 FROM interests
                             WHERE status = 'pending'
                               AND (sender_profile_id = $1 OR receiver_profile_id = $1))",
        )
        .bind(profile_id)
        .fetch_one(&mut *tx)
        .await?;
        if blocked {
            return Err(ApiError::InvalidState {
                details: json!({ "reason": "active_connection_or_pending_interest" }),
            });
        }
    }

    let mut changes = Map::new();
    let mut record = |field: &str, from: Value, to: Value| {
        changes.insert(field.to_owned(), json!({ "from": from, "to": to }));
    };
    if let Some(name) = &new_first {
        record("first_name", json!(old_first), json!(name));
    }
    if let Some(name) = &new_last {
        record("last_name", json!(old_last), json!(name));
    }
    if let Some(gender) = new_gender {
        record("gender", json!(old_gender), json!(gender));
    }
    if let Some(dob) = new_dob {
        record(
            "date_of_birth",
            json!(old_dob.map(|date| date.to_string())),
            json!(dob.to_string()),
        );
    }

    sqlx::query(
        "UPDATE profiles
         SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
             gender = COALESCE($4, gender), date_of_birth = COALESCE($5, date_of_birth),
             hijab = CASE WHEN $4::text IS NULL THEN hijab END,
             beard = CASE WHEN $4::text IS NULL THEN beard END,
             match_stale = true
         WHERE id = $1",
    )
    .bind(profile_id)
    .bind(&new_first)
    .bind(&new_last)
    .bind(new_gender)
    .bind(new_dob)
    .execute(&mut *tx)
    .await?;
    if new_gender.is_some() {
        sqlx::query(
            "DELETE FROM match_recommendations WHERE profile_id = $1 OR candidate_profile_id = $1",
        )
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    }
    crate::audit::record(
        &mut tx,
        actor,
        "profile.locked_fields_change",
        AuditTargetType::Profile,
        &profile_id.to_string(),
        json!({ "reason": reason, "changes": changes }),
    )
    .await?;
    tx.commit().await?;

    if new_gender.is_some() {
        state.accounts.invalidate(user_id);
    }
    Ok(true)
}
