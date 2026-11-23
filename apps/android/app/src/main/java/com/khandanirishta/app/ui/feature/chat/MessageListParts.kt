package com.khandanirishta.app.ui.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.FirstLineMark
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.IconTextLine
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.components.rememberNow
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import java.time.Instant

/*
 * What stands between the bubbles: day separators, the unread divider, system lines, older
 * pages, the first-chat tips, the starters and the "New messages" button.
 */

/** "Today", "Yesterday" or the date, as a centred caption. */
@Composable
internal fun DaySeparator(
    instant: Instant,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    CaptionText(
        text = Formatters.dayLabel(res, instant, rememberNow()),
        textAlign = TextAlign.Center,
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { heading() }
                .padding(top = Spacing.s20, bottom = Spacing.s4),
    )
}

/** "Unread messages" above the first unread message when the screen opened. */
@Composable
internal fun UnreadDivider(modifier: Modifier = Modifier) {
    val primary = MaterialTheme.colorScheme.primary
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(Modifier.weight(1f), thickness = Strokes.hairline, color = primary)
        Text(
            text = stringResource(R.string.chat_chat_unread_divider),
            style = KrType.badge,
            color = primary,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .semantics { heading() }
                    .padding(horizontal = Spacing.s8),
        )
        HorizontalDivider(Modifier.weight(1f), thickness = Strokes.hairline, color = primary)
    }
}

/**
 * A system message as a centred caption (11 section 6.8): a gold diamond and the words in a
 * hairline outline with no fill, so it never reads as the other family's sand bubble.
 */
@Composable
internal fun SystemLine(
    row: SystemRow,
    onOpenDetails: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = MaterialTheme.shapes.large
    val linked = row.linksToDetails
    val detailsLabel = stringResource(R.string.chat_chat_details)
    val link =
        if (linked) {
            Modifier
                .tappable(shape = shape, onClick = onOpenDetails, onClickLabel = detailsLabel)
                .heightIn(min = Sizes.touch)
        } else {
            Modifier
        }
    Box(
        modifier
            .fillMaxWidth()
            .padding(vertical = Spacing.s8),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = Color.Transparent,
            contentColor = if (linked) MaterialTheme.colorScheme.primary else KrTheme.colors.textSecondary,
            shape = shape,
            border = BorderStroke(Strokes.hairline, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.widthIn(max = SystemLineWidth),
        ) {
            Row(
                link.padding(horizontal = Spacing.s16, vertical = Spacing.s8),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8, Alignment.CenterHorizontally),
            ) {
                // On the first line when the words wrap, as in a heading.
                FirstLineMark(KrType.caption) { Diamond() }
                Text(
                    text = row.text,
                    style = KrType.caption,
                    textAlign = TextAlign.Center,
                    textDecoration = if (linked) TextDecoration.Underline else null,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }
        }
    }
}

/** "Load older messages", its spinner (rule G6), or the failure with a way to try again. */
@Composable
internal fun OlderMessages(
    loading: Boolean,
    failed: Boolean,
    onLoad: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.s8),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        if (loading) {
            val label = stringResource(R.string.chat_chat_loading_older)
            Box(
                Modifier
                    .heightIn(min = Sizes.touch)
                    .semantics {
                        contentDescription = label
                        liveRegion = LiveRegionMode.Polite
                    },
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(Sizes.icon),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = Color.Transparent,
                    strokeWidth = OlderSpinner,
                )
            }
        } else {
            if (failed) {
                IconText(
                    icon = Icons.Outlined.ErrorOutline,
                    text = stringResource(R.string.chat_chat_older_failed),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            KrButton(
                text = stringResource(R.string.chat_chat_load_older),
                onClick = onLoad,
                variant = KrButtonVariant.QUIET,
                enabled = LocalOnline.current,
            )
        }
    }
}

/** The "Before you start" card of 13 section 11.2, dismissible. */
@Composable
internal fun FirstChatTips(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val style = MaterialTheme.typography.titleMedium
    TonalPanel(
        modifier = modifier.padding(vertical = Spacing.s8),
        shape = MaterialTheme.shapes.extraLarge,
        spacing = Spacing.s8,
    ) {
        Row(Modifier.fillMaxWidth()) {
            IconTextLine(
                icon = Icons.Outlined.HealthAndSafety,
                style = style,
                tint = MaterialTheme.colorScheme.primary,
                modifier =
                    Modifier
                        .weight(1f)
                        .padding(top = Spacing.s12),
            ) {
                Text(
                    text = stringResource(R.string.chat_tips_title),
                    style = style,
                    modifier =
                        Modifier
                            .weight(1f)
                            .semantics { heading() },
                )
            }
            KrIconButton(
                icon = Icons.Outlined.Close,
                contentDescription = stringResource(R.string.chat_tips_dismiss),
                onClick = onDismiss,
            )
        }
        TipsList()
    }
}

/** Two sentences that fill the composer when there is no text message yet (16 section 6.11 states). */
@Composable
internal fun Starters(
    onStarter: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(top = Spacing.s16, bottom = Spacing.s4),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        Diamond()
        CaptionText(stringResource(R.string.chat_chat_start_label), textAlign = TextAlign.Center)
        STARTERS.forEach { id ->
            val sentence = stringResource(id)
            val shape = MaterialTheme.shapes.large
            Surface(
                color = Color.Transparent,
                contentColor = MaterialTheme.colorScheme.onSurface,
                shape = shape,
                border = BorderStroke(Strokes.hairline, MaterialTheme.colorScheme.outline),
            ) {
                Box(
                    Modifier
                        .tappable(shape = shape, onClick = { onStarter(sentence) })
                        .heightIn(min = Sizes.touch)
                        .padding(horizontal = Spacing.s16, vertical = Spacing.s12),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(sentence, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

/** "New messages": shown when a message arrives away from the bottom; tapping scrolls down. */
@Composable
internal fun NewMessagesPill(
    visible: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(Motion.fast()) + slideInVertically(Motion.base()) { it / 2 },
        exit = fadeOut(Motion.fast()) + slideOutVertically(Motion.base()) { it / 2 },
    ) {
        KrButton(
            text = stringResource(R.string.chat_chat_new_messages),
            onClick = onClick,
            size = KrButtonSize.DEFAULT,
            icon = Icons.Outlined.ArrowDownward,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

private val STARTERS = listOf(R.string.chat_chat_chip_salaam, R.string.chat_chat_chip_family)
private val SystemLineWidth = 448.dp
private val OlderSpinner = 3.dp
