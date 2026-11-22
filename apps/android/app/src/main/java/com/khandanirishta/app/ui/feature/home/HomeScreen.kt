package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Home
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.HeadingOrnament
import com.khandanirishta.app.ui.components.HomeTopBar
import com.khandanirishta.app.ui.components.KrPullToRefresh
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SectionHeading
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.Interests
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.Notifications
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.Visitors
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** What the parts of the home screen can do; they get these instead of the view model. */
@Immutable
internal class HomeActions(
    val load: (pull: Boolean) -> Unit,
    val dismiss: (String) -> Unit,
    val toggleShortlist: (ProfileCard) -> Unit,
    val pass: (ProfileCard) -> Unit,
    val undoPass: (id: String) -> Unit,
    val open: (AppKey) -> Unit,
    val openProfile: (id: String) -> Unit,
    val openInterests: () -> Unit,
    val openSearch: () -> Unit,
    val openNewMembers: () -> Unit,
    val openNearby: () -> Unit,
    val openMe: () -> Unit,
)

/** APP-HOME: the daily starting point (specs/16 section 6.4, DESIGN.md section 6.21). */
@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    LifecycleResumeEffect(Unit) {
        viewModel.onVisible()
        onPauseOrDispose { }
    }
    VisitEffect(onLeave = viewModel::leaveScreen, onReturn = viewModel::returnToScreen)
    val state by viewModel.state.collectAsStateWithLifecycle()
    val dismissed by viewModel.dismissed.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel, navigator) {
            HomeActions(
                load = { pull -> viewModel.load(pull = pull) },
                dismiss = viewModel::dismiss,
                toggleShortlist = viewModel::toggleShortlist,
                pass = viewModel::pass,
                undoPass = viewModel::undoPass,
                open = { navigator.push(it) },
                openProfile = { navigator.push(Profile(it)) },
                openInterests = { navigator.openOnTab(Tab.INTERESTS, listOf(Interests("received"))) },
                openSearch = { navigator.selectTab(Tab.SEARCH) },
                openNewMembers = {
                    viewModel.presetNewMembers()
                    navigator.selectTab(Tab.SEARCH)
                },
                openNearby = {
                    viewModel.presetNearby()
                    navigator.selectTab(Tab.SEARCH)
                },
                openMe = { navigator.selectTab(Tab.ME) },
            )
        }
    Scaffold(
        modifier = modifier,
        topBar = {
            HomeTopBar(unread = me.counters.unreadNotifications, onNotifications = { navigator.push(Notifications) })
        },
    ) { padding ->
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            StatusGate(GateRouter.Level.BROWSE) { HomeContent(state, dismissed, actions) }
        }
    }
}

