package com.khandanirishta.app.ui.feature.me

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Schedule
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.media.PreparedPhoto
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.UploadSlot
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * `ME-VERIFY-ID` (specs/16 section 6.23, specs/12 sections 3, 5 and 8.2): the identity number when
 * it is missing or [changeNumber] was chosen, photos of the card (front, then back unless it is a
 * passport) with the back camera or the Photo Picker, a live selfie with the day's gesture, three
 * upload rounds with one progress, and the request.
 */
@Composable
fun VerifyIdentityScreen(changeNumber: Boolean) {
    VerifyIdentityRoute(changeNumber = changeNumber)
}

@Composable
private fun VerifyIdentityRoute(
    changeNumber: Boolean,
    viewModel: VerifyIdentityViewModel =
        hiltViewModel<VerifyIdentityViewModel, VerifyIdentityViewModel.Factory> { factory ->
            factory.create(changeNumber)
        },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val me = LocalMe.current
    val navigator = LocalNavigator.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            if (event == VerifyEvent.ReturnToCentre) navigator.returnTo(Verification)
        }
    }
    val pickCard =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) viewModel.onCardPicked(uri)
        }
    val closed = me?.profile?.status == ProfileStatus.CLOSED
    val active = !closed && !state.loading && state.error == null && state.blocked == null
    val canGoBack =
        active &&
            when (state.step) {
                IdStep.NUMBER, IdStep.DONE -> false
                IdStep.FRONT -> state.cardCamera || state.candidate != null
                else -> true
            }
    BackHandler(enabled = canGoBack) { viewModel.back() }
    val cardAccess = rememberCameraAccess(onOpen = viewModel::openCardCamera)
    val selfieAccess = rememberCameraAccess(onOpen = viewModel::openSelfieCamera)
    val actions =
        remember(viewModel, navigator, pickCard) {
            IdentityActions(
                reopen = { navigator.push(AccountSettings) },
                toCentre = { navigator.returnTo(Verification) },
                retry = viewModel::load,
                chooseCard = { pickCard.launch(PickVisualMediaRequest(mediaType = ImageOnly)) },
                useCard = viewModel::useCard,
                retakeCard = viewModel::retakeCard,
                retryChallenge = viewModel::retryChallenge,
                useSelfie = viewModel::useSelfie,
                retakeSelfie = viewModel::retakeSelfie,
                submit = viewModel::submit,
            )
        }

    val gesture = state.gesture
    if (active && (state.step == IdStep.FRONT || state.step == IdStep.BACK) && state.cardCamera) {
        CameraCapture(
            front = false,
            guide = CameraGuide.CARD,
            hint = stringResource(R.string.me_android_camera_card_hint),
            processing = state.preparing,
            onCapture = viewModel::onCardCaptured,
            onClose = viewModel::closeCardCamera,
        )
        return
    }
    if (active && state.step == IdStep.CAMERA) {
        CameraCapture(
            front = true,
            guide = CameraGuide.FACE,
            hint = selfieHint(gesture),
            gesture = gesture,
            processing = state.preparing,
            onCapture = viewModel::onSelfieCaptured,
            onClose = { viewModel.back() },
        )
        return
    }

    IdentityFlow(
        state = state,
        closed = closed,
        cardAccess = cardAccess,
        selfieAccess = selfieAccess,
        actions = actions,
        onBack = { if (!active || !viewModel.back()) navigator.back() },
    ) {
        IdentityNumberFormContent(
            submitLabel = stringResource(R.string.verification_selfie_continue),
            onSave = viewModel::onNumberSaved,
            startEditing = true,
            showManagedNote = false,
        )
    }
}

/** What the steps of the identity flow can do. */
@Immutable
internal class IdentityActions(
    val reopen: () -> Unit,
    val toCentre: () -> Unit,
    val retry: () -> Unit,
    val chooseCard: () -> Unit,
    val useCard: () -> Unit,
    val retakeCard: () -> Unit,
    val retryChallenge: () -> Unit,
    val useSelfie: () -> Unit,
    val retakeSelfie: () -> Unit,
    val submit: () -> Unit,
)

