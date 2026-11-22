package com.khandanirishta.app.ui.feature.settings

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.ClosedReason
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.NudgeCard
import com.khandanirishta.app.ui.components.OrnamentRule
import com.khandanirishta.app.ui.components.RadioList
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

/*
 * The dialogs and sheets of SET-ACCOUNT: pause (specs/08 section 7.1), close (7.3), reopen (7.4),
 * the gentler options before deleting (06 section 9.1) and the one-time "Mubarak" note. Ink
 * confirms what can be undone; danger confirms only what destroys something.
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
        variant = KrButtonVariant.INK,
        busy = busy,
    )
}

/**
 * "Close the profile?" with the required reason (`closed_reason` from the reference data) and the
 * consequences under the choices (08 section 7.3). Closing ends every open interest, so danger
 * confirms it.
 */
@Composable
internal fun CloseProfileDialog(
    busy: Boolean,
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
    val options = remember(reasons) { reasons.map { (value, label) -> Option(value.wire, label) } }
    var chosen by rememberSaveable { mutableStateOf<String?>(null) }
    val reason = reasons.firstOrNull { it.first.wire == chosen }?.first
    KrSheet(
        title = stringResource(R.string.settings_account_status_close_title),
        onDismissRequest = onDismiss,
        dismissible = !busy,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.settings_account_status_close_confirm),
                onConfirm = { reason?.let(onConfirm) },
                onCancel = onDismiss,
                variant = KrButtonVariant.DANGER,
                enabled = reason != null,
                busy = busy,
            )
        },
    ) {
        FieldLabel(stringResource(R.string.settings_account_status_close_reason_label))
        RadioList(options = options, selected = chosen, onSelect = { chosen = it }, enabled = !busy)
        Text(
            text = stringResource(R.string.settings_account_status_close_body),
            style = MaterialTheme.typography.bodyMedium,
            color = KrTheme.colors.textSecondary,
        )
    }
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
 * pause or close the profile when its status allows it, or continue to delete. Continuing only
 * opens the confirmation, so it is not danger yet.
 */
@Composable
internal fun GentleOptionsSheet(
    status: ProfileStatus,
    onPause: () -> Unit,
    onClose: () -> Unit,
    onContinue: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KrSheet(
        title = stringResource(R.string.settings_account_delete_gentle_title),
        description = stringResource(R.string.settings_account_delete_gentle_text),
        onDismissRequest = onDismiss,
        modifier = modifier,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.settings_account_delete_gentle_continue),
                onConfirm = onContinue,
                onCancel = onDismiss,
                variant = KrButtonVariant.INK,
                needsNetwork = false,
            )
        },
    ) {
        if (canPauseProfile(status)) {
            NudgeCard(
                title = stringResource(R.string.settings_account_delete_gentle_pause),
                icon = Icons.Outlined.PauseCircle,
                tone = ArchTone.WARNING,
                onClick = onPause,
            )
        }
        if (canCloseProfile(status)) {
            NudgeCard(
                title = stringResource(R.string.settings_account_delete_gentle_close),
                icon = Icons.Outlined.VisibilityOff,
                tone = ArchTone.WARNING,
                onClick = onClose,
            )
        }
    }
}

/**
 * "Mubarak!" once, after closing because the match was found here, with "Open my connections"
 * (APP-CHATS, specs/08 section 7.3): the word in serif under the gold rule.
 */
@Composable
internal fun MubarakDialog(
    onOpenConnections: () -> Unit,
    onDismiss: () -> Unit,
) {
    KrDialog(
        confirmLabel = stringResource(R.string.settings_account_status_close_open_connections),
        onConfirm = onOpenConnections,
        onDismissRequest = onDismiss,
        dismissLabel = stringResource(R.string.common_actions_close),
    ) {
        OrnamentRule()
        Text(
            text = stringResource(R.string.settings_account_status_close_mubarak_title),
            style = MaterialTheme.typography.displaySmall,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.settings_account_status_close_mubarak),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
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
