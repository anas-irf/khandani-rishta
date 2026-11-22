package com.khandanirishta.app.ui.components

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import com.khandanirishta.app.ui.theme.Sizes

/**
 * The height of one line of [style] as Compose lays it out. Android scales large text by less than
 * small text, and Compose keeps a line in proportion to its scaled font: the line height's own
 * `toDp()` comes out too low at large text.
 */
internal fun Density.lineHeightOf(style: TextStyle): Dp =
    if (style.lineHeight.isSp && style.fontSize.isSp) {
        style.fontSize.toDp() * (style.lineHeight.value / style.fontSize.value)
    } else {
        Sizes.icon
    }
