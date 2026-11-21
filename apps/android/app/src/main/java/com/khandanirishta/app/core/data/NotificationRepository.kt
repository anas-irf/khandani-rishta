package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.NotificationsApi
import com.khandanirishta.app.core.network.generated.model.DeviceBody
import com.khandanirishta.app.core.network.generated.model.DevicePlatform
import com.khandanirishta.app.core.network.generated.model.Notification
import com.khandanirishta.app.core.network.generated.model.NotificationPreferences
import com.khandanirishta.app.core.network.generated.model.PreferencesBody
import com.khandanirishta.app.core.network.generated.model.ReadBody
import javax.inject.Inject
import javax.inject.Singleton

/** The in-app feed, notification preferences and push devices (specs/14, 15 section 14). */
@Singleton
class NotificationRepository
    @Inject
    constructor(
        private val api: NotificationsApi,
        private val caller: ApiCaller,
        private val me: MeRepository,
    ) {
        suspend fun list(cursor: String?): Result<Page<Notification>> =
            caller
                .call {
                    api.listNotifications(limit = DiscoveryRepository.PAGE, cursor = cursor)
                }.map { Page(it.items, it.nextCursor) }

        suspend fun markRead(ids: List<String>): Result<Unit> =
            caller.call { api.markNotificationsRead(ReadBody(ids = ids)) }.onSuccess { me.refreshIfStale(0) }

        suspend fun markAllRead(): Result<Unit> =
            caller.call { api.markNotificationsRead(ReadBody(all = true)) }.onSuccess { me.refreshIfStale(0) }

        suspend fun preferences(): Result<NotificationPreferences> = caller.call { api.getNotificationPreferences() }

        suspend fun savePreferences(value: NotificationPreferences): Result<NotificationPreferences> =
            caller.call {
                api.putNotificationPreferences(
                    PreferencesBody(
                        pushInterests = value.pushInterests,
                        pushMessages = value.pushMessages,
                        pushPhotoRequests = value.pushPhotoRequests,
                        pushProfileViews = value.pushProfileViews,
                        pushMatches = value.pushMatches,
                        emailInterests = value.emailInterests,
                        emailMessages = value.emailMessages,
                        emailMatchDigest = value.emailMatchDigest,
                        emailAnnouncements = value.emailAnnouncements,
                        quietHoursStart = value.quietHoursStart,
                        quietHoursEnd = value.quietHoursEnd,
                    ),
                )
            }

        suspend fun registerDevice(
            token: String,
            appVersion: String,
            deviceModel: String,
        ): Result<Unit> =
            caller.call {
                api.registerDevice(
                    DeviceBody(
                        platform = DevicePlatform.ANDROID,
                        pushToken = token,
                        appVersion = appVersion,
                        deviceModel = deviceModel,
                    ),
                )
            }

        suspend fun removeDevice(token: String): Result<Unit> = caller.call { api.removeDevice(token) }
    }
