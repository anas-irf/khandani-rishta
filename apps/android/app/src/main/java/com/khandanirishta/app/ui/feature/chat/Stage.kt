package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.Party
import com.khandanirishta.app.core.network.generated.model.ProposableStage
import com.khandanirishta.app.ui.components.AnswerRow
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.RadioCardRow
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.SmallArchShape
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/**
 * The suggestion banner of `APP-CHAT` (16 section 6.11 block 2): "{name} suggests: {stage}." with
 * "Confirm" and "Not yet", or "You suggested: {stage}. Waiting for {name}." with "Withdraw". It
 * scrolls inside the height its caller allows, so the messages keep their room.
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
    val sentence =
        if (fromThem) {
            text(R.string.chat_stage_they_suggest, "name" to name, "stage" to stage)
        } else {
            text(R.string.chat_stage_you_suggested_short, "name" to name, "stage" to stage)
        }
    Surface(
        color = KrTheme.colors.warningContainer,
        contentColor = MaterialTheme.colorScheme.onSurface,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(
            modifier =
                Modifier
                    .verticalScroll(rememberScrollState())
                    .contentWidth()
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            IconText(
                icon = Icons.Outlined.Groups,
                text = sentence,
                style = MaterialTheme.typography.bodySmall,
                tint = KrTheme.colors.warning,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (canEngage) {
                ProposalAnswers(
                    proposalId = proposal.id,
                    fromThem = fromThem,
                    busy = busy,
                    online = online,
                    onAction = onAction,
                    size = KrButtonSize.DEFAULT,
                )
            }
        }
    }
}

/** "Confirm" and "Not yet" to their suggestion, or "Withdraw" of the member's own. */
@Composable
private fun ProposalAnswers(
    proposalId: String,
    fromThem: Boolean,
    busy: ConnectionAction?,
    online: Boolean,
    onAction: (StageAction) -> Unit,
    size: KrButtonSize,
) {
    val enabled = busy == null && online
    if (fromThem) {
        // The same order and widths as Decline and Accept elsewhere (DESIGN.md section 6.12).
        AnswerRow(
            secondary = { answer ->
                KrButton(
                    text = stringResource(R.string.chat_stage_not_yet),
                    onClick = { onAction(StageAction.Decline(proposalId)) },
                    variant = KrButtonVariant.SECONDARY,
                    size = size,
                    enabled = enabled,
                    loading = busy == ConnectionAction.DECLINE,
                    modifier = answer,
                )
            },
            primary = { answer ->
                KrButton(
                    text = stringResource(R.string.chat_stage_confirm),
                    onClick = { onAction(StageAction.Confirm(proposalId)) },
                    size = size,
                    enabled = enabled,
                    loading = busy == ConnectionAction.CONFIRM,
                    modifier = answer,
                )
            },
        )
    } else {
        KrButton(
            text = stringResource(R.string.chat_stage_withdraw),
            onClick = { onAction(StageAction.Cancel(proposalId)) },
            variant = KrButtonVariant.SECONDARY,
            size = size,
            enabled = enabled,
            loading = busy == ConnectionAction.CANCEL,
        )
    }
}

/**
 * The four stages (16 section 6.12): an arch per step, in a row while the names fit and one under
 * the other when they do not. A step that is reached differs in fill and in shape: the diamond
 * instead of its number, and no tick, which means verified.
 */
