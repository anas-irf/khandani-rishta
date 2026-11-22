package com.khandanirishta.app.ui.feature.settings

import android.text.format.DateFormat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TimeInput
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDialogDefaults
import androidx.compose.material3.TimePickerDisplayMode
import androidx.compose.material3.TimePickerLayoutType
import androidx.compose.material3.isInputValid
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.EmailMatchDigest
import com.khandanirishta.app.core.network.generated.model.NotificationPreferences
import com.khandanirishta.app.core.push.notificationsAllowed
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.PickerBox
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusPill
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.feature.settings.kit.SaveState
import com.khandanirishta.app.ui.feature.settings.kit.SettingOption
import com.khandanirishta.app.ui.feature.settings.kit.SettingSelect
import com.khandanirishta.app.ui.feature.settings.kit.SettingSwitch
import com.khandanirishta.app.ui.feature.settings.kit.SettingsBands
import com.khandanirishta.app.ui.feature.settings.kit.SettingsGroup
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.SettingsSkeleton
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.TABULAR_FIGURES
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * SET-NOTIFS: which push notifications and emails to receive (specs/16 section 6.26, labels of
 * specs/14 section 6.1, quiet hours of 14 section 6.2). Changes show at once and are sent after a
 * short pause; one status for the whole screen floats at its foot, so nothing moves.
 */
@Composable
fun NotificationSettingsScreen(
    modifier: Modifier = Modifier,
    viewModel: NotificationSettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val links = rememberLinkOpener()
    // The phone's own switch for this app (specs/22 section 8), checked again whenever the screen returns.
    var allowed by remember { mutableStateOf(notificationsAllowed(context)) }
    LifecycleResumeEffect(context) {
        allowed = notificationsAllowed(context)
        onPauseOrDispose { }
    }
    SettingsScaffold(title = stringResource(R.string.settings_notifications_title), modifier = modifier) {
        val preferences = state.preferences
        when {
            preferences != null -> {
                Box(Modifier.fillMaxSize()) {
                    NotificationGroups(
                        preferences = preferences,
                        allowed = allowed,
                        onChange = viewModel::change,
                        onOpenPhoneSettings = { links.notificationSettings() },
                    )
                    SaveStatus(
                        state = state.saveState,
                        modifier =
                            Modifier
                                .align(Alignment.BottomCenter)
                                .navigationBarsPadding()
                                .padding(Spacing.s16),
                    )
                }
            }

            state.error != null -> {
                StateScreen { ErrorState(error = state.error, onRetry = viewModel::load) }
            }

            else -> {
                SettingsSkeleton(groups = 3)
            }
        }
    }
}

/** "Saving", then "Saved", in a pill at the foot of the screen. */
@Composable
private fun SaveStatus(
    state: SaveState,
    modifier: Modifier = Modifier,
) {
    if (state == SaveState.IDLE) return
    val saving = state == SaveState.SAVING
    StatusPill(
        text = stringResource(if (saving) R.string.settings_saving_working else R.string.settings_saving_saved),
        tone = if (saving) StatusTone.INFO else StatusTone.SUCCESS,
        icon = Icons.Outlined.Check,
        spinning = saving,
        modifier = modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    )
}

