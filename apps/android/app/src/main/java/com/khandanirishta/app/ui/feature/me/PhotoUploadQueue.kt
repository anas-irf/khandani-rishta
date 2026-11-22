package com.khandanirishta.app.ui.feature.me

import android.net.Uri
import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.media.PhotoPreparer
import com.khandanirishta.app.core.media.PhotoProblem
import com.khandanirishta.app.core.media.PhotoProblemException
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Where an upload slot is in the flow of specs/08 section 5.2. */
enum class PhotoUploadState {
    /** Waiting for one of the two upload places ("Waiting..."). */
    WAITING,

    /** Preparing and sending the file ("Uploading..." with progress). */
    UPLOADING,

    /** Sent; the API confirms and the photo is processed ("Processing..."). */
    PROCESSING,

    /** Three rounds failed or the server refused: "Upload failed" with "Try again". */
    FAILED,
}

/** One picked photo on its way to the server, shown in the grid with its local image. */
@Immutable
data class PhotoUploadSlot(
    val id: Long,
    val uri: Uri,
    val state: PhotoUploadState,
    val progress: Float = 0f,
)

/**
 * The uploads of the own photos (specs/08 section 5.2): each picked file gets a slot, at most two
 * run at the same time, each is prepared on the device (5.1), sent with progress and confirmed.
 * A failed transfer starts a new round with a new upload URL, up to three rounds; after that the
 * slot shows "Upload failed" with "Try again". Uploads continue while the app stays open, also
 * after the photo screen is closed (rule 5), so the queue lives as long as the app.
 */
