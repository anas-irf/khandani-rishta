package com.khandanirishta.app.ui.feature.search

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.PersonSearch
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.Beard
import com.khandanirishta.app.core.network.generated.model.ChildrenAcceptance
import com.khandanirishta.app.core.network.generated.model.EmploymentType
import com.khandanirishta.app.core.network.generated.model.FamilyType
import com.khandanirishta.app.core.network.generated.model.FamilyValues
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Hijab
import com.khandanirishta.app.core.network.generated.model.LivingArrangement
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.Religiosity
import com.khandanirishta.app.core.network.generated.model.Smoking
import com.khandanirishta.app.core.network.generated.model.WorkAfterMarriage
import com.khandanirishta.app.core.network.serialization.WireEnum
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.ChoiceChips
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.components.RangeField
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalViewerCountry
import com.khandanirishta.app.ui.text.plural

/**
 * The filter form of APP-SEARCH (specs/16 section 6.6): the saved searches, the profile code, the
 * filter groups as expandable cards and a bar with "Reset" and "Search" that stays at the bottom.
 */
@Composable
internal fun FilterFormView(
    state: SearchUiState,
    options: FilterOptions,
    online: Boolean,
    actions: SearchActions,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val gender = LocalMe.current?.profile?.gender
    val viewerCountry = LocalViewerCountry.current
    Column(
        modifier
            .fillMaxSize()
            .imePadding(),
    ) {
        LazyColumn(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (state.savedSearches.isNotEmpty()) {
                item(key = "saved") {
                    SavedSearchRow(
                        items = state.savedSearches,
                        online = online,
                        onRun = actions::runSaved,
                        onRename = actions::openRename,
                        onToggleNotify = actions::toggleNotify,
                        onRemove = actions::askRemove,
                    )
                }
            }
            item(key = "code") {
                CodeFinder(
                    error = state.codeError?.resolve(res),
                    busy = state.findingCode,
                    online = online,
                    onFind = actions::findCode,
                    onEdit = actions::clearCodeError,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            item(key = "filters") {
                FiltersHeader(
                    canUsePreferences = state.preferencesLoaded,
                    onUsePreferences = actions::usePreferences,
                    modifier = Modifier.padding(start = 16.dp, end = 4.dp),
                )
            }
            items(FilterGroup.entries, key = { it.name }) { group ->
                FilterGroupCard(
                    group = group,
                    count = state.draft.activeCount(group),
                    hasError = FilterControl.entries.any { it.group == group && state.errorFor(it) != null },
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    GroupControls(
                        group = group,
                        state = state,
                        options = options,
                        viewerGender = gender,
                        viewerCountry = viewerCountry,
                        actions = actions,
                    )
                }
            }
        }
        FormActionBar(online = online, onReset = actions::reset, onSearch = actions::search)
    }
}

/** "Profile code" with "Find" (16 section 6.6). */
@Composable
private fun CodeFinder(
    error: String?,
    busy: Boolean,
    online: Boolean,
    onFind: (String) -> Unit,
    onEdit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var code by rememberSaveable { mutableStateOf("") }
    val label = stringResource(R.string.discovery_search_code_label)
    val focus = LocalFocusManager.current
    val find = {
        focus.clearFocus()
        onFind(code)
    }
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.PersonSearch,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(label, style = MaterialTheme.typography.labelLarge)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { value ->
                        code = value.take(CODE_INPUT_MAX)
                        onEdit()
                    },
                    placeholder = { Text(stringResource(R.string.discovery_search_code_placeholder)) },
                    isError = error != null,
                    singleLine = true,
                    keyboardOptions =
                        KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                            autoCorrectEnabled = false,
                            keyboardType = KeyboardType.Ascii,
                            imeAction = ImeAction.Search,
                        ),
                    keyboardActions = KeyboardActions(onSearch = { find() }),
                    shape = MaterialTheme.shapes.small,
                    modifier =
                        Modifier
                            .weight(1f)
                            .semantics { contentDescription = label },
                )
                Button(
                    onClick = find,
                    enabled = online && !busy,
                    modifier = Modifier.heightIn(min = 56.dp),
                ) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Text(stringResource(R.string.discovery_search_find))
                    }
                }
            }
            FieldSupport(
                helper = null,
                error = error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/** "Search filters" with "Use my preferences" (16 section 6.6, form actions). */
@Composable
private fun FiltersHeader(
    canUsePreferences: Boolean,
    onUsePreferences: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            stringResource(R.string.discovery_search_form_label),
            style = MaterialTheme.typography.titleMedium,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics { heading() },
        )
        TextButton(onClick = onUsePreferences, enabled = canUsePreferences) {
            Icon(Icons.Outlined.Tune, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.discovery_search_actions_use_preferences))
        }
    }
}

