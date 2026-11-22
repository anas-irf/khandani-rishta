package com.khandanirishta.app.ui.feature.lists

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.VisitorItem
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.KrTab
import com.khandanirishta.app.ui.components.KrTabs
import com.khandanirishta.app.ui.components.MetaLine
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
import com.khandanirishta.app.ui.theme.KrType

/** What the parts of APP-VISITORS can do. */
@Immutable
internal class VisitorsActions(
    val selectTab: (tab: Int) -> Unit,
    val refresh: (tab: Int) -> Unit,
    val loadMore: (tab: Int) -> Unit,
    val open: (profileId: String) -> Unit,
    val openPrivacy: () -> Unit,
)

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
    val actions =
        remember(viewModel, navigator) {
            VisitorsActions(
                selectTab = viewModel::selectTab,
                refresh = viewModel::refresh,
                loadMore = viewModel::loadMore,
                open = { navigator.push(Profile(it)) },
                openPrivacy = { navigator.push(PrivacySettings) },
            )
        }
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
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            StatusGate(GateRouter.Level.BROWSE) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                val list by key(state.tab) { viewModel.list(state.tab).collectAsStateWithLifecycle() }
                VisitorsContent(state = state, list = list, actions = actions)
            }
        }
    }
}

/** The two tabs, then who viewed, or the private browsing panel in place of that list. */
@Composable
internal fun VisitorsContent(
    state: VisitorsUiState,
    list: PagedState<VisitorItem>,
    actions: VisitorsActions,
    modifier: Modifier = Modifier,
) {
    val tab = state.tab
    val listState = key(tab) { rememberLazyListState() }
    // Private browsing hides the visitors from the member too (09 section 8.2).
    val hidden = tab == VIEWED_ME && state.hiddenBecausePrivate
    val shown = remember(list, hidden) { if (hidden) list.copy(items = emptyList()) else list }
    Column(modifier.fillMaxSize()) {
        KrTabs(
            tabs =
                listOf(
                    KrTab(label = stringResource(R.string.discovery_visitors_viewed_me)),
                    KrTab(label = stringResource(R.string.discovery_visitors_i_viewed)),
                ),
            selected = tab,
            onSelect = actions.selectTab,
        )
        PagedList(
            state = shown,
            key = { it.profile.id },
            onRefresh = { actions.refresh(tab) },
            onLoadMore = { actions.loadMore(tab) },
            modifier = Modifier.weight(1f),
            listState = listState,
            empty = { VisitorsEmpty(tab = tab, hidden = hidden, onOpenPrivacy = actions.openPrivacy) },
        ) { visit ->
            VisitRow(visit = visit, onOpen = { actions.open(visit.profile.id) })
        }
    }
}

@Composable
private fun VisitorsEmpty(
    tab: Int,
    hidden: Boolean,
    onOpenPrivacy: () -> Unit,
) {
    when {
        hidden -> {
            EmptyState(
                title = stringResource(R.string.discovery_visitors_private_title),
                text = stringResource(R.string.discovery_visitors_private_text),
                icon = Icons.Outlined.VisibilityOff,
                actionLabel = stringResource(R.string.discovery_visitors_private_action),
                onAction = onOpenPrivacy,
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
}

/** One visit: the compact card, "Viewed {relative}" and "{n} times" when above 1. */
@Composable
private fun VisitRow(
    visit: VisitorItem,
    onOpen: () -> Unit,
) {
    val viewed = text(R.string.discovery_visitors_viewed_at, "time" to rememberRelativeTime(visit.lastViewedAt))
    val times = if (visit.viewCount > 1) text(R.string.discovery_visitors_times, "count" to visit.viewCount) else ""
    val facts = remember(viewed, times) { listOf(viewed, times) }
    ProfileRow(
        card = visit.profile,
        onOpen = onOpen,
        details = {
            MetaLine(
                facts = facts,
                style = KrType.caption.merge(KrType.numbers),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    )
}
