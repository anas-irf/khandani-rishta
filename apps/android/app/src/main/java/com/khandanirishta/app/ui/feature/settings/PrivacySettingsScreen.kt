package com.khandanirishta.app.ui.feature.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.DiscoveryVisibility
import com.khandanirishta.app.core.network.generated.model.FieldVisibility
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.InterestPermission
import com.khandanirishta.app.core.network.generated.model.NameDisplay
import com.khandanirishta.app.core.network.generated.model.PhotoVisibility
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.core.network.generated.model.PrivacyPatch
import com.khandanirishta.app.core.network.serialization.WireEnum
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.feature.me.ProfilePreviewDialog
import com.khandanirishta.app.ui.feature.settings.kit.RadioOption
import com.khandanirishta.app.ui.feature.settings.kit.SettingOption
import com.khandanirishta.app.ui.feature.settings.kit.SettingRadioGroup
import com.khandanirishta.app.ui.feature.settings.kit.SettingSelect
import com.khandanirishta.app.ui.feature.settings.kit.SettingSwitch
import com.khandanirishta.app.ui.feature.settings.kit.SettingsBands
import com.khandanirishta.app.ui.feature.settings.kit.SettingsGroup
import com.khandanirishta.app.ui.feature.settings.kit.SettingsScaffold
import com.khandanirishta.app.ui.feature.settings.kit.SettingsSkeleton
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.PhotoRequests
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing
import java.text.BreakIterator

/** What the groups of SET-PRIVACY can do; they get these instead of the view model. */
@Immutable
internal class PrivacyActions(
    val save: (PrivacyControl, PrivacyPatch) -> Unit,
    val preview: () -> Unit,
    val mustHaves: () -> Unit,
    val photoRequests: () -> Unit,
)

/**
 * SET-PRIVACY: every privacy choice in one place, in the four groups of specs/16 section 6.25
 * (labels and helper texts of specs/09 section 3). Each control saves by itself.
 */
@Composable
fun PrivacySettingsScreen(
    modifier: Modifier = Modifier,
    viewModel: PrivacySettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val me = LocalMe.current
    var showPreview by rememberSaveable { mutableStateOf(false) }
    val actions =
        remember(viewModel, navigator) {
            PrivacyActions(
                save = viewModel::save,
                preview = { showPreview = true },
                mustHaves = { navigator.push(MyPreferences) },
                photoRequests = { navigator.push(PhotoRequests("received")) },
            )
        }
    val firstName = me?.profile?.firstName
    val code = me?.profile?.publicCode.orEmpty()
    val examples = remember(firstName, state.lastName, code) { nameExamples(firstName, state.lastName, code) }

    SettingsScaffold(title = stringResource(R.string.settings_privacy_title), modifier = modifier) {
        val privacy = state.privacy
        when {
            privacy != null -> {
                PrivacyGroups(
                    privacy = privacy,
                    state = state,
                    examples = examples,
                    // APP-PHOTO-REQUESTS is open only under the gate `ok` (specs/16 section 3.2).
                    showPhotoRequests = me?.gate == Gate.OK,
                    actions = actions,
                )
            }

            state.error != null -> {
                StateScreen { ErrorState(error = state.error, onRetry = viewModel::load) }
            }

            else -> {
                SettingsSkeleton(groups = 4)
            }
        }
        if (showPreview) ProfilePreviewDialog(onDismiss = { showPreview = false })
    }
}

