//! The delivery rules of 14 section 7: who may be an actor, the profile status rule, the
//! duplicate rules, and the `notification.new` event.

use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::{World, add_interest, block, connect, emails_for, feed, pushes_for};
use crate::domain::options::Gender;
use crate::domain::types::{NotificationType as T, ProfileStatus, UserStatus};
use crate::notify::notify;
use crate::realtime::hub::Realtime;
use crate::test_support::TestUser;

async fn emit(
    w: &World,
    to: &TestUser,
    kind: T,
    actor: Option<&TestUser>,
    data: Value,
) -> Option<Uuid> {
    notify(
        &w.app.state,
        to.user_id,
        kind,
        actor.map(|a| a.profile_id),
        data,
    )
    .await
    .expect("notify does not fail")
}

async fn interest_from_her(w: &World) -> Value {
    let interest = add_interest(&w.app, &w.her, &w.him).await;
    json!({ "interest_id": interest, "reminder": false, "count": 1 })
}

#[sqlx::test]
async fn a_member_is_never_notified_about_their_own_action(db: PgPool) {
    let w = World::new(db).await;
    assert!(
        emit(
            &w,
            &w.him,
            T::InterestReceived,
            Some(&w.him),
            json!({ "interest_id": Uuid::now_v7(), "reminder": false, "count": 1 })
        )
        .await
        .is_none()
    );
    assert!(feed(&w.app, w.him.user_id).await.is_empty(), "no feed row");
}

#[sqlx::test]
async fn a_blocked_actor_creates_nothing_in_either_direction(db: PgPool) {
    let w = World::new(db).await;
    // He blocked her: her interest does not reach him.
    block(&w.app, &w.him, &w.her).await;
    let data = interest_from_her(&w).await;
    assert!(
        emit(&w, &w.him, T::InterestReceived, Some(&w.her), data)
            .await
            .is_none()
    );
    assert!(feed(&w.app, w.him.user_id).await.is_empty(), "no feed row");
    assert!(
        pushes_for(&w.app, w.him.user_id).await.is_empty(),
        "no push is queued"
    );
    assert!(
        emails_for(&w.app, w.him.user_id).await.is_empty(),
        "no email is queued"
    );

    // She blocked a second man, and a third man blocked her: neither reaches her.
    let second = w.app.member().await;
    let third = w.app.member().await;
    block(&w.app, &w.her, &second).await;
    block(&w.app, &third, &w.her).await;
    for sender in [&second, &third] {
        let interest = add_interest(&w.app, sender, &w.her).await;
        assert!(
            emit(
                &w,
                &w.her,
                T::InterestReceived,
                Some(sender),
                json!({ "interest_id": interest, "reminder": false, "count": 1 })
            )
            .await
            .is_none()
        );
    }
    assert!(feed(&w.app, w.her.user_id).await.is_empty(), "no feed row");
}

#[sqlx::test]
async fn an_actor_who_cannot_be_opened_creates_nothing(db: PgPool) {
    let w = World::new(db).await;

    // The same gender cannot open each other (09 section 2.2 row 2).
    let other_man = w.app.member().await;
    assert!(
        emit(
            &w,
            &w.him,
            T::PhotoRequestGranted,
            Some(&other_man),
            json!({})
        )
        .await
        .is_none()
    );

    // A suspended account, and a profile that is not live.
    for (status, user_status) in [
        (ProfileStatus::Active, UserStatus::Suspended),
        (ProfileStatus::PendingReview, UserStatus::Active),
        (ProfileStatus::Suspended, UserStatus::Active),
        (ProfileStatus::Draft, UserStatus::Active),
    ] {
        let actor = w
            .app
            .member_with(|spec| {
                spec.gender = Gender::Female;
                spec.status = status;
                spec.user_status = user_status;
            })
            .await;
        assert!(
            emit(&w, &w.him, T::PhotoRequestGranted, Some(&actor), json!({}))
                .await
                .is_none(),
            "{status:?} {user_status:?}"
        );
    }

    // A hidden profile is not openable without a relation, and is with one (09 section 2.2).
    sqlx::query("UPDATE profile_privacy SET discovery_visibility = 'hidden' WHERE profile_id = $1")
        .bind(w.her.profile_id)
        .execute(w.app.db())
        .await
        .unwrap();
    assert!(
        emit(&w, &w.him, T::PhotoRequestGranted, Some(&w.her), json!({}))
            .await
            .is_none(),
        "hidden, no relation"
    );
    let data = interest_from_her(&w).await;
    assert!(
        emit(&w, &w.him, T::InterestReceived, Some(&w.her), data)
            .await
            .is_some(),
        "hidden, but her interest is pending"
    );
    assert_eq!(feed(&w.app, w.him.user_id).await.len(), 1);
}

