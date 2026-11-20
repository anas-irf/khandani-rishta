//! Labels of the closed option lists, served in `ReferenceBootstrap.options`.
//!
//! Generated from specs/05-reference-data.md section 2. The codes are the values allowed by the
//! schema `CHECK` constraints; rows are in display order. `label_ur` stays empty until the
//! Urdu phase.

/// One option of a closed list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OptionRow {
    pub code: &'static str,
    pub label: &'static str,
    pub label_ur: Option<&'static str>,
}

/// A closed list and its options.
#[derive(Debug, Clone, Copy)]
pub struct OptionList {
    pub name: &'static str,
    pub rows: &'static [OptionRow],
}

const fn row(code: &'static str, label: &'static str) -> OptionRow {
    OptionRow {
        code,
        label,
        label_ur: None,
    }
}

/// Every closed list, in the order of 05 section 2.
pub const OPTION_LISTS: &[OptionList] = &[
    OptionList {
        name: "gender",
        rows: &[row("male", "Male"), row("female", "Female")],
    },
    OptionList {
        name: "managed_by",
        rows: &[
            row("self", "Self"),
            row("parent", "Parent"),
            row("sibling", "Brother or sister"),
            row("relative", "Relative"),
            row("friend", "Friend"),
        ],
    },
    OptionList {
        name: "marital_status",
        rows: &[
            row("never_married", "Never married"),
            row("divorced", "Divorced"),
            row("widowed", "Widowed"),
            row("separated", "Separated"),
            row("nikah_ended_before_rukhsati", "Nikah ended before rukhsati"),
            row("married", "Married (seeking another marriage)"),
        ],
    },
    OptionList {
        name: "children_status",
        rows: &[
            row("none", "No children"),
            row("living_with_me", "Yes, living with me"),
            row("not_living_with_me", "Yes, not living with me"),
        ],
    },
    OptionList {
        name: "complexion",
        rows: &[
            row("very_fair", "Very fair"),
            row("fair", "Fair"),
            row("wheatish", "Wheatish"),
            row("brown", "Brown"),
            row("dark", "Dark"),
        ],
    },
    OptionList {
        name: "body_type",
        rows: &[
            row("slim", "Slim"),
            row("average", "Average"),
            row("athletic", "Athletic"),
            row("heavy", "Heavy"),
        ],
    },
    OptionList {
        name: "blood_group",
        rows: &[
            row("a_pos", "A+"),
            row("a_neg", "A-"),
            row("b_pos", "B+"),
            row("b_neg", "B-"),
            row("ab_pos", "AB+"),
            row("ab_neg", "AB-"),
            row("o_pos", "O+"),
            row("o_neg", "O-"),
        ],
    },
    OptionList {
        name: "disability",
        rows: &[
            row("none", "None"),
            row("physical", "Physical disability"),
            row("visual", "Visual impairment"),
            row("hearing", "Hearing impairment"),
            row("speech", "Speech impairment"),
            row("chronic_illness", "Long-term illness"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "residency_status",
        rows: &[
            row("citizen", "Citizen"),
            row("permanent_resident", "Permanent resident"),
            row("work_visa", "Work visa"),
            row("student_visa", "Student visa"),
            row("dependent_visa", "Dependent or family visa"),
            row("visit_visa", "Visit visa"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "relocation",
        rows: &[
            row("not_willing", "Not willing to relocate"),
            row("within_country", "Within the same country"),
            row("abroad", "Willing to move abroad"),
            row("anywhere", "Anywhere"),
        ],
    },
    OptionList {
        name: "employment_type",
        rows: &[
            row("private_job", "Private job"),
            row("government_job", "Government job"),
            row("armed_forces", "Armed forces"),
            row("business_owner", "Business owner"),
            row("self_employed", "Self-employed or freelancer"),
            row("student", "Student"),
            row("homemaker", "Homemaker"),
            row("not_working", "Not working"),
            row("retired", "Retired"),
        ],
    },
    OptionList {
        name: "religiosity",
        rows: &[
            row("very_practising", "Very practising"),
            row("practising", "Practising"),
            row("moderately_practising", "Moderately practising"),
            row("not_practising", "Not practising"),
        ],
    },
    OptionList {
        name: "prayer_frequency",
        rows: &[
            row("five_times", "Five times a day"),
            row("most_prayers", "Most prayers"),
            row("sometimes", "Sometimes"),
            row("jummah_only", "Jummah only"),
            row("rarely", "Rarely"),
        ],
    },
    OptionList {
        name: "hijab",
        rows: &[
            row("niqab", "Niqab"),
            row("hijab", "Hijab or abaya"),
            row("dupatta", "Dupatta or chadar"),
            row("occasionally", "Occasionally"),
            row("none", "None"),
        ],
    },
    OptionList {
        name: "beard",
        rows: &[
            row("full", "Full beard"),
            row("trimmed", "Trimmed beard"),
            row("none", "No beard"),
        ],
    },
    OptionList {
        name: "religious_education",
        rows: &[
            row("none", "None"),
            row("nazra", "Nazra Quran"),
            row("hafiz", "Hafiz-e-Quran"),
            row("alim", "Alim or Alima (Dars-e-Nizami)"),
        ],
    },
    OptionList {
        name: "smoking",
        rows: &[
            row("no", "No"),
            row("occasionally", "Occasionally"),
            row("yes", "Yes"),
        ],
    },
    OptionList {
        name: "living_arrangement",
        rows: &[
            row("with_family", "With family (joint)"),
            row("separate", "Separate home"),
            row("flexible", "Flexible"),
        ],
    },
    OptionList {
        name: "work_after_marriage",
        rows: &[
            row("yes", "Yes"),
            row("no", "No"),
            row("flexible", "Flexible"),
        ],
    },
    OptionList {
        name: "marriage_timeline",
        rows: &[
            row("within_6_months", "Within 6 months"),
            row("within_1_year", "Within 1 year"),
            row("within_2_years", "Within 2 years"),
            row("not_decided", "Not decided"),
        ],
    },
    OptionList {
        name: "jahez_stance",
        rows: &[
            row("against", "Against jahez"),
            row("no_demand", "No demand"),
            row("family_custom", "As per family custom"),
        ],
    },
    OptionList {
        name: "parent_status",
        rows: &[row("alive", "Alive"), row("deceased", "Deceased")],
    },
    OptionList {
        name: "family_type",
        rows: &[
            row("joint", "Joint family"),
            row("nuclear", "Nuclear family"),
        ],
    },
    OptionList {
        name: "family_class",
        rows: &[
            row("lower_middle", "Lower middle class"),
            row("middle", "Middle class"),
            row("upper_middle", "Upper middle class"),
            row("affluent", "Affluent"),
        ],
    },
    OptionList {
        name: "family_values",
        rows: &[
            row("religious", "Religious"),
            row("traditional", "Traditional"),
            row("moderate", "Moderate"),
            row("liberal", "Liberal"),
        ],
    },
    OptionList {
        name: "home_ownership",
        rows: &[
            row("owned", "Owned"),
            row("rented", "Rented"),
            row("ancestral", "Family-owned (ancestral)"),
            row("employer_provided", "Employer or government provided"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "home_type",
        rows: &[
            row("house", "House"),
            row("apartment", "Apartment or flat"),
            row("portion", "Portion"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "home_size_unit",
        rows: &[
            row("marla", "Marla"),
            row("kanal", "Kanal"),
            row("sq_yard", "Square yards (gaz)"),
            row("sq_ft", "Square feet"),
            row("sq_m", "Square metres"),
        ],
    },
    OptionList {
        name: "guardian_relation",
        rows: &[
            row("father", "Father"),
            row("mother", "Mother"),
            row("brother", "Brother"),
            row("sister", "Sister"),
            row("uncle", "Uncle"),
            row("aunt", "Aunt"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "preferred_contact",
        rows: &[
            row("self", "The candidate"),
            row("guardian", "The guardian"),
        ],
    },
    OptionList {
        name: "importance",
        rows: &[
            row("must", "Must have"),
            row("high", "Very important"),
            row("medium", "Important"),
            row("low", "Nice to have"),
        ],
    },
    OptionList {
        name: "children_acceptance",
        rows: &[
            row("any", "Children are fine"),
            row(
                "not_living_with_partner",
                "Only if the children do not live with the partner",
            ),
            row("none", "No children"),
        ],
    },
    OptionList {
        name: "name_display",
        rows: &[
            row("full_name", "Full name"),
            row("first_name_last_initial", "First name and initial"),
            row("first_name_only", "First name only"),
            row("initials", "Initials"),
            row("code_only", "Profile code only"),
        ],
    },
    OptionList {
        name: "photo_visibility",
        rows: &[
            row("members", "All members"),
            row("interests_and_connections", "People I show interest in"),
            row("connections", "Connections only"),
            row("approved_only", "Only people I approve"),
        ],
    },
    OptionList {
        name: "field_visibility",
        rows: &[
            row("members", "All members"),
            row("connections", "Connections only"),
            row("nobody", "Nobody"),
        ],
    },
    OptionList {
        name: "discovery_visibility",
        rows: &[
            row("everyone", "Everyone"),
            row("preference_match", "Only people who fit my must-haves"),
            row("hidden", "Hidden"),
        ],
    },
    OptionList {
        name: "interest_permission",
        rows: &[
            row("everyone", "Anyone"),
            row("verified_only", "Verified members only"),
            row("preference_match", "Only people who fit my must-haves"),
        ],
    },
    OptionList {
        name: "document_type",
        rows: &[
            row("cnic", "CNIC"),
            row("nicop", "NICOP"),
            row("poc", "Pakistan Origin Card (POC)"),
            row("passport", "Passport"),
        ],
    },
    OptionList {
        name: "closed_reason",
        rows: &[
            row("found_match_here", "I found a match on Khandani Rishta"),
            row("found_match_elsewhere", "I found a match elsewhere"),
            row("taking_a_break", "I am taking a break"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "connection_stage",
        rows: &[
            row("chatting", "Getting to know each other"),
            row("families_talking", "Our families are in touch"),
            row("engaged", "Rishta confirmed"),
            row("nikah_done", "Nikah completed"),
        ],
    },
    OptionList {
        name: "connection_end_reason",
        rows: &[
            row("not_compatible", "We are not compatible"),
            row("family_declined", "Family did not agree"),
            row("no_response", "No response"),
            row("found_someone_else", "Found someone else"),
            row("inappropriate_behaviour", "Inappropriate behaviour"),
            row("other", "Other"),
            row("blocked", "Ended by a block"),
            row("account_closed", "The account was closed"),
        ],
    },
    OptionList {
        name: "report_reason",
        rows: &[
            row("fake_profile", "Fake profile"),
            row("already_married", "Already married and hiding it"),
            row("misleading_information", "False or misleading information"),
            row("inappropriate_photo", "Inappropriate photo"),
            row("harassment", "Harassment or abusive behaviour"),
            row("asking_for_money", "Asking for money"),
            row("marriage_bureau_or_agent", "Marriage bureau or paid agent"),
            row("underage", "Under 18"),
            row("impersonation", "Pretending to be someone else"),
            row("offensive_content", "Offensive content"),
            row("other", "Something else"),
        ],
    },
    OptionList {
        name: "photo_rejection_reason",
        rows: &[
            row("not_a_person", "The photo does not show a person"),
            row("face_not_visible", "The face is not clearly visible"),
            row("group_photo", "Group photo"),
            row("inappropriate", "Not appropriate for this platform"),
            row("contains_contact_info", "Contains contact details or text"),
            row("low_quality", "Too blurry or too dark"),
            row("not_the_candidate", "Does not appear to be the candidate"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "verification_rejection_reason",
        rows: &[
            row("unreadable", "The image is not readable"),
            row(
                "document_mismatch",
                "The document does not match the profile",
            ),
            row("face_mismatch", "The face does not match"),
            row("gesture_missing", "The requested gesture is missing"),
            row("expired_document", "The document has expired"),
            row("underage", "The candidate is under 18"),
            row("suspected_fraud", "The document could not be accepted"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "email_match_digest",
        rows: &[
            row("off", "Off"),
            row("daily", "Daily"),
            row("weekly", "Weekly"),
        ],
    },
];

/// The options of one list, or `None` for an unknown list name.
pub fn list(name: &str) -> Option<&'static [OptionRow]> {
    OPTION_LISTS.iter().find(|l| l.name == name).map(|l| l.rows)
}

/// The label of one code in one list.
pub fn label(list_name: &str, code: &str) -> Option<&'static str> {
    list(list_name)?
        .iter()
        .find(|r| r.code == code)
        .map(|r| r.label)
}
