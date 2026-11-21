package com.khandanirishta.app.ui.feature.me

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.NoPhotography
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.ui.rememberLinkOpener
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
 * with the front camera for selfies and the back camera for identity cards, full screen on black
 * with a framed guide and a large capture button. Photos are taken into memory and prepared by
 * `PhotoPreparer`; nothing is written to the gallery.
 */

/** The frame drawn over the preview: an oval for a face, a card shape for a document. */
internal enum class CameraGuide { FACE, CARD }

/**
 * The full-screen camera. [front] selects the front camera (selfies) or the back camera (cards).
 * [hint] is shown under the top bar; [gesture], when given, is drawn small in the corner so the
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

    Box(
        modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        val request = surfaceRequest
        if (request != null) {
            CameraXViewfinder(
                surfaceRequest = request,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else if (!failed) {
            Column(
                Modifier.align(Alignment.Center),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator(color = Color.White)
                Text(stringResource(R.string.verification_camera_starting), color = Color.White)
            }
        }
        if (failed) {
            Column(
                Modifier
                    .align(Alignment.Center)
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Icon(
                    Icons.Outlined.NoPhotography,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(48.dp),
                )
                Text(
                    stringResource(R.string.me_android_camera_unavailable),
                    color = Color.White,
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                )
                OutlinedButton(onClick = onClose) {
                    Text(stringResource(R.string.me_android_camera_close), color = Color.White)
                }
            }
        } else {
            GuideOverlay(guide = guide, modifier = Modifier.fillMaxSize())
        }

        Column(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 8.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                IconButton(onClick = onClose) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = stringResource(R.string.me_android_camera_close),
                        tint = Color.White,
                    )
                }
                Spacer(Modifier.weight(1f))
                if (gesture != null) {
                    Box(
                        Modifier
                            .size(76.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.92f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        GestureIllustration(gesture = gesture, modifier = Modifier.size(58.dp))
                    }
                }
            }
            Text(
                hint,
                color = Color.White,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 8.dp),
            )
        }

        if (!failed) {
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (captureFailed) {
                    Text(
                        stringResource(R.string.me_android_camera_failed),
                        color = Color.White,
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 24.dp),
                    )
                }
                ShutterButton(
                    enabled = request != null && !capturing && !processing,
                    busy = capturing || processing,
                    onClick = capture,
                )
            }
        }
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
    val label = stringResource(R.string.verification_camera_capture)
    Box(
        modifier
            .size(80.dp)
            .clip(CircleShape)
            .border(4.dp, Color.White, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(64.dp)
                .clip(CircleShape)
                .background(if (enabled) Color.White else Color.White.copy(alpha = 0.5f)),
            contentAlignment = Alignment.Center,
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    color = MaterialTheme.colorScheme.primary,
                    strokeWidth = 3.dp,
                )
            }
        }
    }
}

/** The darkened surroundings and the white outline of the guide. */
@Composable
private fun GuideOverlay(
    guide: CameraGuide,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier) {
        val centerY = size.height * GUIDE_CENTER
        val hole =
            when (guide) {
                CameraGuide.FACE -> {
                    val width = min(size.width * 0.72f, size.height * 0.6f / FACE_RATIO)
                    val height = width * FACE_RATIO
                    Rect(Offset((size.width - width) / 2f, centerY - height / 2f), Size(width, height))
                }

                CameraGuide.CARD -> {
                    val width = min(size.width * 0.88f, size.height * 0.5f * CARD_RATIO)
                    val height = width / CARD_RATIO
                    Rect(Offset((size.width - width) / 2f, centerY - height / 2f), Size(width, height))
                }
            }
        val radius = 18.dp.toPx()
        val scrim =
            Path().apply {
                fillType = PathFillType.EvenOdd
                addRect(Rect(Offset.Zero, size))
                when (guide) {
                    CameraGuide.FACE -> addOval(hole)
                    CameraGuide.CARD -> addRoundRect(RoundRect(hole, radius, radius))
                }
            }
        drawPath(scrim, Color.Black.copy(alpha = 0.55f))
        val outline = Stroke(width = 3.dp.toPx())
        when (guide) {
            CameraGuide.FACE -> {
                drawOval(Color.White, topLeft = hole.topLeft, size = hole.size, style = outline)
            }

            CameraGuide.CARD -> {
                drawRoundRect(
                    Color.White,
                    topLeft = hole.topLeft,
                    size = hole.size,
                    cornerRadius = CornerRadius(radius),
                    style = outline,
                )
            }
        }
    }
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

/**
 * The button that opens the camera, with the permission of specs/22 section 9: an explanation
 * first, then the system request; when refused, the text of 12 section 8.4 with a button to the
 * app settings and "Try again".
 */
@Composable
internal fun CameraButton(
    text: String,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Outlined.PhotoCamera,
    secondary: Boolean = false,
) {
    val context = LocalContext.current
    val links = rememberLinkOpener()
    var granted by remember { mutableStateOf(hasCameraPermission(context)) }
    var denied by rememberSaveable { mutableStateOf(false) }
    val currentOnOpen by rememberUpdatedState(onOpen)
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
            granted = ok
            denied = !ok
            if (ok) currentOnOpen()
        }
    // The member may allow the camera in the settings and come back.
    LifecycleResumeEffect(Unit) {
        granted = hasCameraPermission(context)
        if (granted) denied = false
        onPauseOrDispose { }
    }
    val request: () -> Unit = {
        if (granted) currentOnOpen() else launcher.launch(Manifest.permission.CAMERA)
    }
    Column(
        modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (denied && !granted) {
            MeNotice(
                text = stringResource(R.string.verification_camera_denied),
                tone = MeNoticeTone.WARNING,
                icon = Icons.Outlined.NoPhotography,
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(onClick = { links.appSettings() }) {
                        Text(stringResource(R.string.camera_permission_settings))
                    }
                    TextButton(onClick = request) { Text(stringResource(R.string.verification_camera_try_again)) }
                }
            }
        }
        if (secondary) {
            MeSecondaryButton(text = text, onClick = request, icon = icon)
        } else {
            MePrimaryButton(text = text, onClick = request, icon = icon)
        }
        if (!granted && !denied) {
            Text(
                stringResource(R.string.me_android_camera_explain),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private fun hasCameraPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

/** Capture sizes: enough for a readable card after scaling to 2,048 pixels, less for a selfie. */
private val SelfieTarget = CameraSize(1920, 1440)
private val CardTarget = CameraSize(2560, 1920)

/** Height of the face oval for its width, and the width of an ID-1 card for its height. */
private const val FACE_RATIO = 1.3f
private const val CARD_RATIO = 1.586f
private const val GUIDE_CENTER = 0.46f
