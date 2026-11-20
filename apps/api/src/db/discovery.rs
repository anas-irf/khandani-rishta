//! SQL for discovery (10 sections 8 to 10, 09 section 8): search, the recommendations cache,
//! profile views, visitors and saved searches. Dynamic statements are built only from fixed
//! fragments with every value bound (10 section 9.2).

use serde_json::Value;
use sqlx::{PgPool, Postgres, QueryBuilder};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::matching::eligibility::Cooldowns;
use crate::domain::matching::refresh::PoolQueryParams;
use crate::domain::options::Gender;
use crate::domain::visibility::ViewRecord;
use crate::models::discovery::SearchFilters;

// -------------------------------------------------------------------------------------------
// Search (10 section 9)
// -------------------------------------------------------------------------------------------

/// What a search runs for: the viewer's side of E1 to E9 and the filters.
#[derive(Debug, Clone)]
pub struct SearchScope<'a> {
    pub viewer_id: Uuid,
    pub viewer_gender: Gender,
    /// The viewer's `marital_statuses` contains `married` (E9).
    pub viewer_accepts_married: bool,
    /// The viewer is `married` (E9).
    pub viewer_is_married: bool,
    pub cooldowns: Cooldowns,
    /// Today in `Asia/Karachi`, for the age filters.
    pub today: Date,
    pub filters: &'a SearchFilters,
    /// Only profiles first activated after this instant (`saved_search_alerts`, 10 section 9.5).
    pub activated_after: Option<OffsetDateTime>,
}

/// A row of a search: the id and the keys the sorts use.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SearchRow {
    pub id: Uuid,
    pub first_activated_at: Option<OffsetDateTime>,
    pub last_active_at: Option<OffsetDateTime>,
}

/// The keyset sorts of 10 section 9.3.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeysetSort {
    /// `first_activated_at DESC, id DESC`.
    Newest,
    /// `COALESCE(last_active_at, '-infinity') DESC, id DESC`.
    RecentlyActive,
}

impl KeysetSort {
    /// The column the sort reads.
    fn column(self) -> &'static str {
        match self {
            Self::Newest => "c.first_activated_at",
            Self::RecentlyActive => "c.last_active_at",
        }
    }

    /// The key of a row.
    pub fn key_of(self, row: &SearchRow) -> (Option<OffsetDateTime>, Uuid) {
        match self {
            Self::Newest => (row.first_activated_at, row.id),
            Self::RecentlyActive => (row.last_active_at, row.id),
        }
    }
}

