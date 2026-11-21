package com.khandanirishta.app

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.clerk.api.Clerk
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.network.PlainClient
import com.khandanirishta.app.core.push.NotificationChannels
import com.khandanirishta.app.core.realtime.AppForeground
import com.khandanirishta.app.core.realtime.RealtimeCoordinator
import com.khandanirishta.app.core.telemetry.SentryErrorReporter
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath
import javax.inject.Inject

/** Hilt entry; starts Sentry, Clerk, the notification channels and the realtime coordinator. */
@HiltAndroidApp
class KhandaniApplication :
    Application(),
    SingletonImageLoader.Factory {
    @Inject lateinit var config: AppConfig

    @Inject lateinit var foreground: AppForeground

    @Inject lateinit var realtime: RealtimeCoordinator

    @Inject
    @PlainClient
    lateinit var plainClient: OkHttpClient

    override fun onCreate() {
        super.onCreate()
        SentryErrorReporter.start(this, config)
        if (config.clerkPublishableKey.isNotBlank()) {
            Clerk.initialize(this, config.clerkPublishableKey)
        }
        NotificationChannels.create(this)
        foreground.start()
        realtime.start()
    }

    /**
     * Coil for member photos: presigned URLs need no token, so the plain client is used. The disk
     * cache lives in the app's private cache directory, capped at 100 MB, and is cleared at
     * sign-out (specs/22 section 9).
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader
            .Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { plainClient })) }
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, MEMORY_SHARE).build() }
            .diskCache {
                DiskCache
                    .Builder()
                    .directory(cacheDir.resolve("member_photos").toOkioPath())
                    .maxSizeBytes(DISK_CACHE_BYTES)
                    .build()
            }.crossfade(true)
            .build()

    private companion object {
        const val MEMORY_SHARE = 0.25
        const val DISK_CACHE_BYTES = 100L * 1024 * 1024
    }
}
