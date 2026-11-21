//! In-memory request rate limits (15 section 3.1).
//!
//! Authenticated requests are limited per verified user id inside the access-level extractors,
//! so nobody can drain another person's allowance by forging a token's `sub`. Requests without
//! a token, webhooks and the WebSocket upgrade are limited per client IP in middleware. One API
//! instance runs per environment, so memory is the right place (19 section 6.2).
//!
//! The algorithm is GCRA: each key stores a theoretical arrival time, which allows bursts up to
//! the limit and spreads the rest evenly over the period.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::http::Method;
use moka::sync::Cache;

/// Rate limit groups of 15 section 3.1, plus the WebSocket upgrade of 19 section 4.2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Group {
    Default,
    Writes,
    Search,
    Uploads,
    Unauthenticated,
    Webhooks,
    WebSocket,
}

impl Group {
    /// `(requests, period)`.
    pub fn quota(self) -> (u32, Duration) {
        const MINUTE: Duration = Duration::from_secs(60);
        match self {
            Self::Default => (120, MINUTE),
            Self::Writes => (40, MINUTE),
            Self::Search => (30, MINUTE),
            Self::Uploads => (20, Duration::from_secs(3600)),
            Self::Unauthenticated => (60, MINUTE),
            Self::Webhooks => (300, MINUTE),
            Self::WebSocket => (20, MINUTE),
        }
    }

    /// The group of an authenticated request.
    pub fn for_request(method: &Method, path: &str) -> Self {
        let is_search = (method == Method::POST && path == "/v1/search")
            || (method == Method::GET && path == "/v1/reference/cities");
        let is_upload = method == Method::POST
            && (path == "/v1/me/photos/uploads" || path == "/v1/me/verifications/uploads");
        if is_search {
            Self::Search
        } else if is_upload {
            Self::Uploads
        } else if matches!(
            *method,
            Method::POST | Method::PUT | Method::PATCH | Method::DELETE
        ) {
            Self::Writes
        } else {
            Self::Default
        }
    }
}

/// The limiter key of a signed-in user. Every route counts a user under this one key, so the
/// middleware (which has only the token) and the extractors (which also have the account) share
/// one allowance per group instead of two.
pub fn user_key(clerk_user_id: &str) -> String {
    format!("clerk:{clerk_user_id}")
}

/// Keyed GCRA limiter.
pub struct RateLimiter {
    arrivals: Cache<(Group, String), Arc<Mutex<Instant>>>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            arrivals: Cache::builder()
                .max_capacity(200_000)
                // Longer than the longest period, so an idle key's state is never needed again.
                .time_to_idle(Duration::from_secs(3600))
                .build(),
        }
    }

    /// Counts one request. `Err(seconds)` says how long to wait before retrying.
    pub fn check(&self, group: Group, key: &str) -> Result<(), u64> {
        self.check_at(group, key, Instant::now())
    }

    fn check_at(&self, group: Group, key: &str, now: Instant) -> Result<(), u64> {
        let (limit, period) = group.quota();
        let emission = period / limit.max(1);
        let cell = self
            .arrivals
            .get_with((group, key.to_owned()), || Arc::new(Mutex::new(now)));
        let Ok(mut tat) = cell.lock() else {
            return Ok(());
        };
        let start = if *tat > now { *tat } else { now };
        let next = start + emission;
        let allowed_until = now + period;
        if next > allowed_until {
            let wait = next - allowed_until;
            return Err(wait.as_secs().max(1));
        }
        *tat = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_a_burst_up_to_the_limit_then_refuses() {
        let limiter = RateLimiter::new();
        let now = Instant::now();
        for _ in 0..40 {
            assert!(limiter.check_at(Group::Writes, "u1", now).is_ok());
        }
        let wait = limiter.check_at(Group::Writes, "u1", now).unwrap_err();
        assert!(
            (1..=2).contains(&wait),
            "about one emission interval: {wait}"
        );
        assert!(
            limiter.check_at(Group::Writes, "u2", now).is_ok(),
            "keys are independent"
        );
        assert!(
            limiter.check_at(Group::Default, "u1", now).is_ok(),
            "groups are independent"
        );
    }

    #[test]
    fn capacity_returns_over_time() {
        let limiter = RateLimiter::new();
        let now = Instant::now();
        for _ in 0..30 {
            limiter.check_at(Group::Search, "ip", now).unwrap();
        }
        assert!(limiter.check_at(Group::Search, "ip", now).is_err());
        assert!(
            limiter
                .check_at(Group::Search, "ip", now + Duration::from_secs(2))
                .is_ok()
        );
    }

    #[test]
    fn groups_follow_the_contract() {
        assert_eq!(
            Group::for_request(&Method::POST, "/v1/search"),
            Group::Search
        );
        assert_eq!(
            Group::for_request(&Method::GET, "/v1/reference/cities"),
            Group::Search
        );
        assert_eq!(
            Group::for_request(&Method::POST, "/v1/me/photos/uploads"),
            Group::Uploads
        );
        assert_eq!(Group::for_request(&Method::PATCH, "/v1/me"), Group::Writes);
        assert_eq!(Group::for_request(&Method::GET, "/v1/me"), Group::Default);
    }
}
