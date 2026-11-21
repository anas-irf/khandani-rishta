package com.khandanirishta.app.ui.feature.search

import android.content.res.Resources
import androidx.annotation.StringRes
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Beard
import com.khandanirishta.app.core.network.generated.model.ChildrenAcceptance
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.core.network.generated.model.EmploymentType
import com.khandanirishta.app.core.network.generated.model.FamilyType
import com.khandanirishta.app.core.network.generated.model.FamilyValues
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Hijab
import com.khandanirishta.app.core.network.generated.model.LivingArrangement
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Religiosity
import com.khandanirishta.app.core.network.generated.model.SearchFilters
import com.khandanirishta.app.core.network.generated.model.SearchSort
import com.khandanirishta.app.core.network.generated.model.Smoking
import com.khandanirishta.app.core.network.generated.model.WorkAfterMarriage
import com.khandanirishta.app.core.network.serialization.WireEnum
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.text
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/*
 * The rules of the search form of specs/16 section 6.6 and 15 section 4.8, ported from the web's
 * search-params.ts and filter-options.ts: the groups and controls, what an untouched control
 * leaves out, the copy from the partner preferences, the profile code rule and the labels.
 */

internal const val AGE_MIN = 18
internal const val AGE_MAX = 80

/** 4 ft 0 in and 7 ft 0 in, in inches (16 section 6.6). */
internal const val HEIGHT_MIN_INCHES = 48
internal const val HEIGHT_MAX_INCHES = 84

/** A saved search name has 1 to 60 characters. */
internal const val NAME_MAX = 60

/** The code of the "Any" entry of a select; it sends nothing. */
internal const val ANY = "_any"

/** "Active" within 1, 7 or 30 days; "Joined" within 7 or 30 days. */
internal val ACTIVE_DAYS = listOf(1, 7, 30)
internal val JOINED_DAYS = listOf(7, 30)

/** The sorts in the order of the sort select. */
internal val SORTS = listOf(SearchSort.BEST_MATCH, SearchSort.NEWEST, SearchSort.RECENTLY_ACTIVE)

/** The groups of the filter form. Basics, Community and Location start expanded. */
enum class FilterGroup(
    @param:StringRes val title: Int,
    val expandedAtStart: Boolean,
) {
    BASICS(R.string.discovery_search_groups_basics, true),
    COMMUNITY(R.string.discovery_search_groups_community, true),
    LOCATION(R.string.discovery_search_groups_location, true),
    EDUCATION_WORK(R.string.discovery_search_groups_education_work, false),
    FAITH(R.string.discovery_search_groups_faith, false),
    FAMILY(R.string.discovery_search_groups_family, false),
    LIFESTYLE(R.string.discovery_search_groups_lifestyle, false),
    PROFILE(R.string.discovery_search_groups_profile, false),
}

/**
 * One control of the form and the `SearchFilters` keys it sets, as the API names them. Age and
 * height are one control each, with two keys.
 */
