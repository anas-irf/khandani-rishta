package com.khandanirishta.app.ui.feature.me

import android.graphics.Bitmap
import android.net.Uri
import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.VerificationRepository
import com.khandanirishta.app.core.media.PhotoPreparer
import com.khandanirishta.app.core.media.PhotoProblem
import com.khandanirishta.app.core.media.PhotoProblemException
import com.khandanirishta.app.core.media.PreparedPhoto
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.DocumentType
import com.khandanirishta.app.core.network.generated.model.FieldCode
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.core.network.generated.model.IdentityStatus
import com.khandanirishta.app.core.network.generated.model.IdentitySummary
import com.khandanirishta.app.core.network.generated.model.SelfieChallenge
import com.khandanirishta.app.core.network.generated.model.UploadSlot
import com.khandanirishta.app.core.network.generated.model.VerificationKind
import com.khandanirishta.app.core.network.generated.model.VerificationOverview
import com.khandanirishta.app.core.network.generated.model.VerificationRequestSummary
import com.khandanirishta.app.core.network.generated.model.VerificationStatus
import com.khandanirishta.app.ui.messages.MessageBus
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ---------------------------------------------------------------------------
// ME-VERIFY (specs/16 section 6.21)
// ---------------------------------------------------------------------------

@Immutable
data class VerificationUiState(
    val overview: VerificationOverview? = null,
    val loading: Boolean = true,
    val error: ApiError? = null,
    val cancelling: Boolean = false,
)

/** The verification centre: `GET /v1/me/verifications` on open and after every change. */
@HiltViewModel
class VerificationViewModel
    @Inject
    constructor(
        private val verifications: VerificationRepository,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(VerificationUiState())
        val state: StateFlow<VerificationUiState> = mutableState.asStateFlow()

        private var loadJob: Job? = null

        init {
            load()
            viewModelScope.launch { invalidation.on(DataKey.Verifications).collect { load(silent = true) } }
        }

        fun load(silent: Boolean = false) {
            loadJob?.cancel()
            loadJob =
                viewModelScope.launch {
                    mutableState.update { it.copy(loading = it.overview == null && !silent, error = null) }
                    verifications
                        .overview()
                        .onSuccess { overview -> mutableState.update { it.copy(overview = overview, loading = false) } }
                        .onFailure { failure ->
                            mutableState.update {
                                it.copy(loading = false, error = if (it.overview == null) failure.apiError else null)
                            }
                        }
                }
        }

        /** Returning from a sub-screen refetches the state (16 section 6.21). */
        fun onVisible() {
            if (mutableState.value.overview != null) load(silent = true)
        }

        /** "Cancel request" after its confirmation: `DELETE /v1/me/verifications/{request_id}`. */
        fun cancel(request: VerificationRequestSummary) {
            if (mutableState.value.cancelling) return
            viewModelScope.launch {
                mutableState.update { it.copy(cancelling = true) }
                verifications
                    .cancel(request.id)
                    .onSuccess { bus.toast(R.string.verification_centre_cancel_done) }
                    .onFailure { failure ->
                        bus.error(failure.apiError)
                        load(silent = true)
                    }
                mutableState.update { it.copy(cancelling = false) }
            }
        }
    }

// ---------------------------------------------------------------------------
// Shared by the selfie and identity flows
// ---------------------------------------------------------------------------

/** One-off results of a verification flow that the screen acts on. */
sealed interface VerifyEvent {
    /** Back to `ME-VERIFY` (16 sections 6.22 and 6.23: `already_exists`, `invalid_state`). */
    data object ReturnToCentre : VerifyEvent
}

/** `validation_failed` on `gesture` with code `mismatch`: the challenge is older than yesterday's. */
private fun ApiError.isGestureMismatch(): Boolean =
    code == ErrorCode.VALIDATION_FAILED && fields.any { it.field == "gesture" && it.code == FieldCode.MISMATCH }

/** `validation_failed` on `back_key` with code `required`: the back of the card is missing. */
private fun ApiError.isBackRequired(): Boolean =
    code == ErrorCode.VALIDATION_FAILED && fields.any { it.field == "back_key" && it.code == FieldCode.REQUIRED }

