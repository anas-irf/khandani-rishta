package com.khandanirishta.app.ui.text

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.ManagedBy

/**
 * The wording pattern of 07 section 3.2: labels are written in the `self` form, and copy that
 * mentions the candidate has variants for a male, a female or a not yet known candidate.
 */
enum class Subject { SELF, MALE, FEMALE, UNKNOWN }

fun subjectOf(
    managedBy: ManagedBy?,
    gender: Gender?,
): Subject =
    when {
        managedBy == null || managedBy == ManagedBy.SELF || managedBy == ManagedBy.UNKNOWN -> Subject.SELF
        gender == Gender.MALE -> Subject.MALE
        gender == Gender.FEMALE -> Subject.FEMALE
        else -> Subject.UNKNOWN
    }

/** The variant of a string for this subject; a missing variant falls back to the base text. */
fun Subject.pick(
    base: Int,
    male: Int? = null,
    female: Int? = null,
    unknown: Int? = null,
): Int =
    when (this) {
        Subject.SELF -> base
        Subject.MALE -> male ?: base
        Subject.FEMALE -> female ?: base
        Subject.UNKNOWN -> unknown ?: base
    }

/**
 * The person the signed-in profile is for, and how to speak about them (specs/16 section 1.1, the
 * web's `useCandidate`):
 *
 * - [subject] picks the pronoun form of a string: "your city", "his city", "her city".
 * - [heading] picks the form of a heading that names them: "Near Ayesha", "Ayesha's matches".
 *   Fill its `name` with [name].
 */
@Immutable
data class Candidate(
    val subject: Subject = Subject.SELF,
    val name: String = "",
) {
    val managed: Boolean get() = subject != Subject.SELF

    /** The pronoun form. Works for strings and for plurals. */
    fun pick(
        base: Int,
        male: Int? = null,
        female: Int? = null,
    ): Int = subject.pick(base, male, female)

    @StringRes
    fun heading(
        @StringRes base: Int,
        @StringRes named: Int,
    ): Int = if (managed && name.isNotBlank()) named else base
}

/** The candidate of the signed-in profile; the `self` form where no member is signed in. */
@Composable
fun rememberCandidate(): Candidate {
    val profile = LocalMe.current?.profile
    val managedBy = profile?.managedBy
    val gender = profile?.gender
    val name = profile?.firstName.orEmpty()
    return remember(managedBy, gender, name) { Candidate(subjectOf(managedBy, gender), name) }
}
