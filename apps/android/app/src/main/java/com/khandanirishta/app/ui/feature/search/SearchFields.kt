package com.khandanirishta.app.ui.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.core.network.generated.model.RegionItem
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.ChoiceChips
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrRemovableChip
import com.khandanirishta.app.ui.components.KrSheetFrame
import com.khandanirishta.app.ui.components.KrTextInput
import com.khandanirishta.app.ui.components.LoadingLine
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.rememberHideKeyboardOnSearch
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

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
    val lists =
        remember(countries, regions) {
            countries.mapNotNull { country -> regions[country]?.takeIf { it.isNotEmpty() }?.let { country to it } }
        }
    if (lists.isEmpty()) return
    val label = stringResource(R.string.discovery_search_fields_region)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        if (lists.size > 1) FieldLabel(label)
        lists.forEach { (country, items) ->
            key(country) {
                val ids = remember(items) { items.map { it.id }.toSet() }
                val options = remember(items) { items.map { Option(it.id.toString(), it.name) } }
                MultiSelectField(
                    label = if (lists.size > 1) countryName(country) else label,
                    options = options,
                    selected = remember(selected, ids) { selected.filter { it in ids }.map { it.toString() }.toSet() },
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
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            selected.forEach { id ->
                key(id) {
                    val name = names[id] ?: unknown
                    KrRemovableChip(
                        text = name,
                        removeLabel = text(R.string.discovery_search_remove_value, "value" to name),
                        onRemove = { onRemove(id) },
                    )
                }
            }
            // The cities are searched on the server (rule G14).
            AddButton(label = label, onClick = { open = true }, enabled = LocalOnline.current)
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
    var chosenCountry by rememberSaveable { mutableStateOf(countries.first()) }
    val country = if (chosenCountry in countries) chosenCountry else countries.first()
    var query by rememberSaveable { mutableStateOf("") }
    val currentOnQuery by rememberUpdatedState(onQuery)
    LaunchedEffect(Unit) { currentOnQuery(country, query) }
    val typed = query.trim().length >= MIN_LETTERS
    val chooseCountry: (@Composable () -> Unit)? =
        if (countries.size > 1) {
            {
                Column {
                    FieldLabel(stringResource(R.string.discovery_search_city_country))
                    ChoiceChips(
                        options = remember(countries, countryName) { countries.map { Option(it, countryName(it)) } },
                        selected = country,
                        onSelect = { code ->
                            chosenCountry = code
                            onQuery(code, query)
                        },
                    )
                }
            }
        } else {
            null
        }
    SearchSheet(
        title = stringResource(R.string.discovery_search_fields_city),
        query = query,
        onQueryChange = { value ->
            query = value
            onQuery(country, value)
        },
        placeholder = stringResource(R.string.discovery_search_city_search),
        onDismiss = onDismiss,
        above = chooseCountry,
    ) {
        when {
            !typed -> {
                item(
                    key = HINT_KEY,
                    contentType = HINT_KEY,
                ) { SheetHint(stringResource(R.string.discovery_search_city_search_hint)) }
            }

            search.loading && search.results.isEmpty() -> {
                item(key = LOADING_KEY, contentType = LOADING_KEY) { CitySkeleton() }
            }

            search.done && search.results.isEmpty() -> {
                item(
                    key = HINT_KEY,
                    contentType = HINT_KEY,
                ) { SheetHint(stringResource(R.string.discovery_search_no_results)) }
            }

            else -> {
                if (search.loading) {
                    item(key = LOADING_KEY, contentType = LOADING_KEY) {
                        LoadingLine(Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.s8))
                    }
                }
                items(search.results, key = { "city:${it.id}" }, contentType = { OPTION_TYPE }) { city ->
                    CheckboxRow(
                        checked = city.id in selected,
                        onCheckedChange = { onToggle(city) },
                        label = city.name,
                        helper = city.regionName,
                        modifier = Modifier.padding(horizontal = Spacing.gutter),
                    )
                }
            }
        }
    }
}

/**
 * "Caste or biradari": a searchable multi-select of the top-level castes. Unlike the shared
 * [MultiSelectField], the search also matches each caste's aliases, so "Rajpoot" finds "Rajput".
 */
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
    val chosen =
        remember(options, selected) {
            val known = options.map { it.code }.toSet()
            options.filter { it.code in selected } + (selected - known).map { Option(it, Reference.fallback(it)) }
        }
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            chosen.forEach { option ->
                key(option.code) {
                    KrRemovableChip(
                        text = option.label,
                        removeLabel = text(R.string.discovery_search_remove_value, "value" to option.label),
                        onRemove = { onChange(selected - option.code) },
                    )
                }
            }
            AddButton(label = label, onClick = { open = true })
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

@Composable
private fun AliasSearchSheet(
    title: String,
    options: List<Option>,
    aliases: (String) -> List<String>,
    selected: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
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
    SearchSheet(
        title = title,
        query = query,
        onQueryChange = { query = it },
        placeholder = stringResource(R.string.fields_search_select_search),
        onDismiss = onDismiss,
        above = null,
    ) {
        if (filtered.isEmpty()) {
            item(
                key = HINT_KEY,
                contentType = HINT_KEY,
            ) { SheetHint(stringResource(R.string.fields_search_select_no_results)) }
        }
        items(filtered, key = { "option:${it.code}" }, contentType = { OPTION_TYPE }) { option ->
            CheckboxRow(
                checked = option.code in selected,
                onCheckedChange = { onToggle(option.code) },
                label = option.label,
                modifier = Modifier.padding(horizontal = Spacing.gutter),
            )
        }
    }
}

/**
 * The frame of both search sheets. The title and what is [above] scroll away and the search box
 * stays at the top, so the results keep some room over a keyboard at large text.
 */
@Composable
private fun SearchSheet(
    title: String,
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    onDismiss: () -> Unit,
    above: (@Composable () -> Unit)?,
    results: LazyListScope.() -> Unit,
) {
    KrSheetFrame(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(SHEET_HEIGHT),
        ) {
            LazyColumn(
                Modifier
                    .fillMaxWidth()
                    .weight(1f),
            ) {
                item(key = TITLE_KEY, contentType = TITLE_KEY) {
                    Column(
                        modifier = Modifier.padding(horizontal = Spacing.gutter),
                        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
                    ) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.semantics { heading() },
                        )
                        above?.invoke()
                    }
                }
                stickyHeader(key = QUERY_KEY, contentType = QUERY_KEY) { _ ->
                    Surface(color = KrTheme.colors.card, contentColor = MaterialTheme.colorScheme.onSurface) {
                        KrTextInput(
                            value = query,
                            onValueChange = onQueryChange,
                            placeholder = placeholder,
                            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                            keyboardOptions =
                                KeyboardOptions(
                                    capitalization = KeyboardCapitalization.Words,
                                    imeAction = ImeAction.Search,
                                ),
                            keyboardActions = rememberHideKeyboardOnSearch(),
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s12)
                                    .semantics { contentDescription = placeholder },
                        )
                    }
                }
                results()
            }
            KrButton(
                text = stringResource(R.string.common_actions_done),
                onClick = onDismiss,
                fullWidth = true,
                modifier = Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
            )
        }
    }
}

/** "Add", which opens a search sheet. */
@Composable
private fun AddButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    KrButton(
        text = stringResource(R.string.discovery_search_add),
        onClick = onClick,
        variant = KrButtonVariant.QUIET,
        icon = Icons.Outlined.Add,
        enabled = enabled,
        contentDescription = text(R.string.discovery_search_add_named, "label" to label),
        modifier = modifier,
    )
}

/** The city search runs: rows in the shape of its answers (rule G1). */
@Composable
private fun CitySkeleton() {
    LoadingRegion(Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.s12)) {
        repeat(SKELETON_ROWS) { SkeletonBox(Modifier.fillMaxWidth().height(Sizes.touch)) }
    }
}

@Composable
private fun SheetHint(
    hint: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = hint,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier =
            modifier
                .semantics { liveRegion = LiveRegionMode.Polite }
                .padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
    )
}

private const val MIN_LETTERS = 2
private const val SHEET_HEIGHT = 0.92f
private const val SKELETON_ROWS = 3
private const val TITLE_KEY = "sheet:title"
private const val QUERY_KEY = "sheet:query"
private const val HINT_KEY = "sheet:hint"
private const val LOADING_KEY = "sheet:loading"
private const val OPTION_TYPE = "option"
