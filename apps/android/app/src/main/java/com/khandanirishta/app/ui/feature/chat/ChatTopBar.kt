package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.ui.components.FirstLineMark
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuDivider
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.KrTopBar
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusPill
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** What the header and its menu can do; built once per screen. */
@Immutable
internal class ChatHeaderActions(
    val back: () -> Unit,
    val openDetails: () -> Unit,
    val viewProfile: () -> Unit,
    val toggleMute: () -> Unit,
    val toggleArchive: () -> Unit,
    val safetyTips: () -> Unit,
    val report: () -> Unit,
    val block: () -> Unit,
    val end: () -> Unit,
)

/**
 * The header (16 section 6.11 block 1): the arch, the name, then "typing...", "Online now" or the
 * last active label, and the stage. All of it opens the connection details. The name wraps; at
 * large text the arch gives it the room.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ChatTopBar(
    connection: Connection,
    name: String,
    subtitle: String?,
    onlineNow: Boolean,
    typing: Boolean,
    online: Boolean,
    actions: ChatHeaderActions,
    modifier: Modifier = Modifier,
) {
    val large = isLargeText()
    val stageShown =
        connection.stage != ConnectionStage.CHATTING &&
            connection.stage != ConnectionStage.UNKNOWN &&
            // While typing in large text the messages need that line; the stage is in the details too.
            !(large && WindowInsets.isImeVisible)
    val detailsLabel = text(R.string.chat_chat_open_details, "name" to name)
    val spoken = spokenName(connection.other, name)
    KrTopBar(modifier) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(Spacing.s4),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChatBack(actions.back)
            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics { heading() }
                        .tappable(
                            shape = MaterialTheme.shapes.small,
                            onClick = actions.openDetails,
                            onClickLabel = detailsLabel,
                        ).heightIn(min = Sizes.touchLarge)
                        .padding(Spacing.s4),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!large) OtherAvatar(connection.other, size = Sizes.arch40)
                Column(Modifier.weight(1f)) {
                    Text(name, style = KrType.name, modifier = Modifier.semantics { contentDescription = spoken })
                    if (subtitle != null || stageShown) {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                            verticalArrangement = Arrangement.spacedBy(Spacing.s4),
                            itemVerticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (subtitle != null) Presence(subtitle, onlineNow = onlineNow, typing = typing)
                            if (stageShown) {
                                StatusPill(
                                    text = stringResource(stageLabel(connection.stage)),
                                    tone = StatusTone.SUCCESS,
                                    icon = Icons.Outlined.Groups,
                                )
                            }
                        }
                    }
                }
            }
            ChatMenu(connection = connection, online = online, actions = actions)
        }
    }
}

/** A dot only beside the words "Online now", so it is never colour alone. */
@Composable
private fun Presence(
    words: String,
    onlineNow: Boolean,
    typing: Boolean,
) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
    ) {
        if (onlineNow) {
            FirstLineMark(KrType.caption) {
                Box(
                    Modifier
                        .size(Spacing.s8)
                        .background(KrTheme.colors.online, PillShape),
                )
            }
        }
        Text(
            text = words,
            style = KrType.caption,
            color = if (typing) colors.primary else colors.onSurfaceVariant,
            modifier = Modifier.weight(1f, fill = false),
        )
    }
}

/** The menu of 16 section 6.11. Danger is not a menu colour: it waits for the confirmation. */
@Composable
private fun ChatMenu(
    connection: Connection,
    online: Boolean,
    actions: ChatHeaderActions,
) {
    var open by remember { mutableStateOf(false) }
    val close: (() -> Unit) -> () -> Unit = { action ->
        {
            open = false
            action()
        }
    }
    val active = connection.status == ConnectionStatus.ACTIVE
    val hasOther = connection.other != null
    val muted = connection.isMuted
    val archived = connection.isArchived
    Box {
        KrIconButton(
            icon = Icons.Outlined.MoreVert,
            contentDescription = stringResource(R.string.chat_chat_menu),
            onClick = { open = true },
        )
        KrMenu(expanded = open, onDismissRequest = { open = false }) {
            if (hasOther) {
                KrMenuItem(
                    text = stringResource(R.string.chat_chat_view_profile),
                    icon = Icons.Outlined.Person,
                    onClick = close(actions.viewProfile),
                )
            }
            KrMenuItem(
                text = stringResource(R.string.chat_chat_details),
                icon = Icons.Outlined.Info,
                onClick = close(actions.openDetails),
            )
            if (active) {
                KrMenuItem(
                    text = stringResource(if (muted) R.string.chat_chat_unmute else R.string.chat_chat_mute),
                    icon = if (muted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff,
                    enabled = online,
                    onClick = close(actions.toggleMute),
                )
                KrMenuItem(
                    text = stringResource(if (archived) R.string.chat_chat_unarchive else R.string.chat_chat_archive),
                    icon = if (archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                    enabled = online,
                    onClick = close(actions.toggleArchive),
                )
            }
            KrMenuItem(
                text = stringResource(R.string.chat_chat_safety_tips),
                icon = Icons.Outlined.HealthAndSafety,
                onClick = close(actions.safetyTips),
            )
            if (hasOther || active) KrMenuDivider()
            if (hasOther) {
                KrMenuItem(
                    text = stringResource(R.string.chat_chat_report),
                    icon = Icons.Outlined.Flag,
                    enabled = online,
                    onClick = close(actions.report),
                )
                KrMenuItem(
                    text = stringResource(R.string.chat_chat_block),
                    icon = Icons.Outlined.Block,
                    enabled = online,
                    onClick = close(actions.block),
                )
            }
            if (active) {
                KrMenuItem(
                    text = stringResource(R.string.chat_chat_end),
                    icon = Icons.Outlined.LinkOff,
                    enabled = online,
                    onClick = close(actions.end),
                )
            }
        }
    }
}

/** The header while the conversation loads: Back works, the rest has its final shape. */
@Composable
internal fun ChatTopBarSkeleton(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val large = isLargeText()
    KrTopBar(modifier) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(Spacing.s4),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChatBack(onBack)
            LoadingRegion(Modifier.weight(1f)) {
                Row(
                    modifier =
                        Modifier
                            .heightIn(min = Sizes.touchLarge)
                            .padding(Spacing.s4),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (!large) SkeletonBox(Modifier.size(Sizes.arch40), shape = ArchShape)
                    SkeletonBox(
                        Modifier
                            .fillMaxWidth(SKELETON_NAME)
                            .heightIn(min = Spacing.s24),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatBack(onBack: () -> Unit) {
    KrIconButton(
        icon = Icons.AutoMirrored.Filled.ArrowBack,
        contentDescription = stringResource(R.string.a11y_back),
        onClick = onBack,
    )
}

private const val SKELETON_NAME = 0.6f
