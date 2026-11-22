package com.khandanirishta.app.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.InnerArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/*
 * The states every screen shares (specs/16 rules G2, G3, G14 and section 1.4, DESIGN.md 6.15):
 * empty, error, no longer available, paused or closed, offline, and banners. Each has words, and
 * an icon wherever a colour says something.
 */

/** The colour of the icon in the middle arch of an [EmptyState]. */
enum class PanelTone { PRIMARY, WARNING, DANGER }

/**
 * The standard panel (DESIGN.md section 6.15): three arches with the icon or a diamond in the
 * middle one, a title, a line and, where useful, a primary action with at most one beside it.
 * [content] goes between the text and the actions. The caller gives the screen's gutters.
 */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    text: String? = null,
    icon: ImageVector? = null,
    tone: PanelTone = PanelTone.PRIMARY,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    actionEnabled: Boolean = true,
    actionBusy: Boolean = false,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    footnote: String? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    TonalPanel(
        modifier = modifier,
        shape = MaterialTheme.shapes.extraLarge,
        padding = PanelPadding,
        spacing = Spacing.s16,
    ) {
        EmptyArches(icon = icon, tone = tone)
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        if (text != null) {
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                color = KrTheme.colors.textSecondary,
                modifier = Modifier.widthIn(max = Sizes.measure),
            )
        }
        content?.invoke(this)
        val hasAction = actionLabel != null && onAction != null
        val hasSecondary = secondaryLabel != null && onSecondary != null
        if (hasAction || hasSecondary) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
                verticalArrangement = Arrangement.spacedBy(Spacing.s12),
            ) {
                if (actionLabel != null && onAction != null) {
                    KrButton(actionLabel, onAction, enabled = actionEnabled, loading = actionBusy)
                }
                if (secondaryLabel != null && onSecondary != null) {
                    KrButton(
                        text = secondaryLabel,
                        onClick = onSecondary,
                        variant = KrButtonVariant.SECONDARY,
                        size = KrButtonSize.LARGE,
                    )
                }
            }
        }
        if (footnote != null) CaptionText(footnote)
    }
}

@Composable
private fun EmptyArches(
    icon: ImageVector?,
    tone: PanelTone,
) {
    val gold = KrTheme.colors.ornament
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier.clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalAlignment = Alignment.Bottom,
    ) {
        val side = Modifier.size(Sizes.arch64).dashedBorder(InnerArchShape, gold)
        Box(side)
        Box(
            Modifier
                .size(Sizes.arch96)
                .border(Strokes.control, gold, ArchShape),
            contentAlignment = Alignment.Center,
        ) {
            if (icon == null) {
                Diamond(size = PanelDiamond)
            } else {
                val tint =
                    when (tone) {
                        PanelTone.PRIMARY -> colors.primary
                        PanelTone.WARNING -> KrTheme.colors.warning
                        PanelTone.DANGER -> colors.error
                    }
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(PanelIcon))
            }
        }
        Box(side)
    }
}

/**
 * Rule G3: the screen-level error with "Try again" and the request id in small type. Offline it
 * says so and "Try again" waits for the network (rule G14); [needsNetwork] is false only at start,
 * where retrying is the one way on.
 */
@Composable
fun ErrorState(
    error: ApiError?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    retrying: Boolean = false,
    needsNetwork: Boolean = true,
) {
    val connected = LocalOnline.current
    val offline = error?.isNetwork == true || !connected
    EmptyState(
        title = stringResource(if (offline) R.string.common_offline else R.string.errors_generic_screen_title),
        text = stringResource(R.string.errors_generic_screen_text),
        icon = if (offline) Icons.Outlined.CloudOff else Icons.Outlined.ErrorOutline,
        tone = PanelTone.DANGER,
        actionLabel = stringResource(R.string.errors_generic_try_again),
        onAction = onRetry,
        actionEnabled = connected || !needsNetwork,
        actionBusy = retrying,
        footnote = error?.requestId?.let { text(R.string.errors_reference, "id" to it) },
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
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

/** A state that stands in for a whole screen: centred, with gutters, and it scrolls when tall. */
@Composable
fun StateScreen(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .contentWidth(Sizes.formWidth)
                .padding(horizontal = Spacing.gutter, vertical = Spacing.s24),
        verticalArrangement = Arrangement.spacedBy(Spacing.s16, Alignment.CenterVertically),
        content = content,
    )
}

/** The panel of specs/16 section 1.4, in place of a screen the profile's status refuses. */
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
    StateScreen(modifier) {
        EmptyState(
            title = stringResource(title),
            text = stringResource(body),
            icon = if (paused) Icons.Outlined.PauseCircle else Icons.Outlined.Cancel,
            tone = PanelTone.WARNING,
            actionLabel = stringResource(action),
            onAction = if (paused) onResume else onReopen,
            actionEnabled = !paused || LocalOnline.current,
            actionBusy = busy,
        )
    }
}

