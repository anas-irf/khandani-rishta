package com.khandanirishta.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.PhotoView
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.LargeArchShape
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.rememberReducedMotion

/** Which variant of a photo to load (specs/16 rule G10). */
enum class PhotoSize { THUMB, MEDIUM, LARGE }

fun PhotoView.url(size: PhotoSize): String =
    when (size) {
        PhotoSize.THUMB -> thumbUrl
        PhotoSize.MEDIUM -> mediumUrl
        PhotoSize.LARGE -> largeUrl ?: mediumUrl
    }

/** The URL without its query string: the signature changes hourly, the object path does not (08 section 5.4). */
fun stableKey(url: String): String = url.substringBefore('?')

/**
 * An image request whose memory and disk cache keys ignore the URL signature. Coil decodes to the
 * size of the box it is drawn in, and fades in unless animations are off.
 */
@Composable
fun rememberStableImageRequest(url: String?): ImageRequest? {
    val context = LocalContext.current
    val reducedMotion = rememberReducedMotion()
    return remember(url, reducedMotion) {
        url?.let {
            ImageRequest
                .Builder(context)
                .data(it)
                .memoryCacheKey(stableKey(it))
                .diskCacheKey(stableKey(it))
                .crossfade(if (reducedMotion) 0 else Motion.FAST_MILLIS)
                .build()
        }
    }
}

/**
 * How the states of DESIGN.md section 6.8 are layered.
 *
 * - [CARD]: veil, inner arch line, diamond, monogram and the pill with words.
 * - [TILE]: veil and monogram; the words are for TalkBack.
 * - [COMPACT]: rows and thumbs, where private is a small lock disc.
 * - [PROFILE]: the gallery, with the double line and a larger monogram.
 * - [BARE]: the image alone, where the caller draws its own treatment over it.
 */
enum class PhotoVariant { CARD, TILE, COMPACT, PROFILE, BARE }

/**
 * Another member's photo, always an arch (DESIGN.md section 6.8, specs/22 section 11). Give it
 * its size: it keeps that size while the image loads, so nothing shifts.
 *
 * The image is drawn exactly as received. A blurred photo is a separate file from the API and is
 * never blurred or unblurred on the device (rule G10): the private treatment is layers over it.
 * A placeholder is the lattice with the monogram, or a silhouette when the member has no name.
 *
 * Pass [decorative] inside a card whose name already says the photo's state.
 */
@Composable
fun MemberPhoto(
    photo: PhotoView?,
    name: String?,
    gender: Gender?,
    size: PhotoSize,
    modifier: Modifier = Modifier,
    variant: PhotoVariant = if (size == PhotoSize.THUMB) PhotoVariant.COMPACT else PhotoVariant.CARD,
    shape: Shape = if (variant == PhotoVariant.PROFILE) LargeArchShape else ArchShape,
    decorative: Boolean = false,
    count: Long = 0,
    isNew: Boolean = false,
    monogramSize: Dp = monogramFor(variant),
) {
    val url = photo?.url(size)
    val key = url?.let(::stableKey)
    var failed by remember(url) { mutableStateOf(false) }
    var loaded by remember(key) { mutableStateOf(false) }
    val showImage = url != null && !failed
    val named = !name.isNullOrBlank()
    // The caller of a bare photo draws the veil and the monogram, also when the image is missing.
    val bare = variant == PhotoVariant.BARE
    val blurred = photo?.isBlurred == true && !bare
    val compact = variant == PhotoVariant.COMPACT
    val large = variant == PhotoVariant.CARD || variant == PhotoVariant.PROFILE
    val showCount = variant == PhotoVariant.CARD && count >= 2
    val hasChips = isNew || showCount
    val extra = KrTheme.colors

    val description =
        when {
            decorative -> null
            photo == null -> stringResource(R.string.shared_photo_none)
            photo.isBlurred -> stringResource(R.string.a11y_private_photo)
            else -> text(R.string.shared_photo_alt, "name" to name.orEmpty())
        }
    val ground =
        when {
            !showImage -> Modifier.lattice(fill = KrTheme.tonal, dots = extra.lattice)
            !loaded -> Modifier.background(extra.skeleton)
            else -> Modifier
        }
    Box(
        modifier
            .clearAndSetSemantics {
                if (description != null) {
                    contentDescription = description
                    role = Role.Image
                }
            }.clip(shape)
            .then(ground),
    ) {
        if (showImage) {
            AsyncImage(
                model = rememberStableImageRequest(url),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                onSuccess = { loaded = true },
                onError = { failed = true },
                modifier = Modifier.matchParentSize(),
            )
        } else if (!named && !bare) {
            Silhouette(gender, Modifier.matchParentSize())
        }

        if ((named && !showImage && !bare) || (blurred && !compact)) {
            val pill =
                when {
                    blurred && large -> {
                        StatePill(Icons.Outlined.Lock, stringResource(R.string.shared_photo_private))
                    }

                    variant == PhotoVariant.CARD && photo == null -> {
                        StatePill(Icons.Outlined.PhotoCamera, stringResource(R.string.shared_photo_none))
                    }

                    else -> {
                        null
                    }
                }
            PhotoVeil(
                name = name,
                monogramSize = monogramSize,
                veiled = showImage,
                inlay = large,
                doubleInlay = variant == PhotoVariant.PROFILE,
                pill = pill,
                roomForChips = large && hasChips,
            )
        }
        if (blurred && compact) LockDisc(centered = isNew)
        if (hasChips) PhotoChips(variant = variant, isNew = isNew, count = if (showCount) count else 0)
    }
}

