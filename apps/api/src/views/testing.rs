//! Test helpers for the discovery, relations and job tests: direct row changes for setups
//! the API under test does not offer, and batch-created candidates.

#![allow(clippy::missing_panics_doc)]

use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::options::Gender;
use crate::seed::{FakeProfile, insert};
use crate::test_support::TestApp;

/// `UPDATE <table> SET <assignments> WHERE <key> = $1`, for test setups only.
async fn update(app: &TestApp, table: &str, key: &str, id: Uuid, assignments: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {table} SET {assignments} WHERE {key} = $1"
    )))
    .bind(id)
    .execute(app.db())
    .await
    .expect("the test update runs");
}

/// Changes columns of a profile, for example `"status = 'paused'"`.
pub async fn set_profile(app: &TestApp, profile_id: Uuid, assignments: &str) {
    update(app, "profiles", "id", profile_id, assignments).await;
}

/// Changes privacy settings, for example `"caste_visibility = 'connections'"`.
pub async fn set_privacy(app: &TestApp, profile_id: Uuid, assignments: &str) {
    update(
        app,
        "profile_privacy",
        "profile_id",
        profile_id,
        assignments,
    )
    .await;
}

/// Changes partner preferences (the fixture row has every column at its default).
pub async fn set_prefs(app: &TestApp, profile_id: Uuid, assignments: &str) {
    update(
        app,
        "partner_preferences",
        "profile_id",
        profile_id,
        assignments,
    )
    .await;
}

/// Runs a statement with one profile id bound as `$1`.
pub async fn exec(app: &TestApp, sql: &str, id: Uuid) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned()))
        .bind(id)
        .execute(app.db())
        .await
        .expect("the test statement runs");
}

/// Adds an approved, primary photo with all five variants and marks the profile as having one.
pub async fn add_photo(app: &TestApp, profile_id: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    let base = format!("photos/{profile_id}/{id}");
    sqlx::query(
        "INSERT INTO profile_photos (id, profile_id, status, position, is_primary, upload_key,
             key_large, key_medium, key_thumb, key_blur_medium, key_blur_thumb)
         VALUES ($1, $2, 'approved', 0, true, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(profile_id)
    .bind(format!("tmp/photos/{profile_id}/{id}"))
    .bind(format!("{base}/large.jpg"))
    .bind(format!("{base}/medium.jpg"))
    .bind(format!("{base}/thumb.jpg"))
    .bind(format!("{base}/blur_medium.jpg"))
    .bind(format!("{base}/blur_thumb.jpg"))
    .execute(app.db())
    .await
    .expect("the photo inserts");
    set_profile(app, profile_id, "has_approved_photo = true").await;
    id
}

/// Inserts an interest. Closed statuses get `responded_at = now() - days_ago`.
pub async fn interest(
    app: &TestApp,
    sender: Uuid,
    receiver: Uuid,
    status: &str,
    days_ago: i64,
) -> Uuid {
    let id = Uuid::now_v7();
    let at = OffsetDateTime::now_utc() - time::Duration::days(days_ago);
    let responded = (status != "pending" && status != "expired").then_some(at);
    let expires = if status == "expired" {
        at
    } else {
        at + time::Duration::days(21)
    };
    sqlx::query(
        "INSERT INTO interests (id, sender_profile_id, receiver_profile_id, status, responded_at,
             expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(sender)
    .bind(receiver)
    .bind(status)
    .bind(responded)
    .bind(expires)
    .bind(at)
    .execute(app.db())
    .await
    .expect("the interest inserts");
    id
}

/// Connects two profiles: an accepted interest, an active connection and both member rows.
pub async fn connect(app: &TestApp, a: Uuid, b: Uuid) -> Uuid {
    let interest_id = interest(app, a, b, "accepted", 0).await;
    let (low, high) = crate::lifecycle::ordered_pair(a, b);
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO connections (id, profile_low_id, profile_high_id, interest_id)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(id)
    .bind(low)
    .bind(high)
    .bind(interest_id)
    .execute(app.db())
    .await
    .expect("the connection inserts");
    sqlx::query(
        "INSERT INTO connection_members (connection_id, profile_id) VALUES ($1, $2), ($1, $3)",
    )
    .bind(id)
    .bind(a)
    .bind(b)
    .execute(app.db())
    .await
    .expect("the members insert");
    id
}

/// Inserts a block row directly (without the effects of `PUT /v1/blocks`).
pub async fn block_row(app: &TestApp, by: Uuid, target: Uuid) {
    sqlx::query("INSERT INTO blocks (blocker_profile_id, blocked_profile_id) VALUES ($1, $2)")
        .bind(by)
        .bind(target)
        .execute(app.db())
        .await
        .expect("the block inserts");
}

/// Creates `count` active candidates of a gender in one batch, each shaped by `customise`.
pub async fn candidates(
    app: &TestApp,
    gender: Gender,
    count: usize,
    customise: impl Fn(usize, &mut FakeProfile),
) -> Vec<Uuid> {
    let now = OffsetDateTime::now_utc();
    let profiles: Vec<FakeProfile> = (0..count)
        .map(|index| {
            let mut profile = FakeProfile::basic(gender, index, now);
            customise(index, &mut profile);
            profile
        })
        .collect();
    insert(app.db(), &profiles)
        .await
        .expect("candidates insert")
}

/// The ids of the cards in a JSON list.
pub fn ids(items: &serde_json::Value) -> Vec<Uuid> {
    items.as_array().map_or_default(|items| {
        items
            .iter()
            .filter_map(|item| {
                item["id"]
                    .as_str()
                    .or_else(|| item["profile"]["id"].as_str())
                    .and_then(|id| id.parse().ok())
            })
            .collect()
    })
}
