package com.khandanirishta.app.ui.feature.me

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.core.realtime.RealtimeClient
import com.khandanirishta.app.core.realtime.RealtimeEvent
import com.khandanirishta.app.core.realtime.RealtimeState
import com.khandanirishta.app.ui.messages.MessageBus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import javax.inject.Inject

data class PhotoManagerUiState(
    val photos: List<OwnPhoto> = emptyList(),
    val loading: Boolean = true,
    val loaded: Boolean = false,
    val error: ApiError? = null,
    /** "Make main photo", a new order or a removal is waiting for the server (rule 4: no optimism). */
    val busy: Boolean = false,
)

/**
 * The photo grid of `ME-PHOTOS` and `ONB-08` (specs/08 section 5.5): `GET /v1/me/photos` on open
 * and after every change, the `photo.updated` event, polling while a photo is `processing` and
 * the socket is down (5.2 step 6), and the changes of the main photo, the order and removals.
 */
@HiltViewModel
class PhotoManagerViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val queue: PhotoUploadQueue,
        private val meRepository: MeRepository,
        private val realtime: RealtimeClient,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(PhotoManagerUiState())
        val state: StateFlow<PhotoManagerUiState> = mutableState.asStateFlow()

        /** The uploads in progress, shown after the photos in the grid. */
        val uploads: StateFlow<List<PhotoUploadSlot>> = queue.slots

        private var loadJob: Job? = null
        private var pollJob: Job? = null
        private var signature: String? = null

        init {
            load()
            viewModelScope.launch { invalidation.on(DataKey.OwnPhotos).collect { load(silent = true) } }
            viewModelScope.launch { queue.confirmed.collect { photo -> upsert(photo) } }
            viewModelScope.launch {
                // Rule G15: after a reconnect the open screen refetches its data.
                realtime.events.collect { event ->
                    if (event is RealtimeEvent.Ready && event.afterReconnect) load(silent = true)
                }
            }
        }

        fun load(silent: Boolean = false) {
            loadJob?.cancel()
            loadJob =
                viewModelScope.launch {
                    mutableState.update { it.copy(loading = !it.loaded && !silent, error = null) }
                    profiles
                        .photos()
                        .onSuccess { photos -> showPhotos(photos) }
                        .onFailure { failure ->
                            mutableState.update {
                                it.copy(loading = false, error = if (it.loaded) null else failure.apiError)
                            }
                            schedulePoll(mutableState.value.photos)
                        }
                }
        }

        /** Adds picked photos to the upload queue, up to the free slots (08 section 5.2 step 1). */
        fun add(
            uris: List<Uri>,
            photosMax: Int,
        ) {
            val active = mutableState.value.photos.count { it.countsTowardLimit() } + uploads.value.size
            queue.add(uris, freeSlots = (photosMax - active).coerceAtLeast(0))
        }

        fun cancelUpload(id: Long) = queue.cancel(id)

        fun retryUpload(id: Long) = queue.retry(id)

        fun dismissUpload(id: Long) = queue.dismiss(id)

        /** "Make main photo": `PATCH /v1/me/photos/{id}` with `{ "is_primary": true }`. */
        fun makePrimary(photo: OwnPhoto) {
            if (mutableState.value.busy) return
            viewModelScope.launch {
                mutableState.update { it.copy(busy = true) }
                profiles
                    .setPrimary(photo.id)
                    .onSuccess { photos ->
                        showPhotos(photos)
                        bus.toast(R.string.photos_toast_main_changed)
                    }.onFailure { failure ->
                        val error = failure.apiError
                        if (error.code == ErrorCode.INVALID_STATE) {
                            bus.toast(R.string.photos_toast_main_invalid)
                        } else {
                            bus.error(error)
                        }
                    }
                mutableState.update { it.copy(busy = false) }
            }
        }

        /** "Move earlier" (-1) or "Move later" (+1): `PUT /v1/me/photos/order` with every photo once. */
        fun move(
            photo: OwnPhoto,
            delta: Int,
        ) {
            val ids = mutableState.value.photos.map { it.id }
            val next = moveId(ids, photo.id, delta)
            if (next == ids || mutableState.value.busy) return
            viewModelScope.launch {
                mutableState.update { it.copy(busy = true) }
                profiles
                    .reorder(next)
                    .onSuccess { photos -> showPhotos(photos) }
                    .onFailure { bus.toast(R.string.photos_toast_order_failed) }
                mutableState.update { it.copy(busy = false) }
            }
        }

        /** "Remove" after the confirmation: `DELETE /v1/me/photos/{id}`, then the list again. */
        fun remove(photo: OwnPhoto) {
            if (mutableState.value.busy) return
            viewModelScope.launch {
                mutableState.update { it.copy(busy = true) }
                profiles
                    .deletePhoto(photo.id)
                    .onSuccess {
                        mutableState.update { current ->
                            current.copy(photos = current.photos.filterNot { it.id == photo.id })
                        }
                        bus.toast(R.string.photos_toast_removed)
                        load(silent = true)
                    }.onFailure { bus.error(it.apiError) }
                mutableState.update { it.copy(busy = false) }
            }
        }

        private fun upsert(photo: OwnPhoto) {
            showPhotos(mutableState.value.photos.filterNot { it.id == photo.id } + photo)
        }

        private fun showPhotos(photos: List<OwnPhoto>) {
            val sorted = photos.sortedBy { it.position }
            val next = sorted.joinToString("|") { "${it.id}:${it.status.wire}:${it.isPrimary}" }
            val changed = signature != null && signature != next
            signature = next
            mutableState.update { it.copy(photos = sorted, loading = false, loaded = true, error = null) }
            // A new status or main photo changes `Me` too: the completeness and the main photo.
            if (changed) viewModelScope.launch { meRepository.refresh() }
            schedulePoll(sorted)
        }

        /**
         * Without a live socket, `GET /v1/me/photos` every 3 seconds for the first minute after the
         * newest upload, then every 15 seconds, until no photo is `processing` (08 section 5.2 step 6).
         */
        private fun schedulePoll(photos: List<OwnPhoto>) {
            pollJob?.cancel()
            val processing = photos.filter { it.status == PhotoStatus.PROCESSING }
            if (processing.isEmpty()) return
            val newest = processing.maxOf { it.createdAt }
            pollJob =
                viewModelScope.launch {
                    while (true) {
                        val age = Duration.between(newest, Instant.now()).toMillis()
                        delay(if (age < FAST_FOR_MS) FAST_MS else SLOW_MS)
                        if (realtime.state.value != RealtimeState.READY) {
                            load(silent = true)
                            return@launch
                        }
                    }
                }
        }

        private companion object {
            const val FAST_MS = 3_000L
            const val SLOW_MS = 15_000L
            const val FAST_FOR_MS = 60_000L
        }
    }
