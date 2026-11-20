//! Chat safety notices (13 section 5): pattern matching on chat messages and the rule that turns
//! repeated money flags into an automatic report.
//!
//! Chat is never blocked, delayed, edited or pre-screened. [`classify`] runs on the message body
//! when it is sent and returns at most one [`SafetyFlag`], stored in `messages.safety_flag`. The
//! receiver sees a notice under the message; the sender never does ([`visible_notice`]). Matching
//! is plain string and pattern matching inside the API: no message leaves the server.
//!
//! The phrase lists live here as constants and change by code review (13 section 5.2 names a
//! `moderation/chat_patterns.rs` file for them; this module is where the task placed them).

use std::cmp::Reverse;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Value, json};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::domain::options::ReportReason;
use crate::domain::text_rules::{ContactScope, find_contact, normalize};
use crate::domain::types::{ReportSource, ReportSubject, SafetyFlag};

// ---------------------------------------------------------------------------------------------
// Phrase lists (13 section 5.2)
// ---------------------------------------------------------------------------------------------

/// List M (money): English and Roman Urdu, lowercase, whole-phrase match.
pub const MONEY_PHRASES: &[&str] = &[
    "send money",
    "send me money",
    "transfer money",
    "need money",
    "lend me",
    "loan",
    "borrow",
    "easypaisa",
    "easy paisa",
    "jazzcash",
    "jazz cash",
    "bank account",
    "account number",
    "iban",
    "western union",
    "moneygram",
    "money gram",
    "crypto",
    "bitcoin",
    "usdt",
    "binance",
    "gift card",
    "visa fee",
    "customs fee",
    "clearance fee",
    "processing fee",
    "courier fee",
    "investment",
    "invest with me",
    "urgent need",
    "hospital bill",
    "medical emergency",
    "mobile load",
    "send load",
    "balance bhej",
    "load karwa",
    "recharge",
    "paise bhej",
    "paisay bhej",
    "pese bhej",
    "paisa bhej",
    "paise chahiye",
    "paisay chahiye",
    "udhaar",
    "udhar",
    "qarz",
    "raqam bhej",
    "account mein",
    "paise transfer",
];

/// List O (off-platform): whole-phrase match.
pub const OFF_PLATFORM_PHRASES: &[&str] = &[
    "whatsapp",
    "whats app",
    "watsapp",
    "wtsapp",
    "telegram",
    "snapchat",
    "snap id",
    "instagram",
    "insta",
    "imo",
    "botim",
    "skype",
    "facebook",
    "fb id",
    "messenger",
    "viber",
    "signal app",
    "video call karo",
    "call me on",
    "text me on",
    "msg me on",
    "message me on",
    "number do",
    "number dein",
    "number dedo",
    "number de do",
    "number bhej",
    "apna number",
    "number send",
];

/// One alternation of the phrases, each a whole word or phrase (`\b` on both sides).
fn phrase_pattern(phrases: &[&str]) -> Regex {
    let alternation = phrases
        .iter()
        .map(|phrase| regex::escape(phrase))
        .collect::<Vec<_>>()
        .join("|");
    // The pattern is built from the constant lists of this file; the tests compile it.
    Regex::new(&format!(r"\b(?:{alternation})\b")).expect("constant pattern compiles")
}

static MONEY: LazyLock<Regex> = LazyLock::new(|| phrase_pattern(MONEY_PHRASES));
static OFF_PLATFORM: LazyLock<Regex> = LazyLock::new(|| phrase_pattern(OFF_PLATFORM_PHRASES));

