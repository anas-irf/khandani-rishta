package com.khandanirishta.app.ui.feature.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.NotificationRepository
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Notification
import com.khandanirishta.app.core.realtime.ConnectivityObserver
import com.khandanirishta.app.core.realtime.RealtimeClient
import com.khandanirishta.app.core.realtime.RealtimeEvent
import com.khandanirishta.app.ui.messages.MessageBus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class NotificationsUiState(
    /** "Mark all as read" is waiting for the server. */
    val markingAll: Boolean = false,
    /** Buttons that need the network are disabled while offline (rule G14). */
    val online: Boolean = true,
)

/**
 * APP-NOTIFS (specs/16 section 6.15, 14 section 3): the in-app feed. Marking one row read is
 * optimistic (rule G7); "Mark all as read" waits for the server.
 */
@HiltViewModel
class NotificationsViewModel
    @Inject
    constructor(
        private val notifications: NotificationRepository,
        private val me: MeRepository,
        private val bus: MessageBus,
        realtime: RealtimeClient,
        connectivity: ConnectivityObserver,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(NotificationsUiState())
        val state: StateFlow<NotificationsUiState> = mutableState.asStateFlow()

        private val paginator =
            Paginator<Notification>(viewModelScope, key = { it.id }) { cursor -> notifications.list(cursor) }
        val list: StateFlow<PagedState<Notification>> = paginator.state

        init {
            paginator.refresh()
            // `notification.new` adds the row at the top at once (16 section 6.15).
            viewModelScope.launch {
                realtime.events.filterIsInstance<RealtimeEvent.NotificationNew>().collect { event ->
                    if (!paginator.state.value.isLoading) paginator.prepend(event.notification)
                }
            }
            // The same event, a socket reconnect and other changes invalidate the feed: refetch quietly.
            viewModelScope.launch {
                invalidation.on(DataKey.Notifications).collect { paginator.refresh(showSpinner = false) }
            }
            viewModelScope.launch {
                connectivity.online.collect { online -> mutableState.update { it.copy(online = online) } }
            }
        }

        fun refresh() = paginator.refresh()

        fun loadMore() = paginator.loadMore()

        /** The screen is shown again: refetch after 60 seconds (rule G5). */
        fun onResume() = paginator.refreshIfStale()

        /** Tapping a row marks it read at once; on failure the dot comes back and a toast explains. */
        fun markRead(item: Notification) {
            if (item.isRead) return
            paginator.updateItem(item.id) { it.copy(isRead = true) }
            // The bell badge goes down with the dot (the web does the same).
            me.current?.counters?.let { counters ->
                val left = (counters.unreadNotifications - 1).coerceAtLeast(0)
                me.updateCounters(counters.copy(unreadNotifications = left))
            }
            viewModelScope.launch {
                notifications.markRead(listOf(item.id)).onFailure { error ->
                    paginator.updateItem(item.id) { it.copy(isRead = false) }
                    me.refresh()
                    bus.error(error.apiError)
                }
            }
        }

        /** "Mark all as read": every dot and the bell badge clear when the server confirms. */
        fun markAllRead() {
            if (mutableState.value.markingAll) return
            mutableState.update { it.copy(markingAll = true) }
            viewModelScope.launch {
                notifications
                    .markAllRead()
                    .onSuccess {
                        paginator.update { items -> items.map { if (it.isRead) it else it.copy(isRead = true) } }
                    }.onFailure { bus.error(it.apiError) }
                mutableState.update { it.copy(markingAll = false) }
            }
        }
    }
