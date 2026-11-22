package com.khandanirishta.app.ui.theme

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp

/*
 * Space, size, stroke and elevation of DESIGN.md sections 4.2 and 5. Text is in sp and grows with
 * the reader; these stay in dp, so larger text gets the room instead of the space around it.
 */

/** The steps of the 4 dp scale. Use only these. */
object Spacing {
    val s4 = 4.dp
    val s8 = 8.dp
    val s12 = 12.dp
    val s16 = 16.dp
    val s20 = 20.dp
    val s24 = 24.dp
    val s32 = 32.dp
    val s40 = 40.dp
    val s48 = 48.dp
    val s56 = 56.dp
    val s64 = 64.dp
    val s80 = 80.dp

    /** The side of every screen on a phone. */
    val gutter = s20
}

object Sizes {
    val touch = 48.dp
    val touchLarge = 56.dp

    /** A row that is one switch. */
    val switchRow = 72.dp

    /** A nudge in the row of Home. */
    val nudge = 72.dp

    val icon = 24.dp
    val iconBar = 26.dp
    val iconSmall = 20.dp
    val iconMedium = 18.dp
    val iconTiny = 16.dp
    val iconBadge = 14.dp

    val topBar = 64.dp
    val bottomBar = 64.dp

    val arch40 = DpSize(40.dp, 50.dp)
    val arch46 = DpSize(46.dp, 58.dp)
    val arch48 = DpSize(48.dp, 60.dp)
    val arch56 = DpSize(56.dp, 70.dp)
    val arch64 = DpSize(64.dp, 80.dp)
    val arch96 = DpSize(96.dp, 120.dp)

    /** An icon in an arch. */
    val archIconSmall = DpSize(36.dp, 44.dp)
    val archIcon = DpSize(46.dp, 56.dp)
    val archIconLarge = DpSize(56.dp, 68.dp)

    /** The arch of a compact card. */
    val rowPhoto = DpSize(60.dp, 76.dp)

    /** The arch of a tile of "New members". */
    val tilePhoto = DpSize(156.dp, 195.dp)

    val cardMin = 272.dp
    val cardMax = 340.dp

    /** A profile gallery never grows past this. */
    val galleryMax = 380.dp

    /** Form columns. */
    val formWidth = 560.dp

    /** Lists and reading. */
    val columnWidth = 768.dp

    /** The content column. */
    val contentWidth = 1168.dp

    /** About 64 characters of body large. */
    val measure = 560.dp

    val diamond = 8.dp
    val countBadge = 24.dp
    val countBadgeSmall = 22.dp
    val matchRing = 160.dp
    val completenessRing = 116.dp
}

/** Line weights (DESIGN.md section 4.2). */
object Strokes {
    val hairline = 1.dp
    val control = 1.5.dp
    val focus = 3.dp

    /** The gold bar at the start of a quote. */
    val quote = 3.dp

    /** The gold line under a text link. */
    val link = 2.dp
}

/** Only floating layers cast a shadow (DESIGN.md section 5.3). Everything else is flat. */
object Elevation {
    val menu = 3.dp
    val panel = 2.dp
    val bar = 6.dp
    val none = 0.dp
}
