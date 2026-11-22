package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.KrSheetFrame
import com.khandanirishta.app.ui.components.KrTextInput
import com.khandanirishta.app.ui.components.rememberHideKeyboardOnSearch
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The full-height sheet of the search and city pickers. The title and the [status] line scroll
 * and only the search box stays, so results still fit over the keyboard at 200% text. An empty
 * [status] keeps its line, so results do not jump as it comes and goes; `null` has no line.
 */
@Composable
internal fun PickerSheet(
    title: String,
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    listModifier: Modifier = Modifier,
    status: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    focusOnOpen: Boolean = false,
    content: LazyListScope.() -> Unit,
) {
    KrSheetFrame(onDismissRequest = onDismiss, modifier = modifier) {
        val list = rememberLazyListState()
        // Each new query starts at the top, with its first results right under the box.
        LaunchedEffect(query) {
            if (query.isNotEmpty()) list.scrollToItem(SEARCH_INDEX)
        }
        LazyColumn(
            state = list,
            modifier =
                listModifier
                    .fillMaxWidth()
                    .fillMaxHeight(SHEET_SHARE)
                    .imePadding(),
            contentPadding = ListPadding,
        ) {
            item(key = TITLE_KEY, contentType = TITLE_KEY) { PickerTitle(title = title, onClose = onDismiss) }
            stickyHeader(key = SEARCH_KEY, contentType = SEARCH_KEY) {
                PickerSearch(
                    title = title,
                    query = query,
                    onQueryChange = onQueryChange,
                    placeholder = placeholder,
                    keyboardOptions = keyboardOptions,
                    focusOnOpen = focusOnOpen,
                )
            }
            if (status != null) {
                item(key = STATUS_KEY, contentType = STATUS_KEY) {
                    CaptionText(
                        text = status,
                        modifier =
                            Modifier
                                .semantics { liveRegion = LiveRegionMode.Polite }
                                .padding(bottom = Spacing.s8),
                    )
                }
            }
            content()
        }
    }
}

@Composable
private fun PickerTitle(
    title: String,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics { heading() },
        )
        KrIconButton(
            icon = Icons.Outlined.Close,
            contentDescription = stringResource(R.string.common_actions_close),
            onClick = onClose,
        )
    }
}

@Composable
private fun PickerSearch(
    title: String,
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    keyboardOptions: KeyboardOptions,
    focusOnOpen: Boolean,
) {
    val focus = remember { FocusRequester() }
    val searchLabel = text(R.string.fields_search_select_search_label, "label" to title)
    Surface(color = KrTheme.colors.card, modifier = Modifier.fillMaxWidth()) {
        KrTextInput(
            value = query,
            onValueChange = onQueryChange,
            placeholder = placeholder,
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            keyboardOptions = keyboardOptions,
            keyboardActions = rememberHideKeyboardOnSearch(),
            modifier =
                Modifier
                    .padding(vertical = Spacing.s8)
                    .fillMaxWidth()
                    .focusRequester(focus)
                    .semantics { contentDescription = searchLabel },
        )
    }
    if (focusOnOpen) {
        LaunchedEffect(Unit) {
            withFrameNanos { }
            runCatching { focus.requestFocus() }
        }
    }
}

/** The last row of a picker: "My city is not listed", "Other (type your own)". */
@Composable
internal fun PickerAction(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .tappable(shape = MaterialTheme.shapes.small, onClick = onClick)
                .heightIn(min = Sizes.touchLarge)
                .padding(vertical = Spacing.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconText(
            icon = icon,
            text = label,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurface,
            tint = MaterialTheme.colorScheme.primary,
            gap = Spacing.s12,
        )
    }
}

private const val TITLE_KEY = "picker:title"
private const val SEARCH_KEY = "picker:search"
private const val STATUS_KEY = "picker:status"
private const val SEARCH_INDEX = 1
private const val SHEET_SHARE = 0.92f
private val ListPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, bottom = Spacing.s16)