/** "Reset" clears every control without searching; "Search" runs the form. */
@Composable
private fun FormActionBar(
    online: Boolean,
    onReset: () -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 8.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(onClick = onReset, modifier = Modifier.heightIn(min = 52.dp)) {
                Icon(Icons.Outlined.RestartAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.discovery_search_actions_reset))
            }
            Button(
                onClick = onSearch,
                enabled = online,
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 52.dp),
            ) {
                Icon(Icons.Outlined.Search, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.discovery_search_actions_search))
            }
        }
    }
}

/**
 * One group of the form as an expandable card, with its count of active filters in the heading.
 * A group opens by itself when the API named one of its fields.
 */
@Composable
private fun FilterGroupCard(
    group: FilterGroup,
    count: Int,
    hasError: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(group.expandedAtStart) }
    LaunchedEffect(hasError) {
        if (hasError) expanded = true
    }
    val rotation by animateFloatAsState(if (expanded) 180f else 0f, label = "chevron")
    val stateText =
        stringResource(if (expanded) R.string.search_android_expanded else R.string.search_android_collapsed)
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .clickable(role = Role.Button) { expanded = !expanded }
                    .semantics {
                        heading()
                        stateDescription = stateText
                    }.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(group.title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                if (count > 0) {
                    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                        Text(
                            plural(R.plurals.discovery_search_group_count, count),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                }
                Icon(
                    Icons.Filled.ExpandMore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.rotate(rotation),
                )
            }
            AnimatedVisibility(visible = expanded) {
                Column(
                    Modifier.padding(start = 16.dp, end = 16.dp, bottom = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    content = content,
                )
            }
        }
    }
}

/**
 * The controls of one group. Every control maps to one key of `SearchFilters`; an untouched
 * control sends nothing. Hijab is offered to a male viewer and beard to a female viewer.
 */
