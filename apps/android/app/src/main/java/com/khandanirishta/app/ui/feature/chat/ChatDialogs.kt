package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.MemberEndReason
import com.khandanirishta.app.core.network.generated.model.ReportReason
import com.khandanirishta.app.ui.components.BlockDialog
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.RadioList
import com.khandanirishta.app.ui.components.ReportDialog
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

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
 * reached (16 section 6.12). Screen-specific dialogs are drawn by the screens.
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
            EndConnectionDialog(
                name = name,
                canBlock = canBlockOnEnd,
                busy = busy == ConnectionAction.END,
                online = core.online,
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
            )
        }

        ConnectionDialog.SafetyTips -> {
            SafetyTipsDialog(onDismiss = actions.close)
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
        reference
            .options(Lists.CONNECTION_END_REASON)
            .mapNotNull { option -> MEMBER_END_REASONS.firstOrNull { it.wire == option.code } }
            .ifEmpty { MEMBER_END_REASONS }
    return ordered.map { reason ->
        val label =
            endReasonLabel(reason)?.let { stringResource(it) }
                ?: reference.option(Lists.CONNECTION_END_REASON, reason)
        Option(reason.wire, label)
    }
}

/**
 * "End this connection?" (16 section 6.12): the consequences, a required reason, and "Also block
 * {name}", ticked automatically for inappropriate behaviour.
 */
@Composable
private fun EndConnectionDialog(
    name: String,
    canBlock: Boolean,
    busy: Boolean,
    online: Boolean,
    onConfirm: (MemberEndReason, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var reason by rememberSaveable { mutableStateOf<String?>(null) }
    var alsoBlock by rememberSaveable { mutableStateOf(false) }
    var showRequired by rememberSaveable { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.chat_end_title)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(text(R.string.chat_end_text, "name" to name), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.chat_end_reason_label), style = MaterialTheme.typography.labelLarge)
                RadioList(
                    options = endReasonOptions(),
                    selected = reason,
                    onSelect = { code ->
                        reason = code
                        showRequired = false
                        if (code == MemberEndReason.INAPPROPRIATE_BEHAVIOUR.wire) alsoBlock = true
                    },
                )
                if (showRequired) {
                    Text(
                        stringResource(R.string.chat_end_reason_required),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                if (canBlock) {
                    CheckboxRow(
                        checked = alsoBlock,
                        onCheckedChange = { alsoBlock = it },
                        label = text(R.string.chat_end_also_block, "name" to name),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val chosen = MEMBER_END_REASONS.firstOrNull { it.wire == reason }
                    if (chosen == null) showRequired = true else onConfirm(chosen, canBlock && alsoBlock)
                },
                enabled = !busy && online,
            ) {
                if (busy) {
                    ProgressLabel(label = "", busy = true)
                } else {
                    Text(stringResource(R.string.chat_end_confirm), color = MaterialTheme.colorScheme.error)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    )
}

/** The report confirmation of 13 section 6.4 with safety tip 12, for harassment and money reports. */
@Composable
private fun ReportTipDialog(onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        icon = { Icon(Icons.Outlined.HealthAndSafety, contentDescription = null) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.shared_report_success), style = MaterialTheme.typography.bodyLarge)
                Text(stringResource(R.string.shared_report_safety_tip), style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.common_actions_close)) } },
    )
}

/** The "Before you start" tips, opened from the conversation menu ("Safety tips"). */
@Composable
private fun SafetyTipsDialog(onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        },
        title = { Text(stringResource(R.string.chat_tips_title)) },
        text = { TipsList() },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_actions_close)) } },
    )
}

/** The four first-chat tips of 13 section 11.2. */
@Composable
internal fun TipsList(modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        TIPS.forEach { id ->
            Row {
                Text("•", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(end = 8.dp))
                Text(stringResource(id), style = MaterialTheme.typography.bodyMedium)
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

/** "Mubarak! May Allah bless this marriage." on the brand gradient, with the nikah guide. */
@Composable
private fun NikahMessage(
    muslim: Boolean,
    onGuide: () -> Unit,
    onClose: () -> Unit,
) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            Modifier
                .fillMaxSize()
                .background(KrTheme.colors.heroGradient)
                .padding(horizontal = 28.dp, vertical = 32.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Box(
                    Modifier
                        .size(104.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.16f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Celebration,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(56.dp),
                    )
                }
                val title = if (muslim) R.string.chat_stage_nikah_title else R.string.chat_stage_nikah_title_other
                Text(
                    stringResource(title),
                    style = MaterialTheme.typography.headlineSmall,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    stringResource(R.string.chat_stage_nikah_text),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.White.copy(alpha = 0.92f),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.size(8.dp))
                Button(
                    onClick = onClose,
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = Color.White,
                            contentColor = MaterialTheme.colorScheme.primary,
                        ),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp),
                ) { Text(stringResource(R.string.chat_stage_nikah_close)) }
                OutlinedButton(
                    onClick = onGuide,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.7f)),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp),
                ) {
                    Icon(
                        Icons.AutoMirrored.Outlined.MenuBook,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.chat_stage_nikah_guide))
                }
            }
        }
    }
}
