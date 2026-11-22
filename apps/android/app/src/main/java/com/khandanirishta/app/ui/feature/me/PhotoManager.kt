package com.khandanirishta.app.ui.feature.me

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.SectionHeading
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import kotlinx.coroutines.launch

/**
 * The photo grid with upload, primary choice, order and removal (specs/08 section 5.5), used by
 * `ME-PHOTOS` and the onboarding photos step (`ONB-08`). It loads and updates the photos itself
 * through `ProfileRepository` and reports every change through [onPhotosChange].
 *
 * Content: the grid of `photos_max` arches (photos by position, uploads in progress, then empty
 * slots), "Add a photo" or the limit, the photos that were not approved with their messages, and
 * the photo guidelines of 13 section 4.1. Photos are picked with the system Photo Picker; uploads
 * run in [PhotoUploadQueue]. Every change waits for the server (rule 4). It has no gutters: the
 * screen around it gives them.
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
    val currentOpenPicker by rememberUpdatedState(openPicker)

    var viewerId by rememberSaveable { mutableStateOf<String?>(null) }
    var removeId by rememberSaveable { mutableStateOf<String?>(null) }
    var warnPrimaryId by rememberSaveable { mutableStateOf<String?>(null) }
    var warnRemoveId by rememberSaveable { mutableStateOf<String?>(null) }

    val actions =
        remember(viewModel, photoVerified) {
            PhotoActions(
                add = { currentOpenPicker() },
                open = { viewerId = it.id },
                // Rule 1 of 08 section 5.5: changing or removing the main photo of a photo-verified profile.
                makeMain = { photo -> if (photoVerified) warnPrimaryId = photo.id else viewModel.makePrimary(photo) },
                move = viewModel::move,
                remove = { photo ->
                    if (photoVerified && photo.isPrimary) warnRemoveId = photo.id else removeId = photo.id
                },
                cancelUpload = viewModel::cancelUpload,
                retryUpload = viewModel::retryUpload,
                dismissUpload = viewModel::dismissUpload,
            )
        }

    PhotoManagerBody(
        state = state,
        uploads = uploads,
        photosMax = photosMax,
        onboarding = onboarding,
        actions = actions,
        onRetry = { viewModel.load() },
        modifier = modifier,
    )

    val viewerPhoto = photos.firstOrNull { it.id == viewerId }
    if (viewerPhoto != null) {
        PhotoViewerSheet(
            photo = viewerPhoto,
            position = photos.indexOf(viewerPhoto) + 1,
            count = photos.size,
            busy = state.busy,
            actions = actions,
            onDismiss = { viewerId = null },
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

/** Blocks 2 to 4 of `ME-PHOTOS`, without the view model and the picker. */
@Composable
internal fun PhotoManagerBody(
    state: PhotoManagerUiState,
    uploads: List<PhotoUploadSlot>,
    photosMax: Int,
    onboarding: Boolean,
    actions: PhotoActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val photos = state.photos
    val freeSlots =
        remember(photos, uploads, photosMax) {
            (photosMax - photos.count { it.countsTowardLimit() } - uploads.size).coerceAtLeast(0)
        }
    val problems =
        remember(photos) { photos.filter { it.status == PhotoStatus.REJECTED || it.status == PhotoStatus.FAILED } }
    val rules = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.gutter)) {
        if (!onboarding && state.loaded && photos.isEmpty() && uploads.isEmpty()) {
            Text(
                text = stringResource(R.string.photos_grid_empty),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when {
            !state.loaded && state.error != null -> {
                ErrorState(error = state.error, onRetry = onRetry, retrying = state.loading)
            }

            !state.loaded -> {
                GridSkeleton(slots = photosMax)
            }

            else -> {
                PhotoGrid(photos, uploads, freeSlots, photosMax, state.busy, actions)
                if (freeSlots == 0) {
                    CaptionText(
                        text = text(R.string.photos_grid_limit, "max" to photosMax),
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                } else {
                    KrButton(
                        text = stringResource(R.string.photos_grid_add),
                        onClick = actions.add,
                        variant = KrButtonVariant.SECONDARY,
                        icon = Icons.Outlined.Add,
                        enabled = LocalOnline.current,
                    )
                }
            }
        }
        if (problems.isNotEmpty()) {
            RefusedPhotos(
                photos = problems,
                allPhotos = photos,
                busy = state.busy,
                onGuidelines = { scope.launch { rules.bringIntoView() } },
                onRemove = actions.remove,
            )
        }
        PhotoRules(onboarding = onboarding, modifier = Modifier.bringIntoViewRequester(rules))
    }
}

/** Block 2 of `ME-PHOTOS`: `photos_max` arches. */
@Composable
private fun PhotoGrid(
    photos: List<OwnPhoto>,
    uploads: List<PhotoUploadSlot>,
    freeSlots: Int,
    photosMax: Int,
    busy: Boolean,
    actions: PhotoActions,
) {
    val addDescription = text(R.string.photos_grid_add_named, "count" to freeSlots, "max" to photosMax)
    val mainLabel = stringResource(R.string.photos_status_main)
    val nothingYet = photos.isEmpty() && uploads.isEmpty()
    ArchGrid {
        photos.forEachIndexed { index, photo ->
            key("photo-${photo.id}") {
                PhotoCell(photo, position = index + 1, count = photos.size, busy = busy, actions = actions)
            }
        }
        uploads.forEach { slot ->
            key("upload-${slot.id}") { UploadCell(slot, actions) }
        }
        repeat(freeSlots) { index ->
            key("empty-$index") {
                AddCell(
                    // The first photo becomes the main one.
                    label = if (index == 0 && nothingYet) mainLabel else null,
                    description = addDescription,
                    first = index == 0,
                    onClick = actions.add,
                )
            }
        }
    }
}

/** Block 3: a banner for each `rejected` or `failed` photo, with its message and "Remove". */
@Composable
private fun RefusedPhotos(
    photos: List<OwnPhoto>,
    allPhotos: List<OwnPhoto>,
    busy: Boolean,
    onGuidelines: () -> Unit,
    onRemove: (OwnPhoto) -> Unit,
) {
    val usable = LocalOnline.current && !busy
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        SectionHeading(
            title = stringResource(R.string.photos_rejections_title),
            style = MaterialTheme.typography.titleMedium,
        )
        photos.forEach { photo ->
            StatusBanner(text = stringResource(photoRejectionText(photo)), tone = StatusTone.DANGER) {
                FlowRow(
                    modifier = Modifier.padding(top = Spacing.s8),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                    verticalArrangement = Arrangement.spacedBy(Spacing.s8),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) {
                    // Which photo it is about.
                    OwnPhotoImage(
                        url = photo.thumbUrl ?: photo.mediumUrl,
                        description =
                            text(R.string.photos_grid_photo_alt, "position" to allPhotos.indexOf(photo) + 1),
                        modifier =
                            Modifier
                                .size(Sizes.arch48)
                                .clip(ArchShape),
                        placeholder = { NoFileYet(photo.status) },
                    )
                    if (photo.status == PhotoStatus.REJECTED) {
                        KrTextLink(stringResource(R.string.photos_rejections_guidelines), onGuidelines)
                    }
                    KrButton(
                        text = stringResource(R.string.photos_actions_remove),
                        onClick = { onRemove(photo) },
                        variant = KrButtonVariant.SECONDARY,
                        enabled = usable,
                    )
                }
            }
        }
    }
}

/** Block 4: the "Do" and "Do not" list of 13 section 4.1. Dots, not ticks: a tick means verified. */
@Composable
private fun PhotoRules(
    onboarding: Boolean,
    modifier: Modifier = Modifier,
) {
    TonalPanel(modifier = modifier, spacing = Spacing.s16) {
        Text(
            text = stringResource(R.string.photos_rules_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        RuleList(title = stringResource(R.string.photos_rules_do_title), rules = PhotoDos)
        RuleList(title = stringResource(R.string.photos_rules_dont_title), rules = PhotoDonts)
        if (onboarding) CaptionText(stringResource(R.string.photos_rules_reviewed))
    }
}

@Composable
private fun RuleList(
    title: String,
    rules: List<Int>,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.semantics { heading() },
        )
        rules.forEach { BulletLine(stringResource(it), style = MaterialTheme.typography.bodySmall) }
    }
}

/** Loading: the arches of the grid (08 section 5.5). */
@Composable
private fun GridSkeleton(slots: Int) {
    LoadingRegion(Modifier.fillMaxWidth()) {
        ArchGrid {
            repeat(slots) { SkeletonBox(Modifier.fillMaxWidth().aspectRatio(ARCH_RATIO), shape = ArchShape) }
        }
    }
}

private val PhotoDos =
    listOf(
        R.string.photos_rules_do_0,
        R.string.photos_rules_do_1,
        R.string.photos_rules_do_2,
        R.string.photos_rules_do_3,
    )
private val PhotoDonts =
    listOf(
        R.string.photos_rules_dont_0,
        R.string.photos_rules_dont_1,
        R.string.photos_rules_dont_2,
        R.string.photos_rules_dont_3,
        R.string.photos_rules_dont_4,
        R.string.photos_rules_dont_5,
        R.string.photos_rules_dont_6,
    )
private const val DEFAULT_PHOTOS_MAX = 6L
