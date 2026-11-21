package com.khandanirishta.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.RangeSliderState
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

/*
 * Form fields of specs/22 section 11 (the web's components/common/fields). Every field is
 * stateless: it shows a value and reports changes. Server validation errors arrive as [error].
 */

/** The label above a field, with "(optional)" when the field is not required. */
@Composable
fun FieldLabel(
    label: String,
    modifier: Modifier = Modifier,
    optional: Boolean = false,
) {
    Row(modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        if (optional) {
            Spacer(Modifier.width(4.dp))
            Text(
                stringResource(R.string.common_optional),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Helper or error text under a field. */
@Composable
fun FieldSupport(
    helper: String?,
    error: String?,
    modifier: Modifier = Modifier,
) {
    when {
        error != null -> {
            Text(
                error,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = modifier.padding(top = 4.dp),
            )
        }

        helper != null -> {
            Text(
                helper,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = modifier.padding(top = 4.dp),
            )
        }
    }
}

/** A text field with label, helper, error and an optional counter (`TextField`). */
@Composable
fun KrTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    placeholder: String? = null,
    optional: Boolean = false,
    maxLength: Int? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    showCounter: Boolean = maxLength != null && !singleLine,
) {
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label, optional = optional)
        OutlinedTextField(
            value = value,
            onValueChange = { next -> onValueChange(if (maxLength != null) next.take(maxLength) else next) },
            placeholder = placeholder?.let { { Text(it) } },
            isError = error != null,
            singleLine = singleLine,
            minLines = minLines,
            enabled = enabled,
            keyboardOptions = keyboardOptions,
            visualTransformation = visualTransformation,
            shape = MaterialTheme.shapes.small,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics {
                        contentDescription = label
                        if (error != null) error(error)
                    },
        )
        Row {
            Box(Modifier.weight(1f)) { FieldSupport(helper, error) }
            if (showCounter && maxLength != null) {
                Text(
                    text(R.string.fields_text_area_counter, "length" to value.length, "max" to maxLength),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp, start = 8.dp),
                )
            }
        }
    }
}

