package com.khandanirishta.app.core.realtime

import android.os.SystemClock
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.auth.TokenProvider
import com.khandanirishta.app.core.network.PlainClient
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.Counters
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.Interest
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.Notification
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.serialization.ApiJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

/** Server frames of specs/19 section 4.6, already decoded. Unknown frames are ignored. */
sealed interface RealtimeEvent {
    /** The socket is ready. [afterReconnect] asks the open screens to resynchronise (19 section 4.8). */
    data class Ready(
        val counters: Counters?,
        val afterReconnect: Boolean,
    ) : RealtimeEvent

    data class MessageNew(
        val message: Message,
    ) : RealtimeEvent

    data class MessageDeleted(
        val connectionId: String,
        val messageId: String,
    ) : RealtimeEvent

    data class MessageRead(
        val connectionId: String,
        val reader: String,
        val upToMessageId: String,
    ) : RealtimeEvent

    data class Typing(
        val connectionId: String,
    ) : RealtimeEvent

    data class Presence(
        val profileId: String,
        val isOnline: Boolean,
    ) : RealtimeEvent

    data class ConnectionUpdated(
        val connection: Connection,
    ) : RealtimeEvent

    data class InterestReceived(
        val interest: Interest,
    ) : RealtimeEvent

    data class InterestAccepted(
        val interest: Interest,
        val connection: Connection?,
    ) : RealtimeEvent

    data class NotificationNew(
        val notification: Notification,
    ) : RealtimeEvent

    data class CountersChanged(
        val counters: Counters,
    ) : RealtimeEvent

    data class PhotoUpdated(
        val photo: OwnPhoto,
    ) : RealtimeEvent

    data class GateChanged(
        val gate: Gate?,
    ) : RealtimeEvent

    /** The server refused this account's socket (4403): fetch `Me` and follow the gate. */
    data object AccountRefused : RealtimeEvent

    /** No token could be obtained after 4401: the session is over. */
    data object SessionEnded : RealtimeEvent
}

enum class RealtimeState { DISCONNECTED, CONNECTING, READY }

/**
 * The realtime socket of specs/19 section 4, behaving as specs/22 section 7 says: authenticate with
 * the first frame, ping every 30 seconds, treat 45 seconds without a pong as dead, and reconnect
 * with backoff and jitter. Whether it should run is decided by [RealtimeCoordinator].
 */
