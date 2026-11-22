package com.khandanirishta.app.ui.feature.chat

import android.os.SystemClock
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ConnectionRepository
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.datastore.AppPreferences
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ContactShareBody
import com.khandanirishta.app.core.network.generated.model.MemberEndReason
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.ProposableStage
import com.khandanirishta.app.core.network.generated.model.ReportReason
import com.khandanirishta.app.core.network.generated.model.ReportSubject
import com.khandanirishta.app.core.realtime.ConnectivityObserver
import com.khandanirishta.app.core.realtime.RealtimeClient
import com.khandanirishta.app.core.realtime.RealtimeEvent
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.Chats
import com.khandanirishta.app.ui.navigation.ConnectionDetails
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Tab
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** A request of the chat and connection screens; while one runs, its button shows progress. */
enum class ConnectionAction {
    PROPOSE,
    CONFIRM,
    DECLINE,
    CANCEL,
    SHARE,
    STOP_SHARING,
    END,
    REPORT,
    BLOCK,
    PAUSE,
    REMOVE_MESSAGE,
}

/** A stage suggestion or its answer (specs/11 section 9). */
sealed interface StageAction {
    val action: ConnectionAction

    data class Propose(
        val stage: ProposableStage,
    ) : StageAction {
        override val action: ConnectionAction get() = ConnectionAction.PROPOSE
    }

    data class Confirm(
        val proposalId: String,
    ) : StageAction {
        override val action: ConnectionAction get() = ConnectionAction.CONFIRM
    }

    data class Decline(
        val proposalId: String,
    ) : StageAction {
        override val action: ConnectionAction get() = ConnectionAction.DECLINE
    }

    data class Cancel(
        val proposalId: String,
    ) : StageAction {
        override val action: ConnectionAction get() = ConnectionAction.CANCEL
    }
}

/** The dialog on top of the chat or the connection details. Kept in the ViewModel so it survives rotation. */
sealed interface ConnectionDialog {
    /** The report dialog of specs/16 section 6.11; [leaveAfter] returns to the chat list when it closes. */
    data class Report(
        val profileId: String,
        val name: String,
        val messageId: String? = null,
        val reason: String? = null,
        val leaveAfter: Boolean = false,
        val blockedProfileId: String? = null,
    ) : ConnectionDialog

    /** The report confirmation with safety tip 12 (13 section 11.3). */
    data class ReportTip(
        val leave: Boolean,
        val blockedProfileId: String?,
    ) : ConnectionDialog

    data class Block(
        val profileId: String,
        val name: String,
    ) : ConnectionDialog

    data object End : ConnectionDialog

    /** "Would you like to report {name}?" after ending for inappropriate behaviour. */
    data class ReportOffer(
        val profileId: String,
        val name: String,
        val blockedProfileId: String?,
    ) : ConnectionDialog

    data object SafetyTips : ConnectionDialog

    data class RemoveMessage(
        val messageId: String,
    ) : ConnectionDialog

    data object StopSharing : ConnectionDialog

    data object SuggestStage : ConnectionDialog
}

/** The part of the screen state that the chat and the connection details share. */
@Immutable
data class ConnectionCore(
    val connection: Connection? = null,
    /** The first load is running and nothing is shown yet (skeleton, rule G1). */
    val loading: Boolean = true,
    /** The first load failed (rule G3). */
    val error: ApiError? = null,
    /** `not_found`: "This is no longer available." (16 section 1.3). */
    val notFound: Boolean = false,
    val busy: ConnectionAction? = null,
    val dialog: ConnectionDialog? = null,
    /** A stage reached while this screen watched, waiting to be claimed by the screen on display. */
    val pendingFollowUp: ConnectionStage? = null,
    /** The follow-up of 16 section 6.12 being shown. */
    val followUp: ConnectionStage? = null,
    /** For the nikah message: "Mubarak!" for a Muslim profile, otherwise the general wording. */
    val muslim: Boolean = true,
    val online: Boolean = true,
)

/** One-off results for the screen. */
sealed interface ConnectionEvent {
    /** Back to `APP-CHATS` after ending or blocking; the blocked member's profile leaves the stack too. */
    data class Leave(
        val blockedProfileId: String?,
    ) : ConnectionEvent
}

/** Changes one chat screen tells the others about, so the chat list stays current without a refetch. */
sealed interface ChatSyncEvent {
    /** A newer copy of a connection. */
    data class Changed(
        val connection: Connection,
    ) : ChatSyncEvent

