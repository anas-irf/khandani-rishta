package com.khandanirishta.app.ui.feature.chat

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.KrTab
import com.khandanirishta.app.ui.components.KrTabs
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** What the chat list can do; built once per screen. */
@Immutable
internal class ChatsActions(
    val select: (ChatFilter) -> Unit,
    val refresh: () -> Unit,
    val loadMore: () -> Unit,
    val open: (id: String) -> Unit,
    val toggleMute: (Connection) -> Unit,
    val toggleArchive: (Connection) -> Unit,
    val openMatches: () -> Unit,
)

/**
 * APP-CHATS: the list of connections with the latest message of each (specs/16 section 6.10). A
 * three-way filter, rows with the arch, name, preview, time, unread badge and the markers in
 * words; a long press, or TalkBack's actions, mutes or archives at once (rule G7).
 */
@Composable
fun ChatsScreen(
    modifier: Modifier = Modifier,
    viewModel: ChatsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    LifecycleResumeEffect(viewModel) {
        viewModel.onResume()
        onPauseOrDispose { viewModel.onPause() }
    }
    val actions =
        remember(viewModel, navigator) {
            ChatsActions(
                select = viewModel::select,
                refresh = { viewModel.refresh() },
                loadMore = { viewModel.loadMore() },
                open = { id -> navigator.push(Chat(id)) },
                toggleMute = viewModel::toggleMute,
                toggleArchive = viewModel::toggleArchive,
                openMatches = { navigator.openOnTab(Tab.HOME, listOf(Matches)) },
            )
        }
    ChatsContent(state = state, actions = actions, modifier = modifier)
}

@Composable
internal fun ChatsContent(
    state: ChatsUiState,
    actions: ChatsActions,
    modifier: Modifier = Modifier,
) {
    // One scroll position per filter, so switching filters keeps each place.
    val activeList = rememberLazyListState()
    val archivedList = rememberLazyListState()
    val endedList = rememberLazyListState()
    val listState: LazyListState =
        when (state.filter) {
            ChatFilter.ACTIVE -> activeList
            ChatFilter.ARCHIVED -> archivedList
            ChatFilter.ENDED -> endedList
        }
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column {
                TabTopBar(title = stringResource(R.string.chat_chats_title))
                FilterBar(selected = state.filter, onSelect = actions.select)
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            PagedList(
                state = state.list,
                key = { it.id },
                onRefresh = actions.refresh,
                onLoadMore = actions.loadMore,
                listState = listState,
                contentPadding = ListPadding,
                contentType = { CONVERSATION },
                skeleton = { ChatsSkeleton() },
                empty = { ChatsEmpty(filter = state.filter, onMatches = actions.openMatches) },
            ) { connection ->
                ConversationRow(
                    connection = connection,
                    filter = state.filter,
                    online = state.online,
                    onOpen = { actions.open(connection.id) },
                    onToggleMute = { actions.toggleMute(connection) },
                    onToggleArchive = { actions.toggleArchive(connection) },
                )
            }
        }
    }
}

/** The three filters as [KrTabs], which become chips that wrap where a word would break. */
@Composable
private fun FilterBar(
    selected: ChatFilter,
    onSelect: (ChatFilter) -> Unit,
) {
    val filters = ChatFilter.entries
    val labels = filters.map { stringResource(it.label()) }
    val tabs = remember(labels) { labels.map { KrTab(it) } }
    val sides = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Box(Modifier.fillMaxWidth().windowInsetsPadding(sides)) {
            KrTabs(tabs = tabs, selected = selected.ordinal, onSelect = { onSelect(filters[it]) })
        }
    }
}

@StringRes
private fun ChatFilter.label(): Int =
    when (this) {
        ChatFilter.ACTIVE -> R.string.chat_chats_filter_active
        ChatFilter.ARCHIVED -> R.string.chat_chats_filter_archived
        ChatFilter.ENDED -> R.string.chat_chats_filter_ended
    }

@Composable
internal fun ChatsEmpty(
    filter: ChatFilter,
    onMatches: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (filter) {
        ChatFilter.ACTIVE -> {
            val action =
                rememberCandidate().pick(
                    R.string.chat_chats_empty_active_action,
                    R.string.chat_chats_empty_active_action_male,
                    R.string.chat_chats_empty_active_action_female,
                )
            EmptyState(
                title = stringResource(R.string.chat_chats_empty_active_title),
                text = stringResource(R.string.chat_chats_empty_active_text),
                icon = Icons.Outlined.ChatBubbleOutline,
                actionLabel = stringResource(action),
                onAction = onMatches,
                modifier = modifier,
            )
        }

        ChatFilter.ARCHIVED -> {
            EmptyState(
                title = stringResource(R.string.chat_chats_empty_archived_title),
                text = stringResource(R.string.chat_chats_empty_archived_text),
                icon = Icons.Outlined.Archive,
                modifier = modifier,
            )
        }

        ChatFilter.ENDED -> {
            EmptyState(
                title = stringResource(R.string.chat_chats_empty_ended_title),
                icon = Icons.Outlined.LinkOff,
                modifier = modifier,
            )
        }
    }
}

/** The shape of the conversation rows (rule G1). */
@Composable
private fun ChatsSkeleton(modifier: Modifier = Modifier) {
    LoadingRegion(modifier.fillMaxWidth(), spacing = 0.dp) {
        repeat(SKELETON_ROWS) {
            Row(Modifier.padding(vertical = Spacing.s12)) {
                SkeletonBox(Modifier.size(Sizes.arch46), shape = ArchShape)
                Column(
                    Modifier
                        .padding(start = Spacing.s12)
                        .weight(1f),
                ) {
                    SkeletonBox(Modifier.fillMaxWidth(SKELETON_NAME).height(Spacing.s24))
                    SkeletonBox(
                        Modifier
                            .padding(top = Spacing.s8)
                            .fillMaxWidth(SKELETON_PREVIEW)
                            .height(Spacing.s20),
                    )
                }
            }
            RowDivider()
        }
    }
}

private val ListPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s8, end = Spacing.gutter, bottom = Spacing.s24)
private const val CONVERSATION = "conversation"
private const val SKELETON_ROWS = 7
private const val SKELETON_NAME = 0.5f
private const val SKELETON_PREVIEW = 0.85f
