package com.khandanirishta.app.ui.feature.interests

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.InterestRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Interest
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The confirmations of the list: the decline and withdraw dialogs of 16 section 6.7. */
@Immutable
sealed interface InterestDialog {
    val interest: Interest

    data class Decline(
        override val interest: Interest,
    ) : InterestDialog

    data class Withdraw(
        override val interest: Interest,
    ) : InterestDialog
}

@Immutable
data class InterestsUiState(
    /** `received` or `sent`. */
    val box: String = InterestsViewModel.RECEIVED,
    /** `pending`, `accepted` or `closed`. */
    val status: String = InterestsViewModel.PENDING,
    /** Interests whose "Accept" is waiting for the server. */
    val accepting: Set<String> = emptySet(),
    val dialog: InterestDialog? = null,
    val dialogBusy: Boolean = false,
)

sealed interface InterestsEvent {
    /** "Accept" succeeded: open `APP-CHAT` for the new connection. */
    data class OpenChat(
        val connectionId: String,
    ) : InterestsEvent
}

/**
 * APP-INTERESTS (specs/16 section 6.9, 11 sections 3 and 4). One cursor list per box and status,
 * kept while the screen lives. Nothing here is optimistic (rule G7): accepting, declining and
 * withdrawing wait for the server, then the item leaves the list.
 */
