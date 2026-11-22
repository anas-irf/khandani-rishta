package com.khandanirishta.app.ui.feature.profilesections

import android.content.res.Resources
import androidx.annotation.StringRes
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.text.Subject
import com.khandanirishta.app.ui.text.text
import java.util.Locale

/** What the "Help me write" starter knows about the candidate (07 section 9.3). */
data class DraftInput(
    val subject: Subject,
    val firstName: String?,
    val age: Int?,
    /** `job_title`, or the name of the profession category. */
    val job: String?,
    /** The city name, or `city_other`. */
    val city: String?,
    val educationLevel: String?,
    val educationField: String?,
    val religiosity: String?,
    /** The saved `family_type`. */
    val familyType: String?,
    /** Names of the selected hobbies, in the order chosen. */
    val hobbies: List<String>,
)

/**
 * Builds the `about_me` draft on the device from the answers already given, with the fixed
 * sentences of 07 section 9.3, joined by one space. It never calls the API. A known gender gives
 * the third-person sentences; `self` and an unknown gender use the base form.
 */
fun buildAboutMeDraft(
    input: DraftInput,
    res: Resources,
): String {
    @StringRes
    fun pick(
        @StringRes base: Int,
        @StringRes male: Int,
        @StringRes female: Int,
    ): Int =
        when (input.subject) {
            Subject.MALE -> male
            Subject.FEMALE -> female
            else -> base
        }
    val sentences = mutableListOf<String>()
    val name = input.firstName.orEmpty()
    if (input.age != null && !input.city.isNullOrBlank()) {
        sentences +=
            if (!input.job.isNullOrBlank()) {
                res.text(
                    pick(
                        R.string.profile_sections_help_me_write_intro_job,
                        R.string.profile_sections_help_me_write_intro_job_male,
                        R.string.profile_sections_help_me_write_intro_job_female,
                    ),
                    "age" to input.age,
                    "job" to input.job.lowercase(Locale.ENGLISH),
                    "city" to input.city,
                    "name" to name,
                )
            } else {
                res.text(
                    pick(
                        R.string.profile_sections_help_me_write_intro,
                        R.string.profile_sections_help_me_write_intro_male,
                        R.string.profile_sections_help_me_write_intro_female,
                    ),
                    "age" to input.age,
                    "city" to input.city,
                    "name" to name,
                )
            }
    }
    if (!input.educationLevel.isNullOrBlank()) {
        sentences +=
            if (!input.educationField.isNullOrBlank()) {
                res.text(
                    pick(
                        R.string.profile_sections_help_me_write_education_field,
                        R.string.profile_sections_help_me_write_education_field_male,
                        R.string.profile_sections_help_me_write_education_field_female,
                    ),
                    "level" to input.educationLevel,
                    "field" to input.educationField,
                )
            } else {
                res.text(
                    pick(
                        R.string.profile_sections_help_me_write_education,
                        R.string.profile_sections_help_me_write_education_male,
                        R.string.profile_sections_help_me_write_education_female,
                    ),
                    "level" to input.educationLevel,
                )
            }
    }
    val faith =
        when (input.religiosity) {
            "very_practising" -> {
                pick(
                    R.string.profile_sections_help_me_write_faith_very,
                    R.string.profile_sections_help_me_write_faith_very_male,
                    R.string.profile_sections_help_me_write_faith_very_female,
                )
            }

            "practising" -> {
                pick(
                    R.string.profile_sections_help_me_write_faith_practising,
                    R.string.profile_sections_help_me_write_faith_practising_male,
                    R.string.profile_sections_help_me_write_faith_practising_female,
                )
            }

            "moderately_practising" -> {
                pick(
                    R.string.profile_sections_help_me_write_faith_moderate,
                    R.string.profile_sections_help_me_write_faith_moderate_male,
                    R.string.profile_sections_help_me_write_faith_moderate_female,
                )
            }

            else -> {
                null
            }
        }
    if (faith != null) sentences += res.getString(faith)
    val family =
        when (input.familyType) {
            "joint" -> {
                pick(
                    R.string.profile_sections_help_me_write_family_joint,
                    R.string.profile_sections_help_me_write_family_joint_male,
                    R.string.profile_sections_help_me_write_family_joint_female,
                )
            }

            "nuclear" -> {
                pick(
                    R.string.profile_sections_help_me_write_family_nuclear,
                    R.string.profile_sections_help_me_write_family_nuclear_male,
                    R.string.profile_sections_help_me_write_family_nuclear_female,
                )
            }

            else -> {
                null
            }
        }
    if (family != null) sentences += res.getString(family)
    hobbyList(input.hobbies, res)?.let { hobbies ->
        sentences +=
            res.text(
                pick(
                    R.string.profile_sections_help_me_write_hobbies,
                    R.string.profile_sections_help_me_write_hobbies_male,
                    R.string.profile_sections_help_me_write_hobbies_female,
                ),
                "hobbies" to hobbies,
            )
    }
    sentences +=
        res.getString(
            pick(
                R.string.profile_sections_help_me_write_closing,
                R.string.profile_sections_help_me_write_closing_male,
                R.string.profile_sections_help_me_write_closing_female,
            ),
        )
    return sentences.joinToString(" ")
}

/** "a", "a and b" or "a, b and c": the first three hobbies in lower case. */
private fun hobbyList(
    names: List<String>,
    res: Resources,
): String? {
    val first = names.take(HOBBIES_IN_DRAFT).map { it.lowercase(Locale.ENGLISH) }
    return when (first.size) {
        0 -> {
            null
        }

        1 -> {
            first[0]
        }

        2 -> {
            res.text(R.string.profile_sections_help_me_write_list_two, "a" to first[0], "b" to first[1])
        }

        else -> {
            res.text(
                R.string.profile_sections_help_me_write_list_three,
                "a" to first[0],
                "b" to first[1],
                "c" to first[2],
            )
        }
    }
}

private const val HOBBIES_IN_DRAFT = 3