fn days(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

/// The `excluded` CTE of 10 section 8.4: blocks both ways (E3), the viewer's passes (E4),
/// active and recently ended connections (E5), pending interests and the interest cooldowns in
/// both directions (E6, E7).
fn push_excluded(qb: &mut QueryBuilder<Postgres>, viewer: Uuid, cooldowns: Cooldowns) {
    qb.push("WITH excluded AS (SELECT blocked_profile_id AS id FROM blocks WHERE blocker_profile_id = ")
        .push_bind(viewer)
        .push(" UNION SELECT blocker_profile_id FROM blocks WHERE blocked_profile_id = ")
        .push_bind(viewer)
        .push(" UNION SELECT target_profile_id FROM passes WHERE profile_id = ")
        .push_bind(viewer)
        .push(" AND expires_at > now()")
        .push(
            " UNION SELECT other.profile_id FROM connection_members mine \
             JOIN connections k ON k.id = mine.connection_id \
             JOIN connection_members other ON other.connection_id = k.id AND other.profile_id <> mine.profile_id \
             WHERE mine.profile_id = ",
        )
        .push_bind(viewer)
        .push(" AND (k.status = 'active' OR k.ended_at > now() - make_interval(days => ")
        .push_bind(days(cooldowns.connection_end))
        .push("))")
        .push(" UNION SELECT CASE WHEN i.sender_profile_id = ")
        .push_bind(viewer)
        .push(" THEN i.receiver_profile_id ELSE i.sender_profile_id END FROM interests i WHERE (i.sender_profile_id = ")
        .push_bind(viewer)
        .push(" OR i.receiver_profile_id = ")
        .push_bind(viewer)
        .push(") AND (i.status = 'pending' OR (i.status = 'declined' AND i.responded_at > now() - make_interval(days => ")
        .push_bind(days(cooldowns.decline))
        .push(")) OR (i.status = 'expired' AND i.expires_at > now() - make_interval(days => ")
        .push_bind(days(cooldowns.expiry))
        .push(")) OR (i.status = 'withdrawn' AND i.responded_at > now() - make_interval(days => ")
        .push_bind(days(cooldowns.withdraw))
        .push("))))");
}

/// `WITH excluded ... SELECT <select> FROM ... WHERE <eligibility and filters>`: E1 to E9
/// except the `preference_match` part of E8, which the caller checks in Rust (10 section 9.1),
/// plus every filter of 10 section 9.2 that is present.
fn push_filtered(qb: &mut QueryBuilder<Postgres>, scope: &SearchScope<'_>, select: &str) {
    push_excluded(qb, scope.viewer_id, scope.cooldowns);
    qb.push(" SELECT ")
        .push(select)
        .push(
            " FROM profiles c \
             JOIN users u ON u.id = c.user_id AND u.status = 'active' \
             JOIN profile_privacy pv ON pv.profile_id = c.id \
             LEFT JOIN partner_preferences pp ON pp.profile_id = c.id \
             LEFT JOIN profile_family pf ON pf.profile_id = c.id \
             LEFT JOIN education_levels el ON el.code = c.education_level_code \
             LEFT JOIN income_bands ib ON ib.code = c.income_band_code \
             WHERE c.status = 'active' AND pv.discovery_visibility <> 'hidden' AND c.gender <> ",
        )
        .push_bind(scope.viewer_gender)
        .push(" AND c.id <> ")
        .push_bind(scope.viewer_id)
        .push(" AND (c.marital_status <> 'married' OR ")
        .push_bind(scope.viewer_accepts_married)
        .push(") AND (NOT ")
        .push_bind(scope.viewer_is_married)
        .push(" OR 'married' = ANY (COALESCE(pp.marital_statuses, '{}')))")
        .push(" AND NOT EXISTS (SELECT 1 FROM excluded e WHERE e.id = c.id)");
    if let Some(after) = scope.activated_after {
        qb.push(" AND c.first_activated_at > ").push_bind(after);
    }
    push_filters(qb, scope);
}

/// A non-empty array filter, or `None`.
fn present<T: Clone>(values: Option<&Vec<T>>) -> Option<Vec<T>> {
    values.filter(|values| !values.is_empty()).cloned()
}

/// The filter rows of 10 section 9.2. Search filters are exact: a profile with a `null` value
/// never matches a filter on it, and a value hidden from members never matches either.
fn push_filters(qb: &mut QueryBuilder<Postgres>, scope: &SearchScope<'_>) {
    let f = scope.filters;
    if let Some(age_min) = f.age_min {
        qb.push(" AND c.date_of_birth <= (")
            .push_bind(scope.today)
            .push("::date - make_interval(years => ")
            .push_bind(i32::from(age_min))
            .push("))::date");
    }
    if let Some(age_max) = f.age_max {
        qb.push(" AND c.date_of_birth > (")
            .push_bind(scope.today)
            .push("::date - make_interval(years => ")
            .push_bind(i32::from(age_max) + 1)
            .push("))::date");
    }
    if let Some(min) = f.height_min_cm {
        qb.push(" AND c.height_cm >= ").push_bind(min);
    }
    if let Some(max) = f.height_max_cm {
        qb.push(" AND c.height_cm <= ").push_bind(max);
    }
    if let Some(values) = present(f.marital_statuses.as_ref()) {
        qb.push(" AND c.marital_status = ANY (")
            .push_bind(values)
            .push(")");
    }
    match f.children_acceptance {
        Some(crate::domain::options::ChildrenAcceptance::None) => {
            qb.push(
                " AND (c.children_status = 'none' \
                 OR (c.children_status IS NULL AND c.marital_status = 'never_married'))",
            );
        }
        Some(crate::domain::options::ChildrenAcceptance::NotLivingWithPartner) => {
            qb.push(
                " AND (c.children_status IN ('none', 'not_living_with_me') \
                 OR (c.children_status IS NULL AND c.marital_status = 'never_married'))",
            );
        }
        Some(crate::domain::options::ChildrenAcceptance::Any) | None => {}
    }
    push_any(
        qb,
        "c.religion_code",
        present(f.religion_codes.as_ref()),
        "",
    );
    push_any(qb, "c.sect_code", present(f.sect_codes.as_ref()), "");
    push_any(
        qb,
        "c.caste_code",
        present(f.caste_codes.as_ref()),
        " AND pv.caste_visibility = 'members'",
    );
    push_any(
        qb,
        "c.mother_tongue_code",
        present(f.mother_tongue_codes.as_ref()),
        "",
    );
    let countries = present(f.country_codes.as_ref());
    let regions = present(f.region_ids.as_ref());
    let cities = present(f.city_ids.as_ref());
    if countries.is_some() || regions.is_some() || cities.is_some() {
        qb.push(" AND (c.country_code = ANY (")
            .push_bind(countries.unwrap_or_default())
            .push(") OR c.region_id = ANY (")
            .push_bind(regions.unwrap_or_default())
            .push(") OR c.city_id = ANY (")
            .push_bind(cities.unwrap_or_default())
            .push("))");
    }
    if let Some(rank) = f.education_min_rank {
        qb.push(" AND el.rank >= ").push_bind(rank);
    }
    if let Some(values) = present(f.employment_types.as_ref()) {
        qb.push(" AND c.employment_type = ANY (")
            .push_bind(values)
            .push(")");
    }
    push_any(
        qb,
        "c.profession_code",
        present(f.profession_codes.as_ref()),
        "",
    );
    if let Some(rank) = f.income_min_rank {
        qb.push(" AND ib.rank >= ")
            .push_bind(rank)
            .push(" AND pv.income_visibility = 'members'");
    }
    push_filter_lifestyle(qb, scope);
}

/// `<column> = ANY ($a)<extra>` when the filter is present.
fn push_any(
    qb: &mut QueryBuilder<Postgres>,
    column: &'static str,
    values: Option<Vec<String>>,
    extra: &'static str,
) {
    if let Some(values) = values {
        qb.push(" AND ")
            .push(column)
            .push(" = ANY (")
            .push_bind(values)
            .push(")")
            .push(extra);
    }
}

/// The lifestyle, family, management and activity filters of 10 section 9.2.
fn push_filter_lifestyle(qb: &mut QueryBuilder<Postgres>, scope: &SearchScope<'_>) {
    let f = scope.filters;
    if let Some(values) = present(f.religiosity_levels.as_ref()) {
        qb.push(" AND c.religiosity = ANY (")
            .push_bind(values)
            .push(")");
    }
    // Appearance follows the gender being searched for.
    if scope.viewer_gender == Gender::Male
        && let Some(values) = present(f.hijab_types.as_ref())
    {
        qb.push(" AND c.hijab = ANY (").push_bind(values).push(")");
    }
    if scope.viewer_gender == Gender::Female
        && let Some(values) = present(f.beard_types.as_ref())
    {
        qb.push(" AND c.beard = ANY (").push_bind(values).push(")");
    }
    if let Some(values) = present(f.family_values.as_ref()) {
        qb.push(" AND pf.family_values = ANY (")
            .push_bind(values)
            .push(") AND pv.family_visibility = 'members'");
    }
    if let Some(values) = present(f.family_types.as_ref()) {
        qb.push(" AND pf.family_type = ANY (")
            .push_bind(values)
            .push(") AND pv.family_visibility = 'members'");
    }
    if let Some(values) = present(f.living_arrangements.as_ref()) {
        qb.push(" AND c.living_arrangement = ANY (")
            .push_bind(values)
            .push(")");
    }
    if let Some(values) = present(f.work_after_marriage_options.as_ref()) {
        qb.push(" AND c.work_after_marriage = ANY (")
            .push_bind(values)
            .push(")");
    }
    if let Some(values) = present(f.smoking_options.as_ref()) {
        qb.push(" AND c.smoking = ANY (")
            .push_bind(values)
            .push(")");
    }
    if let Some(values) = present(f.managed_by.as_ref()) {
        qb.push(" AND c.managed_by = ANY (")
            .push_bind(values)
            .push(")");
    }
    if f.has_photo == Some(true) {
        qb.push(" AND c.has_approved_photo");
    }
    if f.verified_only == Some(true) {
        qb.push(" AND (c.is_id_verified OR c.is_photo_verified)");
    }
    if let Some(days) = f.active_within_days {
        qb.push(" AND c.last_active_at > now() - make_interval(days => ")
            .push_bind(days)
            .push(")");
    }
    if let Some(days) = f.joined_within_days {
        qb.push(" AND c.first_activated_at > now() - make_interval(days => ")
            .push_bind(days)
            .push(")");
    }
}

const SEARCH_SELECT: &str = "c.id, c.first_activated_at, c.last_active_at";

/// One batch of a keyset sort, after `after` (exclusive).
pub async fn search_page(
    db: &PgPool,
    scope: &SearchScope<'_>,
    sort: KeysetSort,
    after: Option<(Option<OffsetDateTime>, Uuid)>,
    limit: usize,
) -> sqlx::Result<Vec<SearchRow>> {
    let mut qb = QueryBuilder::new("");
    push_filtered(&mut qb, scope, SEARCH_SELECT);
    let column = sort.column();
    if let Some((at, id)) = after {
        qb.push(" AND (COALESCE(")
            .push(column)
            .push(", '-infinity'::timestamptz), c.id) < (COALESCE(")
            .push_bind(at)
            .push("::timestamptz, '-infinity'::timestamptz), ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY COALESCE(")
        .push(column)
        .push(", '-infinity'::timestamptz) DESC, c.id DESC LIMIT ")
        .push_bind(i64::try_from(limit).unwrap_or(i64::MAX));
    qb.build_query_as().fetch_all(db).await
}

/// The `best_match` pool: the filtered query in the pre-rank order of 10 section 8.4, at most
/// `limit` rows (600).
pub async fn search_pool(
    db: &PgPool,
    scope: &SearchScope<'_>,
    hints: &PoolQueryParams,
    limit: i64,
) -> sqlx::Result<Vec<SearchRow>> {
    let mut qb = QueryBuilder::new("");
    push_filtered(&mut qb, scope, SEARCH_SELECT);
    push_pre_rank(&mut qb, hints);
    qb.push(" LIMIT ").push_bind(limit);
    qb.build_query_as().fetch_all(db).await
}

/// The pre-rank order of 10 section 8.4: preferred places, then recency.
fn push_pre_rank(qb: &mut QueryBuilder<Postgres>, hints: &PoolQueryParams) {
    qb.push(" ORDER BY (CASE WHEN c.city_id = ANY (")
        .push_bind(hints.city_ids.clone())
        .push(") THEN 3 WHEN c.region_id = ANY (")
        .push_bind(hints.region_ids.clone())
        .push(") THEN 2 WHEN c.country_code = ANY (")
        .push_bind(hints.country_codes.clone())
        .push(
            ") THEN 1 ELSE 0 END \
             + CASE WHEN c.last_active_at > now() - interval '7 days' THEN 3 \
                    WHEN c.last_active_at > now() - interval '30 days' THEN 2 \
                    WHEN c.last_active_at > now() - interval '90 days' THEN 1 \
                    ELSE 0 END) DESC, c.last_active_at DESC NULLS LAST, c.id",
        );
}

/// `SELECT count(*) FROM (<filtered query> LIMIT cap) t` (10 section 9.4 rule 1).
pub async fn search_count(db: &PgPool, scope: &SearchScope<'_>, cap: i64) -> sqlx::Result<i64> {
    let mut qb = QueryBuilder::new("SELECT count(*) FROM (");
    push_filtered(&mut qb, scope, "c.id");
    qb.push(" LIMIT ").push_bind(cap).push(") t");
    qb.build_query_scalar().fetch_one(db).await
}

/// The id of the profile with this public code, if any.
pub async fn profile_id_by_code(db: &PgPool, public_code: &str) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar("SELECT id FROM profiles WHERE public_code = $1")
        .bind(public_code)
        .fetch_optional(db)
        .await
}

// -------------------------------------------------------------------------------------------
// The recommendations cache (10 sections 8.6 and 10)
// -------------------------------------------------------------------------------------------

/// A cached recommendation in serving order.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CachedRow {
    pub candidate_profile_id: Uuid,
    pub rank_score: f32,
}

