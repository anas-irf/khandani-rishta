package com.khandanirishta.app.ui.feature.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.BrandMark
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.KrTopBar
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.Wordmark
import com.khandanirishta.app.ui.feature.profilesections.BusyOverlay
import com.khandanirishta.app.ui.feature.profilesections.FieldSpacing
import com.khandanirishta.app.ui.feature.profilesections.InlineFailureBox
import com.khandanirishta.app.ui.navigation.Help
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The frame of every onboarding step with its ways out (07 section 2.5): Back, which asks
 * "Discard changes?" when input is unsaved, Help and "Sign out". Nothing can be left while a save
 * runs. [StepFrame] is what it draws.
 */
@Composable
internal fun OnboardingScaffold(
    step: String,
    edit: Boolean,
    title: String,
    busy: Boolean,
    dirty: Boolean,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    bottomBar: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    val currentStep = LocalMe.current
        ?.profile
        ?.onboardingStep
        ?.wire
    var discard by rememberSaveable { mutableStateOf(false) }
    var signOut by rememberSaveable { mutableStateOf(false) }
    val canGoBack = edit || Steps.previous(step) != null

    fun back() {
        if (dirty) discard = true else navigator.back()
    }

    // No way out while the save runs; unsaved input asks first (07 section 2.5).
    BackHandler(enabled = busy) {}
    BackHandler(enabled = !busy && dirty) { discard = true }

    StepFrame(
        step = step,
        currentStep = currentStep,
        title = title,
        busy = busy,
        onBack = if (canGoBack) ::back else null,
        onHelp = { navigator.push(Help) },
        onSignOut = { signOut = true },
        modifier = modifier,
        subtitle = subtitle,
        bottomBar = bottomBar,
        content = content,
    )

    if (discard) {
        ConfirmDialog(
            title = stringResource(R.string.onboarding_discard_title),
            text = stringResource(R.string.onboarding_discard_body),
            confirmLabel = stringResource(R.string.onboarding_discard_discard),
            dismissLabel = stringResource(R.string.onboarding_discard_keep),
            destructive = true,
            needsNetwork = false,
            onConfirm = {
                discard = false
                navigator.back()
            },
            onDismiss = { discard = false },
        )
    }
    if (signOut) {
        // Everything saved so far stays on the server; the next sign-in resumes here (07 section 2.5).
        ConfirmDialog(
            title = stringResource(R.string.common_sign_out_dialog_title),
            text = stringResource(R.string.common_sign_out_dialog_body),
            confirmLabel = stringResource(R.string.common_actions_sign_out),
            variant = KrButtonVariant.INK,
            needsNetwork = false,
            onConfirm = {
                signOut = false
                onSignOut()
                appViewModel.signOut()
            },
            onDismiss = { signOut = false },
        )
    }
}

/**
 * One onboarding step as drawn (07 section 2.6): the bar with Back and the menu, then on sand the
 * progress, the title and its line, then [content] in bands of its own ([StepBody] for a form).
 * Only the bar is pinned, so at 200% text the fields keep most of the screen.
 */
@Composable
internal fun StepFrame(
    step: String,
    currentStep: String?,
    title: String,
    busy: Boolean,
    onBack: (() -> Unit)?,
    onHelp: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    bottomBar: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        // A step without an action bar still keeps its field above the keyboard.
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = { StepTopBar(busy = busy, onBack = onBack, onHelp = onHelp, onSignOut = onSignOut) },
        bottomBar = bottomBar,
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState()),
            ) {
                Band(
                    tone = BandTone.SAND,
                    padding = HeaderPadding,
                    maxWidth = Sizes.formWidth,
                    spacing = Spacing.s8,
                ) {
                    if (currentStep != null) {
                        StepProgress(
                            step = step,
                            currentStep = currentStep,
                            modifier = Modifier.padding(bottom = Spacing.s16),
                        )
                    }
                    Text(
                        text = title,
                        style = MaterialTheme.typography.headlineMedium,
                        modifier = Modifier.semantics { heading() },
                    )
                    if (subtitle != null) {
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.bodyMedium,
                            color = KrTheme.colors.textSecondary,
                        )
                    }
                }
                content()
            }
            BusyOverlay(busy)
        }
    }
}

/**
 * Back, the brand and the menu. Beside Back the name gives way to the mark at large text, where it
 * would break inside a word.
 */
