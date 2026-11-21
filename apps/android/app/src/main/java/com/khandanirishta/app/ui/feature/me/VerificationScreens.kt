package com.khandanirishta.app.ui.feature.me

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.media.PreparedPhoto
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.core.network.generated.model.IdentityStatus
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.UploadSlot
import com.khandanirishta.app.core.network.generated.model.VerificationKind
import com.khandanirishta.app.core.network.generated.model.VerificationOverview
import com.khandanirishta.app.core.network.generated.model.VerificationRequestSummary
import com.khandanirishta.app.core.network.generated.model.VerificationStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.navigation.VerifyIdentity
import com.khandanirishta.app.ui.navigation.VerifySelfie
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

// ---------------------------------------------------------------------------
// ME-VERIFY
// ---------------------------------------------------------------------------

/**
 * `ME-VERIFY` (specs/16 section 6.21, specs/12 section 8.1): the verification centre. What is
 * verified, what is under review, and how to verify the rest: the identity document and the
 * photo check with their states and controls, the footer about the documents, and the past
 * requests with their rejection messages. A closed profile can view but not start a check.
 */
@Composable
fun VerificationScreen() {
    VerificationRoute()
}

@Composable
private fun VerificationRoute(viewModel: VerificationViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    var cancelTarget by remember { mutableStateOf<VerificationRequestSummary?>(null) }
    LifecycleResumeEffect(Unit) {
        viewModel.onVisible()
        onPauseOrDispose { }
    }
    Scaffold(
        topBar = { DetailTopBar(title = stringResource(R.string.verification_centre_title), onBack = navigator::back) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = MeScreenPadding, end = MeScreenPadding, top = 4.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
        ) {
            IntroCard()
            val overview = state.overview
            when {
                overview != null -> {
                    CentreContent(
                        overview = overview,
                        cancelling = state.cancelling,
                        onCancel = { cancelTarget = it },
                        onOpen = navigator::push,
                    )
                }

                state.error != null -> {
                    ErrorState(error = state.error, onRetry = { viewModel.load() })
                }

                else -> {
                    RowsSkeleton()
                }
            }
        }
    }
    cancelTarget?.let { request ->
        ConfirmDialog(
            title = stringResource(R.string.verification_centre_cancel_title),
            text = stringResource(R.string.verification_centre_cancel_description),
            confirmLabel = stringResource(R.string.verification_centre_cancel_confirm),
            dismissLabel = stringResource(R.string.verification_centre_cancel_keep),
            destructive = true,
            onConfirm = {
                viewModel.cancel(request)
                cancelTarget = null
            },
            onDismiss = { cancelTarget = null },
        )
    }
}

