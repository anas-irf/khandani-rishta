package com.khandanirishta.app.ui.feature.search

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.SavedSearch
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.text
import java.time.Instant

/**
 * The saved searches above the form, newest first (specs/16 section 6.6). Tapping a chip loads
 * its filters and runs the search; its menu (or a long press) renames it, switches its
 * notification and removes it.
 */
@Composable
internal fun SavedSearchRow(
    items: List<SavedSearch>,
    online: Boolean,
    onRun: (SavedSearch) -> Unit,
    onRename: (SavedSearch) -> Unit,
    onToggleNotify: (SavedSearch) -> Unit,
    onRemove: (SavedSearch) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.discovery_saved_label),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier =
                Modifier
                    .padding(horizontal = 16.dp)
                    .semantics { heading() },
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(items, key = { it.id }) { saved ->
                SavedSearchChip(
                    saved = saved,
                    online = online,
                    onRun = { onRun(saved) },
                    onRename = { onRename(saved) },
                    onToggleNotify = { onToggleNotify(saved) },
                    onRemove = { onRemove(saved) },
                )
            }
        }
    }
}

@Composable
private fun SavedSearchChip(
    saved: SavedSearch,
    online: Boolean,
    onRun: () -> Unit,
    onRename: () -> Unit,
    onToggleNotify: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    val menuLabel = text(R.string.discovery_saved_menu, "name" to saved.name)
    val runLabel = stringResource(R.string.discovery_search_actions_search)
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .combinedClickable(
                        onClickLabel = runLabel,
                        role = Role.Button,
                        onLongClickLabel = menuLabel,
                        onLongClick = { menu = true },
                        onClick = onRun,
                    ).padding(start = 14.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.Bookmark,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    saved.name,
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 200.dp),
                )
                if (saved.notifyNew) {
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        Icons.Outlined.NotificationsActive,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            Box {
                IconButton(onClick = { menu = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = menuLabel, modifier = Modifier.size(20.dp))
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.discovery_saved_rename)) },
                        onClick = {
                            menu = false
                            onRename()
                        },
                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                        enabled = online,
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.discovery_saved_notify)) },
                        onClick = {
                            menu = false
                            onToggleNotify()
                        },
                        modifier = Modifier.semantics { selected = saved.notifyNew },
                        leadingIcon = {
                            Icon(
                                if (saved.notifyNew) {
                                    Icons.Outlined.NotificationsActive
                                } else {
                                    Icons.Outlined.NotificationsNone
                                },
                                contentDescription = null,
                            )
                        },
                        trailingIcon = { Checkbox(checked = saved.notifyNew, onCheckedChange = null) },
                        enabled = online,
                    )
                    HorizontalDivider()
                    DropdownMenuItem(
                        text = {
                            Text(
                                stringResource(R.string.discovery_saved_remove),
                                color = MaterialTheme.colorScheme.error,
                            )
                        },
                        onClick = {
                            menu = false
                            onRemove()
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Outlined.DeleteOutline,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error,
                            )
                        },
                        enabled = online,
                    )
                }
            }
        }
    }
}

/**
 * "Save this search" (16 section 6.6): a name of 1 to 60 characters prefilled "Search {date}", and
 * "Notify me about new members who match".
 */
@Composable
internal fun SaveSearchDialog(
    dialog: NameDialog,
    onSave: (String, Boolean) -> Unit,
    onEdit: () -> Unit,
    onDismiss: () -> Unit,
) {
    val initial = text(R.string.discovery_saved_name_default, "date" to Formatters.date(Instant.now()))
    var name by rememberSaveable { mutableStateOf(initial) }
    var notify by rememberSaveable { mutableStateOf(false) }
    NameDialogFrame(
        title = stringResource(R.string.discovery_saved_dialog_title),
        confirmLabel = stringResource(R.string.discovery_saved_save),
        name = name,
        onNameChange = { value ->
            name = value
            onEdit()
        },
        dialog = dialog,
        onConfirm = { onSave(name, notify) },
        onDismiss = onDismiss,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .toggleable(
                    value = notify,
                    enabled = !dialog.busy,
                    role = Role.Switch,
                    onValueChange = { notify = it },
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.discovery_saved_notify_label),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(12.dp))
            Switch(checked = notify, onCheckedChange = null, enabled = !dialog.busy)
        }
    }
}

/** "Rename saved search": `PATCH /v1/me/saved-searches/{id}` with `{ "name" }`. */
@Composable
internal fun RenameSearchDialog(
    dialog: NameDialog,
    onRename: (String) -> Unit,
    onEdit: () -> Unit,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable(dialog.target?.id) { mutableStateOf(dialog.target?.name.orEmpty()) }
    NameDialogFrame(
        title = stringResource(R.string.discovery_saved_rename_title),
        confirmLabel = stringResource(R.string.common_actions_save),
        name = name,
        onNameChange = { value ->
            name = value
            onEdit()
        },
        dialog = dialog,
        onConfirm = { onRename(name) },
        onDismiss = onDismiss,
    )
}

/** The name field with its "{count} of {max} characters" line, the confirm and cancel buttons. */
@Composable
private fun NameDialogFrame(
    title: String,
    confirmLabel: String,
    name: String,
    onNameChange: (String) -> Unit,
    dialog: NameDialog,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit = {},
) {
    val error = dialog.error?.resolve(LocalResources.current)
    AlertDialog(
        onDismissRequest = { if (!dialog.busy) onDismiss() },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { onNameChange(it.take(NAME_MAX)) },
                    label = { Text(stringResource(R.string.discovery_saved_name_label)) },
                    supportingText = {
                        val count = text(R.string.discovery_saved_name_count, "count" to name.length, "max" to NAME_MAX)
                        Text(error ?: count)
                    },
                    isError = error != null,
                    enabled = !dialog.busy,
                    singleLine = true,
                    keyboardOptions =
                        KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { onConfirm() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                content()
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !dialog.busy) {
                if (dialog.busy) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text(confirmLabel)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !dialog.busy) {
                Text(stringResource(R.string.common_actions_cancel))
            }
        },
    )
}