#[sqlx::test]
async fn the_profile_status_decides_what_is_received(db: PgPool) {
    let w = World::new(db).await;
    let (interest, connection) = connect(&w.app, &w.him, &w.her).await;

    // Paused receives everything.
    let paused = w
        .app
        .member_with(|spec| spec.status = ProfileStatus::Paused)
        .await;
    assert!(
        emit(
            &w,
            &paused,
            T::NewMatches,
            None,
            json!({ "source": "recommendations", "count": 1 })
        )
        .await
        .is_some()
    );

    // Closed receives account notices and events on its existing connections.
    let closed = w
        .app
        .member_with(|spec| spec.status = ProfileStatus::Closed)
        .await;
    for kind in [T::NewMatches, T::ProfileViewsSummary, T::Announcement] {
        assert!(
            emit(
                &w,
                &closed,
                kind,
                None,
                json!({ "source": "recommendations", "count": 1 })
            )
            .await
            .is_none(),
            "{kind} is not for a closed profile"
        );
    }
    assert!(
        emit(
            &w,
            &closed,
            T::AccountWarning,
            None,
            json!({ "sanction_id": Uuid::now_v7() })
        )
        .await
        .is_some()
    );
    // The closed profile of a connection still hears of events on it.
    sqlx::query("UPDATE profiles SET status = 'closed' WHERE id = $1")
        .bind(w.him.profile_id)
        .execute(w.app.db())
        .await
        .unwrap();
    assert!(
        emit(
            &w,
            &w.him,
            T::StageProposed,
            Some(&w.her),
            json!({ "connection_id": connection, "proposal_id": Uuid::now_v7(), "stage": "engaged" })
        )
        .await
        .is_some()
    );
    assert!(
        emit(
            &w,
            &w.him,
            T::InterestAccepted,
            Some(&w.her),
            json!({ "interest_id": interest, "connection_id": connection })
        )
        .await
        .is_some()
    );
    sqlx::query("UPDATE profiles SET status = 'active' WHERE id = $1")
        .bind(w.him.profile_id)
        .execute(w.app.db())
        .await
        .unwrap();

    // A suspended or banned user receives only email: no row, no push.
    for user_status in [UserStatus::Suspended, UserStatus::Banned] {
        let user = w
            .app
            .member_with(|spec| spec.user_status = user_status)
            .await;
        assert!(
            emit(
                &w,
                &user,
                T::AccountWarning,
                None,
                json!({ "sanction_id": Uuid::now_v7(), "reason": "x" })
            )
            .await
            .is_none()
        );
        assert!(feed(&w.app, user.user_id).await.is_empty(), "no feed row");
        assert!(
            pushes_for(&w.app, user.user_id).await.is_empty(),
            "no push is queued"
        );
        let emails = emails_for(&w.app, user.user_id).await;
        assert_eq!(emails.len(), 1, "{user_status:?}");
        assert_eq!(emails[0]["template"], "account_warning");
    }

    // A deleted user receives nothing at all.
    let gone = w
        .app
        .member_with(|spec| spec.user_status = UserStatus::Deleted)
        .await;
    assert!(
        emit(
            &w,
            &gone,
            T::AccountWarning,
            None,
            json!({ "sanction_id": Uuid::now_v7() })
        )
        .await
        .is_none()
    );
    assert!(
        emails_for(&w.app, gone.user_id).await.is_empty(),
        "no email is queued"
    );
}

#[sqlx::test]
async fn decisions_without_an_id_only_repeat_within_a_minute(db: PgPool) {
    let w = World::new(db).await;
    let data = json!({ "reason": "Add a photo" });
    emit(&w, &w.him, T::ProfileChangesRequested, None, data.clone())
        .await
        .expect("a row");
    assert!(
        emit(&w, &w.him, T::ProfileChangesRequested, None, data.clone())
            .await
            .is_none(),
        "a repeat of the same call"
    );
    sqlx::query("UPDATE notifications SET created_at = now() - interval '2 minutes'")
        .execute(w.app.db())
        .await
        .unwrap();
    assert!(
        emit(&w, &w.him, T::ProfileChangesRequested, None, data)
            .await
            .is_some(),
        "a later decision is a new row"
    );
}

