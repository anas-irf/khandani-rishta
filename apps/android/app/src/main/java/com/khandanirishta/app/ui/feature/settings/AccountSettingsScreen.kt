package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Downloading
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clerk.api.ui.ClerkColors
import com.clerk.api.ui.ClerkDesign
import com.clerk.api.ui.ClerkTheme
import com.clerk.ui.userprofile.UserProfileView
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.ExportStatus
import com.khandanirishta.app.core.network.generated.model.LatestExport
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.ReferenceLine
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.feature.settings.kit.ActionButton
import com.khandanirishta.app.ui.feature.settings.kit.ActionStyle
import com.khandanirishta.app.ui.feature.settings.kit.RowEnd
import com.khandanirishta.app.ui.feature.settings.kit.SaveState
import com.khandanirishta.app.ui.feature.settings.kit.SettingOption
import com.khandanirishta.app.ui.feature.settings.kit.SettingSelectRow
import com.khandanirishta.app.ui.feature.settings.kit.SettingsColumn
import com.khandanirishta.app.ui.feature.settings.kit.SettingsInfoRow
import com.khandanirishta.app.ui.feature.settings.kit.SettingsRow
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.SettingsSection
import com.khandanirishta.app.ui.feature.settings.kit.SignOutDialog
import com.khandanirishta.app.ui.feature.settings.kit.TintedIcon
import com.khandanirishta.app.ui.feature.settings.kit.displayPhone
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Brand
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.core.network.generated.model.Locale as AppLocale

/**
 * SET-ACCOUNT: sign-in and security, language, profile status, the data export, account deletion
 * and sign-out, top to bottom as in specs/16 section 6.27 (08 section 7, 06 sections 9, 10.1 and 12).
 */
@Composable
fun AccountSettingsScreen(viewModel: AccountSettingsViewModel = hiltViewModel()) {
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val online by viewModel.online.collectAsStateWithLifecycle()
    var showAccountUi by rememberSaveable { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        viewModel.onVisible()
        onPauseOrDispose { viewModel.onHidden() }
    }
    val status = me.profile.status

    SettingsScaffold(title = stringResource(R.string.settings_account_title)) { padding ->
        SettingsColumn(padding) {
            SignInSection(
                email = me.user.email,
                emailVerified = me.user.emailVerified,
                phone = me.user.phoneE164,
                onManage = { showAccountUi = true },
            )
            LanguageSection(
                locale = me.user.locale,
                busy = state.localeBusy,
                enabled = online,
                onChange = viewModel::changeLocale,
            )
            ProfileStatusSection(
                status = status,
                busy = state.statusBusy,
                reopenChecking = state.nikah.loading,
                online = online,
                onPause = { viewModel.open(AccountDialog.PAUSE) },
                onResume = viewModel::resume,
                onClose = { viewModel.open(AccountDialog.CLOSE) },
                onReopen = { viewModel.open(AccountDialog.REOPEN) },
            )
            DataSection(
                export = state.export,
                online = online,
                onRequest = viewModel::requestExport,
                onRetry = viewModel::loadExport,
            )
            DeleteSection(
                onDelete = {
                    // The gentler options come first when the profile can still be paused or closed (06 section 9.1).
                    val gentle = canPauseProfile(status) || canCloseProfile(status)
                    viewModel.open(if (gentle) AccountDialog.GENTLE else AccountDialog.DELETE)
                },
            )
            SettingsSection(title = null) {
                SettingsRow(
                    title = stringResource(R.string.common_actions_sign_out),
                    icon = Icons.AutoMirrored.Outlined.Logout,
                    end = RowEnd.NONE,
                    onClick = { viewModel.open(AccountDialog.SIGN_OUT) },
                )
            }

            when (state.dialog) {
                AccountDialog.PAUSE -> {
                    PauseDialog(
                        busy = state.statusBusy,
                        onConfirm = viewModel::pause,
                        onDismiss = viewModel::dismiss,
                    )
                }

                AccountDialog.CLOSE -> {
                    CloseProfileDialog(
                        busy = state.statusBusy,
                        online = online,
                        onConfirm = viewModel::close,
                        onDismiss = viewModel::dismiss,
                    )
                }

                AccountDialog.REOPEN -> {
                    ReopenDialog(
                        nikah = state.nikah,
                        busy = state.statusBusy,
                        onConfirm = viewModel::reopen,
                        onDismiss = viewModel::dismiss,
                    )
                }

                AccountDialog.GENTLE -> {
                    GentleOptionsSheet(
                        status = status,
                        onPause = { viewModel.open(AccountDialog.PAUSE) },
                        onClose = { viewModel.open(AccountDialog.CLOSE) },
                        onContinue = { viewModel.open(AccountDialog.DELETE) },
                        onDismiss = viewModel::dismiss,
                    )
                }

                AccountDialog.DELETE -> {
                    DeleteAccountSheet(onDismiss = viewModel::dismiss)
                }

                AccountDialog.MUBARAK -> {
                    MubarakDialog(
                        onOpenConnections = {
                            viewModel.dismiss()
                            navigator.selectTab(Tab.CHATS)
                        },
                        onDismiss = viewModel::dismiss,
                    )
                }

                AccountDialog.SIGN_OUT -> {
                    SignOutDialog(
                        onConfirm = {
                            viewModel.dismiss()
                            appViewModel.signOut()
                        },
                        onDismiss = viewModel::dismiss,
                    )
                }

                null -> {}
            }
            if (showAccountUi) AccountUiDialog(onDismiss = { showAccountUi = false })
        }
    }
}

