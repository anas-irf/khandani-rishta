package com.khandanirishta.app.ui.text

import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The wording rules of specs/07 section 3.2, specs/10 section 7 and specs/12 section 1.2. */
class WordingTest {
    @Test
    fun `a member managing their own profile is spoken to as you`() {
        assertEquals(Subject.SELF, subjectOf(ManagedBy.SELF, Gender.FEMALE))
        assertEquals(Subject.SELF, subjectOf(null, Gender.MALE))
    }

    @Test
    fun `a managed profile speaks of the candidate`() {
        assertEquals(Subject.MALE, subjectOf(ManagedBy.PARENT, Gender.MALE))
        assertEquals(Subject.FEMALE, subjectOf(ManagedBy.PARENT, Gender.FEMALE))
        assertEquals(Subject.UNKNOWN, subjectOf(ManagedBy.PARENT, null))
    }

    @Test
    fun `a missing variant falls back to the base text`() {
        assertEquals(1, Subject.FEMALE.pick(base = 1, male = 2))
        assertEquals(1, Subject.UNKNOWN.pick(base = 1, male = 2, female = 3))
        assertEquals(3, Subject.FEMALE.pick(base = 1, male = 2, female = 3))
    }

    @Test
    fun `a heading names the candidate only when managed and named`() {
        assertEquals(2, Candidate(Subject.FEMALE, "Ayesha").heading(base = 1, named = 2))
        assertEquals(1, Candidate(Subject.FEMALE, " ").heading(base = 1, named = 2))
        assertEquals(1, Candidate(Subject.SELF, "Ayesha").heading(base = 1, named = 2))
    }

    @Test
    fun `verified and new member are no longer reasons`() {
        assertNull(reasonLabel("verified"))
        assertNull(reasonLabel("new_member"))
        assertNull(reasonLabel("from_a_newer_api"))
    }

    @Test
    fun `at most three known reasons are shown, in order`() {
        val codes = listOf("verified", "same_city", "age_fits", "education_fits", "profession_fits")
        val expected = listOf("same_city", "age_fits", "education_fits").map { reasonLabel(it) }
        assertEquals(expected, reasonLabels(codes))
    }

    @Test
    fun `badges are ID, photo, then phone, and new is not one of them`() {
        val badges = listOf(Badge.NEW, Badge.PHONE_VERIFIED, Badge.ID_VERIFIED, Badge.PHOTO_VERIFIED)
        assertEquals(listOf(Badge.ID_VERIFIED, Badge.PHOTO_VERIFIED, Badge.PHONE_VERIFIED), badges.verifications())
    }

    @Test
    fun `every badge has words`() {
        assertEquals(R.string.shared_badge_id_verified, badgeLabel(Badge.ID_VERIFIED))
        assertEquals(R.string.shared_badge_photo_verified, badgeLabel(Badge.PHOTO_VERIFIED))
        assertEquals(R.string.shared_badge_phone_verified, badgeLabel(Badge.PHONE_VERIFIED))
    }
}