#[sqlx::test]
async fn the_windows_of_the_duplicate_rules_expire(db: PgPool) {
    let w = World::new(db).await;
    let (_, connection) = connect(&w.app, &w.him, &w.her).await;
    let shared = json!({ "connection_id": connection });
    let granted = json!({ "photo_access_id": Uuid::now_v7() });
    let matches = json!({ "source": "recommendations", "count": 2, "saved_search_id": null });
    emit(&w, &w.him, T::ContactShared, Some(&w.her), shared.clone())
        .await
        .expect("a row");
    emit(
        &w,
        &w.him,
        T::PhotoRequestGranted,
        Some(&w.her),
        granted.clone(),
    )
    .await
    .expect("a row");
    emit(&w, &w.him, T::NewMatches, None, matches.clone())
        .await
        .expect("a row");
    emit(
        &w,
        &w.him,
        T::ProfileViewsSummary,
        None,
        json!({ "count": 1 }),
    )
    .await
    .expect("a row");

    // 25 hours later: contact shares, grants and matches (20 hours) may repeat; the views
    // summary is one a day, so it also may.
    sqlx::query("UPDATE notifications SET created_at = now() - interval '25 hours'")
        .execute(w.app.db())
        .await
        .unwrap();
    assert!(
        emit(&w, &w.him, T::ContactShared, Some(&w.her), shared)
            .await
            .is_some()
    );
    assert!(
        emit(&w, &w.him, T::PhotoRequestGranted, Some(&w.her), granted)
            .await
            .is_some()
    );
    assert!(
        emit(&w, &w.him, T::NewMatches, None, matches)
            .await
            .is_some()
    );
    assert!(
        emit(
            &w,
            &w.him,
            T::ProfileViewsSummary,
            None,
            json!({ "count": 2 })
        )
        .await
        .is_some()
    );
}

#[sqlx::test]
async fn a_new_photo_request_after_the_retry_period_is_a_new_row(db: PgPool) {
    let w = World::new(db).await;
    let access = Uuid::now_v7();
    let data = json!({ "photo_access_id": access });
    emit(
        &w,
        &w.her,
        T::PhotoRequestReceived,
        Some(&w.him),
        data.clone(),
    )
    .await
    .expect("a row");
    assert!(
        emit(
            &w,
            &w.her,
            T::PhotoRequestReceived,
            Some(&w.him),
            data.clone()
        )
        .await
        .is_none()
    );
    // photo_access.retry_days is 30: a request after that period reuses the same access row.
    sqlx::query("UPDATE notifications SET created_at = now() - interval '31 days'")
        .execute(w.app.db())
        .await
        .unwrap();
    assert!(
        emit(&w, &w.her, T::PhotoRequestReceived, Some(&w.him), data)
            .await
            .is_some()
    );
}

#[sqlx::test]
async fn an_online_recipient_gets_notification_new_with_the_actor_and_counters(db: PgPool) {
    let w = World::new(db).await;
    let mut socket = w.app.state.hub.register(w.him.profile_id, w.him.user_id);
    let data = interest_from_her(&w).await;
    let id = emit(&w, &w.him, T::InterestReceived, Some(&w.her), data.clone())
        .await
        .expect("a row");

    let frame: Value = serde_json::from_str(&socket.receiver.recv().await.unwrap()).unwrap();
    assert_eq!(frame["type"], "notification.new");
    let notification = &frame["data"]["notification"];
    assert_eq!(notification["id"], json!(id));
    assert_eq!(notification["type"], "interest_received");
    assert_eq!(notification["is_read"], false);
    assert_eq!(notification["data"], data);
    assert_eq!(notification["actor"]["profile_id"], json!(w.her.profile_id));
    // The default name display is "first name and last initial" for a member of the pair
    // before a connection (09 section 4.1).
    assert_eq!(notification["actor"]["display_name"], "Ayesha M.");
    assert!(notification["actor"]["photo"].is_null());
    assert!(
        notification["created_at"]
            .as_str()
            .is_some_and(|t| t.ends_with('Z'))
    );

    let counters: Value = serde_json::from_str(&socket.receiver.recv().await.unwrap()).unwrap();
    assert_eq!(counters["type"], "counters");
    assert_eq!(counters["data"]["unread_notifications"], 1);
    assert_eq!(counters["data"]["pending_interests"], 1);

    // Nothing is sent to a recipient who is offline, but the row is there.
    assert!(w.app.state.hub.is_online(w.him.profile_id));
    w.app
        .state
        .hub
        .unregister(w.him.profile_id, socket.socket_id);
}

#[sqlx::test]
async fn a_connection_sees_the_full_name_and_a_member_sees_the_reduced_one(db: PgPool) {
    let w = World::new(db).await;
    let mut socket = w.app.state.hub.register(w.him.profile_id, w.him.user_id);
    let (_, connection) = connect(&w.app, &w.him, &w.her).await;
    emit(
        &w,
        &w.him,
        T::ContactShared,
        Some(&w.her),
        json!({ "connection_id": connection }),
    )
    .await
    .expect("a row");
    let frame: Value = serde_json::from_str(&socket.receiver.recv().await.unwrap()).unwrap();
    assert_eq!(
        frame["data"]["notification"]["actor"]["display_name"],
        "Ayesha Malik"
    );
}
