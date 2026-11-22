package com.khandanirishta.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.InnerArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.SmallArchShape
import com.khandanirishta.app.ui.theme.Strokes

/*
 * Arches (DESIGN.md sections 4.1 and 6.8): the frame of every member photo, monogram and icon
 * bubble. Nothing that stands for a member is a circle.
 */

/**
 * The first letters of the first and last words of a name, in capitals (DESIGN.md section 6.8):
 * "Muhammad Abdul Rehman S." gives "MS". The web's `initialsOf`.
 */
fun initialsOf(name: String?): String {
    val letters = name.orEmpty().split(WHITESPACE).mapNotNull(::firstLetter)
    val first = letters.firstOrNull() ?: return ""
    val last = if (letters.size > 1) letters.last() else ""
    return (first + last).uppercase()
}

private fun firstLetter(word: String): String? {
    var index = 0
    while (index < word.length) {
        val point = word.codePointAt(index)
        val length = Character.charCount(point)
        if (Character.isLetterOrDigit(point)) return word.substring(index, index + length)
        index += length
    }
    return null
}

private val WHITESPACE = Regex("\\s+")

/** The gold line inside an arch; [double] adds the fainter second line of the profile. */
@Composable
fun BoxScope.ArchInlay(
    modifier: Modifier = Modifier,
    double: Boolean = false,
) {
    val gold = KrTheme.colors.ornament
    Box(
        modifier
            .matchParentSize()
            .padding(InlayInset)
            .border(Strokes.hairline, gold, InnerArchShape),
    )
    if (double) {
        Box(
            Modifier
                .matchParentSize()
                .padding(SecondInlayInset)
                .border(Strokes.hairline, gold.copy(alpha = SECOND_INLAY_ALPHA), InnerArchShape),
        )
    }
}

/**
 * Initials in serif italic. They are a picture, so [size] is in dp and follows the arch they sit
 * in, not the reader's text size.
 */
@Composable
fun Monogram(
    name: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
) {
    val initials = remember(name) { initialsOf(name) }
    if (initials.isEmpty()) return
    val fontSize = with(LocalDensity.current) { size.toSp() }
    Text(
        text = initials,
        style = KrType.monogram,
        fontSize = fontSize,
        lineHeight = fontSize,
        color = color,
        softWrap = false,
        maxLines = 1,
        modifier = modifier.clearAndSetSemantics {},
    )
}

enum class MonogramTone { SAND, PAGE, PRIMARY }

/** A small arch holding a monogram. Decorative: the name is always written next to it. */
@Composable
fun MonogramArch(
    name: String?,
    modifier: Modifier = Modifier,
    size: DpSize = Sizes.arch46,
    tone: MonogramTone = MonogramTone.SAND,
) {
    val colors = MaterialTheme.colorScheme
    val fill =
        when (tone) {
            MonogramTone.SAND -> colors.surfaceContainer
            MonogramTone.PAGE -> colors.background
            MonogramTone.PRIMARY -> colors.primary
        }
    val primary = tone == MonogramTone.PRIMARY
    Box(
        modifier
            .size(size)
            .clip(ArchShape)
            .background(fill)
            .border(Strokes.control, if (primary) colors.primary else KrTheme.colors.ornament, ArchShape),
        contentAlignment = Alignment.Center,
    ) {
        Monogram(
            name = name,
            size = size.width * MONOGRAM_SHARE,
            color = if (primary) colors.onPrimary else colors.primary,
        )
    }
}

enum class ArchTone { TONAL, PRIMARY, SUCCESS, SOLID, WARNING, DANGER, OUTLINE }

/** An icon in a small arch, where the launch design had an icon in a circle. Decorative. */
@Composable
fun ArchIcon(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: DpSize = Sizes.archIcon,
    tone: ArchTone = ArchTone.PRIMARY,
) {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    val (fill, tint) =
        when (tone) {
            ArchTone.TONAL -> KrTheme.tonal to colors.onSurface
            ArchTone.PRIMARY -> colors.primaryContainer to colors.primary
            ArchTone.SUCCESS -> extra.successContainer to extra.success
            ArchTone.SOLID -> extra.success to extra.onSuccess
            ArchTone.WARNING -> extra.warningContainer to extra.warning
            ArchTone.DANGER -> colors.errorContainer to colors.error
            ArchTone.OUTLINE -> Color.Transparent to colors.primary
        }
    val outline =
        if (tone == ArchTone.OUTLINE) {
            Modifier.border(Strokes.control, extra.ornament, SmallArchShape)
        } else {
            Modifier
        }
    Box(
        modifier
            .size(size)
            .clip(SmallArchShape)
            .background(fill)
            .then(outline),
        contentAlignment = Alignment.Center,
    ) {
        val iconSize = if (size.width < Sizes.archIcon.width) Sizes.iconSmall else Sizes.icon
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
    }
}

private val InlayInset = 14.dp
private val SecondInlayInset = 23.dp
private const val SECOND_INLAY_ALPHA = 0.45f
private const val MONOGRAM_SHARE = 0.48f