enum class FilterControl(
    val group: FilterGroup,
    @param:StringRes val label: Int,
    val keys: List<String>,
) {
    AGE(FilterGroup.BASICS, R.string.discovery_search_fields_age, listOf("age_min", "age_max")),
    HEIGHT(FilterGroup.BASICS, R.string.discovery_search_fields_height, listOf("height_min_cm", "height_max_cm")),
    MARITAL_STATUS(FilterGroup.BASICS, R.string.discovery_search_fields_marital_status, listOf("marital_statuses")),
    CHILDREN(FilterGroup.BASICS, R.string.discovery_search_fields_children, listOf("children_acceptance")),
    RELIGION(FilterGroup.COMMUNITY, R.string.discovery_search_fields_religion, listOf("religion_codes")),
    SECT(FilterGroup.COMMUNITY, R.string.discovery_search_fields_sect, listOf("sect_codes")),
    CASTE(FilterGroup.COMMUNITY, R.string.discovery_search_fields_caste, listOf("caste_codes")),
    MOTHER_TONGUE(FilterGroup.COMMUNITY, R.string.discovery_search_fields_mother_tongue, listOf("mother_tongue_codes")),
    COUNTRY(FilterGroup.LOCATION, R.string.discovery_search_fields_country, listOf("country_codes")),
    REGION(FilterGroup.LOCATION, R.string.discovery_search_fields_region, listOf("region_ids")),
    CITY(FilterGroup.LOCATION, R.string.discovery_search_fields_city, listOf("city_ids")),
    EDUCATION(FilterGroup.EDUCATION_WORK, R.string.discovery_search_fields_education, listOf("education_min_rank")),
    EMPLOYMENT(FilterGroup.EDUCATION_WORK, R.string.discovery_search_fields_employment, listOf("employment_types")),
    PROFESSION(FilterGroup.EDUCATION_WORK, R.string.discovery_search_fields_profession, listOf("profession_codes")),
    INCOME(FilterGroup.EDUCATION_WORK, R.string.discovery_search_fields_income, listOf("income_min_rank")),
    RELIGIOSITY(FilterGroup.FAITH, R.string.discovery_search_fields_religiosity, listOf("religiosity_levels")),
    HIJAB(FilterGroup.FAITH, R.string.discovery_search_fields_hijab, listOf("hijab_types")),
    BEARD(FilterGroup.FAITH, R.string.discovery_search_fields_beard, listOf("beard_types")),
    FAMILY_VALUES(FilterGroup.FAMILY, R.string.discovery_search_fields_family_values, listOf("family_values")),
    FAMILY_TYPE(FilterGroup.FAMILY, R.string.discovery_search_fields_family_type, listOf("family_types")),
    LIVING(FilterGroup.LIFESTYLE, R.string.discovery_search_fields_living, listOf("living_arrangements")),
    WORK(FilterGroup.LIFESTYLE, R.string.discovery_search_fields_work, listOf("work_after_marriage_options")),
    SMOKING(FilterGroup.LIFESTYLE, R.string.discovery_search_fields_smoking, listOf("smoking_options")),
    MANAGED_BY(FilterGroup.PROFILE, R.string.discovery_search_fields_managed_by, listOf("managed_by")),
    HAS_PHOTO(FilterGroup.PROFILE, R.string.discovery_search_fields_has_photo, listOf("has_photo")),
    VERIFIED_ONLY(FilterGroup.PROFILE, R.string.discovery_search_fields_verified_only, listOf("verified_only")),
    ACTIVE(FilterGroup.PROFILE, R.string.discovery_search_fields_active, listOf("active_within_days")),
    JOINED(FilterGroup.PROFILE, R.string.discovery_search_fields_joined, listOf("joined_within_days")),
    ;

    /** Whether this control has a value in [filters] (cleaned filters, see [cleaned]). */
    fun isSet(filters: SearchFilters): Boolean =
        when (this) {
            AGE -> filters.ageMin != null || filters.ageMax != null
            HEIGHT -> filters.heightMinCm != null || filters.heightMaxCm != null
            MARITAL_STATUS -> !filters.maritalStatuses.isNullOrEmpty()
            CHILDREN -> filters.childrenAcceptance != null
            RELIGION -> !filters.religionCodes.isNullOrEmpty()
            SECT -> !filters.sectCodes.isNullOrEmpty()
            CASTE -> !filters.casteCodes.isNullOrEmpty()
            MOTHER_TONGUE -> !filters.motherTongueCodes.isNullOrEmpty()
            COUNTRY -> !filters.countryCodes.isNullOrEmpty()
            REGION -> !filters.regionIds.isNullOrEmpty()
            CITY -> !filters.cityIds.isNullOrEmpty()
            EDUCATION -> filters.educationMinRank != null
            EMPLOYMENT -> !filters.employmentTypes.isNullOrEmpty()
            PROFESSION -> !filters.professionCodes.isNullOrEmpty()
            INCOME -> filters.incomeMinRank != null
            RELIGIOSITY -> !filters.religiosityLevels.isNullOrEmpty()
            HIJAB -> !filters.hijabTypes.isNullOrEmpty()
            BEARD -> !filters.beardTypes.isNullOrEmpty()
            FAMILY_VALUES -> !filters.familyValues.isNullOrEmpty()
            FAMILY_TYPE -> !filters.familyTypes.isNullOrEmpty()
            LIVING -> !filters.livingArrangements.isNullOrEmpty()
            WORK -> !filters.workAfterMarriageOptions.isNullOrEmpty()
            SMOKING -> !filters.smokingOptions.isNullOrEmpty()
            MANAGED_BY -> !filters.managedBy.isNullOrEmpty()
            HAS_PHOTO -> filters.hasPhoto == true
            VERIFIED_ONLY -> filters.verifiedOnly == true
            ACTIVE -> filters.activeWithinDays != null
            JOINED -> filters.joinedWithinDays != null
        }

    /** [filters] without this control's keys (the close control of a summary chip). */
    fun clear(filters: SearchFilters): SearchFilters =
        when (this) {
            AGE -> filters.copy(ageMin = null, ageMax = null)
            HEIGHT -> filters.copy(heightMinCm = null, heightMaxCm = null)
            MARITAL_STATUS -> filters.copy(maritalStatuses = null)
            CHILDREN -> filters.copy(childrenAcceptance = null)
            RELIGION -> filters.copy(religionCodes = null)
            SECT -> filters.copy(sectCodes = null)
            CASTE -> filters.copy(casteCodes = null)
            MOTHER_TONGUE -> filters.copy(motherTongueCodes = null)
            COUNTRY -> filters.copy(countryCodes = null)
            REGION -> filters.copy(regionIds = null)
            CITY -> filters.copy(cityIds = null)
            EDUCATION -> filters.copy(educationMinRank = null)
            EMPLOYMENT -> filters.copy(employmentTypes = null)
            PROFESSION -> filters.copy(professionCodes = null)
            INCOME -> filters.copy(incomeMinRank = null)
            RELIGIOSITY -> filters.copy(religiosityLevels = null)
            HIJAB -> filters.copy(hijabTypes = null)
            BEARD -> filters.copy(beardTypes = null)
            FAMILY_VALUES -> filters.copy(familyValues = null)
            FAMILY_TYPE -> filters.copy(familyTypes = null)
            LIVING -> filters.copy(livingArrangements = null)
            WORK -> filters.copy(workAfterMarriageOptions = null)
            SMOKING -> filters.copy(smokingOptions = null)
            MANAGED_BY -> filters.copy(managedBy = null)
            HAS_PHOTO -> filters.copy(hasPhoto = null)
            VERIFIED_ONLY -> filters.copy(verifiedOnly = null)
            ACTIVE -> filters.copy(activeWithinDays = null)
            JOINED -> filters.copy(joinedWithinDays = null)
        }

    companion object {
        /** The control of a `validation_failed` field such as `filters.age_min`. */
        fun ofField(field: String): FilterControl? {
            val key = field.removePrefix("filters.").substringBefore('.')
            return FilterControl.entries.firstOrNull { key in it.keys }
        }
    }
}

