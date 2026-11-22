package com.khandanirishta.app.ui.feature.settings.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.ButtonSpinner
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.FirstLineMark
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.PickerBox
import com.khandanirishta.app.ui.components.RadioCardRow
import com.khandanirishta.app.ui.components.RadioRow
import com.khandanirishta.app.ui.components.SectionHeading
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.SwitchRow
import com.khandanirishta.app.ui.components.bandToneAt
import com.khandanirishta.app.ui.components.exceptBottom
import com.khandanirishta.app.ui.components.lineHeightOf
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.RowShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/*
 * What the settings and gate screens share on top of the app's components (specs/16 sections 6.2
 * and 6.24 to 6.30): groups as tonal bands, and controls that save by themselves with a status.
 */

/** How a control that saves by itself is doing: a spinner while saving, then a brief "Saved". */
enum class SaveState { IDLE, SAVING, SAVED }

/** How long the "Saved" mark stays next to a control (specs/16 section 6.25). */
internal const val SAVED_MARK_MILLIS = 2_500L

/** A settings screen: Back and the title, and the content under them inside the insets. */
@Composable
internal fun SettingsScaffold(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val navigator = LocalNavigator.current
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { DetailTopBar(title = title, onBack = { navigator.back() }) },
    ) { padding ->
        val aboveAndBeside = padding.exceptBottom()
        Box(
            Modifier
                .fillMaxSize()
                .padding(aboveAndBeside)
                .consumeWindowInsets(aboveAndBeside),
        ) { content() }
    }
}

/** The scrolling bands of a settings screen. [endTone] is the last band's, which runs on to the bottom. */
@Composable
internal fun SettingsBands(
    modifier: Modifier = Modifier,
    endTone: BandTone = BandTone.PAGE,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .background(if (endTone == BandTone.SAND) colors.surfaceContainer else colors.background)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding(),
        content = content,
    )
}

/** A group of settings: a band of its own with its diamond heading (DESIGN.md section 6.10). */
@Composable
internal fun SettingsGroup(
    title: String,
    tone: BandTone,
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.s16,
    content: @Composable ColumnScope.() -> Unit,
) {
    Band(modifier = modifier, tone = tone, spacing = spacing) {
        SectionHeading(title)
        content()
    }
}

/**
 * The status of a control that saves by itself (specs/16 section 6.25): a spinner and "Saving",
 * then "Saved" for a moment. Its line keeps its room, so what is under it never moves.
 */
@Composable
internal fun SaveIndicator(
    state: SaveState,
    modifier: Modifier = Modifier,
) {
    val style = KrType.caption
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val line = LocalDensity.current.lineHeightOf(style)
    val announced = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
    Box(modifier.heightIn(min = line), contentAlignment = Alignment.CenterStart) {
        when (state) {
            SaveState.SAVING -> {
                Row(
                    modifier = announced,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ButtonSpinner(Modifier.size(Sizes.iconTiny), color = muted)
                    Text(stringResource(R.string.settings_saving_working), style = style, color = muted)
                }
            }

            SaveState.SAVED -> {
                IconText(
                    icon = Icons.Outlined.Check,
                    text = stringResource(R.string.settings_saving_saved),
                    style = style,
                    color = muted,
                    tint = KrTheme.colors.success,
                    iconSize = Sizes.iconTiny,
                    modifier = announced,
                )
            }

            SaveState.IDLE -> {}
        }
    }
}

/**
 * The switch row of DESIGN.md section 6.11. A switch that saves on its own passes [saveState]
 * and gets the status line under it.
 */
@Composable
internal fun SettingSwitch(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    saveState: SaveState? = null,
    enabled: Boolean = true,
) {
    Column(modifier.fillMaxWidth()) {
        SwitchRow(
            title = title,
            checked = checked,
            onCheckedChange = onCheckedChange,
            helper = helper,
            enabled = enabled && LocalOnline.current && saveState != SaveState.SAVING,
        )
        if (saveState != null) SaveIndicator(saveState, Modifier.padding(start = Spacing.gutter, top = Spacing.s4))
    }
}