/// Compiles both phrase patterns now, so a broken list stops the start-up (see
/// `text_rules::init` for the contact patterns).
pub fn init() {
    LazyLock::force(&MONEY);
    LazyLock::force(&OFF_PLATFORM);
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/// The safety flag of a chat message body, or `None` (13 section 5.2).
///
/// The body is normalised with 13 section 3.2 first. Then, stopping at the first hit:
///
/// 1. `money`: a phrase of list M occurs as a whole word or phrase.
/// 2. `off_platform`: a phrase of list O occurs as a whole word or phrase.
/// 3. `contact_info`: `P1`, `C0`, `E1`, `E2` or `E3` of 13 section 3.4 matches, after the `X1`
///    and `X2` exemptions. Links and social handles alone do not set a flag.
///
/// So a message asking to send money to a number gets `money`. The caller has already checked the
/// body length (1 to 2000 characters, 15 section 12).
pub fn classify(body: &str) -> Option<SafetyFlag> {
    let normalized = normalize(body);
    if MONEY.is_match(&normalized) {
        Some(SafetyFlag::Money)
    } else if OFF_PLATFORM.is_match(&normalized) {
        Some(SafetyFlag::OffPlatform)
    } else if find_contact(&normalized, ContactScope::PhoneAndEmail).is_some() {
        Some(SafetyFlag::ContactInfo)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------------------------
// Notices (13 section 5.3)
// ---------------------------------------------------------------------------------------------

/// The value of `Message.safety_notice` for a viewer (15 section 12, 13 section 5.1 rule 3): the
/// flag for the receiver, always `None` on the viewer's own messages.
///
/// The client shows the same notice at most once per flag per conversation per day; that is a
/// client rule and needs nothing here.
pub const fn visible_notice(
    flag: Option<SafetyFlag>,
    viewer_is_sender: bool,
) -> Option<SafetyFlag> {
    if viewer_is_sender { None } else { flag }
}

/// The i18n key of the notice text (13 section 5.3).
pub const fn notice_key(flag: SafetyFlag) -> &'static str {
    match flag {
        SafetyFlag::Money => "chat.notice.money",
        SafetyFlag::OffPlatform => "chat.notice.off_platform",
        SafetyFlag::ContactInfo => "chat.notice.contact_info",
    }
}

/// The English notice text (13 section 5.3).
pub const fn notice_text(flag: SafetyFlag) -> &'static str {
    match flag {
        SafetyFlag::Money => {
            "Be careful. Never send money or share bank details with someone you met here, whatever the reason. If this member asks for money, report them."
        }
        SafetyFlag::OffPlatform => {
            "No need to rush to another app. Here you can block and report; elsewhere you cannot. Move when you and your family are comfortable."
        }
        SafetyFlag::ContactInfo => {
            "This message seems to contain contact details. Share yours only when you and your family are ready."
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Automatic report on repeated money flags (13 section 5.5)
// ---------------------------------------------------------------------------------------------

/// The look-back window of the count query, in days (`interval '7 days'`). Also the window in
/// which an earlier automatic report suppresses a new one.
pub const MONEY_REPORT_WINDOW_DAYS: u32 = 7;
/// At least this many `money` messages in the window...
pub const MONEY_REPORT_MIN_FLAGS: i64 = 5;
/// ...spread over at least this many connections.
pub const MONEY_REPORT_MIN_CONNECTIONS: i64 = 3;
/// At most this many of the newest flagged messages go into the report context.
pub const MONEY_REPORT_MAX_CONTEXT_MESSAGES: usize = 20;
/// `reports.details` of the automatic report.
pub const MONEY_REPORT_DETAILS: &str =
    "Automatic: repeated money-related messages across several connections.";
/// `reports.context.trigger` of the automatic report.
pub const MONEY_REPORT_TRIGGER: &str = "money_flags";

/// The result of the count query of 13 section 5.5: `count(*)` and `count(DISTINCT
/// connection_id)` over the sender's `money` messages in the window. PostgreSQL returns `bigint`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MoneyFlagCounts {
    pub flags: i64,
    pub connections: i64,
}

/// Whether a system report is due after a `money` message was inserted (13 section 5.5):
/// `flags >= 5` and `connections >= 3`, and no `system` report with the reason `asking_for_money`
/// for this target was created in the last 7 days.
pub const fn money_report_due(counts: MoneyFlagCounts, system_report_in_window: bool) -> bool {
    counts.flags >= MONEY_REPORT_MIN_FLAGS
        && counts.connections >= MONEY_REPORT_MIN_CONNECTIONS
        && !system_report_in_window
}

/// One of the sender's own flagged messages, for the report context. Replies of the other member
/// are never part of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlaggedMessage {
    pub id: Uuid,
    pub connection_id: Uuid,
    /// `None` for a message that was deleted since.
    pub body: Option<String>,
    pub created_at: OffsetDateTime,
}

/// The column values of the automatic report, except two that the caller supplies:
/// `reporter_profile_id` is `NULL` and `target_profile_id` is the sender's profile.
#[derive(Debug, Clone, PartialEq)]
pub struct MoneyReport {
    /// `system`.
    pub source: ReportSource,
    /// `profile`.
    pub subject_type: ReportSubject,
    /// `asking_for_money`.
    pub reason: ReportReason,
    /// [`MONEY_REPORT_DETAILS`].
    pub details: &'static str,
    /// `{ "trigger", "flags", "connections", "messages": [ { "id", "connection_id", "body",
    /// "created_at" } ] }` with up to 20 of the newest flagged messages, newest first.
    pub context: Value,
}

/// Builds the automatic report of 13 section 5.5 from the counts and the sender's flagged
/// messages (in any order; the 20 newest are kept).
pub fn money_report(counts: MoneyFlagCounts, flagged: &[FlaggedMessage]) -> MoneyReport {
    let mut newest: Vec<&FlaggedMessage> = flagged.iter().collect();
    newest.sort_by_key(|message| Reverse(message.created_at));
    newest.truncate(MONEY_REPORT_MAX_CONTEXT_MESSAGES);
    let messages: Vec<Value> = newest
        .into_iter()
        .map(|message| {
            json!({
                "id": message.id,
                "connection_id": message.connection_id,
                "body": message.body,
                "created_at": message
                    .created_at
                    .format(&Rfc3339)
                    .unwrap_or_else(|_| message.created_at.to_string()),
            })
        })
        .collect();
    MoneyReport {
        source: ReportSource::System,
        subject_type: ReportSubject::Profile,
        reason: ReportReason::AskingForMoney,
        details: MONEY_REPORT_DETAILS,
        context: json!({
            "trigger": MONEY_REPORT_TRIGGER,
            "flags": counts.flags,
            "connections": counts.connections,
            "messages": messages,
        }),
    }
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    fn flag(body: &str) -> Option<SafetyFlag> {
        classify(body)
    }

    // ---- Lists ----

    #[test]
    fn list_sizes_match_the_spec() {
        assert_eq!(MONEY_PHRASES.len(), 49);
        assert_eq!(OFF_PLATFORM_PHRASES.len(), 29);
        for phrase in MONEY_PHRASES.iter().chain(OFF_PLATFORM_PHRASES) {
            assert_eq!(*phrase, phrase.to_lowercase(), "{phrase} must be lowercase");
            assert_eq!(*phrase, phrase.trim(), "{phrase} must be trimmed");
        }
        init();
    }

    #[test]
    fn every_money_phrase_sets_the_money_flag() {
        for phrase in MONEY_PHRASES {
            assert_eq!(
                flag(&format!("hello, {phrase} please")),
                Some(SafetyFlag::Money),
                "{phrase}"
            );
            assert_eq!(flag(phrase), Some(SafetyFlag::Money), "{phrase} alone");
            assert_eq!(
                flag(&phrase.to_uppercase()),
                Some(SafetyFlag::Money),
                "{phrase} uppercase"
            );
        }
    }

    #[test]
    fn every_off_platform_phrase_sets_the_off_platform_flag() {
        for phrase in OFF_PLATFORM_PHRASES {
            assert_eq!(
                flag(&format!("hello, {phrase} please")),
                Some(SafetyFlag::OffPlatform),
                "{phrase}"
            );
            assert_eq!(
                flag(phrase),
                Some(SafetyFlag::OffPlatform),
                "{phrase} alone"
            );
            assert_eq!(
                flag(&phrase.to_uppercase()),
                Some(SafetyFlag::OffPlatform),
                "{phrase} uppercase"
            );
        }
    }

    #[test]
    fn phrases_are_matched_as_whole_words() {
        assert_eq!(flag("he borrowed a book"), None);
        assert_eq!(flag("our loans team"), None);
        assert_eq!(flag("the recharged battery"), None);
        assert_eq!(flag("investments are risky"), None);
        assert_eq!(flag("a primo plan"), None);
        assert_eq!(flag("cryptography class"), None);
        assert_eq!(flag("numbers do not lie"), None);
        // Words still match when punctuation touches them.
        assert_eq!(flag("Do you use WhatsApp?"), Some(SafetyFlag::OffPlatform));
        assert_eq!(flag("(loan)"), Some(SafetyFlag::Money));
        assert_eq!(flag("easypaisa."), Some(SafetyFlag::Money));
    }

    #[test]
    fn whitespace_and_case_do_not_hide_a_phrase() {
        assert_eq!(flag("SEND   Money"), Some(SafetyFlag::Money));
        assert_eq!(flag("send\nmoney"), Some(SafetyFlag::Money));
        assert_eq!(flag("send\u{00A0}money"), Some(SafetyFlag::Money));
        assert_eq!(flag("Whats\u{200B}App"), Some(SafetyFlag::OffPlatform));
        assert_eq!(
            flag("\u{FF37}\u{FF48}\u{FF41}\u{FF54}\u{FF53}\u{FF21}\u{FF50}\u{FF50}"),
            Some(SafetyFlag::OffPlatform)
        );
    }

    // ---- Roman Urdu phrasings ----

    #[test]
    fn roman_urdu_money_phrasings() {
        for body in [
            "mujhe paise chahiye",
            "mujhe paisay chahiye urgently",
            "paise bhej do please",
            "paisay bhej dein",
            "pese bhej do",
            "paisa bhej do",
            "thora udhaar chahiye",
            "udhar de do",
            "qarz mil jaye ga?",
            "raqam bhej do",
            "mere account mein dal do",
            "paise transfer kar do",
            "mobile load karwa do",
            "balance bhej do",
            "easy paisa pe bhej do",
        ] {
            assert_eq!(flag(body), Some(SafetyFlag::Money), "{body}");
        }
    }

    #[test]
    fn roman_urdu_off_platform_phrasings() {
        for body in [
            "apna number do",
            "number dedo na",
            "number de do",
            "apna number bhej do",
            "number dein please",
            "number bhej do",
            "video call karo",
            "watsapp pe aao",
        ] {
            assert_eq!(flag(body), Some(SafetyFlag::OffPlatform), "{body}");
        }
    }

    // ---- Precedence and contact info ----

    #[test]
    fn precedence_is_money_then_off_platform_then_contact_info() {
        // A message asking to send money to a number gets `money` (13 section 5.2).
        assert_eq!(flag("send money to 0300 1234567"), Some(SafetyFlag::Money));
        // Money beats off-platform.
        assert_eq!(flag("send money on whatsapp"), Some(SafetyFlag::Money));
        // Off-platform beats contact info.
        assert_eq!(
            flag("whatsapp me on 0300 1234567"),
            Some(SafetyFlag::OffPlatform)
        );
        assert_eq!(
            flag("call me on 0300 1234567"),
            Some(SafetyFlag::OffPlatform)
        );
        // Contact info alone.
        assert_eq!(
            flag("my number is 03001234567"),
            Some(SafetyFlag::ContactInfo)
        );
    }

    #[test]
    fn contact_info_uses_phone_and_email_patterns_only() {
        // P1, C0, E1, E2 and E3 set the flag.
        assert_eq!(flag("0300 1234567"), Some(SafetyFlag::ContactInfo));
        assert_eq!(flag("+92 (300) 1234567"), Some(SafetyFlag::ContactInfo));
        assert_eq!(
            flag("zero three zero zero one two three four five six seven"),
            Some(SafetyFlag::ContactInfo)
        );
        assert_eq!(
            flag("sifar teen sifar sifar aik do teen char panch chay saat"),
            Some(SafetyFlag::ContactInfo)
        );
        assert_eq!(
            flag("write to ayesha.khan@gmail.com"),
            Some(SafetyFlag::ContactInfo)
        );
        assert_eq!(
            flag("ayesha khan at gmail dot com"),
            Some(SafetyFlag::ContactInfo)
        );
        assert_eq!(flag("ayeshak (at) yahoo"), Some(SafetyFlag::ContactInfo));
        assert_eq!(flag("gmail.com"), Some(SafetyFlag::ContactInfo));
        // Digit forms in other scripts: extended Arabic-Indic and full-width.
        assert_eq!(
            flag(
                "\u{06F0}\u{06F3}\u{06F0}\u{06F0}\u{06F1}\u{06F2}\u{06F3}\u{06F4}\u{06F5}\u{06F6}\u{06F7}"
            ),
            Some(SafetyFlag::ContactInfo)
        );
        assert_eq!(
            flag(
                "\u{FF10}\u{FF13}\u{FF10}\u{FF10}\u{FF11}\u{FF12}\u{FF13}\u{FF14}\u{FF15}\u{FF16}\u{FF17}"
            ),
            Some(SafetyFlag::ContactInfo)
        );
        // Links and handles alone do not (13 section 5.2 lists only P1, C0, E1, E2 and E3).
        assert_eq!(flag("visit www.example.com"), None);
        assert_eq!(flag("https://example.org/me"), None);
        assert_eq!(flag("my shop is myshop.pk"), None);
        assert_eq!(flag("@ayesha_khan"), None);
        // A platform name is still list O.
        assert_eq!(flag("insta: ayesha_k"), Some(SafetyFlag::OffPlatform));
    }

    #[test]
    fn dates_and_year_ranges_are_exempt() {
        assert_eq!(flag("I was born on 12-05-1995"), None);
        assert_eq!(flag("I studied 2015-2019 at NUST"), None);
        assert_eq!(flag("I worked 2019 to 2023"), None);
        assert_eq!(flag("I earn 150000 per month"), None);
    }

    #[test]
    fn ordinary_messages_get_no_flag() {
        for body in [
            "Assalam o alaikum, how are you?",
            "JazakAllah, my family would like to meet yours.",
            "We live in Lahore, DHA phase 6.",
            "Hello",
            "",
            "   ",
            "\u{0627}\u{0644}\u{0633}\u{0644}\u{0627}\u{0645} \u{0639}\u{0644}\u{06CC}\u{06A9}\u{0645}",
        ] {
            assert_eq!(flag(body), None, "{body:?}");
        }
    }

    // ---- Notices ----

    #[test]
    fn the_sender_never_sees_a_notice() {
        for flag in SafetyFlag::ALL {
            assert_eq!(visible_notice(Some(*flag), true), None);
            assert_eq!(visible_notice(Some(*flag), false), Some(*flag));
        }
        assert_eq!(visible_notice(None, false), None);
        assert_eq!(visible_notice(None, true), None);
    }

    #[test]
    fn notice_keys_and_texts() {
        assert_eq!(notice_key(SafetyFlag::Money), "chat.notice.money");
        assert_eq!(
            notice_key(SafetyFlag::OffPlatform),
            "chat.notice.off_platform"
        );
        assert_eq!(
            notice_key(SafetyFlag::ContactInfo),
            "chat.notice.contact_info"
        );
        assert!(notice_text(SafetyFlag::Money).starts_with("Be careful. Never send money"));
        assert!(
            notice_text(SafetyFlag::OffPlatform).starts_with("No need to rush to another app.")
        );
        assert!(
            notice_text(SafetyFlag::ContactInfo)
                .starts_with("This message seems to contain contact details.")
        );
    }

    // ---- Automatic report ----

    fn counts(flags: i64, connections: i64) -> MoneyFlagCounts {
        MoneyFlagCounts { flags, connections }
    }

    #[test]
    fn thresholds_are_five_flags_over_three_connections_in_seven_days() {
        assert_eq!(MONEY_REPORT_MIN_FLAGS, 5);
        assert_eq!(MONEY_REPORT_MIN_CONNECTIONS, 3);
        assert_eq!(MONEY_REPORT_WINDOW_DAYS, 7);
        assert_eq!(MONEY_REPORT_MAX_CONTEXT_MESSAGES, 20);
    }

    #[test]
    fn the_report_is_due_at_the_thresholds_only() {
        assert!(money_report_due(counts(5, 3), false));
        assert!(money_report_due(counts(40, 9), false));
        assert!(!money_report_due(counts(4, 3), false));
        assert!(!money_report_due(counts(5, 2), false));
        assert!(!money_report_due(counts(0, 0), false));
        assert!(!money_report_due(counts(100, 1), false));
        // A system report in the last 7 days suppresses a new one.
        assert!(!money_report_due(counts(5, 3), true));
        assert!(!money_report_due(counts(50, 10), true));
    }

    /// The n-th flagged message, sent n minutes after the base time.
    fn flagged(n: u32) -> FlaggedMessage {
        FlaggedMessage {
            id: Uuid::from_u128(u128::from(n)),
            connection_id: Uuid::from_u128(1000 + u128::from(n % 3)),
            body: Some(format!("send money {n}")),
            created_at: datetime!(2026-11-20 10:00 UTC) + time::Duration::minutes(i64::from(n)),
        }
    }

    #[test]
    fn the_report_has_the_columns_of_the_spec() {
        let messages = [flagged(1), flagged(2), flagged(3)];
        let report = money_report(counts(5, 3), &messages);
        assert_eq!(report.source, ReportSource::System);
        assert_eq!(report.subject_type, ReportSubject::Profile);
        assert_eq!(report.reason, ReportReason::AskingForMoney);
        assert_eq!(
            report.details,
            "Automatic: repeated money-related messages across several connections."
        );
        assert_eq!(report.context["trigger"], "money_flags");
        assert_eq!(report.context["flags"], 5);
        assert_eq!(report.context["connections"], 3);
        let listed = report.context["messages"].as_array().expect("array");
        assert_eq!(listed.len(), 3);
        // Newest first, with exactly the four documented keys.
        assert_eq!(listed[0]["body"], "send money 3");
        assert_eq!(listed[0]["created_at"], "2026-11-20T10:03:00Z");
        assert_eq!(listed[0]["id"], Uuid::from_u128(3).to_string().as_str());
        assert_eq!(
            listed[0]["connection_id"],
            Uuid::from_u128(1000).to_string().as_str()
        );
        let object = listed[0].as_object().expect("object");
        assert_eq!(object.len(), 4);
        for key in ["id", "connection_id", "body", "created_at"] {
            assert!(object.contains_key(key), "{key}");
        }
    }

    #[test]
    fn the_context_keeps_the_twenty_newest_messages() {
        let many: Vec<FlaggedMessage> = (0..30).map(flagged).collect();
        let report = money_report(counts(30, 3), &many);
        let listed = report.context["messages"].as_array().expect("array");
        assert_eq!(listed.len(), 20);
        assert_eq!(listed[0]["body"], "send money 29");
        assert_eq!(listed[19]["body"], "send money 10");
        // Input order does not matter.
        let mut reversed = many;
        reversed.reverse();
        assert_eq!(money_report(counts(30, 3), &reversed), report);
    }

    #[test]
    fn a_deleted_message_has_a_null_body_and_no_messages_is_an_empty_list() {
        let mut deleted = flagged(1);
        deleted.body = None;
        let report = money_report(counts(5, 3), &[deleted]);
        assert!(report.context["messages"][0]["body"].is_null());
        let empty = money_report(counts(5, 3), &[]);
        assert_eq!(empty.context["messages"], json!([]));
    }

    // ---- Odd input ----

    #[test]
    fn odd_input_never_panics() {
        let inputs = [
            String::new(),
            "0".repeat(100_000),
            "send money ".repeat(10_000),
            "\u{1F600}".repeat(5_000),
            "\u{0639}\u{0627}\u{0626}\u{0634}\u{06C1} ".repeat(2_000),
            "\u{06F0}\u{0661}0\u{FF11}".repeat(1_000),
            "double ".repeat(5_000),
            "zero ".repeat(5_000),
            "\u{FDFA}".repeat(2_000),
            "\0\r\n\t".to_owned(),
        ];
        for input in &inputs {
            let _ = classify(input);
        }
    }
}
