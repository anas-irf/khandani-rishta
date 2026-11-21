package com.khandanirishta.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.LocalViewerCountry
import com.khandanirishta.app.ui.text.activityLabel
import com.khandanirishta.app.ui.text.badgeLabel
import com.khandanirishta.app.ui.text.ordered
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.reasonText
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

/** "Ayesha K., 26". */
@Composable
fun nameAndAge(card: ProfileCard): String =
    text(
        R.string.common_format_name_age,
        "name" to card.displayName,
        "age" to card.age,
    )

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

/** Education level, then the profession or, without one, the employment type. */
@Composable
fun educationAndWork(card: ProfileCard): String {
    val ref = LocalReference.current
    val work = card.professionCode?.let { ref.profession(it) } ?: ref.option(Lists.EMPLOYMENT_TYPE, card.employmentType)
    return listOf(ref.educationLevel(card.educationLevelCode), work).filter { it.isNotBlank() }.joinToString(" · ")
}

/** Height, marital status (unless never married), sect or religion, and caste. */
@Composable
fun keyFacts(card: ProfileCard): List<String> {
    val ref = LocalReference.current
    val res = LocalResources.current
    return buildList {
        add(Formatters.heightShort(res, card.heightCm))
        if (card.maritalStatus != MaritalStatus.NEVER_MARRIED) add(ref.option(Lists.MARITAL_STATUS, card.maritalStatus))
        add(card.sectCode?.let { ref.sect(it) } ?: ref.religion(card.religionCode))
        card.casteLabel?.let { add(it) }
    }.filter { it.isNotBlank() }
}

/** "Interest sent", "Interested in you" or "Connected" (specs/16 section 1.5). */
@Composable
fun relationHint(card: ProfileCard): String? =
    when {
        card.relation.tier == Tier.CONNECTION -> stringResource(R.string.shared_card_relation_connected)

        card.relation.interestDirection == InterestDirection.SENT -> stringResource(R.string.shared_card_relation_sent)

        card.relation.interestDirection == InterestDirection.RECEIVED -> stringResource(
            R.string.shared_card_relation_received,
        )

        else -> null
    }

/** The "{n}% match" pill (`CompatBadge`). */
@Composable
fun CompatBadge(
    value: Int,
    modifier: Modifier = Modifier,
    onPhoto: Boolean = false,
) {
    Box(
        modifier
            .clip(CircleShape)
            .background(KrTheme.colors.compatGradient)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            text(R.string.shared_compat, "value" to value),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
            color = Color.White,
        )
    }
    if (onPhoto) Unit
}