/** The flow outside the camera. [numberForm] is step 1, the form it shares with onboarding. */
@Composable
internal fun IdentityFlow(
    state: IdentityUiState,
    closed: Boolean,
    cardAccess: CameraAccess,
    selfieAccess: CameraAccess,
    actions: IdentityActions,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    numberForm: @Composable () -> Unit,
) {
    // Every step starts at its top.
    val scroll = rememberSaveable(state.step, saver = ScrollState.Saver) { ScrollState(0) }
    val ready = !closed && state.error == null && !state.loading
    val inSteps = ready && state.blocked == null
    MeScaffold(
        title = stringResource(R.string.verification_identity_title),
        onBack = onBack,
        modifier = modifier,
        scrollState = scroll,
        bottomBar = {
            when {
                closed -> ReopenBar(onReopen = actions.reopen)
                ready && state.blocked != null -> BackToCentreBar(onBack = actions.toCentre)
                inSteps -> IdentityBar(state, cardAccess, selfieAccess, actions)
            }
        },
    ) {
        if (inSteps && state.step != IdStep.DONE) {
            Band(tone = BandTone.SAND, padding = BandDefaults.compactPadding, maxWidth = Sizes.formWidth) {
                StepIndicator(step = state.step)
            }
        }
        Band(maxWidth = Sizes.formWidth, spacing = Spacing.gutter) {
            when {
                closed -> {
                    ClosedMessage()
                }

                state.error != null -> {
                    ErrorState(error = state.error, onRetry = actions.retry)
                }

                state.loading -> {
                    FormSkeleton(fields = NUMBER_FIELDS)
                }

                state.blocked == IdBlock.VERIFIED -> {
                    FlowMessage(
                        icon = Icons.Outlined.Check,
                        message = stringResource(R.string.verification_identity_verified),
                        tone = ArchTone.SOLID,
                    )
                }

                state.blocked == IdBlock.PENDING -> {
                    FlowMessage(
                        icon = Icons.Outlined.Schedule,
                        message = stringResource(R.string.verification_identity_pending),
                        tone = ArchTone.WARNING,
                    )
                }

                else -> {
                    IdentityStepBody(state, cardAccess, selfieAccess, actions, numberForm)
                }
            }
        }
    }
}

/** "Step n of 3" and the step's heading (12 section 8.2), with three segments. */
@Composable
private fun StepIndicator(step: IdStep) {
    val index =
        when (step) {
            IdStep.NUMBER -> 0
            IdStep.FRONT, IdStep.BACK -> 1
            else -> 2
        }
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            StepHeadings.indices.forEach { position ->
                Box(
                    Modifier
                        .weight(1f)
                        .height(SegmentHeight)
                        .background(if (position <= index) colors.primary else colors.outlineVariant, PillShape),
                )
            }
        }
        CaptionText(text(R.string.me_android_step_of, "current" to index + 1, "total" to StepHeadings.size))
        Text(
            text = stringResource(StepHeadings[index]),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
    }
}

@Composable
private fun IdentityStepBody(
    state: IdentityUiState,
    cardAccess: CameraAccess,
    selfieAccess: CameraAccess,
    actions: IdentityActions,
    numberForm: @Composable () -> Unit,
) {
    val candidate = rememberCandidate()
    when (state.step) {
        IdStep.NUMBER -> {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.gutter)) {
                if (candidate.managed) {
                    StatusBanner(text = text(R.string.verification_identity_managed_note, "name" to candidate.name))
                }
                numberForm()
            }
        }

        IdStep.FRONT, IdStep.BACK -> {
            CardStep(state = state, access = cardAccess, onChoose = actions.chooseCard)
        }

        IdStep.GESTURE, IdStep.CAMERA -> {
            val instruction = state.gesture
                ?.let(::gestureInstruction)
                ?.let { stringResource(it) }
                .orEmpty()
            val intro =
                if (candidate.managed) {
                    text(
                        R.string.verification_identity_selfie_body,
                        "name" to candidate.name,
                        "gesture" to instruction,
                    )
                } else {
                    text(R.string.verification_identity_selfie_body_self, "gesture" to instruction)
                }
            GestureStep(
                gesture = state.gesture,
                error = state.challengeError,
                notice = state.notice,
                failure = state.stepError,
                intro = intro,
                access = selfieAccess,
                onRetry = actions.retryChallenge,
            )
        }

        IdStep.REVIEW -> {
            state.selfie?.let { CapturedImage(it) }
        }

        IdStep.SUBMIT -> {
            PhotosToSend(state)
        }

        IdStep.DONE -> {
            SentMessage(stringResource(R.string.verification_identity_success))
        }
    }
}

