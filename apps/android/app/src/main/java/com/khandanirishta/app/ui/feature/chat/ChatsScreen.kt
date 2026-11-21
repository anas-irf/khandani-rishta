package com.khandanirishta.app.ui.feature.chat

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.Party
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.Avatar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text

/**
 * APP-CHATS: the list of connections with the latest message of each (specs/16 section 6.10). A
 * three-way filter, rows with photo, name, preview, time, unread badge, stage and proposal markers,
 * the quiet hint and the muted icon; a long-press menu mutes or archives at once (rule G7).
 */
@OptIn(ExperimentalMaterial3Api::class)
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
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    // One scroll position per filter, so switching filters keeps each place.
    val activeList = rememberLazyListState()
    val archivedList = rememberLazyListState()
    val endedList = rememberLazyListState()
    val listState =
        when (state.filter) {
            ChatFilter.ACTIVE -> activeList
            ChatFilter.ARCHIVED -> archivedList
            ChatFilter.ENDED -> endedList
        }

    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = { TabTopBar(title = stringResource(R.string.chat_chats_title), scrollBehavior = scrollBehavior) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            FilterRow(selected = state.filter, onSelect = viewModel::select)
            PagedList(
                state = state.list,
                key = { it.id },
                onRefresh = viewModel::refresh,
                onLoadMore = viewModel::loadMore,
                modifier = Modifier.weight(1f),
                listState = listState,
                contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp),
                spacing = Arrangement.spacedBy(0.dp),
                skeleton = { ChatsSkeleton() },
                empty = {
                    ChatsEmpty(
                        filter = state.filter,
                        onMatches = { navigator.openOnTab(Tab.HOME, listOf(Matches)) },
                    )
                },
            ) { connection ->
                ChatRow(
                    connection = connection,
                    filter = state.filter,
                    online = state.online,
                    onOpen = { navigator.push(Chat(connection.id)) },
                    onToggleMute = { viewModel.toggleMute(connection) },
                    onToggleArchive = { viewModel.toggleArchive(connection) },
                )
            }
        }
    }
}

@Composable
private fun FilterRow(
    selected: ChatFilter,
    onSelect: (ChatFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .selectableGroup()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ChatFilter.entries.forEach { filter ->
            val isSelected = filter == selected
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(filter) },
                label = { Text(stringResource(filter.label())) },
                leadingIcon =
                    if (isSelected) {
                        { Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(18.dp)) }
                    } else {
                        null
                    },
                colors =
                    FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        selectedLeadingIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    ),
            )
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

