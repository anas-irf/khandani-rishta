package com.khandanirishta.app.ui.feature.preferences

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.IntRangeSlider
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.components.RadioCard
import com.khandanirishta.app.ui.components.RadioCardsField
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.feature.profilesections.CollapsibleHeader
import com.khandanirishta.app.ui.feature.profilesections.FieldLocator
import com.khandanirishta.app.ui.feature.profilesections.FormSummaryBox
import com.khandanirishta.app.ui.feature.profilesections.GroupTitle
import com.khandanirishta.app.ui.feature.profilesections.HelperText
import com.khandanirishta.app.ui.feature.profilesections.NOT_SPECIFIED
import com.khandanirishta.app.ui.feature.profilesections.TextStatusNote
import com.khandanirishta.app.ui.feature.profilesections.ToggleChipsField
import com.khandanirishta.app.ui.feature.profilesections.WarningBox
import com.khandanirishta.app.ui.feature.profilesections.locate
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text

/** Five or more must-haves can leave very few matches (07 section 11.3 rule 3). */
const val MUST_WARNING_AT = 5

/**
 * The partner preferences form of ONB-09 and ME-PREFS (07 section 11): the essentials, then
 * "More preferences" (collapsed, it opens when one of its fields has an error), each row with its
 * importance control, then the notes. The "{n} must-haves" line lives in the screen's bottom bar.
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
    val tierTwoShown = tierTwoOpen || PreferencesRules.TIER_TWO.any { form.error(it) != null }
    var placesOpen by rememberSaveable { mutableStateOf(false) }
    val placesShown =
        placesOpen || values.regionIds.isNotEmpty() || values.cityIds.isNotEmpty() ||
            form.error("region_ids") != null || form.error("city_ids") != null
    val musts = values.mustHaveCount(gender)

    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (form.showSummary) FormSummaryBox(form.unmatched)
        if (musts >= MUST_WARNING_AT) WarningBox(text(R.string.preferences_must_warning, "count" to musts))
        GroupTitle(stringResource(R.string.preferences_tier_essentials))
        HelperText(stringResource(R.string.fields_importance_help))

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
            ChipsRow(
                "marital_statuses",
                maritalLabel,
                reference.options(Lists.MARITAL_STATUS).filter { it.code != "married" || female },
                values.maritalStatuses,
            ) { input, codes -> input.copy(maritalStatuses = codes) }
        }
        val religionLabel = stringResource(R.string.preferences_rows_religion)
        DimensionRow(Dimension.RELIGION, religionLabel) {
            ToggleChipsField(
                label = religionLabel,
                groups = listOf(null to reference.religionOptions()),
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
            if (values.religionCodes.isEmpty()) emptyList() else reference.sectOptions(values.religionCodes)
        if (sectOptions.isNotEmpty()) {
            val sectLabel = stringResource(R.string.preferences_rows_sect)
            DimensionRow(Dimension.SECT, sectLabel) {
                ChipsRow("sect_codes", sectLabel, sectOptions, values.sectCodes) { input, codes ->
                    input.copy(sectCodes = codes)
                }
            }
        }
        DimensionRow(Dimension.LOCATION, stringResource(R.string.preferences_rows_location)) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                MultiSelectField(
                    label = stringResource(R.string.preferences_rows_countries),
                    options = remember(reference) { reference.countryOptions() },
                    selected = values.countryCodes,
                    onChange = { codes -> edit("country_codes") { it.copy(countryCodes = codes) } },
                    helper = if (values.countryCodes.isEmpty()) any else null,
                    error = error("country_codes"),
                    max = PreferencesRules.PLACES_MAX,
                    chips = false,
                    modifier = Modifier.locate("country_codes", locator),
                )
                if (placesShown) {
                    RegionIdsField(
                        countryCodes = values.countryCodes,
                        selected = values.regionIds,
                        onChange = { ids -> edit("region_ids") { it.copy(regionIds = ids) } },
                        error = error("region_ids"),
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
                    TextButton(onClick = { placesOpen = true }, enabled = enabled) {
                        Text(stringResource(R.string.preferences_rows_add_places))
                    }
                }
            }
        }
        val educationLabel = stringResource(R.string.preferences_rows_education)
        DimensionRow(Dimension.EDUCATION, educationLabel) {
            val ranks =
                reference.educationRanks().map { (rank, name) ->
                    Option(
                        rank.toString(),
                        text(R.string.preferences_rows_education_option, "name" to name.withoutBrackets()),
                    )
                }
            SelectField(
                label = educationLabel,
                options = listOf(Option(NOT_SPECIFIED, any)) + ranks,
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
            onToggle = { tierTwoOpen = !tierTwoShown },
            modifier = Modifier.padding(top = 8.dp),
        )
        AnimatedVisibility(visible = tierTwoShown) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
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
                    RadioCardsField(
                        cards = reference.options(Lists.CHILDREN_ACCEPTANCE).map { RadioCard(it.code, it.label) },
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
                        modifier = Modifier.locate("mother_tongue_codes", locator),
                    )
                }
                DimensionRow(Dimension.PROFESSION, stringResource(R.string.preferences_rows_profession)) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
                            modifier = Modifier.locate("profession_codes", locator),
                        )
                    }
                }
                val incomeLabel = stringResource(R.string.preferences_rows_income)
                DimensionRow(Dimension.INCOME, incomeLabel) {
                    val bands = incomeOptions()
                    SelectField(
                        label = incomeLabel,
                        options = listOf(Option(NOT_SPECIFIED, any)) + bands,
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
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
                Column(Modifier.locate("notes", locator), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
}

/** "Bachelor's degree (BA, BSc)" reads "Bachelor's degree" in "... or higher" (05 section 7). */
private fun String.withoutBrackets(): String = replace(Regex("\\s*\\(.*\\)\\s*$"), "")

