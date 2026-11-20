//! Test helpers: an app wired to fakes, token minting with a fixed key, an HTTP client for the
//! router, and fixtures that create users and profiles in any state.
//!
//! Tests use `#[sqlx::test]`, which creates a throwaway database with every migration applied,
//! and build the app around it with [`TestApp::new`].

#![allow(clippy::missing_panics_doc, dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header};
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use tower::ServiceExt;
use uuid::Uuid;

use crate::auth::jwks::Jwks;
use crate::config::Config;
use crate::domain::options::Gender;
use crate::domain::types::{ProfileStatus, UserRole, UserStatus};
use crate::services::ServiceError;
use crate::services::clerk::{BanOutcome, ClerkApi, ClerkUser};
use crate::services::content_safety::{CategorySeverity, ContentSafety, SafetyAnalysis};
use crate::services::fcm::{PushError, PushMessage, PushSender};
use crate::services::r2::MemoryStore;
use crate::services::resend::{EmailSender, OutgoingEmail};
use crate::state::{AppState, Integrations};

pub const TEST_ISSUER: &str = "https://clerk.test";
pub const TEST_KID: &str = "test-key";
pub const TEST_WEBHOOK_SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

/// A 2048-bit RSA key used only by tests.
const TEST_PRIVATE_KEY: &str = "-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC8uDKzQQE6ZkXE
xMBy5Pg8hv5nhXRF2jig0ETkIP2n/NuFMc4im+/rnRhEo4c1Kg1RD8Mes+x7e0Gq
jKTkAfD+XP8I6ewVOIIuWp2TNZ6DcDZQeeFD7BBQhhq7D61UpL0WpQEB7CPav1kW
CH9ZpZQxGP8HJMMTCODjEPAqQ90y9tGuqpmINvQI9PBkGhyq3JsUCaLNpf90lDSP
vTjHWdNHt81pyX9mRZXBmjTrATC0KRSxvbIkauK84X2LFpKdAfsQaoeb2gGGVai6
iJHKny3nTWDIbJqMKs5T6F9F4Tzq74e2q84wdH2gZGyulibeePHo3qylOiE2KJqz
/fh1hKl3AgMBAAECggEASXii0HO10TEg5268B98Jn7Lkl5P2xP0kv8LllzUa28xP
AGd3+7Re7wk9efd6O6HwBkePLMRahGZjlczkoxn4Y2b8KVG8xjQ2Rmqj3zxoRn6o
vqL8ps9gOKFFBd+gGQx7yzWZE1EGUnLdcX0Ea3fRnl2/Z94RjjcOKoidH69FDkIp
UOy8CTMUwMfxE4dpNo6TYjGFusv4Q6cLUjIl8/1Fx9+s6ExL4Q2KU37An1wn8b9+
jydLAUaE5QTUb0dcUTl3wmDHCdAA6F4MVlk9ynrQQ4XBzBk/VQALqkQEl8sZXN+Z
iROqX0tGPJTlEBcvYdAzbS7oDw2rOWcPyoWU0Ax0PQKBgQD9mGqL813zyiQmQQmI
J0j/GGiNo+YlPpc0k7heyQp8XyzEuOv5JdsP4sIA5xh/+zcj4qBYyL+V+pK7Rtsy
IC1VhvNCAtUtIrKv7/141YK5tsz3Eu0OpDR7JzrIRXi4QmzwttKlvgfDuD6aQFMr
koTArk3keoJeTbPh0a4/fguiswKBgQC+gkzyTlYDkqdVIvHKNWha/kEB74hyXOKW
RNuG62jXiqFAFg5moKSu8oOzJMvGlNcRXcXHrkzEdVp36skGJmoH3KX6i9HBwh4b
JZ8rCmf+ZIZwmnuIpxtYziKv9jt8eeejY5bh1N8+TOm4RgPGmxE4y5JPQOEquBJN
MtOcEuqwLQKBgGZy6LhZPR98DlaV96/VjxvfVH3ENPne618GPnmsZlwQZxmiS1KA
BJvKU+3hbnhlmMUajQTRNPT2IckeuvbpIOdoeWW1l0GAvwdswM3ME9/LBcrbDoHX
vIv0MT8vMbHew/wLH9Ztit161W+jhPYZXyAoSrd+9qP6aC1WdDqaRUEZAoGAEsCa
uGMznkhqRjwZVtEpA4PxfDJK2Q8Bks8WWNKFUGop8zf4lOuNKlde1Vxy3oo6HVCA
rmYe0lvG2vT2cq+HUlzKzb3DmPH1qrBqWX89u1HD1gOu00W3sGciDPYM5vTM801T
RcmBbA2AGA50QrFy4YdQUJLPVzglPQoawEswZMUCgYAE0x1YKtVGCsiKl3XeU+08
VyLZGdE0+kelgNuLPe+dILM2OHEDEjK7PnF7/3tMIXx7CdYnrVu3pM1HbF7JZgt6
Pj/ztYcumPhVTsKKHxYdDesLj3vG8mkrcDL1w4H4BcdHxZxtru2QYiCw0bL87k9T
3lkB2+HNbpjZLVVn2jsEJA==
-----END PRIVATE KEY-----";
const TEST_KEY_N: &str = "vLgys0EBOmZFxMTAcuT4PIb-Z4V0Rdo4oNBE5CD9p_zbhTHOIpvv650YRKOHNSoNUQ_DHrPse3tBqoyk5AHw_lz_COnsFTiCLlqdkzWeg3A2UHnhQ-wQUIYauw-tVKS9FqUBAewj2r9ZFgh_WaWUMRj_ByTDEwjg4xDwKkPdMvbRrqqZiDb0CPTwZBocqtybFAmizaX_dJQ0j704x1nTR7fNacl_ZkWVwZo06wEwtCkUsb2yJGrivOF9ixaSnQH7EGqHm9oBhlWouoiRyp8t501gyGyajCrOU-hfReE86u-HtqvOMHR9oGRsrpYm3njx6N6spTohNiias_34dYSpdw";
const TEST_KEY_E: &str = "AQAB";

