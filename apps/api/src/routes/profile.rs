//! Onboarding and the member's own profile (15 section 7).
//!
//! The handlers of the profile and its sections are here; the rest lives in the modules below,
//! one per group of endpoints:
//!
//! - `sections`: validation and saving of the eight sections (07 sections 3 to 9, 08 section 3).
//! - `steps`: what each onboarding step requires (03 section 4.3).
//! - `onboarding`: `continue`, `complete` and `resubmit`.
//! - `status`: `pause`, `resume`, `close` and `reopen`.
//! - `preferences`: partner preferences and privacy settings.
//! - `identity`: the identity document number.
//!
//! `GET /v1/me/profile/preview` belongs to the profile view (15 section 17), not to this file.

mod identity;
mod onboarding;
mod preferences;
mod rules;
mod sections;
mod status;
mod steps;
#[cfg(test)]
mod tests;

use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use serde_json::Value;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Open;
use crate::db::profiles;
use crate::error::{ApiResult, ErrorBody};
use crate::extract::{ApiJson, ApiPath};
use crate::models::profile::{OwnProfile, Section, SectionBody};
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(get_profile))
        .routes(routes!(put_section))
        .routes(routes!(onboarding::post_continue))
        .routes(routes!(onboarding::post_complete))
        .routes(routes!(onboarding::post_resubmit))
        .routes(routes!(status::post_pause))
        .routes(routes!(status::post_resume))
        .routes(routes!(status::post_close))
        .routes(routes!(status::post_reopen))
        .routes(routes!(
            preferences::get_preferences,
            preferences::put_preferences
        ))
        .routes(routes!(
            preferences::get_privacy,
            preferences::patch_privacy
        ))
        .routes(routes!(identity::get_identity, identity::put_identity))
}

/// The owner's complete view of the profile: every section, `missing`, `locked_fields`, the
/// photos, the identity summary, the verification state and the status of the moderated texts.
#[utoipa::path(
    get,
    path = "/me/profile",
    tag = "profile",
    security(("bearer" = [])),
    responses(
        (status = 200, body = OwnProfile),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn get_profile(State(state): State<AppState>, account: Open) -> ApiResult<Json<OwnProfile>> {
    Ok(Json(
        profiles::load_own_profile(&state.db, state.storage.as_ref(), account.profile_id).await?,
    ))
}

/// Replace one section of the profile.
///
/// `{section}` is one of `account_for`, `basics`, `community`, `location`, `education_career`,
/// `family`, `lifestyle` and `contacts`. The body is the matching section type of `OwnProfile`;
/// a key sent as `null` clears the value. While the profile is a `draft`, required fields may
/// be `null`; afterwards they can no longer be cleared. Fields in `locked_fields` must be sent
/// with their current value. Recomputes `completeness`, marks the recommendations stale (not
/// for `contacts`) and holds a changed free text for review. Returns the updated `OwnProfile`.
#[utoipa::path(
    put,
    path = "/me/profile/sections/{section}",
    tag = "profile",
    security(("bearer" = [])),
    params(("section" = Section, Path, description = "The section to replace")),
    request_body = SectionBody,
    responses(
        (status = 200, body = OwnProfile),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn put_section(
    State(state): State<AppState>,
    account: Open,
    headers: HeaderMap,
    ApiPath(section): ApiPath<Section>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<OwnProfile>> {
    let saved = sections::save(
        &state,
        account.user_id,
        account.profile_id,
        section,
        body,
        &headers,
    )
    .await?;
    if saved.invalidate_account {
        state.accounts.invalidate(account.user_id);
    }
    if saved.wake_jobs {
        state.jobs.wake();
    }
    Ok(Json(
        profiles::load_own_profile(&state.db, state.storage.as_ref(), account.profile_id).await?,
    ))
}
