package com.khandanirishta.app.ui.feature.me

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.DocumentType
import com.khandanirishta.app.core.network.generated.model.FieldCode
import com.khandanirishta.app.core.network.generated.model.IdentitySummary
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.DiamondTitle
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.IdentityMask
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.Subject
import com.khandanirishta.app.ui.text.linkedText
import com.khandanirishta.app.ui.text.subjectOf
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import dagger.hilt.android.lifecycle.HiltViewModel
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

/**
 * The identity document form of `ONB-10` and `ME-VERIFY-ID` step 1 (specs/07 section 13,
 * specs/12 sections 2 and 3): the consent text, the document type, the number with its mask, the
 * managed-profile note, and the save with `PUT /v1/me/identity` including its error messages.
 * [onSave] receives the saved summary. [submitLabel] is the button text of the hosting screen.
 *
 * When a number is already registered, the form first shows it read-only with "Change" (07
 * section 13.5); the button then hands the saved summary to [onSave] without saving again.
 *
 * Offline (rule G14) it cannot save, go on or load again; typing and "Change" still work. It has
 * no gutters: the screen around it gives them.
 */
@Composable
fun IdentityNumberForm(
    submitLabel: String,
    onSave: (IdentitySummary) -> Unit,
    modifier: Modifier = Modifier,
) {
    IdentityNumberFormContent(
        submitLabel = submitLabel,
        onSave = onSave,
        startEditing = false,
        showManagedNote = true,
        modifier = modifier,
    )
}

/**
 * The form itself. `ME-VERIFY-ID` opens it with [startEditing] (the empty fields at once, 16
 * section 6.23) and shows the managed-profile note itself, so [showManagedNote] is false there.
 */
@Composable
internal fun IdentityNumberFormContent(
    submitLabel: String,
    onSave: (IdentitySummary) -> Unit,
    startEditing: Boolean,
    showManagedNote: Boolean,
    modifier: Modifier = Modifier,
    viewModel: IdentityFormViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val currentOnSave by rememberUpdatedState(onSave)
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is IdentityFormEvent.Saved -> currentOnSave(event.summary)

                // No gender yet during onboarding: the number is checked against it (07 section 13.6).
                IdentityFormEvent.GoToBasics -> navigator.push(OnboardingStep(BASICS_STEP))
            }
        }
    }
    val actions =
        remember(viewModel, navigator) {
            IdentityFormActions(
                retry = viewModel::load,
                change = viewModel::change,
                next = { currentOnSave(it) },
                setType = viewModel::setType,
                setNumber = viewModel::setNumber,
                submit = viewModel::submit,
                toBasics = { navigator.push(OnboardingStep(BASICS_STEP)) },
            )
        }
    IdentityFormBody(
        state = state,
        submitLabel = submitLabel,
        startEditing = startEditing,
        showManagedNote = showManagedNote,
        actions = actions,
        modifier = modifier,
    )
    if (state.registered) {
        RegisteredDialog(onDismiss = viewModel::dismissRegistered)
    }
}

/** What the form can do. */
@Immutable
internal class IdentityFormActions(
    val retry: () -> Unit,
    val change: () -> Unit,
    val next: (IdentitySummary) -> Unit,
    val setType: (DocumentType) -> Unit,
    val setNumber: (String) -> Unit,
    val submit: () -> Unit,
    val toBasics: () -> Unit,
)

/** The form in all its states, without its view model and navigation. */
@Composable
internal fun IdentityFormBody(
    state: IdentityFormUiState,
    submitLabel: String,
    startEditing: Boolean,
    showManagedNote: Boolean,
    actions: IdentityFormActions,
    modifier: Modifier = Modifier,
) {
    val profile = state.profile
    val summary = state.summary
    Column(modifier.fillMaxWidth()) {
        when {
            state.loadError != null -> {
                ErrorState(error = state.loadError, onRetry = actions.retry)
            }

            state.loading || profile == null -> {
                FormSkeleton(fields = LOADING_FIELDS)
            }

            summary != null && !startEditing && !state.changing -> {
                SavedIdentity(
                    summary = summary,
                    submitLabel = submitLabel,
                    onChange = actions.change,
                    onContinue = { actions.next(summary) },
                )
            }

            else -> {
                NumberForm(
                    state = state,
                    profile = profile,
                    submitLabel = submitLabel,
                    showManagedNote = showManagedNote,
                    actions = actions,
                )
            }
        }
    }
}

