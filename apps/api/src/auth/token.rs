//! Clerk session token verification, performed locally (06 section 6.2).
//!
//! Every failure maps to the same `401 unauthenticated`; the precise reason is only logged at
//! `debug` level.

use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use serde::Deserialize;

use crate::auth::jwks::Jwks;
use crate::config::ClerkConfig;

/// Seconds of clock skew accepted on `exp` and `nbf`.
const LEEWAY_SECONDS: u64 = 30;

/// The claims the API uses (06 section 6.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claims {
    /// Clerk user id.
    pub sub: String,
    /// Session id. Logged, not otherwise used.
    pub sid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawClaims {
    sub: String,
    #[serde(default)]
    azp: Option<String>,
    #[serde(default)]
    sts: Option<String>,
    #[serde(default)]
    sid: Option<String>,
}

/// Why a token was refused. Never returned to the client.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TokenError {
    #[error("missing or malformed Authorization header")]
    MissingBearer,
    #[error("token header could not be decoded")]
    BadHeader,
    #[error("algorithm is not RS256")]
    WrongAlgorithm,
    #[error("token has no kid")]
    MissingKid,
    #[error("no key for kid")]
    UnknownKid,
    #[error("signature or claims invalid: {0}")]
    Invalid(String),
    #[error("azp is not an authorized party")]
    UnauthorizedParty,
    #[error("session is pending")]
    PendingSession,
    #[error("sub is empty")]
    EmptySubject,
}

/// Extracts the token from an `Authorization: Bearer <token>` header value.
pub fn bearer_token(header: Option<&str>) -> Result<&str, TokenError> {
    header
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or(TokenError::MissingBearer)
}

/// Verifies a token: steps 2 to 9 of 06 section 6.2.
pub async fn verify(token: &str, jwks: &Jwks, config: &ClerkConfig) -> Result<Claims, TokenError> {
    let header = decode_header(token).map_err(|_| TokenError::BadHeader)?;
    if header.alg != Algorithm::RS256 {
        return Err(TokenError::WrongAlgorithm);
    }
    let kid = header.kid.ok_or(TokenError::MissingKid)?;
    let key = jwks.key(&kid).await.ok_or(TokenError::UnknownKid)?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = LEEWAY_SECONDS;
    validation.validate_exp = true;
    validation.validate_nbf = true;
    validation.validate_aud = false;
    validation.set_issuer(&[config.issuer.as_str()]);
    validation.set_required_spec_claims(&["exp", "iss", "sub"]);

    let data = decode::<RawClaims>(token, &key, &validation)
        .map_err(|error| TokenError::Invalid(error.to_string()))?;
    let claims = data.claims;

    if let Some(azp) = &claims.azp
        && !config
            .authorized_parties
            .iter()
            .any(|party| party == azp.trim_end_matches('/'))
    {
        return Err(TokenError::UnauthorizedParty);
    }
    if claims.sts.as_deref() == Some("pending") {
        return Err(TokenError::PendingSession);
    }
    if claims.sub.trim().is_empty() {
        return Err(TokenError::EmptySubject);
    }
    Ok(Claims {
        sub: claims.sub,
        sid: claims.sid,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::config::Config;
    use crate::test_support::{TokenSpec, sign_token, test_jwks};

    async fn check(spec: TokenSpec) -> Result<Claims, TokenError> {
        let config = Config::for_tests();
        verify(&sign_token(&spec), &test_jwks(), &config.clerk).await
    }

    #[tokio::test]
    async fn accepts_a_valid_token() {
        let claims = check(TokenSpec::new("user_1")).await.unwrap();
        assert_eq!(claims.sub, "user_1");
    }

    #[tokio::test]
    async fn accepts_android_tokens_without_azp() {
        let mut spec = TokenSpec::new("user_1");
        spec.azp = None;
        assert!(check(spec).await.is_ok());
    }

    #[tokio::test]
    async fn refuses_expired_tokens_beyond_the_leeway() {
        let mut spec = TokenSpec::new("user_1");
        spec.exp_offset = -31;
        assert!(matches!(check(spec).await, Err(TokenError::Invalid(_))));

        let mut within = TokenSpec::new("user_1");
        within.exp_offset = -10;
        assert!(check(within).await.is_ok(), "30 s of leeway");
    }

    #[tokio::test]
    async fn refuses_tokens_not_yet_valid() {
        let mut spec = TokenSpec::new("user_1");
        spec.nbf_offset = Some(120);
        assert!(matches!(check(spec).await, Err(TokenError::Invalid(_))));
    }

    #[tokio::test]
    async fn refuses_a_wrong_issuer() {
        let mut spec = TokenSpec::new("user_1");
        spec.iss = "https://other.clerk.accounts.dev".to_owned();
        assert!(matches!(check(spec).await, Err(TokenError::Invalid(_))));
    }

    #[tokio::test]
    async fn refuses_an_unknown_azp() {
        let mut spec = TokenSpec::new("user_1");
        spec.azp = Some("https://evil.example".to_owned());
        assert_eq!(check(spec).await, Err(TokenError::UnauthorizedParty));
    }

    #[tokio::test]
    async fn refuses_pending_sessions() {
        let mut spec = TokenSpec::new("user_1");
        spec.extra = json!({ "sts": "pending" });
        assert_eq!(check(spec).await, Err(TokenError::PendingSession));
    }

    #[tokio::test]
    async fn refuses_a_bad_signature() {
        let token = sign_token(&TokenSpec::new("user_1"));
        let (rest, signature) = token.rsplit_once('.').unwrap();
        let mut bytes = signature.as_bytes().to_vec();
        bytes[5] = if bytes[5] == b'A' { b'B' } else { b'A' };
        let tampered = format!("{rest}.{}", String::from_utf8(bytes).unwrap());
        let config = Config::for_tests();
        assert!(matches!(
            verify(&tampered, &test_jwks(), &config.clerk).await,
            Err(TokenError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn refuses_unknown_kids_and_other_algorithms() {
        let mut spec = TokenSpec::new("user_1");
        spec.kid = Some("unknown".to_owned());
        assert_eq!(check(spec).await, Err(TokenError::UnknownKid));

        let mut no_kid = TokenSpec::new("user_1");
        no_kid.kid = None;
        assert_eq!(check(no_kid).await, Err(TokenError::MissingKid));

        // An HS256 token signed with a guessable secret must never pass.
        let header = jsonwebtoken::Header::new(Algorithm::HS256);
        let token = jsonwebtoken::encode(
            &header,
            &json!({ "sub": "user_1", "exp": 4_000_000_000_u64 }),
            &jsonwebtoken::EncodingKey::from_secret("secret".as_bytes()).unwrap(),
        )
        .unwrap();
        let config = Config::for_tests();
        assert_eq!(
            verify(&token, &test_jwks(), &config.clerk).await,
            Err(TokenError::WrongAlgorithm)
        );
        assert_eq!(
            verify("not a token", &test_jwks(), &config.clerk).await,
            Err(TokenError::BadHeader)
        );
    }

    #[test]
    fn reads_bearer_headers() {
        assert_eq!(bearer_token(Some("Bearer abc")), Ok("abc"));
        assert_eq!(
            bearer_token(Some("Basic abc")),
            Err(TokenError::MissingBearer)
        );
        assert_eq!(
            bearer_token(Some("Bearer ")),
            Err(TokenError::MissingBearer)
        );
        assert_eq!(bearer_token(None), Err(TokenError::MissingBearer));
    }
}
