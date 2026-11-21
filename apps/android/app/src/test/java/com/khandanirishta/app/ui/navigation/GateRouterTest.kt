package com.khandanirishta.app.ui.navigation

import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.khandanirishta.app.core.network.generated.model.OnboardingStep as Step

/** Every row of specs/16 section 3.2 and specs/22 section 3.2. */
class GateRouterTest {
    @Test
    fun `each gate has its landing screen`() {
        assertEquals(GateBlocked, GateRouter.root(Gate.BANNED, Step.DONE))
        assertEquals(GateBlocked, GateRouter.root(Gate.SUSPENDED, Step.DONE))
        assertEquals(GateDeletion, GateRouter.root(Gate.DELETION_SCHEDULED, Step.DONE))
        assertEquals(GateConsent, GateRouter.root(Gate.CONSENT_REQUIRED, Step.DONE))
        assertEquals(OnboardingStep("family"), GateRouter.root(Gate.ONBOARDING, Step.FAMILY))
        assertEquals(GateChanges, GateRouter.root(Gate.CHANGES_REQUESTED, Step.DONE))
        assertEquals(GateReview, GateRouter.root(Gate.PENDING_REVIEW, Step.DONE))
        assertEquals(Home, GateRouter.root(Gate.OK, Step.DONE))
    }

    @Test
    fun `onboarding with an unknown step starts at the first step`() {
        assertEquals(OnboardingStep("account_for"), GateRouter.root(Gate.ONBOARDING, Step.UNKNOWN))
    }

    @Test
    fun `only the gate ok shows the tabs`() {
        Gate.entries.filter { it != Gate.OK && it != Gate.UNKNOWN }.forEach { assertFalse(GateRouter.isTabbed(it)) }
        assertTrue(GateRouter.isTabbed(Gate.OK))
    }

    @Test
    fun `blocked accounts see only the blocked screen and help`() {
        for (gate in listOf(Gate.BANNED, Gate.SUSPENDED)) {
            assertTrue(GateRouter.isAllowed(gate, Step.DONE, GateBlocked))
            assertTrue(GateRouter.isAllowed(gate, Step.DONE, Help))
            assertFalse(GateRouter.isAllowed(gate, Step.DONE, Home))
            assertFalse(GateRouter.isAllowed(gate, Step.DONE, Settings))
        }
    }

    @Test
    fun `deletion scheduled allows the deletion screen and help`() {
        assertTrue(GateRouter.isAllowed(Gate.DELETION_SCHEDULED, Step.DONE, GateDeletion))
        assertTrue(GateRouter.isAllowed(Gate.DELETION_SCHEDULED, Step.DONE, Help))
        assertFalse(GateRouter.isAllowed(Gate.DELETION_SCHEDULED, Step.DONE, MyProfile))
    }

    @Test
    fun `consent required allows only the consent screen`() {
        assertTrue(GateRouter.isAllowed(Gate.CONSENT_REQUIRED, Step.DONE, GateConsent))
        assertFalse(GateRouter.isAllowed(Gate.CONSENT_REQUIRED, Step.DONE, Help))
    }

    @Test
    fun `onboarding allows earlier steps and help, never later steps`() {
        assertTrue(GateRouter.isAllowed(Gate.ONBOARDING, Step.LOCATION, OnboardingStep("account_for")))
        assertTrue(GateRouter.isAllowed(Gate.ONBOARDING, Step.LOCATION, OnboardingStep("location")))
        assertFalse(GateRouter.isAllowed(Gate.ONBOARDING, Step.LOCATION, OnboardingStep("family")))
        assertTrue(GateRouter.isAllowed(Gate.ONBOARDING, Step.LOCATION, Help))
        assertFalse(GateRouter.isAllowed(Gate.ONBOARDING, Step.LOCATION, Home))
        assertFalse(GateRouter.isAllowed(Gate.ONBOARDING, Step.LOCATION, OnboardingStep("done")))
    }

    @Test
    fun `review gates allow own profile, settings and notifications but not blocked members`() {
        for (gate in listOf(Gate.PENDING_REVIEW, Gate.CHANGES_REQUESTED)) {
            listOf(
                MyProfile,
                EditSection("basics"),
                MyPhotos,
                MyPreferences,
                Verification,
                VerifyIdentity(),
                VerifySelfie,
                Notifications,
                Settings,
                PrivacySettings,
                NotificationSettings,
                ContactDetails(),
                AccountSettings,
                Help,
            ).forEach { key -> assertTrue("$gate $key", GateRouter.isAllowed(gate, Step.DONE, key)) }
            assertFalse(GateRouter.isAllowed(gate, Step.DONE, BlockedMembers))
            assertFalse(GateRouter.isAllowed(gate, Step.DONE, Home))
            assertFalse(GateRouter.isAllowed(gate, Step.DONE, Chats))
        }
        assertTrue(GateRouter.isAllowed(Gate.PENDING_REVIEW, Step.DONE, GateReview))
        assertFalse(GateRouter.isAllowed(Gate.PENDING_REVIEW, Step.DONE, GateChanges))
        assertTrue(GateRouter.isAllowed(Gate.CHANGES_REQUESTED, Step.DONE, GateChanges))
    }

    @Test
    fun `gate ok allows every app screen but no gate or onboarding screen`() {
        listOf(
            Home,
            Matches,
            Search(),
            Profile("p"),
            Chats,
            Chat("c"),
            Settings,
            BlockedMembers,
            OnboardingDone,
        ).forEach {
            assertTrue(GateRouter.isAllowed(Gate.OK, Step.DONE, it))
        }
        listOf(GateBlocked, GateDeletion, GateConsent, GateReview, GateChanges, OnboardingStep("basics")).forEach {
            assertFalse(GateRouter.isAllowed(Gate.OK, Step.DONE, it))
        }
    }

    @Test
    fun `status panels follow the access level`() {
        assertEquals(ProfileStatus.PAUSED, GateRouter.statusPanel(ProfileStatus.PAUSED, GateRouter.Level.BROWSE))
        assertNull(GateRouter.statusPanel(ProfileStatus.PAUSED, GateRouter.Level.ENGAGE))
        assertEquals(ProfileStatus.CLOSED, GateRouter.statusPanel(ProfileStatus.CLOSED, GateRouter.Level.BROWSE))
        assertEquals(ProfileStatus.CLOSED, GateRouter.statusPanel(ProfileStatus.CLOSED, GateRouter.Level.ENGAGE))
        assertNull(GateRouter.statusPanel(ProfileStatus.CLOSED, GateRouter.Level.CONNECTED))
        assertNull(GateRouter.statusPanel(ProfileStatus.ACTIVE, GateRouter.Level.BROWSE))
    }
}