/**
 * Drops every key that sends nothing (16 section 6.6: "an untouched control sends nothing"): empty
 * lists, switches that are off, "Any" choices, values this build does not know and the profile
 * code, which the form never sets.
 */
internal fun SearchFilters.cleaned(): SearchFilters =
    SearchFilters(
        activeWithinDays = activeWithinDays?.takeIf { it in ACTIVE_DAYS },
        ageMax = ageMax,
        ageMin = ageMin,
        beardTypes = beardTypes.known(Beard.UNKNOWN),
        casteCodes = casteCodes.cleanCodes(),
        childrenAcceptance =
            childrenAcceptance?.takeIf { it != ChildrenAcceptance.ANY && it != ChildrenAcceptance.UNKNOWN },
        cityIds = cityIds?.distinct()?.takeIf { it.isNotEmpty() },
        countryCodes = countryCodes.cleanCodes(),
        educationMinRank = educationMinRank,
        employmentTypes = employmentTypes.known(EmploymentType.UNKNOWN),
        familyTypes = familyTypes.known(FamilyType.UNKNOWN),
        familyValues = familyValues.known(FamilyValues.UNKNOWN),
        hasPhoto = hasPhoto?.takeIf { it },
        heightMaxCm = heightMaxCm,
        heightMinCm = heightMinCm,
        hijabTypes = hijabTypes.known(Hijab.UNKNOWN),
        incomeMinRank = incomeMinRank,
        joinedWithinDays = joinedWithinDays?.takeIf { it in JOINED_DAYS },
        livingArrangements = livingArrangements.known(LivingArrangement.UNKNOWN),
        managedBy = managedBy.known(ManagedBy.UNKNOWN),
        maritalStatuses = maritalStatuses.known(MaritalStatus.UNKNOWN),
        motherTongueCodes = motherTongueCodes.cleanCodes(),
        professionCodes = professionCodes.cleanCodes(),
        publicCode = null,
        regionIds = regionIds?.distinct()?.takeIf { it.isNotEmpty() },
        religionCodes = religionCodes.cleanCodes(),
        religiosityLevels = religiosityLevels.known(Religiosity.UNKNOWN),
        sectCodes = sectCodes.cleanCodes(),
        smokingOptions = smokingOptions.known(Smoking.UNKNOWN),
        verifiedOnly = verifiedOnly?.takeIf { it },
        workAfterMarriageOptions = workAfterMarriageOptions.known(WorkAfterMarriage.UNKNOWN),
    )

