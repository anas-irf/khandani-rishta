//! The `process_photo` job (19 section 2.2, 08 section 5.3): turns an uploaded file into the five
//! stored variants, runs the automatic check and decides the photo's status.
//!
//! The pixel work is [`build_variants`], a pure function over bytes, so it is tested without a
//! database. The rest of the job reads first, calls R2 and Azure with no transaction open, and
//! then writes the result in one transaction (19 section 1.4 rule 3).

use std::borrow::Cow;
use std::io::Cursor;
use std::sync::LazyLock;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits, Rgb, RgbImage};
use serde::Deserialize;
use serde_json::json;
use time::{Duration, OffsetDateTime};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::db::photos as db;
use crate::domain::options::PhotoRejectionReason;
use crate::domain::types::{NotificationType, PhotoStatus};
use crate::jobs::{ClaimedJob, JobOutcome, NewJob, enqueue, payload};
use crate::notify::notify;
use crate::services::ServiceError;
use crate::services::content_safety::{ImageVerdict, image_verdict, photo_moderation_record};
use crate::settings::ReviewMode;
use crate::state::AppState;

/// Either side must be at least this many pixels (08 section 5.1).
const MIN_SIDE: u32 = 400;
/// The server accepts at most this many pixels on a side.
const MAX_SIDE: u32 = 8_000;
/// And at most this many pixels in total (25 megapixels).
const MAX_PIXELS: u64 = 25_000_000;
/// Memory the decoder may use (08 section 5.3 step 5).
const MAX_ALLOC: u64 = 128 * 1024 * 1024;
/// Stored with every variant (08 section 5.3 step 10).
const CACHE_CONTROL: &str = "private, max-age=3600";
/// A rejected photo's files are kept this long in case of an appeal (08 section 5.3).
const APPEAL_RETENTION: Duration = Duration::days(30);

/// Sizes and JPEG qualities of the variants (08 section 5.3).
const LARGE_BOUND: u32 = 1_600;
const MEDIUM_BOUND: u32 = 800;
const THUMB_SIDE: u32 = 320;
const BLUR_WIDTH: u32 = 48;
const BLUR_SIGMA: f32 = 3.0;
const QUALITY_LARGE: u8 = 82;
const QUALITY_MEDIUM: u8 = 80;
const QUALITY_THUMB: u8 = 78;
const QUALITY_BLUR: u8 = 60;

/// At most one photo is decoded at a time, whatever the worker concurrency is, so a 25
/// megapixel photo cannot add to the memory of another (08 section 5.3, resource limits).
static DECODE_SLOT: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(1));

#[derive(Debug, Deserialize)]
struct Payload {
    photo_id: Uuid,
}

// ---------------------------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------------------------

/// Why a file cannot become a photo. Every case ends as status `failed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Unreadable {
    #[error("not a JPEG, PNG or WebP image")]
    Format,
    #[error("the dimensions are outside 400 to 8000 pixels or over 25 megapixels")]
    Dimensions,
    #[error("the image could not be decoded")]
    Decode,
    #[error("the image could not be encoded")]
    Encode,
}

/// The five encoded files of one photo.
#[derive(Debug)]
pub struct Variants {
    pub large: Vec<u8>,
    pub medium: Vec<u8>,
    pub thumb: Vec<u8>,
    pub blur_medium: Vec<u8>,
    pub blur_thumb: Vec<u8>,
    /// Size of the `large` variant, stored in `width` and `height`.
    pub width: u32,
    pub height: u32,
}

/// Decodes by content, applies the orientation, flattens to RGB and builds the five variants of
/// 08 section 5.3. Re-encoding drops every kind of embedded metadata, including GPS location
/// (20 section 1, S-15).
pub fn build_variants(bytes: &[u8]) -> Result<Variants, Unreadable> {
    let image = decode(bytes)?;

    // Resizing never enlarges: a source smaller than the bound keeps its size.
    let large = fit(&image, LARGE_BOUND);
    let medium = fit(&image, MEDIUM_BOUND);
    let thumb = image.resize_to_fill(THUMB_SIDE, THUMB_SIDE, FilterType::Lanczos3);
    let blur_medium = blurred(
        &medium,
        (
            BLUR_WIDTH,
            scaled_height(medium.width(), medium.height(), BLUR_WIDTH),
        ),
    );
    let blur_thumb = blurred(&thumb, (BLUR_WIDTH, BLUR_WIDTH));

    Ok(Variants {
        width: large.width(),
        height: large.height(),
        large: encode(&large, QUALITY_LARGE)?,
        medium: encode(&medium, QUALITY_MEDIUM)?,
        thumb: encode(&thumb, QUALITY_THUMB)?,
        blur_medium: encode(&blur_medium, QUALITY_BLUR)?,
        blur_thumb: encode(&blur_thumb, QUALITY_BLUR)?,
    })
}

