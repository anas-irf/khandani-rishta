package com.khandanirishta.app.ui.navigation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Rule G17 of specs/16 section 1.2: the six screens that set FLAG_SECURE, and the ones that do not. */
class SecureScreensTest {
    @Test
    fun `the six secure screens block screenshots`() {
        val secure =
            listOf(
                Profile("member-1"),
                PhotoViewer("member-1", 0),
                Chat("connection-1"),
                ConnectionDetails("connection-1"),
                VerifyIdentity(),
                VerifySelfie,
            )
        secure.forEach { assertTrue(it.toString(), it.isSecure()) }
    }

    @Test
    fun `lists do not`() {
        listOf(Home, Matches, Chats, MyProfile).forEach { assertFalse(it.toString(), it.isSecure()) }
    }
}
