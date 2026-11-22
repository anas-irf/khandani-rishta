package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.IdentityStatus
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.VerificationKind
import com.khandanirishta.app.core.network.generated.model.VerificationOverview
import com.khandanirishta.app.core.network.generated.model.VerificationRequestSummary
import com.khandanirishta.app.core.network.generated.model.VerificationStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.Disclosure
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.OrnamentRule
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.VerifyIdentity
import com.khandanirishta.app.ui.navigation.VerifySelfie
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.SmallArchShape
import com.khandanirishta.app.ui.theme.Spacing

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
    VerificationContent(
        state = state,
        onBack = navigator::back,
        onRetry = { viewModel.load() },
        onOpen = navigator::push,
        onCancel = { cancelTarget = it },
    )
    cancelTarget?.let { request ->
        ConfirmDialog(
            title = stringResource(R.string.verification_centre_cancel_title),
            text = stringResource(R.string.verification_centre_cancel_description),
            confirmLabel = stringResource(R.string.verification_centre_cancel_confirm),
            dismissLabel = stringResource(R.string.verification_centre_cancel_keep),
            // Ink, as on the web: a new request can be sent at any time.
            variant = KrButtonVariant.INK,
            onConfirm = {
                viewModel.cancel(request)
                cancelTarget = null
            },
            onDismiss = { cancelTarget = null },
        )
    }
}