/** 07 section 13.5: the saved number, read-only, with "Change". Going on needs the network. */
@Composable
private fun SavedIdentity(
    summary: IdentitySummary,
    submitLabel: String,
    onChange: () -> Unit,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val value =
        text(
            R.string.identity_saved_value,
            "document" to reference.option(Lists.DOCUMENT_TYPE, summary.documentType),
            "number" to summary.numberMasked,
        )
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s24)) {
        Column(Modifier.fillMaxWidth()) {
            FieldLabel(stringResource(R.string.identity_saved_label))
            Surface(
                color = KrTheme.tonal,
                contentColor = MaterialTheme.colorScheme.onSurface,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth(),
            ) {
                AdaptiveRow(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = Sizes.touchLarge)
                            .padding(horizontal = Spacing.s16, vertical = Spacing.s4),
                    spacing = Spacing.s16,
                    lineSpacing = Spacing.s4,
                ) {
                    Text(
                        text = value,
                        style = MaterialTheme.typography.bodyMedium.merge(KrType.numbers),
                        modifier =
                            Modifier
                                .grow(basis = SavedValueBasis)
                                .padding(vertical = Spacing.s8),
                    )
                    KrTextLink(stringResource(R.string.identity_change), onChange)
                }
            }
        }
        KrButton(text = submitLabel, onClick = onContinue, enabled = LocalOnline.current, fullWidth = true)
    }
}

@Suppress("DEPRECATION") // As KrTextInput: the mask is a VisualTransformation.
@Composable
private fun NumberForm(
    state: IdentityFormUiState,
    profile: OwnProfile,
    submitLabel: String,
    showManagedNote: Boolean,
    actions: IdentityFormActions,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val subject = subjectOf(profile.accountFor.managedBy, profile.basics.gender)
    val draft = profile.status == ProfileStatus.DRAFT
    val type = state.documentType
    val cnicLike = type.isCnicLike()
    val options = remember(reference) { documentOptions(reference) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.gutter)) {
        if (state.stateError) {
            StatusBanner(
                text = stringResource(R.string.identity_invalid_state),
                tone = StatusTone.DANGER,
                announce = true,
            )
        }
        SelectField(
            label = stringResource(R.string.identity_document_label),
            options = options,
            selected = type.wire,
            onSelect = { code ->
                if (!code.isNullOrEmpty()) {
                    DocumentType.entries.firstOrNull { it.wire == code }?.let(actions.setType)
                }
            },
            enabled = !state.saving,
            clearable = false,
            searchable = false,
        )
        ConsentPanel()
        if (showManagedNote && subject != Subject.SELF) ManagedNote(name = profile.basics.firstName)
        Column(Modifier.fillMaxWidth()) {
            KrTextField(
                value = state.number,
                onValueChange = actions.setNumber,
                label = stringResource(identityNumberLabel(type, subject)),
                error = state.fieldError?.let { stringResource(it) } ?: state.fieldMessage,
                placeholder =
                    stringResource(
                        if (cnicLike) {
                            R.string.fields_identity_placeholder_cnic
                        } else {
                            R.string.fields_identity_placeholder_passport
                        },
                    ),
                keyboardOptions =
                    KeyboardOptions(
                        capitalization =
                            if (cnicLike) KeyboardCapitalization.None else KeyboardCapitalization.Characters,
                        autoCorrectEnabled = false,
                        keyboardType = if (cnicLike) KeyboardType.Number else KeyboardType.Ascii,
                        imeAction = ImeAction.Done,
                    ),
                visualTransformation = if (cnicLike) IdentityMask else VisualTransformation.None,
            )
            if (state.mismatch && draft) KrTextLink(stringResource(R.string.identity_go_basics), actions.toBasics)
        }
        if (state.failed) {
            StatusBanner(
                text = stringResource(if (draft) R.string.identity_failed_onboarding else R.string.identity_failed),
                tone = StatusTone.DANGER,
                announce = true,
            )
        }
        KrButton(
            text = submitLabel,
            onClick = actions.submit,
            enabled = LocalOnline.current && identityNumberComplete(type, state.number),
            loading = state.saving,
            fullWidth = true,
        )
    }
}

