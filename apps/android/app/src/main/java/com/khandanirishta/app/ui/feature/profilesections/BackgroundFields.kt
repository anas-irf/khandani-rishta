package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.ChoiceRow
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.RadioCard
import com.khandanirishta.app.ui.components.RadioCardsField
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.components.SwitchRow
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.pick
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing

private val textKeyboard =
    KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next)

/** ONB-05 and ME-EDIT `education_career` (07 section 7). */
@Composable
internal fun ColumnScope.EducationCareerFields(
    scope: FieldsScope<EducationCareerInput>,
    currency: String?,
    onCurrency: (String) -> Unit,
) {
    val values = scope.values
    val reference = LocalReference.current
    val privateHelp = stringResource(R.string.profile_sections_education_career_private_help)
    SelectField(
        label = stringResource(R.string.profile_sections_education_career_education_level_label),
        options = remember(reference) { reference.educationLevelOptions() },
        selected = values.educationLevelCode,
        onSelect = { code -> scope.edit("education_level_code") { it.copy(educationLevelCode = code) } },
        error = scope.error("education_level_code"),
        enabled = scope.enabled,
        modifier = Modifier.locate("education_level_code", scope.locator),
    )
    SelectField(
        label = stringResource(R.string.profile_sections_education_career_education_field_label),
        options = remember(reference) { reference.educationFieldOptions() },
        selected = values.educationFieldCode,
        onSelect = { code -> scope.edit("education_field_code") { it.copy(educationFieldCode = code) } },
        error = scope.error("education_field_code"),
        optional = true,
        searchable = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("education_field_code", scope.locator),
    )
    KrTextField(
        value = values.degreeTitle,
        onValueChange = { text -> scope.edit("degree_title") { it.copy(degreeTitle = text) } },
        label = stringResource(R.string.profile_sections_education_career_degree_title_label),
        placeholder = stringResource(R.string.profile_sections_education_career_degree_title_placeholder),
        error = scope.error("degree_title"),
        optional = true,
        maxLength = SHORT_TEXT_MAX,
        enabled = scope.enabled,
        keyboardOptions = textKeyboard,
        modifier = Modifier.locate("degree_title", scope.locator),
    )
    KrTextField(
        value = values.instituteName,
        onValueChange = { text -> scope.edit("institute_name") { it.copy(instituteName = text) } },
        label = stringResource(R.string.profile_sections_education_career_institute_name_label),
        helper = privateHelp,
        error = scope.error("institute_name"),
        optional = true,
        maxLength = LONG_TEXT_MAX,
        enabled = scope.enabled,
        keyboardOptions = textKeyboard,
        modifier = Modifier.locate("institute_name", scope.locator),
    )
    SelectField(
        label = stringResource(R.string.profile_sections_education_career_employment_type_label),
        options = reference.options(Lists.EMPLOYMENT_TYPE),
        selected = values.employmentType,
        onSelect = { code -> scope.edit("employment_type") { it.copy(employmentType = code) } },
        error = scope.error("employment_type"),
        enabled = scope.enabled,
        modifier = Modifier.locate("employment_type", scope.locator),
    )
    if (!isWorking(values.employmentType)) return
    SelectField(
        label = stringResource(R.string.profile_sections_education_career_profession_label),
        options = remember(reference) { reference.professionOptions() },
        selected = values.professionCode,
        onSelect = { code -> scope.edit("profession_code") { it.copy(professionCode = code) } },
        error = scope.error("profession_code"),
        optional = true,
        searchable = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("profession_code", scope.locator),
    )
    KrTextField(
        value = values.jobTitle,
        onValueChange = { text -> scope.edit("job_title") { it.copy(jobTitle = text) } },
        label = stringResource(R.string.profile_sections_education_career_job_title_label),
        error = scope.error("job_title"),
        optional = true,
        maxLength = SHORT_TEXT_MAX,
        enabled = scope.enabled,
        keyboardOptions = textKeyboard,
        modifier = Modifier.locate("job_title", scope.locator),
    )
    KrTextField(
        value = values.employerName,
        onValueChange = { text -> scope.edit("employer_name") { it.copy(employerName = text) } },
        label = stringResource(R.string.profile_sections_education_career_employer_name_label),
        helper = privateHelp,
        error = scope.error("employer_name"),
        optional = true,
        maxLength = LONG_TEXT_MAX,
        enabled = scope.enabled,
        keyboardOptions = textKeyboard,
        modifier = Modifier.locate("employer_name", scope.locator),
    )
    IncomeField(scope, currency, onCurrency, privateHelp)
}