private class StatePill(
    val icon: ImageVector,
    val text: String,
)

/** The veil with its monogram. Text never sits on a photo: the pill has its own fill. */
@Composable
private fun BoxScope.PhotoVeil(
    name: String?,
    monogramSize: Dp,
    veiled: Boolean,
    inlay: Boolean,
    doubleInlay: Boolean,
    pill: StatePill?,
    roomForChips: Boolean,
) {
    val veil = if (veiled) Modifier.background(KrTheme.colors.photoVeil) else Modifier
    Box(Modifier.matchParentSize().then(veil))
    if (inlay) ArchInlay(double = doubleInlay)
    // Room at the bottom, so the chips never cover the pill at larger text.
    val chipRoom = with(LocalDensity.current) { ChipRoom.toDp() } + Spacing.s16
    val padding =
        if (inlay) {
            Modifier.padding(
                start = Spacing.s24,
                top = Spacing.s24,
                end = Spacing.s24,
                bottom = if (roomForChips) chipRoom else Spacing.s24,
            )
        } else {
            Modifier
        }
    Box(Modifier.matchParentSize().then(padding), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            if (inlay) Diamond(size = InlayDiamond)
            Monogram(name = name, size = monogramSize)
            if (pill != null) {
                Surface(
                    color = MaterialTheme.colorScheme.background,
                    contentColor = MaterialTheme.colorScheme.onBackground,
                    shape = MaterialTheme.shapes.large,
                ) {
                    IconText(
                        icon = pill.icon,
                        text = pill.text,
                        style = KrType.badge,
                        iconSize = Sizes.iconBadge,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = Spacing.s12, vertical = Spacing.s8),
                    )
                }
            }
        }
    }
}

@Composable
private fun BoxScope.LockDisc(centered: Boolean) {
    val placed =
        if (centered) {
            Modifier.align(Alignment.Center)
        } else {
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = LockInset)
        }
    Box(
        placed
            .size(LockDiscSize)
            .background(MaterialTheme.colorScheme.background, PillShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Lock,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.size(Sizes.iconBadge),
        )
    }
}

/** "New" at the bottom start and "4 photos" at the bottom end. */
@Composable
private fun BoxScope.PhotoChips(
    variant: PhotoVariant,
    isNew: Boolean,
    count: Long,
) {
    val colors = MaterialTheme.colorScheme
    val compact = variant == PhotoVariant.COMPACT
    val side =
        when (variant) {
            PhotoVariant.COMPACT -> 0.dp
            PhotoVariant.TILE -> Spacing.s8
            else -> Spacing.s16
        }
    val bottom = if (compact) Spacing.s4 else side
    Row(
        modifier =
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(start = side, end = side, bottom = bottom),
        horizontalArrangement = if (compact) Arrangement.Center else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        if (isNew) {
            Surface(color = colors.primary, contentColor = colors.onPrimary, shape = PillShape) {
                Text(
                    text = stringResource(R.string.shared_badge_new),
                    style = KrType.badge,
                    modifier =
                        Modifier.padding(
                            horizontal = if (compact) Spacing.s8 else Spacing.s12,
                            vertical = if (compact) 0.dp else ChipInset,
                        ),
                )
            }
        }
        if (count > 0) {
            Spacer(Modifier.weight(1f))
            Surface(color = KrTheme.colors.photoCountChip, contentColor = colors.background, shape = PillShape) {
                Text(
                    text = plural(R.plurals.shared_card_photo_count, count.toInt()),
                    style = KrType.count,
                    modifier = Modifier.padding(horizontal = Spacing.s12, vertical = ChipInset),
                )
            }
        }
    }
}

/**
 * The neutral figure for a member with no name to make a monogram from (rule G10): a silhouette
 * that differs for male and female profiles.
 */
@Composable
fun Silhouette(
    gender: Gender?,
    modifier: Modifier = Modifier,
) {
    Image(
        painter =
            painterResource(
                if (gender == Gender.FEMALE) R.drawable.ic_silhouette_female else R.drawable.ic_silhouette_male,
            ),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        colorFilter = ColorFilter.tint(KrTheme.colors.silhouette),
        modifier = modifier,
    )
}

/**
 * A member's small arch in a row or a bar: the thumb with the private treatment, or the monogram.
 * Never a circle. [size] is one of the arches of `Sizes`.
 */
@Composable
fun MemberAvatar(
    photo: PhotoView?,
    name: String?,
    gender: Gender?,
    modifier: Modifier = Modifier,
    size: DpSize = Sizes.arch46,
    decorative: Boolean = false,
) {
    MemberPhoto(
        photo = photo,
        name = name,
        gender = gender,
        size = PhotoSize.THUMB,
        decorative = decorative,
        monogramSize = if (size.width < Sizes.arch56.width) SmallMonogram else CompactMonogram,
        modifier = modifier.size(size),
    )
}

private fun monogramFor(variant: PhotoVariant): Dp =
    when (variant) {
        PhotoVariant.CARD -> CardMonogram
        PhotoVariant.PROFILE -> ProfileMonogram
        PhotoVariant.TILE -> TileMonogram
        PhotoVariant.COMPACT, PhotoVariant.BARE -> CompactMonogram
    }

private val ProfileMonogram = 76.dp
private val CardMonogram = 58.dp
private val TileMonogram = 34.dp
private val CompactMonogram = 22.dp
private val SmallMonogram = 18.dp
private val InlayDiamond = 9.dp
private val LockDiscSize = 24.dp
private val LockInset = 5.dp
private val ChipInset = 5.dp
private val ChipRoom = 33.sp
