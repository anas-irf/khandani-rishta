package com.khandanirishta.app.ui.feature.profile

import android.content.res.Resources
import androidx.compose.runtime.Immutable
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.ChildrenStatus
import com.khandanirishta.app.core.network.generated.model.Compatibility
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.LockedGroup
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text

/*
 * What a profile shows, worked out once and away from the composition (specs/16 section 6.7
 * blocks 3 to 11): which bands there are, and the rows of each group.
 */

/** A row of a group: its value, or `null` when the owner keeps it private. */
@Immutable
internal data class ProfileRowFact(
    val label: String,
    val value: String?,
)

/** A titled group of rows, with what may follow them. */
@Immutable
internal data class ProfileGroup(
    val key: String,
    val title: String,
    val rows: List<ProfileRowFact>,
    /** The whole group is private: one locked value and no rows. */
    val locked: Boolean = false,
    val aboutFamily: String? = null,
    val hobbies: List<String> = emptyList(),
) {
    val shown: Boolean get() = rows.isNotEmpty() || locked || aboutFamily != null || hobbies.isNotEmpty()
}

/** One band under the hero. */
@Immutable
internal sealed interface ProfileBand {
    val key: String

    data class Match(
        val compatibility: Compatibility,
    ) : ProfileBand {
        override val key: String get() = "compatibility"
    }

    data class About(
        val text: String,
    ) : ProfileBand {
        override val key: String get() = "about"
    }

    /** One group, or two that share a band where they fit (DESIGN.md section 6.10). */
    data class Details(
        val groups: List<ProfileGroup>,
    ) : ProfileBand {
        override val key: String get() = groups.joinToString("-") { it.key }
    }

    data object LookingFor : ProfileBand {
        override val key: String get() = "looking-for"
    }
}

/** The bands of a profile, in order. A [preview] of the own profile has no compatibility. */
internal fun profileBands(
    detail: ProfileDetail,
    ref: Reference,
    res: Resources,
    preview: Boolean,
): List<ProfileBand> {
    val facts = DetailFacts(detail, ref, res)
    val details =
        listOf(
            listOf(facts.basics(), facts.community()),
            listOf(facts.location(), facts.career()),
            listOf(facts.family()),
            listOf(facts.lifestyle()),
        ).mapNotNull { pair ->
            val shown = pair.filter { it.shown }
            if (shown.isEmpty()) null else ProfileBand.Details(shown)
        }
    return buildList {
        if (!preview) detail.compatibility?.let { add(ProfileBand.Match(it)) }
        detail.aboutMe?.takeIf { it.isNotBlank() }?.let { add(ProfileBand.About(it)) }
        addAll(details)
        add(ProfileBand.LookingFor)
    }
}

/** Rows in order. One without a value is left out (rule 1 of 16 section 6.7). */
private class FactRows(
    private val res: Resources,
) {
    val items = mutableListOf<ProfileRowFact>()

    fun add(
        label: Int,
        value: String?,
    ) {
        if (!value.isNullOrBlank()) items += ProfileRowFact(res.getString(label), value)
    }

    fun locked(label: Int) {
        items += ProfileRowFact(res.getString(label), null)
    }
}