/** A read-only box that opens a picker, styled like a text field. */
@Composable
fun PickerBox(
    text: String?,
    placeholder: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    isError: Boolean = false,
    enabled: Boolean = true,
    contentDescription: String? = null,
) {
    Surface(
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        border =
            androidx.compose.foundation.BorderStroke(
                1.dp,
                when {
                    isError -> MaterialTheme.colorScheme.error
                    else -> MaterialTheme.colorScheme.outline
                },
            ),
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clickable(enabled = enabled, role = Role.DropdownList, onClick = onClick)
                .semantics { if (contentDescription != null) this.contentDescription = contentDescription },
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text ?: placeholder,
                style = MaterialTheme.typography.bodyLarge,
                color =
                    when {
                        !enabled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                        text == null -> MaterialTheme.colorScheme.onSurfaceVariant
                        else -> MaterialTheme.colorScheme.onSurface
                    },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Filled.ArrowDropDown,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * A single choice from a list, in a modal bottom sheet (`SelectField`). Lists longer than 12
 * entries get a search box (`SearchSelectField`). [display] gives a shorter text for the closed
 * field (a narrow dial code box, for example); the sheet and screen readers use the full label.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectField(
    label: String,
    options: List<Option>,
    selected: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    optional: Boolean = false,
    placeholder: String = stringResource(R.string.fields_select_placeholder),
    enabled: Boolean = true,
    clearable: Boolean = optional,
    searchable: Boolean = options.size > SEARCH_THRESHOLD,
    showLabel: Boolean = true,
    display: ((Option) -> String)? = null,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val chosen = options.firstOrNull { it.code == selected }
    val current =
        chosen?.label
            ?: selected?.let {
                com.khandanirishta.app.core.data.Reference
                    .fallback(it)
            }
    Column(modifier.fillMaxWidth()) {
        if (showLabel) FieldLabel(label, optional = optional)
        PickerBox(
            text = chosen?.let { display?.invoke(it) } ?: current,
            placeholder = placeholder,
            onClick = { open = true },
            isError = error != null,
            enabled = enabled,
            contentDescription = "$label, ${current ?: placeholder}",
        )
        FieldSupport(helper, error)
    }
    if (open) {
        OptionSheet(
            title = label,
            options = options,
            searchable = searchable,
            onDismiss = { open = false },
            isSelected = { it == selected },
            onPick = {
                onSelect(it)
                open = false
            },
            clearLabel = if (clearable &&
                selected != null
            ) {
                text(R.string.fields_search_select_clear, "label" to label)
            } else {
                null
            },
            onClear = {
                onSelect(null)
                open = false
            },
        )
    }
}

/** The sheet behind [SelectField] and [MultiSelectField]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OptionSheet(
    title: String,
    options: List<Option>,
    searchable: Boolean,
    onDismiss: () -> Unit,
    isSelected: (String) -> Boolean,
    onPick: (String) -> Unit,
    multi: Boolean = false,
    clearLabel: String? = null,
    onClear: () -> Unit = {},
    doneLabel: String? = null,
) {
    val sheetState = rememberModalSheetState(skipPartiallyExpanded = searchable)
    var query by rememberSaveable { mutableStateOf("") }
    val filtered =
        remember(options, query) {
            val needle = query.trim()
            if (needle.isEmpty()) options else options.filter { it.label.contains(needle, ignoreCase = true) }
        }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .then(if (searchable) Modifier.fillMaxHeight(0.92f) else Modifier)
                .imePadding(),
        ) {
            Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                if (clearLabel != null) TextButton(onClick = onClear) { Text(clearLabel) }
                if (doneLabel != null) TextButton(onClick = onDismiss) { Text(doneLabel) }
            }
            if (searchable) {
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
            }
            if (filtered.isEmpty()) {
                Text(
                    stringResource(R.string.fields_search_select_no_results),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(20.dp),
                )
            }
            LazyColumn(
                Modifier
                    .fillMaxWidth()
                    .then(if (multi) Modifier else Modifier.selectableGroup())
                    .navigationBarsPadding(),
            ) {
                items(filtered, key = { it.code }) { option ->
                    val chosen = isSelected(option.code)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp)
                            .then(
                                if (multi) {
                                    Modifier.toggleable(value = chosen, role = Role.Checkbox) { onPick(option.code) }
                                } else {
                                    Modifier.selectable(
                                        selected = chosen,
                                        role = Role.RadioButton,
                                    ) { onPick(option.code) }
                                },
                            ).padding(horizontal = 20.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (multi) {
                            Checkbox(
                                checked = chosen,
                                onCheckedChange = null,
                            )
                        } else {
                            RadioButton(selected = chosen, onClick = null)
                        }
                        Spacer(Modifier.width(14.dp))
                        Text(option.label, style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        }
    }
}

/**
 * Several choices (`MultiSelectField`): chips for short lists; for long lists the chosen values
 * as removable chips and an "Add" button that opens a searchable sheet.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun MultiSelectField(
    label: String,
    options: List<Option>,
    selected: Set<String>,
    onChange: (Set<String>) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    optional: Boolean = false,
    max: Int? = null,
    chips: Boolean = options.size <= CHIP_THRESHOLD,
    showLabel: Boolean = true,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    var maxReached by remember { mutableStateOf(false) }

    fun toggle(code: String) {
        if (code in selected) {
            onChange(selected - code)
            maxReached = false
        } else if (max != null && selected.size >= max) {
            maxReached = true
        } else {
            onChange(selected + code)
        }
    }
    Column(modifier.fillMaxWidth()) {
        if (showLabel) FieldLabel(label, optional = optional)
        if (chips) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                options.forEach { option ->
                    val chosen = option.code in selected
                    FilterChip(
                        selected = chosen,
                        onClick = { toggle(option.code) },
                        label = { Text(option.label) },
                        leadingIcon = if (chosen) {
                            (
                                {
                                    Icon(
                                        Icons.Filled.Check,
                                        contentDescription = null,
                                        Modifier.size(18.dp),
                                    )
                                }
                            )
                        } else {
                            null
                        },
                        colors =
                            FilterChipDefaults.filterChipColors(
                                selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            ),
                    )
                }
            }
        } else {
            val chosen =
                options.filter { it.code in selected } +
                    (selected - options.map { it.code }.toSet()).map { Option(it, it) }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                chosen.forEach { option ->
                    InputChip(
                        selected = true,
                        onClick = { toggle(option.code) },
                        label = { Text(option.label) },
                        trailingIcon = {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = text(R.string.fields_multi_select_remove, "item" to option.label),
                                modifier = Modifier.size(18.dp),
                            )
                        },
                    )
                }
                FilterChip(
                    selected = false,
                    onClick = { open = true },
                    label = { Text(stringResource(R.string.fields_multi_select_add)) },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, Modifier.size(18.dp)) },
                    modifier = Modifier.semantics { contentDescription = "" },
                )
            }
        }
        if (maxReached && max != null) {
            FieldSupport(null, text(R.string.fields_multi_select_max_reached, "max" to max))
        } else {
            FieldSupport(helper, error)
        }
    }
    if (open) {
        OptionSheet(
            title = label,
            options = options,
            searchable = true,
            multi = true,
            onDismiss = { open = false },
            isSelected = { it in selected },
            onPick = ::toggle,
            doneLabel = stringResource(R.string.common_actions_done),
        )
    }
}

/** A single choice shown as chips, for short lists. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChoiceChips(
    options: List<Option>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { option ->
            FilterChip(
                selected = option.code == selected,
                onClick = { onSelect(option.code) },
                label = { Text(option.label) },
                colors =
                    FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primary,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                    ),
            )
        }
    }
}

/** One choice of a [RadioCardsField]. */
data class RadioCard(
    val code: String,
    val title: String,
    val helper: String? = null,
)

/** Radio cards: each choice with a title and an explanation (`RadioCardsField`). */
@Composable
fun RadioCardsField(
    cards: List<RadioCard>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    error: String? = null,
    enabled: Boolean = true,
) {
    Column(modifier.fillMaxWidth()) {
        if (label != null) FieldLabel(label)
        Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            cards.forEach { card ->
                val chosen = card.code == selected
                Surface(
                    shape = MaterialTheme.shapes.medium,
                    color = if (chosen) {
                        MaterialTheme.colorScheme.primaryContainer.copy(
                            alpha = 0.45f,
                        )
                    } else {
                        MaterialTheme.colorScheme.surfaceContainerLowest
                    },
                    border =
                        androidx.compose.foundation.BorderStroke(
                            if (chosen) 2.dp else 1.dp,
                            if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                        ),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = chosen,
                                enabled = enabled,
                                role = Role.RadioButton,
                            ) { onSelect(card.code) },
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                        RadioButton(selected = chosen, onClick = null, enabled = enabled)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(card.title, style = MaterialTheme.typography.titleSmall)
                            if (card.helper != null) {
                                Text(
                                    card.helper,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
        FieldSupport(null, error)
    }
}

/**
 * Date of birth as three pickers, day, month and year (07 section 4.1), not a calendar: scrolling
 * decades in a calendar is slow. An incomplete or impossible date gives `null`.
 */
@Composable
fun DateOfBirthField(
    value: LocalDate?,
    onChange: (LocalDate?) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    minAge: Int = 18,
    maxAge: Int = 80,
) {
    var day by rememberSaveable { mutableStateOf(value?.dayOfMonth) }
    var month by rememberSaveable { mutableStateOf(value?.monthValue) }
    var year by rememberSaveable { mutableStateOf(value?.year) }
    var invalid by remember { mutableStateOf(false) }
    val currentYear = Formatters.todayInKarachi().year

    fun emit(
        d: Int?,
        m: Int?,
        y: Int?,
    ) {
        day = d
        month = m
        year = y
        if (d == null || m == null || y == null) {
            invalid = false
            onChange(null)
            return
        }
        val valid = d <= YearMonth.of(y, m).lengthOfMonth()
        invalid = !valid
        onChange(if (valid) LocalDate.of(y, m, d) else null)
    }
    val days = (1..31).map { Option(it.toString(), it.toString()) }
    val months =
        (1..12).map {
            Option(
                it.toString(),
                java.time.Month
                    .of(it)
                    .getDisplayName(TextStyle.FULL, Locale.ENGLISH),
            )
        }
    val years = (currentYear - minAge downTo currentYear - maxAge).map { Option(it.toString(), it.toString()) }
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SelectField(
                label = stringResource(R.string.fields_date_of_birth_day),
                options = days,
                selected = day?.toString(),
                onSelect = { emit(it?.toInt(), month, year) },
                placeholder = stringResource(R.string.fields_date_of_birth_day),
                showLabel = false,
                isErrorOverride = error != null || invalid,
                modifier = Modifier.weight(0.8f),
            )
            SelectField(
                label = stringResource(R.string.fields_date_of_birth_month),
                options = months,
                selected = month?.toString(),
                onSelect = { emit(day, it?.toInt(), year) },
                placeholder = stringResource(R.string.fields_date_of_birth_month),
                showLabel = false,
                isErrorOverride = error != null || invalid,
                modifier = Modifier.weight(1.3f),
            )
            SelectField(
                label = stringResource(R.string.fields_date_of_birth_year),
                options = years,
                selected = year?.toString(),
                onSelect = { emit(day, month, it?.toInt()) },
                placeholder = stringResource(R.string.fields_date_of_birth_year),
                showLabel = false,
                isErrorOverride = error != null || invalid,
                modifier = Modifier.weight(1f),
            )
        }
        FieldSupport(helper, error ?: if (invalid) stringResource(R.string.fields_date_of_birth_invalid) else null)
    }
}

/** A [SelectField] variant without its own support line, for rows of pickers. */
@Composable
private fun SelectField(
    label: String,
    options: List<Option>,
    selected: String?,
    onSelect: (String?) -> Unit,
    placeholder: String,
    showLabel: Boolean,
    isErrorOverride: Boolean,
    modifier: Modifier = Modifier,
    display: ((Option) -> String)? = null,
) {
    SelectField(
        label = label,
        options = options,
        selected = selected,
        onSelect = onSelect,
        placeholder = placeholder,
        showLabel = showLabel,
        error = if (isErrorOverride) "" else null,
        modifier = modifier,
        clearable = false,
        display = display,
    )
}

/** Height as feet and inches (07 section 4.3); the value is in centimetres. */
@Composable
fun HeightField(
    valueCm: Int?,
    onChange: (Int?) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    optional: Boolean = false,
) {
    val initial = valueCm
        ?.takeIf {
            it in Formatters.MIN_HEIGHT_CM..Formatters.MAX_HEIGHT_CM
        }?.let(Formatters::cmToFeetInches)
    var feet by rememberSaveable { mutableStateOf(initial?.first) }
    var inches by rememberSaveable { mutableStateOf(initial?.second) }

    fun emit(
        f: Int?,
        i: Int?,
    ) {
        val adjustedInches = if (f == MAX_FEET) 0 else i
        feet = f
        inches = adjustedInches
        onChange(if (f != null && adjustedInches != null) Formatters.feetInchesToCm(f, adjustedInches) else null)
    }
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label, optional = optional)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            SelectField(
                label = stringResource(R.string.fields_height_feet),
                options = (4..MAX_FEET).map {
                    Option(
                        it.toString(),
                        text(
                            R.string.fields_height_feet_option,
                            "feet" to it,
                        ),
                    )
                },
                selected = feet?.toString(),
                onSelect = { emit(it?.toInt(), inches) },
                placeholder = stringResource(R.string.fields_height_feet),
                showLabel = false,
                isErrorOverride = error != null,
                modifier = Modifier.weight(1f),
            )
            SelectField(
                label = stringResource(R.string.fields_height_inches),
                options =
                    (if (feet == MAX_FEET) listOf(0) else (0..11).toList()).map {
                        Option(it.toString(), text(R.string.fields_height_inches_option, "inches" to it))
                    },
                selected = inches?.toString(),
                onSelect = { emit(feet, it?.toInt()) },
                placeholder = stringResource(R.string.fields_height_inches),
                showLabel = false,
                isErrorOverride = error != null,
                modifier = Modifier.weight(1f),
            )
        }
        val cm = if (feet != null && inches != null) Formatters.feetInchesToCm(feet!!, inches!!) else null
        FieldSupport(helper ?: cm?.let { text(R.string.fields_height_centimetres, "cm" to it) }, error)
    }
}

