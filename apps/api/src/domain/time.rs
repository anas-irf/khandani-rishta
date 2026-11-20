//! Day boundaries and ages in `Asia/Karachi`.
//!
//! Pakistan is UTC+5 all year with no daylight saving, so a fixed offset is exact and no time
//! zone database is needed (19 section 3.1).

use time::{Date, Duration, OffsetDateTime, UtcOffset};

/// `Asia/Karachi`, UTC+05:00.
pub const KARACHI: UtcOffset = match UtcOffset::from_hms(5, 0, 0) {
    Ok(offset) => offset,
    Err(_) => panic!("invalid offset"),
};

/// The calendar date in `Asia/Karachi` at the given instant.
pub fn karachi_date(at: OffsetDateTime) -> Date {
    at.to_offset(KARACHI).date()
}

/// The first instant of the next `Asia/Karachi` day after `at`, in UTC. Daily limits reset then.
pub fn next_karachi_midnight(at: OffsetDateTime) -> OffsetDateTime {
    let tomorrow = karachi_date(at) + Duration::days(1);
    tomorrow
        .midnight()
        .assume_offset(KARACHI)
        .to_offset(UtcOffset::UTC)
}

/// The first instant of the `Asia/Karachi` day that contains `at`, in UTC.
pub fn karachi_day_start(at: OffsetDateTime) -> OffsetDateTime {
    karachi_date(at)
        .midnight()
        .assume_offset(KARACHI)
        .to_offset(UtcOffset::UTC)
}

/// Whole years between `date_of_birth` and `today` (03 section 6). A birthday on 29 February
/// counts from 1 March in years that are not leap years.
pub fn age_on(date_of_birth: Date, today: Date) -> i32 {
    let mut years = today.year() - date_of_birth.year();
    let birthday_passed =
        (today.month() as u8, today.day()) >= (date_of_birth.month() as u8, date_of_birth.day());
    if !birthday_passed {
        years -= 1;
    }
    years
}

/// Age today in `Asia/Karachi`.
pub fn age_now(date_of_birth: Date, now: OffsetDateTime) -> i32 {
    age_on(date_of_birth, karachi_date(now))
}

#[cfg(test)]
mod tests {
    use time::macros::{date, datetime};

    use super::*;

    #[test]
    fn karachi_date_crosses_midnight_five_hours_early() {
        assert_eq!(
            karachi_date(datetime!(2026-11-20 18:59 UTC)),
            date!(2026 - 11 - 20)
        );
        assert_eq!(
            karachi_date(datetime!(2026-11-20 19:00 UTC)),
            date!(2026 - 11 - 21)
        );
    }

    #[test]
    fn next_midnight_is_19_utc() {
        assert_eq!(
            next_karachi_midnight(datetime!(2026-11-20 10:00 UTC)),
            datetime!(2026-11-20 19:00 UTC)
        );
        assert_eq!(
            karachi_day_start(datetime!(2026-11-20 10:00 UTC)),
            datetime!(2026-11-19 19:00 UTC)
        );
    }

    #[test]
    fn age_counts_whole_years() {
        assert_eq!(age_on(date!(2008 - 11 - 20), date!(2026 - 11 - 20)), 18);
        assert_eq!(age_on(date!(2008 - 11 - 21), date!(2026 - 11 - 20)), 17);
        assert_eq!(age_on(date!(2000 - 02 - 29), date!(2026 - 02 - 28)), 25);
        assert_eq!(age_on(date!(2000 - 02 - 29), date!(2026 - 03 - 01)), 26);
    }
}