/** Step 2: one photo of the card with the back camera or the Photo Picker, then its review. */
@Composable
private fun CardStep(
    state: IdentityUiState,
    access: CameraAccess,
    onChoose: () -> Unit,
) {
    val reference = LocalReference.current
    val back = state.step == IdStep.BACK
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.gutter)) {
        state.identity?.let { identity ->
            Text(
                text =
                    text(
                        R.string.verification_identity_number_on_file,
                        "type" to reference.option(Lists.DOCUMENT_TYPE, identity.documentType),
                        "number" to identity.numberMasked,
                    ),
                style = MaterialTheme.typography.bodySmall.merge(KrType.numbers),
                color = colors.onSurfaceVariant,
            )
        }
        StatusBanner(text = stringResource(R.string.verification_identity_tips))
        Text(
            text =
                stringResource(
                    when {
                        back -> R.string.verification_identity_back
                        state.passport -> R.string.verification_identity_front_passport
                        else -> R.string.verification_identity_front
                    },
                ),
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.semantics { heading() },
        )
        val candidate = state.candidate
        when {
            candidate != null -> {
                CapturedImage(candidate)
            }

            state.preparing -> {
                LoadingRegion(Modifier.fillMaxWidth()) {
                    SkeletonBox(Modifier.fillMaxWidth().aspectRatio(CARD_RATIO), shape = MaterialTheme.shapes.large)
                }
            }

            else -> {
                state.stepError?.let {
                    StatusBanner(text = stringResource(it), tone = StatusTone.DANGER, announce = true)
                }
                StepPanel {
                    ArchIcon(Icons.Outlined.CreditCard, size = Sizes.archIconLarge)
                    Text(
                        text =
                            stringResource(
                                when {
                                    back -> R.string.verification_identity_choose_back
                                    state.passport -> R.string.verification_identity_choose_passport
                                    else -> R.string.verification_identity_choose_front
                                },
                            ),
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                    )
                    KrButton(
                        text = stringResource(R.string.me_android_card_gallery),
                        onClick = onChoose,
                        variant = KrButtonVariant.SECONDARY,
                        size = KrButtonSize.LARGE,
                        icon = Icons.Outlined.PhotoLibrary,
                        fullWidth = true,
                    )
                }
                CameraNote(access)
            }
        }
    }
}

