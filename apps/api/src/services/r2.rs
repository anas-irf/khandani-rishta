//! Object storage: Cloudflare R2 through its S3 API (tech stack section 11, 08 section 5).
//!
//! The bucket is private. Clients upload and download with short-lived presigned URLs; the API
//! reads and writes objects itself only for processing. [`MemoryStore`] stands in for R2 in tests,
//! and [`DisabledStore`] when R2 is not configured.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use time::OffsetDateTime;

use crate::config::R2Config;
use crate::services::ServiceError;

/// Validity of a photo URL (08 section 5.4 rule 2).
pub const PHOTO_URL_TTL: Duration = Duration::from_secs(7200);

/// The start of the UTC hour containing `at` (08 section 5.4 rule 3).
pub fn hour_start(at: std::time::SystemTime) -> std::time::SystemTime {
    let seconds = at
        .duration_since(std::time::UNIX_EPOCH)
        .map_or_default(|d| d.as_secs());
    std::time::UNIX_EPOCH + Duration::from_secs(seconds - seconds % 3600)
}

/// A presigned upload: `PUT url` with exactly these headers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresignedPut {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

/// Metadata of a stored object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectMeta {
    pub key: String,
    pub size: u64,
    pub content_type: Option<String>,
    pub last_modified: Option<OffsetDateTime>,
}

#[async_trait]
pub trait ObjectStore: Send + Sync {
    /// False when storage is not configured; upload endpoints then answer 503.
    fn is_available(&self) -> bool;
    async fn presign_put(
        &self,
        key: &str,
        content_type: &str,
        expires_in: Duration,
    ) -> Result<PresignedPut, ServiceError>;
    async fn presign_get(&self, key: &str, expires_in: Duration) -> Result<String, ServiceError>;
    /// A photo URL per 08 section 5.4: signed at the start of the current UTC hour and valid for
    /// 2 hours, so the same file has the same URL for the whole hour.
    async fn presign_photo(&self, key: &str) -> Result<String, ServiceError>;
    /// `Ok(None)` when the object does not exist.
    async fn head(&self, key: &str) -> Result<Option<ObjectMeta>, ServiceError>;
    /// `Ok(None)` when the object does not exist.
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, ServiceError>;
    async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> Result<(), ServiceError>;
    /// Like [`ObjectStore::put`], and stores a `Cache-Control` header with the object (the
    /// photo variants use `private, max-age=3600`, 08 section 5.3 step 10). A store that cannot
    /// keep the header writes the object without it.
    async fn put_cached(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
        _cache_control: &str,
    ) -> Result<(), ServiceError> {
        self.put(key, bytes, content_type).await
    }
    /// Deletes keys; missing objects are not an error.
    async fn delete(&self, keys: &[String]) -> Result<(), ServiceError>;
    /// Every object under a prefix, all pages.
    async fn list(&self, prefix: &str) -> Result<Vec<ObjectMeta>, ServiceError>;

    /// Deletes every object under a prefix and returns how many were deleted.
    async fn delete_prefix(&self, prefix: &str) -> Result<usize, ServiceError> {
        let keys: Vec<String> = self
            .list(prefix)
            .await?
            .into_iter()
            .map(|o| o.key)
            .collect();
        for chunk in keys.chunks(1000) {
            self.delete(chunk).await?;
        }
        Ok(keys.len())
    }
}

/// The real store.
pub struct R2Store {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl R2Store {
    pub fn new(config: &R2Config) -> Self {
        let credentials = aws_sdk_s3::config::Credentials::new(
            &config.access_key_id,
            &config.secret_access_key,
            None,
            None,
            "r2",
        );
        let s3_config = aws_sdk_s3::config::Builder::new()
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .endpoint_url(&config.endpoint)
            .region(aws_sdk_s3::config::Region::new("auto"))
            .credentials_provider(credentials)
            .force_path_style(true)
            .build();
        Self {
            client: aws_sdk_s3::Client::from_conf(s3_config),
            bucket: config.bucket.clone(),
        }
    }
}

fn s3_error(context: &str, error: impl std::fmt::Display) -> ServiceError {
    ServiceError::Temporary(format!("{context}: {error}"))
}

fn presigning(expires_in: Duration) -> Result<PresigningConfig, ServiceError> {
    PresigningConfig::expires_in(expires_in)
        .map_err(|error| ServiceError::Permanent(error.to_string()))
}

#[async_trait]
impl ObjectStore for R2Store {
    fn is_available(&self) -> bool {
        true
    }

