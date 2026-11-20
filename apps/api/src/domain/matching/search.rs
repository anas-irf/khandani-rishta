//! The pure parts of search (10 section 9): profile code normalisation and the keyset
//! over-fetch loop. Filters are SQL and live with the queries.
//!
//! Search applies E1 to E9 (the `excluded` CTE of 10 section 8.4 plus E8 in Rust through
//! [`crate::domain::matching::eligibility::discovery_admits`]) but not the stored preferences.
//! A search by `public_code` drops E4 to E7 and returns the profile when `can_open` allows it
//! (10 section 9.1 rule 3).

use time::OffsetDateTime;

use crate::domain::matching::eligibility::{Cooldowns, PairLinks, excluded_by_pair_links};

/// Normalises a typed profile code (10 section 9.1 rule 3): trim, upper-case and remove
/// spaces. Every whitespace character is removed, so a code pasted with a tab or a line break
/// still matches.
pub fn normalize_public_code(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_uppercase)
        .collect()
}

/// Whether E4 to E7 remove a profile from search results (10 section 9.1). They apply to a
/// filtered search; a search by `public_code` drops them, so a member can always find a
/// connection or an earlier contact by code (rule 3). `can_open` still applies in both cases.
pub fn excluded_from_search(
    by_public_code: bool,
    links: &PairLinks,
    cooldowns: Cooldowns,
    now: OffsetDateTime,
) -> bool {
    !by_public_code && excluded_by_pair_links(links, cooldowns, now)
}

/// The keyset over-fetch loop of 10 section 9.3 for the `newest` and `recently_active` sorts.
/// Because `can_open` runs after the query, a page may lose rows; the loop fetches batches of
/// `2 * limit + 1` rows, at most three times, and advances the cursor over every row it
/// examines, dropped or not, so no row is skipped or repeated across pages.
///
/// The caller drives it, because each round is a query:
///
/// ```text
/// let mut pager = OverFetch::new(limit, request_cursor);
/// while !pager.is_done() {
///     let rows = query(filters, sort, pager.after(), pager.batch_size()).await?;
///     pager.absorb(rows, key_of, |row| can_open(viewer, row));
/// }
/// let page = pager.finish();
/// ```
#[derive(Debug, Clone)]
pub struct OverFetch<K, R> {
    page_limit: usize,
    cursor: Option<K>,
    items: Vec<R>,
    rounds: u32,
    /// `Some(more)` once the loop has stopped; `more` says whether a next page may exist.
    finished: Option<bool>,
}

/// One page of results and the cursor of the next page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page<K, R> {
    pub items: Vec<R>,
    /// The key of the last row examined, or `None` when there are no more rows.
    pub next_cursor: Option<K>,
}

impl<K: Clone, R> OverFetch<K, R> {
    /// At most this many queries per page.
    pub const MAX_ROUNDS: u32 = 3;

    /// Starts a page after `cursor` (`None` for the first page). A limit of 0 counts as 1.
    pub fn new(page_limit: usize, cursor: Option<K>) -> Self {
        Self {
            page_limit: page_limit.max(1),
            cursor,
            items: Vec::new(),
            rounds: 0,
            finished: None,
        }
    }

    /// The `LIMIT` of the next query: `2 * page_limit + 1`.
    pub fn batch_size(&self) -> usize {
        self.page_limit.saturating_mul(2).saturating_add(1)
    }

    /// The key to query after: rows strictly after it in the sort order.
    pub fn after(&self) -> Option<&K> {
        self.cursor.as_ref()
    }

    /// Whether the loop has stopped.
    pub fn is_done(&self) -> bool {
        self.finished.is_some()
    }

    /// Feeds the rows of one query, in sort order. `key_of` gives a row's keyset key; `admit`
    /// is the post-filter (`can_open`). Does nothing once the loop has stopped.
    pub fn absorb(
        &mut self,
        rows: Vec<R>,
        key_of: impl Fn(&R) -> K,
        mut admit: impl FnMut(&R) -> bool,
    ) {
        if self.finished.is_some() {
            return;
        }
        let full_batch = rows.len() >= self.batch_size();
        let mut rows = rows.into_iter().peekable();
        while let Some(row) = rows.next() {
            self.cursor = Some(key_of(&row));
            if admit(&row) {
                self.items.push(row);
            }
            if self.items.len() >= self.page_limit {
                // Stopped early: more rows may follow when this batch still had rows or was
                // full. A short batch that ends exactly here has nothing after it.
                self.finished = Some(rows.peek().is_some() || full_batch);
                return;
            }
        }
        self.rounds += 1;
        if !full_batch || self.rounds >= Self::MAX_ROUNDS {
            self.finished = Some(full_batch);
        }
    }

