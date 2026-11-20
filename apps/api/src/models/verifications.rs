//! API types for verifications (15 section 9) and the selfie challenge (12 section 4.2).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::options::VerificationRejectionReason;
use crate::domain::text_enum;
use crate::domain::types::{Gesture, VerificationKind, VerificationStatus};

/// The identity summary is shared with the own-profile response (15 section 4.3).
pub use crate::models::profile::IdentitySummary;

/// One verification request as its owner sees it. The reviewer's note stays with staff.
#[derive(Debug, Clone, Serialize, ToSchema, sqlx::FromRow)]
pub struct VerificationRequestSummary {
    pub id: Uuid,
    pub kind: VerificationKind,
    pub status: VerificationStatus,
    pub rejection_reason: Option<VerificationRejectionReason>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub reviewed_at: Option<OffsetDateTime>,
}

/// `GET /v1/me/verifications` (15 section 9).
#[derive(Debug, Serialize, ToSchema)]
#[allow(clippy::struct_excessive_bools)] // The three badges of 12 section 1.1.
pub struct VerificationOverview {
    pub phone_verified: bool,
    pub photo_verified: bool,
    pub id_verified: bool,
    pub identity: Option<IdentitySummary>,
    /// Newest first, at most 10.
    pub requests: Vec<VerificationRequestSummary>,
}

/// `GET /v1/me/verifications/selfie-challenge`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SelfieChallenge {
    pub gesture: Gesture,
}

/// The gesture to show for a profile on a day (12 section 4.2):
/// `gestures[SHA-256(profile_id + ":" + day)[0] mod 4]` with the gestures in the order
/// `peace_sign`, `thumbs_up`, `open_palm`, `hand_on_head` and the day in `Asia/Karachi` as
/// `YYYY-MM-DD`. Needs no storage and is stable for the day.
pub fn challenge_for(profile_id: Uuid, day: Date) -> Gesture {
    const GESTURES: [Gesture; 4] = [
        Gesture::PeaceSign,
        Gesture::ThumbsUp,
        Gesture::OpenPalm,
        Gesture::HandOnHead,
    ];
    let digest = Sha256::digest(format!("{profile_id}:{day}").as_bytes());
    GESTURES[usize::from(digest[0] % 4)]
}

text_enum! {
    /// Which image of a request an upload is for (15 section 9).
    UploadSlot { Front = "front", Back = "back", Selfie = "selfie" }
}

/// `POST /v1/me/verifications/uploads`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VerificationUploadRequest {
    pub slot: UploadSlot,
    /// `image/jpeg`, `image/png` or `image/webp`.
    pub content_type: String,
    /// The size of the file in bytes, at most 10 MiB.
    pub size_bytes: i64,
}

/// `POST /v1/me/verifications` (15 section 9): an identity check or a photo check.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SubmitVerification {
    IdDocument {
        front_key: String,
        /// Required for `cnic`, `nicop` and `poc`.
        back_key: Option<String>,
        selfie_key: String,
        gesture: String,
    },
    Selfie {
        selfie_key: String,
        gesture: String,
    },
}

#[cfg(test)]
mod tests {
    use time::macros::date;

    use super::*;

    #[test]
    fn the_challenge_is_stable_for_a_day_and_follows_the_spec_formula() {
        let profile = Uuid::parse_str("0193a2c4-0000-7000-8000-000000000001").unwrap();
        let day = date!(2026 - 11 - 20);
        assert_eq!(challenge_for(profile, day), challenge_for(profile, day));

        let digest = Sha256::digest(format!("{profile}:2026-11-20").as_bytes());
        let expected =
            ["peace_sign", "thumbs_up", "open_palm", "hand_on_head"][usize::from(digest[0] % 4)];
        assert_eq!(challenge_for(profile, day).as_str(), expected);
    }

    #[test]
    fn every_gesture_comes_up_across_days_and_profiles() {
        let mut seen = std::collections::HashSet::new();
        let mut day = date!(2026 - 11 - 1);
        for _ in 0..60 {
            seen.insert(challenge_for(Uuid::now_v7(), day));
            day = day.next_day().unwrap();
        }
        assert_eq!(seen.len(), 4);
    }

    #[test]
    fn submissions_are_told_apart_by_kind_and_refuse_unknown_keys() {
        let id: SubmitVerification = serde_json::from_value(serde_json::json!({
            "kind": "id_document", "front_key": "a", "back_key": null, "selfie_key": "c",
            "gesture": "peace_sign",
        }))
        .unwrap();
        assert!(matches!(
            id,
            SubmitVerification::IdDocument { back_key: None, .. }
        ));
        let selfie: SubmitVerification = serde_json::from_value(serde_json::json!({
            "kind": "selfie", "selfie_key": "c", "gesture": "thumbs_up",
        }))
        .unwrap();
        assert!(matches!(selfie, SubmitVerification::Selfie { .. }));
        assert!(
            serde_json::from_value::<SubmitVerification>(serde_json::json!({
                "kind": "selfie", "selfie_key": "c", "gesture": "thumbs_up", "front_key": "x",
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<SubmitVerification>(serde_json::json!({ "kind": "other" }))
                .is_err()
        );
    }
}
