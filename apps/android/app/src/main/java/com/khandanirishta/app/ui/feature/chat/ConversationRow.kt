package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.Party
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.CountBadge
import com.khandanirishta.app.ui.components.CountTone
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.StatusPill
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.rememberNow
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * One conversation, by the item table of 16 section 6.10. All of it opens the chat; a long press
 * opens mute and archive, which are also the row's custom actions.
 */
@Composable
internal fun ConversationRow(
    connection: Connection,
    filter: ChatFilter,
    online: Boolean,
    onOpen: () -> Unit,
    onToggleMute: () -> Unit,
    onToggleArchive: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val name = otherName(connection)
    val active = connection.status == ConnectionStatus.ACTIVE
    val hasMenu = active && online
    val menuLabel = text(R.string.chat_chats_menu, "name" to name)
    val muteLabel = stringResource(if (connection.isMuted) R.string.chat_chats_unmute else R.string.chat_chats_mute)
    val archiveLabel =
        stringResource(if (connection.isArchived) R.string.chat_chats_unarchive else R.string.chat_chats_archive)
    val shape = MaterialTheme.shapes.small
    var menuOpen by remember { mutableStateOf(false) }

    Box(modifier.fillMaxWidth()) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics {
                        if (hasMenu) {
                            customActions =
                                listOf(
                                    CustomAccessibilityAction(muteLabel) {
                                        onToggleMute()
                                        true
                                    },
                                    CustomAccessibilityAction(archiveLabel) {
                                        onToggleArchive()
                                        true
                                    },
                                )
                        }
                    }.clip(shape)
                    .combinedClickable(
                        interactionSource = null,
                        indication = ripple(focusRingShape = shape),
                        role = Role.Button,
                        onLongClickLabel = if (hasMenu) menuLabel else null,
                        onLongClick = if (hasMenu) ({ menuOpen = true }) else null,
                        onClick = onOpen,
                    ).padding(vertical = Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            Row(
                modifier = Modifier.heightIn(min = Sizes.arch46.height),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            ) {
                OtherAvatar(connection.other)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                    NameAndTime(connection = connection, name = name)
                    PreviewLine(connection)
                    ConversationMarks(connection = connection, filter = filter)
                }
            }
            if (isQuiet(connection, rememberNow())) {
                // Under the whole row: at 200% text its words do not fit beside the arch.
                IconText(
                    icon = Icons.Outlined.Schedule,
                    text = stringResource(R.string.chat_chats_quiet),
                    style = KrType.caption,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    iconSize = Sizes.iconTiny,
                )
            }
        }
        Box(Modifier.align(Alignment.BottomEnd)) {
            KrMenu(expanded = menuOpen && hasMenu, onDismissRequest = { menuOpen = false }) {
                KrMenuItem(
                    text = muteLabel,
                    icon = if (connection.isMuted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff,
                    onClick = {
                        menuOpen = false
                        onToggleMute()
                    },
                )
                KrMenuItem(
                    text = archiveLabel,
                    icon = if (connection.isArchived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                    onClick = {
                        menuOpen = false
                        onToggleArchive()
                    },
                )
            }
        }
    }
}

/** The name, which wraps and is never cut, and the time, which takes its own line beside a long one. */
@Composable
private fun NameAndTime(
    connection: Connection,
    name: String,
) {
    val spoken = spokenName(connection.other, name)
    val res = LocalResources.current
    val time = connection.lastMessageAt ?: connection.createdAt
    AdaptiveRow(spacing = Spacing.s8, lineSpacing = Spacing.s4) {
        Text(
            text = name,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = if (connection.unreadCount > 0) FontWeight.Bold else null,
            modifier =
                Modifier
                    .grow()
                    .semantics { contentDescription = spoken },
        )
        Text(
            text = Formatters.relative(res, time, rememberNow()),
            style = KrType.caption.merge(KrType.numbers),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PreviewLine(connection: Connection) {
    val unread = connection.unreadCount > 0
    val colors = MaterialTheme.colorScheme
    val preview =
        connection.lastMessagePreview ?: stringResource(
            if (hasNoTextMessages(connection)) R.string.chat_chats_preview_new else R.string.chat_chats_preview_update,
        )
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s8), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = preview,
            style = MaterialTheme.typography.bodySmall.copy(textDirection = TextDirection.Content),
            fontWeight = if (unread) FontWeight.Bold else null,
            color = if (unread) colors.onSurface else colors.onSurfaceVariant,
            // One line by 16 section 6.10: the whole message is one tap away.
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (unread) {
            CountBadge(
                count = connection.unreadCount.toLong(),
                tone = CountTone.INVERSE,
                label = plural(R.plurals.chat_chats_unread, connection.unreadCount),
            )
        }
    }
}

/** Stage, a suggestion to answer, muted, archived and ended, each an icon and words. */
@Composable
private fun ConversationMarks(
    connection: Connection,
    filter: ChatFilter,
) {
    val stageShown = connection.stage != ConnectionStage.CHATTING && connection.stage != ConnectionStage.UNKNOWN
    val waiting =
        connection.status == ConnectionStatus.ACTIVE && connection.pendingStageProposal?.proposedBy == Party.THEM
    val ended = filter == ChatFilter.ENDED || connection.status == ConnectionStatus.ENDED
    if (!stageShown && !waiting && !ended && !connection.isMuted && !connection.isArchived) return
    FlowRow(
        modifier = Modifier.padding(top = Spacing.s4),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        if (stageShown) {
            StatusPill(
                text = stringResource(stageLabel(connection.stage)),
                tone = StatusTone.SUCCESS,
                icon = Icons.Outlined.Groups,
            )
        }
        if (waiting) StatusPill(stringResource(R.string.chat_chats_waiting_for_you), tone = StatusTone.WARNING)
        if (connection.isMuted) {
            StatusPill(stringResource(R.string.chat_chats_muted), icon = Icons.Outlined.NotificationsOff)
        }
        if (connection.isArchived) {
            StatusPill(stringResource(R.string.chat_chats_filter_archived), icon = Icons.Outlined.Archive)
        }
        if (ended) StatusPill(stringResource(R.string.chat_chats_ended), icon = Icons.Outlined.LinkOff)
    }
}
