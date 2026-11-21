package com.khandanirishta.app.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter
import javax.inject.Inject
import javax.inject.Singleton

/** The kinds of data a screen shows, mirroring the web's query keys (specs/17 section 6.2). */
sealed interface DataKey {
    data object Home : DataKey

    data object Recommendations : DataKey

    data object Search : DataKey

    data object Interests : DataKey

    data object Connections : DataKey

    data class Connection(
        val id: String,
    ) : DataKey

    data class Profile(
        val id: String,
    ) : DataKey

    /** Every other member's profile, after the viewer's preferences change. */
    data object AllProfiles : DataKey

    data object Shortlist : DataKey

    data object Visitors : DataKey

    data object Blocks : DataKey

    data object Notifications : DataKey

    data object PhotoAccess : DataKey

    data object OwnProfile : DataKey

    data object OwnPhotos : DataKey

    data object Verifications : DataKey

    data object SavedSearches : DataKey

    data object Preferences : DataKey

    data object Privacy : DataKey
}

/**
 * After a change succeeds, repositories announce which data is now stale, following the web's
 * invalidation table (specs/17 section 6.3). Screens showing that data fetch it again.
 */
@Singleton
class Invalidation
    @Inject
    constructor() {
        private val events = MutableSharedFlow<DataKey>(extraBufferCapacity = 64)
        val flow: SharedFlow<DataKey> = events.asSharedFlow()

        fun invalidate(vararg keys: DataKey) {
            keys.forEach { events.tryEmit(it) }
        }

        /** Events for one key, or for profiles when [key] is a profile and all profiles were invalidated. */
        fun on(key: DataKey): Flow<DataKey> =
            flow.filter { it == key || (key is DataKey.Profile && it == DataKey.AllProfiles) }
    }
