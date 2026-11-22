package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.MessageSender
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.Spacing
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import java.time.ZoneId

/**
 * The conversation (16 section 6.11 block 4): newest at the bottom with `reverseLayout`, so the
 * latest messages stay in view when the keyboard opens. Opens at the unread divider or at the
 * bottom, stays at the bottom for new messages (otherwise "New messages"), loads older messages
 * near the top while keeping the visible message in place, and reports the newest message from
 * them that is on screen, for the read state.
 */
@Composable
internal fun MessageList(
    content: ChatContent,
    connection: Connection,
    ownProfileId: String,
    showStarters: Boolean,
    canRemove: Boolean,
    listState: LazyListState,
    actions: MessageActions,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val name = otherName(connection)
    val zone = remember { ZoneId.systemDefault() }
    val rows =
        remember(content.items, content.dividerBeforeId, ownProfileId, name, res) {
            buildRows(content.items, content.dividerBeforeId, zone, ownProfileId) { message ->
                systemText(res, message, ownProfileId, name)
            }
        }
    // Newest first, for the reversed list.
    val display = remember(rows) { rows.asReversed() }
    val rowsByKey = remember(rows) { rows.associateBy { it.key } }
    val starterOffset = if (showStarters) 1 else 0
    val bottomSlack = with(density) { BottomSlack.roundToPx() }
    // The divider is one line of text, so its room grows with the text.
    val dividerSpace = with(density) { (DividerSpace * fontScale.coerceAtLeast(1f)).roundToPx() }

    // Opening: at the unread divider when the unread messages do not fit, otherwise at the bottom.
    var positioned by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(display.isNotEmpty()) {
        if (positioned || display.isEmpty()) return@LaunchedEffect
        positioned = true
        val dividerIndex = display.indexOfFirst { it is UnreadRow }
        if (dividerIndex < 0) return@LaunchedEffect
        listState.scrollToItem(0)
        val info = listState.layoutInfo
        if (info.visibleItemsInfo.any { it.key == UnreadRow.key }) return@LaunchedEffect
        val viewport = info.viewportEndOffset - info.viewportStartOffset
        listState.scrollToItem(dividerIndex + starterOffset, -(viewport - dividerSpace).coerceAtLeast(0))
    }

    // A new message: stay at the bottom when there (or when it is the member's own), else offer the pill.
    val newest = content.items.lastOrNull()
    val tracker = remember { NewestTracker(newest?.key) }
    var showPill by remember { mutableStateOf(false) }
    SideEffect {
        val previous = tracker.key
        val current = newest?.key
        if (previous == current) return@SideEffect
        tracker.key = current
        if (previous == null || newest == null) return@SideEffect
        val atBottom = listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset <= bottomSlack
        if (newest.message.sender == MessageSender.ME || atBottom) {
            listState.requestScrollToItem(0)
            showPill = false
        } else if (newest.message.sender == MessageSender.THEM) {
            showPill = true
        }
    }
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset <= bottomSlack }
            .distinctUntilChanged()
            .collect { atBottom -> if (atBottom) showPill = false }
    }

    // Older pages when the top comes near; the reversed list keeps the visible message in place.
    val canLoadOlder by rememberUpdatedState(content.hasOlder && !content.loadingOlder && !content.olderFailed)
    val loadOlder by rememberUpdatedState(actions.loadOlder)
    LaunchedEffect(listState) {
        snapshotFlow {
            val info = listState.layoutInfo
            val top = info.visibleItemsInfo.lastOrNull()?.index ?: -1
            canLoadOlder && info.totalItemsCount > 0 && top >= info.totalItemsCount - LOAD_OLDER_AHEAD
        }.distinctUntilChanged()
            .filter { it }
            .collect { loadOlder() }
    }

    // The read state: the newest message from them that is on screen (11 section 6.5).
    val currentRows by rememberUpdatedState(rowsByKey)
    val onVisible by rememberUpdatedState(actions.theirsVisible)
    LaunchedEffect(listState) {
        snapshotFlow {
            listState.layoutInfo.visibleItemsInfo
                .mapNotNull { info -> (info.key as? String)?.let { currentRows[it] } as? BubbleRow }
                .map { it.item }
                .filter { it.local == null && it.message.sender == MessageSender.THEM }
                .maxOfOrNull { it.message.id }
        }.distinctUntilChanged()
            .collect { id -> if (id != null) onVisible(id) }
    }

    // Only what a bubble needs from the connection, so a change to it does not redraw every bubble.
    val reportable = connection.other != null
    val readUpTo = connection.theirLastReadMessageId

    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier =
                Modifier
                    .fillMaxSize()
                    .contentWidth(),
            contentPadding = ListPadding,
        ) {
            if (showStarters) {
                item(key = STARTERS_KEY, contentType = STARTERS_KEY) {
                    Starters(
                        onStarter = actions.starter,
                        modifier = Modifier.animateItem(Motion.fast(), Motion.base(), Motion.fast()),
                    )
                }
            }
            items(display, key = { it.key }, contentType = { contentTypeOf(it) }) { row ->
                // Items fade and settle by the app's motion (DESIGN.md section 5.4).
                val itemModifier = Modifier.animateItem(Motion.fast(), Motion.base(), Motion.fast())
                when (row) {
                    is DayRow -> {
                        DaySeparator(row.instant, modifier = itemModifier)
                    }

                    UnreadRow -> {
                        UnreadDivider(modifier = itemModifier)
                    }

                    is SystemRow -> {
                        SystemLine(row, onOpenDetails = actions.openDetails, modifier = itemModifier)
                    }

                    is BubbleRow -> {
                        MessageBubble(
                            row = row,
                            name = name,
                            // "Read" only when receipts are on for both, and they read up to this message.
                            read = row.showStatus && readUpTo != null && readUpTo >= row.item.message.id,
                            reportable = reportable,
                            removable = canRemove,
                            actions = actions,
                            modifier = itemModifier,
                        )
                    }
                }
            }
            if (content.hasOlder || content.olderFailed) {
                item(key = OLDER_KEY, contentType = OLDER_KEY) {
                    OlderMessages(
                        loading = content.loadingOlder,
                        failed = content.olderFailed,
                        onLoad = actions.loadOlder,
                    )
                }
            }
            if (content.showTips) {
                item(key = TIPS_KEY, contentType = TIPS_KEY) {
                    FirstChatTips(
                        onDismiss = actions.dismissTips,
                        modifier = Modifier.animateItem(Motion.fast(), Motion.base(), Motion.fast()),
                    )
                }
            }
        }
        NewMessagesPill(
            visible = showPill,
            onClick = {
                showPill = false
                scope.launch { listState.animateScrollToItem(0) }
            },
            modifier =
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
        )
    }
}

/** The newest message key seen, outside of the snapshot state so it causes no recomposition. */
private class NewestTracker(
    var key: String?,
)

private fun contentTypeOf(row: ChatRow): Int =
    when (row) {
        is DayRow -> 0
        UnreadRow -> 1
        is SystemRow -> 2
        is BubbleRow -> 3
    }

private const val STARTERS_KEY = "starters"
private const val OLDER_KEY = "older"
private const val TIPS_KEY = "tips"
private const val LOAD_OLDER_AHEAD = 4
private val BottomSlack = 48.dp
private val DividerSpace = 56.dp
private val ListPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s8, end = Spacing.gutter, bottom = Spacing.s12)
