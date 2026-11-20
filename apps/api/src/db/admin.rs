//! SQL of the staff console (18), one file per area. Handlers in `routes/admin/` stay thin and
//! call these functions; the ones that change state run one transaction that also writes the
//! audit row (03 section 8 rule 13).

pub mod announcements;
pub mod audit;
pub mod castes;
pub mod overview;
pub mod profiles;
pub mod releases;
pub mod reports;
pub mod settings;
pub mod users;

/// Escapes the backslash, `%` and `_` so user text can be used inside a `LIKE` pattern.
pub(crate) fn escape_like(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::escape_like;

    #[test]
    fn like_patterns_are_escaped() {
        assert_eq!(escape_like("50%_off\\"), "50\\%\\_off\\\\");
        assert_eq!(escape_like("plain"), "plain");
    }
}

/// Helpers shared by the tests of the staff routes and jobs.
#[cfg(test)]
pub(crate) mod test_util {
    use serde_json::Value;
    use sqlx::PgPool;
    use uuid::Uuid;

    /// The `details` of every audit row with this action, oldest first.
    pub async fn audit_details(db: &PgPool, action: &str) -> Vec<Value> {
        sqlx::query_scalar(
            "SELECT details FROM admin_audit_log WHERE action = $1 ORDER BY created_at, id",
        )
        .bind(action)
        .fetch_all(db)
        .await
        .unwrap()
    }

    /// How many audit rows exist in total.
    pub async fn audit_total(db: &PgPool) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM admin_audit_log")
            .fetch_one(db)
            .await
            .unwrap()
    }

    /// The email address a fixture user was provisioned with.
    pub async fn email_of(db: &PgPool, user_id: Uuid) -> String {
        sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(db)
            .await
            .unwrap()
    }

    /// `send_email` jobs queued for a user with this template, oldest first.
    pub async fn queued_emails(db: &PgPool, user_id: Uuid, template: &str) -> Vec<Value> {
        sqlx::query_scalar(
            "SELECT payload FROM jobs
             WHERE kind = 'send_email' AND payload ->> 'user_id' = $1 AND payload ->> 'template' = $2
             ORDER BY created_at, id",
        )
        .bind(user_id.to_string())
        .bind(template)
        .fetch_all(db)
        .await
        .unwrap()
    }

    /// The `data` of every notification of a type for a user, oldest first.
    pub async fn notifications(db: &PgPool, user_id: Uuid, kind: &str) -> Vec<Value> {
        sqlx::query_scalar(
            "SELECT data FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at, id",
        )
        .bind(user_id)
        .bind(kind)
        .fetch_all(db)
        .await
        .unwrap()
    }
}
