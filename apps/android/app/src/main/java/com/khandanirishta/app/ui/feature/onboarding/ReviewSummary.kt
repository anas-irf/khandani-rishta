package com.khandanirishta.app.ui.feature.onboarding

import android.content.res.Resources
import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.IdentitySummary
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.core.network.serialization.WireEnum
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.feature.preferences.Dimension
import com.khandanirishta.app.ui.feature.preferences.PreferencesInput
import com.khandanirishta.app.ui.feature.profilesections.isWorking
import com.khandanirishta.app.ui.feature.profilesections.wireCode
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import java.math.BigDecimal

/** One label and value of the review; private values say so (07 section 14.1). */
@Immutable
internal data class ReviewRow(
    val label: String,
    val value: String,
    val privateByDefault: Boolean = false,
)

/** A part of the review that is labels and values. [step] is the step that Edit opens. */
@Immutable
internal data class ReviewPart(
    val step: String,
    @param:StringRes val title: Int,
    val rows: List<ReviewRow>,
    @param:StringRes val emptyText: Int = R.string.onboarding_review_not_added_yet,
)

/** One line of "Looking for". */
@Immutable
internal data class LookingForItem(
    val dimension: Dimension,
    val text: String,
    val must: Boolean,
)

/** Everything ONB-11 shows, formatted once for the data it came from (07 section 14.1). */
@Immutable
internal data class ReviewSummary(
    val answers: List<ReviewPart>,
    val photos: List<OwnPhoto>,
    @param:StringRes val photoVisibility: Int?,
    val lookingFor: List<LookingForItem>,
    val identity: ReviewPart,
)

internal fun reviewSummary(
    profile: OwnProfile,
    preferences: Preferences,
    privacy: Privacy?,
    identity: IdentitySummary?,
    photos: List<OwnPhoto>,
    res: Resources,
    reference: Reference,
): ReviewSummary {
    val answers =
        listOf(
            ReviewPart(
                step = "account_for",
                title = R.string.onboarding_review_cards_account_for,
                rows = accountRows(profile, res, reference),
            ),
            ReviewPart(
                step = "basics",
                title = R.string.onboarding_review_cards_basics,
                rows = basicsRows(profile, res, reference),
            ),
            ReviewPart(
                step = "community",
                title = R.string.onboarding_review_cards_community,
                rows = communityRows(profile, res, reference),
            ),
            ReviewPart(
                step = "location",
                title = R.string.onboarding_review_cards_location,
                rows = locationRows(profile, res, reference),
            ),
            ReviewPart(
                step = "education_career",
                title = R.string.onboarding_review_cards_education_career,
                rows = educationRows(profile, res, reference),
            ),
            ReviewPart(
                step = "family",
                title = R.string.onboarding_review_cards_family,
                rows = familyRows(profile, res, reference),
            ),
            ReviewPart(
                step = "lifestyle",
                title = R.string.onboarding_review_cards_lifestyle,
                rows = lifestyleRows(profile, res, reference),
            ),
        )
    return ReviewSummary(
        answers = answers,
        photos = photos.sortedBy { it.position },
        photoVisibility = privacy?.let { photoVisibilityTitle(it.photoVisibility.wireCode) },
        lookingFor = lookingFor(preferences, profile.basics.gender, res, reference),
        identity =
            ReviewPart(
                step = "identity",
                title = R.string.onboarding_review_cards_identity,
                rows = identityRows(identity, res, reference),
                emptyText = R.string.onboarding_review_not_added,
            ),
    )
}

/** One line per dimension that has a preference. */
private fun lookingFor(
    preferences: Preferences,
    gender: Gender?,
    res: Resources,
    reference: Reference,
): List<LookingForItem> {
    val values = PreferencesInput.from(preferences)
    return Dimension.entries.filter { values.hasPreference(it, gender) }.map { dimension ->
        LookingForItem(
            dimension = dimension,
            text = lookingForLine(dimension, values, gender, reference, res),
            must = values.importanceOf(dimension) == Importance.MUST,
        )
    }
}

