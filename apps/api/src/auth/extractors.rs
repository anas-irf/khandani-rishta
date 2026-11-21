//! Access levels as Axum extractors (15 section 3, 06 section 6.4).
//!
//! A handler takes the extractor of its level. Each level wraps the one before it and checks,
//! in order: token, user status, profile status. The resolved account is cached in the request
//! extensions, so several extractors on one request verify the token once.

use std::ops::Deref;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{FromRequestParts, MatchedPath};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use moka::sync::Cache;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::account::AccountSnapshot;
use crate::auth::provisioning::resolve_account;
use crate::auth::token::{bearer_token, verify};
use crate::domain::types::{ProfileStatus, UserRole, UserStatus};
use crate::error::ApiError;
use crate::middleware::client_ip_of;
use crate::ratelimit::{Group, user_key};
use crate::state::AppState;

/// Verifies the token, resolves the account and applies the per-user rate limit, once per
/// request.
async fn authenticate(
    parts: &mut Parts,
    state: &AppState,
) -> Result<Arc<AccountSnapshot>, ApiError> {
    if let Some(snapshot) = parts.extensions.get::<Arc<AccountSnapshot>>() {
        return Ok(snapshot.clone());
    }
    if let Some(refused) = parts.extensions.get::<Refused>() {
        return Err(refused.error());
    }
    let header = parts
        .headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let claims = match bearer_token(header) {
        Ok(token) => verify(token, &state.jwks, &state.config.clerk).await,
        Err(reason) => Err(reason),
    };
    let claims = match claims {
        Ok(claims) => claims,
        Err(reason) => {
            tracing::debug!(%reason, "token refused");
            return Err(refuse(parts, state));
        }
    };
    let snapshot = match resolve_account(state, &claims.sub).await {
        Ok(snapshot) => snapshot,
        // A signed token for a user Clerk no longer has is refused like any other bad token.
        Err(ApiError::Unauthenticated) => return Err(refuse(parts, state)),
        Err(error) => return Err(error),
    };
    if snapshot.user_status == UserStatus::Deleted {
        return Err(refuse(parts, state));
    }

    let path = parts
        .extensions
        .get::<MatchedPath>()
        .map_or_else(|| parts.uri.path().to_owned(), |p| p.as_str().to_owned());
    let group = Group::for_request(&parts.method, &path);
    state
        .limiter
        .check(group, &user_key(&claims.sub))
        .map_err(|retry_after_seconds| ApiError::RateLimited {
            retry_after_seconds,
        })?;

    state
        .activity
        .touch(&state.db, snapshot.user_id, snapshot.profile_id);
    parts.extensions.insert(snapshot.clone());
    Ok(snapshot)
}

/// How a request whose token was refused was answered. It is kept in the request extensions so
/// that a second extractor on the same request answers alike without counting it again.
#[derive(Debug, Clone, Copy)]
struct Refused {
    retry_after_seconds: Option<u64>,
}

impl Refused {
    fn error(self) -> ApiError {
        match self.retry_after_seconds {
            Some(retry_after_seconds) => ApiError::RateLimited {
                retry_after_seconds,
            },
            None => ApiError::Unauthenticated,
        }
    }
}

/// Refuses a request with no token, a malformed, invalid or expired token, or a deleted
/// account. A request that carried a token counts against its client IP in the
/// `Unauthenticated` group (15 section 3.1), so a flood of bad tokens meets the same limit as
/// requests without one; `middleware::ip_rate_limit` already counted the requests without one.
/// Answers `401 unauthenticated`, or `429 rate_limited` once the IP has used its allowance.
fn refuse(parts: &mut Parts, state: &AppState) -> ApiError {
    let retry_after_seconds = if parts.headers.contains_key(AUTHORIZATION) {
        let ip = client_ip_of(&parts.headers, &parts.extensions);
        state.limiter.check(Group::Unauthenticated, &ip).err()
    } else {
        None
    };
    let refused = Refused {
        retry_after_seconds,
    };
    parts.extensions.insert(refused);
    refused.error()
}

fn require_open(snapshot: &AccountSnapshot) -> Result<(), ApiError> {
    match snapshot.user_status {
        UserStatus::Banned => Err(ApiError::AccountBanned {
            reason: snapshot.status_reason.clone(),
        }),
        UserStatus::Suspended => Err(ApiError::AccountSuspended {
            reason: snapshot.status_reason.clone(),
            suspended_until: snapshot.suspended_until,
        }),
        UserStatus::DeletionScheduled => Err(ApiError::AccountDeletionScheduled {
            purge_after: snapshot.purge_after,
        }),
        UserStatus::Deleted => Err(ApiError::Unauthenticated),
        UserStatus::Active if snapshot.profile_status == ProfileStatus::Suspended => {
            Err(ApiError::AccountSuspended {
                reason: snapshot.status_reason.clone(),
                suspended_until: snapshot.suspended_until,
            })
        }
        UserStatus::Active => Ok(()),
    }
}

