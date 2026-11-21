package com.khandanirishta.app.ui.feature.settings.kit

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.GroupHeader
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.SwitchRow
import com.khandanirishta.app.ui.components.rememberModalSheetState
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.theme.KrTheme

/*
 * The building blocks of the settings screens (specs/16 sections 6.24 to 6.30): grouped cards with
 * rows inside, controls that save by themselves with a small status, and full-width actions.
 */

/** How a control that saves by itself is doing: a spinner while saving, then a brief "Saved". */
enum class SaveState { IDLE, SAVING, SAVED }

/** How long the "Saved" mark stays next to a control (specs/16 section 6.25). */
internal const val SAVED_MARK_MILLIS = 2_500L

private const val DISABLED_ALPHA = 0.5f

/** A settings screen: the back arrow and title, and the content under it. */
@Composable
internal fun SettingsScaffold(
    title: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    val navigator = LocalNavigator.current
    Scaffold(
        modifier = modifier,
        topBar = { DetailTopBar(title = title, onBack = { navigator.back() }, actions = actions) },
        containerColor = MaterialTheme.colorScheme.background,
        content = content,
    )
}

/** The scrolling column of a settings screen, inside the scaffold's [padding]. */
@Composable
internal fun SettingsColumn(
    padding: PaddingValues,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxSize()
            .padding(padding)
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, bottom = 32.dp),
        content = content,
    )
}

/** A rounded card that holds settings rows, separated by `RowDivider`. */
@Composable
internal fun SettingsCard(
    modifier: Modifier = Modifier,
    border: BorderStroke? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        border = border,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(content = content)
    }
}

/** A group of settings: its heading (`GroupHeader`) and a card. Without a [title] only a gap is left. */
@Composable
internal fun SettingsSection(
    title: String?,
    modifier: Modifier = Modifier,
    border: BorderStroke? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        if (title != null) {
            GroupHeader(title)
        } else {
            Spacer(Modifier.height(16.dp))
        }
        SettingsCard(border = border, content = content)
    }
}

/** What a [SettingsRow] shows at its end. */
internal enum class RowEnd { CHEVRON, EXTERNAL, NONE }

/**
 * A tappable row with an icon, a title and an optional subtitle, in the metrics of `NavRow`.
 * [RowEnd.EXTERNAL] marks rows that open a web page or another app.
 */
@Composable
internal fun SettingsRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    subtitle: String? = null,
    end: RowEnd = RowEnd.CHEVRON,
    tint: Color = Color.Unspecified,
    enabled: Boolean = true,
) {
    val titleColor = if (tint.isSpecified) tint else MaterialTheme.colorScheme.onSurface
    val iconColor = if (tint.isSpecified) tint else MaterialTheme.colorScheme.primary
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .alpha(if (enabled) 1f else DISABLED_ALPHA),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = iconColor)
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = titleColor)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        when (end) {
            RowEnd.CHEVRON -> {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            RowEnd.EXTERNAL -> {
                Icon(
                    Icons.AutoMirrored.Outlined.OpenInNew,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }

            RowEnd.NONE -> {}
        }
    }
}

/**
 * A row of information with an icon, not tappable. [endIcon] sits after the text (a tick, for
 * example), described by [endIconDescription] and tinted [endIconTint].
 */
@Composable
internal fun SettingsInfoRow(
    text: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    endIcon: ImageVector? = null,
    endIconDescription: String? = null,
    endIconTint: Color = Color.Unspecified,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(16.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f, fill = false))
        if (endIcon != null) {
            Spacer(Modifier.width(8.dp))
            Icon(
                endIcon,
                contentDescription = endIconDescription,
                tint = if (endIconTint.isSpecified) endIconTint else MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/**
 * The status of a control that saves by itself: a small spinner while the request runs, then
 * "Saved" with a tick for a moment (specs/16 section 6.25). Announced politely to TalkBack.
 */
@Composable
internal fun SaveIndicator(
    state: SaveState,
    modifier: Modifier = Modifier,
) {
    val savingLabel = stringResource(R.string.settings_saving_working)
    AnimatedContent(
        targetState = state,
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
        label = "save-state",
    ) { current ->
        when (current) {
            SaveState.SAVING -> {
                CircularProgressIndicator(
                    strokeWidth = 2.dp,
                    modifier =
                        Modifier
                            .padding(horizontal = 8.dp)
                            .size(18.dp)
                            .semantics { contentDescription = savingLabel },
                )
            }

            SaveState.SAVED -> {
                Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Filled.Check,
                        contentDescription = null,
                        tint = KrTheme.colors.success,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        stringResource(R.string.settings_saving_saved),
                        style = MaterialTheme.typography.labelMedium,
                        color = KrTheme.colors.success,
                    )
                }
            }

            SaveState.IDLE -> {
                Spacer(Modifier.size(0.dp))
            }
        }
    }
}

