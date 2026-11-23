package com.khandanirishta.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/*
 * Chips and tabs, styled Material widgets. A chosen chip takes the selected border, fill and
 * weight (DESIGN.md section 4.2) and no tick, which means verified. The 24 radius is a pill at
 * one line and stays a soft rectangle at two, and every row of chips wraps.
 */

/** A word or two on the fill that stands out on the band behind it: a hobby. */
@Composable
fun KrChip(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = KrTheme.tonal,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.large,
        modifier = modifier,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = Spacing.s16, vertical = Spacing.s8),
        )
    }
}

/**
 * A choice that stays pressed. [singleChoice] chips are radio buttons to TalkBack and go in a
 * `Modifier.selectableGroup()`; the others are checkboxes.
 */
@Composable
fun KrChoiceChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    singleChoice: Boolean = false,
    icon: ImageVector? = null,
    count: Long = 0,
    countLabel: String? = null,
) {
    val colors = MaterialTheme.colorScheme
    val choice = if (singleChoice) Role.RadioButton else Role.Checkbox
    FilterChip(
        selected = selected,
        onClick = onClick,
        enabled = enabled,
        shape = MaterialTheme.shapes.large,
        label = {
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                modifier = Modifier.padding(vertical = Spacing.s8),
            )
        },
        leadingIcon =
            icon?.let {
                { Icon(it, contentDescription = null, modifier = Modifier.size(Sizes.iconSmall)) }
            },
        trailingIcon = if (count > 0) ({ CountBadge(count, label = countLabel) }) else null,
        colors =
            FilterChipDefaults.filterChipColors(
                labelColor = colors.onSurface,
                iconColor = colors.onSurface,
                disabledContainerColor = KrTheme.colors.disabledContainer,
                disabledLabelColor = KrTheme.colors.onDisabledContainer,
                disabledLeadingIconColor = KrTheme.colors.onDisabledContainer,
                selectedContainerColor = colors.primaryContainer,
                disabledSelectedContainerColor = KrTheme.colors.disabledContainer,
                selectedLabelColor = colors.primary,
                selectedLeadingIconColor = colors.primary,
            ),
        border =
            BorderStroke(
                Strokes.control,
                when {
                    selected && enabled -> colors.primary

                    // Switched off, the choice still shows: its bold label and a border.
                    selected -> KrTheme.colors.onDisabledContainer

                    enabled -> colors.outline

                    else -> KrTheme.colors.disabledContainer
                },
            ),
        modifier =
            modifier
                .semantics { role = choice }
                .heightIn(min = Sizes.touch),
    )
}

/** One choice out of a few, as chips that wrap: the filters under tabs, segmented fields. */
@Composable
fun <T> SingleChoiceChips(
    options: List<Pair<T, String>>,
    selected: T?,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    FlowRow(
        modifier = modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        options.forEach { (value, label) ->
            KrChoiceChip(
                text = label,
                selected = value == selected,
                onClick = { onSelect(value) },
                enabled = enabled,
                singleChoice = true,
            )
        }
    }
}

/**
 * A chosen value with a way to take it away: filters, multi-selects. Without [onClick] a tap
 * anywhere removes it. With [onClick] the chip does that, and only its close control (48, named
 * [removeLabel]) removes, so a tap to read a search filter does not drop it and search again.
 */
@Composable
fun KrRemovableChip(
    text: String,
    removeLabel: String,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    InputChip(
        selected = false,
        onClick = onClick ?: onRemove,
        enabled = enabled,
        shape = MaterialTheme.shapes.large,
        label = {
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(vertical = Spacing.s8),
            )
        },
        trailingIcon = {
            if (onClick == null) {
                Icon(Icons.Outlined.Close, contentDescription = null, modifier = Modifier.size(Sizes.iconSmall))
            } else {
                IconButton(onClick = onRemove, enabled = enabled, modifier = Modifier.size(Sizes.touch)) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = removeLabel,
                        modifier = Modifier.size(Sizes.iconSmall),
                    )
                }
            }
        },
        colors =
            InputChipDefaults.inputChipColors(
                containerColor = KrTheme.tonal,
                labelColor = colors.onSurface,
                trailingIconColor = colors.onSurfaceVariant,
            ),
        border = BorderStroke(Strokes.hairline, colors.outline),
        modifier =
            if (onClick == null) {
                modifier.semantics {
                    contentDescription = removeLabel
                    role = Role.Button
                }
            } else {
                modifier
            }.heightIn(min = Sizes.touch),
    )
}

/** One tab of a list screen, with an optional count and what it says to TalkBack. */
@Immutable
data class KrTab(
    val label: String,
    val count: Long = 0,
    val countLabel: String? = null,
)

/**
 * The tabs of a screen, with counts. A count drops under its label when they do not fit. Where a
 * label would break inside a word (large text on a small phone), the tabs become chips that wrap,
 * so no tab is cut and none has to be scrolled to.
 */
@Composable
fun KrTabs(
    tabs: List<KrTab>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val style = MaterialTheme.typography.labelLarge
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val longestWord =
        remember(tabs, style, density, measurer) {
            val bold = style.copy(fontWeight = FontWeight.Bold)
            tabs.flatMap { it.label.split(' ') }.maxOfOrNull { measurer.measure(it, bold).size.width } ?: 0
        }
    BoxWithConstraints(modifier.fillMaxWidth().background(colors.surfaceContainer)) {
        val room = with(density) { (maxWidth / tabs.size.coerceAtLeast(1) - Spacing.s16).roundToPx() }
        if (longestWord <= room) {
            TabLine(tabs = tabs, selected = selected, onSelect = onSelect)
        } else {
            TabChips(tabs = tabs, selected = selected, onSelect = onSelect)
        }
    }
}

@Composable
private fun TabLine(
    tabs: List<KrTab>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    PrimaryTabRow(
        selectedTabIndex = selected,
        containerColor = colors.surfaceContainer,
        contentColor = colors.primary,
    ) {
        tabs.forEachIndexed { index, tab ->
            val chosen = index == selected
            Tab(
                selected = chosen,
                onClick = { onSelect(index) },
                selectedContentColor = colors.primary,
                unselectedContentColor = colors.onSurface,
            ) {
                FlowRow(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = Sizes.touchLarge)
                            .padding(horizontal = Spacing.s8, vertical = Spacing.s8),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s8, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(Spacing.s4, Alignment.CenterVertically),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = tab.label,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (chosen) FontWeight.Bold else FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                    )
                    CountBadge(tab.count, label = tab.countLabel)
                }
            }
        }
    }
}

@Composable
private fun TabChips(
    tabs: List<KrTab>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    FlowRow(
        modifier =
            Modifier
                .fillMaxWidth()
                .selectableGroup()
                .padding(horizontal = Spacing.gutter, vertical = Spacing.s8),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        tabs.forEachIndexed { index, tab ->
            KrChoiceChip(
                text = tab.label,
                selected = index == selected,
                onClick = { onSelect(index) },
                singleChoice = true,
                count = tab.count,
                countLabel = tab.countLabel,
            )
        }
    }
}