    /** The member read the conversation: the unread badge clears (rule G7). */
    data class Read(
        val connectionId: String,
    ) : ChatSyncEvent

    /** The member sent a message from this device. */
    data class Sent(
        val message: Message,
    ) : ChatSyncEvent

    /** The newest message was removed, so the list preview is gone (11 section 6.7). */
    data class PreviewCleared(
        val connectionId: String,
    ) : ChatSyncEvent

    /** The connection answered `not_found`: it leaves every list (16 section 1.3). */
    data class Gone(
        val connectionId: String,
    ) : ChatSyncEvent
}

/**
 * The link between the chat screens of this package: list updates, the claim on stage follow-ups (so
 * the chat and the connection details never both show one), and the share selection kept while the
 * member adds a missing detail on `SET-CONTACTS` (08 section 3.5).
 */
@Singleton
class ChatSync
    @Inject
    constructor() {
        private val mutableEvents = MutableSharedFlow<ChatSyncEvent>(extraBufferCapacity = 32)
        val events: SharedFlow<ChatSyncEvent> = mutableEvents.asSharedFlow()

        private val handledStages = HashMap<String, Int>()
        private val savedSelections = HashMap<String, ContactShareBody>()

        fun emit(event: ChatSyncEvent) {
            mutableEvents.tryEmit(event)
        }

        /** True once per connection and stage: the screen that claims it shows the follow-up. */
        @Synchronized
        fun claimFollowUp(
            connectionId: String,
            stage: ConnectionStage,
        ): Boolean {
            val handled = handledStages[connectionId] ?: -1
            if (stage.order() <= handled) return false
            handledStages[connectionId] = stage.order()
            return true
        }

        @Synchronized
        fun saveSelection(
            connectionId: String,
            selection: ContactShareBody,
        ) {
            savedSelections[connectionId] = selection
        }

        /** The selection saved for [connectionId], once. */
        @Synchronized
        fun takeSelection(connectionId: String): ContactShareBody? = savedSelections.remove(connectionId)
    }

/** The singletons both chat ViewModels need, in one injectable bundle. */
class ChatTools
    @Inject
    constructor(
        val realtime: RealtimeClient,
        val relations: RelationRepository,
        val me: MeRepository,
        val profiles: ProfileRepository,
        val preferences: AppPreferences,
        val bus: MessageBus,
        val sync: ChatSync,
        val invalidation: Invalidation,
        val connectivity: ConnectivityObserver,
    )

/** The device key that marks the "families_talking" share suggestion as pending (16 section 6.12). */
internal fun shareHintKey(connectionId: String) = "chat_share_hint:$connectionId"

/** The device key that marks the share suggestion as dismissed. */
internal fun shareHintDoneKey(connectionId: String) = "chat_share_hint_done:$connectionId"

/**
 * The connection, its actions and dialogs, shared by `APP-CHAT` and `APP-CONNECTION` (specs/16
 * sections 6.11 and 6.12): loading, live updates, mute and archive (optimistic, rule G7), stage
 * suggestions, report, block, ending, and the follow-ups after a stage is reached.
 */