    async fn presign_put(
        &self,
        key: &str,
        content_type: &str,
        expires_in: Duration,
    ) -> Result<PresignedPut, ServiceError> {
        let request = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .presigned(presigning(expires_in)?)
            .await
            .map_err(|error| s3_error("presign put", error))?;
        Ok(PresignedPut {
            url: request.uri().to_owned(),
            headers: vec![("Content-Type".to_owned(), content_type.to_owned())],
        })
    }

    async fn presign_get(&self, key: &str, expires_in: Duration) -> Result<String, ServiceError> {
        let request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(presigning(expires_in)?)
            .await
            .map_err(|error| s3_error("presign get", error))?;
        Ok(request.uri().to_owned())
    }

    async fn presign_photo(&self, key: &str) -> Result<String, ServiceError> {
        let config = PresigningConfig::builder()
            .start_time(hour_start(std::time::SystemTime::now()))
            .expires_in(PHOTO_URL_TTL)
            .build()
            .map_err(|error| ServiceError::Permanent(error.to_string()))?;
        let request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(config)
            .await
            .map_err(|error| s3_error("presign photo", error))?;
        Ok(request.uri().to_owned())
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectMeta>, ServiceError> {
        match self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(output) => Ok(Some(ObjectMeta {
                key: key.to_owned(),
                size: output
                    .content_length()
                    .and_then(|n| u64::try_from(n).ok())
                    .unwrap_or(0),
                content_type: output.content_type().map(str::to_owned),
                last_modified: output
                    .last_modified()
                    .and_then(|at| OffsetDateTime::from_unix_timestamp(at.secs()).ok()),
            })),
            Err(error)
                if error.as_service_error().is_some_and(
                    aws_sdk_s3::operation::head_object::HeadObjectError::is_not_found,
                ) =>
            {
                Ok(None)
            }
            Err(error) => Err(s3_error(
                "head object",
                aws_sdk_s3::error::DisplayErrorContext(error),
            )),
        }
    }

    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, ServiceError> {
        match self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(output) => {
                let bytes = output
                    .body
                    .collect()
                    .await
                    .map_err(|error| s3_error("read object", error))?;
                Ok(Some(bytes.into_bytes().to_vec()))
            }
            Err(error)
                if error.as_service_error().is_some_and(
                    aws_sdk_s3::operation::get_object::GetObjectError::is_no_such_key,
                ) =>
            {
                Ok(None)
            }
            Err(error) => Err(s3_error(
                "get object",
                aws_sdk_s3::error::DisplayErrorContext(error),
            )),
        }
    }

    async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> Result<(), ServiceError> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(bytes))
            .send()
            .await
            .map_err(|error| {
                s3_error("put object", aws_sdk_s3::error::DisplayErrorContext(error))
            })?;
        Ok(())
    }

    async fn put_cached(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
        cache_control: &str,
    ) -> Result<(), ServiceError> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .cache_control(cache_control)
            .body(ByteStream::from(bytes))
            .send()
            .await
            .map_err(|error| {
                s3_error("put object", aws_sdk_s3::error::DisplayErrorContext(error))
            })?;
        Ok(())
    }

    async fn delete(&self, keys: &[String]) -> Result<(), ServiceError> {
        // One call per key keeps this simple and works on every S3-compatible store.
        for key in keys {
            self.client
                .delete_object()
                .bucket(&self.bucket)
                .key(key)
                .send()
                .await
                .map_err(|error| {
                    s3_error(
                        "delete object",
                        aws_sdk_s3::error::DisplayErrorContext(error),
                    )
                })?;
        }
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<Vec<ObjectMeta>, ServiceError> {
        let mut objects = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let output = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(prefix)
                .set_continuation_token(token.take())
                .send()
                .await
                .map_err(|error| {
                    s3_error(
                        "list objects",
                        aws_sdk_s3::error::DisplayErrorContext(error),
                    )
                })?;
            for object in output.contents() {
                if let Some(key) = object.key() {
                    objects.push(ObjectMeta {
                        key: key.to_owned(),
                        size: object
                            .size()
                            .and_then(|n| u64::try_from(n).ok())
                            .unwrap_or(0),
                        content_type: None,
                        last_modified: object
                            .last_modified()
                            .and_then(|at| OffsetDateTime::from_unix_timestamp(at.secs()).ok()),
                    });
                }
            }
            match output.next_continuation_token() {
                Some(next) if output.is_truncated() == Some(true) => token = Some(next.to_owned()),
                _ => break,
            }
        }
        Ok(objects)
    }
}