/** The income band in the currency of the country of residence, with "Change currency" (07 section 7.2). */
@Composable
private fun IncomeField(
    scope: FieldsScope<EducationCareerInput>,
    currency: String?,
    onCurrency: (String) -> Unit,
    helper: String,
) {
    val reference = LocalReference.current
    var choosing by rememberSaveable { mutableStateOf(false) }
    val shownCurrency = currency ?: IncomeCurrency.forCountry(scope.profile.location.countryCode)
    val none = stringResource(R.string.profile_sections_education_career_income_none)
    val res = LocalResources.current
    val options =
        remember(reference, res, shownCurrency, none) {
            val bands =
                reference.incomeBandOptions(shownCurrency).map { band ->
                    Option(
                        band.code,
                        res.text(
                            R.string.profile_sections_education_career_income_option,
                            "label" to band.label,
                            "currency" to shownCurrency,
                        ),
                    )
                }
            withNone(none, bands)
        }
    Column(Modifier.locate("income_band_code", scope.locator)) {
        SelectField(
            label = stringResource(R.string.profile_sections_education_career_income_label),
            options = options,
            selected = scope.values.incomeBandCode,
            onSelect = { code ->
                val band = code?.takeIf { it != NOT_SPECIFIED }
                scope.edit("income_band_code") { it.copy(incomeBandCode = band) }
            },
            placeholder = none,
            helper = helper,
            error = scope.error("income_band_code"),
            optional = true,
            clearable = false,
            enabled = scope.enabled,
        )
        if (choosing) {
            SelectField(
                label = stringResource(R.string.profile_sections_education_career_currency_label),
                options = IncomeCurrency.currencies(reference.data.incomeBands).map { Option(it, it) },
                selected = shownCurrency,
                onSelect = { code -> if (code != null && code != shownCurrency) onCurrency(code) },
                clearable = false,
                enabled = scope.enabled,
                modifier = Modifier.padding(top = Spacing.s16),
            )
        } else {
            KrTextLink(
                text = stringResource(R.string.profile_sections_education_career_change_currency),
                onClick = { choosing = true },
                enabled = scope.enabled,
                modifier = Modifier.padding(top = Spacing.s8),
            )
        }
    }
}

