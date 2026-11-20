//! The gate: one value that tells a client which area of the app the user may enter
//! (03 section 5.1). Rows are evaluated top to bottom; the first match wins.

use crate::domain::types::{Gate, ProfileStatus, UserStatus};

/// The facts the gate depends on.
#[derive(Debug, Clone, Copy)]
pub struct GateInput {
    pub user_status: UserStatus,
    pub profile_status: ProfileStatus,
    /// `terms`, `privacy` and `community_guidelines` accepted at their current versions.
    pub consents_current: bool,
}

/// Computes the gate (03 section 5.1).
pub fn compute(input: GateInput) -> Gate {
    match input.user_status {
        UserStatus::Banned => return Gate::Banned,
        UserStatus::Suspended => return Gate::Suspended,
        UserStatus::DeletionScheduled => return Gate::DeletionScheduled,
        UserStatus::Active | UserStatus::Deleted => {}
    }
    // A suspended profile always goes with a suspended or banned account; treat it the same.
    if input.profile_status == ProfileStatus::Suspended {
        return Gate::Suspended;
    }
    if !input.consents_current && input.profile_status != ProfileStatus::Draft {
        return Gate::ConsentRequired;
    }
    match input.profile_status {
        ProfileStatus::Draft => Gate::Onboarding,
        ProfileStatus::ChangesRequested => Gate::ChangesRequested,
        ProfileStatus::PendingReview => Gate::PendingReview,
        _ => Gate::Ok,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate(
        user_status: UserStatus,
        profile_status: ProfileStatus,
        consents_current: bool,
    ) -> Gate {
        compute(GateInput {
            user_status,
            profile_status,
            consents_current,
        })
    }

    #[test]
    fn account_states_come_first() {
        assert_eq!(
            gate(UserStatus::Banned, ProfileStatus::Active, false),
            Gate::Banned
        );
        assert_eq!(
            gate(UserStatus::Suspended, ProfileStatus::Suspended, true),
            Gate::Suspended
        );
        assert_eq!(
            gate(UserStatus::DeletionScheduled, ProfileStatus::Draft, false),
            Gate::DeletionScheduled
        );
    }

    #[test]
    fn consent_is_required_only_after_draft() {
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::Active, false),
            Gate::ConsentRequired
        );
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::PendingReview, false),
            Gate::ConsentRequired
        );
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::Draft, false),
            Gate::Onboarding
        );
    }

    #[test]
    fn profile_states() {
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::Draft, true),
            Gate::Onboarding
        );
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::ChangesRequested, true),
            Gate::ChangesRequested
        );
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::PendingReview, true),
            Gate::PendingReview
        );
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::Active, true),
            Gate::Ok
        );
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::Paused, true),
            Gate::Ok
        );
        assert_eq!(
            gate(UserStatus::Active, ProfileStatus::Closed, true),
            Gate::Ok
        );
    }
}