/** The message for a photo that cannot be used (the `verification` copy). */
@StringRes
private fun preparationProblem(failure: Throwable): Int =
    when ((failure as? PhotoProblemException)?.problem) {
        PhotoProblem.WRONG_TYPE -> R.string.verification_errors_unsupported_type
        PhotoProblem.FILE_TOO_LARGE, PhotoProblem.PREPARED_TOO_LARGE -> R.string.verification_errors_too_large
        else -> R.string.verification_errors_unreadable
    }

// ---------------------------------------------------------------------------
// ME-VERIFY-SELFIE (specs/16 section 6.22)
// ---------------------------------------------------------------------------

enum class SelfieStep { EXPLAIN, GESTURE, CAMERA, REVIEW, SUBMIT, DONE }

@Immutable
data class SelfieUiState(
    val step: SelfieStep = SelfieStep.EXPLAIN,
    val gesture: Gesture? = null,
    val challengeError: ApiError? = null,
    /** The captured selfie, prepared: at most 1,600 pixels on the long side, JPEG (12 section 4.3). */
    val photo: PreparedPhoto? = null,
    val preparing: Boolean = false,
    @param:StringRes val notice: Int? = null,
    @param:StringRes val error: Int? = null,
    /** The single progress of the three calls, 0 to 1, while sending. */
    val progress: Float? = null,
    /** `invalid_state` on submit: no approved photo (12 section 4.1). */
    val noPhoto: Boolean = false,
)

/**
 * The selfie flow: explain, the day's gesture, the front camera, review, upload and submit with one
 * progress, done; with the error cases of 16 section 6.22.
 */
@HiltViewModel
class VerifySelfieViewModel
    @Inject
    constructor(
        private val verifications: VerificationRepository,
        private val preparer: PhotoPreparer,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(SelfieUiState())
        val state: StateFlow<SelfieUiState> = mutableState.asStateFlow()

        private val mutableEvents = MutableSharedFlow<VerifyEvent>(extraBufferCapacity = 4)
        val events: SharedFlow<VerifyEvent> = mutableEvents.asSharedFlow()

        private var challengeJob: Job? = null

        init {
            loadChallenge()
        }

        /** `GET /v1/me/verifications/selfie-challenge`: today's gesture (12 section 4.2). */
        fun loadChallenge() {
            challengeJob?.cancel()
            challengeJob =
                viewModelScope.launch {
                    mutableState.update { it.copy(challengeError = null) }
                    verifications
                        .selfieChallenge()
                        .onSuccess { challenge ->
                            if (challenge.gesture == Gesture.UNKNOWN) {
                                mutableState.update { it.copy(challengeError = ApiError.unreadable(200, null)) }
                            } else {
                                mutableState.update { it.copy(gesture = challenge.gesture) }
                            }
                        }.onFailure { failure -> mutableState.update { it.copy(challengeError = failure.apiError) } }
                }
        }

        fun toGesture() {
            mutableState.update { it.copy(step = SelfieStep.GESTURE, error = null) }
        }

        fun openCamera() {
            if (mutableState.value.gesture == null) return
            mutableState.update { it.copy(step = SelfieStep.CAMERA, notice = null, error = null) }
        }

        fun onCaptured(bitmap: Bitmap) {
            viewModelScope.launch {
                mutableState.update { it.copy(preparing = true, error = null) }
                preparer
                    .prepare(bitmap, PhotoPreparer.SELFIE_MAX_SIDE)
                    .onSuccess { photo ->
                        mutableState.value.photo?.delete()
                        mutableState.update { it.copy(photo = photo, preparing = false, step = SelfieStep.REVIEW) }
                    }.onFailure { failure ->
                        mutableState.update {
                            it.copy(preparing = false, step = SelfieStep.GESTURE, error = preparationProblem(failure))
                        }
                    }
            }
        }

        /** "Retake": back to the camera. */
        fun retake() {
            mutableState.value.photo?.delete()
            mutableState.update { it.copy(photo = null, error = null, step = SelfieStep.CAMERA) }
        }

        /** "Use this photo". */
        fun usePhoto() {
            if (mutableState.value.photo == null) return
            mutableState.update { it.copy(step = SelfieStep.SUBMIT, error = null) }
        }

        /** Step 5: the upload round of the slot `selfie`, then `POST /v1/me/verifications`. */
        fun submit() {
            val current = mutableState.value
            val photo = current.photo ?: return
            val gesture = current.gesture ?: return
            if (current.progress != null) return
            viewModelScope.launch {
                mutableState.update { it.copy(progress = 0f, error = null) }
                val key =
                    verifications
                        .upload(UploadSlot.SELFIE, photo) { fraction ->
                            mutableState.update { it.copy(progress = fraction * UPLOAD_SHARE) }
                        }.getOrElse { failure ->
                            fail(failure.apiError)
                            return@launch
                        }
                mutableState.update { it.copy(progress = UPLOAD_SHARE) }
                verifications
                    .submitSelfie(key, gesture.wire)
                    .onSuccess {
                        photo.delete()
                        mutableState.update { it.copy(step = SelfieStep.DONE, progress = null, photo = null) }
                    }.onFailure { failure -> fail(failure.apiError) }
            }
        }

        private suspend fun fail(error: ApiError) {
            mutableState.update { it.copy(progress = null) }
            when {
                error.code == ErrorCode.INVALID_STATE -> {
                    mutableState.update { it.copy(noPhoto = true) }
                }

                error.code == ErrorCode.ALREADY_EXISTS -> {
                    bus.toast(R.string.verification_selfie_already_exists)
                    mutableEvents.emit(VerifyEvent.ReturnToCentre)
                }

                error.isGestureMismatch() -> {
                    // A new gesture and a new selfie, from step 2.
                    mutableState.value.photo?.delete()
                    mutableState.update {
                        it.copy(
                            photo = null,
                            gesture = null,
                            step = SelfieStep.GESTURE,
                            notice = R.string.verification_gesture_changed,
                        )
                    }
                    loadChallenge()
                }

                error.code == ErrorCode.PAYLOAD_TOO_LARGE -> {
                    mutableState.update { it.copy(error = R.string.verification_errors_too_large) }
                }

                else -> {
                    mutableState.update { it.copy(error = R.string.verification_errors_upload_failed) }
                }
            }
        }

        /** After "Add a photo first": the flag is cleared so a new photo can be used on return. */
        fun clearNoPhoto() {
            mutableState.update { it.copy(noPhoto = false) }
        }

        /** System Back inside the flow goes to the previous step; `false` leaves the screen. */
        fun back(): Boolean {
            val step = mutableState.value.step
            val previous =
                when (step) {
                    SelfieStep.GESTURE -> SelfieStep.EXPLAIN
                    SelfieStep.CAMERA, SelfieStep.REVIEW -> SelfieStep.GESTURE
                    SelfieStep.SUBMIT -> SelfieStep.REVIEW
                    SelfieStep.EXPLAIN, SelfieStep.DONE -> return false
                }
            if (mutableState.value.progress != null) return true
            mutableState.update { it.copy(step = previous, error = null) }
            return true
        }

        override fun onCleared() {
            mutableState.value.photo?.delete()
        }

        private companion object {
            /** The upload takes most of the single progress bar; the submit call the rest. */
            const val UPLOAD_SHARE = 0.9f
        }
    }

