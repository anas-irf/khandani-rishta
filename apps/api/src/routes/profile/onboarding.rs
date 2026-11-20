//! `POST /v1/me/onboarding/continue`, `POST /v1/me/onboarding/complete` and
//! `POST /v1/me/profile/resubmit` (15 section 7, 03 sections 4.2 and 4.3, 07 sections 2 and 14).

use axum::Json;
use axum::extract::State;
use serde_json::json;
use time::OffsetDateTime;

use crate::auth::Open;
use crate::db::profiles::{self, onboarding};
use crate::domain::types::{OnboardingStep, ProfileStatus};
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::extract::ApiJson;
use crate::jobs::{NewJob, enqueue};
use crate::models::me::{self, Me};
use crate::models::profile::ContinueBody;
use crate::notify::queue_email;
use crate::routes::profile::steps::{self, StepFacts};
use crate::settings::ReviewMode;
use crate::state::AppState;

/// `409 invalid_state` that tells the client where the profile really is (15 section 7).
fn out_of_step(row: &profiles::ProfileRow) -> ApiError {
    ApiError::InvalidState {
        details: json!({
            "onboarding_step": row.onboarding_step,
            "status": row.status,
        }),
    }
}

/// Mark the current onboarding step as done.
///
/// `step` must equal the current `onboarding_step` and must not be `review` or `done`. The
/// step's requirement (03 section 4.3) is checked against the saved profile; on failure the
/// answer is `validation_failed` naming the missing fields. Returns `Me`.
#[utoipa::path(
    post,
    path = "/me/onboarding/continue",
    tag = "profile",
    security(("bearer" = [])),
    request_body = ContinueBody,
    responses(
        (status = 200, body = Me),
        (status = 400, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn post_continue(
    State(state): State<AppState>,
    account: Open,
    ApiJson(body): ApiJson<ContinueBody>,
) -> ApiResult<Json<Me>> {
    let settings = state.settings.get().await?;
    let reference = state.reference.get();
    let mut tx = state.db.begin().await?;
    let row = profiles::load_profile(&mut tx, account.profile_id, true).await?;
    let step = row.onboarding_step;
    if row.status != ProfileStatus::Draft
        || body.step != step.as_str()
        || matches!(step, OnboardingStep::Review | OnboardingStep::Done)
    {
        return Err(out_of_step(&row));
    }

    let facts = StepFacts {
        settings: &settings,
        reference: &reference,
        now: OffsetDateTime::now_utc(),
    };
    let errors = steps::step_requirements(&mut tx, &facts, &row, step).await?;
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let skipped = steps::step_was_skipped(&mut tx, &row, step).await?;
    onboarding::set_step(&mut tx, row.id, step.next()).await?;
    tx.commit().await?;

    state.accounts.invalidate(account.user_id);
    tracing::info!(
        event = "onboarding.step_completed",
        user_id = %account.user_id,
        profile_id = %account.profile_id,
        step = %step,
        skipped,
        "onboarding step completed"
    );
    Ok(Json(me::reload(&state, &account).await?))
}

/// Finish onboarding.
///
/// Requires `onboarding_step = review`. Re-validates every required field and the 18+ rule,
/// then sets the status to `active`, or to `pending_review` when `moderation.profile_review` is
/// `manual` or a system report about the profile is open (13 section 2.3). Enqueues the first
/// recommendations refresh and, for a profile that goes live, the `welcome` email. Returns `Me`.
#[utoipa::path(
    post,
    path = "/me/onboarding/complete",
    tag = "profile",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Me),
        (status = 400, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn post_complete(State(state): State<AppState>, account: Open) -> ApiResult<Json<Me>> {
    let settings = state.settings.get().await?;
    let reference = state.reference.get();
    let mut tx = state.db.begin().await?;
    let row = profiles::load_profile(&mut tx, account.profile_id, true).await?;
    if row.status != ProfileStatus::Draft || row.onboarding_step != OnboardingStep::Review {
        return Err(out_of_step(&row));
    }

    let facts = StepFacts {
        settings: &settings,
        reference: &reference,
        now: OffsetDateTime::now_utc(),
    };
    let errors = steps::all_requirements(&mut tx, &facts, &row).await?;
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }

    let needs_review = settings.profile_review == ReviewMode::Manual
        || onboarding::has_open_system_report(&mut tx, row.id).await?;
    let status = if needs_review {
        ProfileStatus::PendingReview
    } else {
        ProfileStatus::Active
    };
    onboarding::complete_onboarding(&mut tx, row.id, status).await?;
    profiles::recompute_completeness(&mut tx, row.id).await?;
    // The first refresh (10 section 8.6): one queued job per profile.
    enqueue(
        &mut *tx,
        NewJob::new(
            "refresh_recommendations",
            json!({ "profile_id": row.id, "notify": false }),
        )
        .dedupe(row.id.to_string()),
    )
    .await?;
    if status == ProfileStatus::Active {
        queue_email(
            &mut *tx,
            row.user_id,
            "welcome",
            json!({}),
            Some(format!("welcome:{}", row.user_id)),
        )
        .await?;
    }
    let seconds_since_signup = onboarding::seconds_since_signup(&mut tx, row.user_id).await?;
    tx.commit().await?;

    state.jobs.wake();
    state.accounts.invalidate(account.user_id);
    tracing::info!(
        event = "onboarding.completed",
        user_id = %account.user_id,
        profile_id = %account.profile_id,
        result = %status,
        seconds_since_signup,
        "onboarding completed"
    );
    tracing::info!(
        event = "profile.status_changed",
        user_id = %account.user_id,
        profile_id = %account.profile_id,
        from = %ProfileStatus::Draft,
        to = %status,
        "profile status changed"
    );
    Ok(Json(me::reload(&state, &account).await?))
}

/// Send a `changes_requested` profile back to review.
///
/// Requires `status = changes_requested` (`invalid_state` otherwise). Re-validates every
/// required field as `complete` does, sets the status to `pending_review` and clears
/// `status_reason`. Returns `Me`.
#[utoipa::path(
    post,
    path = "/me/profile/resubmit",
    tag = "profile",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Me),
        (status = 400, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn post_resubmit(State(state): State<AppState>, account: Open) -> ApiResult<Json<Me>> {
    let settings = state.settings.get().await?;
    let reference = state.reference.get();
    let mut tx = state.db.begin().await?;
    let row = profiles::load_profile(&mut tx, account.profile_id, true).await?;
    if row.status != ProfileStatus::ChangesRequested {
        return Err(ApiError::invalid_state(row.status));
    }

    let facts = StepFacts {
        settings: &settings,
        reference: &reference,
        now: OffsetDateTime::now_utc(),
    };
    let errors = steps::all_requirements(&mut tx, &facts, &row).await?;
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    onboarding::resubmit(&mut tx, row.id).await?;
    tx.commit().await?;

    state.accounts.invalidate(account.user_id);
    tracing::info!(
        event = "profile.status_changed",
        user_id = %account.user_id,
        profile_id = %account.profile_id,
        from = %ProfileStatus::ChangesRequested,
        to = %ProfileStatus::PendingReview,
        "profile status changed"
    );
    Ok(Json(me::reload(&state, &account).await?))
}
