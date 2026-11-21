package com.khandanirishta.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * Brand tokens of specs/17 section 9.3, shared with the web app: deep teal for actions, a warm
 * gold-brown accent for matches and highlights, a warm off-white page. Light theme only at
 * launch, and no dynamic colour, so the brand looks the same on every phone (specs/22 section 12).
 */

object Brand {
    val Primary = Color(0xFF0F766E)
    val PrimaryDark = Color(0xFF0B5A54)
    val PrimaryDeep = Color(0xFF073F3B)
    val PrimaryContainer = Color(0xFFCFF1EB)
    val OnPrimaryContainer = Color(0xFF053F3A)
    val Accent = Color(0xFFB45309)
    val AccentLight = Color(0xFFD97706)
    val AccentContainer = Color(0xFFFDEBD3)
    val OnAccentContainer = Color(0xFF5C2A04)
    val Success = Color(0xFF15803D)
    val SuccessContainer = Color(0xFFDCFCE7)
    val Warning = Color(0xFFB45309)
    val WarningContainer = Color(0xFFFEF3C7)
    val Danger = Color(0xFFB91C1C)
    val DangerContainer = Color(0xFFFDE2E2)
    val Background = Color(0xFFFAFAF9)
    val Surface = Color(0xFFFFFFFF)
    val Text = Color(0xFF1C1917)
    val MutedText = Color(0xFF57534E)
    val Border = Color(0xFFE7E5E4)
    val Outline = Color(0xFFA8A29E)
    val Online = Color(0xFF22C55E)
}

private val LightColors =
    lightColorScheme(
        primary = Brand.Primary,
        onPrimary = Color.White,
        primaryContainer = Brand.PrimaryContainer,
        onPrimaryContainer = Brand.OnPrimaryContainer,
        inversePrimary = Color(0xFF5EEAD4),
        secondary = Color(0xFF44615C),
        onSecondary = Color.White,
        secondaryContainer = Color(0xFFDCEBE8),
        onSecondaryContainer = Color(0xFF1F3A36),
        tertiary = Brand.Accent,
        onTertiary = Color.White,
        tertiaryContainer = Brand.AccentContainer,
        onTertiaryContainer = Brand.OnAccentContainer,
        error = Brand.Danger,
        onError = Color.White,
        errorContainer = Brand.DangerContainer,
        onErrorContainer = Color(0xFF7F1D1D),
        background = Brand.Background,
        onBackground = Brand.Text,
        surface = Brand.Background,
        onSurface = Brand.Text,
        surfaceVariant = Color(0xFFF0EEEC),
        onSurfaceVariant = Brand.MutedText,
        surfaceTint = Color.Transparent,
        inverseSurface = Color(0xFF292524),
        inverseOnSurface = Color(0xFFF5F5F4),
        outline = Brand.Outline,
        outlineVariant = Brand.Border,
        scrim = Color.Black,
        surfaceBright = Color.White,
        surfaceDim = Color(0xFFE7E5E4),
        surfaceContainerLowest = Color.White,
        surfaceContainerLow = Color(0xFFF7F6F4),
        surfaceContainer = Color(0xFFF3F2F0),
        surfaceContainerHigh = Color(0xFFEEEDEB),
        surfaceContainerHighest = Color(0xFFE8E6E3),
    )

/** Colours that Material 3 has no slot for. */
@Immutable
data class ExtendedColors(
    val success: Color = Brand.Success,
    val successContainer: Color = Brand.SuccessContainer,
    val warning: Color = Brand.Warning,
    val warningContainer: Color = Brand.WarningContainer,
    val online: Color = Brand.Online,
    val card: Color = Brand.Surface,
    /** Skeleton fill (surfaceContainerHigh) and the highlight that sweeps across it. */
    val skeleton: Color = Color(0xFFEEEDEB),
    val skeletonHighlight: Color = Color.White,
    /** The hero gradient behind greetings and headers. */
    val heroGradient: Brush =
        Brush.linearGradient(listOf(Brand.PrimaryDeep, Brand.Primary, Color(0xFF14A08F))),
    /** The match badge gradient. */
    val compatGradient: Brush = Brush.horizontalGradient(listOf(Brand.Accent, Brand.AccentLight)),
    /** Darkening at the bottom of photo cards, so white text stays readable. */
    val photoScrim: Brush =
        Brush.verticalGradient(
            0f to Color.Transparent,
            0.45f to Color.Transparent,
            1f to Color(0xD9000000),
        ),
)

val LocalExtendedColors = staticCompositionLocalOf { ExtendedColors() }

private val baseTypography = Typography()

/** The Material 3 type scale with body text at 16 sp and firmer headings (specs/22 section 12). */
private val AppTypography =
    Typography(
        displaySmall = baseTypography.displaySmall.copy(fontWeight = FontWeight.SemiBold),
        headlineLarge = baseTypography.headlineLarge.copy(fontWeight = FontWeight.SemiBold),
        headlineMedium = baseTypography.headlineMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 26.sp),
        headlineSmall = baseTypography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 22.sp),
        titleLarge = baseTypography.titleLarge.copy(fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
        titleMedium = baseTypography.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 17.sp),
        titleSmall = baseTypography.titleSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
        bodyLarge = baseTypography.bodyLarge.copy(fontSize = 16.sp, lineHeight = 24.sp),
        bodyMedium = baseTypography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 22.sp),
        bodySmall = baseTypography.bodySmall.copy(fontSize = 14.sp, lineHeight = 20.sp),
        labelLarge = baseTypography.labelLarge.copy(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
        labelMedium = baseTypography.labelMedium.copy(fontWeight = FontWeight.Medium, fontSize = 13.sp),
        labelSmall = baseTypography.labelSmall.copy(fontWeight = FontWeight.Medium, fontSize = 12.sp),
    )

/** 8 dp inputs, 12 dp cards (specs/22 section 12). */
private val AppShapes =
    Shapes(
        extraSmall = RoundedCornerShape(6.dp),
        small = RoundedCornerShape(8.dp),
        medium = RoundedCornerShape(12.dp),
        large = RoundedCornerShape(18.dp),
        extraLarge = RoundedCornerShape(28.dp),
    )

@Composable
fun KhandaniTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalExtendedColors provides ExtendedColors()) {
        MaterialTheme(
            colorScheme = LightColors,
            typography = AppTypography,
            shapes = AppShapes,
            content = content,
        )
    }
}

/** Shortcuts to the theme's extra colours. */
object KrTheme {
    val colors: ExtendedColors
        @Composable get() = LocalExtendedColors.current
}

/** Small caps-free overline style for section labels. */
val SectionLabelStyle: TextStyle
    @Composable get() =
        MaterialTheme.typography.labelLarge.copy(
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            letterSpacing = 0.2.sp,
        )
