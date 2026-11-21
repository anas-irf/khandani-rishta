package com.khandanirishta.app.ui.feature.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.feature.profilesections.BusyOverlay
import com.khandanirishta.app.ui.feature.profilesections.FieldSpacing
import com.khandanirishta.app.ui.feature.profilesections.InlineFailureBox
import com.khandanirishta.app.ui.navigation.Help
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text

/**
 * The frame of every onboarding step (07 sections 2.3, 2.5 and 2.6): a top bar with the step title,
 * Back (hidden on ONB-01) and a menu with Help and "Sign out", the four-part progress indicator,
 * one scrolling column, and the [bottomBar] with the step's buttons. Back with unsaved input asks
 * "Discard changes?"; nothing can be left while a save runs.
 */
@OptIn(ExperimentalMaterial3Api::class)
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
    val me = LocalMe.current
    var discard by rememberSaveable { mutableStateOf(false) }
    var signOut by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val canGoBack = edit || Steps.previous(step) != null

    fun back() {
        if (dirty) discard = true else navigator.back()
    }

    // No way out while the save runs; unsaved input asks first (07 section 2.5).
    BackHandler(enabled = busy) { }
    BackHandler(enabled = !busy && dirty) { discard = true }

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            Column(Modifier.background(MaterialTheme.colorScheme.background)) {
                TopAppBar(
                    title = {
                        Text(
                            title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleLarge,
                            autoSize = TextAutoSize.StepBased(minFontSize = 15.sp, maxFontSize = 20.sp),
                        )
                    },
                    navigationIcon = {
                        if (canGoBack) {
                            IconButton(onClick = ::back, enabled = !busy) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = stringResource(R.string.a11y_back),
                                )
                            }
                        }
                    },
                    actions = {
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(
                                    Icons.Outlined.MoreVert,
                                    contentDescription = stringResource(R.string.onboarding_menu_label),
                                )
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.settings_help_title)) },
                                    leadingIcon = {
                                        Icon(Icons.AutoMirrored.Outlined.HelpOutline, contentDescription = null)
                                    },
                                    onClick = {
                                        menu = false
                                        navigator.push(Help)
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.onboarding_menu_sign_out)) },
                                    leadingIcon = {
                                        Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null)
                                    },
                                    enabled = !busy,
                                    onClick = {
                                        menu = false
                                        signOut = true
                                    },
                                )
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                )
                if (me != null) ProgressHeader(step = step, currentStep = me.profile.onboardingStep.wire)
            }
        },
        bottomBar = bottomBar,
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(FieldSpacing),
            ) {
                if (subtitle != null) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                content()
                Spacer(Modifier.height(8.dp))
            }
            BusyOverlay(busy)
        }
    }

    if (discard) {
        ConfirmDialog(
            title = stringResource(R.string.onboarding_discard_title),
            text = stringResource(R.string.onboarding_discard_body),
            confirmLabel = stringResource(R.string.onboarding_discard_discard),
            dismissLabel = stringResource(R.string.onboarding_discard_keep),
            destructive = true,
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
 * The progress indicator of 07 section 2.3: four segments, one per group, each filled in
 * proportion to the completed steps of its group; under it the group name and "Step N of 11".
 * Display only, not a navigation control.
 */
@Composable
private fun ProgressHeader(
    step: String,
    currentStep: String,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val current = Steps.index(currentStep).let { if (it < 0) Steps.ORDER.size else it }
    val group = Steps.groupOf(step)
    val description =
        res.getString(R.string.onboarding_progress_label) + ". " +
            Steps.GROUPS.joinToString(". ") { entry ->
                val done = entry.steps.count { Steps.index(it) < current }
                res.text(
                    R.string.onboarding_progress_group_done,
                    "group" to res.getString(entry.name),
                    "done" to done,
                    "total" to entry.steps.size,
                )
            }
    Column(
        modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = description },
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Steps.GROUPS.forEach { entry ->
                val done = entry.steps.count { Steps.index(it) < current }
                val fraction by animateFloatAsState(done.toFloat() / entry.steps.size, label = "progress")
                val track =
                    if (entry == group) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceContainerHighest
                    }
                Box(
                    Modifier
                        .weight(1f)
                        .height(6.dp)
                        .clip(CircleShape)
                        .background(track),
                ) {
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(fraction)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary),
                    )
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(group.name),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            Text(
                text(R.string.onboarding_progress_step, "n" to Steps.index(step) + 1, "total" to Steps.ORDER.size),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * The sticky bottom bar of a step: an inline [failure] with "Try again" (07 section 16.9), an
 * optional [summary] line, the primary button with a spinner while it runs, then the skip control
 * and its [note] (07 section 2.6).
 */
@Composable
internal fun StepBottomBar(
    modifier: Modifier = Modifier,
    primaryLabel: String? = null,
    onPrimary: () -> Unit = {},
    busy: Boolean = false,
    enabled: Boolean = true,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    secondaryBusy: Boolean = false,
    note: String? = null,
    summary: String? = null,
    failure: ApiError? = null,
    onRetry: () -> Unit = onPrimary,
) {
    if (primaryLabel == null && secondaryLabel == null && failure == null) return
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 8.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (failure != null) {
                InlineFailureBox(
                    text = stringResource(R.string.onboarding_failed),
                    error = failure,
                    onRetry = onRetry,
                    busy = busy,
                )
            }
            if (summary != null) {
                Text(
                    summary,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            if (primaryLabel != null) {
                Button(
                    onClick = onPrimary,
                    enabled = enabled && !busy,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp),
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = LocalContentColor.current,
                        )
                    } else {
                        Text(primaryLabel)
                    }
                }
            }
            if (secondaryLabel != null && onSecondary != null) {
                TextButton(
                    onClick = onSecondary,
                    enabled = enabled && !busy && !secondaryBusy,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                ) {
                    if (secondaryBusy) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Text(secondaryLabel)
                    }
                }
            }
            if (note != null) {
                Text(
                    note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** "Save what you entered?" when skipping a step with input (07 section 2.5). */
@Composable
internal fun SkipDialog(
    onSave: () -> Unit,
    onSkip: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.onboarding_skip_dialog_title)) },
        confirmButton = { TextButton(onClick = onSave) { Text(stringResource(R.string.onboarding_skip_dialog_save)) } },
        dismissButton = { TextButton(onClick = onSkip) { Text(stringResource(R.string.onboarding_skip_dialog_skip)) } },
    )
}
