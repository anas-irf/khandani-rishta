package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Downloading
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clerk.ui.userprofile.UserProfileView
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.ExportStatus
import com.khandanirishta.app.core.network.generated.model.LatestExport
import com.khandanirishta.app.core.network.generated.model.MeUser
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.DarkSystemBarIcons
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusPill
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.feature.settings.kit.SaveState
import com.khandanirishta.app.ui.feature.settings.kit.SettingOption
import com.khandanirishta.app.ui.feature.settings.kit.SettingSelect
import com.khandanirishta.app.ui.feature.settings.kit.SettingsBands
import com.khandanirishta.app.ui.feature.settings.kit.SettingsGroup
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.SignOutDialog
import com.khandanirishta.app.ui.feature.settings.kit.displayPhone
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.rememberClerkTheme
import com.khandanirishta.app.core.network.generated.model.Locale as AppLocale

/** What the sections of SET-ACCOUNT can do; they get these instead of the view model. */
@Immutable
internal class AccountActions(
    val manage: () -> Unit,
    val changeLocale: (AppLocale) -> Unit,
    val pause: () -> Unit,
    val resume: () -> Unit,
    val close: () -> Unit,
    val reopen: () -> Unit,
    val requestExport: () -> Unit,
    val loadExport: () -> Unit,
    val download: (url: String) -> Unit,
    val delete: () -> Unit,
    val signOut: () -> Unit,
)

/**
 * SET-ACCOUNT: sign-in and security, language, profile status, the data export, account deletion
 * and sign-out, top to bottom as in specs/16 section 6.27 (08 section 7, 06 sections 9, 10.1 and 12).
 */
