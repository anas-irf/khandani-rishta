package com.khandanirishta.app.ui.feature.search

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.SearchSort
import com.khandanirishta.app.ui.components.CardSkeleton
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileCardView
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text

/**
 * APP-SEARCH: find members with explicit filters (specs/16 section 6.6). A phone shows one view at
 * a time: the filter form first, then the results; "Filters" and system Back return to the form.
 * [savedSearchId] (from a notification) loads that saved search and runs it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    savedSearchId: String?,
    modifier: Modifier = Modifier,
) {
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TabTopBar(title = stringResource(R.string.discovery_search_title), scrollBehavior = scrollBehavior)
        },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            StatusGate(GateRouter.Level.BROWSE) {
                val viewModel =
                    hiltViewModel<SearchViewModel, SearchViewModel.Factory> { factory -> factory.create(savedSearchId) }
                val state by viewModel.state.collectAsStateWithLifecycle()
                val results by viewModel.results.collectAsStateWithLifecycle()
                val online by viewModel.online.collectAsStateWithLifecycle()
                val navigator = LocalNavigator.current
                LaunchedEffect(viewModel, navigator) {
                    viewModel.events.collect { event ->
                        when (event) {
                            is SearchEvent.OpenProfile -> navigator.push(Profile(event.profileId))
                        }
                    }
                }
                LifecycleResumeEffect(viewModel) {
                    viewModel.onResume()
                    onPauseOrDispose { }
                }
                SearchContent(
                    state = state,
                    results = results,
                    online = online,
                    actions = viewModel,
                    onOpenProfile = { profileId -> navigator.push(Profile(profileId)) },
                )
            }
        }
    }
}

@Composable
private fun SearchContent(
    state: SearchUiState,
    results: PagedState<ProfileCard>,
    online: Boolean,
    actions: SearchActions,
    onOpenProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val res = LocalResources.current
    val gender = LocalMe.current?.profile?.gender
    val options = remember(reference, res, gender) { FilterOptions(reference, res, gender) }
    // On a phone the results replace the form; Back shows the form again (16 section 6.6).
    BackHandler(enabled = state.view == SearchPane.RESULTS) { actions.showForm() }
    // Each view keeps its scroll position and open groups while the other one is shown.
    val views = rememberSaveableStateHolder()
    AnimatedContent(
        targetState = state.view,
        transitionSpec = {
            val direction = if (targetState == SearchPane.RESULTS) 1 else -1
            val enter =
                fadeIn(tween(TRANSITION_MS)) + slideInHorizontally(tween(TRANSITION_MS)) { direction * it / SLIDE }
            val exit =
                fadeOut(tween(TRANSITION_MS)) + slideOutHorizontally(tween(TRANSITION_MS)) { -direction * it / SLIDE }
            enter togetherWith exit
        },
        label = "search-view",
        modifier = modifier.fillMaxSize(),
    ) { view ->
        views.SaveableStateProvider(view.name) {
            when {
                !state.ready && view == SearchPane.FORM -> {
                    FormSkeleton()
                }

                !state.ready -> {
                    CardSkeleton()
                }

                view == SearchPane.FORM -> {
                    FilterFormView(state = state, options = options, online = online, actions = actions)
                }

                else -> {
                    ResultsView(
                        state = state,
                        options = options,
                        results = results,
                        online = online,
                        actions = actions,
                        onOpenProfile = onOpenProfile,
                    )
                }
            }
        }
    }
    SearchDialogs(state = state, actions = actions)
}

@Composable
private fun SearchDialogs(
    state: SearchUiState,
    actions: SearchActions,
) {
    state.saveDialog?.let { dialog ->
        SaveSearchDialog(
            dialog = dialog,
            onSave = actions::saveSearch,
            onEdit = actions::clearDialogError,
            onDismiss = actions::dismissSaveDialog,
        )
    }
    state.renameDialog?.let { dialog ->
        RenameSearchDialog(
            dialog = dialog,
            onRename = actions::rename,
            onEdit = actions::clearDialogError,
            onDismiss = actions::dismissRename,
        )
    }
    state.removing?.let { saved ->
        ConfirmDialog(
            title = stringResource(R.string.discovery_saved_remove_title),
            text = text(R.string.discovery_saved_remove_text, "name" to saved.name),
            confirmLabel = stringResource(R.string.discovery_saved_remove),
            onConfirm = actions::confirmRemove,
            onDismiss = actions::dismissRemove,
            destructive = true,
            busy = state.removeBusy,
        )
    }
}

/**
 * The results view (16 section 6.6): the count, a chip per active filter whose close control
 * removes it and searches again, the sort, "Filters", "Save this search" and the cards with the
 * card actions of APP-HOME.
 */