/** Collects the rows of a part; empty values are left out. */
private class RowsBuilder(
    private val res: Resources,
    private val reference: Reference,
) {
    val rows = mutableListOf<ReviewRow>()

    fun add(
        label: Int,
        value: String?,
        locked: Boolean = false,
    ) {
        if (!value.isNullOrBlank()) rows += ReviewRow(res.getString(label), value, locked)
    }

    /** The label of a closed-list value. */
    fun option(
        label: Int,
        list: String,
        value: WireEnum?,
        locked: Boolean = false,
    ) = add(label, reference.option(list, value), locked)
}

private fun rows(
    res: Resources,
    reference: Reference,
    build: RowsBuilder.() -> Unit,
): List<ReviewRow> = RowsBuilder(res, reference).apply(build).rows

private fun accountRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val account = profile.accountFor
        option(R.string.onboarding_review_labels_managed_by, Lists.MANAGED_BY, account.managedBy)
        if (account.managedBy != ManagedBy.SELF) {
            add(R.string.onboarding_review_labels_manager_name, account.managerName)
        }
    }

private fun basicsRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val basics = profile.basics
        val status = basics.maritalStatus.wireCode
        add(
            R.string.onboarding_review_labels_full_name,
            listOfNotNull(basics.firstName, basics.lastName).joinToString(" "),
        )
        option(R.string.onboarding_review_labels_gender, Lists.GENDER, basics.gender)
        basics.dateOfBirth?.let { date ->
            val value =
                res.text(
                    R.string.onboarding_review_labels_date_of_birth_value,
                    "date" to Formatters.longDate(date),
                    "age" to Formatters.ageFrom(date),
                )
            add(R.string.onboarding_review_labels_date_of_birth, value)
        }
        option(R.string.onboarding_review_labels_marital_status, Lists.MARITAL_STATUS, basics.maritalStatus)
        if (status == "married") {
            add(R.string.onboarding_review_labels_current_wives_count, basics.currentWivesCount?.toString())
        }
        if (status != null && status != "never_married" && basics.childrenStatus != null) {
            val children = reference.option(Lists.CHILDREN_STATUS, basics.childrenStatus)
            val value =
                basics.childrenCount?.let { count ->
                    res.text(R.string.onboarding_review_labels_children_value, "status" to children, "count" to count)
                } ?: children
            add(R.string.onboarding_review_labels_children, value)
        }
        add(R.string.onboarding_review_labels_height, basics.heightCm?.let { Formatters.height(res, it) })
    }

private fun communityRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val community = profile.community
        add(R.string.onboarding_review_labels_religion, reference.religion(community.religionCode))
        add(R.string.onboarding_review_labels_sect, reference.sect(community.sectCode))
        add(
            R.string.onboarding_review_labels_caste,
            community.casteCode?.let { reference.caste(it) } ?: community.casteOther,
        )
        add(
            R.string.onboarding_review_labels_sub_caste,
            community.subCasteCode?.let { reference.subCaste(it) } ?: community.subCasteOther,
        )
        add(R.string.onboarding_review_labels_mother_tongue, reference.language(community.motherTongueCode))
        add(
            R.string.onboarding_review_labels_languages,
            community.languageCodes.orEmpty().joinToString(", ") { reference.language(it) },
        )
    }

private fun locationRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val location = profile.location
        add(R.string.onboarding_review_labels_city, location.city?.name ?: location.cityOther)
        add(R.string.onboarding_review_labels_region, location.city?.regionName)
        add(R.string.onboarding_review_labels_country, reference.country(location.countryCode))
        add(R.string.onboarding_review_labels_area, location.area, locked = true)
        add(R.string.onboarding_review_labels_nationality, reference.country(location.nationalityCode))
        if (location.countryCode != location.nationalityCode) {
            option(R.string.onboarding_review_labels_residency, Lists.RESIDENCY_STATUS, location.residencyStatus)
        }
        add(R.string.onboarding_review_labels_origin, location.originCity?.name ?: location.originOther)
        option(R.string.onboarding_review_labels_relocation, Lists.RELOCATION, location.relocation)
    }

