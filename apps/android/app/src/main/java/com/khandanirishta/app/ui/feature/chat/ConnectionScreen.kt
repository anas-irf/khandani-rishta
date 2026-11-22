package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.EndedBy
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.IconTextLine
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.NoLongerAvailable
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.RowEnd
import com.khandanirishta.app.ui.components.RowSkeleton
import com.khandanirishta.app.ui.components.SectionCard
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.components.SwitchRow
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.components.bandToneAt
import com.khandanirishta.app.ui.components.exceptBottom
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.SmallArchShape
import com.khandanirishta.app.ui.theme.Spacing

/** What the parts of the connection details can do; built once per screen. */
@Immutable
internal class ConnectionDetailsActions(
    val viewProfile: (id: String) -> Unit,
    val stage: (StageAction) -> Unit,
    val suggest: () -> Unit,
    val share: () -> Unit,
    val stopSharing: () -> Unit,
    val dismissHint: () -> Unit,
    val setMuted: (Boolean) -> Unit,
    val setArchived: (Boolean) -> Unit,
    val call: (phone: String) -> Unit,
    val whatsApp: (phone: String) -> Unit,
    val email: (address: String) -> Unit,
    val safetyTips: () -> Unit,
    val nikahGuide: () -> Unit,
    val end: () -> Unit,
    val report: () -> Unit,
    val block: () -> Unit,
)

/**
 * APP-CONNECTION: everything about one connection that is not the conversation (specs/16 section
 * 6.12): the member, the stage tracker and suggestions, both sides' contact details, chat
 * settings, help links, and ending, reporting or blocking. An ended connection shows when and why
 * it ended and keeps "Report" and "Block".
 *
 * ConnectionHost is the stateful half of this screen. What is under it takes state and lambdas.
 */
@Suppress("ktlint:compose:vm-forwarding-check")
@Composable
fun ConnectionScreen(
    connectionId: String,
    modifier: Modifier = Modifier,
    viewModel: ConnectionViewModel =
        hiltViewModel<ConnectionViewModel, ConnectionViewModel.Factory> { it.create(connectionId) },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    // Back from `SET-CONTACTS` with a share in progress: the sheet opens again (08 section 3.5).
    LifecycleResumeEffect(viewModel) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is ConnectionEvent.Leave -> navigator.backToChats(event.blockedProfileId)
            }
        }
    }
    val core = state.core
    val connection = core.connection
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            DetailTopBar(title = stringResource(R.string.chat_connection_title), onBack = { navigator.back() })
        },
    ) { padding ->
        val aboveAndBeside = padding.exceptBottom()
        Box(Modifier.fillMaxSize().padding(aboveAndBeside).consumeWindowInsets(aboveAndBeside)) {
            when {
                core.notFound -> {
                    StateScreen { NoLongerAvailable(onBack = { navigator.back() }) }
                }

                connection != null -> {
                    ConnectionHost(state = state, connection = connection, viewModel = viewModel)
                }

                core.error != null -> {
                    StateScreen { ErrorState(error = core.error, onRetry = { viewModel.retry() }) }
                }

                else -> {
                    DetailsSkeleton()
                }
            }
        }
    }
}

