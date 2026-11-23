package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateSetOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.PhotoView
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.RelationPhotoAccess
import com.khandanirishta.app.ui.components.ArchInlay
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.LightSystemBarIcons
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.Monogram
import com.khandanirishta.app.ui.components.NoLongerAvailable
import com.khandanirishta.app.ui.components.PhotoSize
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.components.lattice
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.components.stableKey
import com.khandanirishta.app.ui.components.url
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.rememberReducedMotion
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@Immutable
data class PhotoViewerState(
    val detail: ProfileDetail? = null,
    val error: ApiError? = null,
    val requesting: Boolean = false,
)

/** The photos of APP-PHOTOS: from the profile already loaded, refetched when older than 60 minutes (16 section 6.8). */
@HiltViewModel(assistedFactory = PhotoViewerViewModel.Factory::class)
class PhotoViewerViewModel
    @AssistedInject
    constructor(
        @Assisted val profileId: String,
        private val cache: ProfileCache,
        private val discovery: DiscoveryRepository,
        private val relations: RelationRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(profileId: String): PhotoViewerViewModel
        }

        private val mutableState = MutableStateFlow(PhotoViewerState(detail = cache.get(profileId)))
        val state: StateFlow<PhotoViewerState> = mutableState.asStateFlow()
        private var retried = false

        init {
            if (mutableState.value.detail == null) reload()
        }

        fun reload() {
            viewModelScope.launch {
                mutableState.update { it.copy(error = null) }
                discovery
                    .profile(profileId)
                    .onSuccess { detail ->
                        cache.put(detail)
                        mutableState.update { it.copy(detail = detail) }
                    }.onFailure { failure -> mutableState.update { it.copy(error = failure.apiError) } }
            }
        }

        /** "Try again" on a photo that failed: refetch the profile once. */
        fun retryOnce() {
            if (retried) return
            retried = true
            reload()
        }

        fun requestPhotos() {
            if (mutableState.value.requesting) return
            mutableState.update { it.copy(requesting = true) }
            viewModelScope.launch {
                relations
                    .requestPhotos(profileId)
                    .onSuccess {
                        bus.toast(R.string.shared_photo_access_sent)
                        reload()
                    }.onFailure { photoRequestFailed(bus, it.apiError, refetch = ::reload) }
                mutableState.update { it.copy(requesting = false) }
            }
        }
    }

/** APP-PHOTOS: one photo at a time on the inverse surface, swipe and pinch to zoom (16 section 6.8). */
@Composable
fun PhotoViewerScreen(
    profileId: String,
    index: Int,
    modifier: Modifier = Modifier,
    viewModel: PhotoViewerViewModel =
        hiltViewModel<PhotoViewerViewModel, PhotoViewerViewModel.Factory> { it.create(profileId) },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val back = { navigator.back() }
    val error = state.error
    if (state.detail == null && error != null) {
        Scaffold(
            modifier = modifier,
            topBar = { DetailTopBar(title = "", onBack = back) },
        ) { padding ->
            StateScreen(Modifier.padding(padding).consumeWindowInsets(padding)) {
                if (error.code == ErrorCode.NOT_FOUND) {
                    NoLongerAvailable(onBack = back, title = stringResource(R.string.profile_load_not_found))
                } else {
                    ErrorState(error = error, onRetry = viewModel::reload)
                }
            }
        }
        return
    }
    PhotoViewerContent(
        state = state,
        index = index,
        onClose = back,
        onRetry = viewModel::retryOnce,
        onRequest = viewModel::requestPhotos,
        modifier = modifier,
    )
}

