package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.LockedGroup
import com.khandanirishta.app.core.network.generated.model.PhotoView
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.RelationPhotoAccess
import com.khandanirishta.app.ui.components.ArchInlay
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrOutlinedIconButton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberPhoto
import com.khandanirishta.app.ui.components.Monogram
import com.khandanirishta.app.ui.components.PhotoSize
import com.khandanirishta.app.ui.components.PhotoVariant
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.LargeArchShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.rememberReducedMotion
import kotlinx.coroutines.launch

/** The photos with the primary first (16 section 6.7 block 1). The viewer uses the same order. */
internal fun orderedPhotos(photos: List<PhotoView>): List<PhotoView> = photos.sortedByDescending { it.isPrimary }

/** Whether the photo access overlay covers the photos. */
internal fun photosLocked(detail: ProfileDetail): Boolean =
    LockedGroup.PHOTOS in detail.locked && detail.relation.photoAccess != RelationPhotoAccess.VISIBLE

/**
 * The gallery of APP-PROFILE (16 section 6.7 block 1) as one large arch: the photos swipe, and
 * the controls and position sit under the arch, off the photo. Without photos the arch keeps its
 * shape and a caption says so. The access overlay grows the arch rather than being cut.
 */
@Composable
internal fun ProfileGallery(
    detail: ProfileDetail,
    onOpen: ((index: Int) -> Unit)?,
    onRequestPhotos: (() -> Unit)?,
    modifier: Modifier = Modifier,
    requesting: Boolean = false,
) {
    val card = detail.card
    val photos = remember(detail.photos) { orderedPhotos(detail.photos) }
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        val locked = photosLocked(detail)
        if (photos.isEmpty() && !locked) {
            MemberPhoto(
                photo = null,
                name = card.displayName,
                gender = card.gender,
                size = PhotoSize.MEDIUM,
                variant = PhotoVariant.PROFILE,
                decorative = true,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(ARCH_RATIO),
            )
            IconText(
                icon = Icons.Outlined.PhotoCamera,
                text = stringResource(R.string.profile_gallery_none),
                style = MaterialTheme.typography.titleSmall,
                iconSize = Sizes.iconMedium,
                textAlign = TextAlign.Center,
            )
            return@Column
        }
        val pager = rememberPagerState { photos.size }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(LargeArchShape),
            contentAlignment = Alignment.Center,
        ) {
            // Holds the 4:5, and lets the overlay make the arch taller.
            Spacer(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ARCH_RATIO),
            )
            HorizontalPager(
                state = pager,
                key = { photos[it].id },
                modifier = Modifier.matchParentSize(),
            ) { page ->
                val open =
                    if (onOpen == null) {
                        Modifier
                    } else {
                        Modifier.tappable(
                            shape = LargeArchShape,
                            onClick = { onOpen(page) },
                            onClickLabel =
                                text(R.string.profile_gallery_open, "current" to page + 1, "total" to photos.size),
                        )
                    }
                Box(Modifier.fillMaxSize().then(open)) {
                    MemberPhoto(
                        photo = photos[page],
                        name = card.displayName,
                        gender = card.gender,
                        size = PhotoSize.MEDIUM,
                        variant = if (locked) PhotoVariant.BARE else PhotoVariant.PROFILE,
                        shape = LargeArchShape,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            if (locked) {
                if (photos.isEmpty()) {
                    // The API can send none for photos it could not sign: the arch and the request stay.
                    MemberPhoto(
                        photo = null,
                        name = card.displayName,
                        gender = card.gender,
                        size = PhotoSize.MEDIUM,
                        variant = PhotoVariant.BARE,
                        shape = LargeArchShape,
                        decorative = true,
                        modifier = Modifier.matchParentSize(),
                    )
                }
                Box(
                    Modifier
                        .matchParentSize()
                        .background(KrTheme.colors.photoVeil),
                )
                ArchInlay(double = true)
                PhotoAccessOverlay(
                    access = detail.relation.photoAccess,
                    name = card.displayName,
                    onRequest = onRequestPhotos,
                    busy = requesting,
                )
            }
        }
        if (photos.size > 1) GalleryControls(pager, photos.size)
        if (locked && card.photoCount >= 2) {
            Text(
                text = plural(R.plurals.shared_card_photo_count, card.photoCount.toInt()),
                style = MaterialTheme.typography.bodySmall.merge(KrType.numbers),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun GalleryControls(
    pager: PagerState,
    total: Int,
) {
    val scope = rememberCoroutineScope()
    val reducedMotion = rememberReducedMotion()
    val current = pager.currentPage

    fun show(page: Int) {
        scope.launch { if (reducedMotion) pager.scrollToPage(page) else pager.animateScrollToPage(page) }
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        KrOutlinedIconButton(
            icon = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            contentDescription = stringResource(R.string.profile_gallery_previous),
            onClick = { show(current - 1) },
            enabled = current > 0,
        )
        Text(
            text = text(R.string.profile_gallery_position, "current" to current + 1, "total" to total),
            style = MaterialTheme.typography.bodySmall.merge(KrType.numbers),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        KrOutlinedIconButton(
            icon = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = stringResource(R.string.profile_gallery_next),
            onClick = { show(current + 1) },
            enabled = current < total - 1,
        )
    }
}

/**
 * The words and the control of the "Photo access" table of 16 section 6.7, over the veil. A
 * denial is never named (09 section 6.4). The blurred image under it is drawn as received.
 *
 * It takes no touches outside its button, so the photos still swipe and open under it.
 */
@Composable
internal fun PhotoAccessOverlay(
    access: RelationPhotoAccess,
    name: String,
    onRequest: (() -> Unit)?,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    monogramSize: Dp = OverlayMonogram,
) {
    if (access == RelationPhotoAccess.VISIBLE) return
    val requested = access == RelationPhotoAccess.REQUESTED
    val colors = MaterialTheme.colorScheme
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.gutter, vertical = Spacing.s24),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        Diamond(size = OverlayDiamond)
        Monogram(name = name, size = monogramSize)
        Text(
            text =
                if (requested) {
                    stringResource(R.string.profile_photo_access_requested)
                } else {
                    text(R.string.profile_photo_access_private, "name" to name)
                },
            style = if (requested) MaterialTheme.typography.titleSmall else KrType.figure,
            color = colors.onBackground,
            textAlign = TextAlign.Center,
            // Text never sits on a photo. A Surface would take the swipe, so this is a background.
            modifier =
                Modifier
                    .background(colors.background, MaterialTheme.shapes.large)
                    .padding(horizontal = Spacing.s12, vertical = Spacing.s8),
        )
        if (access == RelationPhotoAccess.CAN_REQUEST && onRequest != null) {
            KrButton(
                text = stringResource(R.string.profile_photo_access_request),
                onClick = onRequest,
                size = KrButtonSize.COMPACT,
                enabled = LocalOnline.current,
                loading = busy,
            )
        }
    }
}

private val OverlayDiamond = 10.dp
private val OverlayMonogram = 76.dp
