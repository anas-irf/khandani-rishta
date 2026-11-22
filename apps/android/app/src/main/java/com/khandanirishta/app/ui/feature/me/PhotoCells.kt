package com.khandanirishta.app.ui.feature.me

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuDivider
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.KrMeter
import com.khandanirishta.app.ui.components.KrOutlinedIconButton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.dashedBorder
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** What the grid, the viewer and the list of refused photos can do. */
@Immutable
internal class PhotoActions(
    val add: () -> Unit,
    val open: (OwnPhoto) -> Unit,
    val makeMain: (OwnPhoto) -> Unit,
    val move: (OwnPhoto, Int) -> Unit,
    val remove: (OwnPhoto) -> Unit,
    val cancelUpload: (Long) -> Unit,
    val retryUpload: (Long) -> Unit,
    val dismissUpload: (Long) -> Unit,
)

/** The status of a slot: words, and always an icon or a spinner with them (08 section 5.5). */
@Immutable
internal data class SlotStatus(
    @param:StringRes val label: Int,
    val tone: StatusTone,
    val icon: ImageVector? = null,
    val spinning: Boolean = false,
)

/** `null` for an approved photo that is not the main one: it has no label. */
internal fun slotStatus(photo: OwnPhoto): SlotStatus? {
    val label = photoStatusLabel(photo) ?: return null
    return when (photo.status) {
        PhotoStatus.PROCESSING -> SlotStatus(label, StatusTone.NEUTRAL, spinning = true)

        PhotoStatus.PENDING_REVIEW -> SlotStatus(label, StatusTone.WARNING, Icons.Outlined.Schedule)

        PhotoStatus.REJECTED -> SlotStatus(label, StatusTone.DANGER, Icons.Outlined.ErrorOutline)

        PhotoStatus.FAILED -> SlotStatus(label, StatusTone.DANGER, Icons.Outlined.BrokenImage)

        // "Main photo". A star, because a tick would say verified and a heart Shortlist.
        PhotoStatus.APPROVED, PhotoStatus.UNKNOWN -> SlotStatus(label, StatusTone.INFO, Icons.Outlined.StarOutline)
    }
}

internal fun OwnPhoto.canBecomeMain(): Boolean = status == PhotoStatus.APPROVED && !isPrimary

/**
 * A photo of the grid: the arch, which opens it, its menu, and the status under it. To TalkBack
 * the arch says the status and carries the menu's actions, so no one has to drag to reorder.
 */
@Composable
internal fun PhotoCell(
    photo: OwnPhoto,
    position: Int,
    count: Int,
    busy: Boolean,
    actions: PhotoActions,
    modifier: Modifier = Modifier,
) {
    val usable = LocalOnline.current && !busy
    val status = remember(photo) { slotStatus(photo) }
    val statusText = status?.let { stringResource(it.label) }
    val alt = text(R.string.photos_grid_photo_alt, "position" to position)
    val openLabel = text(R.string.photos_grid_open, "position" to position)
    val makeMain = stringResource(R.string.photos_actions_make_main)
    val moveEarlier = stringResource(R.string.photos_actions_move_earlier)
    val moveLater = stringResource(R.string.photos_actions_move_later)
    val remove = stringResource(R.string.photos_actions_remove)
    val accessibility =
        Modifier.semantics {
            contentDescription = alt
            if (statusText != null) stateDescription = statusText
            if (usable) {
                customActions =
                    buildList {
                        if (photo.canBecomeMain()) add(accessibilityAction(makeMain) { actions.makeMain(photo) })
                        if (position > 1) add(accessibilityAction(moveEarlier) { actions.move(photo, -1) })
                        if (position < count) add(accessibilityAction(moveLater) { actions.move(photo, 1) })
                        add(accessibilityAction(remove) { actions.remove(photo) })
                    }
            }
        }
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        Box(Modifier.fillMaxWidth()) {
            OwnPhotoImage(
                url = photo.thumbUrl ?: photo.mediumUrl,
                description = null,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(ARCH_RATIO)
                        .then(accessibility)
                        .tappable(shape = ArchShape, onClick = { actions.open(photo) }, onClickLabel = openLabel),
                placeholder = { NoFileYet(photo.status) },
            )
            PhotoMenu(
                photo = photo,
                position = position,
                count = count,
                usable = usable,
                actions = actions,
                modifier =
                    Modifier
                        .align(Alignment.BottomEnd)
                        .padding(Spacing.s4),
            )
        }
        if (status != null && statusText != null) {
            ArchStatus(
                text = statusText,
                tone = status.tone,
                icon = status.icon,
                spinning = status.spinning,
                // The arch already says it.
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
    }
}

private fun accessibilityAction(
    label: String,
    action: () -> Unit,
) = CustomAccessibilityAction(label) {
    action()
    true
}

/** In the place of a photo without a file: waiting while it is processed, broken otherwise. */
@Composable
internal fun NoFileYet(status: PhotoStatus) {
    Icon(
        imageVector = if (status == PhotoStatus.PROCESSING) Icons.Outlined.Schedule else Icons.Outlined.BrokenImage,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(Sizes.icon),
    )
}

/** The menu of 08 section 5.5, for members who cannot drag. */
@Composable
private fun PhotoMenu(
    photo: OwnPhoto,
    position: Int,
    count: Int,
    usable: Boolean,
    actions: PhotoActions,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }

    fun choose(action: () -> Unit) {
        open = false
        action()
    }

    Box(modifier) {
        // A fill of its own, so the control is readable over any photo.
        Box(Modifier.background(KrTheme.colors.card, PillShape)) {
            KrOutlinedIconButton(
                icon = Icons.Outlined.MoreVert,
                contentDescription = text(R.string.photos_grid_options, "position" to position),
                onClick = { open = true },
            )
        }
        KrMenu(expanded = open, onDismissRequest = { open = false }) {
            KrMenuItem(
                text = stringResource(R.string.photos_actions_view),
                icon = Icons.Outlined.Visibility,
                onClick = { choose { actions.open(photo) } },
            )
            if (photo.canBecomeMain()) {
                KrMenuItem(
                    text = stringResource(R.string.photos_actions_make_main),
                    icon = Icons.Outlined.StarOutline,
                    enabled = usable,
                    onClick = { choose { actions.makeMain(photo) } },
                )
            }
            KrMenuItem(
                text = stringResource(R.string.photos_actions_move_earlier),
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                enabled = usable && position > 1,
                onClick = { choose { actions.move(photo, -1) } },
            )
            KrMenuItem(
                text = stringResource(R.string.photos_actions_move_later),
                icon = Icons.AutoMirrored.Filled.ArrowForward,
                enabled = usable && position < count,
                onClick = { choose { actions.move(photo, 1) } },
            )
            KrMenuDivider()
            KrMenuItem(
                text = stringResource(R.string.photos_actions_remove),
                icon = Icons.Outlined.DeleteOutline,
                enabled = usable,
                onClick = { choose { actions.remove(photo) } },
            )
        }
    }
}