private fun <E> List<E>?.known(unknown: E): List<E>? =
    this
        ?.filter { it != unknown }
        ?.distinct()
        ?.takeIf { it.isNotEmpty() }

private fun List<String>?.cleanCodes(): List<String>? =
    this
        ?.filter { it.isNotBlank() }
        ?.distinct()
        ?.takeIf { it.isNotEmpty() }

/**
 * The controls that have a value, one per control, in form order: the summary chips, and their
 * number on the "Filters" button (16 section 6.6).
 */
internal fun SearchFilters.activeControls(): List<FilterControl> {
    val clean = cleaned()
    return FilterControl.entries.filter { it.isSet(clean) }
}

/** The count in a group's heading. */
internal fun SearchFilters.activeCount(group: FilterGroup): Int = activeControls().count { it.group == group }

/**
 * "Use my preferences" (16 section 6.6): the values of `Preferences` under the same key names.
 * Importance values and `notes` are ignored. The full age range and "Children are fine" are the
 * untouched states, so they send nothing. Hijab applies to a male viewer, beard to a female
 * viewer, and `married` is offered to a female viewer only.
 */
internal fun Preferences.toSearchFilters(viewerGender: Gender?): SearchFilters {
    val fullAgeRange = ageMin <= AGE_MIN && ageMax >= AGE_MAX
    return SearchFilters(
        ageMin = if (fullAgeRange) null else ageMin,
        ageMax = if (fullAgeRange) null else ageMax,
        heightMinCm = heightMinCm,
        heightMaxCm = heightMaxCm,
        maritalStatuses = maritalStatuses.filter { it != MaritalStatus.MARRIED || viewerGender == Gender.FEMALE },
        childrenAcceptance = childrenAcceptance,
        religionCodes = religionCodes,
        sectCodes = sectCodes,
        casteCodes = casteCodes,
        motherTongueCodes = motherTongueCodes,
        countryCodes = countryCodes,
        regionIds = regionIds,
        cityIds = cityIds,
        educationMinRank = educationMinRank,
        employmentTypes = employmentTypes,
        professionCodes = professionCodes,
        incomeMinRank = incomeMinRank,
        religiosityLevels = religiosityLevels,
        hijabTypes = if (viewerGender == Gender.MALE) hijabTypes else null,
        beardTypes = if (viewerGender == Gender.FEMALE) beardTypes else null,
        familyValues = familyValues,
        familyTypes = familyTypes,
        livingArrangements = livingArrangements,
        workAfterMarriageOptions = workAfterMarriageOptions,
        smokingOptions = smokingOptions,
    ).cleaned()
}