/// One page of the cache by `rank_score`, after the keyset `(rank_score, candidate id)`.
pub async fn recommendation_page(
    db: &PgPool,
    viewer: Uuid,
    after: Option<(f32, Uuid)>,
    limit: usize,
) -> sqlx::Result<Vec<CachedRow>> {
    sqlx::query_as(
        "SELECT candidate_profile_id, rank_score FROM match_recommendations
         WHERE profile_id = $1
           AND ($2::real IS NULL OR rank_score < $2
                OR (rank_score = $2 AND candidate_profile_id > $3))
         ORDER BY rank_score DESC, candidate_profile_id
         LIMIT $4",
    )
    .bind(viewer)
    .bind(after.map(|(score, _)| score))
    .bind(after.map(|(_, id)| id))
    .bind(i64::try_from(limit).unwrap_or(i64::MAX))
    .fetch_all(db)
    .await
}

/// Cached candidates first activated within 7 days, by stored `compat` (home `new_members`).
pub async fn new_member_rows(
    db: &PgPool,
    viewer: Uuid,
    exclude: &[Uuid],
    limit: i64,
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT m.candidate_profile_id FROM match_recommendations m
         JOIN profiles c ON c.id = m.candidate_profile_id
         WHERE m.profile_id = $1 AND c.first_activated_at > now() - interval '7 days'
           AND NOT (m.candidate_profile_id = ANY ($2))
         ORDER BY m.compat DESC, m.rank_score DESC, m.candidate_profile_id
         LIMIT $3",
    )
    .bind(viewer)
    .bind(exclude)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Cached candidates in the viewer's city first, then in the viewer's region, each by
