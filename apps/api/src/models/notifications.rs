//! API types for notifications, notification preferences and push devices (15 sections 6
//! and 14).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::macros::format_description;
use time::{OffsetDateTime, Time};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::options::EmailMatchDigest;
use crate::domain::types::{DevicePlatform, NotificationType};
use crate::error::{ApiError, FieldCode, FieldErrors};

/// The actor's photo is the shared `PhotoView` (15 section 14).
pub use crate::views::types::PhotoView as ActorPhoto;

/// Who caused a notification, rendered for the recipient (09 section 4, 14 section 3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct NotificationActor {
    pub profile_id: Uuid,
    /// Reduced according to the actor's `name_display` and the relation (09 section 4.1).
    pub display_name: String,
    pub photo: Option<ActorPhoto>,
}

/// One row of the feed, also the body of the `notification.new` event (15 section 14).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Notification {
    pub id: Uuid,
    /// A `notifications.type` value.
    #[serde(rename = "type")]
    pub kind: NotificationType,
    /// `null` for system notifications.
    pub actor: Option<NotificationActor>,
    /// Shape per type, see 14 section 3.
    #[schema(value_type = Object)]
    pub data: Value,
    pub is_read: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Body of `POST /v1/notifications/read`: `{ "ids": [...] }` or `{ "all": true }`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReadBody {
    pub ids: Option<Vec<Uuid>>,
    pub all: Option<bool>,
}

/// Most ids one `POST /v1/notifications/read` call may carry (a feed page is at most 50 rows).
pub const MAX_READ_IDS: usize = 200;

/// What a validated read request asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadTarget {
    All,
    Ids(Vec<Uuid>),
}

impl ReadBody {
    /// `all: true` wins over `ids`. Neither given is a validation error on `ids`.
    pub fn target(self) -> Result<ReadTarget, ApiError> {
        if self.all == Some(true) {
            return Ok(ReadTarget::All);
        }
        let Some(ids) = self.ids else {
            return Err(ApiError::field("ids", FieldCode::Required));
        };
        if ids.len() > MAX_READ_IDS {
            return Err(ApiError::field("ids", FieldCode::TooLong));
        }
        Ok(ReadTarget::Ids(ids))
    }
}

/// `notification_preferences` without the key and timestamps (15 section 6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch per column of notification_preferences (14 section 6.1)"
)]
pub struct NotificationPreferences {
    pub push_interests: bool,
    pub push_messages: bool,
    pub push_photo_requests: bool,
    pub push_profile_views: bool,
    pub push_matches: bool,
    pub email_interests: bool,
    pub email_messages: bool,
    pub email_match_digest: EmailMatchDigest,
    pub email_announcements: bool,
    /// Local time in `users.timezone`, `HH:MM`. Both quiet hours are set or both are `null`.
    #[schema(example = "22:00")]
    pub quiet_hours_start: Option<String>,
    #[schema(example = "07:00")]
    pub quiet_hours_end: Option<String>,
}

/// Body of `PUT /v1/me/notification-preferences`: the complete object (16 section 6.26).
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PreferencesBody {
    pub push_interests: Option<bool>,
    pub push_messages: Option<bool>,
    pub push_photo_requests: Option<bool>,
    pub push_profile_views: Option<bool>,
    pub push_matches: Option<bool>,
    pub email_interests: Option<bool>,
    pub email_messages: Option<bool>,
    #[schema(value_type = Option<EmailMatchDigest>)]
    pub email_match_digest: Option<String>,
    pub email_announcements: Option<bool>,
    #[schema(example = "22:00")]
    pub quiet_hours_start: Option<String>,
    #[schema(example = "07:00")]
    pub quiet_hours_end: Option<String>,
}

/// `HH:MM`, the form the API sends quiet hours in.
pub fn format_clock(time: Time) -> String {
    time.format(format_description!("[hour]:[minute]"))
        .unwrap_or_default()
}

/// Parses `HH:MM` or `HH:MM:SS`.
pub fn parse_clock(text: &str) -> Option<Time> {
    Time::parse(text, format_description!("[hour]:[minute]"))
        .or_else(|_| Time::parse(text, format_description!("[hour]:[minute]:[second]")))
        .ok()
}

/// A validated `PUT` body, ready to store.
#[derive(Debug, Clone, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch per column of notification_preferences (14 section 6.1)"
)]
pub struct ValidPreferences {
    pub push_interests: bool,
    pub push_messages: bool,
    pub push_photo_requests: bool,
    pub push_profile_views: bool,
    pub push_matches: bool,
    pub email_interests: bool,
    pub email_messages: bool,
    pub email_match_digest: EmailMatchDigest,
    pub email_announcements: bool,
    pub quiet_hours: Option<(Time, Time)>,
}

