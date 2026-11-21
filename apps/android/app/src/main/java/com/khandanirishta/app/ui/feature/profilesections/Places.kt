package com.khandanirishta.app.ui.feature.profilesections

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.core.network.generated.model.RegionItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A place chosen with the city picker (07 section 6): country, province or state, and a listed
 * city or a typed city name. [cityOther] is `null` while a listed city is used and a string
 * (possibly empty) once "My city is not listed" was chosen, so the rules can tell "nothing
 * chosen" from "name missing".
 */
data class PlaceValue(
    val countryCode: String? = null,
    val regionId: Int? = null,
    val cityId: Int? = null,
    val cityOther: String? = null,
) {
    val typed: Boolean get() = cityOther != null

    /** The typed city name to send: only without a listed city, and never empty. */
    val cityOtherToSend: String? get() = if (cityId == null) collapse(cityOther) else null
}

/**
 * Regions and city names seen in this session. The API has no lookup of a city by id, so names
 * come from the profile, from searches and from the list of major cities of a country.
 */
@Singleton
class PlaceLookup
    @Inject
    constructor(
        private val reference: ReferenceRepository,
    ) {
        private val regionState = MutableStateFlow<Map<String, List<RegionItem>>>(emptyMap())
        val regions: StateFlow<Map<String, List<RegionItem>>> = regionState.asStateFlow()

        private val cityState = MutableStateFlow<Map<Int, CityRef>>(emptyMap())
        val cities: StateFlow<Map<Int, CityRef>> = cityState.asStateFlow()

        private val majorLoaded = ConcurrentHashMap.newKeySet<String>()

        /** Whether the country has provinces or states, once they are loaded. */
        fun hasRegions(countryCode: String?): Boolean =
            countryCode?.let { regionState.value[it]?.isNotEmpty() } ?: false

        /** `GET /v1/reference/regions` for a country, once per session. */
        suspend fun loadRegions(countryCode: String): List<RegionItem> {
            regionState.value[countryCode]?.let { return it }
            val items = reference.regions(countryCode).getOrNull() ?: return emptyList()
            regionState.update { it + (countryCode to items) }
            return items
        }

        /** `GET /v1/reference/cities`; without [query] the API answers the major cities. */
        suspend fun search(
            countryCode: String,
            regionId: Int?,
            query: String?,
        ): Result<List<CityRef>> =
            reference
                .cities(countryCode = countryCode, regionId = regionId, query = query?.takeIf { it.isNotBlank() })
                .onSuccess { remember(it) }

        fun remember(cities: Collection<CityRef?>) {
            val known = cities.filterNotNull()
            if (known.isEmpty()) return
            cityState.update { map -> map + known.associateBy { it.id } }
        }

        fun name(cityId: Int?): String? = cityId?.let { cityState.value[it]?.name }

        /** Loads the major cities of a country once, so a saved city id can be named. */
        suspend fun resolve(
            countryCode: String,
            cityId: Int,
        ) {
            if (cityState.value.containsKey(cityId) || !majorLoaded.add(countryCode)) return
            reference
                .cities(countryCode = countryCode, limit = MAJOR_CITIES)
                .onSuccess { remember(it) }
                .onFailure { majorLoaded.remove(countryCode) }
        }

        private companion object {
            const val MAJOR_CITIES = 50L
        }
    }

/** The search behind one city picker: debounced, with the major cities before typing (07 section 6.1). */
@HiltViewModel
class CitySearchViewModel
    @Inject
    constructor(
        private val places: PlaceLookup,
    ) : ViewModel() {
        data class Search(
            val query: String = "",
            val results: List<CityRef> = emptyList(),
            val loading: Boolean = false,
            val searched: Boolean = false,
        )

        private val state = MutableStateFlow(Search())
        val search: StateFlow<Search> = state.asStateFlow()

        val regions: StateFlow<Map<String, List<RegionItem>>> = places.regions
        val cities: StateFlow<Map<Int, CityRef>> = places.cities

        private var job: Job? = null

        fun loadRegions(countryCode: String?) {
            if (countryCode == null) return
            viewModelScope.launch { places.loadRegions(countryCode) }
        }

        fun resolve(
            countryCode: String?,
            cityId: Int?,
        ) {
            if (countryCode == null || cityId == null) return
            viewModelScope.launch { places.resolve(countryCode, cityId) }
        }

        fun remember(city: CityRef) = places.remember(listOf(city))

        /** `q` is sent from 2 characters, 300 ms after the last keystroke; an empty query lists the major cities. */
        fun search(
            countryCode: String,
            regionId: Int?,
            query: String,
            immediate: Boolean = false,
        ) {
            state.update { it.copy(query = query) }
            job?.cancel()
            val text = query.trim()
            if (text.length in 1 until MIN_QUERY) return
            job =
                viewModelScope.launch {
                    if (!immediate) delay(DEBOUNCE_MS)
                    state.update { it.copy(loading = true) }
                    val result = places.search(countryCode, regionId, text.ifEmpty { null })
                    state.update {
                        it.copy(results = result.getOrNull().orEmpty(), loading = false, searched = true)
                    }
                }
        }

        companion object {
            const val MIN_QUERY = 2
            private const val DEBOUNCE_MS = 300L
        }
    }
