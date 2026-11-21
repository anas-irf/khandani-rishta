package com.khandanirishta.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.node.CompositionLocalConsumerModifierNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.currentValueOf
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.LocalExtendedColors
import kotlinx.coroutines.launch

/** A moving highlight for skeletons (rule G1: a skeleton that matches the final layout). */
fun Modifier.shimmer(): Modifier = this then ShimmerElement

private data object ShimmerElement : ModifierNodeElement<ShimmerNode>() {
    override fun create(): ShimmerNode = ShimmerNode()

    override fun update(node: ShimmerNode) = Unit

    override fun InspectorInfo.inspectableProperties() {
        name = "shimmer"
    }
}

/** Fills its bounds with the skeleton colour, with a highlight sweeping across it on a loop. */
private class ShimmerNode :
    Modifier.Node(),
    DrawModifierNode,
    CompositionLocalConsumerModifierNode {
    private val progress = Animatable(0f)

    override fun onAttach() {
        coroutineScope.launch {
            progress.snapTo(0f)
            progress.animateTo(
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(SHIMMER_MILLIS, easing = LinearEasing), RepeatMode.Restart),
            )
        }
    }

    override fun ContentDrawScope.draw() {
        val colors = currentValueOf(LocalExtendedColors)
        val shift = progress.value * SHIMMER_TRAVEL
        drawRect(
            Brush.linearGradient(
                colors = listOf(colors.skeleton, colors.skeletonHighlight, colors.skeleton),
                start = Offset(x = -600f + shift, y = 0f),
                end = Offset(x = -200f + shift, y = 400f),
            ),
        )
        drawContent()
    }
}

private const val SHIMMER_MILLIS = 1200
private const val SHIMMER_TRAVEL = 1600f

@Composable
fun SkeletonBox(
    modifier: Modifier = Modifier,
    corner: Dp = 8.dp,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(corner))
            .shimmer(),
    )
}

/** Skeleton rows for compact lists. */
@Composable
fun ListSkeleton(
    modifier: Modifier = Modifier,
    rows: Int = 6,
) {
    Column(modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        repeat(rows) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SkeletonBox(Modifier.size(64.dp), corner = 32.dp)
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SkeletonBox(
                        Modifier
                            .fillMaxWidth(0.6f)
                            .height(16.dp),
                    )
                    SkeletonBox(
                        Modifier
                            .fillMaxWidth(0.85f)
                            .height(12.dp),
                    )
                    SkeletonBox(
                        Modifier
                            .fillMaxWidth(0.4f)
                            .height(12.dp),
                    )
                }
            }
        }
    }
}

/** Skeleton cards for the full-size card lists. */
@Composable
fun CardSkeleton(
    modifier: Modifier = Modifier,
    cards: Int = 2,
) {
    Column(modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        repeat(cards) {
            SkeletonBox(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(0.85f),
                corner = 20.dp,
            )
        }
    }
}

/** Skeleton for forms and settings screens. */
@Composable
fun FormSkeleton(
    modifier: Modifier = Modifier,
    fields: Int = 6,
) {
    Column(modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        repeat(fields) {
            SkeletonBox(
                Modifier
                    .fillMaxWidth(0.35f)
                    .height(14.dp),
            )
            SkeletonBox(
                Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            )
        }
    }
}

/** Rule G2: an icon, a title, one line of text and, where useful, one primary button. */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    text: String? = null,
    icon: ImageVector = Icons.Outlined.Inbox,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(88.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(40.dp),
            )
        }
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        if (text != null) {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(4.dp))
            Button(onClick = onAction) { Text(actionLabel) }
        }
    }
}

/** Rule G3: the screen-level error with "Try again" and the request id in small type. */
@Composable
fun ErrorState(
    error: ApiError?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val offline = error?.isNetwork == true
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            if (offline) Icons.Outlined.CloudOff else Icons.Outlined.ErrorOutline,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(48.dp),
        )
        Text(
            if (offline) {
                stringResource(
                    R.string.common_offline,
                )
            } else {
                stringResource(R.string.errors_generic_screen_title)
            },
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.errors_generic_screen_text),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Button(onClick = onRetry) { Text(stringResource(R.string.errors_generic_try_again)) }
        error?.requestId?.let {
            Text(
                text(R.string.errors_reference, "id" to it),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** "This is no longer available." with "Go back" (specs/16 section 1.3). */
@Composable
fun NoLongerAvailable(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = stringResource(R.string.errors_no_longer_available),
) {
    EmptyState(
        title = title,
        icon = Icons.Outlined.SearchOff,
        actionLabel = stringResource(R.string.errors_go_back),
        onAction = onBack,
        modifier = modifier,
    )
}

/** Rule G14: "You are offline" under the top bar. */
@Composable
fun OfflineBanner(modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.inverseSurface, modifier = modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                Icons.Outlined.CloudOff,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.inverseOnSurface,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(R.string.common_offline),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.inverseOnSurface,
            )
        }
    }
}

/** The status panel of specs/16 section 1.4, shown in place of a screen the profile status refuses. */
@Composable
fun StatusPanel(
    status: ProfileStatus,
    onResume: () -> Unit,
    onReopen: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
) {
    val paused = status == ProfileStatus.PAUSED
    val title = if (paused) R.string.shared_status_panel_paused_title else R.string.shared_status_panel_closed_title
    val body = if (paused) R.string.shared_status_panel_paused_text else R.string.shared_status_panel_closed_text
    val action = if (paused) R.string.shared_status_panel_paused_action else R.string.shared_status_panel_closed_action
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                Icons.Outlined.PauseCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.size(56.dp),
            )
            Text(
                stringResource(title),
                style = MaterialTheme.typography.titleLarge,
                textAlign = TextAlign.Center,
            )
            Text(
                stringResource(body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Button(onClick = if (paused) onResume else onReopen, enabled = !busy) {
                Text(stringResource(action))
            }
        }
    }
}

/** A tinted information banner (profile and moderation states). */
@Composable
fun StatusBanner(
    text: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    container: Color = MaterialTheme.colorScheme.tertiaryContainer,
    content: Color = MaterialTheme.colorScheme.onTertiaryContainer,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Surface(
        color = container,
        contentColor = content,
        shape = MaterialTheme.shapes.medium,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
            }
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            if (actionLabel != null && onAction != null) {
                OutlinedButton(onClick = onAction) { Text(actionLabel) }
            }
        }
    }
}
