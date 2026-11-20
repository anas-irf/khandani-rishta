//! Enumerations of the closed option lists (05 section 2), generated from the spec.
//! Each is stored as `text` with a `CHECK` constraint (04 section 1).

use crate::domain::text_enum;

text_enum! {
    /// `gender` (05 section 2).
    Gender {
        Male = "male",
        Female = "female",
    }
}

text_enum! {
    /// `managed_by` (05 section 2).
    ManagedBy {
        Candidate = "self",
        Parent = "parent",
        Sibling = "sibling",
        Relative = "relative",
        Friend = "friend",
    }
}

text_enum! {
    /// `marital_status` (05 section 2).
    MaritalStatus {
        NeverMarried = "never_married",
        Divorced = "divorced",
        Widowed = "widowed",
        Separated = "separated",
        NikahEndedBeforeRukhsati = "nikah_ended_before_rukhsati",
        Married = "married",
    }
}

text_enum! {
    /// `children_status` (05 section 2).
    ChildrenStatus {
        None = "none",
        LivingWithMe = "living_with_me",
        NotLivingWithMe = "not_living_with_me",
    }
}

text_enum! {
    /// `complexion` (05 section 2).
    Complexion {
        VeryFair = "very_fair",
        Fair = "fair",
        Wheatish = "wheatish",
        Brown = "brown",
        Dark = "dark",
    }
}

text_enum! {
    /// `body_type` (05 section 2).
    BodyType {
        Slim = "slim",
        Average = "average",
        Athletic = "athletic",
        Heavy = "heavy",
    }
}

text_enum! {
    /// `blood_group` (05 section 2).
    BloodGroup {
        APos = "a_pos",
        ANeg = "a_neg",
        BPos = "b_pos",
        BNeg = "b_neg",
        AbPos = "ab_pos",
        AbNeg = "ab_neg",
        OPos = "o_pos",
        ONeg = "o_neg",
    }
}

text_enum! {
    /// `disability` (05 section 2).
    Disability {
        None = "none",
        Physical = "physical",
        Visual = "visual",
        Hearing = "hearing",
        Speech = "speech",
        ChronicIllness = "chronic_illness",
        Other = "other",
    }
}

text_enum! {
    /// `residency_status` (05 section 2).
    ResidencyStatus {
        Citizen = "citizen",
        PermanentResident = "permanent_resident",
        WorkVisa = "work_visa",
        StudentVisa = "student_visa",
        DependentVisa = "dependent_visa",
        VisitVisa = "visit_visa",
        Other = "other",
    }
}

text_enum! {
    /// `relocation` (05 section 2).
    Relocation {
        NotWilling = "not_willing",
        WithinCountry = "within_country",
        Abroad = "abroad",
        Anywhere = "anywhere",
    }
}

text_enum! {
    /// `employment_type` (05 section 2).
    EmploymentType {
        PrivateJob = "private_job",
        GovernmentJob = "government_job",
        ArmedForces = "armed_forces",
        BusinessOwner = "business_owner",
        SelfEmployed = "self_employed",
        Student = "student",
        Homemaker = "homemaker",
        NotWorking = "not_working",
        Retired = "retired",
    }
}

text_enum! {
    /// `religiosity` (05 section 2).
    Religiosity {
        VeryPractising = "very_practising",
        Practising = "practising",
        ModeratelyPractising = "moderately_practising",
        NotPractising = "not_practising",
    }
}

text_enum! {
    /// `prayer_frequency` (05 section 2).
    PrayerFrequency {
        FiveTimes = "five_times",
        MostPrayers = "most_prayers",
        Sometimes = "sometimes",
        JummahOnly = "jummah_only",
        Rarely = "rarely",
    }
}

text_enum! {
    /// `hijab` (05 section 2).
    #[expect(clippy::enum_variant_names, reason = "`hijab` is one of the stored codes")]
    Hijab {
        Niqab = "niqab",
        Hijab = "hijab",
        Dupatta = "dupatta",
        Occasionally = "occasionally",
        None = "none",
    }
}

text_enum! {
    /// `beard` (05 section 2).
    Beard {
        Full = "full",
        Trimmed = "trimmed",
        None = "none",
    }
}

text_enum! {
    /// `religious_education` (05 section 2).
    ReligiousEducation {
        None = "none",
        Nazra = "nazra",
        Hafiz = "hafiz",
        Alim = "alim",
    }
}

text_enum! {
    /// `smoking` (05 section 2).
    Smoking {
        No = "no",
        Occasionally = "occasionally",
        Yes = "yes",
    }
}

text_enum! {
    /// `living_arrangement` (05 section 2).
    LivingArrangement {
        WithFamily = "with_family",
        Separate = "separate",
        Flexible = "flexible",
    }
}

text_enum! {
    /// `work_after_marriage` (05 section 2).
    WorkAfterMarriage {
        Yes = "yes",
        No = "no",
        Flexible = "flexible",
    }
}

text_enum! {
    /// `marriage_timeline` (05 section 2).
    MarriageTimeline {
        Within6Months = "within_6_months",
        Within1Year = "within_1_year",
        Within2Years = "within_2_years",
        NotDecided = "not_decided",
    }
}

text_enum! {
    /// `jahez_stance` (05 section 2).
    JahezStance {
        Against = "against",
        NoDemand = "no_demand",
        FamilyCustom = "family_custom",
    }
}

text_enum! {
    /// `parent_status` (05 section 2).
    ParentStatus {
        Alive = "alive",
        Deceased = "deceased",
    }
}

text_enum! {
    /// `family_type` (05 section 2).
    FamilyType {
        Joint = "joint",
        Nuclear = "nuclear",
    }
}

