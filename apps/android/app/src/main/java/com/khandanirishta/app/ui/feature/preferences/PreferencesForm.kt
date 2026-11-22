package com.khandanirishta.app.ui.feature.preferences

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.ImportanceField
import com.khandanirishta.app.ui.components.IntRangeSlider
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.components.RadioCard
import com.khandanirishta.app.ui.components.RadioCardsField
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.components.SwitchRow
import com.khandanirishta.app.ui.feature.profilesections.CollapsibleContent
import com.khandanirishta.app.ui.feature.profilesections.CollapsibleHeader
import com.khandanirishta.app.ui.feature.profilesections.FieldLocator
import com.khandanirishta.app.ui.feature.profilesections.FormErrors
import com.khandanirishta.app.ui.feature.profilesections.GroupTitle
import com.khandanirishta.app.ui.feature.profilesections.HelperText
import com.khandanirishta.app.ui.feature.profilesections.NOT_SPECIFIED
import com.khandanirishta.app.ui.feature.profilesections.TextStatusNote
import com.khandanirishta.app.ui.feature.profilesections.ToggleChipsField
import com.khandanirishta.app.ui.feature.profilesections.WarningBox
import com.khandanirishta.app.ui.feature.profilesections.locate
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.TABULAR_FIGURES

/** Five or more must-haves can leave very few matches (07 section 11.3 rule 3). */
const val MUST_WARNING_AT = 5

/**
 * The partner preferences form of ONB-09 and ME-PREFS (07 section 11): the essentials, then
 * "More preferences" (collapsed, it opens when one of its fields has an error), each row with its
 * importance control and a hairline under it, then the notes. The "{n} must-haves" line lives in
 * the screen's bottom bar.
 */
