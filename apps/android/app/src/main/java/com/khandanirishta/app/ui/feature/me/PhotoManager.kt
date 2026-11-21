package com.khandanirishta.app.ui.feature.me

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import kotlinx.coroutines.launch

/**
 * The photo grid with upload, primary choice, order and removal (specs/08 section 5.5), used by
 * `ME-PHOTOS` and the onboarding photos step (`ONB-08`). It loads and updates the photos itself
 * through `ProfileRepository` and reports every change through [onPhotosChange].
 *
 * Content: the grid of `photos_max` slots (photos by position, uploads in progress, then empty
 * "Add a photo" slots), the limit caption, the photos that were not approved with their
 * messages, and the photo guidelines of 13 section 4.1. Photos are picked with the system Photo
 * Picker; uploads run in [PhotoUploadQueue]. Every change waits for the server (rule 4).
 */
@Composable
fun PhotoManager(
    modifier: Modifier = Modifier,
    onPhotosChange: (List<OwnPhoto>) -> Unit = {},
) {
    PhotoManagerContent(onPhotosChange = onPhotosChange, modifier = modifier)
}

@Composable
private fun PhotoManagerContent(
    onPhotosChange: (List<OwnPhoto>) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PhotoManagerViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val uploads by viewModel.uploads.collectAsStateWithLifecycle()
    val me = LocalMe.current
    val photosMax = (me?.config?.photosMax ?: DEFAULT_PHOTOS_MAX).toInt()
    // The onboarding step adds its own privacy choice and buttons around the grid (07 section 10).
    val onboarding = me?.gate == Gate.ONBOARDING
    val photoVerified = me?.profile?.badges?.contains(Badge.PHOTO_VERIFIED) == true
    val photos = state.photos

    val currentOnPhotosChange by rememberUpdatedState(onPhotosChange)
    LaunchedEffect(photos, state.loaded) {
        if (state.loaded) currentOnPhotosChange(photos)
    }

    val activeCount = photos.count { it.countsTowardLimit() } + uploads.size
    val freeSlots = (photosMax - activeCount).coerceAtLeast(0)

    // The Photo Picker allows several photos only when two or more slots are free.
    val multipleContract = remember(photosMax) { ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, photosMax)) }
    val pickMany = rememberLauncherForActivityResult(multipleContract) { uris -> viewModel.add(uris, photosMax) }
    val pickOne =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) viewModel.add(listOf(uri), photosMax)
        }
    val openPicker: () -> Unit = {
        try {
            if (freeSlots >= 2) {
                pickMany.launch(
                    PickVisualMediaRequest(
                        mediaType = ActivityResultContracts.PickVisualMedia.ImageOnly,
                        maxItems = freeSlots,
                    ),
                )
            } else if (freeSlots == 1) {
                pickOne.launch(PickVisualMediaRequest(mediaType = ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
        } catch (_: ActivityNotFoundException) {
            // No picker on this phone: nothing can be chosen.
        }
    }

    var viewerId by rememberSaveable { mutableStateOf<String?>(null) }
    var removeId by rememberSaveable { mutableStateOf<String?>(null) }
    var warnPrimaryId by rememberSaveable { mutableStateOf<String?>(null) }
    var warnRemoveId by rememberSaveable { mutableStateOf<String?>(null) }

    // Rule 1 of 08 section 5.5: changing or removing the main photo of a photo-verified profile.
    val requestPrimary: (OwnPhoto) -> Unit = { photo ->
        if (photoVerified) warnPrimaryId = photo.id else viewModel.makePrimary(photo)
    }
    val requestRemove: (OwnPhoto) -> Unit = { photo ->
        if (photoVerified && photo.isPrimary) warnRemoveId = photo.id else removeId = photo.id
    }

    val rulesRequester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    val problems = photos.filter { it.status == PhotoStatus.REJECTED || it.status == PhotoStatus.FAILED }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(MeBlockSpacing)) {
        if (!onboarding && state.loaded && photos.isEmpty() && uploads.isEmpty()) {
            Text(
                stringResource(R.string.photos_grid_empty),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when {
            !state.loaded && state.error != null -> {
                ErrorState(error = state.error, onRetry = { viewModel.load() })
            }

            !state.loaded -> {
                GridSkeleton(slots = photosMax)
            }

            else -> {
                PhotoGrid(
                    photos = photos,
                    uploads = uploads,
                    freeSlots = freeSlots,
                    photosMax = photosMax,
                    busy = state.busy,
                    onAdd = openPicker,
                    onOpen = { viewerId = it.id },
                    onMakeMain = requestPrimary,
                    onMove = viewModel::move,
                    onRemove = requestRemove,
                    onCancelUpload = viewModel::cancelUpload,
                    onRetryUpload = viewModel::retryUpload,
                    onDismissUpload = viewModel::dismissUpload,
                )
            }
        }
        if (state.loaded && freeSlots == 0) {
            Text(
                text(R.string.photos_grid_limit, "max" to photosMax),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (problems.isNotEmpty()) {
            RejectedPhotos(
                photos = problems,
                onGuidelines = { scope.launch { rulesRequester.bringIntoView() } },
                onRemove = requestRemove,
            )
        }
        PhotoRules(onboarding = onboarding, modifier = Modifier.bringIntoViewRequester(rulesRequester))
    }

    val viewerPhoto = photos.firstOrNull { it.id == viewerId }
    if (viewerPhoto != null) {
        PhotoViewerDialog(
            photo = viewerPhoto,
            position = photos.indexOf(viewerPhoto) + 1,
            count = photos.size,
            busy = state.busy,
            onClose = { viewerId = null },
            onMakeMain = requestPrimary,
            onMove = viewModel::move,
            onRemove = requestRemove,
        )
    }

    if (warnPrimaryId != null || warnRemoveId != null) {
        ConfirmDialog(
            title = stringResource(R.string.photos_verified_dialog_title),
            text = stringResource(R.string.photos_verified_dialog_description),
            confirmLabel = stringResource(R.string.photos_verified_dialog_confirm),
            dismissLabel = stringResource(R.string.photos_verified_dialog_cancel),
            onConfirm = {
                photos.firstOrNull { it.id == warnPrimaryId }?.let(viewModel::makePrimary)
                if (warnRemoveId != null) removeId = warnRemoveId
                warnPrimaryId = null
                warnRemoveId = null
            },
            onDismiss = {
                warnPrimaryId = null
                warnRemoveId = null
            },
        )
    }

    val removeTarget = photos.firstOrNull { it.id == removeId }
    if (removeTarget != null) {
        ConfirmDialog(
            title = stringResource(R.string.photos_remove_dialog_title),
            text = stringResource(R.string.photos_remove_dialog_description),
            confirmLabel = stringResource(R.string.photos_remove_dialog_confirm),
            dismissLabel = stringResource(R.string.photos_remove_dialog_cancel),
            destructive = true,
            onConfirm = {
                viewModel.remove(removeTarget)
                if (viewerId == removeTarget.id) viewerId = null
                removeId = null
            },
            onDismiss = { removeId = null },
        )
    }
}

/** A cell of the grid: a photo, an upload in progress, or an empty slot. */
private sealed interface GridCell {
    val key: String

    data class Photo(
        val photo: OwnPhoto,
        val position: Int,
    ) : GridCell {
        override val key: String get() = "photo-" + photo.id
    }

    data class Upload(
        val slot: PhotoUploadSlot,
    ) : GridCell {
        override val key: String get() = "upload-" + slot.id
    }

    data class Empty(
        val index: Int,
    ) : GridCell {
        override val key: String get() = "empty-$index"
    }
}

/** Block 2 of `ME-PHOTOS`: `photos_max` slots, 3 per row (08 section 5.5). */
@Composable
private fun PhotoGrid(
    photos: List<OwnPhoto>,
    uploads: List<PhotoUploadSlot>,
    freeSlots: Int,
    photosMax: Int,
    busy: Boolean,
    onAdd: () -> Unit,
    onOpen: (OwnPhoto) -> Unit,
    onMakeMain: (OwnPhoto) -> Unit,
    onMove: (OwnPhoto, Int) -> Unit,
    onRemove: (OwnPhoto) -> Unit,
    onCancelUpload: (Long) -> Unit,
    onRetryUpload: (Long) -> Unit,
    onDismissUpload: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cells =
        photos.mapIndexed { index, photo -> GridCell.Photo(photo, index + 1) } +
            uploads.map { GridCell.Upload(it) } +
            (0 until freeSlots).map { GridCell.Empty(it) }
    val firstEmptyIsMain = photos.isEmpty() && uploads.isEmpty()
    val addDescription = text(R.string.photos_grid_add_named, "count" to freeSlots, "max" to photosMax)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(GridGap)) {
        cells.chunked(COLUMNS).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(GridGap)) {
                row.forEach { cell ->
                    key(cell.key) {
                        val cellModifier =
                            Modifier
                                .weight(1f)
                                .aspectRatio(1f)
                        when (cell) {
                            is GridCell.Photo -> {
                                PhotoTile(
                                    photo = cell.photo,
                                    position = cell.position,
                                    count = photos.size,
                                    busy = busy,
                                    onOpen = { onOpen(cell.photo) },
                                    onMakeMain = { onMakeMain(cell.photo) },
                                    onMove = { delta -> onMove(cell.photo, delta) },
                                    onRemove = { onRemove(cell.photo) },
                                    modifier = cellModifier,
                                )
                            }

                            is GridCell.Upload -> {
                                UploadTile(
                                    slot = cell.slot,
                                    onCancel = { onCancelUpload(cell.slot.id) },
                                    onRetry = { onRetryUpload(cell.slot.id) },
                                    onDismiss = { onDismissUpload(cell.slot.id) },
                                    modifier = cellModifier,
                                )
                            }

                            is GridCell.Empty -> {
                                AddTile(
                                    label =
                                        when {
                                            cell.index != 0 -> null
                                            firstEmptyIsMain -> stringResource(R.string.photos_status_main)
                                            else -> stringResource(R.string.photos_grid_add)
                                        },
                                    description = addDescription,
                                    onClick = onAdd,
                                    modifier = cellModifier,
                                )
                            }
                        }
                    }
                }
                repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** A photo slot: the thumbnail, its status label and the menu of 08 section 5.5. */
@Composable
private fun PhotoTile(
    photo: OwnPhoto,
    position: Int,
    count: Int,
    busy: Boolean,
    onOpen: () -> Unit,
    onMakeMain: () -> Unit,
    onMove: (Int) -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val openLabel = text(R.string.photos_grid_open, "position" to position)
    Box(
        modifier
            .clip(TileShape)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(role = Role.Button, onClickLabel = openLabel, onClick = onOpen),
    ) {
        OwnPhotoImage(
            photo = photo,
            description = text(R.string.photos_grid_photo_alt, "position" to position),
            large = false,
            modifier = Modifier.fillMaxSize(),
        )
        PhotoStatusPill(
            photo = photo,
            modifier =
                Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp),
        )
        Box(Modifier.align(Alignment.TopEnd)) {
            IconButton(onClick = { menuOpen = true }) {
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.MoreVert,
                        contentDescription = text(R.string.photos_grid_options, "position" to position),
                        tint = Color.White,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                MenuItem(R.string.photos_actions_view, Icons.Outlined.Visibility) {
                    menuOpen = false
                    onOpen()
                }
                if (photo.status == PhotoStatus.APPROVED && !photo.isPrimary) {
                    MenuItem(R.string.photos_actions_make_main, Icons.Outlined.Star, enabled = !busy) {
                        menuOpen = false
                        onMakeMain()
                    }
                }
                MenuItem(
                    R.string.photos_actions_move_earlier,
                    Icons.AutoMirrored.Filled.ArrowBack,
                    enabled = position > 1 && !busy,
                ) {
                    menuOpen = false
                    onMove(-1)
                }
                MenuItem(
                    R.string.photos_actions_move_later,
                    Icons.AutoMirrored.Filled.ArrowForward,
                    enabled = position < count && !busy,
                ) {
                    menuOpen = false
                    onMove(1)
                }
                HorizontalDivider()
                MenuItem(
                    R.string.photos_actions_remove,
                    Icons.Outlined.DeleteOutline,
                    destructive = true,
                    enabled = !busy,
                ) {
                    menuOpen = false
                    onRemove()
                }
            }
        }
    }
}

@Composable
private fun MenuItem(
    @StringRes label: Int,
    icon: ImageVector,
    enabled: Boolean = true,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    val tint = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    DropdownMenuItem(
        text = { Text(stringResource(label)) },
        onClick = onClick,
        enabled = enabled,
        leadingIcon = { Icon(icon, contentDescription = null) },
        colors = MenuDefaults.itemColors(textColor = tint, leadingIconColor = tint),
    )
}

/** The own photo: `thumb_url` in the grid, `large_url` in the viewer; an icon while there is none. */
@Composable
private fun OwnPhotoImage(
    photo: OwnPhoto,
    description: String?,
    large: Boolean,
    modifier: Modifier = Modifier,
) {
    val url = if (large) photo.largeUrl ?: photo.mediumUrl ?: photo.thumbUrl else photo.thumbUrl ?: photo.mediumUrl
    val request = rememberStableImageRequest(url)
    if (request != null) {
        AsyncImage(
            model = request,
            contentDescription = description,
            contentScale = if (large) ContentScale.Fit else ContentScale.Crop,
            modifier = modifier,
        )
    } else {
        Box(
            modifier.semantics { if (description != null) contentDescription = description },
            contentAlignment = Alignment.Center,
        ) {
            if (photo.status == PhotoStatus.PROCESSING) {
                CircularProgressIndicator(modifier = Modifier.size(26.dp), strokeWidth = 2.5.dp)
            } else {
                Icon(
                    Icons.Outlined.BrokenImage,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(28.dp),
                )
            }
        }
    }
}

/** The label over a slot: the status, or "Main photo" on the primary one (08 section 5.5). */
@Composable
private fun PhotoStatusPill(
    photo: OwnPhoto,
    modifier: Modifier = Modifier,
) {
    val label = photoStatusLabel(photo) ?: return
    val problem = photo.status == PhotoStatus.REJECTED || photo.status == PhotoStatus.FAILED
    val main = photo.status == PhotoStatus.APPROVED
    MeStatusPill(
        text = stringResource(label),
        container =
            when {
                problem -> MaterialTheme.colorScheme.error
                main -> MaterialTheme.colorScheme.primary
                else -> Color.Black.copy(alpha = 0.65f)
            },
        content = Color.White,
        icon =
            when {
                main -> Icons.Filled.Star
                problem -> Icons.Outlined.ErrorOutline
                photo.status == PhotoStatus.PENDING_REVIEW -> Icons.Outlined.Schedule
                else -> null
            },
        spinning = photo.status == PhotoStatus.PROCESSING,
        modifier = modifier,
    )
}

/** An upload slot: the local image, "Waiting...", "Uploading..." with progress, "Processing...". */
@Composable
private fun UploadTile(
    slot: PhotoUploadSlot,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
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
    val progressLabel = stringResource(R.string.photos_status_progress)
    Box(
        modifier
            .clip(TileShape)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        AsyncImage(
            model = slot.uri,
            contentDescription = stringResource(R.string.photos_grid_upload_alt),
            contentScale = ContentScale.Crop,
            modifier =
                Modifier
                    .fillMaxSize()
                    .alpha(if (failed) 0.85f else 0.55f),
        )
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(6.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            MeStatusPill(
                text = label,
                container = if (failed) MaterialTheme.colorScheme.error else Color.Black.copy(alpha = 0.65f),
                content = Color.White,
                icon = if (failed) Icons.Outlined.ErrorOutline else null,
                spinning = !failed,
            )
            if (slot.state == PhotoUploadState.UPLOADING) {
                LinearProgressIndicator(
                    progress = { slot.progress },
                    color = Color.White,
                    trackColor = Color.White.copy(alpha = 0.35f),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(CircleShape)
                            .semantics { contentDescription = progressLabel },
                )
            }
        }
        if (failed) {
            Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilledTonalIconButton(onClick = onRetry) {
                    Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.photos_actions_retry))
                }
                FilledTonalIconButton(onClick = onDismiss) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.photos_actions_dismiss))
                }
            }
        } else if (slot.state != PhotoUploadState.PROCESSING) {
            IconButton(onClick = onCancel, modifier = Modifier.align(Alignment.TopEnd)) {
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = stringResource(R.string.photos_actions_cancel_upload),
                        tint = Color.White,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

/** An empty slot with a plus sign: tapping opens the Photo Picker. */
@Composable
private fun AddTile(
    label: String?,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .clip(TileShape)
            .background(MaterialTheme.colorScheme.surfaceContainerLowest)
            .meDashedBorder(color = MaterialTheme.colorScheme.outline, cornerRadius = TileCorner)
            .clickable(role = Role.Button, onClickLabel = description, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
            if (label != null) {
                Text(
                    label,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 6.dp),
                )
            }
        }
    }
}

/** Block 3: one line per `rejected` or `failed` photo with its message and "Remove". */
@Composable
private fun RejectedPhotos(
    photos: List<OwnPhoto>,
    onGuidelines: () -> Unit,
    onRemove: (OwnPhoto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        MeBlockTitle(stringResource(R.string.photos_rejections_title))
        photos.forEach { photo ->
            Surface(
                color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.55f),
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                    OwnPhotoImage(
                        photo = photo,
                        description = null,
                        large = false,
                        modifier =
                            Modifier
                                .size(56.dp)
                                .clip(MaterialTheme.shapes.small)
                                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(photoRejectionText(photo)), style = MaterialTheme.typography.bodyMedium)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (photo.status == PhotoStatus.REJECTED) {
                                TextButton(onClick = onGuidelines) {
                                    Text(stringResource(R.string.photos_rejections_guidelines))
                                }
                            }
                            TextButton(
                                onClick = { onRemove(photo) },
                                colors =
                                    ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            ) {
                                Text(stringResource(R.string.photos_actions_remove))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Block 4: the "Do" and "Do not" list of 13 section 4.1. */
@Composable
private fun PhotoRules(
    onboarding: Boolean,
    modifier: Modifier = Modifier,
) {
    val dos =
        listOf(
            R.string.photos_rules_do_0,
            R.string.photos_rules_do_1,
            R.string.photos_rules_do_2,
            R.string.photos_rules_do_3,
        )
    val donts =
        listOf(
            R.string.photos_rules_dont_0,
            R.string.photos_rules_dont_1,
            R.string.photos_rules_dont_2,
            R.string.photos_rules_dont_3,
            R.string.photos_rules_dont_4,
            R.string.photos_rules_dont_5,
            R.string.photos_rules_dont_6,
        )
    MeSurfaceCard(modifier = modifier, spacing = 8.dp) {
        MeBlockTitle(stringResource(R.string.photos_rules_title))
        Text(
            stringResource(R.string.photos_rules_do_title),
            style = MaterialTheme.typography.titleSmall,
            color = KrTheme.colors.success,
        )
        dos.forEach { rule ->
            RuleLine(text = stringResource(rule), icon = Icons.Filled.CheckCircle, tint = KrTheme.colors.success)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            stringResource(R.string.photos_rules_dont_title),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.error,
        )
        donts.forEach { rule ->
            RuleLine(text = stringResource(rule), icon = Icons.Filled.Cancel, tint = MaterialTheme.colorScheme.error)
        }
        if (onboarding) {
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.photos_rules_reviewed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RuleLine(
    text: String,
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Icon(
            icon,
            contentDescription = null,
            tint = tint,
            modifier =
                Modifier
                    .padding(top = 2.dp)
                    .size(18.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

/** Tapping a filled slot: the own photo full screen with its controls (08 section 5.5). */
@Composable
private fun PhotoViewerDialog(
    photo: OwnPhoto,
    position: Int,
    count: Int,
    busy: Boolean,
    onClose: () -> Unit,
    onMakeMain: (OwnPhoto) -> Unit,
    onMove: (OwnPhoto, Int) -> Unit,
    onRemove: (OwnPhoto) -> Unit,
) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(color = Color.Black, contentColor = Color.White, modifier = Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.photos_actions_close))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(
                            text(R.string.photos_viewer_title, "position" to position),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            stringResource(R.string.photos_viewer_description),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.75f),
                        )
                    }
                }
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.Center,
                ) {
                    OwnPhotoImage(
                        photo = photo,
                        description = text(R.string.photos_grid_photo_alt, "position" to position),
                        large = true,
                        modifier = Modifier.fillMaxSize(),
                    )
                    PhotoStatusPill(
                        photo = photo,
                        modifier =
                            Modifier
                                .align(Alignment.BottomCenter)
                                .padding(12.dp),
                    )
                }
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (photo.status == PhotoStatus.APPROVED && !photo.isPrimary) {
                        MePrimaryButton(
                            text = stringResource(R.string.photos_actions_make_main),
                            onClick = { onMakeMain(photo) },
                            busy = busy,
                            icon = Icons.Filled.Star,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ViewerButton(
                            text = stringResource(R.string.photos_actions_move_earlier),
                            icon = Icons.AutoMirrored.Filled.ArrowBack,
                            enabled = position > 1 && !busy,
                            onClick = { onMove(photo, -1) },
                            modifier = Modifier.weight(1f),
                        )
                        ViewerButton(
                            text = stringResource(R.string.photos_actions_move_later),
                            icon = Icons.AutoMirrored.Filled.ArrowForward,
                            enabled = position < count && !busy,
                            onClick = { onMove(photo, 1) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    TextButton(
                        onClick = { onRemove(photo) },
                        enabled = !busy,
                        colors =
                            ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.errorContainer),
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp),
                    ) {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.photos_actions_remove))
                    }
                }
            }
        }
    }
}

@Composable
private fun ViewerButton(
    text: String,
    icon: ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        border = BorderStroke(1.dp, Color.White.copy(alpha = if (enabled) 0.6f else 0.25f)),
        colors =
            ButtonDefaults.outlinedButtonColors(
                contentColor = Color.White,
                disabledContentColor = Color.White.copy(alpha = 0.4f),
            ),
        modifier = modifier.heightIn(min = 48.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, maxLines = 1)
    }
}

/** Loading: a grid of grey slots (08 section 5.5). */
@Composable
private fun GridSkeleton(
    slots: Int,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(GridGap)) {
        (0 until slots).chunked(COLUMNS).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(GridGap)) {
                row.forEach { _ ->
                    SkeletonBox(
                        Modifier
                            .weight(1f)
                            .aspectRatio(1f),
                        corner = TileCorner,
                    )
                }
                repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

private const val COLUMNS = 3
private const val DEFAULT_PHOTOS_MAX = 6L
private val GridGap = 10.dp
private val TileCorner = 16.dp
private val TileShape = RoundedCornerShape(TileCorner)
