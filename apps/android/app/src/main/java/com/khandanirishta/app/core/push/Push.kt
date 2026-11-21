package com.khandanirishta.app.core.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.khandanirishta.app.MainActivity
import com.khandanirishta.app.R
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.auth.AuthSession
import com.khandanirishta.app.core.data.NotificationRepository
import com.khandanirishta.app.core.datastore.AppPreferences
import com.khandanirishta.app.core.realtime.RealtimeClient
import com.khandanirishta.app.core.realtime.RealtimeState
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/** Notification channels of specs/14 section 4.2, created at start. */
object NotificationChannels {
    const val MESSAGES = "messages"
    const val INTERESTS = "interests"
    const val ACTIVITY = "activity"
    const val ACCOUNT = "account"

    fun create(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    MESSAGES,
                    context.getString(R.string.channel_messages),
                    NotificationManager.IMPORTANCE_HIGH,
                ),
                NotificationChannel(
                    INTERESTS,
                    context.getString(R.string.channel_interests),
                    NotificationManager.IMPORTANCE_HIGH,
                ),
                NotificationChannel(
                    ACTIVITY,
                    context.getString(R.string.channel_activity),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ),
                NotificationChannel(
                    ACCOUNT,
                    context.getString(R.string.channel_account),
                    NotificationManager.IMPORTANCE_HIGH,
                ),
            ),
        )
    }
}

/** What the app is showing, so a push for the screen on display is not shown (specs/22 section 8). */
@Singleton
class VisibleScreen
    @Inject
    constructor() {
        /** The connection whose chat is on screen, if any. */
        @Volatile
        var chatConnectionId: String? = null
    }

/** Push data keys that the app copies into the tap intent (specs/14 section 4.1). */
object PushKeys {
    const val TYPE = "type"
    const val TARGET = "target"
    val PARAMS =
        listOf(
            "notification_id",
            "connection_id",
            "interest_id",
            "profile_id",
            "saved_search_id",
            "field",
            "count",
            "stage",
        )

    /** Marks an intent that came from a notification tap. */
    const val FROM_PUSH = "from_push"
}

/** Builds the visible notification from a data message, with fixed private text (specs/14 section 4.2). */
@Singleton
class NotificationFactory
    @Inject
    constructor(
        @param:ApplicationContext private val context: Context,
    ) {
        fun show(data: Map<String, String>) {
            val type = data[PushKeys.TYPE].orEmpty()
            val spec = spec(type, data)
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED &&
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ) {
                return
            }
            val intent =
                Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra(PushKeys.FROM_PUSH, true)
                    putExtra(PushKeys.TYPE, type)
                    putExtra(PushKeys.TARGET, data[PushKeys.TARGET].orEmpty())
                    PushKeys.PARAMS.forEach { key -> data[key]?.takeIf { it.isNotEmpty() }?.let { putExtra(key, it) } }
                }
            val pending =
                PendingIntent.getActivity(
                    context,
                    spec.tag.hashCode(),
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            val title = context.getString(R.string.app_name)
            val publicVersion =
                NotificationCompat
                    .Builder(context, spec.channel)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle(title)
                    .setContentText(context.getString(R.string.push_public_text))
                    .build()
            val notification =
                NotificationCompat
                    .Builder(context, spec.channel)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setColor(ContextCompat.getColor(context, R.color.brand_primary))
                    .setContentTitle(title)
                    .setContentText(context.getString(spec.body))
                    .setAutoCancel(true)
                    .setContentIntent(pending)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setPublicVersion(publicVersion)
                    .setPriority(
                        if (spec.channel == NotificationChannels.ACTIVITY) {
                            NotificationCompat.PRIORITY_DEFAULT
                        } else {
                            NotificationCompat.PRIORITY_HIGH
                        },
                    ).build()
            NotificationManagerCompat.from(context).notify(spec.tag, 0, notification)
        }

        /** Clears the chat notification of a connection when its chat opens (14 section 4.5). */
        fun clearChat(connectionId: String) {
            NotificationManagerCompat.from(context).cancel("msg_$connectionId", 0)
        }

        private data class Spec(
            val channel: String,
            val body: Int,
            val tag: String,
        )

        private fun spec(
            type: String,
            data: Map<String, String>,
        ): Spec {
            val connection = data["connection_id"].orEmpty()
            val reminder = data["count"] != null && type == "interest_received" && data["target"] == "APP-INTERESTS"
            return when (type) {
                "message" -> {
                    Spec(NotificationChannels.MESSAGES, R.string.push_message, "msg_$connection")
                }

                "interest_received" -> {
                    if (reminder) {
                        Spec(NotificationChannels.INTERESTS, R.string.push_interest_reminder, "interest_reminder")
                    } else {
                        Spec(NotificationChannels.INTERESTS, R.string.push_interest_received, "interest")
                    }
                }

                "interest_accepted" -> {
                    Spec(NotificationChannels.INTERESTS, R.string.push_interest_accepted, "accepted_$connection")
                }

                "photo_request_received" -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_photo_request_received, "photo_request")
                }

                "photo_request_granted" -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_photo_request_granted, "photo_granted")
                }

                "contact_shared" -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_contact_shared, "contact_$connection")
                }

                "stage_proposed" -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_stage_proposed, "stage_$connection")
                }

                "stage_confirmed" -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_stage_confirmed, "stage_$connection")
                }

                "new_matches" -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_new_matches, "matches")
                }

                "profile_views_summary" -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_profile_views, "views")
                }

                "profile_approved" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_profile_approved, "account")
                }

                "profile_changes_requested" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_profile_changes, "account")
                }

                "photo_rejected" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_photo_rejected, "account_photo")
                }

                "text_rejected" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_text_rejected, "account_text")
                }

                "verification_approved" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_verification_approved, "account_verify")
                }

                "verification_rejected" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_verification_rejected, "account_verify")
                }

                "account_warning" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_account_warning, "account_warning")
                }

                "announcement" -> {
                    Spec(NotificationChannels.ACCOUNT, R.string.push_announcement, "announcement")
                }

                else -> {
                    Spec(NotificationChannels.ACTIVITY, R.string.push_public_text, "other_$type")
                }
            }
        }
    }

