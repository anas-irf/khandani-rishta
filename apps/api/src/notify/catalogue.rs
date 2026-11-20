//! The event catalogue of 14 section 2 as code: which events push and which send an email,
//! with the preference column, the Android channel, the fixed text, the collapse key and the
//! time to live of each push (14 section 4.2), and the email template, dedupe key and time of
//! each email (14 section 5).

use serde_json::{Map, Value, json};
use time::macros::time;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::db::notifications::PrefsRow;
use crate::domain::time::{KARACHI, karachi_date};
use crate::domain::types::NotificationType;

/// The title of every push: the app name (14 section 4.2).
pub const APP_NAME: &str = "Khandani Rishta";

const DAY: u32 = 86_400;
const THREE_DAYS: u32 = 3 * DAY;

/// The `push_*` preference column that switches a push off (14 section 6.1). Account notices
/// have none: they are always delivered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushPref {
    Interests,
    Messages,
    PhotoRequests,
    ProfileViews,
    Matches,
}

impl PushPref {
    pub fn allows(self, prefs: &PrefsRow) -> bool {
        match self {
            Self::Interests => prefs.push_interests,
            Self::Messages => prefs.push_messages,
            Self::PhotoRequests => prefs.push_photo_requests,
            Self::ProfileViews => prefs.push_profile_views,
            Self::Matches => prefs.push_matches,
        }
    }
}

/// The preference of a push `type` (a `notifications.type` value, or `message` for chat).
pub fn push_pref(push_type: &str) -> Option<PushPref> {
    match push_type {
        "interest_received" | "interest_accepted" => Some(PushPref::Interests),
        "message" | "contact_shared" | "stage_proposed" | "stage_confirmed" => {
            Some(PushPref::Messages)
        }
        "photo_request_received" | "photo_request_granted" => Some(PushPref::PhotoRequests),
        "profile_views_summary" => Some(PushPref::ProfileViews),
        "new_matches" => Some(PushPref::Matches),
        _ => None,
    }
}

/// Whether the event has a push at all (the "Push" column of 14 section 2). Approved photos
/// only appear in the feed.
pub fn pushes(kind: NotificationType) -> bool {
    kind != NotificationType::PhotoApproved
}

/// Reads a string value out of a JSON object.
fn text<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    data.get(key).and_then(Value::as_str)
}

/// Renders a JSON scalar as the string FCM needs. Anything else is not sent.
fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

/// The FCM `data` map of a feed notification (14 section 4.1): only the allowed keys, all
/// values strings, never a name, a photo, a reason or a text. The caller adds `sent_at`, the
/// time of the event.
pub fn push_data(
    kind: NotificationType,
    actor_profile_id: Option<Uuid>,
    data: &Value,
    notification_id: Uuid,
) -> Map<String, Value> {
    use NotificationType as T;

    let mut map = Map::new();
    let mut put = |key: &str, value: Option<String>| {
        if let Some(value) = value {
            map.insert(key.to_owned(), Value::String(value));
        }
    };
    let from_data = |key: &str| data.get(key).and_then(scalar);
    let actor = actor_profile_id.map(|id| id.to_string());

    put("type", Some(kind.as_str().to_owned()));
    put("notification_id", Some(notification_id.to_string()));
    match kind {
        T::InterestReceived if data.get("reminder").and_then(Value::as_bool) == Some(true) => {
            put("target", Some("APP-INTERESTS".to_owned()));
            put("count", from_data("count"));
        }
        T::InterestReceived => {
            put("target", Some("APP-PROFILE".to_owned()));
            put("profile_id", actor);
            put("interest_id", from_data("interest_id"));
            put("count", from_data("count"));
        }
        T::InterestAccepted => {
            put("target", Some("APP-CHAT".to_owned()));
            put("connection_id", from_data("connection_id"));
            put("interest_id", from_data("interest_id"));
        }
        T::PhotoRequestReceived => put("target", Some("APP-PHOTO-REQUESTS".to_owned())),
        T::PhotoRequestGranted => {
            put("target", Some("APP-PROFILE".to_owned()));
            put("profile_id", actor);
        }
        T::ContactShared => {
            put("target", Some("APP-CONNECTION".to_owned()));
            put("connection_id", from_data("connection_id"));
        }
        T::StageProposed | T::StageConfirmed => {
            put("target", Some("APP-CONNECTION".to_owned()));
            put("connection_id", from_data("connection_id"));
            put("stage", from_data("stage"));
        }
        T::ProfileApproved => put("target", Some("APP-HOME".to_owned())),
        T::ProfileChangesRequested => put("target", Some("GATE-CHANGES".to_owned())),
        T::PhotoApproved | T::PhotoRejected => put("target", Some("ME-PHOTOS".to_owned())),
        T::TextRejected => {
            let field = text(data, "field");
            let target = if field == Some("partner_notes") {
                "ME-PREFS"
            } else {
                "ME-EDIT"
            };
            put("target", Some(target.to_owned()));
            put("field", field.map(str::to_owned));
        }
        T::VerificationApproved | T::VerificationRejected => {
            put("target", Some("ME-VERIFY".to_owned()));
        }
        T::NewMatches if text(data, "source") == Some("saved_search") => {
            put("target", Some("APP-SEARCH".to_owned()));
            put("saved_search_id", from_data("saved_search_id"));
            put("count", from_data("count"));
        }
        T::NewMatches => {
            put("target", Some("APP-MATCHES".to_owned()));
            put("count", from_data("count"));
        }
        T::ProfileViewsSummary => {
            put("target", Some("APP-VISITORS".to_owned()));
            put("count", from_data("count"));
        }
        T::AccountWarning => put("target", Some("PUB-GUIDELINES".to_owned())),
        // The announcement text and its link are never sent in a push (14 section 4.1 rule 3).
        T::Announcement => put("target", Some(String::new())),
    }
    map
}

