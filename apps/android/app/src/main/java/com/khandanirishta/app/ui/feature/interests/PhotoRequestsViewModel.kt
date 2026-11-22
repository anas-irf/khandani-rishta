package com.khandanirishta.app.ui.feature.interests

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.Page
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.PhotoAccessItem
import com.khandanirishta.app.ui.messages.MessageBus
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** "Remove access" waiting for its confirmation (16 section 6.16). */
@Immutable
data class RevokeDialog(
    val item: PhotoAccessItem,
    val name: String,
)

@Immutable
data class PhotoRequestsUiState(
    /** `received` or `sent`. */
    val box: String = PhotoRequestsViewModel.RECEIVED,
    /** Under Received: `waiting` or `approved`. */
    val filter: String = PhotoRequestsViewModel.WAITING,
    /** Requests whose "Approve" or "Not now" waits for the server. */
    val approving: Set<String> = emptySet(),
    val denying: Set<String> = emptySet(),
    val revoke: RevokeDialog? = null,
    val revokeBusy: Boolean = false,
) {
    /** The list on screen for the tab and the filter. */
    val listKey: String
        get() =
            when {
                box == PhotoRequestsViewModel.SENT -> PhotoRequestsViewModel.SENT_ALL
                filter == PhotoRequestsViewModel.APPROVED -> PhotoRequestsViewModel.RECEIVED_APPROVED
                else -> PhotoRequestsViewModel.RECEIVED_WAITING
            }
}

/**
 * APP-PHOTO-REQUESTS (specs/16 section 6.16, 09 section 6.3): requests to see the member's photos,
 * and the member's own requests. Answers wait for the server (rule G7).
 */
