package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.PickerBox
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.components.rememberModalSheetState
import com.khandanirishta.app.ui.text.LocalReference

/**
 * Country, province or state, then a city searched with `GET /v1/reference/cities`, or a typed
 * name after "My city is not listed" (07 sections 6.1 and 8.1, the web's CityPickerField).
 * [countryLabel] `null` hides the country (a place that is always in one country); [regionLabel]
 * `null` hides the province. Picking a city also sets its province.
 */
@Composable
fun CityPickerField(
    value: PlaceValue,
    onChange: (PlaceValue) -> Unit,
    cityLabel: String,
    cityOtherLabel: String,
    pickerKey: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    countryLabel: String? = null,
    regionLabel: String? = null,
    allowTyped: Boolean = true,
    helper: String? = null,
    error: String? = null,
    optional: Boolean = false,
    enabled: Boolean = true,
) {
    val viewModel = hiltViewModel<CitySearchViewModel>(key = "city-picker-$pickerKey")
    val reference = LocalReference.current
    val regionsByCountry by viewModel.regions.collectAsStateWithLifecycle()
    val cities by viewModel.cities.collectAsStateWithLifecycle()
    var searching by rememberSaveable { mutableStateOf(false) }
    val country = value.countryCode
    val regions = country?.let { regionsByCountry[it] }.orEmpty()

    LaunchedEffect(country) { viewModel.loadRegions(country) }
    LaunchedEffect(country, value.cityId) {
        if (value.cityId != null && !cities.containsKey(value.cityId)) viewModel.resolve(country, value.cityId)
    }

    fun chooseRegion(id: Int?) {
        val keep = value.cityId != null && cities[value.cityId]?.regionId == id
        onChange(value.copy(regionId = id, cityId = if (keep) value.cityId else null))
    }

    fun chooseCity(city: CityRef) {
        viewModel.remember(city)
        onChange(value.copy(cityId = city.id, regionId = city.regionId ?: value.regionId, cityOther = null))
        searching = false
    }

    fun chooseNotListed() {
        searching = false
        onChange(value.copy(cityId = null, cityOther = value.cityOther ?: ""))
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (label != null) GroupTitle(label, optional = optional)
        if (countryLabel != null) {
            val countries = remember(reference) { reference.countryOptions() }
            SelectField(
                label = countryLabel,
                options = countries,
                selected = country,
                onSelect = { code -> if (code != null && code != country) onChange(PlaceValue(countryCode = code)) },
                enabled = enabled,
                clearable = false,
                searchable = true,
            )
        }
        if (regionLabel != null && country != null && regions.isNotEmpty()) {
            SelectField(
                label = regionLabel,
                options = regions.map { Option(it.id.toString(), it.name) },
                selected = value.regionId?.toString(),
                onSelect = { id -> chooseRegion(id?.toIntOrNull()) },
                placeholder = stringResource(R.string.fields_city_region_placeholder),
                optional = !value.typed,
                clearable = true,
                enabled = enabled,
            )
        }
        if (country != null && !value.typed) {
            Column {
                FieldLabel(cityLabel, optional = optional && label == null)
                val saved = stringResource(R.string.onboarding_android_city_saved)
                val name = value.cityId?.let { id -> cities[id]?.name ?: saved }
                PickerBox(
                    text = name,
                    placeholder = stringResource(R.string.fields_city_city_placeholder),
                    onClick = { searching = true },
                    isError = error != null,
                    enabled = enabled,
                    contentDescription =
                        cityLabel + ", " + (name ?: stringResource(R.string.fields_city_city_placeholder)),
                )
                if (allowTyped) {
                    TextButton(onClick = { chooseNotListed() }, enabled = enabled) {
                        Text(stringResource(R.string.fields_city_not_listed))
                    }
                }
            }
        }
        if (country != null && value.typed) {
            Column {
                KrTextField(
                    value = value.cityOther.orEmpty(),
                    onValueChange = { onChange(value.copy(cityOther = it)) },
                    label = cityOtherLabel,
                    maxLength = CITY_NAME_MAX,
                    enabled = enabled,
                    optional = optional && label == null,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                )
                TextButton(
                    onClick = { onChange(value.copy(cityOther = null, cityId = null)) },
                    enabled = enabled,
                ) { Text(stringResource(R.string.fields_city_back_to_list)) }
            }
        }
        if (helper != null || error != null) FieldSupport(helper, error)
    }

    if (searching && country != null) {
        CitySearchSheet(
            title = cityLabel,
            viewModel = viewModel,
            countryCode = country,
            regionId = if (regionLabel != null) value.regionId else null,
            onPick = ::chooseCity,
            onNotListedClick = if (allowTyped) ::chooseNotListed else null,
            onDismiss = { searching = false },
        )
    }
}

/** The full-height search list of a city picker, with "My city is not listed" as the last row. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CitySearchSheet(
    title: String,
    viewModel: CitySearchViewModel,
    countryCode: String,
    regionId: Int?,
    onPick: (CityRef) -> Unit,
    onNotListedClick: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalSheetState(skipPartiallyExpanded = true)
    val search by viewModel.search.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }
    LaunchedEffect(countryCode, regionId) { viewModel.search(countryCode, regionId, "", immediate = true) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(SHEET_HEIGHT)
                .imePadding(),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp))
            OutlinedTextField(
                value = search.query,
                onValueChange = { viewModel.search(countryCode, regionId, it) },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text(stringResource(R.string.fields_city_city_placeholder)) },
                singleLine = true,
                shape = MaterialTheme.shapes.small,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .focusRequester(focus),
            )
            val typed = search.query.trim()
            if (typed.length in 1 until CitySearchViewModel.MIN_QUERY) {
                HelperText(
                    stringResource(R.string.fields_city_city_hint),
                    Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            if (search.loading) {
                LinearProgressIndicator(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                )
            }
            LazyColumn(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .navigationBarsPadding(),
            ) {
                items(search.results, key = { it.id }) { city ->
                    CityRow(city = city, onClick = { onPick(city) })
                }
                val nothingFound = search.searched && !search.loading && search.results.isEmpty()
                if (nothingFound && typed.length >= CitySearchViewModel.MIN_QUERY) {
                    item(key = "none") {
                        HelperText(
                            stringResource(R.string.fields_city_no_results),
                            Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                        )
                    }
                }
                if (onNotListedClick != null) {
                    item(key = "not-listed") {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 52.dp)
                                .clickable(role = Role.Button, onClick = onNotListedClick)
                                .padding(horizontal = 20.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                stringResource(R.string.fields_city_not_listed),
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

@Composable
private fun CityRow(
    city: CityRef,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Place, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(14.dp))
        Column {
            Text(city.name, style = MaterialTheme.typography.bodyLarge)
            if (!city.regionName.isNullOrBlank()) {
                Text(
                    city.regionName,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private const val CITY_NAME_MAX = 60
private const val SHEET_HEIGHT = 0.92f
