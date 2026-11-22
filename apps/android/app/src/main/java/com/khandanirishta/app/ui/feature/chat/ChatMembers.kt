package com.khandanirishta.app.ui.feature.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.components.MemberAvatar
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.theme.Sizes
import kotlin.math.roundToInt

/*
 * What the chat list, the conversation and the connection details share: the other member's arch
 * and the few rules that keep them readable at 200% text.
 */

/**
 * The other member's small arch or, when `other` is null, the silhouette of 15 section 4.7. It is
 * decoration: the name is always beside it and says the photo's state ([spokenName]).
 */
@Composable
internal fun OtherAvatar(
    other: ProfileCard?,
    modifier: Modifier = Modifier,
    size: DpSize = Sizes.arch46,
) {
    MemberAvatar(
        photo = other?.photo,
        name = other?.displayName,
        gender = other?.gender ?: otherGender(LocalMe.current?.profile?.gender),
        size = size,
        decorative = true,
        modifier = modifier,
    )
}

/** The name as TalkBack reads it: then the state of the photo (DESIGN.md section 8, item 3). */
@Composable
internal fun spokenName(
    other: ProfileCard?,
    name: String,
): String =
    when {
        other == null -> name
        other.photo == null -> "$name. ${stringResource(R.string.shared_photo_none)}"
        other.photo.isBlurred -> "$name. ${stringResource(R.string.a11y_private_photo)}"
        else -> name
    }

/** Text at 150% or more, where the conversation trades ornament for room to read. */
@Composable
internal fun isLargeText(): Boolean = LocalDensity.current.fontScale >= LARGE_TEXT

/**
 * At most [share] of the height that is left, though never less than [atLeast] while there is
 * that much, so a banner or a long draft never pushes the messages or the Send button off a
 * small screen. What is inside scrolls.
 */
internal fun Modifier.maxHeightShare(
    share: Float,
    atLeast: Dp = 0.dp,
): Modifier =
    layout { measurable, constraints ->
        val limit =
            if (constraints.hasBoundedHeight) {
                (constraints.maxHeight * share)
                    .roundToInt()
                    .coerceAtLeast(minOf(atLeast.roundToPx(), constraints.maxHeight))
                    .coerceAtLeast(constraints.minHeight)
            } else {
                constraints.maxHeight
            }
        val placeable = measurable.measure(constraints.copy(maxHeight = limit))
        layout(placeable.width, placeable.height) { placeable.place(0, 0) }
    }

private const val LARGE_TEXT = 1.5f
