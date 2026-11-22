package com.khandanirishta.app.ui.feature.preferences

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrRemovableChip
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.feature.profilesections.CitySearchSheet
import com.khandanirishta.app.ui.feature.profilesections.CitySearchViewModel
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing

/**
 * "Provinces or states" of the location row (07 section 11.2): the regions of the selected
 * countries, loaded with `GET /v1/reference/regions`.
 */
@Composable
internal fun RegionIdsField(
    countryCodes: Set<String>,
    selected: Set<Int>,
    onChange: (Set<Int>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    enabled: Boolean = true,
    viewModel: CitySearchViewModel = hiltViewModel<CitySearchViewModel>(key = "preferences-regions"),
) {
    val online = LocalOnline.current
    val regionsByCountry by viewModel.regions.collectAsStateWithLifecycle()
    LaunchedEffect(countryCodes, online) { countryCodes.forEach { viewModel.loadRegions(it) } }
    val options =
        remember(countryCodes, regionsByCountry) {
            countryCodes.flatMap { regionsByCountry[it].orEmpty() }.map { Option(it.id.toString(), it.name) }
        }
    MultiSelectField(
        label = stringResource(R.string.preferences_rows_regions),
        options = options,
        selected = remember(selected) { selected.map { it.toString() }.toSet() },
        onChange = { codes -> onChange(codes.mapNotNull { it.toIntOrNull() }.toSet()) },
        helper = if (selected.isEmpty()) stringResource(R.string.preferences_any) else null,
        error = error,
        max = PreferencesRules.PLACES_MAX,
        chips = false,
        enabled = enabled,
        modifier = modifier,
    )
}

/**
 * "Cities" of the location row: several cities as chips, added by searching with
 * `GET /v1/reference/cities` in one of the selected countries (all countries when none is chosen).
 */
@Composable
internal fun CityIdsField(
    countryCodes: Set<String>,
    selected: Set<Int>,
    onChange: (Set<Int>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    enabled: Boolean = true,
    viewModel: CitySearchViewModel = hiltViewModel<CitySearchViewModel>(key = "preferences-cities"),
) {
    val cities by viewModel.cities.collectAsStateWithLifecycle()
    val online = LocalOnline.current
    val reference = LocalReference.current
    val allCountries = remember(reference) { reference.countryOptions() }
    val searchCountries =
        remember(allCountries, countryCodes) {
            if (countryCodes.isEmpty()) allCountries else allCountries.filter { it.code in countryCodes }
        }
    var chosenCountry by rememberSaveable { mutableStateOf<String?>(null) }
    val activeCountry =
        chosenCountry?.takeIf { code -> searchCountries.any { it.code == code } } ?: searchCountries.firstOrNull()?.code
    var searching by rememberSaveable { mutableStateOf(false) }
    val reached = selected.size >= PreferencesRules.PLACES_MAX
    val label = stringResource(R.string.preferences_rows_cities)
    val saved = stringResource(R.string.onboarding_android_city_saved)

    // The major cities of each selected country name most saved choices: the API has no lookup by id.
    LaunchedEffect(selected, countryCodes, online) {
        selected.filter { it !in cities }.forEach { id ->
            countryCodes.forEach { country -> viewModel.resolve(country, id) }
        }
    }

    val helper =
        when {
            reached -> text(R.string.fields_multi_select_max_reached, "max" to PreferencesRules.PLACES_MAX)
            selected.isEmpty() -> stringResource(R.string.preferences_any)
            else -> null
        }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
        Column {
            FieldLabel(label)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                verticalArrangement = Arrangement.spacedBy(Spacing.s8),
            ) {
                selected.forEach { id ->
                    val name = cities[id]?.name ?: saved
                    KrRemovableChip(
                        text = name,
                        removeLabel = text(R.string.fields_multi_select_remove, "item" to name),
                        onRemove = { onChange(selected - id) },
                        enabled = enabled,
                    )
                }
                KrButton(
                    text = stringResource(R.string.fields_multi_select_add),
                    onClick = { searching = true },
                    variant = KrButtonVariant.QUIET,
                    icon = Icons.Outlined.Add,
                    enabled = enabled && !reached && activeCountry != null,
                    contentDescription = text(R.string.fields_multi_select_add_label, "label" to label),
                )
            }
            FieldSupport(helper, error)
        }
        if (searchCountries.size > 1) {
            SelectField(
                label = stringResource(R.string.preferences_cities_country),
                options = searchCountries,
                selected = activeCountry,
                onSelect = { code -> if (code != null) chosenCountry = code },
                clearable = false,
                enabled = enabled,
            )
        }
    }

    val country = activeCountry
    if (searching && country != null) {
        val search by viewModel.search.collectAsStateWithLifecycle()
        CitySearchSheet(
            title = stringResource(R.string.preferences_cities_search),
            search = search,
            onSearch = viewModel::search,
            countryCode = country,
            regionId = null,
            onPick = { city ->
                viewModel.remember(city)
                if (!reached) onChange(selected + city.id)
                searching = false
            },
            onNotListedClick = null,
            onDismiss = { searching = false },
        )
    }
}
