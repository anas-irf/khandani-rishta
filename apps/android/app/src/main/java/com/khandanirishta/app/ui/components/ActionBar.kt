package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.ui.theme.Elevation
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.SheetShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/**
 * How tall the action bars on screen are, so the root's toasts sit above them instead of over the
 * main button or the composer. During a transition two screens may each have one: the taller counts.
 */
@Stable
class ActionBarRoom {
    private val bars = mutableStateMapOf<Any, Int>()

    /** In pixels, 0 when no action bar shows. */
    val height: Int get() = bars.values.maxOrNull() ?: 0

    internal fun report(
        owner: Any,
        height: Int,
    ) {
        bars[owner] = height
    }

    internal fun remove(owner: Any) {
        bars.remove(owner)
    }
}

/** The app's [ActionBarRoom]; `null` where no toast host needs it (previews, tests). */
val LocalActionBarRoom = staticCompositionLocalOf<ActionBarRoom?> { null }

/**
 * The bar at the bottom of a screen (DESIGN.md section 6.14): surface, the sheet radius, a
 * hairline along its top and the bar shadow, above the navigation bar and the keyboard. It holds
 * one primary and at most a line under it; secondary actions go to the top bar.
 *
 * [banner] sits on top of the buttons as one unit (the interest banner of section 6.12). When it
 * is long it scrolls inside, so the buttons stay on the screen.
 */
@Composable
fun KrActionBar(
    modifier: Modifier = Modifier,
    maxWidth: Dp = Sizes.columnWidth,
    spacing: Dp = Spacing.s8,
    banner: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val hairline = colors.outlineVariant
    val insets = WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)
    val barLimit = LocalWindowInfo.current.containerDpSize.height * BAR_SHARE
    val room = LocalActionBarRoom.current
    val owner = remember { Any() }
    DisposableEffect(room, owner) { onDispose { room?.remove(owner) } }
    Surface(
        color = KrTheme.colors.card,
        contentColor = colors.onSurface,
        shape = SheetShape,
        shadowElevation = Elevation.bar,
        modifier = modifier.fillMaxWidth().onSizeChanged { room?.report(owner, it.height) },
    ) {
        CompositionLocalProvider(LocalTonalColor provides colors.surfaceContainer) {
            Column(
                modifier =
                    Modifier
                        .drawWithCache {
                            val outline = SheetShape.createOutline(size, layoutDirection, this)
                            val stroke = Stroke(Strokes.hairline.toPx() * 2)
                            val top = BarRadius.toPx()
                            onDrawWithContent {
                                drawContent()
                                clipRect(bottom = top) { drawOutline(outline, hairline, style = stroke) }
                            }
                        }.windowInsetsPadding(insets)
                        .then(if (banner != null) Modifier.heightIn(max = barLimit) else Modifier)
                        .contentWidth(maxWidth)
                        .padding(start = Spacing.s16, top = BarTop, end = Spacing.s16, bottom = Spacing.s12),
                verticalArrangement = Arrangement.spacedBy(spacing),
            ) {
                if (banner != null) {
                    Box(
                        Modifier
                            .weight(1f, fill = false)
                            .verticalScroll(rememberScrollState())
                            .padding(bottom = Spacing.s4),
                    ) { banner() }
                }
                content()
            }
        }
    }
}

/**
 * Two answers, 56 tall: the quieter one, then the main one 1.4 times as wide. At large text each
 * takes a line of its own (DESIGN.md section 6.12).
 */
@Composable
fun AnswerRow(
    secondary: @Composable (Modifier) -> Unit,
    primary: @Composable (Modifier) -> Unit,
    modifier: Modifier = Modifier,
) {
    AdaptiveRow(modifier.fillMaxWidth()) {
        secondary(Modifier.grow())
        primary(Modifier.grow(MAIN_ANSWER))
    }
}

private const val MAIN_ANSWER = 1.4f
private const val BAR_SHARE = 0.6f
private val BarTop = 14.dp
private val BarRadius = 24.dp
