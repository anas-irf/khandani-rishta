package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.LayoutScopeMarker
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.layout.ParentDataModifier
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import kotlin.math.max
import kotlin.math.roundToInt

/*
 * The layout rules of DESIGN.md sections 5 and 6: tonal bands in place of cards and shadows, a
 * centred column on wide windows, and rows that wrap instead of clipping at 200% text.
 */

/** A centred column that stops growing at [max]. Apply it before the padding. */
fun Modifier.contentWidth(max: Dp = Sizes.columnWidth): Modifier =
    this
        .fillMaxWidth()
        .wrapContentWidth(Alignment.CenterHorizontally)
        .widthIn(max = max)
        .fillMaxWidth()

/**
 * A Scaffold's padding without its bottom, for content that scrolls on behind the navigation bar
 * or the action bar (edge to edge). What scrolls then adds that bottom inside itself. Not for a
 * form: a field has to come to rest above the keyboard.
 */
@Composable
fun PaddingValues.exceptBottom(): PaddingValues {
    val direction = LocalLayoutDirection.current
    return PaddingValues(
        start = calculateStartPadding(direction),
        top = calculateTopPadding(),
        end = calculateEndPadding(direction),
    )
}

/** The sides of a screen and the space above and below what is in a band. */
object BandDefaults {
    val padding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s24)
    val compactPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s16)
}

enum class BandTone { PAGE, SAND, SUCCESS, PRIMARY, INVERSE }

/** Bands that take turns between page and sand, counting only those that are shown. */
fun bandToneAt(index: Int): BandTone = if (index % 2 == 0) BandTone.PAGE else BandTone.SAND

/**
 * A tonal band (DESIGN.md section 6.10): a full-width fill with its column inside. It separates
 * the parts of a screen in place of cards, and tells what is inside which fill stands out on it.
 */
@Composable
fun Band(
    modifier: Modifier = Modifier,
    tone: BandTone = BandTone.PAGE,
    padding: PaddingValues = BandDefaults.padding,
    maxWidth: Dp = Sizes.columnWidth,
    spacing: Dp = 0.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val fill: Color
    val onFill: Color
    val tonal: Color
    when (tone) {
        BandTone.PAGE -> {
            fill = colors.background
            onFill = colors.onBackground
            tonal = colors.surfaceContainer
        }

        BandTone.SAND -> {
            fill = colors.surfaceContainer
            onFill = colors.onSurface
            tonal = colors.background
        }

        BandTone.SUCCESS -> {
            fill = KrTheme.colors.successContainer
            onFill = colors.onSurface
            tonal = colors.background
        }

        BandTone.PRIMARY -> {
            fill = colors.primary
            onFill = colors.onPrimary
            tonal = colors.background
        }

        BandTone.INVERSE -> {
            fill = colors.inverseSurface
            onFill = colors.inverseOnSurface
            tonal = colors.background
        }
    }
    val column: @Composable () -> Unit = {
        Column(
            modifier =
                Modifier
                    .contentWidth(maxWidth)
                    .padding(padding),
            verticalArrangement = Arrangement.spacedBy(spacing),
            content = content,
        )
    }
    Surface(color = fill, contentColor = onFill, modifier = modifier.fillMaxWidth()) {
        CompositionLocalProvider(LocalTonalColor provides tonal) {
            if (tone == BandTone.PRIMARY || tone == BandTone.INVERSE) InvertedFocusRing(column) else column()
        }
    }
}

/**
 * A block of its own on a band, in the fill that stands out on it. What is inside then stands
 * out with the band's fill.
 */
@Composable
fun TonalPanel(
    modifier: Modifier = Modifier,
    shape: Shape = MaterialTheme.shapes.large,
    padding: PaddingValues = PaddingValues(Spacing.s20),
    spacing: Dp = 0.dp,
    horizontalAlignment: Alignment.Horizontal = Alignment.Start,
    content: @Composable ColumnScope.() -> Unit,
) {
    val fill = KrTheme.tonal
    Surface(
        color = fill,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = shape,
        modifier = modifier.fillMaxWidth(),
    ) {
        CompositionLocalProvider(LocalTonalColor provides nestedTonal(fill)) {
            Column(
                modifier = Modifier.padding(padding),
                verticalArrangement = Arrangement.spacedBy(spacing),
                horizontalAlignment = horizontalAlignment,
                content = content,
            )
        }
    }
}

