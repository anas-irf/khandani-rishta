package com.khandanirishta.app.ui.feature.chat

import android.content.ClipData
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.outlined.RemoveCircleOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.MessageSender
import com.khandanirishta.app.core.network.generated.model.SafetyFlag
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.IconTextLine
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.RowShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/**
 * A message with its time, delivery state, safety notice and menu. To TalkBack the bubble and
 * the line under it are one item: who wrote it, the words, the time and the state, with the
 * entries of the long-press menu as custom actions.
 */
@Composable
internal fun MessageBubble(
    row: BubbleRow,
    name: String,
    read: Boolean,
    reportable: Boolean,
    removable: Boolean,
    actions: MessageActions,
    modifier: Modifier = Modifier,
) {
    val item = row.item
    val message = item.message
    val mine = message.sender == MessageSender.ME
    val failed = item.local?.failed == true
    val deleted = message.isDeleted
    val body = message.body.orEmpty()
    val canCopy = !deleted && body.isNotEmpty()
    val canReport = !mine && reportable && !deleted
    val mayRemove = mine && removable && item.local == null && !deleted
    val hasMenu = canCopy || canReport || mayRemove || failed
    val online = LocalOnline.current
    val side = if (mine) Alignment.End else Alignment.Start

    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val clipLabel = stringResource(R.string.chat_composer_label)
    val copy: () -> Unit = {
        val clip = ClipEntry(ClipData.newPlainText(clipLabel, body))
        scope.launch { clipboard.setClipEntry(clip) }
        actions.copied()
    }

    val optionsLabel = stringResource(R.string.chat_message_options)
    val retryLabel = stringResource(R.string.chat_message_retry)
    val copyLabel = stringResource(R.string.chat_message_copy)
    val removeLabel = stringResource(R.string.chat_message_remove)
    val deleteLabel = stringResource(R.string.chat_message_delete_local)
    val reportLabel = stringResource(R.string.chat_message_report)
    val press = remember { MutableInteractionSource() }
    var menuOpen by remember { mutableStateOf(false) }

    val accessibility =
        Modifier.semantics(mergeDescendants = true) {
            if (hasMenu) {
                // A tap does nothing on a sent message, so TalkBack's double tap opens the options.
                if (!failed) {
                    onClick(label = optionsLabel) {
                        menuOpen = true
                        true
                    }
                }
                customActions =
                    buildList {
                        if (canCopy) {
                            add(
                                CustomAccessibilityAction(copyLabel) {
                                    copy()
                                    true
                                },
                            )
                        }
                        if (online && mayRemove && canStillRemove(message.createdAt)) {
                            add(
                                CustomAccessibilityAction(removeLabel) {
                                    actions.remove(item)
                                    true
                                },
                            )
                        }
                        if (failed) {
                            add(
                                CustomAccessibilityAction(deleteLabel) {
                                    actions.discard(item)
                                    true
                                },
                            )
                        }
                        if (online && canReport) {
                            add(
                                CustomAccessibilityAction(reportLabel) {
                                    actions.report(item, null)
                                    true
                                },
                            )
                        }
                    }
            }
        }
    val gestures =
        if (hasMenu) {
            Modifier.combinedClickable(
                interactionSource = press,
                // Drawn inside the bubble, so it follows its shape.
                indication = null,
                onClickLabel = if (failed) retryLabel else null,
                onLongClickLabel = optionsLabel,
                onLongClick = { menuOpen = true },
                onClick = { if (failed && online) actions.retry(item) },
            )
        } else {
            Modifier
        }

    Column(
        modifier
            .fillMaxWidth()
            .padding(top = if (row.joinsPrevious) JoinedGap else Spacing.s12),
        horizontalAlignment = side,
    ) {
        Column(Modifier.fillMaxWidth(bubbleShare()), horizontalAlignment = side) {
            Box {
                Column(accessibility.then(gestures), horizontalAlignment = side) {
                    Sender(if (mine) stringResource(R.string.chat_message_from_me) else name)
                    Bubble(
                        body = body,
                        mine = mine,
                        failed = failed,
                        deleted = deleted,
                        joinsPrevious = row.joinsPrevious,
                        press = press,
                    )
                    if (failed) {
                        FailedLine(item)
                    } else {
                        DeliveryLine(
                            message = message,
                            sending = item.local != null,
                            showStatus = row.showStatus,
                            read = read,
                        )
                    }
                }
                KrMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (canCopy) {
                        KrMenuItem(
                            text = copyLabel,
                            icon = Icons.Outlined.ContentCopy,
                            onClick = {
                                menuOpen = false
                                copy()
                            },
                        )
                    }
                    // Checked when the menu opens: removal is possible for 15 minutes (11 section 6.7).
                    if (mayRemove && canStillRemove(message.createdAt)) {
                        KrMenuItem(
                            text = removeLabel,
                            icon = Icons.Outlined.Delete,
                            enabled = online,
                            onClick = {
                                menuOpen = false
                                actions.remove(item)
                            },
                        )
                    }
                    if (failed) {
                        KrMenuItem(
                            text = deleteLabel,
                            icon = Icons.Outlined.Delete,
                            onClick = {
                                menuOpen = false
                                actions.discard(item)
                            },
                        )
                    }
                    if (canReport) {
                        KrMenuItem(
                            text = reportLabel,
                            icon = Icons.Outlined.Flag,
                            enabled = online,
                            onClick = {
                                menuOpen = false
                                actions.report(item, null)
                            },
                        )
                    }
                }
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

private fun canStillRemove(createdAt: Instant): Boolean = Duration.between(createdAt, Instant.now()) < REMOVE_WINDOW

/** Who wrote it, for TalkBack. It has a dp of its own, because a node with no size is not read. */
@Composable
private fun Sender(who: String) {
    Box(
        Modifier
            .size(SenderNode)
            .semantics { contentDescription = who },
    )
}

/** Bubbles widen with the text, so a line at 200% still holds a few words. */
@Composable
private fun bubbleShare(): Float {
    val scale = LocalDensity.current.fontScale
    return when {
        scale >= HUGE_TEXT -> HUGE_TEXT_SHARE
        scale >= BIG_TEXT -> BIG_TEXT_SHARE
        else -> BUBBLE_SHARE
    }
}

/** Their words on sand, the member's own on primary. A message that was not sent turns to the error colours. */
@Composable
private fun Bubble(
    body: String,
    mine: Boolean,
    failed: Boolean,
    deleted: Boolean,
    joinsPrevious: Boolean,
    press: MutableInteractionSource,
) {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    val shape = bubbleShape(mine = mine, joinsPrevious = joinsPrevious)
    val onPrimary = mine && !failed && !deleted
    val container =
        when {
            deleted -> extra.disabledContainer
            failed -> colors.errorContainer
            mine -> colors.primary
            else -> colors.surfaceContainer
        }
    val content =
        when {
            deleted -> extra.onDisabledContainer
            onPrimary -> colors.onPrimary
            else -> colors.onSurface
        }
    val bubble: @Composable () -> Unit = {
        Surface(
            color = container,
            contentColor = content,
            shape = shape,
            border = if (failed) BorderStroke(Strokes.control, colors.error) else null,
        ) {
            Box(
                Modifier
                    .indication(press, ripple(focusRingShape = shape))
                    .padding(horizontal = Spacing.s16, vertical = Spacing.s8),
            ) {
                if (deleted) {
                    IconText(Icons.Outlined.RemoveCircleOutline, stringResource(R.string.chat_message_removed))
                } else {
                    MemberText(body, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
    if (onPrimary) InvertedFocusRing(bubble) else bubble()
}

/** The row radius with a tighter corner on the sender's side, so a group reads as one block. */
@Composable
private fun bubbleShape(
    mine: Boolean,
    joinsPrevious: Boolean,
): Shape {
    val tight = MaterialTheme.shapes.extraSmall.bottomEnd
    return remember(mine, joinsPrevious, tight) {
        val top = if (joinsPrevious) tight else RowShape.topStart
        if (mine) {
            RowShape.copy(topEnd = top, bottomEnd = tight)
        } else {
            RowShape.copy(topStart = top, bottomStart = tight)
        }
    }
}

/** The time under the bubble and, under the newest own message, its state in words (16 section 6.11). */
@Composable
private fun DeliveryLine(
    message: Message,
    sending: Boolean,
    showStatus: Boolean,
    read: Boolean,
) {
    val time = remember(message.createdAt) { Formatters.time(message.createdAt) }
    val modifier = Modifier.padding(horizontal = Spacing.s4)
    if (!sending && !showStatus) {
        CaptionText(time, modifier)
        return
    }
    val state =
        when {
            sending -> R.string.chat_message_sending
            read -> R.string.chat_message_read
            else -> R.string.chat_message_sent
        }
    // No ticks: a tick means verified (DESIGN.md section 6.6).
    val icon =
        when {
            sending -> Icons.Outlined.Schedule
            read -> Icons.Outlined.Visibility
            else -> Icons.AutoMirrored.Outlined.Send
        }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    IconText(
        icon = icon,
        text = "$time · ${stringResource(state)}",
        style = KrType.caption,
        color = muted,
        tint = if (read && !sending) MaterialTheme.colorScheme.primary else muted,
        iconSize = Sizes.iconBadge,
        gap = Spacing.s4,
        modifier = modifier,
    )
}

/** "Not sent. Tap to retry", after the reason when one is known. */
@Composable
private fun FailedLine(item: ChatItem) {
    val res = LocalResources.current
    val reason = item.local?.error?.resolve(res)
    val label = stringResource(R.string.chat_message_failed)
    IconText(
        icon = Icons.Outlined.ErrorOutline,
        text = if (reason != null) "$reason. $label" else label,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.error,
        iconSize = Sizes.iconTiny,
        gap = Spacing.s4,
        modifier =
            Modifier
                .semantics { liveRegion = LiveRegionMode.Polite }
                .padding(horizontal = Spacing.s4, vertical = Spacing.s4),
    )
}

/** The notice under a flagged message from them, muted, with a shield (13 section 5.3). */
@Composable
private fun SafetyNotice(
    flag: SafetyFlag,
    onReport: (() -> Unit)?,
) {
    val notice =
        when (flag) {
            SafetyFlag.MONEY -> R.string.chat_notice_money
            SafetyFlag.OFF_PLATFORM -> R.string.chat_notice_off_platform
            SafetyFlag.CONTACT_INFO, SafetyFlag.UNKNOWN -> R.string.chat_notice_contact_info
        }
    Surface(
        color = KrTheme.tonal,
        contentColor = KrTheme.colors.textSecondary,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.padding(top = Spacing.s8),
    ) {
        IconTextLine(
            icon = Icons.Outlined.GppMaybe,
            style = KrType.caption,
            iconSize = Sizes.iconTiny,
            modifier = Modifier.padding(horizontal = Spacing.s12, vertical = Spacing.s8),
        ) {
            Column(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                Text(stringResource(notice), style = KrType.caption)
                if (onReport != null) {
                    KrTextLink(
                        text = stringResource(R.string.chat_notice_report),
                        onClick = onReport,
                        enabled = LocalOnline.current,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

private const val MONEY_REASON = "asking_for_money"
private const val BUBBLE_SHARE = 0.82f
private const val BIG_TEXT = 1.3f
private const val BIG_TEXT_SHARE = 0.92f
private const val HUGE_TEXT = 1.8f
private const val HUGE_TEXT_SHARE = 0.97f
private val SenderNode = 1.dp
private val JoinedGap = 2.dp
