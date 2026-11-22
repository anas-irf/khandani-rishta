package com.khandanirishta.app.ui.feature.profile

import android.os.SystemClock
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.InterestRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.PhotoVisibility
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.ReportReason
import com.khandanirishta.app.core.network.generated.model.ReportSubject
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.text.pick
import com.khandanirishta.app.ui.text.subjectOf
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/** Loaded profiles, so the photo viewer can use the photos the profile screen already has (16 section 6.8). */
@Singleton
class ProfileCache
    @Inject
    constructor() {
        private val entries = ConcurrentHashMap<String, Pair<ProfileDetail, Long>>()

        fun put(detail: ProfileDetail) {
            entries[detail.card.id] = detail to SystemClock.elapsedRealtime()
        }

        /** The cached profile when it is younger than [maxAgeMillis] (signed URLs live an hour). */
        fun get(
            profileId: String,
            maxAgeMillis: Long = 60 * 60_000L,
        ): ProfileDetail? =
            entries[profileId]?.takeIf { SystemClock.elapsedRealtime() - it.second < maxAgeMillis }?.first

        fun remove(profileId: String) {
            entries.remove(profileId)
        }
    }

@Immutable
data class ProfileUiState(
    val detail: ProfileDetail? = null,
    val loading: Boolean = true,
    val error: ApiError? = null,
    val notFound: Boolean = false,
    val viewLimit: Boolean = false,
    val statusPanel: Boolean = false,
    val busy: Boolean = false,
    /** Accept is on its way: the spinner in its button. */
    val accepting: Boolean = false,
    /** "You are both interested!" after a mutual interest, with the new connection. */
    val mutualConnectionId: String? = null,
    /** "This member accepts interests only from verified members." (send refused). */
    val verifiedOnlyDialog: Boolean = false,
    /** The report was sent; [reportTip] adds safety tip 12 (harassment, asking for money). */
    val reportDone: Boolean = false,
    val reportTip: Boolean = false,
    val reportBlocked: Boolean = false,
    /** The shortlist note dialog is open. */
    val noteDialog: Boolean = false,
    /** Field error on the interest message. */
    val messageError: UiText? = null,
    /** The viewer's own photo visibility, for "Let {name} see my photos". */
    val ownPhotoVisibility: PhotoVisibility? = null,
)

sealed interface ProfileEvent {
    data object Back : ProfileEvent

    data class OpenChat(
        val connectionId: String,
    ) : ProfileEvent

    data object CloseSendDialog : ProfileEvent
}

