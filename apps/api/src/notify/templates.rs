//! Email templates (14 section 5.3): subject, HTML and text, in English.
//!
//! The emails are plain and mobile friendly, carry no photos and no chat content, and end with
//! the support address (14 section 5.1). Optional kinds also link to the notification settings
//! (14 section 5.5).
//!
//! Every value that a member or a moderator typed (names, reasons, announcement text) is HTML
//! escaped before it enters the HTML part. Links are built from `WEB_BASE_URL`; the only link
//! that comes from outside is an announcement link, which must be an `http` or `https` URL.
//!
//! # Data per template
//!
//! The `data` of the `send_email` job (19 section 2.7) is read leniently: a missing key gives
//! a generic sentence, never a failure.
//!
//! | Template | `data` keys |
//! |---|---|
//! | `account_suspended` | `form` (`suspended`, `banned` or `active_again`), `reason`, `suspended_until` |
//! | `account_warning` | `reason` |
//! | `account_deletion` | `form` (`scheduled` or `cancelled`), `purge_after` |
//! | `export_ready` | none |
//! | `profile_changes_requested` | `reason` |
//! | `verification_result` | `kind` (`id_document` or `selfie`), `result` (`approved` or `rejected`), `rejection_reason` |
//! | `welcome` | none |
//! | `interest_accepted` | `actor_profile_id`, `connection_id` (the name is added at send time) |
//! | `interest_digest`, `unread_messages` | none (counted at send time) |
//! | `match_digest` | `candidate_ids` (the matches are loaded at send time) |
//! | `announcement` | `text_en`, `url` |
//!
//! Dates are Unix seconds, RFC 3339 text or `YYYY-MM-DD`.

use std::fmt::Write as _;

use serde_json::Value;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::time::karachi_date;
use crate::reference::options;

/// Where links point and who to write to.
#[derive(Debug, Clone, Copy)]
pub struct Context<'a> {
    /// `WEB_BASE_URL`, without a trailing slash.
    pub web_base_url: &'a str,
    /// The `support.email` setting.
    pub support_email: &'a str,
}

/// One member in a digest (14 section 5.3): display name rendered for the recipient, age, city
/// and, for matches, the match percentage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberLine {
    pub display_name: String,
    pub age: Option<i32>,
    pub city: Option<String>,
    pub compat: Option<i16>,
}

/// Values the job loads at send time.
#[derive(Debug, Clone, Default)]
pub struct Facts {
    /// The display name of the member who accepted (`interest_accepted`).
    pub actor_name: Option<String>,
    /// Up to 5 members for the digests.
    pub members: Vec<MemberLine>,
    /// The number of new interests, or of chats with unread messages.
    pub count: i64,
}

/// A rendered email.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    pub subject: String,
    pub html: String,
    pub text: String,
}

/// Escapes text for HTML, in element content and in quoted attributes.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

/// Collapses whitespace and control characters to single spaces: for subjects and names.
fn single_line(text: &str) -> String {
    text.split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// A piece of the message body. The strings are raw text; escaping happens when rendering.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Block {
    Paragraph(String),
    /// A quoted line, for a reason a moderator typed.
    Quote(String),
    Items(Vec<String>),
    Button {
        label: String,
        url: String,
    },
}

struct Message {
    subject: String,
    blocks: Vec<Block>,
    /// Adds the "Change email preferences" link (optional kinds only).
    preferences_link: bool,
}

const BODY_STYLE: &str = "margin:0;padding:0;background:#f5f5f4;";
const CARD_STYLE: &str = "max-width:520px;margin:0 auto;padding:24px;background:#ffffff;\
     font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1c1917;";
const BUTTON_STYLE: &str = "display:inline-block;padding:12px 20px;background:#0f766e;\
     color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;";

impl Message {
    fn new(subject: impl AsRef<str>) -> Self {
        Self {
            subject: single_line(subject.as_ref()),
            blocks: Vec::new(),
            preferences_link: false,
        }
    }

