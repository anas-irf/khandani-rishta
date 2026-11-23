package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Home
import com.khandanirishta.app.core.network.generated.model.Nudge
import com.khandanirishta.app.core.network.generated.model.NudgeCode
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.RelaxationHint
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.NudgeCard
import com.khandanirishta.app.ui.components.ProfileCardSkeleton
import com.khandanirishta.app.ui.components.ProfileTile
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.MyProfile
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.navigation.VerifySelfie
import com.khandanirishta.app.ui.text.Candidate
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** The window is wide from 768 (DESIGN.md section 5.2). */
@Composable
internal fun isWideWindow(): Boolean = LocalWindowInfo.current.containerDpSize.width >= Sizes.columnWidth

/** A card of the row: 272 to 340, 30% of the window, and 272 when the window is short. */
@Composable
private fun matchCardWidth(): Dp {
    val window = LocalWindowInfo.current.containerDpSize
    val wanted =
        if (window.height <= ShortWindow) {
            Sizes.cardMin
        } else {
            (window.width * CARD_SHARE).coerceIn(Sizes.cardMin, Sizes.cardMax)
        }
    return wanted.coerceAtMost(window.width - Spacing.gutter * 2)
}

/**
 * "Your matches": cards that scroll sideways from edge to edge, then the card that closes the
 * row when the pool is exhausted. Each card keeps its own height; the row keeps the tallest it
 * has shown, so what is under it does not move while it scrolls.
 */
@Composable
internal fun MatchesRow(
    cards: List<ProfileCard>,
    passed: PassedCards,
    exhausted: Boolean,
    hints: List<RelaxationHint>,
    actions: HomeActions,
    modifier: Modifier = Modifier,
) {
    val cardWidth = matchCardWidth()
    val density = LocalDensity.current
    // Saved under the text size and card width: a font scale change recreates the activity, and a
    // height restored from the old size would leave an empty band under the row.
    val size = "${density.fontScale}:${cardWidth.value}"
    var tallest by rememberSaveable(size, key = "matches-row:$size") { mutableIntStateOf(0) }
    // Of the members' cards alone: the closing card would otherwise grow by its own rounding, frame after frame.
    var tallestCard by rememberSaveable(size, key = "matches-cards:$size") { mutableIntStateOf(0) }
    val minHeight = with(density) { tallest.toDp() }
    val endHeight = with(density) { tallestCard.toDp() }
    LazyRow(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = minHeight)
                .onSizeChanged { if (it.height > tallest) tallest = it.height },
        contentPadding = RowPadding,
        horizontalArrangement = Arrangement.spacedBy(Spacing.gutter),
    ) {
        items(cards, key = { it.id }, contentType = { "card" }) { card ->
            DiscoveryCard(
                card = card,
                passed = passed.isPassed(card.id),
                onOpen = { actions.openProfile(card.id) },
                onToggleShortlist = { actions.toggleShortlist(card) },
                onPass = { actions.pass(card) },
                onUndo = { actions.undoPass(card.id) },
                modifier =
                    Modifier
                        .width(cardWidth)
                        .onSizeChanged { if (it.height > tallestCard) tallestCard = it.height },
            )
        }
        if (exhausted) {
            item(key = "exhausted", contentType = "exhausted") {
                ExhaustedNotice(
                    empty = false,
                    hints = hints,
                    minHeight = endHeight,
                    modifier = Modifier.width(cardWidth),
                )
            }
        }
    }
}

/** The tiles of "New members". */
@Composable
internal fun NewMembersRow(
    cards: List<ProfileCard>,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = RowPadding,
        horizontalArrangement = Arrangement.spacedBy(Spacing.gutter),
    ) {
        items(cards, key = { it.id }, contentType = { "tile" }) { card ->
            ProfileTile(card = card, onOpen = { onOpen(card.id) })
        }
    }
}

