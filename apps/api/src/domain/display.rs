//! Values shown about a profile to other members: the display name (09 section 4), age, the
//! `new` flag, badges, the last-active label and online status (03 section 6).
//!
//! This module only computes the values. Whether a viewer may receive them (for example the
//! label when either side hides activity) is decided in [`super::visibility`].

use std::sync::LazyLock;

use regex::Regex;
use time::{Date, Duration, OffsetDateTime};

use crate::domain::options::NameDisplay;
use crate::domain::time::{age_now, karachi_date};
use crate::domain::types::{Badge, LastActive, Tier};

/// A profile is new for this long after `first_activated_at` (03 section 6, 12 section 1.1).
pub const NEW_PERIOD: Duration = Duration::days(7);

/// A profile whose `last_active_at` is more recent than this is online even without an open
/// socket (03 section 6, 19 section 5).
pub const ONLINE_WINDOW: Duration = Duration::minutes(5);

/// Activity more recent than this, but not on today's date, is labelled `this_week`.
pub const THIS_WEEK_WINDOW: Duration = Duration::days(7);

/// Activity more recent than this, but older than [`THIS_WEEK_WINDOW`], is labelled `this_month`.
pub const THIS_MONTH_WINDOW: Duration = Duration::days(30);

/// The owner's stored name and profile code (09 section 4.1).
#[derive(Debug, Clone, Copy)]
pub struct NameParts<'a> {
    /// `profiles.first_name`. Never sent to another member as a separate value.
    pub first_name: &'a str,
    /// `profiles.last_name`. Never sent to another member as a separate value.
    pub last_name: &'a str,
    /// `profiles.public_code`, for example `KR7F3K2QX9`.
    pub public_code: &'a str,
}

/// Whether the display name at this tier is the full `{first} {last}` (09 section 4.1).
///
/// `locked` contains `full_name` exactly when this is false.
pub fn shows_full_name(name_display: NameDisplay, tier: Tier) -> bool {
    name_display == NameDisplay::FullName || matches!(tier, Tier::Connection | Tier::SelfTier)
}

/// The `display_name` of the owner as sent at `tier` (09 section 4.1).
///
/// Connections and the owner always get the full name; every other tier gets the form chosen in
/// `name_display`. A missing name part, possible only for a `draft` profile seen in its own
/// preview, is left out; with no name at all the public code is used.
pub fn display_name(name: NameParts<'_>, name_display: NameDisplay, tier: Tier) -> String {
    let first = name.first_name.trim();
    let last = name.last_name.trim();
    let form = if shows_full_name(name_display, tier) {
        NameDisplay::FullName
    } else {
        name_display
    };
    let shown = match form {
        NameDisplay::FullName => join_words(&[first, last]),
        NameDisplay::FirstNameLastInitial => join_words(&[first, &abbreviation(last)]),
        NameDisplay::FirstNameOnly => first.to_owned(),
        NameDisplay::Initials => join_words(&[&abbreviation(first), &abbreviation(last)]),
        NameDisplay::CodeOnly => String::new(),
    };
    if shown.is_empty() {
        name.public_code.to_owned()
    } else {
        shown
    }
}

/// The initial of a name part: the first extended grapheme cluster of its first word,
/// upper-cased when the script has case (09 section 4.3). Empty for an empty part.
///
/// Names may only contain letters, combining marks, spaces, full stops, apostrophes and hyphens
/// (13 section 3.3), so a cluster is a base character followed by its combining marks. Scripts
/// without case, such as Urdu, are returned unchanged.
pub fn initial(part: &str) -> String {
    part.split_whitespace()
        .next()
        .map_or_else(String::new, |word| first_grapheme(word).to_uppercase())
}

/// `{X}.` for a name part, or an empty string when the part is empty.
fn abbreviation(part: &str) -> String {
    let letter = initial(part);
    if letter.is_empty() {
        letter
    } else {
        format!("{letter}.")
    }
}