/** A sort this build can send; an unknown one falls back to the default. */
internal fun SearchSort.orDefault(): SearchSort = if (this == SearchSort.UNKNOWN) SearchSort.BEST_MATCH else this

/** The wire codes of an enum list, for the chip fields. */
internal fun <E : WireEnum> List<E>?.wireSet(): Set<String> = orEmpty().map { it.wire }.toSet()

/** The enum values of chosen codes, in the order they were chosen. */
internal fun <E> Collection<String>.toEnums(values: List<E>): List<E> where E : Enum<E>, E : WireEnum =
    mapNotNull { code -> values.firstOrNull { it.wire == code && code.isNotEmpty() } }

// ---------------------------------------------------------------------------
// Profile code (16 section 6.6)
// ---------------------------------------------------------------------------

/** `KR` and 8 Crockford base32 characters (04 section 5). */
private val PROFILE_CODE = Regex("^KR[0-9A-HJKMNP-TV-Z]{8}$")
private val SPACES = Regex("\\s+")

/** Trimmed and in capitals, as "Find" sends it. Inner spaces are removed too. */
internal fun normalizeProfileCode(input: String): String = input.replace(SPACES, "").uppercase(Locale.ROOT)

internal fun isProfileCode(code: String): Boolean = PROFILE_CODE.matches(code)

// ---------------------------------------------------------------------------
// Height in whole inches for the slider, stored in centimetres (07 section 4.3)
// ---------------------------------------------------------------------------

internal fun inchesToCm(inches: Int): Int = Formatters.feetInchesToCm(inches / 12, inches % 12)

internal fun cmToInches(cm: Int): Int = Formatters.cmToFeetInches(cm).let { (feet, inches) -> feet * 12 + inches }

/**
 * The centimetres for one end of the height slider: nothing at the bound, the stored value while
 * that end has not moved (so a preference such as 150 cm is kept as it is), the new value otherwise.
 */
internal fun sliderHeightCm(
    inches: Int,
    currentCm: Int?,
    bound: Int,
): Int? =
    when {
        inches == bound -> null
        currentCm != null && cmToInches(currentCm) == inches -> currentCm
        else -> inchesToCm(inches)
    }

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

private val BELOW = Regex("^\\s*below\\b", RegexOption.IGNORE_CASE)
private val AMOUNT = Regex("\\d[\\d,.]*")

/**
 * The "at least" label of one PKR band (05 section 10.3): "At least 100,000 PKR a month or the
 * equivalent abroad"; the lowest band keeps its own label ("Below 50,000 PKR a month").
 */