impl PreferencesBody {
    /// Every switch is required (the call replaces the whole object). The quiet hours are both
    /// set or both `null` (14 section 6.2 rule 1): when only one is given, the missing one gets
    /// `required`.
    pub fn validate(self) -> Result<ValidPreferences, ApiError> {
        let mut errors = FieldErrors::new();
        let mut flag = |name: &'static str, value: Option<bool>| {
            value.unwrap_or_else(|| {
                errors.add(name, FieldCode::Required);
                false
            })
        };
        let push_interests = flag("push_interests", self.push_interests);
        let push_messages = flag("push_messages", self.push_messages);
        let push_photo_requests = flag("push_photo_requests", self.push_photo_requests);
        let push_profile_views = flag("push_profile_views", self.push_profile_views);
        let push_matches = flag("push_matches", self.push_matches);
        let email_interests = flag("email_interests", self.email_interests);
        let email_messages = flag("email_messages", self.email_messages);
        let email_announcements = flag("email_announcements", self.email_announcements);

        let email_match_digest = match self.email_match_digest.as_deref() {
            None => {
                errors.add("email_match_digest", FieldCode::Required);
                EmailMatchDigest::Off
            }
            Some(code) => EmailMatchDigest::parse(code).unwrap_or_else(|| {
                errors.add("email_match_digest", FieldCode::UnknownCode);
                EmailMatchDigest::Off
            }),
        };

        let mut clock = |name: &'static str, value: Option<&str>| -> Option<Time> {
            let parsed = parse_clock(value?);
            if parsed.is_none() {
                errors.add(name, FieldCode::Invalid);
            }
            parsed
        };
        let start = clock("quiet_hours_start", self.quiet_hours_start.as_deref());
        let end = clock("quiet_hours_end", self.quiet_hours_end.as_deref());
        let quiet_hours = match (&self.quiet_hours_start, &self.quiet_hours_end) {
            (None, None) => None,
            (Some(_), None) => {
                errors.add("quiet_hours_end", FieldCode::Required);
                None
            }
            (None, Some(_)) => {
                errors.add("quiet_hours_start", FieldCode::Required);
                None
            }
            (Some(_), Some(_)) => start.zip(end),
        };
        errors.finish()?;
        Ok(ValidPreferences {
            push_interests,
            push_messages,
            push_photo_requests,
            push_profile_views,
            push_matches,
            email_interests,
            email_messages,
            email_match_digest,
            email_announcements,
            quiet_hours,
        })
    }
}

/// Body of `POST /v1/me/devices`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DeviceBody {
    pub platform: DevicePlatform,
    pub push_token: String,
    pub app_version: Option<String>,
    pub device_model: Option<String>,
}

/// Longest push token accepted (FCM tokens are about 160 characters).
pub const MAX_PUSH_TOKEN_LEN: usize = 1024;
const MAX_APP_VERSION_LEN: usize = 50;
const MAX_DEVICE_MODEL_LEN: usize = 100;

/// A validated device registration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidDevice {
    pub platform: DevicePlatform,
    pub push_token: String,
    pub app_version: Option<String>,
    pub device_model: Option<String>,
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

impl DeviceBody {
    pub fn validate(self) -> Result<ValidDevice, ApiError> {
        let mut errors = FieldErrors::new();
        let push_token = self.push_token.trim().to_owned();
        if push_token.is_empty() {
            errors.add("push_token", FieldCode::Required);
        } else if push_token.chars().count() > MAX_PUSH_TOKEN_LEN
            || push_token.chars().any(char::is_whitespace)
        {
            errors.add("push_token", FieldCode::Invalid);
        }
        let app_version = trimmed(self.app_version);
        if app_version
            .as_deref()
            .is_some_and(|text| text.chars().count() > MAX_APP_VERSION_LEN)
        {
            errors.add("app_version", FieldCode::TooLong);
        }
        let device_model = trimmed(self.device_model);
        if device_model
            .as_deref()
            .is_some_and(|text| text.chars().count() > MAX_DEVICE_MODEL_LEN)
        {
            errors.add("device_model", FieldCode::TooLong);
        }
        errors.finish()?;
        Ok(ValidDevice {
            platform: self.platform,
            push_token,
            app_version,
            device_model,
        })
    }
}

