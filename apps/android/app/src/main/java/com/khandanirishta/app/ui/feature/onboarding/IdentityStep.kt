package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.generated.model.FieldCode
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.generated.model.IdentitySummary
import com.khandanirishta.app.ui.components.LoadingLine
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.feature.me.IdentityNumberForm
import com.khandanirishta.app.ui.feature.profilesections.FormSummaryBox
import com.khandanirishta.app.ui.feature.profilesections.isFormFailure
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.text.LocalMe
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@Immutable
data class IdentityStepUi(
    /** `continue` runs after the number was saved. */
    val busy: Boolean = false,
    val skipping: Boolean = false,
    val failure: ApiError? = null,
    /** Errors of `continue` or of a failed completion, shown above the form. */
    val errors: List<UiText> = emptyList(),
    val outcome: StepOutcome? = null,
)

/**
 * ONB-10: the identity number (07 section 13). [IdentityNumberForm] shows the saved number
 * read-only with "Change", or the document type and number, and saves them; this step then
 * continues, or offers "Skip for now" while the number is optional (07 section 13.6).
 */
@HiltViewModel(assistedFactory = IdentityStepViewModel.Factory::class)
class IdentityStepViewModel
    @AssistedInject
    constructor(
        @Assisted val edit: Boolean,
        private val bus: MessageBus,
        private val flow: OnboardingFlow,
        private val session: OnboardingSession,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(edit: Boolean): IdentityStepViewModel
        }

        private val viewedAt = System.currentTimeMillis()
        private val mutableState = MutableStateFlow(IdentityStepUi())
        val state: StateFlow<IdentityStepUi> = mutableState.asStateFlow()

        init {
            session.stepViewed(STEP, edit, flow.currentStep)
            session.takeCompletionErrors(STEP)?.let { fields ->
                mutableState.update { it.copy(errors = messages(fields)) }
            }
        }

        /**
         * The number was saved with `PUT /v1/me/identity`, or the saved one was kept: continue
         * (07 sections 13.4 and 13.5).
         */
        @Suppress("UNUSED_PARAMETER")
        fun onSaved(summary: IdentitySummary) = advance()

        fun advance() {
            if (mutableState.value.busy) return
            mutableState.update { it.copy(busy = true, failure = null, errors = emptyList()) }
            viewModelScope.launch {
                when (val outcome = flow.advance(STEP, edit, viewedAt)) {
                    is StepOutcome.Failed -> fail(outcome.error)
                    else -> mutableState.update { it.copy(outcome = outcome) }
                }
            }
        }

        fun skip() {
            if (mutableState.value.busy || mutableState.value.skipping) return
            mutableState.update { it.copy(skipping = true, failure = null, errors = emptyList()) }
            viewModelScope.launch {
                when (val outcome = flow.skip(STEP, edit, viewedAt)) {
                    is StepOutcome.Failed -> {
                        mutableState.update { it.copy(skipping = false) }
                        fail(outcome.error)
                    }

                    else -> {
                        mutableState.update { it.copy(outcome = outcome) }
                    }
                }
            }
        }

        private fun fail(error: ApiError) {
            mutableState.update {
                it.copy(
                    busy = false,
                    errors = if (error.code == ErrorCode.VALIDATION_FAILED) messages(error.fields) else emptyList(),
                    failure = if (error.isFormFailure) error else null,
                )
            }
            if (error.code != ErrorCode.VALIDATION_FAILED && !error.isFormFailure) bus.error(error)
        }

        /** `continue` without an identity says "Enter the identity number to continue." (07 section 13.6). */
        private fun messages(fields: List<FieldError>): List<UiText> =
            fields.map { field ->
                when {
                    field.field == "number" && field.code == FieldCode.REQUIRED -> {
                        UiText.of(R.string.identity_errors_number_required_continue)
                    }

                    field.code == FieldCode.UNKNOWN -> {
                        UiText.Raw(field.message)
                    }

                    else -> {
                        MessageBus.fieldText(field.code.wire)
                    }
                }
            }

        fun consumeOutcome() {
            mutableState.update { it.copy(outcome = null, busy = false, skipping = false) }
        }

        fun signedOut() = session.signedOut(STEP)

        private companion object {
            const val STEP = "identity"
        }
    }

/** ONB-10 (07 section 13): the number form, the verification note, and "Skip for now" unless required. */
@Composable
internal fun IdentityStep(
    edit: Boolean,
    viewModel: IdentityStepViewModel =
        hiltViewModel<IdentityStepViewModel, IdentityStepViewModel.Factory> { it.create(edit) },
) {
    val me = LocalMe.current ?: return
    val state by viewModel.state.collectAsStateWithLifecycle()
    val online = LocalOnline.current
    val skippable = Steps.skippable("identity", me.config) && !edit
    val submitLabel =
        stringResource(if (edit) R.string.onboarding_actions_save else R.string.onboarding_actions_continue)

    StepNavigationEffect(state.outcome, viewModel::consumeOutcome)

    OnboardingScaffold(
        step = "identity",
        edit = edit,
        title = stringResource(R.string.onboarding_identity_title),
        subtitle = stringResource(R.string.onboarding_identity_subtitle),
        busy = state.busy || state.skipping,
        dirty = false,
        onSignOut = viewModel::signedOut,
        bottomBar = {
            // The form has the button of this step, so the bar only carries a failure.
            StepBottomBar(
                busy = state.busy,
                enabled = online,
                failure = state.failure,
                onRetry = viewModel::advance,
            )
        },
    ) {
        StepBody {
            if (state.errors.isNotEmpty()) FormSummaryBox(state.errors)
            IdentityNumberForm(submitLabel = submitLabel, onSave = viewModel::onSaved)
            if (state.busy) LoadingLine()
            if (skippable) {
                StepSecondaryAction(
                    label = stringResource(R.string.onboarding_actions_skip),
                    onClick = viewModel::skip,
                    enabled = online && !state.busy,
                    loading = state.skipping,
                    note = stringResource(R.string.onboarding_identity_skip_note),
                )
            }
            Text(
                text = stringResource(R.string.onboarding_identity_verification_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