/** A profile someone manages: whose number it is (07 section 13.2). */
@Composable
private fun ManagedNote(name: String?) {
    IconText(
        icon = Icons.Outlined.Info,
        text =
            if (name.isNullOrBlank()) {
                stringResource(R.string.identity_managed_note_unnamed)
            } else {
                text(R.string.identity_managed_note, "name" to name)
            },
        style = MaterialTheme.typography.titleSmall,
        tint = MaterialTheme.colorScheme.primary,
    )
}

/** The consent text of 12 section 2.2, directly above the number. */
@Composable
private fun ConsentPanel(modifier: Modifier = Modifier) {
    TonalPanel(modifier = modifier, spacing = Spacing.s12) {
        DiamondTitle(
            title = stringResource(R.string.identity_consent_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics(mergeDescendants = true) { heading() },
        )
        Text(stringResource(R.string.identity_consent_body), style = MaterialTheme.typography.bodyMedium)
        ConsentPoints.forEach { BulletLine(stringResource(it)) }
    }
}

/** `409 identity_already_registered` (07 section 13.4): the dialog with the support address. */
@Composable
private fun RegisteredDialog(onDismiss: () -> Unit) {
    val supportEmail = LocalMe.current
        ?.config
        ?.supportEmail
        .orEmpty()
    val links = rememberLinkOpener()
    val linkColor = MaterialTheme.colorScheme.primary
    val raw = text(R.string.identity_registered_support, "email" to supportEmail)
    KrDialog(
        title = stringResource(R.string.identity_registered_title),
        text = stringResource(R.string.identity_registered_body),
        confirmLabel = stringResource(R.string.identity_registered_ok),
        onConfirm = onDismiss,
        onDismissRequest = onDismiss,
    ) {
        if (supportEmail.isNotEmpty()) {
            Text(
                text = linkedText(raw, linkColor, mapOf("mail" to { links.email(supportEmail, subject = "") })),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

private fun documentOptions(reference: Reference): List<Option> {
    val listed =
        reference.optionsOf(Lists.DOCUMENT_TYPE, DocumentType.entries).map { (type, label) -> Option(type.wire, label) }
    if (listed.isNotEmpty()) return listed
    return DocumentType.entries
        .filter { it != DocumentType.UNKNOWN }
        .map { Option(it.wire, Reference.fallback(it.wire)) }
}

private val ConsentPoints =
    listOf(
        R.string.identity_consent_point_hidden,
        R.string.identity_consent_point_encrypted,
        R.string.identity_consent_point_not_shared,
        R.string.identity_consent_point_deleted,
    )
private val SavedValueBasis = 160.dp
private const val LOADING_FIELDS = 2
private const val BASICS_STEP = "basics"

/** What the identity form shows. */
@Immutable
data class IdentityFormUiState(
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    val profile: OwnProfile? = null,
    val summary: IdentitySummary? = null,
    /** "Change" was chosen on the read-only view of a saved number. */
    val changing: Boolean = false,
    val documentType: DocumentType = DocumentType.CNIC,
    /** Normalised: digits for CNIC, NICOP and POC; capitals and digits for a passport. */
    val number: String = "",
    val saving: Boolean = false,
    @param:StringRes val fieldError: Int? = null,
    /** The API's own message for `invalid` (one code covers several rules, 07 section 13.4). */
    val fieldMessage: String? = null,
    val mismatch: Boolean = false,
    /** `409 invalid_state`: the number is being verified or is verified. */
    val stateError: Boolean = false,
    /** A network or server failure: the inline message above the button. */
    val failed: Boolean = false,
    /** `409 identity_already_registered`: the dialog. */
    val registered: Boolean = false,
)

sealed interface IdentityFormEvent {
    data class Saved(
        val summary: IdentitySummary,
    ) : IdentityFormEvent

    data object GoToBasics : IdentityFormEvent
}

/** `GET /v1/me/identity`, the own profile for the defaults and wording, and `PUT /v1/me/identity`. */
@HiltViewModel
class IdentityFormViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(IdentityFormUiState())
        val state: StateFlow<IdentityFormUiState> = mutableState.asStateFlow()

        private val mutableEvents = MutableSharedFlow<IdentityFormEvent>(extraBufferCapacity = 4)
        val events: SharedFlow<IdentityFormEvent> = mutableEvents.asSharedFlow()

        private var typeChosen = false

        init {
            load()
        }

        fun load() {
            viewModelScope.launch {
                mutableState.update { it.copy(loading = true, loadError = null) }
                val identity = async { profiles.identity() }
                val profile = profiles.load()
                // No number yet may also be answered with `not_found` (as the web app reads it).
                val summary =
                    identity.await().recoverCatching { failure ->
                        if (failure.apiError.code == ErrorCode.NOT_FOUND) null else throw failure
                    }
                val failure = profile.exceptionOrNull() ?: summary.exceptionOrNull()
                if (failure != null) {
                    mutableState.update { it.copy(loading = false, loadError = failure.apiError) }
                    return@launch
                }
                val own = profile.getOrNull()
                val saved = summary.getOrNull()
                mutableState.update {
                    it.copy(
                        loading = false,
                        profile = own,
                        summary = saved,
                        documentType =
                            when {
                                typeChosen -> it.documentType
                                saved != null && saved.documentType != DocumentType.UNKNOWN -> saved.documentType
                                else -> defaultDocumentType(own?.location?.nationalityCode, own?.location?.countryCode)
                            },
                    )
                }
            }
        }

        fun change() {
            mutableState.update { it.copy(changing = true) }
        }

        fun setType(type: DocumentType) {
            typeChosen = true
            // A different document needs a different number (12 section 3.7).
            mutableState.update {
                if (it.documentType == type) {
                    it
                } else {
                    it.copy(documentType = type, number = "", fieldError = null, fieldMessage = null)
                }
            }
        }

        fun setNumber(input: String) {
            mutableState.update {
                it.copy(
                    number = normalizeIdentityNumber(it.documentType, input),
                    fieldError = null,
                    fieldMessage = null,
                    mismatch = false,
                )
            }
        }

        fun dismissRegistered() {
            mutableState.update { it.copy(registered = false) }
        }

        fun submit() {
            val current = mutableState.value
            if (current.saving) return
            val problem = identityNumberProblem(current.documentType, current.number)
            if (problem != null) {
                mutableState.update { it.copy(fieldError = problem, fieldMessage = null) }
                return
            }
            viewModelScope.launch {
                mutableState.update {
                    it.copy(
                        saving = true,
                        fieldError = null,
                        fieldMessage = null,
                        mismatch = false,
                        stateError = false,
                        failed = false,
                    )
                }
                profiles
                    .registerIdentity(current.documentType, current.number)
                    .onSuccess { summary ->
                        mutableState.update {
                            it.copy(saving = false, summary = summary, changing = false, number = "")
                        }
                        mutableEvents.emit(IdentityFormEvent.Saved(summary))
                    }.onFailure { failure ->
                        mutableState.update { it.copy(saving = false) }
                        handle(failure.apiError)
                    }
            }
        }

        private suspend fun handle(error: ApiError) {
            val profile = mutableState.value.profile
            when {
                error.code == ErrorCode.IDENTITY_ALREADY_REGISTERED -> {
                    mutableState.update { it.copy(registered = true) }
                }

                error.code == ErrorCode.INVALID_STATE -> {
                    if (profile != null && profile.status == ProfileStatus.DRAFT && profile.basics.gender == null) {
                        mutableEvents.emit(IdentityFormEvent.GoToBasics)
                    } else {
                        mutableState.update { it.copy(stateError = true) }
                    }
                }

                error.code == ErrorCode.VALIDATION_FAILED -> {
                    val field = error.fieldError(NUMBER_FIELD) ?: error.fields.firstOrNull()
                    mutableState.update {
                        when (field?.code) {
                            FieldCode.REQUIRED -> {
                                it.copy(fieldError = R.string.identity_errors_number_required)
                            }

                            FieldCode.MISMATCH -> {
                                it.copy(fieldError = R.string.identity_errors_number_mismatch, mismatch = true)
                            }

                            else -> {
                                it.copy(fieldMessage = field?.message, failed = field == null)
                            }
                        }
                    }
                }

                error.isGeneric -> {
                    mutableState.update { it.copy(failed = true) }
                }

                else -> {
                    bus.error(error)
                }
            }
        }

        private companion object {
            const val NUMBER_FIELD = "number"
        }
    }
