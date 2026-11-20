//! What each onboarding step requires (03 section 4.3 and 07), checked by `continue` for one
//! step and by `complete` and `resubmit` for all of them.
//!
//! The checks read the saved profile, not a request body, so they also catch a requirement
//! that was met when the step was saved and not any more (for example the only photo was
//! rejected in between).

use sqlx::PgConnection;
use time::OffsetDateTime;

use crate::db::profiles::ProfileRow;
use crate::db::profiles::onboarding;
use crate::domain::options::{ChildrenStatus, ManagedBy, MaritalStatus};
use crate::domain::time::{age_on, karachi_date};
use crate::domain::types::{ConsentDocument, OnboardingStep};
use crate::error::{FieldCode, FieldError};
use crate::reference::ReferenceData;
use crate::routes::profile::rules::Checker;
use crate::settings::AppSettings;

/// What the checks need besides the profile.
pub struct StepFacts<'a> {
    pub settings: &'a AppSettings,
    pub reference: &'a ReferenceData,
    pub now: OffsetDateTime,
}

/// The steps whose requirement `complete` and `resubmit` check again, in order. `family` and
/// `lifestyle` can be skipped, and `review` is completed by `complete` itself.
pub const CHECKED_STEPS: [OnboardingStep; 8] = [
    OnboardingStep::AccountFor,
    OnboardingStep::Basics,
    OnboardingStep::Community,
    OnboardingStep::Location,
    OnboardingStep::EducationCareer,
    OnboardingStep::Photos,
    OnboardingStep::Preferences,
    OnboardingStep::Identity,
];

/// The field errors of one step. An empty list means the step may be continued.
#[expect(clippy::too_many_lines, reason = "one arm per step of 03 section 4.3")]
pub async fn step_requirements(
    conn: &mut PgConnection,
    facts: &StepFacts<'_>,
    row: &ProfileRow,
    step: OnboardingStep,
) -> sqlx::Result<Vec<FieldError>> {
    let mut c = Checker::new(false);
    match step {
        OnboardingStep::AccountFor => {
            let account_for = &row.account_for;
            c.need("managed_by", account_for.managed_by.is_some());
            let managed = account_for
                .managed_by
                .is_some_and(|managed_by| managed_by != ManagedBy::Candidate);
            if managed {
                c.need("manager_name", account_for.manager_name.is_some());
            }
            let recorded = onboarding::recorded_consents(conn, row.user_id, facts.settings).await?;
            let mut needed = vec![
                ConsentDocument::Terms,
                ConsentDocument::Privacy,
                ConsentDocument::CommunityGuidelines,
                ConsentDocument::AgeDeclaration,
            ];
            if managed {
                needed.push(ConsentDocument::CandidateConsent);
            }
            if needed.iter().any(|document| !recorded.contains(document)) {
                c.fail("consents", FieldCode::Required);
            }
        }
        OnboardingStep::Basics => {
            let basics = &row.basics;
            c.need("first_name", basics.first_name.is_some());
            c.need("last_name", basics.last_name.is_some());
            c.need("gender", basics.gender.is_some());
            c.need("marital_status", basics.marital_status.is_some());
            c.need("height_cm", basics.height_cm.is_some());
            match row.date_of_birth() {
                None => c.need("date_of_birth", false),
                Some(date) => {
                    let age = age_on(date, karachi_date(facts.now));
                    if age < 18 {
                        c.fail("date_of_birth", FieldCode::TooYoung);
                    } else if age > 80 {
                        c.fail("date_of_birth", FieldCode::OutOfRange);
                    }
                }
            }
            if basics.marital_status == Some(MaritalStatus::Married) {
                c.need("current_wives_count", basics.current_wives_count.is_some());
            }
            if basics
                .marital_status
                .is_some_and(|status| status != MaritalStatus::NeverMarried)
            {
                c.need("children_status", basics.children_status.is_some());
            }
            if basics
                .children_status
                .is_some_and(|status| status != ChildrenStatus::None)
            {
                c.need("children_count", basics.children_count.is_some());
            }
        }
        OnboardingStep::Community => {
            let community = &row.community;
            c.need("religion_code", community.religion_code.is_some());
            c.need("mother_tongue_code", community.mother_tongue_code.is_some());
            if let Some(religion) = &community.religion_code
                && facts.reference.religion_has_sects(religion)
            {
                c.need("sect_code", community.sect_code.is_some());
            }
        }
        OnboardingStep::Location => {
            let location = &row.location;
            c.need("country_code", location.country_code.is_some());
            if location.city_id.is_none() && location.city_other.is_none() {
                c.need("city_id", false);
            }
            if location.city_id.is_none()
                && location.city_other.is_some()
                && let Some(country) = &location.country_code
                && crate::db::profiles::country_has_regions(conn, country).await?
            {
                c.need("region_id", location.region_id.is_some());
            }
            if let (Some(country), Some(nationality)) =
                (&location.country_code, &location.nationality_code)
                && country != nationality
            {
                c.need("residency_status", location.residency_status.is_some());
            }
        }
        OnboardingStep::EducationCareer => {
            c.need(
                "education_level_code",
                row.education_career.education_level_code.is_some(),
            );
            c.need(
                "employment_type",
                row.education_career.employment_type.is_some(),
            );
        }
        OnboardingStep::Photos => {
            if facts.settings.photo_required
                && onboarding::live_photo_count(conn, row.id).await? == 0
            {
                c.fail_with(
                    "photos",
                    FieldCode::Required,
                    "Add at least one photo to continue.",
                );
            }
        }
        OnboardingStep::Preferences => {
            if !row.has_preferences {
                c.fail("preferences", FieldCode::Required);
            }
        }
        OnboardingStep::Identity => {
            if facts.settings.identity_required && row.identity.identity_status.is_none() {
                c.fail_with(
                    "number",
                    FieldCode::Required,
                    "Enter the identity number to continue.",
                );
            }
        }
        // Family and lifestyle can be skipped; review is completed by `complete`.
        OnboardingStep::Family
        | OnboardingStep::Lifestyle
        | OnboardingStep::Review
        | OnboardingStep::Done => {}
    }
    Ok(c.errors.into_inner())
}

/// The field errors of every step, for `complete` and `resubmit` (15 section 7: "re-validates
/// every required field").
pub async fn all_requirements(
    conn: &mut PgConnection,
    facts: &StepFacts<'_>,
    row: &ProfileRow,
) -> sqlx::Result<Vec<FieldError>> {
    let mut errors = Vec::new();
    for step in CHECKED_STEPS {
        errors.extend(step_requirements(conn, facts, row, step).await?);
    }
    Ok(errors)
}

/// Whether a skippable step was left without saving anything (`skipped` of the
/// `onboarding.step_completed` event, 20 section 8.2).
pub async fn step_was_skipped(
    conn: &mut PgConnection,
    row: &ProfileRow,
    step: OnboardingStep,
) -> sqlx::Result<bool> {
    Ok(match step {
        OnboardingStep::Family => is_blank(&row.family),
        OnboardingStep::Lifestyle => is_blank(&row.lifestyle),
        OnboardingStep::Photos => onboarding::photo_count(conn, row.id).await? == 0,
        OnboardingStep::Identity => row.identity.identity_status.is_none(),
        _ => false,
    })
}

/// A section with every value `null` or empty.
fn is_blank(section: &impl serde::Serialize) -> bool {
    serde_json::to_value(section)
        .ok()
        .and_then(|value| {
            value.as_object().map(|map| {
                map.values()
                    .all(|value| value.is_null() || value.as_array().is_some_and(Vec::is_empty))
            })
        })
        .unwrap_or(false)
}
