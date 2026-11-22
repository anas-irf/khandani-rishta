package com.khandanirishta.app.ui.components

import android.animation.ValueAnimator
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.node.CompositionLocalConsumerModifierNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.currentValueOf
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.LocalExtendedColors
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import kotlinx.coroutines.launch

/*
 * Loading shapes (specs/16 rule G1): a skeleton in the shape of what is coming, announced once.
 * The pulse is one colour that is read only while drawing, and it stands still when animations
 * are off.
 */

/** Fills its bounds with the skeleton colour, breathing towards the highlight. */
fun Modifier.skeleton(): Modifier = this then SkeletonElement

private data object SkeletonElement : ModifierNodeElement<SkeletonNode>() {
    override fun create(): SkeletonNode = SkeletonNode()

    override fun update(node: SkeletonNode) = Unit

    override fun InspectorInfo.inspectableProperties() {
        name = "skeleton"
    }
}

private class SkeletonNode :
    Modifier.Node(),
    DrawModifierNode,
    CompositionLocalConsumerModifierNode {
    private val breath = Animatable(0f)

    override fun onAttach() {
        if (!ValueAnimator.areAnimatorsEnabled()) return
        coroutineScope.launch {
            breath.snapTo(0f)
            breath.animateTo(
                targetValue = BREATH,
                animationSpec = infiniteRepeatable(tween(BREATH_MILLIS), RepeatMode.Reverse),
            )
        }
    }

    override fun ContentDrawScope.draw() {
        val colors = currentValueOf(LocalExtendedColors)
        drawRect(lerp(colors.skeleton, colors.skeletonHighlight, breath.value))
        drawContent()
    }
}

private const val BREATH = 0.6f
private const val BREATH_MILLIS = 900

/** One block of a skeleton. */
@Composable
fun SkeletonBox(
    modifier: Modifier = Modifier,
    shape: Shape = MaterialTheme.shapes.small,
) {
    Box(
        modifier
            .clip(shape)
            .skeleton(),
    )
}

/** The one thing a screen's skeletons say to TalkBack: "Loading". */
@Composable
fun LoadingRegion(
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.s16,
    content: @Composable ColumnScope.() -> Unit,
) {
    val label = stringResource(R.string.shared_list_loading)
    Column(
        modifier =
            modifier.clearAndSetSemantics {
                contentDescription = label
                liveRegion = LiveRegionMode.Polite
            },
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

/** The shape of a compact card. */
@Composable
fun RowSkeleton(modifier: Modifier = Modifier) {
    Column(modifier) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = Spacing.s12),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s16),
        ) {
            SkeletonBox(Modifier.size(Sizes.rowPhoto), shape = ArchShape)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                SkeletonBox(Modifier.fillMaxWidth(NAME_SHARE).height(Spacing.s24))
                SkeletonBox(Modifier.fillMaxWidth(LINE_SHARE).height(Spacing.s16))
                SkeletonBox(Modifier.fillMaxWidth(BADGE_SHARE).height(Spacing.s24), shape = PillShape)
            }
        }
        RowDivider()
    }
}

/** The shape of a full-size card. */
@Composable
fun ProfileCardSkeleton(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        SkeletonBox(Modifier.fillMaxWidth().aspectRatio(ARCH_RATIO), shape = ArchShape)
        SkeletonBox(Modifier.fillMaxWidth(NAME_SHARE).height(NameHeight))
        SkeletonBox(Modifier.fillMaxWidth().height(Spacing.s16))
        SkeletonBox(Modifier.fillMaxWidth(LINE_SHARE).height(Spacing.s16))
        SkeletonBox(Modifier.fillMaxWidth().height(Sizes.touch), shape = PillShape)
    }
}

/** The first load of a list of compact cards. Its caller gives the screen's gutters. */
@Composable
fun ListSkeleton(
    modifier: Modifier = Modifier,
    rows: Int = LIST_ROWS,
) {
    LoadingRegion(modifier.fillMaxWidth(), spacing = 0.dp) {
        repeat(rows) { RowSkeleton() }
    }
}

/** The first load of a list of full-size cards. */
@Composable
fun CardSkeleton(
    modifier: Modifier = Modifier,
    cards: Int = 2,
) {
    LoadingRegion(modifier.fillMaxWidth(), spacing = Spacing.s40) {
        repeat(cards) {
            ProfileCardSkeleton(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .widthIn(max = Sizes.cardMax),
            )
        }
    }
}

/** The first load of a form or a settings screen. */
@Composable
fun FormSkeleton(
    modifier: Modifier = Modifier,
    fields: Int = FORM_FIELDS,
) {
    LoadingRegion(modifier.fillMaxWidth(), spacing = Spacing.s20) {
        repeat(fields) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                SkeletonBox(Modifier.fillMaxWidth(BADGE_SHARE).height(Spacing.s20))
                SkeletonBox(Modifier.fillMaxWidth().height(Sizes.touchLarge), shape = MaterialTheme.shapes.medium)
            }
        }
    }
}

private const val NAME_SHARE = 0.6f
private const val LINE_SHARE = 0.8f
private const val BADGE_SHARE = 0.4f
private const val LIST_ROWS = 6
private const val FORM_FIELDS = 6
private val NameHeight = 28.dp