private class DetailFacts(
    private val detail: ProfileDetail,
    private val ref: Reference,
    private val res: Resources,
) {
    private val locked = detail.locked.toSet()
    private val female = detail.card.gender == Gender.FEMALE

    private fun group(
        key: String,
        title: Int,
        rows: FactRows,
        wholeLocked: Boolean = false,
        aboutFamily: String? = null,
        hobbies: List<String> = emptyList(),
    ): ProfileGroup =
        ProfileGroup(
            key = key,
            title = res.getString(title),
            rows = rows.items,
            locked = wholeLocked,
            aboutFamily = aboutFamily,
            hobbies = hobbies,
        )

    fun basics(): ProfileGroup {
        val basics = detail.basics
        val rows = FactRows(res)
        rows.add(R.string.profile_rows_marital_status, ref.option(Lists.MARITAL_STATUS, basics.maritalStatus))
        rows.add(R.string.profile_rows_children, children())
        basics.currentWivesCount?.let {
            rows.add(R.string.profile_rows_current_wives, res.plural(R.plurals.profile_rows_current_wives_value, it))
        }
        rows.add(R.string.profile_rows_height, Formatters.height(res, basics.heightCm))
        basics.weightKg?.let {
            rows.add(R.string.profile_rows_weight, res.text(R.string.profile_rows_weight_value, "value" to it))
        }
        rows.add(R.string.profile_rows_complexion, ref.option(Lists.COMPLEXION, basics.complexion))
        rows.add(R.string.profile_rows_build, ref.option(Lists.BODY_TYPE, basics.bodyType))
        return group("basics", R.string.profile_blocks_basics, rows)
    }

    private fun children(): String? {
        val basics = detail.basics
        val pronoun = res.getString(if (female) R.string.profile_pronoun_female else R.string.profile_pronoun_male)
        val status = basics.childrenStatus ?: return null
        val count = basics.childrenCount
        return when {
            status == ChildrenStatus.NONE -> {
                res.getString(R.string.profile_rows_children_none)
            }

            count != null && status == ChildrenStatus.LIVING_WITH_ME -> {
                res.plural(R.plurals.profile_rows_children_with, count, "pronoun" to pronoun)
            }

            count != null && status == ChildrenStatus.NOT_LIVING_WITH_ME -> {
                res.plural(R.plurals.profile_rows_children_without, count, "pronoun" to pronoun)
            }

            else -> {
                ref.option(Lists.CHILDREN_STATUS, status)
            }
        }
    }

    fun community(): ProfileGroup {
        val community = detail.community
        val rows = FactRows(res)
        rows.add(R.string.profile_rows_religion, ref.religion(community.religionCode))
        rows.add(R.string.profile_rows_sect, community.sectCode?.let { ref.sect(it) })
        if (LockedGroup.CASTE in locked) {
            rows.locked(R.string.shared_locked_group_caste)
        } else {
            rows.add(
                R.string.profile_rows_caste,
                community.casteLabel?.let { caste -> community.subCasteLabel?.let { "$caste ($it)" } ?: caste },
            )
        }
        rows.add(R.string.profile_rows_mother_tongue, ref.language(community.motherTongueCode))
        rows.add(
            R.string.profile_rows_other_languages,
            community.languageCodes.filter { it != community.motherTongueCode }.joinToString(", ") { ref.language(it) },
        )
        return group("community", R.string.profile_blocks_community, rows)
    }

    fun location(): ProfileGroup {
        val location = detail.location
        val rows = FactRows(res)
        rows.add(
            R.string.profile_rows_lives_in,
            joined(location.cityName, location.regionName, ref.country(location.countryCode)),
        )
        if (LockedGroup.AREA in locked) {
            rows.locked(R.string.shared_locked_group_area)
        } else {
            rows.add(R.string.profile_rows_area, location.area)
        }
        rows.add(R.string.profile_rows_nationality, location.nationalityCode?.let { ref.country(it) })
        rows.add(R.string.profile_rows_residency, ref.option(Lists.RESIDENCY_STATUS, location.residencyStatus))
        rows.add(R.string.profile_rows_home_town, location.originLabel)
        rows.add(R.string.profile_rows_relocate, ref.option(Lists.RELOCATION, location.relocation))
        return group("location", R.string.profile_blocks_location, rows)
    }

    fun career(): ProfileGroup {
        val career = detail.educationCareer
        val detailsLocked = LockedGroup.CAREER_DETAILS in locked
        val rows = FactRows(res)
        rows.add(R.string.profile_rows_education_level, ref.educationLevel(career.educationLevelCode))
        rows.add(R.string.profile_rows_field, career.educationFieldCode?.let { ref.educationField(it) })
        if (detailsLocked) {
            rows.locked(R.string.shared_locked_group_career_details)
        } else {
            rows.add(R.string.profile_rows_degree, career.degreeTitle)
            rows.add(R.string.profile_rows_institute, career.instituteName)
        }
        rows.add(R.string.profile_rows_employment, ref.option(Lists.EMPLOYMENT_TYPE, career.employmentType))
        rows.add(R.string.profile_rows_profession, career.professionCode?.let { ref.profession(it) })
        if (!detailsLocked) {
            rows.add(R.string.profile_rows_job_title, career.jobTitle)
            rows.add(R.string.profile_rows_employer, career.employerName)
        }
        if (LockedGroup.INCOME in locked) {
            rows.locked(R.string.shared_locked_group_income)
        } else {
            rows.add(R.string.profile_rows_income, career.incomeBandCode?.let { ref.incomeBand(it) })
        }
        return group("education-career", R.string.profile_blocks_education_career, rows)
    }

    fun family(): ProfileGroup {
        val rows = FactRows(res)
        if (LockedGroup.FAMILY in locked) {
            return group("family", R.string.profile_blocks_family, rows, wholeLocked = true)
        }
        detail.family?.let { family ->
            rows.add(
                R.string.profile_rows_father,
                joined(family.fatherStatus?.let { ref.option(Lists.PARENT_STATUS, it) }, family.fatherOccupation),
            )
            rows.add(
                R.string.profile_rows_mother,
                joined(family.motherStatus?.let { ref.option(Lists.PARENT_STATUS, it) }, family.motherOccupation),
            )
            rows.add(R.string.profile_rows_brothers, siblings(family.brothersCount, family.brothersMarried))
            rows.add(R.string.profile_rows_sisters, siblings(family.sistersCount, family.sistersMarried))
            rows.add(R.string.profile_rows_family_type, ref.option(Lists.FAMILY_TYPE, family.familyType))
            rows.add(R.string.profile_rows_family_status, ref.option(Lists.FAMILY_CLASS, family.familyClass))
            rows.add(R.string.profile_rows_family_values, ref.option(Lists.FAMILY_VALUES, family.familyValues))
            rows.add(
                R.string.profile_rows_family_lives_in,
                joined(family.familyCityName, family.familyCountryCode?.let { ref.country(it) }),
            )
            if (LockedGroup.HOME in locked) {
                rows.locked(R.string.shared_locked_group_home)
            } else {
                val size =
                    family.homeSizeValue?.let { value ->
                        val number = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
                        "$number ${ref.option(Lists.HOME_SIZE_UNIT, family.homeSizeUnit)}".trim()
                    }
                rows.add(
                    R.string.profile_rows_home,
                    joined(
                        family.homeOwnership?.let { ref.option(Lists.HOME_OWNERSHIP, it) },
                        family.homeType?.let { ref.option(Lists.HOME_TYPE, it) },
                        size,
                    ),
                )
            }
        }
        val about = detail.aboutFamily?.takeIf { it.isNotBlank() }
        return group("family", R.string.profile_blocks_family, rows, aboutFamily = about)
    }

    /** "2, 1 married"; the count alone when none is married. */
    private fun siblings(
        count: Int?,
        married: Int?,
    ): String? =
        when {
            count == null -> null
            married == null || married <= 0 -> count.toString()
            else -> res.text(R.string.profile_rows_siblings_value, "count" to count, "married" to married)
        }

    fun lifestyle(): ProfileGroup {
        val lifestyle = detail.lifestyle
        val rows = FactRows(res)
        rows.add(R.string.profile_rows_religiosity, ref.option(Lists.RELIGIOSITY, lifestyle.religiosity))
        rows.add(R.string.profile_rows_prayers, ref.option(Lists.PRAYER_FREQUENCY, lifestyle.prayerFrequency))
        if (female) {
            rows.add(R.string.profile_rows_hijab, ref.option(Lists.HIJAB, lifestyle.hijab))
        } else {
            rows.add(R.string.profile_rows_beard, ref.option(Lists.BEARD, lifestyle.beard))
        }
        rows.add(
            R.string.profile_rows_religious_education,
            ref.option(Lists.RELIGIOUS_EDUCATION, lifestyle.religiousEducation),
        )
        rows.add(R.string.profile_rows_smoking, ref.option(Lists.SMOKING, lifestyle.smoking))
        rows.add(R.string.profile_rows_living, ref.option(Lists.LIVING_ARRANGEMENT, lifestyle.livingArrangement))
        rows.add(R.string.profile_rows_work, ref.option(Lists.WORK_AFTER_MARRIAGE, lifestyle.workAfterMarriage))
        rows.add(R.string.profile_rows_timeline, ref.option(Lists.MARRIAGE_TIMELINE, lifestyle.marriageTimeline))
        rows.add(R.string.profile_rows_jahez, ref.option(Lists.JAHEZ_STANCE, lifestyle.jahezStance))
        if (LockedGroup.HEALTH in locked) {
            rows.locked(R.string.shared_locked_group_health)
        } else {
            rows.add(R.string.profile_rows_blood_group, ref.option(Lists.BLOOD_GROUP, lifestyle.bloodGroup))
            rows.add(
                R.string.profile_rows_disability,
                lifestyle.disability?.let { joined(ref.option(Lists.DISABILITY, it), lifestyle.disabilityDetails) },
            )
        }
        val hobbies = lifestyle.hobbyCodes.map { ref.hobby(it) }
        return group("lifestyle", R.string.profile_blocks_lifestyle, rows, hobbies = hobbies)
    }

    private fun joined(vararg parts: String?): String = parts.filterNot { it.isNullOrBlank() }.joinToString(", ")
}

