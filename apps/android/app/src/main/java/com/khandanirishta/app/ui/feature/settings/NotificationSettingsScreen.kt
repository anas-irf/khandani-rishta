package com.khandanirishta.app.ui.feature.settings

import android.text.format.DateFormat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDialog
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
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
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.PickerBox
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.feature.settings.kit.SaveIndicator
import com.khandanirishta.app.ui.feature.settings.kit.SettingOption
import com.khandanirishta.app.ui.feature.settings.kit.SettingSelectRow
import com.khandanirishta.app.ui.feature.settings.kit.SettingSwitch
import com.khandanirishta.app.ui.feature.settings.kit.SettingsColumn
import com.khandanirishta.app.ui.feature.settings.kit.SettingsNote
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.SettingsSection
import com.khandanirishta.app.ui.feature.settings.kit.SettingsSkeleton
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.theme.KrTheme
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * SET-NOTIFS: which push notifications and emails to receive (specs/16 section 6.26, labels of
 * specs/14 section 6.1, quiet hours of 14 section 6.2). Changes show at once and are sent after a
 * short pause; the save status is shown in the top bar.
 */
@Composable
fun NotificationSettingsScreen(
    modifier: Modifier = Modifier,
    viewModel: NotificationSettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SettingsScaffold(
        title = stringResource(R.string.settings_notifications_title),
        modifier = modifier,
        actions = { SaveIndicator(state.saveState) },
    ) { padding ->
        val preferences = state.preferences
        when {
            preferences != null -> {
                NotificationGroups(preferences = preferences, padding = padding, onChange = viewModel::change)
            }

            state.error != null -> {
                Box(Modifier.padding(padding)) {
                    ErrorState(error = state.error, onRetry = viewModel::load)
                }
            }

            else -> {
                SettingsSkeleton(Modifier.padding(padding), groups = 3)
            }
        }
    }
}