/** E.164 helpers of 08 section 3.3. */
object Phone {
    val E164 = Regex("^\\+[1-9][0-9]{7,14}$")

    /** The flag emoji of a two-letter country code (`PK` gives the Pakistani flag); empty otherwise. */
    fun flag(countryCode: String): String =
        if (countryCode.length == 2 && countryCode.all { it in 'A'..'Z' }) {
            countryCode
                .map { String(Character.toChars(REGIONAL_INDICATOR_A + (it - 'A'))) }
                .joinToString("")
        } else {
            ""
        }

    private const val REGIONAL_INDICATOR_A = 0x1F1E6

    /** `toE164("+92", "0300 1234567")` is `+923001234567`; an empty number gives `null`. */
    fun toE164(
        dial: String,
        national: String,
    ): String? {
        val digits = national.replace(Regex("[\\s-]"), "").removePrefix("0")
        return if (digits.isEmpty()) null else dial + digits
    }

    /** The longest dial code that prefixes [value], and the rest. */
    fun split(
        value: String?,
        dialCodes: List<String>,
    ): Pair<String?, String> {
        if (value.isNullOrEmpty()) return null to ""
        val dial = dialCodes.sortedByDescending { it.length }.firstOrNull { value.startsWith(it) }
        return if (dial == null) null to value.removePrefix("+") else dial to value.removePrefix(dial)
    }
}

