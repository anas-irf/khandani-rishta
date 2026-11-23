package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.TextStatus
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ChoiceChips
import com.khandanirishta.app.ui.components.DiamondTitle
import com.khandanirishta.app.ui.components.DisclosureHeader
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.IconTextLine
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrChoiceChip
import com.khandanirishta.app.ui.components.KrOutlinedIconButton
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.ReferenceLine
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.linkedText
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.TABULAR_FIGURES
import kotlinx.coroutines.launch

/*
 * What the own-profile forms share (the web's form-shell.tsx and fields.tsx): flat groups under
 * diamond headings, labels above fields, and errors that are an icon and words. None of it has
 * side padding: the screen gives the gutters.
 */

/** Spacing between the fields of a form column. */
val FieldSpacing = Spacing.s20

/** The room over a group's heading, on top of [FieldSpacing]. */
internal val GroupSpace = Spacing.s12

/**
 * Finds a field on screen, so a failed submit can scroll to the first invalid one and focus it
 * (07 section 2.4 step 3, 17 section 8.3): TalkBack then reads that field and its error instead of
 * staying on Save.
 */
@Stable
class FieldLocator {
    private val requesters = HashMap<String, BringIntoViewRequester>()
    private val focus = HashMap<String, FocusRequester>()

    fun requester(field: String): BringIntoViewRequester = requesters.getOrPut(field) { BringIntoViewRequester() }

    fun focusRequester(field: String): FocusRequester = focus.getOrPut(field) { FocusRequester() }

    suspend fun reveal(field: String) {
        runCatching { requesters[field]?.bringIntoView() }
        // A group of chips has nothing that takes focus in touch mode: then it is only scrolled to.
        runCatching { focus[field]?.requestFocus() }
    }
}

@Composable
fun rememberFieldLocator(): FieldLocator = remember { FieldLocator() }

/** Marks the field [field] so it can be scrolled into view and focused. */
fun Modifier.locate(
    field: String,
    locator: FieldLocator,
): Modifier = bringIntoViewRequester(locator.requester(field)).focusRequester(locator.focusRequester(field))

/** Scrolls to the field of each new [reveal] request, after collapsed groups had a frame to open. */
@Composable
fun RevealEffect(
    reveal: Reveal?,
    locator: FieldLocator,
) {
    LaunchedEffect(reveal) {
        val target = reveal ?: return@LaunchedEffect
        withFrameNanos { }
        withFrameNanos { }
        locator.reveal(target.field)
    }
}

/** Keeps touches away from the content below while a save runs (07 section 2.4). */
@Composable
fun BoxScope.BusyOverlay(
    busy: Boolean,
    modifier: Modifier = Modifier,
) {
    if (!busy) return
    Box(
        modifier
            .matchParentSize()
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(PointerEventPass.Initial).changes.forEach { it.consume() }
                    }
                }
            },
    )
}

/**
 * The error summary at the top of a form (07 section 2.4, 17 section 8.3): "Please check the
 * highlighted fields.", the server errors that belong to no field and, with [onShowFirstError],
 * the [firstError] as a link that leads to its field.
 */
@Composable
fun FormSummaryBox(
    unmatched: List<UiText>,
    modifier: Modifier = Modifier,
    onShowFirstError: (() -> Unit)? = null,
    firstError: String? = null,
) {
    val res = LocalResources.current
    StatusBanner(
        text = null,
        title = stringResource(R.string.errors_form_summary),
        tone = StatusTone.DANGER,
        announce = true,
        modifier = modifier,
    ) {
        unmatched.forEach { message ->
            Text(message.resolve(res), style = MaterialTheme.typography.bodySmall)
        }
        if (!firstError.isNullOrBlank() && onShowFirstError != null) {
            KrTextLink(text = firstError, onClick = onShowFirstError)
        }
    }
}

/** The [FormSummaryBox] of [form]: its link leads to the first invalid one of [fields]. */
@Composable
internal fun <V> FormErrors(
    form: FormState<V>,
    fields: List<String>,
    locator: FieldLocator,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    val first = form.firstError(fields)
    FormSummaryBox(
        unmatched = form.unmatched,
        firstError = first?.let { form.error(it) }?.resolve(res),
        onShowFirstError = {
            if (first != null) {
                scope.launch { locator.reveal(first) }
            }
        },
        modifier = modifier,
    )
}

/** "Something went wrong..." with "Try again" and the request id (07 section 16.9, 08 section 2.5). */
@Composable
fun InlineFailureBox(
    text: String,
    error: ApiError?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    enabled: Boolean = true,
) {
    StatusBanner(text = text, tone = StatusTone.DANGER, announce = true, modifier = modifier) {
        KrButton(
            text = stringResource(R.string.profile_sections_form_try_again),
            onClick = onRetry,
            variant = KrButtonVariant.SECONDARY,
            enabled = enabled && LocalOnline.current,
            loading = busy,
            modifier = Modifier.padding(top = Spacing.s8),
        )
        ReferenceLine(error?.requestId)
    }
}

