package com.khandanirishta.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/*
 * The Mehfil Heritage colours (DESIGN.md section 2). This is the only file that writes a colour.
 * Screens read the roles of `MaterialTheme.colorScheme` and `KrTheme.colors`; the resources in
 * res/values/colors.xml repeat the few values the system draws without Compose.
 */

object Brand {
    val Primary = Color(0xFF6E1D34)
    val PrimaryPressed = Color(0xFF561528)
    val PrimarySoft = Color(0xFFF3E4E6)
    val OnPrimary = Color(0xFFFAF6F0)
    val Gold = Color(0xFF9C7430)
    val GoldSoft = Color(0xFFF6ECD9)
    val GoldOrnament = Color(0xFFB68B40)
    val GoldOnInverse = Color(0xFFC9A25E)
    val OnGoldSoft = Color(0xFF5C4211)
    val Sage = Color(0xFF2D6350)
    val SageSoft = Color(0xFFE3EDE6)
    val Warning = Color(0xFF8A5300)
    val WarningSoft = Color(0xFFFDF1DC)
    val Danger = Color(0xFFA4262C)
    val DangerPressed = Color(0xFF861C22)
    val DangerSoft = Color(0xFFFBE9E7)
    val OnDangerSoft = Color(0xFF6E1418)
    val Background = Color(0xFFFAF6F0)
    val Surface = Color(0xFFFFFCF7)
    val SurfaceLow = Color(0xFFF7F1E9)
    val Sand = Color(0xFFF2EAE0)
    val SandStrong = Color(0xFFEADFD2)
    val Ink = Color(0xFF23191D)
    val InkSecondary = Color(0xFF3D3034)
    val InkMuted = Color(0xFF5A4B4F)
    val Border = Color(0xFFE3D7C6)
    val Outline = Color(0xFF8F7E77)
    val InverseMuted = Color(0xFFCDBFB8)
    val White = Color.White
    val Black = Color.Black
}

/**
 * Light only, without dynamic colour (specs/22 section 12). Every role is set, the "fixed" ones
 * too, so no component falls back to Material's baseline purple.
 */
internal val LightColors: ColorScheme =
    lightColorScheme(
        primary = Brand.Primary,
        onPrimary = Brand.OnPrimary,
        primaryContainer = Brand.PrimarySoft,
        onPrimaryContainer = Brand.Primary,
        inversePrimary = Brand.GoldOnInverse,
        secondary = Brand.InkSecondary,
        onSecondary = Brand.Background,
        // The navigation indicator and tonal controls read secondaryContainer: the primary soft pill.
        secondaryContainer = Brand.PrimarySoft,
        onSecondaryContainer = Brand.Primary,
        tertiary = Brand.Gold,
        onTertiary = Brand.White,
        tertiaryContainer = Brand.GoldSoft,
        onTertiaryContainer = Brand.OnGoldSoft,
        error = Brand.Danger,
        onError = Brand.White,
        errorContainer = Brand.DangerSoft,
        onErrorContainer = Brand.OnDangerSoft,
        background = Brand.Background,
        onBackground = Brand.Ink,
        surface = Brand.Background,
        onSurface = Brand.Ink,
        surfaceVariant = Brand.Sand,
        onSurfaceVariant = Brand.InkMuted,
        surfaceTint = Color.Transparent,
        inverseSurface = Brand.Ink,
        inverseOnSurface = Brand.Sand,
        outline = Brand.Outline,
        outlineVariant = Brand.Border,
        scrim = Brand.Black,
        surfaceBright = Brand.Surface,
        surfaceDim = Brand.SandStrong,
        surfaceContainerLowest = Brand.Surface,
        surfaceContainerLow = Brand.SurfaceLow,
        surfaceContainer = Brand.Sand,
        surfaceContainerHigh = Brand.SandStrong,
        surfaceContainerHighest = Brand.Border,
        primaryFixed = Brand.PrimarySoft,
        primaryFixedDim = Brand.PrimarySoft,
        onPrimaryFixed = Brand.PrimaryPressed,
        onPrimaryFixedVariant = Brand.Primary,
        secondaryFixed = Brand.Sand,
        secondaryFixedDim = Brand.SandStrong,
        onSecondaryFixed = Brand.Ink,
        onSecondaryFixedVariant = Brand.InkSecondary,
        tertiaryFixed = Brand.GoldSoft,
        tertiaryFixedDim = Brand.GoldSoft,
        onTertiaryFixed = Brand.OnGoldSoft,
        onTertiaryFixedVariant = Brand.OnGoldSoft,
    )

/** Colours that Material 3 has no slot for (DESIGN.md sections 2.1 and 2.5). */
@Immutable
data class ExtendedColors(
    /** Body copy under headings and the meta line of a card. */
    val textSecondary: Color = Brand.InkSecondary,
    val primaryPressed: Color = Brand.PrimaryPressed,
    val dangerPressed: Color = Brand.DangerPressed,
    val success: Color = Brand.Sage,
    val onSuccess: Color = Brand.White,
    val successContainer: Color = Brand.SageSoft,
    val onSuccessContainer: Color = Brand.Sage,
    val successRule: Color = Brand.Sage.copy(alpha = 0.3f),
    val match: Color = Brand.Sage,
    val online: Color = Brand.Sage,
    val warning: Color = Brand.Warning,
    val warningContainer: Color = Brand.WarningSoft,
    /** Sheets, menus, text fields and the action bar. */
    val card: Color = Brand.Surface,
    val band: Color = Brand.Sand,
    /** Hairline rules, diamonds and arch outlines. Never text, never the only signal. */
    val ornament: Color = Brand.GoldOrnament,
    val inverseMuted: Color = Brand.InverseMuted,
    val disabledContainer: Color = Brand.SandStrong,
    val onDisabledContainer: Color = Brand.InkSecondary,
    val focusRing: Color = Brand.Primary,
    /** Over a photo the server sent blurred. */
    val photoVeil: Color = Color(0x8CF2EAE0),
    val photoCountChip: Color = Color(0xD123191D),
    /** The dots of the photo that is not there. */
    val lattice: Color = Color(0x3DB68B40),
    val silhouette: Color = Brand.Outline.copy(alpha = 0.6f),
    /** Around the frame of the verification camera. */
    val cameraMask: Color = Brand.Ink.copy(alpha = 0.6f),
    val skeleton: Color = Brand.SandStrong,
    val skeletonHighlight: Color = Brand.Surface,
)

val LocalExtendedColors = staticCompositionLocalOf { ExtendedColors() }

/**
 * The fill that stands out on the band behind it (DESIGN.md section 6.10): sand on the page, the
 * page on sand. Bands and tonal panels swap it, so a chip or a row never vanishes into its band.
 */
val LocalTonalColor = compositionLocalOf { Brand.Sand }
