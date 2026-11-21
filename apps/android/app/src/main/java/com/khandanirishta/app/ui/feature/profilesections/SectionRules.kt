package com.khandanirishta.app.ui.feature.profilesections

import com.khandanirishta.app.R
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.messages.UiText
import java.time.LocalDate

/**
 * The client rules of the profile sections (07 sections 3 to 9 and the catalogue in 16), the
 * fields each section shows, and where the API's field errors go. Messages are those of
 * [profileSectionMessage], so a client error and the same API error read the same.
 */
class SectionRules(
    private val context: SectionContext,
) : FormRules<SectionInput> {
    override fun validate(values: SectionInput): List<FieldIssue> =
        when (values) {
            is AccountForInput -> values.validate(context)
            is BasicsInput -> values.validate(context)
            is CommunityInput -> values.validate(context)
            is LocationInput -> values.validate(context)
            is EducationCareerInput -> values.validate()
            is FamilyInput -> values.validate()
            is LifestyleInput -> values.validate()
        }

    override fun fields(values: SectionInput): List<String> =
        when (values) {
            is AccountForInput -> values.fields(context)
            is BasicsInput -> values.fields()
            is CommunityInput -> values.fields(context)
            is LocationInput -> values.fields()
            is EducationCareerInput -> values.fields()
            is FamilyInput -> values.fields()
            is LifestyleInput -> values.fields(context)
        }

    override fun fieldFor(apiField: String): String =
        when (apiField) {
            "consents" -> "consent_terms"
            "country_code", "region_id", "city_id", "city_other" -> "place"
            "origin_city_id", "origin_other" -> "origin"
            "family_country_code", "family_city_id" -> "family_place"
            else -> apiField
        }

    override fun message(
        apiField: String,
        code: String,
    ): Int? = profileSectionMessage(apiField, code)
}

/** Collects issues in page order, one per field. */
private class Issues {
    val list = mutableListOf<FieldIssue>()

    /** An issue on [field] with the message of [messageField] and [code]. */
    fun add(
        field: String,
        code: String,
        messageField: String = field,
    ) {
        if (list.any { it.field == field }) return
        val message = profileSectionMessage(messageField, code) ?: R.string.errors_field_invalid
        list += FieldIssue(field, UiText.of(message))
    }
}

private fun AccountForInput.validate(context: SectionContext): List<FieldIssue> {
    val issues = Issues()
    if (managedBy == null) issues.add("managed_by", "required")
    if (managedBy != null && managedBy != "self") {
        val name = collapse(managerName)
        if (name == null) {
            issues.add("manager_name", "required")
        } else {
            lengthCode(name, NAME_MIN, MANAGER_NAME_MAX)?.let { issues.add("manager_name", it) }
        }
    }
    if (context.mode == FormMode.ONBOARDING) {
        if (!consentTerms) issues.add("consent_terms", "required", messageField = "consents")
        if (!consentAge) issues.add("consent_age", "required")
    }
    if (showsCandidateConsent(context) && !consentCandidate) issues.add("consent_candidate", "required")
    return issues.list
}

private fun AccountForInput.fields(context: SectionContext): List<String> =
    buildList {
        add("managed_by")
        if (managedBy != null && managedBy != "self") add("manager_name")
        if (context.mode == FormMode.ONBOARDING) {
            add("consent_terms")
            add("consent_age")
        }
        if (showsCandidateConsent(context)) add("consent_candidate")
    }

/** The code of the age rule: 18 to 80 on today's date in Asia/Karachi (07 section 4.1). */
fun dateOfBirthCode(dateOfBirth: LocalDate?): String? {
    if (dateOfBirth == null) return "required"
    val age = Formatters.ageFrom(dateOfBirth)
    return when {
        age < MIN_AGE -> "too_young"
        age > MAX_AGE -> "out_of_range"
        else -> null
    }
}

private fun BasicsInput.validate(context: SectionContext): List<FieldIssue> {
    val issues = Issues()
    listOf("first_name" to firstName, "last_name" to lastName).forEach { (field, value) ->
        val name = collapse(value)
        if (name == null) {
            issues.add(field, "required")
        } else {
            lengthCode(name, NAME_MIN, NAME_MAX)?.let { issues.add(field, it) }
        }
    }
    if (gender == null) issues.add("gender", "required")
    when (val code = dateOfBirthCode(dateOfBirth)) {
        null -> {}

        "too_young" -> {
            val variant = if (context.subject == Subject.SELF) "too_young" else "too_young_other"
            issues.add("date_of_birth", variant)
        }

        else -> {
            issues.add("date_of_birth", code)
        }
    }
    if (maritalStatus == null) {
        issues.add("marital_status", "required")
    } else if (maritalStatus == "married" && gender == "female") {
        issues.add("marital_status", "not_allowed")
    }
    if (maritalStatus == "married") {
        when {
            currentWivesCount == null -> issues.add("current_wives_count", "required")
            currentWivesCount !in WIVES -> issues.add("current_wives_count", "out_of_range")
        }
    }
    if (maritalStatus != null && maritalStatus != "never_married") {
        if (childrenStatus == null) {
            issues.add("children_status", "required")
        } else if (childrenStatus in CHILDREN_WITH_COUNT) {
            when {
                childrenCount == null -> issues.add("children_count", "required")
                childrenCount !in CHILDREN -> issues.add("children_count", "out_of_range")
            }
        }
    }
    when {
        heightCm == null -> issues.add("height_cm", "required")
        heightCm !in Formatters.MIN_HEIGHT_CM..Formatters.MAX_HEIGHT_CM -> issues.add("height_cm", "out_of_range")
    }
    return issues.list
}