/** The preview link, then the four groups, each on a band of its own. */
@Composable
internal fun PrivacyGroups(
    privacy: Privacy,
    state: PrivacyUiState,
    examples: Map<NameDisplay, String>,
    showPhotoRequests: Boolean,
    actions: PrivacyActions,
    modifier: Modifier = Modifier,
) {
    var confirmHidden by rememberSaveable { mutableStateOf(false) }
    val onSave = actions.save
    val mustHaves: @Composable () -> Unit = {
        // To ME-PREFS, under both must-have choices (specs/16 section 6.25).
        KrTextLink(
            text = stringResource(R.string.settings_privacy_review_must_haves),
            onClick = actions.mustHaves,
            icon = Icons.Outlined.Tune,
            modifier = Modifier.padding(start = Spacing.s16),
        )
    }

    SettingsBands(modifier = modifier, endTone = BandTone.PAGE) {
        Band(padding = BandDefaults.compactPadding) {
            // "Preview how others see the profile" at the top (specs/08 section 4).
            KrTextLink(
                text = stringResource(R.string.settings_privacy_preview_link),
                onClick = actions.preview,
                icon = Icons.Outlined.Visibility,
            )
        }

        SettingsGroup(
            title = stringResource(R.string.settings_privacy_groups_find),
            tone = BandTone.SAND,
            spacing = Spacing.s24,
        ) {
            SettingRadioGroup(
                title = stringResource(R.string.settings_privacy_fields_discovery_visibility_title),
                options =
                    DISCOVERY_CHOICES.map { choice ->
                        val mustHave = choice.value == DiscoveryVisibility.PREFERENCE_MATCH
                        choice.toOption(extra = if (mustHave) mustHaves else null)
                    },
                selected = privacy.discoveryVisibility.wire,
                saveState = state.saveState(PrivacyControl.DISCOVERY_VISIBILITY),
                onSelect = { code ->
                    wireValue<DiscoveryVisibility>(code)?.let { value ->
                        // Hiding asks first (specs/16 section 6.25).
                        if (value == DiscoveryVisibility.HIDDEN) {
                            confirmHidden = true
                        } else {
                            onSave(PrivacyControl.DISCOVERY_VISIBILITY, PrivacyPatch(discoveryVisibility = value))
                        }
                    }
                },
            )
            SettingRadioGroup(
                title = stringResource(R.string.settings_privacy_fields_interest_permission_title),
                options =
                    INTEREST_CHOICES.map { choice ->
                        val mustHave = choice.value == InterestPermission.PREFERENCE_MATCH
                        choice.toOption(extra = if (mustHave) mustHaves else null)
                    },
                selected = privacy.interestPermission.wire,
                saveState = state.saveState(PrivacyControl.INTEREST_PERMISSION),
                onSelect = { code ->
                    wireValue<InterestPermission>(code)?.let { value ->
                        onSave(PrivacyControl.INTEREST_PERMISSION, PrivacyPatch(interestPermission = value))
                    }
                },
            )
        }

        SettingsGroup(
            title = stringResource(R.string.settings_privacy_groups_name_photos),
            tone = BandTone.PAGE,
            spacing = Spacing.s24,
        ) {
            SettingRadioGroup(
                title = stringResource(R.string.settings_privacy_fields_name_display_title),
                options =
                    NAME_DISPLAY_CHOICES.map { (value, label) ->
                        val example = examples[value].orEmpty()
                        RadioOption(
                            code = value.wire,
                            label = stringResource(label),
                            helper =
                                if (example.isEmpty()) {
                                    null
                                } else {
                                    text(R.string.settings_privacy_fields_name_display_example, "example" to example)
                                },
                        )
                    },
                selected = privacy.nameDisplay.wire,
                saveState = state.saveState(PrivacyControl.NAME_DISPLAY),
                note = stringResource(R.string.settings_privacy_fields_name_display_note),
                onSelect = { code ->
                    wireValue<NameDisplay>(code)?.let { value ->
                        onSave(PrivacyControl.NAME_DISPLAY, PrivacyPatch(nameDisplay = value))
                    }
                },
            )
            SettingRadioGroup(
                title = stringResource(R.string.settings_privacy_fields_photo_visibility_title),
                options = PHOTO_CHOICES.map { choice -> choice.toOption() },
                selected = privacy.photoVisibility.wire,
                saveState = state.saveState(PrivacyControl.PHOTO_VISIBILITY),
                note = stringResource(R.string.settings_privacy_fields_photo_visibility_note),
                onSelect = { code ->
                    wireValue<PhotoVisibility>(code)?.let { value ->
                        onSave(PrivacyControl.PHOTO_VISIBILITY, PrivacyPatch(photoVisibility = value))
                    }
                },
            )
            SettingSwitch(
                title = stringResource(R.string.settings_privacy_fields_allow_photo_requests_title),
                helper = stringResource(R.string.settings_privacy_fields_allow_photo_requests_help),
                checked = privacy.allowPhotoRequests,
                saveState = state.saveState(PrivacyControl.ALLOW_PHOTO_REQUESTS),
                onCheckedChange = { checked ->
                    onSave(PrivacyControl.ALLOW_PHOTO_REQUESTS, PrivacyPatch(allowPhotoRequests = checked))
                },
            )
            if (showPhotoRequests) {
                Column {
                    RowDivider()
                    NavRow(
                        title = stringResource(R.string.settings_privacy_photo_requests_link),
                        icon = Icons.Outlined.PhotoLibrary,
                        onClick = actions.photoRequests,
                    )
                }
            }
        }

        SettingsGroup(title = stringResource(R.string.settings_privacy_groups_details), tone = BandTone.SAND) {
            val visibilityOptions =
                VISIBILITY_CHOICES.map { (value, label) -> SettingOption(value.wire, stringResource(label)) }
            PRIVACY_DETAIL_ROWS.forEach { row ->
                SettingSelect(
                    title = stringResource(row.title),
                    helper = stringResource(row.help),
                    options = visibilityOptions,
                    selected = row.value(privacy).wire,
                    saveState = state.saveState(row.control),
                    onSelect = { code ->
                        wireValue<FieldVisibility>(code)?.let { value -> onSave(row.control, row.patch(value)) }
                    },
                )
            }
            CaptionText(stringResource(R.string.settings_privacy_details_note))
        }

        SettingsGroup(title = stringResource(R.string.settings_privacy_groups_activity), tone = BandTone.PAGE) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                PRIVACY_ACTIVITY_ROWS.forEach { row ->
                    SettingSwitch(
                        title = stringResource(row.title),
                        helper = stringResource(row.help),
                        checked = row.value(privacy),
                        saveState = state.saveState(row.control),
                        onCheckedChange = { checked -> onSave(row.control, row.patch(checked)) },
                    )
                }
            }
        }

        if (confirmHidden) {
            ConfirmDialog(
                title = stringResource(R.string.settings_privacy_hide_dialog_title),
                text = stringResource(R.string.settings_privacy_hide_dialog_text),
                confirmLabel = stringResource(R.string.settings_privacy_hide_dialog_confirm),
                onConfirm = {
                    confirmHidden = false
                    onSave(
                        PrivacyControl.DISCOVERY_VISIBILITY,
                        PrivacyPatch(discoveryVisibility = DiscoveryVisibility.HIDDEN),
                    )
                },
                onDismiss = { confirmHidden = false },
                // A negative choice that is not destructive, like Pause (DESIGN.md section 6.1).
                variant = KrButtonVariant.INK,
            )
        }
    }
}

