package com.khandanirishta.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.text.reasonLabels
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import com.khandanirishta.app.ui.theme.TABULAR_FIGURES
import java.time.Duration
import java.time.Instant

/*
 * The text parts of DESIGN.md sections 6.6, 6.9 and 6.12: names that wrap, the meta line, reasons,
 * member-written text, quotes and expiry.
 */

private val AGE_AT_END = Regex(",\\s(?=\\d+$)")

/** "Ayesha K., 26" with the age held to the last word, so it never starts a line of its own. */
fun holdAgeToName(nameAndAge: String): String = AGE_AT_END.replace(nameAndAge, ",\u00A0")

/** A member's name and age (specs/16 section 1.5). It wraps and is never cut. */
@Composable
fun nameAndAge(
    name: String,
    age: Int,
): String {
    val line = text(R.string.common_format_name_age, "name" to name, "age" to age)
    return remember(line) { holdAgeToName(line) }
}

/** A name and age as a heading of its line, with tabular figures. */
@Composable
fun NameAge(
    name: String,
    age: Int,
    style: TextStyle,
    modifier: Modifier = Modifier,
) {
    Text(
        text = nameAndAge(name, age),
        style = style.copy(fontFeatureSettings = TABULAR_FIGURES),
        color = MaterialTheme.colorScheme.onSurface,
        modifier = modifier,
    )
}

/**
 * Facts on one line, "Lahore · Software and IT · Divorced" (DESIGN.md section 6.9). It wraps
 * between facts and each keeps its dot, so a line never starts with one. TalkBack hears commas.
 */
@Composable
fun MetaLine(
    facts: List<String>,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = KrTheme.colors.textSecondary,
) {
    val shown = remember(facts) { facts.filter { it.isNotBlank() } }
    if (shown.isEmpty()) return
    val spoken = remember(shown) { AnnotatedString(shown.joinToString(", ")) }
    FlowRow(
        modifier = modifier.clearAndSetSemantics { text = spoken },
        horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
    ) {
        shown.forEachIndexed { index, fact ->
            Text(
                text = if (index < shown.lastIndex) "$fact\u00A0·" else fact,
                style = style,
                color = color,
            )
        }
    }
}

/**
 * Up to three reasons as a list, not pills, because their labels are long (DESIGN.md section 6.6).
 * Each has a dot and never a tick, which means verified. Codes outside the list are not shown.
 */
@Composable
fun ReasonChips(
    reasons: List<String>,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodySmall,
) {
    val subject = rememberCandidate().subject
    val labels = remember(reasons, subject) { reasonLabels(reasons, subject) }
    if (labels.isEmpty()) return
    val title = stringResource(R.string.shared_reasons_label)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
        labels.forEachIndexed { index, label ->
            val reason = stringResource(label)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                FirstLineMark(style, Modifier.width(Sizes.iconTiny)) {
                    Box(
                        Modifier
                            .size(ReasonDot)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.onSurfaceVariant),
                    )
                }
                Text(
                    text = reason,
                    style = style,
                    color = MaterialTheme.colorScheme.onSurface,
                    // The first reason carries the name of the list for TalkBack.
                    modifier =
                        Modifier
                            .weight(1f, fill = false)
                            .semantics { if (index == 0) contentDescription = "$title: $reason" },
                )
            }
        }
    }
}

/**
 * Text a member wrote: always plain, with its own direction and its line breaks, and no wider
 * than a comfortable measure.
 */
@Composable
fun MemberText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    color: Color = Color.Unspecified,
    textAlign: TextAlign = TextAlign.Start,
    maxLines: Int = Int.MAX_VALUE,
) {
    Text(
        text = text,
        style = style.copy(textDirection = TextDirection.Content),
        color = color,
        textAlign = textAlign,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.widthIn(max = Sizes.measure),
    )
}

/** A member's own words: a tonal block with the gold bar at its start, shown in full. */
@Composable
fun QuoteBlock(
    text: String?,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodySmall,
) {
    if (text.isNullOrBlank()) return
    val bar = KrTheme.colors.ornament
    Surface(
        color = KrTheme.tonal,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.small,
        modifier = modifier.fillMaxWidth(),
    ) {
        MemberText(
            text = text,
            style = style,
            modifier =
                Modifier
                    .drawWithContent {
                        drawContent()
                        val width = Strokes.quote.toPx()
                        val x = if (layoutDirection == LayoutDirection.Ltr) 0f else size.width - width
                        drawRect(bar, topLeft = Offset(x, 0f), size = Size(width, size.height))
                    }.padding(horizontal = Spacing.s16, vertical = Spacing.s12),
        )
    }
}

/** An interest that expires within this long takes the attention colours. */
private val SOON: Duration = Duration.ofDays(3)

fun expiresSoon(
    expiresAt: Instant,
    now: Instant = Instant.now(),
): Boolean = Duration.between(now, expiresAt) <= SOON

/**
 * When an interest expires (DESIGN.md section 6.12): a clock and [text], muted. In the last 3
 * days it takes the attention colour on attention soft, and keeps the icon.
 */
@Composable
fun ExpiryNote(
    text: String,
    expiresAt: Instant,
    modifier: Modifier = Modifier,
) {
    val now = rememberNow()
    val soon = remember(expiresAt, now) { expiresSoon(expiresAt, now) }
    val extra = KrTheme.colors
    val color = if (soon) extra.warning else MaterialTheme.colorScheme.onSurfaceVariant
    val line: @Composable (Modifier) -> Unit = {
        IconText(
            icon = Icons.Outlined.Schedule,
            text = text,
            style = KrType.caption,
            color = color,
            iconSize = Sizes.iconTiny,
            gap = NoteGap,
            modifier = it,
        )
    }
    if (soon) {
        Surface(color = extra.warningContainer, shape = MaterialTheme.shapes.large, modifier = modifier) {
            line(Modifier.padding(horizontal = Spacing.s12, vertical = Spacing.s4))
        }
    } else {
        line(modifier)
    }
}

/** A muted caption: timestamps, helper text, limits. */
@Composable
fun CaptionText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    textAlign: TextAlign = TextAlign.Start,
) {
    Text(text = text, style = KrType.caption, color = color, textAlign = textAlign, modifier = modifier)
}

private val ReasonDot = 6.dp
private val NoteGap = 6.dp
