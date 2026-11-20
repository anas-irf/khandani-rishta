//! Clerk Backend API: users, sessions, bans and deletion (06 sections 5, 7, 8 and 9).

use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;

use crate::config::ClerkConfig;
use crate::services::{ServiceError, http_client};

/// The fields of a Clerk user that the API copies (06 section 7.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClerkUser {
    pub id: String,
    /// Primary email, lower-cased.
    pub email: Option<String>,
    pub email_verified: bool,
    pub phone_e164: Option<String>,
    pub phone_verified: bool,
}

/// Whether a ban or unban took effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BanOutcome {
    Done,
    /// The plan does not include bans (HTTP 402). Treated as success (06 section 8.2).
    NotIncluded,
}

#[async_trait]
pub trait ClerkApi: Send + Sync {
    /// `GET /users/{id}`. `Ok(None)` when Clerk answers 404.
    async fn get_user(&self, clerk_user_id: &str) -> Result<Option<ClerkUser>, ServiceError>;
    /// Ids of the user's active sessions.
    async fn active_sessions(&self, clerk_user_id: &str) -> Result<Vec<String>, ServiceError>;
    async fn revoke_session(&self, session_id: &str) -> Result<(), ServiceError>;
    async fn ban_user(&self, clerk_user_id: &str) -> Result<BanOutcome, ServiceError>;
    async fn unban_user(&self, clerk_user_id: &str) -> Result<BanOutcome, ServiceError>;
    /// `DELETE /users/{id}`. A 404 counts as success.
    async fn delete_user(&self, clerk_user_id: &str) -> Result<(), ServiceError>;
}

/// The real Backend API client.
pub struct HttpClerk {
    client: reqwest::Client,
    base_url: String,
    secret_key: String,
}

impl HttpClerk {
    pub fn new(config: &ClerkConfig) -> Self {
        Self {
            client: http_client(),
            base_url: config.api_base_url.clone(),
            secret_key: config.secret_key.clone(),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.base_url))
            .bearer_auth(&self.secret_key)
    }

    async fn fetch_user(&self, clerk_user_id: &str) -> Result<Option<ClerkUser>, ServiceError> {
        let response = self
            .request(reqwest::Method::GET, &format!("/users/{clerk_user_id}"))
            .timeout(Duration::from_secs(5))
            .send()
            .await?;
        match response.status() {
            reqwest::StatusCode::NOT_FOUND => Ok(None),
            status if status.is_success() => {
                let user: UserObject = response.json().await?;
                Ok(Some(user.into()))
            }
            status => Err(ServiceError::from_status(status, "clerk get user")),
        }
    }

    async fn ban_call(
        &self,
        clerk_user_id: &str,
        action: &str,
    ) -> Result<BanOutcome, ServiceError> {
        let response = self
            .request(
                reqwest::Method::POST,
                &format!("/users/{clerk_user_id}/{action}"),
            )
            .send()
            .await?;
        match response.status() {
            reqwest::StatusCode::PAYMENT_REQUIRED => Ok(BanOutcome::NotIncluded),
            status if status.is_success() => Ok(BanOutcome::Done),
            status => Err(ServiceError::from_status(status, "clerk ban")),
        }
    }
}

#[async_trait]
impl ClerkApi for HttpClerk {
    async fn get_user(&self, clerk_user_id: &str) -> Result<Option<ClerkUser>, ServiceError> {
        // Timeout 5 s, one retry (06 section 5.1 step a).
        match self.fetch_user(clerk_user_id).await {
            Err(error) if error.is_temporary() => self.fetch_user(clerk_user_id).await,
            other => other,
        }
    }

    async fn active_sessions(&self, clerk_user_id: &str) -> Result<Vec<String>, ServiceError> {
        let response = self
            .request(reqwest::Method::GET, "/sessions")
            .query(&[
                ("user_id", clerk_user_id),
                ("status", "active"),
                ("limit", "100"),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ServiceError::from_status(
                response.status(),
                "clerk sessions",
            ));
        }
        let sessions: SessionList = response.json().await?;
        Ok(sessions.into_ids())
    }

    async fn revoke_session(&self, session_id: &str) -> Result<(), ServiceError> {
        let response = self
            .request(
                reqwest::Method::POST,
                &format!("/sessions/{session_id}/revoke"),
            )
            .send()
            .await?;
        match response.status() {
            // Already gone or already revoked.
            reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::BAD_REQUEST => Ok(()),
            status if status.is_success() => Ok(()),
            status => Err(ServiceError::from_status(status, "clerk revoke session")),
        }
    }

    async fn ban_user(&self, clerk_user_id: &str) -> Result<BanOutcome, ServiceError> {
        self.ban_call(clerk_user_id, "ban").await
    }

    async fn unban_user(&self, clerk_user_id: &str) -> Result<BanOutcome, ServiceError> {
        self.ban_call(clerk_user_id, "unban").await
    }

    async fn delete_user(&self, clerk_user_id: &str) -> Result<(), ServiceError> {
        let response = self
            .request(reqwest::Method::DELETE, &format!("/users/{clerk_user_id}"))
            .send()
            .await?;
        match response.status() {
            reqwest::StatusCode::NOT_FOUND => Ok(()),
            status if status.is_success() => Ok(()),
            status => Err(ServiceError::from_status(status, "clerk delete user")),
        }
    }
}