// ---------------------------------------------------------------------------
// ME-VERIFY-ID (specs/16 section 6.23)
// ---------------------------------------------------------------------------

enum class IdStep { NUMBER, FRONT, BACK, GESTURE, CAMERA, REVIEW, SUBMIT, DONE }

/** Why the identity flow cannot start: already verified, or a request is under review. */
enum class IdBlock { VERIFIED, PENDING }

@Immutable
data class IdentityUiState(
    val loading: Boolean = true,
    val error: ApiError? = null,
    val blocked: IdBlock? = null,
    val identity: IdentitySummary? = null,
    val step: IdStep = IdStep.FRONT,
    /** The back camera is open for the current card step. */
    val cardCamera: Boolean = false,
    /** The card photo being reviewed, before "Use this photo". */
    val candidate: PreparedPhoto? = null,
    val front: PreparedPhoto? = null,
    val back: PreparedPhoto? = null,
    val selfie: PreparedPhoto? = null,
    val gesture: Gesture? = null,
    val challengeError: ApiError? = null,
    val preparing: Boolean = false,
    @param:StringRes val stepError: Int? = null,
    @param:StringRes val notice: Int? = null,
    @param:StringRes val submitError: Int? = null,
    val submitting: Boolean = false,
    /** The slot being uploaded, or `null` while the request itself is sent. */
    val progressSlot: UploadSlot? = null,
    val progress: Float = 0f,
) {
    val passport: Boolean get() = identity?.documentType == DocumentType.PASSPORT

    /** The upload rounds: front, back and selfie, or front and selfie for a passport (12 section 5.2). */
    val slots: List<UploadSlot>
        get() =
            if (passport) {
                listOf(UploadSlot.FRONT, UploadSlot.SELFIE)
            } else {
                listOf(UploadSlot.FRONT, UploadSlot.BACK, UploadSlot.SELFIE)
            }
}

