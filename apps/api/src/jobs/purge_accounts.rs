//! The `purge_accounts` job (19 section 2.10, 06 section 9.4, 04 section 12).
//!
//! Accounts are scrubbed, not removed, so other members' chat history and the moderation records
//! keep valid foreign keys. Each user is purged in its own transaction; a failure on one user is
//! logged and does not stop the others.

use serde_json::json;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue};
use crate::lifecycle;
use crate::realtime::hub::{Realtime, close_code};
use crate::state::AppState;

/// Users purged per run (19 section 2.10).
const BATCH: i64 = 20;

/// Rows owned by the profile through one column: step 1 of 04 section 12.
const OWNED_BY_PROFILE: &[(&str, &str)] = &[
    ("profile_family", "profile_id"),
    ("profile_contacts", "profile_id"),
    ("profile_identity", "profile_id"),
    ("profile_languages", "profile_id"),
    ("profile_hobbies", "profile_id"),
    ("partner_preferences", "profile_id"),
    ("profile_privacy", "profile_id"),
    ("profile_photos", "profile_id"),
    ("verification_requests", "profile_id"),
    ("saved_searches", "profile_id"),
    ("usage_counters", "profile_id"),
];

/// Rows that point at the profile from either side: step 1 of 04 section 12.
const BOTH_DIRECTIONS: &[(&str, &str, &str)] = &[
    ("photo_access", "owner_profile_id", "viewer_profile_id"),
    ("shortlists", "profile_id", "target_profile_id"),
    ("passes", "profile_id", "target_profile_id"),
    ("blocks", "blocker_profile_id", "blocked_profile_id"),
    ("profile_views", "viewer_profile_id", "viewed_profile_id"),
    (
        "match_recommendations",
        "profile_id",
        "candidate_profile_id",
    ),
];

pub async fn run(state: &AppState, _job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let due: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users
         WHERE status IN ('deletion_scheduled', 'banned', 'suspended') AND purge_after <= now()
         ORDER BY purge_after, id LIMIT $1",
    )
    .bind(BATCH)
    .fetch_all(&state.db)
    .await?;

    let mut purged = 0_usize;
    let mut failed = 0_usize;
    for user_id in &due {
        match purge_user(state, *user_id).await {
            Ok(true) => purged += 1,
            Ok(false) => {}
            Err(error) => {
                failed += 1;
                tracing::error!(%user_id, error = %format!("{error:#}"), "account purge failed");
            }
        }
    }

    // A full batch means more may be waiting: continue with a new job (no dedupe key).
    if i64::try_from(due.len()).is_ok_and(|count| count == BATCH) && purged > 0 {
        enqueue(&state.db, NewJob::new("purge_accounts", json!({}))).await?;
        state.jobs.wake();
    }
    if failed > 0 {
        anyhow::bail!("{failed} account(s) could not be purged");
    }
    Ok(JobOutcome::Done)
}