/** Pause is offered from `active`, close from `active` and `paused` (08 section 7, 06 section 9.1). */
internal fun canPauseProfile(status: ProfileStatus): Boolean = status == ProfileStatus.ACTIVE

internal fun canCloseProfile(status: ProfileStatus): Boolean =
    status == ProfileStatus.ACTIVE || status == ProfileStatus.PAUSED

/**
 * "Sign-in and security": the email with a tick when verified, the phone when set, and the row
 * that opens Clerk's account UI (06 section 12). Deletion is not in that UI; it is group 5.
 */
@Composable
private fun SignInSection(
    email: String?,
    emailVerified: Boolean,
    phone: String?,
    onManage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val verified = email != null && emailVerified
    SettingsSection(title = stringResource(R.string.settings_account_sign_in_title), modifier = modifier) {
        SettingsInfoRow(
            text =
                if (email != null) {
                    text(R.string.settings_account_sign_in_email, "email" to email)
                } else {
                    stringResource(R.string.settings_account_sign_in_email_none)
                },
            icon = Icons.Outlined.MailOutline,
            endIcon = if (verified) Icons.Filled.Verified else null,
            endIconDescription = stringResource(R.string.settings_account_sign_in_email_verified),
            endIconTint = KrTheme.colors.success,
        )
        if (!phone.isNullOrBlank()) {
            RowDivider()
            SettingsInfoRow(
                text = text(R.string.settings_account_sign_in_phone, "phone" to displayPhone(phone)),
                icon = Icons.Outlined.Phone,
            )
        }
        RowDivider()
        SettingsRow(
            title = stringResource(R.string.settings_account_sign_in_manage),
            icon = Icons.Outlined.Security,
            onClick = onManage,
        )
    }
}

/** "Language": English, and Urdu disabled with "Coming soon" until the Urdu phase (specs/22 section 12). */
@Composable
private fun LanguageSection(
    locale: AppLocale,
    busy: Boolean,
    enabled: Boolean,
    onChange: (AppLocale) -> Unit,
    modifier: Modifier = Modifier,
) {
    SettingsSection(title = stringResource(R.string.settings_account_language_title), modifier = modifier) {
        SettingSelectRow(
            title = stringResource(R.string.settings_account_language_label),
            icon = Icons.Outlined.Translate,
            options =
                listOf(
                    SettingOption(AppLocale.EN.wire, stringResource(R.string.settings_account_language_english)),
                    SettingOption(
                        code = AppLocale.UR.wire,
                        label = stringResource(R.string.settings_account_language_urdu),
                        enabled = false,
                        caption = stringResource(R.string.settings_account_language_coming_soon),
                    ),
                ),
            selected = locale.wire.ifEmpty { AppLocale.EN.wire },
            saveState = if (busy) SaveState.SAVING else SaveState.IDLE,
            enabled = enabled,
            onSelect = { code ->
                AppLocale.entries.firstOrNull { it.wire == code && it != AppLocale.UNKNOWN }?.let(onChange)
            },
        )
    }
}

/** How a profile status looks on the "Profile status" card. */
private class StatusLook(
    val icon: ImageVector,
    val tint: Color,
    val container: Color,
    val line: Int,
)

