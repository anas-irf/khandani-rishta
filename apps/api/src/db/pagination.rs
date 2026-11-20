//! Cursor pagination (15 section 1, "Lists").
//!
//! `?limit=20&cursor=<opaque>` in, `{ "items": [...], "next_cursor": "..." }` out. A cursor is
//! the base64url encoding of a small JSON value chosen by each list (usually the sort key and
//! id of the last row), so clients must treat it as opaque.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::error::ApiError;

pub const DEFAULT_LIMIT: i64 = 20;
pub const MAX_LIMIT: i64 = 50;

/// Query parameters of every paginated list.
#[derive(Debug, Clone, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PageParams {
    /// 1 to 50, default 20.
    pub limit: Option<i64>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
}

impl PageParams {
    /// The page size, clamped to 1..=50.
    pub fn limit(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
    }

    /// The decoded cursor, `None` on the first page. A cursor that does not decode answers
    /// `400 bad_request`.
    pub fn cursor<T: DeserializeOwned>(&self) -> Result<Option<T>, ApiError> {
        self.cursor.as_deref().map(decode_cursor).transpose()
    }
}

/// One page of a list.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Page<T> {
    pub items: Vec<T>,
    /// `null` on the last page.
    pub next_cursor: Option<String>,
}

impl<T> Page<T> {
    /// Builds a page from rows fetched with `LIMIT limit + 1`: the extra row only signals that
    /// another page exists. `cursor_of` makes the cursor from the last returned row.
    pub fn from_rows<R, C: Serialize>(
        mut rows: Vec<R>,
        limit: i64,
        cursor_of: impl Fn(&R) -> C,
        map: impl FnMut(R) -> T,
    ) -> Self {
        let limit = usize::try_from(limit).unwrap_or(0);
        let has_more = rows.len() > limit;
        rows.truncate(limit);
        let next_cursor = if has_more {
            rows.last().map(|row| encode_cursor(&cursor_of(row)))
        } else {
            None
        };
        Self {
            items: rows.into_iter().map(map).collect(),
            next_cursor,
        }
    }
}

pub fn encode_cursor<T: Serialize>(value: &T) -> String {
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(value).unwrap_or_default())
}

pub fn decode_cursor<T: DeserializeOwned>(cursor: &str) -> Result<T, ApiError> {
    URL_SAFE_NO_PAD
        .decode(cursor)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or_else(|| ApiError::BadRequest("invalid cursor".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_are_clamped() {
        assert_eq!(PageParams::default().limit(), 20);
        assert_eq!(
            PageParams {
                limit: Some(500),
                cursor: None
            }
            .limit(),
            50
        );
        assert_eq!(
            PageParams {
                limit: Some(0),
                cursor: None
            }
            .limit(),
            1
        );
    }

    #[test]
    fn cursors_round_trip_and_reject_garbage() {
        let cursor = encode_cursor(&("2026-11-20T10:00:00Z", 42));
        let decoded: (String, i32) = decode_cursor(&cursor).unwrap();
        assert_eq!(decoded, ("2026-11-20T10:00:00Z".to_owned(), 42));
        assert!(decode_cursor::<(String, i32)>("!!!").is_err());
    }

    #[test]
    fn pages_use_the_extra_row_to_detect_more() {
        let page = Page::from_rows(vec![1, 2, 3], 2, |n| *n, |n| n * 10);
        assert_eq!(page.items, vec![10, 20]);
        assert_eq!(
            decode_cursor::<i32>(page.next_cursor.as_deref().unwrap()).unwrap(),
            2
        );

        let last = Page::from_rows(vec![1, 2], 2, |n| *n, |n| n);
        assert_eq!(last.next_cursor, None);
    }
}