#[cfg(test)]
mod tests {
    use time::macros::time;

    use super::*;

    fn full_body() -> PreferencesBody {
        PreferencesBody {
            push_interests: Some(true),
            push_messages: Some(true),
            push_photo_requests: Some(true),
            push_profile_views: Some(false),
            push_matches: Some(true),
            email_interests: Some(true),
            email_messages: Some(false),
            email_match_digest: Some("weekly".to_owned()),
            email_announcements: Some(true),
            quiet_hours_start: None,
            quiet_hours_end: None,
        }
    }

    fn errors_of(body: PreferencesBody) -> Vec<String> {
        match body.validate() {
            Err(ApiError::Validation(fields)) => fields
                .into_iter()
                .map(|f| {
                    let code = serde_json::to_value(f.code).unwrap();
                    format!("{}:{}", f.field, code.as_str().unwrap())
                })
                .collect(),
            other => panic!("expected a validation error, got {other:?}"),
        }
    }

    #[test]
    fn clocks_round_trip() {
        assert_eq!(parse_clock("22:00"), Some(time!(22:00)));
        assert_eq!(parse_clock("07:30:00"), Some(time!(07:30)));
        assert_eq!(parse_clock("25:00"), None);
        assert_eq!(parse_clock("7"), None);
        assert_eq!(format_clock(time!(07:05)), "07:05");
    }

    #[test]
    fn a_complete_body_is_valid() {
        let valid = full_body().validate().unwrap();
        assert_eq!(valid.email_match_digest, EmailMatchDigest::Weekly);
        assert_eq!(valid.quiet_hours, None);

        let mut body = full_body();
        body.quiet_hours_start = Some("23:00".to_owned());
        body.quiet_hours_end = Some("07:00".to_owned());
        assert_eq!(
            body.validate().unwrap().quiet_hours,
            Some((time!(23:00), time!(07:00)))
        );
    }

    #[test]
    fn quiet_hours_are_both_set_or_both_null() {
        let mut body = full_body();
        body.quiet_hours_start = Some("23:00".to_owned());
        assert_eq!(errors_of(body), ["quiet_hours_end:required"]);

        let mut body = full_body();
        body.quiet_hours_end = Some("07:00".to_owned());
        assert_eq!(errors_of(body), ["quiet_hours_start:required"]);

        let mut body = full_body();
        body.quiet_hours_start = Some("late".to_owned());
        body.quiet_hours_end = Some("07:00".to_owned());
        assert_eq!(errors_of(body), ["quiet_hours_start:invalid"]);
    }

    #[test]
    fn missing_switches_and_unknown_digest_codes_are_reported() {
        let mut body = full_body();
        body.push_matches = None;
        body.email_match_digest = Some("monthly".to_owned());
        assert_eq!(
            errors_of(body),
            ["push_matches:required", "email_match_digest:unknown_code"]
        );
    }

    #[test]
    fn read_bodies_need_ids_or_all() {
        let id = Uuid::now_v7();
        let body = ReadBody {
            ids: Some(vec![id]),
            all: None,
        };
        assert_eq!(body.target().unwrap(), ReadTarget::Ids(vec![id]));
        let body = ReadBody {
            ids: None,
            all: Some(true),
        };
        assert_eq!(body.target().unwrap(), ReadTarget::All);
        let body = ReadBody {
            ids: None,
            all: Some(false),
        };
        assert!(body.target().is_err());
        let body = ReadBody {
            ids: Some(vec![id; MAX_READ_IDS + 1]),
            all: None,
        };
        assert!(body.target().is_err());
    }

    #[test]
    fn devices_are_trimmed_and_limited() {
        let valid = DeviceBody {
            platform: DevicePlatform::Android,
            push_token: " abc123 ".to_owned(),
            app_version: Some("  ".to_owned()),
            device_model: Some("Pixel 8".to_owned()),
        }
        .validate()
        .unwrap();
        assert_eq!(valid.push_token, "abc123");
        assert_eq!(valid.app_version, None);
        assert_eq!(valid.device_model.as_deref(), Some("Pixel 8"));

        let too_long = DeviceBody {
            platform: DevicePlatform::Web,
            push_token: "x".repeat(MAX_PUSH_TOKEN_LEN + 1),
            app_version: None,
            device_model: None,
        };
        assert!(too_long.validate().is_err());
        let empty = DeviceBody {
            platform: DevicePlatform::Web,
            push_token: "  ".to_owned(),
            app_version: None,
            device_model: None,
        };
        assert!(empty.validate().is_err());
    }
}
