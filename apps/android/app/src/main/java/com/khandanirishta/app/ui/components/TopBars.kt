package com.khandanirishta.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/*
 * The top bars of DESIGN.md section 6.16. Material's TopAppBar has a fixed height and cuts a
 * title that wraps, so these are Material surfaces at least 64 tall that grow with the text. They
 * draw behind the status bar and keep clear of it and of cutouts.
 */

/** The frame of every top bar. */
@Composable
fun KrTopBar(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.background,
    divider: Boolean = true,
    content: @Composable () -> Unit,
) {
    val insets = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
    Surface(
        color = color,
        contentColor = MaterialTheme.colorScheme.onSurface,
        modifier = modifier.fillMaxWidth().semantics { isTraversalGroup = true },
    ) {
        CompositionLocalProvider(LocalTonalColor provides nestedTonal(color)) {
            Column {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .windowInsetsPadding(insets)
                            .heightIn(min = Sizes.topBar),
                    contentAlignment = Alignment.CenterStart,
                ) { content() }
                if (divider) RowDivider()
            }
        }
    }
}

@Composable
private fun BackButton(
    onBack: () -> Unit,
    enabled: Boolean = true,
) {
    KrIconButton(
        icon = Icons.AutoMirrored.Filled.ArrowBack,
        contentDescription = stringResource(R.string.a11y_back),
        onClick = onBack,
        enabled = enabled,
    )
}

/**
 * The top bar of a detail screen (specs/16 section 2.1): Back and the title, which wraps rather
 * than being cut. Without [onBack] there is no arrow (the first step of onboarding).
 */
@Composable
fun DetailTopBar(
    title: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    backEnabled: Boolean = true,
    actions: @Composable RowScope.() -> Unit = {},
) {
    KrTopBar(modifier) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.s4, vertical = Spacing.s8),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) BackButton(onBack, enabled = backEnabled)
            Column(
                Modifier
                    .weight(1f)
                    .padding(start = if (onBack == null) Spacing.s16 else 0.dp),
            ) {
                Text(title, style = KrType.name, modifier = Modifier.semantics { heading() })
                if (subtitle != null) CaptionText(subtitle)
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
                verticalAlignment = Alignment.CenterVertically,
                content = actions,
            )
        }
    }
}

/** The top of a tab root: the sand band with the title at 28 / 700 (DESIGN.md section 3.2). */
@Composable
fun TabTopBar(
    title: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    KrTopBar(modifier = modifier, color = MaterialTheme.colorScheme.surfaceContainer, divider = false) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(start = Spacing.gutter, top = Spacing.s8, end = Spacing.s8, bottom = Spacing.s8),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineMedium,
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics { heading() },
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
                verticalAlignment = Alignment.CenterVertically,
                content = actions,
            )
        }
    }
}

/** The top bar of Home: the wordmark, then the bell with its count. */
@Composable
fun HomeTopBar(
    unread: Long,
    onNotifications: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // The badge grows upwards from the bell, so the bar makes room rather than reach the status bar.
    val room = (countLineHeight() - (Sizes.touch - Sizes.iconBar) + Spacing.s4).coerceAtLeast(Spacing.s4)
    KrTopBar(modifier) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(start = Spacing.s16, top = room, end = Spacing.s8, bottom = Spacing.s4),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Wordmark(Modifier.weight(1f))
            NotificationBell(count = unread, onClick = onNotifications)
        }
    }
}

/** The bell of Home (specs/16 section 2.2). Its badge grows upwards, away from the bell. */
@Composable
fun NotificationBell(
    count: Long,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val label =
        if (count > 0) {
            text(R.string.common_nav_notifications_count, "count" to Formatters.badgeCount(count))
        } else {
            stringResource(R.string.common_nav_notifications)
        }
    Box(modifier.size(Sizes.touch)) {
        IconButton(onClick = onClick, modifier = Modifier.size(Sizes.touch)) {
            Icon(
                Icons.Outlined.NotificationsNone,
                contentDescription = label,
                modifier = Modifier.size(Sizes.iconBar),
            )
        }
        CountBadge(
            count = count,
            tone = CountTone.INVERSE,
            small = true,
            decorative = true,
            modifier =
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(bottom = Sizes.iconBar)
                    .wrapContentHeight(align = Alignment.Bottom, unbounded = true)
                    .offset(x = BadgeOverhang),
        )
    }
}

/**
 * The top bar of a profile: Back, the name, then icon-and-label buttons for Shortlist and More.
 * The only place a name is cut, because the full name is right below. At large text the buttons
 * take a line of their own.
 */
@Composable
fun ProfileTopBar(
    name: String?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    KrTopBar(modifier) {
        AdaptiveRow(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.s4, vertical = Spacing.s4),
            spacing = Spacing.s4,
            lineSpacing = Spacing.s4,
        ) {
            Row(
                modifier = Modifier.grow(basis = BarNameBasis),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BackButton(onBack)
                if (name != null) {
                    Text(
                        text = name,
                        style = KrType.name,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier =
                            Modifier
                                .weight(1f)
                                .clearAndSetSemantics {},
                    )
                }
            }
            if (actions != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s8), content = actions)
            }
        }
    }
}

/** An icon over its label, at least 56 tall, for a top bar. */
@Composable
fun BarAction(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = MaterialTheme.colorScheme.onSurface,
) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier =
            modifier
                .tappable(shape = MaterialTheme.shapes.medium, onClick = onClick, enabled = enabled)
                .heightIn(min = Sizes.touchLarge)
                .widthIn(min = Sizes.touchLarge)
                .padding(Spacing.s4),
        verticalArrangement = Arrangement.spacedBy(Spacing.s4, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (enabled) tint else colors.onSurfaceVariant,
            modifier = Modifier.size(BarActionIcon),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (enabled) colors.onSurface else colors.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/** The brand mark: two arches and a diamond. Decorative: the name beside it is the text. */
@Composable
fun BrandMark(
    modifier: Modifier = Modifier,
    height: Dp = DefaultMark,
) {
    Image(
        painter = painterResource(R.drawable.ic_logo_mark),
        contentDescription = null,
        modifier = modifier.size(width = height * MARK_RATIO, height = height),
    )
}

/** The mark and the name in serif, growing with the text. The name wraps and is never cut. */
@Composable
fun Wordmark(
    modifier: Modifier = Modifier,
    large: Boolean = false,
) {
    val style = if (large) KrType.wordmarkLarge else KrType.wordmark
    val markHeight = with(LocalDensity.current) { (style.fontSize * MARK_TO_TEXT).toDp() }
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrandMark(height = markHeight)
        Text(
            text = stringResource(R.string.app_name),
            style = style,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f, fill = false),
        )
    }
}

private val BadgeOverhang = 4.dp
private val BarNameBasis = 120.dp
private val BarActionIcon = 22.dp
private val DefaultMark = 36.dp
private const val MARK_RATIO = 30f / 36f
private const val MARK_TO_TEXT = 1.14f
