package com.khandanirishta.app.ui.feature.chat

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.MessageKind
import com.khandanirishta.app.core.network.generated.model.MessageSender
import com.khandanirishta.app.core.network.generated.model.SafetyFlag
import com.khandanirishta.app.core.network.generated.model.SystemEvent
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One line of the conversation: a day separator, the unread divider, a system line or a bubble. */
@Immutable
internal sealed interface ChatRow {
    val key: String
}

@Immutable
internal data class DayRow(
    override val key: String,
    val instant: Instant,
) : ChatRow

@Immutable
internal data object UnreadRow : ChatRow {
    override val key: String = "unread"
}

@Immutable
internal data class SystemRow(
    override val key: String,
    val text: String,
    /** "{name} shared contact details with you." opens the connection details (16 section 6.11). */
    val linksToDetails: Boolean,
) : ChatRow

@Immutable
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
    val rows = ArrayList<ChatRow>(items.size + SEPARATORS)
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

private const val SEPARATORS = 8
private val GROUP_WINDOW: Duration = Duration.ofMinutes(5)
