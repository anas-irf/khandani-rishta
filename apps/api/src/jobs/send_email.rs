//! The `send_email` job (19 section 2.7, 14 section 5): one email through Resend.
//!
//! Payload: `{ "user_id", "template", "priority", "data" }`. In order: load the user, apply the
//! template's own skip rules and preference (14 section 5.4), apply the daily budget of the
//! job's priority (14 section 5.2), render and send with the job id as the idempotency key.
//!
//! Without a Resend key the job succeeds without sending and logs a warning (20 section 2.2).
//! It then finishes as `skipped:email_disabled`, so it is not counted as an email sent.

use rand::Rng;
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::db::notifications::{self as store, PrefsRow};
use crate::domain::options::EmailMatchDigest;
use crate::domain::types::{ProfileStatus, UserStatus};
use crate::jobs::{ClaimedJob, JobOutcome, payload};
use crate::models::reference::cities_by_ids;
use crate::notify::actor::{self, Actor};
use crate::notify::email_priority;
use crate::notify::templates::{self, Context, Facts, MemberLine};
use crate::services::resend::OutgoingEmail;
use crate::state::AppState;

/// The most members a digest lists (14 section 5.3).
const DIGEST_MEMBERS: usize = 5;

/// How far back "new interests" of the daily digest reach (14 section 5.4).
const DIGEST_WINDOW_HOURS: i64 = 24;

/// Most interests counted for one digest.
const DIGEST_SCAN: i64 = 200;

/// The daily ceilings of 14 section 5.2: an email of priority `p` is sent only while fewer than
/// `ceiling(p)` emails were sent in the current UTC day. 95 stays under Resend's 100 a day and
/// keeps the month under 3,000.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ceilings([i64; 6]);

impl Ceilings {
    /// Priorities 1 to 6: account and moderation, `welcome` and `interest_accepted`,
    /// `interest_digest`, `unread_messages`, `match_digest`, `announcement`.
    pub const LAUNCH: Self = Self([95, 85, 70, 55, 45, 25]);

    /// Ceilings of your own, for tests that need a small budget.
    #[cfg(test)]
    pub const fn new(by_priority: [i64; 6]) -> Self {
        Self(by_priority)
    }

    /// The ceiling of a priority; a priority outside 1 to 6 counts as the nearest one.
    pub fn for_priority(self, priority: i16) -> i64 {
        let index = usize::try_from(priority.clamp(1, 6) - 1).unwrap_or(0);
        self.0[index]
    }
}

#[derive(Debug, Deserialize)]
struct Payload {
    user_id: Uuid,
    template: String,
    priority: Option<i16>,
    #[serde(default)]
    data: Value,
}

#[derive(Debug, sqlx::FromRow)]
struct Recipient {
    email: Option<String>,
    status: UserStatus,
    last_seen_at: Option<OffsetDateTime>,
    profile_id: Uuid,
    profile_status: ProfileStatus,
}

/// Emails sent in the current UTC day (14 section 5.2). Skipped jobs have a `last_error` and are
/// not counted.
async fn sent_today(db: &PgPool) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM jobs
         WHERE kind = 'send_email' AND status = 'succeeded' AND last_error IS NULL
           AND finished_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
    )
    .fetch_one(db)
    .await
}

/// The next UTC midnight plus a random 0 to 30 minutes, where a deferred email goes (14 section
/// 5.2).
fn next_utc_midnight_with_jitter(now: OffsetDateTime) -> OffsetDateTime {
    let midnight = (now.date() + Duration::days(1)).midnight().assume_utc();
    let jitter = rand::rng().next_u32() % 1_800;
    midnight + Duration::seconds(i64::from(jitter))
}

/// Whether a succeeded `send_email` job of this template already went to the user. Skipped jobs
/// do not count.
async fn already_sent(
    db: &PgPool,
    user_id: Uuid,
    template: &str,
    within: Option<Duration>,
    except_job: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM jobs
             WHERE kind = 'send_email' AND status = 'succeeded' AND last_error IS NULL
               AND payload->>'user_id' = $1 AND payload->>'template' = $2
               AND id <> $3
               AND ($4::timestamptz IS NULL OR finished_at >= $4))",
    )
    .bind(user_id.to_string())
    .bind(template)
    .bind(except_job)
    .bind(within.map(|window| OffsetDateTime::now_utc() - window))
    .fetch_one(db)
    .await
}

