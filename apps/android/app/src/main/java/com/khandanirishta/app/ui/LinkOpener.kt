package com.khandanirishta.app.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri
import com.khandanirishta.app.core.AppConfig

/** Opens web pages in a Custom Tab, and mail, phone and WhatsApp links in their apps. */
@Stable
class LinkOpener(
    private val context: Context,
    private val config: AppConfig,
    /** The bars of a Custom Tab take the page's own colour. */
    private val barColor: Int,
) {
    /** A public page of the web app: legal, help and safety content (specs/22 section 3.1). */
    fun webPage(path: String) = url(config.webPage(path))

    fun url(url: String) {
        val intent =
            CustomTabsIntent
                .Builder()
                .setColorScheme(CustomTabsIntent.COLOR_SCHEME_LIGHT)
                .setDefaultColorSchemeParams(
                    CustomTabColorSchemeParams
                        .Builder()
                        .setToolbarColor(barColor)
                        .setNavigationBarColor(barColor)
                        .build(),
                ).setShowTitle(true)
                .build()
        try {
            intent.launchUrl(context, url.toUri())
        } catch (_: ActivityNotFoundException) {
            start(Intent(Intent.ACTION_VIEW, url.toUri()))
        }
    }

    fun email(
        to: String,
        subject: String,
        body: String? = null,
    ) {
        val uri =
            Uri
                .Builder()
                .scheme("mailto")
                .opaquePart(to)
                .build()
        val intent =
            Intent(Intent.ACTION_SENDTO, uri).apply {
                putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
                putExtra(Intent.EXTRA_SUBJECT, subject)
                if (body != null) putExtra(Intent.EXTRA_TEXT, body)
            }
        start(intent)
    }

    fun call(phone: String) = start(Intent(Intent.ACTION_DIAL, "tel:$phone".toUri()))

    /** WhatsApp chat for a number in E.164 form. */
    fun whatsApp(phone: String) = url("https://wa.me/" + phone.filter { it.isDigit() })

    fun appSettings() =
        start(
            Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null),
            ),
        )

    fun notificationSettings() =
        start(
            Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(
                android.provider.Settings.EXTRA_APP_PACKAGE,
                context.packageName,
            ),
        )

    private fun start(intent: Intent) {
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // Nothing can open it on this phone.
        }
    }
}

@Composable
fun rememberLinkOpener(): LinkOpener {
    val context = LocalContext.current
    val barColor = MaterialTheme.colorScheme.background.toArgb()
    return remember(context, barColor) { LinkOpener(context, AppConfig.fromBuildConfig(), barColor) }
}
