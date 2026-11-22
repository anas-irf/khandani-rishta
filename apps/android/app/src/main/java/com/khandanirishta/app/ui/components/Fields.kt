package com.khandanirishta.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.RangeSliderState
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import com.khandanirishta.app.ui.theme.TABULAR_FIGURES
import java.time.LocalDate
import java.time.Month
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

/*
 * Form fields of specs/22 section 11 (the web's components/common/fields). Every field is
 * stateless: it shows a value and reports changes. Server validation errors arrive as [error]
 * and always come with an icon and words.
 */

/** The label above a field, with "(optional)" when the field is not required. */
@Composable
fun FieldLabel(
    label: String,
    modifier: Modifier = Modifier,
    optional: Boolean = false,
) {
    FlowRow(
        modifier = modifier.padding(bottom = Spacing.s8),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
        if (optional) {
            Text(
                text = stringResource(R.string.common_optional),
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Normal),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Helper text under a field, or what is wrong with it: danger with an icon, read out at once. */
@Composable
fun FieldSupport(
    helper: String?,
    error: String?,
    modifier: Modifier = Modifier,
) {
    if (!error.isNullOrBlank()) {
        IconText(
            icon = Icons.Outlined.ErrorOutline,
            text = error,
            style = KrType.caption.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.error,
            iconSize = Sizes.iconTiny,
            modifier =
                modifier
                    .semantics { liveRegion = LiveRegionMode.Polite }
                    .padding(top = Spacing.s8),
        )
    } else if (!helper.isNullOrBlank() && error == null) {
        CaptionText(helper, modifier.padding(top = Spacing.s8))
    }
}

/** A text field with label, helper, error and an optional counter (`TextField`). */
@Suppress("DEPRECATION") // As KrTextInput.
@Composable
fun KrTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    inputModifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    placeholder: String? = null,
    optional: Boolean = false,
    maxLength: Int? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    showCounter: Boolean = maxLength != null && !singleLine,
    counter: String? = null,
    showLabel: Boolean = true,
) {
    Column(modifier.fillMaxWidth()) {
        if (showLabel) FieldLabel(label, optional = optional)
        KrTextInput(
            value = value,
            onValueChange = { next -> onValueChange(withinLimit(value, next, maxLength)) },
            placeholder = placeholder,
            isError = error != null,
            errorMessage = error,
            singleLine = singleLine,
            minLines = minLines,
            enabled = enabled,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation = visualTransformation,
            modifier =
                inputModifier
                    .fillMaxWidth()
                    .semantics { contentDescription = label },
        )
        FieldSupport(helper, error)
        if (showCounter && maxLength != null) {
            val spoken = text(R.string.fields_text_area_counter_label, "length" to value.length, "max" to maxLength)
            Text(
                text = counter ?: text(R.string.fields_text_area_counter, "length" to value.length, "max" to maxLength),
                style = KrType.caption.copy(fontFeatureSettings = TABULAR_FIGURES),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    Modifier
                        .align(Alignment.End)
                        .semantics { contentDescription = spoken }
                        .padding(top = Spacing.s4),
            )
        }
    }
}

/** A read-only box that opens a picker, styled like a text field. What is chosen wraps. */
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
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    val shape = MaterialTheme.shapes.medium
    Surface(
        shape = shape,
        color =
            when {
                !enabled -> extra.disabledContainer
                isError -> colors.errorContainer
                else -> extra.card
            },
        border =
            BorderStroke(
                Strokes.control,
                when {
                    !enabled -> extra.disabledContainer
                    isError -> colors.error
                    else -> colors.outline
                },
            ),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics {
                        if (contentDescription != null) this.contentDescription = contentDescription
                    }.tappable(shape = shape, onClick = onClick, role = Role.DropdownList, enabled = enabled)
                    .heightIn(min = Sizes.touchLarge)
                    .padding(start = PickerInset, top = Spacing.s12, end = Spacing.s8, bottom = Spacing.s12),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = text ?: placeholder,
                style = MaterialTheme.typography.bodyMedium,
                color =
                    when {
                        !enabled -> extra.onDisabledContainer
                        text == null -> colors.onSurfaceVariant
                        else -> colors.onSurface
                    },
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Outlined.ExpandMore,
                contentDescription = null,
                tint = if (enabled) colors.onSurfaceVariant else extra.onDisabledContainer,
                modifier = Modifier.size(Sizes.iconSmall),
            )
        }
    }
}

