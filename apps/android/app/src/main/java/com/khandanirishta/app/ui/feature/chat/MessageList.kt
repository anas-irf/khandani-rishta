package com.khandanirishta.app.ui.feature.chat

import android.content.ClipData
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Done
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.WavingHand
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.MessageKind
import com.khandanirishta.app.core.network.generated.model.MessageSender
import com.khandanirishta.app.core.network.generated.model.SafetyFlag
import com.khandanirishta.app.core.network.generated.model.SystemEvent
import com.khandanirishta.app.core.util.Formatters
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One line of the conversation: a day separator, the unread divider, a system line or a bubble. */
internal sealed interface ChatRow {
    val key: String
}

internal data class DayRow(
    override val key: String,
    val instant: Instant,
) : ChatRow

internal data object UnreadRow : ChatRow {
    override val key: String = "unread"
}

internal data class SystemRow(
    override val key: String,
    val text: String,
    /** "{name} shared contact details with you." opens the connection details (16 section 6.11). */
    val linksToDetails: Boolean,
) : ChatRow

internal data class BubbleRow(
    override val key: String,
    val item: ChatItem,
    /** The safety notice under this message, shown once per flag, per conversation, per day (13 section 5.3). */
    val notice: SafetyFlag?,
    /** The delivery state under the newest own message. */
    val showStatus: Boolean,
    /** Grouped with the message before or after: same sender within a few minutes. */
    val joinsPrevious: Boolean,
    val joinsNext: Boolean,
) : ChatRow

/** What the member can do with the messages; built once per screen. */
@Stable
internal class MessageActions(
    val retry: (ChatItem) -> Unit,
    val discard: (ChatItem) -> Unit,
    val remove: (ChatItem) -> Unit,
    val report: (ChatItem, String?) -> Unit,
    val copied: () -> Unit,
    val openDetails: () -> Unit,
    val loadOlder: () -> Unit,
    val dismissTips: () -> Unit,
    val starter: (String) -> Unit,
    val theirsVisible: (String) -> Unit,
)

/**
 * Display rows, oldest first: day separators, the unread divider, system lines and bubbles. A safety
 * notice shows at most once per flag, per conversation, per day; the delivery state shows under the
 * newest own message (16 section 6.11).
 */
