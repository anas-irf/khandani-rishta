package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.LocalViewerCountry
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import kotlin.math.max

/*
 * The one card for every list of members (specs/16 section 1.5, DESIGN.md section 6.9), in two
 * sizes and a tile. Lists decide, profiles explain: education, height, religion or sect, caste
 * and activity are on the profile, never on a card. Cards have no box, no shadow and no hairline.
 */

/** The city, with the country when it is not the viewer's (specs/16 section 1.5). */
@Composable
fun locationLine(
    city: String,
    countryCode: String,
): String {
    val viewerCountry = LocalViewerCountry.current
    return if (countryCode == viewerCountry) {
        city
    } else {
        text(
            R.string.shared_card_location_with_country,
            "city" to city,
            "country" to LocalReference.current.country(countryCode),
        )
    }
}

/** What the meta line of a card says. */
@Immutable
data class CardFacts(
    val location: String,
    /** The profession or, without one, the employment type. */
    val work: String,
    /** `null` when never married. */
    val maritalStatus: String?,
)

@Composable
fun rememberCardFacts(card: ProfileCard): CardFacts {
    val reference = LocalReference.current
    val location = locationLine(card.cityName, card.countryCode)
    return remember(card, reference, location) {
        CardFacts(
            location = location,
            work =
                card.professionCode?.let { reference.profession(it) }
                    ?: reference.option(Lists.EMPLOYMENT_TYPE, card.employmentType),
            maritalStatus =
                if (card.maritalStatus == MaritalStatus.NEVER_MARRIED) {
                    null
                } else {
                    reference.option(Lists.MARITAL_STATUS, card.maritalStatus)
                },
        )
    }
}

/**
 * The name as TalkBack reads it: then what the arch shows (DESIGN.md section 8, item 3), because
 * the photo itself is decoration inside a card.
 */
@Composable
private fun spokenName(
    card: ProfileCard,
    withCount: Boolean,
): String {
    val state = ArrayList<String>(SPOKEN_STATES)
    if (Badge.NEW in card.badges) state += stringResource(R.string.shared_badge_new)
    if (card.photo?.isBlurred == true) state += stringResource(R.string.shared_photo_private)
    if (card.photo == null) state += stringResource(R.string.shared_photo_none)
    if (withCount && card.photoCount >= 2) {
        state += plural(R.plurals.shared_card_photo_count, card.photoCount.toInt())
    }
    val name = nameAndAge(card.displayName, card.age)
    return if (state.isEmpty()) name else "$name. ${state.joinToString(", ")}"
}

@Composable
private fun CardName(
    card: ProfileCard,
    style: TextStyle,
    withCount: Boolean,
    modifier: Modifier = Modifier,
) {
    val spoken = spokenName(card, withCount)
    NameAge(
        name = card.displayName,
        age = card.age,
        style = style,
        modifier = modifier.semantics { contentDescription = spoken },
    )
}

/**
 * The full-size card of matches, search and "Your matches" (DESIGN.md section 6.9): the photo;
 * the name, match and relation with the badges by the name; the reasons; who they are; then
 * Shortlist and More.
 *
 * To TalkBack the whole card is one item with custom actions (specs/22 section 12), so the two
 * buttons are for touch and keyboards and are not read again. Cards of a phone keep their own
 * height, so one long name does not lengthen the others.
 */