/** The title block: why verifying is worth it (12 section 8.1). */
@Composable
private fun IntroCard(modifier: Modifier = Modifier) {
    Surface(shape = RoundedCornerShape(24.dp), color = Color.Transparent, modifier = modifier.fillMaxWidth()) {
        Row(
            Modifier
                .background(KrTheme.colors.heroGradient)
                .padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MeIconBubble(
                icon = Icons.Outlined.VerifiedUser,
                size = 52.dp,
                tint = Color.White,
                container = Color.White.copy(alpha = 0.18f),
            )
            Spacer(Modifier.width(16.dp))
            Text(
                stringResource(R.string.verification_centre_intro),
                style = MaterialTheme.typography.bodyLarge,
                color = Color.White,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** The state of a row of the centre, chosen with the table of 16 section 6.21. */
private enum class CheckState { VERIFIED, PENDING, REJECTED, NOT_STARTED, NUMBER_ADDED, NO_PHOTO }

private fun identityState(overview: VerificationOverview): CheckState {
    val newest = newestRequest(overview.requests, VerificationKind.ID_DOCUMENT)
    return when {
        overview.idVerified -> CheckState.VERIFIED
        newest?.status == VerificationStatus.PENDING -> CheckState.PENDING
        newest?.status == VerificationStatus.REJECTED -> CheckState.REJECTED
        overview.identity == null -> CheckState.NOT_STARTED
        else -> CheckState.NUMBER_ADDED
    }
}

private fun photoState(
    overview: VerificationOverview,
    hasApprovedPhoto: Boolean,
): CheckState {
    val newest = newestRequest(overview.requests, VerificationKind.SELFIE)
    return when {
        overview.photoVerified -> CheckState.VERIFIED
        newest?.status == VerificationStatus.PENDING -> CheckState.PENDING
        newest?.status == VerificationStatus.REJECTED -> CheckState.REJECTED
        !hasApprovedPhoto -> CheckState.NO_PHOTO
        else -> CheckState.NOT_STARTED
    }
}

@Composable
private fun CentreContent(
    overview: VerificationOverview,
    cancelling: Boolean,
    onCancel: (VerificationRequestSummary) -> Unit,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val me = LocalMe.current
    val res = LocalResources.current
    val reference = LocalReference.current
    val candidate = verifyCandidateOf(me)
    val supportEmail = me?.config?.supportEmail.orEmpty()
    val closed = me?.profile?.status == ProfileStatus.CLOSED
    // Only an approved photo can be the main one (12 section 4.1).
    val hasApprovedPhoto = me?.profile?.photo != null
    val identity = overview.identity
    val newestId = newestRequest(overview.requests, VerificationKind.ID_DOCUMENT)
    val newestSelfie = newestRequest(overview.requests, VerificationKind.SELFIE)
    val idState = identityState(overview)
    val selfieState = photoState(overview, hasApprovedPhoto)
    val rejected: (VerificationRequestSummary?) -> String = { request ->
        withoutFinalStop(verificationRejectionText(res, request?.rejectionReason, candidate, supportEmail))
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(MeBlockSpacing)) {
        if (closed) ClosedNotice(onReopen = { onOpen(AccountSettings) })

        CheckCard(
            icon = Icons.Outlined.Badge,
            title = stringResource(R.string.verification_centre_identity_title),
            state = idState,
            text =
                when (idState) {
                    CheckState.VERIFIED -> {
                        identity?.verifiedAt?.let {
                            text(R.string.verification_centre_identity_verified, "date" to Formatters.longDate(it))
                        }
                            ?: stringResource(R.string.verification_centre_identity_verified_no_date)
                    }

                    CheckState.PENDING -> {
                        stringResource(R.string.verification_centre_identity_pending)
                    }

                    CheckState.REJECTED -> {
                        text(R.string.verification_centre_identity_rejected, "reason" to rejected(newestId))
                    }

                    CheckState.NOT_STARTED -> {
                        stringResource(R.string.verification_centre_identity_not_started)
                    }

                    CheckState.NUMBER_ADDED, CheckState.NO_PHOTO -> {
                        stringResource(R.string.verification_centre_identity_number_added)
                    }
                },
            detail =
                identity?.let {
                    text(
                        R.string.verification_centre_identity_document,
                        "type" to reference.option(Lists.DOCUMENT_TYPE, it.documentType),
                        "number" to it.numberMasked,
                    )
                },
        ) {
            when (idState) {
                CheckState.PENDING -> {
                    newestId?.let { request -> CancelButton(enabled = !cancelling) { onCancel(request) } }
                }

                CheckState.REJECTED -> {
                    if (!closed) {
                        MePrimaryButton(
                            stringResource(R.string.verification_centre_identity_try_again),
                            onClick = { onOpen(VerifyIdentity()) },
                        )
                    }
                }

                CheckState.NOT_STARTED -> {
                    if (!closed) {
                        MePrimaryButton(
                            stringResource(R.string.verification_centre_identity_start),
                            onClick = { onOpen(VerifyIdentity()) },
                        )
                    }
                }

                CheckState.NUMBER_ADDED -> {
                    if (!closed) {
                        MePrimaryButton(
                            stringResource(R.string.verification_centre_identity_upload),
                            onClick = { onOpen(VerifyIdentity()) },
                        )
                        // Only while the number may still change (12 section 3.6).
                        if (identity?.status in CHANGEABLE) {
                            TextButton(onClick = { onOpen(VerifyIdentity(changeNumber = true)) }) {
                                Text(stringResource(R.string.verification_centre_identity_change_number))
                            }
                        }
                    }
                }

                CheckState.VERIFIED, CheckState.NO_PHOTO -> {}
            }
        }

        CheckCard(
            icon = Icons.Outlined.Face,
            title = stringResource(R.string.verification_centre_photo_title),
            state = selfieState,
            text =
                when (selfieState) {
                    CheckState.VERIFIED -> {
                        stringResource(R.string.verification_centre_photo_verified)
                    }

                    CheckState.PENDING -> {
                        stringResource(R.string.verification_centre_photo_pending)
                    }

                    CheckState.REJECTED -> {
                        text(R.string.verification_centre_photo_rejected, "reason" to rejected(newestSelfie))
                    }

                    CheckState.NO_PHOTO -> {
                        stringResource(R.string.verification_centre_photo_no_photo)
                    }

                    CheckState.NOT_STARTED, CheckState.NUMBER_ADDED -> {
                        stringResource(R.string.verification_centre_photo_not_started)
                    }
                },
            detail = null,
        ) {
            when (selfieState) {
                CheckState.PENDING -> {
                    newestSelfie?.let { request -> CancelButton(enabled = !cancelling) { onCancel(request) } }
                }

                CheckState.REJECTED -> {
                    if (!closed) {
                        MePrimaryButton(
                            stringResource(R.string.verification_centre_photo_try_again),
                            onClick = { onOpen(VerifySelfie) },
                        )
                    }
                }

                CheckState.NO_PHOTO -> {
                    MePrimaryButton(
                        stringResource(R.string.verification_centre_photo_add_photo),
                        onClick = { onOpen(MyPhotos) },
                        icon = Icons.Outlined.AddAPhoto,
                    )
                }

                CheckState.NOT_STARTED -> {
                    if (!closed) {
                        MePrimaryButton(
                            stringResource(R.string.verification_centre_photo_take_selfie),
                            onClick = { onOpen(VerifySelfie) },
                            icon = Icons.Outlined.PhotoCamera,
                        )
                    }
                }

                CheckState.VERIFIED, CheckState.NUMBER_ADDED -> {}
            }
        }

        Row(verticalAlignment = Alignment.Top) {
            Icon(
                Icons.Outlined.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    Modifier
                        .padding(top = 2.dp)
                        .size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(R.string.verification_centre_footer),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        History(requests = overview.requests, rejected = rejected)
    }
}

/** One check of the centre: icon, title, state, its text and its controls. */
@Composable
private fun CheckCard(
    icon: ImageVector,
    title: String,
    state: CheckState,
    text: String,
    detail: String?,
    modifier: Modifier = Modifier,
    controls: @Composable ColumnScope.() -> Unit,
) {
    val (tint, container) =
        when (state) {
            CheckState.VERIFIED -> KrTheme.colors.success to KrTheme.colors.successContainer
            CheckState.PENDING -> KrTheme.colors.warning to KrTheme.colors.warningContainer
            CheckState.REJECTED -> MaterialTheme.colorScheme.error to MaterialTheme.colorScheme.errorContainer
            else -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f)
        }
    MeSurfaceCard(modifier = modifier, spacing = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MeIconBubble(icon = icon, size = 48.dp, tint = tint, container = container)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
                MeStatusPill(
                    text = stringResource(stateLabel(state)),
                    container = container,
                    content = if (state == CheckState.PENDING) MaterialTheme.colorScheme.onSurface else tint,
                    icon = stateIcon(state),
                )
            }
        }
        Text(text, style = MaterialTheme.typography.bodyMedium)
        if (detail != null) {
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        controls()
    }
}

/** The line over the selfie camera: the gesture's instruction. */
@Composable
private fun selfieHint(gesture: Gesture?): String {
    val instruction = gesture?.let(::gestureInstruction)
    return stringResource(instruction ?: R.string.me_android_camera_face_hint)
}

/** A number that may still be changed (12 section 3.6). */
private val CHANGEABLE = setOf(IdentityStatus.UNVERIFIED, IdentityStatus.REJECTED)

private fun stateLabel(state: CheckState): Int =
    when (state) {
        CheckState.VERIFIED -> {
            R.string.me_profile_summary_state_verified
        }

        CheckState.PENDING -> {
            R.string.me_profile_summary_state_pending
        }

        CheckState.REJECTED -> {
            R.string.verification_centre_history_status_rejected
        }

        CheckState.NOT_STARTED, CheckState.NUMBER_ADDED, CheckState.NO_PHOTO -> {
            R.string.me_profile_summary_state_not_verified
        }
    }

private fun stateIcon(state: CheckState): ImageVector? =
    when (state) {
        CheckState.VERIFIED -> Icons.Outlined.CheckCircle
        CheckState.PENDING -> Icons.Outlined.Schedule
        else -> null
    }

@Composable
private fun CancelButton(
    enabled: Boolean,
    onClick: () -> Unit,
) {
    MeSecondaryButton(
        text = stringResource(R.string.verification_centre_cancel_action),
        onClick = onClick,
        enabled = enabled,
    )
}

/** "Past requests": kind, status, date and the rejection message; never the reviewer's note. */
@Composable
private fun History(
    requests: List<VerificationRequestSummary>,
    rejected: (VerificationRequestSummary?) -> String,
    modifier: Modifier = Modifier,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(modifier.fillMaxWidth()) {
        TextButton(onClick = { open = !open }) {
            Icon(
                Icons.Outlined.ExpandMore,
                contentDescription = null,
                modifier = Modifier.rotate(if (open) 180f else 0f),
            )
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.verification_centre_history_toggle))
        }
        AnimatedVisibility(visible = open) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (requests.isEmpty()) {
                    Text(
                        stringResource(R.string.verification_centre_history_empty),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                requests.forEach { request ->
                    MeSurfaceCard(spacing = 4.dp, contentPadding = PaddingValues(12.dp)) {
                        Text(
                            text(
                                R.string.verification_centre_history_line,
                                "kind" to stringResource(historyKindLabel(request.kind)),
                                "status" to stringResource(historyStatusLabel(request.status)),
                                "date" to Formatters.date(request.reviewedAt ?: request.createdAt),
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (request.status == VerificationStatus.REJECTED) {
                            Text(
                                rejected(request),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RowsSkeleton(modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(MeBlockSpacing)) {
        repeat(2) {
            SkeletonBox(
                Modifier
                    .fillMaxWidth()
                    .height(170.dp),
                corner = 18.dp,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/** A closed profile can view the verification state but not submit (03 section 5). */
@Composable
private fun ClosedNotice(
    onReopen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    MeNotice(
        text = stringResource(R.string.verification_centre_closed),
        tone = MeNoticeTone.WARNING,
        icon = Icons.Outlined.Lock,
        modifier = modifier,
    ) {
        OutlinedButton(onClick = onReopen) { Text(stringResource(R.string.verification_centre_closed_action)) }
    }
}

/** Step 2 of the selfie: the day's gesture with its drawing and instruction (12 section 4.2). */
@Composable
private fun GestureStep(
    gesture: Gesture?,
    error: ApiError?,
    notice: Int?,
    intro: String?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    action: @Composable () -> Unit,
) {
    Column(
        modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
    ) {
        when {
            gesture != null -> {
                if (notice != null) MeNotice(text = stringResource(notice), tone = MeNoticeTone.WARNING)
                if (intro != null) {
                    Text(intro, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                }
                Box(
                    Modifier
                        .size(210.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    GestureIllustration(gesture = gesture, modifier = Modifier.size(160.dp))
                }
                gestureInstruction(gesture)?.let { instruction ->
                    Text(
                        stringResource(instruction),
                        style = MaterialTheme.typography.titleLarge,
                        textAlign = TextAlign.Center,
                    )
                }
                action()
            }

            error != null -> {
                ErrorState(error = error, onRetry = onRetry)
            }

            else -> {
                SkeletonBox(Modifier.size(210.dp), corner = 105.dp)
                SkeletonBox(
                    Modifier
                        .fillMaxWidth(0.7f)
                        .height(22.dp),
                )
            }
        }
    }
}

/** The photo just taken or chosen, with "Retake" and "Use this photo" (16 section 6.22 step 4). */
@Composable
private fun CapturedReview(
    photo: PreparedPhoto,
    onUse: () -> Unit,
    onRetake: () -> Unit,
    modifier: Modifier = Modifier,
    useLabel: String = stringResource(R.string.verification_review_use),
    busy: Boolean = false,
    error: String? = null,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(MeBlockSpacing)) {
        AsyncImage(
            model = photo.file,
            contentDescription = stringResource(R.string.verification_review_alt),
            contentScale = ContentScale.Fit,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 200.dp, max = 440.dp)
                    .clip(MaterialTheme.shapes.large)
                    .background(Color.Black),
        )
        if (error != null) MeNotice(text = error, tone = MeNoticeTone.DANGER)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MeSecondaryButton(
                text = stringResource(R.string.verification_review_retake),
                onClick = onRetake,
                enabled = !busy,
                modifier = Modifier.weight(1f),
            )
            MePrimaryButton(text = useLabel, onClick = onUse, busy = busy, modifier = Modifier.weight(1f))
        }
    }
}

/** The end of a flow: the success text and "Done", back to `ME-VERIFY`. */
@Composable
private fun DonePanel(
    message: String,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        MeIconBubble(
            icon = Icons.Outlined.TaskAlt,
            size = 104.dp,
            tint = KrTheme.colors.success,
            container = KrTheme.colors.successContainer,
        )
        Text(message, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        MePrimaryButton(text = stringResource(R.string.verification_selfie_done), onClick = onDone)
    }
}

/** A flow that cannot start: the identity is verified, or a request is under review. */
@Composable
private fun StateNotice(
    icon: ImageVector,
    tint: Color,
    container: Color,
    message: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        MeIconBubble(icon = icon, size = 96.dp, tint = tint, container = container)
        Text(message, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        MeSecondaryButton(text = stringResource(R.string.verification_identity_back_to_centre), onClick = onBack)
    }
}

/** The intro of a flow step: a large icon in a soft circle. */
@Composable
private fun StepIcon(
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    MeIconBubble(icon = icon, size = 96.dp, modifier = modifier.padding(top = 8.dp))
}

// ---------------------------------------------------------------------------
// ME-VERIFY-SELFIE
// ---------------------------------------------------------------------------

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

    val candidate = verifyCandidateOf(me)
    Scaffold(
        topBar = {
            DetailTopBar(
                title = stringResource(R.string.verification_selfie_title),
                onBack = { if (closed || noPhoto || !viewModel.back()) navigator.back() },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = MeScreenPadding, end = MeScreenPadding, top = 8.dp, bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
        ) {
            when {
                closed -> {
                    ClosedNotice(onReopen = { navigator.push(AccountSettings) })
                }

                noPhoto -> {
                    StepIcon(Icons.Outlined.AddAPhoto)
                    Text(
                        stringResource(R.string.verification_selfie_no_photo),
                        style = MaterialTheme.typography.titleMedium,
                        textAlign = TextAlign.Center,
                    )
                    MePrimaryButton(
                        text = stringResource(R.string.verification_selfie_add_photo),
                        onClick = {
                            viewModel.clearNoPhoto()
                            navigator.push(MyPhotos)
                        },
                        icon = Icons.Outlined.AddAPhoto,
                    )
                }

                else -> {
                    when (state.step) {
                        SelfieStep.EXPLAIN -> {
                            StepIcon(Icons.Outlined.Face)
                            Text(
                                if (candidate.self) {
                                    stringResource(R.string.verification_selfie_body_self)
                                } else {
                                    text(R.string.verification_selfie_body, "name" to candidate.name)
                                },
                                style = MaterialTheme.typography.bodyLarge,
                                textAlign = TextAlign.Center,
                            )
                            if (!candidate.self) {
                                MeNotice(text = text(R.string.verification_selfie_managed, "name" to candidate.name))
                            }
                            MePrimaryButton(
                                text = stringResource(R.string.verification_selfie_continue),
                                onClick = viewModel::toGesture,
                            )
                        }

                        SelfieStep.GESTURE, SelfieStep.CAMERA -> {
                            GestureStep(
                                gesture = gesture,
                                error = state.challengeError,
                                notice = state.notice ?: state.error,
                                intro = null,
                                onRetry = viewModel::loadChallenge,
                            ) {
                                CameraButton(
                                    text = stringResource(R.string.verification_camera_open),
                                    onOpen = viewModel::openCamera,
                                )
                            }
                        }

                        SelfieStep.REVIEW -> {
                            state.photo?.let { photo ->
                                CapturedReview(photo = photo, onUse = viewModel::usePhoto, onRetake = viewModel::retake)
                            }
                        }

                        SelfieStep.SUBMIT -> {
                            state.photo?.let { photo ->
                                SubmitSelfie(
                                    photo = photo,
                                    gesture = gesture,
                                    progress = state.progress,
                                    error = state.error?.let { stringResource(it) },
                                    onSubmit = viewModel::submit,
                                    onRetake = viewModel::retake,
                                )
                            }
                        }

                        SelfieStep.DONE -> {
                            DonePanel(
                                message = stringResource(R.string.verification_selfie_success),
                                onDone = { navigator.returnTo(Verification) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Step 5: the selfie and the gesture once more, "Submit selfie" and one progress for the calls. */
@Composable
private fun SubmitSelfie(
    photo: PreparedPhoto,
    gesture: Gesture?,
    progress: Float?,
    error: String?,
    onSubmit: () -> Unit,
    onRetake: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val progressLabel = stringResource(R.string.verification_selfie_progress)
    Column(
        modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = photo.file,
                contentDescription = stringResource(R.string.verification_review_alt),
                contentScale = ContentScale.Crop,
                modifier =
                    Modifier
                        .size(width = 132.dp, height = 176.dp)
                        .clip(MaterialTheme.shapes.large)
                        .background(Color.Black),
            )
            if (gesture != null) {
                Box(
                    Modifier
                        .size(132.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    GestureIllustration(gesture = gesture, modifier = Modifier.size(100.dp))
                }
            }
        }
        if (error != null) MeNotice(text = error, tone = MeNoticeTone.DANGER)
        if (progress != null) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(progressLabel, style = MaterialTheme.typography.bodyMedium)
                LinearProgressIndicator(
                    progress = { progress },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .semantics { contentDescription = progressLabel },
                )
            }
        }
        MePrimaryButton(
            text =
                stringResource(
                    if (error != null) R.string.verification_camera_try_again else R.string.verification_selfie_submit,
                ),
            onClick = onSubmit,
            busy = progress != null,
        )
        MeSecondaryButton(
            text = stringResource(R.string.verification_review_retake),
            onClick = onRetake,
            enabled = progress == null,
        )
    }
}

// ---------------------------------------------------------------------------
// ME-VERIFY-ID
// ---------------------------------------------------------------------------

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

    val candidate = verifyCandidateOf(me)
    Scaffold(
        topBar = {
            DetailTopBar(
                title = stringResource(R.string.verification_identity_title),
                onBack = { if (!active || !viewModel.back()) navigator.back() },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = MeScreenPadding, end = MeScreenPadding, top = 8.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
        ) {
            when {
                closed -> {
                    ClosedNotice(onReopen = { navigator.push(AccountSettings) })
                }

                state.error != null -> {
                    ErrorState(error = state.error, onRetry = viewModel::load)
                }

                state.loading -> {
                    FormSkeleton(fields = 2)
                }

                state.blocked == IdBlock.VERIFIED -> {
                    StateNotice(
                        icon = Icons.Outlined.CheckCircle,
                        tint = KrTheme.colors.success,
                        container = KrTheme.colors.successContainer,
                        message = stringResource(R.string.verification_identity_verified),
                        onBack = { navigator.returnTo(Verification) },
                    )
                }

                state.blocked == IdBlock.PENDING -> {
                    StateNotice(
                        icon = Icons.Outlined.Schedule,
                        tint = KrTheme.colors.warning,
                        container = KrTheme.colors.warningContainer,
                        message = stringResource(R.string.verification_identity_pending),
                        onBack = { navigator.returnTo(Verification) },
                    )
                }

                else -> {
                    if (state.step != IdStep.DONE) StepIndicator(step = state.step)
                    when (state.step) {
                        IdStep.NUMBER -> {
                            if (!candidate.self) {
                                MeNotice(
                                    text = text(R.string.verification_identity_managed_note, "name" to candidate.name),
                                )
                            }
                            IdentityNumberFormContent(
                                submitLabel = stringResource(R.string.verification_selfie_continue),
                                onSave = viewModel::onNumberSaved,
                                startEditing = true,
                                showManagedNote = false,
                            )
                        }

                        IdStep.FRONT, IdStep.BACK -> {
                            CardStep(
                                state = state,
                                onCamera = viewModel::openCardCamera,
                                onGallery = { pickCard.launch(PickVisualMediaRequest(mediaType = ImageOnly)) },
                                onUse = viewModel::useCard,
                                onRetake = viewModel::retakeCard,
                            )
                        }

                        IdStep.GESTURE, IdStep.CAMERA -> {
                            val instruction = gesture?.let(::gestureInstruction)?.let { stringResource(it) }.orEmpty()
                            GestureStep(
                                gesture = gesture,
                                error = state.challengeError,
                                notice = state.notice ?: state.stepError,
                                intro =
                                    if (candidate.self) {
                                        text(R.string.verification_identity_selfie_body_self, "gesture" to instruction)
                                    } else {
                                        text(
                                            R.string.verification_identity_selfie_body,
                                            "name" to candidate.name,
                                            "gesture" to instruction,
                                        )
                                    },
                                onRetry = viewModel::retryChallenge,
                            ) {
                                CameraButton(
                                    text = stringResource(R.string.verification_camera_open),
                                    onOpen = viewModel::openSelfieCamera,
                                )
                            }
                        }

                        IdStep.REVIEW -> {
                            state.selfie?.let { photo ->
                                CapturedReview(
                                    photo = photo,
                                    onUse = viewModel::useSelfie,
                                    onRetake = viewModel::retakeSelfie,
                                )
                            }
                        }

                        IdStep.SUBMIT -> {
                            SubmitIdentity(state = state, onSubmit = viewModel::submit)
                        }

                        IdStep.DONE -> {
                            DonePanel(
                                message = stringResource(R.string.verification_identity_success),
                                onDone = { navigator.returnTo(Verification) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** "Step n of 3" and the step's heading (12 section 8.2), with three segments. */
@Composable
private fun StepIndicator(
    step: IdStep,
    modifier: Modifier = Modifier,
) {
    val index =
        when (step) {
            IdStep.NUMBER -> 0
            IdStep.FRONT, IdStep.BACK -> 1
            else -> 2
        }
    val headings =
        listOf(
            R.string.verification_identity_step1,
            R.string.verification_identity_step2,
            R.string.verification_identity_step3,
        )
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            headings.indices.forEach { position ->
                Box(
                    Modifier
                        .weight(1f)
                        .height(6.dp)
                        .clip(CircleShape)
                        .background(
                            if (position <= index) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerHighest
                            },
                        ),
                )
            }
        }
        Text(
            text(R.string.me_android_step_of, "current" to index + 1, "total" to headings.size),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            stringResource(headings[index]),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
    }
}

/** Step 2: one photo of the card with the back camera or the Photo Picker, then its review. */
@Composable
private fun CardStep(
    state: IdentityUiState,
    onCamera: () -> Unit,
    onGallery: () -> Unit,
    onUse: () -> Unit,
    onRetake: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val back = state.step == IdStep.BACK
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(MeBlockSpacing)) {
        state.identity?.let { identity ->
            Text(
                text(
                    R.string.verification_identity_number_on_file,
                    "type" to reference.option(Lists.DOCUMENT_TYPE, identity.documentType),
                    "number" to identity.numberMasked,
                ),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        MeNotice(text = stringResource(R.string.verification_identity_tips))
        MeBlockTitle(
            stringResource(
                when {
                    back -> R.string.verification_identity_back
                    state.passport -> R.string.verification_identity_front_passport
                    else -> R.string.verification_identity_front
                },
            ),
        )
        val candidate = state.candidate
        when {
            candidate != null -> {
                CapturedReview(photo = candidate, onUse = onUse, onRetake = onRetake)
            }

            state.preparing -> {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(200.dp),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }
            }

            else -> {
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    StepIcon(Icons.Outlined.CreditCard)
                    Text(
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
                    state.stepError?.let { MeNotice(text = stringResource(it), tone = MeNoticeTone.DANGER) }
                    CameraButton(text = stringResource(R.string.me_android_card_camera), onOpen = onCamera)
                    MeSecondaryButton(
                        text = stringResource(R.string.me_android_card_gallery),
                        onClick = onGallery,
                        icon = Icons.Outlined.PhotoLibrary,
                    )
                }
            }
        }
    }
}

/** Step 4: the photos once more, "Submit for review" and one progress with the slot names. */
@Composable
private fun SubmitIdentity(
    state: IdentityUiState,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val slots = state.slots
    val progressLabel = stringResource(R.string.verification_identity_progress_label)
    val photos = slots.mapNotNull { slot -> slotImage(state, slot) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(MeBlockSpacing)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            photos.forEach { photo ->
                AsyncImage(
                    model = photo.file,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier =
                        Modifier
                            .weight(1f)
                            .height(110.dp)
                            .clip(MaterialTheme.shapes.medium)
                            .background(Color.Black),
                )
            }
        }
        state.submitError?.let { MeNotice(text = stringResource(it), tone = MeNoticeTone.DANGER) }
        if (state.submitting) {
            val slot = state.progressSlot
            val index = slot?.let { slots.indexOf(it) }?.takeIf { it >= 0 } ?: slots.size
            val overall = ((index + state.progress) / (slots.size + 1)).coerceIn(0f, 1f)
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(slotLabel(slot)), style = MaterialTheme.typography.bodyMedium)
                LinearProgressIndicator(
                    progress = { overall },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .semantics { contentDescription = progressLabel },
                )
            }
        }
        MePrimaryButton(
            text =
                stringResource(
                    if (state.submitError != null) {
                        R.string.verification_camera_try_again
                    } else {
                        R.string.verification_identity_submit
                    },
                ),
            onClick = onSubmit,
            busy = state.submitting,
        )
    }
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
