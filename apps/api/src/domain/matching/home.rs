//! Nudges on the home screen (10 section 10.1; 15 section 10, `GET /v1/home`). The table is
//! the single definition: evaluate every row and return the three with the highest priority
//! whose condition holds, highest first.

use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::text_enum;

/// At most this many nudges.
pub const MAX_NUDGES: usize = 3;

/// `complete_profile` applies below this completeness.
const COMPLETE_PROFILE_BELOW: i16 = 70;

text_enum! {
    /// A nudge code (10 section 10.1). [`NudgeCode::ALL`] is in priority order, highest first.
    NudgeCode {
        AddPhoto = "add_photo",
        VerifyIdentity = "verify_identity",
        AddAboutMe = "add_about_me",
        SetPreferences = "set_preferences",
        VerifyPhoto = "verify_photo",
        AddContactDetails = "add_contact_details",
        CompleteProfile = "complete_profile",
    }
}

impl NudgeCode {
    /// The priority column of 10 section 10.1.
    pub const fn priority(self) -> u8 {
        match self {
            Self::AddPhoto => 100,
            Self::VerifyIdentity => 90,
            Self::AddAboutMe => 80,
            Self::SetPreferences => 70,
            Self::VerifyPhoto => 60,
            Self::AddContactDetails => 50,
            Self::CompleteProfile => 40,
        }
    }
}

/// One entry of `nudges` in `GET /v1/home` (15 section 10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct Nudge {
    pub code: NudgeCode,
    pub priority: u8,
}

/// The facts the nudge conditions read, loaded by the home handler.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one flag per condition of the nudge table"
)]
pub struct NudgeInput {
    /// A photo with status `approved`, `processing` or `pending_review` exists.
    pub has_photo_in_progress_or_approved: bool,
    /// `profiles.is_id_verified`.
    pub is_id_verified: bool,
    /// A `pending` `id_document` verification request exists.
    pub has_pending_id_document_request: bool,
    /// The `about_me` completeness item of 08 section 6.1 is met (100 or more characters and
    /// not rejected).
    pub about_me_item_met: bool,
    /// A `partner_preferences` row exists.
    pub has_preferences_row: bool,
    /// `profiles.has_approved_photo`.
    pub has_approved_photo: bool,
    /// `profiles.is_photo_verified`.
    pub is_photo_verified: bool,
    /// A `pending` `selfie` verification request exists.
    pub has_pending_selfie_request: bool,
    /// A `profile_contacts` row exists with `phone_e164` or `guardian_phone_e164` set.
    pub has_contact_phone: bool,
    /// `profiles.completeness`.
    pub completeness: i16,
}

/// The nudges to show: up to three, highest priority first (10 section 10.1).
pub fn nudges(input: &NudgeInput) -> Vec<Nudge> {
    let holds = |code: NudgeCode| match code {
        NudgeCode::AddPhoto => !input.has_photo_in_progress_or_approved,
        NudgeCode::VerifyIdentity => {
            !input.is_id_verified && !input.has_pending_id_document_request
        }
        NudgeCode::AddAboutMe => !input.about_me_item_met,
        NudgeCode::SetPreferences => !input.has_preferences_row,
        NudgeCode::VerifyPhoto => {
            input.has_approved_photo
                && !input.is_photo_verified
                && !input.has_pending_selfie_request
        }
        NudgeCode::AddContactDetails => !input.has_contact_phone,
        NudgeCode::CompleteProfile => input.completeness < COMPLETE_PROFILE_BELOW,
    };
    let mut codes: Vec<NudgeCode> = NudgeCode::ALL
        .iter()
        .copied()
        .filter(|code| holds(*code))
        .collect();
    codes.sort_by_key(|code| std::cmp::Reverse(code.priority()));
    codes
        .into_iter()
        .take(MAX_NUDGES)
        .map(|code| Nudge {
            code,
            priority: code.priority(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete() -> NudgeInput {
        NudgeInput {
            has_photo_in_progress_or_approved: true,
            is_id_verified: true,
            has_pending_id_document_request: false,
            about_me_item_met: true,
            has_preferences_row: true,
            has_approved_photo: true,
            is_photo_verified: true,
            has_pending_selfie_request: false,
            has_contact_phone: true,
            completeness: 100,
        }
    }

    fn codes(input: &NudgeInput) -> Vec<NudgeCode> {
        nudges(input).iter().map(|nudge| nudge.code).collect()
    }

    #[test]
    fn a_complete_profile_has_no_nudges() {
        assert_eq!(nudges(&complete()), Vec::<Nudge>::new());
    }

    #[test]
    fn a_new_profile_gets_the_top_three() {
        let input = NudgeInput::default();
        assert_eq!(
            nudges(&input),
            [
                Nudge {
                    code: NudgeCode::AddPhoto,
                    priority: 100
                },
                Nudge {
                    code: NudgeCode::VerifyIdentity,
                    priority: 90
                },
                Nudge {
                    code: NudgeCode::AddAboutMe,
                    priority: 80
                },
            ]
        );
    }

    #[test]
    fn pending_requests_suppress_verification_nudges() {
        let mut input = complete();
        input.is_id_verified = false;
        input.is_photo_verified = false;
        assert_eq!(
            codes(&input),
            [NudgeCode::VerifyIdentity, NudgeCode::VerifyPhoto]
        );
        input.has_pending_id_document_request = true;
        input.has_pending_selfie_request = true;
        assert_eq!(codes(&input), Vec::<NudgeCode>::new());
    }

    #[test]
    fn verify_photo_needs_an_approved_photo() {
        let mut input = complete();
        input.is_photo_verified = false;
        input.has_approved_photo = false;
        assert_eq!(codes(&input), Vec::<NudgeCode>::new());
    }

    #[test]
    fn lower_rows() {
        let mut input = complete();
        input.has_preferences_row = false;
        input.has_contact_phone = false;
        input.completeness = 69;
        assert_eq!(
            codes(&input),
            [
                NudgeCode::SetPreferences,
                NudgeCode::AddContactDetails,
                NudgeCode::CompleteProfile
            ]
        );
        input.completeness = 70;
        assert_eq!(
            codes(&input),
            [NudgeCode::SetPreferences, NudgeCode::AddContactDetails]
        );
    }

    #[test]
    fn priorities_descend_in_table_order() {
        assert!(
            NudgeCode::ALL
                .windows(2)
                .all(|pair| pair[0].priority() > pair[1].priority())
        );
        let json = serde_json::to_value(Nudge {
            code: NudgeCode::AddPhoto,
            priority: 100,
        })
        .unwrap_or_default();
        assert_eq!(
            json,
            serde_json::json!({ "code": "add_photo", "priority": 100 })
        );
    }
}
