package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.PhotoVisibility
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.BarAction
import com.khandanirishta.app.ui.components.BlockDialog
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DeclineDialog
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuDivider
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.NoLongerAvailable
import com.khandanirishta.app.ui.components.NoteDialog
import com.khandanirishta.app.ui.components.ProfileTopBar
import com.khandanirishta.app.ui.components.ReportDialog
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.bandToneAt
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.components.exceptBottom
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.ConnectionDetails
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.Interests
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.PhotoViewer
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.LargeArchShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** APP-PROFILE: another member's full profile and the place where interest is expressed (16 section 6.7). */
@Composable
fun ProfileScreen(
    profileId: String,
    modifier: Modifier = Modifier,
    viewModel: ProfileViewModel = hiltViewModel<ProfileViewModel, ProfileViewModel.Factory> { it.create(profileId) },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val supportEmail =
        LocalMe.current
            ?.config
            ?.supportEmail
            .orEmpty()
    SideEffect { viewModel.supportEmail = supportEmail }
    var sheet by rememberSaveable { mutableStateOf<ProfileSheet?>(null) }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                ProfileEvent.Back -> navigator.back()
                is ProfileEvent.OpenChat -> navigator.push(Chat(event.connectionId))
                ProfileEvent.CloseSendDialog -> if (sheet == ProfileSheet.SEND) sheet = null
            }
        }
    }

    val detail = state.detail.takeUnless { state.notFound || state.statusPanel }
    val actions =
        remember(viewModel, navigator, detail) {
            ProfileActions(
                back = { navigator.back() },
                retry = { viewModel.load() },
                open = { sheet = it },
                openPhoto = { navigator.push(PhotoViewer(profileId, it)) },
                requestPhotos = viewModel::requestPhotos,
                toggleShortlist = viewModel::toggleShortlist,
                giveAccess = viewModel::giveAccess,
                openConnection = {
                    detail?.relation?.connectionId?.let { navigator.push(ConnectionDetails(it)) }
                },
                pass = {
                    // A pass does not withdraw an open interest, so ask first.
                    if (detail?.relation?.interest != null) {
                        sheet = ProfileSheet.PASS_INTEREST
                    } else {
                        viewModel.pass(withdrawFirst = false)
                    }
                },
                bar =
                    ProfileBarActions(
                        openChat = { detail?.relation?.connectionId?.let { navigator.push(Chat(it)) } },
                        send = { sheet = ProfileSheet.SEND },
                        accept = viewModel::accept,
                        decline = { sheet = ProfileSheet.DECLINE },
                        withdraw = { sheet = ProfileSheet.WITHDRAW },
                        verify = { navigator.push(Verification) },
                        viewSentInterests = { navigator.openOnTab(Tab.INTERESTS, listOf(Interests("sent"))) },
                    ),
            )
        }

    Scaffold(
        modifier = modifier,
        topBar = {
            ProfileTopBar(
                name = detail?.card?.displayName,
                onBack = actions.back,
                actions =
                    if (detail == null) {
                        null
                    } else {
                        { TopBarActions(detail, state.ownPhotoVisibility, state.busy, actions) }
                    },
            )
        },
        bottomBar = {
            if (detail != null) {
                ProfileActionBar(detail, busy = state.busy, accepting = state.accepting, actions = actions.bar)
            }
        },
    ) { padding ->
        val aboveAndBeside = padding.exceptBottom()
        Box(Modifier.padding(aboveAndBeside).consumeWindowInsets(aboveAndBeside)) {
            val below = PaddingValues(bottom = padding.calculateBottomPadding())
            when {
                state.notFound -> {
                    StateScreen {
                        NoLongerAvailable(
                            onBack = actions.back,
                            title = stringResource(R.string.profile_load_not_found),
                        )
                    }
                }

                state.statusPanel -> {
                    StatusGate(GateRouter.Level.BROWSE) {
                        // The own status allows it again (resumed, or Me was refetched): load once more.
                        LaunchedEffect(Unit) { viewModel.load() }
                        if (state.loading) {
                            ProfileSkeleton()
                        } else {
                            StateScreen { ErrorState(error = state.error, onRetry = actions.retry) }
                        }
                    }
                }

                detail != null -> {
                    ProfileContent(detail = detail, busy = state.busy, actions = actions, contentPadding = below)
                }

                state.error != null -> {
                    StateScreen { ErrorState(error = state.error, onRetry = actions.retry) }
                }

                // Behind the limit dialog the page stays quiet.
                !state.viewLimit -> {
                    ProfileSkeleton()
                }
            }
        }
    }

    val decisions = remember(viewModel) { decisionsOf(viewModel) }
    if (detail != null) {
        ProfileSheets(sheet = sheet, detail = detail, state = state, decisions = decisions, onClose = { sheet = null })
    }
    ProfileOutcomes(state = state, decisions = decisions, name = detail?.card?.displayName)
}

