package com.khandanirishta.app.ui.navigation

import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.OnboardingStep as Step

/**
 * Pure routing rules (specs/22 section 3.2, specs/16 section 3.2). `Me.gate` is the only input that
 * decides where a signed-in member may be. Every row has a unit test in GateRouterTest.
 */
object GateRouter {
    /** Onboarding step order (03 section 4.3). */
    val ONBOARDING_STEPS: List<Step> =
        listOf(
            Step.ACCOUNT_FOR,
            Step.BASICS,
            Step.COMMUNITY,
            Step.LOCATION,
            Step.EDUCATION_CAREER,
            Step.FAMILY,
            Step.LIFESTYLE,
            Step.PHOTOS,
            Step.PREFERENCES,
            Step.IDENTITY,
            Step.REVIEW,
        )

    /** Index of a step key in the order; the number of steps for `done`; -1 when unknown. */
    fun stepIndex(step: String): Int =
        if (step == Step.DONE.wire) ONBOARDING_STEPS.size else ONBOARDING_STEPS.indexOfFirst { it.wire == step }

    /** The root of the back stack for a gate. */
    fun root(
        gate: Gate,
        onboardingStep: Step,
    ): AppKey =
        when (gate) {
            Gate.BANNED, Gate.SUSPENDED -> {
                GateBlocked
            }

            Gate.DELETION_SCHEDULED -> {
                GateDeletion
            }

            Gate.CONSENT_REQUIRED -> {
                GateConsent
            }

            Gate.ONBOARDING -> {
                OnboardingStep(
                    step = onboardingStep.takeIf { it in ONBOARDING_STEPS }?.wire ?: Step.ACCOUNT_FOR.wire,
                )
            }

            Gate.CHANGES_REQUESTED -> {
                GateChanges
            }

            Gate.PENDING_REVIEW -> {
                GateReview
            }

            Gate.OK, Gate.UNKNOWN -> {
                Home
            }
        }

    /** Whether the gate shows the tabbed application. */
    fun isTabbed(gate: Gate): Boolean = gate == Gate.OK || gate == Gate.UNKNOWN

    /** Own profile, settings and notifications stay open while a profile is in review (16 section 3.2). */
    private fun allowedInReview(key: AppKey): Boolean =
        when (key) {
            MyProfile, is EditSection, MyPhotos, MyPreferences, Verification, is VerifyIdentity, VerifySelfie -> true
            Notifications -> true
            Settings, PrivacySettings, NotificationSettings, is ContactDetails, AccountSettings, Help -> true
            else -> false
        }

    /** Whether [key] may be opened under [gate] (16 section 3.2). A key that is not allowed is never pushed. */
    fun isAllowed(
        gate: Gate,
        onboardingStep: Step,
        key: AppKey,
    ): Boolean =
        when (gate) {
            Gate.BANNED, Gate.SUSPENDED -> {
                key == GateBlocked || key == Help
            }

            Gate.DELETION_SCHEDULED -> {
                key == GateDeletion || key == Help
            }

            Gate.CONSENT_REQUIRED -> {
                key == GateConsent
            }

            Gate.ONBOARDING -> {
                when (key) {
                    Help -> {
                        true
                    }

                    is OnboardingStep -> {
                        val index = stepIndex(key.step)
                        index >= 0 && index < ONBOARDING_STEPS.size && index <= maxOf(stepIndex(onboardingStep.wire), 0)
                    }

                    else -> {
                        false
                    }
                }
            }

            Gate.CHANGES_REQUESTED -> {
                key == GateChanges || allowedInReview(key)
            }

            Gate.PENDING_REVIEW -> {
                key == GateReview || allowedInReview(key)
            }

            Gate.OK, Gate.UNKNOWN -> {
                when (key) {
                    GateBlocked, GateDeletion, GateConsent, GateReview, GateChanges, is OnboardingStep -> false
                    else -> true
                }
            }
        }

    /** Access levels of specs/15 section 3 that the own profile status can refuse (17 section 4.3). */
    enum class Level { OPEN, CONNECTED, ENGAGE, BROWSE }

    /** Which status panel replaces a screen needing [level], or `null` when it can be shown. */
    fun statusPanel(
        status: ProfileStatus,
        level: Level,
    ): ProfileStatus? =
        when {
            status == ProfileStatus.PAUSED && level == Level.BROWSE -> ProfileStatus.PAUSED
            status == ProfileStatus.CLOSED && (level == Level.BROWSE || level == Level.ENGAGE) -> ProfileStatus.CLOSED
            else -> null
        }
}