private fun educationRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val education = profile.educationCareer
        add(R.string.onboarding_review_labels_education_level, reference.educationLevel(education.educationLevelCode))
        add(R.string.onboarding_review_labels_education_field, reference.educationField(education.educationFieldCode))
        add(R.string.onboarding_review_labels_degree_title, education.degreeTitle)
        add(R.string.onboarding_review_labels_institute_name, education.instituteName, locked = true)
        option(R.string.onboarding_review_labels_employment_type, Lists.EMPLOYMENT_TYPE, education.employmentType)
        if (isWorking(education.employmentType.wireCode)) {
            add(R.string.onboarding_review_labels_profession, reference.profession(education.professionCode))
            add(R.string.onboarding_review_labels_job_title, education.jobTitle)
            add(R.string.onboarding_review_labels_employer_name, education.employerName, locked = true)
            add(R.string.onboarding_review_labels_income, reference.incomeBand(education.incomeBandCode), locked = true)
        }
    }

private fun familyRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val family = profile.family

        fun siblings(
            count: Int?,
            married: Int?,
        ): String? =
            when {
                count == null -> {
                    null
                }

                married != null && count > 0 -> {
                    res.text(R.string.onboarding_review_labels_siblings_value, "count" to count, "married" to married)
                }

                else -> {
                    count.toString()
                }
            }
        option(R.string.profile_sections_family_father_status_label, Lists.PARENT_STATUS, family.fatherStatus)
        add(R.string.profile_sections_family_father_occupation_label, family.fatherOccupation)
        option(R.string.profile_sections_family_mother_status_label, Lists.PARENT_STATUS, family.motherStatus)
        add(R.string.profile_sections_family_mother_occupation_label, family.motherOccupation)
        add(
            R.string.profile_sections_family_brothers_count_label,
            siblings(family.brothersCount, family.brothersMarried),
        )
        add(R.string.profile_sections_family_sisters_count_label, siblings(family.sistersCount, family.sistersMarried))
        option(R.string.profile_sections_family_family_type_label, Lists.FAMILY_TYPE, family.familyType)
        option(R.string.profile_sections_family_family_class_label, Lists.FAMILY_CLASS, family.familyClass)
        option(R.string.profile_sections_family_family_values_label, Lists.FAMILY_VALUES, family.familyValues)
        add(R.string.profile_sections_family_family_country_label, reference.country(family.familyCountryCode))
        option(
            R.string.profile_sections_family_home_ownership_label,
            Lists.HOME_OWNERSHIP,
            family.homeOwnership,
            locked = true,
        )
        option(R.string.profile_sections_family_home_type_label, Lists.HOME_TYPE, family.homeType, locked = true)
        family.homeSizeValue?.let { size ->
            val value =
                BigDecimal.valueOf(size).stripTrailingZeros().toPlainString() + " " +
                    reference.option(Lists.HOME_SIZE_UNIT, family.homeSizeUnit)
            add(R.string.profile_sections_family_home_size_label, value, locked = true)
        }
        add(R.string.profile_sections_family_about_family_label, family.aboutFamily)
    }