/** A dial-code picker and the national number (08 section 3.3). The value is E.164 or `null`. */
@Composable
fun PhoneField(
    value: String?,
    onChange: (String?) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    optional: Boolean = false,
    defaultCountry: String = "PK",
) {
    val reference = LocalReference.current
    val countries = remember(reference) { reference.data.countries.filter { !it.dialCode.isNullOrBlank() } }
    val dialCodes = remember(countries) { countries.mapNotNull { it.dialCode } }
    val (initialDial, initialNational) = remember { Phone.split(value, dialCodes) }
    var country by rememberSaveable {
        mutableStateOf(countries.firstOrNull { it.dialCode == initialDial }?.code ?: defaultCountry)
    }
    var national by rememberSaveable { mutableStateOf(initialNational) }
    val dial = countries.firstOrNull { it.code == country }?.dialCode ?: "+92"
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label, optional = optional)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            SelectField(
                label = stringResource(R.string.fields_phone_dial_code),
                options =
                    countries.map {
                        Option(
                            it.code,
                            text(
                                R.string.fields_phone_dial_option,
                                "country" to reference.country(it.code),
                                "dial" to it.dialCode,
                            ),
                        )
                    },
                selected = country,
                onSelect = { code ->
                    if (code != null) {
                        country = code
                        val newDial = countries.firstOrNull { it.code == code }?.dialCode ?: dial
                        onChange(Phone.toE164(newDial, national))
                    }
                },
                placeholder = dial,
                showLabel = false,
                isErrorOverride = false,
                modifier = Modifier.weight(0.34f),
                // The closed box is narrow: the flag and dial code, the sheet lists full names.
                display = { option ->
                    val code = countries.firstOrNull { it.code == option.code }?.dialCode.orEmpty()
                    "${Phone.flag(option.code)} $code".trim()
                },
            )
            OutlinedTextField(
                value = national,
                onValueChange = { next ->
                    val cleaned = next.filter { it.isDigit() || it == ' ' || it == '-' }.take(MAX_PHONE)
                    national = cleaned
                    onChange(Phone.toE164(dial, cleaned))
                },
                placeholder = { Text(if (dial == "+92") stringResource(R.string.fields_phone_placeholder_pk) else "") },
                singleLine = true,
                isError = error != null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                shape = MaterialTheme.shapes.small,
                modifier =
                    Modifier
                        .weight(0.66f)
                        .semantics { contentDescription = label },
            )
        }
        FieldSupport(helper, error)
    }
}

