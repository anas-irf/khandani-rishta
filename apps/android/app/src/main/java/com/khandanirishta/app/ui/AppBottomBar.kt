package com.khandanirishta.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ShortNavigationBar
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.ShortNavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AttentionMark
import com.khandanirishta.app.ui.components.CountBadge
import com.khandanirishta.app.ui.components.CountTone
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes

/** The five destinations with their badges (specs/16 sections 2.1 and 2.4). */
@Composable
fun AppBottomBar(
    navigator: AppNavigator,
    me: Me,
    modifier: Modifier = Modifier,
) {
    DestinationBar(
        selected = navigator.currentTab,
        counts =
            DestinationCounts(
                interests = me.counters.pendingInterests,
                chats = me.counters.unreadChats,
                attention = me.profile.completeness < ATTENTION_BELOW || me.counters.pendingPhotoRequests > 0,
            ),
        onSelect = navigator::selectTab,
        modifier = modifier,
    )
}

/** What the bar shows on its destinations. */
@Immutable
data class DestinationCounts(
    val interests: Long = 0,
    val chats: Long = 0,
    val attention: Boolean = false,
)

/**
 * Material's short navigation bar in the look of DESIGN.md section 6.17: 64 tall plus the inset,
 * with the primary soft indicator. Its labels are never cut: when five no longer fit on a line
 * (large text), they take a second one.
 */
@Composable
fun DestinationBar(
    selected: Tab,
    counts: DestinationCounts,
    onSelect: (Tab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    Column(modifier) {
        RowDivider()
        ShortNavigationBar(containerColor = colors.background, contentColor = colors.onSurfaceVariant) {
            WrappingDestinations {
                Tab.entries.forEach { tab ->
                    Destination(tab = tab, selected = tab == selected, counts = counts, onClick = { onSelect(tab) })
                }
            }
        }
    }
}

@Composable
private fun Destination(
    tab: Tab,
    selected: Boolean,
    counts: DestinationCounts,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val fontScale = LocalDensity.current.fontScale
    val count =
        when (tab) {
            Tab.INTERESTS -> counts.interests
            Tab.CHATS -> counts.chats
            else -> 0L
        }
    val attention = tab == Tab.ME && counts.attention
    val label = stringResource(tab.label())
    val description =
        when {
            count > 0 -> "$label, " + text(R.string.common_nav_badge_count, "count" to Formatters.badgeCount(count))
            attention -> "$label, " + stringResource(R.string.common_nav_attention_dot)
            else -> label
        }
    ShortNavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = {
            BadgedBox(
                badge = {
                    when {
                        count > 0 -> {
                            CountBadge(
                                count = count,
                                // Primary for interests, inverse for chats (DESIGN.md section 6.19).
                                tone = if (tab == Tab.INTERESTS) CountTone.PRIMARY else CountTone.INVERSE,
                                small = true,
                                decorative = true,
                                // A larger count moves aside, so the icon under it can still be told.
                                modifier = Modifier.padding(start = BadgeShift * (fontScale - 1f).coerceAtLeast(0f)),
                            )
                        }

                        attention -> {
                            // Given room, so it sits beside the head of the icon and not on it.
                            Box(Modifier.size(AttentionRoom), contentAlignment = Alignment.TopEnd) {
                                AttentionMark(decorative = true)
                            }
                        }
                    }
                },
            ) {
                Icon(
                    imageVector = if (selected) tab.selectedIcon() else tab.icon(),
                    contentDescription = null,
                    modifier = Modifier.size(Sizes.icon),
                )
            }
        },
        label = {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
        },
        colors =
            ShortNavigationBarItemDefaults.colors(
                selectedIconColor = colors.primary,
                selectedTextColorTopIconPosition = colors.primary,
                selectedTextColorStartIconPosition = colors.primary,
                selectedIndicatorColor = colors.secondaryContainer,
                unselectedIconColor = colors.onSurfaceVariant,
                unselectedTextColor = colors.onSurfaceVariant,
            ),
        modifier = Modifier.semantics { contentDescription = description },
    )
}

/** Equal widths while every label fits its share, then its own width, then another line. */
@Composable
private fun WrappingDestinations(content: @Composable () -> Unit) {
    val policy = remember { WrappingPolicy() }
    Layout(content = content, measurePolicy = policy)
}

