package com.khandanirishta.app.ui.feature.chat

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.core.data.ConnectionRepository
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.MessageKind
import com.khandanirishta.app.core.network.generated.model.MessageSender
import com.khandanirishta.app.core.push.VisibleScreen
import com.khandanirishta.app.core.realtime.ConnectivityObserver
import com.khandanirishta.app.core.realtime.RealtimeClient
import com.khandanirishta.app.core.realtime.RealtimeEvent
import com.khandanirishta.app.ui.messages.MessageBus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The three-way filter of `APP-CHATS` and its `filter` query value (specs/16 section 6.10). */
enum class ChatFilter(
    val wire: String,
) {
    ACTIVE("active"),
    ARCHIVED("archived"),
    ENDED("ended"),
}

@Immutable
data class ChatsUiState(
    val filter: ChatFilter = ChatFilter.ACTIVE,
    val list: PagedState<Connection> = PagedState(),
    val online: Boolean = true,
)

/**
 * APP-CHATS (specs/16 section 6.10): one paged list per filter, live updates (`message.new` moves a
 * row to the top, `connection.updated` and `interest.accepted` refetch), and mute and archive from
 * the item menu, both optimistic (rule G7).
 */
@HiltViewModel
@OptIn(ExperimentalCoroutinesApi::class)
class ChatsViewModel
    @Inject
    constructor(
        private val connections: ConnectionRepository,
        private val bus: MessageBus,
        private val visibleScreen: VisibleScreen,
        realtime: RealtimeClient,
        invalidation: Invalidation,
        sync: ChatSync,
        connectivity: ConnectivityObserver,
    ) : ViewModel() {
        private val paginators: Map<ChatFilter, Paginator<Connection>> =
            ChatFilter.entries.associateWith { filter ->
                Paginator<Connection>(viewModelScope, key = { it.id }) { cursor ->
                    connections.list(filter.wire, cursor)
                }
            }

        private val filter = MutableStateFlow(ChatFilter.ACTIVE)

        val state: StateFlow<ChatsUiState> =
            combine(
                filter.flatMapLatest { selected -> paginators.getValue(selected).state.map { selected to it } },
                connectivity.online,
            ) { (selected, list), online -> ChatsUiState(selected, list, online) }
                .stateIn(viewModelScope, SharingStarted.Eagerly, ChatsUiState())

        /** Filters whose first page was requested. */
        private val loaded = mutableSetOf<ChatFilter>()

        /** Filters that changed while the screen was not on display; they refetch when it returns. */
        private val stale = mutableSetOf<ChatFilter>()
        private var visible = false

        init {
            load(ChatFilter.ACTIVE)
            viewModelScope.launch { invalidation.on(DataKey.Connections).collect { listsChanged() } }
            viewModelScope.launch { realtime.events.collect { onEvent(it) } }
            viewModelScope.launch { sync.events.collect { onSync(it) } }
        }

        fun select(next: ChatFilter) {
            filter.value = next
            when {
                next !in loaded -> {
                    load(next)
                }

                next in stale -> {
                    stale -= next
                    paginators.getValue(next).refresh(showSpinner = false)
                }

                else -> {
                    paginators.getValue(next).refreshIfStale()
                }
            }
        }

        fun refresh() = paginators.getValue(filter.value).refresh()

        fun loadMore() = paginators.getValue(filter.value).loadMore()

        /** Back on screen: refetch what changed meanwhile, or the shown list after 60 seconds (rule G5). */
        fun onResume() {
            visible = true
            val current = filter.value
            stale.toList().forEach { paginators.getValue(it).refresh(showSpinner = false) }
            val refreshed = current in stale
            stale.clear()
            if (!refreshed) paginators.getValue(current).refreshIfStale()
        }

        fun onPause() {
            visible = false
        }

        private fun load(target: ChatFilter) {
            loaded += target
            paginators.getValue(target).refresh()
        }

        private fun listsChanged() {
            if (visible) {
                loaded.forEach { paginators.getValue(it).refresh(showSpinner = false) }
            } else {
                stale += loaded
            }
        }

        // -----------------------------------------------------------------------------------------
        // Live updates (16 section 6.10)
        // -----------------------------------------------------------------------------------------

        private fun onEvent(event: RealtimeEvent) {
            when (event) {
                is RealtimeEvent.MessageNew -> {
                    // No unread count for the conversation on screen: it is being read.
                    val open = visibleScreen.chatConnectionId == event.message.connectionId
                    applyMessage(event.message, countUnread = !open)
                }

                is RealtimeEvent.MessageRead -> {
                    if (event.reader == READER_ME) setUnreadZero(event.connectionId)
                }

                is RealtimeEvent.ConnectionUpdated -> {
                    updateEverywhere(event.connection.id) { event.connection }
                }

                else -> {}
            }
        }

        private fun onSync(event: ChatSyncEvent) {
            when (event) {
                is ChatSyncEvent.Changed -> {
                    updateEverywhere(event.connection.id) { event.connection }
                }

                is ChatSyncEvent.Read -> {
                    setUnreadZero(event.connectionId)
                }

                is ChatSyncEvent.Sent -> {
                    applyMessage(event.message, countUnread = false)
                }

                is ChatSyncEvent.PreviewCleared -> {
                    updateEverywhere(event.connectionId) { it.copy(lastMessagePreview = null) }
                }

                is ChatSyncEvent.Gone -> {
                    paginators.values.forEach { it.remove(event.connectionId) }
                }
            }
        }

        /**
         * A new message: preview, time and unread count change and the row moves to the top. A text
         * message brings an archived chat back (11 section 6.2 step 6); a system message clears the
         * preview and never counts as unread (11 section 6.8).
         */
        private fun applyMessage(
            message: Message,
            countUnread: Boolean,
        ) {
            val id = message.connectionId
            val isText = message.kind == MessageKind.TEXT
            val preview = if (isText) message.body?.take(PREVIEW_LENGTH) else null
            val unreadAdded = if (countUnread && isText && message.sender == MessageSender.THEM) 1 else 0
            var wasArchived = false
            paginators.values.forEach { paginator ->
                val held = paginator.state.value.items
                    .firstOrNull { it.id == id } ?: return@forEach
                if (held.isArchived) wasArchived = true
                val updated =
                    held.copy(
                        lastMessageAt = message.createdAt,
                        lastMessagePreview = preview,
                        unreadCount = held.unreadCount + unreadAdded,
                        isArchived = if (isText) false else held.isArchived,
                    )
                paginator.update { items -> listOf(updated) + items.filterNot { it.id == id } }
            }
            val inActive = paginators
                .getValue(ChatFilter.ACTIVE)
                .state.value.items
                .any { it.id == id }
            if ((isText && wasArchived) || !inActive) listsChanged()
        }

        private fun setUnreadZero(connectionId: String) =
            updateEverywhere(connectionId) { if (it.unreadCount == 0) it else it.copy(unreadCount = 0) }

        private fun updateEverywhere(
            connectionId: String,
            transform: (Connection) -> Connection,
        ) {
            paginators.values.forEach { it.updateItem(connectionId, transform) }
        }

        // -----------------------------------------------------------------------------------------
        // Item menu: mute and archive (optimistic, rule G7)
        // -----------------------------------------------------------------------------------------

        fun toggleMute(connection: Connection) {
            val target = !connection.isMuted
            updateEverywhere(connection.id) { it.copy(isMuted = target) }
            viewModelScope.launch {
                connections.setMuted(connection.id, target).onFailure { failure ->
                    updateEverywhere(connection.id) { it.copy(isMuted = !target) }
                    bus.error(failure.apiError)
                }
            }
        }

        /** The row leaves its filter at once; the other filter shows it after the refetch. */
        fun toggleArchive(connection: Connection) {
            val target = !connection.isArchived
            val from = paginators.getValue(if (target) ChatFilter.ACTIVE else ChatFilter.ARCHIVED)
            val before = from.state.value.items
            from.remove(connection.id)
            viewModelScope.launch {
                connections.setArchived(connection.id, target).onFailure { failure ->
                    from.update { before }
                    bus.error(failure.apiError)
                }
            }
        }

        private companion object {
            /** `last_message_preview` is the first 80 characters (11 section 6.2). */
            const val PREVIEW_LENGTH = 80
            const val READER_ME = "me"
        }
    }
