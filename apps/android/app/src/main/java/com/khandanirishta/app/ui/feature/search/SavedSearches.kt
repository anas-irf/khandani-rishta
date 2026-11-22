package com.khandanirishta.app.ui.feature.search

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.SavedSearch
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.FirstLineMark
import com.khandanirishta.app.ui.components.IconTextLine
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuDivider
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.components.SwitchRow
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import java.time.Instant

/**
 * The saved searches above the form, newest first (specs/16 section 6.6), in chips that wrap.
 * Tapping one loads its filters and runs the search; its menu (or a long press) renames it,
 * switches its notification and removes it.
 */
@Composable
internal fun SavedSearchList(
    items: List<SavedSearch>,
    onRun: (SavedSearch) -> Unit,
    onRename: (SavedSearch) -> Unit,
    onToggleNotify: (SavedSearch) -> Unit,
    onRemove: (SavedSearch) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        Text(
            text = stringResource(R.string.discovery_saved_label),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.semantics { heading() },
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            items.forEach { saved ->
                key(saved.id) {
                    SavedSearchChip(
                        saved = saved,
                        onRun = { onRun(saved) },
                        onRename = { onRename(saved) },
                        onToggleNotify = { onToggleNotify(saved) },
                        onRemove = { onRemove(saved) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SavedSearchChip(
    saved: SavedSearch,
    onRun: () -> Unit,
    onRename: () -> Unit,
    onToggleNotify: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    val online = LocalOnline.current
    val colors = MaterialTheme.colorScheme
    val shape = MaterialTheme.shapes.large
    val style = MaterialTheme.typography.labelMedium
    val menuLabel = text(R.string.discovery_saved_menu, "name" to saved.name)
    val runLabel = stringResource(R.string.discovery_search_actions_search)
    Surface(
        color = Color.Transparent,
        contentColor = if (online) colors.onSurface else colors.onSurfaceVariant,
        shape = shape,
        border = BorderStroke(Strokes.control, colors.outline),
        modifier = modifier,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s8), verticalAlignment = Alignment.CenterVertically) {
            IconTextLine(
                icon = Icons.Outlined.Bookmark,
                style = style,
                tint = colors.primary,
                iconSize = Sizes.iconMedium,
                modifier =
                    Modifier
                        .weight(1f, fill = false)
                        .clip(shape)
                        .combinedClickable(
                            interactionSource = null,
                            indication = ripple(focusRingShape = shape),
                            // Running it needs the network, and so does everything in its menu (rule G14).
                            enabled = online,
                            onClickLabel = runLabel,
                            role = Role.Button,
                            onLongClickLabel = menuLabel,
                            onLongClick = { menu = true },
                            onClick = onRun,
                        ).heightIn(min = Sizes.touch)
                        .padding(start = Spacing.s16, top = Spacing.s12, bottom = Spacing.s12),
            ) {
                MemberText(saved.name, style = style, modifier = Modifier.weight(1f, fill = false))
                if (saved.notifyNew) {
                    FirstLineMark(style) {
                        Icon(
                            Icons.Outlined.NotificationsActive,
                            contentDescription = stringResource(R.string.discovery_saved_notify),
                            tint = colors.onSurfaceVariant,
                            modifier = Modifier.size(Sizes.iconTiny),
                        )
                    }
                }
            }
            Box {
                KrIconButton(icon = Icons.Outlined.MoreVert, contentDescription = menuLabel, onClick = { menu = true })
                KrMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    KrMenuItem(
                        text = stringResource(R.string.discovery_saved_rename),
                        icon = Icons.Outlined.Edit,
                        enabled = online,
                        onClick = {
                            menu = false
                            onRename()
                        },
                    )
                    CheckboxRow(
                        checked = saved.notifyNew,
                        onCheckedChange = {
                            menu = false
                            onToggleNotify()
                        },
                        label = stringResource(R.string.discovery_saved_notify),
                        enabled = online,
                        modifier = Modifier.padding(horizontal = Spacing.s20),
                    )
                    KrMenuDivider()
                    KrMenuItem(
                        text = stringResource(R.string.discovery_saved_remove),
                        icon = Icons.Outlined.DeleteOutline,
                        enabled = online,
                        onClick = {
                            menu = false
                            onRemove()
                        },
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
    val today = remember { Formatters.date(Instant.now()) }
    val initial = text(R.string.discovery_saved_name_default, "date" to today)
    var name by rememberSaveable { mutableStateOf(initial) }
    var notify by rememberSaveable { mutableStateOf(false) }
    NameSheet(
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
        SwitchRow(
            title = stringResource(R.string.discovery_saved_notify_label),
            checked = notify,
            onCheckedChange = { notify = it },
            enabled = !dialog.busy,
        )
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
    NameSheet(
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

/** A sheet with the name, its "{count} of {max} characters" line, then Cancel and the confirming button. */
@Composable
private fun NameSheet(
    title: String,
    confirmLabel: String,
    name: String,
    onNameChange: (String) -> Unit,
    dialog: NameDialog,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit = {},
) {
    val error = dialog.error?.resolve(LocalResources.current)
    val online = LocalOnline.current
    KrSheet(
        title = title,
        onDismissRequest = onDismiss,
        dismissible = !dialog.busy,
        actions = {
            SheetAnswers(confirmLabel = confirmLabel, onConfirm = onConfirm, onCancel = onDismiss, busy = dialog.busy)
        },
    ) {
        KrTextField(
            value = name,
            onValueChange = onNameChange,
            label = stringResource(R.string.discovery_saved_name_label),
            error = error,
            maxLength = NAME_MAX,
            showCounter = true,
            counter = text(R.string.discovery_saved_name_count, "count" to name.length, "max" to NAME_MAX),
            enabled = !dialog.busy,
            keyboardOptions =
                KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (online && !dialog.busy) onConfirm() }),
        )
        content()
    }
}