/// Storage that is not configured: every call fails with [`ServiceError::Disabled`].
pub struct DisabledStore;

#[async_trait]
impl ObjectStore for DisabledStore {
    fn is_available(&self) -> bool {
        false
    }

    async fn presign_put(
        &self,
        _: &str,
        _: &str,
        _: Duration,
    ) -> Result<PresignedPut, ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn presign_get(&self, _: &str, _: Duration) -> Result<String, ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn presign_photo(&self, _: &str) -> Result<String, ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn head(&self, _: &str) -> Result<Option<ObjectMeta>, ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn get(&self, _: &str) -> Result<Option<Vec<u8>>, ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn put(&self, _: &str, _: Vec<u8>, _: &str) -> Result<(), ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn delete(&self, _: &[String]) -> Result<(), ServiceError> {
        Err(ServiceError::Disabled)
    }

    async fn list(&self, _: &str) -> Result<Vec<ObjectMeta>, ServiceError> {
        Err(ServiceError::Disabled)
    }
}

/// An in-memory store for tests. Presigned URLs are fake but deterministic per key.
#[derive(Default)]
pub struct MemoryStore {
    objects: Mutex<BTreeMap<String, StoredObject>>,
}

#[derive(Clone)]
struct StoredObject {
    bytes: Vec<u8>,
    content_type: String,
    cache_control: Option<String>,
    last_modified: OffsetDateTime,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stores an object as a client upload would, with a chosen modification time.
    pub fn insert_at(&self, key: &str, bytes: Vec<u8>, content_type: &str, at: OffsetDateTime) {
        if let Ok(mut objects) = self.objects.lock() {
            objects.insert(
                key.to_owned(),
                StoredObject {
                    bytes,
                    content_type: content_type.to_owned(),
                    cache_control: None,
                    last_modified: at,
                },
            );
        }
    }

    /// The `Cache-Control` header stored with an object, for assertions.
    pub fn cache_control(&self, key: &str) -> Option<String> {
        self.objects.lock().ok().and_then(|objects| {
            objects
                .get(key)
                .and_then(|object| object.cache_control.clone())
        })
    }

    /// Every stored key, for assertions.
    pub fn keys(&self) -> Vec<String> {
        self.objects
            .lock()
            .map_or_default(|objects| objects.keys().cloned().collect())
    }
}

#[async_trait]
impl ObjectStore for MemoryStore {
    fn is_available(&self) -> bool {
        true
    }

    async fn presign_put(
        &self,
        key: &str,
        content_type: &str,
        expires_in: Duration,
    ) -> Result<PresignedPut, ServiceError> {
        Ok(PresignedPut {
            url: format!(
                "https://storage.test/{key}?op=put&expires={}",
                expires_in.as_secs()
            ),
            headers: vec![("Content-Type".to_owned(), content_type.to_owned())],
        })
    }

    async fn presign_get(&self, key: &str, expires_in: Duration) -> Result<String, ServiceError> {
        Ok(format!(
            "https://storage.test/{key}?op=get&expires={}",
            expires_in.as_secs()
        ))
    }

