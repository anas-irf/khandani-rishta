package com.khandanirishta.app.ui.components

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.runtime.Composable

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