/** The viewer. Nothing here saves, shares or downloads, and a blurred photo is never zoomed. */
@Composable
internal fun PhotoViewerContent(
    state: PhotoViewerState,
    index: Int,
    onClose: () -> Unit,
    onRetry: () -> Unit,
    onRequest: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val detail = state.detail
    val photos = remember(detail?.photos) { orderedPhotos(detail?.photos.orEmpty()) }
    val pager = rememberPagerState(initialPage = index.coerceAtLeast(0)) { photos.size }
    // Here rather than in each page: the access overlay steps aside for a page that failed.
    val failed = remember { mutableStateSetOf<String>() }
    val name = detail?.card?.displayName
    val title = text(R.string.profile_photos_title, "name" to name.orEmpty())
    LightSystemBarIcons()
    Surface(
        color = colors.inverseSurface,
        contentColor = colors.inverseOnSurface,
        modifier = modifier.fillMaxSize().semantics { if (name != null) paneTitle = title },
    ) {
        InvertedFocusRing {
            Column(Modifier.safeDrawingPadding()) {
                ViewerBar(pager = pager, total = photos.size, onClose = onClose)
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .clipToBounds(),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        detail == null -> {
                            ViewerPlaceholder(name = null, message = stringResource(R.string.shared_list_loading))
                        }

                        photos.isEmpty() -> {
                            ViewerPlaceholder(name = name, message = stringResource(R.string.profile_gallery_none))
                        }

                        else -> {
                            HorizontalPager(
                                state = pager,
                                key = { photos[it].id },
                                modifier = Modifier.fillMaxSize(),
                            ) { page ->
                                val url = photos[page].url(PhotoSize.LARGE)
                                ViewerPhoto(
                                    photo = photos[page],
                                    name = name,
                                    position = page + 1,
                                    total = photos.size,
                                    shown = pager.settledPage == page,
                                    veiled = photos[page].isBlurred && photosLocked(detail),
                                    failed = url in failed,
                                    onFailure = { failed += url },
                                    onRetry = {
                                        failed -= url
                                        onRetry()
                                    },
                                    access = {
                                        if (photos[page].isBlurred && photosLocked(detail)) {
                                            FailedPhotoAccess(
                                                access = detail.relation.photoAccess,
                                                busy = state.requesting,
                                                onRequest = onRequest,
                                            )
                                        }
                                    },
                                )
                            }
                            val current = photos.getOrNull(pager.currentPage)
                            if (current?.isBlurred == true && photosLocked(detail) &&
                                current.url(PhotoSize.LARGE) !in failed
                            ) {
                                PhotoAccessOverlay(
                                    access = detail.relation.photoAccess,
                                    name = detail.card.displayName,
                                    onRequest = onRequest,
                                    busy = state.requesting,
                                    monogramSize = ViewerMonogram,
                                )
                            }
                        }
                    }
                }
                if (photos.size > 1) ViewerControls(pager, photos.size)
            }
        }
    }
}

@Composable
private fun ViewerBar(
    pager: PagerState,
    total: Int,
    onClose: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = Sizes.topBar)
                .padding(horizontal = Spacing.s8, vertical = Spacing.s4),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KrIconButton(
            icon = Icons.Outlined.Close,
            contentDescription = stringResource(R.string.profile_photos_close),
            onClick = onClose,
        )
        if (total > 0) {
            Text(
                text = text(R.string.profile_photos_position, "current" to pager.currentPage + 1, "total" to total),
                style = MaterialTheme.typography.bodyMedium.merge(KrType.numbers),
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics { liveRegion = LiveRegionMode.Polite },
            )
            // Keeps the position in the middle.
            Spacer(Modifier.size(Sizes.touch))
        }
    }
}

/** The same as a swipe, for anyone who cannot swipe. They sit off the photo. */
@Composable
private fun ViewerControls(
    pager: PagerState,
    total: Int,
) {
    val scope = rememberCoroutineScope()
    val reducedMotion = rememberReducedMotion()
    val current = pager.currentPage

    fun show(page: Int) {
        scope.launch { if (reducedMotion) pager.scrollToPage(page) else pager.animateScrollToPage(page) }
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s8, vertical = Spacing.s4),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        if (current > 0) {
            KrIconButton(
                icon = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                contentDescription = stringResource(R.string.profile_photos_previous),
                onClick = { show(current - 1) },
            )
        } else {
            Spacer(Modifier.size(Sizes.touch))
        }
        if (current < total - 1) {
            KrIconButton(
                icon = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = stringResource(R.string.profile_photos_next),
                onClick = { show(current + 1) },
            )
        } else {
            Spacer(Modifier.size(Sizes.touch))
        }
    }
}

/**
 * One photo. A pinch zooms a clear photo up to [MAX_ZOOM]. One finger pans it only while it is
 * zoomed, and otherwise swipes to the next photo.
 */
