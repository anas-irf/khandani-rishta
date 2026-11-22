package com.khandanirishta.app.ui.feature.interests

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.HideImage
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.PhotoAccessItem
import com.khandanirishta.app.core.network.generated.model.PhotoAccessStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AnswerRow
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTab
import com.khandanirishta.app.ui.components.KrTabs
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.SingleChoiceChips
import com.khandanirishta.app.ui.components.StatusPill
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.UnavailableRow
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.APPROVED
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.RECEIVED
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.RECEIVED_APPROVED
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.SENT
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.SENT_ALL
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.WAITING
import com.khandanirishta.app.ui.feature.lists.RowMeta
import com.khandanirishta.app.ui.feature.lists.rememberRelativeTime
import com.khandanirishta.app.ui.feature.lists.rowActions
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing

/** What the parts of APP-PHOTO-REQUESTS can do. */
@Immutable
internal class PhotoRequestsActions(
    val selectBox: (box: String) -> Unit,
    val selectFilter: (filter: String) -> Unit,
    val refresh: (listKey: String) -> Unit,
    val loadMore: (listKey: String) -> Unit,
    val openProfile: (id: String) -> Unit,
    val approve: (item: PhotoAccessItem, name: String) -> Unit,
    val deny: (PhotoAccessItem) -> Unit,
    val revoke: (item: PhotoAccessItem, name: String) -> Unit,
    val confirmRevoke: () -> Unit,
    val dismissRevoke: () -> Unit,
)

/**
 * APP-PHOTO-REQUESTS: requests to see the member's photos, answered here, and the member's own
 * requests (specs/16 section 6.16, 09 section 6.3).
 */
@Composable
fun PhotoRequestsScreen(
    box: String,
    modifier: Modifier = Modifier,
    viewModel: PhotoRequestsViewModel =
        hiltViewModel<PhotoRequestsViewModel, PhotoRequestsViewModel.Factory> { factory -> factory.create(box) },
) {
    val navigator = LocalNavigator.current
    val actions =
        remember(viewModel, navigator) {
            PhotoRequestsActions(
                selectBox = viewModel::selectBox,
                selectFilter = viewModel::selectFilter,
                refresh = viewModel::refresh,
                loadMore = viewModel::loadMore,
                openProfile = { navigator.push(Profile(it)) },
                approve = viewModel::approve,
                deny = viewModel::deny,
                revoke = viewModel::askRevoke,
                confirmRevoke = viewModel::confirmRevoke,
                dismissRevoke = viewModel::dismissRevoke,
            )
        }
    LifecycleResumeEffect(Unit) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    Scaffold(
        modifier = modifier,
        topBar = { DetailTopBar(title = stringResource(R.string.photo_requests_title), onBack = { navigator.back() }) },
    ) { padding ->
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            StatusGate(GateRouter.Level.ENGAGE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                val list by key(state.listKey) { viewModel.list(state.listKey).collectAsStateWithLifecycle() }
                PhotoRequestsContent(
                    state = state,
                    list = list,
                    pending = LocalMe.current?.counters?.pendingPhotoRequests ?: 0L,
                    actions = actions,
                )
            }
        }
    }
}

/** The tabs, then one list per tab and filter. */
@Composable
internal fun PhotoRequestsContent(
    state: PhotoRequestsUiState,
    list: PagedState<PhotoAccessItem>,
    pending: Long,
    actions: PhotoRequestsActions,
    modifier: Modifier = Modifier,
) {
    val listKey = state.listKey
    val received = listKey != SENT_ALL
    val listState = key(listKey) { rememberLazyListState() }
    val fallbackName = stringResource(R.string.photo_requests_member_fallback)
    Column(modifier.fillMaxSize()) {
        KrTabs(
            tabs =
                listOf(
                    KrTab(
                        label = stringResource(R.string.photo_requests_tabs_received),
                        count = pending,
                        countLabel = text(R.string.common_nav_badge_count, "count" to Formatters.badgeCount(pending)),
                    ),
                    KrTab(label = stringResource(R.string.photo_requests_tabs_sent)),
                ),
            selected = if (received) 0 else 1,
            onSelect = { index -> actions.selectBox(if (index == 1) SENT else RECEIVED) },
        )
        PagedList(
            state = list,
            key = { it.id },
            onRefresh = { actions.refresh(listKey) },
            onLoadMore = { actions.loadMore(listKey) },
            modifier = Modifier.weight(1f),
            listState = listState,
            header = {
                if (received) {
                    item(key = FILTER_KEY, contentType = FILTER_KEY) {
                        SingleChoiceChips(
                            options =
                                listOf(
                                    WAITING to stringResource(R.string.photo_requests_filter_waiting),
                                    APPROVED to stringResource(R.string.photo_requests_filter_approved),
                                ),
                            selected = state.filter,
                            onSelect = actions.selectFilter,
                            modifier = Modifier.padding(bottom = Spacing.s8),
                        )
                    }
                }
            },
            empty = { RequestsEmpty(listKey) },
        ) { item ->
            RequestItem(
                item = item,
                name = item.profile?.displayName ?: fallbackName,
                received = received,
                approving = item.id in state.approving,
                denying = item.id in state.denying,
                actions = actions,
            )
        }
        state.revoke?.let { dialog ->
            ConfirmDialog(
                title = stringResource(R.string.photo_requests_revoke_title),
                text = text(R.string.photo_requests_revoke_text, "name" to dialog.name),
                confirmLabel = stringResource(R.string.photo_requests_remove_access),
                onConfirm = actions.confirmRevoke,
                onDismiss = actions.dismissRevoke,
                variant = KrButtonVariant.INK,
                busy = state.revokeBusy,
            )
        }
    }
}

