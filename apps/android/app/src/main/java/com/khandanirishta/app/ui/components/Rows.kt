package com.khandanirishta.app.ui.components

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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.RowShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/*
 * Rows that are one control from edge to edge (DESIGN.md sections 6.11 and 6.21): links, switches,
 * checkboxes, radios and nudges. The whole row is the target and the words always wrap.
 */

/** What a [NavRow] shows at its end. */
enum class RowEnd {
    CHEVRON,

    /** It opens a web page or another app. */
    EXTERNAL,

    NONE,
}

/** A row that opens a screen: an icon, a title over its line, a count, then the chevron. */
@Composable
fun NavRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    subtitle: String? = null,
    badge: Long = 0,
    badgeTone: CountTone = CountTone.PRIMARY,
    dot: Boolean = false,
    end: RowEnd = RowEnd.CHEVRON,
    enabled: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .tappable(shape = MaterialTheme.shapes.small, onClick = onClick, enabled = enabled)
                .heightIn(min = Sizes.touchLarge)
                .padding(vertical = Spacing.s12),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(
                icon,
                contentDescription = null,
                tint = colors.onSurfaceVariant,
                modifier = Modifier.size(Sizes.iconSmall),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = if (enabled) colors.onSurface else colors.onSurfaceVariant,
            )
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
            }
        }
        if (badge > 0) {
            CountBadge(badge, tone = badgeTone)
        } else if (dot) {
            AttentionMark()
        }
        RowEndIcon(end)
    }
}

@Composable
private fun RowEndIcon(end: RowEnd) {
    val icon =
        when (end) {
            RowEnd.CHEVRON -> Icons.AutoMirrored.Filled.KeyboardArrowRight
            RowEnd.EXTERNAL -> Icons.AutoMirrored.Outlined.OpenInNew
            RowEnd.NONE -> return
        }
    Icon(
        icon,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(Sizes.iconSmall),
    )
}

/**
 * A suggested next step as one sand link (DESIGN.md section 6.21): an arch with its icon, the
 * title over its text, then the chevron. [inRow] is the 72 tall card of the row on Home, which
 * shows the title alone and leaves the text to TalkBack.
 */
@Composable
fun NudgeCard(
    title: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
    tone: ArchTone = ArchTone.PRIMARY,
    inRow: Boolean = false,
) {
    val shape = MaterialTheme.shapes.large
    val spoken = if (inRow && description != null) "$title. $description" else null
    Surface(
        color = KrTheme.tonal,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = shape,
        modifier = modifier,
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .tappable(shape = shape, onClick = onClick)
                    .heightIn(min = Sizes.nudge)
                    .padding(horizontal = Spacing.s16, vertical = if (inRow) Spacing.s12 else Spacing.s16),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ArchIcon(icon, size = if (inRow) Sizes.archIconSmall else Sizes.archIcon, tone = tone)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                Text(
                    text = title,
                    style = KrType.emphasis,
                    modifier = Modifier.semantics { if (spoken != null) contentDescription = spoken },
                )
                if (!inRow && description != null) {
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = KrTheme.colors.textSecondary,
                    )
                }
            }
            RowEndIcon(RowEnd.CHEVRON)
        }
    }
}

/**
 * A setting that is one switch from edge to edge (DESIGN.md section 6.11): at least 72 tall, the
 * label and its help at the start, then Material's switch and the word "On" or "Off", so the
 * state is never colour alone.
 */
@Composable
fun SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    enabled: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    val fill = KrTheme.tonal
    Surface(color = fill, contentColor = colors.onSurface, shape = RowShape, modifier = modifier.fillMaxWidth()) {
        CompositionLocalProvider(LocalTonalColor provides nestedTonal(fill)) {
            AdaptiveRow(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .switchable(RowShape, value = checked, onValueChange = onCheckedChange, enabled = enabled)
                        .heightIn(min = Sizes.switchRow)
                        .padding(start = Spacing.s20, top = Spacing.s12, end = Spacing.s16, bottom = Spacing.s12),
                spacing = Spacing.s16,
                lineSpacing = Spacing.s8,
            ) {
                Column(
                    modifier = Modifier.grow(basis = SwitchLabelBasis),
                    verticalArrangement = Arrangement.spacedBy(Spacing.s4),
                ) {
                    Text(title, style = KrType.emphasis)
                    if (helper != null) {
                        Text(helper, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    trailing?.invoke()
                    KrSwitch(checked = checked, enabled = enabled)
                    Text(
                        text = stringResource(if (checked) R.string.common_switch_on else R.string.common_switch_off),
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                        modifier =
                            Modifier
                                .widthIn(min = SwitchWordWidth)
                                .clearAndSetSemantics {},
                    )
                }
            }
        }
    }
}

/** Material's switch in the colours of DESIGN.md section 6.11. The row around it takes the tap. */
@Composable
private fun KrSwitch(
    checked: Boolean,
    enabled: Boolean,
) {
    val colors = MaterialTheme.colorScheme
    Switch(
        checked = checked,
        onCheckedChange = null,
        enabled = enabled,
        // Content in the thumb keeps it large in both states.
        thumbContent = { Box(Modifier.size(Sizes.iconTiny)) },
        colors =
            SwitchDefaults.colors(
                checkedThumbColor = colors.background,
                checkedTrackColor = colors.primary,
                checkedBorderColor = colors.primary,
                checkedIconColor = Color.Transparent,
                uncheckedThumbColor = colors.background,
                uncheckedTrackColor = colors.outline,
                uncheckedBorderColor = colors.outline,
                uncheckedIconColor = Color.Transparent,
                disabledCheckedThumbColor = colors.background,
                disabledCheckedTrackColor = colors.primary.copy(alpha = DISABLED_TRACK),
                disabledCheckedBorderColor = Color.Transparent,
                disabledCheckedIconColor = Color.Transparent,
                disabledUncheckedThumbColor = colors.background,
                disabledUncheckedTrackColor = colors.outline.copy(alpha = DISABLED_TRACK),
                disabledUncheckedBorderColor = Color.Transparent,
                disabledUncheckedIconColor = Color.Transparent,
            ),
    )
}

/** Material's checkbox with the control border. The row around it takes the tap. */
@Composable
fun KrCheckboxMark(
    checked: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    error: Boolean = false,
) {
    val colors = MaterialTheme.colorScheme
    Checkbox(
        checked = checked,
        onCheckedChange = null,
        enabled = enabled,
        colors =
            CheckboxDefaults.colors(
                checkedColor = colors.primary,
                checkmarkColor = colors.onPrimary,
                uncheckedColor = if (error) colors.error else colors.outline,
                disabledCheckedColor = colors.onSurfaceVariant,
                disabledUncheckedColor = colors.outlineVariant,
            ),
        modifier = modifier,
    )
}

/** Material's radio with the control border. The row around it takes the tap. */
@Composable
fun KrRadioMark(
    selected: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    RadioButton(
        selected = selected,
        onClick = null,
        enabled = enabled,
        colors =
            RadioButtonDefaults.colors(
                selectedColor = colors.primary,
                unselectedColor = colors.outline,
                disabledSelectedColor = colors.onSurfaceVariant,
                disabledUnselectedColor = colors.outlineVariant,
            ),
        modifier = modifier,
    )
}

/** A checkbox and its words as one 48 tall target. The box stays on the first line. */
@Composable
fun CheckboxRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    helper: String? = null,
) {
    CheckboxRow(
        checked = checked,
        onCheckedChange = onCheckedChange,
        label = AnnotatedString(label),
        modifier = modifier,
        enabled = enabled,
        helper = helper,
    )
}

