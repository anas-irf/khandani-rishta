package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.ClosedReason
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.RadioList
import com.khandanirishta.app.ui.components.rememberModalSheetState
import com.khandanirishta.app.ui.feature.settings.kit.ActionButton
import com.khandanirishta.app.ui.feature.settings.kit.ActionStyle
import com.khandanirishta.app.ui.feature.settings.kit.TintedIcon
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

/*
 * The dialogs and sheets of SET-ACCOUNT: pause (specs/08 section 7.1), close (7.3), reopen (7.4),
 * the gentler options before deleting (06 section 9.1) and the one-time "Mubarak" note.
 */

/** "Pause the profile?" with its consequences, "Pause" and "Cancel" (08 section 7.1). */
@Composable
internal fun PauseDialog(
    busy: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    ConfirmDialog(
        title = stringResource(R.string.settings_account_status_pause_title),
        text = stringResource(R.string.settings_account_status_pause_body),
        confirmLabel = stringResource(R.string.settings_account_status_pause_confirm),
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        busy = busy,
    )
}

/**
 * "Close the profile?" with the required reason (`closed_reason` from the reference data) and the
 * consequences under the choices (08 section 7.3).
 */
@Composable
internal fun CloseProfileDialog(
    busy: Boolean,
    online: Boolean,
    onConfirm: (ClosedReason) -> Unit,
    onDismiss: () -> Unit,
) {
    val reference = LocalReference.current
    val reasons =
        remember(reference) {
            reference
                .optionsOf(Lists.CLOSED_REASON, ClosedReason.entries)
                .ifEmpty { CLOSED_REASON_FALLBACK.map { it to Reference.fallback(it.wire) } }
        }
    var chosen by rememberSaveable { mutableStateOf<String?>(null) }
    val reason = reasons.firstOrNull { it.first.wire == chosen }?.first
    val canConfirm = reason != null && online && !busy
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.settings_account_status_close_title)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    stringResource(R.string.settings_account_status_close_reason_label),
                    style = MaterialTheme.typography.labelLarge,
                )
                RadioList(
                    options = reasons.map { (value, label) -> Option(value.wire, label) },
                    selected = chosen,
                    onSelect = { chosen = it },
                )
                Text(
                    stringResource(R.string.settings_account_status_close_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { reason?.let(onConfirm) }, enabled = canConfirm) {
                Text(
                    stringResource(R.string.settings_account_status_close_confirm),
                    color = if (canConfirm) MaterialTheme.colorScheme.error else Color.Unspecified,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    )
}

/**
 * "Reopen the profile?", or, when the profile was closed after a confirmed nikah, "Reopen after a
 * nikah?" with REOPEN to type (08 section 7.4). Both call `POST /v1/me/profile/reopen`.
 */
@Composable
internal fun ReopenDialog(
    nikah: NikahCheck,
    busy: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val afterNikah = nikah.found
    val partner = nikah.partnerName ?: stringResource(R.string.settings_account_status_reopen_member_fallback)
    ConfirmDialog(
        title =
            if (afterNikah) {
                stringResource(R.string.settings_account_status_reopen_nikah_title)
            } else {
                stringResource(R.string.settings_account_status_reopen_title)
            },
        text =
            if (afterNikah) {
                text(R.string.settings_account_status_reopen_nikah_body, "name" to partner)
            } else {
                stringResource(R.string.settings_account_status_reopen_body)
            },
        confirmLabel = stringResource(R.string.settings_account_status_reopen_confirm),
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        busy = busy,
        typedPhrase = if (afterNikah) REOPEN_PHRASE else null,
    )
}

/**
 * The gentler options shown before the deletion confirmation (06 section 9.1, 16 section 6.27):
 * pause or close the profile when its status allows it, or continue to delete.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun GentleOptionsSheet(
    status: ProfileStatus,
    onPause: () -> Unit,
    onClose: () -> Unit,
    onContinue: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalSheetState(skipPartiallyExpanded = true),
        modifier = modifier,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.settings_account_delete_gentle_title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                stringResource(R.string.settings_account_delete_gentle_text),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (canPauseProfile(status)) {
                GentleOptionCard(
                    icon = Icons.Outlined.PauseCircle,
                    title = stringResource(R.string.settings_account_delete_gentle_pause),
                    onClick = onPause,
                )
            }
            if (canCloseProfile(status)) {
                GentleOptionCard(
                    icon = Icons.Outlined.VisibilityOff,
                    title = stringResource(R.string.settings_account_delete_gentle_close),
                    onClick = onClose,
                )
            }
            Spacer(Modifier.height(4.dp))
            ActionButton(
                text = stringResource(R.string.settings_account_delete_gentle_continue),
                style = ActionStyle.DANGER_OUTLINED,
                onClick = onContinue,
            )
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.common_actions_cancel))
            }
        }
    }
}

@Composable
private fun GentleOptionCard(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            TintedIcon(
                icon = icon,
                tint = KrTheme.colors.warning,
                container = KrTheme.colors.warningContainer,
            )
            Spacer(Modifier.width(14.dp))
            Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * "Mubarak!" once, after closing because the match was found here, with "Open my connections"
 * (APP-CHATS, specs/08 section 7.3).
 */
@Composable
internal fun MubarakDialog(
    onOpenConnections: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(Icons.Outlined.Celebration, contentDescription = null, tint = MaterialTheme.colorScheme.tertiary)
        },
        title = { Text(stringResource(R.string.settings_account_status_close_mubarak_title)) },
        text = { Text(stringResource(R.string.settings_account_status_close_mubarak)) },
        confirmButton = {
            TextButton(onClick = onOpenConnections) {
                Text(stringResource(R.string.settings_account_status_close_open_connections))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_actions_close)) }
        },
    )
}

/** The phrase typed to reopen after a nikah (08 section 7.4). */
private const val REOPEN_PHRASE = "REOPEN"

/** Reasons in the order of 08 section 7.3, for when the reference data has none. */
private val CLOSED_REASON_FALLBACK =
    listOf(
        ClosedReason.FOUND_MATCH_HERE,
        ClosedReason.FOUND_MATCH_ELSEWHERE,
        ClosedReason.TAKING_A_BREAK,
        ClosedReason.OTHER,
    )