text_enum! {
    /// `family_class` (05 section 2).
    FamilyClass {
        LowerMiddle = "lower_middle",
        Middle = "middle",
        UpperMiddle = "upper_middle",
        Affluent = "affluent",
    }
}

text_enum! {
    /// `family_values` (05 section 2).
    FamilyValues {
        Religious = "religious",
        Traditional = "traditional",
        Moderate = "moderate",
        Liberal = "liberal",
    }
}

text_enum! {
    /// `home_ownership` (05 section 2).
    HomeOwnership {
        Owned = "owned",
        Rented = "rented",
        Ancestral = "ancestral",
        EmployerProvided = "employer_provided",
        Other = "other",
    }
}

text_enum! {
    /// `home_type` (05 section 2).
    HomeType {
        House = "house",
        Apartment = "apartment",
        Portion = "portion",
        Other = "other",
    }
}

text_enum! {
    /// `home_size_unit` (05 section 2).
    HomeSizeUnit {
        Marla = "marla",
        Kanal = "kanal",
        SqYard = "sq_yard",
        SqFt = "sq_ft",
        SqM = "sq_m",
    }
}

text_enum! {
    /// `guardian_relation` (05 section 2).
    GuardianRelation {
        Father = "father",
        Mother = "mother",
        Brother = "brother",
        Sister = "sister",
        Uncle = "uncle",
        Aunt = "aunt",
        Other = "other",
    }
}

text_enum! {
    /// `preferred_contact` (05 section 2).
    PreferredContact {
        Candidate = "self",
        Guardian = "guardian",
    }
}

text_enum! {
    /// `importance` (05 section 2).
    Importance {
        Must = "must",
        High = "high",
        Medium = "medium",
        Low = "low",
    }
}

text_enum! {
    /// `children_acceptance` (05 section 2).
    ChildrenAcceptance {
        Any = "any",
        NotLivingWithPartner = "not_living_with_partner",
        None = "none",
    }
}

text_enum! {
    /// `name_display` (05 section 2).
    NameDisplay {
        FullName = "full_name",
        FirstNameLastInitial = "first_name_last_initial",
        FirstNameOnly = "first_name_only",
        Initials = "initials",
        CodeOnly = "code_only",
    }
}

text_enum! {
    /// `photo_visibility` (05 section 2).
    PhotoVisibility {
        Members = "members",
        InterestsAndConnections = "interests_and_connections",
        Connections = "connections",
        ApprovedOnly = "approved_only",
    }
}

text_enum! {
    /// `field_visibility` (05 section 2).
    FieldVisibility {
        Members = "members",
        Connections = "connections",
        Nobody = "nobody",
    }
}

text_enum! {
    /// `discovery_visibility` (05 section 2).
    DiscoveryVisibility {
        Everyone = "everyone",
        PreferenceMatch = "preference_match",
        Hidden = "hidden",
    }
}

text_enum! {
    /// `interest_permission` (05 section 2).
    InterestPermission {
        Everyone = "everyone",
        VerifiedOnly = "verified_only",
        PreferenceMatch = "preference_match",
    }
}

text_enum! {
    /// `document_type` (05 section 2).
    DocumentType {
        Cnic = "cnic",
        Nicop = "nicop",
        Poc = "poc",
        Passport = "passport",
    }
}

text_enum! {
    /// `closed_reason` (05 section 2).
    ClosedReason {
        FoundMatchHere = "found_match_here",
        FoundMatchElsewhere = "found_match_elsewhere",
        TakingABreak = "taking_a_break",
        Other = "other",
    }
}

text_enum! {
    /// `connection_stage` (05 section 2).
    ConnectionStage {
        Chatting = "chatting",
        FamiliesTalking = "families_talking",
        Engaged = "engaged",
        NikahDone = "nikah_done",
    }
}

text_enum! {
    /// `connection_end_reason` (05 section 2).
    ConnectionEndReason {
        NotCompatible = "not_compatible",
        FamilyDeclined = "family_declined",
        NoResponse = "no_response",
        FoundSomeoneElse = "found_someone_else",
        InappropriateBehaviour = "inappropriate_behaviour",
        Other = "other",
        Blocked = "blocked",
        AccountClosed = "account_closed",
    }
}

text_enum! {
    /// `report_reason` (05 section 2).
    ReportReason {
        FakeProfile = "fake_profile",
        AlreadyMarried = "already_married",
        MisleadingInformation = "misleading_information",
        InappropriatePhoto = "inappropriate_photo",
        Harassment = "harassment",
        AskingForMoney = "asking_for_money",
        MarriageBureauOrAgent = "marriage_bureau_or_agent",
        Underage = "underage",
        Impersonation = "impersonation",
        OffensiveContent = "offensive_content",
        Other = "other",
    }
}

text_enum! {
    /// `photo_rejection_reason` (05 section 2).
    PhotoRejectionReason {
        NotAPerson = "not_a_person",
        FaceNotVisible = "face_not_visible",
        GroupPhoto = "group_photo",
        Inappropriate = "inappropriate",
        ContainsContactInfo = "contains_contact_info",
        LowQuality = "low_quality",
        NotTheCandidate = "not_the_candidate",
        Other = "other",
    }
}

text_enum! {
    /// `verification_rejection_reason` (05 section 2).
    VerificationRejectionReason {
        Unreadable = "unreadable",
        DocumentMismatch = "document_mismatch",
        FaceMismatch = "face_mismatch",
        GestureMissing = "gesture_missing",
        ExpiredDocument = "expired_document",
        Underage = "underage",
        SuspectedFraud = "suspected_fraud",
        Other = "other",
    }
}

text_enum! {
    /// `email_match_digest` (05 section 2).
    EmailMatchDigest {
        Off = "off",
        Daily = "daily",
        Weekly = "weekly",
    }
}