@Composable
private fun ResultsView(
    state: SearchUiState,
    options: FilterOptions,
    results: PagedState<ProfileCard>,
    online: Boolean,
    actions: SearchActions,
    onOpenProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val applied = state.applied
    if (applied == null) {
        EmptyState(
            title = stringResource(R.string.discovery_search_results_start),
            icon = Icons.Outlined.Tune,
            actionLabel = stringResource(R.string.discovery_search_actions_edit_filters),
            onAction = actions::showForm,
            modifier = modifier,
        )
        return
    }
    val chips =
        remember(applied, options, state.cityNames, state.regions) {
            applied.filters.activeControls().map { control ->
                control to options.chipLabel(control, applied.filters, state.cityNames, state::regionName)
            }
        }
    // A new search starts at the top; coming back to the same search keeps the position.
    val listState = rememberSaveable(state.runId, saver = LazyListState.Saver) { LazyListState(0, 0) }
    PagedList(
        state = results,
        key = { it.id },
        onRefresh = actions::refresh,
        onLoadMore = actions::loadMore,
        modifier = modifier,
        listState = listState,
        contentPadding = PaddingValues(bottom = 24.dp),
        spacing = Arrangement.spacedBy(16.dp),
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
            item(key = HEADER_KEY) {
                ResultsHeader(
                    sort = applied.sort,
                    total = state.total,
                    totalKnown = state.totalKnown,
                    loading = results.isLoading,
                    activeCount = chips.size,
                    chips = chips,
                    online = online,
                    onSort = actions::changeSort,
                    onFilters = actions::showForm,
                    onSave = actions::openSaveDialog,
                    onRemove = actions::removeFilter,
                )
            }
        },
    ) { card ->
        ProfileCardView(
            card = card,
            onOpen = { onOpenProfile(card.id) },
            onToggleShortlist = { actions.toggleShortlist(card) },
            onPass = { actions.pass(card) },
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ResultsHeader(
    sort: SearchSort,
    total: Long?,
    totalKnown: Boolean,
    loading: Boolean,
    activeCount: Int,
    chips: List<Pair<FilterControl, String>>,
    online: Boolean,
    onSort: (SearchSort) -> Unit,
    onFilters: () -> Unit,
    onSave: () -> Unit,
    onRemove: (FilterControl) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 4.dp, bottom = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                when {
                    totalKnown -> {
                        Text(
                            if (total == null) {
                                stringResource(R.string.discovery_search_results_many)
                            } else {
                                plural(R.plurals.discovery_search_results_count, total.toInt())
                            },
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }

                    loading -> {
                        SkeletonBox(
                            Modifier
                                .width(140.dp)
                                .height(24.dp),
                        )
                    }
                }
            }
            SortMenu(sort = sort, onSort = onSort)
        }
        FlowRow(
            Modifier.padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilledTonalButton(onClick = onFilters) {
                Icon(Icons.Outlined.Tune, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    if (activeCount > 0) {
                        text(R.string.discovery_search_actions_filters_count, "count" to activeCount)
                    } else {
                        stringResource(R.string.discovery_search_actions_filters)
                    },
                )
            }
            OutlinedButton(onClick = onSave, enabled = online) {
                Icon(Icons.Outlined.BookmarkAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.discovery_search_actions_save))
            }
        }
        if (chips.isNotEmpty()) {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(chips, key = { it.first.name }) { (control, label) ->
                    val removeLabel = text(R.string.discovery_search_results_remove_filter, "label" to label)
                    InputChip(
                        selected = false,
                        onClick = { onRemove(control) },
                        label = {
                            Text(
                                label,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 240.dp),
                            )
                        },
                        trailingIcon = {
                            Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                        },
                        modifier = Modifier.semantics { contentDescription = removeLabel },
                    )
                }
            }
        }
    }
}

/** "Sort": changing it searches again from the first page (16 section 6.6). */
@Composable
private fun SortMenu(
    sort: SearchSort,
    onSort: (SearchSort) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    val current = stringResource(sortLabel(sort))
    val description = stringResource(R.string.discovery_search_sort_label) + ", " + current
    Box(modifier) {
        TextButton(onClick = { open = true }, modifier = Modifier.semantics { contentDescription = description }) {
            Icon(Icons.AutoMirrored.Outlined.Sort, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(current, maxLines = 1)
            Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            SORTS.forEach { option ->
                DropdownMenuItem(
                    text = { Text(stringResource(sortLabel(option))) },
                    onClick = {
                        open = false
                        onSort(option)
                    },
                    trailingIcon =
                        if (option == sort) ({ Icon(Icons.Filled.Check, contentDescription = null) }) else null,
                )
            }
        }
    }
}

private const val HEADER_KEY = "search_results_header"
private const val TRANSITION_MS = 220

/** The views slide by an eighth of the width, like the screens of the app. */
private const val SLIDE = 8
