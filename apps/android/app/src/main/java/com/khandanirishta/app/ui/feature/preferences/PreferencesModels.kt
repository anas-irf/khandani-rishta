package com.khandanirishta.app.ui.feature.preferences

import androidx.compose.runtime.Immutable
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Beard
import com.khandanirishta.app.core.network.generated.model.ChildrenAcceptance
import com.khandanirishta.app.core.network.generated.model.EmploymentType
import com.khandanirishta.app.core.network.generated.model.FamilyType
import com.khandanirishta.app.core.network.generated.model.FamilyValues
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Hijab
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.LivingArrangement
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Religiosity
import com.khandanirishta.app.core.network.generated.model.Smoking
import com.khandanirishta.app.core.network.generated.model.WorkAfterMarriage
import com.khandanirishta.app.core.network.serialization.WireEnum
import com.khandanirishta.app.ui.feature.profilesections.FieldIssue
import com.khandanirishta.app.ui.feature.profilesections.FormRules
import com.khandanirishta.app.ui.feature.profilesections.trimmed
import com.khandanirishta.app.ui.feature.profilesections.wireCode
import com.khandanirishta.app.ui.feature.profilesections.wireOf
import com.khandanirishta.app.ui.feature.profilesections.wiresOf
import com.khandanirishta.app.ui.messages.UiText

/** The matching dimensions of 07 section 11.2, each with one importance control. */
enum class Dimension(
    val key: String,
    val tier: Int,
) {
    AGE("age", 1),
    MARITAL_STATUS("marital_status", 1),
    RELIGION("religion", 1),
    SECT("sect", 1),
    LOCATION("location", 1),
    EDUCATION("education", 1),
    HEIGHT("height", 2),
    CHILDREN("children", 2),
    CASTE("caste", 2),
    MOTHER_TONGUE("mother_tongue", 2),
    PROFESSION("profession", 2),
    INCOME("income", 2),
    RELIGIOSITY("religiosity", 2),
    APPEARANCE("appearance", 2),
    FAMILY("family", 2),
    LIVING_ARRANGEMENT("living_arrangement", 2),
    WORK_AFTER_MARRIAGE("work_after_marriage", 2),
    SMOKING("smoking", 2),
    ;

    /** The form field (and API key) of the importance control. */
    val importanceField: String get() = "${key}_importance"
}

const val AGE_MIN = 18
const val AGE_MAX = 80