@Composable
fun PreferencesFields(
    ui: PreferencesFormUi,
    locator: FieldLocator,
    onEdit: (Set<String>, (PreferencesInput) -> PreferencesInput) -> Unit,
    modifier: Modifier = Modifier,
) {
    val form = ui.form ?: return
    val values = form.values
    val res = LocalResources.current
    val reference = LocalReference.current
    val gender = ui.candidateGender
    val female = gender == Gender.FEMALE
    val enabled = !form.busy
    val any = stringResource(R.string.preferences_any)
    val rules =
        remember(gender, reference) {
            PreferencesRules(gender) { religions ->
                PreferencesFormController.sectsOf(reference, religions).isNotEmpty()
            }
        }

    fun error(field: String): String? = form.error(field)?.resolve(res)

    fun edit(
        vararg fields: String,
        transform: (PreferencesInput) -> PreferencesInput,
    ) = onEdit(fields.toSet(), transform)

    fun importance(dimension: Dimension): (Importance) -> Unit =
        { value -> edit(dimension.importanceField) { it.copy(importance = it.importance + (dimension to value)) } }

    @Composable
    fun DimensionRow(
        dimension: Dimension,
        label: String,
        content: @Composable () -> Unit,
    ) {
        PreferenceRow(
            label = label,
            importance = values.importanceOf(dimension),
            onImportance = importance(dimension),
            enabled = enabled && values.hasPreference(dimension, gender),
            error = error(dimension.importanceField),
            modifier = Modifier.locate(dimension.importanceField, locator),
            content = content,
        )
    }

    @Composable
    fun ChipsRow(
        field: String,
        label: String,
        options: List<Option>,
        selected: Set<String>,
        apply: (PreferencesInput, Set<String>) -> PreferencesInput,
    ) {
        ToggleChipsField(
            label = label,
            groups = listOf(null to options),
            selected = selected,
            onChange = { codes -> edit(field) { apply(it, codes) } },
            error = error(field),
            enabled = enabled,
            emptyLabel = any,
            modifier = Modifier.locate(field, locator),
        )
    }

    var tierTwoOpen by rememberSaveable { mutableStateOf(false) }
    val tierTwoError = PreferencesRules.TIER_TWO.any { form.error(it) != null }
    val tierTwoShown = tierTwoOpen || tierTwoError
    var placesOpen by rememberSaveable { mutableStateOf(false) }
    val placesShown =
        placesOpen || values.regionIds.isNotEmpty() || values.cityIds.isNotEmpty() ||
            form.error("region_ids") != null || form.error("city_ids") != null
    val musts = values.mustHaveCount(gender)
    // Both stay open once opened, so neither closes on the field being changed.
    LaunchedEffect(tierTwoError) { if (tierTwoError) tierTwoOpen = true }
    LaunchedEffect(placesShown) { if (placesShown) placesOpen = true }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(RowGap)) {
        if (form.showSummary) FormErrors(form = form, fields = rules.fields(values), locator = locator)
        if (musts >= MUST_WARNING_AT) WarningBox(text(R.string.preferences_must_warning, "count" to musts))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            GroupTitle(stringResource(R.string.preferences_tier_essentials))
            HelperText(stringResource(R.string.fields_importance_help))
        }

        val ageLabel = stringResource(R.string.preferences_rows_age)
        DimensionRow(Dimension.AGE, ageLabel) {
            AgeRangeControl(
                label = ageLabel,
                min = values.ageMin,
                max = values.ageMax,
                onChange = { min, max -> edit("age") { it.copy(ageMin = min, ageMax = max) } },
                enabled = enabled,
                error = error("age"),
                modifier = Modifier.locate("age", locator),
            )
        }
        val maritalLabel = stringResource(R.string.preferences_rows_marital_status)
        DimensionRow(Dimension.MARITAL_STATUS, maritalLabel) {
            // `married` is listed only when the candidate is female (07 section 11.2).
            val options =
                remember(reference, female) {
                    reference.options(Lists.MARITAL_STATUS).filter { it.code != "married" || female }
                }
            ChipsRow("marital_statuses", maritalLabel, options, values.maritalStatuses) { input, codes ->
                input.copy(maritalStatuses = codes)
            }
        }
        val religionLabel = stringResource(R.string.preferences_rows_religion)
        DimensionRow(Dimension.RELIGION, religionLabel) {
            val options = remember(reference) { reference.religionOptions() }
            ToggleChipsField(
                label = religionLabel,
                groups = listOf(null to options),
                selected = values.religionCodes,
                onChange = { codes ->
                    // Sects stay only for the religions still selected.
                    val allowed = PreferencesFormController.sectsOf(reference, codes)
                    edit("religion_codes", "sect_codes") {
                        it.copy(
                            religionCodes = codes,
                            sectCodes = it.sectCodes.filter { code -> code in allowed }.toSet(),
                        )
                    }
                },
                error = error("religion_codes"),
                enabled = enabled,
                emptyLabel = any,
                modifier = Modifier.locate("religion_codes", locator),
            )
        }
        val sectOptions =
            remember(reference, values.religionCodes) {
                if (values.religionCodes.isEmpty()) emptyList() else reference.sectOptions(values.religionCodes)
            }
        if (sectOptions.isNotEmpty()) {
            val sectLabel = stringResource(R.string.preferences_rows_sect)
            DimensionRow(Dimension.SECT, sectLabel) {
                ChipsRow("sect_codes", sectLabel, sectOptions, values.sectCodes) { input, codes ->
                    input.copy(sectCodes = codes)
                }
            }
        }
        DimensionRow(Dimension.LOCATION, stringResource(R.string.preferences_rows_location)) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
                MultiSelectField(
                    label = stringResource(R.string.preferences_rows_countries),
                    options = remember(reference) { reference.countryOptions() },
                    selected = values.countryCodes,
                    onChange = { codes -> edit("country_codes") { it.copy(countryCodes = codes) } },
                    helper = if (values.countryCodes.isEmpty()) any else null,
                    error = error("country_codes"),
                    max = PreferencesRules.PLACES_MAX,
                    chips = false,
                    enabled = enabled,
                    modifier = Modifier.locate("country_codes", locator),
                )
                if (placesShown) {
                    RegionIdsField(
                        countryCodes = values.countryCodes,
                        selected = values.regionIds,
                        onChange = { ids -> edit("region_ids") { it.copy(regionIds = ids) } },
                        error = error("region_ids"),
                        enabled = enabled,
                        modifier = Modifier.locate("region_ids", locator),
                    )
                    CityIdsField(
                        countryCodes = values.countryCodes,
                        selected = values.cityIds,
                        onChange = { ids -> edit("city_ids") { it.copy(cityIds = ids) } },
                        error = error("city_ids"),
                        enabled = enabled,
                        modifier = Modifier.locate("city_ids", locator),
                    )
                } else {
                    KrTextLink(
                        text = stringResource(R.string.preferences_rows_add_places),
                        onClick = { placesOpen = true },
                        enabled = enabled,
                    )
                }
            }
        }
        val educationLabel = stringResource(R.string.preferences_rows_education)
        DimensionRow(Dimension.EDUCATION, educationLabel) {
            SelectField(
                label = educationLabel,
                options = educationOptions(any),
                selected = values.educationMinRank?.toString(),
                onSelect = { code -> edit("education_min_rank") { it.copy(educationMinRank = code?.toIntOrNull()) } },
                placeholder = any,
                error = error("education_min_rank"),
                clearable = false,
                enabled = enabled,
                modifier = Modifier.locate("education_min_rank", locator),
            )
        }

        CollapsibleHeader(
            title = stringResource(R.string.preferences_more),
            expanded = tierTwoShown,
            onToggle = { tierTwoOpen = tierTwoError || !tierTwoShown },
        )
        CollapsibleContent(visible = tierTwoShown, instant = tierTwoError, spacing = RowGap) {
            val heightLabel = stringResource(R.string.preferences_rows_height)
            DimensionRow(Dimension.HEIGHT, heightLabel) {
                HeightRangeControl(
                    label = heightLabel,
                    min = values.heightMin,
                    max = values.heightMax,
                    onChange = { min, max -> edit("height") { it.copy(heightMin = min, heightMax = max) } },
                    enabled = enabled,
                    error = error("height"),
                    modifier = Modifier.locate("height", locator),
                )
            }
            val childrenLabel = stringResource(R.string.preferences_rows_children)
            DimensionRow(Dimension.CHILDREN, childrenLabel) {
                val cards =
                    remember(reference) {
                        reference.options(Lists.CHILDREN_ACCEPTANCE).map { RadioCard(it.code, it.label) }
                    }
                RadioCardsField(
                    cards = cards,
                    selected = values.childrenAcceptance,
                    onSelect = { code -> edit("children_acceptance") { it.copy(childrenAcceptance = code) } },
                    label = childrenLabel,
                    error = error("children_acceptance"),
                    enabled = enabled,
                    modifier = Modifier.locate("children_acceptance", locator),
                )
            }
            val casteLabel = stringResource(R.string.preferences_rows_caste)
            DimensionRow(Dimension.CASTE, casteLabel) {
                MultiSelectField(
                    label = casteLabel,
                    options = remember(reference) { reference.casteOptions() },
                    selected = values.casteCodes,
                    onChange = { codes -> edit("caste_codes") { it.copy(casteCodes = codes) } },
                    helper = if (values.casteCodes.isEmpty()) any else null,
                    error = error("caste_codes"),
                    max = PreferencesRules.CASTES_MAX,
                    chips = false,
                    enabled = enabled,
                    modifier = Modifier.locate("caste_codes", locator),
                )
            }
            val tongueLabel = stringResource(R.string.preferences_rows_mother_tongue)
            DimensionRow(Dimension.MOTHER_TONGUE, tongueLabel) {
                MultiSelectField(
                    label = tongueLabel,
                    options = remember(reference) { reference.languageOptions() },
                    selected = values.motherTongueCodes,
                    onChange = { codes -> edit("mother_tongue_codes") { it.copy(motherTongueCodes = codes) } },
                    helper = if (values.motherTongueCodes.isEmpty()) any else null,
                    error = error("mother_tongue_codes"),
                    chips = false,
                    enabled = enabled,
                    modifier = Modifier.locate("mother_tongue_codes", locator),
                )
            }
            DimensionRow(Dimension.PROFESSION, stringResource(R.string.preferences_rows_profession)) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
                    ChipsRow(
                        "employment_types",
                        stringResource(R.string.preferences_rows_employment),
                        reference.options(Lists.EMPLOYMENT_TYPE),
                        values.employmentTypes,
                    ) { input, codes -> input.copy(employmentTypes = codes) }
                    MultiSelectField(
                        label = stringResource(R.string.preferences_rows_profession_list),
                        options = remember(reference) { reference.professionOptions() },
                        selected = values.professionCodes,
                        onChange = { codes -> edit("profession_codes") { it.copy(professionCodes = codes) } },
                        helper = if (values.professionCodes.isEmpty()) any else null,
                        error = error("profession_codes"),
                        max = PreferencesRules.PLACES_MAX,
                        chips = false,
                        enabled = enabled,
                        modifier = Modifier.locate("profession_codes", locator),
                    )
                }
            }
            val incomeLabel = stringResource(R.string.preferences_rows_income)
            DimensionRow(Dimension.INCOME, incomeLabel) {
                SelectField(
                    label = incomeLabel,
                    options = incomeOptions(any),
                    selected = values.incomeMinRank?.toString(),
                    onSelect = { code -> edit("income_min_rank") { it.copy(incomeMinRank = code?.toIntOrNull()) } },
                    placeholder = any,
                    error = error("income_min_rank"),
                    clearable = false,
                    enabled = enabled,
                    modifier = Modifier.locate("income_min_rank", locator),
                )
            }
            val religiosityLabel = stringResource(R.string.preferences_rows_religiosity)
            DimensionRow(Dimension.RELIGIOSITY, religiosityLabel) {
                ChipsRow(
                    "religiosity_levels",
                    religiosityLabel,
                    reference.options(Lists.RELIGIOSITY),
                    values.religiosityLevels,
                ) { input, codes ->
                    input.copy(religiosityLevels = codes)
                }
            }
            // The candidate is female: the beard of the men she looks for; otherwise the hijab (07 section 11.2).
            val appearanceLabel =
                stringResource(
                    if (female) {
                        R.string.preferences_rows_appearance_beard
                    } else {
                        R.string.preferences_rows_appearance_hijab
                    },
                )
            DimensionRow(Dimension.APPEARANCE, appearanceLabel) {
                if (female) {
                    ChipsRow(
                        "beard_types",
                        appearanceLabel,
                        reference.options(Lists.BEARD),
                        values.beardTypes,
                    ) { input, codes ->
                        input.copy(beardTypes = codes)
                    }
                } else {
                    ChipsRow(
                        "hijab_types",
                        appearanceLabel,
                        reference.options(Lists.HIJAB),
                        values.hijabTypes,
                    ) { input, codes ->
                        input.copy(hijabTypes = codes)
                    }
                }
            }
            DimensionRow(Dimension.FAMILY, stringResource(R.string.preferences_rows_family)) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
                    ChipsRow(
                        "family_values",
                        stringResource(R.string.preferences_rows_family_values),
                        reference.options(Lists.FAMILY_VALUES),
                        values.familyValues,
                    ) { input, codes -> input.copy(familyValues = codes) }
                    ChipsRow(
                        "family_types",
                        stringResource(R.string.preferences_rows_family_types),
                        reference.options(Lists.FAMILY_TYPE),
                        values.familyTypes,
                    ) { input, codes -> input.copy(familyTypes = codes) }
                }
            }
            val livingLabel = stringResource(R.string.preferences_rows_living_arrangement)
            DimensionRow(Dimension.LIVING_ARRANGEMENT, livingLabel) {
                ChipsRow(
                    "living_arrangements",
                    livingLabel,
                    reference.options(Lists.LIVING_ARRANGEMENT),
                    values.livingArrangements,
                ) { input, codes ->
                    input.copy(livingArrangements = codes)
                }
            }
            val workLabel =
                stringResource(
                    if (female) {
                        R.string.preferences_rows_work_after_marriage_female
                    } else {
                        R.string.preferences_rows_work_after_marriage_male
                    },
                )
            DimensionRow(Dimension.WORK_AFTER_MARRIAGE, workLabel) {
                ChipsRow(
                    "work_after_marriage_options",
                    workLabel,
                    reference.options(Lists.WORK_AFTER_MARRIAGE),
                    values.workAfterMarriageOptions,
                ) { input, codes -> input.copy(workAfterMarriageOptions = codes) }
            }
            val smokingLabel = stringResource(R.string.preferences_rows_smoking)
            DimensionRow(Dimension.SMOKING, smokingLabel) {
                ChipsRow(
                    "smoking_options",
                    smokingLabel,
                    reference.options(Lists.SMOKING),
                    values.smokingOptions,
                ) { input, codes ->
                    input.copy(smokingOptions = codes)
                }
            }
            Column(Modifier.locate("notes", locator), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                KrTextField(
                    value = values.notes,
                    onValueChange = { text -> edit("notes") { it.copy(notes = text) } },
                    label = stringResource(R.string.preferences_notes_label),
                    helper = stringResource(R.string.preferences_notes_help),
                    error = error("notes"),
                    optional = true,
                    maxLength = PreferencesRules.NOTES_MAX,
                    singleLine = false,
                    minLines = NOTES_LINES,
                    enabled = enabled,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                TextStatusNote(ui.notesStatus)
            }
        }
    }
}

