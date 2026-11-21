package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.TipsAndUpdates
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Home
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.Nudge
import com.khandanirishta.app.core.network.generated.model.NudgeCode
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.Avatar
import com.khandanirishta.app.ui.components.BadgedIconButton
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.ProfileCardCompactTile
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.Interests
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.MyProfile
import com.khandanirishta.app.ui.navigation.Notifications
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.navigation.VerifySelfie
import com.khandanirishta.app.ui.navigation.Visitors
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

/** What the parts of the home screen can do; they get these instead of the view model. */
@Immutable
private class HomeActions(
    val load: (pull: Boolean) -> Unit,
    val dismiss: (String) -> Unit,
    val toggleShortlist: (ProfileCard) -> Unit,
    val pass: (ProfileCard) -> Unit,
    val presetNewMembers: () -> Unit,
    val presetNearby: () -> Unit,
)

/** APP-HOME: the daily starting point (specs/16 section 6.4). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    LifecycleResumeEffect(Unit) {
        viewModel.onVisible()
        onPauseOrDispose { }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val dismissed by viewModel.dismissed.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            HomeActions(
                load = { pull -> viewModel.load(pull = pull) },
                dismiss = viewModel::dismiss,
                toggleShortlist = viewModel::toggleShortlist,
                pass = viewModel::pass,
                presetNewMembers = viewModel::presetNewMembers,
                presetNearby = viewModel::presetNearby,
            )
        }
    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TabTopBar(
                title = stringResource(R.string.app_name),
                showLogo = true,
                scrollBehavior = scrollBehavior,
                actions = {
                    BadgedIconButton(
                        icon = Icons.Outlined.NotificationsNone,
                        contentDescription =
                            if (me.counters.unreadNotifications > 0) {
                                text(
                                    R.string.common_nav_notifications_count,
                                    "count" to me.counters.unreadNotifications,
                                )
                            } else {
                                stringResource(R.string.common_nav_notifications)
                            },
                        count = me.counters.unreadNotifications,
                        onClick = { navigator.push(Notifications) },
                    )
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            StatusGate(GateRouter.Level.BROWSE) { HomeContent(state, dismissed, actions) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeContent(
    state: HomeUiState,
    dismissed: Set<String>,
    actions: HomeActions,
) {
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    val links = rememberLinkOpener()
    val appViewModel = LocalAppViewModel.current
    val update by appViewModel.optionalUpdate.collectAsStateWithLifecycle()
    val open: (AppKey) -> Unit = { navigator.push(it) }

    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = {
        actions.load(true)
    }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            me.config.announcement?.let { announcement ->
                val key = "announcement:" + announcement.textEn.hashCode()
                if (key !in dismissed) {
                    item(key = "announcement") {
                        Banner(
                            icon = Icons.Outlined.Campaign,
                            text = announcement.textEn,
                            onClick = announcement.url?.let { url -> { links.url(url) } },
                            onClose = { actions.dismiss(key) },
                            closeLabel = stringResource(R.string.discovery_home_announcement_close),
                        )
                    }
                }
            }
            update?.let { release ->
                item(key = "update") {
                    Banner(
                        icon = Icons.Outlined.SystemUpdate,
                        text = stringResource(R.string.update_banner_text),
                        actionLabel = stringResource(R.string.update_banner_action),
                        onClick = { links.url(release.downloadUrl) },
                        onClose = appViewModel::dismissUpdateBanner,
                        closeLabel = stringResource(R.string.a11y_close),
                    )
                }
            }
            item(key = "greeting") { Greeting() }
            val tipKey = "first_run_tip:" + me.profile.id
            if (tipKey !in dismissed) {
                item(key = "tip") {
                    Banner(
                        icon = Icons.Outlined.TipsAndUpdates,
                        text = stringResource(R.string.discovery_home_first_run_text),
                        onClose = { actions.dismiss(tipKey) },
                        closeLabel = stringResource(R.string.discovery_home_first_run_close),
                        container = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f),
                    )
                }
            }
            val home = state.home
            when {
                home != null -> homeSections(
                    home,
                    me.counters.pendingInterests,
                    state.findingAttempts,
                    actions,
                    open,
                    navigator,
                )

                state.error != null -> item(
                    key = "error",
                ) { ErrorState(error = state.error, onRetry = { actions.load(false) }) }

                else -> item(key = "skeleton") { HomeSkeleton() }
            }
            item(key = "safety") {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { links.webPage("safety") }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        Icons.Outlined.Shield,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        stringResource(R.string.discovery_home_safety_text) + " " +
                            stringResource(R.string.discovery_home_safety_link),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.homeSections(
    home: Home,
    pending: Long,
    findingAttempts: Int,
    actions: HomeActions,
    open: (AppKey) -> Unit,
    navigator: com.khandanirishta.app.ui.navigation.AppNavigator,
) {
    if (pending > 0) {
        item(key = "pending") {
            PendingCard(
                count = pending.toInt(),
                onView = { navigator.openOnTab(Tab.INTERESTS, listOf(Interests("received"))) },
            )
        }
    }
    val nudges = home.nudges.filter { it.code != NudgeCode.UNKNOWN }.sortedBy { it.priority }
    if (nudges.isNotEmpty()) {
        item(key = "nudges") { NudgeRow(nudges, home.completeness, open) }
    }
    item(key = "matches") {
        CardSection(
            title = R.string.discovery_home_rows_matches,
            onSeeAll = { open(Matches) },
        ) {
            if (home.recommendations.isNotEmpty()) {
                CardStrip(home.recommendations.take(10), actions, open)
                if (home.poolExhausted) {
                    Spacer(Modifier.height(12.dp))
                    ExhaustedNotice(empty = false, hints = home.relaxationHints)
                }
            } else if (home.poolExhausted) {
                ExhaustedNotice(empty = true, hints = home.relaxationHints)
            } else if (findingAttempts < HomeViewModel.FINDING_RETRIES) {
                Text(
                    stringResource(R.string.discovery_matches_state_finding),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                SkeletonStrip()
            } else {
                EmptyState(
                    title = stringResource(R.string.discovery_matches_state_none_title),
                    text = stringResource(R.string.discovery_matches_state_none_text),
                    actionLabel = stringResource(R.string.discovery_matches_state_search),
                    onAction = { navigator.selectTab(Tab.SEARCH) },
                )
            }
        }
    }
    if (home.newMembers.isNotEmpty()) {
        item(key = "new") {
            CardSection(
                title = R.string.discovery_home_rows_new_members,
                onSeeAll = {
                    actions.presetNewMembers()
                    navigator.selectTab(Tab.SEARCH)
                },
            ) { CardStrip(home.newMembers, actions, open) }
        }
    }
    if (home.nearby.isNotEmpty()) {
        item(key = "nearby") {
            CardSection(
                title = R.string.discovery_home_rows_nearby,
                onSeeAll = {
                    actions.presetNearby()
                    navigator.selectTab(Tab.SEARCH)
                },
            ) { CardStrip(home.nearby, actions, open) }
        }
    }
    if (home.visitorsCount7d > 0) {
        item(key = "visitors") { VisitorsCard(home.visitorsCount7d.toInt(), home.recentVisitors, open) }
    }
    if (home.completeness < 70) {
        item(key = "completeness") { CompletenessCard(home.completeness, onImprove = { navigator.selectTab(Tab.ME) }) }
    }
}

/** "Welcome back, {name}", or the managed form (16 section 6.4 block 4), on the brand gradient. */
@Composable
private fun Greeting() {
    val me = LocalMe.current ?: return
    val name = me.profile.firstName
    val managed = me.profile.managedBy != null && me.profile.managedBy != ManagedBy.SELF
    val greeting =
        when {
            name.isNullOrBlank() -> stringResource(R.string.discovery_home_greeting_plain)
            managed -> text(R.string.discovery_home_greeting_managed, "name" to name)
            else -> text(R.string.discovery_home_greeting, "name" to name)
        }
    Surface(shape = MaterialTheme.shapes.large, color = Color.Transparent, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .background(KrTheme.colors.heroGradient)
                .padding(horizontal = 20.dp, vertical = 22.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                greeting,
                style = MaterialTheme.typography.headlineSmall,
                color = Color.White,
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics { heading() },
            )
            val photo = me.profile.photo?.thumbUrl
            if (photo != null) {
                Spacer(Modifier.width(12.dp))
                AsyncImage(
                    model = rememberStableImageRequest(photo),
                    contentDescription = null,
                    modifier =
                        Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.2f)),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                )
            }
        }
    }
}

