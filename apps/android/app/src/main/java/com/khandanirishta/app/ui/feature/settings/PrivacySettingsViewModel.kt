package com.khandanirishta.app.ui.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.core.network.generated.model.PrivacyPatch
import com.khandanirishta.app.ui.feature.settings.kit.SAVED_MARK_MILLIS
import com.khandanirishta.app.ui.feature.settings.kit.SaveState
import com.khandanirishta.app.ui.feature.settings.kit.saveFailed
import com.khandanirishta.app.ui.messages.MessageBus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject

/** One control of SET-PRIVACY. Each saves by itself, with only its own key (specs/16 section 6.25). */
enum class PrivacyControl {
    DISCOVERY_VISIBILITY,
    INTEREST_PERMISSION,
    NAME_DISPLAY,
    PHOTO_VISIBILITY,
    ALLOW_PHOTO_REQUESTS,
    CASTE_VISIBILITY,
    INCOME_VISIBILITY,
    FAMILY_VISIBILITY,
    CAREER_DETAILS_VISIBILITY,
    HOME_VISIBILITY,
    AREA_VISIBILITY,
    HEALTH_VISIBILITY,
    SHOW_LAST_ACTIVE,
    SHOW_ONLINE_STATUS,
    RECORD_MY_VISITS,
    SEND_READ_RECEIPTS,
}

data class PrivacyUiState(
    /** The saved settings; `null` until the first load. */
    val privacy: Privacy? = null,
    /** The first load failed (rule G3). */
    val error: ApiError? = null,
    val saving: Set<PrivacyControl> = emptySet(),
    val saved: Set<PrivacyControl> = emptySet(),
    /** The own last name, for the examples under "Name shown to members". */
    val lastName: String? = null,
) {
    fun saveState(control: PrivacyControl): SaveState =
        when (control) {
            in saving -> SaveState.SAVING
            in saved -> SaveState.SAVED
            else -> SaveState.IDLE
        }
}

/**
 * SET-PRIVACY (specs/16 section 6.25). Loads `GET /v1/me/privacy` and saves one control at a time
 * with `PATCH /v1/me/privacy`. Not optimistic (rule G7): while a request runs the control shows a
 * spinner and is disabled; on success it shows the value the API returned and a brief "Saved";
 * on failure it keeps the old value and a toast says so.
 */
@HiltViewModel
class PrivacySettingsViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(PrivacyUiState())
        val state: StateFlow<PrivacyUiState> = mutableState.asStateFlow()

        /** Saves outlive the screen, so a change made just before leaving still reaches the API. */
        private val saveScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

        /** One request at a time, so the answers arrive in the order of the changes. */
        private val saveLock = Mutex()
        private val savedMarks = mutableMapOf<PrivacyControl, Job>()
        private var loadJob: Job? = null

        init {
            load()
            viewModelScope.launch {
                profiles.ownProfile.collect { own ->
                    val lastName = own?.basics?.lastName ?: return@collect
                    mutableState.update { it.copy(lastName = lastName) }
                }
            }
            viewModelScope.launch { profiles.cachedOrLoad() }
        }

        fun load() {
            loadJob?.cancel()
            mutableState.update { it.copy(error = null) }
            loadJob =
                viewModelScope.launch {
                    profiles
                        .privacy()
                        .onSuccess { privacy -> mutableState.update { it.copy(privacy = privacy, error = null) } }
                        .onFailure { error ->
                            mutableState.update { it.copy(error = if (it.privacy == null) error.apiError else null) }
                        }
                }
        }

        /** Saves one control: [patch] carries only that control's key. */
        fun save(
            control: PrivacyControl,
            patch: PrivacyPatch,
        ) {
            if (control in mutableState.value.saving) return
            savedMarks.remove(control)?.cancel()
            mutableState.update { it.copy(saving = it.saving + control, saved = it.saved - control) }
            saveScope.launch {
                val result = saveLock.withLock { profiles.updatePrivacy(patch) }
                result
                    .onSuccess { privacy ->
                        mutableState.update {
                            it.copy(privacy = privacy, saving = it.saving - control, saved = it.saved + control)
                        }
                        savedMarks[control] =
                            saveScope.launch {
                                delay(SAVED_MARK_MILLIS)
                                mutableState.update { it.copy(saved = it.saved - control) }
                            }
                    }.onFailure { error ->
                        mutableState.update { it.copy(saving = it.saving - control) }
                        bus.saveFailed(error.apiError)
                    }
            }
        }

        override fun onCleared() {
            savedMarks.values.forEach { it.cancel() }
        }
    }