/// Steps 3 to 7 of 08 section 5.3: identify, check the size from the header, decode with limits,
/// orient, flatten.
fn decode(bytes: &[u8]) -> Result<DynamicImage, Unreadable> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| Unreadable::Format)?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP)
    ) {
        return Err(Unreadable::Format);
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);

    let mut decoder = reader.into_decoder().map_err(|_| Unreadable::Decode)?;
    let (width, height) = decoder.dimensions();
    if width < MIN_SIDE
        || height < MIN_SIDE
        || width > MAX_SIDE
        || height > MAX_SIDE
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(Unreadable::Dimensions);
    }
    if decoder.total_bytes() > MAX_ALLOC {
        return Err(Unreadable::Decode);
    }
    // A missing or invalid tag means no rotation.
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| Unreadable::Decode)?;
    image.apply_orientation(orientation);
    Ok(DynamicImage::ImageRgb8(flatten(image)))
}

/// 8-bit RGB; transparency is composited over white.
fn flatten(image: DynamicImage) -> RgbImage {
    if !image.color().has_alpha() {
        return image.into_rgb8();
    }
    let rgba = image.into_rgba8();
    let mut flat = RgbImage::new(rgba.width(), rgba.height());
    for (source, target) in rgba.pixels().zip(flat.pixels_mut()) {
        let alpha = u32::from(source[3]);
        let over_white = |channel: u8| {
            let mixed = (u32::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255;
            u8::try_from(mixed).unwrap_or(u8::MAX)
        };
        *target = Rgb([
            over_white(source[0]),
            over_white(source[1]),
            over_white(source[2]),
        ]);
    }
    flat
}

/// The image itself when it already fits inside `bound` by `bound`, otherwise resized to fit
/// with the aspect ratio kept.
fn fit(image: &DynamicImage, bound: u32) -> Cow<'_, DynamicImage> {
    if image.width() <= bound && image.height() <= bound {
        Cow::Borrowed(image)
    } else {
        Cow::Owned(image.resize(bound, bound, FilterType::Lanczos3))
    }
}

/// The height that keeps the aspect ratio when the width becomes `new_width` (at least 1).
fn scaled_height(width: u32, height: u32, new_width: u32) -> u32 {
    let scaled =
        (u64::from(height) * u64::from(new_width) + u64::from(width) / 2) / u64::from(width.max(1));
    u32::try_from(scaled).unwrap_or(1).max(1)
}

/// Shrinks to `small`, blurs with a Gaussian and enlarges back to the original size. Nothing
/// finer than a 48 pixel wide picture survives (08 section 5.3).
fn blurred(source: &DynamicImage, small: (u32, u32)) -> DynamicImage {
    source
        .resize_exact(small.0, small.1, FilterType::Triangle)
        .blur(BLUR_SIGMA)
        .resize_exact(source.width(), source.height(), FilterType::Triangle)
}

fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, Unreadable> {
    let mut out = Vec::new();
    image
        .write_with_encoder(JpegEncoder::new_with_quality(&mut out, quality))
        .map_err(|_| Unreadable::Encode)?;
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

/// The status table of 08 section 5.3 (also 03 section 4.4): a certain violation is rejected,
/// anything uncertain or unchecked goes to a moderator, and only a clean photo under
/// `moderation.photo_review = auto` is approved. `None` means the check was unavailable.
pub fn decide(
    verdict: Option<ImageVerdict>,
    review: ReviewMode,
) -> (PhotoStatus, Option<PhotoRejectionReason>) {
    match (verdict, review) {
        (Some(ImageVerdict::Reject), _) => (
            PhotoStatus::Rejected,
            Some(PhotoRejectionReason::Inappropriate),
        ),
        (Some(ImageVerdict::Clean), ReviewMode::Auto) => (PhotoStatus::Approved, None),
        _ => (PhotoStatus::PendingReview, None),
    }
}

// ---------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------

/// The part of the row the job needs.
#[derive(Debug, sqlx::FromRow)]
struct Pending {
    id: Uuid,
    profile_id: Uuid,
    user_id: Uuid,
    status: PhotoStatus,
    upload_key: String,
}

fn variant_key(profile_id: Uuid, photo_id: Uuid, name: &str) -> String {
    format!("photos/{profile_id}/{photo_id}/{name}.jpg")
}

pub async fn run(state: &AppState, job: &ClaimedJob) -> anyhow::Result<JobOutcome> {
    let payload: Payload = payload(job)?;
    let pending: Option<Pending> = sqlx::query_as(
        "SELECT ph.id, ph.profile_id, p.user_id, ph.status, ph.upload_key
         FROM profile_photos ph JOIN profiles p ON p.id = ph.profile_id
         WHERE ph.id = $1",
    )
    .bind(payload.photo_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(pending) = pending else {
        return Ok(JobOutcome::Skipped("photo gone".to_owned()));
    };
    if pending.status != PhotoStatus::Processing {
        return Ok(JobOutcome::Skipped("not processing".to_owned()));
    }

    // Step 2: download. A missing object is a failed photo, a storage error is retried.
    let bytes = match state.storage.get(&pending.upload_key).await {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return fail(state, &pending, "upload missing").await,
        Err(error) => return transient(state, job, &pending, &error.to_string()).await,
    };

    // Steps 3 to 8, on a blocking thread and one photo at a time.
    let built = {
        let _slot = DECODE_SLOT.acquire().await?;
        tokio::task::spawn_blocking(move || build_variants(&bytes)).await?
    };
    let variants = match built {
        Ok(variants) => variants,
        Err(reason) => return fail(state, &pending, &reason.to_string()).await,
    };

    // Step 9: the automatic check on the medium variant.
    let (verdict, moderation) = moderate(state, &variants.medium).await;

    // Step 10: store the five files.
    let keys = Keys::new(pending.profile_id, pending.id);
    if let Err(error) = store_variants(state, &keys, &variants).await {
        return transient(state, job, &pending, &error.to_string()).await;
    }

    // Step 11: decide and write, with the side effects, in one transaction.
    let settings = state.settings.get().await?;
    let (status, rejection_reason) = decide(verdict, settings.photo_review);
    let decision = Decision {
        status,
        rejection_reason,
        moderation,
    };
    if !write_decision(state, &pending, &keys, &variants, &decision).await? {
        // The owner deleted the photo, or `cleanup_uploads` gave up on it, while we worked.
        enqueue(
            &state.db,
            NewJob::new("delete_objects", json!({ "keys": keys.all() })),
        )
        .await?;
        state.jobs.wake();
        return Ok(JobOutcome::Skipped("photo changed meanwhile".to_owned()));
    }
    state.jobs.wake();
    finish(state, &pending, status).await?;
    Ok(JobOutcome::Done)
}

/// What the check and the settings made of the photo.
struct Decision {
    status: PhotoStatus,
    rejection_reason: Option<PhotoRejectionReason>,
    moderation: serde_json::Value,
}

/// Step 10: the five files, as `image/jpeg` with the cache header of 08 section 5.3.
async fn store_variants(
    state: &AppState,
    keys: &Keys,
    variants: &Variants,
) -> Result<(), ServiceError> {
    for (key, bytes) in [
        (&keys.large, &variants.large),
        (&keys.medium, &variants.medium),
        (&keys.thumb, &variants.thumb),
        (&keys.blur_medium, &variants.blur_medium),
        (&keys.blur_thumb, &variants.blur_thumb),
    ] {
        state
            .storage
            .put_cached(key, bytes.clone(), "image/jpeg", CACHE_CONTROL)
            .await?;
    }
    Ok(())
}

/// Step 11: the keys, the size, the check result and the status in one transaction, with the
/// side effects of 08 section 5.3. `false` when the photo is no longer `processing`, in which
/// case nothing is written.
async fn write_decision(
    state: &AppState,
    pending: &Pending,
    keys: &Keys,
    variants: &Variants,
    decision: &Decision,
) -> anyhow::Result<bool> {
    let mut tx = state.db.begin().await?;
    db::lock_profile(&mut tx, pending.profile_id).await?;
    let updated: Option<(Uuid,)> = sqlx::query_as(
        "UPDATE profile_photos
         SET status = $2, rejection_reason = $3, key_large = $4, key_medium = $5, key_thumb = $6,
             key_blur_medium = $7, key_blur_thumb = $8, width = $9, height = $10, moderation = $11
         WHERE id = $1 AND status = 'processing'
         RETURNING id",
    )
    .bind(pending.id)
    .bind(decision.status)
    .bind(decision.rejection_reason)
    .bind(&keys.large)
    .bind(&keys.medium)
    .bind(&keys.thumb)
    .bind(&keys.blur_medium)
    .bind(&keys.blur_thumb)
    .bind(i32::try_from(variants.width).unwrap_or(i32::MAX))
    .bind(i32::try_from(variants.height).unwrap_or(i32::MAX))
    .bind(&decision.moderation)
    .fetch_optional(&mut *tx)
    .await?;
    if updated.is_none() {
        tx.rollback().await?;
        return Ok(false);
    }
    match decision.status {
        PhotoStatus::Approved => {
            db::settle(&mut tx, pending.profile_id, false).await?;
        }
        PhotoStatus::Rejected => {
            enqueue(
                &mut *tx,
                NewJob::new("delete_objects", json!({ "keys": keys.all() }))
                    .run_at(OffsetDateTime::now_utc() + APPEAL_RETENTION),
            )
            .await?;
            file_repeat_offender_report(&mut tx, pending.profile_id, pending.id).await?;
        }
        _ => {}
    }
    tx.commit().await?;
    Ok(true)
}

/// Steps 12 and 13 and what follows a commit: the temporary object, the event to the owner, the
/// notification of an automatic rejection.
async fn finish(state: &AppState, pending: &Pending, status: PhotoStatus) -> anyhow::Result<()> {
    // A failure to delete the upload only leaves it to `delete_objects`.
    if let Err(error) = state
        .storage
        .delete(std::slice::from_ref(&pending.upload_key))
        .await
    {
        tracing::warn!(%error, photo_id = %pending.id, "could not delete the upload, queueing it");
        enqueue(
            &state.db,
            NewJob::new("delete_objects", json!({ "keys": [pending.upload_key] })),
        )
        .await?;
        state.jobs.wake();
    }

    db::announce(state, pending.profile_id, &[pending.id]).await;
    match status {
        PhotoStatus::Approved => {
            tracing::info!(event = "photo.approved", photo_id = %pending.id, source = "automatic", "photo approved");
        }
        PhotoStatus::Rejected => {
            tracing::info!(event = "photo.rejected", photo_id = %pending.id, reason = "inappropriate", source = "automatic", "photo rejected");
            if let Err(error) = notify(
                state,
                pending.user_id,
                NotificationType::PhotoRejected,
                None,
                json!({ "photo_id": pending.id, "rejection_reason": "inappropriate" }),
            )
            .await
            {
                tracing::warn!(%error, "could not notify about a rejected photo");
            }
        }
        _ => {}
    }
    Ok(())
}

/// The keys of the five variants.
struct Keys {
    large: String,
    medium: String,
    thumb: String,
    blur_medium: String,
    blur_thumb: String,
}

impl Keys {
    fn new(profile_id: Uuid, photo_id: Uuid) -> Self {
        Self {
            large: variant_key(profile_id, photo_id, "large"),
            medium: variant_key(profile_id, photo_id, "medium"),
            thumb: variant_key(profile_id, photo_id, "thumb"),
            blur_medium: variant_key(profile_id, photo_id, "blur_medium"),
            blur_thumb: variant_key(profile_id, photo_id, "blur_thumb"),
        }
    }

    fn all(&self) -> Vec<&str> {
        vec![
            &self.large,
            &self.medium,
            &self.thumb,
            &self.blur_medium,
            &self.blur_thumb,
        ]
    }
}

/// Runs the automatic check. A disabled service, a quota that is used up and any service error
/// all count as `unavailable` (08 section 5.3 step 9), which sends the photo to a moderator.
async fn moderate(state: &AppState, medium: &[u8]) -> (Option<ImageVerdict>, serde_json::Value) {
    let now = OffsetDateTime::now_utc();
    if !state.content_safety.is_enabled() {
        return (None, photo_moderation_record(None, None, now));
    }
    match state.content_safety.analyze_image(medium).await {
        Ok(analysis) => {
            let verdict = image_verdict(&analysis);
            let record = photo_moderation_record(Some(&analysis), Some(verdict), now);
            (Some(verdict), record)
        }
        Err(error) => {
            tracing::warn!(%error, "the automatic photo check is unavailable");
            (None, photo_moderation_record(None, None, now))
        }
    }
}

/// Two automatic rejections within 24 hours file a `system` report with the reason
/// `inappropriate_photo` (13 section 4.2), unless one was already filed in that time.
async fn file_repeat_offender_report(
    tx: &mut sqlx::PgConnection,
    profile_id: Uuid,
    photo_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO reports (id, source, target_profile_id, subject_type, photo_id, reason, context)
         SELECT $1, 'system', $2, 'photo', $3, 'inappropriate_photo',
                '{\"trigger\": \"two_automatic_photo_rejections_in_24_hours\"}'::jsonb
         WHERE (SELECT count(*) FROM profile_photos
                 WHERE profile_id = $2 AND status = 'rejected' AND rejection_reason = 'inappropriate'
                   AND reviewed_by IS NULL AND updated_at > now() - interval '24 hours') >= 2
           AND NOT EXISTS (SELECT 1 FROM reports
                            WHERE target_profile_id = $2 AND source = 'system'
                              AND reason = 'inappropriate_photo'
                              AND created_at > now() - interval '24 hours')",
    )
    .bind(Uuid::now_v7())
    .bind(profile_id)
    .bind(photo_id)
    .execute(tx)
    .await?;
    Ok(())
}

/// Sets the photo to `failed`, queues the temporary object for deletion and tells the owner
/// (19 section 2.2 step 2).
async fn fail(state: &AppState, pending: &Pending, reason: &str) -> anyhow::Result<JobOutcome> {
    let mut tx = state.db.begin().await?;
    db::lock_profile(&mut tx, pending.profile_id).await?;
    let updated = sqlx::query(
        "UPDATE profile_photos SET status = 'failed' WHERE id = $1 AND status = 'processing'",
    )
    .bind(pending.id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 1 {
        enqueue(
            &mut *tx,
            NewJob::new("delete_objects", json!({ "keys": [pending.upload_key] })),
        )
        .await?;
    }
    tx.commit().await?;
    state.jobs.wake();
    if updated == 1 {
        tracing::warn!(photo_id = %pending.id, %reason, "photo could not be processed");
        db::announce(state, pending.profile_id, &[pending.id]).await;
    }
    Ok(JobOutcome::Done)
}

/// A storage failure: retried by the runner, and the photo is set to `failed` when the attempts
/// are used up (08 section 5.3, "Retries").
async fn transient(
    state: &AppState,
    job: &ClaimedJob,
    pending: &Pending,
    error: &str,
) -> anyhow::Result<JobOutcome> {
    if job.is_last_attempt() {
        fail(state, pending, "out of attempts").await?;
    }
    Err(anyhow::anyhow!("photo storage failed: {error}"))
}

#[cfg(test)]
pub(crate) mod tests {
    use image::ImageEncoder;
    use image::codecs::png::PngEncoder;
    use image::{ExtendedColorType, GenericImageView, Rgba, RgbaImage};

    use super::*;

    /// A picture with real detail: diagonal stripes of different widths and a noisy pattern, so
    /// that blurring visibly removes information.
    pub(crate) fn test_picture(width: u32, height: u32) -> RgbImage {
        RgbImage::from_fn(width, height, |x, y| {
            let stripe = if (x / 7 + y / 5) % 2 == 0 { 220 } else { 30 };
            let noise = u8::try_from((x * 31 + y * 17) % 40).unwrap_or(0);
            Rgb([
                stripe,
                noise.saturating_mul(5),
                u8::try_from((x + y) % 256).unwrap_or(0),
            ])
        })
    }

    pub(crate) fn jpeg_bytes(image: &RgbImage) -> Vec<u8> {
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 90)
            .encode_image(image)
            .unwrap();
        out
    }

    fn dimensions(bytes: &[u8]) -> (u32, u32) {
        image::load_from_memory(bytes).unwrap().dimensions()
    }

    /// The mean absolute difference between neighbouring pixels: a measure of detail.
    #[allow(
        clippy::cast_precision_loss,
        reason = "pixel counts are far below 2^52"
    )]
    fn detail(bytes: &[u8]) -> f64 {
        let image = image::load_from_memory(bytes).unwrap().to_luma8();
        let (width, height) = image.dimensions();
        let mut total = 0_u64;
        let mut count = 0_u64;
        for y in 0..height {
            for x in 1..width {
                let a = i32::from(image.get_pixel(x - 1, y)[0]);
                let b = i32::from(image.get_pixel(x, y)[0]);
                total += u64::from((a - b).unsigned_abs());
                count += 1;
            }
        }
        total as f64 / count.max(1) as f64
    }

    #[test]
    fn a_large_photo_gets_the_documented_sizes() {
        let source = jpeg_bytes(&test_picture(2_400, 1_800));
        let variants = build_variants(&source).unwrap();
        assert_eq!(dimensions(&variants.large), (1_600, 1_200));
        assert_eq!((variants.width, variants.height), (1_600, 1_200));
        assert_eq!(dimensions(&variants.medium), (800, 600));
        assert_eq!(dimensions(&variants.thumb), (320, 320));
        assert_eq!(dimensions(&variants.blur_medium), (800, 600));
        assert_eq!(dimensions(&variants.blur_thumb), (320, 320));
    }

    #[test]
    fn a_small_photo_is_never_enlarged() {
        let source = jpeg_bytes(&test_picture(500, 700));
        let variants = build_variants(&source).unwrap();
        assert_eq!(dimensions(&variants.large), (500, 700));
        assert_eq!(dimensions(&variants.medium), (500, 700));
        assert_eq!(dimensions(&variants.thumb), (320, 320));
        assert_eq!(dimensions(&variants.blur_medium), (500, 700));
    }

    #[test]
    fn the_blurred_variants_hold_no_detail() {
        let source = jpeg_bytes(&test_picture(900, 900));
        let variants = build_variants(&source).unwrap();
        let sharp = detail(&variants.medium);
        let blurred = detail(&variants.blur_medium);
        assert!(sharp > 20.0, "the test picture has detail: {sharp}");
        assert!(
            blurred < sharp / 5.0,
            "blurred {blurred} against sharp {sharp}"
        );
        assert!(detail(&variants.blur_thumb) < detail(&variants.thumb) / 5.0);
    }

    #[test]
    fn exif_orientation_is_applied_and_metadata_is_dropped() {
        // A 600 by 450 photo marked "rotate 90 degrees clockwise" (EXIF orientation 6) with a
        // GPS-looking APP1 segment.
        let plain = jpeg_bytes(&test_picture(600, 450));
        let tagged = with_exif_orientation(&plain, 6);
        assert!(contains(&tagged, b"Exif"));
        let variants = build_variants(&tagged).unwrap();
        assert_eq!(dimensions(&variants.large), (450, 600), "rotated");
        for file in [&variants.large, &variants.medium, &variants.thumb] {
            assert!(!contains(file, b"Exif"), "metadata survived re-encoding");
        }
    }

    #[test]
    fn transparency_is_composited_over_white() {
        let mut picture = RgbaImage::from_pixel(500, 500, Rgba([0, 0, 0, 0]));
        for y in 100..400 {
            for x in 100..400 {
                picture.put_pixel(x, y, Rgba([200, 20, 20, 255]));
            }
        }
        let mut png = Vec::new();
        PngEncoder::new(&mut png)
            .write_image(picture.as_raw(), 500, 500, ExtendedColorType::Rgba8)
            .unwrap();
        let variants = build_variants(&png).unwrap();
        let large = image::load_from_memory(&variants.large).unwrap().to_rgb8();
        let corner = large.get_pixel(5, 5);
        assert!(
            corner.0.iter().all(|c| *c > 245),
            "white corner, got {corner:?}"
        );
        let middle = large.get_pixel(250, 250);
        assert!(
            middle[0] > 150 && middle[1] < 80,
            "red middle, got {middle:?}"
        );
    }

    #[test]
    fn unreadable_files_are_refused_by_content_not_by_name() {
        assert_eq!(
            build_variants(b"this is just a text file renamed to .jpg").unwrap_err(),
            Unreadable::Format
        );
        assert_eq!(build_variants(&[]).unwrap_err(), Unreadable::Format);
        // A file that starts like a JPEG is recognised as one and then fails to decode.
        let mut fake = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        fake.extend_from_slice(b"JFIF\0 and then only words, no image data at all");
        assert!(matches!(
            build_variants(&fake).unwrap_err(),
            Unreadable::Decode | Unreadable::Dimensions
        ));
        // Only the first bytes of a real JPEG: the size cannot even be read.
        let source = jpeg_bytes(&test_picture(600, 600));
        assert!(build_variants(&source[..20]).is_err());
    }

    #[test]
    fn dimensions_are_checked_before_decoding() {
        let too_small = jpeg_bytes(&test_picture(399, 800));
        assert_eq!(
            build_variants(&too_small).unwrap_err(),
            Unreadable::Dimensions
        );
        let thin = jpeg_bytes(&test_picture(800, 399));
        assert_eq!(build_variants(&thin).unwrap_err(), Unreadable::Dimensions);
        let exactly = jpeg_bytes(&test_picture(400, 400));
        assert!(build_variants(&exactly).is_ok());
    }

    #[test]
    fn the_status_table_of_08_section_5_3() {
        use PhotoStatus::{Approved, PendingReview, Rejected};
        let inappropriate = Some(PhotoRejectionReason::Inappropriate);
        for review in [ReviewMode::Auto, ReviewMode::Manual] {
            assert_eq!(
                decide(Some(ImageVerdict::Reject), review),
                (Rejected, inappropriate)
            );
            assert_eq!(
                decide(Some(ImageVerdict::Flag), review),
                (PendingReview, None)
            );
            assert_eq!(decide(None, review), (PendingReview, None));
        }
        assert_eq!(
            decide(Some(ImageVerdict::Clean), ReviewMode::Manual),
            (PendingReview, None)
        );
        assert_eq!(
            decide(Some(ImageVerdict::Clean), ReviewMode::Auto),
            (Approved, None)
        );
    }

    #[test]
    fn variant_keys_follow_the_layout() {
        let profile = Uuid::now_v7();
        let photo = Uuid::now_v7();
        assert_eq!(
            variant_key(profile, photo, "blur_thumb"),
            format!("photos/{profile}/{photo}/blur_thumb.jpg")
        );
        assert_eq!(scaled_height(800, 600, 48), 36);
        assert_eq!(scaled_height(10_000, 1, 48), 1);
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    /// Inserts an APP1 Exif segment holding only the orientation tag right after the SOI marker.
    pub(crate) fn with_exif_orientation(jpeg: &[u8], orientation: u8) -> Vec<u8> {
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II*\0");
        tiff.extend_from_slice(&8_u32.to_le_bytes());
        tiff.extend_from_slice(&1_u16.to_le_bytes());
        tiff.extend_from_slice(&0x0112_u16.to_le_bytes());
        tiff.extend_from_slice(&3_u16.to_le_bytes());
        tiff.extend_from_slice(&1_u32.to_le_bytes());
        tiff.extend_from_slice(&u16::from(orientation).to_le_bytes());
        tiff.extend_from_slice(&[0, 0]);
        tiff.extend_from_slice(&0_u32.to_le_bytes());
        let mut segment = b"Exif\0\0".to_vec();
        segment.extend_from_slice(&tiff);
        let length = u16::try_from(segment.len() + 2).unwrap();
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
        out.extend_from_slice(&length.to_be_bytes());
        out.extend_from_slice(&segment);
        out.extend_from_slice(&jpeg[2..]);
        out
    }
}
