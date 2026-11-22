package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.media.PreparedPhoto
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.ui.components.AnswerRow
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchInlay
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrMeter
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/*
 * The steps the selfie and the identity flow share (specs/16 sections 6.22 and 6.23). Each step
 * keeps its main action in the bar at the bottom, so it is in view at any text size.
 */

/** The bar of a step, with what went wrong or how far it is on top of its button. */
@Composable
internal fun FlowBar(
    modifier: Modifier = Modifier,
    banner: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    KrActionBar(modifier = modifier, maxWidth = Sizes.formWidth, banner = banner, content = content)
}

/** A step or state in one panel: an icon in an arch, then its words. */
@Composable
internal fun FlowMessage(
    icon: ImageVector,
    message: String,
    modifier: Modifier = Modifier,
    tone: ArchTone = ArchTone.PRIMARY,
) {
    StepPanel(modifier) {
        ArchIcon(icon, size = Sizes.archIconLarge, tone = tone)
        Text(
            text = message,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

/** A closed profile can view the verification state but not submit (03 section 5). */
@Composable
internal fun ClosedMessage(modifier: Modifier = Modifier) {
    FlowMessage(
        icon = Icons.Outlined.Lock,
        message = stringResource(R.string.verification_centre_closed),
        tone = ArchTone.TONAL,
        modifier = modifier,
    )
}

@Composable
internal fun ReopenBar(onReopen: () -> Unit) {
    FlowBar {
        KrButton(
            text = stringResource(R.string.verification_centre_closed_action),
            onClick = onReopen,
            variant = KrButtonVariant.SECONDARY,
            size = KrButtonSize.LARGE,
            fullWidth = true,
        )
    }
}

/** The end of a flow. Sent is not verified yet, so it has a clock and no tick (DESIGN.md 6.6). */
@Composable
internal fun SentMessage(
    message: String,
    modifier: Modifier = Modifier,
) {
    FlowMessage(icon = Icons.Outlined.Schedule, message = message, tone = ArchTone.WARNING, modifier = modifier)
}

/** The day's gesture with its drawing and instruction (12 section 4.2). */
@Composable
internal fun GestureStep(
    gesture: Gesture?,
    error: ApiError?,
    notice: Int?,
    failure: Int?,
    intro: String?,
    access: CameraAccess,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.gutter)) {
        when {
            gesture != null -> {
                if (notice != null) {
                    StatusBanner(text = stringResource(notice), tone = StatusTone.WARNING, announce = true)
                }
                if (failure != null) {
                    StatusBanner(text = stringResource(failure), tone = StatusTone.DANGER, announce = true)
                }
                StepPanel {
                    if (intro != null) {
                        Text(intro, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                    }
                    GestureArch(gesture = gesture, size = GestureArchSize)
                    gestureInstruction(gesture)?.let { instruction ->
                        Text(
                            text = stringResource(instruction),
                            style = MaterialTheme.typography.titleLarge,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                CameraNote(access)
            }

            error != null -> {
                ErrorState(error = error, onRetry = onRetry)
            }

            else -> {
                StepPanel {
                    LoadingRegion(Modifier.fillMaxWidth()) {
                        SkeletonBox(
                            Modifier
                                .align(Alignment.CenterHorizontally)
                                .size(GestureArchSize),
                            shape = ArchShape,
                        )
                        SkeletonBox(Modifier.fillMaxWidth().height(Spacing.s24))
                    }
                }
            }
        }
    }
}

/** The drawing of a gesture in an arch, with the gold line. */
@Composable
internal fun GestureArch(
    gesture: Gesture,
    size: DpSize,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(size)
            .clip(ArchShape)
            .background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
    ) {
        ArchInlay()
        GestureIllustration(gesture = gesture, modifier = Modifier.size(size * DRAWING_SHARE))
    }
}

/** The photo just taken or chosen, whole, at a height that is known before it is decoded. */
@Composable
internal fun CapturedImage(
    photo: PreparedPhoto,
    modifier: Modifier = Modifier,
) {
    val height = (LocalWindowInfo.current.containerDpSize.height * REVIEW_SHARE).coerceIn(ReviewMin, ReviewMax)
    AsyncImage(
        model = photo.file,
        contentDescription = stringResource(R.string.verification_review_alt),
        contentScale = ContentScale.Fit,
        modifier =
            modifier
                .fillMaxWidth()
                .height(height)
                .clip(MaterialTheme.shapes.large)
                .background(KrTheme.tonal),
    )
}

/** "Retake", then the main answer: "Use this photo" (16 section 6.22 step 4) or the submit. */
@Composable
internal fun RetakeOrContinue(
    onRetake: () -> Unit,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
    continueLabel: String = stringResource(R.string.verification_review_use),
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    AnswerRow(
        modifier = modifier,
        secondary = { answer ->
            KrButton(
                text = stringResource(R.string.verification_review_retake),
                onClick = onRetake,
                variant = KrButtonVariant.SECONDARY,
                size = KrButtonSize.LARGE,
                enabled = !busy,
                modifier = answer,
            )
        },
        primary = { answer ->
            KrButton(
                text = continueLabel,
                onClick = onContinue,
                enabled = enabled,
                loading = busy,
                modifier = answer,
            )
        },
    )
}

/** What the submit bar shows above its button: the failure, or the one progress of the calls. */
@Composable
internal fun SendStatus(
    failure: String?,
    progressText: String?,
    progressLabel: String,
    progress: () -> Float,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        if (failure != null) StatusBanner(text = failure, tone = StatusTone.DANGER, announce = true)
        if (progressText != null) {
            Text(
                text = progressText,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            KrMeter(progress = progress, description = progressLabel)
        }
    }
}

private val GestureArchSize = DpSize(160.dp, 200.dp)
private val ReviewMin = 180.dp
private val ReviewMax = 440.dp
private const val REVIEW_SHARE = 0.42f
private const val DRAWING_SHARE = 0.78f
