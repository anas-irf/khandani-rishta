//! Enumerations of the schema that are not member-facing option lists: statuses, kinds and
//! other values with a `CHECK` constraint in 04. Option lists are in [`super::options`].

use crate::domain::text_enum;

text_enum! {
    /// `users.role`.
    UserRole { Member = "member", Moderator = "moderator", Admin = "admin" }
}

impl UserRole {
    /// Moderators and admins.
    pub fn is_staff(self) -> bool {
        matches!(self, Self::Moderator | Self::Admin)
    }
}

text_enum! {
    /// `users.status` (03 section 4.1).
    UserStatus {
        Active = "active",
        Suspended = "suspended",
        Banned = "banned",
        DeletionScheduled = "deletion_scheduled",
        Deleted = "deleted",
    }
}

text_enum! {
    /// `users.locale`.
    Locale { En = "en", Ur = "ur" }
}

text_enum! {
    /// `user_consents.document`.
    ConsentDocument {
        Terms = "terms",
        Privacy = "privacy",
        CommunityGuidelines = "community_guidelines",
        AgeDeclaration = "age_declaration",
        CandidateConsent = "candidate_consent",
    }
}

text_enum! {
    /// `user_devices.platform`.
    DevicePlatform { Android = "android", Web = "web" }
}

text_enum! {
    /// `profiles.status` (03 section 4.2).
    ProfileStatus {
        Draft = "draft",
        PendingReview = "pending_review",
        ChangesRequested = "changes_requested",
        Active = "active",
        Paused = "paused",
        Closed = "closed",
        Suspended = "suspended",
        Deleted = "deleted",
    }
}

text_enum! {
    /// `profiles.onboarding_step` (03 section 4.3), in order.
    OnboardingStep {
        AccountFor = "account_for",
        Basics = "basics",
        Community = "community",
        Location = "location",
        EducationCareer = "education_career",
        Family = "family",
        Lifestyle = "lifestyle",
        Photos = "photos",
        Preferences = "preferences",
        Identity = "identity",
        Review = "review",
        Done = "done",
    }
}

impl OnboardingStep {
    /// The step after this one; `Done` stays `Done`.
    pub fn next(self) -> Self {
        let all = Self::ALL;
        let index = all
            .iter()
            .position(|step| *step == self)
            .unwrap_or(all.len() - 1);
        all.get(index + 1).copied().unwrap_or(Self::Done)
    }
}

text_enum! {
    /// Moderated text status: `about_me_status`, `about_family_status`, `notes_status` (03 section 4.5).
    TextStatus { Approved = "approved", Pending = "pending", Rejected = "rejected" }
}

text_enum! {
    /// `profile_photos.status` (03 section 4.4).
    PhotoStatus {
        Processing = "processing",
        PendingReview = "pending_review",
        Approved = "approved",
        Rejected = "rejected",
        Failed = "failed",
    }
}

text_enum! {
    /// `photo_access.status` (03 section 4.9).
    PhotoAccessStatus {
        Pending = "pending",
        Granted = "granted",
        Denied = "denied",
        Revoked = "revoked",
    }
}

text_enum! {
    /// `verification_requests.kind`.
    VerificationKind { IdDocument = "id_document", Selfie = "selfie" }
}

text_enum! {
    /// `verification_requests.status` (03 section 4.6).
    VerificationStatus {
        Pending = "pending",
        Approved = "approved",
        Rejected = "rejected",
        Cancelled = "cancelled",
    }
}

text_enum! {
    /// `profile_identity.status`.
    IdentityStatus {
        Unverified = "unverified",
        Pending = "pending",
        Verified = "verified",
        Rejected = "rejected",
    }
}

text_enum! {
    /// `verification_requests.gesture`.
    Gesture {
        PeaceSign = "peace_sign",
        ThumbsUp = "thumbs_up",
        OpenPalm = "open_palm",
        HandOnHead = "hand_on_head",
    }
}

text_enum! {
    /// `interests.status` (03 section 4.7).
    InterestStatus {
        Pending = "pending",
        Accepted = "accepted",
        Declined = "declined",
        Withdrawn = "withdrawn",
        Expired = "expired",
    }
}

text_enum! {
    /// `connections.status` (03 section 4.8).
    ConnectionStatus { Active = "active", Ended = "ended" }
}

text_enum! {
    /// `connection_stage_proposals.status`.
    ProposalStatus {
        Pending = "pending",
        Confirmed = "confirmed",
        Declined = "declined",
        Cancelled = "cancelled",
    }
}

text_enum! {
    /// `contact_shares.status` (03 section 4.10).
    ContactShareStatus { Active = "active", Revoked = "revoked" }
}

text_enum! {
    /// `messages.kind`.
    MessageKind { Text = "text", System = "system" }
}

text_enum! {
    /// `messages.system_event`.
    SystemEvent {
        Connected = "connected",
        ContactShared = "contact_shared",
        ContactShareRevoked = "contact_share_revoked",
        StageProposed = "stage_proposed",
        StageConfirmed = "stage_confirmed",
        StageDeclined = "stage_declined",
        ConnectionEnded = "connection_ended",
    }
}

text_enum! {
    /// `messages.safety_flag` (13 section 5).
    SafetyFlag { Money = "money", OffPlatform = "off_platform", ContactInfo = "contact_info" }
}

