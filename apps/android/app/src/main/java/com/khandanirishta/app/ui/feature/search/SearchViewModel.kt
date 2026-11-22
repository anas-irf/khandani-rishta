package com.khandanirishta.app.ui.feature.search

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.Page
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.core.data.SearchSession
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.RegionItem
import com.khandanirishta.app.core.network.generated.model.SavedSearch
import com.khandanirishta.app.core.network.generated.model.SearchFilters
import com.khandanirishta.app.core.network.generated.model.SearchSort
import com.khandanirishta.app.ui.feature.home.CardActions
import com.khandanirishta.app.ui.feature.home.PassedCards
import com.khandanirishta.app.ui.feature.home.putBack
import com.khandanirishta.app.ui.feature.home.withShortlist
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.messages.fieldTexts
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The two views of APP-SEARCH; a phone shows one at a time (specs/16 section 6.6). */
enum class SearchPane { FORM, RESULTS }

/** The search shown in the results view. */
@Immutable
data class AppliedSearch(
    val filters: SearchFilters,
    val sort: SearchSort,
)

/** "Save this search" or "Rename" while open; [target] is the saved search being renamed. */
@Immutable
data class NameDialog(
    val target: SavedSearch? = null,
    val busy: Boolean = false,
    val error: UiText? = null,
)

/** The city search behind the "City" control (`GET /v1/reference/cities`). */
@Immutable
data class CitySearch(
    val query: String = "",
    val loading: Boolean = false,
    val results: List<CityRef> = emptyList(),
    /** A search ran for [query], so empty [results] means nothing was found. */
    val done: Boolean = false,
)

@Immutable
data class SearchUiState(
    /** The form is filled: from the session, a preset, a saved search or the preferences. */
    val ready: Boolean = false,
    val view: SearchPane = SearchPane.FORM,
    /** The filters on the form. */
    val draft: SearchFilters = SearchFilters(),
    val sort: SearchSort = SearchSort.BEST_MATCH,
    val applied: AppliedSearch? = null,
    /** Counts the searches run, so each new search starts at the top of the list. */
    val runId: Int = 0,
    /** `total_estimate` of the first page; `null` means more than 500. */
    val total: Long? = null,
    val totalKnown: Boolean = false,
    /** `validation_failed` messages by filter key, shown on the form. */
    val fieldErrors: Map<String, UiText> = emptyMap(),
    val preferencesLoaded: Boolean = false,
    val savedSearches: List<SavedSearch> = emptyList(),
    val codeError: UiText? = null,
    val findingCode: Boolean = false,
    /** Regions of the chosen countries, by country code. */
    val regions: Map<String, List<RegionItem>> = emptyMap(),
    val cityNames: Map<Int, String> = emptyMap(),
    val citySearch: CitySearch = CitySearch(),
    val saveDialog: NameDialog? = null,
    val renameDialog: NameDialog? = null,
    val removing: SavedSearch? = null,
    val removeBusy: Boolean = false,
) {
    /** The message for one control, if the API named one of its keys. */
    fun errorFor(control: FilterControl): UiText? = control.keys.firstNotNullOfOrNull { fieldErrors[it] }

    fun regionName(id: Int): String? =
        regions.values.firstNotNullOfOrNull { list -> list.firstOrNull { it.id == id }?.name }
}

sealed interface SearchEvent {
    data class OpenProfile(
        val profileId: String,
    ) : SearchEvent
}

/** What the search screen asks of its view model. */
@Stable
interface SearchActions {
    fun updateDraft(transform: (SearchFilters) -> SearchFilters)

    /** Countries change the regions on offer: regions of countries no longer chosen are dropped. */
    fun setCountries(codes: List<String>)

    fun search()

    fun reset()

    fun usePreferences()

    fun showForm()

    fun changeSort(sort: SearchSort)

    fun removeFilter(control: FilterControl)

    fun runSaved(saved: SavedSearch)

    fun openSaveDialog()

    fun saveSearch(
        name: String,
        notify: Boolean,
    )

    fun dismissSaveDialog()

    fun openRename(saved: SavedSearch)

    fun rename(name: String)

    fun dismissRename()

    fun clearDialogError()

    fun toggleNotify(saved: SavedSearch)

    fun askRemove(saved: SavedSearch)

    fun confirmRemove()

    fun dismissRemove()

    fun findCode(input: String)

    fun clearCodeError()

    fun searchCities(
        country: String,
        query: String,
    )