/**
 * A soft banner for profile and moderation states, notices and warnings: always an icon and
 * words (rule G13). [content] is what sits under the text, when it is more than one link or
 * button.
 */
@Composable
fun StatusBanner(
    text: String?,
    modifier: Modifier = Modifier,
    tone: StatusTone = StatusTone.INFO,
    title: String? = null,
    icon: ImageVector? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    actionEnabled: Boolean = true,
    announce: Boolean = false,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val look = toneColors(tone)
    val spoken = if (announce) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier
    val titleStyle = MaterialTheme.typography.titleSmall
    val textStyle = if (title == null) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodySmall
    Surface(
        color = look.container,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.fillMaxWidth().then(spoken),
    ) {
        CompositionLocalProvider(LocalTonalColor provides MaterialTheme.colorScheme.background) {
            IconTextLine(
                icon = icon ?: look.icon,
                style = if (title != null) titleStyle else textStyle,
                tint = look.accent,
                gap = Spacing.s12,
                modifier = Modifier.padding(horizontal = Spacing.s20, vertical = Spacing.s16),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                    if (title != null) Text(title, style = titleStyle)
                    if (text != null) Text(text, style = textStyle)
                    content?.invoke(this)
                    if (actionLabel != null && onAction != null) {
                        KrButton(
                            text = actionLabel,
                            onClick = onAction,
                            variant = KrButtonVariant.SECONDARY,
                            enabled = actionEnabled,
                            modifier = Modifier.padding(top = Spacing.s8),
                        )
                    }
                }
            }
        }
    }
}

/**
 * A banner the member can hide: the announcement on gold soft, the update prompt, the first-run
 * tip. [onAction] is a link under the words.
 */
@Composable
fun DismissibleBanner(
    text: String,
    icon: ImageVector,
    onClose: () -> Unit,
    closeLabel: String,
    modifier: Modifier = Modifier,
    container: Color = MaterialTheme.colorScheme.tertiaryContainer,
    iconTint: Color = MaterialTheme.colorScheme.onSurface,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val style = MaterialTheme.typography.bodySmall
    Surface(
        color = container,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(start = Spacing.s16, top = Spacing.s4, end = Spacing.s4, bottom = Spacing.s4),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            Box(Modifier.padding(top = Spacing.s12)) {
                FirstLineMark(style) {
                    Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(Sizes.iconSmall))
                }
            }
            Column(Modifier.weight(1f)) {
                MemberText(text, style = style, modifier = Modifier.padding(vertical = Spacing.s12))
                if (actionLabel != null && onAction != null) KrTextLink(actionLabel, onAction)
            }
            KrIconButton(icon = Icons.Outlined.Close, contentDescription = closeLabel, onClick = onClose)
        }
    }
}

/** Rule G14: "You are offline", in the inverse band above the screen. */
@Composable
fun OfflineBanner(modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    Surface(
        color = colors.inverseSurface,
        contentColor = colors.inverseOnSurface,
        modifier = modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = Spacing.s40)
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s8),
            contentAlignment = Alignment.Center,
        ) {
            IconText(
                icon = Icons.Outlined.CloudOff,
                text = stringResource(R.string.common_offline),
                style = MaterialTheme.typography.labelSmall,
                iconSize = Sizes.iconTiny,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** "Reference: {id}" in small type. */
@Composable
fun ReferenceLine(
    requestId: String?,
    modifier: Modifier = Modifier,
) {
    if (requestId == null) return
    CaptionText(text(R.string.errors_reference, "id" to requestId), modifier)
}

private val PanelPadding = PaddingValues(28.dp)
private val PanelDiamond = 10.dp
private val PanelIcon = 30.dp