/**
 * The values of a looking-for line (16 section 6.7, 10 section 11.1): labels joined with commas,
 * an age pair as "25 to 32 years", a height pair with open bounds, a single rank as "At least".
 */
internal fun lookingForValues(
    dimension: String,
    values: List<String>,
    ref: Reference,
    res: Resources,
    viewerGender: Gender?,
): String {
    fun options(list: String) = values.joinToString(", ") { ref.option(list, it) }
    return when (dimension) {
        "age" -> {
            res.text(R.string.profile_looking_for_age, "min" to values.getOrNull(0), "max" to values.getOrNull(1))
        }

        "height" -> {
            val min = values.getOrNull(0)?.toIntOrNull()?.let { Formatters.height(res, it) }
            val max = values.getOrNull(1)?.toIntOrNull()?.let { Formatters.height(res, it) }
            when {
                min != null && max != null -> res.text(R.string.profile_looking_for_range, "min" to min, "max" to max)
                min != null -> res.text(R.string.profile_looking_for_at_least, "value" to min)
                max != null -> res.text(R.string.profile_looking_for_up_to, "value" to max)
                else -> ""
            }
        }

        "education" -> {
            res.text(R.string.profile_looking_for_at_least, "value" to ref.educationLevel(values.firstOrNull()))
        }

        "income" -> {
            val rank = values.firstOrNull()?.toIntOrNull()
            val band = ref.data.incomeBands.firstOrNull { it.currencyCode == "PKR" && it.rank == rank }
            if (band != null) {
                incomeMinLabel(res, band.label)
            } else {
                res.text(R.string.profile_looking_for_at_least, "value" to values.firstOrNull().orEmpty())
            }
        }

        "location", "profession", "family" -> {
            values.joinToString(", ") { entry ->
                val prefix = entry.substringBefore(':', missingDelimiterValue = "")
                val value = entry.substringAfter(':')
                when {
                    prefix.isEmpty() -> entry
                    dimension == "location" && prefix == "country" -> ref.country(value)
                    dimension == "profession" && prefix == "employment" -> ref.option(Lists.EMPLOYMENT_TYPE, value)
                    dimension == "profession" && prefix == "profession" -> ref.profession(value)
                    dimension == "family" && prefix == "values" -> ref.option(Lists.FAMILY_VALUES, value)
                    dimension == "family" && prefix == "type" -> ref.option(Lists.FAMILY_TYPE, value)
                    else -> value
                }
            }
        }

        "appearance" -> {
            options(if (viewerGender == Gender.FEMALE) Lists.HIJAB else Lists.BEARD)
        }

        "marital_status" -> {
            options(Lists.MARITAL_STATUS)
        }

        "children" -> {
            options(Lists.CHILDREN_ACCEPTANCE)
        }

        "religiosity" -> {
            options(Lists.RELIGIOSITY)
        }

        "living_arrangement" -> {
            options(Lists.LIVING_ARRANGEMENT)
        }

        "work_after_marriage" -> {
            options(Lists.WORK_AFTER_MARRIAGE)
        }

        "smoking" -> {
            options(Lists.SMOKING)
        }

        "religion" -> {
            values.joinToString(", ") { ref.religion(it) }
        }

        "sect" -> {
            values.joinToString(", ") { ref.sect(it) }
        }

        "caste" -> {
            values.joinToString(", ") { ref.caste(it) }
        }

        "mother_tongue" -> {
            values.joinToString(", ") { ref.language(it) }
        }

        else -> {
            values.joinToString(", ")
        }
    }
}

private val BELOW = Regex("^\\s*below\\b", RegexOption.IGNORE_CASE)
private val AMOUNT = Regex("\\d[\\d,.]*")

/** "At least 100,000 PKR a month or the equivalent abroad" for a PKR band (05 section 10.3). */
private fun incomeMinLabel(
    res: Resources,
    bandLabel: String,
): String {
    val amount = if (BELOW.containsMatchIn(bandLabel)) null else AMOUNT.find(bandLabel)?.value
    return if (amount != null) {
        res.text(R.string.discovery_search_income_option, "amount" to amount)
    } else {
        res.text(R.string.discovery_search_income_option_lowest, "label" to bandLabel)
    }
}
