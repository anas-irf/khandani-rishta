package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.ui.DestinationBar
import com.khandanirishta.app.ui.DestinationCounts
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.preview.SampleData
import com.khandanirishta.app.ui.theme.Sizes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The shared components of specs/22 section 11: states, semantics, direction and 200% text. */
@RunWith(AndroidJUnit4::class)
class SharedComponentsTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun aFailureIsSaidInsideTheSheetThatStaysOpen() {
        val toasts = SnackbarHostState()
        var failed by mutableStateOf(false)
        rule.show(scrolls = false) {
            CompositionLocalProvider(LocalToasts provides toasts) {
                KrSheet(title = "Decline this interest?", onDismissRequest = {}) { Text("Hamza S.") }
            }
            LaunchedEffect(failed) {
                if (failed) toasts.showSnackbar("Could not decline.", duration = SnackbarDuration.Indefinite)
            }
        }
        rule.onNodeWithText("Could not decline.").assertDoesNotExist()
        rule.runOnIdle { failed = true }
        rule.onNodeWithText("Could not decline.").assertIsDisplayed()
    }

    @Test
    fun aSheetWhoseDismissalIsRefusedComesBack() {
        var asked = 0
        rule.show(scrolls = false) {
            KrSheet(title = "End this connection?", onDismissRequest = { asked++ }) { Text("Ahmed R.") }
        }
        rule
            .onNode(
                SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss),
            ).performSemanticsAction(SemanticsActions.Dismiss)
        rule.waitUntil(5_000) { asked == 1 }
        rule.mainClock.advanceTimeBy(1_000)
        rule.onNodeWithText("Ahmed R.").assertIsDisplayed()
    }

    @Test
    fun photoWithoutOneSaysSo() {
        rule.show {
            MemberAvatar(photo = null, name = "Ayesha K.", gender = Gender.FEMALE)
        }
        rule.onNodeWithContentDescription("No photo added yet").assertExists()
    }

    @Test
    fun privatePhotoSaysSo() {
        rule.show {
            MemberAvatar(photo = SampleData.photo(blurred = true), name = "Ayesha K.", gender = Gender.FEMALE)
        }
        rule.onNodeWithContentDescription("Private photo").assertExists()
    }

    @Test
    fun lockedValueIsReadWithItsLabel() {
        rule.show { LockedRow(label = "Monthly income", placeholder = "Visible after you connect") }
        rule
            .onNode(hasText("Monthly income"))
            .assert(hasText("Visible after you connect"))
            .assertIsDisplayed()
    }

    @Test
    fun switchRowIsOneSwitch() {
        var changed = false
        rule.show {
            SwitchRow(title = "Show me in search", checked = true, onCheckedChange = { changed = true })
        }
        rule
            .onNode(isToggleable())
            .assertIsOn()
            .assert(hasText("Show me in search"))
            .assertHeightIsAtLeast(72.dp)
        rule.onNode(isToggleable()).performClick()
        assertTrue(changed)
    }

    @Test
    fun aSingleChoiceChipIsARadioButton() {
        rule.show { KrChoiceChip(text = "Best match", selected = true, onClick = {}, singleChoice = true) }
        rule
            .onNodeWithText("Best match")
            .assertIsSelected()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
    }

    @Test
    fun badgesAreWordsAndNeverNew() {
        rule.show { BadgeRow(listOf(Badge.NEW, Badge.PHONE_VERIFIED, Badge.ID_VERIFIED)) }
        rule.onNodeWithText("ID verified").assertIsDisplayed()
        rule.onNodeWithText("Phone verified").assertIsDisplayed()
        rule.onNodeWithText("New").assertDoesNotExist()
    }

    @Test
    fun aDisabledButtonStaysReadable() {
        rule.show { KrButton(text = "Interest sent", onClick = {}, enabled = false) }
        rule
            .onNodeWithText("Interest sent")
            .assertIsDisplayed()
            .assertIsNotEnabled()
            .assertHeightIsAtLeast(Sizes.touchLarge)
    }

    @Test
    fun passedCardHasUndoWithNoTimeLimit() {
        var undone = false
        rule.show { PassedCard(name = "Ayesha K.", onUndo = { undone = true }) }
        rule.onNodeWithText("Ayesha K. is hidden from your matches.").assertIsDisplayed()
        rule.mainClock.advanceTimeBy(TEN_SECONDS)
        rule.onNodeWithText("Undo").assertIsEnabled().performClick()
        assertTrue(undone)
    }

    @Test
    fun passedCardCannotUndoOffline() {
        rule.show(online = false) { PassedCard(name = "Ayesha K.", onUndo = {}) }
        rule.onNodeWithText("Undo").assertIsNotEnabled()
    }

    @Test
    fun passedCardNamesTheCandidate() {
        rule.show(me = SampleData.me(managedBy = ManagedBy.PARENT, gender = Gender.MALE)) {
            PassedCard(name = "Ayesha K.", onUndo = {})
        }
        rule.onNodeWithText("Ayesha K. is hidden from his matches.").assertIsDisplayed()
    }

    @Test
    fun aRowMirrorsRightToLeft() {
        rule.show(TestPhone(direction = LayoutDirection.Rtl)) {
            Row {
                KrButton(text = "First", onClick = {}, variant = KrButtonVariant.SECONDARY)
                KrButton(text = "Second", onClick = {}, variant = KrButtonVariant.SECONDARY)
            }
        }
        val first = rule.onNodeWithText("First").getBoundsInRoot()
        val second = rule.onNodeWithText("Second").getBoundsInRoot()
        assertTrue(first.left > second.left)
    }

    @Test
    fun anAdaptiveRowStacksInTheOrderOfReadingAtLargeText() {
        rule.show(SmallPhoneLargeText) {
            AnswerRow(
                secondary = { KrButton("Decline", {}, it, variant = KrButtonVariant.SECONDARY) },
                primary = { KrButton("Accept the interest", {}, it) },
            )
        }
        val decline = rule.onNodeWithText("Decline").getBoundsInRoot()
        val accept = rule.onNodeWithText("Accept the interest").getBoundsInRoot()
        assertTrue(accept.top >= decline.bottom)
        rule.assertNoTextIsCut()
    }

    @Test
    fun theDestinationsWrapAndNoneIsCut() {
        var chosen: Tab? = null
        rule.show(SmallPhoneLargeText, scrolls = false) {
            DestinationBar(
                selected = Tab.HOME,
                counts = DestinationCounts(interests = 4, chats = 120, attention = true),
                onSelect = { chosen = it },
            )
        }
        rule.assertNoTextIsCut()
        rule.onNodeWithContentDescription("Interests, 4 new").performClick()
        assertEquals(Tab.INTERESTS, chosen)
    }

    @Test
    fun compactCardsAreNotCutAtLargeText() {
        rule.show(SmallPhoneLargeText) {
            Column {
                ProfileRow(card = SampleData.card(name = SampleData.LONG_NAME), onOpen = {})
                ProfileTile(card = SampleData.card(badges = listOf(Badge.NEW)), onOpen = {})
            }
        }
        rule.assertNoTextIsCut()
    }

    @Test
    fun rowsAndStatesAreNotCutAtLargeText() {
        rule.show(SmallPhoneLargeText) {
            Column {
                InfoRow(label = "Education level", value = "Professional degree (MBBS, BDS, Pharm-D, LLB, CA, ACCA)")
                LockedRow(label = "Workplace and institute", placeholder = "Visible after you connect")
                SwitchRow(title = "Let members see that I viewed their profile", checked = false, onCheckedChange = {})
                StatusBanner(text = "The profile is being reviewed.", tone = StatusTone.WARNING)
                EmptyState(title = "No saved profiles yet.", actionLabel = "See my matches", onAction = {})
                PassedCard(name = SampleData.LONG_NAME, onUndo = {})
            }
        }
        rule.assertNoTextIsCut()
    }

    private companion object {
        const val TEN_SECONDS = 10_000L
    }
}
