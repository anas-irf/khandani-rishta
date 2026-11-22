package com.khandanirishta.app.ui.feature.settings

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.ContactPhone
import androidx.compose.material.icons.outlined.Gavel
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.RowEnd
import com.khandanirishta.app.ui.feature.settings.kit.SettingsBands
import com.khandanirishta.app.ui.feature.settings.kit.SettingsGroup
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.SignOutDialog
import com.khandanirishta.app.ui.feature.settings.kit.appVersionName
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.BlockedMembers
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.Help
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.NotificationSettings
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Spacing

/**
 * SET-HOME: the settings menu (specs/16 section 6.24). "Blocked members" needs an active profile,
 * so its row is shown only under the gate `ok` (16 section 3.2). At the bottom: sign-out and the
 * app version.
 */
@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    val version = remember { appVersionName() }

    SettingsScaffold(title = stringResource(R.string.settings_title), modifier = modifier) {
        SettingsMenu(
            version = version,
            showBlocked = me.gate == Gate.OK,
            onOpen = { navigator.push(it) },
            onSignOut = { confirmSignOut = true },
        )
        if (confirmSignOut) {
            SignOutDialog(
                onConfirm = {
                    confirmSignOut = false
                    appViewModel.signOut()
                },
                onDismiss = { confirmSignOut = false },
            )
        }
    }
}

/** A row of SET-HOME. */
@Immutable
private data class MenuEntry(
    @param:StringRes val label: Int,
    val icon: ImageVector,
    val target: AppKey,
    val onlyWhenOk: Boolean = false,
)

private val MENU: List<MenuEntry> =
    listOf(
        MenuEntry(R.string.settings_home_rows_privacy, Icons.Outlined.Shield, PrivacySettings),
        MenuEntry(R.string.settings_home_rows_notifications, Icons.Outlined.Notifications, NotificationSettings),
        MenuEntry(R.string.settings_home_rows_contacts, Icons.Outlined.ContactPhone, ContactDetails()),
        MenuEntry(R.string.settings_home_rows_blocked, Icons.Outlined.PersonOff, BlockedMembers, onlyWhenOk = true),
        MenuEntry(R.string.settings_home_rows_account, Icons.Outlined.ManageAccounts, AccountSettings),
        MenuEntry(R.string.settings_home_rows_help, Icons.AutoMirrored.Outlined.HelpOutline, Help),
    )

@Composable
internal fun SettingsMenu(
    version: String,
    showBlocked: Boolean,
    onOpen: (AppKey) -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SettingsBands(modifier = modifier, endTone = BandTone.SAND) {
        Band(padding = BandDefaults.compactPadding) {
            MENU.forEach { entry ->
                if (showBlocked || !entry.onlyWhenOk) {
                    NavRow(title = stringResource(entry.label), icon = entry.icon, onClick = { onOpen(entry.target) })
                    RowDivider()
                }
            }
        }
        Band(tone = BandTone.SAND, spacing = Spacing.s16) {
            KrButton(
                text = stringResource(R.string.common_actions_sign_out),
                onClick = onSignOut,
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.AutoMirrored.Outlined.Logout,
            )
            CaptionText(text(R.string.settings_home_version, "version" to version))
        }
    }
}

/** A public web page of SET-HELP, opened in a Custom Tab (specs/22 section 3.1). */
@Immutable
private data class HelpPage(
    val path: String,
    @param:StringRes val label: Int,
    val icon: ImageVector,
)

/** The pages of specs/16 section 6.30, in its order. */
private val HELP_PAGES: List<HelpPage> =
    listOf(
        HelpPage("safety", R.string.settings_help_rows_safety, Icons.Outlined.Shield),
        HelpPage("how-it-works", R.string.settings_help_rows_how, Icons.Outlined.Lightbulb),
        HelpPage("faq", R.string.settings_help_rows_faq, Icons.Outlined.QuestionAnswer),
        HelpPage("nikah-guide", R.string.settings_help_rows_nikah, Icons.AutoMirrored.Outlined.MenuBook),
        HelpPage("community-guidelines", R.string.settings_help_rows_guidelines, Icons.Outlined.Groups),
        HelpPage("terms", R.string.settings_help_rows_terms, Icons.Outlined.Gavel),
        HelpPage("privacy", R.string.settings_help_rows_privacy, Icons.Outlined.PrivacyTip),
    )

/**
 * SET-HELP: help, safety and legal pages, contact support and About (specs/16 section 6.30).
 * Reachable under every gate except `consent_required`; Back returns to where it was opened from.
 */
@Composable
fun HelpScreen(modifier: Modifier = Modifier) {
    val me = LocalMe.current ?: return
    val links = rememberLinkOpener()
    val res = LocalResources.current
    val version = remember { appVersionName() }
    val code = me.profile.publicCode
    val supportEmail = me.config.supportEmail

    SettingsScaffold(title = stringResource(R.string.settings_help_title), modifier = modifier) {
        HelpContent(
            version = version,
            code = code,
            supportEmail = supportEmail,
            onPage = { links.webPage(it) },
            onContact = {
                // The subject names the profile code; the body ends with the version and platform.
                links.email(
                    to = supportEmail,
                    subject = res.text(R.string.settings_help_support_subject, "code" to code),
                    body = "\n\n" + res.text(R.string.settings_android_support_body, "version" to version),
                )
            },
        )
    }
}

@Composable
internal fun HelpContent(
    version: String,
    code: String,
    supportEmail: String,
    onPage: (path: String) -> Unit,
    onContact: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SettingsBands(modifier = modifier, endTone = BandTone.SAND) {
        Band(padding = BandDefaults.compactPadding) {
            HELP_PAGES.forEach { page ->
                NavRow(
                    title = stringResource(page.label),
                    icon = page.icon,
                    end = RowEnd.EXTERNAL,
                    onClick = { onPage(page.path) },
                )
                RowDivider()
            }
            NavRow(
                title = stringResource(R.string.settings_help_rows_contact),
                subtitle = supportEmail,
                icon = Icons.Outlined.SupportAgent,
                end = RowEnd.EXTERNAL,
                onClick = onContact,
            )
            RowDivider()
        }
        SettingsGroup(title = stringResource(R.string.settings_help_about_title), tone = BandTone.SAND) {
            val figures = MaterialTheme.typography.bodyMedium.merge(KrType.numbers)
            Text(text(R.string.settings_help_about_version, "version" to version), style = figures)
            Text(text(R.string.settings_help_about_code, "code" to code), style = figures)
            CaptionText(stringResource(R.string.common_geonames))
        }
    }
}
