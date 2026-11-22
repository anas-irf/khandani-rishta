package com.khandanirishta.app.ui.feature.me

import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.camera.compose.CameraXViewfinder
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.NoPhotography
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.ui.components.ButtonSpinner
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.LightSystemBarIcons
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asExecutor
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.min
import android.util.Size as CameraSize

/*
 * The in-app camera of the verification flows (specs/12 section 4.3, specs/22 section 9): CameraX
 * with the front camera for selfies and the back camera for identity cards, on an inverse screen.
 * Words are on solid bands above and below the preview, never on it. Photos are taken into memory
 * and prepared by `PhotoPreparer`; nothing is written to the gallery.
 */

/** The frame drawn over the preview: an arch for the face and the hand, or the shape of a card. */
internal enum class CameraGuide { FACE, CARD }

/**
 * The full-screen camera. [front] selects the front camera (selfies) or the back camera (cards).
 * [hint] is in the band above the preview; [gesture], when given, is drawn small beside it so the
 * member can follow it while taking the selfie. [processing] keeps the button busy while the
 * photo taken is being prepared.
 */
@Composable
internal fun CameraCapture(
    front: Boolean,
    guide: CameraGuide,
    hint: String,
    onCapture: (Bitmap) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    gesture: Gesture? = null,
    processing: Boolean = false,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val currentOnCapture by rememberUpdatedState(onCapture)
    var surfaceRequest by remember { mutableStateOf<SurfaceRequest?>(null) }
    var failed by remember { mutableStateOf(false) }
    var capturing by remember { mutableStateOf(false) }
    var captureFailed by remember { mutableStateOf(false) }
    val preview = remember { Preview.Builder().build() }
    val imageCapture =
        remember(front) {
            ImageCapture
                .Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setResolutionSelector(
                    ResolutionSelector
                        .Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(
                                if (front) SelfieTarget else CardTarget,
                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                            ),
                        ).build(),
                ).build()
        }

    LaunchedEffect(lifecycleOwner, front) {
        preview.setSurfaceProvider { request -> surfaceRequest = request }
        val provider = runCatching { ProcessCameraProvider.awaitInstance(context) }.getOrNull()
        if (provider == null) {
            failed = true
            return@LaunchedEffect
        }
        val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        val bound =
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, selector, preview, imageCapture)
            }.isSuccess
        if (!bound) {
            failed = true
            return@LaunchedEffect
        }
        try {
            awaitCancellation()
        } finally {
            provider.unbind(preview, imageCapture)
            surfaceRequest = null
        }
    }

    val capture: () -> Unit = {
        if (!capturing && !processing) {
            capturing = true
            captureFailed = false
            scope.launch {
                val bitmap = runCatching { imageCapture.takeBitmap() }.getOrNull()
                capturing = false
                if (bitmap != null) currentOnCapture(bitmap) else captureFailed = true
            }
        }
    }

    LightSystemBarIcons()
    val colors = MaterialTheme.colorScheme
    Surface(
        color = colors.inverseSurface,
        contentColor = colors.inverseOnSurface,
        modifier = modifier.fillMaxSize(),
    ) {
        InvertedFocusRing {
            Column(Modifier.fillMaxSize()) {
                // The bands are drawn after the preview, whose surface can reach past its box.
                CameraHeader(hint = hint, gesture = gesture, onClose = onClose, modifier = Modifier.zIndex(1f))
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .clipToBounds(),
                ) {
                    val request = surfaceRequest
                    when {
                        failed -> {
                            CameraUnavailable(onClose = onClose, modifier = Modifier.matchParentSize())
                        }

                        request != null -> {
                            CameraXViewfinder(
                                surfaceRequest = request,
                                modifier = Modifier.matchParentSize(),
                                contentScale = ContentScale.Crop,
                            )
                            GuideOverlay(guide = guide, modifier = Modifier.matchParentSize())
                        }

                        else -> {
                            // No preview yet, so this is still on the solid ground.
                            Text(
                                text = stringResource(R.string.verification_camera_starting),
                                style = MaterialTheme.typography.bodyLarge,
                                textAlign = TextAlign.Center,
                                modifier =
                                    Modifier
                                        .align(Alignment.Center)
                                        .semantics { liveRegion = LiveRegionMode.Polite }
                                        .padding(Spacing.s24),
                            )
                        }
                    }
                }
                if (!failed) {
                    CameraFooter(
                        ready = surfaceRequest != null,
                        busy = capturing || processing,
                        captureFailed = captureFailed,
                        onCapture = capture,
                        modifier = Modifier.zIndex(1f),
                    )
                }
            }
        }
    }
}

