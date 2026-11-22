package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.MemberEndReason
import com.khandanirishta.app.core.network.generated.model.ReportReason
import com.khandanirishta.app.ui.components.BlockDialog
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.FirstLineMark
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.RadioList
import com.khandanirishta.app.ui.components.ReportDialog
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing

/** What the shared connection dialogs can do; built once per screen. */
@Stable
internal class ConnectionDialogActions(
    val close: () -> Unit,
    val report: (reason: String, details: String, alsoBlock: Boolean) -> Unit,
    val block: () -> Unit,
    val end: (MemberEndReason, Boolean) -> Unit,
    val acceptReportOffer: () -> Unit,
    val pause: () -> Unit,
    val dismissFollowUp: () -> Unit,
    val announceStage: (String) -> Unit,
    val openNikahGuide: () -> Unit,
)

/**
 * The dialogs `APP-CHAT` and `APP-CONNECTION` share: report (with the tip of 13 section 11.3),
 * block, end connection and its report offer, the safety tips, and the follow-ups after a stage is
 * reached (16 section 6.12). What needs a choice is a sheet and a short answer is a dialog
 * (DESIGN.md section 6.13). Screen-specific ones are drawn by the screens.
 */
@Composable
internal fun ConnectionDialogs(
    core: ConnectionCore,
    name: String,
    canBlockOnEnd: Boolean,
    actions: ConnectionDialogActions,
) {
    val busy = core.busy
    when (val dialog = core.dialog) {
        is ConnectionDialog.Report -> {
            ReportDialog(
                name = dialog.name,
                reasons = reportReasons(),
                onSubmit = actions.report,
                onDismiss = actions.close,
                busy = busy == ConnectionAction.REPORT,
                initialReason = dialog.reason,
            )
        }

        is ConnectionDialog.ReportTip -> {
            ReportTipDialog(onClose = actions.close)
        }

        is ConnectionDialog.Block -> {
            BlockDialog(
                name = dialog.name,
                onConfirm = actions.block,
                onDismiss = actions.close,
                busy = busy == ConnectionAction.BLOCK,
            )
        }

        ConnectionDialog.End -> {
            EndConnectionSheet(
                name = name,
                canBlock = canBlockOnEnd,
                busy = busy == ConnectionAction.END,
                onConfirm = actions.end,
                onDismiss = actions.close,
            )
        }

        is ConnectionDialog.ReportOffer -> {
            ConfirmDialog(
                title = text(R.string.chat_end_report_offer, "name" to dialog.name),
                text = null,
                confirmLabel = stringResource(R.string.chat_end_report),
                onConfirm = actions.acceptReportOffer,
                onDismiss = actions.close,
                dismissLabel = stringResource(R.string.chat_end_no),
                // It only opens the report; sending that waits for the network.
                needsNetwork = false,
            )
        }

        ConnectionDialog.SafetyTips -> {
            SafetyTipsSheet(onDismiss = actions.close)
        }

        else -> {}
    }
    StageFollowUp(core = core, actions = actions)
}

/** The reasons of `options.report_reason` this build can send, in the API's order. */
@Composable
private fun reportReasons(): List<Option> {
    val reference = LocalReference.current
    return remember(reference) {
        reference.options(Lists.REPORT_REASON).filter { option ->
            ReportReason.entries.any { it.wire == option.code && it != ReportReason.UNKNOWN }
        }
    }
}

/** The member-selectable rows of `options.connection_end_reason`, with this dialog's wording (16 section 6.12). */
@Composable
private fun endReasonOptions(): List<Option> {
    val reference = LocalReference.current
    val ordered =
        remember(reference) {
            reference
                .options(Lists.CONNECTION_END_REASON)
                .mapNotNull { option -> MEMBER_END_REASONS.firstOrNull { it.wire == option.code } }
                .ifEmpty { MEMBER_END_REASONS }
        }
    return ordered.map { reason ->
        val label =
            endReasonLabel(reason)?.let { stringResource(it) }
                ?: reference.option(Lists.CONNECTION_END_REASON, reason)
        Option(reason.wire, label)
    }
}

/**
 * "End this connection?" (16 section 6.12): the consequences, a required reason, and "Also block
 * {name}", ticked automatically for inappropriate behaviour. Danger is only on the button that
 * confirms it.
 */
