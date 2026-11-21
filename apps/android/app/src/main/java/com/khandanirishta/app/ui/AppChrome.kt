package com.khandanirishta.app.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.khandanirishta.app.R
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Brand

/** The five destinations with their badges (specs/16 sections 2.1 and 2.4). */
@Composable
fun AppBottomBar(
    navigator: AppNavigator,
    me: Me,
    modifier: Modifier = Modifier,
) {
    NavigationBar(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
        tonalElevation = 0.dp,
    ) {
        Tab.entries.forEach { tab ->
            val selected = navigator.currentTab == tab
            val count =
                when (tab) {
                    Tab.INTERESTS -> me.counters.pendingInterests
                    Tab.CHATS -> me.counters.unreadChats
                    else -> 0L
                }
            val dot = tab == Tab.ME && (me.profile.completeness < 70 || me.counters.pendingPhotoRequests > 0)
            val label = stringResource(tab.label())
            val description =
                when {
                    count > 0 -> {
                        "$label, " +
                            text(R.string.common_nav_badge_count, "count" to Formatters.badgeCount(count))
                    }

                    dot -> {
                        "$label, " + stringResource(R.string.common_nav_attention_dot)
                    }

                    else -> {
                        label
                    }
                }
            NavigationBarItem(
                selected = selected,
                onClick = { navigator.selectTab(tab) },
                icon = {
                    BadgedBox(
                        badge = {
                            when {
                                count > 0 -> Badge { Text(Formatters.badgeCount(count)) }
                                dot -> Badge()
                            }
                        },
                    ) {
                        Icon(if (selected) tab.selectedIcon() else tab.icon(), contentDescription = null)
                    }
                },
                label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                colors =
                    NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.colorScheme.primary,
                        selectedTextColor = MaterialTheme.colorScheme.primary,
                        indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                    ),
                modifier = Modifier.semantics { contentDescription = description },
            )
        }
    }
}

private fun Tab.label(): Int =
    when (this) {
        Tab.HOME -> R.string.common_nav_home
        Tab.SEARCH -> R.string.common_nav_search
        Tab.INTERESTS -> R.string.common_nav_interests
        Tab.CHATS -> R.string.common_nav_chats
        Tab.ME -> R.string.common_nav_me
    }

private fun Tab.icon(): ImageVector =
    when (this) {
        Tab.HOME -> Icons.Outlined.Home
        Tab.SEARCH -> Icons.Outlined.Search
        Tab.INTERESTS -> Icons.Outlined.FavoriteBorder
        Tab.CHATS -> Icons.Outlined.ChatBubbleOutline
        Tab.ME -> Icons.Outlined.Person
    }

private fun Tab.selectedIcon(): ImageVector =
    when (this) {
        Tab.HOME -> Icons.Filled.Home
        Tab.SEARCH -> Icons.Filled.Search
        Tab.INTERESTS -> Icons.Filled.Favorite
        Tab.CHATS -> Icons.Filled.ChatBubble
        Tab.ME -> Icons.Filled.Person
    }

/** Opens web pages in a Custom Tab, and mail, phone and WhatsApp links in their apps. */
@Stable
class LinkOpener(
    private val context: Context,
    private val config: AppConfig,
) {
    /** A public page of the web app: legal, help and safety content (specs/22 section 3.1). */
    fun webPage(path: String) = url(config.webPage(path))

    fun url(url: String) {
        val intent =
            CustomTabsIntent
                .Builder()
                .setDefaultColorSchemeParams(
                    CustomTabColorSchemeParams.Builder().setToolbarColor(Brand.Primary.toArgb()).build(),
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
    return remember(context) { LinkOpener(context, AppConfig.fromBuildConfig()) }
}
