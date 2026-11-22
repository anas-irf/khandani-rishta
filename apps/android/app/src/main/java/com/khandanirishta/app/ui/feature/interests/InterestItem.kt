package com.khandanirishta.app.ui.feature.interests

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.DisplayStatus
import com.khandanirishta.app.core.network.generated.model.Interest
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.InterestStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AnswerRow
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ExpiryNote
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.QuoteBlock
import com.khandanirishta.app.ui.components.StatusPill
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.UnavailableRow
import com.khandanirishta.app.ui.components.rememberNow
import com.khandanirishta.app.ui.feature.lists.RowMeta
import com.khandanirishta.app.ui.feature.lists.UnseenMark
import com.khandanirishta.app.ui.feature.lists.rememberRelativeTime
import com.khandanirishta.app.ui.feature.lists.rowActions
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.Spacing
import java.time.Instant

/**
 * One interest (specs/16 section 6.9): the compact card, the message, when it came and where it
 * stands, then its answers. [sent] is the box it is listed in.
 */
@Composable
internal fun InterestItem(
    interest: Interest,
    sent: Boolean,
    highlighted: Boolean,
    accepting: Boolean,
    actions: InterestsActions,
    modifier: Modifier = Modifier,
) {
    val member = interest.profile
    val card = remember(member, interest.compatScore) { member?.copy(compat = interest.compatScore) }
    HighlightFrame(highlighted = highlighted, modifier = modifier) {
        if (card == null) {
            // The other member can no longer be opened: a quiet row without answers (11 section 3.1).
            UnavailableRow(text = stringResource(R.string.interests_unavailable)) {
                InterestDetails(interest = interest, sent = sent, unseen = false)
            }
        } else {
            val received = interest.direction == InterestDirection.RECEIVED
            val pending = interest.status == InterestStatus.PENDING
            val chatId = interest.connectionId?.takeIf { interest.status == InterestStatus.ACCEPTED }
            val buttons: (@Composable ColumnScope.() -> Unit)? =
                if (pending || chatId != null) {
                    { InterestButtons(interest, chatId = chatId, accepting = accepting, actions = actions) }
                } else {
                    null
                }
            val online = LocalOnline.current
            val acceptLabel = stringResource(R.string.interests_actions_accept)
            val declineLabel = stringResource(R.string.interests_actions_decline)
            ProfileRow(
                card = card,
                onOpen = { actions.openProfile(card.id) },
                details = {
                    InterestDetails(
                        interest = interest,
                        sent = sent,
                        unseen = received && !interest.seen,
                        modifier =
                            Modifier.rowActions(
                                enabled = received && pending && online && !accepting,
                                acceptLabel to { actions.accept(interest) },
                                declineLabel to { actions.decline(interest) },
                            ),
                    )
                },
                actions = buttons,
            )
        }
    }
}

/** The row a notification named, on its own fill (specs/17 section 3.3). */
@Composable
private fun HighlightFrame(
    highlighted: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val tonal = if (highlighted) colors.background else LocalTonalColor.current
    Surface(
        color = if (highlighted) colors.primaryContainer else Color.Transparent,
        contentColor = colors.onSurface,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.fillMaxWidth(),
    ) {
        CompositionLocalProvider(LocalTonalColor provides tonal) {
            Box(Modifier.padding(horizontal = if (highlighted) Spacing.s12 else 0.dp)) { content() }
        }
    }
}

/** The message in quotes, then the unseen mark, the time, the expiry and the status. */
@Composable
private fun InterestDetails(
    interest: Interest,
    sent: Boolean,
    unseen: Boolean,
    modifier: Modifier = Modifier,
) {
    val time =
        text(
            if (sent) R.string.interests_sent_at else R.string.interests_received_at,
            "time" to rememberRelativeTime(interest.createdAt),
        )
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        val message = interest.message
        if (!message.isNullOrBlank()) QuoteBlock(text(R.string.interests_message, "message" to message))
        RowMeta {
            if (unseen) UnseenMark(stringResource(R.string.interests_unseen))
            CaptionText(time)
            if (interest.status == InterestStatus.PENDING) Expiry(interest.expiresAt)
            StatusLabel(interest.displayStatus)
        }
    }
}

/** "Expires in {n} days", or today. */
@Composable
private fun Expiry(expiresAt: Instant) {
    val now = rememberNow()
    val days = remember(expiresAt, now) { Formatters.daysUntil(expiresAt, now) }
    ExpiryNote(
        text =
            if (days == 0) {
                stringResource(R.string.interests_expires_today)
            } else {
                plural(R.plurals.interests_expires_in, days)
            },
        expiresAt = expiresAt,
    )
}

/**
 * The status in words. Accepted has the two people of "Connected"; the others keep the envelope
 * of an interest, and none is red: a closed or declined interest is not an error.
 */
@Composable
private fun StatusLabel(status: DisplayStatus) {
    val label = displayStatusLabel(status) ?: return
    val accepted = status == DisplayStatus.ACCEPTED
    StatusPill(
        text = stringResource(label),
        tone = if (accepted) StatusTone.SUCCESS else StatusTone.NEUTRAL,
        icon = if (accepted) Icons.Outlined.Groups else Icons.Outlined.MailOutline,
    )
}

/** Decline and Accept, Withdraw, or Open chat. */
@Composable
private fun InterestButtons(
    interest: Interest,
    chatId: String?,
    accepting: Boolean,
    actions: InterestsActions,
) {
    val online = LocalOnline.current
    when {
        chatId != null -> {
            KrButton(
                text = stringResource(R.string.interests_actions_open_chat),
                onClick = { actions.openChat(chatId) },
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.Outlined.ChatBubbleOutline,
            )
        }

        interest.direction == InterestDirection.RECEIVED -> {
            AnswerRow(
                secondary = { answer ->
                    KrButton(
                        text = stringResource(R.string.interests_actions_decline),
                        onClick = { actions.decline(interest) },
                        variant = KrButtonVariant.SECONDARY,
                        size = KrButtonSize.LARGE,
                        enabled = online && !accepting,
                        modifier = answer,
                    )
                },
                primary = { answer ->
                    KrButton(
                        text = stringResource(R.string.interests_actions_accept),
                        onClick = { actions.accept(interest) },
                        enabled = online,
                        loading = accepting,
                        modifier = answer,
                    )
                },
            )
        }

        else -> {
            KrButton(
                text = stringResource(R.string.interests_actions_withdraw),
                onClick = { actions.withdraw(interest) },
                variant = KrButtonVariant.SECONDARY,
                enabled = online,
            )
        }
    }
}

/** The label of `display_status`; nothing for `pending` (specs/16 section 6.9). */
@StringRes
private fun displayStatusLabel(status: DisplayStatus): Int? =
    when (status) {
        DisplayStatus.ACCEPTED -> R.string.interests_display_status_accepted
        DisplayStatus.NO_RESPONSE -> R.string.interests_display_status_no_response
        DisplayStatus.CLOSED -> R.string.interests_display_status_closed
        DisplayStatus.WITHDRAWN -> R.string.interests_display_status_withdrawn
        DisplayStatus.DECLINED -> R.string.interests_display_status_declined
        DisplayStatus.PENDING, DisplayStatus.UNKNOWN -> null
    }
