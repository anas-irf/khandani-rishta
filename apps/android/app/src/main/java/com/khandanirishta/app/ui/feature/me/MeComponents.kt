package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.khandanirishta.app.ui.components.ButtonSpinner
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.FirstLineMark
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.components.exceptBottom
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.components.stableKey
import com.khandanirishta.app.ui.components.toneColors
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import kotlin.math.max

/*
 * What the own-profile, photo and verification screens share on top of ui/components: their
 * scrolling frame, the own photo in an arch, the grid of arches and the status under an arch.
 */

/**
 * A screen of bands under a detail bar. [bottomBar] is the step's action bar, when it has one;
 * without one the bands scroll on behind the navigation bar.
 */
@Composable
internal fun MeScaffold(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    scrollState: ScrollState = rememberScrollState(),
    bottomBar: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        modifier = modifier,
        topBar = { DetailTopBar(title = title, onBack = onBack) },
        bottomBar = bottomBar ?: {},
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        val outside = if (bottomBar == null) padding.exceptBottom() else padding
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(outside)
                    .consumeWindowInsets(outside)
                    .imePadding()
                    .verticalScroll(scrollState)
                    .navigationBarsPadding(),
            content = content,
        )
    }
}

/** A centred block for one step or state of a flow (the web's `StepPanel`). */
@Composable
internal fun StepPanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    TonalPanel(
        modifier = modifier,
        shape = MaterialTheme.shapes.extraLarge,
        padding = StepPadding,
        spacing = Spacing.s16,
        horizontalAlignment = Alignment.CenterHorizontally,
        content = content,
    )
}

/** One line of a plain list: a muted dot on the first line. A tick would say "verified". */
@Composable
internal fun BulletLine(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
) {
    val dot = MaterialTheme.colorScheme.onSurfaceVariant
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        FirstLineMark(style) {
            Box(
                Modifier
                    .size(BulletSize)
                    .background(dot, PillShape),
            )
        }
        Text(text, style = style, modifier = Modifier.weight(1f))
    }
}

/**
 * One of the member's own photos. It takes its size from [modifier], so nothing moves while it
 * loads, and shows [placeholder] while there is no file to show or it did not load. Without a
 * [description] it is decoration for the control around it.
 */
@Composable
internal fun OwnPhotoImage(
    url: String?,
    description: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    placeholder: @Composable BoxScope.() -> Unit = { UnreadablePhoto() },
) {
    val key = url?.let(::stableKey)
    var loaded by remember(key) { mutableStateOf(false) }
    var failed by remember(url) { mutableStateOf(false) }
    val showImage = url != null && !failed
    val ground = if (showImage && !loaded) KrTheme.colors.skeleton else KrTheme.tonal
    val described =
        if (description == null) {
            Modifier
        } else {
            Modifier.semantics {
                contentDescription = description
                role = Role.Image
            }
        }
    Box(modifier.then(described).background(ground), contentAlignment = Alignment.Center) {
        if (showImage) {
            AsyncImage(
                model = rememberStableImageRequest(url),
                contentDescription = null,
                contentScale = contentScale,
                onSuccess = { loaded = true },
                onError = { failed = true },
                modifier = Modifier.matchParentSize(),
            )
        } else {
            placeholder()
        }
    }
}

@Composable
private fun UnreadablePhoto() {
    Icon(
        Icons.Outlined.BrokenImage,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(Sizes.icon),
    )
}

/**
 * The grid of arches of `ME-PHOTOS` and the photos step (the web's `arch-grid`): three across,
 * or two where a third would be too narrow for a status at the reader's text size. The children
 * share one parent, so a photo that moves keeps its focus.
 */
@Composable
internal fun ArchGrid(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Layout(content = content, modifier = modifier.fillMaxWidth(), measurePolicy = ArchGridPolicy)
}

private val ArchGridPolicy =
    MeasurePolicy { measurables, constraints ->
        val gap = GridGap.roundToPx()
        val width = constraints.maxWidth
        val third = (width - gap * (MOST_COLUMNS - 1)) / MOST_COLUMNS
        val columns = if (third >= CellMin.toPx() * max(1f, fontScale)) MOST_COLUMNS else FEWEST_COLUMNS
        val cell = ((width - gap * (columns - 1)) / columns).coerceAtLeast(0)
        val rows =
            measurables
                .map { it.measure(Constraints(minWidth = cell, maxWidth = cell)) }
                .chunked(columns)
        val heights = rows.map { row -> row.maxOf { it.height } }
        val total = heights.sum() + gap * (rows.size - 1).coerceAtLeast(0)
        layout(width, total.coerceIn(constraints.minHeight, constraints.maxHeight)) {
            var y = 0
            rows.forEachIndexed { index, row ->
                row.forEachIndexed { column, placeable -> placeable.placeRelative(column * (cell + gap), y) }
                y += heights[index] + gap
            }
        }
    }

/**
 * The status under an arch, never on the photo. A grid cell is narrower than a `StatusPill`
 * needs, so here the words may go under their icon instead of breaking inside a word.
 */
@Composable
internal fun ArchStatus(
    text: String,
    tone: StatusTone,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    spinning: Boolean = false,
) {
    val look = toneColors(tone)
    Surface(
        color = look.container,
        contentColor = look.accent,
        shape = MaterialTheme.shapes.medium,
        modifier = modifier,
    ) {
        FlowRow(
            modifier = Modifier.padding(horizontal = Spacing.s4, vertical = Spacing.s4),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s4, Alignment.CenterHorizontally),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            if (spinning) {
                ButtonSpinner(Modifier.size(Sizes.iconBadge))
            } else {
                Icon(icon ?: look.icon, contentDescription = null, modifier = Modifier.size(Sizes.iconBadge))
            }
            Text(text, style = CellStatusStyle, textAlign = TextAlign.Center)
        }
    }
}

private val BulletSize = 6.dp

// "Processing..." is wider than a cell at 200% text: it breaks at a syllable, not at a letter.
private val CellStatusStyle = KrType.badge.copy(hyphens = Hyphens.Auto, lineBreak = LineBreak.Paragraph)

private val GridGap = Spacing.s12

// The narrowest cell of the web's grid, 5.75rem: it grows with the text.
private val CellMin = 92.dp
private val StepPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s32)
private const val MOST_COLUMNS = 3
private const val FEWEST_COLUMNS = 2