@Composable
private fun ColumnScope.GroupControls(
    group: FilterGroup,
    state: SearchUiState,
    options: FilterOptions,
    viewerGender: Gender?,
    viewerCountry: String,
    actions: SearchActions,
) {
    val res = LocalResources.current
    val draft = state.draft
    val error: (FilterControl) -> String? = { control -> state.errorFor(control)?.resolve(res) }
    when (group) {
        FilterGroup.BASICS -> {
            val ageLow = (draft.ageMin ?: AGE_MIN).coerceIn(AGE_MIN, AGE_MAX)
            RangeField(
                label = stringResource(R.string.discovery_search_fields_age),
                min = ageLow,
                max = (draft.ageMax ?: AGE_MAX).coerceIn(ageLow, AGE_MAX),
                bounds = AGE_MIN..AGE_MAX,
                onChange = { min, max ->
                    // The ends of the slider mean "no limit", so they send nothing.
                    val low = min.takeIf { it != AGE_MIN }
                    val high = max.takeIf { it != AGE_MAX }
                    actions.updateDraft { it.copy(ageMin = low, ageMax = high) }
                },
                error = error(FilterControl.AGE),
            )
            val heightLow =
                draft.heightMinCm
                    ?.let(::cmToInches)
                    ?.coerceIn(HEIGHT_MIN_INCHES, HEIGHT_MAX_INCHES)
                    ?: HEIGHT_MIN_INCHES
            RangeField(
                label = stringResource(R.string.discovery_search_fields_height),
                min = heightLow,
                max = draft.heightMaxCm?.let(::cmToInches)?.coerceIn(heightLow, HEIGHT_MAX_INCHES) ?: HEIGHT_MAX_INCHES,
                bounds = HEIGHT_MIN_INCHES..HEIGHT_MAX_INCHES,
                format = { inches -> Formatters.heightShort(res, inchesToCm(inches)) },
                onChange = { min, max ->
                    actions.updateDraft {
                        it.copy(
                            heightMinCm = sliderHeightCm(min, it.heightMinCm, HEIGHT_MIN_INCHES),
                            heightMaxCm = sliderHeightCm(max, it.heightMaxCm, HEIGHT_MAX_INCHES),
                        )
                    }
                },
                error = error(FilterControl.HEIGHT),
            )
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_marital_status),
                options = options.marital,
                values = draft.maritalStatuses,
                entries = MaritalStatus.entries,
                onChange = { values -> actions.updateDraft { it.copy(maritalStatuses = values) } },
                error = error(FilterControl.MARITAL_STATUS),
            )
            SelectField(
                label = stringResource(R.string.discovery_search_fields_children),
                options = options.children,
                selected =
                    draft.childrenAcceptance
                        ?.takeIf { it != ChildrenAcceptance.ANY && it != ChildrenAcceptance.UNKNOWN }
                        ?.wire ?: ANY,
                onSelect = { code ->
                    val value =
                        ChildrenAcceptance.entries.firstOrNull { it.wire == code && it != ChildrenAcceptance.UNKNOWN }
                    actions.updateDraft { it.copy(childrenAcceptance = value) }
                },
                error = error(FilterControl.CHILDREN),
                searchable = false,
            )
        }

        FilterGroup.COMMUNITY -> {
            CodesField(
                label = stringResource(R.string.discovery_search_fields_religion),
                options = options.religions,
                values = draft.religionCodes,
                onChange = { religions ->
                    // Sects of religions that are no longer chosen leave with them.
                    val allowed =
                        if (religions.isEmpty()) emptySet() else options.sects(religions).map { it.code }.toSet()
                    actions.updateDraft { filters ->
                        filters.copy(religionCodes = religions, sectCodes = filters.sectCodes?.filter { it in allowed })
                    }
                },
                error = error(FilterControl.RELIGION),
            )
            if (!draft.religionCodes.isNullOrEmpty() || !draft.sectCodes.isNullOrEmpty()) {
                val sects = options.sects(draft.religionCodes)
                if (sects.isNotEmpty()) {
                    CodesField(
                        label = stringResource(R.string.discovery_search_fields_sect),
                        options = sects,
                        values = draft.sectCodes,
                        onChange = { codes -> actions.updateDraft { it.copy(sectCodes = codes) } },
                        error = error(FilterControl.SECT),
                    )
                }
            }
            CasteField(
                options = options.castes,
                aliases = options::casteAliases,
                selected = draft.casteCodes.orEmpty().toSet(),
                onChange = { codes -> actions.updateDraft { it.copy(casteCodes = codes.toList()) } },
                error = error(FilterControl.CASTE),
            )
            CodesField(
                label = stringResource(R.string.discovery_search_fields_mother_tongue),
                options = options.languages,
                values = draft.motherTongueCodes,
                onChange = { codes -> actions.updateDraft { it.copy(motherTongueCodes = codes) } },
                error = error(FilterControl.MOTHER_TONGUE),
            )
        }

        FilterGroup.LOCATION -> {
            CodesField(
                label = stringResource(R.string.discovery_search_fields_country),
                options = options.countries,
                values = draft.countryCodes,
                onChange = actions::setCountries,
                error = error(FilterControl.COUNTRY),
            )
            RegionsField(
                countries = draft.countryCodes.orEmpty(),
                regions = state.regions,
                selected = draft.regionIds.orEmpty(),
                countryName = options::countryName,
                onChange = { ids -> actions.updateDraft { it.copy(regionIds = ids) } },
                error = error(FilterControl.REGION),
            )
            CityField(
                selected = draft.cityIds.orEmpty(),
                names = state.cityNames,
                countries = draft.countryCodes.orEmpty().ifEmpty { listOf(viewerCountry) },
                countryName = options::countryName,
                search = state.citySearch,
                onQuery = actions::searchCities,
                onAdd = actions::addCity,
                onRemove = actions::removeCity,
                error = error(FilterControl.CITY),
            )
        }

        FilterGroup.EDUCATION_WORK -> {
            SelectField(
                label = stringResource(R.string.discovery_search_fields_education),
                options = options.education,
                selected = draft.educationMinRank?.toString() ?: ANY,
                onSelect = { code -> actions.updateDraft { it.copy(educationMinRank = code?.toIntOrNull()) } },
                error = error(FilterControl.EDUCATION),
                searchable = false,
            )
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_employment),
                options = options.employment,
                values = draft.employmentTypes,
                entries = EmploymentType.entries,
                onChange = { values -> actions.updateDraft { it.copy(employmentTypes = values) } },
                error = error(FilterControl.EMPLOYMENT),
            )
            CodesField(
                label = stringResource(R.string.discovery_search_fields_profession),
                options = options.professions,
                values = draft.professionCodes,
                onChange = { codes -> actions.updateDraft { it.copy(professionCodes = codes) } },
                error = error(FilterControl.PROFESSION),
            )
            SelectField(
                label = stringResource(R.string.discovery_search_fields_income),
                options = options.income,
                selected = draft.incomeMinRank?.toString() ?: ANY,
                onSelect = { code -> actions.updateDraft { it.copy(incomeMinRank = code?.toIntOrNull()) } },
                error = error(FilterControl.INCOME),
                searchable = false,
            )
        }

        FilterGroup.FAITH -> {
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_religiosity),
                options = options.religiosity,
                values = draft.religiosityLevels,
                entries = Religiosity.entries,
                onChange = { values -> actions.updateDraft { it.copy(religiosityLevels = values) } },
                error = error(FilterControl.RELIGIOSITY),
            )
            if (viewerGender == Gender.MALE) {
                EnumChipsField(
                    label = stringResource(R.string.discovery_search_fields_hijab),
                    options = options.hijab,
                    values = draft.hijabTypes,
                    entries = Hijab.entries,
                    onChange = { values -> actions.updateDraft { it.copy(hijabTypes = values) } },
                    error = error(FilterControl.HIJAB),
                )
            }
            if (viewerGender == Gender.FEMALE) {
                EnumChipsField(
                    label = stringResource(R.string.discovery_search_fields_beard),
                    options = options.beard,
                    values = draft.beardTypes,
                    entries = Beard.entries,
                    onChange = { values -> actions.updateDraft { it.copy(beardTypes = values) } },
                    error = error(FilterControl.BEARD),
                )
            }
        }

        FilterGroup.FAMILY -> {
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_family_values),
                options = options.familyValues,
                values = draft.familyValues,
                entries = FamilyValues.entries,
                onChange = { values -> actions.updateDraft { it.copy(familyValues = values) } },
                error = error(FilterControl.FAMILY_VALUES),
            )
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_family_type),
                options = options.familyTypes,
                values = draft.familyTypes,
                entries = FamilyType.entries,
                onChange = { values -> actions.updateDraft { it.copy(familyTypes = values) } },
                error = error(FilterControl.FAMILY_TYPE),
            )
        }

        FilterGroup.LIFESTYLE -> {
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_living),
                options = options.living,
                values = draft.livingArrangements,
                entries = LivingArrangement.entries,
                onChange = { values -> actions.updateDraft { it.copy(livingArrangements = values) } },
                error = error(FilterControl.LIVING),
            )
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_work),
                options = options.work,
                values = draft.workAfterMarriageOptions,
                entries = WorkAfterMarriage.entries,
                onChange = { values -> actions.updateDraft { it.copy(workAfterMarriageOptions = values) } },
                error = error(FilterControl.WORK),
            )
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_smoking),
                options = options.smoking,
                values = draft.smokingOptions,
                entries = Smoking.entries,
                onChange = { values -> actions.updateDraft { it.copy(smokingOptions = values) } },
                error = error(FilterControl.SMOKING),
            )
        }

        FilterGroup.PROFILE -> {
            EnumChipsField(
                label = stringResource(R.string.discovery_search_fields_managed_by),
                options = options.managedBy,
                values = draft.managedBy,
                entries = ManagedBy.entries,
                onChange = { values -> actions.updateDraft { it.copy(managedBy = values) } },
                error = error(FilterControl.MANAGED_BY),
            )
            FilterSwitch(
                label = stringResource(R.string.discovery_search_fields_has_photo),
                checked = draft.hasPhoto == true,
                onChange = { on -> actions.updateDraft { it.copy(hasPhoto = on.takeIf { value -> value }) } },
            )
            FilterSwitch(
                label = stringResource(R.string.discovery_search_fields_verified_only),
                checked = draft.verifiedOnly == true,
                onChange = { on -> actions.updateDraft { it.copy(verifiedOnly = on.takeIf { value -> value }) } },
            )
            ChoiceField(
                label = stringResource(R.string.discovery_search_fields_active),
                options = options.active,
                selected = draft.activeWithinDays?.toString() ?: ANY,
                onSelect = { code -> actions.updateDraft { it.copy(activeWithinDays = code.toIntOrNull()) } },
                error = error(FilterControl.ACTIVE),
            )
            ChoiceField(
                label = stringResource(R.string.discovery_search_fields_joined),
                options = options.joined,
                selected = draft.joinedWithinDays?.toString() ?: ANY,
                onSelect = { code -> actions.updateDraft { it.copy(joinedWithinDays = code.toIntOrNull()) } },
                error = error(FilterControl.JOINED),
            )
        }
    }
}

