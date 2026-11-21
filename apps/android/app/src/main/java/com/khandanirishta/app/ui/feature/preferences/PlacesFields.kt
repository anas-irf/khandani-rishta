package com.khandanirishta.app.ui.feature.preferences

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.MultiSelectField
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.feature.profilesections.CitySearchSheet
import com.khandanirishta.app.ui.feature.profilesections.CitySearchViewModel
import com.khandanirishta.app.ui.feature.profilesections.HelperText
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text

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
) {
    val viewModel = hiltViewModel<CitySearchViewModel>(key = "preferences-regions")
    val regionsByCountry by viewModel.regions.collectAsStateWithLifecycle()
    LaunchedEffect(countryCodes) { countryCodes.forEach { viewModel.loadRegions(it) } }
    val options = countryCodes.flatMap { regionsByCountry[it].orEmpty() }.map { Option(it.id.toString(), it.name) }
    MultiSelectField(
        label = stringResource(R.string.preferences_rows_regions),
        options = options,
        selected = selected.map { it.toString() }.toSet(),
        onChange = { codes -> onChange(codes.mapNotNull { it.toIntOrNull() }.toSet()) },
        helper = if (selected.isEmpty()) stringResource(R.string.preferences_any) else null,
        error = error,
        max = PreferencesRules.PLACES_MAX,
        chips = false,
        modifier = modifier,
    )
}

/**
 * "Cities" of the location row: several cities as chips, added by searching with
 * `GET /v1/reference/cities` in one of the selected countries (all countries when none is chosen).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CityIdsField(
    countryCodes: Set<String>,
    selected: Set<Int>,
    onChange: (Set<Int>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    enabled: Boolean = true,
) {
    val viewModel = hiltViewModel<CitySearchViewModel>(key = "preferences-cities")
    val cities by viewModel.cities.collectAsStateWithLifecycle()
    val reference = LocalReference.current
    val allCountries = remember(reference) { reference.countryOptions() }
    val searchCountries = if (countryCodes.isEmpty()) allCountries else allCountries.filter { it.code in countryCodes }
    var chosenCountry by rememberSaveable { mutableStateOf<String?>(null) }
    val activeCountry =
        chosenCountry?.takeIf { code -> searchCountries.any { it.code == code } } ?: searchCountries.firstOrNull()?.code
    var searching by rememberSaveable { mutableStateOf(false) }
    val reached = selected.size >= PreferencesRules.PLACES_MAX
    val label = stringResource(R.string.preferences_rows_cities)

    // The major cities of each selected country name most saved choices: the API has no lookup by id.
    LaunchedEffect(selected, countryCodes) {
        selected.filter { it !in cities }.forEach { id ->
            countryCodes.forEach { country -> viewModel.resolve(country, id) }
        }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FieldLabel(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            selected.forEach { id ->
                val name = cities[id]?.name ?: stringResource(R.string.onboarding_android_city_saved)
                InputChip(
                    selected = true,
                    onClick = { onChange(selected - id) },
                    enabled = enabled,
                    label = { Text(name) },
                    trailingIcon = {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = text(R.string.fields_multi_select_remove, "item" to name),
                            modifier = Modifier.size(18.dp),
                        )
                    },
                )
            }
            FilterChip(
                selected = false,
                onClick = { searching = true },
                enabled = enabled && !reached && activeCountry != null,
                label = { Text(stringResource(R.string.fields_multi_select_add)) },
                leadingIcon = {
                    Icon(Icons.Outlined.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                },
            )
        }
        if (selected.isEmpty()) HelperText(stringResource(R.string.preferences_any))
        if (searchCountries.size > 1) {
            SelectField(
                label = stringResource(R.string.preferences_cities_country),
                options = searchCountries.map { Option(it.code, it.label) },
                selected = activeCountry,
                onSelect = { code -> if (code != null) chosenCountry = code },
                clearable = false,
                enabled = enabled,
            )
        }
        when {
            error != null -> {
                FieldSupport(null, error)
            }

            reached -> {
                FieldSupport(text(R.string.fields_multi_select_max_reached, "max" to PreferencesRules.PLACES_MAX), null)
            }
        }
    }

    val country = activeCountry
    if (searching && country != null) {
        CitySearchSheet(
            title = stringResource(R.string.preferences_cities_search),
            viewModel = viewModel,
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
