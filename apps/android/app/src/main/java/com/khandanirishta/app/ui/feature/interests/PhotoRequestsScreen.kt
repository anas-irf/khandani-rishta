package com.khandanirishta.app.ui.feature.interests

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.HideImage
import androidx.compose.material.icons.outlined.HourglassBottom
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.PhotoAccessItem
import com.khandanirishta.app.core.network.generated.model.PhotoAccessStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.APPROVED
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.RECEIVED
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.RECEIVED_APPROVED
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.SENT
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.SENT_ALL
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsViewModel.Companion.WAITING
import com.khandanirishta.app.ui.feature.lists.ButtonSpinner
import com.khandanirishta.app.ui.feature.lists.FilterChipRow
import com.khandanirishta.app.ui.feature.lists.ListTab
import com.khandanirishta.app.ui.feature.lists.ListTabs
import com.khandanirishta.app.ui.feature.lists.MetaLine
import com.khandanirishta.app.ui.feature.lists.UnavailableCard
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import kotlinx.coroutines.flow.StateFlow

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
    LifecycleResumeEffect(Unit) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    Scaffold(
        modifier = modifier,
        topBar = { DetailTopBar(title = stringResource(R.string.photo_requests_title), onBack = { navigator.back() }) },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            StatusGate(GateRouter.Level.ENGAGE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                PhotoRequestsContent(
                    state = state,
                    listFlow = viewModel.list(state.listKey),
                    onSelectBox = viewModel::selectBox,
                    onSelectFilter = viewModel::selectFilter,
                    onRefresh = viewModel::refresh,
                    onLoadMore = viewModel::loadMore,
                    onApprove = viewModel::approve,
                    onDeny = viewModel::deny,
                    onRevoke = viewModel::askRevoke,
                    onConfirmRevoke = viewModel::confirmRevoke,
                    onDismissRevoke = viewModel::dismissRevoke,
                )
            }
        }
    }
}

@Composable
private fun PhotoRequestsContent(
    state: PhotoRequestsUiState,
    listFlow: StateFlow<PagedState<PhotoAccessItem>>,
    onSelectBox: (String) -> Unit,
    onSelectFilter: (String) -> Unit,
    onRefresh: (listKey: String) -> Unit,
    onLoadMore: (listKey: String) -> Unit,
    onApprove: (item: PhotoAccessItem, name: String) -> Unit,
    onDeny: (PhotoAccessItem) -> Unit,
    onRevoke: (item: PhotoAccessItem, name: String) -> Unit,
    onConfirmRevoke: () -> Unit,
    onDismissRevoke: () -> Unit,
) {
    val pending = LocalMe.current?.counters?.pendingPhotoRequests ?: 0L

    Column(Modifier.fillMaxSize()) {
        ListTabs(
            tabs =
                listOf(
                    ListTab(
                        label = stringResource(R.string.photo_requests_tabs_received),
                        badge = pending,
                        badgeDescription =
                            text(R.string.common_nav_badge_count, "count" to Formatters.badgeCount(pending)),
                    ),
                    ListTab(label = stringResource(R.string.photo_requests_tabs_sent)),
                ),
            selected = if (state.box == SENT) 1 else 0,
            onSelect = { index -> onSelectBox(if (index == 1) SENT else RECEIVED) },
        )
        if (state.box == RECEIVED) {
            FilterChipRow(
                options =
                    listOf(
                        WAITING to stringResource(R.string.photo_requests_filter_waiting),
                        APPROVED to stringResource(R.string.photo_requests_filter_approved),
                    ),
                selected = state.filter,
                onSelect = onSelectFilter,
            )
        }
        key(state.listKey) {
            RequestList(
                listFlow = listFlow,
                state = state,
                onRefresh = onRefresh,
                onLoadMore = onLoadMore,
                onApprove = onApprove,
                onDeny = onDeny,
                onRevoke = onRevoke,
                modifier = Modifier.weight(1f),
            )
        }
        state.revoke?.let { dialog ->
            ConfirmDialog(
                title = stringResource(R.string.photo_requests_revoke_title),
                text = text(R.string.photo_requests_revoke_text, "name" to dialog.name),
                confirmLabel = stringResource(R.string.photo_requests_remove_access),
                onConfirm = onConfirmRevoke,
                onDismiss = onDismissRevoke,
                destructive = true,
                busy = state.revokeBusy,
            )
        }
    }
}