    fn paragraph(mut self, text: impl Into<String>) -> Self {
        self.blocks.push(Block::Paragraph(text.into()));
        self
    }

    fn quote(mut self, text: impl Into<String>) -> Self {
        self.blocks.push(Block::Quote(text.into()));
        self
    }

    fn items(mut self, items: Vec<String>) -> Self {
        if !items.is_empty() {
            self.blocks.push(Block::Items(items));
        }
        self
    }

    fn button(mut self, label: impl Into<String>, url: impl Into<String>) -> Self {
        self.blocks.push(Block::Button {
            label: label.into(),
            url: url.into(),
        });
        self
    }

    fn optional(mut self) -> Self {
        self.preferences_link = true;
        self
    }

    fn render(self, ctx: &Context<'_>) -> Rendered {
        let mut html = format!(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
             <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
             <title>{}</title></head><body style=\"{BODY_STYLE}\">\
             <div style=\"{CARD_STYLE}\">",
            escape(&self.subject)
        );
        let mut text = String::new();
        // Writing to a `String` cannot fail.
        for block in &self.blocks {
            match block {
                Block::Paragraph(body) => {
                    let _ = write!(html, "<p style=\"margin:0 0 16px;\">{}</p>", escape(body));
                    let _ = writeln!(text, "{body}\n");
                }
                Block::Quote(body) => {
                    let _ = write!(
                        html,
                        "<blockquote style=\"margin:0 0 16px;padding:8px 16px;\
                         border-left:4px solid #d6d3d1;\">{}</blockquote>",
                        escape(body)
                    );
                    let _ = writeln!(text, "\"{body}\"\n");
                }
                Block::Items(items) => {
                    html.push_str("<ul style=\"margin:0 0 16px;padding-left:20px;\">");
                    for item in items {
                        let _ = write!(html, "<li>{}</li>", escape(item));
                        let _ = writeln!(text, "- {item}");
                    }
                    html.push_str("</ul>");
                    text.push('\n');
                }
                Block::Button { label, url } => {
                    let _ = write!(
                        html,
                        "<p style=\"margin:0 0 16px;\"><a href=\"{}\" style=\"{BUTTON_STYLE}\">{}</a></p>",
                        escape(url),
                        escape(label)
                    );
                    let _ = writeln!(text, "{label}: {url}\n");
                }
            }
        }
        let support = ctx.support_email;
        let _ = write!(
            html,
            "<hr style=\"border:0;border-top:1px solid #e7e5e4;margin:24px 0 16px;\">\
             <p style=\"margin:0 0 8px;font-size:14px;color:#57534e;\">Questions? Write to \
             <a href=\"mailto:{0}\">{0}</a>.</p>",
            escape(support)
        );
        let _ = writeln!(text, "Questions? Write to {support}.");
        if self.preferences_link {
            let url = format!("{}/settings/notifications", ctx.web_base_url);
            let _ = write!(
                html,
                "<p style=\"margin:0;font-size:14px;color:#57534e;\">\
                 <a href=\"{0}\">Change email preferences</a></p>",
                escape(&url)
            );
            let _ = writeln!(text, "Change email preferences: {url}");
        }
        html.push_str("</div></body></html>");
        Rendered {
            subject: self.subject,
            html,
            text,
        }
    }
}

/// `20 November 2026`, the date in `Asia/Karachi`.
fn format_date(date: Date) -> String {
    format!("{} {} {}", date.day(), date.month(), date.year())
}

/// Reads a date out of a JSON value: Unix seconds, RFC 3339 text or `YYYY-MM-DD`.
fn read_date(value: &Value) -> Option<Date> {
    match value {
        Value::Number(number) => {
            let seconds = number.as_i64()?;
            OffsetDateTime::from_unix_timestamp(seconds)
                .ok()
                .map(karachi_date)
        }
        Value::String(text) => {
            if let Ok(at) =
                OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339)
            {
                return Some(karachi_date(at));
            }
            Date::parse(
                text,
                &time::macros::format_description!("[year]-[month]-[day]"),
            )
            .ok()
        }
        _ => None,
    }
}

