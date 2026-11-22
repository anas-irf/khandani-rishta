package com.khandanirishta.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.LayoutModifier
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/**
 * The looks of a button (DESIGN.md section 6.1). One primary per screen area; secondary actions
 * are outlined and tertiary ones quiet.
 */
enum class KrButtonVariant {
    /** The one main action of an area. */
    PRIMARY,

    /** "Decline", "Shortlist", "Withdraw". */
    SECONDARY,

    /** "More", "Not interested", "Report". */
    QUIET,

    /** The main action on a primary or inverse band. */
    INVERSE,

    /** Confirms a negative choice that destroys nothing. */
    INK,

    /** Confirms a destructive choice. Only in confirmations. */
    DANGER,
}

enum class KrButtonSize {
    /** 48 tall. */
    DEFAULT,

    /** 48 tall with narrow sides, for two buttons sharing a card. */
    COMPACT,

    /** 56 tall with the 18 / 700 label: main actions on phones, dialogs and answers. */
    LARGE,
}

/**
 * The button of every screen (DESIGN.md section 6.1): a pill, at least 48 tall, whose label wraps
 * rather than being cut. A disabled one is sand strong with secondary text, never faded, because
 * it often says something to read ("Interest sent"). While [loading] it keeps its colours, shows
 * a spinner and takes no second tap.
 *
 * Primary and inverse buttons are 56 tall unless [size] says otherwise. Put buttons that share a
 * line in an `AdaptiveRow`, so they stack when they no longer fit.
 */
@Composable
fun KrButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: KrButtonVariant = KrButtonVariant.PRIMARY,
    size: KrButtonSize = defaultSize(variant),
    icon: ImageVector? = null,
    iconTint: Color = Color.Unspecified,
    enabled: Boolean = true,
    loading: Boolean = false,
    fullWidth: Boolean = false,
    contentDescription: String? = null,
) {
    val interactions = remember { MutableInteractionSource() }
    val look = buttonLook(variant, interactions)
    val active = enabled || loading
    val large = size == KrButtonSize.LARGE
    val busyLabel = stringResource(R.string.shared_list_loading)
    val button: @Composable () -> Unit = {
        Button(
            onClick = onClick,
            enabled = enabled && !loading,
            shape = PillShape,
            colors =
                ButtonDefaults.buttonColors(
                    containerColor = look.fill,
                    contentColor = look.content,
                    disabledContainerColor = if (loading) look.fill else KrTheme.colors.disabledContainer,
                    disabledContentColor = if (loading) look.content else KrTheme.colors.onDisabledContainer,
                ),
            elevation = null,
            border = if (active) look.border else null,
            contentPadding =
                when (size) {
                    KrButtonSize.LARGE -> LargePadding
                    KrButtonSize.DEFAULT -> DefaultPadding
                    KrButtonSize.COMPACT -> CompactPadding
                },
            interactionSource = interactions,
            modifier =
                modifier
                    .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
                    .heightIn(min = if (large) Sizes.touchLarge else Sizes.touch)
                    .semantics {
                        if (contentDescription != null) this.contentDescription = contentDescription
                        if (loading) stateDescription = busyLabel
                    },
        ) {
            if (loading) {
                // Without an icon to replace, the spinner asks for no width: the button keeps its place.
                ButtonSpinner(if (icon == null) Modifier.askingForNoWidth() else Modifier)
                Spacer(if (icon == null) Modifier.askingForNoWidth().width(IconGap) else Modifier.width(IconGap))
            } else if (icon != null) {
                val tint = if (enabled && iconTint != Color.Unspecified) iconTint else LocalContentColor.current
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(Sizes.iconSmall))
                Spacer(Modifier.width(IconGap))
            }
            Text(
                text = text,
                style = if (large) KrType.buttonLarge else MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
    }
    if (variant in FILLED) InvertedFocusRing(button) else button()
}

private fun defaultSize(variant: KrButtonVariant): KrButtonSize =
    when (variant) {
        KrButtonVariant.PRIMARY, KrButtonVariant.INVERSE -> KrButtonSize.LARGE
        else -> KrButtonSize.DEFAULT
    }

@Immutable
private data class ButtonLook(
    val fill: Color,
    val content: Color,
    val border: BorderStroke? = null,
)

@Composable
private fun buttonLook(
    variant: KrButtonVariant,
    interactions: MutableInteractionSource,
): ButtonLook {
    val pressed by interactions.collectIsPressedAsState()
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    return when (variant) {
        KrButtonVariant.PRIMARY -> {
            ButtonLook(if (pressed) extra.primaryPressed else colors.primary, colors.onPrimary)
        }

        KrButtonVariant.SECONDARY -> {
            ButtonLook(Color.Transparent, LocalContentColor.current, BorderStroke(Strokes.control, colors.outline))
        }

        KrButtonVariant.QUIET -> {
            ButtonLook(Color.Transparent, LocalContentColor.current, BorderStroke(Strokes.hairline, colors.outline))
        }

        KrButtonVariant.INVERSE -> {
            ButtonLook(if (pressed) extra.card else colors.background, colors.primary)
        }

        KrButtonVariant.INK -> {
            ButtonLook(if (pressed) extra.textSecondary else colors.onSurface, colors.background)
        }

        KrButtonVariant.DANGER -> {
            ButtonLook(if (pressed) extra.dangerPressed else colors.error, colors.onError)
        }
    }
}

private val FILLED = setOf(KrButtonVariant.PRIMARY, KrButtonVariant.INK, KrButtonVariant.DANGER)

/** The spinner inside a button (specs/16 rule G1 allows spinners only there and for "load more"). */
@Composable
fun ButtonSpinner(
    modifier: Modifier = Modifier,
    color: Color = LocalContentColor.current,
) {
    CircularProgressIndicator(
        modifier = modifier.size(Sizes.iconSmall),
        color = color,
        trackColor = Color.Transparent,
        strokeWidth = SpinnerStroke,
    )
}

/**
 * A link that stands on its own (DESIGN.md section 6.2): 17 / 600 over a 2 dp gold line, in a
 * 48 tall hit area. "See all", "Read the safety tips".
 */
@Composable
fun KrTextLink(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    style: TextStyle = MaterialTheme.typography.labelLarge,
    contentDescription: String? = null,
) {
    val color = LocalContentColor.current
    val underline = KrTheme.colors.ornament
    var lines by remember { mutableStateOf<TextLayoutResult?>(null) }
    TextButton(
        onClick = onClick,
        enabled = enabled,
        shape = MaterialTheme.shapes.small,
        colors =
            ButtonDefaults.textButtonColors(
                contentColor = color,
                disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        contentPadding = LinkPadding,
        modifier =
            modifier
                .defaultMinSize(minWidth = Sizes.touch, minHeight = Sizes.touch)
                .semantics { if (contentDescription != null) this.contentDescription = contentDescription },
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(Sizes.iconSmall))
            Spacer(Modifier.width(Spacing.s8))
        }
        Text(
            text = text,
            style = style,
            onTextLayout = { lines = it },
            modifier =
                Modifier
                    .weight(1f, fill = false)
                    .drawWithContent {
                        drawContent()
                        val layout = lines
                        if (enabled && layout != null) {
                            val stroke = Strokes.link.toPx()
                            for (line in 0 until layout.lineCount) {
                                val y = layout.getLineBaseline(line) + LinkUnderlineOffset.toPx()
                                drawLine(
                                    color = underline,
                                    start = Offset(layout.getLineLeft(line), y),
                                    end = Offset(layout.getLineRight(line), y),
                                    strokeWidth = stroke,
                                )
                            }
                        }
                    },
        )
    }
}