/** ONB-06 and ME-EDIT `family` (07 section 8): four groups, every field optional. */
@Composable
internal fun ColumnScope.FamilyFields(scope: FieldsScope<FamilyInput>) {
    val values = scope.values
    val reference = LocalReference.current
    val notSet = stringResource(R.string.profile_sections_family_not_set)

    GroupTitle(stringResource(R.string.profile_sections_family_group_parents))
    SegmentedField(
        label = stringResource(R.string.profile_sections_family_father_status_label),
        options = reference.options(Lists.PARENT_STATUS),
        selected = values.fatherStatus,
        onSelect = { code -> scope.edit("father_status") { it.copy(fatherStatus = code) } },
        error = scope.error("father_status"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("father_status", scope.locator),
    )
    KrTextField(
        value = values.fatherOccupation,
        onValueChange = { text -> scope.edit("father_occupation") { it.copy(fatherOccupation = text) } },
        label = stringResource(R.string.profile_sections_family_father_occupation_label),
        placeholder = stringResource(R.string.profile_sections_family_father_occupation_placeholder),
        error = scope.error("father_occupation"),
        optional = true,
        maxLength = SHORT_TEXT_MAX,
        enabled = scope.enabled,
        keyboardOptions = textKeyboard,
        modifier = Modifier.locate("father_occupation", scope.locator),
    )
    SegmentedField(
        label = stringResource(R.string.profile_sections_family_mother_status_label),
        options = reference.options(Lists.PARENT_STATUS),
        selected = values.motherStatus,
        onSelect = { code -> scope.edit("mother_status") { it.copy(motherStatus = code) } },
        error = scope.error("mother_status"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("mother_status", scope.locator),
    )
    KrTextField(
        value = values.motherOccupation,
        onValueChange = { text -> scope.edit("mother_occupation") { it.copy(motherOccupation = text) } },
        label = stringResource(R.string.profile_sections_family_mother_occupation_label),
        placeholder = stringResource(R.string.profile_sections_family_mother_occupation_placeholder),
        error = scope.error("mother_occupation"),
        optional = true,
        maxLength = SHORT_TEXT_MAX,
        enabled = scope.enabled,
        keyboardOptions = textKeyboard,
        modifier = Modifier.locate("mother_occupation", scope.locator),
    )

    GroupTitle(stringResource(R.string.profile_sections_family_group_siblings), Modifier.padding(top = GroupSpace))
    // A count of 0 or "Not set" hides the married count, which is then sent as null (07 section 8.1).
    StepperField(
        label = stringResource(R.string.profile_sections_family_brothers_count_label),
        value = values.brothersCount,
        onChange = { count ->
            scope.edit("brothers_count", "brothers_married") {
                it.copy(
                    brothersCount = count,
                    brothersMarried = if (count == null || count == 0) null else it.brothersMarried,
                )
            }
        },
        range = SIBLINGS,
        error = scope.error("brothers_count"),
        optional = true,
        clearable = true,
        enabled = scope.enabled,
        emptyText = notSet,
        modifier = Modifier.locate("brothers_count", scope.locator),
    )
    val brothers = values.brothersCount ?: 0
    if (brothers > 0) {
        StepperField(
            label = stringResource(R.string.profile_sections_family_brothers_married_label),
            value = values.brothersMarried,
            onChange = { count -> scope.edit("brothers_married") { it.copy(brothersMarried = count) } },
            range = 0..brothers,
            error = scope.error("brothers_married"),
            optional = true,
            clearable = true,
            enabled = scope.enabled,
            emptyText = notSet,
            modifier = Modifier.locate("brothers_married", scope.locator),
        )
    }
    StepperField(
        label = stringResource(R.string.profile_sections_family_sisters_count_label),
        value = values.sistersCount,
        onChange = { count ->
            scope.edit("sisters_count", "sisters_married") {
                it.copy(
                    sistersCount = count,
                    sistersMarried = if (count == null || count == 0) null else it.sistersMarried,
                )
            }
        },
        range = SIBLINGS,
        error = scope.error("sisters_count"),
        optional = true,
        clearable = true,
        enabled = scope.enabled,
        emptyText = notSet,
        modifier = Modifier.locate("sisters_count", scope.locator),
    )
    val sisters = values.sistersCount ?: 0
    if (sisters > 0) {
        StepperField(
            label = stringResource(R.string.profile_sections_family_sisters_married_label),
            value = values.sistersMarried,
            onChange = { count -> scope.edit("sisters_married") { it.copy(sistersMarried = count) } },
            range = 0..sisters,
            error = scope.error("sisters_married"),
            optional = true,
            clearable = true,
            enabled = scope.enabled,
            emptyText = notSet,
            modifier = Modifier.locate("sisters_married", scope.locator),
        )
    }

    GroupTitle(stringResource(R.string.profile_sections_family_group_background), Modifier.padding(top = GroupSpace))
    SegmentedField(
        label = stringResource(R.string.profile_sections_family_family_type_label),
        options = reference.options(Lists.FAMILY_TYPE),
        selected = values.familyType,
        onSelect = { code -> scope.edit("family_type") { it.copy(familyType = code) } },
        error = scope.error("family_type"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("family_type", scope.locator),
    )
    SelectField(
        label = stringResource(R.string.profile_sections_family_family_class_label),
        options = reference.options(Lists.FAMILY_CLASS),
        selected = values.familyClass,
        onSelect = { code -> scope.edit("family_class") { it.copy(familyClass = code) } },
        error = scope.error("family_class"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("family_class", scope.locator),
    )
    SelectField(
        label = stringResource(R.string.profile_sections_family_family_values_label),
        options = reference.options(Lists.FAMILY_VALUES),
        selected = values.familyValues,
        onSelect = { code -> scope.edit("family_values") { it.copy(familyValues = code) } },
        error = scope.error("family_values"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("family_values", scope.locator),
    )
    SwitchRow(
        title =
            stringResource(
                scope.subject.pick(
                    R.string.profile_sections_family_elsewhere_label,
                    R.string.profile_sections_family_elsewhere_label_male,
                    R.string.profile_sections_family_elsewhere_label_female,
                    R.string.profile_sections_family_elsewhere_label_unknown,
                ),
            ),
        checked = values.familyElsewhere,
        onCheckedChange = { on ->
            scope.edit("family_elsewhere", "family_place") { it.copy(familyElsewhere = on) }
        },
        enabled = scope.enabled,
        modifier = Modifier.locate("family_elsewhere", scope.locator),
    )
    CollapsibleContent(visible = values.familyElsewhere, instant = scope.error("family_place") != null) {
        CityPickerField(
            value = values.familyPlace,
            onChange = { place -> scope.edit("family_place") { it.copy(familyPlace = place) } },
            countryLabel = stringResource(R.string.profile_sections_family_family_country_label),
            cityLabel = stringResource(R.string.profile_sections_family_family_city_label),
            cityOtherLabel = stringResource(R.string.profile_sections_family_family_city_label),
            pickerKey = "family-place",
            allowTyped = false,
            error = scope.error("family_place"),
            optional = true,
            enabled = scope.enabled,
            modifier = Modifier.locate("family_place", scope.locator),
        )
    }

    GroupTitle(stringResource(R.string.profile_sections_family_group_home), Modifier.padding(top = GroupSpace))
    SelectField(
        label = stringResource(R.string.profile_sections_family_home_ownership_label),
        options = reference.options(Lists.HOME_OWNERSHIP),
        selected = values.homeOwnership,
        onSelect = { code -> scope.edit("home_ownership") { it.copy(homeOwnership = code) } },
        error = scope.error("home_ownership"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("home_ownership", scope.locator),
    )
    SelectField(
        label = stringResource(R.string.profile_sections_family_home_type_label),
        options = reference.options(Lists.HOME_TYPE),
        selected = values.homeType,
        onSelect = { code -> scope.edit("home_type") { it.copy(homeType = code) } },
        error = scope.error("home_type"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("home_type", scope.locator),
    )
    AdaptiveRow(
        modifier = Modifier.fillMaxWidth(),
        lineSpacing = FieldSpacing,
        verticalAlignment = Alignment.Top,
    ) {
        KrTextField(
            value = values.homeSizeValue,
            onValueChange = { typed ->
                val size = typed.filter { it.isDigit() || it == '.' }
                scope.edit("home_size_value", "home_size_unit") {
                    // The unit defaults to marla in Pakistan, otherwise square feet (07 section 8.1).
                    val unit =
                        when {
                            it.homeSizeUnit != null || size.isEmpty() -> it.homeSizeUnit
                            scope.profile.location.countryCode == PAKISTAN -> "marla"
                            else -> "sq_ft"
                        }
                    it.copy(homeSizeValue = size, homeSizeUnit = unit)
                }
            },
            label = stringResource(R.string.profile_sections_family_home_size_label),
            error = scope.error("home_size_value"),
            optional = true,
            maxLength = HOME_SIZE_LENGTH,
            enabled = scope.enabled,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next),
            modifier =
                Modifier
                    .locate("home_size_value", scope.locator)
                    .grow(basis = HomeSizeBasis),
        )
        SelectField(
            label = stringResource(R.string.profile_sections_family_home_size_unit_label),
            options = reference.options(Lists.HOME_SIZE_UNIT),
            selected = values.homeSizeUnit,
            onSelect = { code -> scope.edit("home_size_unit", "home_size_value") { it.copy(homeSizeUnit = code) } },
            error = scope.error("home_size_unit"),
            optional = true,
            enabled = scope.enabled,
            modifier =
                Modifier
                    .locate("home_size_unit", scope.locator)
                    .grow(basis = HomeSizeBasis),
        )
    }
    HelperText(stringResource(R.string.profile_sections_family_home_help))

    Column(Modifier.locate("about_family", scope.locator), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        KrTextField(
            value = values.aboutFamily,
            onValueChange = { text -> scope.edit("about_family") { it.copy(aboutFamily = text) } },
            label = stringResource(R.string.profile_sections_family_about_family_label),
            helper = stringResource(R.string.profile_sections_family_about_family_help),
            error = scope.error("about_family"),
            optional = true,
            maxLength = ABOUT_FAMILY_MAX,
            singleLine = false,
            minLines = ABOUT_FAMILY_LINES,
            enabled = scope.enabled,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        TextStatusNote(scope.profile.textStatus.aboutFamily)
        if (scope.mode == FormMode.EDIT) HelperText(stringResource(R.string.profile_sections_form_review_note))
    }
}

private val HOBBY_CATEGORIES =
    listOf(
        "faith" to R.string.profile_sections_lifestyle_hobby_category_faith,
        "sports" to R.string.profile_sections_lifestyle_hobby_category_sports,
        "arts" to R.string.profile_sections_lifestyle_hobby_category_arts,
        "food" to R.string.profile_sections_lifestyle_hobby_category_food,
        "outdoors" to R.string.profile_sections_lifestyle_hobby_category_outdoors,
        "technology" to R.string.profile_sections_lifestyle_hobby_category_technology,
        "home" to R.string.profile_sections_lifestyle_hobby_category_home,
        "social" to R.string.profile_sections_lifestyle_hobby_category_social,
        "learning" to R.string.profile_sections_lifestyle_hobby_category_learning,
    )

/** ONB-07 and ME-EDIT `lifestyle` (07 section 9): five groups, every field optional. */
@Composable
internal fun ColumnScope.LifestyleFields(
    scope: FieldsScope<LifestyleInput>,
    onUseHelpMeWrite: () -> Unit,
) {
    val values = scope.values
    val reference = LocalReference.current
    val subject = scope.subject

    @Composable
    fun LifestyleSelect(
        field: String,
        label: String,
        list: String,
        value: String?,
        apply: (LifestyleInput, String?) -> LifestyleInput,
    ) {
        SelectField(
            label = label,
            options = reference.options(list),
            selected = value,
            onSelect = { code -> scope.edit(field) { apply(it, code) } },
            error = scope.error(field),
            optional = true,
            enabled = scope.enabled,
            modifier = Modifier.locate(field, scope.locator),
        )
    }

    @Composable
    fun LifestyleCards(
        field: String,
        label: String,
        list: String,
        value: String?,
        apply: (LifestyleInput, String) -> LifestyleInput,
    ) {
        Column(Modifier.locate(field, scope.locator)) {
            FieldLabel(label, optional = true)
            RadioCardsField(
                cards = reference.options(list).map { RadioCard(it.code, it.label) },
                selected = value,
                onSelect = { code -> scope.edit(field) { apply(it, code) } },
                error = scope.error(field),
                enabled = scope.enabled,
            )
        }
    }

    fun shows(field: String) = lifestyleShows(field, scope.context)

    GroupTitle(stringResource(R.string.profile_sections_lifestyle_group_practice))
    LifestyleSelect(
        "religiosity",
        stringResource(
            subject.pick(
                R.string.profile_sections_lifestyle_religiosity_label,
                R.string.profile_sections_lifestyle_religiosity_label_male,
                R.string.profile_sections_lifestyle_religiosity_label_female,
                R.string.profile_sections_lifestyle_religiosity_label_unknown,
            ),
        ),
        Lists.RELIGIOSITY,
        values.religiosity,
    ) { input, code -> input.copy(religiosity = code) }
    if (shows("prayer_frequency")) {
        LifestyleSelect(
            "prayer_frequency",
            stringResource(R.string.profile_sections_lifestyle_prayer_frequency_label),
            Lists.PRAYER_FREQUENCY,
            values.prayerFrequency,
        ) { input, code -> input.copy(prayerFrequency = code) }
    }
    if (shows("hijab")) {
        LifestyleSelect(
            "hijab",
            stringResource(R.string.profile_sections_lifestyle_hijab_label),
            Lists.HIJAB,
            values.hijab,
        ) { input, code ->
            input.copy(hijab = code)
        }
    }
    if (shows("beard")) {
        LifestyleSelect(
            "beard",
            stringResource(R.string.profile_sections_lifestyle_beard_label),
            Lists.BEARD,
            values.beard,
        ) { input, code ->
            input.copy(beard = code)
        }
    }
    if (shows("religious_education")) {
        LifestyleSelect(
            "religious_education",
            stringResource(R.string.profile_sections_lifestyle_religious_education_label),
            Lists.RELIGIOUS_EDUCATION,
            values.religiousEducation,
        ) { input, code -> input.copy(religiousEducation = code) }
    }
    LifestyleSelect(
        "smoking",
        stringResource(
            subject.pick(
                R.string.profile_sections_lifestyle_smoking_label,
                R.string.profile_sections_lifestyle_smoking_label_male,
                R.string.profile_sections_lifestyle_smoking_label_female,
                R.string.profile_sections_lifestyle_smoking_label_unknown,
            ),
        ),
        Lists.SMOKING,
        values.smoking,
    ) { input, code -> input.copy(smoking = code) }

    GroupTitle(stringResource(R.string.profile_sections_lifestyle_group_plans), Modifier.padding(top = GroupSpace))
    LifestyleCards(
        "living_arrangement",
        stringResource(
            subject.pick(
                R.string.profile_sections_lifestyle_living_arrangement_label,
                R.string.profile_sections_lifestyle_living_arrangement_label_male,
                R.string.profile_sections_lifestyle_living_arrangement_label_female,
                R.string.profile_sections_lifestyle_living_arrangement_label_unknown,
            ),
        ),
        Lists.LIVING_ARRANGEMENT,
        values.livingArrangement,
    ) { input, code -> input.copy(livingArrangement = code) }
    val maleProfile = scope.profile.basics.gender
        ?.wire == "male"
    val workLabel =
        if (maleProfile) {
            subject.pick(
                R.string.profile_sections_lifestyle_work_male_profile_label,
                male = R.string.profile_sections_lifestyle_work_male_profile_label_male,
                unknown = R.string.profile_sections_lifestyle_work_male_profile_label_unknown,
            )
        } else {
            subject.pick(
                R.string.profile_sections_lifestyle_work_female_profile_label,
                female = R.string.profile_sections_lifestyle_work_female_profile_label_female,
                unknown = R.string.profile_sections_lifestyle_work_female_profile_label_unknown,
            )
        }
    LifestyleCards(
        "work_after_marriage",
        stringResource(workLabel),
        Lists.WORK_AFTER_MARRIAGE,
        values.workAfterMarriage,
    ) { input, code ->
        input.copy(workAfterMarriage = code)
    }
    LifestyleSelect(
        "marriage_timeline",
        stringResource(
            subject.pick(
                R.string.profile_sections_lifestyle_marriage_timeline_label,
                R.string.profile_sections_lifestyle_marriage_timeline_label_male,
                R.string.profile_sections_lifestyle_marriage_timeline_label_female,
                R.string.profile_sections_lifestyle_marriage_timeline_label_unknown,
            ),
        ),
        Lists.MARRIAGE_TIMELINE,
        values.marriageTimeline,
    ) { input, code -> input.copy(marriageTimeline = code) }
    LifestyleCards(
        "jahez_stance",
        stringResource(R.string.profile_sections_lifestyle_jahez_stance_label),
        Lists.JAHEZ_STANCE,
        values.jahezStance,
    ) { input, code -> input.copy(jahezStance = code) }

    AppearanceGroup(scope)

    GroupTitle(stringResource(R.string.profile_sections_lifestyle_group_hobbies), Modifier.padding(top = GroupSpace))
    val hobbyGroups =
        remember(reference) {
            val byCategory = reference.hobbyOptions().toMap()
            HOBBY_CATEGORIES.mapNotNull { (category, title) ->
                byCategory[category]?.takeIf { it.isNotEmpty() }?.let { title to it }
            }
        }
    ToggleChipsField(
        label = stringResource(R.string.profile_sections_lifestyle_hobbies_label),
        groups = hobbyGroups.map { (title, options) -> stringResource(title) to options },
        selected = values.hobbyCodes,
        onChange = { codes -> scope.edit("hobby_codes") { it.copy(hobbyCodes = codes) } },
        max = HOBBIES_MAX,
        maxMessage = stringResource(R.string.profile_sections_lifestyle_hobbies_max),
        error = scope.error("hobby_codes"),
        optional = true,
        enabled = scope.enabled,
        modifier = Modifier.locate("hobby_codes", scope.locator),
    )

    AboutMeGroup(scope, onUseHelpMeWrite)
}

/** "Appearance and health", collapsed by default; it opens when one of its fields has an error. */
@Composable
private fun ColumnScope.AppearanceGroup(scope: FieldsScope<LifestyleInput>) {
    val values = scope.values
    val reference = LocalReference.current
    var open by rememberSaveable { mutableStateOf(false) }
    val hasError = APPEARANCE_FIELDS.any { scope.error(it) != null }
    val shown = open || hasError
    // It stays open once the error is put right, so it cannot close on the field being typed in.
    LaunchedEffect(hasError) { if (hasError) open = true }
    CollapsibleHeader(
        title = stringResource(R.string.profile_sections_lifestyle_group_appearance),
        expanded = shown,
        onToggle = { open = hasError || !shown },
        optional = true,
        modifier = Modifier.padding(top = GroupSpace),
    )
    CollapsibleContent(visible = shown, instant = hasError) {
        KrTextField(
            value = values.weightKg,
            onValueChange = { typed ->
                val digits = typed.filter { it.isDigit() }
                scope.edit("weight_kg") { it.copy(weightKg = digits) }
            },
            label = stringResource(R.string.profile_sections_lifestyle_weight_kg_label),
            error = scope.error("weight_kg"),
            optional = true,
            maxLength = WEIGHT_LENGTH,
            enabled = scope.enabled,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
            modifier = Modifier.locate("weight_kg", scope.locator),
        )
        listOf(
            Triple("complexion", R.string.profile_sections_lifestyle_complexion_label, Lists.COMPLEXION),
            Triple("body_type", R.string.profile_sections_lifestyle_body_type_label, Lists.BODY_TYPE),
            Triple("blood_group", R.string.profile_sections_lifestyle_blood_group_label, Lists.BLOOD_GROUP),
            Triple("disability", R.string.profile_sections_lifestyle_disability_label, Lists.DISABILITY),
        ).forEach { (field, label, list) ->
            SelectField(
                label = stringResource(label),
                options = reference.options(list),
                selected =
                    when (field) {
                        "complexion" -> values.complexion
                        "body_type" -> values.bodyType
                        "blood_group" -> values.bloodGroup
                        else -> values.disability
                    },
                onSelect = { code ->
                    scope.edit(field) {
                        when (field) {
                            "complexion" -> it.copy(complexion = code)
                            "body_type" -> it.copy(bodyType = code)
                            "blood_group" -> it.copy(bloodGroup = code)
                            else -> it.copy(disability = code)
                        }
                    }
                },
                error = scope.error(field),
                optional = true,
                enabled = scope.enabled,
                modifier = Modifier.locate(field, scope.locator),
            )
        }
        if (values.disability != null && values.disability != "none") {
            KrTextField(
                value = values.disabilityDetails,
                onValueChange = { text -> scope.edit("disability_details") { it.copy(disabilityDetails = text) } },
                label = stringResource(R.string.profile_sections_lifestyle_disability_details_label),
                error = scope.error("disability_details"),
                optional = true,
                maxLength = DETAILS_MAX,
                enabled = scope.enabled,
                keyboardOptions = textKeyboard,
                modifier = Modifier.locate("disability_details", scope.locator),
            )
        }
        HelperText(stringResource(R.string.profile_sections_lifestyle_health_help))
    }
}

/** "About you": the writing prompts, the text, and "Help me write" (07 sections 9.1 to 9.3). */
@Composable
private fun ColumnScope.AboutMeGroup(
    scope: FieldsScope<LifestyleInput>,
    onUseHelpMeWrite: () -> Unit,
) {
    val values = scope.values
    val subject = scope.subject
    val reference = LocalReference.current
    val res = LocalResources.current
    var activePrompt by rememberSaveable { mutableStateOf<Int?>(null) }
    var replacement by rememberSaveable { mutableStateOf<String?>(null) }

    fun insert(draft: String) {
        scope.edit("about_me") { it.copy(aboutMe = draft) }
        if (scope.mode == FormMode.ONBOARDING) onUseHelpMeWrite()
    }

    fun helpMeWrite() {
        val profile = scope.profile
        val education = profile.educationCareer
        val draft =
            buildAboutMeDraft(
                DraftInput(
                    subject = subject,
                    firstName = profile.basics.firstName,
                    age = profile.basics.dateOfBirth?.let { Formatters.ageFrom(it) },
                    job = education.jobTitle ?: education.professionCode?.let { reference.profession(it) },
                    city = profile.location.city?.name ?: profile.location.cityOther,
                    educationLevel = education.educationLevelCode?.let { reference.educationLevel(it) },
                    educationField = education.educationFieldCode?.let { reference.educationField(it) },
                    religiosity = values.religiosity,
                    familyType = profile.family.familyType.wireCode,
                    hobbies = values.hobbyCodes.map { reference.hobby(it) },
                ),
                res,
            )
        if (values.aboutMe.isNotBlank()) replacement = draft else insert(draft)
    }

    GroupTitle(
        stringResource(
            subject.pick(
                R.string.profile_sections_lifestyle_group_about,
                R.string.profile_sections_lifestyle_group_about_male,
                R.string.profile_sections_lifestyle_group_about_female,
                R.string.profile_sections_lifestyle_group_about_unknown,
            ),
        ),
        Modifier.padding(top = GroupSpace),
    )
    val prompts =
        listOf(
            subject.pick(
                R.string.profile_sections_lifestyle_prompt_1,
                R.string.profile_sections_lifestyle_prompt_1_male,
                R.string.profile_sections_lifestyle_prompt_1_female,
                R.string.profile_sections_lifestyle_prompt_1_unknown,
            ),
            subject.pick(
                R.string.profile_sections_lifestyle_prompt_2,
                R.string.profile_sections_lifestyle_prompt_2_male,
                R.string.profile_sections_lifestyle_prompt_2_female,
                R.string.profile_sections_lifestyle_prompt_2_unknown,
            ),
            R.string.profile_sections_lifestyle_prompt_3,
        )
    Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        Text(
            stringResource(R.string.profile_sections_lifestyle_prompts_label),
            style = MaterialTheme.typography.labelLarge,
        )
        prompts.forEachIndexed { index, prompt ->
            val active = activePrompt == index
            // A prompt only stays highlighted as a guide; it never inserts text (07 section 9.2).
            ChoiceRow(
                text = stringResource(prompt),
                selected = active,
                onClick = { activePrompt = if (active) null else index },
            )
        }
    }
    Column(Modifier.locate("about_me", scope.locator), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        KrTextField(
            value = values.aboutMe,
            onValueChange = { text -> scope.edit("about_me") { it.copy(aboutMe = text) } },
            label =
                stringResource(
                    subject.pick(
                        R.string.profile_sections_lifestyle_about_me_label,
                        R.string.profile_sections_lifestyle_about_me_label_male,
                        R.string.profile_sections_lifestyle_about_me_label_female,
                        R.string.profile_sections_lifestyle_about_me_label_unknown,
                    ),
                ),
            helper = stringResource(R.string.profile_sections_lifestyle_about_me_help),
            error = scope.error("about_me"),
            optional = true,
            maxLength = ABOUT_ME_MAX,
            singleLine = false,
            minLines = ABOUT_ME_LINES,
            enabled = scope.enabled,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        KrButton(
            text = stringResource(R.string.profile_sections_lifestyle_help_me_write),
            onClick = ::helpMeWrite,
            variant = KrButtonVariant.SECONDARY,
            icon = Icons.Outlined.AutoAwesome,
            enabled = scope.enabled,
        )
        TextStatusNote(scope.profile.textStatus.aboutMe)
        if (scope.mode == FormMode.EDIT) HelperText(stringResource(R.string.profile_sections_form_review_note))
    }

    val draft = replacement
    if (draft != null) {
        ConfirmDialog(
            title = stringResource(R.string.profile_sections_lifestyle_replace_dialog_title),
            text = null,
            confirmLabel = stringResource(R.string.profile_sections_lifestyle_replace_dialog_confirm),
            dismissLabel = stringResource(R.string.profile_sections_lifestyle_replace_dialog_cancel),
            needsNetwork = false,
            onConfirm = {
                replacement = null
                insert(draft)
            },
            onDismiss = { replacement = null },
        )
    }
}

private const val HOME_SIZE_LENGTH = 8
private const val WEIGHT_LENGTH = 3
private const val ABOUT_FAMILY_LINES = 5
private const val ABOUT_ME_LINES = 7
private val HomeSizeBasis = 144.dp
