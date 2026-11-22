package com.khandanirishta.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/*
 * Sections of DESIGN.md section 6.10: headings after a diamond, and rows whose values start on
 * one line and drop under their labels when the column is too narrow. No boxes and no shadows:
 * the band a section sits in separates it from the next.
 */

/** A title after its diamond, which stays on the first line when the title wraps. */
@Composable
fun DiamondTitle(
    title: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.headlineSmall,
    note: String? = null,
) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        FirstLineMark(style) { Diamond() }
        Column(Modifier.weight(1f, fill = false)) {
            Text(title, style = style)
            if (note != null) {
                Text(
                    text = note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

enum class HeadingOrnament { DIAMOND, RULE, NONE }

/**
 * The title of a section, at 24 / 700. [action] ("See all", "Edit") sits at its end and moves
 * under it when the two no longer fit.
 */
@Composable
fun SectionHeading(
    title: String,
    modifier: Modifier = Modifier,
    ornament: HeadingOrnament = HeadingOrnament.DIAMOND,
    description: String? = null,
    style: TextStyle = MaterialTheme.typography.headlineSmall,
    action: (@Composable () -> Unit)? = null,
) {
    AdaptiveRow(
        modifier = modifier.fillMaxWidth(),
        spacing = Spacing.s16,
        lineSpacing = Spacing.s4,
        verticalAlignment = if (description == null) Alignment.CenterVertically else Alignment.Bottom,
    ) {
        Column(
            modifier = Modifier.grow(basis = TitleBasis),
            verticalArrangement = Arrangement.spacedBy(Spacing.s4),
        ) {
            if (ornament == HeadingOrnament.RULE) OrnamentRule()
            val heading = Modifier.semantics { heading() }
            if (ornament == HeadingOrnament.DIAMOND) {
                DiamondTitle(title, modifier = heading, style = style)
            } else {
                Text(title, style = style, modifier = heading)
            }
            if (description != null) {
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        action?.invoke()
    }
}

/**
 * A titled group with an optional "Edit" (specs/22 section 11 `SectionCard`): the diamond heading
 * and what belongs to it. Give groups bands of their own rather than boxes.
 */
@Composable
fun SectionCard(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    onEdit: (() -> Unit)? = null,
    editLabel: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        val edit: (@Composable () -> Unit)? =
            onEdit?.let {
                {
                    KrTextLink(
                        text = editLabel ?: stringResource(R.string.shared_section_edit),
                        onClick = it,
                        icon = Icons.Outlined.Edit,
                        contentDescription = text(R.string.shared_section_edit_named, "title" to title),
                    )
                }
            }
        SectionHeading(title = title, description = description, action = edit)
        Column(content = content)
    }
}

/**
 * A label and its value (DESIGN.md section 6.10). TalkBack reads the two as one item. The value
 * starts on one line down a group, and drops under the label when the column is too narrow.
 */
@Composable
fun InfoRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    divider: Boolean = true,
) {
    InfoRow(label = label, modifier = modifier, divider = divider) {
        Text(value, style = MaterialTheme.typography.titleSmall)
    }
}

/** An [InfoRow] with a value of its own. */
@Composable
fun InfoRow(
    label: String,
    modifier: Modifier = Modifier,
    divider: Boolean = true,
    value: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
        AdaptiveRow(
            modifier = Modifier.padding(vertical = Spacing.s12),
            spacing = Spacing.s16,
            lineSpacing = Spacing.s4,
            verticalAlignment = Alignment.Top,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.grow(LABEL_GROWS, LabelBasis),
            )
            Column(
                modifier = Modifier.grow(VALUE_GROWS, ValueBasis),
                horizontalAlignment = Alignment.Start,
                content = value,
            )
        }
        if (divider) RowDivider()
    }
}

/** The placeholder of specs/16 section 6.7 rule 3 for the relation [tier]. */
@Composable
fun lockedText(tier: Tier): String =
    stringResource(
        if (tier == Tier.CONNECTION) {
            R.string.shared_locked_hidden_by_member
        } else {
            R.string.shared_locked_visible_after_connect
        },
    )

/** A value the owner keeps private (DESIGN.md section 6.10): an outlined pill, a lock and words. */
@Composable
fun LockedValue(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = Color.Transparent,
        contentColor = KrTheme.colors.textSecondary,
        shape = MaterialTheme.shapes.large,
        border = BorderStroke(Strokes.hairline, MaterialTheme.colorScheme.outline),
        modifier = modifier,
    ) {
        IconText(
            icon = Icons.Outlined.Lock,
            text = text,
            style = MaterialTheme.typography.labelSmall,
            iconSize = Sizes.iconBadge,
            modifier = Modifier.padding(horizontal = Spacing.s12, vertical = Spacing.s4),
        )
    }
}

/** An [InfoRow] whose value the owner keeps private. */
@Composable
fun LockedRow(
    label: String,
    placeholder: String,
    modifier: Modifier = Modifier,
    divider: Boolean = true,
) {
    InfoRow(label = label, modifier = modifier, divider = divider) { LockedValue(placeholder) }
}

/** The hairline under a row. */
@Composable
fun RowDivider(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.outlineVariant,
) {
    HorizontalDivider(modifier = modifier, thickness = Strokes.hairline, color = color)
}

/**
 * A titled group that opens and closes. Its whole title row is the button and says whether the
 * group is open.
 */
@Composable
fun Disclosure(
    title: String,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    note: String? = null,
    ornament: Boolean = false,
    spacing: Dp = Spacing.s20,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        DisclosureHeader(title, expanded, onExpandedChange, note = note, ornament = ornament)
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn(Motion.base()) + expandVertically(Motion.base()),
            exit = fadeOut(Motion.fast()) + shrinkVertically(Motion.base()),
        ) {
            Column(
                modifier = Modifier.padding(top = Spacing.s16, bottom = Spacing.s20),
                verticalArrangement = Arrangement.spacedBy(spacing),
                content = content,
            )
        }
    }
}

/** The title row of a [Disclosure], for a group whose content is laid out by the screen. */
@Composable
fun DisclosureHeader(
    title: String,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    note: String? = null,
    ornament: Boolean = false,
) {
    val style = MaterialTheme.typography.titleMedium
    val turn by animateFloatAsState(if (expanded) HALF_TURN else 0f, Motion.base(), label = "disclosure")
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics {
                    heading()
                    if (expanded) {
                        collapse {
                            onExpandedChange(false)
                            true
                        }
                    } else {
                        expand {
                            onExpandedChange(true)
                            true
                        }
                    }
                }.tappable(shape = MaterialTheme.shapes.small, onClick = { onExpandedChange(!expanded) })
                .heightIn(min = Sizes.touchLarge)
                .padding(vertical = Spacing.s8),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (ornament) {
            DiamondTitle(title, modifier = Modifier.weight(1f), style = style, note = note)
        } else {
            Column(Modifier.weight(1f)) {
                Text(title, style = style)
                if (note != null) {
                    Text(
                        text = note,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Icon(
            Icons.Outlined.ExpandMore,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier =
                Modifier
                    .size(Sizes.icon)
                    .rotate(turn),
        )
    }
}

private val TitleBasis = 160.dp
private val LabelBasis = 140.dp
private val ValueBasis = 170.dp
private const val LABEL_GROWS = 1f
private const val VALUE_GROWS = 1.4f
private const val HALF_TURN = 180f
