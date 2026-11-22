package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Elevation
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.Spacing

/*
 * Dialogs (specs/16 rule G8, DESIGN.md section 6.13). Short decisions are Material dialogs;
 * anything with choices or a field is a bottom sheet. A dialog's buttons are 56 tall, and each
 * takes a line of its own when they do not fit.
 */

/**
 * Material's dialog in the look of the system: surface, 28 radius, a scrolling body and full
 * buttons. The confirming button is drawn in [variant] and repeats the verb.
 */
@Composable
fun KrDialog(
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    text: String? = null,
    variant: KrButtonVariant = KrButtonVariant.PRIMARY,
    dismissLabel: String? = null,
    onDismiss: () -> Unit = onDismissRequest,
    busy: Boolean = false,
    confirmEnabled: Boolean = true,
    dismissEnabled: Boolean = true,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    val body: (@Composable () -> Unit)? =
        if (text == null && content == null) {
            null
        } else {
            {
                CompositionLocalProvider(LocalTonalColor provides colors.surfaceContainer) {
                    Column(
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
                    ) {
                        if (text != null) Text(text, style = MaterialTheme.typography.bodyMedium)
                        content?.invoke(this)
                    }
                }
            }
        }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismissRequest() },
        modifier = modifier,
        shape = MaterialTheme.shapes.extraLarge,
        containerColor = KrTheme.colors.card,
        titleContentColor = colors.onSurface,
        textContentColor = colors.onSurface,
        tonalElevation = Elevation.none,
        title =
            title?.let {
                {
                    Text(it, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                }
            },
        text = body,
        confirmButton = {
            AdaptiveRow(Modifier.fillMaxWidth()) {
                if (dismissLabel != null) {
                    KrButton(
                        text = dismissLabel,
                        onClick = onDismiss,
                        variant = KrButtonVariant.SECONDARY,
                        size = KrButtonSize.LARGE,
                        enabled = dismissEnabled && !busy,
                        modifier = Modifier.grow(),
                    )
                }
                KrButton(
                    text = confirmLabel,
                    onClick = onConfirm,
                    variant = variant,
                    size = KrButtonSize.LARGE,
                    enabled = confirmEnabled,
                    loading = busy,
                    modifier = Modifier.grow(),
                )
            }
        },
    )
}

/**
 * The confirmation of rule G8: the consequence in one or two sentences and a confirming button
 * that repeats the verb. With [typedPhrase], the button waits until the phrase is typed.
 * [destructive] is for what destroys something ("Block", "Delete"); a negative choice that
 * destroys nothing passes `KrButtonVariant.INK` as its [variant].
 */
@Composable
fun ConfirmDialog(
    title: String,
    text: String?,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    variant: KrButtonVariant = if (destructive) KrButtonVariant.DANGER else KrButtonVariant.PRIMARY,
    dismissLabel: String = stringResource(R.string.common_actions_cancel),
    busy: Boolean = false,
    needsNetwork: Boolean = true,
    typedPhrase: String? = null,
    extra: (@Composable () -> Unit)? = null,
) {
    var typed by rememberSaveable { mutableStateOf("") }
    val online = LocalOnline.current || !needsNetwork
    KrDialog(
        title = title,
        text = text,
        confirmLabel = confirmLabel,
        onConfirm = onConfirm,
        onDismissRequest = onDismiss,
        variant = variant,
        dismissLabel = dismissLabel,
        busy = busy,
        confirmEnabled = online && (typedPhrase == null || typed.trim() == typedPhrase),
        content =
            if (extra == null && typedPhrase == null) {
                null
            } else {
                {
                    extra?.invoke()
                    if (typedPhrase != null) {
                        KrTextField(
                            value = typed,
                            onValueChange = { typed = it },
                            label = text(R.string.shared_confirm_type_phrase, "phrase" to typedPhrase),
                        )
                    }
                }
            },
    )
}

/** The `limit_reached` dialog (specs/16 section 1.3). */
@Composable
fun LimitDialog(
    text: String?,
    onDismiss: () -> Unit,
) {
    KrDialog(
        title = stringResource(R.string.errors_limit_title),
        text = text ?: stringResource(R.string.errors_limit_default),
        confirmLabel = stringResource(R.string.errors_limit_ok),
        onConfirm = onDismiss,
        onDismissRequest = onDismiss,
    )
}

/** A single choice list inside dialogs and sheets. */
@Composable
fun RadioList(
    options: List<Option>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Column(modifier.selectableGroup()) {
        options.forEach { option ->
            RadioRow(
                label = option.label,
                selected = option.code == selected,
                onClick = { onSelect(option.code) },
                enabled = enabled,
            )
        }
    }
}

/**
 * The decline sheet of specs/16 section 6.7, shared by the profile and Interests: "Also block",
 * then Cancel and Decline in ink. Declining is quiet, so the text says the other is not told.
 */
