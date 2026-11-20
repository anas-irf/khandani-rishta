//! The caller's account state, cached for 30 seconds (06 section 6.3).

use std::sync::Arc;
use std::time::Duration;

use moka::sync::Cache;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::domain::types::{
    ConsentDocument, Gate, OnboardingStep, ProfileStatus, UserRole, UserStatus,
};
use crate::settings::AppSettings;

/// Time to live of a cached snapshot.
const SNAPSHOT_TTL: Duration = Duration::from_secs(30);
const SNAPSHOT_CAPACITY: u64 = 10_000;

/// What every request needs to know about its caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountSnapshot {
    pub user_id: Uuid,
    pub clerk_user_id: String,
    pub profile_id: Uuid,
    pub role: UserRole,
    pub user_status: UserStatus,
    pub status_reason: Option<String>,
    pub suspended_until: Option<OffsetDateTime>,
    pub purge_after: Option<OffsetDateTime>,
    pub profile_status: ProfileStatus,
    pub onboarding_step: OnboardingStep,
    pub gender: Option<Gender>,
    /// Versioned documents (`terms`, `privacy`, `community_guidelines`) not yet accepted at
    /// their current versions. Empty means consents are current.
    pub missing_consents: Vec<ConsentDocument>,
}

impl AccountSnapshot {
    pub fn consents_current(&self) -> bool {
        self.missing_consents.is_empty()
    }

    /// The gate for this account (03 section 5.1).
    pub fn gate(&self) -> Gate {
        crate::domain::gate::compute(crate::domain::gate::GateInput {
            user_status: self.user_status,
            profile_status: self.profile_status,
            consents_current: self.consents_current(),
        })
    }

    pub fn is_staff(&self) -> bool {
        self.role.is_staff()
    }
}

#[derive(sqlx::FromRow)]
struct SnapshotRow {
    user_id: Uuid,
    clerk_user_id: String,
    role: UserRole,
    user_status: UserStatus,
    status_reason: Option<String>,
    suspended_until: Option<OffsetDateTime>,
    purge_after: Option<OffsetDateTime>,
    profile_id: Uuid,
    profile_status: ProfileStatus,
    onboarding_step: OnboardingStep,
    gender: Option<Gender>,
    accepted: Vec<ConsentDocument>,
}

/// Reads the snapshot of one Clerk user, or `None` when no row exists yet.
pub async fn load(
    db: &PgPool,
    clerk_user_id: &str,
    settings: &AppSettings,
) -> Result<Option<AccountSnapshot>, sqlx::Error> {
    let row: Option<SnapshotRow> = sqlx::query_as(
        "SELECT u.id AS user_id, u.clerk_user_id, u.role, u.status AS user_status, u.status_reason,
                u.suspended_until, u.purge_after,
                p.id AS profile_id, p.status AS profile_status, p.onboarding_step, p.gender,
                ARRAY(
                    SELECT DISTINCT c.document FROM user_consents c
                    WHERE c.user_id = u.id
                      AND ((c.document = 'terms' AND c.version = $2)
                        OR (c.document = 'privacy' AND c.version = $3)
                        OR (c.document = 'community_guidelines' AND c.version = $4))
                ) AS accepted
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         WHERE u.clerk_user_id = $1",
    )
    .bind(clerk_user_id)
    .bind(&settings.terms_version)
    .bind(&settings.privacy_version)
    .bind(&settings.guidelines_version)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| {
        let missing_consents = [
            ConsentDocument::Terms,
            ConsentDocument::Privacy,
            ConsentDocument::CommunityGuidelines,
        ]
        .into_iter()
        .filter(|document| !row.accepted.contains(document))
        .collect();
        AccountSnapshot {
            user_id: row.user_id,
            clerk_user_id: row.clerk_user_id,
            profile_id: row.profile_id,
            role: row.role,
            user_status: row.user_status,
            status_reason: row.status_reason,
            suspended_until: row.suspended_until,
            purge_after: row.purge_after,
            profile_status: row.profile_status,
            onboarding_step: row.onboarding_step,
            gender: row.gender,
            missing_consents,
        }
    }))
}

/// Snapshots by Clerk user id, with a reverse index so a change by user id can invalidate.
pub struct AccountCache {
    by_clerk_id: Cache<String, Arc<AccountSnapshot>>,
    clerk_id_by_user: Cache<Uuid, String>,
}

impl Default for AccountCache {
    fn default() -> Self {
        Self::new()
    }
}

impl AccountCache {
    pub fn new() -> Self {
        Self {
            by_clerk_id: Cache::builder()
                .max_capacity(SNAPSHOT_CAPACITY)
                .time_to_live(SNAPSHOT_TTL)
                .build(),
            clerk_id_by_user: Cache::builder()
                .max_capacity(SNAPSHOT_CAPACITY)
                .time_to_live(SNAPSHOT_TTL)
                .build(),
        }
    }

    pub fn get(&self, clerk_user_id: &str) -> Option<Arc<AccountSnapshot>> {
        self.by_clerk_id.get(clerk_user_id)
    }

    pub fn insert(&self, snapshot: Arc<AccountSnapshot>) {
        self.clerk_id_by_user
            .insert(snapshot.user_id, snapshot.clerk_user_id.clone());
        self.by_clerk_id
            .insert(snapshot.clerk_user_id.clone(), snapshot);
    }

    /// Drops a user's snapshot. Call after committing any change to `users.status`,
    /// `users.role`, `profiles.status`, `profiles.gender` or `user_consents`.
    pub fn invalidate(&self, user_id: Uuid) {
        if let Some(clerk_user_id) = self.clerk_id_by_user.get(&user_id) {
            self.by_clerk_id.invalidate(&clerk_user_id);
        }
        self.clerk_id_by_user.invalidate(&user_id);
    }

    /// Drops every snapshot, for example after the legal versions change.
    pub fn invalidate_all(&self) {
        self.by_clerk_id.invalidate_all();
        self.clerk_id_by_user.invalidate_all();
    }
}