    /// The page. `next_cursor` is set when the last query returned a full batch or the page
    /// filled before the batch ran out.
    pub fn finish(self) -> Page<K, R> {
        let more = self.finished.unwrap_or(true);
        Page {
            items: self.items,
            next_cursor: if more { self.cursor } else { None },
        }
    }
}

#[cfg(test)]
mod tests {
    use time::Duration;

    use super::*;
    use crate::domain::matching::testkit::{self, NOW, subject};
    use crate::domain::options::FieldVisibility;

    const COOLDOWNS: Cooldowns = Cooldowns {
        decline: 90,
        expiry: 30,
        withdraw: 7,
        connection_end: 90,
    };

    #[test]
    fn case_45_a_caste_filter_never_matches_a_hidden_caste() {
        // The SQL filter is `c.caste_code = ANY ($a) AND pv.caste_visibility = 'members'`
        // (10 section 9.2); the matchable view applies the same rule (09 section 5.4).
        let filter = ["arain".to_string()];
        let mut rows = testkit::woman();
        rows.caste_code = Some("arain".into());
        let matches = |rows: testkit::Rows| {
            subject(rows)
                .caste_code
                .is_some_and(|caste| filter.contains(&caste))
        };
        assert!(matches(rows.clone()));
        rows.caste_visibility = FieldVisibility::Connections;
        assert!(!matches(rows.clone()));
        rows.caste_visibility = FieldVisibility::Nobody;
        assert!(!matches(rows));
    }

    #[test]
    fn case_46_a_passed_profile_is_found_by_its_code() {
        let passed = PairLinks {
            pass_expires_at: Some(NOW + Duration::days(100)),
            ..PairLinks::default()
        };
        assert!(!excluded_from_search(true, &passed, COOLDOWNS, NOW));
        assert!(excluded_from_search(false, &passed, COOLDOWNS, NOW));
    }

    /// Runs the loop against rows `1..=total` sorted ascending, as a keyset query would.
    fn page(
        total: u32,
        visible: impl Fn(u32) -> bool,
        limit: usize,
        cursor: Option<u32>,
    ) -> Page<u32, u32> {
        let mut pager = OverFetch::new(limit, cursor);
        let mut queries = 0;
        while !pager.is_done() {
            let after = pager.after().copied().unwrap_or(0);
            let rows: Vec<u32> = (after + 1..=total).take(pager.batch_size()).collect();
            pager.absorb(rows, |row| *row, |row| visible(*row));
            queries += 1;
            assert!(queries <= 3, "at most three queries per page");
        }
        pager.finish()
    }

    fn all_pages(total: u32, visible: impl Fn(u32) -> bool + Copy, limit: usize) -> Vec<Vec<u32>> {
        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let page = page(total, visible, limit, cursor);
            pages.push(page.items);
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
            assert!(pages.len() < 100, "pagination must end");
        }
        pages
    }

    #[test]
    fn case_47_every_visible_row_once_without_duplicates() {
        // 30 rows, every second fails `can_open`, limit 10.
        let pages = all_pages(30, |row| row % 2 == 1, 10);
        assert_eq!(pages[0].len(), 10);
        let seen: Vec<u32> = pages.concat();
        let expected: Vec<u32> = (1..=30).filter(|row| row % 2 == 1).collect();
        assert_eq!(seen, expected);
    }

    #[test]
    fn sparse_rows_stop_after_three_rounds_and_continue() {
        // Only every 25th of 100 rows is visible; a page stops after three batches of 21.
        let pages = all_pages(100, |row| row % 25 == 0, 10);
        assert_eq!(pages, [vec![25, 50], vec![75, 100]]);
    }

    #[test]
    fn exact_fill_at_the_end_has_no_next_page() {
        let first = page(10, |_| true, 10, None);
        assert_eq!(first.items.len(), 10);
        assert_eq!(first.next_cursor, None);

        let first = page(30, |_| true, 10, None);
        assert_eq!(first.next_cursor, Some(10));
    }

    #[test]
    fn empty_result() {
        let page = page(0, |_| true, 10, None);
        assert_eq!(page.items, Vec::<u32>::new());
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn codes_are_normalised() {
        assert_eq!(normalize_public_code("  kr7f 3k2qx9 "), "KR7F3K2QX9");
        assert_eq!(normalize_public_code("kr7f\t3k2qx9\n"), "KR7F3K2QX9");
        assert_eq!(normalize_public_code(""), "");
    }
}