/** The intro, then push, email and quiet hours, each on a band of its own. */
@Composable
internal fun NotificationGroups(
    preferences: NotificationPreferences,
    allowed: Boolean,
    onChange: ((NotificationPreferences) -> NotificationPreferences) -> Unit,
    onOpenPhoneSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val digestOptions =
        remember(reference) {
            reference
                .optionsOf(Lists.EMAIL_MATCH_DIGEST, EmailMatchDigest.entries)
                .ifEmpty { DIGEST_FALLBACK.map { it to Reference.fallback(it.wire) } }
                .map { (value, label) -> SettingOption(value.wire, label) }
        }

    SettingsBands(modifier = modifier, endTone = BandTone.SAND) {
        Band(padding = BandDefaults.compactPadding, spacing = Spacing.s16) {
            Text(
                text = stringResource(R.string.settings_notifications_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = KrTheme.colors.textSecondary,
            )
            if (!allowed) {
                StatusBanner(
                    text = stringResource(R.string.notifications_off_banner),
                    tone = StatusTone.WARNING,
                    icon = Icons.Outlined.NotificationsOff,
                    actionLabel = stringResource(R.string.notifications_open_settings),
                    onAction = onOpenPhoneSettings,
                )
            }
        }

        SettingsGroup(
            title = stringResource(R.string.settings_notifications_push_title),
            tone = BandTone.SAND,
            spacing = Spacing.s12,
        ) {
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_interests),
                checked = preferences.pushInterests,
                onCheckedChange = { checked -> onChange { it.copy(pushInterests = checked) } },
            )
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_messages),
                checked = preferences.pushMessages,
                onCheckedChange = { checked -> onChange { it.copy(pushMessages = checked) } },
            )
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_photo_requests),
                checked = preferences.pushPhotoRequests,
                onCheckedChange = { checked -> onChange { it.copy(pushPhotoRequests = checked) } },
            )
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_matches),
                checked = preferences.pushMatches,
                onCheckedChange = { checked -> onChange { it.copy(pushMatches = checked) } },
            )
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_profile_views),
                checked = preferences.pushProfileViews,
                onCheckedChange = { checked -> onChange { it.copy(pushProfileViews = checked) } },
            )
        }

        SettingsGroup(
            title = stringResource(R.string.settings_notifications_email_title),
            tone = BandTone.PAGE,
            spacing = Spacing.s12,
        ) {
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_email_interests),
                checked = preferences.emailInterests,
                onCheckedChange = { checked -> onChange { it.copy(emailInterests = checked) } },
            )
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_email_messages),
                checked = preferences.emailMessages,
                onCheckedChange = { checked -> onChange { it.copy(emailMessages = checked) } },
            )
            SettingSelect(
                title = stringResource(R.string.settings_notifications_email_match_digest),
                options = digestOptions,
                selected = preferences.emailMatchDigest.wire,
                modifier = Modifier.padding(vertical = Spacing.s8),
                onSelect = { code ->
                    EmailMatchDigest.entries
                        .firstOrNull { it.wire == code && it != EmailMatchDigest.UNKNOWN }
                        ?.let { digest -> onChange { it.copy(emailMatchDigest = digest) } }
                },
            )
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_email_announcements),
                checked = preferences.emailAnnouncements,
                onCheckedChange = { checked -> onChange { it.copy(emailAnnouncements = checked) } },
            )
            CaptionText(stringResource(R.string.settings_notifications_email_note))
        }

        QuietHours(preferences = preferences, onChange = onChange)
        // Room under the last line for the save status.
        Spacer(Modifier.height(Spacing.s64))
    }
}

@Composable
private fun QuietHours(
    preferences: NotificationPreferences,
    onChange: ((NotificationPreferences) -> NotificationPreferences) -> Unit,
    modifier: Modifier = Modifier,
) {
    val start = parseTime(preferences.quietHoursStart)
    val end = parseTime(preferences.quietHoursEnd)
    // Both times are set, or both are empty (specs/14 section 6.2).
    val quietOn = start != null && end != null
    SettingsGroup(
        title = stringResource(R.string.settings_notifications_quiet_title),
        tone = BandTone.SAND,
        modifier = modifier,
        spacing = Spacing.s12,
    ) {
        SettingSwitch(
            title = stringResource(R.string.settings_notifications_quiet_switch),
            checked = quietOn,
            onCheckedChange = { on ->
                onChange {
                    if (on) {
                        it.copy(quietHoursStart = QUIET_DEFAULT_START, quietHoursEnd = QUIET_DEFAULT_END)
                    } else {
                        it.copy(quietHoursStart = null, quietHoursEnd = null)
                    }
                }
            },
        )
        AnimatedVisibility(
            visible = quietOn,
            enter = fadeIn(Motion.base()) + expandVertically(Motion.base()),
            exit = fadeOut(Motion.fast()) + shrinkVertically(Motion.base()),
        ) {
            // Side by side while both fit; one under the other at large text.
            AdaptiveRow(
                modifier = Modifier.padding(vertical = Spacing.s8),
                lineSpacing = Spacing.s16,
                verticalAlignment = Alignment.Top,
            ) {
                QuietTimeField(
                    label = stringResource(R.string.settings_notifications_quiet_from),
                    time = start,
                    onChange = { value -> onChange { it.copy(quietHoursStart = value) } },
                    modifier = Modifier.grow(basis = TimeFieldBasis),
                )
                QuietTimeField(
                    label = stringResource(R.string.settings_notifications_quiet_to),
                    time = end,
                    onChange = { value -> onChange { it.copy(quietHoursEnd = value) } },
                    modifier = Modifier.grow(basis = TimeFieldBasis),
                )
            }
        }
        CaptionText(stringResource(R.string.settings_notifications_quiet_help))
    }
}

