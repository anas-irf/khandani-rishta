//! The eligibility rules of 10 section 3.1 that are pure functions. The pool query applies
//! E1 to E7, E9 and the `hidden` part of E8 in SQL (10 section 8.4); these functions are the
//! same rules for the Rust pass, the read-time checks of 10 section 8.6 and search.

use time::{Duration, OffsetDateTime};

use crate::domain::matching::dimensions::passes_must_haves;
use crate::domain::matching::subject::{Geo, Subject};
use crate::domain::options::{DiscoveryVisibility, MaritalStatus};
use crate::domain::preferences::Preferences;
use crate::domain::types::{ConnectionStatus, InterestStatus};

/// E9, the second-marriage rule, in both directions (10 section 3.1; 03 section 8 rule 10;
/// 09 section 2.4 `second_marriage_ok`): a `married` member is shown only to a member whose
/// `marital_statuses` contains `married`.
///
/// `a_accepts` and `b_accepts` are each member's `partner_preferences.marital_statuses`. A
/// missing preferences row counts as an empty array (09 section 2.4), and an empty array
/// does not contain `married`.
pub fn second_marriage_ok(
    a_status: MaritalStatus,
    a_accepts: &[MaritalStatus],
    b_status: MaritalStatus,
    b_accepts: &[MaritalStatus],
) -> bool {
    let shown_to = |status: MaritalStatus, other_accepts: &[MaritalStatus]| {
        status != MaritalStatus::Married || other_accepts.contains(&MaritalStatus::Married)
    };
    shown_to(a_status, b_accepts) && shown_to(b_status, a_accepts)
}

/// E8: whether the owner's `discovery_visibility` lets `viewer` find the owner in
/// recommendations, search and the home lists (10 section 3.1; 09 section 2.3). `everyone`
/// always; `preference_match` only when the viewer passes every must-have of the owner;
/// `hidden` never.
pub fn discovery_admits(
    visibility: DiscoveryVisibility,
    owner_prefs: &Preferences,
    viewer: &Subject,
    geo: &Geo,
) -> bool {
    match visibility {
        DiscoveryVisibility::Everyone => true,
        DiscoveryVisibility::PreferenceMatch => passes_must_haves(owner_prefs, viewer, geo),
        DiscoveryVisibility::Hidden => false,
    }
}

/// The cooldown settings used by E5 and E7 (03 section 7). Every value is in days.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cooldowns {
    /// `interest.cooldown_after_decline_days` (90).
    pub decline: u32,
    /// `interest.cooldown_after_expiry_days` (30).
    pub expiry: u32,
    /// `interest.cooldown_after_withdraw_days` (7).
    pub withdraw: u32,
    /// `connection.cooldown_after_end_days` (90).
    pub connection_end: u32,
}

/// A `connections` row shared by the two members.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectionLink {
    pub status: ConnectionStatus,
    pub ended_at: Option<OffsetDateTime>,
}

/// An `interests` row between the two members, in either direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InterestLink {
    pub status: InterestStatus,
    pub responded_at: Option<OffsetDateTime>,
    pub expires_at: OffsetDateTime,
}

/// Everything between a viewer and a candidate that E4 to E7 look at.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PairLinks {
    /// `expires_at` of the viewer's `passes` row for the candidate, if any (E4).
    pub pass_expires_at: Option<OffsetDateTime>,
    /// Connections between the two (E5).
    pub connections: Vec<ConnectionLink>,
    /// Interests between the two, either direction (E6, E7).
    pub interests: Vec<InterestLink>,
}