@Composable
internal fun StageTracker(
    stage: ConnectionStage,
    modifier: Modifier = Modifier,
) {
    val current = stage.order()
    val fontScale = LocalDensity.current.fontScale.coerceAtLeast(1f)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val inRow = maxWidth / TRACKER_STAGES.size >= StepWidth * fontScale
        if (inRow) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                TRACKER_STAGES.forEachIndexed { index, step ->
                    val spoken = spokenStep(step = step, reached = index <= current)
                    Column(
                        modifier =
                            Modifier
                                .weight(1f)
                                .clearAndSetSemantics { contentDescription = spoken }
                                .padding(horizontal = StepGap),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
                    ) {
                        StepArch(index = index, reached = index <= current)
                        StepName(step = step, reached = index <= current, textAlign = TextAlign.Center)
                    }
                }
            }
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
                TRACKER_STAGES.forEachIndexed { index, step ->
                    val spoken = spokenStep(step = step, reached = index <= current)
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clearAndSetSemantics { contentDescription = spoken },
                        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        StepArch(index = index, reached = index <= current)
                        StepName(step = step, reached = index <= current, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/** A step is one thing to TalkBack: its name and whether it is reached. */
@Composable
private fun spokenStep(
    step: ConnectionStage,
    reached: Boolean,
): String {
    val label = if (reached) R.string.chat_stage_step_reached else R.string.chat_stage_step_not_reached
    return text(label, "stage" to stringResource(stageLabel(step)))
}

@Composable
private fun StepArch(
    index: Int,
    reached: Boolean,
) {
    val colors = MaterialTheme.colorScheme
    val look =
        if (reached) {
            Modifier.background(colors.primary, SmallArchShape)
        } else {
            Modifier.border(Strokes.control, colors.outline, SmallArchShape)
        }
    Box(Modifier.size(Sizes.archIconSmall).then(look), contentAlignment = Alignment.Center) {
        if (reached) {
            Diamond(color = colors.onPrimary)
        } else {
            Text(
                text = "${index + 1}",
                style = MaterialTheme.typography.labelMedium.merge(KrType.numbers),
                color = colors.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StepName(
    step: ConnectionStage,
    reached: Boolean,
    modifier: Modifier = Modifier,
    textAlign: TextAlign = TextAlign.Start,
) {
    val colors = MaterialTheme.colorScheme
    Text(
        text = stringResource(stageLabel(step)),
        style = KrType.caption,
        fontWeight = if (reached) FontWeight.Bold else null,
        color = if (reached) colors.onSurface else colors.onSurfaceVariant,
        textAlign = textAlign,
        modifier = modifier,
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
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        when {
            connection.stage == ConnectionStage.NIKAH_DONE -> {
                IconText(
                    icon = Icons.Outlined.Celebration,
                    text = text(R.string.chat_stage_done, "stage" to stringResource(stageLabel(connection.stage))),
                    style = MaterialTheme.typography.titleSmall,
                    tint = MaterialTheme.colorScheme.primary,
                )
            }

            proposal != null && proposal.proposedBy == Party.ME -> {
                Text(
                    text(
                        R.string.chat_stage_you_suggested,
                        "stage" to stringResource(stageLabel(proposal.stage)),
                        "name" to name,
                    ),
                )
                if (canEngage) {
                    ProposalAnswers(
                        proposalId = proposal.id,
                        fromThem = false,
                        busy = busy,
                        online = online,
                        onAction = onAction,
                        size = KrButtonSize.LARGE,
                    )
                }
            }

            proposal != null && proposal.proposedBy == Party.THEM -> {
                Text(
                    text(
                        R.string.chat_stage_they_suggest,
                        "name" to name,
                        "stage" to stringResource(stageLabel(proposal.stage)),
                    ),
                )
                if (canEngage) {
                    ProposalAnswers(
                        proposalId = proposal.id,
                        fromThem = true,
                        busy = busy,
                        online = online,
                        onAction = onAction,
                        size = KrButtonSize.LARGE,
                    )
                }
            }

            canEngage && laterStages(connection.stage).isNotEmpty() -> {
                KrButton(
                    text = stringResource(R.string.chat_stage_suggest),
                    onClick = onSuggest,
                    variant = KrButtonVariant.SECONDARY,
                    enabled = busy == null && online,
                )
            }
        }
    }
}

/**
 * "Suggest the next step": the stages later than the current one, each with its name and one line
 * of explanation (16 section 6.12). Choosing one and confirming sends the suggestion.
 */
@Composable
internal fun SuggestStageSheet(
    current: ConnectionStage,
    busy: Boolean,
    onSuggest: (ProposableStage) -> Unit,
    onDismiss: () -> Unit,
) {
    val options = remember(current) { laterStages(current) }
    var selected by rememberSaveable { mutableStateOf(options.firstOrNull()?.wire) }
    val chosen = options.firstOrNull { it.wire == selected }
    KrSheet(
        title = stringResource(R.string.chat_stage_suggest),
        onDismissRequest = onDismiss,
        dismissible = !busy,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.chat_stage_suggest_confirm),
                onConfirm = { chosen?.let(onSuggest) },
                onCancel = onDismiss,
                enabled = chosen != null,
                busy = busy,
            )
        },
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().selectableGroup(),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            options.forEach { stage ->
                RadioCardRow(
                    title = stringResource(stageLabel(stage.toStage())),
                    helper = stringResource(stageExplanation(stage)),
                    selected = stage.wire == selected,
                    enabled = !busy,
                    onClick = { selected = stage.wire },
                )
            }
        }
    }
}

/** What "confirmed" and "completed" need at 100% text, with the gap on each side. */
private val StepWidth = 78.dp
private val StepGap = 2.dp