fn str_of<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

/// An announcement or other outside link is used only when it is an `http` or `https` URL.
fn safe_url(url: &str) -> Option<&str> {
    let url = url.trim();
    (url.starts_with("https://") || url.starts_with("http://")).then_some(url)
}

/// One member as a line of a digest: `Ayesha K., 27, Lahore (92% match)`.
fn member_line(member: &MemberLine) -> String {
    let mut parts = vec![single_line(&member.display_name)];
    if let Some(age) = member.age {
        parts.push(age.to_string());
    }
    if let Some(city) = &member.city {
        parts.push(single_line(city));
    }
    let mut line = parts.join(", ");
    if let Some(compat) = member.compat {
        let _ = write!(line, " ({compat}% match)");
    }
    line
}

/// Renders a template, or `None` for a template name that does not exist.
pub fn render(ctx: &Context<'_>, template: &str, data: &Value, facts: &Facts) -> Option<Rendered> {
    let web = ctx.web_base_url;
    let message = match template {
        "account_suspended" => account_suspended(web, data),
        "account_warning" => account_warning(web, data),
        "account_deletion" => account_deletion(web, data),
        "export_ready" => Message::new("Your data export is ready")
            .paragraph(
                "Your data export is ready. Sign in and open Settings, then Account, to download \
                 it. The download is available for 7 days.",
            )
            .button("Open settings", format!("{web}/settings/account")),
        "profile_changes_requested" => profile_changes_requested(web, data),
        "verification_result" => verification_result(web, data),
        "welcome" => welcome(web),
        "interest_accepted" => interest_accepted(web, data, facts),
        "interest_digest" => interest_digest(web, facts),
        "unread_messages" => unread_messages(web, facts),
        "match_digest" => Message::new("New matches for you")
            .paragraph("These members match what you are looking for:")
            .items(facts.members.iter().take(5).map(member_line).collect())
            .button("See your matches", format!("{web}/matches"))
            .optional(),
        "announcement" => announcement(data),
        _ => return None,
    };
    Some(message.render(ctx))
}

fn account_warning(web: &str, data: &Value) -> Message {
    let mut message = Message::new("A notice about your Khandani Rishta account")
        .paragraph("We are writing to you about your Khandani Rishta account.");
    if let Some(reason) = str_of(data, "reason") {
        message = message.quote(reason);
    }
    message
        .paragraph(
            "Please read our community guidelines so that your account stays in good standing.",
        )
        .button(
            "Read the community guidelines",
            format!("{web}/community-guidelines"),
        )
}

fn profile_changes_requested(web: &str, data: &Value) -> Message {
    let mut message = Message::new("Your profile needs a few changes").paragraph(
        "A moderator looked at your profile and asked for a few changes before it can go live.",
    );
    if let Some(reason) = str_of(data, "reason") {
        message = message.quote(reason);
    }
    message.button("Update my profile", format!("{web}/account/changes"))
}

fn welcome(web: &str) -> Message {
    Message::new("Your profile is live")
        .paragraph("Assalamu alaikum. Your profile is live and members can now find you.")
        .paragraph("Three things that help you most:")
        .items(vec![
            "Add photos, so members can see who you are.".to_owned(),
            "Get verified, to earn a badge and more trust.".to_owned(),
            "Review your partner preferences, for better matches.".to_owned(),
        ])
        .paragraph("A few safety tips:")
        .items(vec![
            "Never send money or share financial details with anyone.".to_owned(),
            "Keep talking on Khandani Rishta until you trust the person.".to_owned(),
            "Involve your family early, and meet in a public place.".to_owned(),
        ])
        .button("Open Khandani Rishta", format!("{web}/home"))
}

