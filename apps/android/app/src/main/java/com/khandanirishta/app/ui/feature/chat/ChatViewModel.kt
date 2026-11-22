package com.khandanirishta.app.ui.feature.chat

import android.os.Build
import androidx.compose.runtime.Immutable
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ConnectionRepository
import com.khandanirishta.app.core.data.MessageMerger
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.MessageKind
import com.khandanirishta.app.core.network.generated.model.MessageSender
import com.khandanirishta.app.core.push.NotificationFactory
import com.khandanirishta.app.core.push.VisibleScreen
import com.khandanirishta.app.core.realtime.RealtimeEvent
import com.khandanirishta.app.core.realtime.RealtimeState
import com.khandanirishta.app.ui.messages.UiText
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

/** A message as the conversation holds it: [local] is set while the server has not confirmed it. */
@Immutable
data class ChatItem(
    val message: Message,
    val local: LocalState? = null,
) {
    /** Stable while the server copy replaces the local one, so the bubble does not jump (16 section 6.11). */
    val key: String
        get() = message.clientMessageId?.takeIf { message.sender == MessageSender.ME }?.let { "c:$it" } ?: message.id
}

/** "Sending" or "Not sent"; [error] is the reason shown before "Not sent. Tap to retry". */
@Immutable
data class LocalState(
    val failed: Boolean,
    val error: UiText? = null,
)

/** The conversation itself (16 section 6.11 blocks 3 to 5). */
@Immutable
data class ChatContent(
    /** Oldest first; unconfirmed messages last, in the order they were written. */
    val items: List<ChatItem> = emptyList(),
    val messagesLoading: Boolean = true,
    val messagesError: ApiError? = null,
    val hasOlder: Boolean = false,
    val loadingOlder: Boolean = false,
    val olderFailed: Boolean = false,
    /** The "Unread messages" divider goes above this message, decided when the screen opens. */
    val dividerBeforeId: String? = null,
    /** "typing..." for 5 seconds after the last `typing` event (11 section 6.6). */
    val typing: Boolean = false,
    /** The last `presence` event about the other member, when one arrived. */
    val presence: Boolean? = null,
    /** `limit_reached` on send: the banner over the composer. */
    val dailyLimitReached: Boolean = false,
    /** `invalid_state` with `other_unavailable` on send: the composer is replaced. */
    val otherUnavailable: Boolean = false,
    /** The "Before you start" card of the first conversation (13 section 11.2). */
    val showTips: Boolean = false,
)

@Immutable
data class ChatUiState(
    val core: ConnectionCore = ConnectionCore(),
    val chat: ChatContent = ChatContent(),
)

private data class LocalMessage(
    val clientMessageId: String,
    val body: String,
    val createdAt: Instant,
    val seq: Long,
    val failed: Boolean = false,
    val error: UiText? = null,
)

/**
 * APP-CHAT (specs/16 section 6.11): history with `before=` and `after=`, live events, the polling
 * fallback while the socket is down (22 section 7), optimistic sending with a client id, read
 * marking at most once a second while on screen, typing and presence.
 */