/// The public key as a JWK, as Clerk publishes it.
pub fn test_jwk() -> Value {
    json!({ "kty": "RSA", "kid": TEST_KID, "use": "sig", "alg": "RS256", "n": TEST_KEY_N, "e": TEST_KEY_E })
}

/// A key set holding only the test key.
pub fn test_jwks() -> Jwks {
    let key = DecodingKey::from_rsa_components(TEST_KEY_N, TEST_KEY_E).expect("valid test key");
    Jwks::fixed(HashMap::from([(TEST_KID.to_owned(), key)]))
}

/// What to put in a test token.
#[derive(Debug, Clone)]
pub struct TokenSpec {
    pub sub: String,
    pub iss: String,
    pub azp: Option<String>,
    pub kid: Option<String>,
    /// Seconds from now.
    pub exp_offset: i64,
    pub nbf_offset: Option<i64>,
    /// Extra claims merged into the payload.
    pub extra: Value,
}

impl TokenSpec {
    pub fn new(sub: &str) -> Self {
        Self {
            sub: sub.to_owned(),
            iss: TEST_ISSUER.to_owned(),
            azp: Some("http://localhost:3000".to_owned()),
            kid: Some(TEST_KID.to_owned()),
            exp_offset: 60,
            nbf_offset: Some(-5),
            extra: json!({}),
        }
    }
}

/// Signs a token with the test key.
pub fn sign_token(spec: &TokenSpec) -> String {
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let mut claims = json!({
        "sub": spec.sub,
        "iss": spec.iss,
        "exp": now + spec.exp_offset,
        "iat": now - 5,
        "sid": "sess_test",
    });
    if let Some(azp) = &spec.azp {
        claims["azp"] = json!(azp);
    }
    if let Some(nbf) = spec.nbf_offset {
        claims["nbf"] = json!(now + nbf);
    }
    if let (Some(map), Some(extra)) = (claims.as_object_mut(), spec.extra.as_object()) {
        map.extend(extra.clone());
    }
    let mut header = Header::new(Algorithm::RS256);
    header.kid.clone_from(&spec.kid);
    let key = EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes()).expect("valid test key");
    jsonwebtoken::encode(&header, &claims, &key).expect("token encodes")
}

/// A valid token for a Clerk user id.
pub fn token_for(clerk_user_id: &str) -> String {
    sign_token(&TokenSpec::new(clerk_user_id))
}

