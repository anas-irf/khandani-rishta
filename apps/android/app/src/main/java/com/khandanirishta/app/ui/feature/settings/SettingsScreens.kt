package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.ContactPhone
import androidx.compose.material.icons.outlined.Gavel
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.feature.settings.kit.RowEnd
import com.khandanirishta.app.ui.feature.settings.kit.SettingsColumn
import com.khandanirishta.app.ui.feature.settings.kit.SettingsRow
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.SettingsSection
import com.khandanirishta.app.ui.feature.settings.kit.SignOutDialog
import com.khandanirishta.app.ui.feature.settings.kit.appVersionName
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.BlockedMembers
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.Help
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.NotificationSettings
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text

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

    SettingsScaffold(title = stringResource(R.string.settings_title), modifier = modifier) { padding ->
        SettingsColumn(padding) {
            SettingsSection(title = null) {
                NavRow(
                    title = stringResource(R.string.settings_home_rows_privacy),
                    icon = Icons.Outlined.Shield,
                    onClick = { navigator.push(PrivacySettings) },
                )
                RowDivider()
                NavRow(
                    title = stringResource(R.string.settings_home_rows_notifications),
                    icon = Icons.Outlined.Notifications,
                    onClick = { navigator.push(NotificationSettings) },
                )
                RowDivider()
                NavRow(
                    title = stringResource(R.string.settings_home_rows_contacts),
                    icon = Icons.Outlined.ContactPhone,
                    onClick = { navigator.push(ContactDetails()) },
                )
                if (me.gate == Gate.OK) {
                    RowDivider()
                    NavRow(
                        title = stringResource(R.string.settings_home_rows_blocked),
                        icon = Icons.Outlined.Block,
                        onClick = { navigator.push(BlockedMembers) },
                    )
                }
                RowDivider()
                NavRow(
                    title = stringResource(R.string.settings_home_rows_account),
                    icon = Icons.Outlined.ManageAccounts,
                    onClick = { navigator.push(AccountSettings) },
                )
            }
            SettingsSection(title = null) {
                NavRow(
                    title = stringResource(R.string.settings_home_rows_help),
                    icon = Icons.AutoMirrored.Outlined.HelpOutline,
                    onClick = { navigator.push(Help) },
                )
            }
            SettingsSection(title = null) {
                SettingsRow(
                    title = stringResource(R.string.common_actions_sign_out),
                    icon = Icons.AutoMirrored.Outlined.Logout,
                    end = RowEnd.NONE,
                    onClick = { confirmSignOut = true },
                )
            }
            Text(
                text(R.string.settings_home_version, "version" to version),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 20.dp),
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
}

/** A public web page of SET-HELP, opened in a Custom Tab (specs/22 section 3.1). */
private class HelpPage(
    val path: String,
    val label: Int,
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

    SettingsScaffold(title = stringResource(R.string.settings_help_title), modifier = modifier) { padding ->
        SettingsColumn(padding) {
            SettingsSection(title = null) {
                HELP_PAGES.forEachIndexed { index, page ->
                    if (index > 0) RowDivider()
                    SettingsRow(
                        title = stringResource(page.label),
                        icon = page.icon,
                        end = RowEnd.EXTERNAL,
                        onClick = { links.webPage(page.path) },
                    )
                }
            }
            SettingsSection(title = null) {
                SettingsRow(
                    title = stringResource(R.string.settings_help_rows_contact),
                    subtitle = supportEmail,
                    icon = Icons.Outlined.SupportAgent,
                    end = RowEnd.EXTERNAL,
                    onClick = {
                        // The subject names the profile code; the body ends with the version and platform.
                        links.email(
                            to = supportEmail,
                            subject = res.text(R.string.settings_help_support_subject, "code" to code),
                            body = "\n\n" + res.text(R.string.settings_android_support_body, "version" to version),
                        )
                    },
                )
            }
            SettingsSection(title = stringResource(R.string.settings_help_about_title)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text(R.string.settings_help_about_version, "version" to version),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        text(R.string.settings_help_about_code, "code" to code),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        stringResource(R.string.common_geonames),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
