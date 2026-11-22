package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.IconTextLine
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.PickerBox
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

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
    viewModel: CitySearchViewModel = hiltViewModel<CitySearchViewModel>(key = "city-picker-$pickerKey"),
) {
    val reference = LocalReference.current
    val online = LocalOnline.current
    val regionsByCountry by viewModel.regions.collectAsStateWithLifecycle()
    val cities by viewModel.cities.collectAsStateWithLifecycle()
    var searching by rememberSaveable { mutableStateOf(false) }
    val country = value.countryCode
    val regions = country?.let { regionsByCountry[it] }.orEmpty()

    // Asked again when the connection comes back: a failed lookup leaves the province out.
    LaunchedEffect(country, online) { viewModel.loadRegions(country) }
    LaunchedEffect(country, value.cityId, online) {
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

    Column(modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
            if (label != null) GroupTitle(label, optional = optional)
            if (countryLabel != null) {
                val countries = remember(reference) { reference.countryOptions() }
                SelectField(
                    label = countryLabel,
                    options = countries,
                    selected = country,
                    onSelect = { code ->
                        if (code != null && code != country) onChange(PlaceValue(countryCode = code))
                    },
                    enabled = enabled,
                    clearable = false,
                    searchable = true,
                )
            }
            if (regionLabel != null && country != null && regions.isNotEmpty()) {
                SelectField(
                    label = regionLabel,
                    options = remember(regions) { regions.map { Option(it.id.toString(), it.name) } },
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
                    val placeholder = stringResource(R.string.fields_city_city_placeholder)
                    val name = value.cityId?.let { id -> cities[id]?.name ?: saved }
                    PickerBox(
                        text = name,
                        placeholder = placeholder,
                        onClick = { searching = true },
                        isError = error != null,
                        enabled = enabled,
                        contentDescription = "$cityLabel, ${name ?: placeholder}",
                        modifier = Modifier.semantics { if (!error.isNullOrBlank()) error(error) },
                    )
                    if (allowTyped) {
                        KrTextLink(
                            text = stringResource(R.string.fields_city_not_listed),
                            onClick = { chooseNotListed() },
                            enabled = enabled,
                            modifier = Modifier.padding(top = Spacing.s8),
                        )
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
                    KrTextLink(
                        text = stringResource(R.string.fields_city_back_to_list),
                        onClick = { onChange(value.copy(cityOther = null, cityId = null)) },
                        enabled = enabled,
                        modifier = Modifier.padding(top = Spacing.s8),
                    )
                }
            }
        }
        FieldSupport(helper, error)
    }

    if (searching && country != null) {
        val search by viewModel.search.collectAsStateWithLifecycle()
        CitySearchSheet(
            title = cityLabel,
            search = search,
            onSearch = viewModel::search,
            countryCode = country,
            regionId = if (regionLabel != null) value.regionId else null,
            onPick = ::chooseCity,
            onNotListedClick = if (allowTyped) ::chooseNotListed else null,
            onDismiss = { searching = false },
        )
    }
}

/** The city search of a picker, with "My city is not listed" as the last row. */
@Composable
internal fun CitySearchSheet(
    title: String,
    search: CitySearchViewModel.Search,
    onSearch: (countryCode: String, regionId: Int?, query: String, immediate: Boolean) -> Unit,
    countryCode: String,
    regionId: Int?,
    onPick: (CityRef) -> Unit,
    onNotListedClick: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val currentOnSearch by rememberUpdatedState(onSearch)
    LaunchedEffect(countryCode, regionId) { currentOnSearch(countryCode, regionId, "", true) }
    CityResultsSheet(
        title = title,
        search = search,
        online = LocalOnline.current,
        onQueryChange = { onSearch(countryCode, regionId, it, false) },
        onRetry = { onSearch(countryCode, regionId, search.query, true) },
        onPick = onPick,
        onNotListedClick = onNotListedClick,
        onDismiss = onDismiss,
    )
}

/**
 * The sheet of a city search in each of its states: a skeleton, the cities, none with this name,
 * a failure with "Try again", and no connection (rules G1 to G3 and G14).
 */
@Composable
internal fun CityResultsSheet(
    title: String,
    search: CitySearchViewModel.Search,
    online: Boolean,
    onQueryChange: (String) -> Unit,
    onRetry: () -> Unit,
    onPick: (CityRef) -> Unit,
    onNotListedClick: (() -> Unit)?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val typed = search.query.trim()
    val tooShort = typed.length in 1 until CitySearchViewModel.MIN_QUERY
    val searching = online && search.loading
    val failed = online && !search.loading && search.error != null
    val nothingFound =
        online && !search.loading && search.error == null && search.searched && search.results.isEmpty() &&
            typed.length >= CitySearchViewModel.MIN_QUERY
    val status =
        when {
            tooShort -> stringResource(R.string.fields_city_city_hint)
            searching -> stringResource(R.string.fields_city_searching)
            else -> ""
        }
    PickerSheet(
        title = title,
        query = search.query,
        onQueryChange = onQueryChange,
        placeholder = stringResource(R.string.fields_city_city_placeholder),
        onDismiss = onDismiss,
        modifier = modifier,
        status = status,
        keyboardOptions = CityKeyboard,
        focusOnOpen = true,
    ) {
        if (!online) {
            item(key = "offline", contentType = "notice") {
                StatusBanner(
                    text = stringResource(R.string.common_offline),
                    tone = StatusTone.NEUTRAL,
                    icon = Icons.Outlined.CloudOff,
                    announce = true,
                    modifier = Modifier.padding(bottom = Spacing.s8),
                )
            }
        }
        if (failed) {
            item(key = "failed", contentType = "notice") {
                InlineFailureBox(
                    text = stringResource(R.string.errors_generic_action),
                    error = search.error,
                    onRetry = onRetry,
                    modifier = Modifier.padding(bottom = Spacing.s8),
                )
            }
        }
        if (searching && search.results.isEmpty()) {
            item(key = "loading", contentType = "loading") { CitySkeleton() }
        }
        items(search.results, key = { it.id }, contentType = { "city" }) { city ->
            CityRow(city = city, onClick = { onPick(city) })
        }
        if (nothingFound) {
            item(key = "none", contentType = "none") {
                IconText(
                    icon = Icons.Outlined.SearchOff,
                    text = stringResource(R.string.fields_city_no_results),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier =
                        Modifier
                            .semantics { liveRegion = LiveRegionMode.Polite }
                            .padding(vertical = Spacing.s16),
                )
            }
        }
        if (onNotListedClick != null) {
            item(key = "not-listed", contentType = "action") {
                PickerAction(
                    icon = Icons.Outlined.Edit,
                    label = stringResource(R.string.fields_city_not_listed),
                    onClick = onNotListedClick,
                )
            }
        }
    }
}

@Composable
private fun CityRow(
    city: CityRef,
    onClick: () -> Unit,
) {
    val style = MaterialTheme.typography.bodyMedium
    Column {
        IconTextLine(
            icon = Icons.Outlined.Place,
            style = style,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            gap = Spacing.s12,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .tappable(shape = MaterialTheme.shapes.small, onClick = onClick)
                    .heightIn(min = Sizes.touchLarge)
                    .padding(vertical = Spacing.s12),
        ) {
            Column(Modifier.weight(1f)) {
                Text(city.name, style = style)
                if (!city.regionName.isNullOrBlank()) {
                    Text(
                        text = city.regionName,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        RowDivider()
    }
}

@Composable
private fun CitySkeleton() {
    LoadingRegion(Modifier.fillMaxWidth(), spacing = Spacing.s8) {
        repeat(SKELETON_ROWS) {
            Column(
                modifier = Modifier.padding(vertical = Spacing.s12),
                verticalArrangement = Arrangement.spacedBy(Spacing.s8),
            ) {
                SkeletonBox(Modifier.fillMaxWidth(NAME_SHARE).height(Spacing.s20))
                SkeletonBox(Modifier.fillMaxWidth(REGION_SHARE).height(Spacing.s16))
            }
        }
    }
}

private val CityKeyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Search)
private const val CITY_NAME_MAX = 60
private const val SKELETON_ROWS = 4
private const val NAME_SHARE = 0.5f
private const val REGION_SHARE = 0.35f