// ---- Fakes ----

/// Clerk with users held in memory. Records revocations, bans and deletions.
#[derive(Default)]
pub struct FakeClerk {
    pub users: Mutex<HashMap<String, ClerkUser>>,
    pub calls: Mutex<Vec<String>>,
    /// When true every call fails with a temporary error.
    pub down: Mutex<bool>,
}

impl FakeClerk {
    pub fn add_user(&self, user: ClerkUser) {
        self.users.lock().unwrap().insert(user.id.clone(), user);
    }

    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn record(&self, call: String) -> Result<(), ServiceError> {
        self.calls.lock().unwrap().push(call);
        if *self.down.lock().unwrap() {
            Err(ServiceError::Temporary("clerk is down".to_owned()))
        } else {
            Ok(())
        }
    }
}

#[async_trait]
impl ClerkApi for FakeClerk {
    async fn get_user(&self, clerk_user_id: &str) -> Result<Option<ClerkUser>, ServiceError> {
        self.record(format!("get_user:{clerk_user_id}"))?;
        Ok(self.users.lock().unwrap().get(clerk_user_id).cloned())
    }

    async fn active_sessions(&self, clerk_user_id: &str) -> Result<Vec<String>, ServiceError> {
        self.record(format!("active_sessions:{clerk_user_id}"))?;
        Ok(vec![format!("sess_{clerk_user_id}")])
    }

    async fn revoke_session(&self, session_id: &str) -> Result<(), ServiceError> {
        self.record(format!("revoke_session:{session_id}"))
    }

    async fn ban_user(&self, clerk_user_id: &str) -> Result<BanOutcome, ServiceError> {
        self.record(format!("ban_user:{clerk_user_id}"))?;
        Ok(BanOutcome::Done)
    }

    async fn unban_user(&self, clerk_user_id: &str) -> Result<BanOutcome, ServiceError> {
        self.record(format!("unban_user:{clerk_user_id}"))?;
        Ok(BanOutcome::Done)
    }

    async fn delete_user(&self, clerk_user_id: &str) -> Result<(), ServiceError> {
        self.record(format!("delete_user:{clerk_user_id}"))
    }
}

/// Records sent emails.
#[derive(Default)]
pub struct FakeEmail {
    pub sent: Mutex<Vec<OutgoingEmail>>,
}

#[async_trait]
impl EmailSender for FakeEmail {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn send(&self, email: &OutgoingEmail) -> Result<(), ServiceError> {
        self.sent.lock().unwrap().push(email.clone());
        Ok(())
    }
}

/// Records pushes. Tokens listed in `unregistered` answer as no longer registered.
#[derive(Default)]
pub struct FakePush {
    pub sent: Mutex<Vec<(String, PushMessage)>>,
    pub unregistered: Mutex<Vec<String>>,
}

#[async_trait]
impl PushSender for FakePush {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn send(&self, push_token: &str, message: &PushMessage) -> Result<(), PushError> {
        if self
            .unregistered
            .lock()
            .unwrap()
            .iter()
            .any(|t| t == push_token)
        {
            return Err(PushError::Unregistered);
        }
        self.sent
            .lock()
            .unwrap()
            .push((push_token.to_owned(), message.clone()));
        Ok(())
    }
}

/// Content safety with a configurable answer. `None` behaves as the service being down.
#[derive(Default)]
pub struct FakeContentSafety {
    pub severity: Mutex<Option<u8>>,
}

#[async_trait]
impl ContentSafety for FakeContentSafety {
    fn is_enabled(&self) -> bool {
        true
    }

    async fn analyze_text(&self, _: &str) -> Result<SafetyAnalysis, ServiceError> {
        self.answer()
    }

    async fn analyze_image(&self, _: &[u8]) -> Result<SafetyAnalysis, ServiceError> {
        self.answer()
    }
}

impl FakeContentSafety {
    fn answer(&self) -> Result<SafetyAnalysis, ServiceError> {
        let severity = self
            .severity
            .lock()
            .unwrap()
            .ok_or_else(|| ServiceError::Temporary("content safety is down".to_owned()))?;
        Ok(SafetyAnalysis {
            categories: vec![CategorySeverity {
                category: "Sexual".to_owned(),
                severity,
            }],
            raw: json!({ "categoriesAnalysis": [{ "category": "Sexual", "severity": severity }] }),
        })
    }
}

