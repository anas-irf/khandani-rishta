package com.khandanirishta.app.ui.feature.me

import android.os.Build
import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.ui.messages.MessageBus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What `ME-PROFILE` shows (specs/08 section 1). */
data class MyProfileUiState(
    val profile: OwnProfile? = null,
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: ApiError? = null,
    val preferences: Preferences? = null,
    val preferencesLoading: Boolean = true,
    val privacy: Privacy? = null,
    val privacyLoading: Boolean = true,
    val resuming: Boolean = false,
    val resubmitting: Boolean = false,
    /** The API's messages after a refused "Resubmit for review" (`validation_failed`). */
    val resubmitErrors: List<String> = emptyList(),
)

/**
 * `ME-PROFILE`: `GET /v1/me/profile` on open and after every change (08 section 1), with the
 * preferences and privacy settings for their cards. The banner actions "Resume" and "Resubmit
 * for review" call the profile status endpoints; a gate change is routed by the app.
 */
@HiltViewModel
class MyProfileViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val meRepository: MeRepository,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(MyProfileUiState())
        val state: StateFlow<MyProfileUiState> = mutableState.asStateFlow()

        private var loadJob: Job? = null
        private var preferencesJob: Job? = null
        private var privacyJob: Job? = null
        private var loadedAt = 0L

        init {
            // The repository holds the last loaded profile: show it at once, then refresh.
            viewModelScope.launch {
                profiles.ownProfile.collect { cached ->
                    if (cached != null) mutableState.update { it.copy(profile = cached, loading = false) }
                }
            }
            load()
            loadPreferences()
            loadPrivacy()
            viewModelScope.launch {
                invalidation.flow.collect { key ->
                    when (key) {
                        DataKey.OwnProfile, DataKey.OwnPhotos, DataKey.Verifications -> load(silent = true)
                        DataKey.Preferences -> loadPreferences()
                        DataKey.Privacy -> loadPrivacy()
                        else -> Unit
                    }
                }
            }
        }

        fun load(
            silent: Boolean = false,
            pull: Boolean = false,
        ) {
            loadJob?.cancel()
            loadJob =
                viewModelScope.launch {
                    mutableState.update {
                        it.copy(loading = it.profile == null && !silent, refreshing = pull, error = null)
                    }
                    profiles
                        .load()
                        .onSuccess { profile ->
                            loadedAt = SystemClock.elapsedRealtime()
                            mutableState.update { it.copy(profile = profile, loading = false, refreshing = false) }
                        }.onFailure { failure ->
                            mutableState.update {
                                it.copy(
                                    loading = false,
                                    refreshing = false,
                                    error = if (it.profile == null) failure.apiError else null,
                                )
                            }
                            if (mutableState.value.profile != null && pull) bus.error(failure.apiError)
                        }
                }
            if (pull) {
                loadPreferences()
                loadPrivacy()
            }
        }

        /** Rule G5: data older than 60 seconds is fetched again when the screen comes back. */
        fun onVisible() {
            if (loadedAt != 0L && SystemClock.elapsedRealtime() - loadedAt >= STALE_MILLIS) {
                load(silent = true)
                loadPreferences()
                loadPrivacy()
            }
        }

        private fun loadPreferences() {
            preferencesJob?.cancel()
            preferencesJob =
                viewModelScope.launch {
                    val result = profiles.preferences()
                    mutableState.update {
                        it.copy(preferences = result.getOrNull() ?: it.preferences, preferencesLoading = false)
                    }
                }
        }

        private fun loadPrivacy() {
            privacyJob?.cancel()
            privacyJob =
                viewModelScope.launch {
                    val result = profiles.privacy()
                    mutableState.update { it.copy(privacy = result.getOrNull() ?: it.privacy, privacyLoading = false) }
                }
        }

        /** "Resume" on the paused banner (08 section 1.2). */
        fun resume() {
            if (mutableState.value.resuming) return
            viewModelScope.launch {
                mutableState.update { it.copy(resuming = true) }
                meRepository
                    .resume()
                    .onSuccess { bus.toast(R.string.me_profile_banner_resumed) }
                    .onFailure { bus.error(it.apiError) }
                mutableState.update { it.copy(resuming = false) }
            }
        }

        /** "Resubmit for review" on the changes-requested banner; the new gate routes the app. */
        fun resubmit() {
            if (mutableState.value.resubmitting) return
            viewModelScope.launch {
                mutableState.update { it.copy(resubmitting = true, resubmitErrors = emptyList()) }
                meRepository
                    .resubmit()
                    .onSuccess { bus.toast(R.string.me_profile_banner_resubmitted) }
                    .onFailure { failure ->
                        val error = failure.apiError
                        if (error.code == ErrorCode.VALIDATION_FAILED && error.fields.isNotEmpty()) {
                            val messages = error.fields.map { field -> field.message }
                            mutableState.update { it.copy(resubmitErrors = messages) }
                        } else {
                            bus.error(error)
                        }
                    }
                mutableState.update { it.copy(resubmitting = false) }
            }
        }

        /**
         * After "Copy link" on the profile code. Android 13 and later confirm a copy themselves,
         * so the toast is shown only on older versions, and always when the copy failed.
         */
        fun onLinkCopied(
            copied: Boolean,
            code: String,
        ) {
            when {
                !copied -> bus.toast(R.string.me_profile_code_copy_failed, "code" to code)
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> bus.toast(R.string.me_profile_code_copied)
            }
        }

        private companion object {
            const val STALE_MILLIS = 60_000L
        }
    }
