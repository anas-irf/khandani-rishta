package com.khandanirishta.app.ui.feature.settings

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ConnectionRepository
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.ClosedReason
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ExportStatus
import com.khandanirishta.app.core.network.generated.model.LatestExport
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.feature.settings.kit.saveFailed
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import com.khandanirishta.app.core.network.generated.model.Locale as AppLocale

/** The dialogs and sheets of SET-ACCOUNT; at most one is open at a time. */
enum class AccountDialog {
    /** "Pause the profile?" (08 section 7.1). */
    PAUSE,

    /** "Close the profile?" with the reason (08 section 7.3). */
    CLOSE,

    /** "Reopen the profile?", or the nikah version with REOPEN typed (08 section 7.4). */
    REOPEN,

    /** The gentler options before deleting (06 section 9.1). */
    GENTLE,

    /** The deletion confirmation (06 section 9.5). */
    DELETE,

    /** "Mubarak!" once, after closing because the match was found here (08 section 7.3). */
    MUBARAK,

    /** "Sign out of Khandani Rishta?" (16 section 6.27). */
    SIGN_OUT,
}

/** "Your data": the latest export (16 section 6.27, 09 section 12.1). */
@Immutable
data class ExportUi(
    /** The first answer has arrived. */
    val loaded: Boolean = false,
    /** The first load failed. */
    val error: ApiError? = null,
    /** `null` once loaded without an error: no export exists (`404`). */
    val latest: LatestExport? = null,
    /** `POST /v1/me/exports` is running. */
    val requesting: Boolean = false,
)

/** The check before reopening a closed profile: a connection at `nikah_done` (08 section 7.4). */
@Immutable
data class NikahCheck(
    val loading: Boolean = false,
    val found: Boolean = false,
    /** The other member's display name, when available. */
    val partnerName: String? = null,
)

@Immutable
data class AccountUiState(
    val dialog: AccountDialog? = null,
    /** Pause, resume, close or reopen is running. */
    val statusBusy: Boolean = false,
    val localeBusy: Boolean = false,
    val export: ExportUi = ExportUi(),
    val nikah: NikahCheck = NikahCheck(),
)

/**
 * SET-ACCOUNT (specs/16 section 6.27): the profile status actions of 08 section 7, the data export
 * and the language. `Me` comes from the cache; every status call returns `Me`, which replaces it.
 */
