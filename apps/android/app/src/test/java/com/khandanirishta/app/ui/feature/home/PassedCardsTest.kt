package com.khandanirishta.app.ui.feature.home

import com.khandanirishta.app.core.network.generated.model.CardRelation
import com.khandanirishta.app.core.network.generated.model.EmploymentType
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.Tier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Not interested" in place (specs/16 section 6.4, specs/11 section 12). */
class PassedCardsTest {
    private val list = listOf("a", "b", "c", "d").map(::card)

    private fun List<ProfileCard>.ids() = joinToString("") { it.id }

    @Test
    fun `a visit that ended stays ended through a failed pass`() {
        val left = PassedCards().pass(list[1], list).pass(list[2], list).leave()
        assertTrue(left.without("b").left)
        assertTrue(left.passAgain("c").left)
        assertFalse(PassedCards().leave().left)
    }

    @Test
    fun `a failed pass puts the card back once`() {
        assertEquals("abcd", list.filterNot { it.id == "b" }.putBack(list[1], 1).ids())
        assertEquals("abcd", list.putBack(list[1], 3).ids())
        assertEquals("ad", list.take(1).putBack(list[3], 3).ids())
    }

    @Test
    fun `a passed card keeps its place`() {
        val passed = PassedCards().pass(list[1], list)
        assertTrue(passed.isPassed("b"))
        assertEquals("abcd", passed.arrange(list).ids())
    }

    @Test
    fun `a refetch without the passed card still has its panel where it was`() {
        val passed = PassedCards().pass(list[1], list)
        assertEquals("abcd", passed.arrange(list.filterNot { it.id == "b" }).ids())
    }

    @Test
    fun `several passes keep their places in any order`() {
        var passed = PassedCards().pass(list[2], list)
        val shown = passed.arrange(list.filterNot { it.id == "c" })
        passed = passed.pass(shown[0], shown)
        assertEquals("abcd", passed.arrange(list.filter { it.id == "b" || it.id == "d" }).ids())
    }

    @Test
    fun `a place past the end of a shorter list is the end`() {
        val passed = PassedCards().pass(list[3], list)
        assertEquals("ad", passed.arrange(list.take(1)).ids())
    }

    @Test
    fun `undo shows the card again in its place`() {
        val passed = PassedCards().pass(list[1], list).restore("b")
        assertFalse(passed.isPassed("b"))
        assertEquals("abcd", passed.arrange(list.filterNot { it.id == "b" }).ids())
    }

    @Test
    fun `a failed undo puts the panel back`() {
        val passed = PassedCards().pass(list[1], list).restore("b").passAgain("b")
        assertTrue(passed.isPassed("b"))
    }

    @Test
    fun `a failed pass takes the panel away`() {
        val passed = PassedCards().pass(list[1], list).without("b")
        assertFalse(passed.isPassed("b"))
        assertTrue(passed.entries.isEmpty())
    }

    @Test
    fun `passing again keeps one entry`() {
        val passed = PassedCards().pass(list[1], list).restore("b").pass(list[1], list)
        assertEquals(1, passed.entries.size)
        assertTrue(passed.isPassed("b"))
    }

    @Test
    fun `rows without panels hide the passed cards and no others`() {
        val passed = PassedCards().pass(list[1], list).pass(list[2], list).restore("c")
        assertEquals("acd", passed.hide(list).ids())
    }

    @Test
    fun `a shortlist change reaches a card the list no longer has`() {
        val passed = PassedCards().pass(list[1], list).update("b") { it.withShortlist(true) }
        val shown = passed.restore("b").arrange(emptyList())
        assertTrue(shown.single().relation.isShortlisted)
    }
}

private fun card(id: String) =
    ProfileCard(
        age = 26,
        badges = emptyList(),
        casteLabel = null,
        cityName = "Lahore",
        compat = null,
        countryCode = "PK",
        displayName = "Member $id",
        educationLevelCode = "masters",
        employmentType = EmploymentType.PRIVATE_JOB,
        gender = Gender.FEMALE,
        heightCm = 163,
        id = id,
        lastActive = null,
        managedBy = ManagedBy.SELF,
        maritalStatus = MaritalStatus.NEVER_MARRIED,
        motherTongueCode = "urdu",
        photo = null,
        photoCount = 0,
        professionCode = null,
        publicCode = "KR7F3K2QX9",
        reasons = emptyList(),
        regionName = "Punjab",
        relation =
            CardRelation(
                canSendInterest = true,
                connectionId = null,
                interestDirection = null,
                interestStatus = null,
                isShortlisted = false,
                tier = Tier.MEMBER,
            ),
        religionCode = "islam",
        sectCode = null,
    )