/** A switch with its title and helper text, its save status, and disabled while it saves. */
@Composable
internal fun SettingSwitch(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    saveState: SaveState = SaveState.IDLE,
    enabled: Boolean = true,
) {
    SwitchRow(
        title = title,
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        helper = helper,
        enabled = enabled && saveState != SaveState.SAVING,
        trailing = { SaveIndicator(saveState) },
    )
}

/** One choice of a [SettingSelectRow]. A disabled choice shows its [caption], for example "Coming soon". */
internal data class SettingOption(
    val code: String,
    val label: String,
    val enabled: Boolean = true,
    val caption: String? = null,
)

/**
 * A short closed list as a settings row: the title, the chosen value and the helper text. Tapping
 * it opens a sheet with the choices as radio rows.
 */
@Composable
internal fun SettingSelectRow(
    title: String,
    options: List<SettingOption>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    icon: ImageVector? = null,
    saveState: SaveState = SaveState.IDLE,
    enabled: Boolean = true,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val current =
        options.firstOrNull { it.code == selected }?.label
            ?: selected?.takeIf { it.isNotEmpty() }?.let { Reference.fallback(it) }
    val canOpen = enabled && saveState != SaveState.SAVING
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(enabled = canOpen, role = Role.DropdownList) { open = true }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (current != null) {
                Text(
                    current,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color =
                        if (canOpen) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                )
            }
            if (helper != null) {
                Text(
                    helper,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        if (saveState == SaveState.IDLE) {
            Icon(
                Icons.Filled.ArrowDropDown,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            SaveIndicator(saveState)
        }
    }
    if (open) {
        SettingOptionSheet(
            title = title,
            options = options,
            selected = selected,
            onPick = { code ->
                open = false
                if (code != selected) onSelect(code)
            },
            onDismiss = { open = false },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingOptionSheet(
    title: String,
    options: List<SettingOption>,
    selected: String?,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp)
                .selectableGroup(),
        ) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier =
                    Modifier
                        .padding(horizontal = 24.dp, vertical = 8.dp)
                        .semantics { heading() },
            )
            options.forEach { option ->
                val chosen = option.code == selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .selectable(
                            selected = chosen,
                            enabled = option.enabled,
                            role = Role.RadioButton,
                        ) { onPick(option.code) }
                        .padding(horizontal = 24.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = chosen, onClick = null, enabled = option.enabled)
                    Spacer(Modifier.width(16.dp))
                    Column {
                        Text(
                            option.label,
                            style = MaterialTheme.typography.bodyLarge,
                            color =
                                if (option.enabled) {
                                    MaterialTheme.colorScheme.onSurface
                                } else {
                                    MaterialTheme.colorScheme.onSurface.copy(alpha = DISABLED_ALPHA)
                                },
                        )
                        if (option.caption != null) {
                            Text(
                                option.caption,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** One card of a [SettingRadioGroup]. [extra] is shown under the card, for example a link. */
internal data class RadioOption(
    val code: String,
    val label: String,
    val helper: String? = null,
    val extra: (@Composable () -> Unit)? = null,
)

/**
 * Radio cards for choices that each need an explanation (09 section 3): the setting's title with
 * its save status, one card per choice, and an optional fixed [note] under them. While a save
 * runs the cards are disabled and show the saved value, never the pending one (rule G7).
 */
@Composable
internal fun SettingRadioGroup(
    title: String,
    options: List<RadioOption>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    saveState: SaveState = SaveState.IDLE,
    note: String? = null,
) {
    val enabled = saveState != SaveState.SAVING
    Column(
        modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics { heading() },
            )
            SaveIndicator(saveState)
        }
        Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { option ->
                val chosen = option.code == selected
                Surface(
                    shape = MaterialTheme.shapes.medium,
                    color =
                        if (chosen) {
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
                        } else {
                            MaterialTheme.colorScheme.surfaceContainerLowest
                        },
                    border =
                        BorderStroke(
                            if (chosen) 2.dp else 1.dp,
                            if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                        ),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(MaterialTheme.shapes.medium)
                            .selectable(selected = chosen, enabled = enabled, role = Role.RadioButton) {
                                if (!chosen) onSelect(option.code)
                            },
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                        RadioButton(selected = chosen, onClick = null, enabled = enabled)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(option.label, style = MaterialTheme.typography.titleSmall)
                            if (option.helper != null) {
                                Text(
                                    option.helper,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                option.extra?.invoke()
            }
        }
        if (note != null) {
            Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A short explanation inside a settings card. */
@Composable
internal fun SettingsNote(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

/** An icon in a tinted circle, for the start of status lines and option cards. */
@Composable
internal fun TintedIcon(
    icon: ImageVector,
    tint: Color,
    container: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(container),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
    }
}

/** The first load of a settings screen (rule G1): skeleton groups in the shape of the cards. */
@Composable
internal fun SettingsSkeleton(
    modifier: Modifier = Modifier,
    groups: Int = 3,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        repeat(groups) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SkeletonBox(
                    Modifier
                        .padding(start = 16.dp)
                        .width(140.dp)
                        .height(14.dp),
                )
                SettingsCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        repeat(3) {
                            SkeletonBox(
                                Modifier
                                    .fillMaxWidth()
                                    .height(44.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The look of an [ActionButton]. */
internal enum class ActionStyle { FILLED, TONAL, OUTLINED, DANGER, DANGER_OUTLINED }

/**
 * A full-width action (at least 52 dp high). While [busy] it shows a small spinner and is
 * disabled, so a request is never sent twice.
 */
@Composable
internal fun ActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: ActionStyle = ActionStyle.FILLED,
    icon: ImageVector? = null,
    busy: Boolean = false,
    enabled: Boolean = true,
) {
    val sized =
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
    val active = enabled && !busy
    val label: @Composable RowScope.() -> Unit = {
        if (busy) {
            CircularProgressIndicator(
                color = LocalContentColor.current,
                strokeWidth = 2.dp,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text)
    }
    when (style) {
        ActionStyle.FILLED -> {
            Button(onClick = onClick, modifier = sized, enabled = active, content = label)
        }

        ActionStyle.TONAL -> {
            FilledTonalButton(onClick = onClick, modifier = sized, enabled = active, content = label)
        }

        ActionStyle.OUTLINED -> {
            OutlinedButton(onClick = onClick, modifier = sized, enabled = active, content = label)
        }

        ActionStyle.DANGER -> {
            Button(
                onClick = onClick,
                modifier = sized,
                enabled = active,
                colors =
                    ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                content = label,
            )
        }

        ActionStyle.DANGER_OUTLINED -> {
            OutlinedButton(
                onClick = onClick,
                modifier = sized,
                enabled = active,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                border =
                    BorderStroke(
                        1.dp,
                        if (active) {
                            MaterialTheme.colorScheme.error.copy(alpha = 0.5f)
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        },
                    ),
                content = label,
            )
        }
    }
}

/** "Sign out of Khandani Rishta?" with "Sign out" and "Cancel" (specs/16 section 6.27, rule G8). */
@Composable
internal fun SignOutDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    ConfirmDialog(
        title = stringResource(R.string.common_sign_out_dialog_title),
        text = stringResource(R.string.common_sign_out_dialog_body),
        confirmLabel = stringResource(R.string.common_actions_sign_out),
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    )
}
