package com.khandanirishta.app.ui.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.core.network.generated.model.RegionItem
import com.khandanirishta.app.ui.components.ChoiceChips
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.text.text

/*
 * Controls of the search form that the shared fields do not cover: regions per chosen country,
 * the city search and the caste picker that also matches aliases.
 */

/** "Province or state": the regions of each chosen country (`GET /v1/reference/regions`). */
@Composable
internal fun RegionsField(
    countries: List<String>,
    regions: Map<String, List<RegionItem>>,
    selected: List<Int>,
    countryName: (String) -> String,
    onChange: (List<Int>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    val lists = countries.mapNotNull { country -> regions[country]?.takeIf { it.isNotEmpty() }?.let { country to it } }
    if (lists.isEmpty()) return
    val label = stringResource(R.string.discovery_search_fields_region)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (lists.size > 1) FieldLabel(label)
        lists.forEach { (country, items) ->
            key(country) {
                val ids = items.map { it.id }.toSet()
                MultiSelectField(
                    label = if (lists.size > 1) countryName(country) else label,
                    options = items.map { Option(it.id.toString(), it.name) },
                    selected = selected.filter { it in ids }.map { it.toString() }.toSet(),
                    onChange = { codes ->
                        onChange(selected.filterNot { it in ids } + codes.mapNotNull { it.toIntOrNull() })
                    },
                )
            }
        }
        if (error != null) FieldSupport(helper = null, error = error)
    }
}