@Composable
fun ProfileCardView(
    card: ProfileCard,
    onOpen: () -> Unit,
    onToggleShortlist: () -> Unit,
    modifier: Modifier = Modifier,
    onPass: (() -> Unit)? = null,
) {
    val facts = rememberCardFacts(card)
    val online = LocalOnline.current
    val shortlisted = card.relation.isShortlisted
    val openLabel = stringResource(R.string.a11y_open_profile)
    val notInterested = stringResource(R.string.discovery_card_not_interested)
    val shortlistedLabel = stringResource(R.string.shared_card_shortlisted)
    val shortlistLabel =
        text(
            if (shortlisted) R.string.shared_card_shortlist_remove else R.string.shared_card_shortlist_add,
            "name" to card.displayName,
        )
    val accessibility =
        Modifier.semantics {
            if (shortlisted) stateDescription = shortlistedLabel
            if (online) {
                customActions =
                    listOfNotNull(
                        CustomAccessibilityAction(shortlistLabel) {
                            onToggleShortlist()
                            true
                        },
                        onPass?.let { pass ->
                            CustomAccessibilityAction(notInterested) {
                                pass()
                                true
                            }
                        },
                    )
            }
        }
    Column(
        modifier
            .fillMaxWidth()
            .then(accessibility)
            // Square: a card has no padding, so a rounded corner would cut into its last line.
            .tappable(shape = RectangleShape, onClick = onOpen, onClickLabel = openLabel),
    ) {
        MemberPhoto(
            photo = card.photo,
            name = card.displayName,
            gender = card.gender,
            size = PhotoSize.MEDIUM,
            variant = PhotoVariant.CARD,
            decorative = true,
            count = card.photoCount,
            isNew = Badge.NEW in card.badges,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ARCH_RATIO),
        )
        Spacer(Modifier.height(Spacing.s12))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                verticalArrangement = Arrangement.spacedBy(Spacing.s8),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                CardName(card, MaterialTheme.typography.titleLarge, withCount = true)
                card.compat?.let { CompatBadge(it) }
                hintOf(card.relation)?.let { RelationHint(it) }
            }
            BadgeRow(card.badges)
        }
        ReasonChips(card.reasons, Modifier.padding(top = Spacing.s12))
        Spacer(Modifier.height(Spacing.s16))
        MetaLine(listOfNotNull(facts.location, facts.work, facts.maritalStatus))
        if (card.managedBy != ManagedBy.SELF && card.managedBy != ManagedBy.UNKNOWN) {
            ManagedByLine(card.managedBy, Modifier.padding(top = Spacing.s4))
        }
        Spacer(Modifier.height(Spacing.s16))
        AdaptiveRow(
            // Merging and hidden, so the two buttons go with it: the card's custom actions stand in.
            modifier = Modifier.semantics(mergeDescendants = true) { hideFromAccessibility() },
        ) {
            // Shortlist grows; when the two do not fit, each takes a line of its own.
            ShortlistButton(
                shortlisted = shortlisted,
                onToggle = onToggleShortlist,
                enabled = online,
                size = KrButtonSize.COMPACT,
                modifier = Modifier.grow(SHORTLIST_GROWS),
            )
            if (onPass != null) CardMenu(onPass = onPass, enabled = online, modifier = Modifier.grow(MORE_GROWS))
        }
    }
}

@Composable
private fun ManagedByLine(
    managedBy: ManagedBy,
    modifier: Modifier = Modifier,
) {
    val label = LocalReference.current.option(Lists.MANAGED_BY, managedBy)
    IconText(
        icon = Icons.Outlined.Groups,
        text = text(R.string.shared_card_managed_by, "label" to label),
        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
        color = KrTheme.colors.textSecondary,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        iconSize = Sizes.iconMedium,
        modifier = modifier,
    )
}

/**
 * The labelled Shortlist toggle of specs/16 section 1.5: "Shortlist", or pressed with a filled
 * heart and "Shortlisted". The heart means this and nothing else.
 */
@Composable
fun ShortlistButton(
    shortlisted: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    variant: KrButtonVariant = KrButtonVariant.SECONDARY,
    size: KrButtonSize = KrButtonSize.DEFAULT,
    enabled: Boolean = true,
) {
    KrButton(
        text = stringResource(if (shortlisted) R.string.shared_card_shortlisted else R.string.shared_card_shortlist),
        onClick = onToggle,
        variant = variant,
        size = size,
        icon = if (shortlisted) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
        iconTint = if (shortlisted) MaterialTheme.colorScheme.primary else Color.Unspecified,
        enabled = enabled,
        modifier = modifier.semantics { selected = shortlisted },
    )
}

/** More, with "Not interested" (specs/16 section 1.5). */
@Composable
private fun CardMenu(
    onPass: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier, propagateMinConstraints = true) {
        KrButton(
            text = stringResource(R.string.shared_card_more),
            onClick = { open = true },
            variant = KrButtonVariant.QUIET,
            size = KrButtonSize.COMPACT,
            icon = Icons.Outlined.MoreHoriz,
            enabled = enabled,
        )
        KrMenu(expanded = open, onDismissRequest = { open = false }) {
            KrMenuItem(
                text = stringResource(R.string.discovery_card_not_interested),
                icon = Icons.Outlined.VisibilityOff,
                onClick = {
                    open = false
                    onPass()
                },
            )
        }
    }
}

/**
 * What stays in the place of a passed card (specs/16 section 6.4): a sand panel at least as tall
 * as the card was ([minHeight]), with Undo and no time limit.
 */
@Composable
fun PassedCard(
    name: String,
    onUndo: () -> Unit,
    modifier: Modifier = Modifier,
    minHeight: Dp = 0.dp,
) {
    val hiddenFrom =
        rememberCandidate().pick(
            R.string.discovery_card_hidden_from,
            R.string.discovery_card_hidden_from_male,
            R.string.discovery_card_hidden_from_female,
        )
    TonalPanel(
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
        padding = PassedPadding,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = (minHeight - PassedInsets).coerceAtLeast(0.dp)),
            verticalArrangement = Arrangement.spacedBy(Spacing.s16, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Diamond(size = PanelDiamond)
            Text(
                text = text(hiddenFrom, "name" to name),
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                text = stringResource(R.string.discovery_card_hidden_for),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            KrButton(
                text = stringResource(R.string.discovery_card_undo),
                onClick = onUndo,
                variant = KrButtonVariant.SECONDARY,
                enabled = LocalOnline.current,
            )
        }
    }
}

