package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Option
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.TextStatus
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FieldSupport
import com.khandanirishta.app.ui.components.ReferenceLine
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.linkedText
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

/** Spacing between the fields of a form column. */
val FieldSpacing = 20.dp

/**
 * Finds a field on screen, so a failed submit can scroll to the first invalid one (07 section 2.4
 * step 3, 17 section 8.3).
 */
@Stable
class FieldLocator {
    private val requesters = HashMap<String, BringIntoViewRequester>()

    fun requester(field: String): BringIntoViewRequester = requesters.getOrPut(field) { BringIntoViewRequester() }

    suspend fun reveal(field: String) {
        runCatching { requesters[field]?.bringIntoView() }
    }
}

@Composable
fun rememberFieldLocator(): FieldLocator = remember { FieldLocator() }

/** Marks the field [field] so it can be scrolled into view. */
fun Modifier.locate(
    field: String,
    locator: FieldLocator,
): Modifier = bringIntoViewRequester(locator.requester(field))

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

/** "Please check the highlighted fields." and the server errors that belong to no field. */
@Composable
fun FormSummaryBox(
    unmatched: List<UiText>,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = MaterialTheme.shapes.medium,
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.errors_form_summary), style = MaterialTheme.typography.titleSmall)
                unmatched.forEach { message ->
                    Text("• " + message.resolve(res), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

/** "Something went wrong..." with "Try again" and the request id (07 section 16.9, 08 section 2.5). */
@Composable
fun InlineFailureBox(
    text: String,
    error: ApiError?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = MaterialTheme.shapes.medium,
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(text, style = MaterialTheme.typography.bodyMedium)
            }
            OutlinedButton(onClick = onRetry, enabled = !busy) {
                Text(stringResource(R.string.profile_sections_form_try_again))
            }
            ReferenceLine(error?.requestId)
        }
    }
}