/// `rank_score` (home `nearby`).
pub async fn nearby_rows(
    db: &PgPool,
    viewer: Uuid,
    city_id: Option<i32>,
    region_id: Option<i32>,
    exclude: &[Uuid],
    limit: i64,
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT m.candidate_profile_id FROM match_recommendations m
         JOIN profiles c ON c.id = m.candidate_profile_id
         WHERE m.profile_id = $1 AND (c.city_id = $2 OR c.region_id = $3)
           AND NOT (m.candidate_profile_id = ANY ($4))
         ORDER BY (c.city_id IS NOT DISTINCT FROM $2) DESC, m.rank_score DESC,
                  m.candidate_profile_id
         LIMIT $5",
    )
    .bind(viewer)
    .bind(city_id)
    .bind(region_id)
    .bind(exclude)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Deletes cache rows that failed the read-time checks (10 section 8.6 step 3).
pub async fn delete_recommendations(
    db: &PgPool,
    viewer: Uuid,
    candidates: &[Uuid],
) -> sqlx::Result<()> {
    if candidates.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "DELETE FROM match_recommendations WHERE profile_id = $1 AND candidate_profile_id = ANY ($2)",
    )
    .bind(viewer)
    .bind(candidates)
    .execute(db)
    .await?;
    Ok(())
}