private fun lifestyleRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val lifestyle = profile.lifestyle
        option(R.string.onboarding_review_labels_religiosity, Lists.RELIGIOSITY, lifestyle.religiosity)
        option(R.string.onboarding_review_labels_prayer_frequency, Lists.PRAYER_FREQUENCY, lifestyle.prayerFrequency)
        option(R.string.onboarding_review_labels_hijab, Lists.HIJAB, lifestyle.hijab)
        option(R.string.onboarding_review_labels_beard, Lists.BEARD, lifestyle.beard)
        option(
            R.string.onboarding_review_labels_religious_education,
            Lists.RELIGIOUS_EDUCATION,
            lifestyle.religiousEducation,
        )
        option(R.string.onboarding_review_labels_smoking, Lists.SMOKING, lifestyle.smoking)
        option(
            R.string.onboarding_review_labels_living_arrangement,
            Lists.LIVING_ARRANGEMENT,
            lifestyle.livingArrangement,
        )
        option(
            R.string.onboarding_review_labels_work_after_marriage,
            Lists.WORK_AFTER_MARRIAGE,
            lifestyle.workAfterMarriage,
        )
        option(R.string.onboarding_review_labels_marriage_timeline, Lists.MARRIAGE_TIMELINE, lifestyle.marriageTimeline)
        option(R.string.onboarding_review_labels_jahez_stance, Lists.JAHEZ_STANCE, lifestyle.jahezStance)
        add(
            R.string.onboarding_review_labels_weight,
            lifestyle.weightKg?.let { res.text(R.string.onboarding_review_labels_weight_value, "kg" to it) },
        )
        option(R.string.onboarding_review_labels_complexion, Lists.COMPLEXION, lifestyle.complexion)
        option(R.string.onboarding_review_labels_body_type, Lists.BODY_TYPE, lifestyle.bodyType)
        option(R.string.onboarding_review_labels_blood_group, Lists.BLOOD_GROUP, lifestyle.bloodGroup, locked = true)
        val disability =
            listOfNotNull(
                reference.option(Lists.DISABILITY, lifestyle.disability).ifEmpty { null },
                lifestyle.disabilityDetails,
            ).joinToString(": ")
        add(R.string.onboarding_review_labels_disability, disability, locked = true)
        add(
            R.string.onboarding_review_labels_hobbies,
            lifestyle.hobbyCodes.orEmpty().joinToString(", ") { reference.hobby(it) },
        )
        add(R.string.onboarding_review_labels_about_me, lifestyle.aboutMe?.take(ABOUT_PREVIEW))
    }

private fun identityRows(
    identity: IdentitySummary?,
    res: Resources,
    reference: Reference,
): List<ReviewRow> {
    if (identity == null) return emptyList()
    return rows(res, reference) {
        option(R.string.onboarding_review_labels_document, Lists.DOCUMENT_TYPE, identity.documentType)
        add(R.string.onboarding_review_labels_number, identity.numberMasked)
    }
}

