//! The `expire_interests` job (19 section 2.8, 11 section 3.6).
//!
//! - `{}` every 15 minutes: every pending interest past `expires_at` becomes `expired`. Nobody
//!   is notified; receivers who are online get fresh `counters`.
//! - `{ "remind": true }` daily at 10:00 `Asia/Karachi`: each receiver with pending interests
//!   that expire on the date three days from today gets one `interest_received` notification
//!   with `reminder: true` and the count, for the earliest of them (one per receiver per day,
//!   kept by the duplicate rule of `notify`).
//!
//! Both forms are idempotent: a second run finds nothing to expire, and a second reminder on
//! the same day is a duplicate.

use serde::Deserialize;
use serde_json::json;
use time::{Duration, OffsetDateTime};

use crate::db::counters;
use crate::db::interests as db;
use crate::domain::time::karachi_day_start;
use crate::domain::types::NotificationType;
use crate::jobs::{ClaimedJob, JobOutcome, payload};
use crate::notify;
use crate::state::AppState;

/// Days before expiry on which the reminder is sent (11 section 3.6).
pub const REMIND_DAYS_BEFORE: i64 = 3;

#[derive(Debug, Default, Deserialize)]
struct Payload {
    #[serde(default)]
    remind: bool,
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = if job.payload.is_null() {
        Payload::default()
    } else {
        payload(job)?
    };
    if payload.remind {
        remind(state, OffsetDateTime::now_utc()).await
    } else {
        expire(state).await
    }
}

/// Expires due interests and refreshes the receivers' counters.
async fn expire(state: &AppState) -> anyhow::Result<JobOutcome> {
    let expired = db::expire_due(&state.db).await?;
    let mut receivers = Vec::with_capacity(expired.len());
    for (interest_id, receiver, compat_score) in expired {
        tracing::info!(event = "interest.expired", %interest_id, compat_score = ?compat_score);
        receivers.push(receiver);
    }
    receivers.sort_unstable();
    receivers.dedup();
    // `counters::push` sends only to profiles with an open socket.
    for receiver in receivers {
        counters::push(state, receiver).await;
    }
    Ok(JobOutcome::Done)
}

/// Sends the reminders for interests expiring on the day three days after `now` (in
/// `Asia/Karachi`).
async fn remind(state: &AppState, now: OffsetDateTime) -> anyhow::Result<JobOutcome> {
    let from = karachi_day_start(now) + Duration::days(REMIND_DAYS_BEFORE);
    let to = from + Duration::days(1);
    for reminder in db::reminders(&state.db, from, to).await? {
        if let Err(error) = notify::notify(
            state,
            reminder.receiver_user_id,
            NotificationType::InterestReceived,
            Some(reminder.sender_profile_id),
            json!({
                "interest_id": reminder.interest_id,
                "reminder": true,
                "count": reminder.count,
            }),
        )
        .await
        {
            // One failed reminder must not stop the others; the next day's run tries the
            // next batch.
            tracing::warn!(error = %format!("{error:#}"), "could not send an interest reminder");
        }
    }
    Ok(JobOutcome::Done)
}

#[cfg(test)]
mod tests;
