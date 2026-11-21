package com.khandanirishta.app.core.tracking

import com.khandanirishta.app.core.auth.AuthSession
import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.AccountApi
import com.khandanirishta.app.core.network.generated.model.EventsBody
import com.khandanirishta.app.core.realtime.AppForeground
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Client events (specs/20 section 8.3): buffered in memory and sent to `POST /v1/events` when 20
 * have collected, every 30 seconds, and when the app goes to the background. Failures are dropped.
 * Only events named in the specs are sent (07 section 17), and never personal data.
 */
@Singleton
class Tracker
    @Inject
    constructor(
        private val api: AccountApi,
        private val caller: ApiCaller,
        private val auth: AuthSession,
        foreground: AppForeground,
    ) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val lock = Any()

        /** Guarded by [lock]; filled synchronously so a flush right after [track] includes the event. */
        private val buffer = ArrayDeque<JsonObject>()

        init {
            scope.launch {
                while (isActive) {
                    delay(FLUSH_INTERVAL)
                    flush()
                }
            }
            scope.launch {
                foreground.isForeground
                    .drop(1)
                    .filter { !it }
                    .collect { flush() }
            }
        }

        fun track(
            name: String,
            vararg properties: Pair<String, Any?>,
        ) {
            if (!auth.isSignedIn || !NAME.matches(name)) return
            val event =
                buildJsonObject {
                    put("name", name)
                    put("occurred_at", Instant.now().toString())
                    if (properties.isNotEmpty()) {
                        put(
                            "properties",
                            buildJsonObject {
                                properties.take(MAX_PROPERTIES).forEach { (key, value) ->
                                    when (value) {
                                        is String -> put(key, value.take(MAX_STRING))
                                        is Number -> put(key, JsonPrimitive(value))
                                        is Boolean -> put(key, value)
                                        else -> Unit
                                    }
                                }
                            },
                        )
                    }
                }
            val full =
                synchronized(lock) {
                    buffer.addLast(event)
                    buffer.size >= MAX_BUFFER
                }
            if (full) scope.launch { flush() }
        }

        /**
         * Sends everything still buffered. Called just before sign-out, while the session token is
         * still valid, so events such as `onboarding_signed_out` are not lost.
         */
        suspend fun flushAll() {
            do {
                val sent = flush()
            } while (sent)
        }

        /** Drops anything not yet sent, after sign-out. */
        fun clear() {
            synchronized(lock) { buffer.clear() }
        }

        /** Sends one batch; false when there was nothing to send or nobody is signed in. */
        private suspend fun flush(): Boolean {
            if (!auth.isSignedIn) return false
            val batch = synchronized(lock) { List(minOf(MAX_BUFFER, buffer.size)) { buffer.removeFirst() } }
            if (batch.isEmpty()) return false
            caller.call { api.postEvents(EventsBody(batch)) }
            return true
        }

        private companion object {
            const val MAX_BUFFER = 20
            const val MAX_PROPERTIES = 10
            const val MAX_STRING = 100
            const val FLUSH_INTERVAL = 30_000L
            val NAME = Regex("^[a-z][a-z0-9_]{2,49}$")
        }
    }