private fun lookingForLine(
    dimension: Dimension,
    values: PreferencesInput,
    gender: Gender?,
    reference: Reference,
    res: Resources,
): String {
    fun join(
        list: String,
        codes: Collection<String>,
    ) = codes.joinToString(", ") { reference.option(list, it) }

    fun line(
        id: Int,
        list: String,
        codes: Collection<String>,
    ) = res.text(id, "values" to join(list, codes))
    return when (dimension) {
        Dimension.AGE -> {
            res.text(R.string.onboarding_review_looking_for_age, "min" to values.ageMin, "max" to values.ageMax)
        }

        Dimension.MARITAL_STATUS -> {
            line(R.string.onboarding_review_looking_for_marital_status, Lists.MARITAL_STATUS, values.maritalStatuses)
        }

        Dimension.RELIGION -> {
            res.text(
                R.string.onboarding_review_looking_for_religion,
                "values" to values.religionCodes.joinToString(", ") { reference.religion(it) },
            )
        }

        Dimension.SECT -> {
            res.text(
                R.string.onboarding_review_looking_for_sect,
                "values" to values.sectCodes.joinToString(", ") { reference.sect(it) },
            )
        }

        Dimension.LOCATION -> {
            val places = values.regionIds.size + values.cityIds.size
            val parts =
                listOfNotNull(
                    values.countryCodes.joinToString(", ") { reference.country(it) }.takeIf { it.isNotEmpty() },
                    if (places > 0) res.plural(R.plurals.onboarding_review_looking_for_places_count, places) else null,
                )
            res.text(R.string.onboarding_review_looking_for_location, "values" to parts.joinToString(", "))
        }

        Dimension.EDUCATION -> {
            val level = reference.data.educationLevels.firstOrNull { it.rank == values.educationMinRank }
            val name = level?.name?.replace(BRACKETS_AT_END, "")
            val value = name?.let { res.text(R.string.preferences_rows_education_option, "name" to it) }.orEmpty()
            res.text(R.string.onboarding_review_looking_for_education, "value" to value)
        }

        Dimension.HEIGHT -> {
            val min = values.heightMin
            val max = values.heightMax
            val value =
                when {
                    min != null && max != null -> {
                        Formatters.heightShort(res, min) + " - " + Formatters.heightShort(res, max)
                    }

                    min != null -> {
                        res.text(
                            R.string.onboarding_review_looking_for_height_from,
                            "min" to Formatters.heightShort(res, min),
                        )
                    }

                    else -> {
                        res.text(
                            R.string.onboarding_review_looking_for_height_to,
                            "max" to Formatters.heightShort(res, max ?: 0),
                        )
                    }
                }
            res.text(R.string.onboarding_review_looking_for_height, "value" to value)
        }

        Dimension.CHILDREN -> {
            res.text(
                R.string.onboarding_review_looking_for_children,
                "value" to reference.option(Lists.CHILDREN_ACCEPTANCE, values.childrenAcceptance),
            )
        }

        Dimension.CASTE -> {
            res.text(
                R.string.onboarding_review_looking_for_caste,
                "values" to values.casteCodes.joinToString(", ") { reference.caste(it) },
            )
        }

        Dimension.MOTHER_TONGUE -> {
            res.text(
                R.string.onboarding_review_looking_for_mother_tongue,
                "values" to values.motherTongueCodes.joinToString(", ") { reference.language(it) },
            )
        }

        Dimension.PROFESSION -> {
            val parts =
                listOf(
                    join(Lists.EMPLOYMENT_TYPE, values.employmentTypes),
                    values.professionCodes.joinToString(", ") { reference.profession(it) },
                ).filter { it.isNotEmpty() }
            res.text(R.string.onboarding_review_looking_for_profession, "values" to parts.joinToString(", "))
        }

        Dimension.INCOME -> {
            val band =
                reference.data.incomeBands.firstOrNull { it.currencyCode == "PKR" && it.rank == values.incomeMinRank }
            val amount = band?.let { AMOUNT.find(it.label)?.value }
            val value = amount?.let { res.text(R.string.preferences_rows_income_option, "amount" to it) }.orEmpty()
            res.text(R.string.onboarding_review_looking_for_income, "value" to value)
        }

        Dimension.RELIGIOSITY -> {
            line(R.string.onboarding_review_looking_for_religiosity, Lists.RELIGIOSITY, values.religiosityLevels)
        }

        Dimension.APPEARANCE -> {
            if (gender == Gender.FEMALE) {
                line(R.string.onboarding_review_looking_for_appearance_beard, Lists.BEARD, values.beardTypes)
            } else {
                line(R.string.onboarding_review_looking_for_appearance_hijab, Lists.HIJAB, values.hijabTypes)
            }
        }

        Dimension.FAMILY -> {
            val parts =
                listOf(
                    join(Lists.FAMILY_VALUES, values.familyValues),
                    join(Lists.FAMILY_TYPE, values.familyTypes),
                ).filter { it.isNotEmpty() }
            res.text(R.string.onboarding_review_looking_for_family, "values" to parts.joinToString(", "))
        }

        Dimension.LIVING_ARRANGEMENT -> {
            line(
                R.string.onboarding_review_looking_for_living_arrangement,
                Lists.LIVING_ARRANGEMENT,
                values.livingArrangements,
            )
        }

        Dimension.WORK_AFTER_MARRIAGE -> {
            line(
                R.string.onboarding_review_looking_for_work_after_marriage,
                Lists.WORK_AFTER_MARRIAGE,
                values.workAfterMarriageOptions,
            )
        }

        Dimension.SMOKING -> {
            line(R.string.onboarding_review_looking_for_smoking, Lists.SMOKING, values.smokingOptions)
        }
    }
}

private const val ABOUT_PREVIEW = 200

/** "Professional degree (MBBS, BDS)" is "Professional degree" in a line of "Looking for". */
private val BRACKETS_AT_END = Regex("\\s*\\(.*\\)\\s*$")
private val AMOUNT = Regex("\\d[\\d,]*")
