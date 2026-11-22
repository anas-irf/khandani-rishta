package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.PickerBox
import com.khandanirishta.app.ui.components.RadioRow
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing
import java.text.Normalizer

/** A choice of a searchable list; [aliases] are searched too ("Rajpoot" finds "Rajput"). */
@Immutable
data class SearchOption(
    val code: String,
    val label: String,
    val aliases: List<String> = emptyList(),
)

private val ACCENTS = Regex("\\p{M}+")

/** Lower case without accents, so "Arain" matches "Arāin". */
private fun normalize(text: String): String =
    Normalizer
        .normalize(text, Normalizer.Form.NFD)
        .replace(ACCENTS, "")
        .lowercase()
        .trim()

/** Options matching [query] on the label or an alias; labels that start with it come first. */
fun filterOptions(
    options: List<SearchOption>,
    query: String,
): List<SearchOption> {
    val needle = normalize(query)
    if (needle.isEmpty()) return options
    val starts = mutableListOf<SearchOption>()
    val contains = mutableListOf<SearchOption>()
    options.forEach { option ->
        val label = normalize(option.label)
        when {
            label.startsWith(needle) -> starts += option
            label.contains(needle) || option.aliases.any { normalize(it).contains(needle) } -> contains += option
        }
    }
    return starts + contains
}

/**
 * A single choice from a long list with search (the web's SearchSelectField, 07 section 5.2):
 * the caste and sub-caste pickers. [otherLabel] adds a last row ("Other (type your own)") that
 * hands the typed text to [onOther].
 */
@Composable
fun SearchPickerField(
    label: String,
    options: List<SearchOption>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    displayText: String? = null,
    otherLabel: String? = null,
    onOther: ((String) -> Unit)? = null,
    helper: String? = null,
    error: String? = null,
    optional: Boolean = false,
    enabled: Boolean = true,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val current = displayText ?: options.firstOrNull { it.code == selected }?.label
    val placeholder = stringResource(R.string.fields_search_select_placeholder)
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label, optional = optional)
        PickerBox(
            text = current,
            placeholder = placeholder,
            onClick = { open = true },
            isError = error != null,
            enabled = enabled,
            contentDescription = "$label, ${current ?: placeholder}",
            modifier = Modifier.semantics { if (!error.isNullOrBlank()) error(error) },
        )
        FieldSupport(helper, error)
    }
    if (open) {
        SearchSheet(
            title = label,
            options = options,
            selected = selected,
            otherLabel = otherLabel,
            onPick = { code ->
                open = false
                onSelect(code)
            },
            onOther = { typed ->
                open = false
                onOther?.invoke(typed)
            },
            onDismiss = { open = false },
        )
    }
}

@Composable
private fun SearchSheet(
    title: String,
    options: List<SearchOption>,
    selected: String?,
    otherLabel: String?,
    onPick: (String) -> Unit,
    onOther: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val matches = remember(options, query) { filterOptions(options, query) }
    val visible = remember(matches) { matches.take(MAX_RESULTS) }
    val more =
        if (matches.size > visible.size) {
            text(R.string.fields_search_select_more_results, "shown" to visible.size)
        } else {
            null
        }
    PickerSheet(
        title = title,
        query = query,
        onQueryChange = { query = it },
        placeholder = stringResource(R.string.fields_search_select_search),
        onDismiss = onDismiss,
        status = more,
        keyboardOptions = SearchKeyboard,
        listModifier = Modifier.selectableGroup(),
    ) {
        if (visible.isEmpty()) {
            item(key = NONE_KEY, contentType = NONE_KEY) {
                IconText(
                    icon = Icons.Outlined.SearchOff,
                    text = stringResource(R.string.fields_search_select_no_results),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier =
                        Modifier
                            .semantics { liveRegion = LiveRegionMode.Polite }
                            .padding(vertical = Spacing.s16),
                )
            }
        }
        items(visible, key = { OPTION_KEY + it.code }, contentType = { OPTION_KEY }) { option ->
            RadioRow(label = option.label, selected = option.code == selected, onClick = { onPick(option.code) })
        }
        if (otherLabel != null) {
            item(key = OTHER_KEY, contentType = OTHER_KEY) {
                PickerAction(icon = Icons.Outlined.Edit, label = otherLabel, onClick = { onOther(query.trim()) })
            }
        }
    }
}

private val SearchKeyboard = KeyboardOptions(imeAction = ImeAction.Search)
private const val MAX_RESULTS = 50
private const val OPTION_KEY = "option:"
private const val OTHER_KEY = "other"
private const val NONE_KEY = "none"
