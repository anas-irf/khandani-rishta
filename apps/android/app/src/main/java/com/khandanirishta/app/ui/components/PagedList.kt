package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** Pull to refresh (rule G5) in the brand's colours. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KrPullToRefresh(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        modifier = modifier,
        state = state,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = state,
                isRefreshing = refreshing,
                containerColor = KrTheme.colors.card,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.align(Alignment.TopCenter),
            )
        },
    ) { content() }
}

/**
 * A paged list with the standard states of specs/16 section 1.2: a skeleton on first load (G1),
 * the empty state (G2), the screen error (G3), pull to refresh (G5) and infinite scroll with a
 * spinner row (G6).
 *
 * Rows are flat and parted by hairlines. Cards pass `dividers = false` with a [spacing], and a
 * [contentType] where rows differ in shape.
 */
@Composable
fun <T> PagedList(
    state: PagedState<T>,
    key: (T) -> String,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
    listState: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PagedListDefaults.padding,
    maxWidth: Dp = Sizes.columnWidth,
    spacing: Dp = 0.dp,
    dividers: Boolean = true,
    contentType: (T) -> Any? = { ROW_TYPE },
    skeleton: @Composable () -> Unit = { ListSkeleton() },
    empty: @Composable () -> Unit = {},
    header: (LazyListScope.() -> Unit)? = null,
    footer: (LazyListScope.() -> Unit)? = null,
    itemContent: @Composable (T) -> Unit,
) {
    KrPullToRefresh(refreshing = state.isRefreshing, onRefresh = onRefresh, modifier = modifier.fillMaxSize()) {
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
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            // One list for every state, so the header keeps its place and state between them.
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().contentWidth(maxWidth),
                contentPadding = contentPadding,
                verticalArrangement = Arrangement.spacedBy(spacing),
            ) {
                header?.invoke(this)
                when {
                    firstLoad -> {
                        item(key = SKELETON_KEY, contentType = SKELETON_KEY) { skeleton() }
                    }

                    failed -> {
                        item(key = ERROR_KEY, contentType = ERROR_KEY) {
                            ErrorState(error = state.error, onRetry = onRefresh)
                        }
                    }

                    state.isEmpty -> {
                        item(key = EMPTY_KEY, contentType = EMPTY_KEY) { empty() }
                    }

                    else -> {
                        itemsIndexed(
                            items = state.items,
                            key = { _, item -> key(item) },
                            contentType = { _, item -> contentType(item) },
                        ) { index, item ->
                            Column(Modifier.fillMaxWidth()) {
                                itemContent(item)
                                if (dividers && index < state.items.lastIndex) RowDivider()
                            }
                        }
                    }
                }
                if (!firstLoad && !failed) {
                    when {
                        state.isAppending -> {
                            item(key = APPENDING_KEY, contentType = APPENDING_KEY) { LoadingMore() }
                        }

                        state.appendError != null -> {
                            item(key = APPEND_ERROR_KEY, contentType = APPEND_ERROR_KEY) { LoadMoreFailed(onLoadMore) }
                        }
                    }
                    footer?.invoke(this)
                }
            }
        }
    }
}

object PagedListDefaults {
    val padding = PaddingValues(start = Spacing.gutter, top = Spacing.s16, end = Spacing.gutter, bottom = Spacing.s24)
}

@Composable
private fun LoadingMore() {
    val label = stringResource(R.string.shared_list_loading_more)
    Box(
        Modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = label
                liveRegion = LiveRegionMode.Polite
            }.padding(Spacing.s16),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(strokeWidth = MoreStroke)
    }
}

@Composable
private fun LoadMoreFailed(onLoadMore: () -> Unit) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { liveRegion = LiveRegionMode.Polite }
                .padding(vertical = Spacing.s16),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        IconText(
            icon = Icons.Outlined.ErrorOutline,
            text = stringResource(R.string.shared_list_load_more_failed),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            tint = MaterialTheme.colorScheme.error,
        )
        KrButton(
            text = stringResource(R.string.shared_list_load_more),
            onClick = onLoadMore,
            variant = KrButtonVariant.SECONDARY,
        )
    }
}

private const val SKELETON_KEY = "paged-list:skeleton"
private const val ERROR_KEY = "paged-list:error"
private const val EMPTY_KEY = "paged-list:empty"
private const val APPENDING_KEY = "paged-list:appending"
private const val APPEND_ERROR_KEY = "paged-list:append-error"
private const val ROW_TYPE = "paged-list:row"
private val MoreStroke = 3.dp

private const val LOAD_AHEAD = 4
