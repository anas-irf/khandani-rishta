package com.khandanirishta.app.ui.components

import androidx.compose.ui.text.AnnotatedString
import org.junit.Assert.assertEquals
import org.junit.Test

/** The CNIC mask `12345-1234567-1` over the 13 stored digits (12 section 3). */
class IdentityMaskTest {
    @Test
    fun `masks while typing`() {
        assertEquals("3520", IdentityMask.filter(AnnotatedString("3520")).text.text)
        assertEquals("35202-1", IdentityMask.filter(AnnotatedString("352021")).text.text)
        assertEquals("35202-1234567-1", IdentityMask.filter(AnnotatedString("3520212345671")).text.text)
    }

    @Test
    fun `cursor offsets map across the hyphens`() {
        val mapping = IdentityMask.filter(AnnotatedString("3520212345671")).offsetMapping
        assertEquals(5, mapping.originalToTransformed(5))
        assertEquals(7, mapping.originalToTransformed(6))
        assertEquals(15, mapping.originalToTransformed(13))
        assertEquals(6, mapping.transformedToOriginal(7))
        assertEquals(13, mapping.transformedToOriginal(15))
    }
}
