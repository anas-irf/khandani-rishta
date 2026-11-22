package com.khandanirishta.app.ui.feature.me

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * `ME-VERIFY-SELFIE` (specs/16 section 6.22, specs/12 sections 4 and 8.4): a live selfie with the
 * day's gesture so a moderator can confirm that the profile photos show the candidate. Explain,
 * show the gesture, the front camera (CameraX, no gallery), review, upload and submit with one
 * progress, done; with the camera permission and every error case of 6.22.
 */
@Composable
fun VerifySelfieScreen() {
    VerifySelfieRoute()
}

@Composable
private fun VerifySelfieRoute(viewModel: VerifySelfieViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val me = LocalMe.current
    val navigator = LocalNavigator.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            if (event == VerifyEvent.ReturnToCentre) navigator.returnTo(Verification)
        }
    }
    val closed = me?.profile?.status == ProfileStatus.CLOSED
    // 12 section 4.1: a selfie needs an approved photo; only an approved photo is the main one.
    val noPhoto = state.noPhoto || me?.profile?.photo == null
    val inFlow = state.step != SelfieStep.EXPLAIN && state.step != SelfieStep.DONE
    BackHandler(enabled = inFlow && !closed && !noPhoto) { viewModel.back() }
    val access = rememberCameraAccess(onOpen = viewModel::openCamera)
    val actions =
        remember(viewModel, navigator) {
            SelfieActions(
                reopen = { navigator.push(AccountSettings) },
                addPhoto = {
                    viewModel.clearNoPhoto()
                    navigator.push(MyPhotos)
                },
                toGesture = viewModel::toGesture,
                retryChallenge = viewModel::loadChallenge,
                use = viewModel::usePhoto,
                retake = viewModel::retake,
                submit = viewModel::submit,
                done = { navigator.returnTo(Verification) },
            )
        }

    val gesture = state.gesture
    if (state.step == SelfieStep.CAMERA && !closed && !noPhoto) {
        CameraCapture(
            front = true,
            guide = CameraGuide.FACE,
            hint = selfieHint(gesture),
            gesture = gesture,
            processing = state.preparing,
            onCapture = viewModel::onCaptured,
            onClose = { viewModel.back() },
        )
        return
    }
    SelfieFlow(
        state = state,
        closed = closed,
        noPhoto = noPhoto,
        access = access,
        actions = actions,
        onBack = { if (closed || noPhoto || !viewModel.back()) navigator.back() },
    )
}

/** What the steps of the selfie flow can do. */
@Immutable
internal class SelfieActions(
    val reopen: () -> Unit,
    val addPhoto: () -> Unit,
    val toGesture: () -> Unit,
    val retryChallenge: () -> Unit,
    val use: () -> Unit,
    val retake: () -> Unit,
    val submit: () -> Unit,
    val done: () -> Unit,
)

/** The flow outside the camera, without its view model and navigation. */
@Composable
internal fun SelfieFlow(
    state: SelfieUiState,
    closed: Boolean,
    noPhoto: Boolean,
    access: CameraAccess,
    actions: SelfieActions,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Every step starts at its top.
    val scroll = rememberSaveable(state.step, saver = ScrollState.Saver) { ScrollState(0) }
    MeScaffold(
        title = stringResource(R.string.verification_selfie_title),
        onBack = onBack,
        modifier = modifier,
        scrollState = scroll,
        bottomBar = {
            when {
                closed -> ReopenBar(onReopen = actions.reopen)
                noPhoto -> AddPhotoBar(onAddPhoto = actions.addPhoto)
                else -> SelfieBar(state = state, access = access, actions = actions)
            }
        },
    ) {
        Band(maxWidth = Sizes.formWidth, spacing = Spacing.gutter) {
            when {
                closed -> {
                    ClosedMessage()
                }

                noPhoto -> {
                    FlowMessage(
                        icon = Icons.Outlined.AddAPhoto,
                        message = stringResource(R.string.verification_selfie_no_photo),
                    )
                }

                else -> {
                    SelfieStepBody(state = state, access = access, actions = actions)
                }
            }
        }
    }
}

@Composable
private fun AddPhotoBar(onAddPhoto: () -> Unit) {
    FlowBar {
        KrButton(
            text = stringResource(R.string.verification_selfie_add_photo),
            onClick = onAddPhoto,
            icon = Icons.Outlined.AddAPhoto,
            fullWidth = true,
        )
    }
}