/** A warning in a tinted box (the gender and date of birth warning, 07 section 4.1). */
@Composable
fun WarningBox(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = KrTheme.colors.warningContainer,
        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
            Icon(
                Icons.Outlined.WarningAmber,
                contentDescription = null,
                tint = KrTheme.colors.warning,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** A heading over a group of fields (07 sections 8 and 9). */
@Composable
fun GroupTitle(
    title: String,
    modifier: Modifier = Modifier,
    optional: Boolean = false,
) {
    Row(modifier.semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (optional) {
            Spacer(Modifier.width(6.dp))
            Text(
                stringResource(R.string.common_optional),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
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
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clickable(role = Role.Button, onClick = onToggle),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier
                    .weight(1f)
                    .semantics { heading() },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                if (optional) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        stringResource(R.string.common_optional),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** A muted helper line in a form. */
@Composable
fun HelperText(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/** "Under review" or "Not approved" next to a moderated text (08 section 1.4). */
@Composable
fun TextStatusNote(
    status: TextStatus?,
    modifier: Modifier = Modifier,
) {
    val pending = status == TextStatus.PENDING
    if (!pending && status != TextStatus.REJECTED) return
    Surface(
        color = if (pending) KrTheme.colors.warningContainer else MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.small,
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            stringResource(
                if (pending) {
                    R.string.profile_sections_form_text_pending
                } else {
                    R.string.profile_sections_form_text_rejected
                },
            ),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

/**
 * A field the owner can no longer edit (08 section 2.2): read-only text with a lock, and how to
 * ask support for a correction, with the support address as a mail link.
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
    val linkColor = MaterialTheme.colorScheme.primary
    Column(modifier.fillMaxWidth()) {
        FieldLabel(label)
        Surface(
            shape = MaterialTheme.shapes.small,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier
                    .heightIn(min = 56.dp)
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.Lock,
                    contentDescription = stringResource(R.string.profile_sections_locked_icon),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(value, style = MaterialTheme.typography.bodyLarge)
            }
        }
        Text(
            remember(raw, linkColor, email, subject) {
                linkedText(raw, linkColor, mapOf("mail" to { links.email(email, subject) }))
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

/**
 * A number chosen with minus and plus buttons (07 sections 4.1 and 8.1). An empty stepper shows
 * [emptyText] ("Not set") with a plus button; with [clearable], minus at the lowest value empties it.
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
    Column(modifier.fillMaxWidth()) {
        Surface(
            shape = MaterialTheme.shapes.small,
            color = MaterialTheme.colorScheme.surfaceContainerLowest,
            border =
                BorderStroke(
                    1.dp,
                    if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outlineVariant,
                ),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier
                    .heightIn(min = 64.dp)
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(label, style = MaterialTheme.typography.labelLarge)
                    if (optional) {
                        Text(
                            stringResource(R.string.common_optional),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                val canDecrease = enabled && value != null && (value > range.first || clearable)
                FilledTonalIconButton(
                    onClick = { if (value != null) onChange(if (value > range.first) value - 1 else null) },
                    enabled = canDecrease,
                ) {
                    Icon(
                        Icons.Outlined.Remove,
                        contentDescription = text(R.string.fields_number_decrease, "label" to label),
                    )
                }
                val set = value != null
                val colors = MaterialTheme.colorScheme
                Text(
                    value?.toString() ?: emptyText.orEmpty(),
                    style = if (set) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium,
                    color = if (set) colors.onSurface else colors.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.width(if (value != null) 40.dp else 64.dp),
                )
                FilledTonalIconButton(
                    onClick = { onChange(if (value == null) range.first else (value + 1).coerceAtMost(range.last)) },
                    enabled = enabled && (value == null || value < range.last),
                ) {
                    Icon(
                        Icons.Outlined.Add,
                        contentDescription = text(R.string.fields_number_increase, "label" to label),
                    )
                }
            }
        }
        FieldSupport(null, error)
    }
}

/** Two to four choices as a segmented control (07 section 2.6). */
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
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed { index, option ->
                SegmentedButton(
                    selected = option.code == selected,
                    onClick = { onSelect(option.code) },
                    shape = SegmentedButtonDefaults.itemShape(index, options.size),
                    enabled = enabled,
                    label = { Text(option.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                )
            }
        }
        FieldSupport(null, error)
    }
}

/**
 * Several choices as toggle chips, optionally grouped under headings (hobbies by category,
 * 07 section 9.1). With [max] the other chips are disabled once it is reached and [maxMessage]
 * is shown. With [emptyLabel] a pressed chip ("Any") stands for the empty selection and clears it.
 */
@OptIn(ExperimentalLayoutApi::class)
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
    Column(modifier.fillMaxWidth()) {
        if (showLabel) FieldLabel(label, optional = optional)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            groups.forEachIndexed { index, (title, options) ->
                Column {
                    if (title != null) {
                        Text(
                            title,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (index == 0 && emptyLabel != null) {
                            ChoiceChip(
                                label = emptyLabel,
                                chosen = selected.isEmpty(),
                                enabled = enabled,
                                onClick = { if (selected.isNotEmpty()) onChange(emptySet()) },
                            )
                        }
                        options.forEach { option ->
                            val chosen = option.code in selected
                            ChoiceChip(
                                label = option.label,
                                chosen = chosen,
                                enabled = enabled && (chosen || !reached),
                                onClick = {
                                    onChange(if (chosen) selected - option.code else selected + option.code)
                                },
                            )
                        }
                    }
                }
            }
        }
        if (reached && maxMessage != null) {
            FieldSupport(maxMessage, error)
        } else {
            FieldSupport(null, error)
        }
    }
}

@Composable
private fun ChoiceChip(
    label: String,
    chosen: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    FilterChip(
        selected = chosen,
        onClick = onClick,
        enabled = enabled,
        label = { Text(label) },
        leadingIcon =
            if (chosen) {
                { Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(18.dp)) }
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

/** A card that groups related fields, with an optional title. */
@Composable
fun FormCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (title != null) GroupTitle(title)
            content()
        }
    }
}