/**
 * Masks a CNIC, NICOP or POC number as `12345-1234567-1` while typing; the stored value is the
 * 13 digits (12 section 3).
 */
object IdentityMask : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val digits = text.text.take(13)
        val out =
            buildString {
                digits.forEachIndexed { index, c ->
                    if (index == 5 || index == 12) append('-')
                    append(c)
                }
            }
        val mapping =
            object : OffsetMapping {
                override fun originalToTransformed(offset: Int): Int =
                    when {
                        offset <= 5 -> offset
                        offset <= 12 -> offset + 1
                        else -> offset + 2
                    }.coerceAtMost(out.length)

                override fun transformedToOriginal(offset: Int): Int =
                    when {
                        offset <= 5 -> offset
                        offset <= 13 -> offset - 1
                        else -> offset - 2
                    }.coerceIn(0, digits.length)
            }
        return TransformedText(AnnotatedString(out), mapping)
    }
}

/** A min and max range with a slider (`RangeField`). */
@Composable
fun RangeField(
    label: String,
    min: Int,
    max: Int,
    bounds: IntRange,
    onChange: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
    format: (Int) -> String = { it.toString() },
    helper: String? = null,
    error: String? = null,
) {
    val shown = text(R.string.profile_looking_for_range, "min" to format(min), "max" to format(max))
    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            Text(shown, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
        IntRangeSlider(
            start = min,
            end = max,
            bounds = bounds,
            onChange = onChange,
            modifier = Modifier.semantics { contentDescription = "$label, $shown" },
        )
        FieldSupport(helper, error)
    }
}

