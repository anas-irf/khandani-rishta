package com.khandanirishta.app.ui.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.maxLengthTrim
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import kotlinx.coroutines.flow.drop

/** Why the composer is replaced by a grey bar, in the order of the table of 16 section 6.11. */
enum class ComposerBlock { ENDED, UNAVAILABLE, CLOSED, OFFLINE }

internal fun composerBlock(
    ended: Boolean,
    unavailable: Boolean,
    closed: Boolean,
    offline: Boolean,
): ComposerBlock? =
    when {
        ended -> ComposerBlock.ENDED
        unavailable -> ComposerBlock.UNAVAILABLE
        closed -> ComposerBlock.CLOSED
        offline -> ComposerBlock.OFFLINE
        else -> null
    }

/**
 * The composer (16 section 6.11 block 5): a pill-shaped field that grows to five lines, a send
 * button, and a counter from 1,800 characters up to the maximum of 2,000. The keyboard's enter key
 * makes a new line; the button sends. While the member types, a `typing` frame goes out (the client
 * sends at most one every 3 seconds).
 */
@Composable
internal fun Composer(
    state: TextFieldState,
    limitReached: Boolean,
    onSend: () -> Unit,
    onTyping: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val isFocused by rememberUpdatedState(focused)
    val typing by rememberUpdatedState(onTyping)
    LaunchedEffect(state) {
        snapshotFlow { state.text.toString() }
            .drop(1)
            .collect { text -> if (isFocused && text.isNotBlank()) typing() }
    }
    val length = state.text.length
    val empty = state.text.isBlank()
    val label = stringResource(R.string.chat_composer_label)
    val shape = RoundedCornerShape(24.dp)
    val colors = MaterialTheme.colorScheme
    val outline = if (focused) colors.primary.copy(alpha = 0.6f) else colors.outlineVariant

    Surface(color = colors.surfaceContainerLowest, modifier = modifier.fillMaxWidth()) {
        Column {
            HorizontalDivider(color = colors.outlineVariant)
            Column(
                Modifier
                    .navigationBarsPadding()
                    .padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
            ) {
                AnimatedVisibility(visible = limitReached) {
                    Surface(
                        color = KrTheme.colors.warningContainer,
                        shape = MaterialTheme.shapes.medium,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp),
                    ) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Outlined.WarningAmber,
                                contentDescription = null,
                                tint = KrTheme.colors.warning,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                stringResource(R.string.chat_composer_limit_banner),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    BasicTextField(
                        state = state,
                        modifier =
                            Modifier
                                .weight(1f)
                                .semantics { contentDescription = label },
                        inputTransformation = InputTransformation.maxLengthTrim(MESSAGE_MAX_LENGTH),
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.onSurface),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = MAX_LINES),
                        interactionSource = interactions,
                        cursorBrush = SolidColor(colors.primary),
                        decorator = { innerTextField ->
                            Box(
                                Modifier
                                    .heightIn(min = 48.dp)
                                    .clip(shape)
                                    .background(colors.surfaceContainer)
                                    .border(1.dp, outline, shape)
                                    .padding(horizontal = 18.dp, vertical = 12.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                if (state.text.isEmpty()) {
                                    Text(
                                        stringResource(R.string.chat_composer_placeholder),
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = colors.onSurfaceVariant,
                                    )
                                }
                                innerTextField()
                            }
                        },
                    )
                    Spacer(Modifier.width(8.dp))
                    FilledIconButton(
                        onClick = onSend,
                        enabled = !empty,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Send,
                            contentDescription = stringResource(R.string.chat_composer_send),
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
                if (length >= COUNTER_FROM) {
                    Text(
                        text(R.string.chat_composer_counter, "count" to length, "max" to MESSAGE_MAX_LENGTH),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (length >= MESSAGE_MAX_LENGTH) colors.error else colors.onSurfaceVariant,
                        textAlign = TextAlign.End,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(top = 4.dp, end = 64.dp),
                    )
                }
            }
        }
    }
}

/** The grey bar that replaces the composer (16 section 6.11 "Composer disabled states"). */
@Composable
internal fun ComposerDisabled(
    reason: ComposerBlock,
    onReopen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = modifier.fillMaxWidth()) {
        Row(
            Modifier
                .navigationBarsPadding()
                .heightIn(min = 56.dp)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                when (reason) {
                    ComposerBlock.ENDED, ComposerBlock.CLOSED -> Icons.Outlined.Lock
                    ComposerBlock.UNAVAILABLE -> Icons.Outlined.PersonOff
                    ComposerBlock.OFFLINE -> Icons.Outlined.CloudOff
                },
                contentDescription = null,
                tint = muted,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(
                    when (reason) {
                        ComposerBlock.ENDED -> R.string.chat_disabled_ended
                        ComposerBlock.UNAVAILABLE -> R.string.chat_disabled_unavailable
                        ComposerBlock.CLOSED -> R.string.chat_disabled_closed
                        ComposerBlock.OFFLINE -> R.string.chat_disabled_offline
                    },
                ),
                style = MaterialTheme.typography.bodyMedium,
                color = muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (reason == ComposerBlock.CLOSED) {
                TextButton(onClick = onReopen) { Text(stringResource(R.string.chat_disabled_reopen)) }
            }
        }
    }
}

private const val MAX_LINES = 5
