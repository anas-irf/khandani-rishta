//! `GET` and `PUT /v1/me/identity` (15 section 7, 12 sections 2 and 3, 20 section 2.1).
//!
//! The plain number exists only inside `IdentityNumber`, which has no `Debug` and zeroes its
//! memory on drop. It is never logged, never returned and never part of an error.

use axum::Json;
use axum::extract::State;
use serde_json::json;

use crate::auth::Open;
use crate::db::profiles::identity::{self as sql, IdentityRow};
use crate::db::profiles::recompute_completeness;
use crate::domain::identity_number::{IdentityError, IdentityNumber, mask};
use crate::domain::options::Gender;
use crate::domain::types::IdentityStatus;
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode, FieldError};
use crate::extract::ApiJson;
use crate::models::profile::{IdentityBody, IdentitySummary};
use crate::state::AppState;

fn summary(row: &IdentityRow) -> IdentitySummary {
    IdentitySummary {
        document_type: row.document_type,
        number_masked: mask(&row.number_last4),
        status: row.status,
        verified_at: row.verified_at,
    }
}

/// The identity document summary, or `null` while no number was registered. The number is
/// never returned.
#[utoipa::path(
    get,
    path = "/me/identity",
    tag = "profile",
    security(("bearer" = [])),
    responses((status = 200, body = Option<IdentitySummary>), (status = 403, body = ErrorBody))
)]
pub async fn get_identity(
    State(state): State<AppState>,
    account: Open,
) -> ApiResult<Json<Option<IdentitySummary>>> {
    let mut conn = state.db.acquire().await?;
    let row = sql::summary(&mut conn, account.profile_id).await?;
    Ok(Json(row.as_ref().map(summary)))
}

/// Register or replace the identity document number.
///
/// Rules of 12 section 3: the number is normalised and checked against the document type and
/// the profile's gender, hashed with the pepper and compared with `banned_identities` and the
/// other profiles, then stored encrypted with the profile id as associated data. A `pending`
/// or `verified` identity cannot be changed (`invalid_state`); a `rejected` one is replaced and
/// goes back to `unverified`.
#[utoipa::path(
    put,
    path = "/me/identity",
    tag = "profile",
    security(("bearer" = [])),
    request_body = IdentityBody,
    responses(
        (status = 200, body = IdentitySummary),
        (status = 400, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn put_identity(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<IdentityBody>,
) -> ApiResult<Json<IdentitySummary>> {
    let profile_id = account.profile_id;
    let mut tx = state.db.begin().await?;
    // Lock the profile so that two requests for one profile run one after the other.
    let gender: Option<Gender> =
        sqlx::query_scalar("SELECT gender FROM profiles WHERE id = $1 FOR UPDATE")
            .bind(profile_id)
            .fetch_one(&mut *tx)
            .await?;

    // 12 section 3.6.
    if let Some(current) = sql::load_for_update(&mut tx, profile_id).await?
        && matches!(
            current.status,
            IdentityStatus::Pending | IdentityStatus::Verified
        )
    {
        return Err(ApiError::InvalidState {
            details: json!({ "identity_status": current.status }),
        });
    }

    // 12 section 3.3.
    let number = match IdentityNumber::parse(body.document_type, body.number.expose(), gender) {
        Ok(number) => number,
        Err(IdentityError::GenderUnknown) => {
            return Err(ApiError::InvalidState {
                details: json!({ "reason": "gender_required" }),
            });
        }
        Err(error) => {
            let code = match error.field_code() {
                Some("required") => FieldCode::Required,
                Some("mismatch") => FieldCode::Mismatch,
                _ => FieldCode::Invalid,
            };
            return Err(ApiError::Validation(vec![FieldError::with_message(
                "number",
                code,
                error.message(),
            )]));
        }
    };

    // 12 section 3.4: the same answer for a ban and for a number held by another profile.
    let hash = state
        .crypto
        .keyed_hash(number.namespace().as_str(), number.as_str());
    if sql::is_banned(&mut tx, &hash).await?
        || sql::is_taken_by_other(&mut tx, &hash, profile_id).await?
    {
        return Err(ApiError::IdentityAlreadyRegistered);
    }

    // 12 section 3.5.
    let encrypted = state.crypto.encrypt_identity(profile_id, number.as_str());
    let row = match sql::upsert(
        &mut tx,
        profile_id,
        number.document_type(),
        &encrypted,
        &hash,
        &number.last4(),
    )
    .await
    {
        Ok(row) => row,
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
            return Err(ApiError::IdentityAlreadyRegistered);
        }
        Err(error) => return Err(error.into()),
    };
    recompute_completeness(&mut tx, profile_id).await?;
    tx.commit().await?;
    Ok(Json(summary(&row)))
}
