package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.NudgeCard
import com.khandanirishta.app.ui.components.OrnamentRule
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.dashedBorder
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.InnerArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/** The three things that make a real difference (07 section 15.1). */
internal enum class DoneAction { PHOTO, VERIFY, PRIVACY }

private fun actionsFor(profile: OwnProfile): List<DoneAction> =
    buildList {
        if (usablePhotos(profile.photos).isEmpty()) add(DoneAction.PHOTO)
        if (!profile.verification.idVerified && !profile.verification.pending.idDocument) add(DoneAction.VERIFY)
        add(DoneAction.PRIVACY)
    }

/**
 * ONB-DONE as drawn (07 section 15.1): the success band with its arches and the display line,
 * the next steps as nudge cards, and "See my matches" in the action bar.
 */
@Composable
internal fun DoneBody(
    state: DoneUi,
    onRetry: () -> Unit,
    onAction: (DoneAction) -> Unit,
    onSeeMatches: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val matches =
        rememberCandidate().pick(
            R.string.onboarding_done_matches,
            R.string.onboarding_done_matches_male,
            R.string.onboarding_done_matches_female,
        )
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.safeDrawing,
        // The success fill runs on under the status bar and stays there, so no text scrolls under it.
        topBar = { StatusBarFill() },
        bottomBar = { StepBottomBar(primaryLabel = stringResource(matches), onPrimary = onSeeMatches) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            DoneHero()
            Band(maxWidth = Sizes.formWidth, spacing = Spacing.s12) {
                val profile = state.profile
                when {
                    state.loadError != null && profile == null -> ErrorState(state.loadError, onRetry = onRetry)
                    profile == null -> NextStepsSkeleton()
                    else -> NextSteps(profile = profile, onAction = onAction)
                }
            }
        }
    }
}

@Composable
private fun DoneHero() {
    Band(tone = BandTone.SUCCESS, padding = HeroPadding, maxWidth = Sizes.formWidth, spacing = Spacing.s16) {
        DoneArches(Modifier.align(Alignment.CenterHorizontally))
        OrnamentRule(Modifier.align(Alignment.CenterHorizontally), centered = true)
        Text(
            text = stringResource(R.string.onboarding_done_title),
            style = MaterialTheme.typography.displaySmall,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { heading() },
        )
        Text(
            text = stringResource(R.string.onboarding_done_subtitle),
            style = MaterialTheme.typography.bodyLarge,
            color = KrTheme.colors.textSecondary,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .widthIn(max = Sizes.measure),
        )
    }
}

@Composable
private fun StatusBarFill() {
    Box(
        Modifier
            .fillMaxWidth()
            .background(KrTheme.colors.successContainer)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top)),
    )
}

/** Two families and the meeting between them, whole now. Decoration. */
@Composable
private fun DoneArches(modifier: Modifier = Modifier) {
    val extra = KrTheme.colors
    Row(
        modifier = modifier.clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalAlignment = Alignment.Bottom,
    ) {
        val side = Modifier.size(Sizes.arch64).dashedBorder(InnerArchShape, extra.ornament)
        Box(side)
        Box(
            modifier =
                Modifier
                    .size(Sizes.arch96)
                    .background(extra.success, ArchShape)
                    .padding(Spacing.s8)
                    .border(Strokes.hairline, extra.ornament, InnerArchShape),
            contentAlignment = Alignment.Center,
        ) {
            Diamond(size = Spacing.s12)
        }
        Box(side)
    }
}

@Composable
private fun NextSteps(
    profile: OwnProfile,
    onAction: (DoneAction) -> Unit,
) {
    val actions = remember(profile) { actionsFor(profile) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        actions.forEach { action ->
            when (action) {
                DoneAction.PHOTO -> {
                    NudgeCard(
                        title = stringResource(R.string.onboarding_done_photo_title),
                        description = stringResource(R.string.onboarding_done_photo_text),
                        icon = Icons.Outlined.PhotoCamera,
                        onClick = { onAction(action) },
                    )
                }

                DoneAction.VERIFY -> {
                    NudgeCard(
                        title = stringResource(R.string.onboarding_done_verify_title),
                        description = stringResource(R.string.onboarding_done_verify_text),
                        icon = Icons.Outlined.Badge,
                        tone = ArchTone.SUCCESS,
                        onClick = { onAction(action) },
                    )
                }

                DoneAction.PRIVACY -> {
                    NudgeCard(
                        title = stringResource(R.string.onboarding_done_privacy_title),
                        description = stringResource(R.string.onboarding_done_privacy_text),
                        icon = Icons.Outlined.Tune,
                        onClick = { onAction(action) },
                    )
                }
            }
        }
    }
}

@Composable
private fun NextStepsSkeleton() {
    LoadingRegion(Modifier.fillMaxWidth(), spacing = Spacing.s12) {
        repeat(DoneAction.entries.size) {
            SkeletonBox(Modifier.fillMaxWidth().height(NextStepHeight), shape = MaterialTheme.shapes.large)
        }
    }
}

/** A nudge card with its title and two lines of text. */
private val NextStepHeight = 108.dp
private val HeroPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s16, end = Spacing.gutter, bottom = Spacing.s32)