    fun addCity(city: CityRef)

    fun removeCity(id: Int)

    fun refresh()

    fun loadMore()

    fun toggleShortlist(card: ProfileCard)

    fun pass(card: ProfileCard)

    fun undoPass(id: String)
}

/**
 * APP-SEARCH (specs/16 section 6.6). Holds the form, mirrors it into the session kept by
 * [DiscoveryRepository.searchSession] so it survives tab switches, and pages the results.
 * [savedSearchId] comes from a notification: that saved search is loaded and run; when it no
 * longer exists the form starts empty (16 section 4.1).
 */
@HiltViewModel(assistedFactory = SearchViewModel.Factory::class)
class SearchViewModel
    @AssistedInject
    constructor(
        @Assisted private val savedSearchId: String?,
        private val discovery: DiscoveryRepository,
        private val profiles: ProfileRepository,
        private val references: ReferenceRepository,
        private val me: MeRepository,
        private val cardActions: CardActions,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel(),
        SearchActions {
        private val mutableState = MutableStateFlow(SearchUiState())
        val state: StateFlow<SearchUiState> = mutableState.asStateFlow()

        private val paginator = Paginator<ProfileCard>(viewModelScope, key = { it.id }) { cursor -> fetch(cursor) }
        val results: StateFlow<PagedState<ProfileCard>> = paginator.state

        private val mutablePassed = MutableStateFlow(PassedCards())

        /** "Not interested" in these results since the member came to the screen. */
        val passed: StateFlow<PassedCards> = mutablePassed.asStateFlow()

        private val eventChannel = Channel<SearchEvent>(Channel.BUFFERED)
        val events: Flow<SearchEvent> = eventChannel.receiveAsFlow()

        private var preferences: Preferences? = null
        private var cityJob: Job? = null
        private var cityCountry: String? = null
        private val loadingRegions = mutableSetOf<String>()

        init {
            rememberOwnCity()

            // The form keeps the last filters and sort for the rest of the session.
            val session = discovery.searchSession.value
            if (session != null) {
                mutableState.update { it.copy(ready = true, draft = session.filters, sort = session.sort.orDefault()) }
            }
            val preset = if (savedSearchId == null) discovery.takePreset() else null
            when {
                savedSearchId != null -> openSavedSearch(savedSearchId)
                preset != null -> applyPreset(preset)
            }
            // The first open in a session fills the form from the preferences, without searching.
            loadPreferences(fillForm = session == null && savedSearchId == null && preset == null)
            loadSavedSearches()
            ensureRegions(state.value.draft.countryCodes)

            // A preset arriving while the screen is alive ("See all" on Home) is applied too.
            viewModelScope.launch {
                discovery.preset.collect { pending ->
                    if (pending != null) discovery.takePreset()?.let { applyPreset(it) }
                }
            }
            viewModelScope.launch {
                mutableState
                    .filter { it.ready }
                    .map { SearchSession(filters = it.draft, sort = it.sort) }
                    .distinctUntilChanged()
                    .collect { discovery.searchSession.value = it }
            }
            viewModelScope.launch {
                invalidation.flow.collect { key ->
                    when (key) {
                        DataKey.SavedSearches -> loadSavedSearches()
                        DataKey.Preferences -> loadPreferences(fillForm = false)
                        DataKey.Search -> refreshQuietly()
                        else -> Unit
                    }
                }
            }
            viewModelScope.launch {
                cardActions.shortlistChanges.collect { change ->
                    setShortlisted(change.profileId, change.shortlisted)
                }
            }
        }

        /**
         * The screen is shown again: take over a form another search screen changed in the
         * meantime, and refetch results older than 60 seconds (rule G5).
         */
        fun onResume() {
            val session = discovery.searchSession.value
            val current = state.value
            val changed = session != null && (session.filters != current.draft || session.sort != current.sort)
            if (session != null && current.ready && changed) {
                mutableState.update { it.copy(draft = session.filters, sort = session.sort.orDefault()) }
                ensureRegions(session.filters.countryCodes)
            }
            if (current.applied != null) paginator.refreshIfStale()
        }

        // -------------------------------------------------------------------
        // Form
        // -------------------------------------------------------------------

        override fun updateDraft(transform: (SearchFilters) -> SearchFilters) {
            mutableState.update { it.copy(draft = transform(it.draft)) }
            ensureRegions(state.value.draft.countryCodes)
        }

        override fun setCountries(codes: List<String>) {
            val regions = state.value.regions
            updateDraft { filters ->
                val removed = filters.countryCodes.orEmpty().toSet() - codes.toSet()
                val dropped = removed.flatMap { country -> regions[country].orEmpty().map { it.id } }.toSet()
                filters.copy(countryCodes = codes, regionIds = filters.regionIds?.filterNot { it in dropped })
            }
        }

        override fun search() {
            val current = state.value
            run(current.draft, current.sort)
        }

        /** "Reset": clears every control and does not search. */
        override fun reset() {
            mutableState.update { it.copy(draft = SearchFilters(), fieldErrors = emptyMap()) }
        }

        override fun usePreferences() {
            val value = preferences ?: return
            val filters = value.toSearchFilters(me.current?.profile?.gender)
            mutableState.update { it.copy(draft = filters, fieldErrors = emptyMap()) }
            ensureRegions(filters.countryCodes)
        }

        override fun showForm() {
            mutableState.update { it.copy(view = SearchPane.FORM) }
        }

        /** Changing the sort searches again from the first page. */
        override fun changeSort(sort: SearchSort) {
            val applied = state.value.applied ?: return
            if (sort == applied.sort) return
            run(applied.filters, sort)
        }

        /** The close control of a summary chip removes that filter and searches again. */
        override fun removeFilter(control: FilterControl) {
            val applied = state.value.applied ?: return
            run(control.clear(applied.filters), applied.sort)
        }

        override fun runSaved(saved: SavedSearch) {
            run(saved.filters, state.value.sort)
        }

        private fun run(
            filters: SearchFilters,
            sort: SearchSort,
        ) {
            val clean = filters.cleaned()
            val order = sort.orDefault()
            mutableState.update {
                it.copy(
                    ready = true,
                    draft = clean,
                    sort = order,
                    applied = AppliedSearch(clean, order),
                    view = SearchPane.RESULTS,
                    runId = it.runId + 1,
                    total = null,
                    totalKnown = false,
                    fieldErrors = emptyMap(),
                )
            }
            ensureRegions(clean.countryCodes)
            // The panels belong to the results they were made in.
            mutablePassed.value = PassedCards()
            paginator.reset()
            paginator.refresh()
        }

        /** A preset from another screen replaces the form, and runs at once when it asks to. */
        private fun applyPreset(preset: SearchSession) {
            // "Near you" searches the viewer's own city, which then shows by name.
            rememberOwnCity()
            val id = preset.savedSearchId
            if (id != null) {
                openSavedSearch(id)
                return
            }
            if (preset.runNow) {
                run(preset.filters, preset.sort)
            } else {
                val filters = preset.filters.cleaned()
                mutableState.update {
                    it.copy(
                        ready = true,
                        draft = filters,
                        sort = preset.sort.orDefault(),
                        view = SearchPane.FORM,
                        fieldErrors = emptyMap(),
                    )
                }
                ensureRegions(filters.countryCodes)
            }
        }

        private fun openSavedSearch(id: String) {
            mutableState.update { it.copy(ready = false, view = SearchPane.RESULTS) }
            viewModelScope.launch {
                val items = discovery.savedSearches().getOrNull()
                if (items != null) mutableState.update { it.copy(savedSearches = items.newestFirst()) }
                val saved = items?.firstOrNull { it.id == id }
                if (saved != null) {
                    run(saved.filters, state.value.sort)
                } else {
                    mutableState.update {
                        it.copy(ready = true, draft = SearchFilters(), applied = null, view = SearchPane.FORM)
                    }
                }
            }
        }

        private fun loadPreferences(fillForm: Boolean) {
            viewModelScope.launch {
                profiles
                    .preferences()
                    .onSuccess { value ->
                        preferences = value
                        mutableState.update { it.copy(preferencesLoaded = true) }
                        if (fillForm && !state.value.ready) {
                            val filters = value.toSearchFilters(me.current?.profile?.gender)
                            mutableState.update { it.copy(ready = true, draft = filters) }
                            ensureRegions(filters.countryCodes)
                        }
                    }.onFailure {
                        if (fillForm && !state.value.ready) mutableState.update { it.copy(ready = true) }
                    }
            }
        }

        private fun rememberOwnCity() {
            profiles.ownProfile.value
                ?.location
                ?.city
                ?.let(CityNames::put)
            mutableState.update { it.copy(cityNames = it.cityNames + CityNames.all()) }
        }

        /** Loads the regions of each chosen country once, for "Province or state". */
        private fun ensureRegions(countries: List<String>?) {
            countries.orEmpty().forEach { country ->
                if (country in state.value.regions || !loadingRegions.add(country)) return@forEach
                viewModelScope.launch {
                    references.regions(country).onSuccess { items ->
                        mutableState.update { it.copy(regions = it.regions + (country to items)) }
                    }
                    loadingRegions.remove(country)
                }
            }
        }

        // -------------------------------------------------------------------
        // Results
        // -------------------------------------------------------------------

        private suspend fun fetch(cursor: String?): Result<Page<ProfileCard>> {
            val applied = state.value.applied ?: return Result.success(Page(emptyList(), null))
            return discovery
                .search(applied.filters, applied.sort, cursor)
                .onSuccess { page ->
                    if (cursor == null) mutableState.update { it.copy(total = page.totalEstimate, totalKnown = true) }
                }.onFailure { error -> if (cursor == null) searchFailed(error.apiError) }
                .map { Page(it.items, it.nextCursor) }
        }

        /**
         * `validation_failed` shows its messages on the form; `rate_limited` shows the toast of
         * 16 section 1.3. The list shows the screen error (G3) for everything else.
         */
        private fun searchFailed(error: ApiError) {
            when (error.code) {
                ErrorCode.VALIDATION_FAILED -> {
                    val errors =
                        error
                            .fieldTexts()
                            .mapNotNull { (field, text) -> FilterControl.ofField(field)?.let { it to text } }
                            .flatMap { (control, text) -> control.keys.map { key -> key to text } }
                            .toMap()
                    if (errors.isNotEmpty()) {
                        mutableState.update { it.copy(fieldErrors = errors, view = SearchPane.FORM) }
                    }
                }

                ErrorCode.RATE_LIMITED -> {
                    bus.error(error)
                }

                else -> {}
            }
        }

        override fun refresh() {
            if (state.value.applied != null) paginator.refresh()
        }

        /** After a block elsewhere the results are fetched again over the shown list. */
        private fun refreshQuietly() {
            if (state.value.applied != null) paginator.refresh(showSpinner = false)
        }

        override fun loadMore() {
            paginator.loadMore()
        }

        override fun toggleShortlist(card: ProfileCard) {
            viewModelScope.launch {
                cardActions.toggleShortlist(card) { value -> setShortlisted(card.id, value) }
            }
        }

        private fun setShortlisted(
            id: String,
            value: Boolean,
        ) {
            paginator.updateItem(id) { it.withShortlist(value) }
            mutablePassed.update { passed -> passed.update(id) { it.withShortlist(value) } }
        }

        /** "Not interested": the panel takes the card's place until the member leaves the screen. */
        override fun pass(card: ProfileCard) {
            val shown = mutablePassed.value.arrange(results.value.items)
            val place = shown.indexOfFirst { it.id == card.id }
            val searched = state.value.applied
            mutablePassed.update { it.pass(card, shown) }
            viewModelScope.launch {
                cardActions.pass(card.id) {
                    mutablePassed.update { it.without(card.id) }
                    // Only into the results it came from.
                    if (state.value.applied == searched) paginator.update { it.putBack(card, place) }
                }
            }
        }

        override fun undoPass(id: String) {
            mutablePassed.update { it.restore(id) }
            viewModelScope.launch {
                cardActions.undoPass(id) { mutablePassed.update { it.passAgain(id) } }
            }
        }

        /** The panels end with the visit. */
        fun leaveScreen() {
            mutablePassed.update { it.leave() }
        }

        /** Back from elsewhere: the cards passed in the last visit leave the results. */
        fun returnToScreen() {
            val passed = mutablePassed.value
            if (!passed.left) return
            paginator.update(passed::hide)
            mutablePassed.value = PassedCards()
        }

        // -------------------------------------------------------------------
        // Saved searches
        // -------------------------------------------------------------------

        private fun loadSavedSearches() {
            viewModelScope.launch {
                discovery.savedSearches().onSuccess { items ->
                    mutableState.update { it.copy(savedSearches = items.newestFirst()) }
                }
            }
        }

        override fun openSaveDialog() {
            if (state.value.applied == null) return
            mutableState.update { it.copy(saveDialog = NameDialog()) }
        }

        override fun dismissSaveDialog() {
            if (state.value.saveDialog?.busy == true) return
            mutableState.update { it.copy(saveDialog = null) }
        }

        /** `POST /v1/me/saved-searches`; `limit_reached` shows the limit dialog with its own text. */
        override fun saveSearch(
            name: String,
            notify: Boolean,
        ) {
            val current = state.value
            val applied = current.applied ?: return
            val dialog = current.saveDialog ?: return
            if (dialog.busy) return
            val trimmed = name.trim()
            if (trimmed.isEmpty()) {
                mutableState.update { it.copy(saveDialog = dialog.copy(error = REQUIRED)) }
                return
            }
            mutableState.update { it.copy(saveDialog = dialog.copy(busy = true, error = null)) }
            viewModelScope.launch {
                discovery
                    .saveSearch(trimmed, applied.filters.cleaned(), notify)
                    .onSuccess { saved ->
                        mutableState.update {
                            it.copy(
                                saveDialog = null,
                                savedSearches = (it.savedSearches.without(saved.id) + saved).newestFirst(),
                            )
                        }
                        bus.toast(R.string.discovery_saved_saved)
                    }.onFailure { failure ->
                        val error = failure.apiError
                        if (error.code == ErrorCode.LIMIT_REACHED) {
                            mutableState.update { it.copy(saveDialog = null) }
                            bus.limit(UiText.of(R.string.discovery_saved_limit))
                        } else {
                            val nameError = error.fieldTexts()["name"]
                            mutableState.update {
                                it.copy(saveDialog = it.saveDialog?.copy(busy = false, error = nameError))
                            }
                            if (nameError == null) bus.error(error)
                        }
                    }
            }
        }

        override fun openRename(saved: SavedSearch) {
            mutableState.update { it.copy(renameDialog = NameDialog(target = saved)) }
        }

        override fun dismissRename() {
            if (state.value.renameDialog?.busy == true) return
            mutableState.update { it.copy(renameDialog = null) }
        }

        /** `PATCH /v1/me/saved-searches/{id}` with `{ "name" }`. */
        override fun rename(name: String) {
            val dialog = state.value.renameDialog ?: return
            val target = dialog.target ?: return
            if (dialog.busy) return
            val trimmed = name.trim()
            if (trimmed.isEmpty()) {
                mutableState.update { it.copy(renameDialog = dialog.copy(error = REQUIRED)) }
                return
            }
            if (trimmed == target.name) {
                mutableState.update { it.copy(renameDialog = null) }
                return
            }
            mutableState.update { it.copy(renameDialog = dialog.copy(busy = true, error = null)) }
            viewModelScope.launch {
                discovery
                    .updateSavedSearch(target.id, name = trimmed)
                    .onSuccess { updated ->
                        mutableState.update {
                            it.copy(renameDialog = null, savedSearches = it.savedSearches.replace(updated))
                        }
                        bus.toast(R.string.discovery_saved_updated)
                    }.onFailure { failure ->
                        val error = failure.apiError
                        val nameError = error.fieldTexts()["name"]
                        if (error.code == ErrorCode.NOT_FOUND) {
                            mutableState.update { it.copy(renameDialog = null) }
                            loadSavedSearches()
                        } else {
                            mutableState.update {
                                it.copy(renameDialog = it.renameDialog?.copy(busy = false, error = nameError))
                            }
                        }
                        if (nameError == null) bus.error(error)
                    }
            }
        }

        override fun clearDialogError() {
            mutableState.update {
                it.copy(
                    saveDialog = it.saveDialog?.copy(error = null),
                    renameDialog = it.renameDialog?.copy(error = null),
                )
            }
        }

        /** "Notify me about new members": `PATCH` with `{ "notify_new" }`, waiting for the server (G7). */
        override fun toggleNotify(saved: SavedSearch) {
            viewModelScope.launch {
                discovery
                    .updateSavedSearch(saved.id, notifyNew = !saved.notifyNew)
                    .onSuccess { updated ->
                        mutableState.update { it.copy(savedSearches = it.savedSearches.replace(updated)) }
                        bus.toast(R.string.discovery_saved_updated)
                    }.onFailure { bus.error(it.apiError) }
            }
        }

        override fun askRemove(saved: SavedSearch) {
            mutableState.update { it.copy(removing = saved) }
        }

        override fun dismissRemove() {
            if (state.value.removeBusy) return
            mutableState.update { it.copy(removing = null) }
        }

        /** `DELETE /v1/me/saved-searches/{id}` after the confirmation (rule G8). */
        override fun confirmRemove() {
            val target = state.value.removing ?: return
            if (state.value.removeBusy) return
            mutableState.update { it.copy(removeBusy = true) }
            viewModelScope.launch {
                val result = discovery.deleteSavedSearch(target.id)
                val error = result.exceptionOrNull()?.apiError
                val gone = error == null || error.code == ErrorCode.NOT_FOUND
                mutableState.update {
                    it.copy(
                        removing = null,
                        removeBusy = false,
                        savedSearches = if (gone) it.savedSearches.without(target.id) else it.savedSearches,
                    )
                }
                if (!gone) bus.error(error)
            }
        }

        private fun List<SavedSearch>.newestFirst(): List<SavedSearch> = sortedByDescending { it.createdAt }

        private fun List<SavedSearch>.replace(updated: SavedSearch): List<SavedSearch> =
            map { if (it.id == updated.id) updated else it }

        private fun List<SavedSearch>.without(id: String): List<SavedSearch> = filterNot { it.id == id }

        // -------------------------------------------------------------------
        // Profile code (16 section 6.6)
        // -------------------------------------------------------------------

        /**
         * "Find": trimmed and in capitals; `KR` and 8 characters, otherwise the format message.
         * Success opens APP-PROFILE; `404` shows "No profile with this code is available to you."
         */
        override fun findCode(input: String) {
            if (state.value.findingCode) return
            val code = normalizeProfileCode(input)
            if (!isProfileCode(code)) {
                mutableState.update { it.copy(codeError = UiText.of(R.string.discovery_search_code_invalid)) }
                return
            }
            mutableState.update { it.copy(codeError = null, findingCode = true) }
            viewModelScope.launch {
                discovery
                    .profileIdByCode(code)
                    .onSuccess { profileId ->
                        mutableState.update { it.copy(findingCode = false) }
                        eventChannel.trySend(SearchEvent.OpenProfile(profileId))
                    }.onFailure { failure ->
                        val error = failure.apiError
                        val notFound = error.code == ErrorCode.NOT_FOUND
                        mutableState.update {
                            it.copy(
                                findingCode = false,
                                codeError = if (notFound) UiText.of(R.string.discovery_search_code_not_found) else null,
                            )
                        }
                        if (!notFound) bus.error(error)
                    }
            }
        }

        override fun clearCodeError() {
            if (state.value.codeError != null) mutableState.update { it.copy(codeError = null) }
        }

        // -------------------------------------------------------------------
        // Cities
        // -------------------------------------------------------------------

        /** Searches cities of [country] once at least 2 letters are typed, 300 ms after the last key. */
        override fun searchCities(
            country: String,
            query: String,
        ) {
            cityJob?.cancel()
            val trimmed = query.trim()
            if (trimmed.length < CITY_MIN_LETTERS) {
                mutableState.update { it.copy(citySearch = CitySearch(query = query)) }
                return
            }
            val sameCountry = country == cityCountry
            cityCountry = country
            mutableState.update {
                val kept = if (sameCountry) it.citySearch.results else emptyList()
                it.copy(citySearch = it.citySearch.copy(query = query, loading = true, results = kept, done = false))
            }
            cityJob =
                viewModelScope.launch {
                    delay(CITY_DEBOUNCE_MS)
                    references
                        .cities(countryCode = country, query = trimmed)
                        .onSuccess { cities ->
                            cities.forEach(CityNames::put)
                            val found = CitySearch(query = query, results = cities, done = true)
                            mutableState.update { it.copy(citySearch = found) }
                        }.onFailure { failure ->
                            mutableState.update { it.copy(citySearch = CitySearch(query = query, done = true)) }
                            bus.error(failure.apiError)
                        }
                }
        }

        override fun addCity(city: CityRef) {
            CityNames.put(city)
            mutableState.update {
                val ids = it.draft.cityIds.orEmpty()
                it.copy(
                    draft = if (city.id in ids) it.draft else it.draft.copy(cityIds = ids + city.id),
                    cityNames = it.cityNames + (city.id to city.name),
                )
            }
        }

        override fun removeCity(id: Int) {
            mutableState.update { current ->
                current.copy(draft = current.draft.copy(cityIds = current.draft.cityIds?.filterNot { it == id }))
            }
        }

        @AssistedFactory
        interface Factory {
            fun create(savedSearchId: String?): SearchViewModel
        }

        private companion object {
            const val CITY_MIN_LETTERS = 2
            const val CITY_DEBOUNCE_MS = 300L
            val REQUIRED = UiText.of(R.string.errors_field_required)
        }
    }
