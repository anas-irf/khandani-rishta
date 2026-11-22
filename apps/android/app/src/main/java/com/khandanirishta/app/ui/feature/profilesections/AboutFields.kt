package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.ConsentCheckbox
import com.khandanirishta.app.ui.components.DateOfBirthField
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.HeightField
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.components.RadioCard
import com.khandanirishta.app.ui.components.RadioCardsField
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.linkedText
import com.khandanirishta.app.ui.text.pick
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing

private val MANAGED_BY = listOf("self", "parent", "sibling", "relative", "friend")

private fun managedByTitle(code: String): Int =
    when (code) {
        "self" -> R.string.profile_sections_account_for_choice_self
        "parent" -> R.string.profile_sections_account_for_choice_parent
        "sibling" -> R.string.profile_sections_account_for_choice_sibling
        "relative" -> R.string.profile_sections_account_for_choice_relative
        else -> R.string.profile_sections_account_for_choice_friend
    }

private fun managedByHelp(code: String): Int =
    when (code) {
        "self" -> R.string.profile_sections_account_for_choice_self_help
        "parent" -> R.string.profile_sections_account_for_choice_parent_help
        "sibling" -> R.string.profile_sections_account_for_choice_sibling_help
        "relative" -> R.string.profile_sections_account_for_choice_relative_help
        else -> R.string.profile_sections_account_for_choice_friend_help
    }

private val nameKeyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next)

/** ONB-01 and ME-EDIT `account_for` (07 section 3, 08 section 2.1 rule 4). */
@Composable
internal fun ColumnScope.AccountForFields(scope: FieldsScope<AccountForInput>) {
    val values = scope.values
    val links = rememberLinkOpener()
    val linkColor = MaterialTheme.colorScheme.primary
    RadioCardsField(
        cards = MANAGED_BY.map { RadioCard(it, stringResource(managedByTitle(it)), stringResource(managedByHelp(it))) },
        selected = values.managedBy,
        onSelect = { code -> scope.edit("managed_by") { it.copy(managedBy = code) } },
        label = stringResource(R.string.profile_sections_account_for_managed_by_label),
        error = scope.error("managed_by"),
        enabled = scope.enabled,
        modifier = Modifier.locate("managed_by", scope.locator),
    )
    if (values.managedBy != null && values.managedBy != "self") {
        KrTextField(
            value = values.managerName,
            onValueChange = { name -> scope.edit("manager_name") { it.copy(managerName = name) } },
            label = stringResource(R.string.profile_sections_account_for_manager_name_label),
            helper = stringResource(R.string.profile_sections_account_for_manager_name_help),
            error = scope.error("manager_name"),
            maxLength = MANAGER_NAME_MAX,
            enabled = scope.enabled,
            keyboardOptions = nameKeyboard,
            modifier = Modifier.locate("manager_name", scope.locator),
        )
    }
    val candidate = values.showsCandidateConsent(scope.context)
    if (scope.mode == FormMode.ONBOARDING || candidate) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            if (scope.mode == FormMode.ONBOARDING) {
                val terms = stringResource(R.string.profile_sections_account_for_consent_terms)
                ConsentCheckbox(
                    checked = values.consentTerms,
                    onCheckedChange = { checked -> scope.edit("consent_terms") { it.copy(consentTerms = checked) } },
                    label =
                        remember(terms, linkColor) {
                            linkedText(
                                terms,
                                linkColor,
                                mapOf(
                                    "terms" to { links.webPage("terms") },
                                    "privacy" to { links.webPage("privacy") },
                                    "guidelines" to { links.webPage("community-guidelines") },
                                ),
                            )
                        },
                    error = scope.error("consent_terms"),
                    enabled = scope.enabled,
                    modifier = Modifier.locate("consent_terms", scope.locator),
                )
                val self = values.managedBy == null || values.managedBy == "self"
                ConsentCheckbox(
                    checked = values.consentAge,
                    onCheckedChange = { checked -> scope.edit("consent_age") { it.copy(consentAge = checked) } },
                    label =
                        AnnotatedString(
                            stringResource(
                                if (self) {
                                    R.string.profile_sections_account_for_consent_age_self
                                } else {
                                    R.string.profile_sections_account_for_consent_age_other
                                },
                            ),
                        ),
                    error = scope.error("consent_age"),
                    enabled = scope.enabled,
                    modifier = Modifier.locate("consent_age", scope.locator),
                )
            }
            if (candidate) {
                ConsentCheckbox(
                    checked = values.consentCandidate,
                    onCheckedChange = { checked ->
                        scope.edit("consent_candidate") { it.copy(consentCandidate = checked) }
                    },
                    label = AnnotatedString(stringResource(R.string.profile_sections_account_for_consent_candidate)),
                    error = scope.error("consent_candidate"),
                    enabled = scope.enabled,
                    modifier = Modifier.locate("consent_candidate", scope.locator),
                )
            }
        }
    }
    if (scope.mode == FormMode.ONBOARDING) {
        HelperText(stringResource(R.string.profile_sections_account_for_marriage_only))
    }
}