@Composable
private fun ViewerPhoto(
    photo: PhotoView,
    name: String?,
    position: Int,
    total: Int,
    shown: Boolean,
    veiled: Boolean,
    failed: Boolean,
    onFailure: () -> Unit,
    onRetry: () -> Unit,
    access: @Composable () -> Unit,
) {
    val url = photo.url(PhotoSize.LARGE)
    var loaded by remember(stableKey(url)) { mutableStateOf(false) }
    if (failed) {
        // A page of the pager starts at its side, so the arch is put in the middle here.
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            ViewerPlaceholder(
                name = name,
                message = stringResource(R.string.profile_photos_failed),
                actionLabel = stringResource(R.string.profile_photos_retry),
                onAction = onRetry,
                extra = access,
            )
        }
        return
    }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    LaunchedEffect(shown) {
        if (!shown) {
            scale = 1f
            offset = Offset.Zero
        }
    }
    val zoom =
        if (photo.isBlurred) {
            Modifier
        } else {
            Modifier.pointerInput(photo.id) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val pinching = event.changes.count { it.pressed } > 1
                        if (pinching || scale > 1f) {
                            val next = (scale * event.calculateZoom()).coerceIn(1f, MAX_ZOOM)
                            val roomX = size.width * (next - 1f) / 2
                            val roomY = size.height * (next - 1f) / 2
                            val moved = offset + event.calculatePan()
                            scale = next
                            offset = Offset(moved.x.coerceIn(-roomX, roomX), moved.y.coerceIn(-roomY, roomY))
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            }
        }
    val description =
        if (photo.isBlurred) {
            stringResource(R.string.a11y_private_photo)
        } else {
            // "Photo of {name}" (specs/22 section 12), then where it is in the gallery.
            val position = text(R.string.profile_gallery_position, "current" to position, "total" to total)
            if (name.isNullOrBlank()) position else text(R.string.shared_photo_alt, "name" to name) + ", " + position
        }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (!loaded) LoadingArch()
        AsyncImage(
            model = rememberStableImageRequest(url),
            contentDescription = description,
            contentScale = ContentScale.Fit,
            // The veil lies on the image alone, not on the inverse room around it. It blurs nothing.
            colorFilter = if (veiled) ColorFilter.tint(KrTheme.colors.photoVeil, BlendMode.SrcAtop) else null,
            onSuccess = { loaded = true },
            onError = { onFailure() },
            modifier =
                Modifier
                    .fillMaxSize()
                    .then(zoom)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offset.x
                        translationY = offset.y
                    },
        )
    }
}

/** The arch in place of a photo that is loading, missing or failed. */
@Composable
private fun ViewerPlaceholder(
    name: String?,
    message: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    extra: @Composable () -> Unit = {},
) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier =
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(Spacing.s16),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        Box(
            modifier =
                Modifier
                    // Without a name the words are not shown, so the arch says them.
                    .clearAndSetSemantics { if (name == null) contentDescription = message }
                    .size(PlaceholderArch)
                    .clip(ArchShape)
                    .lattice(fill = colors.surfaceContainer, dots = KrTheme.colors.lattice),
            contentAlignment = Alignment.Center,
        ) {
            ArchInlay()
            if (name.isNullOrBlank()) Diamond() else Monogram(name = name, size = ViewerMonogram)
        }
        if (name != null) {
            Text(
                text = message,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (actionLabel != null && onAction != null) {
            KrButton(text = actionLabel, onClick = onAction, variant = KrButtonVariant.INVERSE)
        }
        extra()
    }
}

/** The empty arch while a photo loads, which the photo then covers. */
@Composable
private fun LoadingArch() {
    val label = stringResource(R.string.shared_list_loading)
    Box(
        Modifier
            .semantics { contentDescription = label }
            .size(PlaceholderArch)
            .clip(ArchShape)
            .lattice(fill = MaterialTheme.colorScheme.surfaceContainer, dots = KrTheme.colors.lattice),
    )
}

/** What the access overlay would offer, under a private photo that could not load. */
@Composable
private fun FailedPhotoAccess(
    access: RelationPhotoAccess,
    busy: Boolean,
    onRequest: () -> Unit,
) {
    if (access == RelationPhotoAccess.REQUESTED) {
        Text(stringResource(R.string.profile_photo_access_requested), textAlign = TextAlign.Center)
    } else if (access == RelationPhotoAccess.CAN_REQUEST) {
        KrButton(
            text = stringResource(R.string.profile_photo_access_request),
            onClick = onRequest,
            variant = KrButtonVariant.INVERSE,
            enabled = LocalOnline.current,
            loading = busy,
        )
    }
}

private val PlaceholderArch = DpSize(192.dp, 240.dp)
private val ViewerMonogram = 58.dp
private const val MAX_ZOOM = 4f