/** The enumeration value with this wire code, or `null` for a code this build does not know. */
private inline fun <reified E> wireValue(code: String): E? where E : Enum<E>, E : WireEnum =
    enumValues<E>().firstOrNull { it.wire == code && it.wire.isNotEmpty() }

/** A choice of a radio group, with its label and helper text (specs/09 sections 3.1 and 3.2). */
private class PrivacyChoice<E : WireEnum>(
    val value: E,
    @param:StringRes val label: Int,
    @param:StringRes val help: Int,
)

@Composable
private fun <E : WireEnum> PrivacyChoice<E>.toOption(extra: (@Composable () -> Unit)? = null): RadioOption =
    RadioOption(code = value.wire, label = stringResource(label), helper = stringResource(help), extra = extra)

/** "Profile visibility" (09 section 3.1). */
private val DISCOVERY_CHOICES: List<PrivacyChoice<DiscoveryVisibility>> =
    listOf(
        PrivacyChoice(
            DiscoveryVisibility.EVERYONE,
            R.string.settings_privacy_fields_discovery_visibility_options_everyone_label,
            R.string.settings_privacy_fields_discovery_visibility_options_everyone_help,
        ),
        PrivacyChoice(
            DiscoveryVisibility.PREFERENCE_MATCH,
            R.string.settings_privacy_fields_discovery_visibility_options_preference_match_label,
            R.string.settings_privacy_fields_discovery_visibility_options_preference_match_help,
        ),
        PrivacyChoice(
            DiscoveryVisibility.HIDDEN,
            R.string.settings_privacy_fields_discovery_visibility_options_hidden_label,
            R.string.settings_privacy_fields_discovery_visibility_options_hidden_help,
        ),
    )

/** "Who can send me an interest" (09 section 3.1). */
private val INTEREST_CHOICES: List<PrivacyChoice<InterestPermission>> =
    listOf(
        PrivacyChoice(
            InterestPermission.EVERYONE,
            R.string.settings_privacy_fields_interest_permission_options_everyone_label,
            R.string.settings_privacy_fields_interest_permission_options_everyone_help,
        ),
        PrivacyChoice(
            InterestPermission.VERIFIED_ONLY,
            R.string.settings_privacy_fields_interest_permission_options_verified_only_label,
            R.string.settings_privacy_fields_interest_permission_options_verified_only_help,
        ),
        PrivacyChoice(
            InterestPermission.PREFERENCE_MATCH,
            R.string.settings_privacy_fields_interest_permission_options_preference_match_label,
            R.string.settings_privacy_fields_interest_permission_options_preference_match_help,
        ),
    )