internal fun buildRows(
    items: List<ChatItem>,
    dividerBeforeId: String?,
    zone: ZoneId,
    ownProfileId: String,
    lineOf: (Message) -> String?,
): List<ChatRow> {
    val rows = ArrayList<ChatRow>(items.size + 8)
    val notices = HashSet<String>()
    val newestOwn = items.lastOrNull { it.message.sender == MessageSender.ME && !it.message.isDeleted }?.key
    var lastDay: LocalDate? = null
    for (item in items) {
        val message = item.message
        val day = message.createdAt.atZone(zone).toLocalDate()
        if (day != lastDay) {
            rows += DayRow("day:$day", message.createdAt)
            lastDay = day
        }
        if (dividerBeforeId != null && message.id == dividerBeforeId) rows += UnreadRow
        when (message.kind) {
            MessageKind.SYSTEM -> {
                val text = lineOf(message) ?: continue
                val linked = message.systemEvent == SystemEvent.CONTACT_SHARED && !message.actorIs(ownProfileId)
                rows += SystemRow(item.key, text, linked)
            }

            MessageKind.TEXT -> {
                val flag = message.safetyNotice?.takeIf { it != SafetyFlag.UNKNOWN }
                val notice =
                    if (flag != null && message.sender == MessageSender.THEM && !message.isDeleted) {
                        flag.takeIf { notices.add("${it.wire}|$day") }
                    } else {
                        null
                    }
                val previous = rows.lastOrNull() as? BubbleRow
                val joins =
                    previous != null &&
                        previous.notice == null &&
                        previous.item.message.sender == message.sender &&
                        Duration.between(previous.item.message.createdAt, message.createdAt) < GROUP_WINDOW
                if (previous != null && joins) rows[rows.lastIndex] = previous.copy(joinsNext = true)
                rows +=
                    BubbleRow(
                        key = item.key,
                        item = item,
                        notice = notice,
                        showStatus = item.key == newestOwn && item.local == null,
                        joinsPrevious = joins,
                        joinsNext = false,
                    )
            }

            MessageKind.UNKNOWN -> {}
        }
    }
    return rows
}

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
    val bottomSlack = with(density) { BOTTOM_SLACK.roundToPx() }
    val dividerSpace = with(density) { DIVIDER_SPACE.roundToPx() }

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

    Box(modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
        ) {
            if (showStarters) {
                item(key = STARTERS_KEY, contentType = STARTERS_KEY) {
                    Starters(onStarter = actions.starter, modifier = Modifier.animateItem())
                }
            }
            items(display, key = { it.key }, contentType = { contentTypeOf(it) }) { row ->
                val itemModifier = Modifier.animateItem()
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
                            connection = connection,
                            canRemove = canRemove,
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
                    FirstChatTips(onDismiss = actions.dismissTips, modifier = Modifier.animateItem())
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
                    .padding(bottom = 12.dp),
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

/** A message bubble with its time, delivery state, safety notice and long-press menu. */
@Composable
private fun MessageBubble(
    row: BubbleRow,
    connection: Connection,
    canRemove: Boolean,
    actions: MessageActions,
    modifier: Modifier = Modifier,
) {
    val item = row.item
    val message = item.message
    val mine = message.sender == MessageSender.ME
    val failed = item.local?.failed == true
    val sending = item.local != null && !failed
    val deleted = message.isDeleted
    val body = message.body.orEmpty()
    val canCopy = !deleted && body.isNotEmpty()
    val canReport = !mine && connection.other != null && !deleted
    val mayRemove = mine && canRemove && item.local == null && !deleted
    val hasMenu = canCopy || canReport || mayRemove || failed
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val clipLabel = stringResource(R.string.chat_composer_label)
    var menuOpen by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme
    val container =
        when {
            deleted -> colors.surfaceContainerHigh
            mine -> colors.primary
            else -> colors.surfaceContainerLowest
        }
    val contentColor =
        when {
            deleted -> colors.onSurfaceVariant
            mine -> colors.onPrimary
            else -> colors.onSurface
        }

    Column(
        modifier
            .fillMaxWidth()
            .padding(top = if (row.joinsPrevious) 2.dp else 8.dp),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
    ) {
        Column(
            Modifier.fillMaxWidth(BUBBLE_WIDTH),
            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
        ) {
            Box {
                Surface(
                    shape = bubbleShape(mine, row.joinsPrevious),
                    color = container,
                    contentColor = contentColor,
                    border = if (!mine && !deleted) BorderStroke(1.dp, colors.outlineVariant) else null,
                ) {
                    // Inside the surface, so the press ripple follows the bubble's shape.
                    Text(
                        if (deleted) stringResource(R.string.chat_message_removed) else body,
                        style = MaterialTheme.typography.bodyLarge,
                        fontStyle = if (deleted) FontStyle.Italic else null,
                        modifier =
                            Modifier
                                .combinedClickable(
                                    enabled = hasMenu,
                                    onClickLabel = if (failed) stringResource(R.string.chat_message_retry) else null,
                                    onLongClickLabel = stringResource(R.string.chat_message_options),
                                    onLongClick = { menuOpen = true },
                                    onClick = { if (failed) actions.retry(item) },
                                ).padding(horizontal = 14.dp, vertical = 9.dp),
                    )
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (canCopy) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.chat_message_copy)) },
                            leadingIcon = { Icon(Icons.Outlined.ContentCopy, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                val clip = ClipEntry(ClipData.newPlainText(clipLabel, body))
                                scope.launch { clipboard.setClipEntry(clip) }
                                actions.copied()
                            },
                        )
                    }
                    // Checked when the menu opens: removal is possible for 15 minutes (11 section 6.7).
                    if (mayRemove && Duration.between(message.createdAt, Instant.now()) < REMOVE_WINDOW) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.chat_message_remove)) },
                            leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                actions.remove(item)
                            },
                        )
                    }
                    if (failed) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.chat_message_delete_local)) },
                            leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                actions.discard(item)
                            },
                        )
                    }
                    if (canReport) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.chat_message_report)) },
                            leadingIcon = { Icon(Icons.Outlined.Flag, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                actions.report(item, null)
                            },
                        )
                    }
                }
            }
            when {
                failed -> FailedLine(item, onRetry = { actions.retry(item) })
                else -> MetaLine(message = message, sending = sending, status = row.showStatus, connection = connection)
            }
            if (row.notice != null) {
                // The money notice offers "Report" with the reason preselected (13 section 5.3).
                val reportMoney = row.notice == SafetyFlag.MONEY && canReport
                SafetyNotice(
                    flag = row.notice,
                    onReport = if (reportMoney) ({ actions.report(item, MONEY_REASON) }) else null,
                )
            }
        }
    }
}

