package com.khandanirishta.app.ui.feature.lists

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.VisitorItem
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.lists.VisitorsViewModel.Companion.I_VIEWED
import com.khandanirishta.app.ui.feature.lists.VisitorsViewModel.Companion.VIEWED_ME
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.text.text
import kotlinx.coroutines.flow.StateFlow

/**
 * APP-VISITORS: who viewed the profile in the last 30 days, and the profiles the member opened
 * (specs/16 section 6.14, 09 section 8).
 */
@Composable
fun VisitorsScreen(
    modifier: Modifier = Modifier,
    viewModel: VisitorsViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    LifecycleResumeEffect(Unit) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    Scaffold(
        modifier = modifier,
        topBar = {
            DetailTopBar(title = stringResource(R.string.discovery_visitors_title), onBack = { navigator.back() })
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            StatusGate(GateRouter.Level.BROWSE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                VisitorsContent(
                    state = state,
                    listFlow = viewModel.list(state.tab),
                    onSelectTab = viewModel::selectTab,
                    onRefresh = viewModel::refresh,
                    onLoadMore = viewModel::loadMore,
                )
            }
        }
    }
}

@Composable
private fun VisitorsContent(
    state: VisitorsUiState,
    listFlow: StateFlow<PagedState<VisitorItem>>,
    onSelectTab: (Int) -> Unit,
    onRefresh: (tab: Int) -> Unit,
    onLoadMore: (tab: Int) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        ListTabs(
            tabs =
                listOf(
                    ListTab(label = stringResource(R.string.discovery_visitors_viewed_me)),
                    ListTab(label = stringResource(R.string.discovery_visitors_i_viewed)),
                ),
            selected = state.tab,
            onSelect = onSelectTab,
        )
        key(state.tab) {
            VisitList(
                listFlow = listFlow,
                tab = state.tab,
                hiddenBecausePrivate = state.hiddenBecausePrivate,
                onRefresh = onRefresh,
                onLoadMore = onLoadMore,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun VisitList(
    listFlow: StateFlow<PagedState<VisitorItem>>,
    tab: Int,
    hiddenBecausePrivate: Boolean,
    onRefresh: (tab: Int) -> Unit,
    onLoadMore: (tab: Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val navigator = LocalNavigator.current
    val list by listFlow.collectAsStateWithLifecycle()
    PagedList(
        state = list,
        key = { it.profile.id },
        onRefresh = { onRefresh(tab) },
        onLoadMore = { onLoadMore(tab) },
        modifier = modifier,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        empty = {
            when {
                // Private browsing hides the visitors from the member too (09 section 8.2).
                tab == VIEWED_ME && hiddenBecausePrivate -> {
                    EmptyState(
                        title = stringResource(R.string.discovery_visitors_private_title),
                        text = stringResource(R.string.discovery_visitors_private_text),
                        icon = Icons.Outlined.VisibilityOff,
                        actionLabel = stringResource(R.string.discovery_visitors_private_action),
                        onAction = { navigator.push(PrivacySettings) },
                    )
                }

                tab == I_VIEWED -> {
                    EmptyState(
                        title = stringResource(R.string.discovery_visitors_empty_i_viewed_title),
                        icon = Icons.Outlined.Visibility,
                    )
                }

                else -> {
                    EmptyState(
                        title = stringResource(R.string.discovery_visitors_empty_viewed_me_title),
                        text = stringResource(R.string.discovery_visitors_empty_viewed_me_text),
                        icon = Icons.Outlined.Visibility,
                    )
                }
            }
        },
    ) { visit ->
        VisitRow(visit = visit, onOpen = { profileId -> navigator.push(Profile(profileId)) })
    }
}

/** One visit: the compact card, "Viewed {relative}" and "{n} times" when above 1. */
@Composable
private fun VisitRow(
    visit: VisitorItem,
    onOpen: (String) -> Unit,
) {
    val res = LocalResources.current
    val viewed = text(R.string.discovery_visitors_viewed_at, "time" to Formatters.relative(res, visit.lastViewedAt))
    val line =
        if (visit.viewCount > 1) {
            viewed + " · " + text(R.string.discovery_visitors_times, "count" to visit.viewCount)
        } else {
            viewed
        }
    ProfileRow(
        card = visit.profile,
        onOpen = { onOpen(visit.profile.id) },
        extra = { MetaLine(line, icon = Icons.Outlined.Visibility) },
    )
}
