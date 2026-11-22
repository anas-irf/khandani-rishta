package com.khandanirishta.app.ui.components

import android.app.Activity
import android.view.WindowManager
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect

/**
 * Blocks screenshots, screen recording and the recent-apps preview while the screen is shown
 * (rule G17, specs/22 section 10). Nested secure screens are counted, so the flag stays until the
 * last one leaves. Its sheets and dialogs inherit the flag from the window.
 */
@Composable
fun SecureScreen() {
    val activity = LocalActivity.current ?: return
    DisposableEffect(activity) {
        SecureCounter.acquire(activity)
        onDispose { SecureCounter.release(activity) }
    }
}

private object SecureCounter {
    private var count = 0

    fun acquire(activity: Activity) {
        count++
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    fun release(activity: Activity) {
        count = (count - 1).coerceAtLeast(0)
        if (count == 0) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}