/** The partner preferences form (07 section 11). Closed lists are wire codes. */
@Immutable
data class PreferencesInput(
    val ageMin: Int = AGE_MIN,
    val ageMax: Int = AGE_MAX,
    val heightMin: Int? = null,
    val heightMax: Int? = null,
    val maritalStatuses: Set<String> = emptySet(),
    val religionCodes: Set<String> = emptySet(),
    val sectCodes: Set<String> = emptySet(),
    val countryCodes: Set<String> = emptySet(),
    val regionIds: Set<Int> = emptySet(),
    val cityIds: Set<Int> = emptySet(),
    val educationMinRank: Int? = null,
    val childrenAcceptance: String = "any",
    val casteCodes: Set<String> = emptySet(),
    val motherTongueCodes: Set<String> = emptySet(),
    val employmentTypes: Set<String> = emptySet(),
    val professionCodes: Set<String> = emptySet(),
    val incomeMinRank: Int? = null,
    val religiosityLevels: Set<String> = emptySet(),
    val hijabTypes: Set<String> = emptySet(),
    val beardTypes: Set<String> = emptySet(),
    val familyValues: Set<String> = emptySet(),
    val familyTypes: Set<String> = emptySet(),
    val livingArrangements: Set<String> = emptySet(),
    val workAfterMarriageOptions: Set<String> = emptySet(),
    val smokingOptions: Set<String> = emptySet(),
    val notes: String = "",
    val importance: Map<Dimension, Importance> = emptyMap(),
) {
    fun importanceOf(dimension: Dimension): Importance = importance[dimension] ?: Importance.MEDIUM

    /**
     * Whether a row states a preference. A row without one has its importance control disabled
     * (07 section 11.3 rule 1): an empty selection, "Any", `null` bounds or the full age range.
     */
    fun hasPreference(
        dimension: Dimension,
        candidateGender: Gender?,
    ): Boolean =
        when (dimension) {
            Dimension.AGE -> {
                ageMin != AGE_MIN || ageMax != AGE_MAX
            }

            Dimension.MARITAL_STATUS -> {
                maritalStatuses.isNotEmpty()
            }

            Dimension.RELIGION -> {
                religionCodes.isNotEmpty()
            }

            Dimension.SECT -> {
                sectCodes.isNotEmpty()
            }

            Dimension.LOCATION -> {
                countryCodes.isNotEmpty() || regionIds.isNotEmpty() || cityIds.isNotEmpty()
            }

            Dimension.EDUCATION -> {
                educationMinRank != null
            }

            Dimension.HEIGHT -> {
                heightMin != null || heightMax != null
            }

            Dimension.CHILDREN -> {
                childrenAcceptance != "any"
            }

            Dimension.CASTE -> {
                casteCodes.isNotEmpty()
            }

            Dimension.MOTHER_TONGUE -> {
                motherTongueCodes.isNotEmpty()
            }

            Dimension.PROFESSION -> {
                employmentTypes.isNotEmpty() || professionCodes.isNotEmpty()
            }

            Dimension.INCOME -> {
                incomeMinRank != null
            }

            Dimension.RELIGIOSITY -> {
                religiosityLevels.isNotEmpty()
            }

            Dimension.APPEARANCE -> {
                if (candidateGender == Gender.FEMALE) beardTypes.isNotEmpty() else hijabTypes.isNotEmpty()
            }

            Dimension.FAMILY -> {
                familyValues.isNotEmpty() || familyTypes.isNotEmpty()
            }

            Dimension.LIVING_ARRANGEMENT -> {
                livingArrangements.isNotEmpty()
            }

            Dimension.WORK_AFTER_MARRIAGE -> {
                workAfterMarriageOptions.isNotEmpty()
            }

            Dimension.SMOKING -> {
                smokingOptions.isNotEmpty()
            }
        }

    /** Rows with a preference whose importance is "Must have" (07 section 11.3 rules 3 and 4). */
    fun mustHaveCount(candidateGender: Gender?): Int =
        Dimension.entries.count { importanceOf(it) == Importance.MUST && hasPreference(it, candidateGender) }

    companion object {
        fun from(preferences: Preferences): PreferencesInput =
            with(preferences) {
                PreferencesInput(
                    ageMin = ageMin,
                    ageMax = ageMax,
                    heightMin = heightMinCm,
                    heightMax = heightMaxCm,
                    maritalStatuses = maritalStatuses.codes(),
                    religionCodes = religionCodes.toCollection(LinkedHashSet()),
                    sectCodes = sectCodes.toCollection(LinkedHashSet()),
                    countryCodes = countryCodes.toCollection(LinkedHashSet()),
                    regionIds = regionIds.toCollection(LinkedHashSet()),
                    cityIds = cityIds.toCollection(LinkedHashSet()),
                    educationMinRank = educationMinRank,
                    childrenAcceptance = childrenAcceptance.wireCode ?: "any",
                    casteCodes = casteCodes.toCollection(LinkedHashSet()),
                    motherTongueCodes = motherTongueCodes.toCollection(LinkedHashSet()),
                    employmentTypes = employmentTypes.codes(),
                    professionCodes = professionCodes.toCollection(LinkedHashSet()),
                    incomeMinRank = incomeMinRank,
                    religiosityLevels = religiosityLevels.codes(),
                    hijabTypes = hijabTypes.codes(),
                    beardTypes = beardTypes.codes(),
                    familyValues = familyValues.codes(),
                    familyTypes = familyTypes.codes(),
                    livingArrangements = livingArrangements.codes(),
                    workAfterMarriageOptions = workAfterMarriageOptions.codes(),
                    smokingOptions = smokingOptions.codes(),
                    notes = notes.orEmpty(),
                    importance =
                        mapOf(
                            Dimension.AGE to ageImportance,
                            Dimension.MARITAL_STATUS to maritalStatusImportance,
                            Dimension.RELIGION to religionImportance,
                            Dimension.SECT to sectImportance,
                            Dimension.LOCATION to locationImportance,
                            Dimension.EDUCATION to educationImportance,
                            Dimension.HEIGHT to heightImportance,
                            Dimension.CHILDREN to childrenImportance,
                            Dimension.CASTE to casteImportance,
                            Dimension.MOTHER_TONGUE to motherTongueImportance,
                            Dimension.PROFESSION to professionImportance,
                            Dimension.INCOME to incomeImportance,
                            Dimension.RELIGIOSITY to religiosityImportance,
                            Dimension.APPEARANCE to appearanceImportance,
                            Dimension.FAMILY to familyImportance,
                            Dimension.LIVING_ARRANGEMENT to livingArrangementImportance,
                            Dimension.WORK_AFTER_MARRIAGE to workAfterMarriageImportance,
                            Dimension.SMOKING to smokingImportance,
                        ).mapValues { (_, value) -> if (value == Importance.UNKNOWN) Importance.MEDIUM else value },
                )
            }
    }

    /**
     * The full `Preferences` to send (07 section 11.1). The appearance list that does not apply
     * to the candidate is sent empty, `married` is kept only for a female candidate (11.4 rule 4),
     * and sects are kept only for the selected religions.
     */
    fun toBody(
        candidateGender: Gender?,
        reference: Reference?,
    ): Preferences {
        val female = candidateGender == Gender.FEMALE
        val allowedSects =
            reference
                ?.data
                ?.religions
                ?.filter { it.code in religionCodes }
                ?.flatMap { religion -> religion.sects.map { it.code } }
                ?.toSet()
        return Preferences(
            ageImportance = importanceOf(Dimension.AGE),
            ageMax = ageMax,
            ageMin = ageMin,
            appearanceImportance = importanceOf(Dimension.APPEARANCE),
            beardTypes = if (female) wiresOf<Beard>(beardTypes) else emptyList(),
            casteCodes = casteCodes.toList(),
            casteImportance = importanceOf(Dimension.CASTE),
            childrenAcceptance = wireOf<ChildrenAcceptance>(childrenAcceptance) ?: ChildrenAcceptance.ANY,
            childrenImportance = importanceOf(Dimension.CHILDREN),
            cityIds = cityIds.toList(),
            countryCodes = countryCodes.toList(),
            educationImportance = importanceOf(Dimension.EDUCATION),
            educationMinRank = educationMinRank,
            employmentTypes = wiresOf<EmploymentType>(employmentTypes),
            familyImportance = importanceOf(Dimension.FAMILY),
            familyTypes = wiresOf<FamilyType>(familyTypes),
            familyValues = wiresOf<FamilyValues>(familyValues),
            heightImportance = importanceOf(Dimension.HEIGHT),
            heightMaxCm = heightMax,
            heightMinCm = heightMin,
            hijabTypes = if (female) emptyList() else wiresOf<Hijab>(hijabTypes),
            incomeImportance = importanceOf(Dimension.INCOME),
            incomeMinRank = incomeMinRank,
            livingArrangementImportance = importanceOf(Dimension.LIVING_ARRANGEMENT),
            livingArrangements = wiresOf<LivingArrangement>(livingArrangements),
            locationImportance = importanceOf(Dimension.LOCATION),
            maritalStatusImportance = importanceOf(Dimension.MARITAL_STATUS),
            maritalStatuses = wiresOf<MaritalStatus>(if (female) maritalStatuses else maritalStatuses - "married"),
            motherTongueCodes = motherTongueCodes.toList(),
            motherTongueImportance = importanceOf(Dimension.MOTHER_TONGUE),
            notes = trimmed(notes),
            professionCodes = professionCodes.toList(),
            professionImportance = importanceOf(Dimension.PROFESSION),
            regionIds = regionIds.toList(),
            religionCodes = religionCodes.toList(),
            religionImportance = importanceOf(Dimension.RELIGION),
            religiosityImportance = importanceOf(Dimension.RELIGIOSITY),
            religiosityLevels = wiresOf<Religiosity>(religiosityLevels),
            sectCodes = sectCodes.filter { allowedSects == null || it in allowedSects },
            sectImportance = importanceOf(Dimension.SECT),
            smokingImportance = importanceOf(Dimension.SMOKING),
            smokingOptions = wiresOf<Smoking>(smokingOptions),
            workAfterMarriageImportance = importanceOf(Dimension.WORK_AFTER_MARRIAGE),
            workAfterMarriageOptions = wiresOf<WorkAfterMarriage>(workAfterMarriageOptions),
        )
    }
}