/**
 * An upload on its way: the picked image under a veil with its progress, and under the arch
 * "Waiting...", "Uploading...", "Processing..." or "Upload failed" with Try again.
 */
@Composable
internal fun UploadCell(
    slot: PhotoUploadSlot,
    actions: PhotoActions,
    modifier: Modifier = Modifier,
) {
    val failed = slot.state == PhotoUploadState.FAILED
    val label =
        stringResource(
            when (slot.state) {
                PhotoUploadState.WAITING -> R.string.photos_status_waiting
                PhotoUploadState.UPLOADING -> R.string.photos_status_uploading
                PhotoUploadState.PROCESSING -> R.string.photos_status_processing
                PhotoUploadState.FAILED -> R.string.photos_status_upload_failed
            },
        )
    val extra = KrTheme.colors
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        Box(Modifier.fillMaxWidth()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ARCH_RATIO)
                    .clip(ArchShape)
                    .background(extra.skeleton),
            ) {
                AsyncImage(
                    model = slot.uri,
                    contentDescription = stringResource(R.string.photos_grid_upload_alt),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize(),
                )
                if (!failed) Box(Modifier.matchParentSize().background(extra.photoVeil))
                if (slot.state == PhotoUploadState.UPLOADING) {
                    KrMeter(
                        progress = { slot.progress },
                        description = stringResource(R.string.photos_status_progress),
                        modifier =
                            Modifier
                                .align(Alignment.Center)
                                .padding(horizontal = Spacing.s8),
                    )
                }
            }
            if (slot.state == PhotoUploadState.WAITING || slot.state == PhotoUploadState.UPLOADING) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .padding(Spacing.s4)
                        .background(extra.card, PillShape),
                ) {
                    KrOutlinedIconButton(
                        icon = Icons.Outlined.Close,
                        contentDescription = stringResource(R.string.photos_actions_cancel_upload),
                        onClick = { actions.cancelUpload(slot.id) },
                    )
                }
            }
        }
        ArchStatus(
            text = label,
            tone = if (failed) StatusTone.DANGER else StatusTone.NEUTRAL,
            spinning = !failed,
            modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        )
        if (failed) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(Spacing.s8),
            ) {
                KrOutlinedIconButton(
                    icon = Icons.Outlined.Refresh,
                    contentDescription = stringResource(R.string.photos_actions_retry),
                    onClick = { actions.retryUpload(slot.id) },
                    enabled = LocalOnline.current,
                )
                KrOutlinedIconButton(
                    icon = Icons.Outlined.Close,
                    contentDescription = stringResource(R.string.photos_actions_dismiss),
                    onClick = { actions.dismissUpload(slot.id) },
                )
            }
        }
    }
}

/**
 * An empty slot: a dashed arch with a plus. The [first] one says how many are free; the others
 * are the same control, so TalkBack skips them.
 */
@Composable
internal fun AddCell(
    label: String?,
    description: String,
    first: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val online = LocalOnline.current
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ARCH_RATIO)
                    .dashedBorder(ArchShape, colors.outline)
                    .semantics {
                        contentDescription = if (label == null) description else "$label. $description"
                        if (!first) hideFromAccessibility()
                    }.tappable(shape = ArchShape, onClick = onClick, enabled = online),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.Add,
                contentDescription = null,
                tint = if (online) colors.primary else colors.onSurfaceVariant,
                modifier = Modifier.size(AddIcon),
            )
        }
        if (label != null) {
            Text(
                text = label,
                style = KrType.badge,
                color = colors.primary,
                textAlign = TextAlign.Center,
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
    }
}

private val AddIcon = 28.dp