/** A warning: an icon and words on attention soft (the warning of 07 section 4.1). */
@Composable
fun WarningBox(
    text: String,
    modifier: Modifier = Modifier,
) {
    StatusBanner(text = text, tone = StatusTone.WARNING, modifier = modifier)
}

/** A diamond heading over a group of fields (07 sections 8 and 9, DESIGN.md section 6.10). */
@Composable
fun GroupTitle(
    title: String,
    modifier: Modifier = Modifier,
    optional: Boolean = false,
) {
    DiamondTitle(
        title = title,
        style = MaterialTheme.typography.titleMedium,
        note = if (optional) stringResource(R.string.common_optional) else null,
        modifier = modifier.semantics(mergeDescendants = true) { heading() },
    )
}

/** A group heading that opens and closes its fields (07 section 9.1, 07 section 11.2). */
@Composable
fun CollapsibleHeader(
    title: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    optional: Boolean = false,
) {
    DisclosureHeader(
        title = title,
        expanded = expanded,
        onExpandedChange = { onToggle() },
        note = if (optional) stringResource(R.string.common_optional) else null,
        ornament = true,
        modifier = modifier,
    )
}

/**
 * The fields that a [CollapsibleHeader] or a switch shows. When they open for an error
 * ([instant]) they do so at once, so [RevealEffect] finds the field where it will stay.
 */
@Composable
internal fun CollapsibleContent(
    visible: Boolean,
    modifier: Modifier = Modifier,
    instant: Boolean = false,
    spacing: Dp = FieldSpacing,
    content: @Composable ColumnScope.() -> Unit,
) {
    val enter =
        if (instant) {
            EnterTransition.None
        } else {
            fadeIn(Motion.base()) + expandVertically(Motion.base(), expandFrom = Alignment.Top)
        }
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = enter,
        exit = fadeOut(Motion.fast()) + shrinkVertically(Motion.base(), shrinkTowards = Alignment.Top),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(spacing), content = content)
    }
}

/** A muted helper line in a form. */
@Composable
fun HelperText(
    text: String,
    modifier: Modifier = Modifier,
) {
    CaptionText(text, modifier)
}

/** "Under review" or "Not approved" next to a moderated text (08 section 1.4): icon and words. */
@Composable
fun TextStatusNote(
    status: TextStatus?,
    modifier: Modifier = Modifier,
) {
    val pending = status == TextStatus.PENDING
    if (!pending && status != TextStatus.REJECTED) return
    val note =
        if (pending) {
            R.string.profile_sections_form_text_pending
        } else {
            R.string.profile_sections_form_text_rejected
        }
    StatusBanner(
        text = stringResource(note),
        tone = if (pending) StatusTone.WARNING else StatusTone.DANGER,
        icon = if (pending) Icons.Outlined.Schedule else Icons.Outlined.Cancel,
        modifier = modifier,
    )
}

/**
 * A field the owner can no longer edit (08 section 2.2): read-only text with a lock on sand
 * strong, and how to ask support for a correction, with the support address as a mail link.
 */
@Composable
fun LockedField(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    val me = LocalMe.current
    val links = rememberLinkOpener()
    val email = me?.config?.supportEmail.orEmpty()
    val code = me?.profile?.publicCode.orEmpty()
    val subject = text(R.string.profile_sections_locked_mail_subject, "code" to code)
    val raw = text(R.string.profile_sections_locked_explanation, "email" to email, "code" to code)
    val lockedState = stringResource(R.string.profile_sections_locked_icon)
    val linkColor = MaterialTheme.colorScheme.primary
    val valueStyle = MaterialTheme.typography.bodyMedium
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = KrTheme.colors.disabledContainer,
            contentColor = KrTheme.colors.onDisabledContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            IconTextLine(
                icon = Icons.Outlined.Lock,
                style = valueStyle,
                gap = Spacing.s12,
                modifier =
                    Modifier
                        .semantics(mergeDescendants = true) { stateDescription = lockedState }
                        .padding(Spacing.s16),
            ) {
                MemberText(
                    text = value,
                    style = valueStyle,
                    color = KrTheme.colors.onDisabledContainer,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Text(
            text =
                remember(raw, linkColor, links, email, subject) {
                    linkedText(raw, linkColor, mapOf("mail" to { links.email(email, subject) }))
                },
            style = KrType.caption,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = Spacing.s8),
        )
    }
}