/** One request: the compact card of the other member, when it was asked, and its answers. */
@Composable
private fun RequestItem(
    item: PhotoAccessItem,
    name: String,
    received: Boolean,
    approving: Boolean,
    denying: Boolean,
    actions: PhotoRequestsActions,
) {
    val waiting = received && item.status == PhotoAccessStatus.PENDING
    val approved = received && item.status == PhotoAccessStatus.GRANTED
    val buttons: (@Composable ColumnScope.() -> Unit)? =
        if (waiting || approved) {
            {
                RequestButtons(
                    waiting = waiting,
                    approving = approving,
                    denying = denying,
                    onApprove = { actions.approve(item, name) },
                    onDeny = { actions.deny(item) },
                    onRevoke = { actions.revoke(item, name) },
                )
            }
        } else {
            null
        }
    val profile = item.profile
    if (profile == null) {
        // A grant can still be removed from a member who is no longer available (15 section 13).
        UnavailableRow(text = stringResource(R.string.photo_requests_unavailable)) {
            RequestDetails(item = item, received = received)
            buttons?.invoke(this)
        }
    } else {
        val online = LocalOnline.current
        val approveLabel = stringResource(R.string.photo_requests_approve)
        val denyLabel = stringResource(R.string.photo_requests_deny)
        ProfileRow(
            card = profile,
            onOpen = { actions.openProfile(profile.id) },
            details = {
                RequestDetails(
                    item = item,
                    received = received,
                    modifier =
                        Modifier.rowActions(
                            enabled = waiting && online && !approving && !denying,
                            approveLabel to { actions.approve(item, name) },
                            denyLabel to { actions.deny(item) },
                        ),
                )
            },
            actions = buttons,
        )
    }
}

/** "Asked {when}", and for the member's own requests "Waiting" or "Approved". */
@Composable
private fun RequestDetails(
    item: PhotoAccessItem,
    received: Boolean,
    modifier: Modifier = Modifier,
) {
    val asked = text(R.string.photo_requests_asked, "when" to rememberRelativeTime(item.createdAt))
    RowMeta(modifier) {
        CaptionText(asked)
        if (!received) {
            // Photos, not a tick: a tick means verified.
            val granted = item.status == PhotoAccessStatus.GRANTED
            StatusPill(
                text = sentStatusLabel(item.status),
                tone = if (granted) StatusTone.SUCCESS else StatusTone.NEUTRAL,
                icon = if (granted) Icons.Outlined.PhotoLibrary else Icons.Outlined.Schedule,
            )
        }
    }
}

@Composable
private fun RequestButtons(
    waiting: Boolean,
    approving: Boolean,
    denying: Boolean,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    onRevoke: () -> Unit,
) {
    val online = LocalOnline.current
    if (waiting) {
        AnswerRow(
            secondary = { answer ->
                KrButton(
                    text = stringResource(R.string.photo_requests_deny),
                    onClick = onDeny,
                    variant = KrButtonVariant.SECONDARY,
                    size = KrButtonSize.LARGE,
                    enabled = online && !approving,
                    loading = denying,
                    modifier = answer,
                )
            },
            primary = { answer ->
                KrButton(
                    text = stringResource(R.string.photo_requests_approve),
                    onClick = onApprove,
                    enabled = online && !denying,
                    loading = approving,
                    modifier = answer,
                )
            },
        )
    } else {
        KrButton(
            text = stringResource(R.string.photo_requests_remove_access),
            onClick = onRevoke,
            variant = KrButtonVariant.SECONDARY,
            enabled = online && !approving && !denying,
        )
    }
}

/** The empty state of each list (16 section 6.16). */
@Composable
private fun RequestsEmpty(listKey: String) {
    when (listKey) {
        RECEIVED_APPROVED -> {
            EmptyState(
                title = stringResource(R.string.photo_requests_empty_received_approved),
                icon = Icons.Outlined.LockOpen,
            )
        }

        SENT_ALL -> {
            EmptyState(
                title = stringResource(R.string.photo_requests_empty_sent),
                icon = Icons.Outlined.HideImage,
            )
        }

        else -> {
            EmptyState(
                title = stringResource(R.string.photo_requests_empty_received_waiting),
                icon = Icons.Outlined.PhotoLibrary,
            )
        }
    }
}

@Composable
private fun sentStatusLabel(status: PhotoAccessStatus): String =
    when (status) {
        PhotoAccessStatus.GRANTED -> stringResource(R.string.photo_requests_status_granted)
        PhotoAccessStatus.PENDING -> stringResource(R.string.photo_requests_status_pending)
        else -> status.wire.replace('_', ' ')
    }

private const val FILTER_KEY = "photo-requests:filter"
