package com.khandanirishta.app.ui.feature.onboarding

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.generated.model.MeConfig
import com.khandanirishta.app.core.tracking.Tracker
import com.khandanirishta.app.ui.feature.profilesections.wireCode
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.text.LocalMe
import javax.inject.Inject
import javax.inject.Singleton
import com.khandanirishta.app.core.network.generated.model.OnboardingStep as ApiStep

/** The onboarding steps, their groups and skip rules (07 sections 2.2 and 2.3). */
object Steps {
    val ORDER: List<String> = GateRouter.ONBOARDING_STEPS.map { it.wire }

    fun index(step: String): Int = GateRouter.stepIndex(step)

    fun next(step: String): String = ORDER.getOrNull(index(step) + 1) ?: REVIEW

    /** The previous step, or `null` on the first one (its Back leaves the app). */
    fun previous(step: String): String? = ORDER.getOrNull(index(step) - 1)

    fun api(step: String): ApiStep? = ApiStep.entries.firstOrNull { it.wire == step && step.isNotEmpty() }

    data class Group(
        @param:StringRes val name: Int,
        val steps: List<String>,
    )

    val GROUPS: List<Group> =
        listOf(
            Group(R.string.onboarding_groups_about, listOf("account_for", "basics", "community", "location")),
            Group(R.string.onboarding_groups_background, listOf("education_career", "family", "lifestyle")),
            Group(R.string.onboarding_groups_photos_preferences, listOf("photos", "preferences")),
            Group(R.string.onboarding_groups_verify_finish, listOf("identity", REVIEW)),
        )

    fun groupOf(step: String): Group = GROUPS.firstOrNull { step in it.steps } ?: GROUPS.first()

    /** Whether the step offers a skip control (07 section 2.2). */
    fun skippable(
        step: String,
        config: MeConfig,
    ): Boolean =
        when (step) {
            "family", "lifestyle" -> true
            "photos" -> !config.photoRequired
            "identity" -> !config.identityRequired
            else -> false
        }

    /** The step that owns an API field key (07 section 14.3, "starts with or equals"). */
    fun forField(field: String): String? =
        FIELD_STEPS.firstOrNull { (_, prefixes) -> prefixes.any { field.startsWith(it) } }?.first

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
            "preferences" to listOf("preferences"),
            "identity" to listOf("number", "document_type"),
        )

    const val REVIEW = "review"
}

/**
 * The onboarding funnel of 07 section 17, and the field errors a failed completion hands to the
 * step that owns them (07 section 14.2). Kept in memory for the session; events never carry
 * personal data.
 */
@Singleton
class OnboardingSession
    @Inject
    constructor(
        private val tracker: Tracker,
    ) {
        private var startedAt = System.currentTimeMillis()
        private var started = false
        private val skipped = LinkedHashSet<String>()
        private var pendingErrors: Pair<String, List<FieldError>>? = null

        /** A step screen is shown; the very first screen of a new profile also starts the funnel. */
        fun stepViewed(
            step: String,
            edit: Boolean,
            currentStep: String,
        ) {
            if (step == "account_for" && currentStep == "account_for" && !started) {
                started = true
                startedAt = System.currentTimeMillis()
                tracker.track("onboarding_started")
            }
            tracker.track("onboarding_step_viewed", "step" to step, "mode" to (if (edit) "edit" else "flow"))
        }

        fun stepCompleted(
            step: String,
            viewedAt: Long,
            managedBy: String?,
        ) {
            tracker.track(
                "onboarding_step_completed",
                "step" to step,
                "duration_ms" to (System.currentTimeMillis() - viewedAt).coerceAtLeast(0),
                "managed_by" to managedBy.orEmpty(),
            )
        }

        fun stepSkipped(step: String) {
            skipped += step
            tracker.track("onboarding_step_skipped", "step" to step)
        }

        /** A save or `continue` answered `validation_failed`. */
        fun validationFailed(
            step: String,
            error: ApiError,
        ) {
            if (error.code != ErrorCode.VALIDATION_FAILED) return
            tracker.track(
                "onboarding_validation_failed",
                "step" to step,
                "fields" to error.fields.joinToString(",") { it.field },
                "codes" to error.fields.joinToString(",") { it.code.wire },
            )
        }

        fun helpMeWriteUsed() = tracker.track("onboarding_help_me_write_used")

        fun photoPrivacyChosen(
            visibility: String,
            count: Int,
        ) = tracker.track("onboarding_photo_privacy_chosen", "photo_visibility" to visibility, "photo_count" to count)

        fun completed(gate: String) {
            tracker.track(
                "onboarding_completed",
                "result_gate" to gate,
                "total_duration_ms" to (System.currentTimeMillis() - startedAt).coerceAtLeast(0),
                "skipped_steps" to skipped.joinToString(","),
            )
            started = false
            skipped.clear()
            startedAt = System.currentTimeMillis()
        }

        fun signedOut(step: String) = tracker.track("onboarding_signed_out", "step" to step)

        fun setCompletionErrors(
            step: String,
            fields: List<FieldError>,
        ) {
            pendingErrors = step to fields
        }

        /** The completion errors for [step], once. */
        fun takeCompletionErrors(step: String): List<FieldError>? {
            val pending = pendingErrors ?: return null
            if (pending.first != step) return null
            pendingErrors = null
            return pending.second
        }
    }

