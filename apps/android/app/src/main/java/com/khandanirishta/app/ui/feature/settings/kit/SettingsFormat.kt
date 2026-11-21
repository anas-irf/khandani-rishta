package com.khandanirishta.app.ui.feature.settings.kit

import com.khandanirishta.app.R
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.ui.messages.MessageBus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * Formatting and error helpers shared by the settings and gate screens.
 */

/** The build shown on SET-HOME, under "About" and at the end of support emails (specs/16 sections 6.24 and 6.30). */
internal fun appVersionName(config: AppConfig = AppConfig.fromBuildConfig()): String =
    "${config.versionName} (${config.versionCode})"

private val PAKISTAN_MOBILE = Regex("^\\+92(\\d{3})(\\d{7})$")

/** "+92 300 1234567" for a Pakistani number in E.164, any other number as it is (the web's `formatPhone`). */
internal fun displayPhone(e164: String): String {
    val match = PAKISTAN_MOBILE.matchEntire(e164) ?: return e164
    return "+92 " + match.groupValues[1] + " " + match.groupValues[2]
}

private val LONG_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH)

/**
 * "4 December 2026" in the member's own time zone (`Me.user.timezone`, specs/16 section 6.2), or in
 * the phone's zone when that name is unknown.
 */
internal fun longDateInZone(
    instant: Instant,
    timeZone: String?,
): String {
    val zone =
        timeZone
            ?.takeIf { it.isNotBlank() }
            ?.let { runCatching { ZoneId.of(it) }.getOrNull() }
            ?: ZoneId.systemDefault()
    return LONG_DATE.format(instant.atZone(zone))
}

/**
 * "Could not save. Please try again." for a setting that saves by itself (specs/16 sections 6.25
 * and 6.26). Limits keep their own messages; gate codes, a dead session and an unsupported build
 * are handled by the app.
 */
internal fun MessageBus.saveFailed(apiError: ApiError) {
    when (apiError.code) {
        ErrorCode.RATE_LIMITED, ErrorCode.LIMIT_REACHED, ErrorCode.COOLDOWN_ACTIVE -> this.error(apiError)
        in ErrorCode.GATE_CODES, ErrorCode.UNAUTHENTICATED, ErrorCode.UPGRADE_REQUIRED -> Unit
        else -> toast(R.string.settings_saving_failed)
    }
}
