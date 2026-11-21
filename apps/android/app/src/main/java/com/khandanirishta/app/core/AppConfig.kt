package com.khandanirishta.app.core

import com.khandanirishta.app.BuildConfig

/** Build values from local.properties or CI (specs/22 section 14). */
data class AppConfig(
    val apiBaseUrl: String,
    val webBaseUrl: String,
    val clerkPublishableKey: String,
    val sentryDsn: String,
    val versionCode: Int,
    val versionName: String,
    val isDebug: Boolean,
) {
    /** `ws://` or `wss://` URL of the realtime socket (specs/19 section 4.2). */
    val realtimeUrl: String
        get() = apiBaseUrl.trimEnd('/').replaceFirst(Regex("^http"), "ws") + "/v1/ws"

    /** A page of the web app, for legal and help content opened in a Custom Tab. */
    fun webPage(path: String): String = webBaseUrl.trimEnd('/') + "/" + path.trimStart('/')

    companion object {
        fun fromBuildConfig(): AppConfig =
            AppConfig(
                apiBaseUrl = BuildConfig.API_BASE_URL.trimEnd('/'),
                webBaseUrl = BuildConfig.WEB_BASE_URL.trimEnd('/'),
                clerkPublishableKey = BuildConfig.CLERK_PUBLISHABLE_KEY,
                sentryDsn = BuildConfig.SENTRY_DSN,
                versionCode = BuildConfig.VERSION_CODE,
                versionName = BuildConfig.VERSION_NAME,
                isDebug = BuildConfig.DEBUG,
            )
    }
}
