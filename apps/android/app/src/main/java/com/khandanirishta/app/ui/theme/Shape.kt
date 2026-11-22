package com.khandanirishta.app.ui.theme

import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// The radii of DESIGN.md section 4.1.

internal val AppShapes =
    Shapes(
        extraSmall = RoundedCornerShape(8.dp),
        small = RoundedCornerShape(10.dp),
        medium = RoundedCornerShape(16.dp),
        large = RoundedCornerShape(24.dp),
        extraLarge = RoundedCornerShape(28.dp),
    )

/** Buttons, chips of one line, badges, tags, switch tracks. A pill never holds two lines. */
val PillShape = RoundedCornerShape(percent = 50)

/** Multi-line rows: switch rows, radio cards, message templates. */
val RowShape = RoundedCornerShape(20.dp)

/** The action bar and bottom sheets. */
val SheetShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)

/** The items of a menu. */
val MenuItemShape = RoundedCornerShape(14.dp)

/** Half circle on top (50% of the width), [base] corners at the bottom. Use on 4:5 boxes. */
fun archShape(base: Dp = 16.dp): RoundedCornerShape =
    RoundedCornerShape(
        topStart = CornerSize(50),
        topEnd = CornerSize(50),
        bottomEnd = CornerSize(base),
        bottomStart = CornerSize(base),
    )

/** Every member photo and monogram. */
val ArchShape = archShape()

/** The line inside an arch, square badges and decorative arches. */
val InnerArchShape = archShape(12.dp)

/** An icon in a small arch. */
val SmallArchShape = archShape(8.dp)

/** The gallery of a profile. */
val LargeArchShape = archShape(22.dp)

/** Width to height of every member photo. */
const val ARCH_RATIO = 4f / 5f