// ---- The app ----

/// The response of a test request.
#[derive(Debug)]
pub struct TestResponse {
    pub status: StatusCode,
    pub headers: axum::http::HeaderMap,
    /// The body as JSON, or `Value::Null` when it is empty or not JSON.
    pub json: Value,
    pub text: String,
    pub request_id: Option<String>,
}

impl TestResponse {
    /// The error code of an error body.
    pub fn code(&self) -> &str {
        self.json["error"]["code"].as_str().unwrap_or_default()
    }

    /// The field error codes of a `validation_failed` body, as `field:code`.
    pub fn field_errors(&self) -> Vec<String> {
        self.json["error"]["fields"]
            .as_array()
            .map_or_default(|fields| {
                fields
                    .iter()
                    .map(|f| {
                        format!(
                            "{}:{}",
                            f["field"].as_str().unwrap_or_default(),
                            f["code"].as_str().unwrap_or_default()
                        )
                    })
                    .collect()
            })
    }
}

/// A user created by a fixture.
#[derive(Debug, Clone)]
pub struct TestUser {
    pub clerk_user_id: String,
    pub user_id: Uuid,
    pub profile_id: Uuid,
    pub token: String,
}

/// What a member fixture looks like. Defaults: an active, complete, consented male profile,
/// aged 28, Muslim (Sunni), Urdu speaking, living in the largest Pakistani city of the seed.
#[derive(Debug, Clone)]
pub struct MemberSpec {
    pub gender: Gender,
    pub status: ProfileStatus,
    pub user_status: UserStatus,
    pub role: UserRole,
    pub date_of_birth: Date,
    pub marital_status: &'static str,
    pub first_name: String,
    pub last_name: String,
    /// Accept the current legal versions.
    pub consents: bool,
    /// Create a `partner_preferences` row with the column defaults.
    pub preferences: bool,
}

impl Default for MemberSpec {
    fn default() -> Self {
        Self {
            gender: Gender::Male,
            status: ProfileStatus::Active,
            user_status: UserStatus::Active,
            role: UserRole::Member,
            date_of_birth: OffsetDateTime::now_utc().date() - time::Duration::days(28 * 365 + 7),
            marital_status: "never_married",
            first_name: "Ahmed".to_owned(),
            last_name: "Khan".to_owned(),
            consents: true,
            preferences: true,
        }
    }
}

pub struct TestApp {
    pub state: AppState,
    pub router: Router,
    pub clerk: Arc<FakeClerk>,
    pub storage: Arc<MemoryStore>,
    pub email: Arc<FakeEmail>,
    pub push: Arc<FakePush>,
    pub content_safety: Arc<FakeContentSafety>,
}

impl TestApp {
    /// An app on a test database with every integration faked. Content safety starts disabled
    /// (`severity` is `None`, so calls fail as if the service were down).
    pub async fn new(db: PgPool) -> Self {
        Self::with_config(db, Config::for_tests()).await
    }

    pub async fn with_config(db: PgPool, config: Config) -> Self {
        let clerk = Arc::new(FakeClerk::default());
        let storage = Arc::new(MemoryStore::new());
        let email = Arc::new(FakeEmail::default());
        let push = Arc::new(FakePush::default());
        let content_safety = Arc::new(FakeContentSafety::default());
        let integrations = Integrations {
            jwks: Arc::new(test_jwks()),
            clerk: clerk.clone(),
            storage: storage.clone(),
            content_safety: content_safety.clone(),
            email: email.clone(),
            push: push.clone(),
        };
        let state = AppState::new(config, db, integrations)
            .await
            .expect("the test state builds");
        let router = crate::routes::app(state.clone());
        Self {
            state,
            router,
            clerk,
            storage,
            email,
            push,
            content_safety,
        }
    }

    pub fn db(&self) -> &PgPool {
        &self.state.db
    }

