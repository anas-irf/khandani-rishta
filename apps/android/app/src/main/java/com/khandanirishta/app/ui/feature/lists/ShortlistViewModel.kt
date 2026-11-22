package com.khandanirishta.app.ui.feature.lists

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.ShortlistItem
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The "Edit note" dialog of one entry. */
@Immutable
data class NoteEditor(
    val profileId: String,
    val name: String,
    val note: String?,
)

@Immutable
data class ShortlistUiState(
    val editor: NoteEditor? = null,
    val savingNote: Boolean = false,
)

/**
 * APP-SHORTLIST (specs/16 section 6.13, 11 section 12): the private list of saved profiles.
 * Removing is optimistic with "Removed. Undo" (rule G7); notes wait for the server.
 */
@HiltViewModel
class ShortlistViewModel
    @Inject
    constructor(
        private val relations: RelationRepository,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ShortlistUiState())
        val state: StateFlow<ShortlistUiState> = mutableState.asStateFlow()

        private val paginator =
            Paginator<ShortlistItem>(viewModelScope, key = { it.profileId }) { cursor -> relations.shortlist(cursor) }
        val list: StateFlow<PagedState<ShortlistItem>> = paginator.state

        init {
            paginator.refresh()
            viewModelScope.launch {
                invalidation.on(DataKey.Shortlist).collect { paginator.refresh(showSpinner = false) }
            }
        }

        fun refresh() = paginator.refresh()

        fun loadMore() = paginator.loadMore()

        /** The screen is shown again: refetch after 60 seconds (rule G5). */
        fun onResume() = paginator.refreshIfStale()

        /**
         * "Remove": the row leaves at once with "Removed. Undo" for 5 seconds; "Undo" saves the
         * entry again with its note. Works with `profile_id` alone, so unavailable rows can go too.
         */
        fun remove(entry: ShortlistItem) {
            val index = list.value.items.indexOfFirst { it.profileId == entry.profileId }
            if (index < 0) return
            paginator.remove(entry.profileId)
            bus.toast(UiText.of(R.string.discovery_shortlist_removed), UiText.of(R.string.discovery_shortlist_undo)) {
                // The toast can outlive this screen, so the save runs in the repository's scope; the
                // shortlist is refetched when it succeeds (it invalidates DataKey.Shortlist).
                restore(entry, index)
                relations.addToShortlistInBackground(entry.profileId, entry.note)
            }
            viewModelScope.launch {
                relations.removeFromShortlist(entry.profileId).onFailure { error ->
                    restore(entry, index)
                    bus.error(error.apiError)
                }
            }
        }

        fun editNote(
            entry: ShortlistItem,
            name: String,
        ) {
            mutableState.update { it.copy(editor = NoteEditor(entry.profileId, name, entry.note), savingNote = false) }
        }

        fun dismissNote() {
            if (mutableState.value.savingNote) return
            mutableState.update { it.copy(editor = null) }
        }

        /** "Save": `PUT /v1/shortlist/{profile_id}` with the note; an empty note clears it. */
        fun saveNote(text: String) {
            val current = mutableState.value
            val editor = current.editor ?: return
            if (current.savingNote) return
            val note = text.trim().take(NOTE_MAX).ifEmpty { null }
            mutableState.update { it.copy(savingNote = true) }
            viewModelScope.launch {
                relations
                    .addToShortlist(editor.profileId, note)
                    .onSuccess {
                        paginator.updateItem(editor.profileId) { it.copy(note = note) }
                        mutableState.update { it.copy(editor = null, savingNote = false) }
                        bus.toast(R.string.discovery_shortlist_note_saved)
                    }.onFailure { error ->
                        // The dialog stays open with the text, so the member can try again.
                        mutableState.update { it.copy(savingNote = false) }
                        showPutError(error.apiError)
                    }
            }
        }

        /** Puts an entry back where it was, unless a refetch already brought it back. */
        private fun restore(
            entry: ShortlistItem,
            index: Int,
        ) {
            paginator.update { items ->
                if (items.any { it.profileId == entry.profileId }) {
                    items
                } else {
                    items.toMutableList().apply { add(index.coerceIn(0, size), entry) }
                }
            }
        }

        /** A full shortlist (200 entries, 11 section 12) has its own text; anything else is generic. */
        private fun showPutError(error: ApiError) {
            if (error.code == ErrorCode.LIMIT_REACHED) {
                bus.limit(UiText.of(R.string.shared_shortlist_full))
            } else {
                bus.error(error)
            }
        }

        companion object {
            /** A note has at most 300 characters (16 section 6.13). */
            const val NOTE_MAX = 300
        }
    }