private class WrappingPolicy : MeasurePolicy {
    override fun MeasureScope.measure(
        measurables: List<Measurable>,
        constraints: Constraints,
    ): MeasureResult {
        val width = constraints.maxWidth
        val lines = arrange(measurables, width)
        val heights =
            lines.map { line ->
                line.indices.maxOf { measurables[line.first + it].maxIntrinsicHeight(line.widths[it]) }
            }
        val content = heights.sum()
        val height = constraints.constrainHeight(content)
        // Room that is left (the bar's 64) is shared by the lines.
        val extra = ((height - content) / lines.size).coerceAtLeast(0)
        val placed =
            lines.mapIndexed { index, line ->
                line.indices.map {
                    val box = Constraints.fixed(line.widths[it], heights[index] + extra)
                    measurables[line.first + it].measure(box)
                }
            }
        return layout(width, height) {
            var y = 0
            placed.forEach { line ->
                var x = 0
                line.forEach { placeable ->
                    placeable.placeRelative(x, y)
                    x += placeable.width
                }
                y += line.first().height
            }
        }
    }

    override fun IntrinsicMeasureScope.minIntrinsicHeight(
        measurables: List<IntrinsicMeasurable>,
        width: Int,
    ): Int = heightFor(measurables, width)

    override fun IntrinsicMeasureScope.maxIntrinsicHeight(
        measurables: List<IntrinsicMeasurable>,
        width: Int,
    ): Int = heightFor(measurables, width)

    private fun Density.heightFor(
        measurables: List<IntrinsicMeasurable>,
        width: Int,
    ): Int =
        arrange(measurables, width).sumOf { line ->
            line.indices.maxOf { measurables[line.first + it].maxIntrinsicHeight(line.widths[it]) }
        }

    private fun Density.arrange(
        measurables: List<IntrinsicMeasurable>,
        width: Int,
    ): List<Line> {
        val gap = LabelGap.roundToPx()
        val wanted = IntArray(measurables.size) { measurables[it].maxIntrinsicWidth(Constraints.Infinity) + gap }
        // The fewest lines whose items fit, split as evenly as five allows: 5, then 3 and 2.
        for (count in 1..measurables.size) {
            val perLine = (measurables.size + count - 1) / count
            val lines = (0 until measurables.size step perLine).map { first ->
                val size = minOf(perLine, measurables.size - first)
                Line(first, size, IntArray(size) { wanted[first + it] })
            }
            if (perLine > 1 && lines.any { it.widths.sum() > width }) continue
            return lines.map { it.filling(width) }
        }
        return emptyList()
    }
}

private class Line(
    val first: Int,
    val size: Int,
    val widths: IntArray,
) {
    val indices: IntRange get() = 0 until size

    fun filling(width: Int): Line {
        val share = width / size
        if (size == 1 || widths.all { it <= share }) return Line(first, size, IntArray(size) { share })
        val extra = (width - widths.sum()) / size
        return Line(first, size, IntArray(size) { widths[it] + extra })
    }
}

private fun Tab.label(): Int =
    when (this) {
        Tab.HOME -> R.string.common_nav_home
        Tab.SEARCH -> R.string.common_nav_search
        Tab.INTERESTS -> R.string.common_nav_interests
        Tab.CHATS -> R.string.common_nav_chats
        Tab.ME -> R.string.common_nav_me
    }

// The envelope is Interests: the heart belongs to Shortlist alone.
private fun Tab.icon(): ImageVector =
    when (this) {
        Tab.HOME -> Icons.Outlined.Home
        Tab.SEARCH -> Icons.Outlined.Search
        Tab.INTERESTS -> Icons.Outlined.MailOutline
        Tab.CHATS -> Icons.Outlined.ChatBubbleOutline
        Tab.ME -> Icons.Outlined.Person
    }

private fun Tab.selectedIcon(): ImageVector =
    when (this) {
        Tab.HOME -> Icons.Filled.Home
        Tab.SEARCH -> Icons.Outlined.Search
        Tab.INTERESTS -> Icons.Filled.Email
        Tab.CHATS -> Icons.Filled.ChatBubble
        Tab.ME -> Icons.Filled.Person
    }

private const val ATTENTION_BELOW = 70
private val LabelGap = 6.dp
private val AttentionRoom = 16.dp
private val BadgeShift = 8.dp
