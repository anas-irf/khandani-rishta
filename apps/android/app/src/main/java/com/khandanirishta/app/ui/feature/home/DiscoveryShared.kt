package com.khandanirishta.app.ui.feature.home

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.RelationRepository
import com.khandanirishta.app.core.data.ShortlistChange
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.components.StatusPanel
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Settings
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.LocalMe
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * The card actions shared by every list of members (specs/16 section 6.4): Shortlist and
 * "Not interested", both optimistic (rule G7). The caller owns the list and passes how to change it.
 */
class CardActions
    @Inject
    constructor(
        private val relations: RelationRepository,
        private val bus: MessageBus,
    ) {
        /** One at a time and in order, so an Undo never reaches the API before its pass. */
        private val passCalls = Mutex()

        /** Shortlist changes saved anywhere in the app, for keeping cards in step. */
        val shortlistChanges: SharedFlow<ShortlistChange> get() = relations.shortlistChanges

        /** Toggles Shortlist: [apply] flips it at once, and again on failure. */
        suspend fun toggleShortlist(
            card: ProfileCard,
            apply: (Boolean) -> Unit,
        ) {
            val target = !card.relation.isShortlisted
            apply(target)
            val result = if (target) relations.addToShortlist(card.id) else relations.removeFromShortlist(card.id)
            result.onFailure { error ->
                apply(!target)
                if (error.apiError.code == ErrorCode.LIMIT_REACHED) {
                    bus.toast(R.string.shared_shortlist_full)
                } else {
                    bus.toast(R.string.shared_shortlist_failed)
                }
            }
        }

        /**
         * "Not interested". The caller has already put the panel in the card's place, and takes it
         * away again in [onFailure]. It finishes even when the member leaves the screen at once.
         */
        suspend fun pass(
            id: String,
            onFailure: () -> Unit,
        ) {
            withContext(NonCancellable) {
                passCalls
                    .withLock { relations.pass(id) }
                    .onFailure {
                        onFailure()
                        bus.error(it.apiError)
                    }
            }
        }

        /** "Undo" of the panel. The caller has already shown the card again. */
        suspend fun undoPass(
            id: String,
            onFailure: () -> Unit,
        ) {
            withContext(NonCancellable) {
                passCalls
                    .withLock { relations.undoPass(id) }
                    .onFailure {
                        onFailure()
                        bus.error(it.apiError)
                    }
            }
        }
    }

/** Sets `is_shortlisted` on a card. */
fun ProfileCard.withShortlist(value: Boolean): ProfileCard = copy(relation = relation.copy(isShortlisted = value))

/** The view model behind [StatusGate]: resuming a paused profile from the status panel. */
@HiltViewModel
class StatusGateViewModel
    @Inject
    constructor(
        private val me: MeRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableBusy = MutableStateFlow(false)
        val busy: StateFlow<Boolean> = mutableBusy.asStateFlow()

        fun resume() {
            if (mutableBusy.value) return
            mutableBusy.value = true
            viewModelScope.launch {
                me.resume().onFailure { bus.error(it.apiError) }
                mutableBusy.value = false
            }
        }
    }

/**
 * Shows the status panel instead of [content] when the own profile status refuses [level]
 * (specs/16 section 1.4, specs/17 section 4.3).
 */
@Composable
fun StatusGate(
    level: GateRouter.Level,
    viewModel: StatusGateViewModel = hiltViewModel(),
    content: @Composable () -> Unit,
) {
    val status = LocalMe.current?.profile?.status ?: ProfileStatus.ACTIVE
    val panel = GateRouter.statusPanel(status, level)
    if (panel == null) {
        content()
        return
    }
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    StatusPanel(
        status = panel,
        onResume = viewModel::resume,
        onReopen = { navigator.openOnTab(Tab.ME, listOf(Settings, AccountSettings)) },
        busy = busy,
    )
}
