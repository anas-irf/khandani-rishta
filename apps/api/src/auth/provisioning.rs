//! First-request user creation (06 section 5).
//!
//! The API creates its rows for a Clerk user the first time that user makes an authenticated
//! request (or when the `sync_clerk_user` job runs first). Concurrent first requests are safe:
//! `ON CONFLICT (clerk_user_id) DO NOTHING` plus a re-read gives every caller the same rows.

use std::sync::Arc;

use rand::Rng;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::account::{self, AccountSnapshot};
use crate::error::ApiError;
use crate::services::ServiceError;
use crate::services::clerk::ClerkUser;
use crate::services::crypto::Crypto;
use crate::state::AppState;

/// Crockford base32 without I, L, O and U (04 section 5.1).
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// Attempts at a unique `public_code` before giving up.
const PUBLIC_CODE_ATTEMPTS: usize = 5;
/// `status_reason` of an account created as banned.
pub const BANNED_AT_CREATION_REASON: &str = "This account cannot be used.";

/// `KR` plus 8 random Crockford base32 characters, for example `KR7F3K2QX9`.
pub fn generate_public_code() -> String {
    let mut rng = rand::rng();
    let mut code = String::with_capacity(10);
    code.push_str("KR");
    for _ in 0..8 {
        // 2^32 is a multiple of 32, so the modulo has no bias.
        code.push(char::from(CROCKFORD[(rng.next_u32() % 32) as usize]));
    }
    code
}

/// The caller's snapshot: from the cache, from the database, or by provisioning the rows from
/// Clerk (06 section 5.1).
pub async fn resolve_account(
    state: &AppState,
    clerk_user_id: &str,
) -> Result<Arc<AccountSnapshot>, ApiError> {
    if let Some(snapshot) = state.accounts.get(clerk_user_id) {
        return Ok(snapshot);
    }
    let settings = state.settings.get().await?;
    if let Some(snapshot) = account::load(&state.db, clerk_user_id, &settings).await? {
        let snapshot = Arc::new(snapshot);
        state.accounts.insert(snapshot.clone());
        return Ok(snapshot);
    }

    let clerk_user = match state.clerk.get_user(clerk_user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return Err(ApiError::Unauthenticated),
        Err(error) => {
            tracing::warn!(%error, "Clerk unavailable during provisioning");
            return Err(ApiError::ServiceUnavailable);
        }
    };
    provision(&state.db, &state.crypto, &clerk_user).await?;

    let snapshot = account::load(&state.db, clerk_user_id, &settings)
        .await?
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("provisioned user not found")))?;
    let snapshot = Arc::new(snapshot);
    state.accounts.insert(snapshot.clone());
    Ok(snapshot)
}

/// Whether the email or phone of a Clerk user is on the ban list.
pub async fn is_banned_identity(
    db: &PgPool,
    crypto: &Crypto,
    email: Option<&str>,
    phone_e164: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let email_hash = email.map(|email| crypto.email_hash(email));
    let phone_hash = phone_e164.map(|phone| crypto.phone_hash(phone));
    sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM banned_identities
             WHERE (kind = 'email' AND value_hash = $1) OR (kind = 'phone' AND value_hash = $2))",
    )
    .bind(email_hash)
    .bind(phone_hash)
    .fetch_one(db)
    .await
}

/// Creates the `users`, `profiles`, `profile_privacy` and `notification_preferences` rows in one
/// transaction (06 section 5.1 step 5d). Returns the new user id, or `None` when the rows
/// already existed (another request or the webhook job won the race).
pub async fn provision(
    db: &PgPool,
    crypto: &Crypto,
    clerk_user: &ClerkUser,
) -> Result<Option<Uuid>, ApiError> {
    let banned = is_banned_identity(
        db,
        crypto,
        clerk_user.email.as_deref(),
        clerk_user.phone_e164.as_deref(),
    )
    .await?;

    let mut tx = db.begin().await?;
    let user_id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO users (id, clerk_user_id, email, email_verified, phone_e164, phone_verified,
                            status, status_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (clerk_user_id) DO NOTHING
         RETURNING id",
    )
    .bind(Uuid::now_v7())
    .bind(&clerk_user.id)
    .bind(&clerk_user.email)
    .bind(clerk_user.email_verified)
    .bind(&clerk_user.phone_e164)
    .bind(clerk_user.phone_verified)
    .bind(if banned { "banned" } else { "active" })
    .bind(banned.then_some(BANNED_AT_CREATION_REASON))
    .fetch_optional(&mut *tx)
    .await?;
    let Some(user_id) = user_id else {
        tx.rollback().await?;
        return Ok(None);
    };

    let profile_id = Uuid::now_v7();
    let mut inserted = false;
    for _ in 0..PUBLIC_CODE_ATTEMPTS {
        inserted = sqlx::query(
            "INSERT INTO profiles (id, user_id, public_code, is_phone_verified)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (public_code) DO NOTHING",
        )
        .bind(profile_id)
        .bind(user_id)
        .bind(generate_public_code())
        .bind(clerk_user.phone_verified)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if inserted {
            break;
        }
    }
    if !inserted {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "no unique public code after {PUBLIC_CODE_ATTEMPTS} attempts"
        )));
    }

    sqlx::query("INSERT INTO profile_privacy (profile_id) VALUES ($1)")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO notification_preferences (user_id) VALUES ($1)")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    tracing::info!(event = "user.created", %user_id, %profile_id, banned, "user created");
    Ok(Some(user_id))
}

impl From<ServiceError> for ApiError {
    fn from(error: ServiceError) -> Self {
        match error {
            ServiceError::Disabled | ServiceError::Temporary(_) => {
                tracing::warn!(%error, "integration unavailable");
                Self::ServiceUnavailable
            }
            ServiceError::Permanent(message) => Self::Internal(anyhow::anyhow!(message)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_codes_match_the_schema_pattern() {
        let pattern = regex::Regex::new("^KR[0-9A-HJKMNP-TV-Z]{8}$").unwrap();
        for _ in 0..500 {
            let code = generate_public_code();
            assert!(pattern.is_match(&code), "{code}");
        }
    }
}