/** ONB-02 and ME-EDIT `basics` (07 section 4, 08 section 2.2 for the locked fields). */
@Composable
internal fun ColumnScope.BasicsFields(scope: FieldsScope<BasicsInput>) {
    val values = scope.values
    val reference = LocalReference.current
    val basics = scope.profile.basics
    val locked = scope.profile.lockedFields.toSet()
    val firstNameLabel = stringResource(R.string.profile_sections_basics_first_name_label)
    if ("first_name" in locked) {
        LockedField(firstNameLabel, basics.firstName.orEmpty(), modifier = Modifier.locate("first_name", scope.locator))
    } else {
        KrTextField(
            value = values.firstName,
            onValueChange = { name -> scope.edit("first_name") { it.copy(firstName = name) } },
            label = firstNameLabel,
            error = scope.error("first_name"),
            maxLength = NAME_MAX,
            enabled = scope.enabled,
            keyboardOptions = nameKeyboard,
            modifier = Modifier.locate("first_name", scope.locator),
        )
    }
    val lastNameLabel = stringResource(R.string.profile_sections_basics_last_name_label)
    if ("last_name" in locked) {
        LockedField(lastNameLabel, basics.lastName.orEmpty(), modifier = Modifier.locate("last_name", scope.locator))
    } else {
        KrTextField(
            value = values.lastName,
            onValueChange = { name -> scope.edit("last_name") { it.copy(lastName = name) } },
            label = lastNameLabel,
            helper = stringResource(R.string.profile_sections_basics_last_name_help),
            error = scope.error("last_name"),
            maxLength = NAME_MAX,
            enabled = scope.enabled,
            keyboardOptions = nameKeyboard,
            modifier = Modifier.locate("last_name", scope.locator),
        )
    }
    val genderLabel = stringResource(R.string.profile_sections_basics_gender_label)
    if ("gender" in locked) {
        LockedField(
            genderLabel,
            reference.option(Lists.GENDER, basics.gender),
            modifier = Modifier.locate("gender", scope.locator),
        )
    } else {
        SegmentedField(
            label = genderLabel,
            options = reference.options(Lists.GENDER),
            selected = values.gender,
            onSelect = { gender ->
                scope.edit("gender", "marital_status", "current_wives_count") {
                    // `married` is offered only to men (07 section 4.1).
                    val clear = gender == "female" && it.maritalStatus == "married"
                    it.copy(
                        gender = gender,
                        maritalStatus = if (clear) null else it.maritalStatus,
                        currentWivesCount = if (clear) null else it.currentWivesCount,
                    )
                }
            },
            error = scope.error("gender"),
            enabled = scope.enabled,
            modifier = Modifier.locate("gender", scope.locator),
        )
    }
    val dateLabel = stringResource(R.string.profile_sections_basics_date_of_birth_label)
    if ("date_of_birth" in locked) {
        val date = basics.dateOfBirth
        val shown =
            if (date == null) {
                ""
            } else {
                val age = text(R.string.common_format_age, "age" to Formatters.ageFrom(date))
                Formatters.longDate(date) + " (" + age + ")"
            }
        LockedField(dateLabel, shown, modifier = Modifier.locate("date_of_birth", scope.locator))
    } else {
        DateOfBirthField(
            value = values.dateOfBirth,
            onChange = { date -> scope.edit("date_of_birth") { it.copy(dateOfBirth = date) } },
            label = dateLabel,
            helper = stringResource(R.string.profile_sections_basics_date_of_birth_help),
            error = scope.error("date_of_birth"),
            enabled = scope.enabled,
            modifier = Modifier.locate("date_of_birth", scope.locator),
        )
    }
    SelectField(
        label = stringResource(R.string.profile_sections_basics_marital_status_label),
        options = reference.options(Lists.MARITAL_STATUS).filter { it.code != "married" || values.gender == "male" },
        selected = values.maritalStatus,
        onSelect = { status -> scope.edit("marital_status") { it.copy(maritalStatus = status) } },
        error = scope.error("marital_status"),
        enabled = scope.enabled,
        modifier = Modifier.locate("marital_status", scope.locator),
    )
    if (values.maritalStatus == "married") {
        StepperField(
            label = stringResource(R.string.profile_sections_basics_current_wives_count_label),
            value = values.currentWivesCount,
            onChange = { count -> scope.edit("current_wives_count") { it.copy(currentWivesCount = count) } },
            range = WIVES,
            error = scope.error("current_wives_count"),
            enabled = scope.enabled,
            modifier = Modifier.locate("current_wives_count", scope.locator),
        )
    }
    if (values.maritalStatus != null && values.maritalStatus != "never_married") {
        RadioCardsField(
            cards = reference.options(Lists.CHILDREN_STATUS).map { RadioCard(it.code, it.label) },
            selected = values.childrenStatus,
            onSelect = { status -> scope.edit("children_status") { it.copy(childrenStatus = status) } },
            label =
                stringResource(
                    scope.subject.pick(
                        R.string.profile_sections_basics_children_status_label,
                        R.string.profile_sections_basics_children_status_label_male,
                        R.string.profile_sections_basics_children_status_label_female,
                        R.string.profile_sections_basics_children_status_label_unknown,
                    ),
                ),
            error = scope.error("children_status"),
            enabled = scope.enabled,
            modifier = Modifier.locate("children_status", scope.locator),
        )
        if (values.childrenStatus in CHILDREN_WITH_COUNT) {
            StepperField(
                label = stringResource(R.string.profile_sections_basics_children_count_label),
                value = values.childrenCount,
                onChange = { count -> scope.edit("children_count") { it.copy(childrenCount = count) } },
                range = CHILDREN,
                error = scope.error("children_count"),
                enabled = scope.enabled,
                modifier = Modifier.locate("children_count", scope.locator),
            )
        }
    }
    HeightField(
        valueCm = values.heightCm,
        onChange = { cm -> scope.edit("height_cm") { it.copy(heightCm = cm) } },
        label = stringResource(R.string.profile_sections_basics_height_label),
        error = scope.error("height_cm"),
        enabled = scope.enabled,
        modifier = Modifier.locate("height_cm", scope.locator),
    )
    if (scope.mode == FormMode.ONBOARDING) {
        WarningBox(stringResource(R.string.profile_sections_basics_warning))
    }
}

