//! The recommendations refresh (10 section 8) and the `refresh_recommendations` job (19
//! section 2.5).
//!
//! [`refresh`] is the one implementation: the candidate pool query of 10 section 8.4, the
//! Rust scoring pass of [`score_pool`], and the delete-then-insert of `match_recommendations`.
//! The job, the inline refresh of `GET /v1/recommendations` and `GET /v1/home` (10 section
//! 8.6) and `POST /v1/recommendations/refresh` all reach it.
//!
//! In-process state, valid because one API instance runs per environment (19 section 6.2):
//! a per-profile guard so two refreshes of one profile never overlap (the second waits for
//! the first, then skips when the first has made the list fresh), and the `eligible_count`
//! and relaxation hints of the last refresh for 24 hours (10 section 8.5 step 8).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::Duration as StdDuration;

use moka::sync::Cache;
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, Postgres, QueryBuilder};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::matching::fit::Side;
use crate::domain::matching::rank::RankSignals;
use crate::domain::matching::refresh::{
    PoolCandidate, PoolQueryParams, Recommendation, RelaxationHint, count_new_matches, score_pool,
};
use crate::domain::types::{NotificationType, ProfileStatus};
use crate::jobs::{ClaimedJob, JobOutcome};
use crate::notify::notify;
use crate::settings::AppSettings;
use crate::state::AppState;
use crate::views::{self, Member};

/// Rows inserted per statement (10 section 8.5).
const INSERT_CHUNK: usize = 100;

/// How long the summary of a refresh is kept (10 section 8.5 step 8).
const SUMMARY_TTL: StdDuration = StdDuration::from_hours(24);

/// The facts of the last refresh that `pool_exhausted` and the hints need.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolSummary {
    /// Candidates that passed steps 2 to 4 of 10 section 8.5.
    pub eligible_count: u32,
    pub relaxation_hints: Vec<RelaxationHint>,
}

static SUMMARIES: LazyLock<Cache<Uuid, PoolSummary>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(100_000)
        .time_to_live(SUMMARY_TTL)
        .build()
});

static GUARDS: LazyLock<Cache<Uuid, Arc<tokio::sync::Mutex<()>>>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(100_000)
        .time_to_idle(StdDuration::from_secs(600))
        .build()
});

/// The summary of the profile's last refresh, while the in-process cache holds it.
pub fn pool_summary(profile_id: Uuid) -> Option<PoolSummary> {
    SUMMARIES.get(&profile_id)
}

/// What a refresh did.
#[derive(Debug, Clone, PartialEq)]
pub enum Refreshed {
    /// The profile is not `active`: nothing to recommend (19 section 2.5 step 1).
    NotActive,
    /// Another refresh of the same profile finished while this one waited.
    AlreadyFresh,
    /// The cache was rebuilt.
    Done {
        /// Candidate ids cached before the refresh.
        previous: Vec<Uuid>,
        /// The new rows, best first.
        recommendations: Vec<Recommendation>,
    },
}

