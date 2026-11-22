package com.khandanirishta.app.ui.feature.gates

import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.ConsentDocument
import com.khandanirishta.app.core.network.generated.model.FieldCode
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.VerifyIdentity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class GateUiState(
    /** An action of the screen is running. */
    val busy: Boolean = false,
    /** The fields named by a `validation_failed` answer to "Resubmit for review". */
    val problems: List<FieldError> = emptyList(),
    /** A screen to open once: the one that fixes the first problem (07 section 14.3). */
    val openTarget: AppKey? = null,
)

/**
 * The gate screens (specs/16 section 6.2). Each refetches `GET /v1/me` when it opens; a response
 * that returns `Me` replaces the cache, and the gate host swaps the screen when the gate changes.
 * A failed refetch keeps the cached `Me`.
 */
@HiltViewModel
class GateViewModel
    @Inject
    constructor(
        private val meRepository: MeRepository,
        private val profiles: ProfileRepository,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(GateUiState())
        val state: StateFlow<GateUiState> = mutableState.asStateFlow()

        /** The own profile, for the action cards of GATE-REVIEW (07 section 15.1). */
        val ownProfile: StateFlow<OwnProfile?> = profiles.ownProfile

        private var pollJob: Job? = null
        private var profileWanted = false

        init {
            viewModelScope.launch { meRepository.refresh() }
            viewModelScope.launch {
                // A photo added or an identity sent meanwhile changes which cards still apply.
                invalidation.on(DataKey.OwnProfile).collect { if (profileWanted) profiles.load() }
            }
        }

        /** Refetches `Me` every [intervalMillis] while the screen is visible (GATE-BLOCKED, GATE-REVIEW). */
        fun startPolling(intervalMillis: Long) {
            pollJob?.cancel()
            pollJob =
                viewModelScope.launch {
                    while (isActive) {
                        delay(intervalMillis)
                        meRepository.refresh()
                    }
                }
        }

        fun stopPolling() {
            pollJob?.cancel()
            pollJob = null
        }

        fun loadOwnProfile() {
            profileWanted = true
            viewModelScope.launch { profiles.cachedOrLoad() }
        }

        /** "Keep my account": `DELETE /v1/me/deletion` (06 section 9.3). */
        fun keepAccount() =
            runAction {
                meRepository
                    .cancelDeletion()
                    .onSuccess { bus.toast(R.string.gate_deletion_welcome_back) }
                    .onFailure { handleFailure(it.apiError) }
            }

        /** "Accept and continue": `POST /v1/me/consents` with the documents still required. */
        fun acceptConsents(documents: List<ConsentDocument>) =
            runAction {
                meRepository.acceptConsents(documents).onFailure { handleFailure(it.apiError) }
            }

        /**
         * "Resubmit for review": `POST /v1/me/profile/resubmit`. `validation_failed` lists what is
         * missing and opens the screen that fixes the first item (16 section 6.2, 07 section 14.3).
         */
        fun resubmit() {
            if (mutableState.value.busy) return
            mutableState.update { it.copy(problems = emptyList()) }
            runAction {
                meRepository.resubmit().onFailure { error ->
                    val apiError = error.apiError
                    if (apiError.code == ErrorCode.VALIDATION_FAILED) {
                        val target =
                            apiError.fields.firstNotNullOfOrNull { field ->
                                stepForField(field.field)?.let(::fixTargetForStep)
                            }
                        mutableState.update { it.copy(problems = apiError.fields, openTarget = target) }
                    } else {
                        handleFailure(apiError)
                    }
                }
            }
        }

        fun consumeOpenTarget() {
            mutableState.update { it.copy(openTarget = null) }
        }

        /** `invalid_state`: the state changed elsewhere, so `Me` is fetched again and the gate decides. */
        private suspend fun handleFailure(apiError: ApiError) {
            if (apiError.code == ErrorCode.INVALID_STATE) {
                meRepository.refresh()
            } else {
                bus.error(apiError)
            }
        }

        private fun runAction(block: suspend () -> Unit) {
            if (mutableState.value.busy) return
            mutableState.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    block()
                } finally {
                    mutableState.update { it.copy(busy = false) }
                }
            }
        }
    }