/** Several choices of a closed list (chips for short lists, a searchable sheet for long ones). */
@Composable
private fun <E> EnumChipsField(
    label: String,
    options: List<Option>,
    values: List<E>?,
    entries: List<E>,
    onChange: (List<E>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) where E : Enum<E>, E : WireEnum {
    MultiSelectField(
        label = label,
        options = options,
        selected = values.wireSet(),
        onChange = { codes -> onChange(codes.toEnums(entries)) },
        modifier = modifier,
        error = error,
    )
}

/** Several codes of a reference list; long lists open a searchable sheet. */
@Composable
private fun CodesField(
    label: String,
    options: List<Option>,
    values: List<String>?,
    onChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    MultiSelectField(
        label = label,
        options = options,
        selected = values.orEmpty().toSet(),
        onChange = { codes -> onChange(codes.toList()) },
        modifier = modifier,
        error = error,
    )
}

/** One choice of a short list as chips; the first chip ("Any time") sends nothing. */
@Composable
private fun ChoiceField(
    label: String,
    options: List<Option>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        ChoiceChips(options = options, selected = selected, onSelect = onSelect)
        FieldSupport(helper = null, error = error)
    }
}

/** A switch with its label as one touch target. */
@Composable
private fun FilterSwitch(
    label: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = null)
    }
}

private const val CODE_INPUT_MAX = 20
