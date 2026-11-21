package com.khandanirishta.app.core.data

import android.os.SystemClock
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One page of a cursor list (specs/15 section 1). */
data class Page<T>(
    val items: List<T>,
    val nextCursor: String?,
)

/** The state of a paged list, for one screen. */
data class PagedState<T>(
    val items: List<T> = emptyList(),
    /** The first page is loading and nothing is shown yet (skeleton, rule G1). */
    val isLoading: Boolean = true,
    /** Pull to refresh is running over the shown items. */
    val isRefreshing: Boolean = false,
    /** A further page is loading (spinner row, rule G6). */
    val isAppending: Boolean = false,
    /** The first page failed (rule G3). */
    val error: ApiError? = null,
    /** A further page failed; the list stays. */
    val appendError: ApiError? = null,
    val endReached: Boolean = false,
) {
    val isEmpty: Boolean get() = !isLoading && error == null && items.isEmpty()
}

/**
 * Cursor pagination with `limit=20` and infinite scroll (specs/16 rule G6). Holds the items in
 * memory so screens can apply optimistic changes (rule G7) with [update] and [remove].
 */
class Paginator<T>(
    private val scope: CoroutineScope,
    private val key: (T) -> String,
    private val clock: () -> Long = SystemClock::elapsedRealtime,
    private val fetch: suspend (cursor: String?) -> Result<Page<T>>,
) {
    private val mutableState = MutableStateFlow(PagedState<T>())
    val state: StateFlow<PagedState<T>> = mutableState.asStateFlow()

    private var cursor: String? = null
    private var job: Job? = null

    /** When the first page last loaded; `null` until it has. */
    private var loadedAt: Long? = null

    /**
     * Loads the first page. With items shown, it refreshes over them. Without [showSpinner], a list
     * that has loaded before stays exactly as shown (even an empty one) until the new page arrives,
     * and a failure keeps it: a background refresh must not flash a skeleton or an error.
     */
    fun refresh(showSpinner: Boolean = true) {
        job?.cancel()
        val quiet = !showSpinner && loadedAt != null
        mutableState.update {
            when {
                quiet -> it
                it.items.isEmpty() -> it.copy(isLoading = true, error = null, appendError = null)
                else -> it.copy(isRefreshing = showSpinner, error = null, appendError = null)
            }
        }
        job =
            scope.launch {
                fetch(null)
                    .onSuccess { page ->
                        cursor = page.nextCursor
                        loadedAt = clock()
                        mutableState.value =
                            PagedState(
                                items = page.items.distinctBy(key),
                                isLoading = false,
                                endReached = page.nextCursor == null,
                            )
                    }.onFailure { error ->
                        if (quiet) return@onFailure
                        mutableState.update {
                            it.copy(
                                isLoading = false,
                                isRefreshing = false,
                                error = if (it.items.isEmpty()) error.apiError else null,
                                appendError = if (it.items.isEmpty()) null else error.apiError,
                            )
                        }
                    }
            }
    }

    /** Loads the next page when there is one and nothing else is loading. */
    fun loadMore() {
        val current = mutableState.value
        if (current.isLoading || current.isAppending || current.isRefreshing || current.endReached) return
        if (current.error != null) return
        val next = cursor ?: return
        mutableState.update { it.copy(isAppending = true, appendError = null) }
        job =
            scope.launch {
                fetch(next)
                    .onSuccess { page ->
                        cursor = page.nextCursor
                        mutableState.update { state ->
                            val known = state.items.map(key).toSet()
                            state.copy(
                                items = state.items + page.items.filter { key(it) !in known },
                                isAppending = false,
                                endReached = page.nextCursor == null,
                            )
                        }
                    }.onFailure { error ->
                        mutableState.update { it.copy(isAppending = false, appendError = error.apiError) }
                    }
            }
    }

    /** Refreshes when the list is older than [maxAgeMillis] (rule G5: 60 seconds). */
    fun refreshIfStale(maxAgeMillis: Long = 60_000L) {
        val at = loadedAt ?: return
        if (clock() - at >= maxAgeMillis) refresh(showSpinner = false)
    }

    fun update(transform: (List<T>) -> List<T>) {
        mutableState.update { it.copy(items = transform(it.items)) }
    }

    fun updateItem(
        id: String,
        transform: (T) -> T,
    ) = update { items -> items.map { if (key(it) == id) transform(it) else it } }

    fun remove(id: String) = update { items -> items.filterNot { key(it) == id } }

    fun prepend(item: T) = update { items -> listOf(item) + items.filterNot { key(it) == key(item) } }

    fun reset() {
        job?.cancel()
        cursor = null
        loadedAt = null
        mutableState.value = PagedState()
    }
}
