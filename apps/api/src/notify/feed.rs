//! `GET /v1/notifications`: one page of the feed with the read-time filter (14 section 7.3
//! rule 3, 15 section 14).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::db::notifications::{self as store, FeedKey, FeedRow};
use crate::db::pagination::{Page, PageParams, encode_cursor};
use crate::error::ApiResult;
use crate::models::notifications::{Notification, NotificationActor};
use crate::notify::actor;
use crate::state::AppState;

/// The most rows one request reads while looking for visible ones. Rows whose actor can no
/// longer be opened are skipped, so a page may need more than `limit` rows.
const MAX_SCANNED_ROWS: usize = 500;

/// Position in the feed: the sort key of the last row returned.
#[derive(Debug, Serialize, Deserialize)]
struct FeedCursor {
    #[serde(with = "time::serde::rfc3339")]
    at: OffsetDateTime,
    id: Uuid,
}

fn key_of(row: &FeedRow) -> FeedKey {
    (row.created_at, row.id)
}

fn cursor_for(key: FeedKey) -> String {
    encode_cursor(&FeedCursor {
        at: key.0,
        id: key.1,
    })
}

/// One page of the feed of `user_id`, newest first. A row whose actor the caller can no longer
/// open (a block, a hidden or suspended profile) is left out, and the page is filled from the
/// rows behind it.
pub async fn page(
    state: &AppState,
    user_id: Uuid,
    profile_id: Uuid,
    params: &PageParams,
) -> ApiResult<Page<Notification>> {
    let limit = params.limit();
    let wanted = usize::try_from(limit).unwrap_or(usize::MAX);
    let mut after: Option<FeedKey> = params
        .cursor::<FeedCursor>()?
        .map(|cursor| (cursor.at, cursor.id));

    // Rows that pass the filter, with their rendered actor.
    let mut visible: Vec<(FeedRow, Option<NotificationActor>)> = Vec::new();
    let mut scanned = 0_usize;
    let mut exhausted = false;
    while visible.len() <= wanted && scanned < MAX_SCANNED_ROWS {
        let rows = store::feed_rows(&state.db, user_id, after, limit + 1).await?;
        scanned += rows.len();
        exhausted = rows.len() < wanted + 1;
        let Some(last) = rows.last() else { break };
        after = Some(key_of(last));

        let ids: Vec<Uuid> = rows
            .iter()
            .filter_map(|row| row.actor_profile_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let actors = actor::load(&state.db, profile_id, &ids).await?;
        for row in rows {
            match row.actor_profile_id {
                None => visible.push((row, None)),
                Some(id) => {
                    if let Some(actor) = actors.get(&id) {
                        let view = actor.view(state.storage.as_ref()).await;
                        visible.push((row, Some(view)));
                    }
                }
            }
        }
        if exhausted {
            break;
        }
    }

    // `visible` may hold one row more than the page: it only tells that another page exists.
    let next_cursor = if visible.len() > wanted {
        visible.truncate(wanted);
        visible.last().map(|(row, _)| cursor_for(key_of(row)))
    } else if exhausted {
        None
    } else {
        // The scan limit was reached before the page was full: continue after the last row read.
        after.map(cursor_for)
    };
    let items = visible
        .into_iter()
        .map(|(row, actor)| Notification {
            id: row.id,
            kind: row.kind,
            actor,
            data: row.data,
            is_read: row.read_at.is_some(),
            created_at: row.created_at,
        })
        .collect();
    Ok(Page { items, next_cursor })
}

/// Decodes a feed cursor, for tests that build requests by hand.
#[cfg(test)]
pub fn decode_feed_cursor(cursor: &str) -> Option<(OffsetDateTime, Uuid)> {
    crate::db::pagination::decode_cursor::<FeedCursor>(cursor)
        .ok()
        .map(|c| (c.at, c.id))
}