/** What the sheets and dialogs of the profile can decide. */
@Immutable
private class ProfileDecisions(
    val send: (message: String) -> Unit,
    val decline: (alsoBlock: Boolean) -> Unit,
    val withdraw: () -> Unit,
    val block: () -> Unit,
    val report: (reason: String, details: String, alsoBlock: Boolean) -> Unit,
    val pass: (withdrawFirst: Boolean) -> Unit,
    val saveNote: (note: String) -> Unit,
    val closeNote: () -> Unit,
    val closeReportDone: () -> Unit,
    val dismissMutual: () -> Unit,
    val dismissVerifiedOnly: () -> Unit,
)

private fun decisionsOf(viewModel: ProfileViewModel): ProfileDecisions =
    ProfileDecisions(
        send = viewModel::sendInterest,
        decline = viewModel::decline,
        withdraw = viewModel::withdraw,
        block = viewModel::block,
        report = viewModel::report,
        pass = viewModel::pass,
        saveNote = viewModel::saveNote,
        closeNote = viewModel::closeNoteDialog,
        closeReportDone = viewModel::closeReportDone,
        dismissMutual = viewModel::dismissMutual,
        dismissVerifiedOnly = viewModel::dismissVerifiedOnly,
    )

internal enum class ProfileSheet { SEND, DECLINE, WITHDRAW, BLOCK, REPORT, PASS_INTEREST }

/** What the parts of the profile can do; they get these instead of the view model. */
@Immutable
internal class ProfileActions(
    val back: () -> Unit,
    val retry: () -> Unit,
    val open: (ProfileSheet) -> Unit,
    val openPhoto: (index: Int) -> Unit,
    val requestPhotos: () -> Unit,
    val toggleShortlist: () -> Unit,
    val giveAccess: () -> Unit,
    val openConnection: () -> Unit,
    val pass: () -> Unit,
    val bar: ProfileBarActions,
)

/** The bands of a profile as one list: the hero, the parts, then the safety footer. */
@Composable
internal fun ProfileContent(
    detail: ProfileDetail,
    busy: Boolean,
    actions: ProfileActions,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val bands = rememberProfileBands(detail)
    val footerTone = bandToneAt(bands.size)
    val colors = MaterialTheme.colorScheme
    LazyColumn(
        modifier =
            modifier
                .fillMaxSize()
                .background(if (footerTone == BandTone.SAND) colors.surfaceContainer else colors.background),
        // The bands run on behind the action bar, under its rounded corners.
        contentPadding = contentPadding,
    ) {
        item(key = "hero", contentType = "hero") {
            ProfileHero(
                detail = detail,
                onOpenPhoto = actions.openPhoto,
                onRequestPhotos = actions.requestPhotos,
                requesting = busy,
            )
        }
        profileBandItems(detail, bands)
        item(key = "safety", contentType = "safety") { SafetyFooter(footerTone, actions.open) }
    }
}