/// Whether E4, E5, E6 or E7 excludes the candidate from the viewer's recommendations and
/// search (10 section 3.1), at `now`. Mirrors the `excluded` CTE of 10 section 8.4; used by
/// the read-time checks of 10 section 8.6.
///
/// - E4: a pass from the viewer that has not expired.
/// - E5: a connection that is `active` or ended less than `connection_end` days ago.
/// - E6: a `pending` interest in either direction.
/// - E7: an interest in either direction `declined` less than `decline` days ago,
///   `expired` less than `expiry` days ago, or `withdrawn` less than `withdraw`
///   days ago. Both directions on purpose: a member who declined someone is not shown that
///   person again during the cooldown.
pub fn excluded_by_pair_links(
    links: &PairLinks,
    cooldowns: Cooldowns,
    now: OffsetDateTime,
) -> bool {
    let within = |at: Option<OffsetDateTime>, days: u32| {
        at.is_some_and(|at| at > now - Duration::days(i64::from(days)))
    };
    let passed = links
        .pass_expires_at
        .is_some_and(|expires_at| expires_at > now);
    let connected = links.connections.iter().any(|connection| {
        connection.status == ConnectionStatus::Active
            || within(connection.ended_at, cooldowns.connection_end)
    });
    let interest_blocks = links
        .interests
        .iter()
        .any(|interest| match interest.status {
            InterestStatus::Pending => true,
            InterestStatus::Declined => within(interest.responded_at, cooldowns.decline),
            InterestStatus::Expired => within(Some(interest.expires_at), cooldowns.expiry),
            InterestStatus::Withdrawn => within(interest.responded_at, cooldowns.withdraw),
            InterestStatus::Accepted => false,
        });
    passed || connected || interest_blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::matching::testkit::{self, NOW, subject};
    use crate::domain::options::Importance;

    const COOLDOWNS: Cooldowns = Cooldowns {
        decline: 90,
        expiry: 30,
        withdraw: 7,
        connection_end: 90,
    };

    fn interest(status: InterestStatus, days_ago: i64) -> PairLinks {
        let at = NOW - Duration::days(days_ago);
        PairLinks {
            interests: vec![InterestLink {
                status,
                responded_at: Some(at),
                expires_at: at,
            }],
            ..PairLinks::default()
        }
    }

    #[test]
    fn case_35_married_candidate_needs_the_viewer_to_accept_married() {
        // Candidate married (a man); the viewer (a woman) has an empty `marital_statuses`.
        assert!(!second_marriage_ok(
            MaritalStatus::NeverMarried,
            &[],
            MaritalStatus::Married,
            &[MaritalStatus::NeverMarried],
        ));
    }

    #[test]
    fn case_36_married_viewer_is_shown_to_a_candidate_who_accepts_married() {
        assert!(second_marriage_ok(
            MaritalStatus::Married,
            &[MaritalStatus::NeverMarried],
            MaritalStatus::NeverMarried,
            &[MaritalStatus::NeverMarried, MaritalStatus::Married],
        ));
        // The same viewer is not shown to a candidate who does not accept it.
        assert!(!second_marriage_ok(
            MaritalStatus::Married,
            &[MaritalStatus::NeverMarried],
            MaritalStatus::NeverMarried,
            &[MaritalStatus::NeverMarried],
        ));
    }

    #[test]
    fn second_marriage_rule_ignores_unmarried_pairs() {
        assert!(second_marriage_ok(
            MaritalStatus::Divorced,
            &[],
            MaritalStatus::Widowed,
            &[]
        ));
    }

    #[test]
    fn case_37_declined_40_days_ago_is_still_excluded() {
        assert!(excluded_by_pair_links(
            &interest(InterestStatus::Declined, 40),
            COOLDOWNS,
            NOW
        ));
    }

    #[test]
    fn case_38_declined_91_days_ago_is_eligible_again() {
        assert!(!excluded_by_pair_links(
            &interest(InterestStatus::Declined, 91),
            COOLDOWNS,
            NOW
        ));
    }

    #[test]
    fn case_39_preference_match_excludes_a_viewer_failing_a_must_have() {
        // Also absent from search: 10 section 9.1 rule 2 applies the same function.
        let geo = testkit::geo();
        let mut owner_prefs = testkit::no_preferences();
        owner_prefs.sect_codes = vec!["shia".into()];
        owner_prefs.sect_importance = Importance::Must;
        let mut viewer = testkit::man();
        viewer.sect_code = Some("sunni".into());
        let viewer = subject(viewer);
        assert!(!discovery_admits(
            DiscoveryVisibility::PreferenceMatch,
            &owner_prefs,
            &viewer,
            &geo
        ));
        assert!(discovery_admits(
            DiscoveryVisibility::Everyone,
            &owner_prefs,
            &viewer,
            &geo
        ));
        assert!(!discovery_admits(
            DiscoveryVisibility::Hidden,
            &testkit::no_preferences(),
            &viewer,
            &geo
        ));
        assert!(discovery_admits(
            DiscoveryVisibility::PreferenceMatch,
            &testkit::no_preferences(),
            &viewer,
            &geo
        ));
    }

    #[test]
    fn other_interest_cooldowns() {
        let excluded = |links: &PairLinks| excluded_by_pair_links(links, COOLDOWNS, NOW);
        assert!(excluded(&interest(InterestStatus::Pending, 400)));
        assert!(excluded(&interest(InterestStatus::Expired, 29)));
        assert!(!excluded(&interest(InterestStatus::Expired, 31)));
        assert!(excluded(&interest(InterestStatus::Withdrawn, 6)));
        assert!(!excluded(&interest(InterestStatus::Withdrawn, 8)));
        assert!(!excluded(&interest(InterestStatus::Accepted, 1)));
        assert!(!excluded(&PairLinks::default()));
    }

    #[test]
    fn passes_and_connections() {
        let excluded = |links: &PairLinks| excluded_by_pair_links(links, COOLDOWNS, NOW);
        let pass = |days: i64| PairLinks {
            pass_expires_at: Some(NOW + Duration::days(days)),
            ..PairLinks::default()
        };
        assert!(excluded(&pass(10)));
        assert!(!excluded(&pass(-1)));

        let connection = |status, ended_days_ago: Option<i64>| PairLinks {
            connections: vec![ConnectionLink {
                status,
                ended_at: ended_days_ago.map(|days| NOW - Duration::days(days)),
            }],
            ..PairLinks::default()
        };
        assert!(excluded(&connection(ConnectionStatus::Active, None)));
        assert!(excluded(&connection(ConnectionStatus::Ended, Some(89))));
        assert!(!excluded(&connection(ConnectionStatus::Ended, Some(91))));
    }
}