/**
 * A number chosen with minus and plus buttons under its label (07 sections 4.1 and 8.1). An empty
 * stepper shows [emptyText] ("Not set") with a plus button; with [clearable], minus at the lowest
 * value empties it.
 */
@Composable
fun StepperField(
    label: String,
    value: Int?,
    onChange: (Int?) -> Unit,
    range: IntRange,
    modifier: Modifier = Modifier,
    error: String? = null,
    optional: Boolean = false,
    clearable: Boolean = false,
    enabled: Boolean = true,
    emptyText: String? = null,
) {
    val shown = value?.toString() ?: emptyText.orEmpty()
    val spoken = if (shown.isEmpty()) label else "$label, $shown"
    val typography = MaterialTheme.typography
    val colors = MaterialTheme.colorScheme
    // Wide enough for "Not set" at any text size, so plus does not move as the number grows.
    val valueWidth = StepperValueWidth * LocalDensity.current.fontScale.coerceAtLeast(1f)
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label, optional = optional)
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            KrOutlinedIconButton(
                icon = Icons.Outlined.Remove,
                contentDescription = text(R.string.fields_number_decrease, "label" to label),
                onClick = { if (value != null) onChange(if (value > range.first) value - 1 else null) },
                enabled = enabled && value != null && (value > range.first || clearable),
            )
            Text(
                text = shown,
                style =
                    if (value != null) {
                        typography.titleMedium.copy(fontFeatureSettings = TABULAR_FIGURES)
                    } else {
                        typography.bodyMedium
                    },
                color = if (value != null) colors.onSurface else colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .weight(1f, fill = false)
                        .semantics {
                            contentDescription = spoken
                            liveRegion = LiveRegionMode.Polite
                        }.widthIn(min = valueWidth),
            )
            KrOutlinedIconButton(
                icon = Icons.Outlined.Add,
                contentDescription = text(R.string.fields_number_increase, "label" to label),
                onClick = { onChange(if (value == null) range.first else (value + 1).coerceAtMost(range.last)) },
                enabled = enabled && (value == null || value < range.last),
            )
        }
        FieldSupport(null, error)
    }
}

/** Two to four choices (07 section 2.6), as chips that wrap where segments would cut their words. */
@Composable
fun SegmentedField(
    label: String,
    options: List<Option>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    optional: Boolean = false,
    enabled: Boolean = true,
) {
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label, optional = optional)
        ChoiceChips(options = options, selected = selected, onSelect = onSelect, enabled = enabled)
        FieldSupport(null, error)
    }
}

/**
 * Several choices as toggle chips, optionally grouped under headings (hobbies by category,
 * 07 section 9.1). With [max] the other chips are disabled once it is reached and [maxMessage]
 * is shown. With [emptyLabel] a pressed chip ("Any") stands for the empty selection and clears it.
 */
@Composable
fun ToggleChipsField(
    label: String,
    groups: List<Pair<String?, List<Option>>>,
    selected: Set<String>,
    onChange: (Set<String>) -> Unit,
    modifier: Modifier = Modifier,
    max: Int? = null,
    maxMessage: String? = null,
    error: String? = null,
    optional: Boolean = false,
    enabled: Boolean = true,
    emptyLabel: String? = null,
    showLabel: Boolean = true,
) {
    val reached = max != null && selected.size >= max
    // The chips keep the same lambdas, so typing elsewhere in the form does not redraw all of them.
    val latestSelected by rememberUpdatedState(selected)
    val latestOnChange by rememberUpdatedState(onChange)
    val toggle =
        remember {
            { code: String ->
                val current = latestSelected
                latestOnChange(if (code in current) current - code else current + code)
            }
        }
    val clear =
        remember {
            {
                if (latestSelected.isNotEmpty()) latestOnChange(emptySet())
            }
        }
    Column(modifier.fillMaxWidth()) {
        if (showLabel) FieldLabel(label, optional = optional)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            groups.forEachIndexed { index, (title, options) ->
                Column {
                    if (title != null) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = Spacing.s8),
                        )
                    }
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
                    ) {
                        if (index == 0 && emptyLabel != null) {
                            KrChoiceChip(
                                text = emptyLabel,
                                selected = selected.isEmpty(),
                                onClick = clear,
                                enabled = enabled,
                            )
                        }
                        options.forEach { option ->
                            val chosen = option.code in selected
                            KrChoiceChip(
                                text = option.label,
                                selected = chosen,
                                onClick = { toggle(option.code) },
                                enabled = enabled && (chosen || !reached),
                            )
                        }
                    }
                }
            }
        }
        if (reached && maxMessage != null) {
            FieldSupport(maxMessage, error, Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        } else {
            FieldSupport(null, error)
        }
    }
}

private val StepperValueWidth = 88.dp
