package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes

/** The two rings (DESIGN.md section 6.5, and Home). */
enum class RingKind { MATCH, COMPLETENESS }

/**
 * A percentage as a ring with the number inside, in tabular figures. [description] is what
 * TalkBack reads ("87% match"). The ring grows with the text it holds.
 */
@Composable
fun ProgressRing(
    value: Int,
    kind: RingKind,
    description: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
) {
    val match = kind == RingKind.MATCH
    val colors = MaterialTheme.colorScheme
    val percent = value.coerceIn(0, MAX_PERCENT)
    val figure = if (match) KrType.figureLarge else KrType.figureMedium
    val base = if (match) Sizes.matchRing else Sizes.completenessRing
    // Scaled by what the number itself scales by, which is gentler than fontScale for large sizes.
    val growth = with(LocalDensity.current) { figure.fontSize.toDp().value / figure.fontSize.value }
    Box(
        modifier =
            modifier
                .clearAndSetSemantics { contentDescription = description }
                .size(base * growth.coerceIn(1f, MAX_GROWTH)),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(
            progress = { percent.toFloat() / MAX_PERCENT },
            modifier = Modifier.matchParentSize(),
            color = if (match) KrTheme.colors.success else colors.primary,
            trackColor = if (match) KrTheme.colors.successContainer else colors.primaryContainer,
            strokeWidth = if (match) MatchStroke else CompletenessStroke,
            // A round cap would draw a dot at zero.
            strokeCap = if (percent == 0) StrokeCap.Butt else StrokeCap.Round,
            gapSize = 0.dp,
        )
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("$percent%", style = figure, color = colors.onSurface, softWrap = false)
            if (caption != null) {
                Text(
                    text = caption,
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                    color = if (match) KrTheme.colors.success else colors.primary,
                )
            }
        }
    }
}

enum class MeterTone { PRIMARY, SUCCESS }

/** A bar for work of unknown length outside a button, where spinners belong (16 rule G1). */
@Composable
fun LoadingLine(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.shared_list_loading)
    LinearProgressIndicator(
        color = MaterialTheme.colorScheme.primary,
        trackColor = MaterialTheme.colorScheme.primaryContainer,
        modifier =
            modifier
                .fillMaxWidth()
                .semantics {
                    contentDescription = label
                    liveRegion = LiveRegionMode.Polite
                },
    )
}

/**
 * A flat bar from the start edge, 12 tall: a fit, or an upload on its way. The words beside it
 * say the number; [description] is for a bar that stands alone.
 */
@Composable
fun KrMeter(
    progress: () -> Float,
    modifier: Modifier = Modifier,
    tone: MeterTone = MeterTone.PRIMARY,
    description: String? = null,
) {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    val success = tone == MeterTone.SUCCESS
    LinearProgressIndicator(
        progress = progress,
        color = if (success) extra.success else colors.primary,
        trackColor = if (success) extra.successContainer else colors.primaryContainer,
        gapSize = 0.dp,
        drawStopIndicator = {},
        modifier =
            modifier
                .clearAndSetSemantics { if (description != null) contentDescription = description }
                .fillMaxWidth()
                .height(MeterHeight)
                .clip(PillShape),
    )
}

private const val MAX_PERCENT = 100
private const val MAX_GROWTH = 1.8f
private val MatchStroke = 11.dp
private val CompletenessStroke = 10.dp
private val MeterHeight = 12.dp
