package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.BlockItem
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.MonogramArch
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.rememberNow
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Spacing
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
    LifecycleResumeEffect(Unit) {
        viewModel.refreshIfStale()
        onPauseOrDispose { }
    }
    SettingsScaffold(title = stringResource(R.string.settings_blocked_title), modifier = modifier) {
        StatusGate(GateRouter.Level.CONNECTED) {
            BlockedList(
                state = list,
                onRefresh = { viewModel.refresh() },
                onLoadMore = { viewModel.loadMore() },
                onUnblock = viewModel::askUnblock,
            )
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

@Composable
internal fun BlockedList(
    state: PagedState<BlockItem>,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onUnblock: (profileId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    PagedList(
        state = state,
        key = { it.profileId },
        onRefresh = onRefresh,
        onLoadMore = onLoadMore,
        modifier = modifier.navigationBarsPadding(),
        header = {
            item(key = "intro", contentType = "intro") {
                Text(
                    text = stringResource(R.string.settings_blocked_text),
                    style = MaterialTheme.typography.bodyMedium,
                    color = KrTheme.colors.textSecondary,
                    modifier = Modifier.padding(bottom = Spacing.s16),
                )
            }
        },
        empty = {
            EmptyState(title = stringResource(R.string.settings_blocked_empty), icon = Icons.Outlined.PersonOff)
        },
    ) { block ->
        BlockedRow(block = block, onUnblock = { onUnblock(block.profileId) })
    }
}

/** A block: the monogram, the name, the code and when. At large text Unblock takes its own line. */
@Composable
private fun BlockedRow(
    block: BlockItem,
    onUnblock: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val now = rememberNow()
    val since = remember(block.createdAt, res, now) { Formatters.relative(res, block.createdAt, now) }
    val caption = KrType.caption.merge(KrType.numbers)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val unblock = stringResource(R.string.settings_blocked_unblock)
    AdaptiveRow(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.s12),
        spacing = Spacing.s16,
        lineSpacing = Spacing.s8,
    ) {
        Row(
            modifier =
                Modifier
                    .grow(basis = MemberBasis)
                    .semantics(mergeDescendants = true) {},
            horizontalArrangement = Arrangement.spacedBy(Spacing.s16),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MonogramArch(block.displayName)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                MemberText(block.displayName, style = MaterialTheme.typography.titleMedium)
                Text(text(R.string.settings_blocked_code, "code" to block.publicCode), style = caption, color = muted)
                Text(text(R.string.settings_blocked_since, "when" to since), style = caption, color = muted)
            }
        }
        KrButton(
            text = unblock,
            onClick = onUnblock,
            variant = KrButtonVariant.SECONDARY,
            enabled = LocalOnline.current,
            // Every row has this button, so it says whose it is.
            contentDescription = "$unblock, ${block.displayName}",
        )
    }
}

/** The unblock confirmation: which row it is for, and whether the request runs. */
@Immutable
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
        invalidation: Invalidation,
    ) : ViewModel() {
        private val paginator =
            Paginator<BlockItem>(viewModelScope, key = { it.profileId }) { cursor -> relations.blocks(cursor) }
        val items = paginator.state

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

private val MemberBasis = 180.dp