@HiltViewModel(assistedFactory = InterestsViewModel.Factory::class)
class InterestsViewModel
    @AssistedInject
    constructor(
        @Assisted initialBox: String,
        private val interests: InterestRepository,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(initialBox: String): InterestsViewModel
        }

        private data class ListKey(
            val box: String,
            val status: String,
        )

        private val mutableState = MutableStateFlow(InterestsUiState(box = if (initialBox == SENT) SENT else RECEIVED))
        val state: StateFlow<InterestsUiState> = mutableState.asStateFlow()

        private val channel = Channel<InterestsEvent>(Channel.BUFFERED)
        val events: Flow<InterestsEvent> = channel.receiveAsFlow()

        private val lists = mutableMapOf<ListKey, Paginator<Interest>>()

        /** Lists that changed on the server while another one was shown; refreshed when selected. */
        private val stale = mutableSetOf<ListKey>()

        /** Ids already sent to `POST /v1/interests/seen`: each id is sent once (11 section 3.2). */
        private val seenSent = mutableSetOf<String>()

        init {
            paginator(current())
            // Mutations, `interest.received`, `interest.accepted` and a socket reconnect all
            // invalidate the interests (applied centrally by the realtime coordinator).
            viewModelScope.launch { invalidation.on(DataKey.Interests).collect { refetch() } }
        }

        /** The list of one box and status. */
        fun list(
            box: String,
            status: String,
        ): StateFlow<PagedState<Interest>> = paginator(ListKey(box, status)).state

        /** A tab change shows the default filter of that tab ("New" or "Waiting"). */
        fun selectBox(box: String) {
            if (box == mutableState.value.box) return
            select(ListKey(box, PENDING))
        }

        fun selectStatus(status: String) {
            val current = mutableState.value
            if (status == current.status) return
            select(ListKey(current.box, status))
        }

        fun refresh(
            box: String,
            status: String,
        ) = paginator(ListKey(box, status)).refresh()

        fun loadMore(
            box: String,
            status: String,
        ) = paginator(ListKey(box, status)).loadMore()

        /** The screen is shown again: refetch after 60 seconds (rule G5). */
        fun onResume() {
            lists[current()]?.refreshIfStale()
        }

        fun accept(interest: Interest) {
            if (interest.id in mutableState.value.accepting) return
            mutableState.update { it.copy(accepting = it.accepting + interest.id) }
            viewModelScope.launch {
                interests
                    .accept(interest.id, interest.profile?.id)
                    .onSuccess { accepted ->
                        removeEverywhere(interest.id)
                        bus.toast(R.string.interests_accept_success)
                        channel.send(InterestsEvent.OpenChat(accepted.connection.id))
                    }.onFailure { throwable ->
                        val error = throwable.apiError
                        when (error.code) {
                            ErrorCode.LIMIT_REACHED -> bus.limit(acceptLimitText(error))
                            ErrorCode.INVALID_STATE, ErrorCode.NOT_FOUND -> refetch()
                            else -> bus.error(error)
                        }
                    }
                mutableState.update { it.copy(accepting = it.accepting - interest.id) }
            }
        }

        fun askDecline(interest: Interest) {
            mutableState.update { it.copy(dialog = InterestDialog.Decline(interest), dialogBusy = false) }
        }

        fun askWithdraw(interest: Interest) {
            mutableState.update { it.copy(dialog = InterestDialog.Withdraw(interest), dialogBusy = false) }
        }

        fun dismissDialog() {
            if (mutableState.value.dialogBusy) return
            mutableState.update { it.copy(dialog = null) }
        }

        /**
         * Declines, with [alsoBlock] from the decline sheet, or withdraws. The dialog closes on
         * success and stays open on an error the member can retry.
         */
        fun confirmDialog(alsoBlock: Boolean) {
            val current = mutableState.value
            val dialog = current.dialog ?: return
            if (current.dialogBusy) return
            mutableState.update { it.copy(dialogBusy = true) }
            viewModelScope.launch {
                val interest = dialog.interest
                val profileId = interest.profile?.id
                val result =
                    when (dialog) {
                        is InterestDialog.Decline -> interests.decline(interest.id, profileId, alsoBlock)
                        is InterestDialog.Withdraw -> interests.withdraw(interest.id, profileId)
                    }
                val success =
                    when (dialog) {
                        is InterestDialog.Decline -> R.string.interests_decline_success
                        is InterestDialog.Withdraw -> R.string.interests_withdraw_success
                    }
                result
                    .onSuccess {
                        mutableState.update { it.copy(dialog = null, dialogBusy = false) }
                        removeEverywhere(interest.id)
                        bus.toast(success)
                    }.onFailure { throwable ->
                        val error = throwable.apiError
                        if (error.code == ErrorCode.INVALID_STATE || error.code == ErrorCode.NOT_FOUND) {
                            // Answered or withdrawn elsewhere: show the list as it is now.
                            mutableState.update { it.copy(dialog = null, dialogBusy = false) }
                            refetch()
                        } else {
                            mutableState.update { it.copy(dialogBusy = false) }
                            bus.error(error)
                        }
                    }
            }
        }

        /**
         * The received items shown for one second on the "New" list: `POST /v1/interests/seen`,
         * once per id, at most 100 ids per call. Failures are ignored (16 section 6.9).
         */
        fun markSeen(ids: List<String>) {
            val fresh = ids.filter { it !in seenSent }
            if (fresh.isEmpty()) return
            seenSent += fresh
            viewModelScope.launch {
                fresh.chunked(SEEN_BATCH).forEach { batch -> interests.markSeen(batch) }
                val done = fresh.toSet()
                lists.values.forEach { list ->
                    list.update { items -> items.map { if (it.id in done && !it.seen) it.copy(seen = true) else it } }
                }
            }
        }

        private fun current(): ListKey = mutableState.value.let { ListKey(it.box, it.status) }

        private fun select(which: ListKey) {
            val existing = lists[which]
            when {
                existing == null -> paginator(which)
                stale.remove(which) -> existing.refresh(showSpinner = false)
                else -> existing.refreshIfStale()
            }
            mutableState.update { it.copy(box = which.box, status = which.status) }
        }

        private fun paginator(which: ListKey): Paginator<Interest> =
            lists.getOrPut(which) {
                Paginator<Interest>(viewModelScope, key = { it.id }) { cursor ->
                    interests.list(which.box, which.status, cursor)
                }.also { it.refresh() }
            }

        /** The server changed: refresh the list on screen now, and the others when they are opened. */
        private fun refetch() {
            val shown = current()
            lists.forEach { (which, list) ->
                if (which == shown) list.refresh(showSpinner = false) else stale.add(which)
            }
        }

        private fun removeEverywhere(interestId: String) {
            lists.values.forEach { it.remove(interestId) }
        }

        /** The limit text for accepting: the connection cap is full on this side or on theirs. */
        private fun acceptLimitText(error: ApiError): UiText? =
            when (error.detailString("side")) {
                "you" -> UiText.of(R.string.interests_limit_accept_you)
                "them" -> UiText.of(R.string.interests_limit_accept_them)
                else -> null
            }

        companion object {
            const val RECEIVED = "received"
            const val SENT = "sent"
            const val PENDING = "pending"
            const val ACCEPTED = "accepted"
            const val CLOSED = "closed"
            val STATUSES = listOf(PENDING, ACCEPTED, CLOSED)
            private const val SEEN_BATCH = 100
        }
    }