/**
 * A two-handle slider over whole numbers that shows [start] and [end] and reports changes. With
 * [stepped] it stops at every whole number (ages, inches); otherwise it moves freely. Steps are
 * not drawn: a dot for every year or inch would only clutter the track.
 */
@Composable
fun IntRangeSlider(
    start: Int,
    end: Int,
    bounds: IntRange,
    onChange: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    stepped: Boolean = false,
) {
    val steps = if (stepped) (bounds.last - bounds.first - 1).coerceAtLeast(0) else 0
    val state =
        remember(bounds, steps) {
            RangeSliderState(
                startValue = start.toFloat(),
                endValue = end.toFloat(),
                steps = steps,
                trackRange = bounds.first.toFloat()..bounds.last.toFloat(),
            )
        }
    // The handles follow the values given, as the controlled overload does; a reset can move both.
    state.moveTo(start.toFloat(), end.toFloat())
    RangeSlider(
        state = state,
        onValueChange = { range ->
            state.moveTo(range.start, range.endInclusive)
            onChange(range.start.roundToInt(), range.endInclusive.roundToInt())
        },
        modifier = modifier,
        enabled = enabled,
        track = { sliderState ->
            SliderDefaults.Track(rangeSliderState = sliderState, enabled = enabled, drawTick = { _, _ -> })
        },
    )
}

/**
 * Sets both handles. Each setter is clamped by the other handle, so the end moves first when the
 * new start is past the current end.
 */
private fun RangeSliderState.moveTo(
    start: Float,
    end: Float,
) {
    if (start > endValue) {
        endValue = end
        startValue = start
    } else {
        startValue = start
        endValue = end
    }
}

/** How much a preference matters: must, high, medium, low (`ImportanceField`). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportanceField(
    value: Importance,
    onChange: (Importance) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    val reference = LocalReference.current
    val options = reference.optionsOf(com.khandanirishta.app.core.data.Lists.IMPORTANCE, Importance.entries)
    Column(modifier.fillMaxWidth()) {
        if (label != null) FieldLabel(label)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed { index, (importance, text) ->
                SegmentedButton(
                    selected = importance == value,
                    onClick = { onChange(importance) },
                    shape = SegmentedButtonDefaults.itemShape(index, options.size),
                    label = {
                        Text(
                            text,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    },
                    colors =
                        SegmentedButtonDefaults.colors(
                            activeContainerColor =
                                if (importance ==
                                    Importance.MUST
                                ) {
                                    MaterialTheme.colorScheme.tertiaryContainer
                                } else {
                                    MaterialTheme.colorScheme.primaryContainer
                                },
                        ),
                )
            }
        }
        if (value == Importance.MUST) {
            Text(
                stringResource(R.string.fields_importance_must_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/** A consent checkbox whose label can carry links (`ConsentCheckbox`). */
@Composable
fun ConsentCheckbox(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: AnnotatedString,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .toggleable(value = checked, role = Role.Checkbox, onValueChange = onCheckedChange)
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Checkbox(checked = checked, onCheckedChange = null, modifier = Modifier.padding(top = 2.dp))
            Spacer(Modifier.width(12.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 12.dp))
        }
        FieldSupport(null, error)
    }
}

/** A small tinted note box, for explanations inside forms. */
@Composable
fun NoteBox(
    text: String,
    modifier: Modifier = Modifier,
    container: Color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f),
) {
    Surface(color = container, shape = MaterialTheme.shapes.medium, modifier = modifier.fillMaxWidth()) {
        Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(12.dp))
    }
}

private const val SEARCH_THRESHOLD = 12
private const val CHIP_THRESHOLD = 12
private const val MAX_FEET = 7
private const val MAX_PHONE = 16
