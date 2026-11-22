package com.khandanirishta.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.CardRelation
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.badgeLabel
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.text.verifications
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.TABULAR_FIGURES

/*
 * The small marks of DESIGN.md sections 6.3 to 6.7 and 6.19. A status is never colour alone: it
 * pairs colour with an icon and words. A tick means verified, the envelope means an interest and
 * the heart means Shortlist; each means nothing else.
 */

/** The tones of a status: banners, notices and pills. */
enum class StatusTone { NEUTRAL, INFO, SUCCESS, WARNING, DANGER }

/** The fill, the accent of the icon, and the icon a tone has when none is given. */
@Immutable
data class ToneColors(
    val container: Color,
    val accent: Color,
    val icon: ImageVector,
)

@Composable
fun toneColors(tone: StatusTone): ToneColors {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    return when (tone) {
        StatusTone.NEUTRAL -> ToneColors(KrTheme.tonal, extra.textSecondary, Icons.Outlined.Info)
        StatusTone.INFO -> ToneColors(colors.primaryContainer, colors.primary, Icons.Outlined.Info)
        StatusTone.SUCCESS -> ToneColors(extra.successContainer, extra.success, Icons.Outlined.CheckCircle)
        StatusTone.WARNING -> ToneColors(extra.warningContainer, extra.warning, Icons.Outlined.WarningAmber)
        StatusTone.DANGER -> ToneColors(colors.errorContainer, colors.error, Icons.Outlined.ErrorOutline)
    }
}

/** A short status in a pill: an icon, or a spinner while it is on its way, and words. */
@Composable
fun StatusPill(
    text: String,
    modifier: Modifier = Modifier,
    tone: StatusTone = StatusTone.NEUTRAL,
    icon: ImageVector? = null,
    spinning: Boolean = false,
) {
    val look = toneColors(tone)
    Surface(
        color = look.container,
        contentColor = look.accent,
        shape = MaterialTheme.shapes.large,
        modifier = modifier,
    ) {
        // Not merged: in a card each badge would become a TalkBack stop of its own.
        Row(
            Modifier.padding(horizontal = Spacing.s12, vertical = BadgePadding),
            horizontalArrangement = Arrangement.spacedBy(BadgeGap),
        ) {
            FirstLineMark(KrType.badge) {
                if (spinning) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(Sizes.iconBadge),
                        color = look.accent,
                        trackColor = Color.Transparent,
                        strokeWidth = SmallSpinner,
                    )
                } else {
                    Icon(icon ?: look.icon, contentDescription = null, modifier = Modifier.size(Sizes.iconBadge))
                }
            }
            Text(text, style = KrType.badge, modifier = Modifier.weight(1f, fill = false))
        }
    }
}

/**
 * The verification badges (DESIGN.md section 6.3): words with a tick, never icons alone, one per
 * earned check in the order ID, photo, phone. `new` is a label on the photo, not a badge here.
 */
@Composable
fun BadgeRow(
    badges: List<Badge>,
    modifier: Modifier = Modifier,
) {
    val earned = remember(badges) { badges.verifications() }
    if (earned.isEmpty()) return
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        earned.forEach { badge ->
            badgeLabel(badge)?.let { label ->
                StatusPill(stringResource(label), tone = StatusTone.SUCCESS, icon = Icons.Outlined.Check)
            }
        }
    }
}

/** "Must have" (DESIGN.md section 6.4): primary on primary soft, after the dimension it marks. */
@Composable
fun KrTag(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.primary,
        shape = PillShape,
        modifier = modifier,
    ) {
        Text(text, style = KrType.badge, modifier = Modifier.padding(horizontal = TagPadding, vertical = TagInset))
    }
}

private val PERCENT = Regex("\\d+\\s?%")

/** A sentence with its percentage set in [number], wherever the translation puts it. */
fun withPercent(
    text: String,
    number: SpanStyle,
): AnnotatedString =
    buildAnnotatedString {
        append(text)
        PERCENT.find(text)?.let { addStyle(number, it.range.first, it.range.last + 1) }
    }

/** A sentence with its percentage bold, in [color] and in tabular figures. */
@Composable
fun percentText(
    text: String,
    color: Color = Color.Unspecified,
): AnnotatedString =
    remember(text, color) {
        val number = SpanStyle(color = color, fontWeight = FontWeight.Bold, fontFeatureSettings = TABULAR_FIGURES)
        withPercent(text, number)
    }

/** The match pill (DESIGN.md section 6.5): "87% match" on success, with the number set larger. */
@Composable
fun CompatBadge(
    value: Int,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val label = text(R.string.shared_compat, "value" to value)
    val number =
        if (compact) {
            MaterialTheme.typography.titleSmall.copy(
                fontWeight = FontWeight.Bold,
                fontFeatureSettings = TABULAR_FIGURES,
            )
        } else {
            KrType.figure
        }
    val rest = if (compact) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelMedium
    Surface(
        color = KrTheme.colors.match,
        contentColor = KrTheme.colors.onSuccess,
        shape = PillShape,
        modifier = modifier,
    ) {
        Text(
            text = remember(label, number) { withPercent(label, number.toSpanStyle()) },
            style = rest,
            textAlign = TextAlign.Center,
            modifier =
                Modifier.padding(
                    horizontal = if (compact) Spacing.s12 else MatchPadding,
                    vertical = if (compact) Spacing.s4 else MatchInset,
                ),
        )
    }
}

