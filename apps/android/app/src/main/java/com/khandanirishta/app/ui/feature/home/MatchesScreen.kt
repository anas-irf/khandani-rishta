package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
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
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.rememberNow
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
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

        private val mutablePassed = MutableStateFlow(PassedCards())

        /** "Not interested" since the member came to the screen. */
        val passed: StateFlow<PassedCards> = mutablePassed.asStateFlow()

        /** The last first page had nothing, though the pool is not exhausted. */
        private var foundNone = false

        val paginator =
            Paginator<ProfileCard>(viewModelScope, key = { it.id }) { cursor ->
                discovery
                    .recommendations(cursor)
                    .map { page ->
                        if (cursor == null) {
                            mutableMeta.value =
                                MatchesMeta(
                                    isRefreshing = page.isRefreshing,
                                    poolExhausted = page.poolExhausted,
                                    refreshedAt = page.refreshedAt,
                                    hints = page.relaxationHints,
                                )
                            foundNone = page.items.isEmpty() && !page.poolExhausted
                            scheduleFollowUps(page.isRefreshing, foundNone)
                        }
                        Page(page.items, page.nextCursor)
                    }.onFailure {
                        // A failed retry of "Finding your matches..." still counts towards the three.
                        if (cursor == null && foundNone) scheduleFollowUps(refreshing = false, empty = true)
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
                    setShortlisted(change.profileId, change.shortlisted)
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
                actions.toggleShortlist(card) { value -> setShortlisted(card.id, value) }
            }
        }

        private fun setShortlisted(
            id: String,
            value: Boolean,
        ) {
            paginator.updateItem(id) { it.withShortlist(value) }
            mutablePassed.update { passed -> passed.update(id) { it.withShortlist(value) } }
        }

        /** "Not interested": the panel takes the card's place until the member leaves the screen. */
        fun pass(card: ProfileCard) {
            val shown = mutablePassed.value.arrange(paginator.state.value.items)
            val place = shown.indexOfFirst { it.id == card.id }
            mutablePassed.update { it.pass(card, shown) }
            viewModelScope.launch {
                actions.pass(card.id) {
                    mutablePassed.update { it.without(card.id) }
                    paginator.update { it.putBack(card, place) }
                }
            }
        }

        fun undoPass(id: String) {
            mutablePassed.update { it.restore(id) }
            viewModelScope.launch {
                actions.undoPass(id) { mutablePassed.update { it.passAgain(id) } }
            }
        }

        /** The panels end with the visit. */
        fun leaveScreen() {
            mutablePassed.update { it.leave() }
        }

        /** Back from elsewhere: the cards passed in the last visit leave the list. */
        fun returnToScreen() {
            val passed = mutablePassed.value
            if (!passed.left) return
            paginator.update(passed::hide)
            mutablePassed.value = PassedCards()
        }
    }

/** APP-MATCHES: the full, ranked list of recommended matches (16 section 6.5). */
@Composable
fun MatchesScreen(
    modifier: Modifier = Modifier,
    viewModel: MatchesViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val candidate = rememberCandidate()
    val online = LocalOnline.current
    val state by viewModel.paginator.state.collectAsStateWithLifecycle()
    val passed by viewModel.passed.collectAsStateWithLifecycle()
    val meta by viewModel.meta.collectAsStateWithLifecycle()
    val finding by viewModel.finding.collectAsStateWithLifecycle()
    val res = LocalResources.current
    val now = rememberNow()
    LifecycleResumeEffect(Unit) {
        viewModel.paginator.refreshIfStale()
        onPauseOrDispose { }
    }
    VisitEffect(onLeave = viewModel::leaveScreen, onReturn = viewModel::returnToScreen)
    val shown = remember(state, passed) { state.copy(items = passed.arrange(state.items)) }
    val title = candidate.heading(R.string.discovery_matches_title, R.string.discovery_matches_title_named)
    Scaffold(
        modifier = modifier,
        topBar = {
            DetailTopBar(
                title = text(title, "name" to candidate.name),
                subtitle =
                    meta.refreshedAt?.let {
                        text(R.string.discovery_matches_updated, "time" to Formatters.relative(res, it, now))
                    },
                onBack = { navigator.back() },
                actions = {
                    KrIconButton(
                        icon = Icons.Outlined.Refresh,
                        contentDescription = stringResource(R.string.discovery_matches_refresh),
                        onClick = viewModel::refreshMatches,
                        enabled = online,
                    )
                    KrIconButton(
                        icon = Icons.Outlined.Tune,
                        contentDescription = stringResource(R.string.discovery_matches_preferences),
                        onClick = { navigator.push(MyPreferences) },
                    )
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            StatusGate(GateRouter.Level.BROWSE) {
                PagedList(
                    state = shown,
                    key = { it.id },
                    onRefresh = { viewModel.paginator.refresh() },
                    onLoadMore = { viewModel.paginator.loadMore() },
                    spacing = Spacing.s40,
                    dividers = false,
                    contentType = { CARD_TYPE },
                    skeleton = { CardSkeleton() },
                    header = {
                        if (meta.isRefreshing) {
                            item(key = "refreshing", contentType = "banner") {
                                StatusBanner(
                                    text = stringResource(R.string.discovery_matches_refreshing),
                                    icon = Icons.Outlined.Refresh,
                                    announce = true,
                                )
                            }
                        }
                    },
                    empty = {
                        MatchesEmpty(
                            exhausted = meta.poolExhausted,
                            hints = meta.hints,
                            finding = finding < HomeViewModel.FINDING_RETRIES,
                            onSearch = { navigator.selectTab(Tab.SEARCH) },
                            skeleton = { CardSkeleton() },
                        )
                    },
                    footer = {
                        if (shown.endReached && shown.items.isNotEmpty()) {
                            item(key = "end", contentType = "end") { MatchesEnd(meta) }
                        }
                    },
                ) { card ->
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                        DiscoveryCard(
                            card = card,
                            passed = passed.isPassed(card.id),
                            onOpen = { navigator.push(Profile(card.id)) },
                            onToggleShortlist = { viewModel.toggleShortlist(card) },
                            onPass = { viewModel.pass(card) },
                            onUndo = { viewModel.undoPass(card.id) },
                            modifier = Modifier.widthIn(max = Sizes.cardMax),
                        )
                    }
                }
            }
        }
    }
}

/** The end of the list: the exhausted card, or that it is everyone for now. */
@Composable
private fun MatchesEnd(meta: MatchesMeta) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        if (meta.poolExhausted) {
            ExhaustedNotice(empty = false, hints = meta.hints, modifier = Modifier.widthIn(max = Sizes.cardMax))
        } else {
            Text(
                text = stringResource(R.string.discovery_matches_end),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private const val CARD_TYPE = "card"