/// Counts a showing of each candidate, under the 6-hour guard of 10 section 8.6 step 5.
pub async fn mark_shown(db: &PgPool, viewer: Uuid, candidates: &[Uuid]) -> sqlx::Result<()> {
    if candidates.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "UPDATE match_recommendations
         SET shown_count = LEAST(shown_count + 1, 32767), last_shown_at = now()
         WHERE profile_id = $1 AND candidate_profile_id = ANY ($2)
           AND (last_shown_at IS NULL OR last_shown_at < now() - interval '6 hours')",
    )
    .bind(viewer)
    .bind(candidates)
    .execute(db)
    .await?;
    Ok(())
}

/// `shown_count` of every cached row (`pool_exhausted` rule 2).
pub async fn shown_counts(db: &PgPool, viewer: Uuid) -> sqlx::Result<Vec<i16>> {
    sqlx::query_scalar("SELECT shown_count FROM match_recommendations WHERE profile_id = $1")
        .bind(viewer)
        .fetch_all(db)
        .await
}

/// `profiles.match_refreshed_at` now.
pub async fn refreshed_at(db: &PgPool, profile_id: Uuid) -> sqlx::Result<Option<OffsetDateTime>> {
    sqlx::query_scalar("SELECT match_refreshed_at FROM profiles WHERE id = $1")
        .bind(profile_id)
        .fetch_one(db)
        .await
}

