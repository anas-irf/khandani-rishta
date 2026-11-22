package com.khandanirishta.app.ui.feature.lists

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.Page
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.network.generated.model.VisitorItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class VisitorsUiState(
    /** 0: "Viewed me", 1: "I viewed". */
    val tab: Int = VisitorsViewModel.VIEWED_ME,
    /** The member browses privately, so the visitors are hidden from them too (09 section 8.2). */
    val hiddenBecausePrivate: Boolean = false,
)

/** APP-VISITORS (specs/16 section 6.14, 09 section 8): who viewed the profile, and the member's own history. */
@HiltViewModel
class VisitorsViewModel
    @Inject
    constructor(
        private val discovery: DiscoveryRepository,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(VisitorsUiState())
        val state: StateFlow<VisitorsUiState> = mutableState.asStateFlow()

        private val lists = mutableMapOf<Int, Paginator<VisitorItem>>()

        /** Lists that changed while the other tab was shown; refreshed when selected. */
        private val stale = mutableSetOf<Int>()

        init {
            paginator(VIEWED_ME)
            viewModelScope.launch { invalidation.on(DataKey.Visitors).collect { refetch() } }
        }

        fun list(tab: Int): StateFlow<PagedState<VisitorItem>> = paginator(tab).state

        fun refresh(tab: Int) = paginator(tab).refresh()

        fun loadMore(tab: Int) = paginator(tab).loadMore()

        fun selectTab(tab: Int) {
            if (tab == mutableState.value.tab) return
            val existing = lists[tab]
            when {
                existing == null -> paginator(tab)
                stale.remove(tab) -> existing.refresh(showSpinner = false)
                else -> existing.refreshIfStale()
            }
            mutableState.update { it.copy(tab = tab) }
        }

        /** The screen is shown again: refetch after 60 seconds (rule G5). */
        fun onResume() {
            lists[mutableState.value.tab]?.refreshIfStale()
        }

        private fun paginator(tab: Int): Paginator<VisitorItem> =
            lists.getOrPut(tab) {
                Paginator<VisitorItem>(viewModelScope, key = { it.profile.id }) { cursor ->
                    if (tab == VIEWED_ME) viewedMe(cursor) else discovery.visited(cursor)
                }.also { it.refresh() }
            }

        /** `GET /v1/me/visitors`; the first page says whether the list is hidden by private browsing. */
        private suspend fun viewedMe(cursor: String?): Result<Page<VisitorItem>> =
            discovery.visitors(cursor).map { page ->
                if (cursor == null) mutableState.update { it.copy(hiddenBecausePrivate = page.hiddenBecausePrivate) }
                Page(page.items, page.nextCursor)
            }

        private fun refetch() {
            val shown = mutableState.value.tab
            lists.forEach { (tab, list) ->
                if (tab == shown) list.refresh(showSpinner = false) else stale.add(tab)
            }
        }

        companion object {
            const val VIEWED_ME = 0
            const val I_VIEWED = 1
        }
    }
