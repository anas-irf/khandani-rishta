package com.khandanirishta.app.ui.feature

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.khandanirishta.app.core.network.generated.model.CannotSendReason
import com.khandanirishta.app.core.network.generated.model.LockedGroup
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.RelationPhotoAccess
import com.khandanirishta.app.core.network.generated.model.RelaxationHint
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.PhoneLargeText
import com.khandanirishta.app.ui.components.SmallPhoneLargeText
import com.khandanirishta.app.ui.components.assertNoTextIsCut
import com.khandanirishta.app.ui.components.show
import com.khandanirishta.app.ui.feature.auth.Welcome
import com.khandanirishta.app.ui.feature.home.ExhaustedPanel
import com.khandanirishta.app.ui.feature.home.Greeting
import com.khandanirishta.app.ui.feature.home.PendingCallout
import com.khandanirishta.app.ui.feature.onboarding.StepBody
import com.khandanirishta.app.ui.feature.onboarding.StepBottomBar
import com.khandanirishta.app.ui.feature.onboarding.StepFrame
import com.khandanirishta.app.ui.feature.onboarding.StepSecondaryAction
import com.khandanirishta.app.ui.feature.profile.ProfileActionBar
import com.khandanirishta.app.ui.feature.profile.ProfileBarActions
import com.khandanirishta.app.ui.feature.profile.ProfileDetailBody
import com.khandanirishta.app.ui.feature.profile.ProfileHero
import com.khandanirishta.app.ui.preview.SampleData
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The parts of sign-in, Home and the profile that edge cases reach first (DESIGN.md section 7). */
@RunWith(AndroidJUnit4::class)
class KeyScreensTest {
    @get:Rule
    val rule = createComposeRule()

    private var requested = 0
    private var accepted = 0

    private fun showBar(detail: ProfileDetail) {
        rule.show(scrolls = false) {
            ProfileActionBar(
                detail = detail,
                busy = false,
                accepting = false,
                actions =
                    ProfileBarActions(
                        openChat = {},
                        send = {},
                        accept = { accepted++ },
                        decline = {},
                        withdraw = {},
                        verify = {},
                        viewSentInterests = {},
                    ),
            )
        }
    }

    @Test
    fun welcomeIsNotCutAtLargeText() {
        rule.show(PhoneLargeText, scrolls = false) { Welcome(onStart = {}) }
        rule.assertNoTextIsCut()
    }

    @Test
    fun theTopOfHomeIsNotCutAtLargeText() {
        rule.show(SmallPhoneLargeText, me = SampleData.me(managedBy = ManagedBy.PARENT)) {
            Column {
                Greeting()
                PendingCallout(count = 2, onView = {})
                ExhaustedPanel(
                    hints = listOf(RelaxationHint(dimension = "living_arrangement", extraProfiles = 8)),
                    ageHint = true,
                    onReview = {},
                    onSearch = {},
                )
            }
        }
        rule.assertNoTextIsCut()
    }