/// Marks a profile's recommendations stale (10 section 8.2).
pub async fn mark_stale<'e>(db: impl sqlx::PgExecutor<'e>, profile_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("UPDATE profiles SET match_stale = true WHERE id = $1")
        .bind(profile_id)
        .execute(db)
        .await?;
    Ok(())
}

// -------------------------------------------------------------------------------------------
// Profile views (09 section 8)
// -------------------------------------------------------------------------------------------

/// `last_viewed_at` of today's row for (viewer, owner), and the viewer's `profiles_viewed`
/// counter for today.
pub async fn view_state(
    db: &PgPool,
    viewer: Uuid,
    owner: Uuid,
    today: Date,
) -> sqlx::Result<(Option<OffsetDateTime>, i64)> {
    sqlx::query_as(
        "SELECT
           (SELECT last_viewed_at FROM profile_views
             WHERE viewer_profile_id = $1 AND viewed_profile_id = $2 AND viewed_on = $3),
           COALESCE((SELECT count::bigint FROM usage_counters
             WHERE profile_id = $1 AND counter = 'profiles_viewed' AND day = $3), 0)",
    )
    .bind(viewer)
    .bind(owner)
    .bind(today)
    .fetch_one(db)
    .await
}

/// Applies the decision of [`crate::domain::visibility::record_view`] in one transaction.
pub async fn apply_view(
    db: &PgPool,
    viewer: Uuid,
    owner: Uuid,
    today: Date,
    record: ViewRecord,
) -> sqlx::Result<()> {
    match record {
        ViewRecord::Skip | ViewRecord::LimitReached => Ok(()),
        ViewRecord::Insert { is_private } => {
            let mut tx = db.begin().await?;
            let inserted = sqlx::query(
                "INSERT INTO profile_views (viewer_profile_id, viewed_profile_id, viewed_on, is_private)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (viewer_profile_id, viewed_profile_id, viewed_on)
                 DO UPDATE SET last_viewed_at = now(), is_private = EXCLUDED.is_private",
            )
            .bind(viewer)
            .bind(owner)
            .bind(today)
            .bind(is_private)
            .execute(&mut *tx)
            .await?;
            if inserted.rows_affected() > 0 {
                sqlx::query(
                    "INSERT INTO usage_counters (profile_id, counter, day, count)
                     VALUES ($1, 'profiles_viewed', $2, 1)
                     ON CONFLICT (profile_id, counter, day)
                     DO UPDATE SET count = usage_counters.count + 1",
                )
                .bind(viewer)
                .bind(today)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await
        }
        ViewRecord::Update {
            is_private,
            count_again,
        } => {
            sqlx::query(
                "UPDATE profile_views
                 SET last_viewed_at = now(), is_private = $4,
                     view_count = view_count + CASE WHEN $5 THEN 1 ELSE 0 END
                 WHERE viewer_profile_id = $1 AND viewed_profile_id = $2 AND viewed_on = $3",
            )
            .bind(viewer)
            .bind(owner)
            .bind(today)
            .bind(is_private)
            .bind(count_again)
            .execute(db)
            .await?;
            Ok(())
        }
    }
}

/// One visitor (or visited profile) grouped over days.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct VisitRow {
    pub profile_id: Uuid,
    pub last_viewed_at: OffsetDateTime,
    pub view_count: i64,
}