/// The fixed texts and delivery settings of one push (14 section 4.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushContent {
    /// Android notification channel id.
    pub channel: &'static str,
    /// The fixed English body the app also has in its resources.
    pub body: &'static str,
    pub collapse_key: String,
    pub ttl_seconds: u32,
}

/// How the collapse key of a push is made (14 section 4.2).
#[derive(Debug, Clone, Copy)]
enum Collapse {
    /// The same key for every push of the type.
    Fixed(&'static str),
    /// A prefix and the connection id: `msg_<connection_id>`.
    PerConnection(&'static str),
}

/// One row of the table of 14 section 4.2: push type, channel, body, collapse key, time to live.
type Row = (&'static str, &'static str, &'static str, Collapse, u32);

/// Every push that exists, in the order of 14 section 4.2. The interest reminder is the row
/// of `interest_received` with `reminder` (see [`content`]).
const CONTENT: [Row; 19] = [
    (
        "message",
        "messages",
        "You have a new message",
        Collapse::PerConnection("msg"),
        DAY,
    ),
    (
        "interest_received",
        "interests",
        "You have received a new interest",
        Collapse::Fixed("interest"),
        THREE_DAYS,
    ),
    (
        "interest_accepted",
        "interests",
        "Your interest was accepted",
        Collapse::PerConnection("accepted"),
        THREE_DAYS,
    ),
    (
        "photo_request_received",
        "activity",
        "A member asked to see your photos",
        Collapse::Fixed("photo_request"),
        THREE_DAYS,
    ),
    (
        "photo_request_granted",
        "activity",
        "A member shared their photos with you",
        Collapse::Fixed("photo_granted"),
        THREE_DAYS,
    ),
    (
        "contact_shared",
        "activity",
        "A connection shared contact details with you",
        Collapse::PerConnection("contact"),
        THREE_DAYS,
    ),
    (
        "stage_proposed",
        "activity",
        "A connection suggested the next step",
        Collapse::PerConnection("stage"),
        THREE_DAYS,
    ),
    (
        "stage_confirmed",
        "activity",
        "Your suggestion was confirmed",
        Collapse::PerConnection("stage"),
        THREE_DAYS,
    ),
    (
        "new_matches",
        "activity",
        "You have new matches",
        Collapse::Fixed("matches"),
        DAY,
    ),
    (
        "profile_views_summary",
        "activity",
        "People viewed your profile today",
        Collapse::Fixed("views"),
        DAY,
    ),
    (
        "profile_approved",
        "account",
        "Your profile is live",
        Collapse::Fixed("account"),
        THREE_DAYS,
    ),
    (
        "profile_changes_requested",
        "account",
        "Your profile needs a few changes",
        Collapse::Fixed("account"),
        THREE_DAYS,
    ),
    (
        "photo_rejected",
        "account",
        "A photo was not approved",
        Collapse::Fixed("account_photo"),
        THREE_DAYS,
    ),
    (
        "text_rejected",
        "account",
        "Part of your profile text was not approved",
        Collapse::Fixed("account_text"),
        THREE_DAYS,
    ),
    (
        "verification_approved",
        "account",
        "Your verification was approved",
        Collapse::Fixed("account_verify"),
        THREE_DAYS,
    ),
    (
        "verification_rejected",
        "account",
        "Your verification was not approved",
        Collapse::Fixed("account_verify"),
        THREE_DAYS,
    ),
    (
        "account_warning",
        "account",
        "Important notice about your account",
        Collapse::Fixed("account_warning"),
        THREE_DAYS,
    ),
    (
        "announcement",
        "account",
        "News from Khandani Rishta",
        Collapse::Fixed("announcement"),
        DAY,
    ),
    // The reminder of an interest that is about to expire.
    (
        "interest_reminder",
        "interests",
        "An interest is waiting for your answer",
        Collapse::Fixed("interest_reminder"),
        DAY,
    ),
];

/// The content of a push by its `type` and its `data` map, or `None` for a type that has no
/// push. A push with `target = APP-INTERESTS` is the interest reminder.
pub fn content(push_type: &str, data: &Value) -> Option<PushContent> {
    let reminder =
        push_type == "interest_received" && text(data, "target") == Some("APP-INTERESTS");
    let wanted = if reminder {
        "interest_reminder"
    } else {
        push_type
    };
    let (_, channel, body, collapse, ttl_seconds) =
        CONTENT.iter().find(|row| row.0 == wanted).copied()?;
    let collapse_key = match collapse {
        Collapse::Fixed(key) => key.to_owned(),
        Collapse::PerConnection(prefix) => {
            format!(
                "{prefix}_{}",
                text(data, "connection_id").unwrap_or_default()
            )
        }
    };
    Some(PushContent {
        channel,
        body,
        collapse_key,
        ttl_seconds,
    })
}

/// The `send_push` payload of 19 section 2.1.
pub fn push_payload(user_id: Uuid, push_type: &str, data: &Map<String, Value>) -> Value {
    let content = content(push_type, &Value::Object(data.clone()));
    json!({
        "user_id": user_id,
        "type": push_type,
        "data": data,
        "collapse_key": content.as_ref().map(|c| c.collapse_key.clone()),
        "ttl_seconds": content.as_ref().map(|c| c.ttl_seconds),
    })
}

/// The `email_*` preference that switches an email off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailPref {
    Interests,
    Announcements,
}

impl EmailPref {
    pub fn allows(self, prefs: &PrefsRow) -> bool {
        match self {
            Self::Interests => prefs.email_interests,
            Self::Announcements => prefs.email_announcements,
        }
    }
}

/// One email an event sends (14 section 5.3).
#[derive(Debug, Clone, PartialEq)]
pub struct EmailPlan {
    pub template: &'static str,
    pub data: Value,
    pub pref: Option<EmailPref>,
    pub dedupe_key: Option<String>,
    /// `None`: now.
    pub run_at: Option<OffsetDateTime>,
}

impl EmailPlan {
    fn now(template: &'static str, data: Value) -> Self {
        Self {
            template,
            data,
            pref: None,
            dedupe_key: None,
            run_at: None,
        }
    }
}

/// The next 18:00 in `Asia/Karachi` strictly after `now`: when the interest digest goes out
/// (14 section 5.4).
pub fn next_digest_time(now: OffsetDateTime) -> OffsetDateTime {
    let today = karachi_date(now)
        .with_time(time!(18:00))
        .assume_offset(KARACHI);
    let at = if today > now {
        today
    } else {
        today + Duration::days(1)
    };
    at.to_offset(time::UtcOffset::UTC)
}

/// The email of an event, or `None` when the catalogue has none (14 section 2, "Email").
pub fn email_plan(
    kind: NotificationType,
    recipient_user_id: Uuid,
    actor_profile_id: Option<Uuid>,
    data: &Value,
    now: OffsetDateTime,
) -> Option<EmailPlan> {
    use NotificationType as T;

    let from_data = |key: &str| data.get(key).cloned().unwrap_or(Value::Null);
    match kind {
        // Event 1: the daily digest. The reminder (event 2) has no email.
        T::InterestReceived if data.get("reminder").and_then(Value::as_bool) != Some(true) => {
            Some(EmailPlan {
                template: "interest_digest",
                data: json!({}),
                pref: Some(EmailPref::Interests),
                dedupe_key: Some(format!("interest_digest:{recipient_user_id}")),
                run_at: Some(next_digest_time(now)),
            })
        }
        T::InterestAccepted => Some(EmailPlan {
            pref: Some(EmailPref::Interests),
            dedupe_key: text(data, "interest_id").map(|id| format!("interest_accepted:{id}")),
            ..EmailPlan::now(
                "interest_accepted",
                json!({
                    "actor_profile_id": actor_profile_id,
                    "connection_id": from_data("connection_id"),
                }),
            )
        }),
        T::ProfileApproved => Some(EmailPlan {
            dedupe_key: Some(format!("welcome:{recipient_user_id}")),
            ..EmailPlan::now("welcome", json!({}))
        }),
        T::ProfileChangesRequested => Some(EmailPlan::now(
            "profile_changes_requested",
            json!({ "reason": from_data("reason") }),
        )),
        T::VerificationApproved | T::VerificationRejected => Some(EmailPlan::now(
            "verification_result",
            json!({
                "kind": from_data("kind"),
                "result": if kind == T::VerificationApproved { "approved" } else { "rejected" },
                "rejection_reason": from_data("rejection_reason"),
            }),
        )),
        T::AccountWarning => Some(EmailPlan::now(
            "account_warning",
            json!({ "reason": from_data("reason") }),
        )),
        T::Announcement => Some(EmailPlan {
            pref: Some(EmailPref::Announcements),
            ..EmailPlan::now(
                "announcement",
                json!({
                    "text_en": from_data("text_en"),
                    "text_ur": from_data("text_ur"),
                    "url": from_data("url"),
                }),
            )
        }),
        _ => None,
    }
}

/// Types a `closed` profile still receives: account notices and events on its existing
/// connections (14 section 7.3 rule 5). Everything else is created only for `active`,
/// `paused` and unfinished profiles.
pub fn closed_profile_receives(kind: NotificationType) -> bool {
    use NotificationType as T;
    matches!(
        kind,
        T::InterestAccepted
            | T::ContactShared
            | T::StageProposed
            | T::StageConfirmed
            | T::ProfileApproved
            | T::ProfileChangesRequested
            | T::PhotoApproved
            | T::PhotoRejected
            | T::TextRejected
            | T::VerificationApproved
            | T::VerificationRejected
            | T::AccountWarning
    )
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    #[test]
    fn the_digest_goes_out_at_the_next_1800_in_karachi() {
        // 12:00 in Karachi is 07:00 UTC: the digest is today at 13:00 UTC.
        assert_eq!(
            next_digest_time(datetime!(2026-11-20 07:00 UTC)),
            datetime!(2026-11-20 13:00 UTC)
        );
        // Exactly 18:00 and later: the next day.
        assert_eq!(
            next_digest_time(datetime!(2026-11-20 13:00 UTC)),
            datetime!(2026-11-21 13:00 UTC)
        );
        // 23:30 UTC is 04:30 the next day in Karachi.
        assert_eq!(
            next_digest_time(datetime!(2026-11-20 23:30 UTC)),
            datetime!(2026-11-21 13:00 UTC)
        );
    }

    #[test]
    fn push_data_has_only_allowed_keys_and_string_values() {
        let allowed = [
            "type",
            "target",
            "notification_id",
            "connection_id",
            "interest_id",
            "profile_id",
            "saved_search_id",
            "field",
            "count",
            "stage",
            "sent_at",
        ];
        let id = Uuid::now_v7();
        let actor = Uuid::now_v7();
        let data = json!({
            "interest_id": Uuid::now_v7(), "connection_id": Uuid::now_v7(), "reminder": false,
            "count": 3, "stage": "engaged", "field": "about_me", "source": "saved_search",
            "saved_search_id": Uuid::now_v7(), "saved_search_name": "Lahore doctors",
            "reason": "A private moderator note", "note": "secret", "text_en": "News",
        });
        for kind in NotificationType::ALL {
            let map = push_data(*kind, Some(actor), &data, id);
            for (key, value) in &map {
                assert!(allowed.contains(&key.as_str()), "{kind}: key {key}");
                assert!(value.is_string(), "{kind}: {key} is not a string");
            }
            let all = Value::Object(map).to_string();
            for secret in ["private moderator", "secret", "Lahore", "News"] {
                assert!(!all.contains(secret), "{kind} leaks {secret}");
            }
        }
    }

    #[test]
    fn reminders_and_chat_have_their_own_tags() {
        let reminder = push_data(
            NotificationType::InterestReceived,
            None,
            &json!({ "reminder": true, "count": 3 }),
            Uuid::now_v7(),
        );
        assert_eq!(reminder["target"], "APP-INTERESTS");
        let c = content("interest_received", &Value::Object(reminder)).unwrap();
        assert_eq!(c.collapse_key, "interest_reminder");
        assert_eq!(c.ttl_seconds, 86_400);

        let message = content("message", &json!({ "connection_id": "abc" })).unwrap();
        assert_eq!(message.collapse_key, "msg_abc");
        assert_eq!(message.channel, "messages");
        assert!(content("photo_approved", &json!({})).is_none());
    }

    #[test]
    fn every_pushing_type_has_content() {
        for kind in NotificationType::ALL {
            assert_eq!(
                content(kind.as_str(), &json!({})).is_some(),
                pushes(*kind),
                "{kind}"
            );
        }
    }
}