private val BRACKETS = Regex("\\s*\\(.*\\)\\s*$")
private val AMOUNT = Regex("\\d[\\d,]*")

/** "Any", then each rank as "Bachelor's degree or higher", without the brackets of its name (05 section 7). */
@Composable
private fun educationOptions(any: String): List<Option> {
    val reference = LocalReference.current
    val res = LocalResources.current
    return remember(reference, res, any) {
        listOf(Option(NOT_SPECIFIED, any)) +
            reference.educationRanks().map { (rank, name) ->
                Option(
                    rank.toString(),
                    res.text(R.string.preferences_rows_education_option, "name" to name.replace(BRACKETS, "")),
                )
            }
    }
}

/** "Any", then the PKR bands as "At least ... PKR a month or the equivalent abroad" (05 section 10.3). */
@Composable
private fun incomeOptions(any: String): List<Option> {
    val reference = LocalReference.current
    val res = LocalResources.current
    return remember(reference, res, any) {
        listOf(Option(NOT_SPECIFIED, any)) +
            reference.data.incomeBands
                .filter { it.currencyCode == "PKR" }
                .sortedBy { it.rank }
                .mapNotNull { band ->
                    val value = AMOUNT.find(band.label)?.value
                    if (value == null || band.rank == 1) null else band.rank to value
                }.map { (rank, value) ->
                    Option(rank.toString(), res.text(R.string.preferences_rows_income_option, "amount" to value))
                }
    }
}