/// Non-private visitors of `owner` in the last `days` days, grouped by viewer, newest first,
/// after the keyset `(last_viewed_at, viewer id)` (09 section 8.3).
pub async fn visitors(
    db: &PgPool,
    owner: Uuid,
    days: i32,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: usize,
) -> sqlx::Result<Vec<VisitRow>> {
    sqlx::query_as(
        "SELECT viewer_profile_id AS profile_id, max(last_viewed_at) AS last_viewed_at,
                sum(view_count)::bigint AS view_count
         FROM profile_views
         WHERE viewed_profile_id = $1 AND NOT is_private
           AND last_viewed_at > now() - make_interval(days => $2)
         GROUP BY viewer_profile_id
         HAVING $3::timestamptz IS NULL OR (max(last_viewed_at), viewer_profile_id) < ($3, $4)
         ORDER BY 2 DESC, 1 DESC
         LIMIT $5",
    )
    .bind(owner)
    .bind(days)
    .bind(after.map(|(at, _)| at))
    .bind(after.map(|(_, id)| id))
    .bind(i64::try_from(limit).unwrap_or(i64::MAX))
    .fetch_all(db)
    .await
}

/// The viewer's own history of the last 30 days, grouped by viewed profile, newest first.
pub async fn visited(
    db: &PgPool,
    viewer: Uuid,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: usize,
) -> sqlx::Result<Vec<VisitRow>> {
    sqlx::query_as(
        "SELECT viewed_profile_id AS profile_id, max(last_viewed_at) AS last_viewed_at,
                sum(view_count)::bigint AS view_count
         FROM profile_views
         WHERE viewer_profile_id = $1 AND last_viewed_at > now() - interval '30 days'
         GROUP BY viewed_profile_id
         HAVING $2::timestamptz IS NULL OR (max(last_viewed_at), viewed_profile_id) < ($2, $3)
         ORDER BY 2 DESC, 1 DESC
         LIMIT $4",
    )
    .bind(viewer)
    .bind(after.map(|(at, _)| at))
    .bind(after.map(|(_, id)| id))
    .bind(i64::try_from(limit).unwrap_or(i64::MAX))
    .fetch_all(db)
    .await
}

// -------------------------------------------------------------------------------------------
// Home (10 section 10)
// -------------------------------------------------------------------------------------------

/// The facts the nudges read (10 section 10.1).
#[derive(Debug, Clone, sqlx::FromRow)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one flag per condition of the nudge table"
)]
pub struct NudgeRow {
    pub has_photo_in_progress_or_approved: bool,
    pub is_id_verified: bool,
    pub has_pending_id_document_request: bool,
    pub about_me_item_met: bool,
    pub has_preferences_row: bool,
    pub has_approved_photo: bool,
    pub is_photo_verified: bool,
    pub has_pending_selfie_request: bool,
    pub has_contact_phone: bool,
    pub completeness: i16,
}

/// Loads the nudge facts of a profile in one query. The `about_me` item follows 08 section
/// 6.1: at least 100 characters and not rejected.
pub async fn nudge_facts(db: &PgPool, profile_id: Uuid) -> sqlx::Result<NudgeRow> {
    sqlx::query_as(
        "SELECT
           EXISTS (SELECT 1 FROM profile_photos ph WHERE ph.profile_id = p.id
                   AND ph.status IN ('approved', 'processing', 'pending_review'))
             AS has_photo_in_progress_or_approved,
           p.is_id_verified,
           EXISTS (SELECT 1 FROM verification_requests v WHERE v.profile_id = p.id
                   AND v.kind = 'id_document' AND v.status = 'pending')
             AS has_pending_id_document_request,
           (char_length(COALESCE(p.about_me, '')) >= 100 AND p.about_me_status <> 'rejected')
             AS about_me_item_met,
           EXISTS (SELECT 1 FROM partner_preferences pp WHERE pp.profile_id = p.id)
             AS has_preferences_row,
           p.has_approved_photo,
           p.is_photo_verified,
           EXISTS (SELECT 1 FROM verification_requests v WHERE v.profile_id = p.id
                   AND v.kind = 'selfie' AND v.status = 'pending')
             AS has_pending_selfie_request,
           EXISTS (SELECT 1 FROM profile_contacts pc WHERE pc.profile_id = p.id
                   AND (pc.phone_e164 IS NOT NULL OR pc.guardian_phone_e164 IS NOT NULL))
             AS has_contact_phone,
           p.completeness
         FROM profiles p WHERE p.id = $1",
    )
    .bind(profile_id)
    .fetch_one(db)
    .await
}