/// The first character of `word` together with the combining marks that follow it.
fn first_grapheme(word: &str) -> &str {
    static CLUSTER: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"^(?s:.)\p{M}*").ok());

    if let Some(found) = CLUSTER.as_ref().and_then(|cluster| cluster.find(word)) {
        return found.as_str();
    }
    // Only reached if the pattern failed to compile: fall back to the first character.
    word.char_indices()
        .nth(1)
        .map_or(word, |(end, _)| word.get(..end).unwrap_or(word))
}

/// Joins the non-empty parts with single spaces.
fn join_words(parts: &[&str]) -> String {
    parts
        .iter()
        .copied()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The age shown to other members: whole years on today's date in `Asia/Karachi` (03 section 6).
/// Other members never receive the date of birth itself (09 section 5.3).
pub fn age(date_of_birth: Date, now: OffsetDateTime) -> i32 {
    age_now(date_of_birth, now)
}

/// Whether `first_activated_at` lies within the last 7 days (03 section 6).
pub fn is_new(first_activated_at: Option<OffsetDateTime>, now: OffsetDateTime) -> bool {
    first_activated_at.is_some_and(|at| now - at < NEW_PERIOD)
}

/// The profile columns behind the badges (03 section 6).
#[derive(Debug, Clone, Copy, Default)]
pub struct BadgeFacts {
    pub is_phone_verified: bool,
    pub is_photo_verified: bool,
    pub is_id_verified: bool,
    pub first_activated_at: Option<OffsetDateTime>,
}

/// The earned badges, in the display order `id_verified`, `photo_verified`, `phone_verified`,
/// `new` (12 section 1.2).
pub fn badges(facts: BadgeFacts, now: OffsetDateTime) -> Vec<Badge> {
    [
        (facts.is_id_verified, Badge::IdVerified),
        (facts.is_photo_verified, Badge::PhotoVerified),
        (facts.is_phone_verified, Badge::PhoneVerified),
        (is_new(facts.first_activated_at, now), Badge::New),
    ]
    .into_iter()
    .filter_map(|(earned, badge)| earned.then_some(badge))
    .collect()
}

/// Whether the profile is online: it has an open WebSocket, or `last_active_at` is within the
/// last 5 minutes (03 section 6). `has_open_socket` comes from the hub.
pub fn is_online(
    has_open_socket: bool,
    last_active_at: Option<OffsetDateTime>,
    now: OffsetDateTime,
) -> bool {
    has_open_socket || last_active_at.is_some_and(|at| now - at < ONLINE_WINDOW)
}

/// The coarse last-active label (03 section 6, 09 section 9). Never an exact time.
///
/// | Label | When |
/// |---|---|
/// | `online` | `online` is true ([`is_online`]) |
/// | `today` | `last_active_at` falls on today's date in `Asia/Karachi` |
/// | `this_week` | Otherwise, within the last 7 days |
/// | `this_month` | Otherwise, within the last 30 days |
/// | `earlier` | Older, or never active |
pub fn last_active_label(
    online: bool,
    last_active_at: Option<OffsetDateTime>,
    now: OffsetDateTime,
) -> LastActive {
    if online {
        return LastActive::Online;
    }
    let Some(at) = last_active_at else {
        return LastActive::Earlier;
    };
    let since = now - at;
    if karachi_date(at) >= karachi_date(now) {
        LastActive::Today
    } else if since < THIS_WEEK_WINDOW {
        LastActive::ThisWeek
    } else if since < THIS_MONTH_WINDOW {
        LastActive::ThisMonth
    } else {
        LastActive::Earlier
    }
}

#[cfg(test)]
mod tests {
    use time::macros::{date, datetime};

    use super::*;

    const NOW: OffsetDateTime = datetime!(2026-11-20 10:00 UTC);

    fn name<'a>(first_name: &'a str, last_name: &'a str, public_code: &'a str) -> NameParts<'a> {
        NameParts {
            first_name,
            last_name,
            public_code,
        }
    }

    #[test]
    fn examples_of_09_section_4_2() {
        let rows = [
            (
                name("Ayesha", "Khan", "KR7F3K2QX9"),
                ["Ayesha K.", "Ayesha", "A. K.", "KR7F3K2QX9"],
            ),
            (
                name("Muhammad Ali", "Raza", "KR2M8PQ4TZ"),
                ["Muhammad Ali R.", "Muhammad Ali", "M. R.", "KR2M8PQ4TZ"],
            ),
            (
                name("Sana", "Khan Niazi", "KR9A1BC3DE"),
                ["Sana K.", "Sana", "S. K.", "KR9A1BC3DE"],
            ),
            (
                name("Bilal", "ul Haq", "KR5H7JK2MN"),
                ["Bilal U.", "Bilal", "B. U.", "KR5H7JK2MN"],
            ),
        ];
        let forms = [
            NameDisplay::FirstNameLastInitial,
            NameDisplay::FirstNameOnly,
            NameDisplay::Initials,
            NameDisplay::CodeOnly,
        ];
        for (parts, expected) in rows {
            for (form, want) in forms.into_iter().zip(expected) {
                assert_eq!(display_name(parts, form, Tier::Member), want, "{form}");
            }
        }
    }

    #[test]
    fn full_name_form_is_full_at_every_tier() {
        for tier in Tier::ALL {
            assert_eq!(
                display_name(
                    name("Ayesha", "Khan", "KR7F3K2QX9"),
                    NameDisplay::FullName,
                    *tier
                ),
                "Ayesha Khan"
            );
        }
    }

    #[test]
    fn connections_and_self_always_see_the_full_name() {
        for form in NameDisplay::ALL {
            for tier in [Tier::Connection, Tier::SelfTier] {
                assert_eq!(
                    display_name(name("Muhammad Ali", "Raza", "KR2M8PQ4TZ"), *form, tier),
                    "Muhammad Ali Raza"
                );
                assert!(shows_full_name(*form, tier));
            }
        }
    }

    #[test]
    fn reduced_forms_apply_to_both_interest_tiers() {
        for tier in [Tier::InterestFromOwner, Tier::InterestToOwner, Tier::Member] {
            assert_eq!(
                display_name(
                    name("Ayesha", "Khan", "KR7F3K2QX9"),
                    NameDisplay::Initials,
                    tier
                ),
                "A. K."
            );
            assert!(!shows_full_name(NameDisplay::Initials, tier));
        }
    }

    #[test]
    fn code_only_shows_the_public_code() {
        assert_eq!(
            display_name(
                name("Ayesha", "Khan", "KR7F3K2QX9"),
                NameDisplay::CodeOnly,
                Tier::InterestFromOwner
            ),
            "KR7F3K2QX9"
        );
    }

    #[test]
    fn stored_names_are_trimmed() {
        assert_eq!(
            display_name(
                name("  Ayesha ", " Khan  ", "KR7F3K2QX9"),
                NameDisplay::FirstNameLastInitial,
                Tier::Member
            ),
            "Ayesha K."
        );
    }

    #[test]
    fn initials_use_the_first_word_and_upper_case() {
        assert_eq!(initial("ul Haq"), "U");
        assert_eq!(initial("muhammad ali"), "M");
        assert_eq!(initial(""), "");
        assert_eq!(initial("   "), "");
    }

    #[test]
    fn initials_in_a_script_without_case_are_unchanged() {
        // Urdu: "Ayesha" and "Khan".
        let parts = name("عائشہ", "خان", "KR7F3K2QX9");
        assert_eq!(
            display_name(parts, NameDisplay::Initials, Tier::Member),
            "ع. خ."
        );
        assert_eq!(
            display_name(parts, NameDisplay::FirstNameLastInitial, Tier::Member),
            "عائشہ خ."
        );
    }

    #[test]
    fn an_initial_keeps_its_combining_marks() {
        // "e" followed by U+0301 COMBINING ACUTE ACCENT is one grapheme.
        assert_eq!(initial("e\u{301}mile"), "E\u{301}");
        // Arabic letter ain with a fatha.
        assert_eq!(initial("عَائشہ"), "عَ");
    }

    #[test]
    fn missing_name_parts_fall_back_gracefully() {
        assert_eq!(
            display_name(
                name("Ayesha", "", "KR7F3K2QX9"),
                NameDisplay::FirstNameLastInitial,
                Tier::Member
            ),
            "Ayesha"
        );
        assert_eq!(
            display_name(
                name("", "", "KR7F3K2QX9"),
                NameDisplay::FullName,
                Tier::SelfTier
            ),
            "KR7F3K2QX9"
        );
    }

    #[test]
    fn age_uses_the_karachi_date() {
        // 19:00 UTC on the 20th is already the 21st in Karachi: the 18th birthday has arrived.
        assert_eq!(
            age(date!(2008 - 11 - 21), datetime!(2026-11-20 19:00 UTC)),
            18
        );
        assert_eq!(
            age(date!(2008 - 11 - 21), datetime!(2026-11-20 18:59 UTC)),
            17
        );
    }

    #[test]
    fn new_lasts_seven_days() {
        assert!(is_new(Some(NOW - Duration::days(6)), NOW));
        assert!(is_new(
            Some(NOW - Duration::days(7) + Duration::seconds(1)),
            NOW
        ));
        assert!(!is_new(Some(NOW - Duration::days(7)), NOW));
        assert!(!is_new(None, NOW));
    }

    #[test]
    fn badges_are_in_display_order_and_only_earned() {
        let all = BadgeFacts {
            is_phone_verified: true,
            is_photo_verified: true,
            is_id_verified: true,
            first_activated_at: Some(NOW - Duration::days(1)),
        };
        assert_eq!(
            badges(all, NOW),
            [
                Badge::IdVerified,
                Badge::PhotoVerified,
                Badge::PhoneVerified,
                Badge::New
            ]
        );
        let some = BadgeFacts {
            is_photo_verified: true,
            first_activated_at: Some(NOW - Duration::days(30)),
            ..BadgeFacts::default()
        };
        assert_eq!(badges(some, NOW), [Badge::PhotoVerified]);
        assert_eq!(badges(BadgeFacts::default(), NOW), Vec::<Badge>::new());
    }

    #[test]
    fn online_means_a_socket_or_five_minutes() {
        assert!(is_online(true, None, NOW));
        assert!(is_online(false, Some(NOW - Duration::minutes(4)), NOW));
        assert!(!is_online(false, Some(NOW - Duration::minutes(5)), NOW));
        assert!(!is_online(false, None, NOW));
    }

    #[test]
    fn last_active_online_wins() {
        assert_eq!(
            last_active_label(true, Some(NOW - Duration::days(40)), NOW),
            LastActive::Online
        );
    }

    #[test]
    fn last_active_today_follows_the_karachi_date() {
        // 20:00 UTC on the 20th is 01:00 on the 21st in Karachi.
        let now = datetime!(2026-11-20 20:00 UTC);
        // 00:30 on the 21st in Karachi: today.
        assert_eq!(
            last_active_label(false, Some(datetime!(2026-11-20 19:30 UTC)), now),
            LastActive::Today
        );
        // 23:30 on the 20th in Karachi: yesterday, although only 90 minutes ago.
        assert_eq!(
            last_active_label(false, Some(datetime!(2026-11-20 18:30 UTC)), now),
            LastActive::ThisWeek
        );
    }

    #[test]
    fn last_active_buckets() {
        let label = |ago: Duration| last_active_label(false, Some(NOW - ago), NOW);
        assert_eq!(label(Duration::hours(1)), LastActive::Today);
        assert_eq!(label(Duration::days(1)), LastActive::ThisWeek);
        assert_eq!(
            label(Duration::days(7) - Duration::seconds(1)),
            LastActive::ThisWeek
        );
        assert_eq!(label(Duration::days(7)), LastActive::ThisMonth);
        assert_eq!(
            label(Duration::days(30) - Duration::seconds(1)),
            LastActive::ThisMonth
        );
        assert_eq!(label(Duration::days(30)), LastActive::Earlier);
        assert_eq!(last_active_label(false, None, NOW), LastActive::Earlier);
    }

    #[test]
    fn a_future_timestamp_counts_as_today() {
        assert_eq!(
            last_active_label(false, Some(NOW + Duration::days(2)), NOW),
            LastActive::Today
        );
    }
}