@Composable
internal fun EndConnectionSheet(
    name: String,
    canBlock: Boolean,
    busy: Boolean,
    onConfirm: (MemberEndReason, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var reason by rememberSaveable { mutableStateOf<String?>(null) }
    var alsoBlock by rememberSaveable { mutableStateOf(false) }
    var showRequired by rememberSaveable { mutableStateOf(false) }
    KrSheet(
        title = stringResource(R.string.chat_end_title),
        description = text(R.string.chat_end_text, "name" to name),
        onDismissRequest = onDismiss,
        dismissible = !busy,
        actions = {
            // With the buttons, so it is on screen however far the reasons have scrolled.
            if (showRequired) {
                FieldSupport(
                    helper = null,
                    error = stringResource(R.string.chat_end_reason_required),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
            }
            SheetAnswers(
                confirmLabel = stringResource(R.string.chat_end_confirm),
                onConfirm = {
                    val chosen = MEMBER_END_REASONS.firstOrNull { it.wire == reason }
                    if (chosen == null) showRequired = true else onConfirm(chosen, canBlock && alsoBlock)
                },
                onCancel = onDismiss,
                variant = KrButtonVariant.DANGER,
                busy = busy,
            )
        },
    ) {
        FieldLabel(stringResource(R.string.chat_end_reason_label))
        RadioList(
            options = endReasonOptions(),
            selected = reason,
            enabled = !busy,
            onSelect = { code ->
                reason = code
                showRequired = false
                if (code == MemberEndReason.INAPPROPRIATE_BEHAVIOUR.wire) alsoBlock = true
            },
        )
        if (canBlock) {
            CheckboxRow(
                checked = alsoBlock,
                onCheckedChange = { alsoBlock = it },
                label = text(R.string.chat_end_also_block, "name" to name),
                enabled = !busy,
            )
        }
    }
}

/** The report confirmation of 13 section 6.4 with safety tip 12, for harassment and money reports. */
@Composable
private fun ReportTipDialog(onClose: () -> Unit) {
    KrDialog(
        confirmLabel = stringResource(R.string.common_actions_close),
        onConfirm = onClose,
        onDismissRequest = onClose,
    ) {
        IconText(
            icon = Icons.Outlined.HealthAndSafety,
            text = stringResource(R.string.shared_report_success),
            style = MaterialTheme.typography.titleSmall,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Text(stringResource(R.string.shared_report_safety_tip), style = MaterialTheme.typography.bodyMedium)
    }
}

/** The "Before you start" tips, opened from the conversation menu ("Safety tips"). */
@Composable
private fun SafetyTipsSheet(onDismiss: () -> Unit) {
    KrSheet(
        title = stringResource(R.string.chat_tips_title),
        onDismissRequest = onDismiss,
        actions = {
            KrButton(
                text = stringResource(R.string.common_actions_close),
                onClick = onDismiss,
                variant = KrButtonVariant.SECONDARY,
                size = KrButtonSize.LARGE,
                fullWidth = true,
            )
        },
    ) {
        TipsList()
    }
}

/** The four first-chat tips of 13 section 11.2, each after its diamond. */
@Composable
internal fun TipsList(modifier: Modifier = Modifier) {
    val style = MaterialTheme.typography.bodySmall
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        TIPS.forEach { id ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
                FirstLineMark(style) { Diamond() }
                Text(stringResource(id), style = style, modifier = Modifier.weight(1f))
            }
        }
    }
}

private val TIPS =
    listOf(R.string.chat_tips_respect, R.string.chat_tips_money, R.string.chat_tips_phone, R.string.chat_tips_report)

/**
 * The follow-up after a stage is reached (16 section 6.12, 11 section 9.4): a toast for
 * `families_talking`, the pause offer for `engaged`, and the full-screen message for `nikah_done`.
 */
@Composable
private fun StageFollowUp(
    core: ConnectionCore,
    actions: ConnectionDialogActions,
) {
    when (core.followUp) {
        ConnectionStage.FAMILIES_TALKING -> {
            val stage = stringResource(stageLabel(ConnectionStage.FAMILIES_TALKING))
            val announce by rememberUpdatedState(actions.announceStage)
            LaunchedEffect(Unit) { announce(stage) }
        }

        ConnectionStage.ENGAGED -> {
            ConfirmDialog(
                title = stringResource(R.string.chat_stage_engaged_title),
                text = stringResource(R.string.chat_stage_engaged_text),
                confirmLabel = stringResource(R.string.chat_stage_engaged_pause),
                onConfirm = actions.pause,
                onDismiss = actions.dismissFollowUp,
                dismissLabel = stringResource(R.string.chat_stage_engaged_not_now),
                busy = core.busy == ConnectionAction.PAUSE,
            )
        }

        ConnectionStage.NIKAH_DONE -> {
            NikahMessage(muslim = core.muslim, onGuide = actions.openNikahGuide, onClose = actions.dismissFollowUp)
        }

        else -> {}
    }
}