abstract class ConnectionViewModelBase(
    val connectionId: String,
    protected val connections: ConnectionRepository,
    protected val tools: ChatTools,
) : ViewModel() {
    protected val core = MutableStateFlow(ConnectionCore())

    private val eventChannel = Channel<ConnectionEvent>(Channel.BUFFERED)

    /** One-off results for the screen. */
    val events: Flow<ConnectionEvent> = eventChannel.receiveAsFlow()

    private var knownStage: ConnectionStage? = null
    private var loadJob: Job? = null

    /** Requests of this screen that are running: their own invalidation needs no refetch. */
    private var ownRequests = 0
    private var appliedAt = 0L

    init {
        viewModelScope.launch {
            tools.connectivity.online.collect { online -> core.update { it.copy(online = online) } }
        }
        viewModelScope.launch {
            tools.invalidation.on(DataKey.Connection(connectionId)).collect {
                val recent = SystemClock.elapsedRealtime() - appliedAt < OWN_CHANGE_WINDOW
                if (ownRequests == 0 && !recent) refreshConnection()
            }
        }
        viewModelScope.launch {
            tools.realtime.events.collect { event ->
                when (event) {
                    is RealtimeEvent.ConnectionUpdated -> {
                        if (event.connection.id == connectionId) applyConnection(event.connection)
                    }

                    is RealtimeEvent.Ready -> {
                        if (event.afterReconnect) onReconnected()
                    }

                    else -> {}
                }
            }
        }
    }

    /** "Try again" after the screen error. */
    open fun retry() = loadConnection()

    /** Loads the connection; the skeleton shows only while nothing is held. */
    protected fun loadConnection() {
        loadJob?.cancel()
        loadJob =
            viewModelScope.launch {
                core.update { it.copy(loading = it.connection == null, error = null) }
                connections
                    .get(connectionId)
                    .onSuccess { applyConnection(it) }
                    .onFailure { failure ->
                        val error = failure.apiError
                        if (error.code == ErrorCode.NOT_FOUND) {
                            gone()
                        } else {
                            core.update { it.copy(loading = false, error = if (it.connection == null) error else null) }
                        }
                    }
            }
    }

    /** Fetches the connection again in the background (after an error code, an event or a reconnect). */
    fun refreshConnection() {
        if (core.value.connection == null) {
            loadConnection()
            return
        }
        loadJob?.cancel()
        loadJob =
            viewModelScope.launch {
                connections
                    .get(connectionId)
                    .onSuccess { applyConnection(it) }
                    .onFailure { if (it.apiError.code == ErrorCode.NOT_FOUND) gone() }
            }
    }

    private fun gone() {
        core.update { it.copy(loading = false, notFound = true, dialog = null) }
        tools.sync.emit(ChatSyncEvent.Gone(connectionId))
    }

    /** Called after a reconnect (19 section 4.8). */
    protected open fun onReconnected() = refreshConnection()

    /** Called whenever a newer copy of the connection arrived. */
    protected open fun onConnectionApplied(connection: Connection) = Unit

    protected fun applyConnection(connection: Connection) {
        val before = knownStage
        knownStage = connection.stage
        val raised = before != null && connection.stage.order() > before.order()
        appliedAt = SystemClock.elapsedRealtime()
        core.update {
            it.copy(
                connection = connection,
                loading = false,
                error = null,
                notFound = false,
                pendingFollowUp = if (raised) connection.stage else it.pendingFollowUp,
            )
        }
        tools.sync.emit(ChatSyncEvent.Changed(connection))
        onConnectionApplied(connection)
    }

    /** Changes the held connection at once (optimistic, rule G7). */
    protected fun patchLocal(transform: (Connection) -> Connection) {
        val current = core.value.connection ?: return
        val changed = transform(current)
        core.update { it.copy(connection = changed) }
        tools.sync.emit(ChatSyncEvent.Changed(changed))
    }

    /** Runs a request of this screen, so the invalidation it causes does not refetch again. */
    protected suspend fun <T> own(block: suspend () -> Result<T>): Result<T> {
        ownRequests++
        try {
            return block()
        } finally {
            ownRequests--
        }
    }

    protected fun setBusy(action: ConnectionAction?) = core.update { it.copy(busy = action) }

    protected fun setDialog(dialog: ConnectionDialog?) = core.update { it.copy(dialog = dialog) }

    private fun leave(blockedProfileId: String?) {
        eventChannel.trySend(ConnectionEvent.Leave(blockedProfileId))
    }

    // ---------------------------------------------------------------------------------------------
    // Mute and archive (optimistic, rule G7)
    // ---------------------------------------------------------------------------------------------

    fun setMuted(muted: Boolean) {
        if (core.value.connection?.isMuted == muted) return
        patchLocal { it.copy(isMuted = muted) }
        viewModelScope.launch {
            own { connections.setMuted(connectionId, muted) }
                .onSuccess { applyConnection(it) }
                .onFailure { failure ->
                    patchLocal { it.copy(isMuted = !muted) }
                    tools.bus.error(failure.apiError)
                }
        }
    }

    fun setArchived(archived: Boolean) {
        if (core.value.connection?.isArchived == archived) return
        patchLocal { it.copy(isArchived = archived) }
        viewModelScope.launch {
            own { connections.setArchived(connectionId, archived) }
                .onSuccess { applyConnection(it) }
                .onFailure { failure ->
                    patchLocal { it.copy(isArchived = !archived) }
                    tools.bus.error(failure.apiError)
                }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Stages (specs/11 section 9, 16 section 6.12)
    // ---------------------------------------------------------------------------------------------

    fun stage(action: StageAction) {
        if (core.value.busy != null) return
        setBusy(action.action)
        viewModelScope.launch {
            val result =
                own {
                    when (action) {
                        is StageAction.Propose -> connections.propose(connectionId, action.stage)
                        is StageAction.Confirm -> connections.confirmProposal(connectionId, action.proposalId)
                        is StageAction.Decline -> connections.declineProposal(connectionId, action.proposalId)
                        is StageAction.Cancel -> connections.cancelProposal(connectionId, action.proposalId)
                    }
                }
            result
                .onSuccess { applyConnection(it) }
                .onFailure { if (stageErrorNeedsRefetch(it.apiError)) refreshConnection() }
            setBusy(null)
            if (core.value.dialog == ConnectionDialog.SuggestStage) setDialog(null)
        }
    }

    /** The errors of 16 section 6.12: a refetch for a stale state, the date for a cooldown. */
    private fun stageErrorNeedsRefetch(error: ApiError): Boolean =
        when (error.code) {
            ErrorCode.INVALID_STATE, ErrorCode.ALREADY_EXISTS, ErrorCode.CONNECTION_ENDED -> {
                true
            }

            ErrorCode.COOLDOWN_ACTIVE -> {
                tools.bus.toast(
                    R.string.chat_stage_cooldown,
                    "date" to MessageBus.formatDetailDate(error.detailString("retry_after_date")),
                )
                false
            }

            else -> {
                tools.bus.error(error)
                false
            }
        }

    /** Claims the follow-up of a stage reached while watching; only the screen on display calls this. */
    fun claimFollowUp() {
        val stage = core.value.pendingFollowUp ?: return
        core.update { it.copy(pendingFollowUp = null) }
        if (!tools.sync.claimFollowUp(connectionId, stage)) return
        when (stage) {
            ConnectionStage.FAMILIES_TALKING -> {
                core.update { it.copy(followUp = stage) }
                viewModelScope.launch { markShareHint() }
            }

            ConnectionStage.ENGAGED -> {
                core.update { it.copy(followUp = stage) }
            }

            ConnectionStage.NIKAH_DONE -> {
                val religion = tools.profiles.ownProfile.value
                    ?.community
                    ?.religionCode
                core.update { it.copy(followUp = stage, muslim = religion == null || religion == ISLAM) }
                viewModelScope.launch { tools.me.refresh() }
            }

            else -> {}
        }
    }

    /** "Marked: {stage name}." for `families_talking`; the screen passes the stage name. */
    fun announceStage(stageName: String) {
        tools.bus.toast(UiText.of(R.string.chat_stage_marked, "stage" to stageName))
        core.update { it.copy(followUp = null) }
    }

    fun dismissFollowUp() = core.update { it.copy(followUp = null) }

    /** "Pause my profile" after `engaged` (11 section 9.4). Nothing is automatic. */
    fun pauseProfile() {
        if (core.value.busy != null) return
        setBusy(ConnectionAction.PAUSE)
        viewModelScope.launch {
            tools.me
                .pause()
                .onSuccess {
                    tools.bus.toast(R.string.settings_account_status_pause_done)
                    core.update { it.copy(followUp = null) }
                }.onFailure { tools.bus.error(it.apiError) }
            setBusy(null)
        }
    }

    private suspend fun markShareHint() {
        val keys = tools.preferences.dismissed.first()
        if (shareHintKey(connectionId) !in keys && shareHintDoneKey(connectionId) !in keys) {
            tools.preferences.dismiss(shareHintKey(connectionId))
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Dialogs: report, block, end (specs/16 sections 6.7, 6.11 and 6.12)
    // ---------------------------------------------------------------------------------------------

    fun openReport(
        messageId: String? = null,
        reason: String? = null,
    ) {
        val other = core.value.connection?.other ?: return
        setDialog(ConnectionDialog.Report(other.id, other.displayName, messageId, reason))
    }

    fun openBlock() {
        val other = core.value.connection?.other ?: return
        setDialog(ConnectionDialog.Block(other.id, other.displayName))
    }

    fun openDialog(dialog: ConnectionDialog) = setDialog(dialog)

    /** Closes the dialog on top; some flows then return to the chat list. */
    fun closeDialog() {
        if (core.value.busy != null) return
        val dialog = core.value.dialog
        setDialog(null)
        when (dialog) {
            is ConnectionDialog.Report -> if (dialog.leaveAfter) leave(dialog.blockedProfileId)
            is ConnectionDialog.ReportTip -> if (dialog.leave) leave(dialog.blockedProfileId)
            is ConnectionDialog.ReportOffer -> leave(dialog.blockedProfileId)
            else -> Unit
        }
    }

    /** "Report" in the offer after ending: the report dialog, then back to the chat list. */
    fun acceptReportOffer() {
        val offer = core.value.dialog as? ConnectionDialog.ReportOffer ?: return
        setDialog(
            ConnectionDialog.Report(
                profileId = offer.profileId,
                name = offer.name,
                leaveAfter = true,
                blockedProfileId = offer.blockedProfileId,
            ),
        )
    }

    /** `POST /v1/reports` (13 section 6.4). */
    fun report(
        reason: String,
        details: String,
        alsoBlock: Boolean,
    ) {
        val dialog = core.value.dialog as? ConnectionDialog.Report ?: return
        val reportReason =
            ReportReason.entries.firstOrNull { it.wire == reason && it != ReportReason.UNKNOWN } ?: return
        if (core.value.busy != null) return
        setBusy(ConnectionAction.REPORT)
        viewModelScope.launch {
            tools.relations
                .report(
                    targetProfileId = dialog.profileId,
                    subject = if (dialog.messageId != null) ReportSubject.MESSAGE else ReportSubject.PROFILE,
                    reason = reportReason,
                    details = details,
                    alsoBlock = alsoBlock,
                    messageId = dialog.messageId,
                ).onSuccess {
                    val blocked = if (alsoBlock) dialog.profileId else dialog.blockedProfileId
                    // When the member was blocked, the client returns to the chat list (16 section 6.11).
                    val backToList = alsoBlock || dialog.leaveAfter
                    if (reportReason in TIP_REASONS) {
                        setDialog(ConnectionDialog.ReportTip(leave = backToList, blockedProfileId = blocked))
                    } else {
                        tools.bus.toast(R.string.shared_report_success)
                        setDialog(null)
                        if (backToList) leave(blocked)
                    }
                }.onFailure { failure ->
                    val error = failure.apiError
                    if (error.code == ErrorCode.LIMIT_REACHED) {
                        val email = tools.me.current
                            ?.config
                            ?.supportEmail
                            .orEmpty()
                        tools.bus.limit(UiText.of(R.string.shared_report_limit, "support_email" to email))
                    } else {
                        tools.bus.error(error)
                    }
                }
            setBusy(null)
        }
    }

    /** `PUT /v1/blocks/{profile_id}` after the confirmation, then back to the chat list (16 section 6.11). */
    fun block() {
        val dialog = core.value.dialog as? ConnectionDialog.Block ?: return
        if (core.value.busy != null) return
        setBusy(ConnectionAction.BLOCK)
        viewModelScope.launch {
            tools.relations
                .block(dialog.profileId)
                .onSuccess {
                    tools.bus.toast(R.string.shared_block_success)
                    setBusy(null)
                    setDialog(null)
                    leave(dialog.profileId)
                }.onFailure { tools.bus.error(it.apiError) }
            setBusy(null)
        }
    }

    /** `POST .../end` (16 section 6.12): then a report offer for inappropriate behaviour, or back to the list. */
    fun end(
        reason: MemberEndReason,
        alsoBlock: Boolean,
    ) {
        if (core.value.busy != null) return
        val other = core.value.connection?.other
        setBusy(ConnectionAction.END)
        viewModelScope.launch {
            own { connections.end(connectionId, reason, alsoBlock) }
                .onSuccess { connection ->
                    applyConnection(connection)
                    tools.bus.toast(R.string.chat_end_success)
                    val blocked = if (alsoBlock) other?.id else null
                    if (reason == MemberEndReason.INAPPROPRIATE_BEHAVIOUR && other != null) {
                        setDialog(ConnectionDialog.ReportOffer(other.id, other.displayName, blocked))
                    } else {
                        setDialog(null)
                        leave(blocked)
                    }
                }.onFailure { failure ->
                    val error = failure.apiError
                    if (error.code == ErrorCode.CONNECTION_ENDED) {
                        setDialog(null)
                        refreshConnection()
                    } else {
                        tools.bus.error(error)
                    }
                }
            setBusy(null)
        }
    }

    private companion object {
        const val OWN_CHANGE_WINDOW = 1_500L
        const val ISLAM = "islam"
        val TIP_REASONS = setOf(ReportReason.HARASSMENT, ReportReason.ASKING_FOR_MONEY)
    }
}

/**
 * Back to `APP-CHATS` after ending or blocking (16 sections 6.11 and 6.12): the chat screens leave
 * the current stack, and so does the profile of a member who was just blocked.
 */
internal fun AppNavigator.backToChats(blockedProfileId: String?) {
    popUntil { key ->
        val blockedProfile = blockedProfileId != null && key is Profile && key.profileId == blockedProfileId
        key !is Chat && key !is ConnectionDetails && !blockedProfile
    }
    openOnTab(Tab.CHATS, listOf(Chats))
}