@Singleton
class PhotoUploadQueue
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val preparer: PhotoPreparer,
        private val bus: MessageBus,
        private val me: MeRepository,
    ) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        private val mutableSlots = MutableStateFlow<List<PhotoUploadSlot>>(emptyList())
        val slots: StateFlow<List<PhotoUploadSlot>> = mutableSlots.asStateFlow()

        private val mutableConfirmed = MutableSharedFlow<OwnPhoto>(extraBufferCapacity = 16)

        /** Photos confirmed by `POST /v1/me/photos`, so the grid can show them before the refetch. */
        val confirmed: SharedFlow<OwnPhoto> = mutableConfirmed.asSharedFlow()

        private val jobs = mutableMapOf<Long, Job>()
        private var nextId = 0L

        init {
            // Signing out clears `Me`: nothing of the previous member may stay in the grid.
            scope.launch { me.me.collect { if (it == null) clear() } }
        }

        /** Adds picked photos, at most [freeSlots] of them (08 section 5.2 step 1). */
        fun add(
            uris: List<Uri>,
            freeSlots: Int,
        ) {
            if (uris.isEmpty()) return
            if (uris.size > freeSlots) bus.toast(R.string.photos_errors_limit, "max" to photosMax())
            val added =
                uris.take(freeSlots.coerceAtLeast(0)).map { uri ->
                    nextId += 1
                    PhotoUploadSlot(id = nextId, uri = uri, state = PhotoUploadState.WAITING)
                }
            if (added.isEmpty()) return
            mutableSlots.update { it + added }
            pump()
        }

        /** "Cancel upload": aborts the `PUT` and frees the slot (rule 4). */
        fun cancel(id: Long) {
            jobs.remove(id)?.cancel()
            mutableSlots.update { slots -> slots.filterNot { it.id == id } }
            pump()
        }

        /** "Try again" on a failed slot: it starts again from a new upload URL. */
        fun retry(id: Long) {
            patch(id) { it.copy(state = PhotoUploadState.WAITING, progress = 0f) }
            pump()
        }

        /** Removes a failed slot from the grid. */
        fun dismiss(id: Long) = cancel(id)

        private fun clear() {
            jobs.values.forEach { it.cancel() }
            jobs.clear()
            mutableSlots.value = emptyList()
        }

        private fun photosMax(): Long = me.current?.config?.photosMax ?: DEFAULT_MAX

        /** Starts waiting slots while fewer than two uploads run (rule 1). */
        private fun pump() {
            var free = MAX_PARALLEL - jobs.size
            for (slot in mutableSlots.value) {
                if (free <= 0) return
                if (slot.state == PhotoUploadState.WAITING && slot.id !in jobs) {
                    start(slot)
                    free -= 1
                }
            }
        }

        private fun start(slot: PhotoUploadSlot) {
            patch(slot.id) { it.copy(state = PhotoUploadState.UPLOADING, progress = 0f) }
            jobs[slot.id] =
                scope.launch {
                    try {
                        finish(slot.id, upload(slot.id, slot.uri))
                    } finally {
                        jobs.remove(slot.id)
                        pump()
                    }
                }
        }

        private suspend fun upload(
            id: Long,
            uri: Uri,
        ): Outcome {
            val prepared =
                preparer.prepare(uri).getOrElse { failure ->
                    currentCoroutineContext().ensureActive()
                    return Outcome.Problem((failure as? PhotoProblemException)?.problem ?: PhotoProblem.UNREADABLE)
                }
            try {
                var lastError = ApiError.network()
                for (round in 1..ROUNDS) {
                    val result =
                        profiles.uploadPhoto(prepared) { fraction ->
                            patch(id) { slot ->
                                if (fraction >= 1f) {
                                    slot.copy(state = PhotoUploadState.PROCESSING, progress = 1f)
                                } else {
                                    slot.copy(state = PhotoUploadState.UPLOADING, progress = fraction)
                                }
                            }
                        }
                    currentCoroutineContext().ensureActive()
                    result.getOrNull()?.let { return Outcome.Done(it) }
                    lastError = result.exceptionOrNull()?.apiError ?: ApiError.network()
                    // Only a failed transfer gets a new round with a new URL (rule 2).
                    if (!isTransferFailure(lastError) || round == ROUNDS) break
                    patch(id) { it.copy(state = PhotoUploadState.UPLOADING, progress = 0f) }
                    delay(ROUND_DELAY_MS * round)
                }
                return Outcome.Failed(lastError)
            } finally {
                prepared.delete()
            }
        }

        private fun finish(
            id: Long,
            outcome: Outcome,
        ) {
            when (outcome) {
                is Outcome.Done -> {
                    mutableConfirmed.tryEmit(outcome.photo)
                    remove(id)
                }

                is Outcome.Problem -> {
                    bus.toast(problemText(outcome.problem))
                    remove(id)
                }

                is Outcome.Failed -> {
                    val refused = refusalText(outcome.error)
                    if (refused != null) {
                        // A refusal that retrying cannot fix: its message, and the slot goes away.
                        bus.toast(refused)
                        remove(id)
                    } else {
                        // Network trouble shows on the slot; anything else also gets the generic toast.
                        if (!isTransferFailure(outcome.error)) bus.error(outcome.error)
                        patch(id) { it.copy(state = PhotoUploadState.FAILED, progress = 0f) }
                    }
                }
            }
        }

        private fun remove(id: Long) {
            mutableSlots.update { slots -> slots.filterNot { it.id == id } }
        }

        private fun patch(
            id: Long,
            change: (PhotoUploadSlot) -> PhotoUploadSlot,
        ) {
            mutableSlots.update { slots -> slots.map { if (it.id == id) change(it) else it } }
        }

        private fun isTransferFailure(error: ApiError): Boolean = error.isNetwork || error.code == UPLOAD_FAILED

        /** The messages of 08 sections 5.1 and 5.2 for a refusal that retrying cannot fix. */
        private fun refusalText(error: ApiError): UiText? =
            when (error.code) {
                ErrorCode.PAYLOAD_TOO_LARGE -> UiText.of(R.string.photos_errors_prepared_too_large)
                ErrorCode.LIMIT_REACHED -> UiText.of(R.string.photos_errors_limit, "max" to photosMax())
                ErrorCode.RATE_LIMITED -> UiText.of(R.string.photos_errors_rate_limited)
                else -> null
            }

        @StringRes
        private fun problemText(problem: PhotoProblem): Int =
            when (problem) {
                PhotoProblem.WRONG_TYPE -> R.string.photos_errors_unsupported_type
                PhotoProblem.FILE_TOO_LARGE -> R.string.photos_errors_picked_too_large
                PhotoProblem.TOO_SMALL -> R.string.photos_errors_too_small
                PhotoProblem.PREPARED_TOO_LARGE -> R.string.photos_errors_prepared_too_large
                PhotoProblem.UNREADABLE -> R.string.photos_errors_decode_failed
            }

        private sealed interface Outcome {
            data class Done(
                val photo: OwnPhoto,
            ) : Outcome

            data class Problem(
                val problem: PhotoProblem,
            ) : Outcome

            data class Failed(
                val error: ApiError,
            ) : Outcome
        }

        private companion object {
            const val MAX_PARALLEL = 2
            const val ROUNDS = 3
            const val ROUND_DELAY_MS = 800L
            const val DEFAULT_MAX = 6L

            /** The code `PresignedUploader` gives a refused `PUT` (an expired or wrong URL). */
            const val UPLOAD_FAILED = "upload_failed"
        }
    }