/** An icon-only control: 48 square, always labelled. */
@Composable
fun KrIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = LocalContentColor.current,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        colors =
            IconButtonDefaults.iconButtonColors(
                contentColor = tint,
                disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        modifier = modifier.size(Sizes.touch),
    ) {
        Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(Sizes.icon))
    }
}

/** An outlined 48 circle with an icon: the gallery's arrows, copy, steppers. */
@Composable
fun KrOutlinedIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    OutlinedIconButton(
        onClick = onClick,
        enabled = enabled,
        colors =
            IconButtonDefaults.outlinedIconButtonColors(
                contentColor = LocalContentColor.current,
                disabledContainerColor = KrTheme.colors.disabledContainer,
                disabledContentColor = KrTheme.colors.onDisabledContainer,
            ),
        border = if (enabled) BorderStroke(Strokes.control, colors.outline) else null,
        modifier = modifier.size(Sizes.touch),
    ) {
        Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(Sizes.iconSmall))
    }
}

private val IconGap = 10.dp
private val SpinnerStroke = 2.dp
private val LinkUnderlineOffset = 6.dp
private val DefaultPadding = PaddingValues(horizontal = 22.dp, vertical = Spacing.s8)
private val CompactPadding = PaddingValues(horizontal = Spacing.s12, vertical = Spacing.s8)
private val LargePadding = PaddingValues(horizontal = 28.dp, vertical = Spacing.s8)
private val LinkPadding = PaddingValues(horizontal = 0.dp, vertical = Spacing.s12)

/** Is drawn at its own width and counts as none when a row asks how wide the button wants to be. */
private fun Modifier.askingForNoWidth(): Modifier = this then NoWidthAsked

private data object NoWidthAsked : LayoutModifier {
    override fun MeasureScope.measure(
        measurable: Measurable,
        constraints: Constraints,
    ): MeasureResult {
        val placeable = measurable.measure(constraints)
        return layout(placeable.width, placeable.height) { placeable.placeRelative(0, 0) }
    }

    override fun IntrinsicMeasureScope.minIntrinsicWidth(
        measurable: IntrinsicMeasurable,
        height: Int,
    ): Int = 0

    override fun IntrinsicMeasureScope.maxIntrinsicWidth(
        measurable: IntrinsicMeasurable,
        height: Int,
    ): Int = 0
}