@Composable
private fun SelfieStepBody(
    state: SelfieUiState,
    access: CameraAccess,
    actions: SelfieActions,
) {
    when (state.step) {
        SelfieStep.EXPLAIN -> {
            SelfieExplanation()
        }

        SelfieStep.GESTURE, SelfieStep.CAMERA -> {
            GestureStep(
                gesture = state.gesture,
                error = state.challengeError,
                notice = state.notice,
                failure = state.error,
                intro = null,
                access = access,
                onRetry = actions.retryChallenge,
            )
        }

        SelfieStep.REVIEW -> {
            state.photo?.let { CapturedImage(it) }
        }

        SelfieStep.SUBMIT -> {
            SelfieToSend(state)
        }

        SelfieStep.DONE -> {
            SentMessage(stringResource(R.string.verification_selfie_success))
        }
    }
}

/** Step 1: what the selfie is for and, for a managed profile, whose it must be. */
@Composable
private fun SelfieExplanation() {
    val candidate = rememberCandidate()
    val body =
        if (candidate.managed) {
            text(R.string.verification_selfie_body, "name" to candidate.name)
        } else {
            stringResource(R.string.verification_selfie_body_self)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.gutter)) {
        StepPanel {
            ArchIcon(Icons.Outlined.Face, size = Sizes.archIconLarge, tone = ArchTone.PRIMARY)
            Text(body, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
        }
        if (candidate.managed) {
            StatusBanner(text = text(R.string.verification_selfie_managed, "name" to candidate.name))
        }
    }
}

/** Step 5: the selfie and the gesture once more. */
@Composable
private fun SelfieToSend(state: SelfieUiState) {
    val photo = state.photo ?: return
    StepPanel {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s16, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(Spacing.s16),
        ) {
            Box(
                Modifier
                    .size(SentImage)
                    .clip(MaterialTheme.shapes.medium)
                    .background(KrTheme.tonal),
            ) {
                AsyncImage(
                    model = photo.file,
                    contentDescription = stringResource(R.string.verification_review_alt),
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.matchParentSize(),
                )
            }
            state.gesture?.let { GestureArch(gesture = it, size = SentImage) }
        }
    }
}

@Composable
private fun SelfieBar(
    state: SelfieUiState,
    access: CameraAccess,
    actions: SelfieActions,
) {
    when (state.step) {
        SelfieStep.EXPLAIN -> {
            FlowBar {
                KrButton(
                    text = stringResource(R.string.verification_selfie_continue),
                    onClick = actions.toGesture,
                    fullWidth = true,
                )
            }
        }

        SelfieStep.GESTURE, SelfieStep.CAMERA -> {
            if (state.gesture != null) {
                FlowBar(banner = cameraRefusal(access)) {
                    KrButton(
                        text = stringResource(R.string.verification_camera_open),
                        onClick = access.request,
                        icon = Icons.Outlined.PhotoCamera,
                        fullWidth = true,
                    )
                }
            }
        }

        SelfieStep.REVIEW -> {
            if (state.photo != null) {
                FlowBar { RetakeOrContinue(onRetake = actions.retake, onContinue = actions.use) }
            }
        }

        SelfieStep.SUBMIT -> {
            if (state.photo != null) SelfieSubmitBar(state = state, actions = actions)
        }

        SelfieStep.DONE -> {
            FlowBar {
                KrButton(
                    text = stringResource(R.string.verification_selfie_done),
                    onClick = actions.done,
                    fullWidth = true,
                )
            }
        }
    }
}

/** "Submit selfie" with one progress for the calls, or the failure with "Try again". */
@Composable
private fun SelfieSubmitBar(
    state: SelfieUiState,
    actions: SelfieActions,
) {
    val failure = state.error
    val progress = state.progress
    val sending = stringResource(R.string.verification_selfie_progress)
    val status: (@Composable () -> Unit)? =
        if (failure == null && progress == null) {
            null
        } else {
            {
                SendStatus(
                    failure = failure?.let { stringResource(it) },
                    progressText = if (progress == null) null else sending,
                    progressLabel = sending,
                    progress = { progress ?: 0f },
                )
            }
        }
    FlowBar(banner = status) {
        RetakeOrContinue(
            onRetake = actions.retake,
            onContinue = actions.submit,
            continueLabel =
                stringResource(
                    if (failure == null) {
                        R.string.verification_selfie_submit
                    } else {
                        R.string.verification_camera_try_again
                    },
                ),
            enabled = LocalOnline.current,
            busy = progress != null,
        )
    }
}

/** The band over the selfie camera: the gesture's instruction. */
@Composable
internal fun selfieHint(gesture: Gesture?): String {
    val instruction = gesture?.let(::gestureInstruction)
    return stringResource(instruction ?: R.string.me_android_camera_face_hint)
}

private val SentImage = DpSize(132.dp, 165.dp)