/** Where a step goes after its save (07 sections 2.4 and 2.5). */
sealed interface StepOutcome {
    /** Edit mode: back to the review step. */
    data object Back : StepOutcome

    /** The next step's screen. */
    data class Open(
        val step: String,
    ) : StepOutcome

    /** Another device moved on (`409 invalid_state`): open the server's current step. */
    data class Jump(
        val step: String,
    ) : StepOutcome

    /** A step of the review in edit mode, with the completion's errors waiting for it. */
    data class Edit(
        val step: String,
    ) : StepOutcome

    data class Failed(
        val error: ApiError,
    ) : StepOutcome
}

/**
 * The per-step sequence after a successful save (07 section 2.4 steps 5 and 6, section 2.5): in
 * edit mode return to the review; for an earlier step open the next one; for the current step call
 * `continue` and open the step the server returns.
 */
class OnboardingFlow
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val me: MeRepository,
        private val session: OnboardingSession,
    ) {
        fun isCurrent(step: String): Boolean =
            me.current
                ?.profile
                ?.onboardingStep
                ?.wire == step

        val currentStep: String get() = me.current
            ?.profile
            ?.onboardingStep
            ?.wire
            .orEmpty()

        suspend fun advance(
            step: String,
            edit: Boolean,
            viewedAt: Long,
        ): StepOutcome {
            if (edit) return StepOutcome.Back
            if (!isCurrent(step)) return StepOutcome.Open(Steps.next(step))
            return runContinue(step, viewedAt)
        }

        /** "Skip for now" without saving: `continue` only. */
        suspend fun skip(
            step: String,
            edit: Boolean,
            viewedAt: Long,
        ): StepOutcome {
            if (edit) return StepOutcome.Back
            if (!isCurrent(step)) return StepOutcome.Open(Steps.next(step))
            val outcome = runContinue(step, viewedAt)
            if (outcome is StepOutcome.Open) session.stepSkipped(step)
            return outcome
        }

        private suspend fun runContinue(
            step: String,
            viewedAt: Long,
        ): StepOutcome {
            val apiStep = Steps.api(step) ?: return StepOutcome.Open(Steps.next(step))
            val result = profiles.continueOnboarding(apiStep)
            val next = result.getOrNull()
            if (next != null) {
                session.stepCompleted(step, viewedAt, next.profile.managedBy.wireCode)
                return StepOutcome.Open(next.profile.onboardingStep.wire)
            }
            val error = result.exceptionOrNull()?.apiError ?: ApiError.network()
            if (error.code == ErrorCode.INVALID_STATE) {
                // Another device moved on: follow it.
                val fresh = me.refresh().getOrNull()
                return StepOutcome.Jump(
                    error.detailString("onboarding_step") ?: fresh?.profile?.onboardingStep?.wire ?: step,
                )
            }
            session.validationFailed(step, error)
            return StepOutcome.Failed(error)
        }
    }

/**
 * Performs a step's navigation once the gate allows it. A step is pushed only after `Me` names it
 * as reached, because the navigator refuses a step later than the current one (16 section 3.2).
 */
@Composable
fun StepNavigationEffect(
    outcome: StepOutcome?,
    onHandle: () -> Unit,
) {
    val navigator = LocalNavigator.current
    val me = LocalMe.current
    val currentOnHandle by rememberUpdatedState(onHandle)
    LaunchedEffect(outcome, me?.profile?.onboardingStep, me?.gate) {
        val target = outcome ?: return@LaunchedEffect

        fun allowed(step: String) =
            me != null && GateRouter.isAllowed(me.gate, me.profile.onboardingStep, OnboardingStep(step))
        when (target) {
            StepOutcome.Back -> {
                navigator.back()
                currentOnHandle()
            }

            is StepOutcome.Open -> {
                if (allowed(target.step)) {
                    navigator.push(OnboardingStep(target.step))
                    currentOnHandle()
                }
            }

            is StepOutcome.Jump -> {
                if (allowed(target.step)) {
                    navigator.openStep(target.step)
                    currentOnHandle()
                }
            }

            is StepOutcome.Edit -> {
                navigator.push(OnboardingStep(target.step, edit = true))
                currentOnHandle()
            }

            is StepOutcome.Failed -> {
                currentOnHandle()
            }
        }
    }
}

/** Shows [step] with the steps before it underneath, as if the member had walked there. */
private fun AppNavigator.openStep(step: String) {
    val target = Steps.index(step)
    if (target < 0) return
    popUntil { key -> key is OnboardingStep && !key.edit && Steps.index(key.step) <= target }
    val reached = (this.top.key as? OnboardingStep)?.let { Steps.index(it.step) } ?: -1
    for (index in (reached + 1)..target) push(OnboardingStep(Steps.ORDER[index]))
}