/// What the template's own rules decided (14 section 5.4).
enum Prepared {
    Send(Facts),
    Skip(&'static str),
}

/// The member line of a digest: display name rendered for the recipient, age, city.
async fn member_lines(
    db: &PgPool,
    members: Vec<(Actor, Option<i16>)>,
) -> sqlx::Result<Vec<MemberLine>> {
    let city_ids: Vec<i32> = members
        .iter()
        .filter_map(|(actor, _)| actor.city_id)
        .collect();
    let cities = cities_by_ids(db, &city_ids).await?;
    Ok(members
        .into_iter()
        .map(|(actor, compat)| MemberLine {
            display_name: actor.display_name.clone(),
            age: actor.age,
            city: actor
                .city_id
                .and_then(|id| cities.get(&id).map(|city| city.name.clone()))
                .or_else(|| actor.city_other.clone()),
            compat,
        })
        .collect())
}

/// The new interests of the digest: pending, received in the last 24 hours, from senders the
/// recipient can still open, newest first.
async fn interest_digest(db: &PgPool, user: &Recipient) -> sqlx::Result<Prepared> {
    let senders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT i.sender_profile_id FROM interests i
         WHERE i.receiver_profile_id = $1 AND i.status = 'pending'
           AND i.created_at >= now() - make_interval(hours => $2::int)
         ORDER BY i.created_at DESC
         LIMIT $3",
    )
    .bind(user.profile_id)
    .bind(i32::try_from(DIGEST_WINDOW_HOURS).unwrap_or(24))
    .bind(DIGEST_SCAN)
    .fetch_all(db)
    .await?;
    let mut actors = actor::load(db, user.profile_id, &senders).await?;
    let openable: Vec<Actor> = senders.iter().filter_map(|id| actors.remove(id)).collect();
    if openable.is_empty() {
        return Ok(Prepared::Skip("no_interests"));
    }
    let count = i64::try_from(openable.len()).unwrap_or(i64::MAX);
    let listed = openable
        .into_iter()
        .take(DIGEST_MEMBERS)
        .map(|actor| (actor, None))
        .collect();
    Ok(Prepared::Send(Facts {
        members: member_lines(db, listed).await?,
        count,
        ..Facts::default()
    }))
}

/// Active, unmuted connections with unread messages (14 section 8.1 `unread_chats`).
async fn unread_chats(db: &PgPool, profile_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM connection_members m JOIN connections k ON k.id = m.connection_id
         WHERE m.profile_id = $1 AND k.status = 'active' AND NOT m.is_muted AND m.unread_count > 0",
    )
    .bind(profile_id)
    .fetch_one(db)
    .await
}

/// The skip rules of `unread_messages` (14 section 5.4).
async fn unread_messages(
    state: &AppState,
    job: &ClaimedJob,
    user: &Recipient,
    user_id: Uuid,
) -> sqlx::Result<Prepared> {
    let created_at: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT created_at FROM jobs WHERE id = $1")
            .bind(job.id)
            .fetch_optional(&state.db)
            .await?;
    // The member has been in the app since the message.
    if let (Some(seen), Some(created)) = (user.last_seen_at, created_at)
        && seen > created
    {
        return Ok(Prepared::Skip("seen"));
    }
    let chats = unread_chats(&state.db, user.profile_id).await?;
    if chats == 0 {
        return Ok(Prepared::Skip("no_unread"));
    }
    // At most one in 24 hours.
    if already_sent(
        &state.db,
        user_id,
        "unread_messages",
        Some(Duration::hours(24)),
        job.id,
    )
    .await?
    {
        return Ok(Prepared::Skip("recent"));
    }
    Ok(Prepared::Send(Facts {
        count: chats,
        ..Facts::default()
    }))
}

