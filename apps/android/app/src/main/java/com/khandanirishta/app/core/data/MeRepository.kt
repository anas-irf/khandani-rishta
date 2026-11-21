package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.AccountApi
import com.khandanirishta.app.core.network.generated.api.ProfileApi
import com.khandanirishta.app.core.network.generated.model.CloseBody
import com.khandanirishta.app.core.network.generated.model.ClosedReason
import com.khandanirishta.app.core.network.generated.model.ConsentDocument
import com.khandanirishta.app.core.network.generated.model.ConsentsBody
import com.khandanirishta.app.core.network.generated.model.Counters
import com.khandanirishta.app.core.network.generated.model.DeletionBody
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.LatestExport
import com.khandanirishta.app.core.network.generated.model.Locale
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.PatchMe
import com.khandanirishta.app.core.network.generated.model.ReopenBody
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The single holder of `Me`, counters included (specs/22 section 6). Every response that returns
 * `Me` replaces it, and the gate router follows [me].
 */
@Singleton
class MeRepository
    @Inject
    constructor(
        private val account: AccountApi,
        private val profile: ProfileApi,
        private val caller: ApiCaller,
        private val invalidation: Invalidation,
    ) {
        private val state = MutableStateFlow<Me?>(null)
        val me: StateFlow<Me?> = state.asStateFlow()

        private val refreshLock = Mutex()

        /** When `Me` was last fetched, in elapsed milliseconds; 0 when never. */
        @Volatile
        var lastFetchedAt: Long = 0L
            private set

        val current: Me? get() = state.value

        val gate: Gate? get() = state.value?.gate

        suspend fun refresh(): Result<Me> =
            refreshLock.withLock {
                caller.call { account.getMe() }.onSuccess { replace(it) }
            }

        /** Fetches again only when the copy is older than [maxAgeMillis]. */
        suspend fun refreshIfStale(maxAgeMillis: Long = STALE_MILLIS): Result<Me>? =
            if (now() - lastFetchedAt >= maxAgeMillis) refresh() else null

        fun replace(me: Me) {
            lastFetchedAt = now()
            state.value = me
        }

        /** The `counters` event only replaces the counters; it causes no fetch (specs/16 section 3.3). */
        fun updateCounters(counters: Counters) {
            state.update { it?.copy(counters = counters) }
        }

        fun clear() {
            state.value = null
            lastFetchedAt = 0L
        }

        suspend fun acceptConsents(documents: List<ConsentDocument>): Result<Me> =
            caller.call { account.postConsents(ConsentsBody(documents)) }.onSuccess(::replace)

        suspend fun requestDeletion(reason: String?): Result<Me> =
            caller.call { account.postDeletion(DeletionBody(confirm = "DELETE", reason = reason)) }.onSuccess(::replace)

        suspend fun cancelDeletion(): Result<Me> = caller.call { account.deleteDeletion() }.onSuccess(::replace)

        suspend fun setLocale(locale: Locale): Result<Me> =
            caller.call { account.patchMe(PatchMe(locale = locale)) }.onSuccess(::replace)

        suspend fun pause(): Result<Me> = profileChange { profile.postPause() }

        suspend fun resume(): Result<Me> = profileChange { profile.postResume() }

        suspend fun close(reason: ClosedReason): Result<Me> = profileChange { profile.postClose(CloseBody(reason)) }

        suspend fun reopen(): Result<Me> = profileChange { profile.postReopen(ReopenBody(confirm = true)) }

        suspend fun resubmit(): Result<Me> = profileChange { profile.postResubmit() }

        suspend fun requestExport(): Result<Unit> = caller.call { account.postExport() }.map { }

        suspend fun latestExport(): Result<LatestExport> = caller.call { account.getLatestExport() }

        private suspend fun profileChange(block: suspend () -> retrofit2.Response<Me>): Result<Me> =
            caller.call(block).onSuccess {
                replace(it)
                invalidation.invalidate(DataKey.Home, DataKey.Recommendations, DataKey.OwnProfile)
            }

        private fun now(): Long = android.os.SystemClock.elapsedRealtime()

        companion object {
            /** `Me` is fetched again when the app returns after this long (specs/16 section 3.3). */
            const val STALE_MILLIS = 60_000L
        }
    }
