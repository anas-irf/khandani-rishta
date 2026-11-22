package com.khandanirishta.app.ui.feature.lists

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.ShortlistItem
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.NoteDialog
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.UnavailableRow
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** What the parts of APP-SHORTLIST can do. */
@Immutable
internal class ShortlistActions(
    val refresh: () -> Unit,
    val loadMore: () -> Unit,
    val open: (profileId: String) -> Unit,
    val editNote: (entry: ShortlistItem, name: String) -> Unit,
    val remove: (ShortlistItem) -> Unit,
    val saveNote: (String) -> Unit,
    val dismissNote: () -> Unit,
    val seeMatches: () -> Unit,
)

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
    val actions =
        remember(viewModel, navigator) {
            ShortlistActions(
                refresh = viewModel::refresh,
                loadMore = viewModel::loadMore,
                open = { navigator.push(Profile(it)) },
                editNote = viewModel::editNote,
                remove = viewModel::remove,
                saveNote = viewModel::saveNote,
                dismissNote = viewModel::dismissNote,
                seeMatches = { navigator.openOnTab(Tab.HOME, listOf(Matches)) },
            )
        }
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
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            StatusGate(GateRouter.Level.BROWSE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                val list by viewModel.list.collectAsStateWithLifecycle()
                ShortlistContent(state = state, list = list, actions = actions)
            }
        }
    }
}

/** "Only you can see this list.", then a compact card per saved profile. */
@Composable
internal fun ShortlistContent(
    state: ShortlistUiState,
    list: PagedState<ShortlistItem>,
    actions: ShortlistActions,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize()) {
        PagedList(
            state = list,
            key = { it.profileId },
            onRefresh = actions.refresh,
            onLoadMore = actions.loadMore,
            header = {
                item(key = INTRO_KEY, contentType = INTRO_KEY) {
                    IconText(
                        icon = Icons.Outlined.Lock,
                        text = stringResource(R.string.discovery_shortlist_intro),
                        style = KrType.caption,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        iconSize = Sizes.iconTiny,
                        modifier = Modifier.padding(bottom = Spacing.s8),
                    )
                }
            },
            empty = { ShortlistEmpty(onSeeMatches = actions.seeMatches) },
        ) { entry ->
            val profile = entry.profile
            if (profile == null) {
                UnavailableEntry(onRemove = { actions.remove(entry) })
            } else {
                SavedProfile(entry = entry, profile = profile, actions = actions)
            }
        }
        state.editor?.let { editor ->
            key(editor.profileId) {
                NoteDialog(
                    name = editor.name,
                    onSave = actions.saveNote,
                    onDismiss = actions.dismissNote,
                    initial = editor.note.orEmpty(),
                    busy = state.savingNote,
                )
            }
        }
    }
}

@Composable
private fun ShortlistEmpty(onSeeMatches: () -> Unit) {
    val action =
        rememberCandidate().pick(
            R.string.discovery_shortlist_see_matches,
            R.string.discovery_shortlist_see_matches_male,
            R.string.discovery_shortlist_see_matches_female,
        )
    EmptyState(
        title = stringResource(R.string.discovery_shortlist_empty_title),
        text = stringResource(R.string.discovery_shortlist_empty_text),
        icon = Icons.Outlined.FavoriteBorder,
        actionLabel = stringResource(action),
        onAction = onSeeMatches,
    )
}

/** "No longer available" with "Remove", which needs only the profile id (16 section 6.13). */
@Composable
private fun UnavailableEntry(onRemove: () -> Unit) {
    UnavailableRow(text = stringResource(R.string.discovery_shortlist_unavailable)) {
        KrButton(
            text = stringResource(R.string.discovery_shortlist_remove),
            onClick = onRemove,
            variant = KrButtonVariant.QUIET,
            size = KrButtonSize.COMPACT,
            icon = Icons.Outlined.DeleteOutline,
            enabled = LocalOnline.current,
            contentDescription = stringResource(R.string.discovery_shortlist_remove_unavailable),
        )
    }
}

/** One saved profile: the compact card, the note in italics, "Saved {relative}", and its controls. */
@Composable
private fun SavedProfile(
    entry: ShortlistItem,
    profile: ProfileCard,
    actions: ShortlistActions,
) {
    val online = LocalOnline.current
    val editLabel = stringResource(R.string.discovery_shortlist_edit_note)
    val removeLabel = text(R.string.shared_card_shortlist_remove, "name" to profile.displayName)
    val saved = text(R.string.discovery_shortlist_saved_at, "time" to rememberRelativeTime(entry.createdAt))
    ProfileRow(
        card = profile,
        onOpen = { actions.open(profile.id) },
        details = {
            Column(
                modifier =
                    Modifier.rowActions(
                        enabled = online,
                        editLabel to { actions.editNote(entry, profile.displayName) },
                        removeLabel to { actions.remove(entry) },
                    ),
                verticalArrangement = Arrangement.spacedBy(Spacing.s4),
            ) {
                val note = entry.note
                if (!note.isNullOrBlank()) {
                    MemberText(note, style = MaterialTheme.typography.bodyMedium.copy(fontStyle = FontStyle.Italic))
                }
                CaptionText(saved)
            }
        },
        actions = {
            AdaptiveRow(Modifier.fillMaxWidth()) {
                KrButton(
                    text = editLabel,
                    onClick = { actions.editNote(entry, profile.displayName) },
                    variant = KrButtonVariant.SECONDARY,
                    size = KrButtonSize.COMPACT,
                    icon = Icons.Outlined.Edit,
                    enabled = online,
                    modifier = Modifier.grow(),
                )
                KrButton(
                    text = stringResource(R.string.discovery_shortlist_remove),
                    onClick = { actions.remove(entry) },
                    variant = KrButtonVariant.QUIET,
                    size = KrButtonSize.COMPACT,
                    icon = Icons.Outlined.DeleteOutline,
                    enabled = online,
                    contentDescription = removeLabel,
                    modifier = Modifier.grow(),
                )
            }
        },
    )
}

private const val INTRO_KEY = "shortlist:intro"