/**
 * "City": the chosen cities as removable chips and "Add", which opens a search of the cities of
 * the chosen countries (the viewer's own country when none is chosen).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CityField(
    selected: List<Int>,
    names: Map<Int, String>,
    countries: List<String>,
    countryName: (String) -> String,
    search: CitySearch,
    onQuery: (String, String) -> Unit,
    onAdd: (CityRef) -> Unit,
    onRemove: (Int) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val label = stringResource(R.string.discovery_search_fields_city)
    val unknown = stringResource(R.string.discovery_search_city_unknown)
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            selected.forEach { id ->
                val name = names[id] ?: unknown
                RemovableChip(
                    label = name,
                    removeLabel = text(R.string.discovery_search_remove_value, "value" to name),
                    onRemove = { onRemove(id) },
                )
            }
            AddChip(
                description = text(R.string.discovery_search_add_named, "label" to label),
                onClick = { open = true },
            )
        }
        FieldSupport(helper = null, error = error)
        if (open && countries.isNotEmpty()) {
            CitySheet(
                countries = countries,
                countryName = countryName,
                selected = selected,
                search = search,
                onQuery = onQuery,
                onToggle = { city -> if (city.id in selected) onRemove(city.id) else onAdd(city) },
                onDismiss = { open = false },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CitySheet(
    countries: List<String>,
    countryName: (String) -> String,
    selected: List<Int>,
    search: CitySearch,
    onQuery: (String, String) -> Unit,
    onToggle: (CityRef) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState =
        rememberBottomSheetState(
            initialValue = SheetValue.Hidden,
            enabledValues = setOf(SheetValue.Hidden, SheetValue.Expanded),
        )
    var chosenCountry by rememberSaveable { mutableStateOf(countries.first()) }
    val country = if (chosenCountry in countries) chosenCountry else countries.first()
    var query by rememberSaveable { mutableStateOf("") }
    val currentOnQuery by rememberUpdatedState(onQuery)
    LaunchedEffect(Unit) { currentOnQuery(country, query) }
    val searchLabel = stringResource(R.string.discovery_search_city_search)
    val typed = query.trim().length >= MIN_LETTERS
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(SHEET_HEIGHT)
                .imePadding(),
        ) {
            SheetTitle(title = stringResource(R.string.discovery_search_fields_city), onDone = onDismiss)
            if (countries.size > 1) {
                Text(
                    stringResource(R.string.discovery_search_city_country),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 6.dp),
                )
                ChoiceChips(
                    options = countries.map { Option(it, countryName(it)) },
                    selected = country,
                    onSelect = { code ->
                        chosenCountry = code
                        onQuery(code, query)
                    },
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
            SheetSearchField(
                query = query,
                onQueryChange = { value ->
                    query = value
                    onQuery(country, value)
                },
                placeholder = searchLabel,
                capitalization = KeyboardCapitalization.Words,
            )
            when {
                !typed -> {
                    SheetHint(stringResource(R.string.discovery_search_city_search_hint))
                }

                search.loading -> {
                    LinearProgressIndicator(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp, vertical = 12.dp),
                    )
                }

                search.done && search.results.isEmpty() -> {
                    SheetHint(stringResource(R.string.discovery_search_no_results))
                }
            }
            LazyColumn(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .navigationBarsPadding(),
            ) {
                if (typed) {
                    items(search.results, key = { it.id }) { city ->
                        CheckRow(
                            title = city.name,
                            subtitle = city.regionName,
                            checked = city.id in selected,
                            onToggle = { onToggle(city) },
                        )
                    }
                }
            }
        }
    }
}

/**
 * "Caste or biradari": a searchable multi-select of the top-level castes. Unlike the shared
 * [MultiSelectField], the search also matches each caste's aliases, so "Rajpoot" finds "Rajput".
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CasteField(
    options: List<Option>,
    aliases: (String) -> List<String>,
    selected: Set<String>,
    onChange: (Set<String>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val label = stringResource(R.string.discovery_search_fields_caste)
    val known = options.map { it.code }.toSet()
    val chosen = options.filter { it.code in selected } + (selected - known).map { Option(it, Reference.fallback(it)) }
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            chosen.forEach { option ->
                RemovableChip(
                    label = option.label,
                    removeLabel = text(R.string.discovery_search_remove_value, "value" to option.label),
                    onRemove = { onChange(selected - option.code) },
                )
            }
            AddChip(
                description = text(R.string.discovery_search_add_named, "label" to label),
                onClick = { open = true },
            )
        }
        FieldSupport(helper = null, error = error)
        if (open) {
            AliasSearchSheet(
                title = label,
                options = options,
                aliases = aliases,
                selected = selected,
                onToggle = { code -> onChange(if (code in selected) selected - code else selected + code) },
                onDismiss = { open = false },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AliasSearchSheet(
    title: String,
    options: List<Option>,
    aliases: (String) -> List<String>,
    selected: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState =
        rememberBottomSheetState(
            initialValue = SheetValue.Hidden,
            enabledValues = setOf(SheetValue.Hidden, SheetValue.Expanded),
        )
    var query by rememberSaveable { mutableStateOf("") }
    val filtered =
        remember(options, query) {
            val needle = query.trim()
            if (needle.isEmpty()) {
                options
            } else {
                options.filter { option ->
                    option.label.contains(needle, ignoreCase = true) ||
                        aliases(option.code).any { it.contains(needle, ignoreCase = true) }
                }
            }
        }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(SHEET_HEIGHT)
                .imePadding(),
        ) {
            SheetTitle(title = title, onDone = onDismiss)
            SheetSearchField(
                query = query,
                onQueryChange = { query = it },
                placeholder = stringResource(R.string.fields_search_select_search),
                capitalization = KeyboardCapitalization.Words,
            )
            if (filtered.isEmpty()) SheetHint(stringResource(R.string.fields_search_select_no_results))
            LazyColumn(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .navigationBarsPadding(),
            ) {
                items(filtered, key = { it.code }) { option ->
                    CheckRow(
                        title = option.label,
                        subtitle = null,
                        checked = option.code in selected,
                        onToggle = { onToggle(option.code) },
                    )
                }
            }
        }
    }
}

/** A chosen value with a close icon; tapping removes it. */
@Composable
private fun RemovableChip(
    label: String,
    removeLabel: String,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    InputChip(
        selected = true,
        onClick = onRemove,
        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailingIcon = { Icon(Icons.Filled.Close, contentDescription = removeLabel, modifier = Modifier.size(18.dp)) },
        modifier = modifier,
    )
}

/** "Add", which opens a search sheet. */
@Composable
private fun AddChip(
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FilterChip(
        selected = false,
        onClick = onClick,
        label = { Text(stringResource(R.string.discovery_search_add)) },
        leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp)) },
        modifier = modifier.semantics { contentDescription = description },
    )
}

@Composable
private fun SheetTitle(
    title: String,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics { heading() },
        )
        TextButton(onClick = onDone) { Text(stringResource(R.string.common_actions_done)) }
    }
}

@Composable
private fun SheetSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    capitalization: KeyboardCapitalization,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        placeholder = { Text(placeholder) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = capitalization, imeAction = ImeAction.Search),
        shape = MaterialTheme.shapes.small,
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .semantics { contentDescription = placeholder },
    )
}

@Composable
private fun SheetHint(
    hint: String,
    modifier: Modifier = Modifier,
) {
    Text(
        hint,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(horizontal = 20.dp, vertical = 12.dp),
    )
}

/** One choice of a search sheet: a checkbox, the name and an optional second line. */
@Composable
private fun CheckRow(
    title: String,
    subtitle: String?,
    checked: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onToggle() })
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = null)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private const val MIN_LETTERS = 2
private const val SHEET_HEIGHT = 0.92f
