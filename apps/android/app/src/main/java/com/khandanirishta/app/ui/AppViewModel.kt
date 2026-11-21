package com.khandanirishta.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil3.SingletonImageLoader
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.auth.AuthSession
import com.khandanirishta.app.core.data.AppReleaseRepository
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.core.datastore.AppPreferences
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ApiSignal
import com.khandanirishta.app.core.network.ApiSignals
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.AppRelease
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.push.PushRegistrar
import com.khandanirishta.app.core.realtime.RealtimeClient
import com.khandanirishta.app.core.realtime.RealtimeEvent
import com.khandanirishta.app.core.tracking.Tracker
import com.khandanirishta.app.ui.navigation.DeepLink
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

/** What the root of the app shows (specs/22 section 3.2). */
sealed interface RootState {
    /** The splash: waiting for Clerk, the update check or `GET /v1/me`. */
    data object Starting : RootState

    /** No Clerk publishable key in this build. */
    data object NotConfigured : RootState

    /** Clerk could not start. */
    data object ClerkFailed : RootState

    /** This build is no longer supported (GATE-UPGRADE). */
    data class Upgrade(
        val downloadUrl: String?,
        val versionName: String?,
        val releaseNotes: String?,
    ) : RootState

    data object SignedOut : RootState

    /** `GET /v1/me` failed at start: G3 with "Try again"; never guess a gate. */
    data class StartError(
        val error: ApiError,
    ) : RootState

    data class Ready(
        val me: Me,
        val reference: Reference,
    ) : RootState
}

