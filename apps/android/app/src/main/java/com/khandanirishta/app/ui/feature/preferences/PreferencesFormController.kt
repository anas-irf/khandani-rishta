package com.khandanirishta.app.ui.feature.preferences

import androidx.compose.runtime.Immutable
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.TextStatus
import com.khandanirishta.app.ui.feature.profilesections.AfterSave
import com.khandanirishta.app.ui.feature.profilesections.FormMode
import com.khandanirishta.app.ui.feature.profilesections.FormState
import com.khandanirishta.app.ui.feature.profilesections.begin
import com.khandanirishta.app.ui.feature.profilesections.edit
import com.khandanirishta.app.ui.feature.profilesections.failed
import com.khandanirishta.app.ui.feature.profilesections.idle
import com.khandanirishta.app.ui.feature.profilesections.savedAs
import com.khandanirishta.app.ui.feature.profilesections.shownByForm
import com.khandanirishta.app.ui.feature.profilesections.withFieldErrors
import com.khandanirishta.app.ui.messages.MessageBus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the preferences form shows: a skeleton, an error with "Try again", or the form. */
@Immutable
data class PreferencesFormUi(
    val mode: FormMode,
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    val form: FormState<PreferencesInput>? = null,
    /** The candidate's gender: it decides `married`, hijab or beard, and the work label (07 section 11.2). */
    val candidateGender: Gender? = null,
    /** The moderation state of `notes` (08 section 1.4). */
    val notesStatus: TextStatus? = null,
)

/**
 * The partner preferences form of ONB-09 and ME-PREFS (07 section 11): loads
 * `GET /v1/me/preferences` (the stored row or the defaults of 07 section 12) and always saves the
 * full object with `PUT /v1/me/preferences`, even when nothing changed (11.1).
 */
class PreferencesFormController(
    private val scope: CoroutineScope,
    val mode: FormMode,
    private val profiles: ProfileRepository,
    private val references: ReferenceRepository,
    me: MeRepository,
    private val bus: MessageBus,
    private var initialErrors: List<FieldError>? = null,
    private val onApiError: (ApiError) -> Unit = {},
) {
    private val gender: Gender? = me.current?.profile?.gender
    private val mutable = MutableStateFlow(PreferencesFormUi(mode = mode, candidateGender = gender))
    val state: StateFlow<PreferencesFormUi> = mutable.asStateFlow()

    val rules = PreferencesRules(gender) { religions -> sectsOf(references.reference.value, religions).isNotEmpty() }

    init {
        load()
        scope.launch {
            profiles.cachedOrLoad().onSuccess { profile ->
                mutable.update { it.copy(notesStatus = profile.textStatus.partnerNotes) }
            }
        }
    }

    fun load() {
        mutable.update { it.copy(loading = it.form == null, loadError = null) }
        scope.launch {
            profiles
                .preferences()
                .onSuccess { preferences ->
                    if (mutable.value.form != null) return@onSuccess
                    var form = FormState.of(PreferencesInput.from(preferences), rules)
                    initialErrors?.let { form = form.withFieldErrors(rules, it) }
                    initialErrors = null
                    mutable.update { it.copy(loading = false, form = form) }
                }.onFailure { error -> mutable.update { it.copy(loading = false, loadError = error.apiError) } }
        }
    }

    fun edit(
        fields: Set<String>,
        transform: (PreferencesInput) -> PreferencesInput,
    ) {
        mutable.update { state -> state.copy(form = state.form?.edit(rules, fields, transform)) }
    }

    /** Validates, saves the full object and runs [afterSave]; nothing runs while a save is busy. */
    fun submit(afterSave: suspend (Preferences) -> AfterSave) {
        val current = mutable.value.form ?: return
        if (current.busy) return
        val (checked, values) = current.begin(rules)
        mutable.update { it.copy(form = checked) }
        if (values == null) return
        scope.launch {
            val saved = profiles.savePreferences(values.toBody(gender, references.reference.value))
            val preferences = saved.getOrNull()
            if (preferences == null) {
                fail(saved.exceptionOrNull()?.apiError ?: return@launch)
                return@launch
            }
            when (val after = afterSave(preferences)) {
                AfterSave.Done -> {
                    mutable.update { it.copy(form = it.form?.savedAs(values)) }
                }

                AfterSave.Leave -> {
                    mutable.update { it.copy(form = it.form?.savedAs(values)?.copy(busy = true)) }
                }

                is AfterSave.Failed -> {
                    mutable.update { it.copy(form = it.form?.savedAs(values)) }
                    fail(after.error)
                }
            }
        }
    }

    private fun fail(error: ApiError) {
        onApiError(error)
        mutable.update { it.copy(form = it.form?.failed(rules, error)) }
        if (!error.shownByForm) bus.error(error)
    }

    /** The screen finished navigating: the form can be used again when the member returns. */
    fun release() {
        mutable.update { it.copy(form = it.form?.idle()) }
    }

    companion object {
        /** The sects of the selected religions. */
        fun sectsOf(
            reference: Reference?,
            religions: Set<String>,
        ): Set<String> =
            reference
                ?.data
                ?.religions
                ?.filter { it.code in religions }
                ?.flatMap { religion -> religion.sects.map { it.code } }
                ?.toSet()
                .orEmpty()
    }
}
