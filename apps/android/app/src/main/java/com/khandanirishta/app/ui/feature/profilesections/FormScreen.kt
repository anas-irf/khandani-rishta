package com.khandanirishta.app.ui.feature.profilesections

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.ui.components.AnswerRow
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The frame of the own-profile forms (ME-EDIT, ME-PREFS, SET-CONTACTS): a top bar with Back, one
 * scrolling column on the page with the screen's gutters, and the [bottomBar], which stays above
 * the keyboard. Back or "Cancel" with unsaved input asks "Discard changes?" (08 section 2);
 * nothing can be left while a save runs.
 */
@Composable
fun FormScreenScaffold(
    title: String,
    busy: Boolean,
    dirty: Boolean,
    onLeave: () -> Unit,
    bottomBar: @Composable (onCancel: () -> Unit) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    var discard by rememberSaveable { mutableStateOf(false) }

    fun leave() {
        if (dirty) discard = true else onLeave()
    }

    BackHandler(enabled = busy) {}
    BackHandler(enabled = !busy && dirty) { discard = true }

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { DetailTopBar(title = title, onBack = ::leave, backEnabled = !busy) },
        bottomBar = { bottomBar(::leave) },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding),
        ) {
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .contentWidth(Sizes.formWidth)
                        .padding(
                            start = Spacing.gutter,
                            top = Spacing.s24,
                            end = Spacing.gutter,
                            bottom = Spacing.s32,
                        ),
                verticalArrangement = Arrangement.spacedBy(FieldSpacing),
                content = content,
            )
            BusyOverlay(busy)
        }
    }

    if (discard) {
        ConfirmDialog(
            title = stringResource(R.string.me_discard_title),
            text = stringResource(R.string.me_discard_body),
            confirmLabel = stringResource(R.string.me_discard_discard),
            dismissLabel = stringResource(R.string.me_discard_keep),
            destructive = true,
            needsNetwork = false,
            onConfirm = {
                discard = false
                onLeave()
            },
            onDismiss = { discard = false },
        )
    }
}

/**
 * "Cancel" and "Save" at the bottom of an own-profile form, with a spinner in "Save" while it runs,
 * an optional [summary] line over them, and the inline [failure] with "Try again" (08 section 2.5).
 * Without a connection Save waits (rule G14).
 */
@Composable
fun SaveBar(
    onSave: () -> Unit,
    onCancel: () -> Unit,
    busy: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    saveLabel: String = stringResource(R.string.common_actions_save),
    cancelLabel: String = stringResource(R.string.common_actions_cancel),
    summary: String? = null,
    failure: ApiError? = null,
    failureText: String = stringResource(R.string.profile_sections_form_failed),
) {
    val canSave = enabled && LocalOnline.current
    // Two stacked answers over a keyboard would hide what is being typed, and Back does what Cancel does.
    val saveAlone = WindowInsets.isImeVisible && LocalDensity.current.fontScale >= LARGE_TEXT
    KrActionBar(
        modifier = modifier,
        maxWidth = Sizes.formWidth,
        banner =
            if (failure == null) {
                null
            } else {
                { InlineFailureBox(text = failureText, error = failure, onRetry = onSave, busy = busy) }
            },
    ) {
        if (summary != null) {
            Text(
                text = summary,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (saveAlone) {
            KrButton(text = saveLabel, onClick = onSave, enabled = canSave, loading = busy, fullWidth = true)
        } else {
            AnswerRow(
                secondary = { answer ->
                    KrButton(
                        text = cancelLabel,
                        onClick = onCancel,
                        variant = KrButtonVariant.SECONDARY,
                        size = KrButtonSize.LARGE,
                        enabled = !busy,
                        modifier = answer,
                    )
                },
                primary = { answer ->
                    KrButton(text = saveLabel, onClick = onSave, enabled = canSave, loading = busy, modifier = answer)
                },
            )
        }
    }
}

private const val LARGE_TEXT = 1.3f