@Composable
private fun StepTopBar(
    busy: Boolean,
    onBack: (() -> Unit)?,
    onHelp: () -> Unit,
    onSignOut: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val named = onBack == null || LocalDensity.current.fontScale <= NAME_FITS
    KrTopBar(color = MaterialTheme.colorScheme.surfaceContainer, divider = false) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(Spacing.s4),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                KrIconButton(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.a11y_back),
                    onClick = onBack,
                    enabled = !busy,
                )
            }
            Box(
                Modifier
                    .weight(1f)
                    .padding(start = if (onBack == null) Spacing.s16 else Spacing.s4, end = Spacing.s4),
            ) {
                if (named) Wordmark() else BrandMark()
            }
            Box {
                KrIconButton(
                    icon = Icons.Outlined.MoreVert,
                    contentDescription = stringResource(R.string.onboarding_menu_label),
                    onClick = { menu = true },
                )
                KrMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    KrMenuItem(
                        text = stringResource(R.string.settings_help_title),
                        icon = Icons.AutoMirrored.Outlined.HelpOutline,
                        onClick = {
                            menu = false
                            onHelp()
                        },
                    )
                    KrMenuItem(
                        text = stringResource(R.string.onboarding_menu_sign_out),
                        icon = Icons.AutoMirrored.Outlined.Logout,
                        enabled = !busy,
                        onClick = {
                            menu = false
                            onSignOut()
                        },
                    )
                }
            }
        }
    }
}

/** The one column of a step: the form width, centred, on the page. */
@Composable
internal fun StepBody(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Band(
        modifier = modifier,
        padding = BodyPadding,
        maxWidth = Sizes.formWidth,
        spacing = FieldSpacing,
        content = content,
    )
}

/**
 * The action bar of a step (DESIGN.md section 6.14): an inline [failure] with "Try again"
 * (07 section 16.9), the live [summary] above the button (07 section 11.3 rule 4), and one
 * primary. The skip control follows the fields, see [StepSecondaryAction].
 */
@Composable
internal fun StepBottomBar(
    modifier: Modifier = Modifier,
    primaryLabel: String? = null,
    onPrimary: () -> Unit = {},
    busy: Boolean = false,
    enabled: Boolean = true,
    summary: String? = null,
    failure: ApiError? = null,
    onRetry: () -> Unit = onPrimary,
) {
    if (primaryLabel == null && failure == null) return
    KrActionBar(
        modifier = modifier,
        maxWidth = Sizes.formWidth,
        banner =
            failure?.let { error ->
                {
                    InlineFailureBox(
                        text = stringResource(R.string.onboarding_failed),
                        error = error,
                        onRetry = onRetry,
                        busy = busy,
                        enabled = enabled,
                    )
                }
            },
    ) {
        if (summary != null) {
            Text(
                text = summary,
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (primaryLabel != null) {
            KrButton(
                text = primaryLabel,
                onClick = onPrimary,
                enabled = enabled,
                loading = busy,
                fullWidth = true,
            )
        }
    }
}

/**
 * "Skip for now" or "Add photos later", outlined after the fields (07 section 2.6), with the line
 * that goes with it.
 */
@Composable
internal fun StepSecondaryAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    note: String? = null,
) {
    Column(modifier.padding(top = Spacing.s12)) {
        KrButton(
            text = label,
            onClick = onClick,
            variant = KrButtonVariant.SECONDARY,
            enabled = enabled,
            loading = loading,
            fullWidth = true,
        )
        if (note != null) CaptionText(note, Modifier.padding(top = Spacing.s8))
    }
}

/** "Save what you entered?" when skipping a step with input (07 section 2.5). */
@Composable
internal fun SkipDialog(
    onSave: () -> Unit,
    onSkip: () -> Unit,
    onDismiss: () -> Unit,
) {
    KrDialog(
        title = stringResource(R.string.onboarding_skip_dialog_title),
        confirmLabel = stringResource(R.string.onboarding_skip_dialog_save),
        onConfirm = onSave,
        confirmEnabled = LocalOnline.current,
        dismissLabel = stringResource(R.string.onboarding_skip_dialog_skip),
        dismissEnabled = LocalOnline.current,
        onDismiss = onSkip,
        onDismissRequest = onDismiss,
    )
}

/** Up to this text scale the wordmark fits between Back and the menu at 320. */
private const val NAME_FITS = 1.3f
private val HeaderPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s4, end = Spacing.gutter, bottom = Spacing.s24)
private val BodyPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s24, end = Spacing.gutter, bottom = Spacing.s40)
