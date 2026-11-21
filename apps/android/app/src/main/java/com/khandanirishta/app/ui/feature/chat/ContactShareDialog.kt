package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.ContactShareBody
import com.khandanirishta.app.core.network.generated.model.ContactsSection
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

/**
 * The member's current value for an item, as the dialog and "You are sharing:" show it; `null`
 * when missing. The guardian item needs the guardian's name and phone number (08 section 3.5).
 */
@Composable
internal fun contactValue(
    contacts: ContactsSection,
    item: ShareItem,
): String? {
    val reference = LocalReference.current
    if (!contacts.has(item)) return null
    return when (item) {
        ShareItem.PHONE -> {
            contacts.phoneE164?.let(::formatPhone)
        }

        ShareItem.WHATSAPP -> {
            contacts.whatsappE164?.let(::formatPhone)
        }

        ShareItem.EMAIL -> {
            contacts.contactEmail
        }

        ShareItem.GUARDIAN -> {
            val relation =
                contacts.guardianRelation
                    ?.let { reference.option(Lists.GUARDIAN_RELATION, it) }
                    ?.takeIf { it.isNotBlank() }
            buildString {
                append(contacts.guardianName.orEmpty())
                if (relation != null) append(" (").append(relation).append(")")
                append(", ").append(formatPhone(contacts.guardianPhoneE164.orEmpty()))
            }
        }
    }
}

/**
 * "Share contact details with {name}" (16 section 6.12, 09 section 10): four checkboxes with the
 * member's current values, "Add" for a missing value (it opens `SET-CONTACTS` and comes back here),
 * the guardian hint when families prefer it, and the fixed warning of 09 section 10.3.
 */
@Composable
internal fun ContactShareDialog(
    name: String,
    profile: OwnProfile?,
    selection: ContactShareBody?,
    missing: ShareItem?,
    busy: Boolean,
    online: Boolean,
    onChange: (ContactShareBody) -> Unit,
    onAdd: (ShareItem, ContactShareBody) -> Unit,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(text(R.string.chat_share_title, "name" to name)) },
        text = {
            if (profile == null || selection == null) {
                val loading = stringResource(R.string.common_loading)
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(Modifier.semantics { contentDescription = loading })
                }
            } else {
                Column(
                    Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (guardianFirst(profile)) {
                        Text(
                            stringResource(R.string.chat_share_guardian_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }
                    ShareItem.entries.forEach { item ->
                        ShareItemRow(
                            label = stringResource(item.label),
                            value = contactValue(profile.contacts, item),
                            checked = selection.isOn(item),
                            onToggle = { on -> onChange(selection.with(item, on)) },
                            addLabel = text(R.string.chat_share_add_named, "item" to stringResource(item.missing)),
                            onAdd = { onAdd(item, selection) },
                        )
                    }
                    Surface(
                        color = KrTheme.colors.warningContainer,
                        shape = MaterialTheme.shapes.medium,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                    ) {
                        Row(Modifier.padding(12.dp)) {
                            Icon(
                                Icons.Outlined.WarningAmber,
                                contentDescription = null,
                                tint = KrTheme.colors.warning,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                stringResource(R.string.chat_share_warning),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                    if (missing != null) {
                        Surface(
                            color = MaterialTheme.colorScheme.errorContainer,
                            contentColor = MaterialTheme.colorScheme.onErrorContainer,
                            shape = MaterialTheme.shapes.medium,
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                        ) {
                            Row(
                                Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text(R.string.chat_share_add_first, "item" to stringResource(missing.missing)),
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.weight(1f),
                                )
                                TextButton(onClick = { onAdd(missing, selection) }) {
                                    Text(stringResource(R.string.chat_share_add_now))
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onShare,
                enabled = profile != null && selection?.anyOn == true && online && !busy,
            ) { ProgressLabel(stringResource(R.string.chat_share_submit), busy) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    )
}

/** One item: a checkbox with the current value, disabled with "Add" when there is none. */
@Composable
private fun ShareItemRow(
    label: String,
    value: String?,
    checked: Boolean,
    onToggle: (Boolean) -> Unit,
    addLabel: String,
    onAdd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val enabled = value != null
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier
                .weight(1f)
                .heightIn(min = 56.dp)
                .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onToggle),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = checked, onCheckedChange = null, enabled = enabled)
            Spacer(Modifier.width(8.dp))
            Column {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (enabled) MaterialTheme.colorScheme.onSurface else muted,
                )
                if (value != null) {
                    Text(value, style = MaterialTheme.typography.bodySmall, color = muted)
                }
            }
        }
        if (!enabled) {
            TextButton(onClick = onAdd, modifier = Modifier.semantics { contentDescription = addLabel }) {
                Text(stringResource(R.string.chat_share_add))
            }
        }
    }
}
