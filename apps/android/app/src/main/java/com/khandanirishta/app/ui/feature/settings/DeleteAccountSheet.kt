package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.feature.settings.kit.BulletLine
import com.khandanirishta.app.ui.feature.settings.kit.longDateInZone
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.messages.fieldTexts
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import javax.inject.Inject

/** The phrase the member types to confirm (specs/06 section 9.1). */
private const val DELETE_PHRASE = "DELETE"

/** The optional reason is at most 300 characters (specs/06 section 9.1). */
private const val REASON_MAX = 300

/**
 * The deletion confirmation of specs/06 section 9.5 and 16 section 6.27 step 2, used by SET-ACCOUNT,
 * GATE-BLOCKED ("Delete my data") and GATE-CONSENT: the consequences with the dates computed from
 * `deletion_grace_days` (never a fixed 30), an optional reason and the typed `DELETE`. Calls
 * `POST /v1/me/deletion`; the returned `Me` replaces the cached one and the gate host follows it.
 * This is the confirmation, so its button alone is danger.
 */
@Composable
internal fun DeleteAccountSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: DeleteAccountViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val state by viewModel.state.collectAsStateWithLifecycle()
    val res = LocalResources.current
    var reason by rememberSaveable { mutableStateOf("") }
    var phrase by rememberSaveable { mutableStateOf("") }
    val currentOnDismiss by rememberUpdatedState(onDismiss)
    LaunchedEffect(state.done) {
        if (state.done) {
            viewModel.consumeDone()
            currentOnDismiss()
        }
    }
    DisposableEffect(viewModel) {
        onDispose { viewModel.reset() }
    }
    val graceDays = me.config.deletionGraceDays
    val purgeDate =
        remember(graceDays, me.user.timezone) {
            longDateInZone(Instant.now().plus(Duration.ofDays(graceDays)), me.user.timezone)
        }
    val points =
        listOf(
            stringResource(R.string.settings_account_delete_confirm_hidden),
            text(R.string.settings_account_delete_confirm_days, "days" to graceDays),
            text(R.string.settings_account_delete_confirm_purge, "date" to purgeDate),
            stringResource(R.string.settings_account_delete_confirm_messages),
            stringResource(R.string.settings_account_delete_confirm_record),
            stringResource(R.string.settings_account_delete_confirm_break),
        )
    val listLabel = stringResource(R.string.settings_account_delete_confirm_list_label)

    // The sheet stays while the request runs.
    KrSheet(
        title = stringResource(R.string.settings_account_delete_confirm_title),
        onDismissRequest = onDismiss,
        modifier = modifier,
        dismissible = !state.busy,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.settings_account_delete_confirm_button),
                onConfirm = { viewModel.submit(reason) },
                onCancel = onDismiss,
                variant = KrButtonVariant.DANGER,
                // Exactly DELETE (specs/16 section 6.27); a space the keyboard adds does not count.
                enabled = phrase.trim() == DELETE_PHRASE,
                busy = state.busy,
            )
        },
    ) {
        Column(
            Modifier.semantics { contentDescription = listLabel },
            verticalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            points.forEach { point -> BulletLine(point) }
        }
        KrTextField(
            value = reason,
            onValueChange = { reason = it },
            label = stringResource(R.string.settings_account_delete_confirm_reason_label),
            error = state.fieldErrors["reason"]?.resolve(res),
            maxLength = REASON_MAX,
            singleLine = false,
            minLines = 3,
            enabled = !state.busy,
        )
        KrTextField(
            value = phrase,
            onValueChange = { phrase = it },
            label = stringResource(R.string.settings_account_delete_confirm_phrase_label),
            error = state.fieldErrors["confirm"]?.resolve(res),
            enabled = !state.busy,
            keyboardOptions =
                KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Done,
                ),
        )
    }
}

@Immutable
data class DeleteAccountUiState(
    val busy: Boolean = false,
    /** Messages of a `validation_failed` answer, by field (`reason`, `confirm`). */
    val fieldErrors: Map<String, UiText> = emptyMap(),
    /** The request is over and the sheet should close. */
    val done: Boolean = false,
)

/** `POST /v1/me/deletion` with `{ reason, confirm: "DELETE" }` (specs/06 section 9.1 step 3). */
@HiltViewModel
class DeleteAccountViewModel
    @Inject
    constructor(
        private val meRepository: MeRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(DeleteAccountUiState())
        val state: StateFlow<DeleteAccountUiState> = mutableState.asStateFlow()

        fun submit(reason: String) {
            if (mutableState.value.busy) return
            mutableState.update { it.copy(busy = true, fieldErrors = emptyMap()) }
            viewModelScope.launch {
                meRepository
                    .requestDeletion(reason.trim().takeIf { it.isNotEmpty() })
                    .onSuccess {
                        // The returned `Me` is in the cache; the gate host routes by its gate. A banned
                        // or suspended member keeps the gate and now has `purge_after` (15 section 6).
                        mutableState.update { it.copy(busy = false, done = true) }
                    }.onFailure { error ->
                        val apiError = error.apiError
                        when (apiError.code) {
                            ErrorCode.VALIDATION_FAILED -> {
                                mutableState.update { it.copy(busy = false, fieldErrors = apiError.fieldTexts()) }
                            }

                            ErrorCode.INVALID_STATE -> {
                                // Already scheduled elsewhere: fetch `Me` again and let the gate decide.
                                meRepository.refresh()
                                mutableState.update { it.copy(busy = false, done = true) }
                            }

                            else -> {
                                mutableState.update { it.copy(busy = false) }
                                bus.error(apiError)
                            }
                        }
                    }
            }
        }

        fun consumeDone() {
            mutableState.update { it.copy(done = false) }
        }

        /** Clears what the last opening of the sheet left, when it closes. */
        fun reset() {
            if (mutableState.value.busy) return
            mutableState.value = DeleteAccountUiState()
        }
    }
