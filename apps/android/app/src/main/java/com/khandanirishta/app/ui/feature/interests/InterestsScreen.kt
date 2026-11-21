package com.khandanirishta.app.ui.feature.interests

import androidx.annotation.StringRes
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.DisplayStatus
import com.khandanirishta.app.core.network.generated.model.Interest
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.InterestStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.ACCEPTED
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.CLOSED
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.PENDING
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.RECEIVED
import com.khandanirishta.app.ui.feature.interests.InterestsViewModel.Companion.SENT
import com.khandanirishta.app.ui.feature.lists.ButtonSpinner
import com.khandanirishta.app.ui.feature.lists.FilterChipRow
import com.khandanirishta.app.ui.feature.lists.ListTab
import com.khandanirishta.app.ui.feature.lists.ListTabs
import com.khandanirishta.app.ui.feature.lists.MetaLine
import com.khandanirishta.app.ui.feature.lists.UnavailableCard
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.Interests
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant

/** Pending interests show the expiry in the attention colour in their last 3 days (16 section 6.9). */
private const val ATTENTION_DAYS = 3

/** Received items count as seen after one second on screen (16 section 6.9). */
private const val SEEN_DELAY_MS = 1_000L

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
        Box(Modifier.padding(padding)) {
            StatusGate(GateRouter.Level.ENGAGE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                InterestsContent(
                    state = state,
                    listFlow = viewModel.list(state.box, state.status),
                    highlightId = interestId,
                    onSelectBox = viewModel::selectBox,
                    onSelectStatus = viewModel::selectStatus,
                    onRefresh = viewModel::refresh,
                    onLoadMore = viewModel::loadMore,
                    onSee = viewModel::markSeen,
                    onAccept = viewModel::accept,
                    onDecline = viewModel::askDecline,
                    onWithdraw = viewModel::askWithdraw,
                    onConfirmDialog = viewModel::confirmDialog,
                    onDismissDialog = viewModel::dismissDialog,
                    onAlsoBlockChange = viewModel::setAlsoBlock,
                )
            }
        }
    }
}

@Composable
private fun InterestsContent(
    state: InterestsUiState,
    listFlow: StateFlow<PagedState<Interest>>,
    highlightId: String?,
    onSelectBox: (String) -> Unit,
    onSelectStatus: (String) -> Unit,
    onRefresh: (box: String, status: String) -> Unit,
    onLoadMore: (box: String, status: String) -> Unit,
    onSee: (List<String>) -> Unit,
    onAccept: (Interest) -> Unit,
    onDecline: (Interest) -> Unit,
    onWithdraw: (Interest) -> Unit,
    onConfirmDialog: () -> Unit,
    onDismissDialog: () -> Unit,
    onAlsoBlockChange: (Boolean) -> Unit,
) {
    val pending = LocalMe.current?.counters?.pendingInterests ?: 0L
    // The linked row is scrolled to once, whichever list shows it first (17 section 3.3).
    var scrolledTo by rememberSaveable { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        ListTabs(
            tabs =
                listOf(
                    ListTab(
                        label = stringResource(R.string.interests_box_received),
                        badge = pending,
                        badgeDescription = text(R.string.interests_box_badge, "count" to pending),
                    ),
                    ListTab(label = stringResource(R.string.interests_box_sent)),
                ),
            selected = if (state.box == SENT) 1 else 0,
            onSelect = { index -> onSelectBox(if (index == 1) SENT else RECEIVED) },
        )
        FilterChipRow(
            options =
                InterestsViewModel.STATUSES.map { status ->
                    status to stringResource(statusLabel(state.box, status))
                },
            selected = state.status,
            onSelect = onSelectStatus,
        )
        key(state.box, state.status) {
            InterestList(
                listFlow = listFlow,
                state = state,
                highlightId = highlightId,
                scrolled = highlightId == null || scrolledTo == highlightId,
                onScroll = { scrolledTo = highlightId },
                onRefresh = onRefresh,
                onLoadMore = onLoadMore,
                onSee = onSee,
                onAccept = onAccept,
                onDecline = onDecline,
                onWithdraw = onWithdraw,
                modifier = Modifier.weight(1f),
            )
        }
        InterestDialogs(
            state = state,
            onConfirm = onConfirmDialog,
            onDismiss = onDismissDialog,
            onAlsoBlockChange = onAlsoBlockChange,
        )
    }
}