/**
 * The identity flow: the document number when missing (or when changing it), the front and back
 * of the card with the back camera or the Photo Picker, the selfie with the day's gesture, three
 * upload rounds with one progress, and the request (16 section 6.23).
 */
@HiltViewModel(assistedFactory = VerifyIdentityViewModel.Factory::class)
class VerifyIdentityViewModel
    @AssistedInject
    constructor(
        @Assisted private val changeNumber: Boolean,
        private val verifications: VerificationRepository,
        private val preparer: PhotoPreparer,
        private val invalidation: Invalidation,
        private val bus: MessageBus,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(changeNumber: Boolean): VerifyIdentityViewModel
        }

        private val mutableState = MutableStateFlow(IdentityUiState())
        val state: StateFlow<IdentityUiState> = mutableState.asStateFlow()

        private val mutableEvents = MutableSharedFlow<VerifyEvent>(extraBufferCapacity = 4)
        val events: SharedFlow<VerifyEvent> = mutableEvents.asSharedFlow()

        /** Upload keys of the rounds that succeeded; a failed submit retries only the others. */
        private val keys = mutableMapOf<UploadSlot, String>()
        private var challengeJob: Job? = null

        init {
            load()
        }

        fun load() {
            viewModelScope.launch {
                mutableState.update { it.copy(loading = true, error = null) }
                val challenge = async { verifications.selfieChallenge() }
                verifications
                    .overview()
                    .onSuccess { overview ->
                        val newest = newestRequest(overview.requests, VerificationKind.ID_DOCUMENT)
                        val pending =
                            overview.identity?.status == IdentityStatus.PENDING ||
                                newest?.status == VerificationStatus.PENDING
                        mutableState.update {
                            it.copy(
                                loading = false,
                                identity = overview.identity,
                                blocked =
                                    when {
                                        overview.idVerified -> IdBlock.VERIFIED
                                        pending -> IdBlock.PENDING
                                        else -> null
                                    },
                                step = if (overview.identity == null || changeNumber) IdStep.NUMBER else IdStep.FRONT,
                            )
                        }
                    }.onFailure { failure ->
                        mutableState.update { it.copy(loading = false, error = failure.apiError) }
                    }
                applyChallenge(challenge.await())
            }
        }

        private fun loadChallenge() {
            challengeJob?.cancel()
            challengeJob =
                viewModelScope.launch {
                    mutableState.update { it.copy(challengeError = null) }
                    applyChallenge(verifications.selfieChallenge())
                }
        }

        fun retryChallenge() = loadChallenge()

        private fun applyChallenge(result: Result<SelfieChallenge>) {
            result
                .onSuccess { challenge ->
                    if (challenge.gesture == Gesture.UNKNOWN) {
                        mutableState.update { it.copy(challengeError = ApiError.unreadable(200, null)) }
                    } else {
                        mutableState.update { it.copy(gesture = challenge.gesture, challengeError = null) }
                    }
                }.onFailure { failure -> mutableState.update { it.copy(challengeError = failure.apiError) } }
        }

        /** Step 1 done: the number is registered (`PUT /v1/me/identity`). */
        fun onNumberSaved(summary: IdentitySummary) {
            mutableState.update { it.copy(identity = summary, step = IdStep.FRONT, stepError = null) }
        }

        fun openCardCamera() {
            mutableState.update { it.copy(cardCamera = true, stepError = null) }
        }

        fun closeCardCamera() {
            mutableState.update { it.copy(cardCamera = false) }
        }

        /** A card photo from the back camera, prepared like a profile photo (2,048 pixels). */
        fun onCardCaptured(bitmap: Bitmap) {
            mutableState.update { it.copy(cardCamera = false) }
            prepareCard { preparer.prepare(bitmap, PhotoPreparer.PROFILE_MAX_SIDE) }
        }

        /** A card photo from the Photo Picker, prepared like a profile photo (08 section 5.1). */
        fun onCardPicked(uri: Uri) {
            prepareCard { preparer.prepare(uri) }
        }

        private fun prepareCard(prepare: suspend () -> Result<PreparedPhoto>) {
            viewModelScope.launch {
                mutableState.update { it.copy(preparing = true, stepError = null) }
                prepare()
                    .onSuccess { photo ->
                        mutableState.value.candidate?.delete()
                        mutableState.update { it.copy(candidate = photo, preparing = false) }
                    }.onFailure { failure ->
                        mutableState.update { it.copy(preparing = false, stepError = preparationProblem(failure)) }
                    }
            }
        }

        fun retakeCard() {
            mutableState.value.candidate?.delete()
            mutableState.update { it.copy(candidate = null, stepError = null) }
        }

        /** "Use this photo" on a card photo: the front leads to the back, or to the selfie for a passport. */
        fun useCard() {
            val current = mutableState.value
            val photo = current.candidate ?: return
            if (current.step == IdStep.FRONT) {
                current.front?.delete()
                keys.remove(UploadSlot.FRONT)
                mutableState.update {
                    it.copy(front = photo, candidate = null, step = if (it.passport) IdStep.GESTURE else IdStep.BACK)
                }
            } else {
                current.back?.delete()
                keys.remove(UploadSlot.BACK)
                mutableState.update { it.copy(back = photo, candidate = null, step = IdStep.GESTURE) }
            }
        }

        fun openSelfieCamera() {
            if (mutableState.value.gesture == null) return
            mutableState.update { it.copy(step = IdStep.CAMERA, notice = null, stepError = null) }
        }

        fun onSelfieCaptured(bitmap: Bitmap) {
            viewModelScope.launch {
                mutableState.update { it.copy(preparing = true, stepError = null) }
                preparer
                    .prepare(bitmap, PhotoPreparer.SELFIE_MAX_SIDE)
                    .onSuccess { photo ->
                        mutableState.value.selfie?.delete()
                        keys.remove(UploadSlot.SELFIE)
                        mutableState.update { it.copy(selfie = photo, preparing = false, step = IdStep.REVIEW) }
                    }.onFailure { failure ->
                        mutableState.update {
                            it.copy(preparing = false, step = IdStep.GESTURE, stepError = preparationProblem(failure))
                        }
                    }
            }
        }

        fun retakeSelfie() {
            mutableState.value.selfie?.delete()
            keys.remove(UploadSlot.SELFIE)
            mutableState.update { it.copy(selfie = null, step = IdStep.CAMERA) }
        }

        fun useSelfie() {
            if (mutableState.value.selfie == null) return
            mutableState.update { it.copy(step = IdStep.SUBMIT, submitError = null) }
        }

        /** Step 4: the upload rounds still needed, then `POST /v1/me/verifications` (12 section 5.2). */
        fun submit() {
            val current = mutableState.value
            val gesture = current.gesture ?: return
            if (current.submitting) return
            viewModelScope.launch {
                mutableState.update { it.copy(submitting = true, submitError = null, progress = 0f) }
                for (slot in current.slots) {
                    if (keys[slot] != null) continue
                    val photo = imageOf(slot)
                    if (photo == null) {
                        mutableState.update { it.copy(submitting = false) }
                        goToCapture(slot)
                        return@launch
                    }
                    mutableState.update { it.copy(progressSlot = slot, progress = 0f) }
                    val key =
                        verifications
                            .upload(slot, photo) { fraction -> mutableState.update { it.copy(progress = fraction) } }
                            .getOrElse { failure ->
                                fail(failure.apiError, slot)
                                return@launch
                            }
                    keys[slot] = key
                }
                mutableState.update { it.copy(progressSlot = null, progress = 1f) }
                verifications
                    .submitIdDocument(
                        frontKey = keys[UploadSlot.FRONT].orEmpty(),
                        backKey = if (current.passport) null else keys[UploadSlot.BACK],
                        selfieKey = keys[UploadSlot.SELFIE].orEmpty(),
                        gesture = gesture.wire,
                    ).onSuccess {
                        mutableState.update { it.copy(submitting = false, step = IdStep.DONE) }
                        deleteImages()
                    }.onFailure { failure -> fail(failure.apiError, null) }
            }
        }

        private fun imageOf(slot: UploadSlot): PreparedPhoto? =
            when (slot) {
                UploadSlot.FRONT -> mutableState.value.front
                UploadSlot.BACK -> mutableState.value.back
                UploadSlot.SELFIE, UploadSlot.UNKNOWN -> mutableState.value.selfie
            }

        private fun goToCapture(slot: UploadSlot) {
            mutableState.update {
                it.copy(
                    step =
                        when (slot) {
                            UploadSlot.FRONT -> IdStep.FRONT
                            UploadSlot.BACK -> IdStep.BACK
                            UploadSlot.SELFIE, UploadSlot.UNKNOWN -> IdStep.GESTURE
                        },
                    candidate = null,
                )
            }
        }

        private suspend fun fail(
            error: ApiError,
            slot: UploadSlot?,
        ) {
            mutableState.update { it.copy(submitting = false, progressSlot = null) }
            when {
                error.code == ErrorCode.INVALID_STATE -> {
                    // No number, or already pending or verified: ME-VERIFY shows the real state.
                    invalidation.invalidate(DataKey.Verifications, DataKey.OwnProfile)
                    mutableEvents.emit(VerifyEvent.ReturnToCentre)
                }

                error.code == ErrorCode.ALREADY_EXISTS -> {
                    bus.toast(R.string.verification_identity_already_exists)
                    invalidation.invalidate(DataKey.Verifications)
                    mutableEvents.emit(VerifyEvent.ReturnToCentre)
                }

                error.isGestureMismatch() -> {
                    mutableState.value.selfie?.delete()
                    keys.remove(UploadSlot.SELFIE)
                    mutableState.update {
                        it.copy(
                            selfie = null,
                            gesture = null,
                            step = IdStep.GESTURE,
                            notice = R.string.verification_gesture_changed,
                        )
                    }
                    loadChallenge()
                }

                error.isBackRequired() -> {
                    mutableState.value.back?.delete()
                    keys.remove(UploadSlot.BACK)
                    mutableState.update { it.copy(back = null, step = IdStep.BACK, candidate = null) }
                }

                error.code == ErrorCode.PAYLOAD_TOO_LARGE && slot != null -> {
                    imageOf(slot)?.delete()
                    keys.remove(slot)
                    when (slot) {
                        UploadSlot.FRONT -> mutableState.update { it.copy(front = null) }
                        UploadSlot.BACK -> mutableState.update { it.copy(back = null) }
                        UploadSlot.SELFIE, UploadSlot.UNKNOWN -> mutableState.update { it.copy(selfie = null) }
                    }
                    goToCapture(slot)
                    mutableState.update { it.copy(stepError = R.string.verification_errors_too_large) }
                }

                else -> {
                    // An upload the API cannot find is sent again on the next try.
                    if (error.code == ErrorCode.VALIDATION_FAILED) {
                        error.fields.forEach { field ->
                            when (field.field) {
                                "front_key" -> keys.remove(UploadSlot.FRONT)
                                "back_key" -> keys.remove(UploadSlot.BACK)
                                "selfie_key" -> keys.remove(UploadSlot.SELFIE)
                            }
                        }
                    }
                    mutableState.update { it.copy(submitError = R.string.verification_errors_upload_failed) }
                }
            }
        }

        /** System Back inside the flow goes to the previous step; `false` leaves the screen. */
        fun back(): Boolean {
            val current = mutableState.value
            if (current.submitting) return true
            when (current.step) {
                IdStep.NUMBER, IdStep.DONE -> {
                    return false
                }

                IdStep.FRONT -> {
                    when {
                        current.cardCamera -> closeCardCamera()
                        current.candidate != null -> retakeCard()
                        else -> return false
                    }
                }

                IdStep.BACK -> {
                    when {
                        current.cardCamera -> closeCardCamera()
                        current.candidate != null -> retakeCard()
                        else -> mutableState.update { it.copy(step = IdStep.FRONT, stepError = null) }
                    }
                }

                IdStep.GESTURE -> {
                    mutableState.update {
                        it.copy(step = if (it.passport) IdStep.FRONT else IdStep.BACK, stepError = null, notice = null)
                    }
                }

                IdStep.CAMERA, IdStep.REVIEW -> {
                    mutableState.update { it.copy(step = IdStep.GESTURE) }
                }

                IdStep.SUBMIT -> {
                    mutableState.update { it.copy(step = IdStep.REVIEW, submitError = null) }
                }
            }
            return true
        }

        private fun deleteImages() {
            val current = mutableState.value
            listOfNotNull(current.candidate, current.front, current.back, current.selfie).forEach { it.delete() }
        }

        override fun onCleared() {
            deleteImages()
        }
    }