@HiltViewModel
class AccountSettingsViewModel
    @Inject
    constructor(
        private val meRepository: MeRepository,
        private val connections: ConnectionRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(AccountUiState())
        val state: StateFlow<AccountUiState> = mutableState.asStateFlow()

        private var visible = false
        private var exportJob: Job? = null
        private var pollJob: Job? = null
        private var nikahJob: Job? = null

        init {
            // Loaded as soon as the profile is closed, so the right reopen dialog opens at once.
            viewModelScope.launch {
                meRepository.me
                    .map { it?.profile?.status }
                    .distinctUntilChanged()
                    .collect { status ->
                        if (status == ProfileStatus.CLOSED) {
                            checkNikah()
                        } else {
                            nikahJob?.cancel()
                            mutableState.update { it.copy(nikah = NikahCheck()) }
                        }
                    }
            }
        }

        fun open(dialog: AccountDialog) {
            mutableState.update { it.copy(dialog = dialog) }
        }

        fun dismiss() {
            if (mutableState.value.statusBusy) return
            mutableState.update { it.copy(dialog = null) }
        }

        // -- Profile status (08 section 7) ----------------------------------------------------------

        fun pause() = statusChange(R.string.settings_account_status_pause_done) { meRepository.pause() }

        /** No confirmation (08 section 7.2). */
        fun resume() = statusChange(R.string.settings_account_status_resume_done) { meRepository.resume() }

        fun close(reason: ClosedReason) =
            statusChange(
                done = R.string.settings_account_status_close_done,
                next = if (reason == ClosedReason.FOUND_MATCH_HERE) AccountDialog.MUBARAK else null,
            ) { meRepository.close(reason) }

        fun reopen() = statusChange(R.string.settings_account_status_reopen_done) { meRepository.reopen() }

        /**
         * Runs one status change. Success closes the dialog (or opens [next]) with the toast [done].
         * `invalid_state` means the status changed elsewhere: `Me` is fetched again and nothing is
         * said. Other failures keep the dialog open, with the generic handling.
         */
        private fun statusChange(
            done: Int,
            next: AccountDialog? = null,
            call: suspend () -> Result<Me>,
        ) {
            if (mutableState.value.statusBusy) return
            mutableState.update { it.copy(statusBusy = true) }
            viewModelScope.launch {
                call()
                    .onSuccess {
                        mutableState.update { it.copy(statusBusy = false, dialog = next) }
                        bus.toast(done)
                    }.onFailure { error ->
                        val apiError = error.apiError
                        if (apiError.code == ErrorCode.INVALID_STATE) {
                            meRepository.refresh()
                            mutableState.update { it.copy(statusBusy = false, dialog = null) }
                        } else {
                            mutableState.update { it.copy(statusBusy = false) }
                            bus.error(apiError)
                        }
                    }
            }
        }

        /**
         * Before reopening (08 section 7.4): `GET /v1/connections?filter=active`, looking for a
         * connection at `nikah_done`. A failed check counts as none; the API still asks for `confirm`.
         */
        private fun checkNikah() {
            nikahJob?.cancel()
            mutableState.update { it.copy(nikah = NikahCheck(loading = true)) }
            nikahJob =
                viewModelScope.launch {
                    var cursor: String? = null
                    var pages = 0
                    var result = NikahCheck()
                    while (pages < NIKAH_PAGES) {
                        val page = connections.list("active", cursor).getOrNull() ?: break
                        val done = page.items.firstOrNull { it.stage == ConnectionStage.NIKAH_DONE }
                        if (done != null) {
                            result = NikahCheck(found = true, partnerName = done.other?.displayName)
                            break
                        }
                        cursor = page.nextCursor ?: break
                        pages += 1
                    }
                    mutableState.update { it.copy(nikah = result) }
                }
        }

        // -- Language ----------------------------------------------------------------------------------

        /** `PATCH /v1/me` with `{ locale }` (16 section 6.27 group 2). */
        fun changeLocale(locale: AppLocale) {
            if (mutableState.value.localeBusy || locale == AppLocale.UNKNOWN) return
            if (locale == meRepository.current?.user?.locale) return
            mutableState.update { it.copy(localeBusy = true) }
            viewModelScope.launch {
                meRepository.setLocale(locale).onFailure { bus.saveFailed(it.apiError) }
                mutableState.update { it.copy(localeBusy = false) }
            }
        }

        // -- Your data (09 section 12.1) ------------------------------------------------------------

        /** The screen is on show: fetch the export state and poll it while it is queued. */
        fun onVisible() {
            visible = true
            loadExport()
        }

        fun onHidden() {
            visible = false
            pollJob?.cancel()
            pollJob = null
        }

        /** `GET /v1/me/exports/latest`; a `404` means no export exists. */
        fun loadExport() {
            exportJob?.cancel()
            if (!mutableState.value.export.loaded) {
                mutableState.update { it.copy(export = it.export.copy(error = null)) }
            }
            exportJob =
                viewModelScope.launch {
                    meRepository
                        .latestExport()
                        .onSuccess { latest -> showExport(latest) }
                        .onFailure { error ->
                            val apiError = error.apiError
                            if (apiError.status == HTTP_NOT_FOUND || apiError.code == ErrorCode.NOT_FOUND) {
                                showExport(null)
                            } else if (!mutableState.value.export.loaded) {
                                mutableState.update { it.copy(export = it.export.copy(error = apiError)) }
                            }
                        }
                    schedulePoll()
                }
        }

        /** Shows the answer of `GET /v1/me/exports/latest`; [latest] is `null` when no export exists. */
        private fun showExport(latest: LatestExport?) {
            mutableState.update { it.copy(export = it.export.copy(loaded = true, error = null, latest = latest)) }
        }

        /** `POST /v1/me/exports`: at most once every 24 hours (`limit_reached`). */
        fun requestExport() {
            if (mutableState.value.export.requesting) return
            mutableState.update { it.copy(export = it.export.copy(requesting = true)) }
            viewModelScope.launch {
                meRepository
                    .requestExport()
                    .onSuccess {
                        mutableState.update {
                            it.copy(
                                export =
                                    ExportUi(
                                        loaded = true,
                                        latest = LatestExport(status = ExportStatus.QUEUED),
                                    ),
                            )
                        }
                        schedulePoll()
                    }.onFailure { error ->
                        mutableState.update { it.copy(export = it.export.copy(requesting = false)) }
                        val apiError = error.apiError
                        if (apiError.code == ErrorCode.LIMIT_REACHED) {
                            bus.limit(UiText.of(R.string.settings_account_data_limit))
                        } else {
                            bus.error(apiError)
                        }
                    }
            }
        }

        /** While the file is being prepared, the state is fetched again every 15 seconds on screen. */
        private fun schedulePoll() {
            pollJob?.cancel()
            pollJob = null
            if (!visible || mutableState.value.export.latest
                    ?.status != ExportStatus.QUEUED
            ) {
                return
            }
            pollJob =
                viewModelScope.launch {
                    delay(EXPORT_POLL_MILLIS)
                    loadExport()
                }
        }

        private companion object {
            const val EXPORT_POLL_MILLIS = 15_000L
            const val NIKAH_PAGES = 3
            const val HTTP_NOT_FOUND = 404
        }
    }
