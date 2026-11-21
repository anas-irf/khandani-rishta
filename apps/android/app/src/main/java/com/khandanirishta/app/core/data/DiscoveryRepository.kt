package com.khandanirishta.app.core.data

import android.os.SystemClock
import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.DiscoveryApi
import com.khandanirishta.app.core.network.generated.api.ProfileApi
import com.khandanirishta.app.core.network.generated.model.Home
import com.khandanirishta.app.core.network.generated.model.NewSavedSearch
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.RecommendationsPage
import com.khandanirishta.app.core.network.generated.model.SavedSearch
import com.khandanirishta.app.core.network.generated.model.SavedSearchPatch
import com.khandanirishta.app.core.network.generated.model.SearchFilters
import com.khandanirishta.app.core.network.generated.model.SearchRequest
import com.khandanirishta.app.core.network.generated.model.SearchResults
import com.khandanirishta.app.core.network.generated.model.SearchSort
import com.khandanirishta.app.core.network.generated.model.VisitorItem
import com.khandanirishta.app.core.network.generated.model.VisitorsPage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Home, matches, search, saved searches, profiles and visitors (specs/10, 15 sections 9 and 10). */
@Singleton
class DiscoveryRepository
    @Inject
    constructor(
        private val api: DiscoveryApi,
        private val profileApi: ProfileApi,
        private val caller: ApiCaller,
        private val invalidation: Invalidation,
    ) {
        private var home: Home? = null
        private var homeAt = 0L

        /** The search form of this session, kept in memory only (specs/16 section 6.6). */
        val searchSession = MutableStateFlow<SearchSession?>(null)

        /** A preset from another screen ("See all"), applied and run when the search opens. */
        private val pendingPreset = MutableStateFlow<SearchSession?>(null)
        val preset: StateFlow<SearchSession?> = pendingPreset.asStateFlow()

        fun presetSearch(session: SearchSession) {
            pendingPreset.value = session
        }

        fun takePreset(): SearchSession? = pendingPreset.value.also { pendingPreset.value = null }

        /** The cached home, when it is younger than 5 minutes (specs/16 section 6.4). */
        fun cachedHome(maxAgeMillis: Long = HOME_MAX_AGE): Home? =
            home?.takeIf { SystemClock.elapsedRealtime() - homeAt < maxAgeMillis }

        suspend fun home(): Result<Home> =
            caller.call { api.getHome() }.onSuccess {
                home = it
                homeAt = SystemClock.elapsedRealtime()
            }

        fun forgetHome() {
            home = null
        }

        suspend fun recommendations(cursor: String?): Result<RecommendationsPage> =
            caller.call { api.getRecommendations(limit = PAGE, cursor = cursor) }

        suspend fun refreshRecommendations(): Result<Unit> = caller.call { api.postRefresh() }

        suspend fun search(
            filters: SearchFilters,
            sort: SearchSort,
            cursor: String?,
        ): Result<SearchResults> =
            caller.call {
                api.postSearch(SearchRequest(filters = filters, sort = sort, limit = PAGE, cursor = cursor))
            }

        suspend fun savedSearches(): Result<List<SavedSearch>> =
            caller.call { api.listSavedSearches() }.map { it.items }

        suspend fun saveSearch(
            name: String,
            filters: SearchFilters,
            notifyNew: Boolean,
        ): Result<SavedSearch> =
            caller
                .call { api.createSavedSearch(NewSavedSearch(filters = filters, name = name, notifyNew = notifyNew)) }
                .onSuccess { invalidation.invalidate(DataKey.SavedSearches) }

        suspend fun updateSavedSearch(
            id: String,
            name: String? = null,
            notifyNew: Boolean? = null,
        ): Result<SavedSearch> =
            caller
                .call { api.patchSavedSearch(id, SavedSearchPatch(name = name, notifyNew = notifyNew)) }
                .onSuccess { invalidation.invalidate(DataKey.SavedSearches) }

        suspend fun deleteSavedSearch(id: String): Result<Unit> =
            caller.call { api.deleteSavedSearch(id) }.onSuccess { invalidation.invalidate(DataKey.SavedSearches) }

        suspend fun profile(profileId: String): Result<ProfileDetail> = caller.call { api.getProfile(profileId) }

        suspend fun profileIdByCode(publicCode: String): Result<String> =
            caller.call { api.getProfileByCode(publicCode) }.map { it.profileId }

        /** How the own profile looks to others (08 section 4); [asTier] is `member` or `connection`. */
        suspend fun preview(asTier: String? = null): Result<ProfileDetail> =
            caller.call { profileApi.getPreview(asTier) }

        suspend fun visitors(cursor: String?): Result<VisitorsPage> =
            caller.call {
                api.getVisitors(limit = PAGE, cursor = cursor)
            }

        suspend fun visited(cursor: String?): Result<Page<VisitorItem>> =
            caller.call { api.getVisited(limit = PAGE, cursor = cursor) }.map { Page(it.items, it.nextCursor) }

        /** Removes a card from the cached home after a pass or block (specs/17 section 6.3). */
        fun dropFromHome(profileId: String) {
            val current = home ?: return

            fun List<ProfileCard>.without() = filterNot { it.id == profileId }
            home =
                current.copy(
                    recommendations = current.recommendations.without(),
                    newMembers = current.newMembers.without(),
                    nearby = current.nearby.without(),
                    recentVisitors = current.recentVisitors.without(),
                )
        }

        companion object {
            const val PAGE = 20L
            const val HOME_MAX_AGE = 5 * 60_000L
        }
    }

/** The filters and sort of the search screen, kept for the session. */
data class SearchSession(
    val filters: SearchFilters = SearchFilters(),
    val sort: SearchSort = SearchSort.BEST_MATCH,
    /** Run the search at once (a preset from another screen, a saved search). */
    val runNow: Boolean = false,
    val savedSearchId: String? = null,
)