/// Runs the refresh of 10 sections 8.4 and 8.5 for one profile. Never inside an HTTP
/// transaction: it takes its own connections.
pub async fn refresh(state: &AppState, profile_id: Uuid) -> anyhow::Result<Refreshed> {
    let waiting_since = OffsetDateTime::now_utc();
    let guard = GUARDS.get_with(profile_id, || Arc::new(tokio::sync::Mutex::new(())));
    let _running = guard.lock().await;

    let now = OffsetDateTime::now_utc();
    let Some(viewer) = views::members(state, &[profile_id], now)
        .await?
        .remove(&profile_id)
    else {
        return Ok(Refreshed::NotActive);
    };
    if viewer.status() != ProfileStatus::Active {
        return Ok(Refreshed::NotActive);
    }
    if !viewer.row.match_stale
        && viewer
            .row
            .match_refreshed_at
            .is_some_and(|at| at >= waiting_since)
    {
        return Ok(Refreshed::AlreadyFresh);
    }
    let Some(viewer_subject) = viewer.subject.clone() else {
        return Ok(Refreshed::NotActive);
    };
    let settings = state.settings.get().await?;

    let pool_ids = pool_query(&state.db, &viewer, &settings, now).await?;
    let mut candidates = views::members(state, &pool_ids, now).await?;
    let previous = previous_rows(&state.db, profile_id).await?;
    let signals = rank_signals(&state.db, &pool_ids, &previous).await?;
    let geo = views::load_geo(
        &state.db,
        std::iter::once(&viewer.prefs).chain(candidates.values().map(|member| &member.prefs)),
    )
    .await?;

    let pool: Vec<PoolCandidate> = pool_ids
        .iter()
        .filter_map(|id| candidates.remove(id))
        .filter_map(|member| {
            let signals = signals.get(&member.id()).copied().unwrap_or_default();
            Some(PoolCandidate {
                discovery_visibility: member.privacy().discovery_visibility,
                subject: member.subject?,
                prefs: member.prefs,
                signals,
            })
        })
        .collect();
    let keep = usize::try_from(settings.recommendations_size.max(0)).unwrap_or(usize::MAX);
    let outcome = score_pool(
        Side {
            subject: &viewer_subject,
            prefs: &viewer.prefs,
        },
        &pool,
        &geo,
        now,
        keep,
    );

    write(&state.db, profile_id, &outcome.recommendations, &previous).await?;
    SUMMARIES.insert(
        profile_id,
        PoolSummary {
            eligible_count: outcome.eligible_count,
            relaxation_hints: outcome.relaxation_hints.clone(),
        },
    );
    tracing::debug!(
        profile_id = %profile_id,
        pool = pool.len(),
        eligible = outcome.eligible_count,
        kept = outcome.recommendations.len(),
        "recommendations refreshed"
    );
    Ok(Refreshed::Done {
        previous: previous.keys().copied().collect(),
        recommendations: outcome.recommendations,
    })
}

/// The candidate pool query of 10 section 8.4: E1 to E7, E9, the `hidden` part of E8 and the
/// viewer's age and religion must-haves, pre-ranked by place and recency, at most
/// `matching.candidate_pool_size` ids. The rows themselves are loaded by the views loader, so
/// the matchable view is built in one place.
async fn pool_query(
    db: &PgPool,
    viewer: &Member,
    settings: &AppSettings,
    now: OffsetDateTime,
) -> sqlx::Result<Vec<Uuid>> {
    let Some(subject) = viewer.subject.as_ref() else {
        return Ok(Vec::new());
    };
    let params = PoolQueryParams::new(
        subject,
        &viewer.prefs,
        crate::domain::time::karachi_date(now),
    );
    let days = |value: i64| i32::try_from(value.max(0)).unwrap_or(i32::MAX);
    sqlx::query_scalar(
        "WITH excluded AS (
             SELECT blocked_profile_id AS id FROM blocks WHERE blocker_profile_id = $1
             UNION
             SELECT blocker_profile_id FROM blocks WHERE blocked_profile_id = $1
             UNION
             SELECT target_profile_id FROM passes WHERE profile_id = $1 AND expires_at > now()
             UNION
             SELECT other.profile_id
             FROM connection_members mine
             JOIN connections k ON k.id = mine.connection_id
             JOIN connection_members other ON other.connection_id = k.id AND other.profile_id <> $1
             WHERE mine.profile_id = $1
               AND (k.status = 'active' OR k.ended_at > now() - make_interval(days => $14))
             UNION
             SELECT CASE WHEN i.sender_profile_id = $1 THEN i.receiver_profile_id ELSE i.sender_profile_id END
             FROM interests i
             WHERE (i.sender_profile_id = $1 OR i.receiver_profile_id = $1)
               AND (   i.status = 'pending'
                    OR (i.status = 'declined'  AND i.responded_at > now() - make_interval(days => $11))
                    OR (i.status = 'expired'   AND i.expires_at   > now() - make_interval(days => $12))
                    OR (i.status = 'withdrawn' AND i.responded_at > now() - make_interval(days => $13)))
         )
         SELECT c.id
         FROM profiles c
         JOIN users u                     ON u.id = c.user_id AND u.status = 'active'
         JOIN profile_privacy pv          ON pv.profile_id = c.id
         LEFT JOIN partner_preferences pp ON pp.profile_id = c.id
         WHERE c.status = 'active'
           AND c.gender <> $2
           AND c.id <> $1
           AND pv.discovery_visibility <> 'hidden'
           AND (c.marital_status <> 'married' OR $6)
           AND (NOT $7 OR 'married' = ANY (COALESCE(pp.marital_statuses, '{}')))
           AND ($8::date IS NULL OR c.date_of_birth > $8)
           AND ($9::date IS NULL OR c.date_of_birth <= $9)
           AND ($10::text[] IS NULL OR c.religion_code = ANY ($10))
           AND NOT EXISTS (SELECT 1 FROM excluded e WHERE e.id = c.id)
         ORDER BY
             (CASE WHEN c.city_id = ANY ($3) THEN 3
                   WHEN c.region_id = ANY ($4) THEN 2
                   WHEN c.country_code = ANY ($5) THEN 1
                   ELSE 0 END
              + CASE WHEN c.last_active_at > now() - interval '7 days'  THEN 3
                     WHEN c.last_active_at > now() - interval '30 days' THEN 2
                     WHEN c.last_active_at > now() - interval '90 days' THEN 1
                     ELSE 0 END) DESC,
             c.last_active_at DESC NULLS LAST,
             c.id
         LIMIT $15",
    )
    .bind(viewer.id())
    .bind(subject.gender)
    .bind(&params.city_ids)
    .bind(&params.region_ids)
    .bind(&params.country_codes)
    .bind(params.viewer_accepts_married)
    .bind(params.viewer_is_married)
    .bind(params.born_after)
    .bind(params.born_on_or_before)
    .bind(&params.religion_codes)
    .bind(days(settings.cooldown_after_decline_days))
    .bind(days(settings.cooldown_after_expiry_days))
    .bind(days(settings.cooldown_after_withdraw_days))
    .bind(days(settings.connection_cooldown_after_end_days))
    .bind(settings.candidate_pool_size.max(0))
    .fetch_all(db)
    .await
}