/** The list of one box and status. [onScroll] reports that the row of [highlightId] has been scrolled to. */
@Composable
private fun InterestList(
    listFlow: StateFlow<PagedState<Interest>>,
    state: InterestsUiState,
    highlightId: String?,
    scrolled: Boolean,
    onScroll: () -> Unit,
    onRefresh: (box: String, status: String) -> Unit,
    onLoadMore: (box: String, status: String) -> Unit,
    onSee: (List<String>) -> Unit,
    onAccept: (Interest) -> Unit,
    onDecline: (Interest) -> Unit,
    onWithdraw: (Interest) -> Unit,
    modifier: Modifier = Modifier,
) {
    val box = state.box
    val status = state.status
    val navigator = LocalNavigator.current
    val list by listFlow.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    val highlightIndex = if (highlightId == null) -1 else list.items.indexOfFirst { it.id == highlightId }
    val alreadyScrolled by rememberUpdatedState(scrolled)
    val markScrolled by rememberUpdatedState(onScroll)
    LaunchedEffect(highlightIndex) {
        if (highlightIndex < 0 || alreadyScrolled) return@LaunchedEffect
        listState.animateScrollToItem(highlightIndex)
        markScrolled()
    }
    MarkSeenEffect(
        listState = listState,
        items = list.items,
        enabled = box == RECEIVED && status == PENDING,
        onSee = onSee,
    )

    PagedList(
        state = list,
        key = { it.id },
        onRefresh = { onRefresh(box, status) },
        onLoadMore = { onLoadMore(box, status) },
        modifier = modifier,
        listState = listState,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        empty = { InterestsEmpty(box = box, status = status) },
    ) { interest ->
        InterestItem(
            interest = interest,
            box = box,
            highlighted = interest.id == highlightId,
            accepting = interest.id in state.accepting,
            online = state.online,
            onOpenProfile = { profileId -> navigator.push(Profile(profileId)) },
            onAccept = { onAccept(interest) },
            onDecline = { onDecline(interest) },
            onWithdraw = { onWithdraw(interest) },
            onOpenChat = { connectionId -> navigator.push(Chat(connectionId)) },
        )
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

@Composable
private fun InterestItem(
    interest: Interest,
    box: String,
    highlighted: Boolean,
    accepting: Boolean,
    online: Boolean,
    onOpenProfile: (String) -> Unit,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onWithdraw: () -> Unit,
    onOpenChat: (String) -> Unit,
) {
    val ring =
        if (highlighted) {
            Modifier.border(2.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.large)
        } else {
            Modifier
        }
    val profile = interest.profile
    val unseen = interest.direction == InterestDirection.RECEIVED && !interest.seen
    val hasActions =
        interest.status == InterestStatus.PENDING ||
            (interest.status == InterestStatus.ACCEPTED && interest.connectionId != null)
    if (profile == null) {
        // The other member can no longer be opened: a grey row without actions (11 section 3.1).
        UnavailableCard(title = stringResource(R.string.interests_unavailable), modifier = ring) {
            InterestDetails(interest = interest, box = box, unseen = false)
        }
    } else {
        ProfileRow(
            card = profile.copy(compat = interest.compatScore),
            onOpen = { onOpenProfile(profile.id) },
            modifier = ring,
            unseen = unseen,
            extra = { InterestDetails(interest = interest, box = box, unseen = unseen) },
            actions =
                if (hasActions) {
                    {
                        InterestActions(
                            interest = interest,
                            accepting = accepting,
                            online = online,
                            onAccept = onAccept,
                            onDecline = onDecline,
                            onWithdraw = onWithdraw,
                            onOpenChat = onOpenChat,
                        )
                    }
                } else {
                    null
                },
        )
    }
}

/** The message in quotes, then when it was received or sent, the expiry and the status label. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InterestDetails(
    interest: Interest,
    box: String,
    unseen: Boolean,
) {
    val res = LocalResources.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val message = interest.message
        if (!message.isNullOrBlank()) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text(R.string.interests_message, "message" to message),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            if (unseen) NewLabel()
            MetaLine(
                text(
                    if (box == SENT) R.string.interests_sent_at else R.string.interests_received_at,
                    "time" to Formatters.relative(res, interest.createdAt),
                ),
            )
            if (interest.status == InterestStatus.PENDING) ExpiryLine(interest.expiresAt)
            displayStatusLabel(interest.displayStatus)?.let { label ->
                MetaLine(stringResource(label), color = MaterialTheme.colorScheme.onSurface, emphasis = true)
            }
        }
    }
}

/** "Expires in {n} days", with an icon and the attention colour in the last 3 days. */
@Composable
private fun ExpiryLine(expiresAt: Instant) {
    val days = Formatters.daysUntil(expiresAt)
    val soon = days <= ATTENTION_DAYS
    MetaLine(
        text =
            if (days == 0) {
                stringResource(R.string.interests_expires_today)
            } else {
                plural(R.plurals.interests_expires_in, days)
            },
        icon = if (soon) Icons.Outlined.WarningAmber else Icons.Outlined.Schedule,
        color = if (soon) KrTheme.colors.warning else MaterialTheme.colorScheme.onSurfaceVariant,
        emphasis = soon,
    )
}

/** The unseen marker in words, next to the dot on the photo (rule G13). */
@Composable
private fun NewLabel() {
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        shape = CircleShape,
    ) {
        Text(
            stringResource(R.string.interests_unseen),
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun InterestActions(
    interest: Interest,
    accepting: Boolean,
    online: Boolean,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onWithdraw: () -> Unit,
    onOpenChat: (String) -> Unit,
) {
    val connectionId = interest.connectionId
    when {
        interest.status == InterestStatus.ACCEPTED && connectionId != null -> {
            FilledTonalButton(onClick = { onOpenChat(connectionId) }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.interests_actions_open_chat))
            }
        }

        interest.status != InterestStatus.PENDING -> {}

        interest.direction == InterestDirection.RECEIVED -> {
            val acceptLabel = stringResource(R.string.interests_actions_accept)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onAccept,
                    enabled = online && !accepting,
                    modifier =
                        Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp)
                            .semantics { contentDescription = acceptLabel },
                ) {
                    if (accepting) ButtonSpinner() else Text(acceptLabel)
                }
                OutlinedButton(
                    onClick = onDecline,
                    enabled = online && !accepting,
                    modifier =
                        Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                ) {
                    Text(stringResource(R.string.interests_actions_decline))
                }
            }
        }

        else -> {
            OutlinedButton(onClick = onWithdraw, enabled = online, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.interests_actions_withdraw))
            }
        }
    }
}