@Composable
fun AccountSettingsScreen(
    modifier: Modifier = Modifier,
    viewModel: AccountSettingsViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    val links = rememberLinkOpener()
    val state by viewModel.state.collectAsStateWithLifecycle()
    var showAccountUi by rememberSaveable { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        viewModel.onVisible()
        onPauseOrDispose { viewModel.onHidden() }
    }
    val status = me.profile.status
    val actions =
        remember(viewModel, links, status) {
            AccountActions(
                manage = { showAccountUi = true },
                changeLocale = viewModel::changeLocale,
                pause = { viewModel.open(AccountDialog.PAUSE) },
                resume = { viewModel.resume() },
                close = { viewModel.open(AccountDialog.CLOSE) },
                reopen = { viewModel.open(AccountDialog.REOPEN) },
                requestExport = viewModel::requestExport,
                loadExport = viewModel::loadExport,
                download = { links.url(it) },
                delete = {
                    // The gentler options come first when the profile can still be paused or closed (06 section 9.1).
                    val gentle = canPauseProfile(status) || canCloseProfile(status)
                    viewModel.open(if (gentle) AccountDialog.GENTLE else AccountDialog.DELETE)
                },
                signOut = { viewModel.open(AccountDialog.SIGN_OUT) },
            )
        }

    SettingsScaffold(title = stringResource(R.string.settings_account_title), modifier = modifier) {
        AccountContent(user = me.user, status = status, state = state, actions = actions)

        when (state.dialog) {
            AccountDialog.PAUSE -> {
                PauseDialog(
                    busy = state.statusBusy,
                    onConfirm = { viewModel.pause() },
                    onDismiss = viewModel::dismiss,
                )
            }

            AccountDialog.CLOSE -> {
                CloseProfileDialog(
                    busy = state.statusBusy,
                    onConfirm = { viewModel.close(it) },
                    onDismiss = viewModel::dismiss,
                )
            }

            AccountDialog.REOPEN -> {
                ReopenDialog(
                    nikah = state.nikah,
                    busy = state.statusBusy,
                    onConfirm = { viewModel.reopen() },
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

/** Pause is offered from `active`, close from `active` and `paused` (08 section 7, 06 section 9.1). */
internal fun canPauseProfile(status: ProfileStatus): Boolean = status == ProfileStatus.ACTIVE

internal fun canCloseProfile(status: ProfileStatus): Boolean =
    status == ProfileStatus.ACTIVE || status == ProfileStatus.PAUSED

/** The six groups of specs/16 section 6.27, each on a band of its own. */
@Composable
internal fun AccountContent(
    user: MeUser,
    status: ProfileStatus,
    state: AccountUiState,
    actions: AccountActions,
    modifier: Modifier = Modifier,
) {
    SettingsBands(modifier = modifier, endTone = BandTone.SAND) {
        SignInSection(
            email = user.email,
            emailVerified = user.emailVerified,
            phone = user.phoneE164,
            onManage = actions.manage,
        )
        LanguageSection(locale = user.locale, busy = state.localeBusy, onChange = actions.changeLocale)
        ProfileStatusSection(
            status = status,
            busy = state.statusBusy,
            reopenChecking = state.nikah.loading,
            actions = actions,
        )
        DataSection(export = state.export, actions = actions)
        SettingsGroup(title = stringResource(R.string.settings_account_delete_title), tone = BandTone.PAGE) {
            // Not danger yet: the confirmation that follows is.
            KrButton(
                text = stringResource(R.string.settings_account_delete_action),
                onClick = actions.delete,
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.Outlined.DeleteOutline,
                enabled = LocalOnline.current,
            )
        }
        SettingsGroup(title = stringResource(R.string.settings_account_sign_out_title), tone = BandTone.SAND) {
            KrButton(
                text = stringResource(R.string.common_actions_sign_out),
                onClick = actions.signOut,
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.AutoMirrored.Outlined.Logout,
            )
        }
    }
}

/**
 * "Sign-in and security": the email with "Email verified" in words, the phone when set, and the
 * row that opens Clerk's account UI (06 section 12). Deletion is not in that UI; it is group 5.
 */
@Composable
private fun SignInSection(
    email: String?,
    emailVerified: Boolean,
    phone: String?,
    onManage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SettingsGroup(
        title = stringResource(R.string.settings_account_sign_in_title),
        tone = BandTone.PAGE,
        modifier = modifier,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            IconText(
                icon = Icons.Outlined.MailOutline,
                text =
                    if (email != null) {
                        text(R.string.settings_account_sign_in_email, "email" to email)
                    } else {
                        stringResource(R.string.settings_account_sign_in_email_none)
                    },
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (email != null && emailVerified) {
                // Words with the tick, never the tick alone (DESIGN.md section 6.3).
                StatusPill(
                    text = stringResource(R.string.settings_account_sign_in_email_verified),
                    tone = StatusTone.SUCCESS,
                    icon = Icons.Outlined.Check,
                    modifier = Modifier.padding(start = Sizes.iconSmall + Spacing.s8),
                )
            }
        }
        if (!phone.isNullOrBlank()) {
            IconText(
                icon = Icons.Outlined.Phone,
                text = text(R.string.settings_account_sign_in_phone, "phone" to displayPhone(phone)),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column {
            RowDivider()
            NavRow(
                title = stringResource(R.string.settings_account_sign_in_manage),
                icon = Icons.Outlined.Security,
                onClick = onManage,
                enabled = LocalOnline.current,
            )
        }
    }
}

/** "Language": English, and Urdu disabled with "Coming soon" until the Urdu phase (specs/22 section 12). */
@Composable
private fun LanguageSection(
    locale: AppLocale,
    busy: Boolean,
    onChange: (AppLocale) -> Unit,
    modifier: Modifier = Modifier,
) {
    SettingsGroup(
        title = stringResource(R.string.settings_account_language_title),
        tone = BandTone.SAND,
        modifier = modifier,
    ) {
        SettingSelect(
            title = stringResource(R.string.settings_account_language_label),
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
            onSelect = { code ->
                AppLocale.entries.firstOrNull { it.wire == code && it != AppLocale.UNKNOWN }?.let(onChange)
            },
        )
    }
}

/** How a state of the profile or of the export reads: its icon in an arch and its line. */
@Immutable
private data class StateLook(
    val icon: ImageVector,
    val tone: ArchTone,
    val line: Int,
)

private fun statusLook(status: ProfileStatus): StateLook =
    when (status) {
        // An eye, not a tick: a tick means verified.
        ProfileStatus.ACTIVE -> {
            StateLook(Icons.Outlined.Visibility, ArchTone.SUCCESS, R.string.settings_account_status_line_active)
        }

        ProfileStatus.PAUSED -> {
            StateLook(Icons.Outlined.PauseCircle, ArchTone.WARNING, R.string.settings_account_status_line_paused)
        }

        ProfileStatus.CLOSED -> {
            StateLook(Icons.Outlined.VisibilityOff, ArchTone.TONAL, R.string.settings_account_status_line_closed)
        }

        else -> {
            StateLook(Icons.Outlined.HourglassTop, ArchTone.PRIMARY, R.string.settings_account_status_line_not_live)
        }
    }

/** "Profile status": the status in words and the actions allowed from it (08 section 7). */
@Composable
private fun ProfileStatusSection(
    status: ProfileStatus,
    busy: Boolean,
    reopenChecking: Boolean,
    actions: AccountActions,
    modifier: Modifier = Modifier,
) {
    val online = LocalOnline.current
    val look = statusLook(status)
    SettingsGroup(
        title = stringResource(R.string.settings_account_status_title),
        tone = BandTone.PAGE,
        modifier = modifier,
    ) {
        StateLine(icon = look.icon, tone = look.tone, line = stringResource(look.line))
        val closable = canCloseProfile(status)
        if (closable || status == ProfileStatus.CLOSED) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                verticalArrangement = Arrangement.spacedBy(Spacing.s12),
            ) {
                if (status == ProfileStatus.ACTIVE) {
                    KrButton(
                        text = stringResource(R.string.settings_account_status_pause_action),
                        onClick = actions.pause,
                        variant = KrButtonVariant.SECONDARY,
                        icon = Icons.Outlined.PauseCircle,
                        enabled = online && !busy,
                    )
                }
                if (status == ProfileStatus.PAUSED) {
                    KrButton(
                        text = stringResource(R.string.settings_account_status_resume_action),
                        onClick = actions.resume,
                        variant = KrButtonVariant.SECONDARY,
                        icon = Icons.Outlined.PlayCircle,
                        loading = busy,
                        enabled = online,
                    )
                }
                if (closable) {
                    KrButton(
                        text = stringResource(R.string.settings_account_status_close_action),
                        onClick = actions.close,
                        variant = KrButtonVariant.SECONDARY,
                        icon = Icons.Outlined.VisibilityOff,
                        enabled = online && !busy,
                    )
                }
                if (status == ProfileStatus.CLOSED) {
                    // The reopen dialog depends on the nikah check, so it waits for it (08 section 7.4).
                    KrButton(
                        text = stringResource(R.string.settings_account_status_reopen_action),
                        onClick = actions.reopen,
                        variant = KrButtonVariant.SECONDARY,
                        icon = Icons.Outlined.Restore,
                        loading = reopenChecking,
                        enabled = online && !busy,
                    )
                }
            }
        }
    }
}

/** "Your data": the state of the latest export and its control (16 section 6.27, 09 section 12.1). */
@Composable
private fun DataSection(
    export: ExportUi,
    actions: AccountActions,
    modifier: Modifier = Modifier,
) {
    val online = LocalOnline.current
    SettingsGroup(
        title = stringResource(R.string.settings_account_data_title),
        tone = BandTone.SAND,
        modifier = modifier,
    ) {
        val latest = export.latest
        when {
            !export.loaded && export.error != null -> {
                ErrorState(error = export.error, onRetry = actions.loadExport)
            }

            !export.loaded -> {
                LoadingRegion {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.s16),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SkeletonBox(Modifier.size(Sizes.archIcon), shape = ArchShape)
                        SkeletonBox(Modifier.weight(1f).height(Spacing.s20))
                    }
                    SkeletonBox(Modifier.fillMaxWidth().height(Sizes.touchLarge), shape = PillShape)
                }
            }

            else -> {
                ExportLine(latest)
                when (latest?.status) {
                    // Being prepared: no control; the state is fetched again every 15 seconds.
                    ExportStatus.QUEUED -> {}

                    ExportStatus.READY -> {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                            verticalArrangement = Arrangement.spacedBy(Spacing.s12),
                        ) {
                            latest.downloadUrl?.let { url ->
                                KrButton(
                                    text = stringResource(R.string.settings_account_data_download),
                                    onClick = { actions.download(url) },
                                    icon = Icons.Outlined.Download,
                                    enabled = online,
                                )
                            }
                            KrButton(
                                text = stringResource(R.string.settings_account_data_request_new),
                                onClick = actions.requestExport,
                                variant = KrButtonVariant.SECONDARY,
                                loading = export.requesting,
                                enabled = online,
                            )
                        }
                    }

                    else -> {
                        val failed = latest?.status == ExportStatus.FAILED
                        val label =
                            if (failed) {
                                R.string.settings_account_data_try_again
                            } else {
                                R.string.settings_account_data_request
                            }
                        KrButton(
                            text = stringResource(label),
                            onClick = actions.requestExport,
                            icon = if (failed) null else Icons.Outlined.CloudDownload,
                            loading = export.requesting,
                            enabled = online,
                        )
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
    val expires = remember(latest?.expiresAt) { latest?.expiresAt?.let { Formatters.date(it) }.orEmpty() }
    val look = exportLook(latest?.status)
    StateLine(
        icon = look.icon,
        tone = look.tone,
        line = text(look.line, "date" to expires),
        modifier = modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    )
}

private fun exportLook(status: ExportStatus?): StateLook =
    when (status) {
        ExportStatus.QUEUED -> {
            StateLook(Icons.Outlined.Downloading, ArchTone.PRIMARY, R.string.settings_account_data_queued)
        }

        ExportStatus.READY -> {
            StateLook(Icons.Outlined.Description, ArchTone.SUCCESS, R.string.settings_account_data_ready)
        }

        ExportStatus.FAILED -> {
            StateLook(Icons.Outlined.ErrorOutline, ArchTone.DANGER, R.string.settings_account_data_failed)
        }

        ExportStatus.EXPIRED -> {
            StateLook(Icons.Outlined.Schedule, ArchTone.WARNING, R.string.settings_account_data_expired)
        }

        else -> {
            StateLook(Icons.Outlined.CloudDownload, ArchTone.TONAL, R.string.settings_account_data_none)
        }
    }

/** A state in words behind its arch. */
@Composable
private fun StateLine(
    icon: ImageVector,
    tone: ArchTone,
    line: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s16),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ArchIcon(icon, tone = tone)
        Text(line, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
    }
}

/**
 * Clerk's prebuilt account UI (`UserProfileView`, specs/22 section 4), full screen and in the
 * app's theme: the email address, the linked Google account and the active devices. Its delete
 * option is switched off in the Clerk dashboard; deletion always goes through our own flow.
 */
@Composable
private fun AccountUiDialog(onDismiss: () -> Unit) {
    val theme = rememberClerkTheme()
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        DarkSystemBarIcons()
        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
            Box(Modifier.safeDrawingPadding()) {
                UserProfileView(clerkTheme = theme, onDismiss = onDismiss, isDismissible = true)
            }
        }
    }
}
