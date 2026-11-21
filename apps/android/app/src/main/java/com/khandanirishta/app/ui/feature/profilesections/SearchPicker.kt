package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.PickerBox
import com.khandanirishta.app.ui.components.rememberModalSheetState
import com.khandanirishta.app.ui.text.text
import java.text.Normalizer

/** A choice of a searchable list; [aliases] are searched too ("Rajpoot" finds "Rajput"). */
data class SearchOption(
    val code: String,
    val label: String,
    val aliases: List<String> = emptyList(),
)

/** Lower case without accents, so "Arain" matches "Arāin". */
private fun normalize(text: String): String =
    Normalizer
        .normalize(text, Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "")
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

@OptIn(ExperimentalMaterial3Api::class)
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
    val sheetState = rememberModalSheetState(skipPartiallyExpanded = true)
    var query by rememberSaveable { mutableStateOf("") }
    val matches = remember(options, query) { filterOptions(options, query) }
    val visible = matches.take(MAX_RESULTS)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(SHEET_HEIGHT)
                .imePadding(),
        ) {
            Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_actions_close)) }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text(stringResource(R.string.fields_search_select_search)) },
                singleLine = true,
                shape = MaterialTheme.shapes.small,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (visible.isEmpty()) {
                HelperText(
                    stringResource(R.string.fields_search_select_no_results),
                    Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
            }
            if (matches.size > visible.size) {
                HelperText(
                    text(R.string.fields_search_select_more_results, "shown" to visible.size),
                    Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            LazyColumn(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .navigationBarsPadding(),
            ) {
                items(visible, key = { it.code }) { option ->
                    val chosen = option.code == selected
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp)
                            .clickable(role = Role.Button) { onPick(option.code) }
                            .padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (chosen) {
                            Icon(
                                Icons.Outlined.Check,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(20.dp),
                            )
                        } else {
                            Spacer(Modifier.size(20.dp))
                        }
                        Spacer(Modifier.width(14.dp))
                        Text(option.label, style = MaterialTheme.typography.bodyLarge)
                    }
                }
                if (otherLabel != null) {
                    item(key = "other") {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 52.dp)
                                .clickable(role = Role.Button) { onOther(query.trim()) }
                                .padding(horizontal = 20.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Spacer(Modifier.size(20.dp))
                            Spacer(Modifier.width(14.dp))
                            Text(
                                otherLabel,
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        }
    }
}

private const val MAX_RESULTS = 50
private const val SHEET_HEIGHT = 0.92f