/** The band above the preview: close, what to do, and the gesture to copy. */
@Composable
private fun CameraHeader(
    hint: String,
    gesture: Gesture?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val insets = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
    // Long words at large text scroll here, and the preview keeps most of the screen.
    val limit = LocalWindowInfo.current.containerDpSize.height * HEADER_SHARE
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .background(colors.inverseSurface)
                .windowInsetsPadding(insets)
                .padding(start = Spacing.s4, top = Spacing.s4, end = Spacing.s16, bottom = Spacing.s12),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        KrIconButton(
            icon = Icons.Outlined.Close,
            contentDescription = stringResource(R.string.me_android_camera_close),
            onClick = onClose,
        )
        Text(
            text = hint,
            style = MaterialTheme.typography.titleSmall,
            modifier =
                Modifier
                    .weight(1f)
                    .heightIn(max = limit)
                    .verticalScroll(rememberScrollState())
                    .padding(top = Spacing.s12)
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (gesture != null) {
            Box(
                Modifier
                    .padding(top = Spacing.s4)
                    .size(Sizes.arch56)
                    .clip(ArchShape)
                    .background(colors.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                // The hint beside it says the same in words.
                GestureIllustration(gesture = gesture, decorative = true, modifier = Modifier.size(GestureMark))
            }
        }
    }
}

/** The band under the preview: what went wrong, then the capture button. */
@Composable
private fun CameraFooter(
    ready: Boolean,
    busy: Boolean,
    captureFailed: Boolean,
    onCapture: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val insets = WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.inverseSurface)
                .windowInsetsPadding(insets)
                .padding(horizontal = Spacing.gutter, vertical = Spacing.s16),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        if (captureFailed) {
            IconText(
                icon = Icons.Outlined.ErrorOutline,
                text = stringResource(R.string.me_android_camera_failed),
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        ShutterButton(enabled = ready && !busy, busy = busy, onClick = onCapture)
    }
}

/** The large round capture button. */
@Composable
private fun ShutterButton(
    enabled: Boolean,
    busy: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val label = stringResource(R.string.verification_camera_capture)
    val busyLabel = stringResource(R.string.shared_list_loading)
    Box(
        modifier
            .semantics {
                contentDescription = label
                if (busy) stateDescription = busyLabel
            }.tappable(shape = PillShape, onClick = onClick, enabled = enabled)
            .size(ShutterSize)
            .border(Strokes.focus, colors.background, PillShape)
            .padding(Spacing.s8),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .matchParentSize()
                .background(if (enabled || busy) colors.background else KrTheme.colors.inverseMuted, PillShape),
        )
        if (busy) ButtonSpinner(color = colors.primary)
    }
}

/** The camera could not start: why, and the way out. */
@Composable
private fun CameraUnavailable(
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Column(
            modifier =
                Modifier
                    // Without the capture band this reaches the bottom of the screen.
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal),
                    ).verticalScroll(rememberScrollState())
                    .padding(Spacing.s24),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.s16),
        ) {
            Icon(Icons.Outlined.NoPhotography, contentDescription = null, modifier = Modifier.size(Sizes.touch))
            Text(
                text = stringResource(R.string.me_android_camera_unavailable),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            KrButton(
                text = stringResource(R.string.me_android_camera_close),
                onClick = onClose,
                variant = KrButtonVariant.INVERSE,
            )
        }
    }
}

/** The mask around the frame, and the frame's line. */
@Composable
private fun GuideOverlay(
    guide: CameraGuide,
    modifier: Modifier = Modifier,
) {
    val mask = KrTheme.colors.cameraMask
    val line = MaterialTheme.colorScheme.background
    val shape = if (guide == CameraGuide.FACE) ArchShape else MaterialTheme.shapes.medium
    Spacer(
        modifier.drawWithCache {
            val frame =
                when (guide) {
                    CameraGuide.FACE -> {
                        val width = min(size.width * FACE_WIDTH, size.height * FACE_HEIGHT * ARCH_RATIO)
                        Size(width, width / ARCH_RATIO)
                    }

                    CameraGuide.CARD -> {
                        val width = min(size.width * CARD_WIDTH, size.height * CARD_HEIGHT * CARD_RATIO)
                        Size(width, width / CARD_RATIO)
                    }
                }
            val corner = Offset((size.width - frame.width) / 2f, (size.height - frame.height) / 2f)
            val outline = shape.createOutline(frame, layoutDirection, this)
            val around =
                Path().apply {
                    fillType = PathFillType.EvenOdd
                    addRect(Rect(Offset.Zero, size))
                    addPath(Path().apply { addOutline(outline) }, corner)
                }
            val stroke = Stroke(Strokes.focus.toPx())
            onDrawBehind {
                drawPath(around, mask)
                translate(corner.x, corner.y) { drawOutline(outline, line, style = stroke) }
            }
        },
    )
}

/** Takes one photo and returns it upright (the rotation is applied, the image is not mirrored). */
private suspend fun ImageCapture.takeBitmap(): Bitmap =
    suspendCancellableCoroutine { continuation ->
        takePicture(
            Dispatchers.Default.asExecutor(),
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val result = runCatching { image.toUprightBitmap() }
                    image.close()
                    result.fold(
                        onSuccess = { continuation.resume(it) },
                        onFailure = { continuation.resumeWithException(it) },
                    )
                }

                override fun onError(exception: ImageCaptureException) {
                    continuation.resumeWithException(exception)
                }
            },
        )
    }

private fun ImageProxy.toUprightBitmap(): Bitmap {
    val bitmap = toBitmap()
    val rotation = imageInfo.rotationDegrees
    if (rotation == 0) return bitmap
    val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
}

/** Capture sizes: enough for a readable card after scaling to 2,048 pixels, less for a selfie. */
private val SelfieTarget = CameraSize(1920, 1440)
private val CardTarget = CameraSize(2560, 1920)

private val ShutterSize = 76.dp
private val GestureMark = 48.dp
private const val HEADER_SHARE = 0.3f
private const val FACE_WIDTH = 0.86f
private const val FACE_HEIGHT = 0.92f
private const val CARD_WIDTH = 0.9f
private const val CARD_HEIGHT = 0.8f

/** The width of an ID-1 card for its height. */
private const val CARD_RATIO = 1.586f