/** "See all" at the end of a heading, named for TalkBack after its [title]. */
@Composable
internal fun SeeAllLink(
    title: String,
    onClick: () -> Unit,
) {
    KrTextLink(
        text = text(R.string.discovery_home_rows_see_all),
        onClick = onClick,
        contentDescription = text(R.string.discovery_home_rows_see_all_named, "title" to title),
    )
}

/** How one nudge looks, what it says and where it goes (specs/16 section 6.4). */
@Immutable
private data class NudgeLook(
    val icon: ImageVector,
    val tone: ArchTone,
    val title: Int,
    val body: Int,
    val target: AppKey,
)

private fun nudgeLook(
    code: NudgeCode,
    candidate: Candidate,
): NudgeLook? =
    when (code) {
        NudgeCode.ADD_PHOTO -> {
            NudgeLook(
                icon = Icons.Outlined.PhotoCamera,
                tone = ArchTone.PRIMARY,
                title = R.string.discovery_home_nudge_add_photo_title,
                body = R.string.discovery_home_nudge_add_photo_text,
                target = MyPhotos,
            )
        }

        NudgeCode.VERIFY_IDENTITY -> {
            NudgeLook(
                icon = Icons.Outlined.Badge,
                tone = ArchTone.SUCCESS,
                title =
                    candidate.pick(
                        R.string.discovery_home_nudge_verify_identity_title,
                        R.string.discovery_home_nudge_verify_identity_title_male,
                        R.string.discovery_home_nudge_verify_identity_title_female,
                    ),
                body = R.string.discovery_home_nudge_verify_identity_text,
                target = Verification,
            )
        }

        NudgeCode.ADD_ABOUT_ME -> {
            NudgeLook(
                icon = Icons.Outlined.Edit,
                tone = ArchTone.PRIMARY,
                title =
                    candidate.heading(
                        R.string.discovery_home_nudge_add_about_me_title,
                        R.string.discovery_home_nudge_add_about_me_title_named,
                    ),
                body = R.string.discovery_home_nudge_add_about_me_text,
                target = EditSection("lifestyle"),
            )
        }

        NudgeCode.SET_PREFERENCES -> {
            NudgeLook(
                icon = Icons.Outlined.Tune,
                tone = ArchTone.PRIMARY,
                title =
                    candidate.pick(
                        R.string.discovery_home_nudge_set_preferences_title,
                        R.string.discovery_home_nudge_set_preferences_title_male,
                        R.string.discovery_home_nudge_set_preferences_title_female,
                    ),
                body =
                    candidate.pick(
                        R.string.discovery_home_nudge_set_preferences_text,
                        R.string.discovery_home_nudge_set_preferences_text_male,
                        R.string.discovery_home_nudge_set_preferences_text_female,
                    ),
                target = MyPreferences,
            )
        }

        NudgeCode.VERIFY_PHOTO -> {
            NudgeLook(
                icon = Icons.Outlined.Face,
                tone = ArchTone.SUCCESS,
                title =
                    candidate.pick(
                        R.string.discovery_home_nudge_verify_photo_title,
                        R.string.discovery_home_nudge_verify_photo_title_male,
                        R.string.discovery_home_nudge_verify_photo_title_female,
                    ),
                body =
                    candidate.pick(
                        R.string.discovery_home_nudge_verify_photo_text,
                        R.string.discovery_home_nudge_verify_photo_text_male,
                        R.string.discovery_home_nudge_verify_photo_text_female,
                    ),
                target = VerifySelfie,
            )
        }

        NudgeCode.ADD_CONTACT_DETAILS -> {
            NudgeLook(
                icon = Icons.Outlined.Phone,
                tone = ArchTone.PRIMARY,
                title = R.string.discovery_home_nudge_add_contact_details_title,
                body = R.string.discovery_home_nudge_add_contact_details_text,
                target = ContactDetails(),
            )
        }

        NudgeCode.COMPLETE_PROFILE -> {
            NudgeLook(
                icon = Icons.Outlined.PersonOutline,
                tone = ArchTone.PRIMARY,
                title = R.string.discovery_home_nudge_complete_profile_title,
                body = R.string.discovery_home_nudge_complete_profile_text,
                target = MyProfile,
            )
        }

        // A code from a newer API is left out.
        NudgeCode.UNKNOWN -> {
            null
        }
    }