@Composable
private fun RequestList(
    listFlow: StateFlow<PagedState<PhotoAccessItem>>,
    state: PhotoRequestsUiState,
    onRefresh: (listKey: String) -> Unit,
    onLoadMore: (listKey: String) -> Unit,
    onApprove: (item: PhotoAccessItem, name: String) -> Unit,
    onDeny: (PhotoAccessItem) -> Unit,
    onRevoke: (item: PhotoAccessItem, name: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val navigator = LocalNavigator.current
    val listKey = state.listKey
    val received = listKey != SENT_ALL
    val list by listFlow.collectAsStateWithLifecycle()
    val fallbackName = stringResource(R.string.photo_requests_member_fallback)

    PagedList(
        state = list,
        key = { it.id },
        onRefresh = { onRefresh(listKey) },
        onLoadMore = { onLoadMore(listKey) },
        modifier = modifier,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = if (received) 4.dp else 12.dp, bottom = 24.dp),
        empty = { RequestsEmpty(listKey) },
    ) { item ->
        val name = item.profile?.displayName ?: fallbackName
        RequestItem(
            item = item,
            received = received,
            approving = item.id in state.approving,
            denying = item.id in state.denying,
            online = state.online,
            onOpenProfile = { profileId -> navigator.push(Profile(profileId)) },
            onApprove = { onApprove(item, name) },
            onDeny = { onDeny(item) },
            onRevoke = { onRevoke(item, name) },
        )
    }
}

/** One request: the compact card of the other member, when it was asked, and its answers. */
@Composable
private fun RequestItem(
    item: PhotoAccessItem,
    received: Boolean,
    approving: Boolean,
    denying: Boolean,
    online: Boolean,
    onOpenProfile: (String) -> Unit,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    onRevoke: () -> Unit,
) {
    val waiting = received && item.status == PhotoAccessStatus.PENDING
    val approved = received && item.status == PhotoAccessStatus.GRANTED
    val buttons: (@Composable () -> Unit)? =
        if (waiting || approved) {
            {
                RequestButtons(
                    waiting = waiting,
                    approving = approving,
                    denying = denying,
                    online = online,
                    onApprove = onApprove,
                    onDeny = onDeny,
                    onRevoke = onRevoke,
                )
            }
        } else {
            null
        }
    val profile = item.profile
    if (profile == null) {
        // A grant can still be removed from a member who is no longer available (15 section 13).
        UnavailableCard(title = stringResource(R.string.photo_requests_unavailable)) {
            RequestDetails(item = item, received = received)
            buttons?.invoke()
        }
    } else {
        ProfileRow(
            card = profile,
            onOpen = { onOpenProfile(profile.id) },
            extra = { RequestDetails(item = item, received = received) },
            actions = buttons,
        )
    }
}

/** "Asked {when}", and for the member's own requests "Waiting" or "Approved". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RequestDetails(
    item: PhotoAccessItem,
    received: Boolean,
) {
    val res = LocalResources.current
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        MetaLine(text(R.string.photo_requests_asked, "when" to Formatters.relative(res, item.createdAt)))
        if (!received) {
            val granted = item.status == PhotoAccessStatus.GRANTED
            MetaLine(
                text = sentStatusLabel(item.status),
                icon = if (granted) Icons.Outlined.TaskAlt else Icons.Outlined.HourglassBottom,
                color = if (granted) KrTheme.colors.success else MaterialTheme.colorScheme.onSurface,
                emphasis = true,
            )
        }
    }
}

@Composable
private fun RequestButtons(
    waiting: Boolean,
    approving: Boolean,
    denying: Boolean,
    online: Boolean,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    onRevoke: () -> Unit,
) {
    val answering = approving || denying
    if (waiting) {
        val approveLabel = stringResource(R.string.photo_requests_approve)
        val denyLabel = stringResource(R.string.photo_requests_deny)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onApprove,
                enabled = online && !answering,
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .semantics { contentDescription = approveLabel },
            ) {
                if (approving) ButtonSpinner() else Text(approveLabel)
            }
            OutlinedButton(
                onClick = onDeny,
                enabled = online && !answering,
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .semantics { contentDescription = denyLabel },
            ) {
                if (denying) ButtonSpinner() else Text(denyLabel)
            }
        }
    } else {
        OutlinedButton(onClick = onRevoke, enabled = online && !answering, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.photo_requests_remove_access))
        }
    }
}

/** The empty state of each list (16 section 6.16). */
@Composable
private fun RequestsEmpty(listKey: String) {
    when (listKey) {
        RECEIVED_APPROVED -> {
            EmptyState(
                title = stringResource(R.string.photo_requests_empty_received_approved),
                icon = Icons.Outlined.HowToReg,
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