internal fun incomeMinLabel(
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

@StringRes
private fun activeLabel(days: Int): Int =
    when (days) {
        1 -> R.string.discovery_search_active_option_1
        7 -> R.string.discovery_search_active_option_7
        else -> R.string.discovery_search_active_option_30
    }

@StringRes
private fun joinedLabel(days: Int): Int =
    when (days) {
        7 -> R.string.discovery_search_joined_option_7
        else -> R.string.discovery_search_joined_option_30
    }

@StringRes
internal fun sortLabel(sort: SearchSort): Int =
    when (sort) {
        SearchSort.NEWEST -> R.string.discovery_search_sort_newest
        SearchSort.RECENTLY_ACTIVE -> R.string.discovery_search_sort_recently_active
        SearchSort.BEST_MATCH, SearchSort.UNKNOWN -> R.string.discovery_search_sort_best_match
    }

/**
 * The choices of every control and the labels of the summary chips, built once per reference
 * data and viewer. Lists come from the reference bootstrap, never from string resources.
 */
internal class FilterOptions(
    private val reference: Reference,
    private val res: Resources,
    viewerGender: Gender?,
) {
    private val anyLabel = res.getString(R.string.discovery_search_any)
    private val anyTimeLabel = res.getString(R.string.discovery_search_any_time)

    /** `married` is listed only when the viewer is female. */
    val marital: List<Option> =
        enumOptions(Lists.MARITAL_STATUS, MaritalStatus.entries)
            .filter { it.code != MaritalStatus.MARRIED.wire || viewerGender == Gender.FEMALE }

    /** "Any" first; it stands for "Children are fine", so that entry is not repeated. */
    val children: List<Option> =
        listOf(Option(ANY, anyLabel)) +
            enumOptions(Lists.CHILDREN_ACCEPTANCE, ChildrenAcceptance.entries)
                .filter { it.code != ChildrenAcceptance.ANY.wire }

    val religions: List<Option> = reference.religionOptions()
    val castes: List<Option> = reference.casteOptions()
    val languages: List<Option> = reference.languageOptions()
    val countries: List<Option> = reference.countryOptions()
    val employment: List<Option> = enumOptions(Lists.EMPLOYMENT_TYPE, EmploymentType.entries)
    val professions: List<Option> = reference.professionOptions()
    val religiosity: List<Option> = enumOptions(Lists.RELIGIOSITY, Religiosity.entries)
    val hijab: List<Option> = enumOptions(Lists.HIJAB, Hijab.entries)
    val beard: List<Option> = enumOptions(Lists.BEARD, Beard.entries)
    val familyValues: List<Option> = enumOptions(Lists.FAMILY_VALUES, FamilyValues.entries)
    val familyTypes: List<Option> = enumOptions(Lists.FAMILY_TYPE, FamilyType.entries)
    val living: List<Option> = enumOptions(Lists.LIVING_ARRANGEMENT, LivingArrangement.entries)
    val work: List<Option> = enumOptions(Lists.WORK_AFTER_MARRIAGE, WorkAfterMarriage.entries)
    val smoking: List<Option> = enumOptions(Lists.SMOKING, Smoking.entries)
    val managedBy: List<Option> = enumOptions(Lists.MANAGED_BY, ManagedBy.entries)

    /** One entry per distinct education rank, "Bachelor's (BA, BSc, BS, BE, BBA) or higher" (05 section 7). */
    val education: List<Option> =
        listOf(Option(ANY, anyLabel)) +
            reference.educationRanks().map { (rank, name) ->
                Option(rank.toString(), res.text(R.string.discovery_search_education_option, "name" to name))
            }

    /** The PKR bands by rank (05 section 10.3). */
    val income: List<Option> =
        listOf(Option(ANY, anyLabel)) +
            reference.incomeRanks().map { (rank, label) -> Option(rank.toString(), incomeMinLabel(res, label)) }

    val active: List<Option> =
        listOf(Option(ANY, anyTimeLabel)) + ACTIVE_DAYS.map { Option(it.toString(), res.getString(activeLabel(it))) }

    val joined: List<Option> =
        listOf(Option(ANY, anyTimeLabel)) + JOINED_DAYS.map { Option(it.toString(), res.getString(joinedLabel(it))) }

    /** The sects of the chosen religions; every sect when none is chosen. */
    fun sects(religionCodes: List<String>?): List<Option> = reference.sectOptions(religionCodes.orEmpty())

    /** Aliases of a caste, so a search for "Rajpoot" finds "Rajput". */
    fun casteAliases(code: String): List<String> = reference.casteAliases(code)

    fun countryName(code: String): String = reference.country(code)

    /**
     * One summary chip (16 section 6.6): the control's label and a short value, "Age: 25 - 32" or
     * "Religion: Islam". Switches show the label alone.
     */
    fun chipLabel(
        control: FilterControl,
        filters: SearchFilters,
        cityNames: Map<Int, String>,
        regionName: (Int) -> String?,
    ): String {
        val name = res.getString(control.label)
        val value =
            when (control) {
                FilterControl.AGE -> range(filters.ageMin, filters.ageMax) { it.toString() }
                FilterControl.HEIGHT -> range(filters.heightMinCm, filters.heightMaxCm) { heightLabel(it) }
                FilterControl.MARITAL_STATUS -> filters.maritalStatuses.labels(Lists.MARITAL_STATUS)
                FilterControl.CHILDREN -> reference.option(Lists.CHILDREN_ACCEPTANCE, filters.childrenAcceptance)
                FilterControl.RELIGION -> filters.religionCodes?.joinToString { reference.religion(it) }
                FilterControl.SECT -> filters.sectCodes?.joinToString { reference.sect(it) }
                FilterControl.CASTE -> filters.casteCodes?.joinToString { reference.caste(it) }
                FilterControl.MOTHER_TONGUE -> filters.motherTongueCodes?.joinToString { reference.language(it) }
                FilterControl.COUNTRY -> filters.countryCodes?.joinToString { reference.country(it) }
                FilterControl.REGION -> regionsLabel(filters.regionIds.orEmpty(), regionName)
                FilterControl.CITY -> filters.cityIds?.joinToString { cityNames[it] ?: unknownCity }
                FilterControl.EDUCATION -> education.labelOf(filters.educationMinRank)
                FilterControl.EMPLOYMENT -> filters.employmentTypes.labels(Lists.EMPLOYMENT_TYPE)
                FilterControl.PROFESSION -> filters.professionCodes?.joinToString { reference.profession(it) }
                FilterControl.INCOME -> income.labelOf(filters.incomeMinRank)
                FilterControl.RELIGIOSITY -> filters.religiosityLevels.labels(Lists.RELIGIOSITY)
                FilterControl.HIJAB -> filters.hijabTypes.labels(Lists.HIJAB)
                FilterControl.BEARD -> filters.beardTypes.labels(Lists.BEARD)
                FilterControl.FAMILY_VALUES -> filters.familyValues.labels(Lists.FAMILY_VALUES)
                FilterControl.FAMILY_TYPE -> filters.familyTypes.labels(Lists.FAMILY_TYPE)
                FilterControl.LIVING -> filters.livingArrangements.labels(Lists.LIVING_ARRANGEMENT)
                FilterControl.WORK -> filters.workAfterMarriageOptions.labels(Lists.WORK_AFTER_MARRIAGE)
                FilterControl.SMOKING -> filters.smokingOptions.labels(Lists.SMOKING)
                FilterControl.MANAGED_BY -> filters.managedBy.labels(Lists.MANAGED_BY)
                FilterControl.HAS_PHOTO, FilterControl.VERIFIED_ONLY -> null
                FilterControl.ACTIVE -> active.labelOf(filters.activeWithinDays)
                FilterControl.JOINED -> joined.labelOf(filters.joinedWithinDays)
            }
        return if (value.isNullOrBlank()) name else "$name: $value"
    }

    private val unknownCity = res.getString(R.string.discovery_search_city_unknown)

    private fun heightLabel(cm: Int): String = Formatters.heightShort(res, cm)

    /** The names of the chosen regions, once every one of them is known. */
    private fun regionsLabel(
        ids: List<Int>,
        regionName: (Int) -> String?,
    ): String? {
        val names = ids.mapNotNull(regionName)
        return if (names.size == ids.size) names.joinToString() else null
    }

    private fun range(
        min: Int?,
        max: Int?,
        format: (Int) -> String,
    ): String =
        when {
            min != null && max != null -> "${format(min)} - ${format(max)}"
            min != null -> res.getString(R.string.discovery_search_from) + " " + format(min)
            max != null -> res.getString(R.string.discovery_search_to) + " " + format(max)
            else -> ""
        }

    private fun <E : WireEnum> List<E>?.labels(list: String): String? =
        this?.joinToString { reference.option(list, it) }

    private fun List<Option>.labelOf(value: Int?): String? =
        value?.let { v -> firstOrNull { it.code == v.toString() }?.label }

    private fun <E> enumOptions(
        list: String,
        values: List<E>,
    ): List<Option> where E : Enum<E>, E : WireEnum =
        reference.optionsOf(list, values).map { (value, label) -> Option(value.wire, label) }
}

/**
 * City names seen in this session (the own city and city searches), by id, so chosen cities show
 * their names. Only reference data is kept here.
 */
internal object CityNames {
    private val names = ConcurrentHashMap<Int, String>()

    fun put(city: CityRef) {
        names[city.id] = city.name
    }

    fun all(): Map<Int, String> = HashMap(names)
}