/** A matching dimension: its value, then its importance, and a hairline (07 sections 11.2 and 11.3). */
@Composable
private fun PreferenceRow(
    label: String,
    importance: Importance,
    onImportance: (Importance) -> Unit,
    enabled: Boolean,
    error: String?,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
        content()
        ImportanceSelector(
            label = text(R.string.preferences_importance_label, "row" to label),
            value = importance,
            onChange = onImportance,
            enabled = enabled,
            error = error,
        )
        RowDivider(Modifier.padding(top = Spacing.s8))
    }
}

/**
 * The four importance choices (07 section 11.3) as chips that wrap. Disabled when the row has no
 * preference; the stored value is kept. "Must have" shows its note directly under the row.
 */
@Composable
private fun ImportanceSelector(
    label: String,
    value: Importance,
    onChange: (Importance) -> Unit,
    enabled: Boolean,
    error: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Spacing.s8),
        )
        ImportanceField(value = value, onChange = onChange, enabled = enabled)
        FieldSupport(null, error)
    }
}

/** The label of a range and what is chosen, which drops under it when the two do not fit. */
@Composable
private fun RangeHeading(
    label: String,
    shown: String?,
    modifier: Modifier = Modifier,
) {
    val style = MaterialTheme.typography.labelLarge
    AdaptiveRow(
        modifier = modifier.fillMaxWidth(),
        lineSpacing = Spacing.s4,
        verticalAlignment = Alignment.Top,
    ) {
        Text(label, style = style, modifier = Modifier.grow())
        if (shown != null) {
            Text(
                text = shown,
                style = style.copy(fontFeatureSettings = TABULAR_FIGURES),
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/** Age 18 to 80 with two handles, shown as "25 to 32 years"; the full range is no preference. */
@Composable
private fun AgeRangeControl(
    label: String,
    min: Int,
    max: Int,
    onChange: (Int, Int) -> Unit,
    enabled: Boolean,
    error: String?,
    modifier: Modifier = Modifier,
) {
    val shown = text(R.string.onboarding_android_age_range, "min" to min, "max" to max)
    Column(modifier.fillMaxWidth()) {
        RangeHeading(label = label, shown = shown)
        IntRangeSlider(
            start = min.coerceIn(AGE_MIN, AGE_MAX),
            end = max.coerceIn(AGE_MIN, AGE_MAX),
            bounds = AGE_MIN..AGE_MAX,
            onChange = onChange,
            enabled = enabled,
            stepped = true,
            modifier = Modifier.semantics { contentDescription = "$label, $shown" },
        )
        FieldSupport(null, error)
    }
}

/**
 * Height 4 ft 0 in to 7 ft 0 in with two handles, by the inch, and a "No preference" switch that
 * sends both ends as `null`; turning it off starts from the full range (07 section 11.2).
 */
@Composable
private fun HeightRangeControl(
    label: String,
    min: Int?,
    max: Int?,
    onChange: (Int?, Int?) -> Unit,
    enabled: Boolean,
    error: String?,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val noPreference = min == null && max == null
    val lowest = Formatters.cmToFeetInches(Formatters.MIN_HEIGHT_CM).let { (f, i) -> f * INCHES + i }
    val highest = Formatters.cmToFeetInches(Formatters.MAX_HEIGHT_CM).let { (f, i) -> f * INCHES + i }

    fun inchesOf(cm: Int?): Int? = cm?.let { Formatters.cmToFeetInches(it) }?.let { (f, i) -> f * INCHES + i }

    fun cmOf(inches: Int): Int = Formatters.feetInchesToCm(inches / INCHES, inches % INCHES)
    val from = (inchesOf(min) ?: lowest).coerceIn(lowest, highest)
    val to = (inchesOf(max) ?: highest).coerceIn(lowest, highest)
    val shown =
        text(
            R.string.onboarding_android_height_range,
            "min" to Formatters.heightShort(res, cmOf(from)),
            "max" to Formatters.heightShort(res, cmOf(to)),
        )
    Column(modifier.fillMaxWidth()) {
        RangeHeading(label = label, shown = if (noPreference) null else shown)
        SwitchRow(
            title = stringResource(R.string.fields_range_no_preference),
            checked = noPreference,
            onCheckedChange = { on ->
                if (on) onChange(null, null) else onChange(Formatters.MIN_HEIGHT_CM, Formatters.MAX_HEIGHT_CM)
            },
            enabled = enabled,
            modifier = Modifier.padding(top = Spacing.s8),
        )
        if (!noPreference) {
            IntRangeSlider(
                start = from,
                end = to,
                bounds = lowest..highest,
                onChange = { start, end -> onChange(cmOf(start), cmOf(end)) },
                enabled = enabled,
                stepped = true,
                modifier =
                    Modifier
                        .padding(top = Spacing.s8)
                        .semantics { contentDescription = "$label, $shown" },
            )
        }
        FieldSupport(null, error)
    }
}

private val RowGap = Spacing.s24
private const val INCHES = 12
private const val NOTES_LINES = 4
