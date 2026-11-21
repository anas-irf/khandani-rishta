package com.khandanirishta.app.ui.feature.profilesections

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar

/**
 * The frame of the own-profile forms (ME-EDIT, ME-PREFS, SET-CONTACTS): a top bar with Back, one
 * scrolling column, and the [bottomBar]. Back or "Cancel" with unsaved input asks "Discard
 * changes?" (08 section 2); nothing can be left while a save runs.
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

    BackHandler(enabled = busy) { }
    BackHandler(enabled = !busy && dirty) { discard = true }

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { DetailTopBar(title = title, onBack = { if (!busy) leave() }) },
        bottomBar = { bottomBar(::leave) },
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
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(FieldSpacing),
                content = {
                    content()
                    Spacer(Modifier.height(8.dp))
                },
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
 * an optional [summary] line, and the inline [failure] with "Try again" (08 section 2.5).
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
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (failure != null) InlineFailureBox(text = failureText, error = failure, onRetry = onSave, busy = busy)
            if (summary != null) {
                Text(
                    summary,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(
                    onClick = onCancel,
                    enabled = !busy,
                    modifier =
                        Modifier
                            .weight(1f)
                            .heightIn(min = 52.dp),
                ) { Text(cancelLabel) }
                Button(
                    onClick = onSave,
                    enabled = enabled && !busy,
                    modifier =
                        Modifier
                            .weight(2f)
                            .heightIn(min = 52.dp),
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = LocalContentColor.current,
                        )
                    } else {
                        Text(saveLabel)
                    }
                }
            }
        }
    }
}