/** A [CheckboxRow] whose words may hold links. */
@Composable
fun CheckboxRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: AnnotatedString,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    error: Boolean = false,
    helper: String? = null,
) {
    val colors = MaterialTheme.colorScheme
    val style = MaterialTheme.typography.bodyMedium
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .switchable(
                    shape = MaterialTheme.shapes.small,
                    value = checked,
                    onValueChange = onCheckedChange,
                    role = Role.Checkbox,
                    enabled = enabled,
                ).heightIn(min = Sizes.touch)
                .padding(vertical = Spacing.s12),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        FirstLineMark(style) { KrCheckboxMark(checked = checked, enabled = enabled, error = error) }
        Column(Modifier.weight(1f)) {
            Text(label, style = style, color = if (enabled) colors.onSurface else colors.onSurfaceVariant)
            if (helper != null) {
                Text(helper, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
            }
        }
    }
}

/** One of a list of choices in a sheet or a dialog. Put the rows in a `Modifier.selectableGroup()`. */
@Composable
fun RadioRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    helper: String? = null,
) {
    val colors = MaterialTheme.colorScheme
    val style = MaterialTheme.typography.bodyMedium
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .choosable(MaterialTheme.shapes.small, selected = selected, onClick = onClick, enabled = enabled)
                .heightIn(min = Sizes.touch)
                .padding(vertical = Spacing.s12),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        FirstLineMark(style) { KrRadioMark(selected = selected, enabled = enabled) }
        Column(Modifier.weight(1f)) {
            Text(label, style = style, color = if (enabled) colors.onSurface else colors.onSurfaceVariant)
            if (helper != null) {
                Text(helper, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
            }
        }
    }
}

/**
 * A choice that needs an explanation: the whole card is the radio, and the chosen one takes the
 * selected border and fill (DESIGN.md sections 4.1 and 4.2).
 */
@Composable
fun RadioCardRow(
    title: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    helper: String? = null,
) {
    val colors = MaterialTheme.colorScheme
    val style = MaterialTheme.typography.titleSmall
    Surface(
        color = if (selected) colors.primaryContainer else KrTheme.tonal,
        contentColor = colors.onSurface,
        shape = RowShape,
        border = BorderStroke(Strokes.control, if (selected) colors.primary else Color.Transparent),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .choosable(shape = RowShape, selected = selected, onClick = onClick, enabled = enabled)
                    .heightIn(min = Sizes.touch)
                    .padding(horizontal = Spacing.s16, vertical = Spacing.s12),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            FirstLineMark(style) { KrRadioMark(selected = selected, enabled = enabled) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                Text(title, style = style)
                if (helper != null) {
                    Text(helper, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
            }
        }
    }
}

/**
 * A sentence that fills a field: a message template, a prompt. The chosen one takes the selected
 * border and fill.
 */
@Composable
fun ChoiceRow(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        color = if (selected) colors.primaryContainer else Color.Transparent,
        contentColor = if (enabled) colors.onSurface else colors.onSurfaceVariant,
        shape = RowShape,
        border = BorderStroke(Strokes.control, if (selected) colors.primary else colors.outline),
        modifier = modifier.fillMaxWidth(),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .choosable(shape = RowShape, selected = selected, onClick = onClick, enabled = enabled)
                    .heightIn(min = Sizes.touch)
                    .padding(horizontal = Spacing.s16, vertical = Spacing.s12),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(text, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private val SwitchLabelBasis = 150.dp
private val SwitchWordWidth = 28.dp
private const val DISABLED_TRACK = 0.7f