/** The centre without its view model and navigation. */
@Composable
internal fun VerificationContent(
    state: VerificationUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onOpen: (AppKey) -> Unit,
    onCancel: (VerificationRequestSummary) -> Unit,
    modifier: Modifier = Modifier,
) {
    val closed = LocalMe.current?.profile?.status == ProfileStatus.CLOSED
    MeScaffold(
        title = stringResource(R.string.verification_centre_title),
        onBack = onBack,
        modifier = modifier,
    ) {
        Band(
            tone = BandTone.SAND,
            padding = BandDefaults.compactPadding,
            maxWidth = Sizes.formWidth,
            spacing = Spacing.s12,
        ) {
            OrnamentRule()
            Text(
                text = stringResource(R.string.verification_centre_intro),
                style = MaterialTheme.typography.bodyLarge,
                color = KrTheme.colors.textSecondary,
            )
        }
        Band(maxWidth = Sizes.formWidth, spacing = Spacing.gutter) {
            if (closed) {
                StatusBanner(
                    text = stringResource(R.string.verification_centre_closed),
                    tone = StatusTone.WARNING,
                    icon = Icons.Outlined.Lock,
                    actionLabel = stringResource(R.string.verification_centre_closed_action),
                    onAction = { onOpen(AccountSettings) },
                )
            }
            val overview = state.overview
            when {
                overview != null -> {
                    IdentityCheck(overview, closed, state.cancelling, onOpen, onCancel)
                    PhotoCheck(overview, closed, state.cancelling, onOpen, onCancel)
                    IconText(
                        icon = Icons.Outlined.Lock,
                        text = stringResource(R.string.verification_centre_footer),
                        style = KrType.caption,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        iconSize = Sizes.iconTiny,
                    )
                    History(requests = overview.requests)
                }

                state.error != null -> {
                    ErrorState(error = state.error, onRetry = onRetry, retrying = state.loading)
                }

                else -> {
                    CentreSkeleton()
                }
            }
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

/** The message of 12 section 8.3 of a rejected request. */
@Composable
private fun rejectionText(request: VerificationRequestSummary?): String =
    verificationRejectionText(
        res = LocalResources.current,
        reason = request?.rejectionReason,
        candidate = rememberCandidate(),
        supportEmail = LocalMe.current
            ?.config
            ?.supportEmail
            .orEmpty(),
    )

@Composable
private fun IdentityCheck(
    overview: VerificationOverview,
    closed: Boolean,
    cancelling: Boolean,
    onOpen: (AppKey) -> Unit,
    onCancel: (VerificationRequestSummary) -> Unit,
) {
    val identity = overview.identity
    val newest = remember(overview) { newestRequest(overview.requests, VerificationKind.ID_DOCUMENT) }
    val state = remember(overview) { identityState(overview) }
    val verifiedOn = remember(identity) { identity?.verifiedAt?.let { Formatters.longDate(it) } }
    val line =
        when (state) {
            CheckState.VERIFIED -> {
                if (verifiedOn == null) {
                    stringResource(R.string.verification_centre_identity_verified_no_date)
                } else {
                    text(R.string.verification_centre_identity_verified, "date" to verifiedOn)
                }
            }

            CheckState.PENDING -> {
                stringResource(R.string.verification_centre_identity_pending)
            }

            CheckState.REJECTED -> {
                text(
                    R.string.verification_centre_identity_rejected,
                    "reason" to withoutFinalStop(rejectionText(newest)),
                )
            }

            CheckState.NOT_STARTED -> {
                stringResource(R.string.verification_centre_identity_not_started)
            }

            CheckState.NUMBER_ADDED, CheckState.NO_PHOTO -> {
                stringResource(R.string.verification_centre_identity_number_added)
            }
        }
    val document =
        identity?.let {
            text(
                R.string.verification_centre_identity_document,
                "type" to LocalReference.current.option(Lists.DOCUMENT_TYPE, it.documentType),
                "number" to it.numberMasked,
            )
        }
    CheckPanel(
        icon = Icons.Outlined.Badge,
        title = stringResource(R.string.verification_centre_identity_title),
        state = state,
        line = line,
        detail = document,
    ) {
        when {
            state == CheckState.PENDING -> {
                newest?.let { request -> CancelRequest(cancelling = cancelling, onClick = { onCancel(request) }) }
            }

            closed -> {}

            state == CheckState.REJECTED -> {
                StartCheck(
                    label = stringResource(R.string.verification_centre_identity_try_again),
                    onClick = { onOpen(VerifyIdentity()) },
                )
            }

            state == CheckState.NOT_STARTED -> {
                StartCheck(
                    label = stringResource(R.string.verification_centre_identity_start),
                    onClick = { onOpen(VerifyIdentity()) },
                )
            }

            state == CheckState.NUMBER_ADDED -> {
                StartCheck(
                    label = stringResource(R.string.verification_centre_identity_upload),
                    onClick = { onOpen(VerifyIdentity()) },
                )
                // Only while the number may still change (12 section 3.6).
                if (identity?.status in CHANGEABLE) {
                    KrTextLink(
                        text = stringResource(R.string.verification_centre_identity_change_number),
                        onClick = { onOpen(VerifyIdentity(changeNumber = true)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PhotoCheck(
    overview: VerificationOverview,
    closed: Boolean,
    cancelling: Boolean,
    onOpen: (AppKey) -> Unit,
    onCancel: (VerificationRequestSummary) -> Unit,
) {
    // Only an approved photo can be the main one (12 section 4.1).
    val hasApprovedPhoto = LocalMe.current?.profile?.photo != null
    val newest = remember(overview) { newestRequest(overview.requests, VerificationKind.SELFIE) }
    val state = remember(overview, hasApprovedPhoto) { photoState(overview, hasApprovedPhoto) }
    val line =
        when (state) {
            CheckState.VERIFIED -> {
                stringResource(R.string.verification_centre_photo_verified)
            }

            CheckState.PENDING -> {
                stringResource(R.string.verification_centre_photo_pending)
            }

            CheckState.REJECTED -> {
                text(
                    R.string.verification_centre_photo_rejected,
                    "reason" to withoutFinalStop(rejectionText(newest)),
                )
            }

            CheckState.NO_PHOTO -> {
                stringResource(R.string.verification_centre_photo_no_photo)
            }

            CheckState.NOT_STARTED, CheckState.NUMBER_ADDED -> {
                stringResource(R.string.verification_centre_photo_not_started)
            }
        }
    CheckPanel(
        icon = Icons.Outlined.Face,
        title = stringResource(R.string.verification_centre_photo_title),
        state = state,
        line = line,
    ) {
        when {
            state == CheckState.PENDING -> {
                newest?.let { request -> CancelRequest(cancelling = cancelling, onClick = { onCancel(request) }) }
            }

            state == CheckState.NO_PHOTO -> {
                StartCheck(
                    label = stringResource(R.string.verification_centre_photo_add_photo),
                    onClick = { onOpen(MyPhotos) },
                    icon = Icons.Outlined.AddAPhoto,
                )
            }

            closed -> {}

            state == CheckState.REJECTED -> {
                StartCheck(
                    label = stringResource(R.string.verification_centre_photo_try_again),
                    onClick = { onOpen(VerifySelfie) },
                )
            }

            state == CheckState.NOT_STARTED -> {
                StartCheck(
                    label = stringResource(R.string.verification_centre_photo_take_selfie),
                    onClick = { onOpen(VerifySelfie) },
                    icon = Icons.Outlined.PhotoCamera,
                )
            }
        }
    }
}

@Immutable
private data class CheckLook(
    val arch: ArchTone,
    val mark: ImageVector,
    val markTint: Color,
)

@Composable
private fun checkLook(state: CheckState): CheckLook {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    return when (state) {
        // The tick is for verified, and for nothing that is only sent.
        CheckState.VERIFIED -> {
            CheckLook(ArchTone.SOLID, Icons.Outlined.Check, extra.success)
        }

        CheckState.PENDING -> {
            CheckLook(ArchTone.WARNING, Icons.Outlined.Schedule, extra.warning)
        }

        CheckState.REJECTED -> {
            CheckLook(ArchTone.DANGER, Icons.Outlined.ErrorOutline, colors.error)
        }

        CheckState.NO_PHOTO -> {
            CheckLook(ArchTone.TONAL, Icons.Outlined.AddAPhoto, colors.onSurfaceVariant)
        }

        CheckState.NOT_STARTED, CheckState.NUMBER_ADDED -> {
            CheckLook(ArchTone.TONAL, Icons.Outlined.RadioButtonUnchecked, colors.onSurfaceVariant)
        }
    }
}

/** One check: the arch with its icon, the title, the state in words with its mark, its controls. */
@Composable
private fun CheckPanel(
    icon: ImageVector,
    title: String,
    state: CheckState,
    line: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    controls: @Composable ColumnScope.() -> Unit,
) {
    val look = checkLook(state)
    TonalPanel(modifier = modifier, spacing = Spacing.s16) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            ArchIcon(icon, tone = look.arch)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    modifier = Modifier.semantics { heading() },
                )
                IconText(icon = look.mark, text = line, tint = look.markTint, iconSize = Sizes.iconTiny)
                if (detail != null) {
                    Text(
                        text = detail,
                        style = MaterialTheme.typography.bodySmall.merge(KrType.numbers),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        controls()
    }
}

@Composable
private fun StartCheck(
    label: String,
    onClick: () -> Unit,
    icon: ImageVector? = null,
) {
    KrButton(text = label, onClick = onClick, icon = icon, fullWidth = true)
}

@Composable
private fun CancelRequest(
    cancelling: Boolean,
    onClick: () -> Unit,
) {
    KrButton(
        text = stringResource(R.string.verification_centre_cancel_action),
        onClick = onClick,
        variant = KrButtonVariant.SECONDARY,
        enabled = LocalOnline.current && !cancelling,
    )
}

/** "Past requests": kind, status, date and the rejection message; never the reviewer's note. */
@Composable
private fun History(requests: List<VerificationRequestSummary>) {
    var open by rememberSaveable { mutableStateOf(false) }
    Disclosure(
        title = stringResource(R.string.verification_centre_history_toggle),
        expanded = open,
        onExpandedChange = { open = it },
        spacing = Spacing.s12,
    ) {
        if (requests.isEmpty()) {
            Text(
                text = stringResource(R.string.verification_centre_history_empty),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        requests.forEach { request -> PastRequest(request) }
    }
}

@Composable
private fun PastRequest(request: VerificationRequestSummary) {
    val date = remember(request) { Formatters.date(request.reviewedAt ?: request.createdAt) }
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
        IconText(
            icon =
                when (request.status) {
                    VerificationStatus.APPROVED -> Icons.Outlined.Check
                    VerificationStatus.PENDING -> Icons.Outlined.Schedule
                    VerificationStatus.REJECTED -> Icons.Outlined.ErrorOutline
                    VerificationStatus.CANCELLED, VerificationStatus.UNKNOWN -> Icons.Outlined.Cancel
                },
            text =
                text(
                    R.string.verification_centre_history_line,
                    "kind" to stringResource(historyKindLabel(request.kind)),
                    "status" to stringResource(historyStatusLabel(request.status)),
                    "date" to date,
                ),
            tint =
                when (request.status) {
                    VerificationStatus.APPROVED -> extra.success
                    VerificationStatus.PENDING -> extra.warning
                    VerificationStatus.REJECTED -> colors.error
                    VerificationStatus.CANCELLED, VerificationStatus.UNKNOWN -> colors.onSurfaceVariant
                },
            iconSize = Sizes.iconTiny,
        )
        if (request.status == VerificationStatus.REJECTED) {
            Text(
                text = rejectionText(request),
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
            )
        }
        RowDivider(Modifier.padding(top = Spacing.s8))
    }
}

/** Loading: the two rows of the centre. */
@Composable
private fun CentreSkeleton() {
    LoadingRegion(Modifier.fillMaxWidth(), spacing = Spacing.gutter) {
        repeat(CHECKS) {
            TonalPanel(spacing = Spacing.s16) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
                    SkeletonBox(Modifier.size(Sizes.archIcon), shape = SmallArchShape)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                        SkeletonBox(Modifier.fillMaxWidth(SKELETON_TITLE).height(Spacing.s24))
                        SkeletonBox(Modifier.fillMaxWidth().height(Spacing.s20))
                    }
                }
                SkeletonBox(Modifier.fillMaxWidth().height(Sizes.touchLarge), shape = PillShape)
            }
        }
    }
}

/** A number that may still be changed (12 section 3.6). */
private val CHANGEABLE = setOf(IdentityStatus.UNVERIFIED, IdentityStatus.REJECTED)
private const val CHECKS = 2
private const val SKELETON_TITLE = 0.6f
