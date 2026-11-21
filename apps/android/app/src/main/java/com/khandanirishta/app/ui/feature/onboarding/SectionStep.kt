package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.feature.profilesections.AfterSave
import com.khandanirishta.app.ui.feature.profilesections.FormMode
import com.khandanirishta.app.ui.feature.profilesections.GenderChangeDialog
import com.khandanirishta.app.ui.feature.profilesections.PlaceLookup
import com.khandanirishta.app.ui.feature.profilesections.RevealEffect
import com.khandanirishta.app.ui.feature.profilesections.SectionFields
import com.khandanirishta.app.ui.feature.profilesections.SectionFormController
import com.khandanirishta.app.ui.feature.profilesections.rememberFieldLocator
import com.khandanirishta.app.ui.feature.profilesections.rememberOnline
import com.khandanirishta.app.ui.feature.profilesections.sectionSubtitle
import com.khandanirishta.app.ui.feature.profilesections.sectionTitle
import com.khandanirishta.app.ui.feature.profilesections.subjectOf
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.text.LocalMe
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** ONB-01 to ONB-07: one profile section of onboarding (07 sections 3 to 9). */
@HiltViewModel(assistedFactory = SectionStepViewModel.Factory::class)
class SectionStepViewModel
    @AssistedInject
    constructor(
        @Assisted val step: String,
        @Assisted val edit: Boolean,
        profiles: ProfileRepository,
        references: ReferenceRepository,
        places: PlaceLookup,
        private val bus: MessageBus,
        private val flow: OnboardingFlow,
        private val session: OnboardingSession,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(
                step: String,
                edit: Boolean,
            ): SectionStepViewModel
        }

        private val viewedAt = System.currentTimeMillis()

        val form =
            SectionFormController(
                scope = viewModelScope,
                section = step,
                mode = FormMode.ONBOARDING,
                profiles = profiles,
                references = references,
                places = places,
                bus = bus,
                initialErrors = session.takeCompletionErrors(step),
                onApiError = { session.validationFailed(step, it) },
            )

        private val mutableOutcome = MutableStateFlow<StepOutcome?>(null)
        val outcome: StateFlow<StepOutcome?> = mutableOutcome.asStateFlow()

        private val mutableSkipping = MutableStateFlow(false)
        val skipping: StateFlow<Boolean> = mutableSkipping.asStateFlow()

        init {
            session.stepViewed(step, edit, flow.currentStep)
        }

        /** "Continue" (or "Save" in edit mode): validate, save, then continue (07 section 2.4). */
        fun submit() {
            if (mutableSkipping.value) return
            form.submit { proceed(flow.advance(step, edit, viewedAt)) }
        }

        private fun proceed(outcome: StepOutcome): AfterSave =
            if (outcome is StepOutcome.Failed) {
                AfterSave.Failed(outcome.error)
            } else {
                mutableOutcome.value = outcome
                AfterSave.Leave
            }

        /** "Skip for now" without saving: `continue` only (07 section 2.5). */
        fun skip() {
            if (mutableSkipping.value || form.state.value.form
                    ?.busy == true
            ) {
                return
            }
            mutableSkipping.value = true
            viewModelScope.launch {
                when (val outcome = flow.skip(step, edit, viewedAt)) {
                    is StepOutcome.Failed -> {
                        mutableSkipping.value = false
                        bus.toast(R.string.onboarding_failed)
                    }

                    else -> {
                        mutableOutcome.value = outcome
                    }
                }
            }
        }

        /** The screen navigated; the step is usable again if the member comes back to it. */
        fun consumeOutcome() {
            mutableOutcome.value = null
            mutableSkipping.value = false
            form.release()
        }

        fun signedOut() = session.signedOut(step)

        fun helpMeWriteUsed() = session.helpMeWriteUsed()
    }

/** ONB-01 to ONB-07 (07 sections 3 to 9). */
@Composable
internal fun SectionStep(
    step: String,
    edit: Boolean,
) {
    val viewModel = hiltViewModel<SectionStepViewModel, SectionStepViewModel.Factory> { it.create(step, edit) }
    val me = LocalMe.current ?: return
    val ui by viewModel.form.state.collectAsStateWithLifecycle()
    val outcome by viewModel.outcome.collectAsStateWithLifecycle()
    val skipping by viewModel.skipping.collectAsStateWithLifecycle()
    val online = rememberOnline()
    val locator = rememberFieldLocator()
    var askSave by rememberSaveable { mutableStateOf(false) }
    val form = ui.form
    val context = viewModel.form.sectionContext
    val subject = subjectOf(me.profile.managedBy, me.profile.gender)
    val skippable = Steps.skippable(step, me.config) && !edit

    StepNavigationEffect(outcome, viewModel::consumeOutcome)
    RevealEffect(form?.reveal, locator)

    OnboardingScaffold(
        step = step,
        edit = edit,
        title = stringResource(sectionTitle(step, subject)),
        subtitle = stringResource(sectionSubtitle(step, subject)),
        busy = form?.busy == true || skipping,
        dirty = form?.dirty == true,
        onSignOut = viewModel::signedOut,
        bottomBar = {
            if (form != null) {
                StepBottomBar(
                    primaryLabel =
                        stringResource(
                            if (edit) R.string.onboarding_actions_save else R.string.onboarding_actions_continue,
                        ),
                    onPrimary = viewModel::submit,
                    busy = form.busy,
                    enabled = online && !skipping,
                    secondaryLabel = if (skippable) stringResource(R.string.onboarding_actions_skip) else null,
                    onSecondary = { if (form.dirty) askSave = true else viewModel.skip() },
                    secondaryBusy = skipping,
                    failure = form.failure,
                )
            }
        },
    ) {
        when {
            ui.loadError != null && form == null -> {
                ErrorState(ui.loadError, onRetry = viewModel.form::load)
            }

            form == null || context == null -> {
                FormSkeleton(fields = 5)
            }

            else -> {
                SectionFields(
                    ui = ui,
                    context = context,
                    locator = locator,
                    onEdit = viewModel.form::edit,
                    onIncomeCurrency = viewModel.form::setIncomeCurrency,
                    onUseHelpMeWrite = viewModel::helpMeWriteUsed,
                )
            }
        }
    }

    ui.confirmGender?.let { gender ->
        GenderChangeDialog(
            gender = gender,
            onConfirm = viewModel.form::confirmGender,
            onDismiss = viewModel.form::cancelGender,
        )
    }
    if (askSave) {
        SkipDialog(
            onSave = {
                askSave = false
                viewModel.submit()
            },
            onSkip = {
                askSave = false
                viewModel.skip()
            },
            onDismiss = { askSave = false },
        )
    }
}