/** What stands out inside a block that is filled with [fill]. */
@Composable
fun nestedTonal(fill: Color): Color {
    val colors = MaterialTheme.colorScheme
    return if (fill == colors.surfaceContainer) colors.background else colors.surfaceContainer
}

@LayoutScopeMarker
@Stable
interface AdaptiveRowScope {
    /**
     * Takes a share of the room that is left, and the whole line when the row stacks. [basis] is
     * the width the child asks for in place of its content's, and grows with the text.
     */
    fun Modifier.grow(
        weight: Float = 1f,
        basis: Dp = Dp.Unspecified,
    ): Modifier = this.then(GrowElement(weight, basis))
}

private object AdaptiveRowScopeInstance : AdaptiveRowScope

private data class GrowElement(
    val weight: Float,
    val basis: Dp,
) : ParentDataModifier {
    override fun Density.modifyParentData(parentData: Any?): Any = this@GrowElement
}

/**
 * A row that stacks when its children do not fit side by side, so nothing is clipped or squeezed
 * at 200% text (DESIGN.md section 7): two buttons, a label and its value, a title and its action.
 *
 * Side by side, children marked `Modifier.grow()` share the room by their weights. Stacked, they
 * take the whole line and the others keep their own width, at the start.
 *
 * Children are asked for their intrinsic width, so they cannot be lazy or subcomposed layouts.
 */
@Composable
fun AdaptiveRow(
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.s12,
    lineSpacing: Dp = spacing,
    verticalAlignment: Alignment.Vertical = Alignment.CenterVertically,
    content: @Composable AdaptiveRowScope.() -> Unit,
) {
    val policy = remember(spacing, lineSpacing, verticalAlignment) {
        AdaptiveRowPolicy(spacing, lineSpacing, verticalAlignment)
    }
    Layout(content = { AdaptiveRowScopeInstance.content() }, modifier = modifier, measurePolicy = policy)
}

