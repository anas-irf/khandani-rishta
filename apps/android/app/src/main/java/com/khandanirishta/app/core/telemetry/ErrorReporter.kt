package com.khandanirishta.app.core.telemetry

import android.content.Context
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.network.ApiError
import io.sentry.Sentry
import io.sentry.SentryLevel
import io.sentry.android.core.SentryAndroid
import javax.inject.Inject
import javax.inject.Singleton

/** Sends unexpected failures to Sentry (tech stack section 17). Never sends bodies or member data. */
interface ErrorReporter {
    fun report(throwable: Throwable)

    fun reportApiError(error: ApiError)
}

@Singleton
class SentryErrorReporter
    @Inject
    constructor() : ErrorReporter {
        override fun report(throwable: Throwable) {
            if (Sentry.isEnabled()) Sentry.captureException(throwable)
        }

        override fun reportApiError(error: ApiError) {
            if (!Sentry.isEnabled()) return
            Sentry.captureMessage("API ${error.status} ${error.code}", SentryLevel.ERROR) { scope ->
                error.requestId?.let { scope.setTag("request_id", it) }
                scope.setTag("api_code", error.code)
            }
        }

        companion object {
            /** Starts Sentry when a DSN is configured (specs/22 section 14). */
            fun start(
                context: Context,
                config: AppConfig,
            ) {
                if (config.sentryDsn.isBlank()) return
                SentryAndroid.init(context) { options ->
                    options.dsn = config.sentryDsn
                    options.environment = if (config.isDebug) "development" else "production"
                    options.release = "com.khandanirishta.app@${config.versionName}+${config.versionCode}"
                    // Deprecated, but still what keeps personal data out of every event.
                    @Suppress("DEPRECATION")
                    options.isSendDefaultPii = false
                    options.tracesSampleRate = if (config.isDebug) 1.0 else 0.1
                    // Screenshots and view hierarchies could show member data.
                    options.isAttachScreenshot = false
                    options.isAttachViewHierarchy = false
                }
            }
        }
    }
