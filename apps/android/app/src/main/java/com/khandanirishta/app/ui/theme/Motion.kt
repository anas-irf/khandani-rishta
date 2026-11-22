package com.khandanirishta.app.ui.theme

import android.animation.ValueAnimator
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.TweenSpec
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/*
 * Motion of DESIGN.md section 5.4: short and optional. Compose scales its own animations by the
 * animator duration scale, so "Remove animations" ends them at once. What Compose does not drive
 * (Coil's crossfade) and what loops asks `rememberReducedMotion`.
 */
object Motion {
    const val FAST_MILLIS = 150
    const val BASE_MILLIS = 200

    /** Switch thumbs and press states. */
    fun <T> fast(): TweenSpec<T> = tween(durationMillis = FAST_MILLIS, easing = FastOutSlowInEasing)

    /** Chevrons, details that open, sheets and screen changes. */
    fun <T> base(): TweenSpec<T> = tween(durationMillis = BASE_MILLIS, easing = FastOutSlowInEasing)
}

/** True when the member turned animations off in the system settings. */
@Composable
fun rememberReducedMotion(): Boolean = remember { !ValueAnimator.areAnimatorsEnabled() }