/** APP-PROFILE (specs/16 section 6.7). */
@HiltViewModel(assistedFactory = ProfileViewModel.Factory::class)
class ProfileViewModel
    @AssistedInject
    constructor(
        @Assisted val profileId: String,
        private val discovery: DiscoveryRepository,
        private val interests: InterestRepository,
        private val relations: RelationRepository,
        private val profiles: ProfileRepository,
        private val cache: ProfileCache,
        private val me: MeRepository,
        private val bus: MessageBus,
        invalidation: Invalidation,
    ) : ViewModel() {
        @AssistedFactory
        interface Factory {
            fun create(profileId: String): ProfileViewModel
        }

        private val mutableState = MutableStateFlow(ProfileUiState())
        val state: StateFlow<ProfileUiState> = mutableState.asStateFlow()

        private val channel = Channel<ProfileEvent>(Channel.BUFFERED)
        val events = channel.receiveAsFlow()

        init {
            load()
            viewModelScope.launch { invalidation.on(DataKey.Profile(profileId)).collect { load(silent = true) } }
            viewModelScope.launch {
                // A heart changed on another screen (the shortlist, a card) shows here too.
                relations.shortlistChanges.collect { change ->
                    if (change.profileId == profileId) setShortlisted(change.shortlisted)
                }
            }
            viewModelScope.launch {
                profiles.privacy().onSuccess { privacy ->
                    mutableState.update { it.copy(ownPhotoVisibility = privacy.photoVisibility) }
                }
            }
        }

        fun load(silent: Boolean = false) {
            viewModelScope.launch {
                if (!silent) mutableState.update { it.copy(loading = it.detail == null, error = null) }
                discovery
                    .profile(profileId)
                    .onSuccess { detail ->
                        cache.put(detail)
                        mutableState.update {
                            it.copy(detail = detail, loading = false, error = null, statusPanel = false)
                        }
                    }.onFailure { failure ->
                        val error = failure.apiError
                        if (error.code == ErrorCode.NOT_FOUND) forget()
                        mutableState.update {
                            when (error.code) {
                                ErrorCode.NOT_FOUND -> it.copy(loading = false, notFound = true)
                                ErrorCode.LIMIT_REACHED -> it.copy(loading = false, viewLimit = true)
                                ErrorCode.PROFILE_NOT_ACTIVE -> it.copy(loading = false, statusPanel = true)
                                else -> it.copy(loading = false, error = if (it.detail == null) error else null)
                            }
                        }
                    }
            }
        }

        /** A member who is no longer available leaves the cached lists (16 section 1.3). */
        private fun forget() {
            cache.remove(profileId)
            discovery.dropFromHome(profileId)
        }

        private fun action(
            accepting: Boolean = false,
            block: suspend () -> Unit,
        ) {
            if (mutableState.value.busy) return
            mutableState.update { it.copy(busy = true, accepting = accepting) }
            viewModelScope.launch {
                block()
                mutableState.update { it.copy(busy = false, accepting = false) }
            }
        }

        private val name: String get() = mutableState.value.detail
            ?.card
            ?.displayName
            .orEmpty()

        /** "Send interest" (16 section 6.7). */
        fun sendInterest(message: String) =
            action {
                mutableState.update { it.copy(messageError = null) }
                interests
                    .send(profileId, message.trim())
                    .onSuccess { sent ->
                        channel.send(ProfileEvent.CloseSendDialog)
                        val connection = sent.connection
                        // The repository invalidates this profile, which reloads it.
                        if (connection == null) {
                            bus.toast(R.string.profile_send_sent)
                        } else {
                            mutableState.update { it.copy(mutualConnectionId = connection.id) }
                        }
                    }.onFailure { failure ->
                        val error = failure.apiError
                        when (error.code) {
                            ErrorCode.ALREADY_CONNECTED, ErrorCode.INTEREST_ALREADY_PENDING -> {
                                channel.send(ProfileEvent.CloseSendDialog)
                                load(silent = true)
                            }

                            ErrorCode.COOLDOWN_ACTIVE -> {
                                channel.send(ProfileEvent.CloseSendDialog)
                                bus.toast(
                                    R.string.profile_send_cooldown,
                                    "date" to MessageBus.formatDetailDate(error.detailString("retry_after_date")),
                                )
                            }

                            ErrorCode.NOT_PERMITTED_BY_MEMBER -> {
                                channel.send(ProfileEvent.CloseSendDialog)
                                if (error.detailString("reason") == "verified_only") {
                                    mutableState.update { it.copy(verifiedOnlyDialog = true) }
                                } else {
                                    bus.toast(R.string.profile_cannot_send_preference_match)
                                }
                            }

                            ErrorCode.LIMIT_REACHED -> {
                                channel.send(ProfileEvent.CloseSendDialog)
                                bus.limit(limitText(error))
                            }

                            ErrorCode.VALIDATION_FAILED -> {
                                mutableState.update { state ->
                                    state.copy(
                                        messageError =
                                            error.fieldError("message")?.let { MessageBus.fieldText(it.code.wire) }
                                                ?: MessageBus.errorText(error),
                                    )
                                }
                            }

                            ErrorCode.NOT_FOUND -> {
                                channel.send(ProfileEvent.CloseSendDialog)
                                mutableState.update { it.copy(notFound = true) }
                            }

                            else -> {
                                bus.error(error)
                            }
                        }
                    }
            }

        private fun limitText(error: ApiError): UiText {
            val limit = error.detailString("limit").orEmpty()
            return when {
                "connection" in limit -> UiText.of(R.string.profile_send_limit_connections)
                "pending" in limit -> UiText.of(R.string.profile_send_limit_pending)
                else -> UiText.of(R.string.profile_send_limit_daily)
            }
        }

        fun dismissMutual() = mutableState.update { it.copy(mutualConnectionId = null) }

        fun dismissVerifiedOnly() = mutableState.update { it.copy(verifiedOnlyDialog = false) }

        fun accept() =
            action(accepting = true) {
                val interest = mutableState.value.detail
                    ?.relation
                    ?.interest ?: return@action
                interests
                    .accept(interest.id, profileId)
                    .onSuccess { accepted ->
                        bus.toast(R.string.profile_accept_done)
                        channel.send(ProfileEvent.OpenChat(accepted.connection.id))
                    }.onFailure { failure ->
                        val error = failure.apiError
                        when (error.code) {
                            ErrorCode.LIMIT_REACHED -> {
                                bus.limit(
                                    UiText.of(
                                        if (error.detailString("side") ==
                                            "them"
                                        ) {
                                            R.string.profile_accept_limit_them
                                        } else {
                                            R.string.profile_accept_limit_you
                                        },
                                    ),
                                )
                            }

                            ErrorCode.INVALID_STATE -> {
                                load(silent = true)
                            }

                            else -> {
                                bus.error(error)
                            }
                        }
                    }
            }

        fun decline(alsoBlock: Boolean) =
            action {
                val interest = mutableState.value.detail
                    ?.relation
                    ?.interest ?: return@action
                interests
                    .decline(interest.id, profileId, alsoBlock)
                    .onSuccess {
                        bus.toast(R.string.profile_decline_done)
                        channel.send(ProfileEvent.Back)
                    }.onFailure { failure ->
                        if (failure.apiError.code ==
                            ErrorCode.INVALID_STATE
                        ) {
                            load(silent = true)
                        } else {
                            bus.error(failure.apiError)
                        }
                    }
            }

        fun withdraw() =
            action {
                val interest = mutableState.value.detail
                    ?.relation
                    ?.interest ?: return@action
                interests
                    .withdraw(interest.id, profileId)
                    .onSuccess { bus.toast(R.string.profile_withdraw_done) }
                    .onFailure { failure ->
                        if (failure.apiError.code ==
                            ErrorCode.INVALID_STATE
                        ) {
                            load(silent = true)
                        } else {
                            bus.error(failure.apiError)
                        }
                    }
            }

        /** The heart: optimistic; after adding, a snackbar offers "Add a note" (16 section 6.7). */
        fun toggleShortlist() {
            val detail = mutableState.value.detail ?: return
            val target = !detail.relation.isShortlisted
            setShortlisted(target)
            viewModelScope.launch {
                val result = if (target) {
                    relations.addToShortlist(
                        profileId,
                    )
                } else {
                    relations.removeFromShortlist(profileId)
                }
                result
                    .onSuccess {
                        if (target) {
                            bus.toast(
                                UiText.of(R.string.profile_actions_shortlisted),
                                UiText.of(R.string.profile_actions_add_note),
                            ) { mutableState.update { it.copy(noteDialog = true) } }
                        }
                    }.onFailure { failure ->
                        setShortlisted(!target)
                        if (failure.apiError.code == ErrorCode.LIMIT_REACHED) {
                            bus.toast(R.string.shared_shortlist_full)
                        } else {
                            bus.toast(R.string.shared_shortlist_failed)
                        }
                    }
            }
        }

        private fun setShortlisted(value: Boolean) {
            mutableState.update { state ->
                val detail = state.detail ?: return@update state
                state.copy(detail = detail.copy(relation = detail.relation.copy(isShortlisted = value)))
            }
        }

        fun closeNoteDialog() = mutableState.update { it.copy(noteDialog = false) }

        fun saveNote(note: String) =
            action {
                relations
                    .addToShortlist(profileId, note)
                    .onSuccess {
                        mutableState.update { it.copy(noteDialog = false) }
                        bus.toast(R.string.discovery_shortlist_note_saved)
                    }.onFailure { bus.error(it.apiError) }
            }

        /** "Not interested": optionally withdraw an open interest first, then pass and go back. */
        fun pass(withdrawFirst: Boolean) =
            action {
                if (withdrawFirst) {
                    mutableState.value.detail
                        ?.relation
                        ?.interest
                        ?.id
                        ?.let { interests.withdraw(it, profileId) }
                }
                relations
                    .pass(profileId)
                    .onSuccess {
                        bus.toast(UiText.of(R.string.profile_pass_done), UiText.of(R.string.discovery_card_undo)) {
                            relations.undoPassInBackground(profileId)
                        }
                        channel.send(ProfileEvent.Back)
                    }.onFailure { bus.error(it.apiError) }
            }

        fun block() =
            action {
                relations
                    .block(profileId)
                    .onSuccess {
                        cache.remove(profileId)
                        bus.toast(R.string.shared_block_success)
                        channel.send(ProfileEvent.Back)
                    }.onFailure { bus.error(it.apiError) }
            }

        fun report(
            reason: String,
            details: String,
            alsoBlock: Boolean,
        ) = action {
            val code = ReportReason.entries.firstOrNull { it.wire == reason } ?: ReportReason.OTHER
            relations
                .report(profileId, ReportSubject.PROFILE, code, details, alsoBlock)
                .onSuccess {
                    mutableState.update {
                        it.copy(
                            reportDone = true,
                            reportTip = code == ReportReason.HARASSMENT || code == ReportReason.ASKING_FOR_MONEY,
                            reportBlocked = alsoBlock,
                        )
                    }
                }.onFailure { failure ->
                    if (failure.apiError.code == ErrorCode.LIMIT_REACHED) {
                        bus.limit(UiText.of(R.string.shared_report_limit, "support_email" to supportEmail))
                    } else {
                        bus.error(failure.apiError)
                    }
                }
        }

        /** Support email for the report limit text; set by the screen from `Me.config`. */
        var supportEmail: String = ""

        fun closeReportDone() {
            val blocked = mutableState.value.reportBlocked
            mutableState.update { it.copy(reportDone = false, reportTip = false, reportBlocked = false) }
            if (blocked) viewModelScope.launch { channel.send(ProfileEvent.Back) }
        }

        fun requestPhotos() =
            action {
                relations
                    .requestPhotos(profileId)
                    .onSuccess { bus.toast(R.string.shared_photo_access_sent) }
                    .onFailure { photoRequestFailed(bus, it.apiError, refetch = { load(silent = true) }) }
            }

        /** "Let {name} see my photos" (16 section 6.7). */
        fun giveAccess() =
            action {
                relations
                    .giveAccess(profileId)
                    .onSuccess {
                        val own = me.me.value?.profile
                        val granted =
                            subjectOf(own?.managedBy, own?.gender).pick(
                                R.string.profile_actions_photos_granted,
                                R.string.profile_actions_photos_granted_male,
                                R.string.profile_actions_photos_granted_female,
                            )
                        bus.toast(granted, "name" to name)
                    }.onFailure { bus.error(it.apiError) }
            }
    }

/** The errors of "Request photos" (16 section 6.7), on the profile and in the viewer. */
internal fun photoRequestFailed(
    bus: MessageBus,
    error: ApiError,
    refetch: () -> Unit,
) {
    when (error.code) {
        ErrorCode.NOT_PERMITTED_BY_MEMBER -> {
            bus.toast(R.string.shared_photo_access_not_permitted)
        }

        ErrorCode.COOLDOWN_ACTIVE -> {
            bus.toast(
                R.string.shared_photo_access_cooldown,
                "date" to MessageBus.formatDetailDate(error.detailString("retry_after_date")),
            )
        }

        ErrorCode.LIMIT_REACHED -> {
            bus.limit(UiText.of(R.string.shared_photo_access_limit))
        }

        ErrorCode.INVALID_STATE, ErrorCode.ALREADY_EXISTS -> {
            refetch()
        }

        else -> {
            bus.error(error)
        }
    }
}
