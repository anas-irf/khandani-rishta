package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.ui.text.text

/**
 * The confirmation of rule G8: the consequence in one or two sentences, and a confirming button
 * that repeats the verb. With [typedPhrase], the button waits until the phrase is typed.
 */
@Composable
fun ConfirmDialog(
    title: String,
    text: String?,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    dismissLabel: String = stringResource(R.string.common_actions_cancel),
    busy: Boolean = false,
    typedPhrase: String? = null,
    extra: (@Composable () -> Unit)? = null,
) {
    var typed by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (text != null) Text(text, style = MaterialTheme.typography.bodyMedium)
                extra?.invoke()
                if (typedPhrase != null) {
                    OutlinedTextField(
                        value = typed,
                        onValueChange = { typed = it },
                        singleLine = true,
                        label = { Text(text(R.string.shared_confirm_type_phrase, "phrase" to typedPhrase)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = !busy && (typedPhrase == null || typed.trim() == typedPhrase),
            ) {
                Text(
                    confirmLabel,
                    color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                )
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(dismissLabel) } },
    )
}

/** The `limit_reached` dialog (specs/16 section 1.3). */
@Composable
fun LimitDialog(
    text: String?,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.errors_limit_title)) },
        text = { Text(text ?: stringResource(R.string.errors_limit_default)) },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.errors_limit_ok)) } },
    )
}

/** A single choice list inside dialogs and sheets. */
@Composable
fun RadioList(
    options: List<Option>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.selectableGroup()) {
        options.forEach { option ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .selectable(
                        selected = option.code == selected,
                        onClick = { onSelect(option.code) },
                        role = Role.RadioButton,
                    ).padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = option.code == selected, onClick = null)
                Text(
                    option.label,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
        }
    }
}

/** A checkbox with its label as one 48 dp touch target. */
@Composable
fun CheckboxRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onCheckedChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = null, enabled = enabled)
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = 12.dp),
            color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The report dialog used from every "Report" control (specs/16 section 6.11): a required reason,
 * optional details (at most 1,000 characters) and "Also block this member", ticked by default.
 */
@Composable
fun ReportDialog(
    name: String,
    reasons: List<Option>,
    onSubmit: (reason: String, details: String, alsoBlock: Boolean) -> Unit,
    onDismiss: () -> Unit,
    busy: Boolean = false,
    initialReason: String? = null,
) {
    var reason by rememberSaveable { mutableStateOf(initialReason) }
    var details by rememberSaveable { mutableStateOf("") }
    var alsoBlock by rememberSaveable { mutableStateOf(true) }
    var showRequired by rememberSaveable { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(text(R.string.shared_report_title, "name" to name)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(stringResource(R.string.shared_report_reason_label), style = MaterialTheme.typography.labelLarge)
                RadioList(options = reasons, selected = reason, onSelect = {
                    reason = it
                    showRequired = false
                })
                if (showRequired) {
                    Text(
                        stringResource(R.string.shared_report_reason_required),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                OutlinedTextField(
                    value = details,
                    onValueChange = { if (it.length <= REPORT_MAX) details = it },
                    label = { Text(stringResource(R.string.shared_report_details_label)) },
                    supportingText = {
                        Text(text(R.string.shared_report_details_count, "count" to details.length, "max" to REPORT_MAX))
                    },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                CheckboxRow(checked = alsoBlock, onCheckedChange = {
                    alsoBlock = it
                }, label = stringResource(R.string.shared_report_also_block))
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = {
                    val chosen = reason
                    if (chosen == null) showRequired = true else onSubmit(chosen, details.trim(), alsoBlock)
                },
            ) { Text(stringResource(R.string.shared_report_submit)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    )
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

private const val REPORT_MAX = 1000