@Composable
private fun HomeContent(
    state: HomeUiState,
    dismissed: Set<String>?,
    actions: HomeActions,
) {
    val me = LocalMe.current ?: return
    val links = rememberLinkOpener()
    val colors = MaterialTheme.colorScheme
    val columns = if (isWideWindow()) WIDE_COLUMNS else 1
    val home = state.home
    val passed = state.passed
    val matches = remember(home, passed) { passed.arrange(home?.matchesRow().orEmpty()) }
    val newMembers = remember(home, passed) { passed.hide(home?.newMembers.orEmpty()) }
    val nearby = remember(home, passed, columns) { passed.hide(home?.nearby.orEmpty()).chunked(columns) }

    // The bands under the matches take turns, whichever of the rows are shown.
    val nearTone = if (newMembers.isEmpty()) BandTone.SAND else BandTone.PAGE
    val lastTone =
        when {
            nearby.isNotEmpty() -> if (nearTone == BandTone.SAND) BandTone.PAGE else BandTone.SAND
            newMembers.isNotEmpty() -> BandTone.PAGE
            else -> BandTone.SAND
        }

    KrPullToRefresh(
        refreshing = state.refreshing,
        onRefresh = { actions.load(true) },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            // The last band runs on to the bottom when the rows are few.
            modifier =
                Modifier
                    .fillMaxSize()
                    .background(if (lastTone == BandTone.SAND) colors.surfaceContainer else colors.background),
        ) {
            item(key = "top", contentType = "top") {
                HomeTop(
                    me = me,
                    dismissed = dismissed,
                    onDismiss = actions.dismiss,
                    onViewInterests = actions.openInterests,
                )
            }
            when {
                home != null -> {
                    item(key = "matches", contentType = "matches") {
                        MatchesBand(home, matches, passed, state.findingAttempts, actions)
                    }
                    if (newMembers.isNotEmpty()) {
                        item(key = "new", contentType = "new") { NewMembersBand(newMembers, actions) }
                    }
                    if (nearby.isNotEmpty()) nearbyBand(nearby, columns, nearTone, actions)
                }

                state.error != null -> {
                    item(key = "error", contentType = "error") {
                        Band { ErrorState(error = state.error, onRetry = { actions.load(false) }) }
                    }
                }

                else -> {
                    item(key = "loading", contentType = "loading") {
                        Band(padding = MatchesPadding, maxWidth = Sizes.contentWidth) { HomeSkeleton() }
                    }
                }
            }
            item(key = "last", contentType = "last") {
                Band(tone = lastTone, maxWidth = Sizes.contentWidth, spacing = Spacing.s16) {
                    if (home != null && home.visitorsCount7d > 0) {
                        VisitorsPanel(
                            count = home.visitorsCount7d,
                            visitors = home.recentVisitors,
                            onOpen = actions.openProfile,
                            onSeeAll = { actions.open(Visitors) },
                        )
                    }
                    if (home != null && home.completeness < COMPLETE_ENOUGH) {
                        CompletenessPanel(value = home.completeness, onImprove = actions.openMe)
                    }
                    SafetyLine(onReadTips = { links.webPage("safety") }, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

/** "Your matches" with every state of specs/16 section 6.4, then the nudges in the same band. */
@Composable
private fun MatchesBand(
    home: Home,
    cards: List<ProfileCard>,
    passed: PassedCards,
    findingAttempts: Int,
    actions: HomeActions,
) {
    val candidate = rememberCandidate()
    val title =
        text(
            candidate.heading(R.string.discovery_home_rows_matches, R.string.discovery_home_rows_matches_named),
            "name" to candidate.name,
        )
    val fit =
        candidate.pick(
            R.string.discovery_home_rows_matches_fit,
            R.string.discovery_home_rows_matches_fit_male,
            R.string.discovery_home_rows_matches_fit_female,
        )
    Band(padding = MatchesPadding, maxWidth = Sizes.contentWidth, spacing = Spacing.s12) {
        SectionHeading(
            title = title,
            // On phones the ornament gives way to the first match.
            ornament = if (isWideWindow()) HeadingOrnament.RULE else HeadingOrnament.NONE,
            description = if (cards.isEmpty()) null else stringResource(fit),
            action = { SeeAllLink(title) { actions.open(Matches) } },
            modifier = Modifier.padding(RowPadding),
        )
        if (cards.isEmpty()) {
            val finding = !home.poolExhausted && findingAttempts < HomeViewModel.FINDING_RETRIES
            MatchesEmpty(
                exhausted = home.poolExhausted,
                hints = home.relaxationHints,
                finding = finding,
                onSearch = actions.openSearch,
                skeleton = { CardRailSkeleton() },
                // The skeleton row brings its own gutters, to run off the edge.
                modifier = if (finding) Modifier.padding(start = Spacing.gutter) else Modifier.padding(RowPadding),
            )
        } else {
            MatchesRow(
                cards = cards,
                passed = passed,
                exhausted = home.poolExhausted,
                hints = home.relaxationHints,
                actions = actions,
            )
        }
        NudgesRow(home = home, onOpen = actions.open, modifier = Modifier.padding(top = Spacing.s12))
    }
}

/** "New members": sand, in tiles. */
@Composable
private fun NewMembersBand(
    cards: List<ProfileCard>,
    actions: HomeActions,
) {
    val title = stringResource(R.string.discovery_home_rows_new_members)
    Band(tone = BandTone.SAND, padding = EdgePadding, maxWidth = Sizes.contentWidth, spacing = Spacing.s20) {
        SectionHeading(
            title = title,
            ornament = HeadingOrnament.NONE,
            action = { SeeAllLink(title, actions.openNewMembers) },
            modifier = Modifier.padding(RowPadding),
        )
        NewMembersRow(cards = cards, onOpen = actions.openProfile)
    }
}

/** "Near you": compact cards as rows of the screen's own list, so only those in view are composed. */
private fun LazyListScope.nearbyBand(
    rows: List<List<ProfileCard>>,
    columns: Int,
    tone: BandTone,
    actions: HomeActions,
) {
    item(key = "near", contentType = "near-heading") {
        val candidate = rememberCandidate()
        val title =
            text(
                candidate.heading(R.string.discovery_home_rows_nearby, R.string.discovery_home_rows_nearby_named),
                "name" to candidate.name,
            )
        Band(tone = tone, padding = NearHeadingPadding, maxWidth = Sizes.contentWidth) {
            SectionHeading(
                title = title,
                ornament = HeadingOrnament.NONE,
                action = { SeeAllLink(title, actions.openNearby) },
            )
        }
    }
    itemsIndexed(
        items = rows,
        key = { _, row -> "near:" + row.first().id },
        contentType = { _, _ -> "near-row" },
    ) { index, row ->
        Band(
            tone = tone,
            padding = if (index == rows.lastIndex) NearLastPadding else RowPadding,
            maxWidth = Sizes.contentWidth,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s40)) {
                row.forEach { card ->
                    Column(Modifier.weight(1f)) {
                        ProfileRow(card = card, onOpen = { actions.openProfile(card.id) })
                        RowDivider()
                    }
                }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

private val MatchesPadding = PaddingValues(top = Spacing.s16, bottom = Spacing.s32)
private val EdgePadding = PaddingValues(vertical = Spacing.s24)
private val NearHeadingPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s24, end = Spacing.gutter, bottom = Spacing.s8)
private val NearLastPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, bottom = Spacing.s24)
private const val COMPLETE_ENOUGH = 70
private const val WIDE_COLUMNS = 2