@Composable
private fun PendingCard(
    count: Int,
    onView: () -> Unit,
) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFFFE4E6)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Favorite, contentDescription = null, tint = Color(0xFFE11D48)) }
            Spacer(Modifier.width(12.dp))
            Text(
                plural(R.plurals.discovery_home_pending_text, count),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            Button(onClick = onView) { Text(stringResource(R.string.discovery_home_pending_view)) }
        }
    }
}

@Composable
private fun NudgeRow(
    nudges: List<Nudge>,
    completeness: Int,
    open: (AppKey) -> Unit,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(nudges, key = { it.code.wire }) { nudge ->
            val (title, body, target) = nudgeCopy(nudge.code)
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerLowest,
                shadowElevation = 1.dp,
                modifier =
                    Modifier
                        .width(250.dp)
                        .heightIn(min = 104.dp)
                        .clickable { open(target) },
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(title),
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                    Text(
                        text(body, "completeness" to completeness),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** Title, text and target of each nudge (16 section 6.4). */
private fun nudgeCopy(code: NudgeCode): Triple<Int, Int, AppKey> =
    when (code) {
        NudgeCode.ADD_PHOTO -> {
            Triple(
                R.string.discovery_home_nudge_add_photo_title,
                R.string.discovery_home_nudge_add_photo_text,
                MyPhotos,
            )
        }

        NudgeCode.VERIFY_IDENTITY -> {
            Triple(
                R.string.discovery_home_nudge_verify_identity_title,
                R.string.discovery_home_nudge_verify_identity_text,
                Verification,
            )
        }

        NudgeCode.ADD_ABOUT_ME -> {
            Triple(
                R.string.discovery_home_nudge_add_about_me_title,
                R.string.discovery_home_nudge_add_about_me_text,
                EditSection("lifestyle"),
            )
        }

        NudgeCode.SET_PREFERENCES -> {
            Triple(
                R.string.discovery_home_nudge_set_preferences_title,
                R.string.discovery_home_nudge_set_preferences_text,
                MyPreferences,
            )
        }

        NudgeCode.VERIFY_PHOTO -> {
            Triple(
                R.string.discovery_home_nudge_verify_photo_title,
                R.string.discovery_home_nudge_verify_photo_text,
                VerifySelfie,
            )
        }

        NudgeCode.ADD_CONTACT_DETAILS -> {
            Triple(
                R.string.discovery_home_nudge_add_contact_details_title,
                R.string.discovery_home_nudge_add_contact_details_text,
                ContactDetails(),
            )
        }

        NudgeCode.COMPLETE_PROFILE, NudgeCode.UNKNOWN -> {
            Triple(
                R.string.discovery_home_nudge_complete_profile_title,
                R.string.discovery_home_nudge_complete_profile_text,
                MyProfile,
            )
        }
    }

@Composable
private fun CardSection(
    title: Int,
    onSeeAll: () -> Unit,
    content: @Composable () -> Unit,
) {
    val name = stringResource(title)
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                name,
                style = MaterialTheme.typography.titleLarge,
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics { heading() },
            )
            val label = text(R.string.discovery_home_rows_see_all_named, "title" to name)
            TextButton(onClick = onSeeAll, modifier = Modifier.semantics { contentDescription = label }) {
                Text(stringResource(R.string.discovery_home_rows_see_all))
            }
        }
        Spacer(Modifier.height(4.dp))
        content()
    }
}

