package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.ui.theme.Elevation
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.LocalTonalColor
import com.khandanirishta.app.ui.theme.SheetShape
import com.khandanirishta.app.ui.theme.Spacing
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The state of a modal bottom sheet. With [skipPartiallyExpanded] the sheet opens at full height
 * with no half-open stop, which suits forms and long lists.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun rememberModalSheetState(
    skipPartiallyExpanded: Boolean = true,
    confirmValueChange: (SheetValue) -> Boolean = { true },
): SheetState =
    rememberBottomSheetState(
        initialValue = SheetValue.Hidden,
        enabledValues =
            if (skipPartiallyExpanded) {
                setOf(SheetValue.Hidden, SheetValue.Expanded)
            } else {
                setOf(SheetValue.Hidden, SheetValue.PartiallyExpanded, SheetValue.Expanded)
            },
        confirmValueChange = confirmValueChange,
    )

/**
 * Material's bottom sheet in the look of DESIGN.md section 4.1: surface, the sheet radius and no
 * tint. It is the frame only, for sheets that hold a lazy list; everything else uses [KrSheet].
 * A secure screen's sheet stays secure: the window flag is inherited.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KrSheetFrame(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    dismissible: Boolean = true,
    skipPartiallyExpanded: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val mayDismiss by rememberUpdatedState(dismissible)
    val state =
        rememberModalSheetState(skipPartiallyExpanded) { target -> target != SheetValue.Hidden || mayDismiss }
    val colors = MaterialTheme.colorScheme
    val toasts = LocalToasts.current
    // Read before the sheet's window is composed: it repeats only what comes while it is open.
    val earlier = remember(toasts) { toasts?.currentSnackbarData }
    val scope = rememberCoroutineScope()
    ModalBottomSheet(
        onDismissRequest = {
            if (mayDismiss) {
                onDismissRequest()
                // The sheet hides before it asks. A caller may refuse, and a hidden sheet would take
                // every touch: one that is still here comes back. One that was closed ends this scope.
                scope.launch {
                    delay(REFUSED_AFTER_MILLIS)
                    state.show()
                }
            }
        },
        modifier = modifier,
        sheetState = state,
        shape = SheetShape,
        containerColor = KrTheme.colors.card,
        contentColor = colors.onSurface,
        tonalElevation = Elevation.none,
        dragHandle = { BottomSheetDefaults.DragHandle(color = colors.outline) },
    ) {
        CompositionLocalProvider(LocalTonalColor provides colors.surfaceContainer) {
            WindowToast(toasts, earlier)
            content()
        }
    }
}

/**
 * A bottom sheet with a title, a body that scrolls and [actions] that stay in view: the decline,
 * send, share and report dialogs (DESIGN.md section 6.13). Over a keyboard on a short window or
 * at large text they scroll with the body instead, so what is typed stays in view.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KrSheet(
    title: String,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
    dismissible: Boolean = true,
    actions: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    KrSheetFrame(onDismissRequest = onDismissRequest, modifier = modifier, dismissible = dismissible) {
        // Each is read every time: read only behind a nested && or ||, they give the body another
        // place in the composition as the keyboard comes, and the field being typed in loses focus.
        val typing = WindowInsets.isImeVisible
        val largeText = LocalDensity.current.fontScale >= CROWDED_TEXT
        val shortWindow = LocalWindowInfo.current.containerDpSize.height < ShortWindow
        val crowded = typing && (largeText || shortWindow)
        Column(
            modifier =
                Modifier
                    .weight(1f, fill = false)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(start = Spacing.gutter, end = Spacing.gutter, bottom = Spacing.s16),
            verticalArrangement = Arrangement.spacedBy(Spacing.s12),
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            if (description != null) {
                Text(description, style = MaterialTheme.typography.bodyMedium, color = KrTheme.colors.textSecondary)
            }
            content()
            if (crowded && actions != null) SheetActions(Modifier.padding(top = Spacing.s8), actions)
        }
        if (!crowded && actions != null) {
            SheetActions(
                modifier =
                    Modifier.padding(
                        start = Spacing.gutter,
                        top = Spacing.s8,
                        end = Spacing.gutter,
                        bottom = Spacing.s20,
                    ),
                content = actions,
            )
        }
    }
}

@Composable
private fun SheetActions(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
        content = content,
    )
}

private val ShortWindow = 480.dp
private const val CROWDED_TEXT = 1.3f
private const val REFUSED_AFTER_MILLIS = 400L