/** One of the two quiet hours times: the time in the phone's 12 or 24 hour style, and a time picker. */
@Composable
private fun QuietTimeField(
    label: String,
    time: Pair<Int, Int>?,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    var open by rememberSaveable { mutableStateOf(false) }
    val shown = remember(time, is24Hour) { time?.let { (hour, minute) -> displayTime(hour, minute, is24Hour) } }
    Column(modifier) {
        FieldLabel(label)
        PickerBox(
            text = shown,
            placeholder = stringResource(R.string.fields_select_placeholder),
            onClick = { open = true },
            enabled = LocalOnline.current,
            contentDescription = listOfNotNull(label, shown).joinToString(", "),
        )
        if (open) {
            QuietTimeSheet(
                title = label,
                initial = time ?: (DEFAULT_HOUR to 0),
                onConfirm = { hour, minute ->
                    open = false
                    onChange(wireTime(hour, minute))
                },
                onDismiss = { open = false },
            )
        }
    }
}

/**
 * Material's time picker, coloured by the scheme, in a sheet that scrolls: its own dialog neither
 * scrolls nor wraps its buttons. The dial where there is room for it; on a short window or at
 * large text the typed time comes first, and the toggle switches between the two.
 */
@Composable
private fun QuietTimeSheet(
    title: String,
    initial: Pair<Int, Int>,
    onConfirm: (Int, Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val pickerState = rememberTimePickerState(initialHour = initial.first, initialMinute = initial.second)
    val window = LocalWindowInfo.current.containerDpSize
    val roomy = window.height >= DialWindowHeight && LocalDensity.current.fontScale <= DIAL_MAX_SCALE
    var typing by rememberSaveable { mutableStateOf(!roomy) }
    KrSheet(
        title = title,
        onDismissRequest = onDismiss,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.common_actions_done),
                onConfirm = { onConfirm(pickerState.hour, pickerState.minute) },
                onCancel = onDismiss,
                enabled = !typing || pickerState.isInputValid,
            )
        },
    ) {
        TimePickerType {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                if (typing) {
                    TimeInput(state = pickerState)
                } else {
                    TimePicker(state = pickerState, layoutType = TimePickerLayoutType.Vertical)
                }
                TimePickerDialogDefaults.DisplayModeToggle(
                    onDisplayModeChange = { typing = !typing },
                    displayMode = if (typing) TimePickerDisplayMode.Input else TimePickerDisplayMode.Picker,
                )
            }
        }
    }
}

/**
 * The picker writes a time in the display sizes, which are serif here, and AM and PM in title
 * medium. Times are read, so both are Source Sans, with lines no taller than the letters: their
 * boxes are 72 and 36 tall whatever the text size.
 */
@Composable
private fun TimePickerType(content: @Composable () -> Unit) {
    val theme = MaterialTheme.typography
    val picker =
        remember(theme) {
            val figures =
                theme.headlineLarge.copy(
                    lineHeight = theme.headlineLarge.fontSize,
                    fontFeatureSettings = TABULAR_FIGURES,
                )
            val period = theme.labelSmall.copy(lineHeight = theme.labelSmall.fontSize)
            theme.copy(displayLarge = figures, displayMedium = figures, titleMedium = period)
        }
    // Colours and shapes are named too: with the type alone Material's two overloads tie.
    MaterialTheme(
        colorScheme = MaterialTheme.colorScheme,
        shapes = MaterialTheme.shapes,
        typography = picker,
        content = content,
    )
}

/** Values offered when quiet hours are first turned on (specs/16 section 6.26). */
private const val QUIET_DEFAULT_START = "22:00"
private const val QUIET_DEFAULT_END = "07:00"
private const val DEFAULT_HOUR = 22

/** The dial needs about this much window, with the title and the answers. */
private val DialWindowHeight = 640.dp
private const val DIAL_MAX_SCALE = 1.3f
private val TimeFieldBasis = 120.dp

/** Labels for the digest choices when the reference data has none. */
private val DIGEST_FALLBACK = listOf(EmailMatchDigest.OFF, EmailMatchDigest.DAILY, EmailMatchDigest.WEEKLY)

private val TIME_VALUE = Regex("^(\\d{2}):(\\d{2})")

/** "22:00" or "22:00:00" as hour and minute; anything else as `null`. */
private fun parseTime(value: String?): Pair<Int, Int>? {
    val match = value?.let { TIME_VALUE.find(it) } ?: return null
    val hour = match.groupValues[1].toInt()
    val minute = match.groupValues[2].toInt()
    return if (hour in 0..23 && minute in 0..59) hour to minute else null
}

/** The API's form of a time: "07:00". */
private fun wireTime(
    hour: Int,
    minute: Int,
): String = String.format(Locale.ROOT, "%02d:%02d", hour, minute)

private val TIME_24: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH)
private val TIME_12: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

/** A time as the phone shows times: "22:00" or "10:00 PM", with Western digits. */
private fun displayTime(
    hour: Int,
    minute: Int,
    is24Hour: Boolean,
): String = (if (is24Hour) TIME_24 else TIME_12).format(LocalTime.of(hour, minute))