/** The decline dialog with "Also block {name}", and the withdraw dialog (16 section 6.7). */
@Composable
private fun InterestDialogs(
    state: InterestsUiState,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    onAlsoBlockChange: (Boolean) -> Unit,
) {
    when (val dialog = state.dialog) {
        is InterestDialog.Decline -> {
            val name = dialog.interest.profile
                ?.displayName
                .orEmpty()
            ConfirmDialog(
                title = stringResource(R.string.interests_decline_title),
                text = text(R.string.interests_decline_text, "name" to name),
                confirmLabel = stringResource(R.string.interests_decline_confirm),
                onConfirm = onConfirm,
                onDismiss = onDismiss,
                destructive = true,
                busy = state.dialogBusy,
                extra = {
                    CheckboxRow(
                        checked = dialog.alsoBlock,
                        onCheckedChange = onAlsoBlockChange,
                        label = text(R.string.interests_decline_also_block, "name" to name),
                        enabled = !state.dialogBusy,
                    )
                },
            )
        }

        is InterestDialog.Withdraw -> {
            ConfirmDialog(
                title = stringResource(R.string.interests_withdraw_title),
                text = stringResource(R.string.interests_withdraw_text),
                confirmLabel = stringResource(R.string.interests_withdraw_confirm),
                onConfirm = onConfirm,
                onDismiss = onDismiss,
                destructive = true,
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
) {
    val navigator = LocalNavigator.current
    val received = box == RECEIVED
    val icon = if (received) Icons.Outlined.FavoriteBorder else Icons.AutoMirrored.Outlined.Send
    when {
        received && status == PENDING -> {
            EmptyState(
                title = stringResource(R.string.interests_empty_received_pending_title),
                text = stringResource(R.string.interests_empty_received_pending_text),
                icon = icon,
                actionLabel = stringResource(R.string.interests_empty_received_pending_action),
                onAction = { navigator.openOnTab(Tab.ME, emptyList()) },
            )
        }

        !received && status == PENDING -> {
            EmptyState(
                title = stringResource(R.string.interests_empty_sent_pending_title),
                text = stringResource(R.string.interests_empty_sent_pending_text),
                icon = icon,
                actionLabel = stringResource(R.string.interests_empty_sent_pending_action),
                onAction = { navigator.openOnTab(Tab.HOME, listOf(Matches)) },
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

/** The status label of an item from `display_status`; nothing for `pending` (16 section 6.9). */
@StringRes
private fun displayStatusLabel(status: DisplayStatus): Int? =
    when (status) {
        DisplayStatus.ACCEPTED -> R.string.interests_display_status_accepted
        DisplayStatus.NO_RESPONSE -> R.string.interests_display_status_no_response
        DisplayStatus.CLOSED -> R.string.interests_display_status_closed
        DisplayStatus.WITHDRAWN -> R.string.interests_display_status_withdrawn
        DisplayStatus.DECLINED -> R.string.interests_display_status_declined
        DisplayStatus.PENDING, DisplayStatus.UNKNOWN -> null
    }
