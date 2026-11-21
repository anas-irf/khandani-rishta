package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.SubcomposeAsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.LockedGroup
import com.khandanirishta.app.core.network.generated.model.PhotoView
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.PhotoPlaceholder
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.text.text
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PhotoViewerState(
    val detail: ProfileDetail? = null,
    val error: ApiError? = null,
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
                discovery
                    .profile(profileId)
                    .onSuccess {
                        cache.put(it)
                        mutableState.value = PhotoViewerState(detail = it)
                    }.onFailure { mutableState.value = mutableState.value.copy(error = it.apiError) }
            }
        }

        /** "Try again" on a photo that failed: refetch the profile once. */
        fun retryOnce() {
            if (retried) return
            retried = true
            reload()
        }

        fun requestPhotos() {
            viewModelScope.launch {
                relations
                    .requestPhotos(profileId)
                    .onSuccess {
                        bus.toast(R.string.shared_photo_access_sent)
                        reload()
                    }.onFailure { bus.error(it.apiError) }
            }
        }
    }

/** APP-PHOTOS: one photo at a time on a dark background, swipe and pinch to zoom (16 section 6.8). */
@Composable
fun PhotoViewerScreen(
    profileId: String,
    index: Int,
    modifier: Modifier = Modifier,
) {
    val viewModel = hiltViewModel<PhotoViewerViewModel, PhotoViewerViewModel.Factory> { it.create(profileId) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    Box(
        modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        val detail = state.detail
        when {
            detail != null -> {
                Viewer(detail, index, onRetry = viewModel::retryOnce, onRequest = viewModel::requestPhotos)
            }

            state.error != null -> {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.background),
                ) {
                    ErrorState(
                        error = state.error,
                        onRetry = viewModel::reload,
                        modifier = Modifier.align(Alignment.Center),
                    )
                }
            }

            else -> {
                CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
            }
        }
        IconButton(
            onClick = { navigator.back() },
            modifier =
                Modifier
                    .statusBarsPadding()
                    .padding(8.dp)
                    .align(Alignment.TopEnd),
        ) {
            Icon(
                Icons.Filled.Close,
                contentDescription = stringResource(R.string.profile_photos_close),
                tint = Color.White,
            )
        }
    }
}

@Composable
private fun Viewer(
    detail: ProfileDetail,
    index: Int,
    onRetry: () -> Unit,
    onRequest: () -> Unit,
) {
    val photos = detail.photos
    if (photos.isEmpty()) {
        PhotoPlaceholder(gender = detail.card.gender, modifier = Modifier.fillMaxSize())
        return
    }
    val pager = rememberPagerState(initialPage = index.coerceIn(0, photos.lastIndex)) { photos.size }
    Box(Modifier.fillMaxSize()) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            ZoomablePhoto(photo = photos[page], zoomable = !photos[page].isBlurred, onRetry = onRetry)
        }
        Column(
            Modifier
                .fillMaxSize()
                .navigationBarsPadding()
                .padding(bottom = 24.dp),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Bottom,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (photos[pager.currentPage].isBlurred && LockedGroup.PHOTOS in detail.locked) {
                PhotoAccessOverlay(
                    access = detail.relation.photoAccess,
                    name = detail.card.displayName,
                    onRequest = onRequest,
                )
            }
            if (photos.size > 1) {
                Surface(color = Color.White.copy(alpha = 0.15f), contentColor = Color.White, shape = CircleShape) {
                    Text(
                        text(
                            R.string.profile_photos_position,
                            "current" to pager.currentPage + 1,
                            "total" to photos.size,
                        ),
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }
}

/** A photo with pinch to zoom on clear photos only; no save, share or download control exists. */
@Composable
private fun ZoomablePhoto(
    photo: PhotoView,
    zoomable: Boolean,
    onRetry: () -> Unit,
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val request = rememberStableImageRequest(photo.largeUrl ?: photo.mediumUrl)
    SubcomposeAsyncImage(
        model = request,
        contentDescription = null,
        contentScale = ContentScale.Fit,
        loading = {
            Box(
                Modifier.fillMaxSize(),
            ) { CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White) }
        },
        error = {
            Column(
                Modifier.fillMaxSize(),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.profile_photos_failed), color = Color.White)
                Button(onClick = onRetry, modifier = Modifier.padding(top = 12.dp)) {
                    Text(stringResource(R.string.profile_photos_retry))
                }
            }
        },
        modifier =
            Modifier
                .fillMaxSize()
                .then(
                    if (zoomable) {
                        Modifier.pointerInput(Unit) {
                            detectTransformGestures { _, pan, zoom, _ ->
                                scale = (scale * zoom).coerceIn(1f, MAX_ZOOM)
                                offset = if (scale == 1f) Offset.Zero else offset + pan
                            }
                        }
                    } else {
                        Modifier
                    },
                ).graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                },
    )
}

private const val MAX_ZOOM = 4f
