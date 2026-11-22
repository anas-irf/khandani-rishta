package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.feature.profilesections.SECTION_KEYS
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * ONB-01 to ONB-11 (specs/07 sections 2 to 14, specs/16 section 6.3): one step of onboarding.
 * [step] is the API step key; [edit] is true when the step was opened with "Edit" from the review
 * step: its button reads "Save", it saves and returns to the review, and `continue` is not called.
 */
@Composable
fun OnboardingStepScreen(
    step: String,
    edit: Boolean,
) {
    when (step) {
        in SECTION_KEYS -> SectionStep(step = step, edit = edit)
        "photos" -> PhotosStep(edit = edit)
        "preferences" -> PreferencesStep(edit = edit)
        "identity" -> IdentityStep(edit = edit)
        Steps.REVIEW -> ReviewStep()
        else -> UnknownStep()
    }
}

/** ONB-DONE (specs/07 section 15): shown once, after a completion that results in the gate `ok`. */
@Composable
fun OnboardingDoneScreen() {
    DoneContent()
}

/** A step key this build does not know opens the current step (07 section 2.5). */
@Composable
private fun UnknownStep() {
    val navigator = LocalNavigator.current
    val current = LocalMe.current
        ?.profile
        ?.onboardingStep
        ?.wire
    LaunchedEffect(current) {
        if (current != null && Steps.index(current) >= 0) navigator.replaceTop(OnboardingStep(current))
    }
    FormSkeleton(
        Modifier
            .safeDrawingPadding()
            .contentWidth(Sizes.formWidth)
            .padding(horizontal = Spacing.gutter, vertical = Spacing.s24),
    )
}