    /// Sends a request through the full middleware stack.
    pub async fn request_with_headers(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<String>,
        headers: &[(&str, &str)],
    ) -> TestResponse {
        let mut builder = Request::builder().method(method).uri(path);
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        if body.is_some() {
            builder = builder.header("content-type", "application/json");
        }
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        let request = builder
            .body(body.map_or_else(Body::empty, Body::from))
            .expect("valid request");
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("the router answers");
        let status = response.status();
        let headers = response.headers().clone();
        let request_id = headers
            .get("x-request-id")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("the body reads");
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        TestResponse {
            status,
            headers,
            json,
            text,
            request_id,
        }
    }

    pub async fn raw(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<String>,
    ) -> TestResponse {
        self.request_with_headers(method, path, token, body, &[])
            .await
    }

    pub async fn request(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> TestResponse {
        self.raw(method, path, token, body.map(|b| b.to_string()))
            .await
    }

    pub async fn get(&self, path: &str, token: Option<&str>) -> TestResponse {
        self.request("GET", path, token, None).await
    }

    pub async fn post(&self, path: &str, token: Option<&str>, body: Value) -> TestResponse {
        self.request("POST", path, token, Some(body)).await
    }

    /// `POST` without a body.
    pub async fn post_empty(&self, path: &str, token: Option<&str>) -> TestResponse {
        self.request("POST", path, token, None).await
    }

    pub async fn put(&self, path: &str, token: Option<&str>, body: Value) -> TestResponse {
        self.request("PUT", path, token, Some(body)).await
    }

    pub async fn patch(&self, path: &str, token: Option<&str>, body: Value) -> TestResponse {
        self.request("PATCH", path, token, Some(body)).await
    }

    pub async fn delete(&self, path: &str, token: Option<&str>) -> TestResponse {
        self.request("DELETE", path, token, None).await
    }

    /// Runs every due job until none is left.
    pub async fn drain_jobs(&self) -> usize {
        crate::jobs::worker::drain(&self.state)
            .await
            .expect("jobs run")
    }

    /// Kinds of queued jobs, for assertions.
    pub async fn queued_jobs(&self, kind: &str) -> Vec<Value> {
        sqlx::query_scalar(
            "SELECT payload FROM jobs WHERE kind = $1 AND status = 'queued' ORDER BY created_at",
        )
        .bind(kind)
        .fetch_all(self.db())
        .await
        .expect("jobs read")
    }

    /// A Clerk user known to the fake, not yet provisioned. Returns its id and token.
    pub fn clerk_user(&self, email: &str) -> (String, String) {
        let clerk_user_id = format!("user_{}", Uuid::now_v7().simple());
        self.clerk.add_user(ClerkUser {
            id: clerk_user_id.clone(),
            email: Some(email.to_lowercase()),
            email_verified: true,
            phone_e164: None,
            phone_verified: false,
        });
        let token = token_for(&clerk_user_id);
        (clerk_user_id, token)
    }

    /// A provisioned user with an empty `draft` profile, as after the first `GET /v1/me`.
    pub async fn draft_user(&self) -> TestUser {
        let (clerk_user_id, token) =
            self.clerk_user(&format!("{}@example.com", Uuid::now_v7().simple()));
        let clerk_user = self
            .clerk
            .users
            .lock()
            .unwrap()
            .get(&clerk_user_id)
            .cloned()
            .unwrap();
        crate::auth::provisioning::provision(self.db(), &self.state.crypto, &clerk_user)
            .await
            .expect("provisioning works");
        let (user_id, profile_id): (Uuid, Uuid) = sqlx::query_as(
            "SELECT u.id, p.id FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.clerk_user_id = $1",
        )
        .bind(&clerk_user_id)
        .fetch_one(self.db())
        .await
        .expect("the user exists");
        TestUser {
            clerk_user_id,
            user_id,
            profile_id,
            token,
        }
    }

    /// An active, complete member with the defaults of [`MemberSpec`].
    pub async fn member(&self) -> TestUser {
        self.member_with(|_| {}).await
    }

    /// A member of the given gender.
    pub async fn member_of(&self, gender: Gender) -> TestUser {
        self.member_with(|spec| {
            spec.gender = gender;
            if gender == Gender::Female {
                spec.first_name = "Ayesha".to_owned();
                spec.last_name = "Malik".to_owned();
            }
        })
        .await
    }

    /// A member shaped by `customise`.
    pub async fn member_with(&self, customise: impl FnOnce(&mut MemberSpec)) -> TestUser {
        let mut spec = MemberSpec::default();
        customise(&mut spec);
        let user = self.draft_user().await;
        let db = self.db();
        ensure_reference_rows(db).await;
        let city_id: Option<i32> = sqlx::query_scalar(
            "SELECT id FROM cities WHERE country_code = 'PK' ORDER BY population DESC NULLS LAST LIMIT 1",
        )
        .fetch_optional(db)
        .await
        .expect("cities read");
        let current_wives = (spec.marital_status == "married").then_some(1_i16);
        sqlx::query(
            "UPDATE profiles SET
                 managed_by = 'self', first_name = $2, last_name = $3, gender = $4, date_of_birth = $5,
                 marital_status = $6, current_wives_count = $7, children_status = 'none', height_cm = 172,
                 religion_code = 'islam', sect_code = 'sunni', mother_tongue_code = 'urdu',
                 nationality_code = 'PK', country_code = 'PK', city_id = $8,
                 city_other = CASE WHEN $8::int IS NULL THEN 'Testville' END,
                 education_level_code = 'bachelors', employment_type = 'private_job',
                 onboarding_step = 'done', onboarding_completed_at = now(),
                 status = $9,
                 first_activated_at = CASE WHEN $9 IN ('active', 'paused', 'closed', 'suspended') THEN now() END,
                 last_active_at = now(), completeness = 60, match_stale = true
             WHERE id = $1",
        )
        .bind(user.profile_id)
        .bind(&spec.first_name)
        .bind(&spec.last_name)
        .bind(spec.gender)
        .bind(spec.date_of_birth)
        .bind(spec.marital_status)
        .bind(current_wives)
        .bind(city_id)
        .bind(spec.status)
        .execute(db)
        .await
        .expect("the profile updates");
        sqlx::query("UPDATE users SET status = $2, role = $3 WHERE id = $1")
            .bind(user.user_id)
            .bind(spec.user_status)
            .bind(spec.role)
            .execute(db)
            .await
            .expect("the user updates");
        if spec.consents {
            let settings = self.state.settings.get().await.expect("settings load");
            for (document, version) in [
                ("terms", &settings.terms_version),
                ("privacy", &settings.privacy_version),
                ("community_guidelines", &settings.guidelines_version),
                ("age_declaration", &settings.terms_version),
            ] {
                sqlx::query(
                    "INSERT INTO user_consents (user_id, document, version) VALUES ($1, $2, $3)
                     ON CONFLICT DO NOTHING",
                )
                .bind(user.user_id)
                .bind(document)
                .bind(version)
                .execute(db)
                .await
                .expect("consents insert");
            }
        }
        if spec.preferences {
            sqlx::query(
                "INSERT INTO partner_preferences (profile_id) VALUES ($1) ON CONFLICT DO NOTHING",
            )
            .bind(user.profile_id)
            .execute(db)
            .await
            .expect("preferences insert");
        }
        self.state.accounts.invalidate(user.user_id);
        user
    }

    /// A staff member: `role` is `moderator` or `admin`.
    pub async fn staff(&self, role: UserRole) -> TestUser {
        self.member_with(|spec| spec.role = role).await
    }
}

/// Makes sure the reference rows that fixtures use exist, so fixtures work even on a database
/// without the seed migrations. With the seed they are no-ops.
async fn ensure_reference_rows(db: &PgPool) {
    for statement in [
        "INSERT INTO religions (code, name) VALUES ('islam', 'Islam') ON CONFLICT DO NOTHING",
        "INSERT INTO sects (code, religion_code, name) VALUES ('sunni', 'islam', 'Sunni') ON CONFLICT DO NOTHING",
        "INSERT INTO languages (code, name) VALUES ('urdu', 'Urdu') ON CONFLICT DO NOTHING",
        "INSERT INTO education_levels (code, name, rank) VALUES ('bachelors', 'Bachelor''s', 5) ON CONFLICT DO NOTHING",
        "INSERT INTO countries (code, name, dial_code, sort_order) VALUES ('PK', 'Pakistan', '+92', 10) ON CONFLICT DO NOTHING",
    ] {
        sqlx::query(statement)
            .execute(db)
            .await
            .expect("reference rows insert");
    }
}
