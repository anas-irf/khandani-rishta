package com.khandanirishta.app.ui.theme

import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.LocalRippleThemeConfiguration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.RippleConfiguration
import androidx.compose.material3.RippleThemeConfiguration
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/*
 * Mehfil Heritage on Material 3 (DESIGN.md, specs/22 section 12). Screens use only the roles of
 * `MaterialTheme`, `KrTheme.colors`, `KrType`, `Spacing`, `Sizes`, `Strokes` and `Elevation`.
 */

/** The 3 dp ring of keyboard and D-pad focus, drawn by Material's own indication. */
private val FocusRing =
    RippleThemeConfiguration(
        RippleThemeConfiguration.Focus.InsetRing(
            outerStrokeInset = 0.dp,
            outerStrokeWidth = Strokes.focus,
            innerStrokeInset = Strokes.focus,
            innerStrokeWidth = Strokes.hairline,
        ),
    )

private val DefaultColors = ExtendedColors()

private val PageRing = RippleConfiguration(focus = focusColors(ring = Brand.Primary, gap = Brand.Background))
private val InvertedRing = RippleConfiguration(focus = focusColors(ring = Brand.OnPrimary, gap = Brand.Primary))

private fun focusColors(
    ring: Color,
    gap: Color,
) = RippleConfiguration.Focus.InsetRing(outerStrokeColor = ring, innerStrokeColor = gap)

@Composable
fun KhandaniTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = LightColors, typography = AppTypography, shapes = AppShapes) {
        CompositionLocalProvider(
            LocalExtendedColors provides DefaultColors,
            LocalRippleThemeConfiguration provides FocusRing,
            LocalRippleConfiguration provides PageRing,
        ) {
            // 17 / 26 is the default text of the interface; Material's own default is body large.
            ProvideTextStyle(AppTypography.bodyMedium, content)
        }
    }
}

/** On a primary or inverse fill the focus ring inverts, so it stays visible (DESIGN.md section 4.2). */
@Composable
fun InvertedFocusRing(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalRippleConfiguration provides InvertedRing, content = content)
}

/** Shortcuts to the theme's extra colours. */
object KrTheme {
    val colors: ExtendedColors
        @Composable
        @ReadOnlyComposable
        get() = LocalExtendedColors.current

    /** The fill that stands out on the band this is drawn on. */
    val tonal: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalTonalColor.current
}