    async fn presign_photo(&self, key: &str) -> Result<String, ServiceError> {
        let hour = hour_start(std::time::SystemTime::now())
            .duration_since(std::time::UNIX_EPOCH)
            .map_or_default(|d| d.as_secs());
        Ok(format!(
            "https://storage.test/{key}?op=get&signed_at={hour}"
        ))
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectMeta>, ServiceError> {
        Ok(self.objects.lock().ok().and_then(|objects| {
            objects.get(key).map(|object| ObjectMeta {
                key: key.to_owned(),
                size: object.bytes.len() as u64,
                content_type: Some(object.content_type.clone()),
                last_modified: Some(object.last_modified),
            })
        }))
    }

    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, ServiceError> {
        Ok(self
            .objects
            .lock()
            .ok()
            .and_then(|objects| objects.get(key).map(|object| object.bytes.clone())))
    }

    async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> Result<(), ServiceError> {
        self.insert_at(key, bytes, content_type, OffsetDateTime::now_utc());
        Ok(())
    }

    async fn put_cached(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
        cache_control: &str,
    ) -> Result<(), ServiceError> {
        self.insert_at(key, bytes, content_type, OffsetDateTime::now_utc());
        if let Ok(mut objects) = self.objects.lock()
            && let Some(object) = objects.get_mut(key)
        {
            object.cache_control = Some(cache_control.to_owned());
        }
        Ok(())
    }

    async fn delete(&self, keys: &[String]) -> Result<(), ServiceError> {
        if let Ok(mut objects) = self.objects.lock() {
            for key in keys {
                objects.remove(key);
            }
        }
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<Vec<ObjectMeta>, ServiceError> {
        let Ok(objects) = self.objects.lock() else {
            return Ok(Vec::new());
        };
        Ok(objects
            .iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .map(|(key, object)| ObjectMeta {
                key: key.clone(),
                size: object.bytes.len() as u64,
                content_type: Some(object.content_type.clone()),
                last_modified: Some(object.last_modified),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_store_behaves_like_a_bucket() {
        let store = MemoryStore::new();
        store
            .put("photos/a/1.jpg", vec![1, 2, 3], "image/jpeg")
            .await
            .unwrap();
        store
            .put("photos/a/2.jpg", vec![4], "image/jpeg")
            .await
            .unwrap();
        store.put("tmp/x", vec![5], "image/png").await.unwrap();

        let head = store.head("photos/a/1.jpg").await.unwrap().unwrap();
        assert_eq!(head.size, 3);
        assert_eq!(store.get("missing").await.unwrap(), None);
        assert_eq!(store.list("photos/").await.unwrap().len(), 2);
        assert_eq!(store.delete_prefix("photos/a/").await.unwrap(), 2);
        assert_eq!(store.keys(), vec!["tmp/x".to_owned()]);
    }

    #[tokio::test]
    async fn r2_presigns_without_network() {
        let store = R2Store::new(&R2Config {
            endpoint: "https://account.r2.cloudflarestorage.com".to_owned(),
            bucket: "kr-dev-media".to_owned(),
            access_key_id: "id".to_owned(),
            secret_access_key: "secret".to_owned(),
        });
        let upload = store
            .presign_put("tmp/photos/p/u", "image/jpeg", Duration::from_secs(600))
            .await
            .unwrap();
        assert!(
            upload.url.starts_with(
                "https://account.r2.cloudflarestorage.com/kr-dev-media/tmp/photos/p/u?"
            )
        );
        assert!(upload.url.contains("X-Amz-Expires=600"));
        let download = store
            .presign_get("photos/p/1/large.jpg", Duration::from_secs(7200))
            .await
            .unwrap();
        assert!(download.contains("X-Amz-Signature="));
        let photo = store.presign_photo("photos/p/1/large.jpg").await.unwrap();
        let again = store.presign_photo("photos/p/1/large.jpg").await.unwrap();
        assert_eq!(photo, again, "the same URL within the hour");
        assert!(photo.contains("X-Amz-Expires=7200"));
    }
}
