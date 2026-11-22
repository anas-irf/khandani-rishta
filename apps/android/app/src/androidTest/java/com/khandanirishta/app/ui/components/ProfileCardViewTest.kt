package com.khandanirishta.app.ui.components

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.preview.SampleData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The shared profile card of specs/16 section 1.5 and DESIGN.md section 6.9 (specs/22 section 15). */
@RunWith(AndroidJUnit4::class)
class ProfileCardViewTest {
    @get:Rule
    val rule = createComposeRule()

    private var opened = 0
    private var toggled = 0
    private var passed = 0

    private fun showCard(
        card: ProfileCard,
        me: Me = SampleData.me(),
        phone: TestPhone = TestPhone(),
        online: Boolean = true,
    ) {
        rule.show(phone = phone, me = me, online = online) {
            ProfileCardView(
                card = card,
                onOpen = { opened++ },
                onToggleShortlist = { toggled++ },
                onPass = { passed++ },
            )
        }
    }

    private fun text(value: String): SemanticsNodeInteraction =
        rule.onNodeWithText(value, useUnmergedTree = true).performScrollTo()

    private fun customActions(cardText: String) =
        rule
            .onNodeWithText(cardText, substring = true)
            .fetchSemanticsNode()
            .config
            .getOrElse(SemanticsActions.CustomActions) { emptyList() }

    @Test
    fun showsNameAgeMatchReasonsAndFacts() {
        showCard(SampleData.card())
        rule.onNodeWithText("Ayesha K.,\u00A026", useUnmergedTree = true).assertExists()
        text("87% match").assertIsDisplayed()
        text("Lives in your city").assertIsDisplayed()
        text("ID verified").assertIsDisplayed()
        text("Photo verified").assertIsDisplayed()
    }

    @Test
    fun leavesTheDetailsToTheProfile() {
        showCard(SampleData.card())
        rule.onNodeWithText("Rajput", substring = true, useUnmergedTree = true).assertDoesNotExist()
        rule.onNodeWithText("masters", substring = true, useUnmergedTree = true).assertDoesNotExist()
        rule.onNodeWithText("Never married", substring = true, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun aMissingPhotoIsSaidAfterTheName() {
        showCard(SampleData.card())
        rule
            .onNodeWithContentDescription("Ayesha K.,\u00A026. No photo added yet", useUnmergedTree = true)
            .assertExists()
    }

    @Test
    fun aPrivatePhotoIsSaidAfterTheNameWithTheCount() {
        showCard(SampleData.card(photo = SampleData.photo(blurred = true)))
        rule
            .onNodeWithContentDescription("Ayesha K.,\u00A026. Photo is private, 3 photos", useUnmergedTree = true)
            .assertExists()
    }

    @Test
    fun newIsOnThePhotoAndNotInTheBadgeRow() {
        showCard(SampleData.card(badges = listOf(Badge.NEW)))
        rule.onNodeWithContentDescription("New", substring = true, useUnmergedTree = true).assertExists()
        rule.onNodeWithText("ID verified", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun theWholeCardOpensTheProfile() {
        showCard(SampleData.card())
        rule.onNodeWithText("87% match").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun shortlistIsALabelledToggle() {
        showCard(SampleData.card())
        rule.onNodeWithText("Shortlist", useUnmergedTree = true).performScrollTo().performClick()
        assertEquals(1, toggled)
        assertEquals(0, opened)
    }

    @Test
    fun aShortlistedCardSaysSo() {
        showCard(SampleData.card(shortlisted = true))
        text("Shortlisted").assertIsDisplayed()
    }

    @Test
    fun talkBackHasShortlistAndNotInterestedAsActions() {
        showCard(SampleData.card())
        val actions = customActions("87% match")
        assertEquals(listOf("Add Ayesha K. to shortlist", "Not interested"), actions.map { it.label })
        rule.runOnIdle { actions.forEach { assertTrue(it.action()) } }
        assertEquals(1, toggled)
        assertEquals(1, passed)
    }

    @Test
    fun offlineThereAreNoActions() {
        showCard(SampleData.card(), online = false)
        assertTrue(customActions("87% match").isEmpty())
    }

    @Test
    fun theRelationIsInWords() {
        showCard(SampleData.card(direction = InterestDirection.SENT))
        text("Interest sent").assertIsDisplayed()
    }

    @Test
    fun aManagedViewerReadsTheCandidatesForm() {
        showCard(
            card = SampleData.card(direction = InterestDirection.RECEIVED),
            me = SampleData.me(managedBy = ManagedBy.PARENT, gender = Gender.FEMALE),
        )
        text("Interested in her").assertIsDisplayed()
    }

    @Test
    fun nothingIsCutAt200PercentOnASmallPhone() {
        showCard(
            card =
                SampleData.card(
                    name = SampleData.LONG_NAME,
                    badges = listOf(Badge.ID_VERIFIED, Badge.PHOTO_VERIFIED, Badge.PHONE_VERIFIED, Badge.NEW),
                    direction = InterestDirection.RECEIVED,
                    managedBy = ManagedBy.PARENT,
                    maritalStatus = MaritalStatus.DIVORCED,
                ),
            phone = SmallPhoneLargeText,
        )
        rule.assertNoTextIsCut()
    }
}