/** Shortlist and More as icon-and-label buttons (DESIGN.md section 6.16). */
@Composable
private fun RowScope.TopBarActions(
    detail: ProfileDetail,
    ownVisibility: PhotoVisibility?,
    busy: Boolean,
    actions: ProfileActions,
) {
    val relation = detail.relation
    val connected = relation.tier == Tier.CONNECTION
    val ready = LocalOnline.current && !busy
    if (!connected) {
        val shortlisted = relation.isShortlisted
        val label = if (shortlisted) R.string.shared_card_shortlisted else R.string.shared_card_shortlist
        BarAction(
            icon = if (shortlisted) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
            label = stringResource(label),
            onClick = actions.toggleShortlist,
            enabled = LocalOnline.current,
            tint = if (shortlisted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.semantics { selected = shortlisted },
        )
    }
    val name = detail.card.displayName
    val menuLabel = text(R.string.profile_actions_menu, "name" to name)
    var open by remember { mutableStateOf(false) }

    fun choose(action: () -> Unit) {
        open = false
        action()
    }
    Box {
        BarAction(
            icon = Icons.Outlined.MoreHoriz,
            label = stringResource(R.string.shared_card_more),
            onClick = { open = true },
            modifier = Modifier.semantics { contentDescription = menuLabel },
        )
        KrMenu(expanded = open, onDismissRequest = { open = false }) {
            val interested = relation.tier == Tier.INTEREST_FROM_OWNER || relation.tier == Tier.INTEREST_TO_OWNER
            val related = connected || interested
            val canGrant = related && ownVisibility != null && ownVisibility != PhotoVisibility.MEMBERS
            val canPass = relation.tier == Tier.MEMBER
            if (connected && relation.connectionId != null) {
                KrMenuItem(
                    text = stringResource(R.string.profile_actions_connection_details),
                    icon = Icons.Outlined.Info,
                    onClick = { choose(actions.openConnection) },
                )
            }
            if (canGrant) {
                val grant =
                    rememberCandidate().pick(
                        R.string.profile_actions_let_see_photos,
                        R.string.profile_actions_let_see_photos_male,
                        R.string.profile_actions_let_see_photos_female,
                    )
                KrMenuItem(
                    text = text(grant, "name" to name),
                    icon = Icons.Outlined.PhotoLibrary,
                    enabled = ready,
                    onClick = { choose(actions.giveAccess) },
                )
            }
            if (canPass) {
                KrMenuItem(
                    text = stringResource(R.string.profile_actions_not_interested),
                    icon = Icons.Outlined.VisibilityOff,
                    enabled = ready,
                    onClick = { choose(actions.pass) },
                )
            }
            if (connected || canGrant || canPass) KrMenuDivider()
            KrMenuItem(
                text = stringResource(R.string.profile_actions_report),
                icon = Icons.Outlined.Flag,
                onClick = { choose { actions.open(ProfileSheet.REPORT) } },
            )
            KrMenuItem(
                text = stringResource(R.string.profile_actions_block),
                icon = Icons.Outlined.Block,
                onClick = { choose { actions.open(ProfileSheet.BLOCK) } },
            )
        }
    }
}

/** Block 12: report and block, and the money warning. */
@Composable
private fun SafetyFooter(
    tone: BandTone,
    onOpen: (ProfileSheet) -> Unit,
) {
    Band(tone = tone, maxWidth = Sizes.contentWidth, spacing = Spacing.s16) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            KrButton(
                text = stringResource(R.string.profile_safety_report),
                onClick = { onOpen(ProfileSheet.REPORT) },
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.Outlined.Flag,
            )
            KrButton(
                text = stringResource(R.string.profile_safety_block),
                onClick = { onOpen(ProfileSheet.BLOCK) },
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.Outlined.Block,
            )
        }
        IconText(
            icon = Icons.Outlined.WarningAmber,
            text = stringResource(R.string.profile_safety_money),
            color = KrTheme.colors.textSecondary,
            tint = MaterialTheme.colorScheme.primary,
            gap = Spacing.s12,
        )
    }
}

/** The sheet or dialog the member opened (rule G8). */
@Composable
private fun ProfileSheets(
    sheet: ProfileSheet?,
    detail: ProfileDetail,
    state: ProfileUiState,
    decisions: ProfileDecisions,
    onClose: () -> Unit,
) {
    val name = detail.card.displayName
    when (sheet) {
        ProfileSheet.SEND -> {
            SendInterestSheet(
                name = name,
                busy = state.busy,
                error = state.messageError?.resolve(LocalResources.current),
                onSend = decisions.send,
                onDismiss = onClose,
            )
        }

        ProfileSheet.DECLINE -> {
            DeclineDialog(
                name = name,
                busy = state.busy,
                onConfirm = { alsoBlock ->
                    onClose()
                    decisions.decline(alsoBlock)
                },
                onDismiss = onClose,
            )
        }

        ProfileSheet.WITHDRAW -> {
            ConfirmDialog(
                title = stringResource(R.string.profile_withdraw_title),
                text = stringResource(R.string.profile_withdraw_text),
                confirmLabel = stringResource(R.string.profile_withdraw_confirm),
                variant = KrButtonVariant.INK,
                busy = state.busy,
                onConfirm = {
                    onClose()
                    decisions.withdraw()
                },
                onDismiss = onClose,
            )
        }

        ProfileSheet.BLOCK -> {
            BlockDialog(
                name = name,
                busy = state.busy,
                onConfirm = {
                    onClose()
                    decisions.block()
                },
                onDismiss = onClose,
            )
        }

        ProfileSheet.REPORT -> {
            ReportDialog(
                name = name,
                reasons = LocalReference.current.options(Lists.REPORT_REASON),
                busy = state.busy,
                onSubmit = { reason, details, alsoBlock ->
                    onClose()
                    decisions.report(reason, details, alsoBlock)
                },
                onDismiss = onClose,
            )
        }

        ProfileSheet.PASS_INTEREST -> {
            KrDialog(
                text = text(R.string.profile_pass_open_interest, "name" to name),
                confirmLabel = stringResource(R.string.profile_pass_withdraw),
                confirmEnabled = LocalOnline.current,
                onConfirm = {
                    onClose()
                    decisions.pass(true)
                },
                dismissLabel = stringResource(R.string.profile_pass_keep),
                onDismiss = {
                    onClose()
                    decisions.pass(false)
                },
                onDismissRequest = onClose,
            )
        }

        null -> {}
    }
}