@HiltViewModel(assistedFactory = ChatViewModel.Factory::class)
class ChatViewModel
    @AssistedInject
    constructor(
        @Assisted connectionId: String,
        connections: ConnectionRepository,
        tools: ChatTools,
        private val visibleScreen: VisibleScreen,
        private val notifications: NotificationFactory,
    ) : ConnectionViewModelBase(connectionId, connections, tools) {
        @AssistedFactory
        interface Factory {
            fun create(connectionId: String): ChatViewModel
        }

        private val chat = MutableStateFlow(ChatContent())

        val state: StateFlow<ChatUiState> =
            combine(core, chat) { core, chat -> ChatUiState(core, chat) }
                .stateIn(viewModelScope, SharingStarted.Eagerly, ChatUiState())

        /** Server messages, sorted by id (UUIDv7, so creation order; 11 section 6.2). */
        private var server: List<Message> = emptyList()
        private var locals: List<LocalMessage> = emptyList()
        private val deletedIds = mutableSetOf<String>()
        private val autoRetried = mutableSetOf<String>()
        private var localSeq = 0L

        private var messagesLoaded = false
        private var dividerDecided = false

        private var resumed = false
        private var resumedBefore = false
        private var pollJob: Job? = null
        private var typingJob: Job? = null

        private var latestVisible: String? = null
        private var readSent: String? = null
        private var readPending: String? = null
        private var readJob: Job? = null

        init {
            loadConnection()
            loadMessages()
            viewModelScope.launch { tools.realtime.events.collect { onEvent(it) } }
            viewModelScope.launch { tools.realtime.state.collect { updatePolling() } }
            viewModelScope.launch { decideTips() }
        }

        override fun retry() {
            loadConnection()
            if (!messagesLoaded) loadMessages()
        }

        fun retryMessages() = loadMessages()

        // -----------------------------------------------------------------------------------------
        // Screen visibility (22 sections 7 and 8)
        // -----------------------------------------------------------------------------------------

        /** The chat is on screen: no push for it, its notification goes, and it catches up on return. */
        fun onResume() {
            resumed = true
            visibleScreen.chatConnectionId = connectionId
            notifications.clearChat(connectionId)
            if (resumedBefore) {
                viewModelScope.launch {
                    catchUp()
                    refreshConnection()
                }
            }
            resumedBefore = true
            updatePolling()
            markReadIfDue()
        }

        fun onPause() {
            resumed = false
            if (visibleScreen.chatConnectionId == connectionId) visibleScreen.chatConnectionId = null
            updatePolling()
        }

        override fun onCleared() {
            if (visibleScreen.chatConnectionId == connectionId) visibleScreen.chatConnectionId = null
        }

        // -----------------------------------------------------------------------------------------
        // History
        // -----------------------------------------------------------------------------------------

        private fun loadMessages() {
            viewModelScope.launch {
                chat.update { it.copy(messagesLoading = true, messagesError = null) }
                connections
                    .messages(connectionId, limit = PAGE_SIZE)
                    .onSuccess { page ->
                        messagesLoaded = true
                        mergeServer(page.items)
                        chat.update { it.copy(messagesLoading = false, hasOlder = page.hasMore) }
                        decideDivider()
                    }.onFailure { failure ->
                        chat.update { it.copy(messagesLoading = false, messagesError = failure.apiError) }
                    }
            }
        }

        /** `before=<oldest id>` while `has_more` (16 section 6.11). */
        fun loadOlder() {
            val current = chat.value
            if (!current.hasOlder || current.loadingOlder) return
            val oldest = server.firstOrNull()?.id ?: return
            chat.update { it.copy(loadingOlder = true, olderFailed = false) }
            viewModelScope.launch {
                connections
                    .messages(connectionId, before = oldest, limit = PAGE_SIZE)
                    .onSuccess { page ->
                        mergeServer(page.items)
                        chat.update { it.copy(loadingOlder = false, hasOlder = page.hasMore) }
                    }.onFailure { chat.update { it.copy(loadingOlder = false, olderFailed = true) } }
            }
        }

        /** `after=<newest id>`, repeated while `has_more` (19 section 4.8 step 2, 11 section 6.4). */
        private suspend fun catchUp() {
            if (!messagesLoaded) return
            repeat(MAX_CATCH_UP_ROUNDS) {
                val after = server.lastOrNull()?.id ?: return
                val page = connections.messages(connectionId, after = after, limit = AFTER_LIMIT).getOrNull() ?: return
                mergeServer(page.items)
                if (!page.hasMore || page.items.isEmpty()) return
            }
        }

        /** Keyed by id, so a message delivered by REST and by event shows once (11 section 6.3). */
        private fun mergeServer(incoming: List<Message>) {
            if (incoming.isEmpty()) return
            incoming.filter { it.isDeleted }.forEach { deletedIds += it.id }
            // A removed message never comes back to life from an older copy.
            val fixed = incoming.map { if (it.id in deletedIds) it.copy(body = null, isDeleted = true) else it }
            server = MessageMerger.merge(server, fixed).sortedBy { it.id }
            val confirmed = fixed.filter { it.sender == MessageSender.ME }.mapNotNull { it.clientMessageId }.toSet()
            if (confirmed.isNotEmpty()) locals = locals.filterNot { it.clientMessageId in confirmed }
            publish()
        }

        private fun publish() {
            val items = server.map { ChatItem(it) } + locals.sortedBy { it.seq }.map { it.toItem() }
            chat.update { it.copy(items = items) }
        }

        private fun LocalMessage.toItem(): ChatItem =
            ChatItem(
                message =
                    Message(
                        body = body,
                        clientMessageId = clientMessageId,
                        connectionId = connectionId,
                        createdAt = createdAt,
                        id = "local:$clientMessageId",
                        isDeleted = false,
                        kind = MessageKind.TEXT,
                        sender = MessageSender.ME,
                    ),
                local = LocalState(failed = failed, error = error),
            )

        /** The first unread message from them when the screen opens (16 section 6.11 block 4). */
        private fun decideDivider() {
            if (dividerDecided || !messagesLoaded) return
            val connection = core.value.connection ?: return
            dividerDecided = true
            val unread = connection.unreadCount
            if (unread <= 0) return
            val theirs = server.filter { it.sender == MessageSender.THEM && it.kind == MessageKind.TEXT }
            if (theirs.isEmpty()) return
            val first = theirs[(theirs.size - unread).coerceAtLeast(0)]
            chat.update { it.copy(dividerBeforeId = first.id) }
        }

        override fun onConnectionApplied(connection: Connection) = decideDivider()

        override fun onReconnected() {
            viewModelScope.launch {
                catchUp()
                refreshConnection()
            }
        }

        // -----------------------------------------------------------------------------------------
        // Live events (19 section 4.6) and the fallback poll (22 section 7)
        // -----------------------------------------------------------------------------------------

        private fun onEvent(event: RealtimeEvent) {
            when (event) {
                is RealtimeEvent.MessageNew -> {
                    if (event.message.connectionId == connectionId) onMessageNew(event.message)
                }

                is RealtimeEvent.MessageDeleted -> {
                    if (event.connectionId == connectionId) markDeleted(event.messageId)
                }

                is RealtimeEvent.MessageRead -> {
                    if (event.connectionId == connectionId) onMessageRead(event)
                }

                is RealtimeEvent.Typing -> {
                    if (event.connectionId == connectionId) onTypingEvent()
                }

                is RealtimeEvent.Presence -> {
                    if (event.profileId == core.value.connection
                            ?.other
                            ?.id
                    ) {
                        chat.update { it.copy(presence = event.isOnline) }
                    }
                }

                else -> {}
            }
        }

        private fun onMessageNew(message: Message) {
            if (message.sender == MessageSender.THEM) {
                typingJob?.cancel()
                chat.update { it.copy(typing = false) }
            }
            mergeServer(listOf(message))
        }

        private fun onMessageRead(event: RealtimeEvent.MessageRead) {
            when (event.reader) {
                READER_THEM -> {
                    patchLocal { connection ->
                        val held = connection.theirLastReadMessageId
                        if (held != null && held >= event.upToMessageId) {
                            connection
                        } else {
                            connection.copy(theirLastReadMessageId = event.upToMessageId)
                        }
                    }
                }

                READER_ME -> {
                    patchLocal { it.copy(unreadCount = 0) }
                }
            }
        }

        private fun onTypingEvent() {
            if (core.value.connection?.status != ConnectionStatus.ACTIVE) return
            chat.update { it.copy(typing = true) }
            typingJob?.cancel()
            typingJob =
                viewModelScope.launch {
                    delay(TYPING_VISIBLE)
                    chat.update { it.copy(typing = false) }
                }
        }

        private fun markDeleted(messageId: String) {
            deletedIds += messageId
            val wasNewest = server.lastOrNull()?.id == messageId
            server = server.map { if (it.id == messageId) it.copy(body = null, isDeleted = true) else it }
            publish()
            if (wasNewest) tools.sync.emit(ChatSyncEvent.PreviewCleared(connectionId))
        }

        /** Poll every 15 seconds, and the connection every 60, while the socket is down and the chat is on screen. */
        private fun updatePolling() {
            val poll = resumed && tools.realtime.state.value != RealtimeState.READY
            if (!poll) {
                pollJob?.cancel()
                pollJob = null
                return
            }
            if (pollJob?.isActive == true) return
            pollJob =
                viewModelScope.launch {
                    var ticks = 0
                    while (isActive) {
                        delay(POLL_MESSAGES)
                        catchUp()
                        ticks++
                        if (ticks % CONNECTION_EVERY == 0) refreshConnection()
                    }
                }
        }

        // -----------------------------------------------------------------------------------------
        // Read state (11 section 6.5)
        // -----------------------------------------------------------------------------------------

        /** The newest message from them that is on screen. */
        fun onTheirsVisible(messageId: String) {
            val latest = latestVisible
            if (latest == null || messageId > latest) latestVisible = messageId
            markReadIfDue()
        }

        /** `POST .../read` at most once a second, never backwards, only while on screen. */
        private fun markReadIfDue() {
            val id = latestVisible ?: return
            if (!resumed) return
            val sent = readSent
            if (sent != null && id <= sent) return
            val pending = readPending
            if (pending != null && id <= pending) return
            clearUnread()
            if (readJob?.isActive == true) {
                readPending = id
                return
            }
            sendRead(id)
        }

        private fun sendRead(id: String) {
            readSent = id
            readPending = null
            readJob =
                viewModelScope.launch {
                    connections.markRead(connectionId, id)
                    delay(READ_INTERVAL)
                    val next = readPending
                    val sent = readSent
                    if (next != null && (sent == null || next > sent)) sendRead(next)
                }
        }

        /** The unread badge clears at once (rule G7), here, in the chat list and in the tab counter. */
        private fun clearUnread() {
            val connection = core.value.connection
            tools.sync.emit(ChatSyncEvent.Read(connectionId))
            if (connection == null || connection.unreadCount == 0) return
            patchLocal { it.copy(unreadCount = 0) }
            // `counters.unread_chats` counts active, unmuted connections with unread messages.
            if (!connection.isMuted && connection.status == ConnectionStatus.ACTIVE) {
                val counters = tools.me.current?.counters ?: return
                if (counters.unreadChats > 0) {
                    tools.me.updateCounters(counters.copy(unreadChats = counters.unreadChats - 1))
                }
            }
        }

        // -----------------------------------------------------------------------------------------
        // Sending (16 section 6.11 "Sending a message")
        // -----------------------------------------------------------------------------------------

        /** Trims the text; false for an empty message. The message shows at once as "Sending". */
        fun send(text: String): Boolean {
            val body = text.trim()
            if (body.isEmpty()) return false
            val clientId = UUID.randomUUID().toString()
            localSeq++
            locals = locals + LocalMessage(clientId, body, Instant.now(), localSeq)
            publish()
            post(clientId, body)
            return true
        }

        /** "Not sent. Tap to retry": the same request with the same `client_message_id`. */
        fun retrySend(item: ChatItem) {
            val clientId = item.message.clientMessageId ?: return
            retryLocal(clientId)
        }

        private fun retryLocal(clientId: String) {
            val local = locals.firstOrNull { it.clientMessageId == clientId } ?: return
            updateLocal(clientId) { it.copy(failed = false, error = null) }
            post(clientId, local.body)
        }

        /** "Delete" on a failed message: removes the local copy only. */
        fun discard(item: ChatItem) {
            val clientId = item.message.clientMessageId ?: return
            locals = locals.filterNot { it.clientMessageId == clientId }
            publish()
        }

        private fun post(
            clientId: String,
            body: String,
        ) {
            viewModelScope.launch {
                connections
                    .send(connectionId, body, clientId)
                    .onSuccess { message ->
                        mergeServer(listOf(message))
                        tools.sync.emit(ChatSyncEvent.Sent(message))
                    }.onFailure { failSend(clientId, it.apiError) }
            }
        }

        /** The error table of 16 section 6.11. Messages are never queued for automatic sending. */
        private fun failSend(
            clientId: String,
            error: ApiError,
        ) {
            when (error.code) {
                ErrorCode.RATE_LIMITED -> {
                    markFailed(clientId, UiText.of(R.string.chat_message_too_fast))
                    if (autoRetried.add(clientId)) {
                        val wait = error.detailLong("retry_after_seconds") ?: DEFAULT_RETRY_SECONDS
                        val seconds = wait.coerceAtLeast(1L)
                        viewModelScope.launch {
                            delay(seconds * MILLIS)
                            if (locals.any { it.clientMessageId == clientId && it.failed }) retryLocal(clientId)
                        }
                    }
                }

                ErrorCode.LIMIT_REACHED -> {
                    chat.update { it.copy(dailyLimitReached = true) }
                    markFailed(clientId, null)
                }

                ErrorCode.VALIDATION_FAILED -> {
                    markFailed(clientId, UiText.Raw(error.fields.firstOrNull()?.message ?: error.message))
                }

                ErrorCode.CONNECTION_ENDED -> {
                    markFailed(clientId, null)
                    refreshConnection()
                }

                ErrorCode.INVALID_STATE -> {
                    markFailed(clientId, null)
                    if (error.detailString("status") == OTHER_UNAVAILABLE) {
                        chat.update { it.copy(otherUnavailable = true) }
                    }
                    refreshConnection()
                }

                // The gate router refetches `Me`; a closed profile then disables the composer.
                ErrorCode.PROFILE_NOT_ACTIVE -> {
                    markFailed(clientId, null)
                }

                else -> {
                    markFailed(clientId, null)
                    if (!error.isNetwork) tools.bus.error(error)
                }
            }
        }

        private fun markFailed(
            clientId: String,
            error: UiText?,
        ) = updateLocal(clientId) { it.copy(failed = true, error = error) }

        private fun updateLocal(
            clientId: String,
            transform: (LocalMessage) -> LocalMessage,
        ) {
            locals = locals.map { if (it.clientMessageId == clientId) transform(it) else it }
            publish()
        }

        /** A `typing` frame while the member types; the client sends at most one every 3 seconds. */
        fun onTyping() {
            if (core.value.connection?.status == ConnectionStatus.ACTIVE) tools.realtime.sendTyping(connectionId)
        }

        /** "Copied", where the system does not confirm a copy itself (before Android 13). */
        fun onCopied() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) tools.bus.toast(R.string.chat_message_copied)
        }

        // -----------------------------------------------------------------------------------------
        // Removing a message (11 section 6.7)
        // -----------------------------------------------------------------------------------------

        fun askRemove(item: ChatItem) = openDialog(ConnectionDialog.RemoveMessage(item.message.id))

        fun removeMessage() {
            val dialog = core.value.dialog as? ConnectionDialog.RemoveMessage ?: return
            if (core.value.busy != null) return
            setBusy(ConnectionAction.REMOVE_MESSAGE)
            viewModelScope.launch {
                connections
                    .deleteMessage(connectionId, dialog.messageId)
                    .onSuccess { message ->
                        mergeServer(listOf(message))
                        markDeleted(message.id)
                    }.onFailure { failure ->
                        val error = failure.apiError
                        if (error.code == ErrorCode.INVALID_STATE) {
                            tools.bus.toast(R.string.chat_message_remove_too_late)
                        } else {
                            tools.bus.error(error)
                        }
                    }
                setBusy(null)
                setDialog(null)
            }
        }

        // -----------------------------------------------------------------------------------------
        // First-chat tips (13 section 11.2): once per member, in the first conversation opened
        // -----------------------------------------------------------------------------------------

        private suspend fun decideTips() {
            val profileId = tools.me.current
                ?.profile
                ?.id ?: return
            val keys = tools.preferences.dismissed.first()
            if (tipsDismissedKey(profileId) in keys) return
            val prefix = tipsFirstPrefix(profileId)
            val first = keys.firstOrNull { it.startsWith(prefix) }
            when (first) {
                null -> {
                    tools.preferences.dismiss(prefix + connectionId)
                    chat.update { it.copy(showTips = true) }
                }

                prefix + connectionId -> {
                    chat.update { it.copy(showTips = true) }
                }

                else -> {}
            }
        }

        fun dismissTips() {
            chat.update { it.copy(showTips = false) }
            val profileId = tools.me.current
                ?.profile
                ?.id ?: return
            viewModelScope.launch { tools.preferences.dismiss(tipsDismissedKey(profileId)) }
        }

        private fun tipsFirstPrefix(profileId: String) = "chat_first_tips:$profileId:"

        private fun tipsDismissedKey(profileId: String) = "chat_first_tips_dismissed:$profileId"

        private companion object {
            const val PAGE_SIZE = 30L
            const val AFTER_LIMIT = 100L
            const val MAX_CATCH_UP_ROUNDS = 50
            const val POLL_MESSAGES = 15_000L
            const val CONNECTION_EVERY = 4
            const val TYPING_VISIBLE = 5_000L
            const val READ_INTERVAL = 1_000L
            const val DEFAULT_RETRY_SECONDS = 5L
            const val MILLIS = 1_000L
            const val READER_THEM = "them"
            const val READER_ME = "me"
            const val OTHER_UNAVAILABLE = "other_unavailable"
        }
    }
