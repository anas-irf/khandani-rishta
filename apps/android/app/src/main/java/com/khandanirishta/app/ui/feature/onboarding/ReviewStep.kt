package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.IdentitySummary
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.feature.profilesections.isFormFailure
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.DeepLink
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.OnboardingDone
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.LocalReference
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class ReviewUi(
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    val profile: OwnProfile? = null,
    val preferences: Preferences? = null,
    val privacy: Privacy? = null,
    val identity: IdentitySummary? = null,
    val photos: List<OwnPhoto> = emptyList(),
    val completing: Boolean = false,
    val failure: ApiError? = null,
    val outcome: StepOutcome? = null,
)

/** ONB-11: review every answer, then "Create my profile" (07 section 14). */
@HiltViewModel
class ReviewViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val me: MeRepository,
        private val bus: MessageBus,
        private val session: OnboardingSession,
        flow: OnboardingFlow,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ReviewUi())
        val state: StateFlow<ReviewUi> = mutableState.asStateFlow()

        init {
            session.stepViewed(Steps.REVIEW, false, flow.currentStep)
            load()
            // A step edited from here saves its data: show the new answers when the member returns.
            viewModelScope.launch {
                invalidation.flow.collect { key -> if (key in RELOAD_ON) load(silent = true) }
            }
        }

        /** The profile, preferences, privacy, identity and photos (07 section 14.1). */
        fun load(silent: Boolean = false) {
            if (!silent) mutableState.update { it.copy(loading = it.profile == null, loadError = null) }
            viewModelScope.launch {
                val preferences = async { profiles.preferences() }
                val privacy = async { profiles.privacy() }
                val identity = async { profiles.identity() }
                val photos = async { profiles.photos() }
                val profile = profiles.load()
                val results = listOf(profile, preferences.await(), privacy.await(), identity.await(), photos.await())
                val error = results.firstNotNullOfOrNull { it.exceptionOrNull() }
                if (error != null) {
                    if (!silent || mutableState.value.profile == null) {
                        mutableState.update { it.copy(loading = false, loadError = error.apiError) }
                    }
                    return@launch
                }
                mutableState.update {
                    it.copy(
                        loading = false,
                        loadError = null,
                        profile = profile.getOrNull(),
                        preferences = preferences.await().getOrNull(),
                        privacy = privacy.await().getOrNull(),
                        identity = identity.await().getOrNull(),
                        photos = photos.await().getOrNull().orEmpty(),
                    )
                }
            }
        }

        /**
         * "Create my profile": `POST /v1/me/onboarding/complete` (07 section 14.2). [onCompleted] runs
         * as soon as the new `Me` is in place, before the gate host replaces this screen.
         */
        fun complete(onCompleted: (Gate) -> Unit) {
            if (mutableState.value.completing) return
            mutableState.update { it.copy(completing = true, failure = null) }
            viewModelScope.launch {
                val result = profiles.completeOnboarding()
                val completed = result.getOrNull()
                if (completed != null) {
                    session.completed(completed.gate.wire)
                    onCompleted(completed.gate)
                    return@launch
                }
                val error = result.exceptionOrNull()?.apiError ?: return@launch
                when {
                    error.code == ErrorCode.VALIDATION_FAILED -> {
                        session.validationFailed(Steps.REVIEW, error)
                        bus.toast(R.string.onboarding_review_missing)
                        val step = error.fields.firstOrNull()?.let { Steps.forField(it.field) }
                        if (step != null) session.setCompletionErrors(step, error.fields)
                        mutableState.update {
                            it.copy(completing = false, outcome = step?.let { target -> StepOutcome.Edit(target) })
                        }
                    }

                    error.code == ErrorCode.INVALID_STATE -> {
                        // Refetch `Me`: the gate router opens the right screen.
                        me.refresh()
                        mutableState.update { it.copy(completing = false) }
                    }

                    error.isFormFailure -> {
                        mutableState.update { it.copy(completing = false, failure = error) }
                    }

                    else -> {
                        mutableState.update { it.copy(completing = false) }
                        bus.error(error)
                    }
                }
            }
        }

        fun consumeOutcome() {
            mutableState.update { it.copy(outcome = null) }
        }

        fun signedOut() = session.signedOut(Steps.REVIEW)

        private companion object {
            val RELOAD_ON =
                setOf(
                    DataKey.OwnProfile,
                    DataKey.Preferences,
                    DataKey.Privacy,
                    DataKey.OwnPhotos,
                    DataKey.Verifications,
                )
        }
    }

/** ONB-11 (07 section 14): a band per part with "Edit", the warning, and "Create my profile". */
@Composable
internal fun ReviewStep(viewModel: ReviewViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    val online = LocalOnline.current
    val reference = LocalReference.current
    val res = LocalResources.current
    val profile = state.profile
    val preferences = state.preferences
    val summary =
        remember(profile, preferences, state.privacy, state.identity, state.photos, reference, res) {
            if (profile == null || preferences == null) {
                null
            } else {
                reviewSummary(profile, preferences, state.privacy, state.identity, state.photos, res, reference)
            }
        }

    StepNavigationEffect(state.outcome, viewModel::consumeOutcome)

    OnboardingScaffold(
        step = Steps.REVIEW,
        edit = false,
        title = stringResource(R.string.onboarding_review_title),
        subtitle = stringResource(R.string.onboarding_review_subtitle),
        busy = state.completing,
        dirty = false,
        onSignOut = viewModel::signedOut,
        bottomBar = {
            if (profile != null) {
                StepBottomBar(
                    primaryLabel = stringResource(R.string.onboarding_review_submit),
                    onPrimary = {
                        viewModel.complete { gate ->
                            // ONB-DONE is shown once, after a completion that results in `ok` (07 section 15).
                            if (gate == Gate.OK) {
                                appViewModel.openLink(DeepLink.Screen(Tab.HOME, listOf(OnboardingDone)))
                            }
                        }
                    },
                    busy = state.completing,
                    enabled = online,
                    failure = state.failure,
                )
            }
        },
    ) {
        when {
            state.loadError != null && profile == null -> {
                StepBody { ErrorState(state.loadError, onRetry = { viewModel.load() }) }
            }

            summary == null -> {
                StepBody { FormSkeleton(fields = SKELETON_FIELDS) }
            }

            else -> {
                ReviewBody(
                    summary = summary,
                    onEdit = { step -> navigator.push(OnboardingStep(step, edit = true)) },
                )
            }
        }
    }
}

private const val SKELETON_FIELDS = 6
