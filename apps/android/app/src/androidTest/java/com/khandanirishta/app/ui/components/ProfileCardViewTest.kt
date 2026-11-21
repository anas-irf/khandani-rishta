package com.khandanirishta.app.ui.components

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.CardRelation
import com.khandanirishta.app.core.network.generated.model.EmploymentType
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.InterestStatus
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.PhotoView
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.ReferenceBootstrap
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.theme.KhandaniTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The shared profile card of specs/16 section 1.5 (specs/22 section 15). */
@RunWith(AndroidJUnit4::class)
class ProfileCardViewTest {
    @get:Rule
    val rule = createComposeRule()

    private val reference =
        Reference(
            ReferenceBootstrap(
                castes = emptyList(),
                countries = emptyList(),
                educationFields = emptyList(),
                educationLevels = emptyList(),
                hobbies = emptyList(),
                incomeBands = emptyList(),
                languages = emptyList(),
                options = emptyMap(),
                professionCategories = emptyList(),
                religions = emptyList(),
                version = "test",
            ),
        )

    private fun card(
        photo: PhotoView? = null,
        direction: InterestDirection? = null,
    ) = ProfileCard(
        age = 26,
        badges = listOf(Badge.ID_VERIFIED),
        casteLabel = "Rajput",
        cityName = "Lahore",
        compat = 87,
        countryCode = "PK",
        displayName = "Ayesha K.",
        educationLevelCode = "masters",
        employmentType = EmploymentType.PRIVATE_JOB,
        gender = Gender.FEMALE,
        heightCm = 163,
        id = "p1",
        lastActive = null,
        managedBy = ManagedBy.SELF,
        maritalStatus = MaritalStatus.NEVER_MARRIED,
        motherTongueCode = "urdu",
        photo = photo,
        photoCount = if (photo == null) 0 else 3,
        professionCode = null,
        publicCode = "KR7F3K2QX9",
        reasons = listOf("same_city"),
        regionName = "Punjab",
        relation =
            CardRelation(
                canSendInterest = true,
                connectionId = null,
                interestDirection = direction,
                interestStatus = direction?.let { InterestStatus.PENDING },
                isShortlisted = false,
                tier = Tier.MEMBER,
            ),
        religionCode = "islam",
        sectCode = null,
    )

    private fun show(
        card: ProfileCard,
        onOpen: () -> Unit = {},
        onHeart: () -> Unit = {},
    ) {
        rule.setContent {
            KhandaniTheme {
                CompositionLocalProvider(LocalReference provides reference) {
                    ProfileCardView(card = card, onOpen = onOpen, onToggleShortlist = onHeart, onPass = {})
                }
            }
        }
    }

    @Test
    fun showsNameAgeMatchAndReasonWithoutAPhoto() {
        show(card())
        rule.onNodeWithText("Ayesha K., 26").assertIsDisplayed()
        rule.onNodeWithText("87% match").assertIsDisplayed()
        rule.onNodeWithText("Lives in your city").assertIsDisplayed()
    }

    @Test
    fun aBlurredPhotoIsMarkedPrivate() {
        val blurred =
            PhotoView(
                id = "ph1",
                isBlurred = true,
                isPrimary = true,
                largeUrl = null,
                mediumUrl = "https://example.invalid/photo/medium.jpg",
                thumbUrl = "https://example.invalid/photo/thumb.jpg",
            )
        show(card(photo = blurred))
        rule.onNodeWithText("Photo is private").assertIsDisplayed()
        rule.onNodeWithContentDescription("Private photo").assertExists()
        rule.onNodeWithText("3 photos").assertIsDisplayed()
    }

    @Test
    fun relationHintAndActions() {
        var opened = 0
        var hearts = 0
        show(card(direction = InterestDirection.SENT), onOpen = { opened++ }, onHeart = { hearts++ })
        rule.onNodeWithText("Interest sent").assertIsDisplayed()
        rule.onNodeWithContentDescription("Add Ayesha K. to shortlist").performClick()
        rule.onNodeWithText("Ayesha K., 26").performClick()
        assertEquals(1, hearts)
        assertEquals(1, opened)
    }
}