/** The nudges after the matches: a row that scrolls sideways on phones, equal columns when wide. */
@Composable
internal fun NudgesRow(
    home: Home,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val candidate = rememberCandidate()
    val nudges: List<Pair<Nudge, NudgeLook>> =
        remember(home.nudges, candidate) {
            home.nudges
                .sortedBy { it.priority }
                .distinctBy { it.code }
                .mapNotNull { nudge -> nudgeLook(nudge.code, candidate)?.let { nudge to it } }
        }
    if (nudges.isEmpty()) return
    if (isWideWindow()) {
        Row(
            modifier = modifier.fillMaxWidth().padding(RowPadding),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            nudges.forEach { (_, look) ->
                HomeNudge(look, home.completeness, inRow = false, onOpen = onOpen, modifier = Modifier.weight(1f))
            }
        }
    } else {
        // Wide enough for its title at any text size, with the next card peeking in.
        val room = LocalWindowInfo.current.containerDpSize.width - Spacing.gutter * 2 - NudgePeek
        val width = (NudgeWidth * LocalDensity.current.fontScale.coerceAtLeast(1f)).coerceAtMost(room)
        LazyRow(
            modifier = modifier.fillMaxWidth(),
            contentPadding = RowPadding,
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            items(nudges, key = { it.first.code.wire }, contentType = { "nudge" }) { (_, look) ->
                HomeNudge(look, home.completeness, inRow = true, onOpen = onOpen, modifier = Modifier.width(width))
            }
        }
    }
}

@Composable
private fun HomeNudge(
    look: NudgeLook,
    completeness: Int,
    inRow: Boolean,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    NudgeCard(
        title = text(look.title, "name" to rememberCandidate().name),
        icon = look.icon,
        onClick = { onOpen(look.target) },
        description = text(look.body, "completeness" to completeness),
        tone = look.tone,
        inRow = inRow,
        modifier = modifier,
    )
}

/** A row of card skeletons in the widths of the real row. */
@Composable
internal fun CardRailSkeleton(modifier: Modifier = Modifier) {
    val cardWidth = matchCardWidth()
    LoadingRegion(modifier.fillMaxWidth()) { SkeletonRail(cardWidth) }
}

@Composable
private fun SkeletonRail(cardWidth: Dp) {
    Row(
        modifier =
            Modifier
                .horizontalScroll(rememberScrollState(), enabled = false)
                .padding(RowPadding),
        horizontalArrangement = Arrangement.spacedBy(Spacing.gutter),
    ) {
        repeat(SKELETON_CARDS) { ProfileCardSkeleton(Modifier.width(cardWidth)) }
    }
}

/** The first load of Home, in the shape of the matches band. */
@Composable
internal fun HomeSkeleton(modifier: Modifier = Modifier) {
    val cardWidth = matchCardWidth()
    LoadingRegion(modifier.fillMaxWidth(), spacing = Spacing.s24) {
        Column(Modifier.padding(RowPadding)) {
            SkeletonBox(Modifier.fillMaxWidth(TITLE_SHARE).height(Spacing.s32))
        }
        SkeletonRail(cardWidth)
        Column(Modifier.padding(RowPadding)) {
            SkeletonBox(Modifier.fillMaxWidth().height(Sizes.nudge))
        }
    }
}

internal val RowPadding = PaddingValues(horizontal = Spacing.gutter)
private val ShortWindow = 820.dp
private val NudgeWidth = 300.dp
private val NudgePeek = 16.dp
private const val CARD_SHARE = 0.3f
private const val TITLE_SHARE = 0.6f
private const val SKELETON_CARDS = 3