@Composable
private fun CardStrip(
    cards: List<ProfileCard>,
    actions: HomeActions,
    open: (AppKey) -> Unit,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
        items(cards, key = { it.id }) { card ->
            ProfileCardCompactTile(
                card = card,
                onOpen = { open(Profile(card.id)) },
                onToggleShortlist = { actions.toggleShortlist(card) },
                onPass = { actions.pass(card) },
            )
        }
    }
}

@Composable
private fun SkeletonStrip() {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(2) {
            SkeletonBox(
                Modifier
                    .width(212.dp)
                    .height(294.dp),
                corner = 18.dp,
            )
        }
    }
}

@Composable
private fun HomeSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SkeletonBox(
            Modifier
                .fillMaxWidth()
                .height(72.dp),
            corner = 18.dp,
        )
        SkeletonBox(
            Modifier
                .width(160.dp)
                .height(22.dp),
        )
        SkeletonStrip()
        SkeletonBox(
            Modifier
                .width(140.dp)
                .height(22.dp),
        )
        SkeletonStrip()
    }
}

@Composable
private fun VisitorsCard(
    count: Int,
    visitors: List<ProfileCard>,
    open: (AppKey) -> Unit,
) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 1.dp,
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable { open(Visitors) },
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.discovery_home_visitors_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                val label = stringResource(R.string.discovery_home_visitors_see_all_label)
                TextButton(onClick = { open(Visitors) }, modifier = Modifier.semantics { contentDescription = label }) {
                    Text(stringResource(R.string.discovery_home_visitors_see_all))
                }
            }
            Text(plural(R.plurals.discovery_home_visitors_text, count), style = MaterialTheme.typography.bodyMedium)
            if (visitors.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy((-10).dp)) {
                    visitors.take(5).forEach { visitor ->
                        Avatar(
                            photo = visitor.photo,
                            gender = visitor.gender,
                            contentDescription = text(R.string.shared_photo_alt, "name" to visitor.displayName),
                            size = 44.dp,
                            modifier = Modifier.clickable { open(Profile(visitor.id)) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CompletenessCard(
    value: Int,
    onImprove: () -> Unit,
) {
    val clamped = value.coerceIn(0, 100)
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            val ringLabel = text(R.string.discovery_home_completeness_ring, "value" to clamped)
            Box(Modifier.semantics { contentDescription = ringLabel }, contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    progress = { clamped / 100f },
                    modifier = Modifier.size(64.dp),
                    strokeWidth = 6.dp,
                    trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                )
                Text("$clamped%", style = MaterialTheme.typography.labelLarge)
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    stringResource(R.string.discovery_home_completeness_text),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Button(onClick = onImprove) { Text(stringResource(R.string.discovery_home_completeness_action)) }
            }
        }
    }
}

/** A dismissible banner: announcements, the update prompt and the first-run tip. */
@Composable
private fun Banner(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    onClose: () -> Unit,
    closeLabel: String,
    onClick: (() -> Unit)? = null,
    actionLabel: String? = null,
    container: Color = MaterialTheme.colorScheme.tertiaryContainer,
) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = container,
        modifier =
            Modifier
                .fillMaxWidth()
                .then(if (onClick != null && actionLabel == null) Modifier.clickable(onClick = onClick) else Modifier),
    ) {
        Row(
            Modifier.padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onTertiaryContainer)
            Spacer(Modifier.width(12.dp))
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
                overflow = TextOverflow.Ellipsis,
                maxLines = 4,
            )
            if (actionLabel != null && onClick != null) TextButton(onClick = onClick) { Text(actionLabel) }
            IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, contentDescription = closeLabel) }
        }
    }
}