private fun List<WireEnum>.codes(): Set<String> = mapNotNull { it.wireCode }.toCollection(LinkedHashSet())

/** The client rules of 07 sections 11.4 and 16.8, and where the API's field errors go. */
class PreferencesRules(
    private val candidateGender: Gender?,
    private val sectsAvailable: (Set<String>) -> Boolean,
) : FormRules<PreferencesInput> {
    override fun validate(values: PreferencesInput): List<FieldIssue> {
        val issues = mutableListOf<FieldIssue>()

        fun add(
            field: String,
            message: Int,
        ) {
            if (issues.none { it.field == field }) issues += FieldIssue(field, UiText.of(message))
        }
        val ages = AGE_MIN..AGE_MAX
        if (values.ageMin !in ages || values.ageMax !in ages) {
            add("age", R.string.preferences_errors_age_min_out_of_range)
        } else if (values.ageMin > values.ageMax) {
            add("age", R.string.preferences_errors_age_min_invalid)
        }
        val min = values.heightMin
        val max = values.heightMax
        if (min != null && max != null && min > max) add("height", R.string.preferences_errors_height_min_cm_invalid)
        if (values.casteCodes.size > CASTES_MAX) add("caste_codes", R.string.preferences_errors_caste_codes_too_long)
        if (values.countryCodes.size > PLACES_MAX) {
            add("country_codes", R.string.preferences_errors_country_codes_too_long)
        }
        if (values.regionIds.size > PLACES_MAX) add("region_ids", R.string.preferences_errors_region_ids_too_long)
        if (values.cityIds.size > PLACES_MAX) add("city_ids", R.string.preferences_errors_city_ids_too_long)
        if (values.professionCodes.size > PLACES_MAX) {
            add("profession_codes", R.string.preferences_errors_profession_codes_too_long)
        }
        val notes = trimmed(values.notes)
        if (notes != null && notes.length < NOTES_MIN) add("notes", R.string.preferences_errors_notes_too_short)
        if (notes != null && notes.length > NOTES_MAX) add("notes", R.string.preferences_errors_notes_too_long)
        return issues
    }

    override fun fields(values: PreferencesInput): List<String> =
        buildList {
            fun row(
                dimension: Dimension,
                vararg fields: String,
            ) {
                addAll(fields)
                add(dimension.importanceField)
            }
            row(Dimension.AGE, "age")
            row(Dimension.MARITAL_STATUS, "marital_statuses")
            row(Dimension.RELIGION, "religion_codes")
            if (sectsAvailable(values.religionCodes)) row(Dimension.SECT, "sect_codes")
            row(Dimension.LOCATION, "country_codes", "region_ids", "city_ids")
            row(Dimension.EDUCATION, "education_min_rank")
            row(Dimension.HEIGHT, "height")
            row(Dimension.CHILDREN, "children_acceptance")
            row(Dimension.CASTE, "caste_codes")
            row(Dimension.MOTHER_TONGUE, "mother_tongue_codes")
            row(Dimension.PROFESSION, "employment_types", "profession_codes")
            row(Dimension.INCOME, "income_min_rank")
            row(Dimension.RELIGIOSITY, "religiosity_levels")
            row(Dimension.APPEARANCE, if (candidateGender == Gender.FEMALE) "beard_types" else "hijab_types")
            row(Dimension.FAMILY, "family_values", "family_types")
            row(Dimension.LIVING_ARRANGEMENT, "living_arrangements")
            row(Dimension.WORK_AFTER_MARRIAGE, "work_after_marriage_options")
            row(Dimension.SMOKING, "smoking_options")
            add("notes")
        }

    override fun fieldFor(apiField: String): String =
        when (apiField) {
            "age_min", "age_max" -> "age"
            "height_min_cm", "height_max_cm" -> "height"
            else -> apiField
        }

    override fun message(
        apiField: String,
        code: String,
    ): Int? = preferencesMessage(apiField, code)

    companion object {
        const val CASTES_MAX = 30
        const val PLACES_MAX = 20
        const val NOTES_MIN = 30
        const val NOTES_MAX = 1000

        /** Fields of the collapsed tier 2 (07 section 11.2). */
        val TIER_TWO: Set<String> =
            Dimension.entries
                .filter { it.tier == 2 }
                .map { it.importanceField }
                .toSet() +
                setOf(
                    "height",
                    "children_acceptance",
                    "caste_codes",
                    "mother_tongue_codes",
                    "employment_types",
                    "profession_codes",
                    "income_min_rank",
                    "religiosity_levels",
                    "hijab_types",
                    "beard_types",
                    "family_values",
                    "family_types",
                    "living_arrangements",
                    "work_after_marriage_options",
                    "smoking_options",
                    "notes",
                )
    }
}

