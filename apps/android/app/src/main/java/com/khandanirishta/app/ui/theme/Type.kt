package com.khandanirishta.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.khandanirishta.app.R

/*
 * The type of DESIGN.md section 3. Both families are bundled in res/font (SIL Open Font License,
 * see assets/licenses): the APK ships outside the Play Store, so no downloadable fonts.
 */

/** Every word of the interface. */
val SourceSans =
    FontFamily(
        Font(R.font.source_sans_3_regular, FontWeight.Normal),
        Font(R.font.source_sans_3_semibold, FontWeight.SemiBold),
        Font(R.font.source_sans_3_bold, FontWeight.Bold),
    )

/** Display titles at 34 and up, the wordmark, monograms and decorative numerals. Nothing else. */
val InstrumentSerif =
    FontFamily(
        Font(R.font.instrument_serif_regular, FontWeight.Normal),
        Font(R.font.instrument_serif_italic, FontWeight.Normal, FontStyle.Italic),
    )

/** Tabular figures, for numbers that people compare. */
const val TABULAR_FIGURES = "tnum"

private fun style(
    family: FontFamily,
    weight: FontWeight,
    size: Int,
    line: Int,
    tracking: Float = 0f,
    lineBreak: LineBreak = LineBreak.Simple,
): TextStyle =
    TextStyle(
        fontFamily = family,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = line.sp,
        letterSpacing = tracking.em,
        lineBreak = lineBreak,
        platformStyle = PlatformTextStyle(includeFontPadding = false),
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    )

private fun display(
    size: Int,
    line: Int,
): TextStyle = style(InstrumentSerif, FontWeight.Normal, size, line, DISPLAY_TRACKING, LineBreak.Heading)

private fun heading(
    weight: FontWeight,
    size: Int,
    line: Int,
): TextStyle = style(SourceSans, weight, size, line, lineBreak = LineBreak.Heading)

internal val AppTypography =
    Typography(
        displayLarge = display(48, 52),
        displayMedium = display(40, 46),
        displaySmall = display(34, 40),
        headlineLarge = heading(FontWeight.Bold, 32, 38),
        headlineMedium = heading(FontWeight.Bold, 28, 34),
        headlineSmall = heading(FontWeight.Bold, 24, 30),
        titleLarge = heading(FontWeight.Bold, 22, 28),
        titleMedium = style(SourceSans, FontWeight.SemiBold, 19, 26),
        titleSmall = style(SourceSans, FontWeight.SemiBold, 17, 24),
        bodyLarge = style(SourceSans, FontWeight.Normal, 18, 30, lineBreak = LineBreak.Paragraph),
        bodyMedium = style(SourceSans, FontWeight.Normal, 17, 26),
        bodySmall = style(SourceSans, FontWeight.Normal, 16, 24),
        labelLarge = style(SourceSans, FontWeight.SemiBold, 17, 22),
        labelMedium = style(SourceSans, FontWeight.SemiBold, 16, 20),
        labelSmall = style(SourceSans, FontWeight.SemiBold, 15, 20),
    )

/**
 * Roles Material 3 has no slot for. Screens pick a role from here or from
 * `MaterialTheme.typography`, and never set a size of their own.
 */
object KrType {
    /** Timestamps, helper text and limits. The smallest text that carries meaning. */
    val caption = style(SourceSans, FontWeight.Normal, 15, 22)

    /** The legal line only. */
    val legal = style(SourceSans, FontWeight.Normal, 14, 20)

    val buttonLarge = style(SourceSans, FontWeight.Bold, 18, 24)

    /** 18 / 700: switch labels, nudge titles and the names on tiles. */
    val emphasis = style(SourceSans, FontWeight.Bold, 18, 24)

    /** Badges and tags. */
    val badge = style(SourceSans, FontWeight.Bold, 15, 20)

    /** Counts on badges, with tabular figures. */
    val count = style(SourceSans, FontWeight.Bold, 15, 20).copy(fontFeatureSettings = TABULAR_FIGURES)

    /** A name in a top bar and in a compact row. */
    val name = style(SourceSans, FontWeight.Bold, 19, 26)

    /** The number of the match pill. */
    val figure = style(SourceSans, FontWeight.Bold, 20, 24).copy(fontFeatureSettings = TABULAR_FIGURES)

    /** The number inside the match ring. */
    val figureLarge = style(SourceSans, FontWeight.Bold, 42, 46).copy(fontFeatureSettings = TABULAR_FIGURES)

    /** The number inside the completeness ring. */
    val figureMedium = style(SourceSans, FontWeight.Bold, 26, 30).copy(fontFeatureSettings = TABULAR_FIGURES)

    val wordmark = style(InstrumentSerif, FontWeight.Normal, 24, 28)
    val wordmarkLarge = style(InstrumentSerif, FontWeight.Normal, 30, 34)

    /** Initials drawn as a picture: the size comes from the arch that holds them. */
    val monogram = TextStyle(fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic)

    val numbers = TextStyle(fontFeatureSettings = TABULAR_FIGURES)
}

private const val DISPLAY_TRACKING = -0.01f
