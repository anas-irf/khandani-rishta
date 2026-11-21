package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.BlockItem
import com.khandanirishta.app.core.realtime.ConnectivityObserver
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.TintedIcon
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.text.text
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * SET-BLOCKED: see and undo blocks (specs/16 section 6.29). One row per block with the name, the
 * profile code and when it was blocked; no photo and no link to the profile.
 */
@Composable
fun BlockedMembersScreen(
    modifier: Modifier = Modifier,
    viewModel: BlockedMembersViewModel = hiltViewModel(),
) {
    val list by viewModel.items.collectAsStateWithLifecycle()
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()
    val online by viewModel.online.collectAsStateWithLifecycle()
    LifecycleResumeEffect(Unit) {
        viewModel.refreshIfStale()
        onPauseOrDispose { }
    }
    SettingsScaffold(title = stringResource(R.string.settings_blocked_title), modifier = modifier) { padding ->
        Box(Modifier.padding(padding)) {
            StatusGate(GateRouter.Level.CONNECTED) {
                PagedList(
                    state = list,
                    key = { it.profileId },
                    onRefresh = viewModel::refresh,
                    onLoadMore = viewModel::loadMore,
                    header = {
                        item(key = "intro") {
                            Text(
                                stringResource(R.string.settings_blocked_text),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
                            )
                        }
                    },
                    empty = {
                        EmptyState(
                            title = stringResource(R.string.settings_blocked_empty),
                            icon = Icons.Outlined.Block,
                        )
                    },
                ) { block ->
                    BlockedRow(block = block, enabled = online, onUnblock = { viewModel.askUnblock(block.profileId) })
                }
            }
            val target = list.items.firstOrNull { it.profileId == dialog.targetId }
            if (target != null) {
                ConfirmDialog(
                    title = text(R.string.settings_blocked_unblock_dialog_title, "name" to target.displayName),
                    text = stringResource(R.string.settings_blocked_unblock_dialog_text),
                    confirmLabel = stringResource(R.string.settings_blocked_unblock),
                    onConfirm = { viewModel.unblock(target.profileId) },
                    onDismiss = viewModel::dismiss,
                    busy = dialog.busy,
                )
            }
        }
    }
}

@Composable
private fun BlockedRow(
    block: BlockItem,
    enabled: Boolean,
    onUnblock: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            TintedIcon(
                icon = Icons.Outlined.PersonOff,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                container = MaterialTheme.colorScheme.surfaceContainerHigh,
            )
            Spacer(Modifier.width(12.dp))
            Column(
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {},
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    block.displayName,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text(R.string.settings_blocked_code, "code" to block.publicCode),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text(R.string.settings_blocked_since, "when" to Formatters.relative(res, block.createdAt)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = onUnblock, enabled = enabled) {
                Text(stringResource(R.string.settings_blocked_unblock))
            }
        }
    }
}

/** The unblock confirmation: which row it is for, and whether the request runs. */
data class UnblockDialogState(
    val targetId: String? = null,
    val busy: Boolean = false,
)

/** SET-BLOCKED: `GET /v1/blocks`, paginated, and `DELETE /v1/blocks/{profile_id}` (specs/16 section 6.29). */
@HiltViewModel
class BlockedMembersViewModel
    @Inject
    constructor(
        private val relations: RelationRepository,
        private val bus: MessageBus,
        connectivity: ConnectivityObserver,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val paginator =
            Paginator<BlockItem>(viewModelScope, key = { it.profileId }) { cursor -> relations.blocks(cursor) }
        val items = paginator.state

        /** Network actions are disabled while offline (rule G14). */
        val online: StateFlow<Boolean> = connectivity.online

        private val mutableDialog = MutableStateFlow(UnblockDialogState())
        val dialog: StateFlow<UnblockDialogState> = mutableDialog.asStateFlow()

        init {
            paginator.refresh()
            viewModelScope.launch {
                invalidation.on(DataKey.Blocks).collect { paginator.refresh(showSpinner = false) }
            }
        }

        fun refresh() = paginator.refresh()

        fun loadMore() = paginator.loadMore()

        /** Rule G5: a list opened again after 60 seconds or more is fetched again. */
        fun refreshIfStale() = paginator.refreshIfStale()

        fun askUnblock(profileId: String) {
            mutableDialog.value = UnblockDialogState(targetId = profileId)
        }

        fun dismiss() {
            if (mutableDialog.value.busy) return
            mutableDialog.value = UnblockDialogState()
        }

        fun unblock(profileId: String) {
            if (mutableDialog.value.busy) return
            mutableDialog.update { it.copy(busy = true) }
            viewModelScope.launch {
                relations
                    .unblock(profileId)
                    .onSuccess {
                        paginator.remove(profileId)
                        mutableDialog.value = UnblockDialogState()
                        bus.toast(R.string.settings_blocked_unblocked)
                    }.onFailure { error ->
                        val apiError = error.apiError
                        if (apiError.code == ErrorCode.NOT_FOUND) {
                            // Already unblocked elsewhere: the row is stale, so fetch the list again.
                            mutableDialog.value = UnblockDialogState()
                            paginator.refresh(showSpinner = false)
                        } else {
                            mutableDialog.update { it.copy(busy = false) }
                            bus.error(apiError)
                        }
                    }
            }
        }
    }
