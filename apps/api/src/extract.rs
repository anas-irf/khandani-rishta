//! Request extractors that answer with the API error body instead of Axum's plain-text
//! rejections (15 sections 1 and 2).

use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use serde::de::DeserializeOwned;

use crate::error::ApiError;

/// Largest accepted request body (20 section 1, S-08). Uploads go to R2 directly.
pub const BODY_LIMIT_BYTES: usize = 64 * 1024;

/// A JSON body. Malformed JSON, a wrong type, a missing content type and unknown keys (with
/// `#[serde(deny_unknown_fields)]` on the type) all answer `400 bad_request`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(request, state).await {
            Ok(axum::Json(value)) => Ok(Self(value)),
            Err(rejection) => Err(json_rejection(&rejection)),
        }
    }
}

fn json_rejection(rejection: &JsonRejection) -> ApiError {
    match rejection {
        JsonRejection::BytesRejection(inner)
            if inner.status() == axum::http::StatusCode::PAYLOAD_TOO_LARGE =>
        {
            ApiError::PayloadTooLarge {
                max_bytes: BODY_LIMIT_BYTES as u64,
            }
        }
        other => ApiError::BadRequest(other.body_text()),
    }
}

/// Query string parameters. Invalid values answer `400 bad_request`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ApiQuery<T>(pub T);

impl<S, T> FromRequestParts<S> for ApiQuery<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        axum::extract::Query::<T>::from_request_parts(parts, state)
            .await
            .map(|axum::extract::Query(value)| Self(value))
            .map_err(|rejection: QueryRejection| ApiError::BadRequest(rejection.body_text()))
    }
}

/// Path parameters. A value that does not parse (for example an id that is not a UUID) answers
/// `404 not_found`: such a resource cannot exist (20 section 1, S-04).
#[derive(Debug, Clone, Copy, Default)]
pub struct ApiPath<T>(pub T);

impl<S, T> FromRequestParts<S> for ApiPath<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        axum::extract::Path::<T>::from_request_parts(parts, state)
            .await
            .map(|axum::extract::Path(value)| Self(value))
            .map_err(|rejection: PathRejection| {
                tracing::debug!(reason = %rejection.body_text(), "path did not parse");
                ApiError::NotFound
            })
    }
}
