package com.khandanirishta.app.ui.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.SearchSort
import com.khandanirishta.app.ui.components.CardSkeleton
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.FirstLineMark
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrRemovableChip
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.RadioRow
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.feature.home.DiscoveryCard
import com.khandanirishta.app.ui.feature.home.PassedCards
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The results view (16 section 6.6): the count, the sort, "Filters", "Save this search", a chip
 * per active filter whose close control removes it and searches again, and the cards with the
 * card actions of APP-HOME.
 */
@Composable
internal fun ResultsView(
    state: SearchUiState,
    options: FilterOptions,
    results: PagedState<ProfileCard>,
    passed: PassedCards,
    actions: SearchActions,
    onOpenProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val applied = state.applied
    if (applied == null) {
        StateScreen(modifier) {
            EmptyState(
                title = stringResource(R.string.discovery_search_results_start),
                icon = Icons.Outlined.Tune,
                actionLabel = stringResource(R.string.discovery_search_actions_edit_filters),
                onAction = actions::showForm,
            )
        }
        return
    }
    val chips =
        remember(applied, options, state.cityNames, state.regions) {
            applied.filters.activeControls().map { control ->
                control to options.chipLabel(control, applied.filters, state.cityNames, state::regionName)
            }
        }
    val shown = remember(results, passed) { results.copy(items = passed.arrange(results.items)) }
    // A new search starts at the top; coming back to the same search keeps the position.
    val listState = rememberSaveable(state.runId, saver = LazyListState.Saver) { LazyListState(0, 0) }
    PagedList(
        state = shown,
        key = { it.id },
        onRefresh = actions::refresh,
        onLoadMore = actions::loadMore,
        modifier = modifier,
        listState = listState,
        spacing = Spacing.s40,
        dividers = false,
        contentType = { CARD_TYPE },
        skeleton = { CardSkeleton() },
        empty = {
            EmptyState(
                title = stringResource(R.string.discovery_search_results_empty_title),
                text = stringResource(R.string.discovery_search_results_empty_text),
                icon = Icons.Outlined.SearchOff,
                actionLabel = stringResource(R.string.discovery_search_actions_edit_filters),
                onAction = actions::showForm,
            )
        },
        header = {
            item(key = HEADER_KEY, contentType = HEADER_KEY) {
                ResultsHeader(
                    sort = applied.sort,
                    total = state.total,
                    totalKnown = state.totalKnown,
                    loading = results.isLoading,
                    chips = chips,
                    onSort = actions::changeSort,
                    onEditFilters = actions::showForm,
                    onSave = actions::openSaveDialog,
                    onRemove = actions::removeFilter,
                )
            }
        },
    ) { card ->
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            DiscoveryCard(
                card = card,
                passed = passed.isPassed(card.id),
                onOpen = { onOpenProfile(card.id) },
                onToggleShortlist = { actions.toggleShortlist(card) },
                onPass = { actions.pass(card) },
                onUndo = { actions.undoPass(card.id) },
                modifier = Modifier.widthIn(max = Sizes.cardMax),
            )
        }
    }
}

@Composable
private fun ResultsHeader(
    sort: SearchSort,
    total: Long?,
    totalKnown: Boolean,
    loading: Boolean,
    chips: List<Pair<FilterControl, String>>,
    onSort: (SearchSort) -> Unit,
    onEditFilters: () -> Unit,
    onSave: () -> Unit,
    onRemove: (FilterControl) -> Unit,
    modifier: Modifier = Modifier,
) {
    val online = LocalOnline.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
        ResultCount(total = total, known = totalKnown, loading = loading)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            KrButton(
                text =
                    if (chips.isEmpty()) {
                        stringResource(R.string.discovery_search_actions_filters)
                    } else {
                        text(R.string.discovery_search_actions_filters_count, "count" to chips.size)
                    },
                onClick = onEditFilters,
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.Outlined.Tune,
            )
            SortButton(sort = sort, onSort = onSort)
            KrButton(
                text = stringResource(R.string.discovery_search_actions_save),
                onClick = onSave,
                variant = KrButtonVariant.QUIET,
                icon = Icons.Outlined.BookmarkAdd,
                enabled = online,
            )
        }
        if (chips.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                verticalArrangement = Arrangement.spacedBy(Spacing.s8),
            ) {
                chips.forEach { (control, label) ->
                    key(control) {
                        KrRemovableChip(
                            text = label,
                            removeLabel = text(R.string.discovery_search_results_remove_filter, "label" to label),
                            onRemove = { onRemove(control) },
                            // Removing a filter searches again.
                            enabled = online,
                        )
                    }
                }
            }
        }
    }
}

/** "{n} profiles", or its skeleton on the same line height while the search runs. */
@Composable
private fun ResultCount(
    total: Long?,
    known: Boolean,
    loading: Boolean,
) {
    val style = MaterialTheme.typography.titleLarge.merge(KrType.numbers)
    when {
        known -> {
            Text(
                text =
                    if (total == null) {
                        stringResource(R.string.discovery_search_results_many)
                    } else {
                        plural(R.plurals.discovery_search_results_count, total.toInt())
                    },
                style = style,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        loading -> {
            FirstLineMark(style) { SkeletonBox(Modifier.width(CountWidth).height(Spacing.s24)) }
        }
    }
}

/** "Sort": changing it searches again from the first page (16 section 6.6). */
@Composable
private fun SortButton(
    sort: SearchSort,
    onSort: (SearchSort) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    val current = stringResource(sortLabel(sort))
    Box(modifier) {
        KrButton(
            text = current,
            onClick = { open = true },
            variant = KrButtonVariant.QUIET,
            icon = Icons.AutoMirrored.Outlined.Sort,
            enabled = LocalOnline.current,
            contentDescription = stringResource(R.string.discovery_search_sort_label) + ", " + current,
        )
        KrMenu(expanded = open, onDismissRequest = { open = false }) {
            Column(Modifier.selectableGroup()) {
                SORTS.forEach { option ->
                    RadioRow(
                        label = stringResource(sortLabel(option)),
                        selected = option == sort,
                        onClick = {
                            open = false
                            onSort(option)
                        },
                        modifier = Modifier.padding(horizontal = Spacing.s20),
                    )
                }
            }
        }
    }
}

private const val HEADER_KEY = "search_results_header"
private const val CARD_TYPE = "card"
private val CountWidth = 140.dp