@Composable
private fun statusLook(status: ProfileStatus): StatusLook =
    when (status) {
        ProfileStatus.ACTIVE -> {
            StatusLook(
                Icons.Outlined.CheckCircle,
                KrTheme.colors.success,
                KrTheme.colors.successContainer,
                R.string.settings_account_status_line_active,
            )
        }

        ProfileStatus.PAUSED -> {
            StatusLook(
                Icons.Outlined.PauseCircle,
                KrTheme.colors.warning,
                KrTheme.colors.warningContainer,
                R.string.settings_account_status_line_paused,
            )
        }

        ProfileStatus.CLOSED -> {
            StatusLook(
                Icons.Outlined.VisibilityOff,
                MaterialTheme.colorScheme.onSurfaceVariant,
                MaterialTheme.colorScheme.surfaceContainerHigh,
                R.string.settings_account_status_line_closed,
            )
        }

        else -> {
            StatusLook(
                Icons.Outlined.HourglassTop,
                MaterialTheme.colorScheme.primary,
                MaterialTheme.colorScheme.primaryContainer,
                R.string.settings_account_status_line_not_live,
            )
        }
    }

/** "Profile status": the status in words and the actions allowed from it (08 section 7). */
@Composable
private fun ProfileStatusSection(
    status: ProfileStatus,
    busy: Boolean,
    reopenChecking: Boolean,
    online: Boolean,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onClose: () -> Unit,
    onReopen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val look = statusLook(status)
    SettingsSection(title = stringResource(R.string.settings_account_status_title), modifier = modifier) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TintedIcon(icon = look.icon, tint = look.tint, container = look.container)
                Spacer(Modifier.width(14.dp))
                Text(stringResource(look.line), style = MaterialTheme.typography.titleSmall)
            }
            when (status) {
                ProfileStatus.ACTIVE -> {
                    Spacer(Modifier.height(2.dp))
                    ActionButton(
                        text = stringResource(R.string.settings_account_status_pause_action),
                        style = ActionStyle.OUTLINED,
                        icon = Icons.Outlined.PauseCircle,
                        enabled = online && !busy,
                        onClick = onPause,
                    )
                    ActionButton(
                        text = stringResource(R.string.settings_account_status_close_action),
                        style = ActionStyle.OUTLINED,
                        icon = Icons.Outlined.VisibilityOff,
                        enabled = online && !busy,
                        onClick = onClose,
                    )
                }

                ProfileStatus.PAUSED -> {
                    Spacer(Modifier.height(2.dp))
                    ActionButton(
                        text = stringResource(R.string.settings_account_status_resume_action),
                        style = ActionStyle.TONAL,
                        icon = Icons.Outlined.PlayCircle,
                        busy = busy,
                        enabled = online,
                        onClick = onResume,
                    )
                    ActionButton(
                        text = stringResource(R.string.settings_account_status_close_action),
                        style = ActionStyle.OUTLINED,
                        icon = Icons.Outlined.VisibilityOff,
                        enabled = online && !busy,
                        onClick = onClose,
                    )
                }

                ProfileStatus.CLOSED -> {
                    Spacer(Modifier.height(2.dp))
                    // The reopen dialog depends on the nikah check, so it waits for it (08 section 7.4).
                    ActionButton(
                        text = stringResource(R.string.settings_account_status_reopen_action),
                        style = ActionStyle.TONAL,
                        icon = Icons.Outlined.Restore,
                        busy = reopenChecking,
                        enabled = online && !busy,
                        onClick = onReopen,
                    )
                }

                else -> {}
            }
        }
    }
}

