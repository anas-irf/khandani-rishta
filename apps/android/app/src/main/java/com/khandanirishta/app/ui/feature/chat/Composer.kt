package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.maxLengthTrim
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrTextInput
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.PillShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
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
 * The composer (16 section 6.11 block 5) in the action bar: a field that grows to five lines,
 * Send, and a counter from 1,800 characters up to the maximum of 2,000. The keyboard's enter key
 * makes a new line; the button sends. While the member types, a `typing` frame goes out (the
 * client sends at most one every 3 seconds).
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
    val label = stringResource(R.string.chat_composer_label)
    val banner: (@Composable () -> Unit)? =
        if (limitReached) {
            {
                StatusBanner(
                    text = stringResource(R.string.chat_composer_limit_banner),
                    tone = StatusTone.WARNING,
                    announce = true,
                )
            }
        } else {
            null
        }
    KrActionBar(modifier = modifier, spacing = Spacing.s4, banner = banner) {
        Row(
            // After the counter, which is never pushed out by a long draft.
            modifier = Modifier.weight(1f, fill = false),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
            verticalAlignment = Alignment.Bottom,
        ) {
            KrTextInput(
                state = state,
                // Within the height that is left, so the field scrolls and Send stays in view.
                modifier = Modifier.weight(1f).semantics { contentDescription = label },
                placeholder = stringResource(R.string.chat_composer_placeholder),
                inputTransformation = InputTransformation.maxLengthTrim(MESSAGE_MAX_LENGTH),
                lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = MAX_LINES),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                interactionSource = interactions,
            )
            SendButton(enabled = !state.text.isBlank(), onClick = onSend)
        }
        Counter(length = state.text.length)
    }
}

@Composable
private fun SendButton(
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    val label = stringResource(R.string.chat_composer_send)
    InvertedFocusRing {
        FilledIconButton(
            onClick = onClick,
            enabled = enabled,
            shape = PillShape,
            colors =
                IconButtonDefaults.filledIconButtonColors(
                    containerColor = colors.primary,
                    contentColor = colors.onPrimary,
                    disabledContainerColor = extra.disabledContainer,
                    disabledContentColor = extra.onDisabledContainer,
                ),
            modifier = Modifier.size(Sizes.touchLarge),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Send,
                contentDescription = label,
                modifier = Modifier.size(Sizes.icon),
            )
        }
    }
}

@Composable
private fun Counter(length: Int) {
    if (length < COUNTER_FROM) return
    val full = length >= MESSAGE_MAX_LENGTH
    val colors = MaterialTheme.colorScheme
    Text(
        text = text(R.string.chat_composer_counter, "count" to length, "max" to MESSAGE_MAX_LENGTH),
        style = KrType.caption.merge(KrType.numbers),
        color = if (full) colors.error else colors.onSurfaceVariant,
        textAlign = TextAlign.End,
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { if (full) liveRegion = LiveRegionMode.Polite },
    )
}

/** The grey bar that replaces the composer (16 section 6.11 "Composer disabled states"). */
@Composable
internal fun ComposerDisabled(
    reason: ComposerBlock,
    onReopen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sentence =
        when (reason) {
            ComposerBlock.ENDED -> R.string.chat_disabled_ended
            ComposerBlock.UNAVAILABLE -> R.string.chat_disabled_unavailable
            ComposerBlock.CLOSED -> R.string.chat_disabled_closed
            ComposerBlock.OFFLINE -> R.string.chat_disabled_offline
        }
    val icon =
        when (reason) {
            ComposerBlock.ENDED, ComposerBlock.CLOSED -> Icons.Outlined.Lock
            ComposerBlock.UNAVAILABLE -> Icons.Outlined.PersonOff
            ComposerBlock.OFFLINE -> Icons.Outlined.CloudOff
        }
    val insets = WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)
    Surface(
        color = KrTheme.colors.disabledContainer,
        contentColor = KrTheme.colors.onDisabledContainer,
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(
            modifier =
                Modifier
                    .windowInsetsPadding(insets)
                    .verticalScroll(rememberScrollState())
                    .contentWidth()
                    .heightIn(min = Sizes.touchLarge)
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            IconText(icon = icon, text = stringResource(sentence), textAlign = TextAlign.Center)
            if (reason == ComposerBlock.CLOSED) {
                KrTextLink(stringResource(R.string.chat_disabled_reopen), onReopen)
            }
        }
    }
}

private const val MAX_LINES = 5