/// The candidates of a match digest that can still be opened, with their match percentage.
async fn match_digest(db: &PgPool, user: &Recipient, data: &Value) -> sqlx::Result<Prepared> {
    let ids: Vec<Uuid> = data
        .get("candidate_ids")
        .and_then(Value::as_array)
        .map_or_default(|ids| {
            ids.iter()
                .filter_map(|id| id.as_str().and_then(|id| Uuid::parse_str(id).ok()))
                .collect()
        });
    let compat: Vec<(Uuid, i16)> = sqlx::query_as(
        "SELECT candidate_profile_id, compat FROM match_recommendations
         WHERE profile_id = $1 AND candidate_profile_id = ANY($2)",
    )
    .bind(user.profile_id)
    .bind(&ids)
    .fetch_all(db)
    .await?;
    let mut actors = actor::load(db, user.profile_id, &ids).await?;
    let listed: Vec<(Actor, Option<i16>)> = ids
        .iter()
        .filter_map(|id| {
            let actor = actors.remove(id)?;
            let percent = compat
                .iter()
                .find(|(candidate, _)| candidate == id)
                .map(|(_, percent)| *percent);
            Some((actor, percent))
        })
        .take(DIGEST_MEMBERS)
        .collect();
    if listed.is_empty() {
        return Ok(Prepared::Skip("no_candidates"));
    }
    Ok(Prepared::Send(Facts {
        members: member_lines(db, listed).await?,
        ..Facts::default()
    }))
}