fn interest_accepted(web: &str, data: &Value, facts: &Facts) -> Message {
    let name = facts
        .actor_name
        .as_deref()
        .map_or_else(|| "A member".to_owned(), single_line);
    let url = str_of(data, "connection_id")
        .and_then(|id| Uuid::parse_str(id).ok())
        .map_or_else(
            || format!("{web}/interests"),
            |id| format!("{web}/chats/{id}"),
        );
    Message::new(format!("{name} accepted your interest"))
        .paragraph(format!("{name} accepted your interest. You can chat now."))
        .button("Open the chat", url)
        .optional()
}

fn interest_digest(web: &str, facts: &Facts) -> Message {
    let count = facts.count.max(1);
    let (subject, intro) = if count == 1 {
        (
            "You have 1 new interest".to_owned(),
            "A member sent you an interest. They are:".to_owned(),
        )
    } else {
        (
            format!("You have {count} new interests"),
            format!("{count} members sent you an interest. The latest are:"),
        )
    };
    Message::new(subject)
        .paragraph(intro)
        .items(facts.members.iter().take(5).map(member_line).collect())
        .button("See your interests", format!("{web}/interests"))
        .optional()
}

fn unread_messages(web: &str, facts: &Facts) -> Message {
    let count = facts.count.max(1);
    Message::new("You have unread messages")
        .paragraph(if count == 1 {
            "You have unread messages in 1 chat.".to_owned()
        } else {
            format!("You have unread messages in {count} chats.")
        })
        .button("Open your chats", format!("{web}/chats"))
        .optional()
}

fn announcement(data: &Value) -> Message {
    let mut message = Message::new("News from Khandani Rishta");
    let body = str_of(data, "text_en").unwrap_or("We have news for you.");
    for paragraph in body.split("\n\n") {
        let paragraph = paragraph.trim();
        if !paragraph.is_empty() {
            message = message.paragraph(paragraph);
        }
    }
    if let Some(url) = str_of(data, "url").and_then(safe_url) {
        message = message.button("Read more", url);
    }
    message.optional()
}

fn account_suspended(web: &str, data: &Value) -> Message {
    let reason = str_of(data, "reason");
    match str_of(data, "form") {
        Some("banned") => {
            let mut message = Message::new("Your Khandani Rishta account has been closed")
                .paragraph("Your Khandani Rishta account has been closed.");
            if let Some(reason) = reason {
                message = message.quote(reason);
            }
            message.paragraph("If you think this is a mistake, please write to us.")
        }
        Some("active_again") => Message::new("Your Khandani Rishta account is active again")
            .paragraph("The suspension of your account has ended. You can sign in again.")
            .button("Open Khandani Rishta", format!("{web}/home")),
        _ => {
            let mut message = Message::new("Your Khandani Rishta account has been suspended")
                .paragraph("Your Khandani Rishta account has been suspended.");
            if let Some(reason) = reason {
                message = message.quote(reason);
            }
            if let Some(until) = data.get("suspended_until").and_then(read_date) {
                message =
                    message.paragraph(format!("The suspension ends on {}.", format_date(until)));
            }
            message.paragraph("If you think this is a mistake, please write to us.")
        }
    }
}