private fun BasicsInput.fields(): List<String> =
    buildList {
        addAll(listOf("first_name", "last_name", "gender", "date_of_birth", "marital_status"))
        if (maritalStatus == "married") add("current_wives_count")
        if (maritalStatus != null && maritalStatus != "never_married") {
            add("children_status")
            if (childrenStatus in CHILDREN_WITH_COUNT) add("children_count")
        }
        add("height_cm")
    }

private fun CommunityInput.validate(context: SectionContext): List<FieldIssue> {
    val issues = Issues()
    if (religionCode == null) {
        issues.add("religion_code", "required")
    } else if (context.sectCount(religionCode) > 0 && sectCode == null) {
        issues.add("sect_code", "required")
    }
    if (casteTyped) lengthCode(collapse(casteOther), TYPED_MIN, TYPED_MAX)?.let { issues.add("caste_other", it) }
    val control = subCasteControl(context)
    val subText = collapse(subCasteOther)
    if (control == SubCasteControl.SELECT && subCasteTyped) {
        lengthCode(subText, TYPED_MIN, TYPED_MAX)?.let { issues.add("sub_caste_other", it) }
    } else if (control == SubCasteControl.TEXT && subText != null) {
        lengthCode(subText, TYPED_MIN, TYPED_MAX)?.let { issues.add("sub_caste_other", it) }
    }
    if (motherTongueCode == null) issues.add("mother_tongue_code", "required")
    if (languageCodes.count { it != motherTongueCode } > LANGUAGES_MAX) issues.add("language_codes", "too_long")
    return issues.list
}

private fun CommunityInput.fields(context: SectionContext): List<String> =
    buildList {
        add("religion_code")
        if (context.sectCount(religionCode) > 0) add("sect_code")
        add("caste_code")
        if (casteTyped) add("caste_other")
        val control = subCasteControl(context)
        if (control == SubCasteControl.SELECT) add("sub_caste_code")
        if (control == SubCasteControl.TEXT || (control == SubCasteControl.SELECT && subCasteTyped)) {
            add("sub_caste_other")
        }
        add("mother_tongue_code")
        add("language_codes")
    }

private fun LocationInput.validate(context: SectionContext): List<FieldIssue> {
    val issues = Issues()
    when {
        place.countryCode == null -> {
            issues.add("place", "required", messageField = "country_code")
        }

        place.cityId != null -> {}

        place.cityOther == null -> {
            issues.add("place", "required", messageField = "city_id")
        }

        else -> {
            val code = lengthCode(collapse(place.cityOther), TYPED_MIN, TYPED_MAX)
            if (code != null) {
                issues.add("place", code, messageField = "city_other")
            } else if (place.regionId == null && context.places.hasRegions(place.countryCode)) {
                issues.add("place", "required", messageField = "region_id")
            }
        }
    }
    lengthCode(collapse(area), 0, AREA_MAX)?.let { issues.add("area", it) }
    if (asksResidency && residencyStatus == null) issues.add("residency_status", "required")
    if (origin.cityId == null && origin.cityOther != null) {
        lengthCode(collapse(origin.cityOther), 0, TYPED_MAX)?.let { code ->
            issues.add("origin", code, messageField = "origin_other")
        }
    }
    return issues.list
}

private fun LocationInput.fields(): List<String> =
    buildList {
        add("place")
        add("area")
        add("nationality_code")
        if (asksResidency) add("residency_status")
        add("origin")
        add("relocation")
    }

private fun EducationCareerInput.validate(): List<FieldIssue> {
    val issues = Issues()
    if (educationLevelCode == null) issues.add("education_level_code", "required")
    if (employmentType == null) issues.add("employment_type", "required")
    val limits =
        mutableListOf(
            "degree_title" to (degreeTitle to SHORT_TEXT_MAX),
            "institute_name" to (instituteName to LONG_TEXT_MAX),
        )
    if (isWorking(employmentType)) {
        limits += "job_title" to (jobTitle to SHORT_TEXT_MAX)
        limits += "employer_name" to (employerName to LONG_TEXT_MAX)
    }
    limits.forEach { (field, value) ->
        if (lengthCode(collapse(value.first), 0, value.second) != null) issues.add(field, "too_long")
    }
    return issues.list
}