/** ONB-03 and ME-EDIT `community` (07 section 5). */
@Composable
internal fun ColumnScope.CommunityFields(scope: FieldsScope<CommunityInput>) {
    val values = scope.values
    val reference = LocalReference.current
    SelectField(
        label = stringResource(R.string.profile_sections_community_religion_label),
        options = reference.religionOptions(),
        selected = values.religionCode,
        onSelect = { code ->
            // Changing the religion clears the sect (07 section 5.1).
            scope.edit("religion_code", "sect_code") {
                it.copy(religionCode = code, sectCode = if (code == it.religionCode) it.sectCode else null)
            }
        },
        error = scope.error("religion_code"),
        enabled = scope.enabled,
        modifier = Modifier.locate("religion_code", scope.locator),
    )
    if (scope.context.sectCount(values.religionCode) > 0) {
        SelectField(
            label = stringResource(R.string.profile_sections_community_sect_label),
            options = reference.sectOptions(listOfNotNull(values.religionCode)),
            selected = values.sectCode,
            onSelect = { code -> scope.edit("sect_code") { it.copy(sectCode = code) } },
            error = scope.error("sect_code"),
            enabled = scope.enabled,
            modifier = Modifier.locate("sect_code", scope.locator),
        )
    }
    val noneLabel = stringResource(R.string.profile_sections_community_caste_none)
    val casteOptions =
        remember(reference, noneLabel) {
            listOf(SearchOption(NOT_SPECIFIED, noneLabel)) +
                reference.data.castes.map { caste ->
                    SearchOption(caste.code, reference.caste(caste.code), caste.aliases)
                }
        }
    val casteOtherOption = stringResource(R.string.profile_sections_community_caste_other_option)
    val subFields = arrayOf("sub_caste_code", "sub_caste_other")
    SearchPickerField(
        label = stringResource(R.string.profile_sections_community_caste_label),
        options = casteOptions,
        selected = if (values.casteTyped) null else values.casteCode,
        displayText = if (values.casteTyped) casteOtherOption else null,
        onSelect = { code ->
            // Changing the caste clears both sub-caste fields (07 section 5.2).
            scope.edit("caste_code", "caste_other", *subFields) {
                it.copy(
                    casteCode = code,
                    casteTyped = false,
                    casteOther = "",
                    subCasteCode = null,
                    subCasteOther = "",
                    subCasteTyped = false,
                )
            }
        },
        otherLabel = casteOtherOption,
        onOther = { typed ->
            scope.edit("caste_code", "caste_other", *subFields) {
                it.copy(
                    casteCode = null,
                    casteTyped = true,
                    casteOther = typed,
                    subCasteCode = null,
                    subCasteOther = "",
                    subCasteTyped = false,
                )
            }
        },
        helper = stringResource(R.string.profile_sections_community_caste_help),
        error = scope.error("caste_code"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("caste_code", scope.locator),
    )
    if (values.casteTyped) {
        KrTextField(
            value = values.casteOther,
            onValueChange = { text -> scope.edit("caste_other") { it.copy(casteOther = text) } },
            label = stringResource(R.string.profile_sections_community_caste_other_label),
            error = scope.error("caste_other"),
            maxLength = TYPED_MAX,
            enabled = scope.enabled,
            keyboardOptions = nameKeyboard,
            modifier = Modifier.locate("caste_other", scope.locator),
        )
    }
    val control = values.subCasteControl(scope.context)
    val subCasteLabel = stringResource(R.string.profile_sections_community_sub_caste_label)
    if (control == SubCasteControl.SELECT) {
        val subNone = stringResource(R.string.profile_sections_community_sub_caste_none)
        val subOtherOption = stringResource(R.string.profile_sections_community_sub_caste_other_option)
        val subOptions =
            remember(reference, values.casteCode, subNone) {
                listOf(SearchOption(NOT_SPECIFIED, subNone)) +
                    reference.subCasteOptions(values.casteCode).map { SearchOption(it.code, it.label) }
            }
        SearchPickerField(
            label = subCasteLabel,
            options = subOptions,
            selected = if (values.subCasteTyped) null else values.subCasteCode,
            displayText = if (values.subCasteTyped) subOtherOption else null,
            onSelect = { code ->
                scope.edit(*subFields) { it.copy(subCasteCode = code, subCasteTyped = false, subCasteOther = "") }
            },
            otherLabel = subOtherOption,
            onOther = { typed ->
                scope.edit(*subFields) { it.copy(subCasteCode = null, subCasteTyped = true, subCasteOther = typed) }
            },
            error = scope.error("sub_caste_code"),
            optional = true,
            enabled = scope.enabled,
            modifier = Modifier.locate("sub_caste_code", scope.locator),
        )
    }
    if (control == SubCasteControl.TEXT || (control == SubCasteControl.SELECT && values.subCasteTyped)) {
        KrTextField(
            value = values.subCasteOther,
            onValueChange = { text -> scope.edit("sub_caste_other") { it.copy(subCasteOther = text) } },
            label = subCasteLabel,
            error = scope.error("sub_caste_other"),
            optional = control == SubCasteControl.TEXT,
            maxLength = TYPED_MAX,
            enabled = scope.enabled,
            keyboardOptions = nameKeyboard,
            modifier = Modifier.locate("sub_caste_other", scope.locator),
        )
    }
    val languages = remember(reference) { reference.languageOptions() }
    SelectField(
        label = stringResource(R.string.profile_sections_community_mother_tongue_label),
        options = languages,
        selected = values.motherTongueCode,
        onSelect = { code -> scope.edit("mother_tongue_code") { it.copy(motherTongueCode = code) } },
        error = scope.error("mother_tongue_code"),
        enabled = scope.enabled,
        searchable = true,
        modifier = Modifier.locate("mother_tongue_code", scope.locator),
    )
    MultiSelectField(
        label = stringResource(R.string.profile_sections_community_languages_label),
        options = languages.filter { it.code != values.motherTongueCode },
        selected = values.languageCodes,
        onChange = { codes -> scope.edit("language_codes") { it.copy(languageCodes = codes) } },
        error = scope.error("language_codes"),
        optional = true,
        max = LANGUAGES_MAX,
        chips = false,
        enabled = scope.enabled,
        modifier = Modifier.locate("language_codes", scope.locator),
    )
}

/** ONB-04 and ME-EDIT `location` (07 section 6). */
@Composable
internal fun ColumnScope.LocationFields(scope: FieldsScope<LocationInput>) {
    val values = scope.values
    val reference = LocalReference.current
    CityPickerField(
        value = values.place,
        onChange = { place ->
            // Changing the country also clears the area (07 section 6.1).
            scope.edit("place", "area") {
                it.copy(place = place, area = if (place.countryCode != it.place.countryCode) "" else it.area)
            }
        },
        countryLabel = stringResource(R.string.profile_sections_location_country_label),
        regionLabel = stringResource(R.string.profile_sections_location_region_label),
        cityLabel = stringResource(R.string.profile_sections_location_city_label),
        cityOtherLabel = stringResource(R.string.profile_sections_location_city_other_label),
        pickerKey = "place",
        error = scope.error("place"),
        enabled = scope.enabled,
        modifier = Modifier.locate("place", scope.locator),
    )
    KrTextField(
        value = values.area,
        onValueChange = { text -> scope.edit("area") { it.copy(area = text) } },
        label = stringResource(R.string.profile_sections_location_area_label),
        helper = stringResource(R.string.profile_sections_location_area_help),
        error = scope.error("area"),
        optional = true,
        maxLength = AREA_MAX,
        enabled = scope.enabled,
        keyboardOptions = nameKeyboard,
        modifier = Modifier.locate("area", scope.locator),
    )
    SelectField(
        label = stringResource(R.string.profile_sections_location_nationality_label),
        options = remember(reference) { reference.countryOptions() },
        selected = values.nationalityCode,
        onSelect = { code -> if (code != null) scope.edit("nationality_code") { it.copy(nationalityCode = code) } },
        error = scope.error("nationality_code"),
        enabled = scope.enabled,
        clearable = false,
        searchable = true,
        modifier = Modifier.locate("nationality_code", scope.locator),
    )
    if (values.asksResidency) {
        // `citizen` applies only to dual nationals here, so it moves to the end (07 section 6.1).
        val residency = reference.options(Lists.RESIDENCY_STATUS)
        SelectField(
            label = stringResource(R.string.profile_sections_location_residency_label),
            options = residency.filter { it.code != "citizen" } + residency.filter { it.code == "citizen" },
            selected = values.residencyStatus,
            onSelect = { code -> scope.edit("residency_status") { it.copy(residencyStatus = code) } },
            error = scope.error("residency_status"),
            enabled = scope.enabled,
            modifier = Modifier.locate("residency_status", scope.locator),
        )
    }
    CityPickerField(
        value = values.origin,
        onChange = { origin -> scope.edit("origin") { it.copy(origin = origin) } },
        label = stringResource(R.string.profile_sections_location_origin_label),
        cityLabel = stringResource(R.string.profile_sections_location_origin_city_label),
        cityOtherLabel = stringResource(R.string.profile_sections_location_origin_other_label),
        pickerKey = "origin",
        helper = stringResource(R.string.profile_sections_location_origin_help),
        error = scope.error("origin"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("origin", scope.locator),
    )
    Column(Modifier.locate("relocation", scope.locator)) {
        FieldLabel(stringResource(R.string.profile_sections_location_relocation_label), optional = true)
        RadioCardsField(
            cards = reference.options(Lists.RELOCATION).map { RadioCard(it.code, it.label) },
            selected = values.relocation,
            onSelect = { code -> scope.edit("relocation") { it.copy(relocation = code) } },
            error = scope.error("relocation"),
            enabled = scope.enabled,
        )
    }
}

/** Options with an entry that stands for "nothing", such as "Prefer not to say". */
internal fun withNone(
    none: String,
    options: List<Option>,
): List<Option> = listOf(Option(NOT_SPECIFIED, none)) + options
