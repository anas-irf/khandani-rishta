package com.khandanirishta.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/**
 * Material's outlined field with the borders of DESIGN.md section 4.2: 1.5 in the control colour,
 * which Material's own field draws at 1, and 3 in primary with focus. Text is 17 and follows its
 * own direction. Use `KrTextField` for a field with a label; this is the control alone, and it
 * takes the width its caller gives it.
 *
 * The value-based field, as Material's own OutlinedTextField(value) is built: the forms hold their
 * values as strings in view models, and the identity mask is a VisualTransformation.
 */
@Suppress("DEPRECATION")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KrTextInput(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    isError: Boolean = false,
    errorMessage: String? = null,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    textStyle: TextStyle = MaterialTheme.typography.bodyMedium,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val interactions = remember { MutableInteractionSource() }
    val scheme = MaterialTheme.colorScheme
    val colors = inputColors()
    val shape = MaterialTheme.shapes.medium
    val color = if (enabled) scheme.onSurface else KrTheme.colors.onDisabledContainer
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier =
            modifier
                .semantics { if (!errorMessage.isNullOrBlank()) error(errorMessage) }
                .defaultMinSize(minHeight = Sizes.touchLarge),
        enabled = enabled,
        readOnly = readOnly,
        textStyle = textStyle.copy(color = color, textDirection = TextDirection.Content),
        cursorBrush = SolidColor(if (isError) scheme.error else scheme.primary),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        visualTransformation = visualTransformation,
        interactionSource = interactions,
        decorationBox = { innerTextField ->
            OutlinedTextFieldDefaults.DecorationBox(
                value = value,
                innerTextField = innerTextField,
                enabled = enabled,
                singleLine = singleLine,
                visualTransformation = visualTransformation,
                interactionSource = interactions,
                isError = isError,
                placeholder =
                    placeholder?.let {
                        {
                            Text(
                                text = it,
                                style = textStyle,
                                maxLines = if (singleLine) 1 else Int.MAX_VALUE,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    },
                leadingIcon = leadingIcon,
                trailingIcon = trailingIcon,
                colors = colors,
                contentPadding = InputPadding,
                container = {
                    OutlinedTextFieldDefaults.Container(
                        enabled = enabled,
                        isError = isError,
                        interactionSource = interactions,
                        colors = colors,
                        shape = shape,
                        focusedBorderThickness = Strokes.focus,
                        unfocusedBorderThickness = Strokes.control,
                    )
                },
            )
        },
    )
}

/**
 * The same look over a [TextFieldState], for a field whose cursor the app has to place: a chat
 * starter puts it after the sentence it fills in. One line sits in the middle of the height, and
 * more grow the field within [lineLimits].
 */
@Composable
fun KrTextInput(
    state: TextFieldState,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    inputTransformation: InputTransformation? = null,
    lineLimits: TextFieldLineLimits = TextFieldLineLimits.Default,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
) {
    val focused by interactionSource.collectIsFocusedAsState()
    val scheme = MaterialTheme.colorScheme
    val fill = KrTheme.colors.card
    val shape = MaterialTheme.shapes.medium
    val style = MaterialTheme.typography.bodyMedium
    val line = if (focused) Strokes.focus else Strokes.control
    val lineColor = if (focused) scheme.primary else scheme.outline
    BasicTextField(
        state = state,
        modifier = modifier,
        inputTransformation = inputTransformation,
        textStyle = style.copy(color = scheme.onSurface, textDirection = TextDirection.Content),
        keyboardOptions = keyboardOptions,
        lineLimits = lineLimits,
        interactionSource = interactionSource,
        cursorBrush = SolidColor(scheme.primary),
        decorator = { innerTextField ->
            Box(
                Modifier
                    .defaultMinSize(minHeight = Sizes.touchLarge)
                    .background(fill, shape)
                    .border(line, lineColor, shape)
                    .padding(InputPadding),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (placeholder != null && state.text.isEmpty()) {
                    Text(placeholder, style = style, color = scheme.onSurfaceVariant)
                }
                innerTextField()
            }
        },
    )
}

@Composable
private fun inputColors(): TextFieldColors {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    return OutlinedTextFieldDefaults.colors(
        focusedContainerColor = extra.card,
        unfocusedContainerColor = extra.card,
        disabledContainerColor = extra.disabledContainer,
        errorContainerColor = colors.errorContainer,
        focusedBorderColor = colors.primary,
        unfocusedBorderColor = colors.outline,
        disabledBorderColor = Color.Transparent,
        errorBorderColor = colors.error,
        focusedPlaceholderColor = colors.onSurfaceVariant,
        unfocusedPlaceholderColor = colors.onSurfaceVariant,
        disabledPlaceholderColor = extra.onDisabledContainer,
        errorPlaceholderColor = colors.onSurfaceVariant,
        disabledTextColor = extra.onDisabledContainer,
        disabledLeadingIconColor = extra.onDisabledContainer,
        disabledTrailingIconColor = extra.onDisabledContainer,
    )
}

/**
 * What a field keeps of an edit from [value] to [next]. An addition at the end is cut at [max].
 * One before the end is not taken, as it would push the last words out without a word.
 */
internal fun withinLimit(
    value: String,
    next: String,
    max: Int?,
): String =
    when {
        max == null || next.length <= max -> next
        !next.startsWith(value) && next.endsWith(value.takeLast(1)) -> value
        else -> next.take(max)
    }

/** The keyboard's Search key puts the keyboard away where the results filter as the member types. */
@Composable
fun rememberHideKeyboardOnSearch(): KeyboardActions {
    val keyboard = LocalSoftwareKeyboardController.current
    return remember(keyboard) { KeyboardActions(onSearch = { keyboard?.hide() }) }
}

private val InputPadding = PaddingValues(horizontal = Spacing.s16, vertical = Spacing.s12)
