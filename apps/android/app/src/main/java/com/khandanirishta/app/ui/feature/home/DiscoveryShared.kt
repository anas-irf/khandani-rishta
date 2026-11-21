package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
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
import com.khandanirishta.app.core.network.generated.model.RelaxationHint
import com.khandanirishta.app.ui.components.StatusPanel
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.Search
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.dimensionText
import com.khandanirishta.app.ui.text.text
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The card actions shared by every list of members (specs/16 section 6.4): the shortlist heart and
 * "Not interested", both optimistic (rule G7). The caller owns the list and passes how to change it.
 */
class CardActions
    @Inject
    constructor(
        private val relations: RelationRepository,
        private val bus: MessageBus,
    ) {
        /** Shortlist changes saved anywhere in the app, for keeping card hearts in step. */
        val shortlistChanges: SharedFlow<ShortlistChange> get() = relations.shortlistChanges

        /** Toggles the heart: [apply] flips it at once and [revert] undoes it on failure. */
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
                    bus.toast(R.string.discovery_shortlist_failed)
                }
            }
        }

        /** "Not interested": the card leaves at once; "Hidden. Undo" stays 5 seconds. */
        suspend fun pass(
            card: ProfileCard,
            remove: () -> Unit,
            restore: () -> Unit,
            message: UiText = UiText.of(R.string.discovery_card_hidden),
            onUndo: suspend () -> Unit = {},
            launchUndo: (suspend () -> Unit) -> Unit,
        ) {
            remove()
            bus.toast(message, UiText.of(R.string.discovery_card_undo)) {
                launchUndo {
                    relations.undoPass(card.id).onSuccess { onUndo() }
                    restore()
                }
            }
            relations.pass(card.id).onFailure {
                restore()
                bus.error(it.apiError)
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
        onReopen = {
            navigator.openOnTab(
                Tab.ME,
                listOf(com.khandanirishta.app.ui.navigation.Settings, AccountSettings),
            )
        },
        busy = busy,
    )
}

/**
 * The exhausted pool (16 section 6.4, 10 section 8.7): the headline, one line per relaxation hint,
 * "Review preferences", and "Search" when there is nothing to show.
 */
@Composable
fun ExhaustedNotice(
    empty: Boolean,
    hints: List<RelaxationHint>,
    modifier: Modifier = Modifier,
) {
    val navigator = LocalNavigator.current
    val headline =
        if (empty) R.string.discovery_matches_state_exhausted_empty else R.string.discovery_matches_state_exhausted_end
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    Modifier
                        .size(40.dp)
                        .padding(2.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Outlined.Tune,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(headline), style = MaterialTheme.typography.titleSmall)
                    hints.take(2).forEach { hint ->
                        Text(
                            text(
                                R.string.discovery_matches_state_hint,
                                "dimension" to dimensionText(hint.dimension),
                                "count" to hint.extraProfiles,
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { navigator.openOnTab(Tab.ME, listOf(MyPreferences)) }) {
                    Text(stringResource(R.string.discovery_matches_state_review_preferences))
                }
                if (empty) {
                    OutlinedButton(onClick = { navigator.openOnTab(Tab.SEARCH, listOf(Search())) }) {
                        Text(stringResource(R.string.discovery_matches_state_search))
                    }
                }
            }
        }
    }
}