/**
 * Registers this device's FCM token with the API after sign-in and at every start with a session,
 * and removes it at sign-out (specs/14 section 4.4). Does nothing without Firebase configured.
 */
@Singleton
class PushRegistrar
    @Inject
    constructor(
        @param:ApplicationContext private val context: Context,
        private val notifications: NotificationRepository,
        private val preferences: AppPreferences,
        private val config: AppConfig,
    ) {
        val isAvailable: Boolean get() = FirebaseApp.getApps(context).isNotEmpty()

        suspend fun register() {
            val token = currentToken() ?: return
            register(token)
        }

        suspend fun register(token: String) {
            preferences.setPushToken(token)
            notifications.registerDevice(
                token = token,
                appVersion = "${config.versionName} (${config.versionCode})",
                deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".take(MAX_MODEL),
            )
        }

        /** `DELETE /v1/me/devices/{push_token}`; failures are ignored (06 section 10.1). */
        suspend fun unregister() {
            val token = preferences.pushToken() ?: return
            notifications.removeDevice(token)
        }

        private suspend fun currentToken(): String? {
            if (!isAvailable) return null
            return suspendCancellableCoroutine { continuation ->
                FirebaseMessaging
                    .getInstance()
                    .token
                    .addOnSuccessListener { continuation.resume(it) }
                    .addOnFailureListener { continuation.resume(null) }
            }
        }

        private companion object {
            const val MAX_MODEL = 100
        }
    }

/** Receives FCM data messages and new tokens (specs/22 section 8). */
@AndroidEntryPoint
class KhandaniMessagingService : FirebaseMessagingService() {
    @Inject lateinit var factory: NotificationFactory

    @Inject lateinit var registrar: PushRegistrar

    @Inject lateinit var auth: AuthSession

    @Inject lateinit var realtime: RealtimeClient

    @Inject lateinit var visibleScreen: VisibleScreen

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        if (!auth.isSignedIn) return
        scope.launch { registrar.register(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data.isEmpty() || !auth.isSignedIn) return
        if (data[PushKeys.TYPE] == "message") {
            // A message push while the socket is open shows nothing (14 section 4.3).
            if (realtime.state.value == RealtimeState.READY) return
            if (visibleScreen.chatConnectionId == data["connection_id"]) return
        }
        factory.show(data)
    }
}

/** Whether notifications are allowed for this app (for the reminder on `SET-NOTIFS`). */
fun notificationsAllowed(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()