    @Test
    fun lockedGroupsShowThePlaceholderAndNeverTheValue() {
        rule.show {
            ProfileDetailBody(SampleData.detail(locked = listOf(LockedGroup.CASTE, LockedGroup.FAMILY)))
        }
        rule.onAllNodesWithText("Visible after you connect", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals(2, it.size)
        }
        rule.onNodeWithText("Rajput", useUnmergedTree = true).assertDoesNotExist()
        rule.onNodeWithText("We are a close family from Lahore.", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun theOwnPreviewHasNoCompatibility() {
        rule.show { ProfileDetailBody(SampleData.detail()) }
        rule.onNodeWithText("Compatibility", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun profileIsNotCutAtLargeText() {
        rule.show(SmallPhoneLargeText) {
            ProfileDetailBody(
                SampleData.detail(
                    card = SampleData.card(name = SampleData.LONG_NAME),
                    locked = listOf(LockedGroup.INCOME, LockedGroup.HEALTH),
                ),
            )
        }
        rule.assertNoTextIsCut()
    }

    @Test
    fun anOnboardingStepIsNotCutAtLargeText() {
        rule.show(SmallPhoneLargeText, scrolls = false) {
            StepFrame(
                step = "education_career",
                currentStep = "education_career",
                title = "Education and career",
                subtitle = "Families often ask about education and work first.",
                busy = false,
                onBack = {},
                onHelp = {},
                onSignOut = {},
                bottomBar = { StepBottomBar(primaryLabel = "Continue") },
            ) {
                StepBody {
                    KrTextField(value = "", onValueChange = {}, label = "Occupation", error = "Enter the occupation.")
                    StepSecondaryAction(label = "Skip for now", onClick = {})
                }
            }
        }
        rule.assertNoTextIsCut()
        rule.onNodeWithText("Continue").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun privatePhotosOfferARequest() {
        rule.show {
            ProfileHero(
                detail =
                    SampleData.detail(
                        photos = listOf(SampleData.photo(blurred = true)),
                        locked = listOf(LockedGroup.PHOTOS),
                        access = RelationPhotoAccess.CAN_REQUEST,
                    ),
                onOpenPhoto = {},
                onRequestPhotos = { requested++ },
            )
        }
        rule.onNodeWithText("Ayesha K.'s photos are private", useUnmergedTree = true).assertExists()
        rule.onNodeWithText("Request photos").performScrollTo().performClick()
        assertEquals(1, requested)
    }

    @Test
    fun aDenialIsNeverNamed() {
        rule.show {
            ProfileHero(
                detail =
                    SampleData.detail(
                        photos = listOf(SampleData.photo(blurred = true)),
                        locked = listOf(LockedGroup.PHOTOS),
                        access = RelationPhotoAccess.DENIED,
                    ),
                onOpenPhoto = {},
                onRequestPhotos = { requested++ },
            )
        }
        rule.onNodeWithText("Ayesha K.'s photos are private", useUnmergedTree = true).assertExists()
        rule.onNodeWithText("Request photos").assertDoesNotExist()
    }

    @Test
    fun aReceivedInterestHasAcceptAndTheMessage() {
        showBar(SampleData.detail(tier = Tier.INTEREST_FROM_OWNER))
        rule.onNodeWithText("Ayesha K. is interested in you").assertIsDisplayed()
        rule.onNodeWithText("Decline").assertIsEnabled()
        rule.onNodeWithText("Accept").performClick()
        assertEquals(1, accepted)
    }

    @Test
    fun aConnectionOpensTheChat() {
        showBar(SampleData.detail(tier = Tier.CONNECTION))
        rule.onNodeWithText("Open chat").assertIsEnabled()
        rule.onNodeWithText("Send interest").assertDoesNotExist()
    }

    @Test
    fun aMemberWhoCanSendSeesWhatIsLeftToday() {
        showBar(SampleData.detail(tier = Tier.MEMBER))
        rule.onNodeWithText("Send interest").assertIsEnabled()
        rule.onNodeWithText("4 of 5 interests left today.").assertIsDisplayed()
    }

    @Test
    fun aSentInterestIsStillReadable() {
        showBar(SampleData.detail(tier = Tier.INTEREST_TO_OWNER))
        rule.onNodeWithText("Interest sent").assertIsDisplayed().assertIsNotEnabled()
        rule.onNodeWithText("Withdraw").assertIsEnabled()
    }

    @Test
    fun theReasonSendingIsOffIsUnderTheButton() {
        val detail = SampleData.detail()
        showBar(
            detail.copy(
                relation =
                    detail.relation.copy(
                        canSendInterest = false,
                        cannotSendReason = CannotSendReason.PENDING_LIMIT,
                    ),
            ),
        )
        rule.onNodeWithText("Send interest").assertIsNotEnabled()
        rule.onNodeWithText("View sent interests").assertIsDisplayed()
    }
}