/**
 * A single choice from a list, in a modal bottom sheet (`SelectField`). Lists longer than 8
 * entries (07 section 2.6) get a search box (`SearchSelectField`). [display] gives a shorter text for the closed
 * field (a narrow dial code box, for example); the sheet and screen readers use the full label.
 */
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
    val chosen = remember(options, selected) { options.firstOrNull { it.code == selected } }
    val current = chosen?.label ?: selected?.let(Reference::fallback)
    Column(modifier.fillMaxWidth()) {
        if (showLabel) FieldLabel(label, optional = optional)
        PickerBox(
            text = chosen?.let { display?.invoke(it) } ?: current,
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
            clearLabel =
                if (clearable && selected != null) {
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

/**
 * The sheet behind [SelectField] and [MultiSelectField]. While the member types, "Done" moves
 * beside the title, so the options keep the room that is left over the keyboard.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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
    var query by rememberSaveable { mutableStateOf("") }
    val filtered =
        remember(options, query) {
            val needle = query.trim()
            if (needle.isEmpty()) options else options.filter { it.label.contains(needle, ignoreCase = true) }
        }
    KrSheetFrame(onDismissRequest = onDismiss, skipPartiallyExpanded = searchable) {
        val typing = WindowInsets.isImeVisible
        val besideTitle = clearLabel ?: doneLabel?.takeIf { typing }
        val onBesideTitle = if (clearLabel != null) onClear else onDismiss
        Column(
            Modifier
                .fillMaxWidth()
                .then(if (searchable) Modifier.fillMaxHeight(SEARCH_SHEET_SHARE) else Modifier)
                .imePadding(),
        ) {
            SectionHeading(
                title = title,
                ornament = HeadingOrnament.NONE,
                style = MaterialTheme.typography.titleLarge,
                action = besideTitle?.let { { KrTextLink(it, onBesideTitle) } },
                modifier = Modifier.padding(horizontal = Spacing.gutter),
            )
            if (searchable) {
                val searchLabel = text(R.string.fields_search_select_search_label, "label" to title)
                KrTextInput(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = stringResource(R.string.fields_search_select_search),
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = Spacing.gutter, vertical = Spacing.s12)
                            .semantics { contentDescription = searchLabel },
                )
            }
            if (filtered.isEmpty()) {
                Text(
                    text = stringResource(R.string.fields_search_select_no_results),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier =
                        Modifier
                            .semantics { liveRegion = LiveRegionMode.Polite }
                            .padding(horizontal = Spacing.gutter, vertical = Spacing.s16),
                )
            }
            LazyColumn(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .weight(1f, fill = false)
                        .then(if (multi) Modifier else Modifier.selectableGroup())
                        .padding(horizontal = Spacing.gutter),
            ) {
                items(filtered, key = { it.code }, contentType = { OPTION_TYPE }) { option ->
                    val chosen = isSelected(option.code)
                    if (multi) {
                        CheckboxRow(checked = chosen, onCheckedChange = { onPick(option.code) }, label = option.label)
                    } else {
                        RadioRow(label = option.label, selected = chosen, onClick = { onPick(option.code) })
                    }
                }
            }
            if (doneLabel != null && !typing) {
                KrButton(
                    text = doneLabel,
                    onClick = onDismiss,
                    fullWidth = true,
                    modifier = Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
                )
            }
        }
    }
}

/**
 * Several choices (`MultiSelectField`): chips for short lists; for long lists the chosen values
 * as removable chips and an "Add" button that opens a searchable sheet.
 */
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
    enabled: Boolean = true,
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
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            if (chips) {
                options.forEach { option ->
                    KrChoiceChip(
                        text = option.label,
                        selected = option.code in selected,
                        onClick = { toggle(option.code) },
                        enabled = enabled,
                    )
                }
            } else {
                val chosen =
                    remember(options, selected) {
                        options.filter { it.code in selected } +
                            (selected - options.map { it.code }.toSet()).map { Option(it, it) }
                    }
                chosen.forEach { option ->
                    KrRemovableChip(
                        text = option.label,
                        removeLabel = text(R.string.fields_multi_select_remove, "item" to option.label),
                        onRemove = { toggle(option.code) },
                        enabled = enabled,
                    )
                }
                KrButton(
                    text = stringResource(R.string.fields_multi_select_add),
                    onClick = { open = true },
                    variant = KrButtonVariant.QUIET,
                    icon = Icons.Outlined.Add,
                    enabled = enabled,
                    contentDescription = text(R.string.fields_multi_select_add_label, "label" to label),
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
@Composable
fun ChoiceChips(
    options: List<Option>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val choices = remember(options) { options.map { it.code to it.label } }
    SingleChoiceChips(choices, selected, onSelect, modifier, enabled)
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
        Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            cards.forEach { card ->
                RadioCardRow(
                    title = card.title,
                    helper = card.helper,
                    selected = card.code == selected,
                    onClick = { onSelect(card.code) },
                    enabled = enabled,
                )
            }
        }
        FieldSupport(null, error)
    }
}

/**
 * Date of birth as three pickers, day, month and year (07 section 4.1), not a calendar: scrolling
 * decades in a calendar is slow. An incomplete or impossible date gives `null`. The three stack
 * when the text is too large for one line.
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
    enabled: Boolean = true,
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
    val days = remember { (1..31).map { Option(it.toString(), it.toString()) } }
    val months =
        remember {
            (1..12).map { Option(it.toString(), Month.of(it).getDisplayName(TextStyle.FULL, Locale.ENGLISH)) }
        }
    val years =
        remember(currentYear, minAge, maxAge) {
            (currentYear - minAge downTo currentYear - maxAge).map { Option(it.toString(), it.toString()) }
        }
    val bad = error != null || invalid
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        AdaptiveRow(spacing = Spacing.s8, verticalAlignment = Alignment.Top) {
            PartSelect(
                label = stringResource(R.string.fields_date_of_birth_day),
                options = days,
                selected = day?.toString(),
                onSelect = { emit(it?.toInt(), month, year) },
                isError = bad,
                enabled = enabled,
                modifier = Modifier.grow(weight = DAY_GROWS, basis = DayBasis),
            )
            PartSelect(
                label = stringResource(R.string.fields_date_of_birth_month),
                options = months,
                selected = month?.toString(),
                onSelect = { emit(day, it?.toInt(), year) },
                isError = bad,
                enabled = enabled,
                modifier = Modifier.grow(weight = MONTH_GROWS, basis = MonthBasis),
            )
            PartSelect(
                label = stringResource(R.string.fields_date_of_birth_year),
                options = years,
                selected = year?.toString(),
                onSelect = { emit(day, month, it?.toInt()) },
                isError = bad,
                enabled = enabled,
                modifier = Modifier.grow(weight = YEAR_GROWS, basis = YearBasis),
            )
        }
        val notADate = stringResource(R.string.fields_date_of_birth_invalid)
        FieldSupport(helper, error ?: notADate.takeIf { invalid })
    }
}

/** One part of a field made of several pickers: its label is the placeholder, its error the field's. */
@Composable
private fun PartSelect(
    label: String,
    options: List<Option>,
    selected: String?,
    onSelect: (String?) -> Unit,
    isError: Boolean,
    modifier: Modifier = Modifier,
    placeholder: String = label,
    enabled: Boolean = true,
    display: ((Option) -> String)? = null,
) {
    SelectField(
        label = label,
        options = options,
        selected = selected,
        onSelect = onSelect,
        placeholder = placeholder,
        showLabel = false,
        error = if (isError) "" else null,
        enabled = enabled,
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
    enabled: Boolean = true,
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
        AdaptiveRow(spacing = Spacing.s8, verticalAlignment = Alignment.Top) {
            PartSelect(
                label = stringResource(R.string.fields_height_feet),
                options =
                    (MIN_FEET..MAX_FEET).map {
                        Option(it.toString(), text(R.string.fields_height_feet_option, "feet" to it))
                    },
                selected = feet?.toString(),
                onSelect = { emit(it?.toInt(), inches) },
                isError = error != null,
                enabled = enabled,
                modifier = Modifier.grow(basis = HeightBasis),
            )
            PartSelect(
                label = stringResource(R.string.fields_height_inches),
                options =
                    (if (feet == MAX_FEET) listOf(0) else (0..11).toList()).map {
                        Option(it.toString(), text(R.string.fields_height_inches_option, "inches" to it))
                    },
                selected = inches?.toString(),
                onSelect = { emit(feet, it?.toInt()) },
                isError = error != null,
                enabled = enabled,
                modifier = Modifier.grow(basis = HeightBasis),
            )
        }
        val f = feet
        val i = inches
        val cm = if (f != null && i != null) Formatters.feetInchesToCm(f, i) else null
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
        AdaptiveRow(spacing = Spacing.s8, verticalAlignment = Alignment.Top) {
            PartSelect(
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
                isError = false,
                modifier = Modifier.grow(weight = DIAL_GROWS, basis = DialBasis),
                // The closed box is narrow: the flag and dial code, the sheet lists full names.
                display = { option ->
                    val code = countries.firstOrNull { it.code == option.code }?.dialCode.orEmpty()
                    "${Phone.flag(option.code)} $code".trim()
                },
            )
            KrTextInput(
                value = national,
                onValueChange = { next ->
                    val cleaned = next.filter { it.isDigit() || it == ' ' || it == '-' }.take(MAX_PHONE)
                    national = cleaned
                    onChange(Phone.toE164(dial, cleaned))
                },
                placeholder = if (dial == "+92") stringResource(R.string.fields_phone_placeholder_pk) else null,
                isError = error != null,
                errorMessage = error,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier =
                    Modifier
                        .grow(weight = NUMBER_GROWS, basis = NumberBasis)
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
@Suppress("DEPRECATION") // As KrTextInput.
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
        AdaptiveRow(
            modifier = Modifier.fillMaxWidth(),
            lineSpacing = Spacing.s4,
            verticalAlignment = Alignment.Top,
        ) {
            Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.grow())
            Text(
                text = shown,
                style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = TABULAR_FIGURES),
                color = MaterialTheme.colorScheme.primary,
            )
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
    val scheme = MaterialTheme.colorScheme
    val colors =
        SliderDefaults.colors(
            thumbColor = scheme.primary,
            activeTrackColor = scheme.primary,
            // A control's edge needs 3:1: the soft fill would vanish into the band.
            inactiveTrackColor = scheme.outline,
            disabledThumbColor = scheme.onSurfaceVariant,
            disabledActiveTrackColor = scheme.onSurfaceVariant,
            disabledInactiveTrackColor = scheme.outlineVariant,
        )
    // The handles follow the values given, as the controlled overload does; a reset can move both.
    state.moveTo(start.toFloat(), end.toFloat())
    RangeSlider(
        state = state,
        onValueChange = { range ->
            state.moveTo(range.start, range.endInclusive)
            onChange(range.start.roundToInt(), range.endInclusive.roundToInt())
        },
        modifier = modifier.heightIn(min = Sizes.touch),
        enabled = enabled,
        colors = colors,
        track = { sliderState ->
            SliderDefaults.Track(
                rangeSliderState = sliderState,
                enabled = enabled,
                colors = colors,
                drawStopIndicator = null,
                drawTick = { _, _ -> },
            )
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

/**
 * How much a preference matters: must, high, medium, low (`ImportanceField`), as chips that wrap
 * where four segments would cut their words.
 */
@Composable
fun ImportanceField(
    value: Importance,
    onChange: (Importance) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
) {
    val reference = LocalReference.current
    val options = remember(reference) { reference.optionsOf(Lists.IMPORTANCE, Importance.entries) }
    Column(modifier.fillMaxWidth()) {
        if (label != null) FieldLabel(label)
        SingleChoiceChips(options = options, selected = value, onSelect = onChange, enabled = enabled)
        if (value == Importance.MUST && enabled) {
            Text(
                text = stringResource(R.string.fields_importance_must_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier =
                    Modifier
                        .semantics { liveRegion = LiveRegionMode.Polite }
                        .padding(top = Spacing.s8),
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
    enabled: Boolean = true,
) {
    Column(modifier.fillMaxWidth()) {
        CheckboxRow(
            checked = checked,
            onCheckedChange = onCheckedChange,
            label = label,
            enabled = enabled,
            error = error != null,
        )
        FieldSupport(null, error)
    }
}

private const val SEARCH_THRESHOLD = 8
private const val CHIP_THRESHOLD = 12
private const val SEARCH_SHEET_SHARE = 0.92f
private const val OPTION_TYPE = "option"
private const val MIN_FEET = 4
private const val MAX_FEET = 7
private const val MAX_PHONE = 16
private const val DAY_GROWS = 0.7f
private const val MONTH_GROWS = 1.2f
private const val YEAR_GROWS = 0.9f
private const val DIAL_GROWS = 0.36f
private const val NUMBER_GROWS = 0.64f
private val PickerInset = Spacing.s12
private val DayBasis = 70.dp
private val MonthBasis = 122.dp
private val YearBasis = 88.dp
private val HeightBasis = 120.dp
private val DialBasis = 112.dp
private val NumberBasis = 150.dp