/// The Backend API user object, also the `data` of user webhooks (06 section 7.4).
#[derive(Debug, Deserialize)]
pub struct UserObject {
    pub id: String,
    #[serde(default)]
    pub primary_email_address_id: Option<String>,
    #[serde(default)]
    pub email_addresses: Vec<EmailAddress>,
    #[serde(default)]
    pub primary_phone_number_id: Option<String>,
    #[serde(default)]
    pub phone_numbers: Vec<PhoneNumber>,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::struct_field_names)] // Clerk's field names.
pub struct EmailAddress {
    pub id: String,
    pub email_address: String,
    #[serde(default)]
    pub verification: Option<Verification>,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::struct_field_names)] // Clerk's field names.
pub struct PhoneNumber {
    pub id: String,
    pub phone_number: String,
    #[serde(default)]
    pub verification: Option<Verification>,
}

#[derive(Debug, Deserialize)]
pub struct Verification {
    #[serde(default)]
    pub status: Option<String>,
}

fn is_verified(verification: Option<&Verification>) -> bool {
    verification.and_then(|v| v.status.as_deref()) == Some("verified")
}

impl From<UserObject> for ClerkUser {
    fn from(user: UserObject) -> Self {
        let email = user.primary_email_address_id.as_ref().and_then(|primary| {
            user.email_addresses
                .iter()
                .find(|address| &address.id == primary)
        });
        let phone = user.primary_phone_number_id.as_ref().and_then(|primary| {
            user.phone_numbers
                .iter()
                .find(|number| &number.id == primary)
        });
        Self {
            id: user.id,
            email: email.map(|address| address.email_address.trim().to_lowercase()),
            email_verified: email.is_some_and(|address| is_verified(address.verification.as_ref())),
            phone_e164: phone.map(|number| number.phone_number.clone()),
            phone_verified: phone.is_some_and(|number| is_verified(number.verification.as_ref())),
        }
    }
}

/// `/sessions` answers either a bare array or `{ "data": [...] }` depending on the API version.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum SessionList {
    Bare(Vec<SessionObject>),
    Wrapped { data: Vec<SessionObject> },
}

#[derive(Debug, Deserialize)]
struct SessionObject {
    id: String,
}

impl SessionList {
    fn into_ids(self) -> Vec<String> {
        match self {
            Self::Bare(list) | Self::Wrapped { data: list } => {
                list.into_iter().map(|session| session.id).collect()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn clerk_for(server: &MockServer) -> HttpClerk {
        HttpClerk {
            client: http_client(),
            base_url: server.uri(),
            secret_key: "sk_test".to_owned(),
        }
    }

    fn user_json() -> serde_json::Value {
        json!({
            "id": "user_1",
            "primary_email_address_id": "idn_2",
            "email_addresses": [
                { "id": "idn_1", "email_address": "old@example.com", "verification": { "status": "verified" } },
                { "id": "idn_2", "email_address": "Ali@Example.com", "verification": { "status": "verified" } }
            ],
            "primary_phone_number_id": null,
            "phone_numbers": [],
            "first_name": "ignored"
        })
    }

    #[test]
    fn maps_the_primary_email_and_phone() {
        let user: UserObject = serde_json::from_value(user_json()).unwrap();
        let user = ClerkUser::from(user);
        assert_eq!(user.email.as_deref(), Some("ali@example.com"));
        assert!(user.email_verified);
        assert_eq!(user.phone_e164, None);
        assert!(!user.phone_verified);
    }

    #[tokio::test]
    async fn fetches_a_user_with_the_secret_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/users/user_1"))
            .and(header("authorization", "Bearer sk_test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(user_json()))
            .mount(&server)
            .await;
        let user = clerk_for(&server)
            .get_user("user_1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(user.id, "user_1");
    }

    #[tokio::test]
    async fn missing_users_are_none_and_server_errors_are_temporary() {
        let server = MockServer::start().await;
        Mock::given(path("/users/gone"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/users/broken"))
            .respond_with(ResponseTemplate::new(503))
            .expect(2)
            .mount(&server)
            .await;
        let clerk = clerk_for(&server);
        assert_eq!(clerk.get_user("gone").await.unwrap(), None);
        assert!(clerk.get_user("broken").await.unwrap_err().is_temporary());
    }

    #[tokio::test]
    async fn lists_and_revokes_sessions() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/sessions"))
            .and(query_param("user_id", "user_1"))
            .and(query_param("status", "active"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!([{ "id": "sess_1" }, { "id": "sess_2" }])),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/sessions/sess_1/revoke"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        let clerk = clerk_for(&server);
        assert_eq!(
            clerk.active_sessions("user_1").await.unwrap(),
            vec!["sess_1", "sess_2"]
        );
        clerk.revoke_session("sess_1").await.unwrap();
    }

    #[tokio::test]
    async fn bans_without_the_plan_are_not_errors() {
        let server = MockServer::start().await;
        Mock::given(path("/users/user_1/ban"))
            .respond_with(ResponseTemplate::new(402))
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(path("/users/user_1"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let clerk = clerk_for(&server);
        assert_eq!(
            clerk.ban_user("user_1").await.unwrap(),
            BanOutcome::NotIncluded
        );
        clerk.delete_user("user_1").await.unwrap();
    }
}