private class AdaptiveRowPolicy(
    private val spacing: Dp,
    private val lineSpacing: Dp,
    private val alignment: Alignment.Vertical,
) : MeasurePolicy {
    override fun MeasureScope.measure(
        measurables: List<Measurable>,
        constraints: Constraints,
    ): MeasureResult {
        if (measurables.isEmpty()) return layout(constraints.minWidth, constraints.minHeight) {}
        val grows = measurables.map { it.parentData as? GrowElement }
        val natural = IntArray(measurables.size) { wantedWidth(measurables[it], grows[it]) }
        val room = if (constraints.hasBoundedWidth) constraints.maxWidth else Constraints.Infinity
        val plan = plan(natural, grows, room, spacing.roundToPx())
        val measured = arrayOfNulls<Placeable>(measurables.size)
        // The others first: what one leaves of its share goes to those that grow, so it ends flush.
        var spare = 0
        for (index in measurables.indices) {
            if (grows[index] != null) continue
            val limits = Constraints(maxWidth = plan.widths[index], maxHeight = constraints.maxHeight)
            val placeable = measurables[index].measure(limits)
            if (!plan.stacked && constraints.hasBoundedWidth) spare += plan.widths[index] - placeable.width
            measured[index] = placeable
        }
        val totalWeight = grows.sumOf { (it?.weight ?: 0f).toDouble() }.toFloat()
        for (index in measurables.indices) {
            val grow = grows[index] ?: continue
            val bonus = if (totalWeight > 0f) (spare * (grow.weight / totalWeight)).toInt() else 0
            val width = plan.widths[index] + bonus
            val limits = Constraints(minWidth = width, maxWidth = width, maxHeight = constraints.maxHeight)
            measured[index] = measurables[index].measure(limits)
        }
        val placeables = measured.requireNoNulls().asList()
        val gap = (if (plan.stacked) lineSpacing else spacing).roundToPx()
        val gaps = gap * (placeables.size - 1)
        val wanted = if (plan.stacked) placeables.maxOf { it.width } else placeables.sumOf { it.width } + gaps
        val fills = constraints.hasBoundedWidth && grows.any { it != null }
        val width = constraints.constrainWidth(if (fills) constraints.maxWidth else wanted)
        val height =
            constraints.constrainHeight(
                if (plan.stacked) placeables.sumOf { it.height } + gaps else placeables.maxOf { it.height },
            )
        return layout(width, height) {
            var position = 0
            placeables.forEach { placeable ->
                if (plan.stacked) {
                    placeable.placeRelative(0, position)
                    position += placeable.height + gap
                } else {
                    placeable.placeRelative(position, alignment.align(placeable.height, height))
                    position += placeable.width + gap
                }
            }
        }
    }

    override fun IntrinsicMeasureScope.maxIntrinsicWidth(
        measurables: List<IntrinsicMeasurable>,
        height: Int,
    ): Int {
        if (measurables.isEmpty()) return 0
        val content = measurables.sumOf { wantedWidth(it, it.parentData as? GrowElement) }
        return content + spacing.roundToPx() * (measurables.size - 1)
    }

    override fun IntrinsicMeasureScope.minIntrinsicWidth(
        measurables: List<IntrinsicMeasurable>,
        height: Int,
    ): Int = measurables.maxOfOrNull { it.minIntrinsicWidth(height) } ?: 0

    override fun IntrinsicMeasureScope.minIntrinsicHeight(
        measurables: List<IntrinsicMeasurable>,
        width: Int,
    ): Int = intrinsicHeight(measurables, width)

    override fun IntrinsicMeasureScope.maxIntrinsicHeight(
        measurables: List<IntrinsicMeasurable>,
        width: Int,
    ): Int = intrinsicHeight(measurables, width)

    private fun IntrinsicMeasureScope.intrinsicHeight(
        measurables: List<IntrinsicMeasurable>,
        width: Int,
    ): Int {
        if (measurables.isEmpty()) return 0
        val grows = measurables.map { it.parentData as? GrowElement }
        val natural = IntArray(measurables.size) { wantedWidth(measurables[it], grows[it]) }
        val plan = plan(natural, grows, width, spacing.roundToPx())
        val heights = measurables.mapIndexed { index, child -> child.maxIntrinsicHeight(plan.widths[index]) }
        return if (plan.stacked) heights.sum() + lineSpacing.roundToPx() * (heights.size - 1) else heights.max()
    }

    private fun Density.wantedWidth(
        child: IntrinsicMeasurable,
        grow: GrowElement?,
    ): Int =
        if (grow != null && grow.basis != Dp.Unspecified) {
            (grow.basis.toPx() * max(1f, fontScale)).roundToInt()
        } else {
            child.maxIntrinsicWidth(Constraints.Infinity)
        }
}

private class RowPlan(
    val stacked: Boolean,
    val widths: IntArray,
)

private fun plan(
    natural: IntArray,
    grows: List<GrowElement?>,
    room: Int,
    gap: Int,
): RowPlan {
    if (room == Constraints.Infinity) return RowPlan(stacked = false, widths = natural)
    val space = room - gap * (natural.size - 1)
    if (natural.sum() > space) {
        val lines = IntArray(natural.size) { if (grows[it] != null) room else minOf(natural[it], room) }
        return RowPlan(stacked = true, widths = lines)
    }
    val weights = FloatArray(natural.size) { grows[it]?.weight ?: 0f }
    val total = weights.sum()
    if (total <= 0f) return RowPlan(stacked = false, widths = natural)
    // When every child grows and fits its share, the shares are exact: equal, or 1 to 1.4.
    val shares = IntArray(natural.size) { (space * (weights[it] / total)).toInt() }
    val exact = natural.indices.all { weights[it] > 0f && natural[it] <= shares[it] }
    val extra = space - natural.sum()
    val widths =
        if (exact) shares else IntArray(natural.size) { natural[it] + (extra * (weights[it] / total)).toInt() }
    return RowPlan(stacked = false, widths = widths)
}