/** The stateful half: navigation, the links out of the app and the sheets over the details. */
@Composable
private fun ConnectionHost(
    state: ConnectionUiState,
    connection: Connection,
    viewModel: ConnectionViewModel,
) {
    val me = LocalMe.current
    val navigator = LocalNavigator.current
    val links = rememberLinkOpener()
    val core = state.core
    val name = otherName(connection)
    val status = me?.profile?.status
    // Sharing contact details and the stage controls need `engage`; the rest only `connected`.
    val canEngage = status == ProfileStatus.ACTIVE || status == ProfileStatus.PAUSED

    // Only the screen on display claims a stage follow-up, so it never shows twice.
    LaunchedEffect(core.pendingFollowUp) {
        if (core.pendingFollowUp != null) viewModel.claimFollowUp()
    }
    val actions =
        remember(viewModel, navigator, links) {
            ConnectionDetailsActions(
                viewProfile = { id -> navigator.push(Profile(id)) },
                stage = viewModel::stage,
                suggest = { viewModel.openDialog(ConnectionDialog.SuggestStage) },
                share = viewModel::openShare,
                stopSharing = { viewModel.openDialog(ConnectionDialog.StopSharing) },
                dismissHint = viewModel::dismissShareHint,
                setMuted = viewModel::setMuted,
                setArchived = viewModel::setArchived,
                call = { phone -> links.call(phone) },
                whatsApp = { phone -> links.whatsApp(phone) },
                email = { address -> links.email(address, subject = "") },
                safetyTips = { links.webPage("safety") },
                nikahGuide = { links.webPage("nikah-guide") },
                end = { viewModel.openDialog(ConnectionDialog.End) },
                report = { viewModel.openReport() },
                block = { viewModel.openBlock() },
            )
        }
    val dialogActions =
        remember(viewModel, links) {
            ConnectionDialogActions(
                close = viewModel::closeDialog,
                report = viewModel::report,
                block = viewModel::block,
                end = viewModel::end,
                acceptReportOffer = viewModel::acceptReportOffer,
                pause = viewModel::pauseProfile,
                dismissFollowUp = viewModel::dismissFollowUp,
                announceStage = viewModel::announceStage,
                openNikahGuide = { links.webPage("nikah-guide") },
            )
        }

    ConnectionDetailsContent(state = state, connection = connection, canEngage = canEngage, actions = actions)

    val share = state.share
    if (share.open) {
        ContactShareSheet(
            name = name,
            profile = state.ownProfile,
            profileError = share.profileError,
            selection = share.selection,
            missing = share.missing,
            busy = core.busy == ConnectionAction.SHARE,
            onRetry = viewModel::retryOwnProfile,
            onChange = viewModel::updateSelection,
            onAdd = { item, selection ->
                viewModel.rememberSelection(selection)
                navigator.push(ContactDetails(focus = item.focus, returnConnectionId = connection.id))
            },
            onShare = viewModel::share,
            onDismiss = viewModel::closeShare,
        )
    }
    when (core.dialog) {
        ConnectionDialog.StopSharing -> {
            ConfirmDialog(
                title = text(R.string.chat_connection_my_contact_stop_title, "name" to name),
                text = stringResource(R.string.chat_share_warning),
                confirmLabel = stringResource(R.string.chat_connection_my_contact_stop),
                onConfirm = viewModel::stopSharing,
                onDismiss = viewModel::closeDialog,
                // Negative, but it destroys nothing: ink (DESIGN.md section 6.1).
                variant = KrButtonVariant.INK,
                busy = core.busy == ConnectionAction.STOP_SHARING,
            )
        }

        ConnectionDialog.SuggestStage -> {
            SuggestStageSheet(
                current = connection.stage,
                busy = core.busy == ConnectionAction.PROPOSE,
                onSuggest = { stage -> viewModel.stage(StageAction.Propose(stage)) },
                onDismiss = viewModel::closeDialog,
            )
        }

        else -> {}
    }
    ConnectionDialogs(core = core, name = name, canBlockOnEnd = connection.other != null, actions = dialogActions)
}