text_enum! {
    /// `usage_counters.counter`.
    UsageCounter {
        InterestsSent = "interests_sent",
        ProfilesViewed = "profiles_viewed",
        PhotoRequestsSent = "photo_requests_sent",
        MessagesSent = "messages_sent",
        ReportsFiled = "reports_filed",
    }
}

text_enum! {
    /// `reports.source`.
    ReportSource { Member = "member", System = "system" }
}

text_enum! {
    /// `reports.subject_type`.
    ReportSubject { Profile = "profile", Photo = "photo", Message = "message" }
}

text_enum! {
    /// `reports.status` (03 section 4.11).
    ReportStatus {
        Open = "open",
        InReview = "in_review",
        Actioned = "actioned",
        Dismissed = "dismissed",
    }
}

text_enum! {
    /// `sanctions.type`.
    SanctionType { Warning = "warning", Suspension = "suspension", Ban = "ban" }
}

text_enum! {
    /// `banned_identities.kind`.
    BannedIdentityKind { IdentityDocument = "identity_document", Phone = "phone", Email = "email" }
}

text_enum! {
    /// `admin_audit_log.target_type`.
    AuditTargetType {
        User = "user",
        Profile = "profile",
        Photo = "photo",
        VerificationRequest = "verification_request",
        Report = "report",
        Caste = "caste",
        CasteSuggestion = "caste_suggestion",
        AppSetting = "app_setting",
        AppRelease = "app_release",
    }
}

text_enum! {
    /// `notifications.type` (14 section 2).
    NotificationType {
        InterestReceived = "interest_received",
        InterestAccepted = "interest_accepted",
        PhotoRequestReceived = "photo_request_received",
        PhotoRequestGranted = "photo_request_granted",
        ContactShared = "contact_shared",
        StageProposed = "stage_proposed",
        StageConfirmed = "stage_confirmed",
        ProfileApproved = "profile_approved",
        ProfileChangesRequested = "profile_changes_requested",
        PhotoApproved = "photo_approved",
        PhotoRejected = "photo_rejected",
        TextRejected = "text_rejected",
        VerificationApproved = "verification_approved",
        VerificationRejected = "verification_rejected",
        NewMatches = "new_matches",
        ProfileViewsSummary = "profile_views_summary",
        AccountWarning = "account_warning",
        Announcement = "announcement",
    }
}

text_enum! {
    /// `caste_suggestions.status`.
    CasteSuggestionStatus { Pending = "pending", Promoted = "promoted", Rejected = "rejected" }
}

text_enum! {
    /// `jobs.status` (19 section 1.1).
    JobStatus { Queued = "queued", Running = "running", Succeeded = "succeeded", Dead = "dead" }
}

text_enum! {
    /// `data_exports.status`.
    ExportStatus { Queued = "queued", Ready = "ready", Failed = "failed", Expired = "expired" }
}

text_enum! {
    /// The gate returned by `GET /v1/me` (03 section 5.1).
    Gate {
        Banned = "banned",
        Suspended = "suspended",
        DeletionScheduled = "deletion_scheduled",
        ConsentRequired = "consent_required",
        Onboarding = "onboarding",
        ChangesRequested = "changes_requested",
        PendingReview = "pending_review",
        Ok = "ok",
    }
}

text_enum! {
    /// Profile badges (03 section 6).
    Badge {
        PhoneVerified = "phone_verified",
        PhotoVerified = "photo_verified",
        IdVerified = "id_verified",
        New = "new",
    }
}

text_enum! {
    /// Last active label (03 section 6). Never an exact time.
    LastActive {
        Online = "online",
        Today = "today",
        ThisWeek = "this_week",
        ThisMonth = "this_month",
        Earlier = "earlier",
    }
}

text_enum! {
    /// Relation tier of a viewer to an owner (03 section 6), evaluated in this order.
    #[expect(clippy::enum_variant_names, reason = "`Self` is a keyword, so the code `self` needs a longer name")]
    Tier {
        SelfTier = "self",
        Connection = "connection",
        InterestFromOwner = "interest_from_owner",
        InterestToOwner = "interest_to_owner",
        Member = "member",
    }
}

text_enum! {
    /// Groups of fields that privacy settings can hide (09 section 5).
    LockedGroup {
        FullName = "full_name",
        Photos = "photos",
        Caste = "caste",
        Income = "income",
        Family = "family",
        CareerDetails = "career_details",
        Home = "home",
        Area = "area",
        Health = "health",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_round_trip() {
        for status in ProfileStatus::ALL {
            assert_eq!(ProfileStatus::parse(status.as_str()), Some(*status));
        }
        assert_eq!(ProfileStatus::parse("nope"), None);
        assert_eq!(serde_json::to_string(&Tier::SelfTier).unwrap(), "\"self\"");
        assert_eq!(
            serde_json::from_str::<UserStatus>("\"deletion_scheduled\"").unwrap(),
            UserStatus::DeletionScheduled
        );
    }

    #[test]
    fn onboarding_steps_advance_in_order() {
        assert_eq!(OnboardingStep::AccountFor.next(), OnboardingStep::Basics);
        assert_eq!(OnboardingStep::Identity.next(), OnboardingStep::Review);
        assert_eq!(OnboardingStep::Review.next(), OnboardingStep::Done);
        assert_eq!(OnboardingStep::Done.next(), OnboardingStep::Done);
    }
}
