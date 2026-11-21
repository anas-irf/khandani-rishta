package com.khandanirishta.app.ui.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Every target of specs/16 section 4.1 and every App Link of specs/22 section 3.4. */
class DeepLinkResolverTest {
    private fun target(
        name: String,
        vararg params: Pair<String, String?>,
    ) = DeepLinkResolver.fromTarget(name, params.toMap())

    @Test
    fun `targets open their screens on the right tab`() {
        assertEquals(DeepLink.Screen(Tab.HOME, emptyList()), target("APP-HOME"))
        assertEquals(DeepLink.Screen(Tab.HOME, listOf(Matches)), target("APP-MATCHES"))
        assertEquals(DeepLink.Screen(Tab.SEARCH, listOf(Search("s1"))), target("APP-SEARCH", "saved_search_id" to "s1"))
        assertEquals(DeepLink.Screen(Tab.HOME, listOf(Profile("p1"))), target("APP-PROFILE", "profile_id" to "p1"))
        assertEquals(
            DeepLink.Screen(Tab.INTERESTS, listOf(Interests("received", "i1"))),
            target("APP-INTERESTS", "interest_id" to "i1"),
        )
        assertEquals(DeepLink.Screen(Tab.CHATS, listOf(Chat("c1"))), target("APP-CHAT", "connection_id" to "c1"))
        assertEquals(
            DeepLink.Screen(Tab.CHATS, listOf(Chat("c1"), ConnectionDetails("c1"))),
            target("APP-CONNECTION", "connection_id" to "c1"),
        )
        assertEquals(DeepLink.Screen(Tab.ME, listOf(PhotoRequests("received"))), target("APP-PHOTO-REQUESTS"))
        assertEquals(DeepLink.Screen(Tab.HOME, listOf(Visitors)), target("APP-VISITORS"))
        assertEquals(DeepLink.Screen(Tab.HOME, listOf(Notifications)), target("APP-NOTIFS"))
        assertEquals(DeepLink.Screen(Tab.ME, emptyList()), target("ME-PROFILE"))
        assertEquals(DeepLink.Screen(Tab.ME, listOf(MyPhotos)), target("ME-PHOTOS"))
        assertEquals(DeepLink.Screen(Tab.ME, listOf(MyPreferences)), target("ME-PREFS"))
        assertEquals(DeepLink.Screen(Tab.ME, listOf(Verification)), target("ME-VERIFY"))
        assertEquals(DeepLink.Screen(Tab.HOME, listOf(GateChanges)), target("GATE-CHANGES"))
        assertEquals(DeepLink.Screen(Tab.ME, listOf(Settings, AccountSettings)), target("SET-ACCOUNT"))
        assertEquals(DeepLink.WebPage("community-guidelines"), target("PUB-GUIDELINES"))
    }

    @Test
    fun `text rejected opens the section of its field`() {
        assertEquals(
            DeepLink.Screen(Tab.ME, listOf(EditSection("lifestyle"))),
            target("ME-EDIT", "field" to "about_me"),
        )
        assertEquals(
            DeepLink.Screen(Tab.ME, listOf(EditSection("family"))),
            target("ME-EDIT", "field" to "about_family"),
        )
        assertEquals(DeepLink.Screen(Tab.ME, listOf(MyPreferences)), target("ME-EDIT", "field" to "partner_notes"))
    }

    @Test
    fun `unknown targets and missing parameters open the notifications`() {
        val notifications = DeepLink.Screen(Tab.HOME, listOf(Notifications))
        assertEquals(notifications, target("APP-SOMETHING-NEW"))
        assertEquals(notifications, target("APP-CHAT"))
        assertEquals(notifications, target("APP-PROFILE", "profile_id" to ""))
    }

    @Test
    fun `app links`() {
        assertEquals(DeepLink.Screen(Tab.HOME, listOf(Profile("abc"))), DeepLinkResolver.fromPath("/profiles/abc"))
        assertEquals(DeepLink.ProfileCode("KR7F3K2QX9"), DeepLinkResolver.fromPath("/p/kr7f3k2qx9"))
        assertEquals(DeepLink.Screen(Tab.CHATS, listOf(Chat("c9"))), DeepLinkResolver.fromPath("/chats/c9"))
        assertEquals(
            DeepLink.Screen(Tab.INTERESTS, listOf(Interests("received"))),
            DeepLinkResolver.fromPath("/interests"),
        )
        assertNull(DeepLinkResolver.fromPath("/safety"))
        assertNull(DeepLinkResolver.fromPath("/"))
    }
}
