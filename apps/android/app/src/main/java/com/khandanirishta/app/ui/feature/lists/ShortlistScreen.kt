package com.khandanirishta.app.ui.feature.lists

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.ShortlistItem
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.UnavailableRow
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.text

/**
 * APP-SHORTLIST: the member's private list of saved profiles, with notes (specs/16 section 6.13,
 * 11 section 12).
 */
@Composable
fun ShortlistScreen(
    modifier: Modifier = Modifier,
    viewModel: ShortlistViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    LifecycleResumeEffect(Unit) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    Scaffold(
        modifier = modifier,
        topBar = {
            DetailTopBar(title = stringResource(R.string.discovery_shortlist_title), onBack = { navigator.back() })
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            StatusGate(GateRouter.Level.BROWSE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                val list by viewModel.list.collectAsStateWithLifecycle()
                ShortlistContent(
                    state = state,
                    list = list,
                    onRefresh = viewModel::refresh,
                    onLoadMore = viewModel::loadMore,
                    onEditNote = viewModel::editNote,
                    onRemove = viewModel::remove,
                    onSaveNote = viewModel::saveNote,
                    onDismissNote = viewModel::dismissNote,
                )
            }
        }
    }
}

@Composable
private fun ShortlistContent(
    state: ShortlistUiState,
    list: PagedState<ShortlistItem>,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onEditNote: (entry: ShortlistItem, name: String) -> Unit,
    onRemove: (ShortlistItem) -> Unit,
    onSaveNote: (String) -> Unit,
    onDismissNote: () -> Unit,
) {
    val navigator = LocalNavigator.current

    Column(Modifier.fillMaxSize()) {
        // "Only you can see this list." under the title.
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                stringResource(R.string.discovery_shortlist_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        PagedList(
            state = list,
            key = { it.profileId },
            onRefresh = onRefresh,
            onLoadMore = onLoadMore,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
            empty = {
                EmptyState(
                    title = stringResource(R.string.discovery_shortlist_empty_title),
                    text = stringResource(R.string.discovery_shortlist_empty_text),
                    icon = Icons.Outlined.FavoriteBorder,
                    actionLabel = stringResource(R.string.discovery_shortlist_see_matches),
                    onAction = { navigator.openOnTab(Tab.HOME, listOf(Matches)) },
                )
            },
        ) { entry ->
            ShortlistRow(
                entry = entry,
                online = state.online,
                onOpen = { profileId -> navigator.push(Profile(profileId)) },
                onEditNote = { name -> onEditNote(entry, name) },
                onRemove = { onRemove(entry) },
            )
        }
        state.editor?.let { editor ->
            NoteDialog(
                editor = editor,
                saving = state.savingNote,
                online = state.online,
                onSave = onSaveNote,
                onDismiss = onDismissNote,
            )
        }
    }
}

/** One saved profile: the compact card, the note in italics, "Saved {relative}", and its controls. */
@Composable
private fun ShortlistRow(
    entry: ShortlistItem,
    online: Boolean,
    onOpen: (String) -> Unit,
    onEditNote: (name: String) -> Unit,
    onRemove: () -> Unit,
) {
    val profile = entry.profile
    if (profile == null) {
        UnavailableEntry(online = online, onRemove = onRemove)
    } else {
        SavedProfile(
            entry = entry,
            profile = profile,
            online = online,
            onOpen = onOpen,
            onEditNote = onEditNote,
            onRemove = onRemove,
        )
    }
}

/** "No longer available" with "Remove", which needs only the profile id (16 section 6.13). */
@Composable
private fun UnavailableEntry(
    online: Boolean,
    onRemove: () -> Unit,
) {
    val removeLabel = stringResource(R.string.discovery_shortlist_remove_unavailable)
    UnavailableRow(
        text = stringResource(R.string.discovery_shortlist_unavailable),
        action = {
            TextButton(
                onClick = onRemove,
                enabled = online,
                modifier =
                    Modifier
                        .heightIn(min = 48.dp)
                        .semantics { contentDescription = removeLabel },
            ) {
                Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.discovery_shortlist_remove))
            }
        },
    )
}

@Composable
private fun SavedProfile(
    entry: ShortlistItem,
    profile: ProfileCard,
    online: Boolean,
    onOpen: (String) -> Unit,
    onEditNote: (name: String) -> Unit,
    onRemove: () -> Unit,
) {
    val res = LocalResources.current
    val removeLabel = text(R.string.shared_card_shortlist_remove, "name" to profile.displayName)
    val saved = text(R.string.discovery_shortlist_saved_at, "time" to Formatters.relative(res, entry.createdAt))
    ProfileRow(
        card = profile,
        onOpen = { onOpen(profile.id) },
        extra = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val note = entry.note
                if (!note.isNullOrBlank()) {
                    Text(note, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic)
                }
                MetaLine(saved)
            }
        },
        actions = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(
                    onClick = { onEditNote(profile.displayName) },
                    enabled = online,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Outlined.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.discovery_shortlist_edit_note))
                }
                TextButton(
                    onClick = onRemove,
                    enabled = online,
                    modifier =
                        Modifier
                            .heightIn(min = 48.dp)
                            .semantics { contentDescription = removeLabel },
                ) {
                    Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.discovery_shortlist_remove))
                }
            }
        },
    )
}

/** "Edit note": a text of at most 300 characters that only the member sees (16 section 6.13). */
@Composable
private fun NoteDialog(
    editor: NoteEditor,
    saving: Boolean,
    online: Boolean,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var value by rememberSaveable(editor.profileId) { mutableStateOf(editor.note.orEmpty()) }
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(text(R.string.discovery_shortlist_note_title, "name" to editor.name)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    stringResource(R.string.discovery_shortlist_note_help),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it.take(ShortlistViewModel.NOTE_MAX) },
                    label = { Text(stringResource(R.string.discovery_shortlist_note_label)) },
                    supportingText = {
                        Text(
                            text(
                                R.string.discovery_shortlist_note_count,
                                "count" to value.length,
                                "max" to ShortlistViewModel.NOTE_MAX,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.End,
                        )
                    },
                    enabled = !saving,
                    minLines = 3,
                    maxLines = 6,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(value) }, enabled = online && !saving) {
                if (saving) ButtonSpinner() else Text(stringResource(R.string.common_actions_save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !saving) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    )
}
