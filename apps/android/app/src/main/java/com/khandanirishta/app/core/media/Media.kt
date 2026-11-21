package com.khandanirishta.app.core.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ApiException
import com.khandanirishta.app.core.network.UploadClient
import com.khandanirishta.app.core.network.generated.model.UploadTicket
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.source
import java.io.File
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.max

/** Why a picked photo cannot be used (specs/08 section 5.1). */
enum class PhotoProblem {
    WRONG_TYPE,
    FILE_TOO_LARGE,
    TOO_SMALL,
    PREPARED_TOO_LARGE,
    UNREADABLE,
}

class PhotoProblemException(
    val problem: PhotoProblem,
) : Exception(problem.name)

/** A JPEG ready to upload, in the app's cache directory. */
data class PreparedPhoto(
    val file: File,
    val width: Int,
    val height: Int,
) {
    val sizeBytes: Long get() = file.length()

    fun delete() {
        file.delete()
    }
}

/**
 * Prepares photos on the device before upload (specs/08 section 5.1, 12 section 4.3): checks the
 * type and size, decodes with sampling, rotates by the EXIF orientation, scales the long side down
 * to [maxSide] and re-encodes as JPEG at quality 90, which also drops embedded metadata such as
 * the location.
 */
@Singleton
class PhotoPreparer
    @Inject
    constructor(
        @param:ApplicationContext private val context: Context,
    ) {
        suspend fun prepare(
            uri: Uri,
            maxSide: Int = PROFILE_MAX_SIDE,
            minSide: Int = MIN_SIDE,
        ): Result<PreparedPhoto> =
            withContext(Dispatchers.IO) {
                runCatching {
                    val resolver = context.contentResolver
                    val type = resolver.getType(uri)
                    if (type != null && type !in ACCEPTED_TYPES) throw PhotoProblemException(PhotoProblem.WRONG_TYPE)
                    val size = resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
                    if (size > MAX_PICKED_BYTES) throw PhotoProblemException(PhotoProblem.FILE_TOO_LARGE)

                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                        throw PhotoProblemException(PhotoProblem.UNREADABLE)
                    }
                    if (bounds.outWidth < minSide || bounds.outHeight < minSide) {
                        throw PhotoProblemException(PhotoProblem.TOO_SMALL)
                    }
                    val orientation =
                        resolver.openInputStream(uri)?.use {
                            ExifInterface(
                                it,
                            ).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                        } ?: ExifInterface.ORIENTATION_NORMAL

                    var sample = 1
                    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
                    val decoded =
                        resolver.openInputStream(uri)?.use {
                            BitmapFactory.decodeStream(
                                it,
                                null,
                                BitmapFactory.Options().apply { inSampleSize = sample },
                            )
                        } ?: throw PhotoProblemException(PhotoProblem.UNREADABLE)
                    val bitmap = scale(rotate(decoded, orientation), maxSide)
                    writeJpeg(bitmap)
                }
            }

        /** Prepares a bitmap captured by the camera (selfies and document photos). */
        suspend fun prepare(
            bitmap: Bitmap,
            maxSide: Int,
        ): Result<PreparedPhoto> = withContext(Dispatchers.IO) { runCatching { writeJpeg(scale(bitmap, maxSide)) } }

        private fun writeJpeg(bitmap: Bitmap): PreparedPhoto {
            val file = File(context.cacheDir, "upload-${UUID.randomUUID()}.jpg")
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
            if (file.length() > MAX_UPLOAD_BYTES) {
                file.delete()
                throw PhotoProblemException(PhotoProblem.PREPARED_TOO_LARGE)
            }
            return PreparedPhoto(file, bitmap.width, bitmap.height)
        }

        private fun rotate(
            bitmap: Bitmap,
            orientation: Int,
        ): Bitmap {
            val matrix = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> {
                    matrix.postRotate(90f)
                }

                ExifInterface.ORIENTATION_ROTATE_180 -> {
                    matrix.postRotate(180f)
                }

                ExifInterface.ORIENTATION_ROTATE_270 -> {
                    matrix.postRotate(270f)
                }

                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> {
                    matrix.postScale(-1f, 1f)
                }

                ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
                    matrix.postScale(1f, -1f)
                }

                ExifInterface.ORIENTATION_TRANSPOSE -> {
                    matrix.postRotate(90f)
                    matrix.postScale(-1f, 1f)
                }

                ExifInterface.ORIENTATION_TRANSVERSE -> {
                    matrix.postRotate(270f)
                    matrix.postScale(-1f, 1f)
                }

                else -> {
                    return bitmap
                }
            }
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        }

        private fun scale(
            bitmap: Bitmap,
            maxSide: Int,
        ): Bitmap {
            val longSide = max(bitmap.width, bitmap.height)
            if (longSide <= maxSide) return bitmap
            val factor = maxSide.toFloat() / longSide
            return Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * factor).toInt(),
                (bitmap.height * factor).toInt(),
                true,
            )
        }

        companion object {
            const val PROFILE_MAX_SIDE = 2048
            const val SELFIE_MAX_SIDE = 1600
            const val MIN_SIDE = 400
            const val JPEG_QUALITY = 90
            const val MAX_PICKED_BYTES = 30L * 1024 * 1024
            const val MAX_UPLOAD_BYTES = 10L * 1024 * 1024
            val ACCEPTED_TYPES = setOf("image/jpeg", "image/png", "image/webp")
        }
    }

/** `PUT`s a file to a presigned R2 URL with the returned headers, reporting progress (08 section 5.2). */
@Singleton
class PresignedUploader
    @Inject
    constructor(
        @param:UploadClient private val client: OkHttpClient,
    ) {
        suspend fun put(
            ticket: UploadTicket,
            file: File,
            contentType: String = "image/jpeg",
            onProgress: (Float) -> Unit = {},
        ): Result<Unit> {
            val body = ProgressBody(file, contentType.toMediaType(), onProgress)
            val request =
                Request
                    .Builder()
                    .url(ticket.uploadUrl)
                    .put(body)
                    .apply { ticket.headers.forEach { (name, value) -> header(name, value) } }
                    .build()
            return runCatching {
                val call = client.newCall(request)
                val response = call.await()
                response.use {
                    if (!it.isSuccessful) {
                        throw ApiException(
                            ApiError(status = it.code, code = "upload_failed", message = "Upload failed (${it.code})"),
                        )
                    }
                }
            }.recoverCatching { error ->
                if (error is IOException) throw ApiException(ApiError.network(error), error) else throw error
            }
        }
    }

private class ProgressBody(
    private val file: File,
    private val type: MediaType,
    private val onProgress: (Float) -> Unit,
) : RequestBody() {
    override fun contentType(): MediaType = type

    override fun contentLength(): Long = file.length()

    override fun writeTo(sink: BufferedSink) {
        val total = contentLength().coerceAtLeast(1)
        var written = 0L
        file.source().use { source ->
            while (true) {
                val read = source.read(sink.buffer, SEGMENT)
                if (read == -1L) break
                written += read
                sink.flush()
                onProgress(written.toFloat() / total)
            }
        }
    }

    private companion object {
        const val SEGMENT = 16 * 1024L
    }
}

private suspend fun Call.await(): Response =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onResponse(
                    call: Call,
                    response: Response,
                ) {
                    continuation.resume(response)
                }

                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) {
                    if (!continuation.isCancelled) continuation.resumeWithException(e)
                }
            },
        )
    }
