package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.feature.preferences.PreferencesFields
import com.khandanirishta.app.ui.feature.preferences.PreferencesFormController
import com.khandanirishta.app.ui.feature.profilesections.AfterSave
import com.khandanirishta.app.ui.feature.profilesections.FormMode
import com.khandanirishta.app.ui.feature.profilesections.RevealEffect
import com.khandanirishta.app.ui.feature.profilesections.rememberFieldLocator
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.text.plural
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** ONB-09: who the member is looking for (07 section 11). */
@HiltViewModel(assistedFactory = PreferencesStepViewModel.Factory::class)
class PreferencesStepViewModel
    @AssistedInject
    constructor(
        @Assisted val edit: Boolean,
        profiles: ProfileRepository,
        references: ReferenceRepository,
        me: MeRepository,
        bus: MessageBus,
        private val flow: OnboardingFlow,
        private val session: OnboardingSession,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(edit: Boolean): PreferencesStepViewModel
        }

        private val viewedAt = System.currentTimeMillis()

        val form =
            PreferencesFormController(
                scope = viewModelScope,
                mode = FormMode.ONBOARDING,
                profiles = profiles,
                references = references,
                me = me,
                bus = bus,
                initialErrors = session.takeCompletionErrors(STEP),
                onApiError = { session.validationFailed(STEP, it) },
            )

        private val mutableOutcome = MutableStateFlow<StepOutcome?>(null)
        val outcome: StateFlow<StepOutcome?> = mutableOutcome.asStateFlow()

        init {
            session.stepViewed(STEP, edit, flow.currentStep)
        }

        /** "Continue" always saves the full object, even unchanged, then continues (07 section 11.1). */
        fun submit() {
            form.submit {
                val outcome = flow.advance(STEP, edit, viewedAt)
                if (outcome is StepOutcome.Failed) {
                    AfterSave.Failed(outcome.error)
                } else {
                    mutableOutcome.value = outcome
                    AfterSave.Leave
                }
            }
        }

        fun consumeOutcome() {
            mutableOutcome.value = null
            form.release()
        }

        fun signedOut() = session.signedOut(STEP)

        private companion object {
            const val STEP = "preferences"
        }
    }

/** ONB-09 (07 section 11), with the "{n} must-haves" line above the button (11.3 rule 4). */
@Composable
internal fun PreferencesStep(
    edit: Boolean,
    viewModel: PreferencesStepViewModel =
        hiltViewModel<PreferencesStepViewModel, PreferencesStepViewModel.Factory> { it.create(edit) },
) {
    val ui by viewModel.form.state.collectAsStateWithLifecycle()
    val outcome by viewModel.outcome.collectAsStateWithLifecycle()
    val online = LocalOnline.current
    val locator = rememberFieldLocator()
    val form = ui.form

    StepNavigationEffect(outcome, viewModel::consumeOutcome)
    RevealEffect(form?.reveal, locator)

    OnboardingScaffold(
        step = "preferences",
        edit = edit,
        title = stringResource(R.string.onboarding_preferences_title),
        subtitle = stringResource(R.string.onboarding_preferences_subtitle),
        busy = form?.busy == true,
        dirty = form?.dirty == true,
        onSignOut = viewModel::signedOut,
        bottomBar = {
            if (form != null) {
                val musts = form.values.mustHaveCount(ui.candidateGender)
                StepBottomBar(
                    primaryLabel =
                        stringResource(
                            if (edit) R.string.onboarding_actions_save else R.string.onboarding_actions_continue,
                        ),
                    onPrimary = viewModel::submit,
                    busy = form.busy,
                    enabled = online,
                    summary = plural(R.plurals.preferences_must_summary, musts),
                    failure = form.failure,
                )
            }
        },
    ) {
        StepBody {
            when {
                ui.loadError != null && form == null -> ErrorState(ui.loadError, onRetry = viewModel.form::load)
                form == null -> FormSkeleton(fields = SKELETON_FIELDS)
                else -> PreferencesFields(ui = ui, locator = locator, onEdit = viewModel.form::edit)
            }
        }
    }
}

private const val SKELETON_FIELDS = 6