/// Purges one user. Returns false when the user was no longer due (another run took it, or the
/// deletion was cancelled meanwhile).
#[allow(clippy::too_many_lines)] // Steps 1 to 6 of 04 section 12, in order.
async fn purge_user(state: &AppState, user_id: Uuid) -> anyhow::Result<bool> {
    let mut tx = state.db.begin().await?;
    crate::sanctions::lock_profile_of(&mut tx, user_id).await?;
    let row: Option<(String, Uuid)> = sqlx::query_as(
        "SELECT u.clerk_user_id, p.id
         FROM users u JOIN profiles p ON p.user_id = u.id
         WHERE u.id = $1 AND u.status IN ('deletion_scheduled', 'banned', 'suspended')
           AND u.purge_after <= now()
         FOR UPDATE OF u SKIP LOCKED",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((clerk_user_id, profile_id)) = row else {
        return Ok(false);
    };

    // Step 1: rows owned by the profile.
    for (table, column) in OWNED_BY_PROFILE {
        delete_where(&mut tx, table, &[*column], profile_id).await?;
    }
    for (table, first, second) in BOTH_DIRECTIONS {
        delete_where(&mut tx, table, &[*first, *second], profile_id).await?;
    }

    // Step 2: the profile row keeps its id, owner, code, gender and timestamps.
    sqlx::query(
        "UPDATE profiles SET
             status = 'deleted', status_reason = NULL,
             managed_by = NULL, manager_name = NULL, first_name = NULL, last_name = NULL,
             date_of_birth = NULL, marital_status = NULL, children_status = NULL,
             children_count = NULL, current_wives_count = NULL, height_cm = NULL, weight_kg = NULL,
             complexion = NULL, body_type = NULL, blood_group = NULL, disability = NULL,
             disability_details = NULL, religion_code = NULL, sect_code = NULL, caste_code = NULL,
             sub_caste_code = NULL, caste_other = NULL, sub_caste_other = NULL,
             mother_tongue_code = NULL, nationality_code = NULL, country_code = NULL,
             region_id = NULL, city_id = NULL, city_other = NULL, area = NULL,
             residency_status = NULL, origin_city_id = NULL, origin_other = NULL,
             relocation = NULL, education_level_code = NULL, education_field_code = NULL,
             degree_title = NULL, institute_name = NULL, employment_type = NULL,
             profession_code = NULL, job_title = NULL, employer_name = NULL,
             income_band_code = NULL, religiosity = NULL, prayer_frequency = NULL, hijab = NULL,
             beard = NULL, religious_education = NULL, smoking = NULL, living_arrangement = NULL,
             work_after_marriage = NULL, marriage_timeline = NULL, jahez_stance = NULL,
             about_me = NULL, about_me_status = 'approved',
             completeness = 0, has_approved_photo = false, is_phone_verified = false,
             is_photo_verified = false, is_id_verified = false, match_stale = false
         WHERE id = $1",
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;

    // Step 3: end the connections and remove the member's messages.
    let ended = lifecycle::end_all_connections(&mut tx, profile_id, "account_closed").await?;
    sqlx::query(
        "UPDATE messages SET deleted_at = COALESCE(deleted_at, now()), body = NULL
         WHERE sender_profile_id = $1",
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;

    // Step 4: pending interests in both directions expire. The text of the interests the member
    // sent is a message they wrote, so it goes with the other messages (06 section 9.5).
    let expired = lifecycle::expire_pending_interests(&mut tx, profile_id).await?;
    sqlx::query("UPDATE interests SET message = NULL WHERE sender_profile_id = $1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;

    // Step 5: the user's feed, preferences, devices and exports.
    for table in [
        "notifications",
        "notification_preferences",
        "user_devices",
        "data_exports",
    ] {
        delete_where(&mut tx, table, &["user_id"], user_id).await?;
    }

    // Step 6: the account row. The unique `clerk_user_id` is replaced by a placeholder.
    sqlx::query(
        "UPDATE users
         SET status = 'deleted', deleted_at = now(), email = NULL, phone_e164 = NULL,
             email_verified = false, phone_verified = false, status_reason = NULL,
             suspended_until = NULL, clerk_user_id = 'deleted:' || id::text
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // Step 7 (after the data is gone): the login and the stored files. The jobs are enqueued in
    // the same transaction, so a crash cannot leave a purged account with a login or files.
    enqueue(
        &mut *tx,
        NewJob::new(
            "delete_clerk_user",
            json!({ "clerk_user_id": clerk_user_id }),
        )
        .dedupe(clerk_user_id.clone()),
    )
    .await?;
    for prefix in [
        format!("photos/{profile_id}/"),
        format!("tmp/photos/{profile_id}/"),
        format!("verification/{profile_id}/"),
        format!("exports/{user_id}/"),
    ] {
        enqueue(
            &mut *tx,
            NewJob::new("delete_objects", json!({ "prefix": prefix })),
        )
        .await?;
    }
    tx.commit().await?;

    state.accounts.invalidate(user_id);
    state.hub.close_user(user_id, close_code::NOT_ALLOWED);
    for (sender, receiver) in expired {
        let other = if sender == profile_id {
            receiver
        } else {
            sender
        };
        crate::db::counters::push(state, other).await;
    }
    for connection in ended {
        let other = if connection.profile_low_id == profile_id {
            connection.profile_high_id
        } else {
            connection.profile_low_id
        };
        crate::models::connections::publish_updated_to(state, connection.connection_id, other)
            .await;
        crate::db::counters::push(state, other).await;
    }
    state.jobs.wake();
    tracing::info!(event = "account.purged", %user_id, "account purged");
    Ok(true)
}

/// `DELETE FROM table WHERE column = id` for each column. The names come from the constant
/// lists above, never from input.
async fn delete_where(
    tx: &mut PgConnection,
    table: &str,
    columns: &[&str],
    id: Uuid,
) -> sqlx::Result<()> {
    for column in columns {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE {column} = $1"
        )))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use sqlx::PgPool;
    use uuid::Uuid;

    use crate::domain::options::Gender;
    use crate::test_support::{TestApp, TestUser};

    /// Gives a member rows in every table that 04 section 12 step 1 and 5 name.
    async fn fill_every_table(app: &TestApp, member: &TestUser, other: &TestUser) {
        let db = app.db();
        let profile = member.profile_id;
        let user = member.user_id;
        let number_hash = app.state.crypto.keyed_hash("pk_id", "3520212345671");
        for statement in [
            "INSERT INTO profile_family (profile_id, father_status, about_family) VALUES ($1, 'alive', 'A family text')",
            "INSERT INTO profile_contacts (profile_id, phone_e164, contact_email) VALUES ($1, '+923001234567', 'me@example.com')",
            "INSERT INTO profile_languages (profile_id, language_code) VALUES ($1, 'urdu')",
            "UPDATE profiles SET about_me = 'Hello there', area = 'Gulberg', job_title = 'Engineer', first_name = 'Ahmed', last_name = 'Khan', caste_other = 'Rajput', date_of_birth = '1998-01-01', status_reason = 'note' WHERE id = $1",
            "INSERT INTO saved_searches (profile_id, name, filters) VALUES ($1, 'Lahore', '{}')",
            "INSERT INTO usage_counters (profile_id, counter, day, count) VALUES ($1, 'interests_sent', current_date, 2)",
            "INSERT INTO profile_photos (profile_id, status, upload_key, key_large) VALUES ($1, 'approved', 'tmp/x', 'photos/p/large.jpg')",
            "INSERT INTO verification_requests (profile_id, kind, status, front_key) VALUES ($1, 'id_document', 'pending', 'verification/p/front')",
        ] {
            sqlx::query(statement)
                .bind(profile)
                .execute(db)
                .await
                .unwrap();
        }
        sqlx::query(
            "INSERT INTO profile_identity (profile_id, document_type, number_encrypted, number_hash, number_last4)
             VALUES ($1, 'cnic', $2, $3, '5671')",
        )
        .bind(profile)
        .bind(app.state.crypto.encrypt_identity(profile, "3520212345671"))
        .bind(number_hash)
        .execute(db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO profile_hobbies (profile_id, hobby_code) SELECT $1::uuid, code FROM hobbies LIMIT 1")
            .bind(profile)
            .execute(db)
            .await
            .unwrap();
        for (owner, viewer) in [(profile, other.profile_id), (other.profile_id, profile)] {
            sqlx::query("INSERT INTO photo_access (owner_profile_id, viewer_profile_id, status) VALUES ($1, $2, 'pending')")
                .bind(owner).bind(viewer).execute(db).await.unwrap();
            sqlx::query(
                "INSERT INTO shortlists (profile_id, target_profile_id, note) VALUES ($1, $2, 'n')",
            )
            .bind(owner)
            .bind(viewer)
            .execute(db)
            .await
            .unwrap();
            sqlx::query("INSERT INTO passes (profile_id, target_profile_id, expires_at) VALUES ($1, $2, now() + interval '1 day')")
                .bind(owner).bind(viewer).execute(db).await.unwrap();
            sqlx::query(
                "INSERT INTO blocks (blocker_profile_id, blocked_profile_id) VALUES ($1, $2)",
            )
            .bind(owner)
            .bind(viewer)
            .execute(db)
            .await
            .unwrap();
            sqlx::query("INSERT INTO profile_views (viewer_profile_id, viewed_profile_id, viewed_on) VALUES ($1, $2, current_date)")
                .bind(owner).bind(viewer).execute(db).await.unwrap();
            sqlx::query("INSERT INTO match_recommendations (profile_id, candidate_profile_id, compat, rank_score) VALUES ($1, $2, 80, 0.5)")
                .bind(owner).bind(viewer).execute(db).await.unwrap();
        }
        sqlx::query(
            "INSERT INTO notifications (user_id, type, data) VALUES ($1, 'profile_approved', '{}')",
        )
        .bind(user)
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_devices (user_id, platform, push_token) VALUES ($1, 'android', $2)",
        )
        .bind(user)
        .bind(format!("token-{}", Uuid::now_v7()))
        .execute(db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO data_exports (user_id, status, file_key) VALUES ($1, 'ready', 'exports/x.json')")
            .bind(user).execute(db).await.unwrap();
    }

    async fn count(db: &PgPool, sql: &str, id: Uuid) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
            .bind(id)
            .fetch_one(db)
            .await
            .unwrap()
    }

    /// T-506: with the grace period over, the purge leaves no personal data in any table of
    /// 04 section 12.
    #[sqlx::test]
    async fn a_purged_account_leaves_no_personal_data(db: PgPool) {
        let app = TestApp::new(db).await;
        let member = app.member().await;
        let other = app.member_of(Gender::Female).await;
        fill_every_table(&app, &member, &other).await;

        // An active connection with chat, an interest with a message, a report and a sanction.
        let (low, high) = crate::lifecycle::ordered_pair(member.profile_id, other.profile_id);
        let interest_id: Uuid = sqlx::query_scalar(
            "INSERT INTO interests (sender_profile_id, receiver_profile_id, status, message, expires_at)
             VALUES ($1, $2, 'accepted', 'Salam, I like your profile', now() + interval '1 day') RETURNING id",
        )
        .bind(member.profile_id).bind(other.profile_id).fetch_one(app.db()).await.unwrap();
        let connection_id: Uuid = sqlx::query_scalar(
            "INSERT INTO connections (profile_low_id, profile_high_id, interest_id) VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(low).bind(high).bind(interest_id).fetch_one(app.db()).await.unwrap();
        let sent = Uuid::now_v7();
        let received = Uuid::now_v7();
        for (id, sender, body) in [
            (sent, member.profile_id, "my words"),
            (received, other.profile_id, "their words"),
        ] {
            sqlx::query("INSERT INTO messages (id, connection_id, sender_profile_id, body) VALUES ($1, $2, $3, $4)")
                .bind(id).bind(connection_id).bind(sender).bind(body).execute(app.db()).await.unwrap();
        }
        let pending_from_other: Uuid = sqlx::query_scalar(
            "INSERT INTO interests (sender_profile_id, receiver_profile_id, expires_at)
             SELECT $2::uuid, $1::uuid, now() + interval '1 day' RETURNING id",
        )
        .bind(member.profile_id)
        .bind(other.profile_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        sqlx::query("INSERT INTO reports (reporter_profile_id, target_profile_id, subject_type, reason) VALUES ($1, $2, 'profile', 'other')")
            .bind(other.profile_id).bind(member.profile_id).execute(app.db()).await.unwrap();
        sqlx::query(
            "INSERT INTO sanctions (user_id, type, reason) VALUES ($1, 'warning', 'Be polite')",
        )
        .bind(member.user_id)
        .execute(app.db())
        .await
        .unwrap();

        // The grace period is over. Zero days means the purge date is now.
        sqlx::query("UPDATE users SET status = 'deletion_scheduled', deletion_requested_at = now() - interval '31 days', purge_after = now() - interval '1 minute' WHERE id = $1")
            .bind(member.user_id).execute(app.db()).await.unwrap();
        let clerk_user_id = member.clerk_user_id.clone();
        sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('purge_accounts', '{}')")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;

        // Step 1 and 5: every table is empty for the member, both directions.
        for table in [
            "profile_family",
            "profile_contacts",
            "profile_identity",
            "profile_languages",
            "profile_hobbies",
            "partner_preferences",
            "profile_privacy",
            "profile_photos",
            "verification_requests",
            "saved_searches",
            "usage_counters",
        ] {
            let n = count(
                app.db(),
                &format!("SELECT count(*) FROM {table} WHERE profile_id = $1"),
                member.profile_id,
            )
            .await;
            assert_eq!(n, 0, "{table} still has rows");
        }
        for (table, a, b) in [
            ("photo_access", "owner_profile_id", "viewer_profile_id"),
            ("shortlists", "profile_id", "target_profile_id"),
            ("passes", "profile_id", "target_profile_id"),
            ("blocks", "blocker_profile_id", "blocked_profile_id"),
            ("profile_views", "viewer_profile_id", "viewed_profile_id"),
            (
                "match_recommendations",
                "profile_id",
                "candidate_profile_id",
            ),
        ] {
            let n = count(
                app.db(),
                &format!("SELECT count(*) FROM {table} WHERE {a} = $1 OR {b} = $1"),
                member.profile_id,
            )
            .await;
            assert_eq!(n, 0, "{table} still has rows in one direction");
        }
        for table in [
            "notifications",
            "notification_preferences",
            "user_devices",
            "data_exports",
        ] {
            let n = count(
                app.db(),
                &format!("SELECT count(*) FROM {table} WHERE user_id = $1"),
                member.user_id,
            )
            .await;
            assert_eq!(n, 0, "{table} still has rows");
        }

        // Step 2: the profile row is a tombstone: every personal column is null.
        let profile: Value = sqlx::query_scalar("SELECT to_jsonb(p) FROM profiles p WHERE id = $1")
            .bind(member.profile_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(profile["status"], "deleted");
        assert_eq!(profile["gender"], "male", "gender is kept");
        assert!(profile["public_code"].is_string());
        for (column, value) in profile.as_object().unwrap() {
            let kept = [
                "id",
                "user_id",
                "public_code",
                "status",
                "gender",
                "about_me_status",
                "onboarding_step",
                "completeness",
                "has_approved_photo",
                "is_phone_verified",
                "is_photo_verified",
                "is_id_verified",
                "match_stale",
                "created_at",
                "updated_at",
                "onboarding_completed_at",
                "first_activated_at",
                "paused_at",
                "closed_at",
                "closed_reason",
                "last_active_at",
                "match_refreshed_at",
            ];
            if !kept.contains(&column.as_str()) {
                assert!(value.is_null(), "profiles.{column} still holds {value}");
            }
        }
        assert_eq!(profile["has_approved_photo"], false);

        // Step 3: connections end, the member's messages are removed, the other's stay.
        let (status, reason): (String, Option<String>) =
            sqlx::query_as("SELECT status, ended_reason FROM connections WHERE id = $1")
                .bind(connection_id)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(
            (status.as_str(), reason.as_deref()),
            ("ended", Some("account_closed"))
        );
        let mine: (Option<String>, bool) =
            sqlx::query_as("SELECT body, deleted_at IS NOT NULL FROM messages WHERE id = $1")
                .bind(sent)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(mine, (None, true));
        let theirs: (Option<String>, bool) =
            sqlx::query_as("SELECT body, deleted_at IS NOT NULL FROM messages WHERE id = $1")
                .bind(received)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(theirs, (Some("their words".to_owned()), false));

        // Step 4: pending interests expire and the member's own text is gone.
        let status: String = sqlx::query_scalar("SELECT status FROM interests WHERE id = $1")
            .bind(pending_from_other)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(status, "expired");
        let message: Option<String> =
            sqlx::query_scalar("SELECT message FROM interests WHERE id = $1")
                .bind(interest_id)
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(message, None);

        // Step 6: the user row.
        let user: Value = sqlx::query_scalar("SELECT to_jsonb(u) FROM users u WHERE id = $1")
            .bind(member.user_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(user["status"], "deleted");
        assert!(
            user["email"].is_null()
                && user["phone_e164"].is_null()
                && user["status_reason"].is_null()
        );
        assert!(user["deleted_at"].is_string());
        assert_eq!(user["clerk_user_id"], format!("deleted:{}", member.user_id));

        // Kept for the records (04 section 12 step 5).
        assert!(
            count(
                app.db(),
                "SELECT count(*) FROM user_consents WHERE user_id = $1",
                member.user_id
            )
            .await
                > 0
        );
        assert_eq!(
            count(
                app.db(),
                "SELECT count(*) FROM sanctions WHERE user_id = $1",
                member.user_id
            )
            .await,
            1
        );
        assert_eq!(
            count(
                app.db(),
                "SELECT count(*) FROM reports WHERE target_profile_id = $1",
                member.profile_id
            )
            .await,
            1
        );

        // Step 7: the login and the files go through jobs (run by the drain above), and the
        // snapshot is gone.
        assert_eq!(
            app.clerk.calls(),
            vec![format!("delete_user:{clerk_user_id}")]
        );
        let mut prefixes: Vec<String> = sqlx::query_scalar(
            "SELECT payload ->> 'prefix' FROM jobs WHERE kind = 'delete_objects'",
        )
        .fetch_all(app.db())
        .await
        .unwrap();
        prefixes.sort();
        let mut expected = vec![
            format!("exports/{}/", member.user_id),
            format!("photos/{}/", member.profile_id),
            format!("tmp/photos/{}/", member.profile_id),
            format!("verification/{}/", member.profile_id),
        ];
        expected.sort();
        assert_eq!(prefixes, expected);
    }

    /// Only due accounts are purged, twenty at a time, and the job continues by itself.
    #[sqlx::test]
    async fn the_purge_takes_only_due_accounts_in_batches_of_twenty(db: PgPool) {
        let app = TestApp::new(db).await;
        let mut due = Vec::new();
        for _ in 0..21 {
            due.push(app.draft_user().await.user_id);
        }
        sqlx::query(
            "UPDATE users SET status = 'deletion_scheduled',
                 deletion_requested_at = now() - interval '40 days', purge_after = now() - interval '10 days'
             WHERE id = ANY($1)",
        )
        .bind(&due)
        .execute(app.db())
        .await
        .unwrap();
        let later = app.member().await;
        sqlx::query(
            "UPDATE users SET status = 'deletion_scheduled', deletion_requested_at = now(),
                 purge_after = now() + interval '5 days' WHERE id = $1",
        )
        .bind(later.user_id)
        .execute(app.db())
        .await
        .unwrap();
        let staying = app.member().await;

        sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('purge_accounts', '{}')")
            .execute(app.db())
            .await
            .unwrap();
        app.drain_jobs().await;

        let deleted: i64 =
            sqlx::query_scalar("SELECT count(*) FROM users WHERE status = 'deleted'")
                .fetch_one(app.db())
                .await
                .unwrap();
        assert_eq!(deleted, 21);
        let runs: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM jobs WHERE kind = 'purge_accounts' AND status = 'succeeded'",
        )
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(
            runs, 2,
            "20 accounts, then the job continued for the last one"
        );
        let pending: (String, String) = sqlx::query_as(
            "SELECT u.status, p.status FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(later.user_id)
        .fetch_one(app.db())
        .await
        .unwrap();
        assert_eq!(
            pending,
            ("deletion_scheduled".to_owned(), "active".to_owned())
        );
        let untouched: String = sqlx::query_scalar("SELECT status FROM users WHERE id = $1")
            .bind(staying.user_id)
            .fetch_one(app.db())
            .await
            .unwrap();
        assert_eq!(untouched, "active");
        assert_eq!(
            app.clerk
                .calls()
                .iter()
                .filter(|call| call.starts_with("delete_user:"))
                .count(),
            21,
            "every purged login is removed through delete_clerk_user"
        );
    }
}