/** Badge icons after the name, in the order of 12 section 1.2, with their labels for TalkBack. */
@Composable
fun BadgeIcons(
    badges: List<Badge>,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.primary,
    onPhoto: Boolean = false,
) {
    val ordered = badges.ordered()
    if (ordered.isEmpty()) return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        ordered.forEach { badge ->
            val label = badgeLabel(badge)?.let { stringResource(it) }.orEmpty()
            when (badge) {
                Badge.NEW -> {
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (onPhoto) {
                                    Color.White.copy(
                                        alpha = 0.25f,
                                    )
                                } else {
                                    MaterialTheme.colorScheme.tertiaryContainer
                                },
                            ).padding(horizontal = 6.dp, vertical = 1.dp),
                    ) {
                        Text(
                            label,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (onPhoto) Color.White else MaterialTheme.colorScheme.onTertiaryContainer,
                        )
                    }
                }

                else -> {
                    Icon(
                        badgeIcon(badge),
                        contentDescription = label,
                        tint = if (onPhoto) Color.White else tint,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

private fun badgeIcon(badge: Badge): ImageVector =
    when (badge) {
        Badge.ID_VERIFIED -> Icons.Filled.VerifiedUser
        Badge.PHOTO_VERIFIED -> Icons.Filled.Verified
        else -> Icons.Filled.PhoneAndroid
    }

/** Up to 3 reason chips (`ReasonChips`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReasonChips(
    reasons: List<String>,
    modifier: Modifier = Modifier,
) {
    if (reasons.isEmpty()) return
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        reasons.take(3).forEach { code ->
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f),
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                shape = CircleShape,
            ) {
                Text(
                    reasonText(code),
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
    }
}

/** The shortlist heart (optimistic, rule G7), with a small pop when it fills. */
@Composable
fun ShortlistHeart(
    shortlisted: Boolean,
    name: String,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    onPhoto: Boolean = false,
) {
    val scale by animateFloatAsState(
        if (shortlisted) 1.12f else 1f,
        animationSpec = spring(dampingRatio = 0.4f),
        label = "heart",
    )
    val tint by animateColorAsState(
        when {
            shortlisted -> Color(0xFFE11D48)
            onPhoto -> Color.White
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        },
        label = "heart-tint",
    )
    val label =
        if (shortlisted) {
            text(R.string.shared_card_shortlist_remove, "name" to name)
        } else {
            text(R.string.shared_card_shortlist_add, "name" to name)
        }
    IconButton(
        onClick = onToggle,
        modifier =
            modifier.then(
                if (onPhoto) {
                    Modifier
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.28f))
                } else {
                    Modifier
                },
            ),
    ) {
        Icon(
            if (shortlisted) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
            contentDescription = label,
            tint = tint,
            modifier = Modifier.scale(scale),
        )
    }
}

/**
 * The full-size profile card of specs/16 section 1.5 for matches and search: a large photo with
 * the name, badges and place over it, then education, key facts, reasons and the actions.
 */
@Composable
fun ProfileCardView(
    card: ProfileCard,
    onOpen: () -> Unit,
    onToggleShortlist: () -> Unit,
    modifier: Modifier = Modifier,
    onPass: (() -> Unit)? = null,
) {
    val name = nameAndAge(card)
    val notInterested = stringResource(R.string.discovery_card_not_interested)
    val shortlistLabel =
        if (card.relation.isShortlisted) {
            text(R.string.shared_card_shortlist_remove, "name" to card.displayName)
        } else {
            text(R.string.shared_card_shortlist_add, "name" to card.displayName)
        }
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 2.dp,
        modifier =
            modifier
                .fillMaxWidth()
                .semantics {
                    customActions =
                        buildList {
                            add(
                                CustomAccessibilityAction(shortlistLabel) {
                                    onToggleShortlist()
                                    true
                                },
                            )
                            if (onPass != null) {
                                add(
                                    CustomAccessibilityAction(notInterested) {
                                        onPass()
                                        true
                                    },
                                )
                            }
                        }
                },
    ) {
        Column(Modifier.clickable(role = Role.Button, onClick = onOpen)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(0.86f),
            ) {
                MemberPhoto(
                    photo = card.photo,
                    gender = card.gender,
                    size = PhotoSize.MEDIUM,
                    contentDescription =
                        if (card.photo?.isBlurred == true) {
                            stringResource(R.string.a11y_private_photo)
                        } else {
                            text(R.string.shared_photo_alt, "name" to card.displayName)
                        },
                    modifier = Modifier.fillMaxSize(),
                    showLock = false,
                )
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(KrTheme.colors.photoScrim),
                )
                Row(
                    Modifier
                        .align(Alignment.TopStart)
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    card.compat?.let { CompatBadge(it) }
                    if (card.photo?.isBlurred ==
                        true
                    ) {
                        PhotoChip(text = stringResource(R.string.shared_photo_private), icon = null)
                    }
                }
                Row(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (card.photoCount >= 2) {
                        PhotoChip(
                            text = plural(R.plurals.shared_card_photo_count, card.photoCount.toInt()),
                            icon = Icons.Filled.PhotoCamera,
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    ShortlistHeart(
                        shortlisted = card.relation.isShortlisted,
                        name = card.displayName,
                        onToggle = onToggleShortlist,
                        onPhoto = true,
                    )
                    if (onPass != null) CardMenu(onPass = onPass, onPhoto = true)
                }
                Column(
                    Modifier
                        .align(Alignment.BottomStart)
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            name,
                            style = MaterialTheme.typography.headlineSmall,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        Spacer(Modifier.width(8.dp))
                        BadgeIcons(card.badges, onPhoto = true)
                    }
                    Spacer(Modifier.height(2.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Outlined.LocationOn,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            locationLine(card.cityName, card.countryCode),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.92f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        activityLabel(card.lastActive)?.let { activity ->
                            Text(
                                "  ·  " + stringResource(activity),
                                style = MaterialTheme.typography.bodyMedium,
                                color = Color.White.copy(alpha = 0.92f),
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.School,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        educationAndWork(card),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    keyFacts(card).joinToString("  ·  "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (card.managedBy != ManagedBy.SELF) {
                    Text(
                        text(
                            R.string.shared_card_managed_by,
                            "label" to LocalReference.current.option(Lists.MANAGED_BY, card.managedBy),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                ReasonChips(card.reasons)
                relationHint(card)?.let { RelationPill(it) }
            }
        }
    }
}

/** The narrower card of the horizontal rows on `APP-HOME`. */
@Composable
fun ProfileCardCompactTile(
    card: ProfileCard,
    onOpen: () -> Unit,
    onToggleShortlist: () -> Unit,
    modifier: Modifier = Modifier,
    onPass: (() -> Unit)? = null,
) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 2.dp,
        modifier = modifier.width(212.dp),
    ) {
        Box(
            Modifier
                .aspectRatio(0.72f)
                .clickable(role = Role.Button, onClick = onOpen),
        ) {
            MemberPhoto(
                photo = card.photo,
                gender = card.gender,
                size = PhotoSize.MEDIUM,
                contentDescription =
                    if (card.photo?.isBlurred == true) {
                        stringResource(R.string.a11y_private_photo)
                    } else {
                        text(R.string.shared_photo_alt, "name" to card.displayName)
                    },
                modifier = Modifier.fillMaxSize(),
                showLock = card.photo?.isBlurred == true,
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(KrTheme.colors.photoScrim),
            )
            card.compat?.let {
                CompatBadge(
                    it,
                    Modifier
                        .align(Alignment.TopStart)
                        .padding(10.dp),
                )
            }
            Row(Modifier.align(Alignment.TopEnd)) {
                if (onPass != null) CardMenu(onPass = onPass, onPhoto = true)
            }
            Column(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 4.dp, bottom = 8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                nameAndAge(card),
                                style = MaterialTheme.typography.titleMedium,
                                color = Color.White,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            Spacer(Modifier.width(4.dp))
                            BadgeIcons(card.badges.filter { it != Badge.NEW }, onPhoto = true)
                        }
                        Text(
                            locationLine(card.cityName, card.countryCode),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.9f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            educationAndWork(card),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.85f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    ShortlistHeart(
                        shortlisted = card.relation.isShortlisted,
                        name = card.displayName,
                        onToggle = onToggleShortlist,
                        onPhoto = true,
                    )
                }
            }
        }
    }
}

/**
 * The compact card of specs/16 section 1.5 for interests, shortlist, visitors and requests: a round
 * photo, name and age, badges, place, one line of education and work, the match percentage and
 * the relation hint. [extra] adds lines under it; [actions] adds buttons.
 */
@Composable
fun ProfileRow(
    card: ProfileCard,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
    showRelation: Boolean = true,
    unseen: Boolean = false,
    extra: (@Composable () -> Unit)? = null,
    actions: (@Composable () -> Unit)? = null,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier
                .clickable(role = Role.Button, onClick = onOpen)
                .padding(12.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Box {
                    MemberPhoto(
                        photo = card.photo,
                        gender = card.gender,
                        size = PhotoSize.THUMB,
                        contentDescription =
                            if (card.photo?.isBlurred == true) {
                                stringResource(R.string.a11y_private_photo)
                            } else {
                                text(R.string.shared_photo_alt, "name" to card.displayName)
                            },
                        modifier = Modifier.size(72.dp),
                        shape = RoundedCornerShape(16.dp),
                        lockSize = 12.dp,
                    )
                    if (unseen) {
                        Box(
                            Modifier
                                .align(Alignment.TopEnd)
                                .size(12.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.tertiary),
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            nameAndAge(card),
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        Spacer(Modifier.width(6.dp))
                        BadgeIcons(card.badges)
                    }
                    Text(
                        locationLine(card.cityName, card.countryCode),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                    Text(
                        educationAndWork(card),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        card.compat?.let {
                            Text(
                                text(R.string.shared_compat, "value" to it),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.tertiary,
                            )
                        }
                        if (showRelation) relationHint(card)?.let { RelationPill(it) }
                    }
                }
            }
            if (extra != null) {
                Spacer(Modifier.height(8.dp))
                extra()
            }
            if (actions != null) {
                Spacer(Modifier.height(10.dp))
                actions()
            }
        }
    }
}

/** A grey row for an item whose member is no longer available (11 section 3.1). */
@Composable
fun UnavailableRow(
    text: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Outlined.VisibilityOff,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            action?.invoke()
        }
    }
}

@Composable
fun RelationPill(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shape = CircleShape,
        modifier = modifier,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun PhotoChip(
    text: String,
    icon: ImageVector?,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.4f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(text, style = MaterialTheme.typography.labelSmall, color = Color.White)
    }
}

/** The card menu with "Not interested". */
@Composable
fun CardMenu(
    onPass: () -> Unit,
    modifier: Modifier = Modifier,
    onPhoto: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        IconButton(
            onClick = { open = true },
            modifier =
                if (onPhoto) {
                    Modifier
                        .padding(start = 4.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.28f))
                } else {
                    Modifier
                },
        ) {
            Icon(
                Icons.Outlined.MoreVert,
                contentDescription = stringResource(R.string.discovery_card_more),
                tint = if (onPhoto) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.discovery_card_not_interested)) },
                leadingIcon = { Icon(Icons.Outlined.VisibilityOff, contentDescription = null) },
                onClick = {
                    open = false
                    onPass()
                },
            )
        }
    }
}
