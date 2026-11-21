package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.Page
import com.khandanirishta.app.core.data.Paginator
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.RelaxationHint
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.CardSkeleton
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.ProfileCardView
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.text
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

/** What the first page of `GET /v1/recommendations` says about the whole list. */
data class MatchesMeta(
    val isRefreshing: Boolean = false,
    val poolExhausted: Boolean = false,
    val refreshedAt: Instant? = null,
    val hints: List<RelaxationHint> = emptyList(),
)

/** APP-MATCHES (specs/16 section 6.5). */
@HiltViewModel
class MatchesViewModel
    @Inject
    constructor(
        private val discovery: DiscoveryRepository,
        private val actions: CardActions,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableMeta = MutableStateFlow(MatchesMeta())
        val meta: StateFlow<MatchesMeta> = mutableMeta.asStateFlow()

        /** "Finding your matches...": refetches done while the list is empty. */
        private val mutableFinding = MutableStateFlow(0)
        val finding: StateFlow<Int> = mutableFinding.asStateFlow()

        val paginator =
            Paginator<ProfileCard>(viewModelScope, key = { it.id }) { cursor ->
                discovery.recommendations(cursor).map { page ->
                    if (cursor == null) {
                        mutableMeta.value =
                            MatchesMeta(page.isRefreshing, page.poolExhausted, page.refreshedAt, page.relaxationHints)
                        scheduleFollowUps(page.isRefreshing, page.items.isEmpty() && !page.poolExhausted)
                    }
                    Page(page.items, page.nextCursor)
                }
            }

        private var followUp: Job? = null

        init {
            paginator.refresh()
            viewModelScope.launch {
                invalidation.flow.collect { key ->
                    if (key == DataKey.Recommendations || key == DataKey.Home) paginator.refresh(showSpinner = false)
                }
            }
            viewModelScope.launch {
                actions.shortlistChanges.collect { change ->
                    paginator.updateItem(change.profileId) { it.withShortlist(change.shortlisted) }
                }
            }
        }

        /** While refreshing: refetch after 5 and 15 seconds. While empty: up to 3 times, 5 seconds apart. */
        private fun scheduleFollowUps(
            refreshing: Boolean,
            empty: Boolean,
        ) {
            followUp?.cancel()
            followUp =
                viewModelScope.launch {
                    if (refreshing) {
                        delay(5_000)
                        paginator.refresh(showSpinner = false)
                        delay(10_000)
                        paginator.refresh(showSpinner = false)
                    } else if (empty && mutableFinding.value < HomeViewModel.FINDING_RETRIES) {
                        delay(HomeViewModel.FINDING_RETRY_MS)
                        mutableFinding.update { it + 1 }
                        paginator.refresh(showSpinner = false)
                    }
                }
        }

        /** "Refresh": `POST /v1/recommendations/refresh` (202), then the refreshing banner. */
        fun refreshMatches() {
            viewModelScope.launch {
                discovery
                    .refreshRecommendations()
                    .onSuccess {
                        mutableMeta.update { it.copy(isRefreshing = true) }
                        scheduleFollowUps(refreshing = true, empty = false)
                    }.onFailure { failure ->
                        if (failure.apiError.code == ErrorCode.RATE_LIMITED) {
                            bus.toast(R.string.discovery_matches_rate_limited)
                        } else {
                            bus.error(failure.apiError)
                        }
                    }
            }
        }

        fun toggleShortlist(card: ProfileCard) {
            viewModelScope.launch {
                actions.toggleShortlist(card) { value -> paginator.updateItem(card.id) { it.withShortlist(value) } }
            }
        }

        fun pass(card: ProfileCard) {
            val before = paginator.state.value.items
            viewModelScope.launch {
                actions.pass(
                    card = card,
                    remove = { paginator.remove(card.id) },
                    restore = { paginator.update { before } },
                    launchUndo = { block -> viewModelScope.launch { block() } },
                    onUndo = { paginator.refresh(showSpinner = false) },
                )
            }
        }
    }

/** APP-MATCHES: the full, ranked list of recommended matches (16 section 6.5). */
@Composable
fun MatchesScreen(
    modifier: Modifier = Modifier,
    viewModel: MatchesViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val state by viewModel.paginator.state.collectAsStateWithLifecycle()
    val meta by viewModel.meta.collectAsStateWithLifecycle()
    val finding by viewModel.finding.collectAsStateWithLifecycle()
    val res = LocalResources.current
    LifecycleResumeEffect(Unit) {
        viewModel.paginator.refreshIfStale()
        onPauseOrDispose { }
    }
    Scaffold(
        modifier = modifier,
        topBar = {
            DetailTopBar(
                title = stringResource(R.string.discovery_matches_title),
                subtitle = meta.refreshedAt?.let {
                    text(
                        R.string.discovery_matches_updated,
                        "time" to Formatters.relative(res, it),
                    )
                },
                onBack = { navigator.back() },
                actions = {
                    IconButton(onClick = viewModel::refreshMatches) {
                        Icon(
                            Icons.Outlined.Refresh,
                            contentDescription = stringResource(R.string.discovery_matches_refresh),
                        )
                    }
                    IconButton(onClick = { navigator.push(MyPreferences) }) {
                        Icon(
                            Icons.Outlined.Tune,
                            contentDescription = stringResource(R.string.discovery_matches_preferences),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            StatusGate(GateRouter.Level.BROWSE) {
                PagedList(
                    state = state,
                    key = { it.id },
                    onRefresh = { viewModel.paginator.refresh() },
                    onLoadMore = { viewModel.paginator.loadMore() },
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                    spacing = Arrangement.spacedBy(16.dp),
                    skeleton = { CardSkeleton() },
                    header = {
                        if (meta.isRefreshing) {
                            item(key = "refreshing") {
                                StatusBanner(
                                    text = stringResource(R.string.discovery_matches_refreshing),
                                    container = MaterialTheme.colorScheme.primaryContainer,
                                    content = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                            }
                        }
                    },
                    empty = {
                        when {
                            meta.poolExhausted -> {
                                ExhaustedNotice(empty = true, hints = meta.hints)
                            }

                            finding < HomeViewModel.FINDING_RETRIES -> {
                                Row(
                                    Modifier.fillMaxWidth().padding(24.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.width(12.dp))
                                    Text(
                                        stringResource(R.string.discovery_matches_state_finding),
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                }
                            }

                            else -> {
                                EmptyState(
                                    title = stringResource(R.string.discovery_matches_state_none_title),
                                    text = stringResource(R.string.discovery_matches_state_none_text),
                                    actionLabel = stringResource(R.string.discovery_matches_state_search),
                                    onAction = { navigator.selectTab(Tab.SEARCH) },
                                )
                            }
                        }
                    },
                    footer = {
                        if (state.endReached && state.items.isNotEmpty()) {
                            item(key = "end") {
                                if (meta.poolExhausted) {
                                    ExhaustedNotice(empty = false, hints = meta.hints)
                                } else {
                                    Text(
                                        stringResource(R.string.discovery_matches_end),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(16.dp),
                                    )
                                }
                            }
                        }
                    },
                ) { card ->
                    ProfileCardView(
                        card = card,
                        onOpen = { navigator.push(Profile(card.id)) },
                        onToggleShortlist = { viewModel.toggleShortlist(card) },
                        onPass = { viewModel.pass(card) },
                    )
                }
            }
        }
    }
}