/** "The profile has no photo that is not rejected or failed" (07 section 15.1). */
internal fun needsPhoto(profile: OwnProfile): Boolean =
    profile.photos.none { it.status != PhotoStatus.REJECTED && it.status != PhotoStatus.FAILED }

/** "`id_verified` is false and no `id_document` request is pending" (07 section 15.1). */
internal fun needsVerification(profile: OwnProfile): Boolean =
    !profile.verification.idVerified && !profile.verification.pending.idDocument

/**
 * Which onboarding step owns an API field named by `validation_failed` (07 section 14.3). A field
 * matches when it equals a listed name or continues it with `.` or `[`.
 */
private val FIELD_STEPS: List<Pair<String, List<String>>> =
    listOf(
        "account_for" to listOf("managed_by", "manager_name", "consents"),
        "basics" to
            listOf(
                "first_name",
                "last_name",
                "gender",
                "date_of_birth",
                "marital_status",
                "current_wives_count",
                "children_status",
                "children_count",
                "height_cm",
            ),
        "community" to
            listOf(
                "religion_code",
                "sect_code",
                "caste_code",
                "caste_other",
                "sub_caste_code",
                "sub_caste_other",
                "mother_tongue_code",
                "language_codes",
            ),
        "location" to
            listOf(
                "country_code",
                "region_id",
                "city_id",
                "city_other",
                "area",
                "nationality_code",
                "residency_status",
                "origin_city_id",
                "origin_other",
                "relocation",
            ),
        "education_career" to
            listOf(
                "education_level_code",
                "education_field_code",
                "degree_title",
                "institute_name",
                "employment_type",
                "profession_code",
                "job_title",
                "employer_name",
                "income_band_code",
            ),
        "photos" to listOf("photos"),
        "identity" to listOf("number", "document_type"),
    )

private val EDITABLE_SECTIONS =
    setOf("account_for", "basics", "community", "location", "education_career", "family", "lifestyle")

/** The step that owns [field], or `null` when the table does not list it. */
internal fun stepForField(field: String): String? =
    FIELD_STEPS.firstOrNull { (_, names) -> names.any { name -> fieldMatches(field, name) } }?.first

/** A field matches a listed name when it equals it or continues it with `.` or `[` (a nested key or a list item). */
private fun fieldMatches(
    field: String,
    name: String,
): Boolean = field == name || field.startsWith("$name.") || field.startsWith("$name[")

/** The own-profile screen that fixes a step: ME-EDIT, ME-PHOTOS or ME-VERIFY-ID. */
internal fun fixTargetForStep(step: String): AppKey? =
    when (step) {
        "photos" -> MyPhotos
        "identity" -> VerifyIdentity(changeNumber = true)
        in EDITABLE_SECTIONS -> EditSection(step)
        else -> null
    }

/** The name of a step in the messages of GATE-CHANGES ("Basics", "Location", ...). */
@StringRes
internal fun sectionLabel(step: String): Int? =
    when (step) {
        "account_for" -> R.string.gate_changes_sections_account_for
        "basics" -> R.string.gate_changes_sections_basics
        "community" -> R.string.gate_changes_sections_community
        "location" -> R.string.gate_changes_sections_location
        "education_career" -> R.string.gate_changes_sections_education_career
        "family" -> R.string.gate_changes_sections_family
        "lifestyle" -> R.string.gate_changes_sections_lifestyle
        "photos" -> R.string.gate_changes_sections_photos
        "identity" -> R.string.gate_changes_sections_identity
        else -> null
    }

/** The text for one field error: the app's own for a known code, the API's message otherwise. */
internal fun problemText(problem: FieldError): UiText =
    if (problem.code == FieldCode.UNKNOWN) UiText.Raw(problem.message) else MessageBus.fieldText(problem.code.wire)