@Singleton
@OptIn(ExperimentalCoroutinesApi::class)
class RealtimeClient
    @Inject
    constructor(
        @PlainClient client: OkHttpClient,
        private val config: AppConfig,
        private val tokens: TokenProvider,
    ) {
        private val socketClient = client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))

        private val mutableEvents = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 128)
        val events: SharedFlow<RealtimeEvent> = mutableEvents.asSharedFlow()

        private val mutableState = MutableStateFlow(RealtimeState.DISCONNECTED)
        val state: StateFlow<RealtimeState> = mutableState.asStateFlow()

        private var wanted = false
        private var socket: WebSocket? = null
        private var generation = 0
        private var attempt = 0
        private var hadConnection = false
        private var readyAt = 0L
        private var lastPongAt = 0L
        private var lastTypingAt = 0L
        private var connectJob: Job? = null
        private var heartbeatJob: Job? = null

        /** Set by the coordinator after `4409`: wait until the app is in the foreground again. */
        private var replaced = false

        /** Starts or stops the socket. */
        fun setWanted(value: Boolean) {
            scope.launch {
                wanted = value
                if (value) {
                    if (socket == null && connectJob?.isActive != true) connect(delayMillis = 0)
                } else {
                    disconnect(code = NORMAL_CLOSE)
                }
            }
        }

        /** The app came to the foreground: a socket replaced by another device may connect again. */
        fun onForeground() {
            scope.launch { replaced = false }
        }

        /** Connectivity came back: reconnect at once instead of waiting for the backoff. */
        fun onNetworkAvailable() {
            scope.launch {
                if (wanted && socket == null && !replaced) {
                    connectJob?.cancel()
                    connect(delayMillis = 0)
                }
            }
        }

        /** Relays "typing" to the other member, at most once every 3 seconds (19 section 4.5). */
        fun sendTyping(connectionId: String) {
            scope.launch {
                val now = SystemClock.elapsedRealtime()
                if (mutableState.value != RealtimeState.READY || now - lastTypingAt < TYPING_INTERVAL) return@launch
                lastTypingAt = now
                socket?.send(
                    buildJsonObject {
                        put("type", "typing")
                        put("connection_id", connectionId)
                    }.toString(),
                )
            }
        }

        private fun connect(delayMillis: Long) {
            connectJob?.cancel()
            connectJob =
                scope.launch {
                    if (delayMillis > 0) delay(delayMillis)
                    if (!wanted || replaced || socket != null) return@launch
                    mutableState.value = RealtimeState.CONNECTING
                    val token = tokens.token(forceRefresh = false)
                    if (token == null) {
                        mutableState.value = RealtimeState.DISCONNECTED
                        return@launch
                    }
                    val id = ++generation
                    val request = Request.Builder().url(config.realtimeUrl).build()
                    socket = socketClient.newWebSocket(request, Listener(id, token))
                }
        }

        private fun disconnect(code: Int) {
            connectJob?.cancel()
            heartbeatJob?.cancel()
            socket?.close(code, null)
            socket = null
            generation++
            mutableState.value = RealtimeState.DISCONNECTED
        }

        private fun scheduleReconnect() {
            if (!wanted || replaced) return
            val base = BACKOFF.getOrElse(attempt) { BACKOFF.last() }
            attempt++
            val jitter = 1.0 + Random.nextDouble(-JITTER, JITTER)
            connect((base * jitter).toLong())
        }

        private fun onOpen(
            id: Int,
            webSocket: WebSocket,
            token: String,
        ) {
            if (id != generation) return
            webSocket.send(
                buildJsonObject {
                    put("type", "auth")
                    put("token", token)
                }.toString(),
            )
        }

        private fun onReady(data: JsonObject?) {
            mutableState.value = RealtimeState.READY
            readyAt = SystemClock.elapsedRealtime()
            lastPongAt = readyAt
            val counters = data?.get("counters")?.let { decode(Counters.serializer(), it) }
            mutableEvents.tryEmit(RealtimeEvent.Ready(counters, afterReconnect = hadConnection))
            hadConnection = true
            startHeartbeat()
        }

        private fun startHeartbeat() {
            heartbeatJob?.cancel()
            heartbeatJob =
                scope.launch {
                    var lastPingAt = SystemClock.elapsedRealtime()
                    while (isActive) {
                        delay(HEARTBEAT_TICK)
                        val now = SystemClock.elapsedRealtime()
                        // The backoff starts again once a connection has stayed ready for 30 seconds.
                        if (now - readyAt >= STABLE_AFTER) attempt = 0
                        if (now - lastPongAt >= PONG_TIMEOUT) {
                            socket?.cancel()
                            onClosed(generation, ABNORMAL_CLOSE)
                            return@launch
                        }
                        if (now - lastPingAt >= PING_INTERVAL) {
                            lastPingAt = now
                            socket?.send("""{"type":"ping"}""")
                        }
                    }
                }
        }

        private fun onClosed(
            id: Int,
            code: Int,
        ) {
            if (id != generation) return
            heartbeatJob?.cancel()
            socket = null
            generation++
            mutableState.value = RealtimeState.DISCONNECTED
            when (code) {
                NORMAL_CLOSE -> {}

                ACCOUNT_REFUSED -> {
                    wanted = false
                    mutableEvents.tryEmit(RealtimeEvent.AccountRefused)
                }

                REPLACED -> {
                    replaced = true
                }

                NOT_AUTHENTICATED -> {
                    scope.launch {
                        val fresh = tokens.token(forceRefresh = true)
                        if (fresh == null) {
                            wanted = false
                            mutableEvents.tryEmit(RealtimeEvent.SessionEnded)
                        } else {
                            scheduleReconnect()
                        }
                    }
                }

                MAX_AGE -> {
                    connect(delayMillis = 0)
                }

                TOO_MANY_FRAMES -> {
                    connect(delayMillis = TOO_MANY_FRAMES_WAIT)
                }

                else -> {
                    scheduleReconnect()
                }
            }
        }

        private fun onText(
            id: Int,
            text: String,
        ) {
            if (id != generation) return
            val frame = runCatching { ApiJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
            val type = (frame["type"] as? JsonPrimitive)?.contentOrNull ?: return
            val data = frame["data"] as? JsonObject
            if (type == "pong") {
                lastPongAt = SystemClock.elapsedRealtime()
                return
            }
            if (type == "ready") {
                onReady(data)
                return
            }
            val event = data?.let { parse(type, it) } ?: return
            mutableEvents.tryEmit(event)
        }

        private fun parse(
            type: String,
            data: JsonObject,
        ): RealtimeEvent? =
            when (type) {
                "message.new" -> {
                    data["message"]?.let { decode(Message.serializer(), it) }?.let(RealtimeEvent::MessageNew)
                }

                "message.deleted" -> {
                    RealtimeEvent.MessageDeleted(
                        connectionId = data.string("connection_id") ?: return null,
                        messageId = data.string("message_id") ?: return null,
                    )
                }

                "message.read" -> {
                    RealtimeEvent.MessageRead(
                        connectionId = data.string("connection_id") ?: return null,
                        reader = data.string("reader") ?: return null,
                        upToMessageId = data.string("up_to_message_id") ?: return null,
                    )
                }

                "typing" -> {
                    data.string("connection_id")?.let(RealtimeEvent::Typing)
                }

                "presence" -> {
                    RealtimeEvent.Presence(
                        profileId = data.string("profile_id") ?: return null,
                        isOnline = (data["is_online"] as? JsonPrimitive)?.booleanOrNull ?: return null,
                    )
                }

                "connection.updated" -> {
                    data["connection"]
                        ?.let {
                            decode(
                                Connection.serializer(),
                                it,
                            )
                        }?.let(RealtimeEvent::ConnectionUpdated)
                }

                "interest.received" -> {
                    data["interest"]?.let { decode(Interest.serializer(), it) }?.let(RealtimeEvent::InterestReceived)
                }

                "interest.accepted" -> {
                    data["interest"]?.let { decode(Interest.serializer(), it) }?.let { interest ->
                        RealtimeEvent.InterestAccepted(
                            interest,
                            data["connection"]?.let { decode(Connection.serializer(), it) },
                        )
                    }
                }

                "notification.new" -> {
                    data["notification"]
                        ?.let {
                            decode(
                                Notification.serializer(),
                                it,
                            )
                        }?.let(RealtimeEvent::NotificationNew)
                }

                "counters" -> {
                    decode(Counters.serializer(), data)?.let(RealtimeEvent::CountersChanged)
                }

                "photo.updated" -> {
                    data["photo"]?.let { decode(OwnPhoto.serializer(), it) }?.let(RealtimeEvent::PhotoUpdated)
                }

                "gate.changed" -> {
                    RealtimeEvent.GateChanged(
                        data["gate"]?.let { decode(Gate.serializer(), it) },
                    )
                }

                else -> {
                    null
                }
            }

        private fun <T> decode(
            serializer: KSerializer<T>,
            element: kotlinx.serialization.json.JsonElement,
        ): T? = runCatching { ApiJson.decodeFromJsonElement(serializer, element) }.getOrNull()

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

        private inner class Listener(
            private val id: Int,
            private val token: String,
        ) : WebSocketListener() {
            override fun onOpen(
                webSocket: WebSocket,
                response: Response,
            ) {
                scope.launch { onOpen(id, webSocket, token) }
            }

            override fun onMessage(
                webSocket: WebSocket,
                text: String,
            ) {
                scope.launch { onText(id, text) }
            }

            override fun onClosing(
                webSocket: WebSocket,
                code: Int,
                reason: String,
            ) {
                webSocket.close(NORMAL_CLOSE, null)
                scope.launch { onClosed(id, code) }
            }

            override fun onFailure(
                webSocket: WebSocket,
                t: Throwable,
                response: Response?,
            ) {
                scope.launch { onClosed(id, ABNORMAL_CLOSE) }
            }
        }

        private companion object {
            const val NORMAL_CLOSE = 1000
            const val ABNORMAL_CLOSE = 1006
            const val NOT_AUTHENTICATED = 4401
            const val ACCOUNT_REFUSED = 4403
            const val REPLACED = 4409
            const val TOO_MANY_FRAMES = 4429
            const val MAX_AGE = 4440
            const val PING_INTERVAL = 30_000L
            const val HEARTBEAT_TICK = 5_000L

            /** 45 seconds without a pong after the last ping, measured from the last pong. */
            const val PONG_TIMEOUT = PING_INTERVAL + 45_000L
            const val STABLE_AFTER = 30_000L
            const val TYPING_INTERVAL = 3_000L
            const val TOO_MANY_FRAMES_WAIT = 30_000L
            const val JITTER = 0.2
            val BACKOFF = listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L)
        }
    }
