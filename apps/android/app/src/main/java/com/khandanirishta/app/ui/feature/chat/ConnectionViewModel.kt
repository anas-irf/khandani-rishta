package com.khandanirishta.app.ui.feature.chat

import androidx.compose.runtime.Immutable
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ConnectionRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.ContactShareBody
import com.khandanirishta.app.core.network.generated.model.FieldCode
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The share dialog of 16 section 6.12, kept here so it survives the trip to `SET-CONTACTS`. */
@Immutable
data class ShareDialogState(
    val open: Boolean = false,
    /** The ticks; `null` until the own profile is known, then the defaults apply. */
    val selection: ContactShareBody? = null,
    /** `validation_failed` with `required`: "Add your {item} first." */
    val missing: ShareItem? = null,
    /** The own profile could not be loaded, so there are no values to show (rule G3). */
    val profileError: ApiError? = null,
)

@Immutable
data class ConnectionUiState(
    val core: ConnectionCore = ConnectionCore(),
    /** The member's own profile, for the contact values (`GET /v1/me/profile`, cached). */
    val ownProfile: OwnProfile? = null,
    val share: ShareDialogState = ShareDialogState(),
    /** "Families usually exchange contact details at this point." (once per connection). */
    val shareHint: Boolean = false,
)

/** APP-CONNECTION (specs/16 section 6.12): stage, contact sharing, chat settings and ending. */
@HiltViewModel(assistedFactory = ConnectionViewModel.Factory::class)
class ConnectionViewModel
    @AssistedInject
    constructor(
        @Assisted connectionId: String,
        connections: ConnectionRepository,
        tools: ChatTools,
    ) : ConnectionViewModelBase(connectionId, connections, tools) {
        @AssistedFactory
        interface Factory {
            fun create(connectionId: String): ConnectionViewModel
        }

        private val shareDialog = MutableStateFlow(ShareDialogState())

        val state: StateFlow<ConnectionUiState> =
            combine(
                core,
                shareDialog,
                tools.profiles.ownProfile,
                tools.preferences.dismissed,
            ) { held, dialog, profile, keys ->
                val selection =
                    when {
                        dialog.selection != null -> dialog.selection
                        dialog.open && profile != null -> defaultSelection(profile, held.connection?.myContactShare)
                        else -> null
                    }
                ConnectionUiState(
                    core = held,
                    ownProfile = profile,
                    share = dialog.copy(selection = selection),
                    shareHint = shareHintKey(connectionId) in keys && shareHintDoneKey(connectionId) !in keys,
                )
            }.stateIn(viewModelScope, SharingStarted.Eagerly, ConnectionUiState())

        init {
            loadConnection()
            viewModelScope.launch { tools.profiles.cachedOrLoad() }
        }

        /** Back on screen: reopen the share dialog when the member went to add a missing detail. */
        fun onResume() {
            if (tools.profiles.ownProfile.value == null) viewModelScope.launch { tools.profiles.cachedOrLoad() }
            val saved = tools.sync.takeSelection(connectionId) ?: return
            shareDialog.value = ShareDialogState(open = true, selection = saved)
            loadForShare()
        }

        // -----------------------------------------------------------------------------------------
        // Your contact details (16 section 6.12, 09 section 10)
        // -----------------------------------------------------------------------------------------

        /** "Share contact details" (defaults) or "Change" (the current share). */
        fun openShare() {
            shareDialog.value = ShareDialogState(open = true)
            loadForShare()
        }

        /** "Try again" in the share sheet. */
        fun retryOwnProfile() = loadForShare()

        private fun loadForShare() {
            if (tools.profiles.ownProfile.value != null) return
            shareDialog.update { it.copy(profileError = null) }
            viewModelScope.launch {
                tools.profiles.load().onFailure { failure ->
                    shareDialog.update { it.copy(profileError = failure.apiError) }
                }
            }
        }

        fun updateSelection(selection: ContactShareBody) =
            shareDialog.update { it.copy(selection = selection, missing = null) }

        fun closeShare() {
            if (core.value.busy == ConnectionAction.SHARE) return
            shareDialog.value = ShareDialogState()
        }

        /** "Add": keeps the ticks for the way back from `SET-CONTACTS` (08 section 3.5). */
        fun rememberSelection(selection: ContactShareBody) {
            tools.sync.saveSelection(connectionId, selection)
            shareDialog.value = ShareDialogState()
        }

        /** `PUT .../contact-share` with the four booleans. */
        fun share() {
            val selection = state.value.share.selection ?: return
            if (!selection.anyOn || core.value.busy != null) return
            setBusy(ConnectionAction.SHARE)
            viewModelScope.launch {
                own { connections.shareContact(connectionId, selection) }
                    .onSuccess { connection ->
                        applyConnection(connection)
                        tools.bus.toast(R.string.chat_connection_my_contact_shared)
                        shareDialog.value = ShareDialogState()
                    }.onFailure { failure ->
                        val error = failure.apiError
                        when (error.code) {
                            ErrorCode.VALIDATION_FAILED -> {
                                val field = error.fields.firstOrNull { it.code == FieldCode.REQUIRED }?.field
                                val item = ShareItem.entries.firstOrNull { it.field == field } ?: ShareItem.PHONE
                                shareDialog.update { it.copy(selection = selection, missing = item) }
                            }

                            ErrorCode.CONNECTION_ENDED -> {
                                shareDialog.value = ShareDialogState()
                                refreshConnection()
                            }

                            else -> {
                                tools.bus.error(error)
                            }
                        }
                    }
                setBusy(null)
            }
        }

        /** `DELETE .../contact-share` after the confirmation of rule G8. */
        fun stopSharing() {
            if (core.value.busy != null) return
            setBusy(ConnectionAction.STOP_SHARING)
            viewModelScope.launch {
                own { connections.stopSharing(connectionId) }
                    .onSuccess { connection ->
                        applyConnection(connection)
                        tools.bus.toast(R.string.chat_connection_my_contact_stopped)
                    }.onFailure { tools.bus.error(it.apiError) }
                setBusy(null)
                setDialog(null)
            }
        }

        /** Dismisses the share suggestion for good. */
        fun dismissShareHint() {
            viewModelScope.launch { tools.preferences.dismiss(shareHintDoneKey(connectionId)) }
        }
    }