/** 18 dp corners with a tighter one on the sender's side; a group of messages reads as one block. */
private fun bubbleShape(
    mine: Boolean,
    joinsPrevious: Boolean,
): Shape {
    val round = 18.dp
    val tight = 6.dp
    val senderTop = if (joinsPrevious) tight else round
    return if (mine) {
        RoundedCornerShape(topStart = round, topEnd = senderTop, bottomEnd = tight, bottomStart = round)
    } else {
        RoundedCornerShape(topStart = senderTop, topEnd = round, bottomEnd = round, bottomStart = tight)
    }
}

/** The time under the bubble and, under the newest own message, its delivery state (16 section 6.11). */
@Composable
private fun MetaLine(
    message: Message,
    sending: Boolean,
    status: Boolean,
    connection: Connection,
    modifier: Modifier = Modifier,
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier.padding(start = 6.dp, end = 6.dp, top = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (sending) {
            Icon(
                Icons.Outlined.Schedule,
                contentDescription = stringResource(R.string.chat_message_sending),
                tint = muted,
                modifier = Modifier.size(12.dp),
            )
            Spacer(Modifier.width(4.dp))
        }
        Text(Formatters.time(message.createdAt), style = MaterialTheme.typography.labelSmall, color = muted)
        if (status) {
            // "Read" only when receipts are on for both, and they read up to this message.
            val read = connection.theirLastReadMessageId?.let { it >= message.id } == true
            Text(" · ", style = MaterialTheme.typography.labelSmall, color = muted)
            Icon(
                if (read) Icons.Outlined.DoneAll else Icons.Outlined.Done,
                contentDescription = null,
                tint = if (read) MaterialTheme.colorScheme.primary else muted,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(2.dp))
            Text(
                stringResource(if (read) R.string.chat_message_read else R.string.chat_message_sent),
                style = MaterialTheme.typography.labelSmall,
                color = if (read) MaterialTheme.colorScheme.primary else muted,
            )
        }
    }
}

/** "Not sent. Tap to retry" in the attention colour, with the reason when known. */
@Composable
private fun FailedLine(
    item: ChatItem,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val reason = item.local?.error?.resolve(res)
    val label = stringResource(R.string.chat_message_failed)
    Row(
        modifier
            .heightIn(min = 48.dp)
            .clickable(onClickLabel = stringResource(R.string.chat_message_retry), onClick = onRetry)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.ErrorOutline,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            if (reason != null) "$reason. $label" else label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

/** The notice under a flagged message from them, muted, with a shield (13 section 5.3). */
@Composable
private fun SafetyNotice(
    flag: SafetyFlag,
    onReport: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val text =
        stringResource(
            when (flag) {
                SafetyFlag.MONEY -> R.string.chat_notice_money
                SafetyFlag.OFF_PLATFORM -> R.string.chat_notice_off_platform
                SafetyFlag.CONTACT_INFO, SafetyFlag.UNKNOWN -> R.string.chat_notice_contact_info
            },
        )
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(top = 6.dp),
    ) {
        Row(Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = if (onReport != null) 2.dp else 10.dp)) {
            Icon(
                Icons.Outlined.GppMaybe,
                contentDescription = null,
                modifier =
                    Modifier
                        .padding(top = 2.dp)
                        .size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Column {
                Text(text, style = MaterialTheme.typography.bodySmall)
                if (onReport != null) {
                    TextButton(onClick = onReport) { Text(stringResource(R.string.chat_notice_report)) }
                }
            }
        }
    }
}

/** "Today", "Yesterday" or the date, centred in a soft pill. */
@Composable
private fun DaySeparator(
    instant: Instant,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    Box(
        modifier
            .fillMaxWidth()
            .padding(top = 14.dp, bottom = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Text(
                Formatters.dayLabel(res, instant),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    Modifier
                        .padding(horizontal = 12.dp, vertical = 4.dp)
                        .semantics { heading() },
            )
        }
    }
}

/** "Unread messages" above the first unread message when the screen opened. */
@Composable
private fun UnreadDivider(modifier: Modifier = Modifier) {
    val line = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)
    Row(
        modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(Modifier.weight(1f), color = line)
        Text(
            stringResource(R.string.chat_chat_unread_divider),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        HorizontalDivider(Modifier.weight(1f), color = line)
    }
}

/** A system message, centred in a soft pill (11 section 6.8). */
@Composable
private fun SystemLine(
    row: SystemRow,
    onOpenDetails: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val detailsLabel = stringResource(R.string.chat_chat_details)
    val colors = MaterialTheme.colorScheme
    val textColor = if (row.linksToDetails) colors.primary else colors.onSecondaryContainer
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f),
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        ) {
            Text(
                row.text,
                style = MaterialTheme.typography.labelMedium,
                textAlign = TextAlign.Center,
                color = textColor,
                textDecoration = if (row.linksToDetails) TextDecoration.Underline else null,
                modifier =
                    Modifier
                        .then(
                            if (row.linksToDetails) {
                                Modifier.clickable(onClickLabel = detailsLabel, onClick = onOpenDetails)
                            } else {
                                Modifier
                            },
                        ).padding(horizontal = 14.dp, vertical = 7.dp),
            )
        }
    }
}