/** The dialogs that follow from what the server answered. */
@Composable
private fun ProfileOutcomes(
    state: ProfileUiState,
    decisions: ProfileDecisions,
    name: String?,
) {
    val navigator = LocalNavigator.current
    if (state.viewLimit && state.detail == null) {
        KrDialog(
            title = stringResource(R.string.profile_load_view_limit_title),
            text = stringResource(R.string.profile_load_view_limit),
            confirmLabel = stringResource(R.string.profile_load_ok),
            onConfirm = { navigator.back() },
            onDismissRequest = { navigator.back() },
        )
    }
    state.mutualConnectionId?.let { connectionId ->
        KrDialog(
            title = stringResource(R.string.profile_send_mutual_title),
            text = stringResource(R.string.profile_send_mutual_text),
            confirmLabel = stringResource(R.string.profile_send_start_chatting),
            onConfirm = {
                decisions.dismissMutual()
                navigator.push(Chat(connectionId))
            },
            dismissLabel = stringResource(R.string.profile_send_later),
            onDismissRequest = decisions.dismissMutual,
        )
    }
    if (state.verifiedOnlyDialog) {
        KrDialog(
            text = stringResource(R.string.profile_cannot_send_verified_only),
            confirmLabel = stringResource(R.string.profile_send_verify_now),
            onConfirm = {
                decisions.dismissVerifiedOnly()
                navigator.push(Verification)
            },
            dismissLabel = stringResource(R.string.common_actions_cancel),
            onDismissRequest = decisions.dismissVerifiedOnly,
        )
    }
    if (state.noteDialog && name != null) {
        NoteDialog(name = name, busy = state.busy, onSave = decisions.saveNote, onDismiss = decisions.closeNote)
    }
    if (state.reportDone) {
        KrDialog(
            text = stringResource(R.string.shared_report_success),
            confirmLabel = stringResource(R.string.errors_limit_ok),
            onConfirm = decisions.closeReportDone,
            onDismissRequest = decisions.closeReportDone,
        ) {
            if (state.reportTip) {
                StatusBanner(text = stringResource(R.string.shared_report_safety_tip), tone = StatusTone.WARNING)
            }
        }
    }
}

/** Loading: the gallery, the header and three blocks, in the shape of the profile. */
@Composable
private fun ProfileSkeleton() {
    LoadingRegion(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        spacing = 0.dp,
    ) {
        Band(tone = BandTone.SAND, spacing = Spacing.s16) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                SkeletonBox(
                    modifier =
                        Modifier
                            .contentWidth(Sizes.galleryMax)
                            .padding(horizontal = Spacing.s24)
                            .aspectRatio(ARCH_RATIO),
                    shape = LargeArchShape,
                )
            }
            SkeletonBox(Modifier.fillMaxWidth(NAME_SHARE).height(Spacing.s40))
            SkeletonBox(Modifier.fillMaxWidth(LINE_SHARE).height(Spacing.s20))
        }
        repeat(SKELETON_BLOCKS) { index ->
            Band(tone = bandToneAt(index)) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
                    SkeletonBox(Modifier.fillMaxWidth(NAME_SHARE).height(Spacing.s24))
                    SkeletonBox(Modifier.fillMaxWidth().height(Spacing.s16))
                    SkeletonBox(Modifier.fillMaxWidth(LINE_SHARE).height(Spacing.s16))
                }
            }
        }
    }
}

private const val SKELETON_BLOCKS = 3
private const val NAME_SHARE = 0.6f
private const val LINE_SHARE = 0.8f