fn account_deletion(web: &str, data: &Value) -> Message {
    let cancelled = str_of(data, "form").is_some_and(|form| form.starts_with("cancel"))
        || data.get("cancelled").and_then(Value::as_bool) == Some(true);
    if cancelled {
        return Message::new("Your account deletion was cancelled")
            .paragraph("Your account will not be deleted. Everything is as it was.")
            .button("Open Khandani Rishta", format!("{web}/home"));
    }
    let purge_date = data.get("purge_after").and_then(read_date).map(format_date);
    let subject = purge_date.as_ref().map_or_else(
        || "Your account will be deleted".to_owned(),
        |day| format!("Your account will be deleted on {day}"),
    );
    Message::new(subject)
        .paragraph(purge_date.map_or_else(
            || "We received your request to delete your Khandani Rishta account.".to_owned(),
            |day| {
                format!(
                    "We received your request to delete your Khandani Rishta account. It will be \
                     deleted on {day}."
                )
            },
        ))
        .paragraph(
            "Until then your profile is hidden. If you change your mind, sign in before that date \
             and choose \"Keep my account\".",
        )
        .button("Sign in", format!("{web}/account/deletion"))
}

fn verification_result(web: &str, data: &Value) -> Message {
    let approved = match str_of(data, "result") {
        Some(result) => result == "approved",
        None => data
            .get("approved")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    };
    let what = if str_of(data, "kind") == Some("selfie") {
        "photo"
    } else {
        "ID"
    };
    let url = format!("{web}/me/verification");
    if approved {
        Message::new("Your verification was approved")
            .paragraph(format!(
                "We checked your {what} and your profile now shows the verified badge."
            ))
            .button("See your verification", url)
    } else {
        let mut message = Message::new("We could not approve your verification")
            .paragraph(format!("We could not approve the check of your {what}."));
        let reason = str_of(data, "rejection_reason")
            .and_then(|code| options::label("verification_rejection_reason", code));
        if let Some(reason) = reason {
            message = message.quote(reason);
        }
        message
            .paragraph("You can try again with a new submission.")
            .button("Try again", url)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const CTX: Context<'static> = Context {
        web_base_url: "https://app.example.test",
        support_email: "help@example.test",
    };

    fn render_for_test(template: &str, data: &Value, facts: &Facts) -> Rendered {
        render(&CTX, template, data, facts).expect("a known template")
    }

    #[test]
    fn every_template_renders_with_missing_data() {
        for template in [
            "account_suspended",
            "account_warning",
            "account_deletion",
            "export_ready",
            "profile_changes_requested",
            "verification_result",
            "welcome",
            "interest_accepted",
            "interest_digest",
            "unread_messages",
            "match_digest",
            "announcement",
        ] {
            let email = render_for_test(template, &json!({}), &Facts::default());
            assert!(!email.subject.is_empty(), "{template}");
            assert!(email.html.contains("help@example.test"), "{template}");
            assert!(email.text.contains("help@example.test"), "{template}");
            assert!(!email.subject.contains('\n'));
        }
        assert!(render(&CTX, "nope", &json!({}), &Facts::default()).is_none());
    }

    #[test]
    fn member_supplied_values_are_escaped() {
        let hostile = "<script>alert('x')</script> & \"quotes\"";
        let facts = Facts {
            actor_name: Some(hostile.to_owned()),
            members: vec![MemberLine {
                display_name: hostile.to_owned(),
                age: Some(27),
                city: Some("<b>Lahore</b>".to_owned()),
                compat: Some(91),
            }],
            count: 2,
        };
        let data = json!({
            "reason": hostile, "text_en": hostile, "url": "https://example.test/?a=1&b=\"2\"",
            "connection_id": "x\"><script>",
        });
        for template in [
            "interest_accepted",
            "interest_digest",
            "match_digest",
            "account_warning",
            "profile_changes_requested",
            "account_suspended",
            "announcement",
        ] {
            let email = render_for_test(template, &data, &facts);
            assert!(
                !email.html.contains("<script>"),
                "{template}: {}",
                email.html
            );
            assert!(!email.html.contains("<b>"), "{template}");
            assert!(!email.subject.contains('\n'), "{template}");
        }
        let email = render_for_test("announcement", &data, &facts);
        assert!(email.html.contains("&lt;script&gt;"));
        assert!(email.html.contains("a=1&amp;b=&quot;2&quot;"));
    }

    #[test]
    fn announcement_links_must_be_http() {
        let email = render_for_test(
            "announcement",
            &json!({ "text_en": "Hello", "url": "javascript:alert(1)" }),
            &Facts::default(),
        );
        assert!(!email.html.contains("javascript:"));
        assert!(!email.html.contains("Read more"));
    }

    #[test]
    fn links_come_from_the_configured_origin() {
        let email = render_for_test(
            "interest_accepted",
            &json!({ "connection_id": "0193a2c4-0000-7000-8000-000000000001" }),
            &Facts {
                actor_name: Some("Ayesha K.".to_owned()),
                ..Facts::default()
            },
        );
        assert_eq!(email.subject, "Ayesha K. accepted your interest");
        assert!(
            email
                .text
                .contains("https://app.example.test/chats/0193a2c4-0000-7000-8000-000000000001")
        );
        assert!(
            email
                .text
                .contains("https://app.example.test/settings/notifications")
        );

        let account = render_for_test("account_warning", &json!({}), &Facts::default());
        assert!(
            !account.text.contains("settings/notifications"),
            "account emails cannot be switched off"
        );
    }

    #[test]
    fn suspension_forms_and_dates() {
        let suspended = render_for_test(
            "account_suspended",
            &json!({ "form": "suspended", "reason": "Rude messages", "suspended_until": 1_795_000_000 }),
            &Facts::default(),
        );
        assert_eq!(
            suspended.subject,
            "Your Khandani Rishta account has been suspended"
        );
        assert!(suspended.text.contains("Rude messages"));
        assert!(suspended.text.contains("The suspension ends on"));
        let banned = render_for_test(
            "account_suspended",
            &json!({ "form": "banned" }),
            &Facts::default(),
        );
        assert_eq!(
            banned.subject,
            "Your Khandani Rishta account has been closed"
        );
        let lifted = render_for_test(
            "account_suspended",
            &json!({ "form": "active_again" }),
            &Facts::default(),
        );
        assert_eq!(
            lifted.subject,
            "Your Khandani Rishta account is active again"
        );
    }

    #[test]
    fn deletion_and_verification_wording() {
        let scheduled = render_for_test(
            "account_deletion",
            &json!({ "purge_after": "2026-12-20T10:00:00Z" }),
            &Facts::default(),
        );
        assert_eq!(
            scheduled.subject,
            "Your account will be deleted on 20 December 2026"
        );
        let cancelled = render_for_test(
            "account_deletion",
            &json!({ "form": "cancelled" }),
            &Facts::default(),
        );
        assert_eq!(cancelled.subject, "Your account deletion was cancelled");

        let approved = render_for_test(
            "verification_result",
            &json!({ "kind": "selfie", "result": "approved" }),
            &Facts::default(),
        );
        assert_eq!(approved.subject, "Your verification was approved");
        let rejected = render_for_test(
            "verification_result",
            &json!({ "kind": "id_document", "result": "rejected", "rejection_reason": "face_mismatch" }),
            &Facts::default(),
        );
        assert_eq!(rejected.subject, "We could not approve your verification");
        assert!(rejected.text.contains("The face does not match"));
    }

    #[test]
    fn digests_list_at_most_five_members() {
        let members = (0..8)
            .map(|n| MemberLine {
                display_name: format!("Member {n}"),
                age: Some(25),
                city: Some("Karachi".to_owned()),
                compat: Some(80),
            })
            .collect();
        let email = render_for_test(
            "match_digest",
            &json!({}),
            &Facts {
                members,
                ..Facts::default()
            },
        );
        assert!(email.text.contains("Member 4, 25, Karachi (80% match)"));
        assert!(!email.text.contains("Member 5"));
        let digest = render_for_test(
            "interest_digest",
            &json!({}),
            &Facts {
                count: 3,
                ..Facts::default()
            },
        );
        assert_eq!(digest.subject, "You have 3 new interests");
    }
}
