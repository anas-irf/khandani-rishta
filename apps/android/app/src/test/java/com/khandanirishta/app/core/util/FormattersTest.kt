package com.khandanirishta.app.core.util

import com.khandanirishta.app.ui.components.Phone
import com.khandanirishta.app.ui.text.fill
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class FormattersTest {
    @Test
    fun `feet and inches convert both ways (07 section 4_3)`() {
        assertEquals(168, Formatters.feetInchesToCm(5, 6))
        assertEquals(122, Formatters.feetInchesToCm(4, 0))
        assertEquals(213, Formatters.feetInchesToCm(7, 0))
        assertEquals(5 to 6, Formatters.cmToFeetInches(168))
        assertEquals(6 to 0, Formatters.cmToFeetInches(183))
    }

    @Test
    fun `age counts whole years in Pakistan time`() {
        // 19:30 UTC on 19 Nov is already 20 Nov in Pakistan (UTC+5): the birthday has come.
        val now = Instant.parse("2026-11-19T19:30:00Z")
        assertEquals(26, Formatters.ageFrom(LocalDate.of(2000, 11, 20), now))
        assertEquals(25, Formatters.ageFrom(LocalDate.of(2000, 11, 21), now))
    }

    @Test
    fun `badge counts cap at 99 plus`() {
        assertEquals("7", Formatters.badgeCount(7))
        assertEquals("99", Formatters.badgeCount(99))
        assertEquals("99+", Formatters.badgeCount(100))
    }

    @Test
    fun `days until never goes negative`() {
        val now = Instant.parse("2026-11-20T00:00:00Z")
        assertEquals(3, Formatters.daysUntil(Instant.parse("2026-11-23T00:00:00Z"), now))
        assertEquals(0, Formatters.daysUntil(Instant.parse("2026-11-19T00:00:00Z"), now))
    }

    @Test
    fun `named placeholders fill in any order`() {
        assertEquals("Ayesha K., 26", "{name}, {age}".fill("age" to 26, "name" to "Ayesha K."))
        assertEquals("{missing} stays", "{missing} stays".fill("other" to 1))
        assertEquals("50% match", "{value}% match".fill("value" to 50))
    }

    @Test
    fun `phone numbers become E 164 (08 section 3_3)`() {
        assertEquals("+923001234567", Phone.toE164("+92", "0300 1234567"))
        assertEquals("+923001234567", Phone.toE164("+92", "300-1234567"))
        assertNull(Phone.toE164("+92", "  "))
        assertEquals("+92" to "3001234567", Phone.split("+923001234567", listOf("+1", "+92", "+971")))
        assertEquals("+971" to "501234567", Phone.split("+971501234567", listOf("+1", "+92", "+97", "+971")))
    }
}
