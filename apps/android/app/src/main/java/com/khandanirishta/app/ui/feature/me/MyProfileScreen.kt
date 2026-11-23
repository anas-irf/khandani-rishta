package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.KrPullToRefresh
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.components.bandToneAt
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.navigation.Settings as SettingsKey

/**
 * `ME-PROFILE` (specs/16 section 6.17, specs/08 section 1): on sand who they are and the profile
 * code; then the Me menu of 16 section 2.2, the status, the completeness and the preview; then a
 * group per editable part, two to a band. A tab root with the gear icon to `SET-HOME`.
 */
@Composable
fun MyProfileScreen() {
    MyProfileRoute()
}

@Composable
private fun MyProfileRoute(viewModel: MyProfileViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    var previewOpen by rememberSaveable { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        viewModel.onVisible()
        onPauseOrDispose { }
    }
    val actions =
        remember(viewModel, navigator) {
            MyProfileActions(
                back = navigator::back,
                open = { navigator.push(it) },
                refresh = { viewModel.load(pull = true) },
                retry = { viewModel.load() },
                preview = { previewOpen = true },
                resume = viewModel::resume,
                resubmit = viewModel::resubmit,
                copied = viewModel::onLinkCopied,
            )
        }
    MyProfileContent(state = state, me = me, tabbed = navigator.tabbed, actions = actions)
    if (previewOpen) ProfilePreviewDialog(onDismiss = { previewOpen = false })
}

/** The screen without its view model and navigation. */
@Composable
internal fun MyProfileContent(
    state: MyProfileUiState,
    me: Me,
    tabbed: Boolean,
    actions: MyProfileActions,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.me_profile_title)
    val settingsAction: @Composable RowScope.() -> Unit = {
        KrIconButton(
            icon = Icons.Outlined.Settings,
            contentDescription = stringResource(R.string.me_profile_settings),
            onClick = { actions.open(SettingsKey) },
        )
    }
    Scaffold(
        modifier = modifier,
        topBar = {
            if (tabbed) {
                TabTopBar(title = title, actions = settingsAction)
            } else {
                // Under review the own profile is opened from the gate screen: it has a way back.
                DetailTopBar(title = title, onBack = actions.back, actions = settingsAction)
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding),
        ) {
            val profile = state.profile
            when {
                profile != null -> {
                    KrPullToRefresh(
                        refreshing = state.refreshing,
                        onRefresh = actions.refresh,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        LazyColumn(Modifier.fillMaxSize()) {
                            item(key = "header", contentType = "header") {
                                ProfileHeader(
                                    profile = profile,
                                    onOpenPhotos = { actions.open(MyPhotos) },
                                    onCopy = actions.copied,
                                )
                            }
                            item(key = "overview", contentType = "overview") {
                                OverviewBand(state, profile, me, tabbed, actions)
                            }
                            groupBands(state, profile, actions.open)
                        }
                    }
                }

                state.error != null -> {
                    StateScreen { ErrorState(error = state.error, onRetry = actions.retry) }
                }

                else -> {
                    MyProfileSkeleton()
                }
            }
        }
    }
}

/** The page band under the header: the menu, the banners, the completeness and the preview. */
@Composable
private fun OverviewBand(
    state: MyProfileUiState,
    profile: OwnProfile,
    me: Me,
    tabbed: Boolean,
    actions: MyProfileActions,
) {
    val moderated = remember(profile.textStatus) { moderatedTexts(profile) }
    Band(padding = BandDefaults.compactPadding, spacing = Spacing.gutter) {
        MeMenu(tabbed = tabbed, photoRequests = me.counters.pendingPhotoRequests, onOpen = actions.open)
        ProfileStatusBanner(state = state, profile = profile, me = me, actions = actions)
        moderated.forEach { ModerationBanner(moderated = it, onOpen = actions.open) }
        if (profile.completeness < COMPLETE) CompletenessPanel(profile = profile, onOpen = actions.open)
        KrButton(
            text = stringResource(R.string.me_profile_preview_button),
            onClick = actions.preview,
            variant = KrButtonVariant.SECONDARY,
            icon = Icons.Outlined.Visibility,
            // Every opening asks the server again (specs/08 section 4.2).
            enabled = LocalOnline.current,
        )
    }
}

