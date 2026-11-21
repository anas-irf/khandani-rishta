package com.khandanirishta.app.core.realtime

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.network.generated.model.Gate
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Whether the phone has a usable connection (rule G14, the offline banner). */
@Singleton
class ConnectivityObserver
    @Inject
    constructor(
        @ApplicationContext context: Context,
    ) {
        private val manager = context.getSystemService(ConnectivityManager::class.java)
        private val mutableOnline = MutableStateFlow(isOnlineNow())
        val online: StateFlow<Boolean> = mutableOnline.asStateFlow()

        private val listeners = mutableListOf<() -> Unit>()

        init {
            manager?.registerDefaultNetworkCallback(
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        mutableOnline.value = true
                        listeners.forEach { it() }
                    }

                    override fun onLost(network: Network) {
                        mutableOnline.value = isOnlineNow()
                    }

                    override fun onCapabilitiesChanged(
                        network: Network,
                        capabilities: NetworkCapabilities,
                    ) {
                        mutableOnline.value = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    }
                },
            )
        }

        fun onAvailable(listener: () -> Unit) {
            listeners += listener
        }

        private fun isOnlineNow(): Boolean {
            val capabilities = manager?.getNetworkCapabilities(manager.activeNetwork) ?: return false
            return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
    }

/** Whether the app is in the foreground, from [ProcessLifecycleOwner]. */
@Singleton
class AppForeground
    @Inject
    constructor() {
        private val mutable = MutableStateFlow(false)
        val isForeground: StateFlow<Boolean> = mutable.asStateFlow()

        /** Elapsed time when the app last went to the background, 0 when never. */
        @Volatile
        var backgroundedAt: Long = 0L
            private set

        fun start() {
            ProcessLifecycleOwner.get().lifecycle.addObserver(
                object : DefaultLifecycleObserver {
                    override fun onStart(owner: LifecycleOwner) {
                        mutable.value = true
                    }

                    override fun onStop(owner: LifecycleOwner) {
                        backgroundedAt = android.os.SystemClock.elapsedRealtime()
                        mutable.value = false
                    }
                },
            )
        }
    }

/**
 * Decides when the socket runs (specs/22 section 7): in the foreground, signed in, and with a gate
 * the server accepts; closed 30 seconds after the app goes to the background. Applies the cache
 * effects of each event (specs/17 section 7.2), and polls `Me` every 60 seconds while the socket
 * is down (11 section 6.4).
 */
@Singleton
@OptIn(ExperimentalCoroutinesApi::class)
class RealtimeCoordinator
    @Inject
    constructor(
        private val client: RealtimeClient,
        private val me: MeRepository,
        private val discovery: DiscoveryRepository,
        private val invalidation: Invalidation,
        private val foreground: AppForeground,
        private val connectivity: ConnectivityObserver,
    ) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        private var started = false
        private var pollJob: Job? = null

        fun start() {
            if (started) return
            started = true
            connectivity.onAvailable { client.onNetworkAvailable() }

            val eligible = me.me.map { it != null && it.gate !in REFUSED_GATES }.distinctUntilChanged()
            scope.launch {
                combine(
                    foreground.isForeground,
                    eligible,
                    connectivity.online,
                ) { fg, ok, online -> Triple(fg, ok, online) }
                    .mapLatest { (fg, ok, online) ->
                        when {
                            !ok -> {
                                false
                            }

                            fg && online -> {
                                true
                            }

                            fg -> {
                                false
                            }

                            else -> {
                                // Stay connected for 30 seconds after going to the background.
                                delay(BACKGROUND_GRACE)
                                false
                            }
                        }
                    }.distinctUntilChanged()
                    .collect { wanted -> client.setWanted(wanted) }
            }
            scope.launch {
                foreground.isForeground.collect { fg ->
                    if (fg) {
                        client.onForeground()
                        // Back after 60 seconds or more: fetch `Me` in the background (16 section 3.3).
                        if (me.current != null) me.refreshIfStale()
                    }
                }
            }
            scope.launch { client.events.collect(::apply) }
            scope.launch {
                combine(client.state, foreground.isForeground, eligible) { state, fg, ok ->
                    state != RealtimeState.READY && fg && ok
                }.distinctUntilChanged().collect { poll -> if (poll) startPolling() else pollJob?.cancel() }
            }
        }

        private fun startPolling() {
            pollJob?.cancel()
            pollJob =
                scope.launch {
                    while (isActive) {
                        delay(POLL_INTERVAL)
                        me.refreshIfStale(POLL_INTERVAL)
                    }
                }
        }

        private suspend fun apply(event: RealtimeEvent) {
            when (event) {
                is RealtimeEvent.Ready -> {
                    event.counters?.let(me::updateCounters)
                    if (event.afterReconnect) {
                        invalidation.invalidate(DataKey.Connections, DataKey.Interests, DataKey.Notifications)
                        me.refreshIfStale()
                    }
                }

                is RealtimeEvent.CountersChanged -> {
                    me.updateCounters(event.counters)
                }

                is RealtimeEvent.GateChanged, RealtimeEvent.AccountRefused -> {
                    me.refresh()
                }

                is RealtimeEvent.InterestReceived, is RealtimeEvent.InterestAccepted -> {
                    discovery.forgetHome()
                    invalidation.invalidate(DataKey.Interests, DataKey.Home)
                    if (event is RealtimeEvent.InterestAccepted) invalidation.invalidate(DataKey.Connections)
                    me.refresh()
                }

                is RealtimeEvent.NotificationNew -> {
                    invalidation.invalidate(DataKey.Notifications)
                }

                is RealtimeEvent.PhotoUpdated -> {
                    invalidation.invalidate(DataKey.OwnPhotos, DataKey.OwnProfile)
                }

                is RealtimeEvent.ConnectionUpdated -> {
                    invalidation.invalidate(DataKey.Connection(event.connection.id), DataKey.Connections)
                }

                else -> {}
            }
        }

        private companion object {
            const val BACKGROUND_GRACE = 30_000L
            const val POLL_INTERVAL = 60_000L
            val REFUSED_GATES = setOf(Gate.BANNED, Gate.SUSPENDED, Gate.DELETION_SCHEDULED)
        }
    }
