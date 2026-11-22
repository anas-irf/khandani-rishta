package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
import com.khandanirishta.app.core.network.generated.model.PhotoVisibility
import com.khandanirishta.app.core.network.generated.model.PrivacyPatch
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.RadioCard
import com.khandanirishta.app.ui.components.RadioCardsField
import com.khandanirishta.app.ui.feature.me.PhotoManager
import com.khandanirishta.app.ui.feature.profilesections.isFormFailure
import com.khandanirishta.app.ui.feature.profilesections.wireCode
import com.khandanirishta.app.ui.feature.profilesections.wireOf
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.theme.Spacing
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Photos that count for `photo_required`: every one that is not `rejected` or `failed` (07 section 10.2). */
fun usablePhotos(photos: List<OwnPhoto>?): List<OwnPhoto> =
    photos.orEmpty().filter { it.status != PhotoStatus.REJECTED && it.status != PhotoStatus.FAILED }

@Immutable
data class PhotosStepUi(
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    /** The chosen `photo_visibility`, as a wire code. */
    val visibility: String? = null,
    /** The value of `GET /v1/me/privacy`, to tell whether the choice changed. */
    val savedVisibility: String? = null,
    val photos: List<OwnPhoto>? = null,
    val busy: Boolean = false,
    val failure: ApiError? = null,
    /** "Add at least one photo to continue." (07 section 10.2). */
    val photoMissing: Boolean = false,
    val outcome: StepOutcome? = null,
)

/** ONB-08: photos and who can see them (07 section 10). */
@HiltViewModel(assistedFactory = PhotosStepViewModel.Factory::class)
class PhotosStepViewModel
    @AssistedInject
    constructor(
        @Assisted val edit: Boolean,
        private val profiles: ProfileRepository,
        private val me: MeRepository,
        private val bus: MessageBus,
        private val flow: OnboardingFlow,
        private val session: OnboardingSession,
        invalidation: Invalidation,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(edit: Boolean): PhotosStepViewModel
        }

        private val viewedAt = System.currentTimeMillis()
        private val mutableState = MutableStateFlow(PhotosStepUi())
        val state: StateFlow<PhotosStepUi> = mutableState.asStateFlow()

        init {
            session.stepViewed(STEP, edit, flow.currentStep)
            load()
            viewModelScope.launch {
                invalidation.on(DataKey.OwnPhotos).collect { refreshPhotos() }
            }
        }

        /** `GET /v1/me/privacy` for the initial choice and `GET /v1/me/photos` (07 section 2.4 step 1). */
        fun load() {
            mutableState.update { it.copy(loading = it.visibility == null, loadError = null) }
            viewModelScope.launch {
                val photos = async { profiles.photos() }
                val privacy = profiles.privacy()
                val photoList = photos.await().getOrNull()
                privacy
                    .onSuccess { value ->
                        val saved = value.photoVisibility.wireCode ?: PhotoVisibility.MEMBERS.wire
                        mutableState.update {
                            it.copy(
                                loading = false,
                                visibility = it.visibility ?: saved,
                                savedVisibility = it.savedVisibility ?: saved,
                                photos = photoList ?: it.photos,
                            )
                        }
                    }.onFailure { error ->
                        mutableState.update { it.copy(loading = false, loadError = error.apiError) }
                    }
            }
        }

        private suspend fun refreshPhotos() {
            profiles.photos().onSuccess { list -> onPhotosChanged(list) }
        }

        fun onPhotosChanged(photos: List<OwnPhoto>) {
            mutableState.update {
                it.copy(photos = photos, photoMissing = it.photoMissing && usablePhotos(photos).isEmpty())
            }
        }

        fun choose(visibility: String) {
            mutableState.update { it.copy(visibility = visibility) }
        }

        /**
         * "Continue" and "Continue without": `PATCH /v1/me/privacy` with the choice (always sent, so it
         * is explicit), then `continue` (07 section 10.2).
         */
        fun submit() {
            val current = mutableState.value
            if (current.busy) return
            val count = usablePhotos(current.photos).size
            if (me.current?.config?.photoRequired == true && count == 0) {
                mutableState.update { it.copy(photoMissing = true) }
                return
            }
            val visibility = current.visibility ?: PhotoVisibility.MEMBERS.wire
            mutableState.update { it.copy(busy = true, failure = null) }
            viewModelScope.launch {
                val saved = profiles.updatePrivacy(PrivacyPatch(photoVisibility = wireOf<PhotoVisibility>(visibility)))
                saved.exceptionOrNull()?.let { error ->
                    fail(error.apiError)
                    return@launch
                }
                mutableState.update { it.copy(savedVisibility = visibility) }
                session.photoPrivacyChosen(visibility, count)
                val wasCurrent = flow.isCurrent(STEP)
                when (val outcome = flow.advance(STEP, edit, viewedAt)) {
                    is StepOutcome.Failed -> {
                        fail(outcome.error)
                    }

                    else -> {
                        if (count == 0 && wasCurrent && !edit) session.stepSkipped(STEP)
                        mutableState.update { it.copy(outcome = outcome) }
                    }
                }
            }
        }

        private fun fail(error: ApiError) {
            val missing = error.code == ErrorCode.VALIDATION_FAILED && error.fields.any { it.field == "photos" }
            mutableState.update {
                it.copy(
                    busy = false,
                    photoMissing = it.photoMissing || missing,
                    failure = if (error.isFormFailure) error else null,
                )
            }
            if (!missing && !error.isFormFailure) bus.error(error)
        }

        fun consumeOutcome() {
            mutableState.update { it.copy(outcome = null, busy = false) }
        }

        fun signedOut() = session.signedOut(STEP)

        private companion object {
            const val STEP = "photos"
        }
    }