/** The seven blocks of 16 section 6.12, each in its band. */
@Composable
internal fun ConnectionDetailsContent(
    state: ConnectionUiState,
    connection: Connection,
    canEngage: Boolean,
    actions: ConnectionDetailsActions,
    modifier: Modifier = Modifier,
) {
    val core = state.core
    val name = otherName(connection)
    val online = core.online
    val active = connection.status == ConnectionStatus.ACTIVE
    val hasOther = connection.other != null
    // The bands take turns after the member: four blocks while active, one once it ended.
    val helpIndex = if (active) ACTIVE_BLOCKS else ENDED_BLOCKS
    val showActions = active || hasOther
    val last = bandToneAt(if (showActions) helpIndex + 1 else helpIndex)
    val colors = MaterialTheme.colorScheme
    Column(
        modifier
            .fillMaxSize()
            .background(if (last == BandTone.SAND) colors.surfaceContainer else colors.background)
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding(),
    ) {
        Band(tone = BandTone.SAND, padding = BandDefaults.compactPadding) {
            MemberBlock(connection = connection, name = name, onViewProfile = actions.viewProfile)
        }
        if (active) {
            Band(tone = bandToneAt(STAGE_BLOCK)) {
                SectionCard(title = stringResource(R.string.chat_stage_title)) {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s20)) {
                        StageTracker(stage = connection.stage)
                        StageControls(
                            connection = connection,
                            name = name,
                            canEngage = canEngage,
                            busy = core.busy,
                            online = online,
                            onAction = actions.stage,
                            onSuggest = actions.suggest,
                        )
                    }
                }
            }
            Band(tone = bandToneAt(MY_CONTACT_BLOCK)) {
                MyContactSection(
                    connection = connection,
                    name = name,
                    ownProfile = state.ownProfile,
                    canEngage = canEngage,
                    online = online,
                    hint = state.shareHint,
                    onShare = actions.share,
                    onStop = actions.stopSharing,
                    onDismissHint = actions.dismissHint,
                )
            }
            Band(tone = bandToneAt(THEIR_CONTACT_BLOCK)) {
                TheirContactSection(
                    connection = connection,
                    name = name,
                    onCall = actions.call,
                    onWhatsApp = actions.whatsApp,
                    onEmail = actions.email,
                )
            }
            Band(tone = bandToneAt(SETTINGS_BLOCK)) {
                ChatSettings(
                    connection = connection,
                    online = online,
                    onMute = actions.setMuted,
                    onArchive = actions.setArchived,
                )
            }
        } else {
            Band { EndedBlock(connection) }
        }
        Band(tone = bandToneAt(helpIndex)) {
            HelpLinks(onSafetyTips = actions.safetyTips, onNikahGuide = actions.nikahGuide)
        }
        if (showActions) {
            Band(tone = last) {
                OtherActions(active = active, hasOther = hasOther, online = online, actions = actions)
            }
        }
    }
}

/** Block 1: the compact card of the other member with "View profile", and "Connected since". */
@Composable
private fun MemberBlock(
    connection: Connection,
    name: String,
    onViewProfile: (String) -> Unit,
) {
    val other = connection.other
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
        if (other != null) {
            ProfileRow(
                card = other,
                onOpen = { onViewProfile(other.id) },
                showRelation = false,
                actions = {
                    KrButton(
                        text = stringResource(R.string.chat_connection_view_profile),
                        onClick = { onViewProfile(other.id) },
                        variant = KrButtonVariant.QUIET,
                        size = KrButtonSize.COMPACT,
                        icon = Icons.Outlined.Person,
                    )
                },
            )
        } else {
            Row(
                modifier = Modifier.padding(vertical = Spacing.s12),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s16),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OtherAvatar(null, size = Sizes.arch56)
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleMedium,
                    modifier =
                        Modifier
                            .weight(1f)
                            .semantics { heading() },
                )
            }
        }
        CaptionText(text(R.string.chat_connection_connected_since, "date" to Formatters.longDate(connection.createdAt)))
    }
}

/** Block 5: two switches, saved at once. */
@Composable
private fun ChatSettings(
    connection: Connection,
    online: Boolean,
    onMute: (Boolean) -> Unit,
    onArchive: (Boolean) -> Unit,
) {
    SectionCard(title = stringResource(R.string.chat_connection_settings_title)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            SwitchRow(
                title = stringResource(R.string.chat_connection_settings_mute),
                checked = connection.isMuted,
                enabled = online,
                onCheckedChange = onMute,
            )
            SwitchRow(
                title = stringResource(R.string.chat_connection_settings_archive),
                checked = connection.isArchived,
                enabled = online,
                onCheckedChange = onArchive,
            )
        }
    }
}

/** Block 6: both open in the browser. */
@Composable
private fun HelpLinks(
    onSafetyTips: () -> Unit,
    onNikahGuide: () -> Unit,
) {
    SectionCard(title = stringResource(R.string.chat_connection_help_title)) {
        NavRow(
            title = stringResource(R.string.chat_connection_help_safety),
            icon = Icons.Outlined.HealthAndSafety,
            end = RowEnd.EXTERNAL,
            onClick = onSafetyTips,
        )
        RowDivider()
        NavRow(
            title = stringResource(R.string.chat_connection_help_nikah),
            icon = Icons.AutoMirrored.Outlined.MenuBook,
            end = RowEnd.EXTERNAL,
            onClick = onNikahGuide,
        )
    }
}

