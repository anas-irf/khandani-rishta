package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material.icons.outlined.Handshake
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.Party
import com.khandanirishta.app.core.network.generated.model.ProposableStage
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text

/** A button label, or a small spinner while its request runs. */
@Composable
internal fun ProgressLabel(
    label: String,
    busy: Boolean,
    modifier: Modifier = Modifier,
) {
    if (busy) {
        CircularProgressIndicator(
            modifier = modifier.size(18.dp),
            color = LocalContentColor.current,
            strokeWidth = 2.dp,
        )
    } else {
        Text(label, modifier = modifier)
    }
}

/**
 * The suggestion banner of `APP-CHAT` (16 section 6.11 block 2): "{name} suggests: {stage}." with
 * "Confirm" and "Not yet", or "You suggested: {stage}. Waiting for {name}." with "Withdraw".
 */
@Composable
internal fun ProposalBanner(
    connection: Connection,
    name: String,
    canEngage: Boolean,
    busy: ConnectionAction?,
    online: Boolean,
    onAction: (StageAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val proposal = connection.pendingStageProposal ?: return
    if (connection.status != ConnectionStatus.ACTIVE) return
    val stage = stringResource(stageLabel(proposal.stage))
    val fromThem = proposal.proposedBy == Party.THEM
    val enabled = busy == null && online
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = if (canEngage) 2.dp else 10.dp)) {
            Row(Modifier.padding(end = 8.dp), verticalAlignment = Alignment.Top) {
                Icon(
                    Icons.Outlined.Handshake,
                    contentDescription = null,
                    modifier =
                        Modifier
                            .padding(top = 1.dp)
                            .size(20.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    if (fromThem) {
                        text(R.string.chat_stage_they_suggest, "name" to name, "stage" to stage)
                    } else {
                        text(R.string.chat_stage_you_suggested_short, "name" to name, "stage" to stage)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (canEngage) {
                Row(Modifier.align(Alignment.End), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (fromThem) {
                        TextButton(onClick = { onAction(StageAction.Decline(proposal.id)) }, enabled = enabled) {
                            ProgressLabel(stringResource(R.string.chat_stage_not_yet), busy == ConnectionAction.DECLINE)
                        }
                        TextButton(onClick = { onAction(StageAction.Confirm(proposal.id)) }, enabled = enabled) {
                            ProgressLabel(stringResource(R.string.chat_stage_confirm), busy == ConnectionAction.CONFIRM)
                        }
                    } else {
                        TextButton(onClick = { onAction(StageAction.Cancel(proposal.id)) }, enabled = enabled) {
                            ProgressLabel(stringResource(R.string.chat_stage_withdraw), busy == ConnectionAction.CANCEL)
                        }
                    }
                }
            }
        }
    }
}

/** Four steps in a row, labelled with the stage names; steps up to the stage are filled (16 section 6.12). */
@Composable
internal fun StageTracker(
    stage: ConnectionStage,
    modifier: Modifier = Modifier,
) {
    val current = stage.order()
    val colors = MaterialTheme.colorScheme
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        TRACKER_STAGES.forEachIndexed { index, step ->
            val reached = index <= current
            val name = stringResource(stageLabel(step))
            val stepLabel = if (reached) R.string.chat_stage_step_reached else R.string.chat_stage_step_not_reached
            val description = text(stepLabel, "stage" to name)
            Column(
                Modifier
                    .weight(1f)
                    .clearAndSetSemantics { contentDescription = description },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Connector(visible = index > 0, filled = index <= current, modifier = Modifier.weight(1f))
                    Box(
                        Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(if (reached) colors.primary else colors.surfaceContainerLowest)
                            .border(2.dp, if (reached) colors.primary else colors.outlineVariant, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (reached) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = null,
                                tint = colors.onPrimary,
                                modifier = Modifier.size(18.dp),
                            )
                        } else {
                            Text(
                                "${index + 1}",
                                style = MaterialTheme.typography.labelLarge,
                                color = colors.onSurfaceVariant,
                            )
                        }
                    }
                    Connector(
                        visible = index < TRACKER_STAGES.lastIndex,
                        filled = index < current,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    name,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = if (index == current) FontWeight.SemiBold else null,
                    color = if (reached) colors.onSurface else colors.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun Connector(
    visible: Boolean,
    filled: Boolean,
    modifier: Modifier = Modifier,
) {
    val color =
        when {
            !visible -> Color.Transparent
            filled -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.outlineVariant
        }
    Box(
        modifier
            .height(2.dp)
            .background(color),
    )
}

/**
 * The controls under the tracker (16 section 6.12 "Stage block"): the pending suggestion with its
 * answers, "Suggest the next step", or the Mubarak line. The controls need `engage`.
 */
@Composable
internal fun StageControls(
    connection: Connection,
    name: String,
    canEngage: Boolean,
    busy: ConnectionAction?,
    online: Boolean,
    onAction: (StageAction) -> Unit,
    onSuggest: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val proposal = connection.pendingStageProposal
    val enabled = busy == null && online
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            connection.stage == ConnectionStage.NIKAH_DONE -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.Celebration,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text(R.string.chat_stage_done, "stage" to stringResource(stageLabel(connection.stage))),
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
            }

            proposal != null && proposal.proposedBy == Party.ME -> {
                Text(
                    text(
                        R.string.chat_stage_you_suggested,
                        "stage" to stringResource(stageLabel(proposal.stage)),
                        "name" to name,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (canEngage) {
                    OutlinedButton(onClick = { onAction(StageAction.Cancel(proposal.id)) }, enabled = enabled) {
                        ProgressLabel(stringResource(R.string.chat_stage_withdraw), busy == ConnectionAction.CANCEL)
                    }
                }
            }

            proposal != null && proposal.proposedBy == Party.THEM -> {
                Text(
                    text(
                        R.string.chat_stage_they_suggest,
                        "name" to name,
                        "stage" to stringResource(stageLabel(proposal.stage)),
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (canEngage) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { onAction(StageAction.Confirm(proposal.id)) }, enabled = enabled) {
                            ProgressLabel(stringResource(R.string.chat_stage_confirm), busy == ConnectionAction.CONFIRM)
                        }
                        OutlinedButton(onClick = { onAction(StageAction.Decline(proposal.id)) }, enabled = enabled) {
                            ProgressLabel(stringResource(R.string.chat_stage_not_yet), busy == ConnectionAction.DECLINE)
                        }
                    }
                }
            }

            canEngage && laterStages(connection.stage).isNotEmpty() -> {
                OutlinedButton(onClick = onSuggest, enabled = enabled) {
                    Text(stringResource(R.string.chat_stage_suggest))
                }
            }
        }
    }
}

/**
 * "Suggest the next step": the stages later than the current one, each with its name and one line
 * of explanation (16 section 6.12). Choosing one and confirming sends the suggestion.
 */
@Composable
internal fun SuggestStageDialog(
    current: ConnectionStage,
    busy: Boolean,
    online: Boolean,
    onSuggest: (ProposableStage) -> Unit,
    onDismiss: () -> Unit,
) {
    val options = remember(current) { laterStages(current) }
    var selected by rememberSaveable { mutableStateOf(options.firstOrNull()?.wire) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.chat_stage_suggest)) },
        text = {
            Column(
                Modifier
                    .selectableGroup()
                    .verticalScroll(rememberScrollState()),
            ) {
                options.forEach { stage ->
                    val isSelected = stage.wire == selected
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 56.dp)
                            .clip(MaterialTheme.shapes.medium)
                            .selectable(
                                selected = isSelected,
                                role = Role.RadioButton,
                                onClick = { selected = stage.wire },
                            ).padding(vertical = 8.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        RadioButton(selected = isSelected, onClick = null)
                        Spacer(Modifier.width(12.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                stringResource(stageLabel(stage.toStage())),
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                stringResource(stageExplanation(stage)),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { options.firstOrNull { it.wire == selected }?.let(onSuggest) },
                enabled = selected != null && !busy && online,
            ) { ProgressLabel(stringResource(R.string.chat_stage_suggest_confirm), busy) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    )
}