@HiltViewModel(assistedFactory = PhotoRequestsViewModel.Factory::class)
class PhotoRequestsViewModel
    @AssistedInject
    constructor(
        @Assisted initialBox: String,
        private val relations: RelationRepository,
        private val me: MeRepository,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(initialBox: String): PhotoRequestsViewModel
        }

        private val mutableState =
            MutableStateFlow(PhotoRequestsUiState(box = if (initialBox == SENT) SENT else RECEIVED))
        val state: StateFlow<PhotoRequestsUiState> = mutableState.asStateFlow()

        private val lists = mutableMapOf<String, Paginator<PhotoAccessItem>>()

        /** Lists that changed while another one was shown; refreshed when selected. */
        private val stale = mutableSetOf<String>()

        init {
            paginator(current())
            viewModelScope.launch { invalidation.on(DataKey.PhotoAccess).collect { refetch() } }
        }

        /** One of the three lists: [RECEIVED_WAITING], [RECEIVED_APPROVED] or [SENT_ALL]. */
        fun list(listKey: String): StateFlow<PagedState<PhotoAccessItem>> = paginator(listKey).state

        fun refresh(listKey: String) = paginator(listKey).refresh()

        fun loadMore(listKey: String) = paginator(listKey).loadMore()

        fun selectBox(box: String) {
            if (box == mutableState.value.box) return
            mutableState.update { it.copy(box = box) }
            show(current())
        }

        fun selectFilter(filter: String) {
            if (filter == mutableState.value.filter) return
            mutableState.update { it.copy(filter = filter) }
            show(current())
        }

        /** The screen is shown again: refetch after 60 seconds (rule G5). */
        fun onResume() {
            lists[current()]?.refreshIfStale()
        }

        /** "Approve": the item leaves "Waiting" and shows under "Approved". */
        fun approve(
            item: PhotoAccessItem,
            name: String,
        ) {
            if (isAnswering(item.id)) return
            mutableState.update { it.copy(approving = it.approving + item.id) }
            viewModelScope.launch {
                relations
                    .grantRequest(item.id, item.profileId)
                    .onSuccess {
                        lists[RECEIVED_WAITING]?.remove(item.id)
                        bus.toast(R.string.photo_requests_approved_toast, "name" to name)
                    }.onFailure { answerFailed(it.apiError) }
                mutableState.update { it.copy(approving = it.approving - item.id) }
            }
        }

        /** "Not now": the item leaves the list; the requester is not told. */
        fun deny(item: PhotoAccessItem) {
            if (isAnswering(item.id)) return
            mutableState.update { it.copy(denying = it.denying + item.id) }
            viewModelScope.launch {
                relations
                    .denyRequest(item.id, item.profileId)
                    .onSuccess { lists[RECEIVED_WAITING]?.remove(item.id) }
                    .onFailure { answerFailed(it.apiError) }
                mutableState.update { it.copy(denying = it.denying - item.id) }
            }
        }

        fun askRevoke(
            item: PhotoAccessItem,
            name: String,
        ) {
            mutableState.update { it.copy(revoke = RevokeDialog(item, name), revokeBusy = false) }
        }

        fun dismissRevoke() {
            if (mutableState.value.revokeBusy) return
            mutableState.update { it.copy(revoke = null) }
        }

        /** "Remove access": works from `profile_id`, so a member no longer available can lose access too. */
        fun confirmRevoke() {
            val current = mutableState.value
            val dialog = current.revoke ?: return
            if (current.revokeBusy) return
            mutableState.update { it.copy(revokeBusy = true) }
            viewModelScope.launch {
                val profileId = dialog.item.profileId
                relations
                    .removeAccess(profileId)
                    .onSuccess {
                        lists[RECEIVED_APPROVED]?.update { items -> items.filterNot { it.profileId == profileId } }
                        mutableState.update { it.copy(revoke = null, revokeBusy = false) }
                        bus.toast(R.string.photo_requests_access_removed)
                    }.onFailure { error ->
                        // The dialog stays open so the member can try again.
                        mutableState.update { it.copy(revokeBusy = false) }
                        bus.error(error.apiError)
                    }
            }
        }

        private fun isAnswering(id: String): Boolean = mutableState.value.let { id in it.approving || id in it.denying }

        /**
         * A request answered or withdrawn elsewhere (`invalid_state`, `not_found`) is simply
         * refetched; any other failure also shows its message.
         */
        private suspend fun answerFailed(error: ApiError) {
            if (error.code != ErrorCode.INVALID_STATE && error.code != ErrorCode.NOT_FOUND) bus.error(error)
            refetch()
            me.refresh()
        }

        private fun current(): String = mutableState.value.listKey

        private fun show(listKey: String) {
            val existing = lists[listKey]
            when {
                existing == null -> paginator(listKey)
                stale.remove(listKey) -> existing.refresh(showSpinner = false)
                else -> existing.refreshIfStale()
            }
        }

        private fun paginator(listKey: String): Paginator<PhotoAccessItem> =
            lists.getOrPut(listKey) {
                Paginator<PhotoAccessItem>(viewModelScope, key = { it.id }) { cursor ->
                    when (listKey) {
                        SENT_ALL -> sentPage(cursor)
                        RECEIVED_APPROVED -> relations.photoAccess(RECEIVED, GRANTED, cursor)
                        else -> relations.photoAccess(RECEIVED, PENDING, cursor)
                    }
                }.also { it.refresh() }
            }

        /**
         * The Sent tab: the waiting requests, then the approved ones listed under them, as one list
         * (16 section 6.16). The cursor says which part the next page comes from.
         */
        private suspend fun sentPage(cursor: String?): Result<Page<PhotoAccessItem>> {
            if (cursor != null && cursor.startsWith(GRANTED_CURSOR)) {
                return relations
                    .photoAccess(SENT, GRANTED, cursor.removePrefix(GRANTED_CURSOR).ifEmpty { null })
                    .map { page -> Page(page.items, page.nextCursor?.let { GRANTED_CURSOR + it }) }
            }
            val waiting =
                relations
                    .photoAccess(SENT, PENDING, cursor?.removePrefix(PENDING_CURSOR)?.ifEmpty { null })
                    .getOrElse { return Result.failure(it) }
            val next = waiting.nextCursor
            if (next != null) return Result.success(Page(waiting.items, PENDING_CURSOR + next))
            val approved = relations.photoAccess(SENT, GRANTED, null).getOrElse { return Result.failure(it) }
            val after = approved.nextCursor?.let { GRANTED_CURSOR + it }
            return Result.success(Page(waiting.items + approved.items, after))
        }

        /** The server changed: refresh the list on screen now, and the others when they are opened. */
        private fun refetch() {
            val shown = current()
            lists.forEach { (listKey, list) ->
                if (listKey == shown) list.refresh(showSpinner = false) else stale.add(listKey)
            }
        }

        companion object {
            const val RECEIVED = "received"
            const val SENT = "sent"
            const val WAITING = "waiting"
            const val APPROVED = "approved"

            /** The three lists of the screen. */
            const val RECEIVED_WAITING = "received_waiting"
            const val RECEIVED_APPROVED = "received_approved"
            const val SENT_ALL = "sent"

            private const val PENDING = "pending"
            private const val GRANTED = "granted"
            private const val PENDING_CURSOR = "p:"
            private const val GRANTED_CURSOR = "g:"
        }
    }