@HiltViewModel
class AppViewModel
    @Inject
    constructor(
        @param:ApplicationContext private val context: android.content.Context,
        private val config: AppConfig,
        private val auth: AuthSession,
        private val me: MeRepository,
        private val reference: ReferenceRepository,
        private val profile: ProfileRepository,
        private val discovery: DiscoveryRepository,
        private val releases: AppReleaseRepository,
        private val realtime: RealtimeClient,
        private val push: PushRegistrar,
        private val tracker: Tracker,
        private val preferences: AppPreferences,
        signals: ApiSignals,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow<RootState>(RootState.Starting)
        val state: StateFlow<RootState> = mutableState.asStateFlow()

        /** A deep link waiting for the gate host (16 section 4.2: applied after routing). */
        private val mutablePendingLink = MutableStateFlow<DeepLink?>(null)
        val pendingLink: StateFlow<DeepLink?> = mutablePendingLink.asStateFlow()

        /** A newer optional build, for the banner on `APP-HOME` (22 section 13). */
        private val mutableOptionalUpdate = MutableStateFlow<AppRelease?>(null)
        val optionalUpdate: StateFlow<AppRelease?> = mutableOptionalUpdate.asStateFlow()

        /** Set when the gate moved from review to `ok`, for the "approved and live" toast. */
        private val mutableApproved = MutableStateFlow(false)
        val approved: StateFlow<Boolean> = mutableApproved.asStateFlow()

        private var loadJob: Job? = null
        private var started = false

        init {
            viewModelScope.launch { start() }
            viewModelScope.launch {
                signals.flow.collect { signal ->
                    when (signal) {
                        is ApiSignal.GateCode -> {
                            me.refresh()
                        }

                        ApiSignal.SessionExpired -> {
                            signOut()
                        }

                        is ApiSignal.UpgradeRequired -> {
                            mutableState.value =
                                RootState.Upgrade(signal.downloadUrl, versionName = null, releaseNotes = null)
                        }
                    }
                }
            }
            viewModelScope.launch {
                realtime.events.collect { event ->
                    when (event) {
                        RealtimeEvent.SessionEnded -> signOut()
                        else -> Unit
                    }
                }
            }
            viewModelScope.launch {
                var previousGate: Gate? = null
                me.me.collect { latest ->
                    val current = mutableState.value
                    if (latest != null && current is RootState.Ready) {
                        if (previousGate == Gate.PENDING_REVIEW && latest.gate == Gate.OK) mutableApproved.value = true
                        mutableState.value = current.copy(me = latest)
                    }
                    previousGate = latest?.gate
                }
            }
        }

        private suspend fun start() {
            if (config.clerkPublishableKey.isBlank()) {
                mutableState.value = RootState.NotConfigured
                return
            }
            // The release check needs no session, so it runs while Clerk starts.
            val release = viewModelScope.async { latestRelease() }
            val initialised = withTimeoutOrNull(CLERK_TIMEOUT) { auth.isInitialized.filter { it }.first() }
            if (initialised == null) {
                release.cancel()
                mutableState.value = RootState.ClerkFailed
                return
            }
            applyRelease(release.await())
            if (mutableState.value is RootState.Upgrade) return
            started = true
            auth.signedIn.collect { signedIn ->
                if (signedIn) {
                    load()
                } else {
                    clearLocal()
                    mutableState.value = RootState.SignedOut
                }
            }
        }

        /** `GET /v1/meta/app-release` at start (22 section 13). Failures never block the app. */
        private suspend fun latestRelease(): AppRelease? =
            withTimeoutOrNull(RELEASE_TIMEOUT) { releases.latest().getOrNull() }

        /** A release below the minimum blocks the app; a newer one shows the banner once a day. */
        private suspend fun applyRelease(release: AppRelease?) {
            if (release == null) return
            if (release.minSupportedVersionCode > config.versionCode) {
                mutableState.value = RootState.Upgrade(release.downloadUrl, release.versionName, release.releaseNotes)
                return
            }
            if (release.versionCode > config.versionCode) {
                val last = preferences.lastUpdatePromptAt()
                if (System.currentTimeMillis() - last >= DAY) mutableOptionalUpdate.value = release
            }
        }

        fun dismissUpdateBanner() {
            mutableOptionalUpdate.value = null
            viewModelScope.launch { preferences.setLastUpdatePromptAt(System.currentTimeMillis()) }
        }

        /** Loads reference data and `Me`, then routes by the gate. */
        fun load() {
            loadJob?.cancel()
            loadJob =
                viewModelScope.launch {
                    if (mutableState.value !is RootState.Ready) mutableState.value = RootState.Starting
                    val referenceResult = async { reference.load() }
                    val meResult = me.refresh()
                    val ref = referenceResult.await()
                    val loaded = meResult.getOrNull()
                    val data = ref.getOrNull()
                    when {
                        loaded != null && data != null -> {
                            mutableState.value = RootState.Ready(loaded, data)
                            launch { push.register() }
                            launch { profile.load() }
                        }

                        meResult.isFailure -> {
                            mutableState.value =
                                RootState.StartError(meResult.exceptionOrNull()!!.apiError)
                        }

                        else -> {
                            mutableState.value = RootState.StartError(ref.exceptionOrNull()!!.apiError)
                        }
                    }
                }
        }

        fun retry() {
            if (!started) {
                viewModelScope.launch { start() }
            } else {
                load()
            }
        }

        /** Retries only when the start failed, for example after network access was granted. */
        fun retryIfFailed() {
            when (mutableState.value) {
                is RootState.StartError -> load()
                RootState.ClerkFailed -> retry()
                else -> Unit
            }
        }

        fun consumeApproved() {
            mutableApproved.value = false
        }

        fun openLink(link: DeepLink) {
            mutablePendingLink.value = link
        }

        fun consumeLink() {
            mutablePendingLink.value = null
        }

        /** A shared profile code: resolve it, then open the profile (16 section 4.1). */
        suspend fun resolveProfileCode(code: String): Result<DeepLink> =
            discovery.profileIdByCode(code).map { DeepLink.Screen(Tab.HOME, listOf(Profile(it))) }

        /**
         * Sign-out in the order of specs/06 section 10.1: close the socket, remove this device's
         * push token, sign out of Clerk, then clear everything held about the member.
         */
        fun signOut() {
            viewModelScope.launch {
                realtime.setWanted(false)
                // Last events go out while the token still works; a slow network must not hold sign-out.
                withTimeoutOrNull(FLUSH_TIMEOUT) { tracker.flushAll() }
                push.unregister()
                auth.signOut()
                clearLocal()
                mutableState.update { RootState.SignedOut }
            }
        }

        private suspend fun clearLocal() {
            me.clear()
            profile.clear()
            discovery.forgetHome()
            discovery.searchSession.value = null
            tracker.clear()
            preferences.clearMemberFlags()
            SingletonImageLoader.get(context).let { loader ->
                loader.memoryCache?.clear()
                loader.diskCache?.clear()
            }
        }

        private companion object {
            const val CLERK_TIMEOUT = 20_000L
            const val RELEASE_TIMEOUT = 5_000L
            const val FLUSH_TIMEOUT = 3_000L
            const val DAY = 24 * 60 * 60 * 1000L
        }
    }
