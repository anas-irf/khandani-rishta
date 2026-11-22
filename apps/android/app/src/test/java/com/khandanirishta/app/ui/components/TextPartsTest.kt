package com.khandanirishta.app.ui.components

import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

/** The text rules of DESIGN.md sections 6.5, 6.8, 6.9 and 6.12. */
class TextPartsTest {
    @Test
    fun `a line at 200 percent is as high as Compose draws it`() {
        val count = TextStyle(fontSize = 15.sp, lineHeight = 20.sp)
        assertEquals(20f, Density(density = 2f, fontScale = 1f).lineHeightOf(count).value, 0.01f)
        val large = Density(density = 2f, fontScale = 2f)
        val drawn = with(large) { 15.sp.toDp().value } * 20f / 15f
        assertEquals(drawn, large.lineHeightOf(count).value, 0.01f)
    }

    @Test
    fun `a field at its limit never loses its last words to an edit before them`() {
        assertEquals("abcde", withinLimit("abcd", "abcde", 5))
        assertEquals("abcde", withinLimit("abc", "abcdefg", 5))
        assertEquals("abcde", withinLimit("", "abcdefg", 5))
        assertEquals("abcde", withinLimit("abcde", "abXcde", 5))
        assertEquals("vwxyz", withinLimit("abc", "vwxyz12", 5))
    }

    @Test
    fun `a monogram is the first letters of the first and last words`() {
        assertEquals("MS", initialsOf("Muhammad Abdul Rehman S."))
        assertEquals("AK", initialsOf("ayesha k."))
        assertEquals("A", initialsOf("Ayesha"))
        assertEquals("AK", initialsOf("  Ayesha   K.  "))
    }

    @Test
    fun `a monogram of nothing is empty`() {
        assertEquals("", initialsOf(null))
        assertEquals("", initialsOf(""))
        assertEquals("", initialsOf(" . "))
    }

    @Test
    fun `a monogram works in Urdu script`() {
        assertEquals("\u0639\u062E", initialsOf("\u0639\u0627\u0626\u0634\u06C1 \u062E\u0627\u0646"))
    }

    @Test
    fun `the age never starts a line of its own`() {
        assertEquals("Ayesha K.,\u00A026", holdAgeToName("Ayesha K., 26"))
        assertEquals("Muhammad Abdul Rehman S.,\u00A032", holdAgeToName("Muhammad Abdul Rehman S., 32"))
    }

    @Test
    fun `only the percentage of a sentence is set in the number style`() {
        val number = SpanStyle(fontWeight = FontWeight.Bold)
        val text = withPercent("You fit 92% of what Ayesha is looking for", number)
        val span = text.spanStyles.single()
        assertEquals("92%", text.text.substring(span.start, span.end))
        assertEquals(number, span.item)
    }

    @Test
    fun `a sentence without a percentage has no span`() {
        assertTrue(withPercent("No match yet", SpanStyle()).spanStyles.isEmpty())
    }

    @Test
    fun `an interest takes the attention colours in its last 3 days`() {
        val now = Instant.parse("2026-11-22T10:00:00Z")
        assertTrue(expiresSoon(now.plus(Duration.ofDays(3)), now))
        assertTrue(expiresSoon(now.plus(Duration.ofHours(2)), now))
        assertFalse(expiresSoon(now.plus(Duration.ofDays(3)).plusSeconds(1), now))
    }
}