/** The messages of the preference rules (07 section 16.8), by API field key and field code. */
fun preferencesMessage(
    field: String,
    code: String,
): Int? =
    when ("$field.$code") {
        "age_min.out_of_range" -> R.string.preferences_errors_age_min_out_of_range
        "age_min.invalid" -> R.string.preferences_errors_age_min_invalid
        "age_max.out_of_range" -> R.string.preferences_errors_age_max_out_of_range
        "height_min_cm.invalid" -> R.string.preferences_errors_height_min_cm_invalid
        "height_min_cm.out_of_range" -> R.string.preferences_errors_height_min_cm_out_of_range
        "height_max_cm.out_of_range" -> R.string.preferences_errors_height_max_cm_out_of_range
        "marital_statuses.not_allowed" -> R.string.preferences_errors_marital_statuses_not_allowed
        "caste_codes.too_long" -> R.string.preferences_errors_caste_codes_too_long
        "country_codes.too_long" -> R.string.preferences_errors_country_codes_too_long
        "region_ids.too_long" -> R.string.preferences_errors_region_ids_too_long
        "region_ids.mismatch" -> R.string.preferences_errors_region_ids_mismatch
        "city_ids.too_long" -> R.string.preferences_errors_city_ids_too_long
        "city_ids.mismatch" -> R.string.preferences_errors_city_ids_mismatch
        "profession_codes.too_long" -> R.string.preferences_errors_profession_codes_too_long
        "notes.too_short" -> R.string.preferences_errors_notes_too_short
        "notes.too_long" -> R.string.preferences_errors_notes_too_long
        "notes.contains_contact_info" -> R.string.preferences_errors_notes_contains_contact_info
        "notes.inappropriate" -> R.string.preferences_errors_notes_inappropriate
        else -> null
    }