/**
 * The compact card of interests, shortlist, visitors, requests and "Near you": the arch, then the
 * name with the match and relation, one line of place and work, and the badges. All of it opens
 * the profile, [details] too; [actions] are buttons under it.
 */
@Composable
fun ProfileRow(
    card: ProfileCard,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
    showRelation: Boolean = true,
    unseenLabel: String? = null,
    details: (@Composable ColumnScope.() -> Unit)? = null,
    actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val facts = rememberCardFacts(card)
    val isNew = Badge.NEW in card.badges
    val openLabel = stringResource(R.string.a11y_open_profile)
    Column(modifier.fillMaxWidth()) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .tappable(shape = MaterialTheme.shapes.small, onClick = onOpen, onClickLabel = openLabel)
                    .padding(vertical = Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            Row(
                modifier = Modifier.heightIn(min = Sizes.rowPhoto.height),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s16),
            ) {
                MemberPhoto(
                    photo = card.photo,
                    name = card.displayName,
                    gender = card.gender,
                    size = PhotoSize.THUMB,
                    decorative = true,
                    isNew = isNew,
                    modifier = Modifier.size(rowPhotoSize(isNew)),
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                        verticalArrangement = Arrangement.spacedBy(Spacing.s4),
                        itemVerticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (unseenLabel != null) UnreadDot(unseenLabel)
                        CardName(card, KrType.name, withCount = false)
                        card.compat?.let { CompatBadge(it, compact = true) }
                        if (showRelation) hintOf(card.relation)?.let { RelationHint(it) }
                    }
                    MetaLine(listOf(facts.location, facts.work), style = MaterialTheme.typography.bodySmall)
                    BadgeRow(card.badges, Modifier.padding(top = Spacing.s4))
                }
            }
            details?.invoke(this)
        }
        if (actions != null) {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = Spacing.s12),
                verticalArrangement = Arrangement.spacedBy(Spacing.s12),
                content = actions,
            )
        }
    }
}

/** With the "New" chip the arch grows with the text, just enough to hold the chip. */
@Composable
private fun rowPhotoSize(isNew: Boolean): DpSize {
    if (!isNew) return Sizes.rowPhoto
    val scale = LocalDensity.current.fontScale
    return DpSize(
        width = max(Sizes.rowPhoto.width.value, NEW_CHIP_WIDTH * scale).dp,
        height = max(Sizes.rowPhoto.height.value, NEW_CHIP_HEIGHT * scale).dp,
    )
}

/** The tile of "New members" on Home, and nothing else: the arch, name, match, place and work. */
@Composable
fun ProfileTile(
    card: ProfileCard,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val facts = rememberCardFacts(card)
    val width = max(Sizes.tilePhoto.width.value, TILE_WIDTH * LocalDensity.current.fontScale).dp
    Column(
        modifier =
            modifier
                .width(width)
                .tappable(
                    shape = RectangleShape,
                    onClick = onOpen,
                    onClickLabel = stringResource(R.string.a11y_open_profile),
                ),
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        MemberPhoto(
            photo = card.photo,
            name = card.displayName,
            gender = card.gender,
            size = PhotoSize.MEDIUM,
            variant = PhotoVariant.TILE,
            decorative = true,
            isNew = Badge.NEW in card.badges,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ARCH_RATIO),
        )
        CardName(card, KrType.emphasis, withCount = false)
        card.compat?.let { CompatBadge(it, compact = true) }
        Column {
            Text(facts.location, style = MaterialTheme.typography.bodySmall, color = KrTheme.colors.textSecondary)
            if (facts.work.isNotBlank()) {
                Text(facts.work, style = MaterialTheme.typography.bodySmall, color = KrTheme.colors.textSecondary)
            }
        }
    }
}

/** The quiet row in place of a card whose member is no longer available (11 section 3.1). */
@Composable
fun UnavailableRow(
    text: String,
    modifier: Modifier = Modifier,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = Sizes.rowPhoto.height)
                .padding(vertical = Spacing.s12),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s16),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ArchIcon(Icons.Outlined.PersonOff, size = Sizes.rowPhoto, tone = ArchTone.TONAL)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            content?.invoke(this)
        }
    }
}

private const val SHORTLIST_GROWS = 999f
private const val MORE_GROWS = 1f
private const val SPOKEN_STATES = 3
private const val NEW_CHIP_WIDTH = 52f
private const val NEW_CHIP_HEIGHT = 65.6f
private const val TILE_WIDTH = 104f
private val PanelDiamond = 10.dp
private val PassedInsets = 48.dp
private val PassedPadding = PaddingValues(Spacing.s24)
