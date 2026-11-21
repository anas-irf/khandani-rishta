package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.Scaffold
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
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.ReferenceRepository
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.feature.profilesections.AfterSave
import com.khandanirishta.app.ui.feature.profilesections.FormMode
import com.khandanirishta.app.ui.feature.profilesections.FormScreenScaffold
import com.khandanirishta.app.ui.feature.profilesections.PlaceLookup
import com.khandanirishta.app.ui.feature.profilesections.RevealEffect
import com.khandanirishta.app.ui.feature.profilesections.SECTION_KEYS
import com.khandanirishta.app.ui.feature.profilesections.SaveBar
import com.khandanirishta.app.ui.feature.profilesections.SectionFields
import com.khandanirishta.app.ui.feature.profilesections.SectionFormController
import com.khandanirishta.app.ui.feature.profilesections.rememberFieldLocator
import com.khandanirishta.app.ui.feature.profilesections.rememberOnline
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPreferences
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What happens after a save on ME-EDIT (08 section 2.3). */
enum class EditResult {
    /** Back to the previous screen. */
    DONE,

    /** "You changed the religion. ... Review them now?" */
    REVIEW_RELIGION,

    /** "You changed the country. ... Review them now?" */
    REVIEW_COUNTRY,
}

/** ME-EDIT: one section of the own profile, with the onboarding form of the same name (08 section 2). */
@HiltViewModel(assistedFactory = EditSectionViewModel.Factory::class)
class EditSectionViewModel
    @AssistedInject
    constructor(
        @Assisted val section: String,
        profiles: ProfileRepository,
        references: ReferenceRepository,
        places: PlaceLookup,
        private val bus: MessageBus,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(section: String): EditSectionViewModel
        }

        val form =
            SectionFormController(
                scope = viewModelScope,
                section = section,
                mode = FormMode.EDIT,
                profiles = profiles,
                references = references,
                places = places,
                bus = bus,
            )

        private val mutableResult = MutableStateFlow<EditResult?>(null)
        val result: StateFlow<EditResult?> = mutableResult.asStateFlow()

        /** "Save": the whole section, then "Saved" and back (08 section 2). */
        fun save() {
            val before = form.state.value.profile
            form.submit { saved ->
                bus.toast(R.string.common_toast_saved)
                val religionChanged = before != null && before.community.religionCode != saved.community.religionCode
                val countryChanged = before != null && before.location.countryCode != saved.location.countryCode
                mutableResult.value =
                    when {
                        section == "community" && religionChanged -> EditResult.REVIEW_RELIGION
                        section == "location" && countryChanged -> EditResult.REVIEW_COUNTRY
                        else -> EditResult.DONE
                    }
                AfterSave.Leave
            }
        }

        fun consumeResult() {
            mutableResult.value = null
        }
    }

/**
 * ME-EDIT (specs/16 section 6.18, specs/08 section 2): edit one section of the own profile with
 * the same fields, rules and messages as its onboarding step. "Save" shows "Saved" and goes back;
 * a changed religion or country offers to review the partner preferences.
 */
@Composable
fun EditSectionScreen(
    section: String,
    modifier: Modifier = Modifier,
) {
    val navigator = LocalNavigator.current
    if (section !in SECTION_KEYS) {
        Scaffold(
            modifier = modifier,
            topBar = { DetailTopBar(title = "", onBack = { navigator.back() }) },
        ) { padding ->
            EmptyState(
                title = stringResource(R.string.me_edit_not_found),
                icon = Icons.Outlined.SearchOff,
                actionLabel = stringResource(R.string.errors_go_back),
                onAction = { navigator.back() },
                modifier = Modifier.padding(padding),
            )
        }
        return
    }
    EditSection(section = section, modifier = modifier)
}

@Composable
private fun EditSection(
    section: String,
    modifier: Modifier = Modifier,
) {
    val viewModel = hiltViewModel<EditSectionViewModel, EditSectionViewModel.Factory> { it.create(section) }
    val navigator = LocalNavigator.current
    val ui by viewModel.form.state.collectAsStateWithLifecycle()
    val result by viewModel.result.collectAsStateWithLifecycle()
    val online = rememberOnline()
    val locator = rememberFieldLocator()
    val form = ui.form
    val context = viewModel.form.sectionContext
    RevealEffect(form?.reveal, locator)

    FormScreenScaffold(
        title = stringResource(editTitle(section)),
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
                    failure = form.failure,
                )
            }
        },
        modifier = modifier,
    ) {
        when {
            ui.loadError != null && form == null -> {
                ErrorState(ui.loadError, onRetry = viewModel.form::load)
            }

            form == null || context == null -> {
                FormSkeleton(fields = 5)
            }

            else -> {
                SectionFields(
                    ui = ui,
                    context = context,
                    locator = locator,
                    onEdit = viewModel.form::edit,
                    onIncomeCurrency = viewModel.form::setIncomeCurrency,
                )
            }
        }
    }

    LaunchedEffect(result) {
        if (result == EditResult.DONE) {
            viewModel.consumeResult()
            navigator.back()
        }
    }
    when (result) {
        EditResult.REVIEW_RELIGION, EditResult.REVIEW_COUNTRY -> {
            ConfirmDialog(
                title =
                    stringResource(
                        if (result == EditResult.REVIEW_COUNTRY) {
                            R.string.me_edit_review_country
                        } else {
                            R.string.me_edit_review_religion
                        },
                    ),
                text = null,
                confirmLabel = stringResource(R.string.me_edit_review),
                dismissLabel = stringResource(R.string.me_edit_later),
                onConfirm = {
                    viewModel.consumeResult()
                    navigator.replaceTop(MyPreferences)
                },
                onDismiss = {
                    viewModel.consumeResult()
                    navigator.back()
                },
            )
        }

        else -> {}
    }
}

private fun editTitle(section: String): Int =
    when (section) {
        "account_for" -> R.string.me_edit_title_account_for
        "basics" -> R.string.me_edit_title_basics
        "community" -> R.string.me_edit_title_community
        "location" -> R.string.me_edit_title_location
        "education_career" -> R.string.me_edit_title_education_career
        "family" -> R.string.me_edit_title_family
        else -> R.string.me_edit_title_lifestyle
    }