/** Step 4: the photos once more. */
@Composable
private fun PhotosToSend(state: IdentityUiState) {
    StepPanel {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            state.slots.forEach { slot ->
                slotImage(state, slot)?.let { photo ->
                    Box(
                        Modifier
                            .size(SentPhoto)
                            .clip(MaterialTheme.shapes.medium)
                            .background(KrTheme.tonal),
                    ) {
                        AsyncImage(
                            model = photo.file,
                            contentDescription = null,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.matchParentSize(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BackToCentreBar(onBack: () -> Unit) {
    FlowBar {
        KrButton(
            text = stringResource(R.string.verification_identity_back_to_centre),
            onClick = onBack,
            variant = KrButtonVariant.SECONDARY,
            size = KrButtonSize.LARGE,
            fullWidth = true,
        )
    }
}

@Composable
private fun IdentityBar(
    state: IdentityUiState,
    cardAccess: CameraAccess,
    selfieAccess: CameraAccess,
    actions: IdentityActions,
) {
    when (state.step) {
        // The form has its own button, as in onboarding.
        IdStep.NUMBER -> {}

        IdStep.FRONT, IdStep.BACK -> {
            FlowBar(banner = if (state.candidate == null) cameraRefusal(cardAccess) else null) {
                if (state.candidate != null) {
                    RetakeOrContinue(onRetake = actions.retakeCard, onContinue = actions.useCard)
                } else {
                    KrButton(
                        text = stringResource(R.string.me_android_card_camera),
                        onClick = cardAccess.request,
                        icon = Icons.Outlined.PhotoCamera,
                        loading = state.preparing,
                        fullWidth = true,
                    )
                }
            }
        }

        IdStep.GESTURE, IdStep.CAMERA -> {
            if (state.gesture != null) {
                FlowBar(banner = cameraRefusal(selfieAccess)) {
                    KrButton(
                        text = stringResource(R.string.verification_camera_open),
                        onClick = selfieAccess.request,
                        icon = Icons.Outlined.PhotoCamera,
                        fullWidth = true,
                    )
                }
            }
        }

        IdStep.REVIEW -> {
            if (state.selfie != null) {
                FlowBar { RetakeOrContinue(onRetake = actions.retakeSelfie, onContinue = actions.useSelfie) }
            }
        }

        IdStep.SUBMIT -> {
            IdentitySubmitBar(state = state, onSubmit = actions.submit)
        }

        IdStep.DONE -> {
            FlowBar {
                KrButton(
                    text = stringResource(R.string.verification_identity_done),
                    onClick = actions.toCentre,
                    fullWidth = true,
                )
            }
        }
    }
}

/** "Submit for review" and one progress with the slot names. */
@Composable
private fun IdentitySubmitBar(
    state: IdentityUiState,
    onSubmit: () -> Unit,
) {
    val failure = state.submitError
    val status: (@Composable () -> Unit)? =
        if (failure == null && !state.submitting) {
            null
        } else {
            {
                SendStatus(
                    failure = failure?.let { stringResource(it) },
                    progressText = if (state.submitting) stringResource(slotLabel(state.progressSlot)) else null,
                    progressLabel = stringResource(R.string.verification_identity_progress_label),
                    progress = { overallProgress(state) },
                )
            }
        }
    FlowBar(banner = status) {
        KrButton(
            text =
                stringResource(
                    if (failure == null) {
                        R.string.verification_identity_submit
                    } else {
                        R.string.verification_camera_try_again
                    },
                ),
            onClick = onSubmit,
            enabled = LocalOnline.current,
            loading = state.submitting,
            fullWidth = true,
        )
    }
}

/** The one progress: the rounds that are done and the running one, then the request itself. */
private fun overallProgress(state: IdentityUiState): Float {
    val slots = state.slots
    val index = state.progressSlot?.let { slots.indexOf(it) }?.takeIf { it >= 0 } ?: slots.size
    return ((index + state.progress) / (slots.size + 1)).coerceIn(0f, 1f)
}

private fun slotImage(
    state: IdentityUiState,
    slot: UploadSlot,
): PreparedPhoto? =
    when (slot) {
        UploadSlot.FRONT -> state.front
        UploadSlot.BACK -> state.back
        UploadSlot.SELFIE, UploadSlot.UNKNOWN -> state.selfie
    }

private fun slotLabel(slot: UploadSlot?): Int =
    when (slot) {
        UploadSlot.FRONT -> R.string.verification_identity_slot_front
        UploadSlot.BACK -> R.string.verification_identity_slot_back
        UploadSlot.SELFIE -> R.string.verification_identity_slot_selfie
        UploadSlot.UNKNOWN, null -> R.string.verification_identity_slot_submit
    }

private val StepHeadings =
    listOf(
        R.string.verification_identity_step1,
        R.string.verification_identity_step2,
        R.string.verification_identity_step3,
    )
private val SegmentHeight = 6.dp
private val SentPhoto = DpSize(96.dp, 120.dp)
private const val NUMBER_FIELDS = 2
private const val CARD_RATIO = 1.586f