/// Applies the skip rules and the preference of the template (14 section 5.4). Account emails
/// have neither: they always go (14 section 5.5). The emails that invite a member back to the
/// product are not sent to a user who is not `active`.
async fn prepare(
    state: &AppState,
    job: &ClaimedJob,
    payload: &Payload,
    user: &Recipient,
    prefs: &PrefsRow,
) -> anyhow::Result<Prepared> {
    let db = &state.db;
    let active = user.status == UserStatus::Active;
    Ok(match payload.template.as_str() {
        "account_suspended"
        | "account_warning"
        | "account_deletion"
        | "export_ready"
        | "profile_changes_requested"
        | "verification_result" => Prepared::Send(Facts::default()),
        "welcome" => {
            if !active {
                Prepared::Skip("user_not_active")
            } else if already_sent(db, payload.user_id, "welcome", None, job.id).await? {
                // Only when the profile becomes active for the first time (14 section 5.3).
                Prepared::Skip("already_sent")
            } else {
                Prepared::Send(Facts::default())
            }
        }
        _ if !active => Prepared::Skip("user_not_active"),
        "interest_accepted" => {
            if !prefs.email_interests {
                return Ok(Prepared::Skip("preference"));
            }
            let actor_id = payload
                .data
                .get("actor_profile_id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok());
            let actor = match actor_id {
                Some(id) => actor::load_one(db, user.profile_id, id).await?,
                None => None,
            };
            match actor {
                Some(actor) => Prepared::Send(Facts {
                    actor_name: Some(actor.display_name),
                    ..Facts::default()
                }),
                None => Prepared::Skip("actor_unavailable"),
            }
        }
        "interest_digest" => {
            if prefs.email_interests {
                interest_digest(db, user).await?
            } else {
                Prepared::Skip("preference")
            }
        }
        "unread_messages" => {
            if prefs.email_messages {
                unread_messages(state, job, user, payload.user_id).await?
            } else {
                Prepared::Skip("preference")
            }
        }
        "match_digest" => {
            if prefs.email_match_digest == EmailMatchDigest::Off {
                Prepared::Skip("preference")
            } else if user.profile_status != ProfileStatus::Active {
                Prepared::Skip("profile_not_active")
            } else {
                match_digest(db, user, &payload.data).await?
            }
        }
        "announcement" => {
            if prefs.email_announcements {
                Prepared::Send(Facts::default())
            } else {
                Prepared::Skip("preference")
            }
        }
        other => anyhow::bail!("unknown email template {other:?}"),
    })
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    run_with(state, job, Ceilings::LAUNCH).await
}

/// [`run`] with the daily ceilings given, so that a test can use a small budget.
pub async fn run_with(
    state: &AppState,
    job: &ClaimedJob,
    ceilings: Ceilings,
) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    if !state.email.is_enabled() {
        tracing::warn!(template = %payload.template, "email is off (no RESEND_API_KEY); nothing is sent");
        return Ok(JobOutcome::Skipped("email_disabled".to_owned()));
    }

    // 1. The user needs an email address and must not be deleted.
    let user: Option<Recipient> = sqlx::query_as(
        "SELECT u.email, u.status, u.last_seen_at, p.id AS profile_id, p.status AS profile_status
         FROM users u JOIN profiles p ON p.user_id = u.id
         WHERE u.id = $1",
    )
    .bind(payload.user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(user) = user.filter(|user| user.status != UserStatus::Deleted) else {
        return Ok(JobOutcome::Skipped("user_missing".to_owned()));
    };
    let Some(email) = user.email.clone().filter(|email| !email.trim().is_empty()) else {
        return Ok(JobOutcome::Skipped("no_email".to_owned()));
    };

    // 2. The template's own rules and its preference.
    let prefs = store::preferences(&state.db, payload.user_id).await?;
    let facts = match prepare(state, job, &payload, &user, &prefs).await? {
        Prepared::Send(facts) => facts,
        Prepared::Skip(reason) => return Ok(JobOutcome::Skipped(reason.to_owned())),
    };

    // 3. The daily budget of the priority.
    let priority = payload
        .priority
        .unwrap_or_else(|| email_priority(&payload.template));
    let sent = sent_today(&state.db).await?;
    if sent >= ceilings.for_priority(priority) {
        let deferred_before = job
            .payload
            .get("budget_deferred")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // Account and moderation emails always wait for the next day; `welcome` and
        // `interest_accepted` wait once; the rest is dropped.
        let defer = priority <= 1 || (priority == 2 && !deferred_before);
        if !defer {
            tracing::info!(template = %payload.template, priority, "email dropped: daily budget");
            return Ok(JobOutcome::Skipped("budget".to_owned()));
        }
        if priority == 2 {
            sqlx::query(
                "UPDATE jobs SET payload = payload || '{\"budget_deferred\": true}'::jsonb
                 WHERE id = $1",
            )
            .bind(job.id)
            .execute(&state.db)
            .await?;
        }
        let at = next_utc_midnight_with_jitter(OffsetDateTime::now_utc());
        tracing::info!(template = %payload.template, priority, "email deferred: daily budget");
        return Ok(JobOutcome::Postpone(at));
    }

    // 4. Render and send.
    let settings = state.settings.get().await?;
    let context = Context {
        web_base_url: &state.config.web_base_url,
        support_email: &settings.support_email,
    };
    let Some(rendered) = templates::render(&context, &payload.template, &payload.data, &facts)
    else {
        anyhow::bail!("unknown email template {:?}", payload.template);
    };
    // 5. A rate limit or a server error fails the attempt and is retried with backoff.
    state
        .email
        .send(&OutgoingEmail {
            to: email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            reply_to: Some(settings.support_email.clone()),
            idempotency_key: job.id.to_string(),
        })
        .await?;
    tracing::info!(job_id = %job.id, template = %payload.template, priority, "email sent");
    Ok(JobOutcome::Done)
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    #[test]
    fn ceilings_follow_the_table_of_the_spec() {
        let ceilings = Ceilings::LAUNCH;
        let table: Vec<i64> = (1..=6).map(|p| ceilings.for_priority(p)).collect();
        assert_eq!(table, [95, 85, 70, 55, 45, 25]);
        assert_eq!(ceilings.for_priority(0), 95);
        assert_eq!(ceilings.for_priority(9), 25);
    }

    #[test]
    fn deferred_emails_go_to_the_next_utc_midnight_plus_up_to_half_an_hour() {
        let now = datetime!(2026-11-20 23:50 UTC);
        for _ in 0..50 {
            let at = next_utc_midnight_with_jitter(now);
            let after_midnight = at - datetime!(2026-11-21 00:00 UTC);
            assert!(after_midnight >= Duration::ZERO && after_midnight < Duration::minutes(30));
        }
    }
}
