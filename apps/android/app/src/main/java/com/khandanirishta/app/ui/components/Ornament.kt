package com.khandanirishta.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/*
 * The ornaments of Mehfil Heritage (DESIGN.md sections 1, 2.1 and 4.2): diamonds, gold hairlines,
 * the lattice and dashed arches. All are decoration and none carries meaning on its own.
 */

/** The gold diamond. */
@Composable
fun Diamond(
    modifier: Modifier = Modifier,
    size: Dp = Sizes.diamond,
    color: Color = KrTheme.colors.ornament,
) {
    Box(
        modifier
            .size(size)
            .drawBehind { rotate(DIAMOND_TURN) { drawRect(color) } },
    )
}

/** A short gold hairline with its diamond: at the start of a heading, or centred on both sides. */
@Composable
fun OrnamentRule(
    modifier: Modifier = Modifier,
    centered: Boolean = false,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (centered) Hairline()
        Diamond(size = RuleDiamond)
        Hairline()
    }
}

@Composable
private fun Hairline() {
    Box(
        Modifier
            .width(RuleLength)
            .height(Strokes.hairline)
            .background(KrTheme.colors.ornament),
    )
}

/** A mark that stays on the first line of the text beside it, however far that text wraps. */
@Composable
fun FirstLineMark(
    style: TextStyle,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val lineHeight = LocalDensity.current.lineHeightOf(style)
    Box(modifier.height(lineHeight), contentAlignment = Alignment.Center) { content() }
}

/**
 * An icon and the words that always go with it (DESIGN.md section 1, Meaning): the icon stays on
 * the first line and the words wrap beside it.
 */
@Composable
fun IconText(
    icon: ImageVector,
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = Color.Unspecified,
    tint: Color = color,
    iconSize: Dp = Sizes.iconSmall,
    gap: Dp = Spacing.s8,
    textAlign: TextAlign = TextAlign.Start,
) {
    IconTextLine(icon, modifier, style, tint, iconSize, gap) {
        Text(text, style = style, color = color, textAlign = textAlign, modifier = Modifier.weight(1f, fill = false))
    }
}

/** [IconText] with content of its own beside the icon. */
@Composable
fun IconTextLine(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    tint: Color = Color.Unspecified,
    iconSize: Dp = Sizes.iconSmall,
    gap: Dp = Spacing.s8,
    content: @Composable RowScope.() -> Unit,
) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(gap)) {
        FirstLineMark(style) {
            if (tint == Color.Unspecified) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(iconSize))
            } else {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
            }
        }
        content()
    }
}

/** Gold dots on an 18 dp grid over [fill]: the photo that is not there. */
fun Modifier.lattice(
    fill: Color,
    dots: Color,
): Modifier =
    drawWithCache {
        val step = LatticeStep.toPx()
        val area = size
        val points =
            buildList {
                var y = step / 2
                while (y < area.height) {
                    var x = step / 2
                    while (x < area.width) {
                        add(Offset(x, y))
                        x += step
                    }
                    y += step
                }
            }
        val dot = LatticeDot.toPx()
        onDrawBehind {
            drawRect(fill)
            drawPoints(points, PointMode.Points, dots, strokeWidth = dot, cap = StrokeCap.Round)
        }
    }

/** A dashed outline inside [shape]: empty and end-of-list arches, "Add a photo". */
fun Modifier.dashedBorder(
    shape: Shape,
    color: Color,
    width: Dp = Strokes.control,
): Modifier =
    drawWithCache {
        val line = width.toPx()
        val inset = line / 2
        val inner = Size((size.width - line).coerceAtLeast(0f), (size.height - line).coerceAtLeast(0f))
        val outline = shape.createOutline(inner, layoutDirection, this)
        val dash = DashLength.toPx()
        val stroke = Stroke(width = line, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash)))
        onDrawBehind {
            translate(inset, inset) { drawOutline(outline, color, style = stroke) }
        }
    }

private const val DIAMOND_TURN = 45f
private val RuleDiamond = 7.dp
private val RuleLength = 44.dp
private val LatticeStep = 18.dp
private val LatticeDot = 2.8.dp
private val DashLength = 6.dp