/** "Who can see my photos" (09 section 3.2). */
private val PHOTO_CHOICES: List<PrivacyChoice<PhotoVisibility>> =
    listOf(
        PrivacyChoice(
            PhotoVisibility.MEMBERS,
            R.string.settings_privacy_fields_photo_visibility_options_members_label,
            R.string.settings_privacy_fields_photo_visibility_options_members_help,
        ),
        PrivacyChoice(
            PhotoVisibility.INTERESTS_AND_CONNECTIONS,
            R.string.settings_privacy_fields_photo_visibility_options_interests_and_connections_label,
            R.string.settings_privacy_fields_photo_visibility_options_interests_and_connections_help,
        ),
        PrivacyChoice(
            PhotoVisibility.CONNECTIONS,
            R.string.settings_privacy_fields_photo_visibility_options_connections_label,
            R.string.settings_privacy_fields_photo_visibility_options_connections_help,
        ),
        PrivacyChoice(
            PhotoVisibility.APPROVED_ONLY,
            R.string.settings_privacy_fields_photo_visibility_options_approved_only_label,
            R.string.settings_privacy_fields_photo_visibility_options_approved_only_help,
        ),
    )

/** The three options of every row of "Details I share" (09 section 3.3). */
private val VISIBILITY_CHOICES: List<Pair<FieldVisibility, Int>> =
    listOf(
        FieldVisibility.MEMBERS to R.string.settings_privacy_visibility_options_members,
        FieldVisibility.CONNECTIONS to R.string.settings_privacy_visibility_options_connections,
        FieldVisibility.NOBODY to R.string.settings_privacy_visibility_options_nobody,
    )

/** The choices of "Name shown to members", in the order of specs/09 section 3.2. */
private val NAME_DISPLAY_CHOICES: List<Pair<NameDisplay, Int>> =
    listOf(
        NameDisplay.FULL_NAME to R.string.settings_privacy_fields_name_display_options_full_name,
        NameDisplay.FIRST_NAME_LAST_INITIAL to
            R.string.settings_privacy_fields_name_display_options_first_name_last_initial,
        NameDisplay.FIRST_NAME_ONLY to R.string.settings_privacy_fields_name_display_options_first_name_only,
        NameDisplay.INITIALS to R.string.settings_privacy_fields_name_display_options_initials,
        NameDisplay.CODE_ONLY to R.string.settings_privacy_fields_name_display_options_code_only,
    )

/** One row of "Details I share": a three-way select (specs/09 section 3.3). */
private class PrivacyDetailRow(
    val control: PrivacyControl,
    @param:StringRes val title: Int,
    @param:StringRes val help: Int,
    val value: (Privacy) -> FieldVisibility,
    val patch: (FieldVisibility) -> PrivacyPatch,
)

private val PRIVACY_DETAIL_ROWS: List<PrivacyDetailRow> =
    listOf(
        PrivacyDetailRow(
            PrivacyControl.CASTE_VISIBILITY,
            R.string.settings_privacy_fields_caste_visibility_title,
            R.string.settings_privacy_fields_caste_visibility_help,
            { it.casteVisibility },
            { PrivacyPatch(casteVisibility = it) },
        ),
        PrivacyDetailRow(
            PrivacyControl.INCOME_VISIBILITY,
            R.string.settings_privacy_fields_income_visibility_title,
            R.string.settings_privacy_fields_income_visibility_help,
            { it.incomeVisibility },
            { PrivacyPatch(incomeVisibility = it) },
        ),
        PrivacyDetailRow(
            PrivacyControl.FAMILY_VISIBILITY,
            R.string.settings_privacy_fields_family_visibility_title,
            R.string.settings_privacy_fields_family_visibility_help,
            { it.familyVisibility },
            { PrivacyPatch(familyVisibility = it) },
        ),
        PrivacyDetailRow(
            PrivacyControl.CAREER_DETAILS_VISIBILITY,
            R.string.settings_privacy_fields_career_details_visibility_title,
            R.string.settings_privacy_fields_career_details_visibility_help,
            { it.careerDetailsVisibility },
            { PrivacyPatch(careerDetailsVisibility = it) },
        ),
        PrivacyDetailRow(
            PrivacyControl.HOME_VISIBILITY,
            R.string.settings_privacy_fields_home_visibility_title,
            R.string.settings_privacy_fields_home_visibility_help,
            { it.homeVisibility },
            { PrivacyPatch(homeVisibility = it) },
        ),
        PrivacyDetailRow(
            PrivacyControl.AREA_VISIBILITY,
            R.string.settings_privacy_fields_area_visibility_title,
            R.string.settings_privacy_fields_area_visibility_help,
            { it.areaVisibility },
            { PrivacyPatch(areaVisibility = it) },
        ),
        PrivacyDetailRow(
            PrivacyControl.HEALTH_VISIBILITY,
            R.string.settings_privacy_fields_health_visibility_title,
            R.string.settings_privacy_fields_health_visibility_help,
            { it.healthVisibility },
            { PrivacyPatch(healthVisibility = it) },
        ),
    )