/** One choice of a [SettingSelect]. A disabled choice shows its [caption], for example "Coming soon". */
@Immutable
internal data class SettingOption(
    val code: String,
    val label: String,
    val enabled: Boolean = true,
    val caption: String? = null,
)

/**
 * A short closed list as a field: the title, the helper, and the chosen value, which opens a
 * sheet with the choices.
 */
@Composable
internal fun SettingSelect(
    title: String,
    options: List<SettingOption>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    saveState: SaveState? = null,
    enabled: Boolean = true,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val online = LocalOnline.current
    val current =
        options.firstOrNull { it.code == selected }?.label
            ?: selected?.takeIf { it.isNotEmpty() }?.let { Reference.fallback(it) }
    Column(modifier.fillMaxWidth()) {
        FieldLabel(title)
        if (helper != null) CaptionText(helper, Modifier.padding(bottom = Spacing.s8))
        PickerBox(
            text = current,
            placeholder = stringResource(R.string.fields_select_placeholder),
            onClick = { open = true },
            enabled = enabled && online && saveState != SaveState.SAVING,
            contentDescription = listOfNotNull(title, current).joinToString(", "),
        )
        if (saveState != null) SaveIndicator(saveState, Modifier.padding(top = Spacing.s4))
        if (open) {
            KrSheet(title = title, onDismissRequest = { open = false }) {
                Column(Modifier.selectableGroup()) {
                    options.forEach { option ->
                        RadioRow(
                            label = option.label,
                            helper = option.caption,
                            selected = option.code == selected,
                            enabled = option.enabled && online,
                            onClick = {
                                open = false
                                if (option.code != selected) onSelect(option.code)
                            },
                        )
                    }
                }
            }
        }
    }
}

/** One card of a [SettingRadioGroup]. [extra] is shown under the card, for example a link. */
@Immutable
internal data class RadioOption(
    val code: String,
    val label: String,
    val helper: String? = null,
    val extra: (@Composable () -> Unit)? = null,
)

/**
 * Radio cards for choices that each need an explanation (09 section 3): the setting's title, one
 * card per choice, the save status and an optional fixed [note]. While a save runs the cards are
 * disabled and show the saved value, never the pending one (rule G7).
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
    val enabled = LocalOnline.current && saveState != SaveState.SAVING
    Column(modifier.fillMaxWidth()) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            modifier =
                Modifier
                    .padding(bottom = Spacing.s12)
                    .semantics { heading() },
        )
        Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            options.forEach { option ->
                val chosen = option.code == selected
                RadioCardRow(
                    title = option.label,
                    helper = option.helper,
                    selected = chosen,
                    enabled = enabled,
                    onClick = { if (!chosen) onSelect(option.code) },
                )
                option.extra?.invoke()
            }
        }
        SaveIndicator(saveState, Modifier.padding(top = Spacing.s4))
        if (note != null) CaptionText(note, Modifier.padding(top = Spacing.s4))
    }
}

/** A point of a list, behind a small diamond that stays on the first line. */
@Composable
internal fun BulletLine(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        FirstLineMark(style) { Diamond(size = BulletSize) }
        Text(text, style = style, modifier = Modifier.weight(1f))
    }
}

/** The first load of a settings screen (rule G1): bands in the shape of its groups. */
@Composable
internal fun SettingsSkeleton(
    modifier: Modifier = Modifier,
    groups: Int = 3,
) {
    LoadingRegion(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        spacing = 0.dp,
    ) {
        repeat(groups) { index ->
            Band(tone = bandToneAt(index), spacing = Spacing.s16) {
                SkeletonBox(Modifier.fillMaxWidth(TITLE_SHARE).height(Spacing.s32))
                repeat(SKELETON_ROWS) {
                    SkeletonBox(Modifier.fillMaxWidth().height(Sizes.switchRow), shape = RowShape)
                }
            }
        }
    }
}

/**
 * "Sign out of Khandani Rishta?" (specs/16 section 6.27, rule G8). Signing out is done on the
 * phone, so it works offline.
 */
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
        variant = KrButtonVariant.INK,
        needsNetwork = false,
    )
}

private val BulletSize = 6.dp
private const val TITLE_SHARE = 0.5f
private const val SKELETON_ROWS = 2
