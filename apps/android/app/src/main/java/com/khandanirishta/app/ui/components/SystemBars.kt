package com.khandanirishta.app.ui.components

import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat

/**
 * Light status and navigation bar icons while an inverse screen is shown (the photo viewer and
 * the camera). The app is light only, so everywhere else the icons are dark; they are put back
 * when the screen goes.
 */
@Composable
fun LightSystemBarIcons() {
    SystemBarIcons(dark = false)
}

/** Dark icons for a full-screen dialog: its window is its own and starts with light ones. */
@Composable
fun DarkSystemBarIcons() {
    SystemBarIcons(dark = true)
}

@Composable
private fun SystemBarIcons(dark: Boolean) {
    val view = LocalView.current
    val activity = LocalActivity.current
    val window = (view.parent as? DialogWindowProvider)?.window ?: activity?.window
    DisposableEffect(view, window, dark) {
        val bars = window?.let { WindowCompat.getInsetsController(it, view) }
        val darkStatus = bars?.isAppearanceLightStatusBars
        val darkNavigation = bars?.isAppearanceLightNavigationBars
        bars?.isAppearanceLightStatusBars = dark
        bars?.isAppearanceLightNavigationBars = dark
        onDispose {
            if (bars != null) {
                bars.isAppearanceLightStatusBars = darkStatus != false
                bars.isAppearanceLightNavigationBars = darkNavigation != false
            }
        }
    }
}
