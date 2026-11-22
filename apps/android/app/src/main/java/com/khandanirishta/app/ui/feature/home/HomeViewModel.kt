package com.khandanirishta.app.ui.feature.home

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.SearchSession
import com.khandanirishta.app.core.datastore.AppPreferences
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Home
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.SearchFilters
import com.khandanirishta.app.core.network.generated.model.SearchSort
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class HomeUiState(
    val home: Home? = null,
    /** "Not interested" since the member came to the screen. */
    val passed: PassedCards = PassedCards(),
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: ApiError? = null,
    /** "Finding your matches...": refetches left (at most 3, 5 seconds apart; 16 section 6.4). */
    val findingAttempts: Int = 0,
)

/** APP-HOME (specs/16 section 6.4). */
@HiltViewModel
class HomeViewModel
    @Inject
    constructor(
        private val discovery: DiscoveryRepository,
        private val profiles: ProfileRepository,
        private val actions: CardActions,
        private val preferences: AppPreferences,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(HomeUiState())
        val state: StateFlow<HomeUiState> = mutableState.asStateFlow()

        /** Tips and banners dismissed on this device. `null` until read, so none flashes up and goes. */
        val dismissed: StateFlow<Set<String>?> =
            preferences.dismissed.stateIn(viewModelScope, SharingStarted.Eagerly, null)

        private var loadJob: Job? = null
        private var findingJob: Job? = null

        init {
            val cached = discovery.cachedHome()
            if (cached != null) {
                mutableState.value = HomeUiState(home = cached, loading = false)
                scheduleFinding(cached)
            } else {
                load()
            }
            viewModelScope.launch {
                invalidation.flow.collect { key ->
                    if (key == DataKey.Home || key == DataKey.Recommendations) load(silent = true)
                }
            }
            viewModelScope.launch {
                actions.shortlistChanges.collect { change ->
                    updateCard(change.profileId) { it.withShortlist(change.shortlisted) }
                }
            }
        }

        fun load(
            silent: Boolean = false,
            pull: Boolean = false,
        ) {
            loadJob?.cancel()
            loadJob =
                viewModelScope.launch {
                    mutableState.update {
                        it.copy(
                            loading = it.home == null && !silent,
                            refreshing = pull,
                            error = null,
                        )
                    }
                    discovery
                        .home()
                        .onSuccess { home ->
                            mutableState.update {
                                it.copy(
                                    home = home,
                                    loading = false,
                                    refreshing = false,
                                    error = null,
                                )
                            }
                            scheduleFinding(home)
                        }.onFailure { error ->
                            mutableState.update {
                                it.copy(
                                    loading = false,
                                    refreshing = false,
                                    error = if (it.home == null) error.apiError else null,
                                )
                            }
                            // A failed retry of "Finding your matches..." still counts towards the three.
                            mutableState.value.home?.let(::scheduleFinding)
                        }
                }
        }

        /** Refreshes when the cached answer is older than 5 minutes (16 section 6.4). */
        fun onVisible() {
            if (discovery.cachedHome() == null && !mutableState.value.loading) load(silent = true)
        }

        private fun scheduleFinding(home: Home) {
            findingJob?.cancel()
            if (home.recommendations.isNotEmpty() || home.poolExhausted) return
            if (mutableState.value.findingAttempts >= FINDING_RETRIES) return
            findingJob =
                viewModelScope.launch {
                    delay(FINDING_RETRY_MS)
                    mutableState.update { it.copy(findingAttempts = it.findingAttempts + 1) }
                    load(silent = true)
                }
        }

        fun toggleShortlist(card: ProfileCard) {
            viewModelScope.launch {
                actions.toggleShortlist(card) { value -> updateCard(card.id) { it.withShortlist(value) } }
            }
        }

        /** "Not interested": the panel takes the card's place until the member leaves the screen. */
        fun pass(card: ProfileCard) {
            val home = mutableState.value.home ?: return
            val shown = mutableState.value.passed.arrange(home.matchesRow())
            val place = shown.indexOfFirst { it.id == card.id }
            mutableState.update { it.copy(passed = it.passed.pass(card, shown)) }
            viewModelScope.launch {
                actions.pass(card.id) {
                    mutableState.update { state ->
                        state.copy(
                            passed = state.passed.without(card.id),
                            home = state.home?.let {
                                it.copy(
                                    recommendations = it.recommendations.putBack(card, place),
                                )
                            },
                        )
                    }
                    load(silent = true)
                }
            }
        }

        fun undoPass(id: String) {
            mutableState.update { it.copy(passed = it.passed.restore(id)) }
            viewModelScope.launch {
                actions.undoPass(id) { mutableState.update { it.copy(passed = it.passed.passAgain(id)) } }
            }
        }

        /** The panels end with the visit. */
        fun leaveScreen() {
            mutableState.update { it.copy(passed = it.passed.leave()) }
        }

        /** Back from elsewhere: the cards passed in the last visit leave the rows. */
        fun returnToScreen() {
            mutableState.update { state ->
                if (!state.passed.left) return@update state
                val passed = state.passed
                state.copy(
                    passed = PassedCards(),
                    home =
                        state.home?.let {
                            it.copy(
                                recommendations = passed.hide(it.recommendations),
                                newMembers = passed.hide(it.newMembers),
                                nearby = passed.hide(it.nearby),
                            )
                        },
                )
            }
        }

        fun dismiss(key: String) {
            viewModelScope.launch { preferences.dismiss(key) }
        }

        /** "See all" of "New members": search with `joined_within_days = 7`, newest first. */
        fun presetNewMembers() {
            discovery.presetSearch(SearchSession(SearchFilters(joinedWithinDays = 7), SearchSort.NEWEST, runNow = true))
        }

        /** "See all" of "Near you": search in the viewer's own city, best match first. */
        fun presetNearby() {
            viewModelScope.launch {
                val cityId = profiles
                    .cachedOrLoad()
                    .getOrNull()
                    ?.location
                    ?.cityId
                val filters = if (cityId != null) SearchFilters(cityIds = listOf(cityId)) else SearchFilters()
                discovery.presetSearch(SearchSession(filters, SearchSort.BEST_MATCH, runNow = cityId != null))
            }
        }

        private fun updateCard(
            id: String,
            transform: (ProfileCard) -> ProfileCard,
        ) {
            mutableState.update { state ->
                val home = state.home ?: return@update state

                fun List<ProfileCard>.map() = map { if (it.id == id) transform(it) else it }
                state.copy(
                    passed = state.passed.update(id, transform),
                    home =
                        home.copy(
                            recommendations = home.recommendations.map(),
                            newMembers = home.newMembers.map(),
                            nearby = home.nearby.map(),
                        ),
                )
            }
        }

        companion object {
            const val FINDING_RETRIES = 3
            const val FINDING_RETRY_MS = 5_000L
        }
    }

/** "Your matches" on Home shows up to 10 (specs/16 section 6.4). */
internal fun Home.matchesRow(): List<ProfileCard> = recommendations.take(MATCHES_ON_HOME)

private const val MATCHES_ON_HOME = 10
