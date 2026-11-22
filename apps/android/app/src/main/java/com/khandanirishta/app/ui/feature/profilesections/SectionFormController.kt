package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.runtime.Immutable
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.ui.messages.MessageBus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What a section form shows: a skeleton, an error with "Try again", or the form. */
@Immutable
data class SectionFormUi(
    val section: String,
    val mode: FormMode,
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    /** The profile the form was filled from (fresh, 08 section 2). */
    val profile: OwnProfile? = null,
    val form: FormState<SectionInput>? = null,
    /** A new gender to confirm before saving (07 section 4.1), as a wire code. */
    val confirmGender: String? = null,
    /** The currency of the income list (07 section 7.2). */
    val incomeCurrency: String? = null,
)

/** What happens after a successful save. */
sealed interface AfterSave {
    /** Nothing more: the form is idle and clean. */
    data object Done : AfterSave

    /** The screen navigates away: the form stays busy until [SectionFormController.release]. */
    data object Leave : AfterSave

    /** A follow-up call failed (the onboarding `continue`): shown like a failed save. */
    data class Failed(
        val error: ApiError,
    ) : AfterSave
}

/**
 * The form of one profile section, shared by onboarding (ONB-01 to ONB-07) and ME-EDIT (08
 * section 2): it loads `GET /v1/me/profile` fresh, fills the form, validates on the device, saves
 * with `PUT /v1/me/profile/sections/{section}` and then runs the screen's follow-up, keeping the
 * button busy until it settles. Lives in the screen's ViewModel, so input survives rotation.
 */
class SectionFormController(
    private val scope: CoroutineScope,
    val section: String,
    val mode: FormMode,
    private val profiles: ProfileRepository,
    private val references: ReferenceRepository,
    private val places: PlaceLookup,
    private val bus: MessageBus,
    /** API field errors to show once the form is filled (a failed completion, 07 section 14.2). */
    private var initialErrors: List<FieldError>? = null,
    /** Told about every failed save or follow-up (the onboarding funnel, 07 section 17). */
    private val onApiError: (ApiError) -> Unit = {},
) {
    private val mutable = MutableStateFlow(SectionFormUi(section, mode))
    val state: StateFlow<SectionFormUi> = mutable.asStateFlow()

    private var context: SectionContext? = null
    private var rules: SectionRules? = null
    private var pendingAfterSave: (suspend (OwnProfile) -> AfterSave)? = null

    init {
        load()
    }

    /** `GET /v1/me/profile`, never a cached copy (08 section 2). */
    fun load() {
        mutable.update { it.copy(loading = it.form == null, loadError = null) }
        scope.launch {
            profiles
                .load()
                .onSuccess { profile -> if (mutable.value.form == null) fill(profile) }
                .onFailure { error -> mutable.update { it.copy(loading = false, loadError = error.apiError) } }
        }
    }

    private fun fill(profile: OwnProfile) {
        val context = SectionContext(mode, profile, references.reference.value, places)
        val rules = SectionRules(context)
        this.context = context
        this.rules = rules
        val values = sectionValues(section, context)
        var form = FormState.of(values, rules)
        initialErrors?.let { form = form.withFieldErrors(rules, it) }
        initialErrors = null
        val bands = context.reference
            ?.data
            ?.incomeBands
            .orEmpty()
        val currency =
            IncomeCurrency.initial(
                bands,
                profile.location.countryCode,
                (values as? EducationCareerInput)?.incomeBandCode,
            )
        mutable.update {
            it.copy(loading = false, loadError = null, profile = profile, form = form, incomeCurrency = currency)
        }
    }

    /** The rules of the filled form, for the composables that show it. */
    val sectionContext: SectionContext? get() = context

    fun edit(
        fields: Set<String>,
        transform: (SectionInput) -> SectionInput,
    ) {
        val rules = rules ?: return
        mutable.update { state -> state.copy(form = state.form?.edit(rules, fields, transform)) }
    }

    /** "Change currency" reloads the band list and clears the choice (07 section 7.2 rule 4). */
    fun setIncomeCurrency(currency: String) {
        mutable.update { it.copy(incomeCurrency = currency) }
        edit(setOf("income_band_code")) { values ->
            (values as? EducationCareerInput)?.copy(incomeBandCode = null) ?: values
        }
    }

    /**
     * Validates, saves the whole section and runs [afterSave] (07 section 2.4 steps 3 to 5).
     * Nothing runs while a save is busy, so a double submission is impossible.
     */
    fun submit(afterSave: suspend (OwnProfile) -> AfterSave) {
        submit(confirmedGender = false, afterSave = afterSave)
    }

    private fun submit(
        confirmedGender: Boolean,
        afterSave: suspend (OwnProfile) -> AfterSave,
    ) {
        val rules = rules ?: return
        val context = context ?: return
        val current = mutable.value.form ?: return
        if (current.busy) return
        val (checked, values) = current.begin(rules)
        mutable.update { it.copy(form = checked) }
        if (values == null) return
        // 07 section 4.1: changing a saved gender during onboarding asks first.
        if (values is BasicsInput && mode == FormMode.ONBOARDING && !confirmedGender) {
            val saved = context.profile.basics.gender.wireCode
            if (saved != null && values.gender != null && values.gender != saved) {
                pendingAfterSave = afterSave
                mutable.update { it.copy(form = checked.idle(), confirmGender = values.gender) }
                return
            }
        }
        scope.launch {
            val saved = profiles.saveSection(values.toPayload(context))
            val profile = saved.getOrNull()
            if (profile == null) {
                fail(saved.exceptionOrNull()?.apiError ?: return@launch)
                return@launch
            }
            refill(profile)
            when (val after = afterSave(profile)) {
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

    /** The saved profile is the new truth for the rules (a changed gender, a new religion). */
    private fun refill(profile: OwnProfile) {
        val context = SectionContext(mode, profile, references.reference.value, places)
        this.context = context
        rules = SectionRules(context)
        mutable.update { it.copy(profile = profile) }
    }

    private fun fail(error: ApiError) {
        val rules = rules ?: return
        onApiError(error)
        mutable.update { it.copy(form = it.form?.failed(rules, error)) }
        if (!error.shownByForm) bus.error(error)
    }

    /** "Change" in the gender dialog: save after all. */
    fun confirmGender() {
        val afterSave = pendingAfterSave ?: return
        pendingAfterSave = null
        mutable.update { it.copy(confirmGender = null) }
        submit(confirmedGender = true, afterSave = afterSave)
    }

    fun cancelGender() {
        pendingAfterSave = null
        mutable.update { it.copy(confirmGender = null) }
    }

    /** The screen finished navigating: the form can be used again when the member returns. */
    fun release() {
        mutable.update { it.copy(form = it.form?.idle()) }
    }
}