/** "Your data": the state of the latest export and its control (16 section 6.27, 09 section 12.1). */
@Composable
private fun DataSection(
    export: ExportUi,
    online: Boolean,
    onRequest: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val links = rememberLinkOpener()
    SettingsSection(title = stringResource(R.string.settings_account_data_title), modifier = modifier) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val latest = export.latest
            when {
                !export.loaded && export.error != null -> {
                    ExportError(error = export.error, onRetry = onRetry)
                }

                !export.loaded -> {
                    SkeletonBox(
                        Modifier
                            .fillMaxWidth(0.8f)
                            .height(16.dp),
                    )
                    SkeletonBox(
                        Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                    )
                }

                else -> {
                    ExportLine(latest)
                    when (latest?.status) {
                        // Being prepared: no control; the state is fetched again every 15 seconds.
                        ExportStatus.QUEUED -> {}

                        ExportStatus.READY -> {
                            latest.downloadUrl?.let { url ->
                                ActionButton(
                                    text = stringResource(R.string.settings_account_data_download),
                                    icon = Icons.Outlined.Download,
                                    onClick = { links.url(url) },
                                )
                            }
                            ActionButton(
                                text = stringResource(R.string.settings_account_data_request_new),
                                style = ActionStyle.OUTLINED,
                                busy = export.requesting,
                                enabled = online,
                                onClick = onRequest,
                            )
                        }

                        ExportStatus.FAILED -> {
                            ActionButton(
                                text = stringResource(R.string.settings_account_data_try_again),
                                style = ActionStyle.TONAL,
                                busy = export.requesting,
                                enabled = online,
                                onClick = onRequest,
                            )
                        }

                        else -> {
                            ActionButton(
                                text = stringResource(R.string.settings_account_data_request),
                                style = ActionStyle.TONAL,
                                icon = Icons.Outlined.CloudDownload,
                                busy = export.requesting,
                                enabled = online,
                                onClick = onRequest,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The line that tells the state of the latest export, with an icon. */
@Composable
private fun ExportLine(
    latest: LatestExport?,
    modifier: Modifier = Modifier,
) {
    val expires = latest?.expiresAt?.let { Formatters.date(it) }.orEmpty()
    val icon =
        when (latest?.status) {
            ExportStatus.QUEUED -> Icons.Outlined.Downloading
            ExportStatus.READY -> Icons.Outlined.CheckCircle
            ExportStatus.FAILED -> Icons.Outlined.ErrorOutline
            ExportStatus.EXPIRED -> Icons.Outlined.HourglassTop
            else -> Icons.Outlined.CloudDownload
        }
    val line =
        when (latest?.status) {
            ExportStatus.QUEUED -> stringResource(R.string.settings_account_data_queued)
            ExportStatus.READY -> text(R.string.settings_account_data_ready, "date" to expires)
            ExportStatus.FAILED -> stringResource(R.string.settings_account_data_failed)
            ExportStatus.EXPIRED -> stringResource(R.string.settings_account_data_expired)
            else -> stringResource(R.string.settings_account_data_none)
        }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TintedIcon(
            icon = icon,
            tint = MaterialTheme.colorScheme.primary,
            container = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f),
        )
        Spacer(Modifier.width(14.dp))
        Text(line, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

/** The export state could not be loaded (rule G3, inside its card). */
@Composable
private fun ExportError(
    error: ApiError?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.errors_generic_screen_title), style = MaterialTheme.typography.titleSmall)
        }
        Text(
            stringResource(R.string.errors_generic_screen_text),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ActionButton(
            text = stringResource(R.string.errors_generic_try_again),
            style = ActionStyle.OUTLINED,
            onClick = onRetry,
        )
        ReferenceLine(error?.requestId)
    }
}

/** "Delete account", in a calm danger style: a thin red outline and a red row. */
@Composable
private fun DeleteSection(
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SettingsSection(
        title = stringResource(R.string.settings_account_delete_title),
        modifier = modifier,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.3f)),
    ) {
        SettingsRow(
            title = stringResource(R.string.settings_account_delete_action),
            icon = Icons.Outlined.DeleteOutline,
            tint = MaterialTheme.colorScheme.error,
            onClick = onDelete,
        )
    }
}

/**
 * Clerk's prebuilt account UI (`UserProfileView`, specs/22 section 4), full screen: the email
 * address, the linked Google account and the active devices. Its delete option is switched off in
 * the Clerk dashboard; deletion always goes through our own flow.
 */
@Composable
private fun AccountUiDialog(onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
            UserProfileView(clerkTheme = accountClerkTheme, onDismiss = onDismiss, isDismissible = true)
        }
    }
}

/** The brand colours for Clerk's screens, as on AUTH-SIGNIN. */
private val accountClerkTheme =
    ClerkTheme(
        colors =
            ClerkColors(
                primary = Brand.Primary,
                background = Brand.Background,
                danger = Brand.Danger,
                success = Brand.Success,
                warning = Brand.Warning,
                foreground = Brand.Text,
                mutedForeground = Brand.MutedText,
                primaryForeground = Color.White,
                border = Brand.Border,
            ),
        design = ClerkDesign(borderRadius = 12.dp),
    )
