package com.khandanirishta.app.ui.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.core.data.NotificationRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.NotificationPreferences
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

data class NotificationSettingsUiState(
    /** The values the API last confirmed; `null` until the first load. */
    val saved: NotificationPreferences? = null,
    /** Changes shown at once while they wait to be sent. */
    val draft: NotificationPreferences? = null,
    /** The first load failed (rule G3). */
    val error: ApiError? = null,
    val saveState: SaveState = SaveState.IDLE,
) {
    /** What the screen shows: the waiting changes, or the saved values. */
    val preferences: NotificationPreferences? get() = draft ?: saved
}

/**
 * SET-NOTIFS (specs/16 section 6.26, specs/14 section 6). Every change shows at once; the complete
 * object is sent with `PUT /v1/me/notification-preferences` after 500 ms without further changes.
 * On failure the screen goes back to the last saved values and a toast says so.
 */
@HiltViewModel
class NotificationSettingsViewModel
    @Inject
    constructor(
        private val notifications: NotificationRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(NotificationSettingsUiState())
        val state: StateFlow<NotificationSettingsUiState> = mutableState.asStateFlow()

        /** Saves outlive the screen: leaving it sends what is waiting instead of dropping it. */
        private val saveScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        private val saveLock = Mutex()

        /** The newest change that has not been confirmed yet. */
        private var pending: NotificationPreferences? = null
        private var debounce: Job? = null
        private var waiting = false
        private var markJob: Job? = null
        private var loadJob: Job? = null

        init {
            load()
        }

        fun load() {
            loadJob?.cancel()
            mutableState.update { it.copy(error = null) }
            loadJob =
                viewModelScope.launch {
                    notifications
                        .preferences()
                        .onSuccess { saved -> mutableState.update { it.copy(saved = saved, error = null) } }
                        .onFailure { error ->
                            mutableState.update { it.copy(error = if (it.saved == null) error.apiError else null) }
                        }
                }
        }

        /** Applies [transform] to what the screen shows and sends the result after a pause. */
        fun change(transform: (NotificationPreferences) -> NotificationPreferences) {
            val base = pending ?: mutableState.value.saved ?: return
            val next = transform(base)
            if (next == base) return
            pending = next
            mutableState.update { it.copy(draft = next) }
            debounce?.cancel()
            waiting = true
            debounce =
                viewModelScope.launch {
                    delay(SAVE_DELAY_MILLIS)
                    debounce = null
                    flush()
                }
        }

        /** Sends the waiting change, in a scope that outlives the screen. */
        private fun flush() {
            waiting = false
            val body = pending ?: return
            markJob?.cancel()
            mutableState.update { it.copy(saveState = SaveState.SAVING) }
            saveScope.launch {
                val result = saveLock.withLock { notifications.savePreferences(body) }
                result
                    .onSuccess { saved ->
                        if (pending === body) {
                            pending = null
                            mutableState.update { it.copy(saved = saved, draft = null, saveState = SaveState.SAVED) }
                        } else {
                            mutableState.update { it.copy(saved = saved, saveState = SaveState.SAVED) }
                        }
                        markJob =
                            saveScope.launch {
                                delay(SAVED_MARK_MILLIS)
                                mutableState.update {
                                    if (it.saveState == SaveState.SAVED) it.copy(saveState = SaveState.IDLE) else it
                                }
                            }
                    }.onFailure { error ->
                        pending = null
                        mutableState.update { it.copy(draft = null, saveState = SaveState.IDLE) }
                        bus.saveFailed(error.apiError)
                    }
            }
        }

        override fun onCleared() {
            // The pause was cut short by leaving the screen: send the change now instead of dropping it.
            if (waiting) flush()
        }

        private companion object {
            /** Every change is sent after this long without further changes (specs/16 section 6.26). */
            const val SAVE_DELAY_MILLIS = 500L
        }
    }
