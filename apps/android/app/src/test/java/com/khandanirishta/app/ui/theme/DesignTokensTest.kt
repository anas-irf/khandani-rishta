package com.khandanirishta.app.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Locale

/** DESIGN.md sections 1, 2 and 3 as checks: contrast, the type floor, and colours from the theme only. */
class DesignTokensTest {
    private val scheme = LightColors
    private val extra = ExtendedColors()

    private fun assertContrast(
        name: String,
        foreground: Color,
        background: Color,
        minimum: Double = TEXT,
    ) {
        val front = foreground.compositeOver(background).luminance().toDouble()
        val back = background.luminance().toDouble()
        val ratio = (maxOf(front, back) + 0.05) / (minOf(front, back) + 0.05)
        assertTrue("$name is $ratio to 1, under $minimum", ratio >= minimum)
    }

    @Test
    fun `body text keeps 7 to 1 on the page and on sand`() {
        assertContrast("text on page", scheme.onBackground, scheme.background, BODY)
        assertContrast("text on sand", scheme.onSurface, scheme.surfaceContainer, BODY)
        assertContrast("secondary text on page", extra.textSecondary, scheme.background, BODY)
        assertContrast("secondary text on sand", extra.textSecondary, scheme.surfaceContainer, BODY)
    }

    @Test
    fun `every text pairing keeps at least 4,5 to 1`() {
        assertContrast("muted on page", scheme.onSurfaceVariant, scheme.background)
        assertContrast("muted on sand", scheme.onSurfaceVariant, scheme.surfaceContainer)
        assertContrast("primary button", scheme.onPrimary, scheme.primary)
        assertContrast("pressed primary button", scheme.onPrimary, extra.primaryPressed)
        assertContrast("primary on page", scheme.primary, scheme.background)
        assertContrast("primary pill", scheme.onPrimaryContainer, scheme.primaryContainer)
        assertContrast("navigation pill", scheme.onSecondaryContainer, scheme.secondaryContainer)
        assertContrast("gold soft", scheme.onTertiaryContainer, scheme.tertiaryContainer)
        assertContrast("danger button", scheme.onError, scheme.error)
        assertContrast("danger banner", scheme.onErrorContainer, scheme.errorContainer)
        assertContrast("match pill", extra.onSuccess, extra.match)
        assertContrast("success pill", extra.onSuccessContainer, extra.successContainer)
        assertContrast("attention", extra.warning, extra.warningContainer)
        assertContrast("disabled button", extra.onDisabledContainer, extra.disabledContainer)
        assertContrast("toast", scheme.inverseOnSurface, scheme.inverseSurface)
        assertContrast("toast action", scheme.inversePrimary, scheme.inverseSurface)
        // The lightest photo under the count chip is white.
        assertContrast("photo count chip", scheme.background, extra.photoCountChip.compositeOver(Color.White))
    }

    @Test
    fun `control borders and indicators keep 3 to 1`() {
        assertContrast("control on page", scheme.outline, scheme.background, GRAPHIC)
        assertContrast("control on sand", scheme.outline, scheme.surfaceContainer, GRAPHIC)
        assertContrast("focus ring", extra.focusRing, scheme.background, GRAPHIC)
    }

    @Test
    fun `the window, splash and launcher colours are the theme's`() {
        val xml = File("src/main/res/values/colors.xml").readText()
        assertResource(xml, "brand_background", scheme.background)
        assertResource(xml, "brand_primary", scheme.primary)
        assertResource(xml, "brand_ornament", extra.ornament)
    }

    private fun assertResource(
        xml: String,
        name: String,
        expected: Color,
    ) {
        val actual = Regex("<color name=\"$name\">#([0-9A-Fa-f]{6})</color>").find(xml)?.groupValues?.get(1)
        val hex = String.format(Locale.ROOT, "%06X", expected.toArgb() and RGB)
        assertEquals(name, hex, actual?.uppercase(Locale.ROOT))
    }

    @Test
    fun `nothing that carries meaning is set under 15`() {
        val styles: Map<String, TextStyle> =
            with(AppTypography) {
                mapOf(
                    "headlineSmall" to headlineSmall,
                    "titleSmall" to titleSmall,
                    "bodyLarge" to bodyLarge,
                    "bodyMedium" to bodyMedium,
                    "bodySmall" to bodySmall,
                    "labelLarge" to labelLarge,
                    "labelMedium" to labelMedium,
                    "labelSmall" to labelSmall,
                    "caption" to KrType.caption,
                    "badge" to KrType.badge,
                    "count" to KrType.count,
                )
            }
        styles.forEach { (name, style) -> assertTrue(name, style.fontSize.value >= SMALLEST) }
        assertEquals(LEGAL, KrType.legal.fontSize.value)
        assertTrue(AppTypography.displaySmall.fontSize.value >= DISPLAY_SMALLEST)
    }

    @Test
    fun `screens and components take colour, type and direction from the theme`() {
        val banned =
            mapOf(
                "a colour written outside the theme" to Regex("""\bColor\(0x|\bColor\.(White|Black|Red|Gray)\b"""),
                "a gradient" to Regex("""\bBrush\.|Gradient\("""),
                "a blur on the device" to Regex("""\.blur\(|RenderEffect"""),
                "a drop shadow" to Regex("""\.shadow\(|\bdropShadow\("""),
                "text faded with alpha" to Regex("""onSurface\w*\.copy\(alpha"""),
                "a font size of its own" to Regex("""fontSize\s*=\s*\d+(\.\d+)?\.sp"""),
                "left or right" to
                    Regex("""absolutePadding|absoluteOffset|TextAlign\.(Left|Right)\b|Absolute\.(Left|Right)\b"""),
            )
        val root = File("src/main/java/com/khandanirishta/app/ui")
        assertTrue("run from the app module", root.isDirectory)
        val found =
            root
                .walkTopDown()
                .filter { it.extension == "kt" && it.parentFile?.name != "theme" }
                .flatMap { file ->
                    file.readLines().asSequence().withIndex().flatMap { (number, line) ->
                        banned.asSequence().filter { it.value.containsMatchIn(line) }.map { (what, _) ->
                            "${file.invariantSeparatorsPath}:${number + 1} has $what"
                        }
                    }
                }.toList()
        assertEquals(emptyList<String>(), found)
    }

    private companion object {
        const val BODY = 7.0
        const val TEXT = 4.5
        const val GRAPHIC = 3.0
        const val SMALLEST = 15f
        const val LEGAL = 14f
        const val DISPLAY_SMALLEST = 34f
        const val RGB = 0xFFFFFF
    }
}