/** "Load older messages", its spinner, or the failure with a retry. */
@Composable
private fun OlderMessages(
    loading: Boolean,
    failed: Boolean,
    onLoad: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            val label = stringResource(R.string.chat_chat_loading_older)
            CircularProgressIndicator(
                modifier =
                    Modifier
                        .size(24.dp)
                        .semantics { contentDescription = label },
                strokeWidth = 2.5.dp,
            )
        } else {
            TextButton(onClick = onLoad) {
                Text(stringResource(if (failed) R.string.chat_chat_older_failed else R.string.chat_chat_load_older))
            }
        }
    }
}

/** The "Before you start" card of 13 section 11.2, dismissible. */
@Composable
private fun FirstChatTips(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f),
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
    ) {
        Box {
            Column(
                Modifier.padding(start = 16.dp, top = 14.dp, end = 52.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.VerifiedUser,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        stringResource(R.string.chat_tips_title),
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                TipsList()
            }
            IconButton(onClick = onDismiss, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.chat_tips_dismiss))
            }
        }
    }
}

/** Two chips that fill the composer when there is no text message yet (16 section 6.11 states). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Starters(
    onStarter: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 12.dp, bottom = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.WavingHand,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.tertiary,
            modifier = Modifier.size(28.dp),
        )
        Spacer(Modifier.size(6.dp))
        Text(
            stringResource(R.string.chat_chat_start_label),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.size(10.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            STARTERS.forEach { id ->
                val label = stringResource(id)
                Surface(
                    onClick = { onStarter(label) },
                    shape = RoundedCornerShape(20.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerLowest,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)),
                ) {
                    Text(
                        label,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                        modifier =
                            Modifier
                                .heightIn(min = 44.dp)
                                .padding(horizontal = 16.dp, vertical = 11.dp),
                    )
                }
            }
        }
    }
}

/** "New messages": shown when a message arrives away from the bottom; tapping scrolls down. */
@Composable
private fun NewMessagesPill(
    visible: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn() + slideInVertically { it / 2 },
        exit = fadeOut() + slideOutVertically { it / 2 },
    ) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            shadowElevation = 4.dp,
        ) {
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.ArrowDownward, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.chat_chat_new_messages), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

private val STARTERS = listOf(R.string.chat_chat_chip_salaam, R.string.chat_chat_chip_family)

private const val STARTERS_KEY = "starters"
private const val OLDER_KEY = "older"
private const val TIPS_KEY = "tips"
private const val MONEY_REASON = "asking_for_money"
private const val BUBBLE_WIDTH = 0.82f
private const val LOAD_OLDER_AHEAD = 4
private val GROUP_WINDOW: Duration = Duration.ofMinutes(5)
private val BOTTOM_SLACK = 48.dp
private val DIVIDER_SPACE = 56.dp
