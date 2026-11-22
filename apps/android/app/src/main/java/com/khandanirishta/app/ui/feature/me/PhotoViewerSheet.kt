package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.StatusPill
import com.khandanirishta.app.ui.text.text

/**
 * Tapping a filled slot: the own photo whole, with its status and controls (08 section 5.5). A
 * sheet, so Back, a swipe or a tap outside closes it. The danger colour waits for the confirmation.
 */
@Composable
internal fun PhotoViewerSheet(
    photo: OwnPhoto,
    position: Int,
    count: Int,
    busy: Boolean,
    actions: PhotoActions,
    onDismiss: () -> Unit,
) {
    val usable = LocalOnline.current && !busy
    val status = remember(photo) { slotStatus(photo) }
    // Fixed before the image loads, so the controls under it do not move.
    val imageHeight =
        (LocalWindowInfo.current.containerDpSize.height * VIEWER_SHARE).coerceIn(ViewerMin, ViewerMax)
    KrSheet(
        title = text(R.string.photos_viewer_title, "position" to position),
        description = stringResource(R.string.photos_viewer_description),
        onDismissRequest = onDismiss,
    ) {
        OwnPhotoImage(
            url = photo.largeUrl ?: photo.mediumUrl ?: photo.thumbUrl,
            description = text(R.string.photos_grid_photo_alt, "position" to position),
            contentScale = ContentScale.Fit,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(imageHeight)
                    .clip(MaterialTheme.shapes.large),
            placeholder = { NoFileYet(photo.status) },
        )
        if (status != null) {
            StatusPill(
                text = stringResource(status.label),
                tone = status.tone,
                icon = status.icon,
                spinning = status.spinning,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (photo.canBecomeMain()) {
            KrButton(
                text = stringResource(R.string.photos_actions_make_main),
                onClick = { actions.makeMain(photo) },
                icon = Icons.Outlined.StarOutline,
                enabled = usable,
                loading = busy,
                fullWidth = true,
            )
        }
        AdaptiveRow {
            KrButton(
                text = stringResource(R.string.photos_actions_move_earlier),
                onClick = { actions.move(photo, -1) },
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                enabled = usable && position > 1,
                modifier = Modifier.grow(),
            )
            KrButton(
                text = stringResource(R.string.photos_actions_move_later),
                onClick = { actions.move(photo, 1) },
                variant = KrButtonVariant.SECONDARY,
                icon = Icons.AutoMirrored.Filled.ArrowForward,
                enabled = usable && position < count,
                modifier = Modifier.grow(),
            )
        }
        KrButton(
            text = stringResource(R.string.photos_actions_remove),
            onClick = { actions.remove(photo) },
            variant = KrButtonVariant.QUIET,
            icon = Icons.Outlined.DeleteOutline,
            enabled = usable,
            fullWidth = true,
        )
    }
}

private val ViewerMin = 180.dp
private val ViewerMax = 440.dp
private const val VIEWER_SHARE = 0.4f
