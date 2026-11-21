package com.khandanirishta.app.ui.feature.me

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.feature.preferences.PreferencesFields
import com.khandanirishta.app.ui.feature.preferences.PreferencesFormController
import com.khandanirishta.app.ui.feature.profilesections.AfterSave
import com.khandanirishta.app.ui.feature.profilesections.FormMode
import com.khandanirishta.app.ui.feature.profilesections.FormScreenScaffold
import com.khandanirishta.app.ui.feature.profilesections.RevealEffect
import com.khandanirishta.app.ui.feature.profilesections.SaveBar
import com.khandanirishta.app.ui.feature.profilesections.rememberFieldLocator
import com.khandanirishta.app.ui.feature.profilesections.rememberOnline
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.text.plural
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/** ME-PREFS: the partner preferences (16 section 6.20, 07 section 11). */
@HiltViewModel
class MyPreferencesViewModel
    @Inject
    constructor(
        profiles: ProfileRepository,
        references: ReferenceRepository,
        me: MeRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        val form =
            PreferencesFormController(
                scope = viewModelScope,
                mode = FormMode.EDIT,
                profiles = profiles,
                references = references,
                me = me,
                bus = bus,
            )

        private val mutableSaved = MutableStateFlow(false)
        val saved: StateFlow<Boolean> = mutableSaved.asStateFlow()

        /** "Save": `PUT /v1/me/preferences` with the full object, a toast, then back (16 section 6.20). */
        fun save() {
            form.submit {
                bus.toast(R.string.me_prefs_saved)
                mutableSaved.value = true
                AfterSave.Leave
            }
        }

        fun consumeSaved() {
            mutableSaved.value = false
        }
    }

/**
 * ME-PREFS (specs/16 section 6.20): the form of 07 section 11 with both tiers, the importance
 * controls and the notes. "Save" shows "Preferences saved. Your matches are being updated." and
 * goes back; leaving with unsaved input asks first.
 */
@Composable
fun MyPreferencesScreen(
    modifier: Modifier = Modifier,
    viewModel: MyPreferencesViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val ui by viewModel.form.state.collectAsStateWithLifecycle()
    val saved by viewModel.saved.collectAsStateWithLifecycle()
    val online = rememberOnline()
    val locator = rememberFieldLocator()
    val form = ui.form
    RevealEffect(form?.reveal, locator)
    LaunchedEffect(saved) {
        if (saved) {
            viewModel.consumeSaved()
            navigator.back()
        }
    }

    FormScreenScaffold(
        title = stringResource(R.string.me_prefs_title),
        busy = form?.busy == true,
        dirty = form?.dirty == true,
        onLeave = { navigator.back() },
        bottomBar = { onCancel ->
            if (form != null) {
                SaveBar(
                    onSave = viewModel::save,
                    onCancel = onCancel,
                    busy = form.busy,
                    enabled = online,
                    summary = plural(R.plurals.preferences_must_summary, form.values.mustHaveCount(ui.candidateGender)),
                    failure = form.failure,
                    failureText = stringResource(R.string.preferences_failed),
                )
            }
        },
        modifier = modifier,
    ) {
        Text(
            stringResource(R.string.me_prefs_intro),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        when {
            ui.loadError != null && form == null -> ErrorState(ui.loadError, onRetry = viewModel.form::load)
            form == null -> FormSkeleton(fields = 6)
            else -> PreferencesFields(ui = ui, locator = locator, onEdit = viewModel.form::edit)
        }
    }
}
