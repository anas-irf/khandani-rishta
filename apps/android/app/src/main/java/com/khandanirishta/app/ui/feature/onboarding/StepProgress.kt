package com.khandanirishta.app.ui.feature.onboarding

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The progress indicator of 07 section 2.3: four segments, one per group, each filled in
 * proportion to the completed steps of its group; under it the group's name and "Step N of 11".
 * TalkBack hears how much of each group is done. Display only, not a navigation control.
 */
@Composable
internal fun StepProgress(
    step: String,
    currentStep: String,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val done =
        remember(currentStep) {
            val current = Steps.index(currentStep).let { if (it < 0) Steps.ORDER.size else it }
            Steps.GROUPS.map { group -> group.steps.count { Steps.index(it) < current } }
        }
    val description =
        remember(res, done) {
            val groups =
                Steps.GROUPS.mapIndexed { index, group ->
                    res.text(
                        R.string.onboarding_progress_group_done,
                        "group" to res.getString(group.name),
                        "done" to done[index],
                        "total" to group.steps.size,
                    )
                }
            (listOf(res.getString(R.string.onboarding_progress_label)) + groups).joinToString(". ")
        }
    val shownGroup = Steps.groupOf(step)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clearAndSetSemantics { contentDescription = description },
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            Steps.GROUPS.forEachIndexed { index, group ->
                Segment(
                    share = done[index].toFloat() / group.steps.size,
                    shown = group == shownGroup,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        AdaptiveRow(
            modifier = Modifier.semantics(mergeDescendants = true) {},
            lineSpacing = Spacing.s4,
            verticalAlignment = Alignment.Top,
        ) {
            Text(
                text = stringResource(shownGroup.name),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.grow(),
            )
            Text(
                text =
                    text(
                        R.string.onboarding_progress_step,
                        "n" to Steps.index(step) + 1,
                        "total" to Steps.ORDER.size,
                    ),
                style = KrType.caption.merge(KrType.numbers),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** One group: its done share in primary, on primary soft for the group the member is in. */
@Composable
private fun Segment(
    share: Float,
    shown: Boolean,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val track = if (shown) colors.primaryContainer else colors.surfaceContainerHigh
    val fill = colors.primary
    val filled = animateFloatAsState(share, Motion.base(), label = "onboarding-progress")
    Box(
        modifier
            .height(SegmentHeight)
            .clip(PillShape)
            .drawBehind {
                drawRect(track)
                val width = size.width * filled.value
                val start = if (layoutDirection == LayoutDirection.Rtl) size.width - width else 0f
                drawRect(fill, topLeft = Offset(start, 0f), size = Size(width, size.height))
            },
    )
}

private val SegmentHeight = 6.dp
