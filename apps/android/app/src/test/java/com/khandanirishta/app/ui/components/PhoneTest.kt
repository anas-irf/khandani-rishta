package com.khandanirishta.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Phone numbers in E.164 with a dial-code picker (08 section 3.3). */
class PhoneTest {
    @Test
    fun `national numbers become E164 without the trunk zero`() {
        assertEquals("+923001234567", Phone.toE164("+92", "0300 1234567"))
        assertEquals("+447700900123", Phone.toE164("+44", "7700-900123"))
        assertNull(Phone.toE164("+92", " "))
    }

    @Test
    fun `the longest dial code wins when splitting`() {
        val codes = listOf("+1", "+92", "+971")
        assertEquals("+971" to "501234567", Phone.split("+971501234567", codes))
        assertEquals("+92" to "3001234567", Phone.split("+923001234567", codes))
        assertEquals(null to "", Phone.split(null, codes))
    }

    @Test
    fun `country codes become flag emoji`() {
        assertEquals("🇵🇰", Phone.flag("PK"))
        assertEquals("🇬🇧", Phone.flag("GB"))
        assertEquals("", Phone.flag("pk"))
        assertEquals("", Phone.flag("PAK"))
    }
}