@Composable
private fun NotificationGroups(
    preferences: NotificationPreferences,
    padding: PaddingValues,
    onChange: ((NotificationPreferences) -> NotificationPreferences) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val links = rememberLinkOpener()
    val reference = LocalReference.current
    // The phone's own switch for this app (specs/22 section 8), checked again whenever the screen returns.
    var allowed by remember { mutableStateOf(notificationsAllowed(context)) }
    LifecycleResumeEffect(context) {
        allowed = notificationsAllowed(context)
        onPauseOrDispose { }
    }
    val digestOptions =
        remember(reference) {
            reference
                .optionsOf(Lists.EMAIL_MATCH_DIGEST, EmailMatchDigest.entries)
                .ifEmpty { DIGEST_FALLBACK.map { it to Reference.fallback(it.wire) } }
                .map { (value, label) -> SettingOption(value.wire, label) }
        }
    val start = parseTime(preferences.quietHoursStart)
    val end = parseTime(preferences.quietHoursEnd)
    // Both times are set, or both are empty (specs/14 section 6.2).
    val quietOn = start != null && end != null

    SettingsColumn(padding, modifier) {
        Text(
            stringResource(R.string.settings_notifications_intro),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 8.dp),
        )
        if (!allowed) {
            Spacer(Modifier.height(16.dp))
            StatusBanner(
                text = stringResource(R.string.notifications_off_banner),
                icon = Icons.Outlined.NotificationsOff,
                container = KrTheme.colors.warningContainer,
                content = MaterialTheme.colorScheme.onSurface,
                actionLabel = stringResource(R.string.notifications_open_settings),
                onAction = { links.notificationSettings() },
            )
        }

        SettingsSection(title = stringResource(R.string.settings_notifications_push_title)) {
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_interests),
                checked = preferences.pushInterests,
                onCheckedChange = { checked -> onChange { it.copy(pushInterests = checked) } },
            )
            RowDivider()
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_messages),
                checked = preferences.pushMessages,
                onCheckedChange = { checked -> onChange { it.copy(pushMessages = checked) } },
            )
            RowDivider()
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_photo_requests),
                checked = preferences.pushPhotoRequests,
                onCheckedChange = { checked -> onChange { it.copy(pushPhotoRequests = checked) } },
            )
            RowDivider()
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_matches),
                checked = preferences.pushMatches,
                onCheckedChange = { checked -> onChange { it.copy(pushMatches = checked) } },
            )
            RowDivider()
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_push_profile_views),
                checked = preferences.pushProfileViews,
                onCheckedChange = { checked -> onChange { it.copy(pushProfileViews = checked) } },
            )
        }

        SettingsSection(title = stringResource(R.string.settings_notifications_email_title)) {
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_email_interests),
                checked = preferences.emailInterests,
                onCheckedChange = { checked -> onChange { it.copy(emailInterests = checked) } },
            )
            RowDivider()
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_email_messages),
                checked = preferences.emailMessages,
                onCheckedChange = { checked -> onChange { it.copy(emailMessages = checked) } },
            )
            RowDivider()
            SettingSelectRow(
                title = stringResource(R.string.settings_notifications_email_match_digest),
                options = digestOptions,
                selected = preferences.emailMatchDigest.wire,
                onSelect = { code ->
                    EmailMatchDigest.entries
                        .firstOrNull { it.wire == code && it != EmailMatchDigest.UNKNOWN }
                        ?.let { digest -> onChange { it.copy(emailMatchDigest = digest) } }
                },
            )
            RowDivider()
            SettingSwitch(
                title = stringResource(R.string.settings_notifications_email_announcements),
                checked = preferences.emailAnnouncements,
                onCheckedChange = { checked -> onChange { it.copy(emailAnnouncements = checked) } },
            )
            SettingsNote(stringResource(R.string.settings_notifications_email_note))
        }

        SettingsSection(title = stringResource(R.string.settings_notifications_quiet_title)) {
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
            AnimatedVisibility(visible = quietOn) {
                Row(
                    Modifier.padding(start = 16.dp, end = 16.dp, bottom = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    QuietTimeField(
                        label = stringResource(R.string.settings_notifications_quiet_from),
                        time = start,
                        onChange = { value -> onChange { it.copy(quietHoursStart = value) } },
                        modifier = Modifier.weight(1f),
                    )
                    QuietTimeField(
                        label = stringResource(R.string.settings_notifications_quiet_to),
                        time = end,
                        onChange = { value -> onChange { it.copy(quietHoursEnd = value) } },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            SettingsNote(stringResource(R.string.settings_notifications_quiet_help))
        }
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
    val context = LocalContext.current
    var open by rememberSaveable { mutableStateOf(false) }
    val shown = time?.let { (hour, minute) -> displayTime(hour, minute, DateFormat.is24HourFormat(context)) }
    Column(modifier) {
        FieldLabel(label)
        PickerBox(
            text = shown,
            placeholder = "",
            onClick = { open = true },
            contentDescription = listOfNotNull(label, shown).joinToString(", "),
        )
    }
    if (open) {
        QuietTimeDialog(
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

/** The Material time picker in a dialog; the value goes back as "HH:MM". */
@Composable
private fun QuietTimeDialog(
    title: String,
    initial: Pair<Int, Int>,
    onConfirm: (Int, Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val pickerState = rememberTimePickerState(initialHour = initial.first, initialMinute = initial.second)
    TimePickerDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = MaterialTheme.typography.labelLarge) },
        confirmButton = {
            TextButton(onClick = { onConfirm(pickerState.hour, pickerState.minute) }) {
                Text(stringResource(R.string.common_actions_done))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    ) {
        TimePicker(state = pickerState)
    }
}

/** Values offered when quiet hours are first turned on (specs/16 section 6.26). */
private const val QUIET_DEFAULT_START = "22:00"
private const val QUIET_DEFAULT_END = "07:00"
private const val DEFAULT_HOUR = 22

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