/** One conversation: the rules of the item table of 16 section 6.10. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChatRow(
    connection: Connection,
    filter: ChatFilter,
    online: Boolean,
    onOpen: () -> Unit,
    onToggleMute: () -> Unit,
    onToggleArchive: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val me = LocalMe.current
    val res = LocalResources.current
    val other = connection.other
    val name = otherName(connection)
    val unread = connection.unreadCount > 0
    val active = connection.status == ConnectionStatus.ACTIVE
    val time = connection.lastMessageAt ?: connection.createdAt
    val preview =
        connection.lastMessagePreview ?: stringResource(
            if (hasNoTextMessages(connection)) R.string.chat_chats_preview_new else R.string.chat_chats_preview_update,
        )
    val photoLabel =
        when {
            other == null -> null
            other.photo?.isBlurred == true -> stringResource(R.string.a11y_private_photo)
            else -> text(R.string.shared_photo_alt, "name" to name)
        }
    val menuLabel = text(R.string.chat_chats_menu, "name" to name)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val timeColor = if (unread) MaterialTheme.colorScheme.primary else muted
    val previewColor = if (unread) MaterialTheme.colorScheme.onSurface else muted
    val stageShown = connection.stage != ConnectionStage.CHATTING && connection.stage != ConnectionStage.UNKNOWN
    val waiting = active && connection.pendingStageProposal?.proposedBy == Party.THEM
    val ended = filter == ChatFilter.ENDED || connection.status == ConnectionStatus.ENDED
    val muteLabel = if (connection.isMuted) R.string.chat_chats_unmute else R.string.chat_chats_mute
    val archiveLabel = if (connection.isArchived) R.string.chat_chats_unarchive else R.string.chat_chats_archive
    var menuOpen by remember { mutableStateOf(false) }

    Column(modifier.fillMaxWidth()) {
        Box {
            Row(
                Modifier
                    .fillMaxWidth()
                    .combinedClickable(
                        onLongClickLabel = if (active) menuLabel else null,
                        onLongClick = if (active && online) ({ menuOpen = true }) else null,
                        onClick = onOpen,
                    ).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Avatar(
                    photo = other?.photo,
                    gender = other?.gender ?: otherGender(me?.profile?.gender),
                    contentDescription = photoLabel,
                    size = 56.dp,
                )
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                name,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            if (connection.isMuted) {
                                Spacer(Modifier.width(6.dp))
                                Icon(
                                    Icons.Outlined.NotificationsOff,
                                    contentDescription = stringResource(R.string.chat_chats_muted),
                                    tint = muted,
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            Formatters.relative(res, time),
                            style = MaterialTheme.typography.labelMedium,
                            color = timeColor,
                            fontWeight = if (unread) FontWeight.SemiBold else null,
                            maxLines = 1,
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            preview,
                            style = MaterialTheme.typography.bodyMedium,
                            color = previewColor,
                            fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (unread) {
                            Spacer(Modifier.width(8.dp))
                            UnreadBadge(connection.unreadCount)
                        }
                    }
                    if (stageShown || waiting || ended) {
                        FlowRow(
                            Modifier.padding(top = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            if (stageShown) {
                                RowChip(
                                    text = stringResource(stageLabel(connection.stage)),
                                    container = MaterialTheme.colorScheme.secondaryContainer,
                                    content = MaterialTheme.colorScheme.onSecondaryContainer,
                                )
                            }
                            if (waiting) {
                                RowChip(
                                    text = stringResource(R.string.chat_chats_waiting_for_you),
                                    container = MaterialTheme.colorScheme.tertiaryContainer,
                                    content = MaterialTheme.colorScheme.onTertiaryContainer,
                                )
                            }
                            if (ended) {
                                RowChip(
                                    text = stringResource(R.string.chat_chats_ended),
                                    container = MaterialTheme.colorScheme.surfaceContainerHigh,
                                    content = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    if (isQuiet(connection)) {
                        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.Top) {
                            Icon(
                                Icons.Outlined.Schedule,
                                contentDescription = null,
                                tint = muted,
                                modifier =
                                    Modifier
                                        .padding(top = 2.dp)
                                        .size(14.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                stringResource(R.string.chat_chats_quiet),
                                style = MaterialTheme.typography.bodySmall,
                                color = muted,
                            )
                        }
                    }
                }
            }
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
                offset = DpOffset(x = 72.dp, y = 0.dp),
            ) {
                DropdownMenuItem(
                    text = { Text(stringResource(muteLabel)) },
                    leadingIcon = {
                        Icon(
                            if (connection.isMuted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff,
                            contentDescription = null,
                        )
                    },
                    onClick = {
                        menuOpen = false
                        onToggleMute()
                    },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(archiveLabel)) },
                    leadingIcon = {
                        Icon(
                            if (connection.isArchived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                            contentDescription = null,
                        )
                    },
                    onClick = {
                        menuOpen = false
                        onToggleArchive()
                    },
                )
            }
        }
        HorizontalDivider(
            Modifier.padding(start = 86.dp),
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.7f),
        )
    }
}

/** The teal unread badge: "99+" above 99 (16 section 2.4), read out as "{count} unread messages". */
@Composable
private fun UnreadBadge(
    count: Int,
    modifier: Modifier = Modifier,
) {
    val description = plural(R.plurals.chat_chats_unread, count)
    Box(
        modifier
            .defaultMinSize(minWidth = 22.dp, minHeight = 22.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp)
            .clearAndSetSemantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            Formatters.badgeCount(count.toLong()),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimary,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun RowChip(
    text: String,
    container: Color,
    content: Color,
    modifier: Modifier = Modifier,
) {
    Surface(color = container, contentColor = content, shape = CircleShape, modifier = modifier) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun ChatsEmpty(
    filter: ChatFilter,
    onMatches: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (filter) {
        ChatFilter.ACTIVE -> {
            EmptyState(
                title = stringResource(R.string.chat_chats_empty_active_title),
                text = stringResource(R.string.chat_chats_empty_active_text),
                icon = Icons.Outlined.ChatBubbleOutline,
                actionLabel = stringResource(R.string.chat_chats_empty_active_action),
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

/** Skeleton rows that match the conversation rows (rule G1). */
@Composable
private fun ChatsSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        repeat(SKELETON_ROWS) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SkeletonBox(Modifier.size(56.dp), corner = 28.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SkeletonBox(
                            Modifier
                                .fillMaxWidth(0.45f)
                                .height(16.dp),
                        )
                        Spacer(Modifier.weight(1f))
                        SkeletonBox(
                            Modifier
                                .width(44.dp)
                                .height(12.dp),
                        )
                    }
                    SkeletonBox(
                        Modifier
                            .fillMaxWidth(0.8f)
                            .height(12.dp),
                    )
                }
            }
        }
    }
}

private const val SKELETON_ROWS = 7
