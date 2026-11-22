package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarData
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.AccessibilityManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import kotlinx.coroutines.withTimeoutOrNull

/** The app's toasts, for the windows that cover them. `null` where there is no app around. */
val LocalToasts = staticCompositionLocalOf<SnackbarHostState?> { null }

/**
 * A toast inside a sheet, which would hide it: one that came after [earlier], so a failure that
 * leaves the sheet open is said in it. The root's host still times it.
 */
@Composable
internal fun WindowToast(
    state: SnackbarHostState?,
    earlier: SnackbarData?,
    modifier: Modifier = Modifier,
) {
    val data = state?.currentSnackbarData
    if (data == null || data === earlier) return
    Box(modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) { KrSnackbar(data) }
}

/**
 * Toasts (DESIGN.md section 6.20) are Material snackbars: inverse surface, the text at 17, and
 * the action in gold on inverse.
 */
@Composable
fun KrSnackbarHost(
    state: SnackbarHostState,
    modifier: Modifier = Modifier,
) {
    SnackbarHost(state, modifier) { KrSnackbar(it) }
}

@Composable
private fun KrSnackbar(data: SnackbarData) {
    val colors = MaterialTheme.colorScheme
    val label = data.visuals.actionLabel
    val action: (@Composable () -> Unit)? =
        label?.let {
            {
                InvertedFocusRing {
                    TextButton(
                        onClick = data::performAction,
                        colors = ButtonDefaults.textButtonColors(contentColor = colors.inversePrimary),
                        modifier = Modifier.heightIn(min = Sizes.touch),
                    ) {
                        Text(it, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
                    }
                }
            }
        }
    Snackbar(
        modifier = Modifier.padding(Spacing.s12),
        action = action,
        // A long action ("Add a note") would squeeze the message at large text.
        actionOnNewLine = label != null && (data.visuals.message.length + label.length) > ONE_LINE_CHARS,
        shape = MaterialTheme.shapes.large,
        containerColor = colors.inverseSurface,
        contentColor = colors.inverseOnSurface,
        actionContentColor = colors.inversePrimary,
    ) {
        Text(data.visuals.message, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Shows a toast for 4 seconds, or for 5 with an action such as Undo (rules G7 and G9), longer
 * when the member asked Android for more time to read.
 */
suspend fun SnackbarHostState.showToast(
    message: String,
    actionLabel: String?,
    accessibility: AccessibilityManager?,
): SnackbarResult {
    if (actionLabel == null) return showSnackbar(message = message, duration = SnackbarDuration.Short)
    val millis =
        accessibility?.calculateRecommendedTimeoutMillis(
            originalTimeoutMillis = ACTION_TOAST_MILLIS,
            containsIcons = false,
            containsText = true,
            containsControls = true,
        ) ?: ACTION_TOAST_MILLIS
    val result =
        withTimeoutOrNull(millis) {
            showSnackbar(message = message, actionLabel = actionLabel, duration = SnackbarDuration.Indefinite)
        }
    return result ?: SnackbarResult.Dismissed
}

private const val ACTION_TOAST_MILLIS = 5_000L
private const val ONE_LINE_CHARS = 28
