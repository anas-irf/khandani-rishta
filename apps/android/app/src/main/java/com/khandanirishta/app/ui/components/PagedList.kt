package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState

/**
 * A paged list with the standard states of specs/16 section 1.2: a skeleton on first load (G1),
 * the empty state (G2), the screen error (G3), pull to refresh (G5) and infinite scroll with a
 * spinner row (G6).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> PagedList(
    state: PagedState<T>,
    key: (T) -> String,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
    listState: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(16.dp),
    spacing: Arrangement.Vertical = Arrangement.spacedBy(12.dp),
    skeleton: @Composable () -> Unit = { ListSkeleton() },
    empty: @Composable () -> Unit = {},
    header: (LazyListScope.() -> Unit)? = null,
    footer: (LazyListScope.() -> Unit)? = null,
    itemContent: @Composable (T) -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier.fillMaxSize(),
    ) {
        val firstLoad = state.isLoading && state.items.isEmpty()
        val failed = !firstLoad && state.error != null && state.items.isEmpty()
        val shouldLoadMore by remember(listState) {
            derivedStateOf {
                val info = listState.layoutInfo
                val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
                info.totalItemsCount > 0 && last >= info.totalItemsCount - LOAD_AHEAD
            }
        }
        val currentOnLoadMore by rememberUpdatedState(onLoadMore)
        // Restarted when the items appear, so a first page that already shows its end loads the next.
        LaunchedEffect(listState, firstLoad, failed) {
            if (firstLoad || failed) return@LaunchedEffect
            snapshotFlow { shouldLoadMore }.collect { if (it) currentOnLoadMore() }
        }
        // One list for every state, so the header keeps its place and state between them.
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            // The skeleton brings its own padding.
            contentPadding = if (firstLoad) PaddingValues(0.dp) else contentPadding,
            verticalArrangement = spacing,
        ) {
            header?.invoke(this)
            when {
                firstLoad -> item(key = SKELETON_KEY) { skeleton() }
                failed -> item(key = ERROR_KEY) { ErrorState(error = state.error, onRetry = onRefresh) }
                state.isEmpty -> item(key = EMPTY_KEY) { empty() }
                else -> items(state.items, key = key) { itemContent(it) }
            }
            if (!firstLoad && !failed) {
                when {
                    state.isAppending -> {
                        item(key = APPENDING_KEY) {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
                            }
                        }
                    }

                    state.appendError != null -> {
                        item(key = APPEND_ERROR_KEY) {
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                TextButton(onClick = onLoadMore) {
                                    Text(
                                        stringResource(R.string.shared_list_load_more_failed) + " " +
                                            stringResource(R.string.shared_list_load_more),
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                            }
                        }
                    }
                }
                footer?.invoke(this)
            }
        }
    }
}

private const val SKELETON_KEY = "paged-list:skeleton"
private const val ERROR_KEY = "paged-list:error"
private const val EMPTY_KEY = "paged-list:empty"
private const val APPENDING_KEY = "paged-list:appending"
private const val APPEND_ERROR_KEY = "paged-list:append-error"

private const val LOAD_AHEAD = 4