/** The PKR bands by rank as "At least ... PKR a month or the equivalent abroad" (05 section 10.3). */
@Composable
private fun incomeOptions(): List<Option> {
    val reference = LocalReference.current
    val amount = Regex("\\d[\\d,]*")
    return reference.data.incomeBands
        .filter { it.currencyCode == "PKR" }
        .sortedBy { it.rank }
        .mapNotNull { band ->
            val value = amount.find(band.label)?.value
            if (value == null || band.rank == 1) null else band.rank to value
        }.map { (rank, value) ->
            Option(rank.toString(), text(R.string.preferences_rows_income_option, "amount" to value))
        }
}

/** A matching dimension as a card: its value control and its importance (07 sections 11.2 and 11.3). */
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
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            content()
            ImportanceSelector(
                label = text(R.string.preferences_importance_label, "row" to label),
                value = importance,
                onChange = onImportance,
                enabled = enabled,
                error = error,
            )
        }
    }
}

/**
 * The four importance choices (07 section 11.3). Disabled and greyed when the row has no
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
    val reference = LocalReference.current
    val options =
        remember(reference) {
            reference.optionsOf(
                Lists.IMPORTANCE,
                listOf(Importance.MUST, Importance.HIGH, Importance.MEDIUM, Importance.LOW),
            )
        }
    Column(modifier.fillMaxWidth()) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min),
        ) {
            options.forEachIndexed { index, (option, text) ->
                SegmentedButton(
                    selected = option == value,
                    onClick = { onChange(option) },
                    shape = SegmentedButtonDefaults.itemShape(index, options.size),
                    modifier = Modifier.fillMaxHeight(),
                    enabled = enabled,
                    colors =
                        SegmentedButtonDefaults.colors(
                            activeContainerColor =
                                if (option == Importance.MUST) {
                                    MaterialTheme.colorScheme.tertiaryContainer
                                } else {
                                    MaterialTheme.colorScheme.primaryContainer
                                },
                        ),
                    icon = {},
                    label = {
                        Text(
                            text,
                            style = MaterialTheme.typography.labelMedium,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                        )
                    },
                )
            }
        }
        if (value == Importance.MUST && enabled) {
            Text(
                stringResource(R.string.preferences_must_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        FieldSupport(null, error)
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text(shown, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            if (!noPreference) {
                Text(shown, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
            Text(
                stringResource(R.string.fields_range_no_preference),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Switch(
                checked = noPreference,
                onCheckedChange = { on ->
                    if (on) onChange(null, null) else onChange(Formatters.MIN_HEIGHT_CM, Formatters.MAX_HEIGHT_CM)
                },
                enabled = enabled,
            )
        }
        if (!noPreference) {
            Spacer(Modifier.size(4.dp))
            IntRangeSlider(
                start = from,
                end = to,
                bounds = lowest..highest,
                onChange = { start, end -> onChange(cmOf(start), cmOf(end)) },
                enabled = enabled,
                stepped = true,
                modifier = Modifier.semantics { contentDescription = "$label, $shown" },
            )
        }
        FieldSupport(null, error)
    }
}

private const val INCHES = 12
private const val NOTES_LINES = 4