/** What a card says about the relation to the viewer (specs/16 section 1.5). */
enum class CardHint { SENT, RECEIVED, CONNECTED }

fun hintOf(relation: CardRelation): CardHint? =
    when {
        relation.tier == Tier.CONNECTION -> CardHint.CONNECTED
        relation.interestDirection == InterestDirection.SENT -> CardHint.SENT
        relation.interestDirection == InterestDirection.RECEIVED -> CardHint.RECEIVED
        else -> null
    }

/** "Interest sent", "Interested in you", "Connected" (DESIGN.md section 6.7). */
@Composable
fun RelationHint(
    hint: CardHint,
    modifier: Modifier = Modifier,
) {
    val candidate = rememberCandidate()
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    val container: Color
    val content: Color
    val label: Int
    when (hint) {
        CardHint.SENT -> {
            container = Color.Transparent
            content = extra.textSecondary
            label = R.string.shared_card_relation_sent
        }

        CardHint.RECEIVED -> {
            container = colors.primaryContainer
            content = colors.primary
            label =
                candidate.pick(
                    R.string.shared_card_relation_received,
                    R.string.shared_card_relation_received_male,
                    R.string.shared_card_relation_received_female,
                )
        }

        CardHint.CONNECTED -> {
            container = extra.successContainer
            content = extra.onSuccessContainer
            label = R.string.shared_card_relation_connected
        }
    }
    val sidePadding = if (hint == CardHint.SENT) 0.dp else Spacing.s12
    Surface(color = container, contentColor = content, shape = MaterialTheme.shapes.large, modifier = modifier) {
        IconText(
            icon = if (hint == CardHint.CONNECTED) Icons.Outlined.Groups else Icons.Outlined.MailOutline,
            text = stringResource(label),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
            iconSize = Sizes.iconMedium,
            gap = BadgeGap,
            modifier = Modifier.padding(horizontal = sidePadding, vertical = BadgePadding),
        )
    }
}

/** Primary for interests; inverse for chats and notifications (DESIGN.md section 6.19). */
enum class CountTone { PRIMARY, INVERSE }

/**
 * A count in a pill: "99+" above 99 and nothing at zero (specs/16 section 2.4). It says [label]
 * to TalkBack, "{n} new" unless told otherwise; where the control around it already says the
 * count, pass [decorative].
 */
@Composable
fun CountBadge(
    count: Long,
    modifier: Modifier = Modifier,
    tone: CountTone = CountTone.PRIMARY,
    small: Boolean = false,
    decorative: Boolean = false,
    label: String? = null,
) {
    if (count <= 0) return
    val colors = MaterialTheme.colorScheme
    val shown = Formatters.badgeCount(count)
    val spoken = label ?: text(R.string.common_nav_badge_count, "count" to shown)
    val size: Dp = if (small) Sizes.countBadgeSmall else Sizes.countBadge
    // As wide as it is tall at any text size, so one digit stays a circle and not an upright oval.
    val round = maxOf(size, countLineHeight())
    val primary = tone == CountTone.PRIMARY
    Box(
        modifier
            .clearAndSetSemantics { if (!decorative) contentDescription = spoken }
            .clip(PillShape)
            .background(if (primary) colors.primary else colors.inverseSurface)
            .defaultMinSize(minWidth = round, minHeight = size)
            .padding(horizontal = BadgeGap),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = shown,
            style = KrType.count,
            color = if (primary) colors.onPrimary else colors.background,
            softWrap = false,
        )
    }
}

/** How tall the line of a count is at the reader's text size. */
@Composable
internal fun countLineHeight(): Dp = LocalDensity.current.lineHeightOf(KrType.count)

/** The gold diamond that says something needs attention (DESIGN.md section 6.17). */
@Composable
fun AttentionMark(
    modifier: Modifier = Modifier,
    decorative: Boolean = false,
) {
    val label = stringResource(R.string.common_nav_attention_dot)
    Diamond(
        size = AttentionSize,
        color = MaterialTheme.colorScheme.tertiary,
        modifier = modifier.clearAndSetSemantics { if (!decorative) contentDescription = label },
    )
}

/** The mark of an item not seen yet, always with words for TalkBack. */
@Composable
fun UnreadDot(
    label: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .clearAndSetSemantics { contentDescription = label }
            .size(UnreadSize)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary),
    )
}

private val BadgeGap = 6.dp
private val BadgePadding = 5.dp
private val TagPadding = 10.dp
private val TagInset = 3.dp
private val MatchPadding = 14.dp
private val MatchInset = 6.dp
private val SmallSpinner = 1.5.dp
private val AttentionSize = 9.dp
private val UnreadSize = 11.dp
