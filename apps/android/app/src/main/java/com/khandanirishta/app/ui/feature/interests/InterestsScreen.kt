package com.khandanirishta.app.ui.feature.interests

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.Interest
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DeclineDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTab
import com.khandanirishta.app.ui.components.KrTabs
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.SingleChoiceChips
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.ACCEPTED
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.CLOSED
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.PENDING
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.RECEIVED
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.SENT
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.Interests
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing
import kotlinx.coroutines.delay

/** What the parts of APP-INTERESTS can do; they get these instead of the view model. */
@Immutable
internal class InterestsActions(
    val selectBox: (box: String) -> Unit,
    val selectStatus: (status: String) -> Unit,
    val refresh: (box: String, status: String) -> Unit,
    val loadMore: (box: String, status: String) -> Unit,
    val see: (ids: List<String>) -> Unit,
    val openProfile: (id: String) -> Unit,
    val openChat: (connectionId: String) -> Unit,
    val accept: (Interest) -> Unit,
    val decline: (Interest) -> Unit,
    val withdraw: (Interest) -> Unit,
    val confirm: (alsoBlock: Boolean) -> Unit,
    val dismiss: () -> Unit,
    val improveProfile: () -> Unit,
    val seeMatches: () -> Unit,
)

/**
 * APP-INTERESTS: received and sent interests under a three-way filter, answered from the list
 * (specs/16 section 6.9, 11 sections 3 and 4). [interestId] names a row to scroll to and
 * highlight, from the reminder notification.
 */
@Composable
fun InterestsScreen(
    box: String,
    interestId: String?,
    modifier: Modifier = Modifier,
    viewModel: InterestsViewModel =
        hiltViewModel<InterestsViewModel, InterestsViewModel.Factory> { factory -> factory.create(box) },
) {
    val navigator = LocalNavigator.current
    val title = stringResource(R.string.interests_title)
    // The tab's own root has no back arrow; a copy opened from a notification or a link has one.
    // Decided once, so the bar does not change while the screen animates out on a tab switch.
    val isTabRoot =
        remember(box, interestId) {
            navigator.tabbed &&
                navigator.currentTab == Tab.INTERESTS &&
                Interests(box, interestId) == Tab.INTERESTS.root
        }
    val actions =
        remember(viewModel, navigator) {
            InterestsActions(
                selectBox = viewModel::selectBox,
                selectStatus = viewModel::selectStatus,
                refresh = viewModel::refresh,
                loadMore = viewModel::loadMore,
                see = viewModel::markSeen,
                openProfile = { navigator.push(Profile(it)) },
                openChat = { navigator.push(Chat(it)) },
                accept = viewModel::accept,
                decline = viewModel::askDecline,
                withdraw = viewModel::askWithdraw,
                confirm = viewModel::confirmDialog,
                dismiss = viewModel::dismissDialog,
                improveProfile = { navigator.openOnTab(Tab.ME, emptyList()) },
                seeMatches = { navigator.openOnTab(Tab.HOME, listOf(Matches)) },
            )
        }
    LifecycleResumeEffect(Unit) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is InterestsEvent.OpenChat -> navigator.push(Chat(event.connectionId))
            }
        }
    }
    Scaffold(
        modifier = modifier,
        topBar = {
            if (isTabRoot) {
                TabTopBar(title = title)
            } else {
                DetailTopBar(title = title, onBack = { navigator.back() })
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            StatusGate(GateRouter.Level.ENGAGE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                // Keyed, so a list never shows for a moment under another list's filter.
                val list by key(state.box, state.status) {
                    viewModel.list(state.box, state.status).collectAsStateWithLifecycle()
                }
                InterestsContent(
                    state = state,
                    list = list,
                    pending = LocalMe.current?.counters?.pendingInterests ?: 0L,
                    highlightId = interestId,
                    actions = actions,
                )
            }
        }
    }
}

/** The tabs, then one list per box and filter. The filters scroll away with the list. */
@Composable
internal fun InterestsContent(
    state: InterestsUiState,
    list: PagedState<Interest>,
    pending: Long,
    highlightId: String?,
    actions: InterestsActions,
    modifier: Modifier = Modifier,
) {
    val box = state.box
    val status = state.status
    val sent = box == SENT
    val listState = key(box, status) { rememberLazyListState() }

    // The linked row is scrolled to once, whichever list shows it first (17 section 3.3).
    var scrolledTo by rememberSaveable { mutableStateOf<String?>(null) }
    val highlightIndex =
        remember(list.items, highlightId) {
            if (highlightId == null) -1 else list.items.indexOfFirst { it.id == highlightId }
        }
    LaunchedEffect(listState, highlightId, highlightIndex) {
        if (highlightIndex < 0 || scrolledTo == highlightId) return@LaunchedEffect
        listState.animateScrollToItem(highlightIndex + HEADER_ITEMS)
        scrolledTo = highlightId
    }
    MarkSeenEffect(
        listState = listState,
        items = list.items,
        enabled = box == RECEIVED && status == PENDING,
        onSee = actions.see,
    )

    Column(modifier.fillMaxSize()) {
        KrTabs(
            tabs =
                listOf(
                    KrTab(
                        label = stringResource(R.string.interests_box_received),
                        count = pending,
                        countLabel = text(R.string.interests_box_badge, "count" to Formatters.badgeCount(pending)),
                    ),
                    KrTab(label = stringResource(R.string.interests_box_sent)),
                ),
            selected = if (sent) 1 else 0,
            onSelect = { index -> actions.selectBox(if (index == 1) SENT else RECEIVED) },
        )
        PagedList(
            state = list,
            key = { it.id },
            onRefresh = { actions.refresh(box, status) },
            onLoadMore = { actions.loadMore(box, status) },
            modifier = Modifier.weight(1f),
            listState = listState,
            header = {
                item(key = FILTER_KEY, contentType = FILTER_KEY) {
                    SingleChoiceChips(
                        options =
                            InterestsViewModel.STATUSES.map { it to stringResource(statusLabel(box, it)) },
                        selected = status,
                        onSelect = actions.selectStatus,
                        modifier = Modifier.padding(bottom = Spacing.s8),
                    )
                }
            },
            empty = { InterestsEmpty(box = box, status = status, actions = actions) },
        ) { interest ->
            InterestItem(
                interest = interest,
                sent = sent,
                highlighted = interest.id == highlightId,
                accepting = interest.id in state.accepting,
                actions = actions,
            )
        }
        InterestDialogs(state = state, actions = actions)
    }
}