/** One switch of "Activity"; each helper states the two-way rule (specs/09 sections 3.4, 8 and 9). */
private class PrivacyActivityRow(
    val control: PrivacyControl,
    @param:StringRes val title: Int,
    @param:StringRes val help: Int,
    val value: (Privacy) -> Boolean,
    val patch: (Boolean) -> PrivacyPatch,
)

private val PRIVACY_ACTIVITY_ROWS: List<PrivacyActivityRow> =
    listOf(
        PrivacyActivityRow(
            PrivacyControl.SHOW_LAST_ACTIVE,
            R.string.settings_privacy_fields_show_last_active_title,
            R.string.settings_privacy_fields_show_last_active_help,
            { it.showLastActive },
            { PrivacyPatch(showLastActive = it) },
        ),
        PrivacyActivityRow(
            PrivacyControl.SHOW_ONLINE_STATUS,
            R.string.settings_privacy_fields_show_online_status_title,
            R.string.settings_privacy_fields_show_online_status_help,
            { it.showOnlineStatus },
            { PrivacyPatch(showOnlineStatus = it) },
        ),
        PrivacyActivityRow(
            PrivacyControl.RECORD_MY_VISITS,
            R.string.settings_privacy_fields_record_my_visits_title,
            R.string.settings_privacy_fields_record_my_visits_help,
            { it.recordMyVisits },
            { PrivacyPatch(recordMyVisits = it) },
        ),
        PrivacyActivityRow(
            PrivacyControl.SEND_READ_RECEIPTS,
            R.string.settings_privacy_fields_send_read_receipts_title,
            R.string.settings_privacy_fields_send_read_receipts_help,
            { it.sendReadReceipts },
            { PrivacyPatch(sendReadReceipts = it) },
        ),
    )

/**
 * The examples under "Name shown to members" (specs/16 section 6.25, 09 section 4.1): each choice
 * rendered with the member's own name and profile code, as a member who is not a connection sees it.
 */
internal fun nameExamples(
    firstName: String?,
    lastName: String?,
    publicCode: String,
): Map<NameDisplay, String> {
    val first = firstName?.trim().orEmpty()
    val last = lastName?.trim().orEmpty()
    val firstInitial = firstLetter(first)
    val lastInitial = firstLetter(last)
    return mapOf(
        NameDisplay.FULL_NAME to listOf(first, last).filter { it.isNotEmpty() }.joinToString(" "),
        NameDisplay.FIRST_NAME_LAST_INITIAL to if (lastInitial.isEmpty()) first else "$first $lastInitial.",
        NameDisplay.FIRST_NAME_ONLY to first,
        NameDisplay.INITIALS to
            when {
                lastInitial.isNotEmpty() -> "$firstInitial. $lastInitial."
                firstInitial.isNotEmpty() -> "$firstInitial."
                else -> ""
            },
        NameDisplay.CODE_ONLY to publicCode,
    )
}

/** The first character (grapheme) of the first word, upper-cased where the script has case (09 section 4.3). */
private fun firstLetter(value: String): String {
    val word = value
        .trim()
        .split(WHITESPACE)
        .firstOrNull()
        .orEmpty()
    if (word.isEmpty()) return ""
    val boundaries = BreakIterator.getCharacterInstance()
    boundaries.setText(word)
    val end = boundaries.next()
    val letter = if (end == BreakIterator.DONE) word else word.substring(0, end)
    return letter.uppercase()
}

private val WHITESPACE = Regex("\\s+")
