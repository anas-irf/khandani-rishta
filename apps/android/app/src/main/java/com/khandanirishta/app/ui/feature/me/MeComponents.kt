package com.khandanirishta.app.ui.feature.me

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.ui.theme.KrTheme

/*
 * Small building blocks shared by the own-profile, photo and verification screens: cards,
 * notices, full-width buttons with a busy state, a progress ring and a dashed border.
 */

/** Screen padding and the space between blocks (the design language of the app). */
internal val MeScreenPadding = 16.dp
internal val MeBlockSpacing = 16.dp

/** A white rounded card with a soft shadow. */
@Composable
internal fun MeSurfaceCard(
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(16.dp),
    spacing: Dp = 8.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(contentPadding), verticalArrangement = Arrangement.spacedBy(spacing), content = content)
    }
}

/** A block title inside a screen or a card. */
@Composable
internal fun MeBlockTitle(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        modifier = modifier.semantics { heading() },
    )
}

/** The tone of a [MeNotice]: colours and icon. */
internal enum class MeNoticeTone { INFO, WARNING, DANGER, SUCCESS }

/** A tinted notice with an icon, an optional title, its text and optional actions under it. */
@Composable
internal fun MeNotice(
    text: String?,
    modifier: Modifier = Modifier,
    tone: MeNoticeTone = MeNoticeTone.INFO,
    title: String? = null,
    icon: ImageVector? = null,
    actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val (container, accent) =
        when (tone) {
            MeNoticeTone.INFO -> {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) to MaterialTheme.colorScheme.primary
            }

            MeNoticeTone.WARNING -> {
                KrTheme.colors.warningContainer to KrTheme.colors.warning
            }

            MeNoticeTone.DANGER -> {
                MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.error
            }

            MeNoticeTone.SUCCESS -> {
                KrTheme.colors.successContainer to KrTheme.colors.success
            }
        }
    val shownIcon =
        icon ?: when (tone) {
            MeNoticeTone.INFO -> Icons.Outlined.Info
            MeNoticeTone.WARNING -> Icons.Outlined.WarningAmber
            MeNoticeTone.DANGER -> Icons.Outlined.ErrorOutline
            MeNoticeTone.SUCCESS -> Icons.Outlined.CheckCircle
        }
    Surface(color = container, shape = MaterialTheme.shapes.medium, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
            Icon(shownIcon, contentDescription = null, tint = accent, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (title != null) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                if (text != null) {
                    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                }
                actions?.invoke(this)
            }
        }
    }
}

/** The main action of a step or form: full width, at least 52 dp, a spinner while [busy]. */
@Composable
internal fun MePrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp),
    ) {
        ButtonContent(text, icon, busy, MaterialTheme.colorScheme.onPrimary)
    }
}

/** A secondary action of a step: full width and outlined. */
@Composable
internal fun MeSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp),
    ) {
        ButtonContent(text, icon, busy, MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun RowScope.ButtonContent(
    text: String,
    icon: ImageVector?,
    busy: Boolean,
    spinnerColor: Color,
) {
    if (busy) {
        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = spinnerColor)
        Spacer(Modifier.width(10.dp))
    } else if (icon != null) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
    }
    Text(text)
}

/** A round progress ring from 0 to 1 that animates to its value. */
@Composable
internal fun MeProgressRing(
    progress: Float,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.surfaceContainerHigh,
    strokeWidth: Dp = 6.dp,
) {
    val animated by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(durationMillis = 900),
        label = "progress-ring",
    )
    Canvas(modifier) {
        val stroke = strokeWidth.toPx()
        val inset = stroke / 2
        val arcSize = Size(size.width - stroke, size.height - stroke)
        drawArc(
            color = trackColor,
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = arcSize,
            style = Stroke(width = stroke),
        )
        drawArc(
            color = color,
            startAngle = -90f,
            sweepAngle = 360f * animated,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = arcSize,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
    }
}

/** A dashed rounded outline, for "Add a photo" tiles. */
internal fun Modifier.meDashedBorder(
    color: Color,
    cornerRadius: Dp,
    strokeWidth: Dp = 1.5.dp,
    dash: Dp = 6.dp,
    gap: Dp = 5.dp,
): Modifier =
    drawBehind {
        val width = strokeWidth.toPx()
        val inset = width / 2
        drawRoundRect(
            color = color,
            topLeft = Offset(inset, inset),
            size = Size(size.width - width, size.height - width),
            cornerRadius = CornerRadius(cornerRadius.toPx()),
            style =
                Stroke(
                    width = width,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash.toPx(), gap.toPx()), 0f),
                ),
        )
    }

/** An icon in a tinted circle, for card headers and step illustrations. */
@Composable
internal fun MeIconBubble(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    tint: Color = MaterialTheme.colorScheme.primary,
    container: Color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f),
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(container),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
}

/** A small rounded status label, for photo tiles and verification rows. */
@Composable
internal fun MeStatusPill(
    text: String,
    container: Color,
    content: Color,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    spinning: Boolean = false,
) {
    Surface(color = container, contentColor = content, shape = CircleShape, modifier = modifier) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (spinning) {
                CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp, color = content)
            } else if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp))
            }
            Text(text, style = MaterialTheme.typography.labelMedium, maxLines = 1)
        }
    }
}