/// The viewer's existing rows, to carry `shown_count` and `last_shown_at` over.
async fn previous_rows(
    db: &PgPool,
    profile_id: Uuid,
) -> sqlx::Result<HashMap<Uuid, (i16, Option<OffsetDateTime>)>> {
    let rows: Vec<(Uuid, i16, Option<OffsetDateTime>)> = sqlx::query_as(
        "SELECT candidate_profile_id, shown_count, last_shown_at
         FROM match_recommendations WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, shown, last)| (id, (shown, last)))
        .collect())
}

/// The follow-up queries of 10 section 8.4: exposure (pending interests received in 14 days)
/// and conduct (an actioned report in 90 days), plus fatigue from the previous rows.
async fn rank_signals(
    db: &PgPool,
    ids: &[Uuid],
    previous: &HashMap<Uuid, (i16, Option<OffsetDateTime>)>,
) -> sqlx::Result<HashMap<Uuid, RankSignals>> {
    let exposure: Vec<(Uuid, i64)> = sqlx::query_as(
        "SELECT receiver_profile_id, count(*) FROM interests
         WHERE receiver_profile_id = ANY ($1) AND status = 'pending'
           AND created_at > now() - interval '14 days'
         GROUP BY receiver_profile_id",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;
    let reported: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT target_profile_id FROM reports
         WHERE target_profile_id = ANY ($1) AND status = 'actioned'
           AND handled_at > now() - interval '90 days'",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;
    let exposure: HashMap<Uuid, i64> = exposure.into_iter().collect();
    let reported: HashSet<Uuid> = reported.into_iter().collect();
    Ok(ids
        .iter()
        .map(|id| {
            (
                *id,
                RankSignals {
                    pending_interests: exposure
                        .get(id)
                        .map_or(0, |count| u32::try_from(*count).unwrap_or(u32::MAX)),
                    shown_count: previous.get(id).map_or(0, |(shown, _)| *shown),
                    recently_actioned_report: reported.contains(id),
                },
            )
        })
        .collect())
}

/// Step 7 of 10 section 8.5 in one transaction: delete the viewer's rows, insert the kept rows
/// in chunks of 100 with `shown_count` and `last_shown_at` carried over, and mark the
/// recommendations fresh.
async fn write(
    db: &PgPool,
    profile_id: Uuid,
    rows: &[Recommendation],
    previous: &HashMap<Uuid, (i16, Option<OffsetDateTime>)>,
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM match_recommendations WHERE profile_id = $1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    for chunk in rows.chunks(INSERT_CHUNK) {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO match_recommendations
             (profile_id, candidate_profile_id, compat, rank_score, reasons, shown_count, last_shown_at, computed_at) ",
        );
        qb.push_values(chunk, |mut values, row| {
            let (shown, last) = previous
                .get(&row.candidate_profile_id)
                .copied()
                .unwrap_or((0, None));
            values
                .push_bind(profile_id)
                .push_bind(row.candidate_profile_id)
                .push_bind(i16::from(row.compat))
                .push_bind(row.rank_score)
                .push_bind(row.reasons.clone())
                .push_bind(shown)
                .push_bind(last)
                .push("now()");
        });
        qb.build().execute(&mut *tx).await?;
    }
    sqlx::query(
        "UPDATE profiles SET match_stale = false, match_refreshed_at = now() WHERE id = $1",
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// The two payload forms of 19 section 2.5.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Payload {
    Profile {
        profile_id: Uuid,
        #[serde(default)]
        notify: bool,
    },
    Fanout {
        #[expect(dead_code, reason = "only selects the form")]
        fanout: bool,
    },
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    match crate::jobs::payload::<Payload>(job)? {
        Payload::Fanout { .. } => fanout(state).await,
        Payload::Profile { profile_id, notify } => run_for_profile(state, profile_id, notify).await,
    }
}

/// The nightly batch: one job per `active` profile active within 7 days whose list is older
/// than 20 hours (19 section 2.5).
async fn fanout(state: &AppState) -> anyhow::Result<JobOutcome> {
    let result = sqlx::query(
        "INSERT INTO jobs (id, kind, payload, dedupe_key, max_attempts)
         SELECT uuidv7(), 'refresh_recommendations',
                jsonb_build_object('profile_id', p.id, 'notify', true),
                p.id::text, 2
         FROM profiles p
         WHERE p.status = 'active'
           AND p.last_active_at > now() - interval '7 days'
           AND (p.match_refreshed_at IS NULL OR p.match_refreshed_at < now() - interval '20 hours')
         ON CONFLICT (kind, dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL DO NOTHING",
    )
    .execute(&state.db)
    .await?;
    state.jobs.wake();
    tracing::info!(enqueued = result.rows_affected(), "recommendations fanout");
    Ok(JobOutcome::Done)
}

/// The form `{ "profile_id", "notify" }` (19 section 2.5 steps 1 to 4).
async fn run_for_profile(
    state: &AppState,
    profile_id: Uuid,
    notify_new: bool,
) -> anyhow::Result<JobOutcome> {
    let row: Option<(ProfileStatus, Uuid, bool, Option<OffsetDateTime>)> = sqlx::query_as(
        "SELECT status, user_id, match_stale, match_refreshed_at FROM profiles WHERE id = $1",
    )
    .bind(profile_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((status, user_id, marked_stale, refreshed_at)) = row else {
        return Ok(JobOutcome::Skipped("no profile".to_owned()));
    };
    if status != ProfileStatus::Active {
        return Ok(JobOutcome::Skipped("not active".to_owned()));
    }
    let now = OffsetDateTime::now_utc();
    if notify_new
        && !marked_stale
        && refreshed_at.is_some_and(|at| at > now - time::Duration::hours(20))
    {
        return Ok(JobOutcome::Skipped("fresh".to_owned()));
    }
    let Refreshed::Done {
        previous,
        recommendations,
    } = refresh(state, profile_id).await?
    else {
        return Ok(JobOutcome::Skipped("not refreshed".to_owned()));
    };
    if notify_new {
        let count = count_new_matches(&previous, &recommendations);
        if count >= 1
            && !recently_notified(&state.db, user_id).await?
            && let Err(error) = notify(
                state,
                user_id,
                NotificationType::NewMatches,
                None,
                json!({ "source": "recommendations", "count": count, "saved_search_id": null }),
            )
            .await
        {
            tracing::warn!(%error, %profile_id, "could not create the new matches notification");
        }
    }
    Ok(JobOutcome::Done)
}

/// The 20-hour rule for `new_matches` from recommendations (10 section 8.6, 14 section 7.2).
async fn recently_notified(db: &PgPool, user_id: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM notifications
                        WHERE user_id = $1 AND type = 'new_matches'
                          AND data->>'source' = 'recommendations'
                          AND created_at > now() - interval '20 hours')",
    )
    .bind(user_id)
    .fetch_one(db)
    .await
}
