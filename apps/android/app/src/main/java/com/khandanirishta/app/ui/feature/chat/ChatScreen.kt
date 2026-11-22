package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.LastActive
import com.khandanirishta.app.core.network.generated.model.MessageKind
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.NoLongerAvailable
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.ConnectionDetails
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.activityLabel
import com.khandanirishta.app.ui.theme.RowShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * APP-CHAT: the conversation between two connected members (specs/16 section 6.11). A header with
 * presence and typing, the suggestion banner, the first-chat tips, the message list and the
 * composer; sending is optimistic with a client id, history pages with `before=`, and the chat
 * catches up after a reconnect and polls while the socket is down (22 section 7).
 *
 * ConversationHost is the stateful half of this screen. What is under it takes state and lambdas.
 */
@Suppress("ktlint:compose:vm-forwarding-check")
@Composable
fun ChatScreen(
    connectionId: String,
    viewModel: ChatViewModel = hiltViewModel<ChatViewModel, ChatViewModel.Factory> { it.create(connectionId) },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    LifecycleResumeEffect(viewModel) {
        viewModel.onResume()
        onPauseOrDispose { viewModel.onPause() }
    }
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is ConnectionEvent.Leave -> navigator.backToChats(event.blockedProfileId)
            }
        }
    }
    val core = state.core
    val connection = core.connection
    val back: () -> Unit = { navigator.back() }
    when {
        core.notFound -> {
            BareFrame(onBack = back) { NoLongerAvailable(onBack = back) }
        }

        connection != null -> {
            ConversationHost(state = state, connection = connection, viewModel = viewModel)
        }

        core.error != null -> {
            BareFrame(onBack = back) { ErrorState(error = core.error, onRetry = { viewModel.retry() }) }
        }

        else -> {
            ChatSkeleton(onBack = back)
        }
    }
}

/** The stateful half: navigation, the view model and the dialogs over the conversation. */
@Composable
private fun ConversationHost(
    state: ChatUiState,
    connection: Connection,
    viewModel: ChatViewModel,
) {
    val me = LocalMe.current
    val navigator = LocalNavigator.current
    val links = rememberLinkOpener()
    val composer = rememberTextFieldState()
    val core = state.core
    val current by rememberUpdatedState(connection)

    // Only the screen on display claims a stage follow-up, so it never shows twice.
    LaunchedEffect(core.pendingFollowUp) {
        if (core.pendingFollowUp != null) viewModel.claimFollowUp()
    }

    val header =
        remember(viewModel, navigator) {
            ChatHeaderActions(
                back = { navigator.back() },
                openDetails = { navigator.push(ConnectionDetails(viewModel.connectionId)) },
                viewProfile = { current.other?.let { navigator.push(Profile(it.id)) } },
                toggleMute = { viewModel.setMuted(!current.isMuted) },
                toggleArchive = { viewModel.setArchived(!current.isArchived) },
                safetyTips = { viewModel.openDialog(ConnectionDialog.SafetyTips) },
                report = { viewModel.openReport() },
                block = { viewModel.openBlock() },
                end = { viewModel.openDialog(ConnectionDialog.End) },
            )
        }
    val messages =
        remember(viewModel, composer, navigator) {
            MessageActions(
                retry = viewModel::retrySend,
                discard = viewModel::discard,
                remove = viewModel::askRemove,
                report = { item, reason -> viewModel.openReport(messageId = item.message.id, reason = reason) },
                copied = viewModel::onCopied,
                openDetails = { navigator.push(ConnectionDetails(viewModel.connectionId)) },
                loadOlder = viewModel::loadOlder,
                dismissTips = viewModel::dismissTips,
                starter = { text -> composer.setTextAndPlaceCursorAtEnd(text) },
                theirsVisible = viewModel::onTheirsVisible,
            )
        }
    val dialogActions =
        remember(viewModel, links) {
            ConnectionDialogActions(
                close = viewModel::closeDialog,
                report = viewModel::report,
                block = viewModel::block,
                end = viewModel::end,
                acceptReportOffer = viewModel::acceptReportOffer,
                pause = viewModel::pauseProfile,
                dismissFollowUp = viewModel::dismissFollowUp,
                announceStage = viewModel::announceStage,
                openNikahGuide = { links.webPage("nikah-guide") },
            )
        }

    Conversation(
        state = state,
        connection = connection,
        ownProfileId = me?.profile?.id.orEmpty(),
        ownStatus = me?.profile?.status,
        composer = composer,
        header = header,
        messages = messages,
        onStage = viewModel::stage,
        onRetryMessages = { viewModel.retryMessages() },
        onSend = { if (viewModel.send(composer.text.toString())) composer.clearText() },
        onTyping = viewModel::onTyping,
        onReopen = { navigator.push(AccountSettings) },
    )

    if (core.dialog is ConnectionDialog.RemoveMessage) {
        ConfirmDialog(
            title = stringResource(R.string.chat_message_remove_title),
            text = null,
            confirmLabel = stringResource(R.string.chat_message_remove_confirm),
            onConfirm = viewModel::removeMessage,
            onDismiss = viewModel::closeDialog,
            destructive = true,
            busy = core.busy == ConnectionAction.REMOVE_MESSAGE,
        )
    }
    ConnectionDialogs(
        core = core,
        name = otherName(connection),
        canBlockOnEnd = connection.other != null,
        actions = dialogActions,
    )
}

