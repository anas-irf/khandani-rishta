package com.khandanirishta.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import kotlinx.coroutines.delay
import java.time.Instant

/**
 * The time, renewed every minute while it is shown. What is said relative to now reads it, because
 * Compose skips a row whose data did not change.
 */
@Composable
fun rememberNow(): Instant {
    val now by produceState(Instant.now()) {
        while (true) {
            delay(MINUTE_MILLIS)
            value = Instant.now()
        }
    }
    return now
}

private const val MINUTE_MILLIS = 60_000L