private val VISIBILITY =
    listOf(
        Triple(
            PhotoVisibility.MEMBERS.wire,
            R.string.onboarding_photos_visibility_members,
            R.string.onboarding_photos_visibility_members_help,
        ),
        Triple(
            PhotoVisibility.INTERESTS_AND_CONNECTIONS.wire,
            R.string.onboarding_photos_visibility_interests_and_connections,
            R.string.onboarding_photos_visibility_interests_and_connections_help,
        ),
        Triple(
            PhotoVisibility.CONNECTIONS.wire,
            R.string.onboarding_photos_visibility_connections,
            R.string.onboarding_photos_visibility_connections_help,
        ),
        Triple(
            PhotoVisibility.APPROVED_ONLY.wire,
            R.string.onboarding_photos_visibility_approved_only,
            R.string.onboarding_photos_visibility_approved_only_help,
        ),
    )

/** The card title of a `photo_visibility` value (07 section 10.1). */
fun photoVisibilityTitle(code: String?): Int =
    VISIBILITY.firstOrNull { it.first == code }?.second ?: R.string.onboarding_photos_visibility_members

/** ONB-08 (07 section 10): the photo grid, the photo privacy choice, and "Add photos later". */
@Composable
internal fun PhotosStep(
    edit: Boolean,
    viewModel: PhotosStepViewModel =
        hiltViewModel<PhotosStepViewModel, PhotosStepViewModel.Factory> { it.create(edit) },
) {
    val me = LocalMe.current ?: return
    val state by viewModel.state.collectAsStateWithLifecycle()
    val online = LocalOnline.current
    var askWithout by rememberSaveable { mutableStateOf(false) }
    val required = me.config.photoRequired
    // The skip control of this step: shown while the grid is empty and photos are optional.
    val showAddLater = !required && !edit && state.photos?.isEmpty() == true

    StepNavigationEffect(state.outcome, viewModel::consumeOutcome)

    OnboardingScaffold(
        step = "photos",
        edit = edit,
        title = stringResource(R.string.onboarding_photos_title),
        subtitle = stringResource(R.string.onboarding_photos_subtitle),
        busy = state.busy,
        dirty = state.visibility != state.savedVisibility,
        onSignOut = viewModel::signedOut,
        bottomBar = {
            if (!state.loading && state.loadError == null) {
                StepBottomBar(
                    primaryLabel =
                        stringResource(
                            if (edit) R.string.onboarding_actions_save else R.string.onboarding_actions_continue,
                        ),
                    onPrimary = viewModel::submit,
                    busy = state.busy,
                    enabled = online,
                    failure = state.failure,
                )
            }
        },
    ) {
        StepBody {
            PhotoManager(onPhotosChange = viewModel::onPhotosChanged)
            when {
                state.loadError != null -> {
                    ErrorState(state.loadError, onRetry = viewModel::load)
                }

                state.loading -> {
                    FormSkeleton(fields = SKELETON_FIELDS)
                }

                else -> {
                    PhotoPrivacyChoice(
                        selected = state.visibility,
                        onSelect = viewModel::choose,
                        enabled = !state.busy,
                        modifier = Modifier.padding(top = Spacing.s12),
                    )
                }
            }
            if (state.photoMissing || (required && usablePhotos(state.photos).isEmpty())) {
                PhotoNeeded(missing = state.photoMissing)
            }
            if (showAddLater && !state.loading && state.loadError == null) {
                StepSecondaryAction(
                    label = stringResource(R.string.onboarding_photos_add_later),
                    onClick = { askWithout = true },
                    enabled = online && !state.busy,
                )
            }
        }
    }

    if (askWithout) {
        ConfirmDialog(
            title = stringResource(R.string.onboarding_photos_skip_dialog_title),
            text = stringResource(R.string.onboarding_photos_skip_dialog_body),
            confirmLabel = stringResource(R.string.onboarding_photos_skip_dialog_continue),
            dismissLabel = stringResource(R.string.onboarding_photos_skip_dialog_add),
            onConfirm = {
                askWithout = false
                // "Continue without" performs the same two calls as "Continue".
                viewModel.submit()
            },
            onDismiss = { askWithout = false },
        )
    }
}

/** "Who can see the photos?": the four choices with the line under them (07 section 10.1). */
@Composable
internal fun PhotoPrivacyChoice(
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val res = LocalResources.current
    val cards =
        remember(res) {
            VISIBILITY.map { (code, title, help) -> RadioCard(code, res.getString(title), res.getString(help)) }
        }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        RadioCardsField(
            cards = cards,
            selected = selected,
            onSelect = onSelect,
            label = stringResource(R.string.onboarding_photos_visibility_label),
            enabled = enabled,
        )
        CaptionText(stringResource(R.string.onboarding_photos_visibility_note))
    }
}

/** "Add at least one photo to continue." It comes into view when Continue found none. */
@Composable
private fun PhotoNeeded(missing: Boolean) {
    val requester = remember { BringIntoViewRequester() }
    LaunchedEffect(missing) {
        if (missing) requester.bringIntoView()
    }
    val message = stringResource(R.string.onboarding_photos_required)
    FieldSupport(
        helper = if (missing) null else message,
        error = if (missing) message else null,
        modifier = Modifier.bringIntoViewRequester(requester),
    )
}

private const val SKELETON_FIELDS = 3