/**
 * Sends the unseen received items that stay on screen for one second, while the app is in the
 * foreground and the "New" list is shown (16 section 6.9).
 */
@Composable
private fun MarkSeenEffect(
    listState: LazyListState,
    items: List<Interest>,
    enabled: Boolean,
    onSee: (List<String>) -> Unit,
) {
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val resumed = lifecycleState.isAtLeast(Lifecycle.State.RESUMED)
    val unseen =
        remember(items) {
            items.filter { it.direction == InterestDirection.RECEIVED && !it.seen }.map { it.id }.toSet()
        }
    val visible by remember(listState, unseen) {
        derivedStateOf {
            listState.layoutInfo.visibleItemsInfo.mapNotNull { info -> (info.key as? String)?.takeIf { it in unseen } }
        }
    }
    val currentOnSee by rememberUpdatedState(onSee)
    LaunchedEffect(enabled, resumed, visible) {
        if (!enabled || !resumed || visible.isEmpty()) return@LaunchedEffect
        delay(SEEN_DELAY_MS)
        currentOnSee(visible)
    }
}

/** The decline sheet with "Also block {name}", and the withdraw dialog (16 section 6.7). */
@Composable
private fun InterestDialogs(
    state: InterestsUiState,
    actions: InterestsActions,
) {
    when (val dialog = state.dialog) {
        is InterestDialog.Decline -> {
            key(dialog.interest.id) {
                DeclineDialog(
                    name = dialog.interest.profile
                        ?.displayName
                        .orEmpty(),
                    onConfirm = actions.confirm,
                    onDismiss = actions.dismiss,
                    busy = state.dialogBusy,
                )
            }
        }

        is InterestDialog.Withdraw -> {
            ConfirmDialog(
                title = stringResource(R.string.interests_withdraw_title),
                text = stringResource(R.string.interests_withdraw_text),
                confirmLabel = stringResource(R.string.interests_withdraw_confirm),
                onConfirm = { actions.confirm(false) },
                onDismiss = actions.dismiss,
                variant = KrButtonVariant.INK,
                busy = state.dialogBusy,
            )
        }

        null -> {}
    }
}

/** The empty state of each list, with its exact copy (16 section 6.9). */
@Composable
private fun InterestsEmpty(
    box: String,
    status: String,
    actions: InterestsActions,
) {
    val candidate = rememberCandidate()
    val received = box == RECEIVED
    val icon = if (received) Icons.Outlined.MailOutline else Icons.AutoMirrored.Outlined.Send
    when {
        received && status == PENDING -> {
            val action =
                candidate.pick(
                    R.string.interests_empty_received_pending_action,
                    R.string.interests_empty_received_pending_action_male,
                    R.string.interests_empty_received_pending_action_female,
                )
            EmptyState(
                title = stringResource(R.string.interests_empty_received_pending_title),
                text = stringResource(R.string.interests_empty_received_pending_text),
                icon = icon,
                actionLabel = stringResource(action),
                onAction = actions.improveProfile,
            )
        }

        !received && status == PENDING -> {
            val action =
                candidate.pick(
                    R.string.interests_empty_sent_pending_action,
                    R.string.interests_empty_sent_pending_action_male,
                    R.string.interests_empty_sent_pending_action_female,
                )
            EmptyState(
                title = stringResource(R.string.interests_empty_sent_pending_title),
                text = stringResource(R.string.interests_empty_sent_pending_text),
                icon = icon,
                actionLabel = stringResource(action),
                onAction = actions.seeMatches,
            )
        }

        else -> {
            EmptyState(title = stringResource(emptyTitle(box, status)), icon = icon)
        }
    }
}

@StringRes
private fun emptyTitle(
    box: String,
    status: String,
): Int =
    when {
        box == RECEIVED && status == ACCEPTED -> R.string.interests_empty_received_accepted_title
        box == RECEIVED -> R.string.interests_empty_received_closed_title
        status == ACCEPTED -> R.string.interests_empty_sent_accepted_title
        else -> R.string.interests_empty_sent_closed_title
    }

/** "New", "Accepted", "Closed" under Received; "Waiting", "Accepted", "Closed" under Sent. */
@StringRes
private fun statusLabel(
    box: String,
    status: String,
): Int =
    if (box == SENT) {
        when (status) {
            ACCEPTED -> R.string.interests_status_sent_accepted
            CLOSED -> R.string.interests_status_sent_closed
            else -> R.string.interests_status_sent_pending
        }
    } else {
        when (status) {
            ACCEPTED -> R.string.interests_status_received_accepted
            CLOSED -> R.string.interests_status_received_closed
            else -> R.string.interests_status_received_pending
        }
    }

/** Received items count as seen after one second on screen (16 section 6.9). */
private const val SEEN_DELAY_MS = 1_000L

/** The filters come before the rows. */
private const val HEADER_ITEMS = 1
private const val FILTER_KEY = "interests:filter"