/** "This conversation ended on {date}." and, for the member who ended it, the reason given. */
@Composable
private fun EndedBlock(connection: Connection) {
    val reference = LocalReference.current
    TonalPanel(shape = MaterialTheme.shapes.extraLarge) {
        IconTextLine(icon = Icons.Outlined.LinkOff, tint = MaterialTheme.colorScheme.onSurfaceVariant) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                Text(
                    text(
                        R.string.chat_connection_ended_on,
                        "date" to Formatters.longDate(connection.endedAt ?: connection.createdAt),
                    ),
                )
                val reason = connection.endedReason
                if (connection.endedBy == EndedBy.ME && reason != null) {
                    Text(
                        text =
                            text(
                                R.string.chat_connection_ended_reason,
                                "reason" to reference.option(Lists.CONNECTION_END_REASON, reason),
                            ),
                        style = MaterialTheme.typography.bodySmall,
                        color = KrTheme.colors.textSecondary,
                    )
                }
            }
        }
    }
}

/**
 * Block 7: "End connection", "Report" and "Block". None is red here: danger waits for the
 * confirmation (DESIGN.md section 2.2).
 */
@Composable
private fun OtherActions(
    active: Boolean,
    hasOther: Boolean,
    online: Boolean,
    actions: ConnectionDetailsActions,
) {
    SectionCard(title = stringResource(R.string.chat_connection_actions_label)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            if (active) {
                KrButton(
                    text = stringResource(R.string.chat_chat_end),
                    onClick = actions.end,
                    variant = KrButtonVariant.SECONDARY,
                    size = KrButtonSize.LARGE,
                    icon = Icons.Outlined.LinkOff,
                    enabled = online,
                    fullWidth = true,
                )
            }
            if (hasOther) {
                AdaptiveRow(Modifier.fillMaxWidth()) {
                    KrButton(
                        text = stringResource(R.string.chat_chat_report),
                        onClick = actions.report,
                        variant = KrButtonVariant.QUIET,
                        icon = Icons.Outlined.Flag,
                        enabled = online,
                        modifier = Modifier.grow(),
                    )
                    KrButton(
                        text = stringResource(R.string.chat_chat_block),
                        onClick = actions.block,
                        variant = KrButtonVariant.QUIET,
                        icon = Icons.Outlined.Block,
                        enabled = online,
                        modifier = Modifier.grow(),
                    )
                }
            }
        }
    }
}

/** The member, the tracker and the first blocks in their final shape (rule G1). */
@Composable
private fun DetailsSkeleton() {
    LoadingRegion(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), spacing = 0.dp) {
        Band(tone = BandTone.SAND, padding = BandDefaults.compactPadding) {
            RowSkeleton()
            SkeletonBox(
                Modifier
                    .padding(top = Spacing.s12)
                    .fillMaxWidth(SKELETON_LINE)
                    .height(Spacing.s20),
            )
        }
        Band(padding = SkeletonPadding, spacing = Spacing.s20) {
            SkeletonBox(Modifier.fillMaxWidth(SKELETON_TITLE).height(Spacing.s32))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                repeat(TRACKER_STAGES.size) {
                    SkeletonBox(Modifier.size(Sizes.archIconSmall), shape = SmallArchShape)
                }
            }
            SkeletonBox(Modifier.fillMaxWidth().height(Sizes.touchLarge))
            SkeletonBox(Modifier.fillMaxWidth(SKELETON_TITLE).height(Spacing.s32))
            SkeletonBox(Modifier.fillMaxWidth().height(Sizes.switchRow))
        }
    }
}

private const val STAGE_BLOCK = 0
private const val MY_CONTACT_BLOCK = 1
private const val THEIR_CONTACT_BLOCK = 2
private const val SETTINGS_BLOCK = 3
private const val ACTIVE_BLOCKS = 4
private const val ENDED_BLOCKS = 1
private const val SKELETON_LINE = 0.5f
private const val SKELETON_TITLE = 0.6f
private val SkeletonPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s12)
