package com.khandanirishta.app.ui.feature.me

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NoPhotography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.theme.Spacing

internal enum class CameraPermission {
    GRANTED,

    /** Not asked yet, so the explanation shows. */
    UNASKED,

    DENIED,
}

/** Whether the camera may open, and the control that opens it or asks for it. */
@Immutable
internal class CameraAccess(
    val permission: CameraPermission,
    val request: () -> Unit,
)

/**
 * The camera permission of specs/22 section 9: an explanation first, then the system request.
 * The member may also allow the camera in the settings and come back.
 */
@Composable
internal fun rememberCameraAccess(onOpen: () -> Unit): CameraAccess {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(hasCameraPermission(context)) }
    var denied by rememberSaveable { mutableStateOf(false) }
    val currentOnOpen by rememberUpdatedState(onOpen)
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
            granted = ok
            denied = !ok
            if (ok) currentOnOpen()
        }
    LifecycleResumeEffect(Unit) {
        granted = hasCameraPermission(context)
        if (granted) denied = false
        onPauseOrDispose { }
    }
    val permission =
        when {
            granted -> CameraPermission.GRANTED
            denied -> CameraPermission.DENIED
            else -> CameraPermission.UNASKED
        }
    return remember(permission, launcher) {
        CameraAccess(
            permission = permission,
            request = {
                if (permission == CameraPermission.GRANTED) {
                    currentOnOpen()
                } else {
                    launcher.launch(Manifest.permission.CAMERA)
                }
            },
        )
    }
}

/** Above the button: why the camera opens, or the refusal of 12 section 8.4 with the way to allow it. */
@Composable
internal fun CameraNote(
    access: CameraAccess,
    modifier: Modifier = Modifier,
) {
    if (access.permission != CameraPermission.UNASKED) return
    CaptionText(
        text = stringResource(R.string.me_android_camera_explain),
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * A refusal, for the bar over the button that was just pressed: the body of a step can end out of
 * view, and after a lasting refusal Android shows no question at all.
 */
internal fun cameraRefusal(access: CameraAccess): (@Composable () -> Unit)? =
    if (access.permission == CameraPermission.DENIED) ({ CameraRefused(access) }) else null

@Composable
private fun CameraRefused(access: CameraAccess) {
    val links = rememberLinkOpener()
    StatusBanner(
        text = stringResource(R.string.verification_camera_denied),
        tone = StatusTone.WARNING,
        icon = Icons.Outlined.NoPhotography,
        announce = true,
    ) {
        FlowRow(
            modifier = Modifier.padding(top = Spacing.s8),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            KrButton(
                text = stringResource(R.string.camera_permission_settings),
                onClick = { links.appSettings() },
                variant = KrButtonVariant.SECONDARY,
            )
            KrButton(
                text = stringResource(R.string.verification_camera_try_again),
                onClick = access.request,
                variant = KrButtonVariant.QUIET,
            )
        }
    }
}

private fun hasCameraPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