// -------------------------------------------------------------------------------------------
// Saved searches (10 section 9.5)
// -------------------------------------------------------------------------------------------

/// A `saved_searches` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SavedSearchRow {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub name: String,
    pub filters: Value,
    pub notify_new: bool,
    pub last_notified_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

const SAVED_SEARCH_COLUMNS: &str =
    "id, profile_id, name, filters, notify_new, last_notified_at, created_at";

/// The caller's saved searches, newest first.
pub async fn saved_searches(db: &PgPool, profile_id: Uuid) -> sqlx::Result<Vec<SavedSearchRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SAVED_SEARCH_COLUMNS} FROM saved_searches WHERE profile_id = $1
         ORDER BY created_at DESC, id DESC"
    )))
    .bind(profile_id)
    .fetch_all(db)
    .await
}

/// Inserts a saved search unless the profile already has `max`; `Err(count)` when full. The
/// profile row is locked so two concurrent saves cannot pass the limit together.
pub async fn insert_saved_search(
    db: &PgPool,
    profile_id: Uuid,
    name: &str,
    filters: &Value,
    notify_new: bool,
    max: i64,
) -> sqlx::Result<Result<SavedSearchRow, i64>> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM saved_searches WHERE profile_id = $1")
            .bind(profile_id)
            .fetch_one(&mut *tx)
            .await?;
    if count >= max {
        return Ok(Err(count));
    }
    let row: SavedSearchRow = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO saved_searches (id, profile_id, name, filters, notify_new)
         VALUES ($1, $2, $3, $4, $5) RETURNING {SAVED_SEARCH_COLUMNS}"
    )))
    .bind(Uuid::now_v7())
    .bind(profile_id)
    .bind(name)
    .bind(filters)
    .bind(notify_new)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Ok(row))
}

/// Renames a saved search or toggles its notifications. `None` when it is not the caller's.
pub async fn update_saved_search(
    db: &PgPool,
    profile_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    notify_new: Option<bool>,
) -> sqlx::Result<Option<SavedSearchRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "UPDATE saved_searches
         SET name = COALESCE($3, name), notify_new = COALESCE($4, notify_new)
         WHERE id = $2 AND profile_id = $1 RETURNING {SAVED_SEARCH_COLUMNS}"
    )))
    .bind(profile_id)
    .bind(id)
    .bind(name)
    .bind(notify_new)
    .fetch_optional(db)
    .await
}

/// Deletes one of the caller's saved searches. `false` when it is not the caller's.
pub async fn delete_saved_search(db: &PgPool, profile_id: Uuid, id: Uuid) -> sqlx::Result<bool> {
    let result = sqlx::query("DELETE FROM saved_searches WHERE id = $2 AND profile_id = $1")
        .bind(profile_id)
        .bind(id)
        .execute(db)
        .await?;
    Ok(result.rows_affected() == 1)
}

/// How many of these city ids and region ids exist, for filter validation.
pub async fn existing_places(
    db: &PgPool,
    city_ids: &[i32],
    region_ids: &[i32],
) -> sqlx::Result<(i64, i64)> {
    sqlx::query_as(
        "SELECT (SELECT count(*) FROM cities WHERE id = ANY ($1)),
                (SELECT count(*) FROM regions WHERE id = ANY ($2))",
    )
    .bind(city_ids)
    .bind(region_ids)
    .fetch_one(db)
    .await
}