/// Consent is checked only once the profile has left `draft` (03 section 5.1).
fn require_connected(snapshot: &AccountSnapshot) -> Result<(), ApiError> {
    require_open(snapshot)?;
    match snapshot.profile_status {
        ProfileStatus::Draft => Err(ApiError::OnboardingRequired {
            onboarding_step: snapshot.onboarding_step,
        }),
        _ if !snapshot.consents_current() => Err(ApiError::ConsentRequired {
            documents: snapshot.missing_consents.clone(),
        }),
        ProfileStatus::Active | ProfileStatus::Paused | ProfileStatus::Closed => Ok(()),
        status => Err(ApiError::ProfileNotActive { status }),
    }
}

fn require_engage(snapshot: &AccountSnapshot) -> Result<(), ApiError> {
    require_connected(snapshot)?;
    match snapshot.profile_status {
        ProfileStatus::Active | ProfileStatus::Paused => Ok(()),
        status => Err(ApiError::ProfileNotActive { status }),
    }
}

fn require_browse(snapshot: &AccountSnapshot) -> Result<(), ApiError> {
    require_connected(snapshot)?;
    match snapshot.profile_status {
        ProfileStatus::Active => Ok(()),
        status => Err(ApiError::ProfileNotActive { status }),
    }
}

fn require_role(snapshot: &AccountSnapshot, admin_only: bool) -> Result<(), ApiError> {
    let role_ok = if admin_only {
        snapshot.role == UserRole::Admin
    } else {
        snapshot.role.is_staff()
    };
    if snapshot.user_status == UserStatus::Active && role_ok {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

macro_rules! access_level {
    ($(#[$meta:meta])* $name:ident, $check:expr) => {
        $(#[$meta])*
        #[derive(Debug, Clone)]
        pub struct $name(pub Arc<AccountSnapshot>);

        impl Deref for $name {
            type Target = AccountSnapshot;

            fn deref(&self) -> &AccountSnapshot {
                &self.0
            }
        }

        impl FromRequestParts<AppState> for $name {
            type Rejection = ApiError;

            async fn from_request_parts(
                parts: &mut Parts,
                state: &AppState,
            ) -> Result<Self, Self::Rejection> {
                let snapshot = authenticate(parts, state).await?;
                let check: fn(&AccountSnapshot) -> Result<(), ApiError> = $check;
                check(&snapshot)?;
                Ok(Self(snapshot))
            }
        }
    };
}

access_level!(
    /// Level `auth`: a valid token, any user status.
    Auth,
    |_| Ok(())
);
access_level!(
    /// Level `open`: `auth`, plus an active user whose profile is not suspended.
    Open,
    require_open
);
access_level!(
    /// Level `connected`: `open`, plus current consents and a profile that is `active`,
    /// `paused` or `closed`.
    Connected,
    require_connected
);
access_level!(
    /// Level `engage`: `connected`, plus a profile that is `active` or `paused`.
    Engage,
    require_engage
);
access_level!(
    /// Level `browse`: `connected`, plus an `active` profile.
    Browse,
    require_browse
);
access_level!(
    /// Level `moderator`: an active user with the role `moderator` or `admin`.
    Moderator,
    |snapshot| require_role(snapshot, false)
);
access_level!(
    /// Level `admin`: an active user with the role `admin`.
    Admin,
    |snapshot| require_role(snapshot, true)
);

/// Stamps `users.last_seen_at` and `profiles.last_active_at` at most once every 5 minutes per
/// profile (06 section 6.4, 19 section 5). The write is fire-and-forget.
pub struct ActivityTracker {
    recent: Cache<Uuid, ()>,
}

impl Default for ActivityTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl ActivityTracker {
    pub fn new() -> Self {
        Self {
            recent: Cache::builder()
                .max_capacity(50_000)
                .time_to_live(Duration::from_mins(5))
                .build(),
        }
    }

    /// Records activity; writes only when the profile was not stamped in the last 5 minutes.
    pub fn touch(&self, db: &PgPool, user_id: Uuid, profile_id: Uuid) {
        if self.recent.contains_key(&profile_id) {
            return;
        }
        self.recent.insert(profile_id, ());
        let db = db.clone();
        // Two separate statements, each its own transaction holding one row lock at a time, so
        // the stamp can never form a lock cycle with a transaction that locks both rows.
        tokio::spawn(async move {
            let profile = sqlx::query("UPDATE profiles SET last_active_at = now() WHERE id = $1")
                .bind(profile_id)
                .execute(&db)
                .await;
            let user = sqlx::query("UPDATE users SET last_seen_at = now() WHERE id = $1")
                .bind(user_id)
                .execute(&db)
                .await;
            if let Err(error) = profile.and(user) {
                tracing::debug!(%error, "activity stamp failed");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{ConsentDocument, OnboardingStep};

    fn snapshot(user_status: UserStatus, profile_status: ProfileStatus) -> AccountSnapshot {
        AccountSnapshot {
            user_id: Uuid::now_v7(),
            clerk_user_id: "user_1".to_owned(),
            profile_id: Uuid::now_v7(),
            role: UserRole::Member,
            user_status,
            status_reason: Some("reason".to_owned()),
            suspended_until: None,
            purge_after: None,
            profile_status,
            onboarding_step: OnboardingStep::Basics,
            gender: None,
            missing_consents: Vec::new(),
        }
    }

    fn code(result: Result<(), ApiError>) -> &'static str {
        result.err().map_or("ok", |error| error.code())
    }

    #[test]
    fn open_refuses_blocked_accounts() {
        use ProfileStatus::Active;
        assert_eq!(
            code(require_open(&snapshot(UserStatus::Banned, Active))),
            "account_banned"
        );
        assert_eq!(
            code(require_open(&snapshot(UserStatus::Suspended, Active))),
            "account_suspended"
        );
        assert_eq!(
            code(require_open(&snapshot(
                UserStatus::DeletionScheduled,
                Active
            ))),
            "account_deletion_scheduled"
        );
        assert_eq!(
            code(require_open(&snapshot(
                UserStatus::Active,
                ProfileStatus::Suspended
            ))),
            "account_suspended"
        );
        assert_eq!(
            code(require_open(&snapshot(UserStatus::Active, Active))),
            "ok"
        );
    }

    #[test]
    fn connected_follows_the_gate_order() {
        let draft = snapshot(UserStatus::Active, ProfileStatus::Draft);
        assert_eq!(code(require_connected(&draft)), "onboarding_required");

        let mut no_consent = snapshot(UserStatus::Active, ProfileStatus::Active);
        no_consent.missing_consents = vec![ConsentDocument::Terms];
        assert_eq!(code(require_connected(&no_consent)), "consent_required");

        let mut draft_no_consent = draft.clone();
        draft_no_consent.missing_consents = vec![ConsentDocument::Terms];
        assert_eq!(
            code(require_connected(&draft_no_consent)),
            "onboarding_required",
            "consent is not asked during onboarding"
        );

        for status in [
            ProfileStatus::PendingReview,
            ProfileStatus::ChangesRequested,
        ] {
            assert_eq!(
                code(require_connected(&snapshot(UserStatus::Active, status))),
                "profile_not_active"
            );
        }
        for status in [
            ProfileStatus::Active,
            ProfileStatus::Paused,
            ProfileStatus::Closed,
        ] {
            assert_eq!(
                code(require_connected(&snapshot(UserStatus::Active, status))),
                "ok"
            );
        }
    }

    #[test]
    fn engage_and_browse_narrow_the_statuses() {
        let closed = snapshot(UserStatus::Active, ProfileStatus::Closed);
        let paused = snapshot(UserStatus::Active, ProfileStatus::Paused);
        let active = snapshot(UserStatus::Active, ProfileStatus::Active);
        assert_eq!(code(require_engage(&closed)), "profile_not_active");
        assert_eq!(code(require_engage(&paused)), "ok");
        assert_eq!(code(require_browse(&paused)), "profile_not_active");
        assert_eq!(code(require_browse(&active)), "ok");
    }

    #[test]
    fn staff_levels_check_role_and_status() {
        let mut moderator = snapshot(UserStatus::Active, ProfileStatus::Draft);
        moderator.role = UserRole::Moderator;
        assert_eq!(code(require_role(&moderator, false)), "ok");
        assert_eq!(code(require_role(&moderator, true)), "forbidden");

        let mut admin = moderator.clone();
        admin.role = UserRole::Admin;
        assert_eq!(code(require_role(&admin, true)), "ok");

        admin.user_status = UserStatus::Suspended;
        assert_eq!(code(require_role(&admin, true)), "forbidden");

        let member = snapshot(UserStatus::Active, ProfileStatus::Active);
        assert_eq!(code(require_role(&member, false)), "forbidden");
    }
}