/**
 * The groups of block 6 in their order. Where two fit side by side they share a band; on a phone
 * each group has a band of its own, so the fills alternate group by group (DESIGN.md section 6.10).
 */
private fun LazyListScope.groupBands(
    state: MyProfileUiState,
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
) {
    item(key = "photos-basics", contentType = GROUPS) {
        GroupsBand(
            pair = 1,
            first = { PhotosGroup(profile, state.privacy, onOpen, it) },
            second = { BasicsGroup(profile, onOpen, it) },
        )
    }
    item(key = "community-location", contentType = GROUPS) {
        GroupsBand(
            pair = 2,
            first = { CommunityGroup(profile, onOpen, it) },
            second = { LocationGroup(profile, onOpen, it) },
        )
    }
    item(key = "education-family", contentType = GROUPS) {
        GroupsBand(
            pair = 3,
            first = { EducationGroup(profile, onOpen, it) },
            second = { FamilyGroup(profile, onOpen, it) },
        )
    }
    item(key = "lifestyle-preferences", contentType = GROUPS) {
        GroupsBand(
            pair = 4,
            first = { LifestyleGroup(profile, onOpen, it) },
            second = { LookingForGroup(profile, state.preferences, state.preferencesLoading, onOpen, it) },
        )
    }
    item(key = "verification-contacts", contentType = GROUPS) {
        GroupsBand(
            pair = 5,
            first = { VerificationGroup(profile, onOpen, it) },
            second = { ContactsGroup(profile, onOpen, it) },
        )
    }
    item(key = "managed-privacy", contentType = GROUPS) {
        GroupsBand(
            pair = 6,
            first = { ManagedByGroup(profile, onOpen, it) },
            second = { PrivacyGroup(state.privacy, state.privacyLoading, onOpen, it) },
        )
    }
}

/** Pair [pair] (from 1) of the groups: one band side by side, or two bands on a phone. */
@Composable
private fun GroupsBand(
    pair: Int,
    first: @Composable (Modifier) -> Unit,
    second: @Composable (Modifier) -> Unit,
) {
    // Movable, so a group keeps its state when a resize moves it between the two layouts. The
    // groups are read through state, so new data still reaches them.
    val currentFirst by rememberUpdatedState(first)
    val currentSecond by rememberUpdatedState(second)
    val firstGroup = remember { movableContentOf<Modifier> { currentFirst(it) } }
    val secondGroup = remember { movableContentOf<Modifier> { currentSecond(it) } }
    val sideBySide = LocalWindowInfo.current.containerDpSize.width >= TwoGroupsWidth
    if (sideBySide) {
        Band(tone = bandToneAt(pair)) {
            AdaptiveRow(
                spacing = Spacing.s40,
                lineSpacing = Spacing.s40,
                verticalAlignment = Alignment.Top,
            ) {
                firstGroup(Modifier.grow(basis = GroupBasis))
                secondGroup(Modifier.grow(basis = GroupBasis))
            }
        }
    } else {
        Column {
            Band(tone = bandToneAt(pair * 2 - 1)) { firstGroup(Modifier.fillMaxWidth()) }
            Band(tone = bandToneAt(pair * 2)) { secondGroup(Modifier.fillMaxWidth()) }
        }
    }
}

private const val GROUPS = "groups"
private const val COMPLETE = 100
private val GroupBasis = 300.dp

// Two groups and the gap between them, inside the gutters of a band.
private val TwoGroupsWidth = GroupBasis * 2 + Spacing.s40 + Spacing.gutter * 2