@Composable
fun DeclineDialog(
    name: String,
    onConfirm: (alsoBlock: Boolean) -> Unit,
    onDismiss: () -> Unit,
    busy: Boolean = false,
) {
    var alsoBlock by rememberSaveable { mutableStateOf(false) }
    KrSheet(
        title = stringResource(R.string.profile_decline_title),
        description = text(R.string.profile_decline_text, "name" to name),
        onDismissRequest = onDismiss,
        dismissible = !busy,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.profile_decline_confirm),
                onConfirm = { onConfirm(alsoBlock) },
                onCancel = onDismiss,
                variant = KrButtonVariant.INK,
                busy = busy,
            )
        },
    ) {
        CheckboxRow(
            checked = alsoBlock,
            onCheckedChange = { alsoBlock = it },
            label = text(R.string.profile_decline_also_block, "name" to name),
            enabled = !busy,
        )
    }
}

/** Cancel and the confirming button at the foot of a sheet, 56 tall and equally wide. */
@Composable
fun SheetAnswers(
    confirmLabel: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    variant: KrButtonVariant = KrButtonVariant.PRIMARY,
    cancelLabel: String = stringResource(R.string.common_actions_cancel),
    enabled: Boolean = true,
    needsNetwork: Boolean = true,
    busy: Boolean = false,
) {
    val online = LocalOnline.current || !needsNetwork
    AdaptiveRow(modifier.fillMaxWidth()) {
        KrButton(
            text = cancelLabel,
            onClick = onCancel,
            variant = KrButtonVariant.SECONDARY,
            size = KrButtonSize.LARGE,
            enabled = !busy,
            modifier = Modifier.grow(),
        )
        KrButton(
            text = confirmLabel,
            onClick = onConfirm,
            variant = variant,
            size = KrButtonSize.LARGE,
            enabled = online && enabled,
            loading = busy,
            modifier = Modifier.grow(),
        )
    }
}

/**
 * The report sheet used from every "Report" control (specs/16 section 6.11): a required reason,
 * optional details (at most 1,000 characters) and "Also block this member", ticked by default.
 */
@Composable
fun ReportDialog(
    name: String,
    reasons: List<Option>,
    onSubmit: (reason: String, details: String, alsoBlock: Boolean) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    initialReason: String? = null,
) {
    var reason by rememberSaveable { mutableStateOf(initialReason) }
    var details by rememberSaveable { mutableStateOf("") }
    var alsoBlock by rememberSaveable { mutableStateOf(true) }
    var showRequired by rememberSaveable { mutableStateOf(false) }
    KrSheet(
        title = text(R.string.shared_report_title, "name" to name),
        onDismissRequest = onDismiss,
        dismissible = !busy,
        modifier = modifier,
        actions = {
            // With the buttons, so it is on screen however far the reasons have scrolled.
            if (showRequired) {
                FieldSupport(
                    helper = null,
                    error = stringResource(R.string.shared_report_reason_required),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
            }
            SheetAnswers(
                confirmLabel = stringResource(R.string.shared_report_submit),
                onConfirm = {
                    val chosen = reason
                    if (chosen == null) showRequired = true else onSubmit(chosen, details.trim(), alsoBlock)
                },
                onCancel = onDismiss,
                busy = busy,
            )
        },
    ) {
        FieldLabel(stringResource(R.string.shared_report_reason_label))
        RadioList(
            options = reasons,
            selected = reason,
            enabled = !busy,
            onSelect = {
                reason = it
                showRequired = false
            },
        )
        KrTextField(
            value = details,
            onValueChange = { details = it },
            label = stringResource(R.string.shared_report_details_label),
            optional = true,
            maxLength = REPORT_MAX,
            counter = text(R.string.shared_report_details_count, "count" to details.length, "max" to REPORT_MAX),
            singleLine = false,
            minLines = 3,
            enabled = !busy,
        )
        CheckboxRow(
            checked = alsoBlock,
            onCheckedChange = { alsoBlock = it },
            label = stringResource(R.string.shared_report_also_block),
            enabled = !busy,
        )
    }
}

/** "Block {name}?" (specs/16 section 6.7). */
@Composable
fun BlockDialog(
    name: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    busy: Boolean = false,
) {
    ConfirmDialog(
        title = text(R.string.shared_block_title, "name" to name),
        text = stringResource(R.string.shared_block_text),
        confirmLabel = stringResource(R.string.shared_block_confirm),
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        destructive = true,
        busy = busy,
    )
}

/** The note on a shortlisted profile: at most 300 characters that only the member sees. */
@Composable
fun NoteDialog(
    name: String,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit,
    initial: String = "",
    busy: Boolean = false,
) {
    var note by rememberSaveable(initial) { mutableStateOf(initial) }
    KrSheet(
        title = text(R.string.discovery_shortlist_note_title, "name" to name),
        description = stringResource(R.string.discovery_shortlist_note_help),
        onDismissRequest = onDismiss,
        dismissible = !busy,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.common_actions_save),
                onConfirm = { onSave(note) },
                onCancel = onDismiss,
                busy = busy,
            )
        },
    ) {
        KrTextField(
            value = note,
            onValueChange = { note = it },
            label = stringResource(R.string.discovery_shortlist_note_label),
            maxLength = NOTE_MAX,
            counter = text(R.string.discovery_shortlist_note_count, "count" to note.length, "max" to NOTE_MAX),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            singleLine = false,
            minLines = 3,
            enabled = !busy,
        )
    }
}

private const val REPORT_MAX = 1000
private const val NOTE_MAX = 300