@Composable
internal fun Conversation(
    state: ChatUiState,
    connection: Connection,
    ownProfileId: String,
    ownStatus: ProfileStatus?,
    composer: TextFieldState,
    header: ChatHeaderActions,
    messages: MessageActions,
    onStage: (StageAction) -> Unit,
    onRetryMessages: () -> Unit,
    onSend: () -> Unit,
    onTyping: () -> Unit,
    onReopen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val core = state.core
    val chat = state.chat
    val listState = rememberLazyListState()
    val other = connection.other
    val name = otherName(connection)
    val active = connection.status == ConnectionStatus.ACTIVE
    val canEngage = ownStatus == ProfileStatus.ACTIVE || ownStatus == ProfileStatus.PAUSED
    val block =
        composerBlock(
            ended = connection.status == ConnectionStatus.ENDED,
            unavailable = other == null || chat.otherUnavailable,
            closed = ownStatus == ProfileStatus.CLOSED,
            offline = !core.online,
        )
    val loaded = !chat.messagesLoading && chat.messagesError == null
    val noTextYet = remember(chat.items) { chat.items.none { it.message.kind == MessageKind.TEXT } }
    val typing = chat.typing && active
    // A presence event wins over the `online` label of the last fetch (19 section 5).
    val shownOnline = chat.presence ?: (other?.lastActive == LastActive.ONLINE)
    val onlineNow = !typing && shownOnline
    val lastActive = other?.lastActive?.let { if (it == LastActive.ONLINE) LastActive.TODAY else it }
    val subtitle =
        when {
            typing -> stringResource(R.string.chat_chat_typing)
            onlineNow -> stringResource(R.string.chat_chat_online)
            else -> activityLabel(lastActive)?.let { stringResource(it) }
        }

    Scaffold(
        modifier = modifier,
        topBar = {
            ChatTopBar(
                connection = connection,
                name = name,
                subtitle = subtitle,
                onlineNow = onlineNow,
                typing = typing,
                online = core.online,
                actions = header,
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
        // The composer owns the bottom, so only the sides are left.
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal),
    ) { padding ->
        // The composer rides above the keyboard; with the reversed list the newest messages stay in view.
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding)
                .imePadding(),
        ) {
            ProposalBanner(
                connection = connection,
                name = name,
                canEngage = canEngage,
                busy = core.busy,
                online = core.online,
                onAction = onStage,
                modifier = Modifier.maxHeightShare(BANNER_SHARE),
            )
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                when {
                    chat.items.isEmpty() && chat.messagesLoading -> {
                        BubblesSkeleton()
                    }

                    chat.items.isEmpty() && chat.messagesError != null -> {
                        StateScreen { ErrorState(error = chat.messagesError, onRetry = onRetryMessages) }
                    }

                    else -> {
                        MessageList(
                            content = chat,
                            connection = connection,
                            ownProfileId = ownProfileId,
                            showStarters = loaded && noTextYet && block == null,
                            canRemove = active && canEngage,
                            listState = listState,
                            actions = messages,
                        )
                    }
                }
            }
            val barSize = Modifier.maxHeightShare(BAR_SHARE, atLeast = BarMinimum)
            if (block != null) {
                ComposerDisabled(reason = block, onReopen = onReopen, modifier = barSize)
            } else {
                Composer(
                    state = composer,
                    limitReached = chat.dailyLimitReached,
                    onSend = onSend,
                    onTyping = onTyping,
                    modifier = barSize,
                )
            }
        }
    }
}

/** A screen with only Back, for "no longer available" and the screen error. */
@Composable
private fun BareFrame(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { DetailTopBar(title = stringResource(R.string.chat_chats_title), onBack = onBack) },
    ) { padding ->
        StateScreen(Modifier.padding(padding).consumeWindowInsets(padding)) { content() }
    }
}

/** The header and the bubbles in their final shape (rule G1). */
@Composable
private fun ChatSkeleton(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { ChatTopBarSkeleton(onBack) },
    ) { padding ->
        BubblesSkeleton(Modifier.padding(padding).consumeWindowInsets(padding))
    }
}

@Composable
private fun BubblesSkeleton(modifier: Modifier = Modifier) {
    LoadingRegion(modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .contentWidth()
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s12, Alignment.Bottom),
        ) {
            SKELETON_BUBBLES.forEach { (share, mine) ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
                ) {
                    SkeletonBox(Modifier.fillMaxWidth(share).height(Sizes.touch), shape = RowShape)
                }
            }
        }
    }
}

private val SKELETON_BUBBLES = listOf(0.62f to false, 0.48f to true, 0.7f to false, 0.4f to true, 0.55f to false)
private const val BANNER_SHARE = 0.35f
private const val BAR_SHARE = 0.6f

// The bar's padding, the field at 56 and the system bar, so Send is never squeezed.
private val BarMinimum = 128.dp