private fun EducationCareerInput.fields(): List<String> =
    buildList {
        addAll(
            listOf("education_level_code", "education_field_code", "degree_title", "institute_name", "employment_type"),
        )
        if (isWorking(employmentType)) {
            addAll(listOf("profession_code", "job_title", "employer_name", "income_band_code"))
        }
    }

private val SIZE_PATTERN = Regex("^\\d{1,5}(\\.\\d{1,2})?$")

private fun FamilyInput.validate(): List<FieldIssue> {
    val issues = Issues()
    listOf(
        Triple("brothers", brothersCount, brothersMarried),
        Triple("sisters", sistersCount, sistersMarried),
    ).forEach { (kind, total, married) ->
        if (total != null && total !in SIBLINGS) issues.add("${kind}_count", "out_of_range")
        if (total != null && total > 0 && married != null && married > total) {
            issues.add("${kind}_married", "out_of_range")
        }
    }
    listOf("father_occupation" to fatherOccupation, "mother_occupation" to motherOccupation).forEach { (field, value) ->
        if (lengthCode(collapse(value), 0, SHORT_TEXT_MAX) != null) issues.add(field, "too_long")
    }
    val size = homeSizeValue.trim().ifEmpty { null }
    if (size != null && (!SIZE_PATTERN.matches(size) || (size.toDoubleOrNull() ?: 0.0) <= 0.0)) {
        issues.add("home_size_value", "out_of_range")
    }
    if (size != null && homeSizeUnit == null) issues.add("home_size_unit", "required")
    if (size == null && homeSizeUnit != null) issues.add("home_size_value", "required")
    trimmed(aboutFamily)?.let { about ->
        lengthCode(about, ABOUT_FAMILY_MIN, ABOUT_FAMILY_MAX)?.let { issues.add("about_family", it) }
    }
    return issues.list
}

private fun FamilyInput.fields(): List<String> =
    buildList {
        addAll(listOf("father_status", "father_occupation", "mother_status", "mother_occupation", "brothers_count"))
        if ((brothersCount ?: 0) > 0) add("brothers_married")
        add("sisters_count")
        if ((sistersCount ?: 0) > 0) add("sisters_married")
        addAll(listOf("family_type", "family_class", "family_values", "family_elsewhere"))
        if (familyElsewhere) add("family_place")
        addAll(listOf("home_ownership", "home_type", "home_size_value", "home_size_unit", "about_family"))
    }

private fun LifestyleInput.validate(): List<FieldIssue> {
    val issues = Issues()
    val weight = weightKg.trim()
    if (weight.isNotEmpty() && (weight.toIntOrNull() ?: 0) !in WEIGHT) issues.add("weight_kg", "out_of_range")
    if (disability != null && disability != "none" && lengthCode(collapse(disabilityDetails), 0, DETAILS_MAX) != null) {
        issues.add("disability_details", "too_long")
    }
    if (hobbyCodes.size > HOBBIES_MAX) issues.add("hobby_codes", "too_long")
    trimmed(aboutMe)?.let { about ->
        lengthCode(about, ABOUT_ME_MIN, ABOUT_ME_MAX)?.let { issues.add("about_me", it) }
    }
    return issues.list
}

/** Fields of the collapsed "Appearance and health" group (07 section 9.1). */
val APPEARANCE_FIELDS = setOf("weight_kg", "complexion", "body_type", "blood_group", "disability", "disability_details")

private fun LifestyleInput.fields(context: SectionContext): List<String> =
    buildList {
        listOf("religiosity", "prayer_frequency", "hijab", "beard", "religious_education").forEach { field ->
            if (lifestyleShows(field, context)) add(field)
        }
        addAll(listOf("smoking", "living_arrangement", "work_after_marriage", "marriage_timeline", "jahez_stance"))
        addAll(listOf("weight_kg", "complexion", "body_type", "blood_group", "disability"))
        if (disability != null && disability != "none") add("disability_details")
        add("hobby_codes")
        add("about_me")
    }

const val NAME_MIN = 2
const val NAME_MAX = 40
const val MANAGER_NAME_MAX = 80
const val TYPED_MIN = 2
const val TYPED_MAX = 60
const val AREA_MAX = 80
const val SHORT_TEXT_MAX = 80
const val LONG_TEXT_MAX = 120
const val DETAILS_MAX = 300
const val ABOUT_FAMILY_MIN = 30
const val ABOUT_FAMILY_MAX = 1000
const val ABOUT_ME_MIN = 50
const val ABOUT_ME_MAX = 1500
const val HOBBIES_MAX = 10
const val LANGUAGES_MAX = 6
private const val MIN_AGE = 18
private const val MAX_AGE = 80
val WIVES = 1..3
val CHILDREN = 1..15
val SIBLINGS = 0..15
private val WEIGHT = 30..200
