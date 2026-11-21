package com.khandanirishta.app.ui.feature.chat

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.LastActive
import com.khandanirishta.app.core.network.generated.model.MessageKind
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.ui.components.Avatar
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.NoLongerAvailable
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.ConnectionDetails
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.activityLabel
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme

/**
 * APP-CHAT: the conversation between two connected members (specs/16 section 6.11). A header with
 * presence and typing, the suggestion banner, the first-chat tips, the message list and the
 * composer; sending is optimistic with a client id, history pages with `before=`, and the chat
 * catches up after a reconnect and polls while the socket is down (22 section 7).
 */
@Composable
fun ChatScreen(connectionId: String) {
    val viewModel = hiltViewModel<ChatViewModel, ChatViewModel.Factory> { it.create(connectionId) }
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
    val back = { navigator.back() }
    when {
        connection != null -> {
            Conversation(state = state, connection = connection, viewModel = viewModel)
        }

        core.notFound -> {
            BareFrame(onBack = back) { NoLongerAvailable(onBack = back) }
        }

        core.error != null -> {
            BareFrame(onBack = back) { ErrorState(error = core.error, onRetry = { viewModel.retry() }) }
        }

        else -> {
            ChatSkeleton(onBack = back)
        }
    }
}

@Composable
private fun Conversation(
    state: ChatUiState,
    connection: Connection,
    viewModel: ChatViewModel,
) {
    val me = LocalMe.current
    val navigator = LocalNavigator.current
    val links = rememberLinkOpener()
    val composer = rememberTextFieldState()
    val listState = rememberLazyListState()
    val core = state.core
    val chat = state.chat
    val other = connection.other
    val name = otherName(connection)
    val status = me?.profile?.status
    val canEngage = status == ProfileStatus.ACTIVE || status == ProfileStatus.PAUSED
    val active = connection.status == ConnectionStatus.ACTIVE
    val block =
        composerBlock(
            ended = connection.status == ConnectionStatus.ENDED,
            unavailable = other == null || chat.otherUnavailable,
            closed = status == ProfileStatus.CLOSED,
            offline = !core.online,
        )
    val loaded = !chat.messagesLoading && chat.messagesError == null
    val noTextYet = loaded && chat.items.none { it.message.kind == MessageKind.TEXT }
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

    // Only the screen on display claims a stage follow-up, so it never shows twice.
    LaunchedEffect(core.pendingFollowUp) {
        if (core.pendingFollowUp != null) viewModel.claimFollowUp()
    }

    val actions =
        remember(viewModel, composer) {
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

    Scaffold(
        topBar = {
            ChatTopBar(
                connection = connection,
                name = name,
                subtitle = subtitle,
                onlineNow = onlineNow,
                typing = typing,
                online = core.online,
                onBack = { navigator.back() },
                onOpenDetails = { navigator.push(ConnectionDetails(connection.id)) },
                onViewProfile = other?.let { card -> { navigator.push(Profile(card.id)) } },
                onToggleMute = { viewModel.setMuted(!connection.isMuted) },
                onToggleArchive = { viewModel.setArchived(!connection.isArchived) },
                onSafetyTips = { viewModel.openDialog(ConnectionDialog.SafetyTips) },
                onReport = { viewModel.openReport() },
                onBlock = { viewModel.openBlock() },
                onEnd = { viewModel.openDialog(ConnectionDialog.End) },
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
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
                onAction = viewModel::stage,
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
                        ErrorState(
                            error = chat.messagesError,
                            onRetry = viewModel::retryMessages,
                            modifier = Modifier.verticalScroll(rememberScrollState()),
                        )
                    }

                    else -> {
                        MessageList(
                            content = chat,
                            connection = connection,
                            ownProfileId = me?.profile?.id.orEmpty(),
                            showStarters = noTextYet && block == null,
                            canRemove = active && canEngage,
                            listState = listState,
                            actions = actions,
                        )
                    }
                }
            }
            if (block != null) {
                ComposerDisabled(reason = block, onReopen = { navigator.push(AccountSettings) })
            } else {
                Composer(
                    state = composer,
                    limitReached = chat.dailyLimitReached,
                    onSend = { if (viewModel.send(composer.text.toString())) composer.clearText() },
                    onTyping = viewModel::onTyping,
                )
            }
        }
    }

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
    ConnectionDialogs(core = core, name = name, canBlockOnEnd = other != null, actions = dialogActions)
}

/**
 * The header (16 section 6.11 block 1): photo, name, "Online now", the last active label or
 * "typing...", the stage chip; tapping it opens the connection details. The menu holds the
 * profile, the details, mute and archive, the safety tips, report, block and ending.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatTopBar(
    connection: Connection,
    name: String,
    subtitle: String?,
    onlineNow: Boolean,
    typing: Boolean,
    online: Boolean,
    onBack: () -> Unit,
    onOpenDetails: () -> Unit,
    onViewProfile: (() -> Unit)?,
    onToggleMute: () -> Unit,
    onToggleArchive: () -> Unit,
    onSafetyTips: () -> Unit,
    onReport: () -> Unit,
    onBlock: () -> Unit,
    onEnd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val me = LocalMe.current
    val other = connection.other
    val active = connection.status == ConnectionStatus.ACTIVE
    val stageShown = connection.stage != ConnectionStage.CHATTING && connection.stage != ConnectionStage.UNKNOWN
    val detailsLabel = text(R.string.chat_chat_open_details, "name" to name)
    var menuOpen by remember { mutableStateOf(false) }
    val close: (() -> Unit) -> () -> Unit = { action ->
        {
            menuOpen = false
            action()
        }
    }
    Column(modifier) {
        TopAppBar(
            title = {
                Row(
                    Modifier
                        .clip(MaterialTheme.shapes.medium)
                        .clickable(onClickLabel = detailsLabel, role = Role.Button, onClick = onOpenDetails)
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(
                        photo = other?.photo,
                        gender = other?.gender ?: otherGender(me?.profile?.gender),
                        contentDescription = null,
                        size = 40.dp,
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f, fill = false)) {
                        Text(
                            name,
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (subtitle != null || stageShown) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (onlineNow) {
                                    Box(
                                        Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(KrTheme.colors.online),
                                    )
                                    Spacer(Modifier.width(5.dp))
                                }
                                if (subtitle != null) {
                                    Text(
                                        subtitle,
                                        style = MaterialTheme.typography.bodySmall,
                                        color =
                                            if (typing) {
                                                MaterialTheme.colorScheme.primary
                                            } else {
                                                MaterialTheme.colorScheme.onSurfaceVariant
                                            },
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f, fill = false),
                                    )
                                }
                                if (stageShown) {
                                    if (subtitle != null) Spacer(Modifier.width(8.dp))
                                    StageChip(
                                        text = stringResource(stageLabel(connection.stage)),
                                        modifier = Modifier.weight(1f, fill = false),
                                    )
                                }
                            }
                        }
                    }
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.a11y_back))
                }
            },
            actions = {
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = stringResource(R.string.chat_chat_menu))
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        if (onViewProfile != null) {
                            MenuEntry(R.string.chat_chat_view_profile, Icons.Outlined.Person, close(onViewProfile))
                        }
                        MenuEntry(R.string.chat_chat_details, Icons.Outlined.Info, close(onOpenDetails))
                        if (active) {
                            val muted = connection.isMuted
                            MenuEntry(
                                if (muted) R.string.chat_chat_unmute else R.string.chat_chat_mute,
                                if (muted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff,
                                close(onToggleMute),
                                enabled = online,
                            )
                            MenuEntry(
                                if (connection.isArchived) R.string.chat_chat_unarchive else R.string.chat_chat_archive,
                                if (connection.isArchived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                                close(onToggleArchive),
                                enabled = online,
                            )
                        }
                        MenuEntry(R.string.chat_chat_safety_tips, Icons.Outlined.HealthAndSafety, close(onSafetyTips))
                        if (other != null || active) HorizontalDivider()
                        if (other != null) {
                            MenuEntry(R.string.chat_chat_report, Icons.Outlined.Flag, close(onReport))
                            MenuEntry(R.string.chat_chat_block, Icons.Outlined.Block, close(onBlock))
                        }
                        if (active) {
                            MenuEntry(R.string.chat_chat_end, Icons.Outlined.LinkOff, close(onEnd), destructive = true)
                        }
                    }
                }
            },
            colors =
                TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
                ),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable
private fun MenuEntry(
    @StringRes label: Int,
    icon: ImageVector,
    onClick: () -> Unit,
    enabled: Boolean = true,
    destructive: Boolean = false,
) {
    val colors =
        if (destructive) {
            MenuDefaults.itemColors(
                textColor = MaterialTheme.colorScheme.error,
                leadingIconColor = MaterialTheme.colorScheme.error,
            )
        } else {
            MenuDefaults.itemColors()
        }
    DropdownMenuItem(
        text = { Text(stringResource(label)) },
        onClick = onClick,
        leadingIcon = { Icon(icon, contentDescription = null) },
        enabled = enabled,
        colors = colors,
    )
}

@Composable
private fun StageChip(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shape = CircleShape,
        modifier = modifier,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

/** A screen with only a back arrow, for "no longer available" and the screen error. */
@Composable
private fun BareFrame(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Scaffold(modifier = modifier, topBar = { DetailTopBar(title = "", onBack = onBack) }) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) { content() }
    }
}

/** Skeleton of the header and of the bubbles (rule G1). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatSkeleton(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SkeletonBox(Modifier.size(40.dp), corner = 20.dp)
                        Spacer(Modifier.width(10.dp))
                        SkeletonBox(
                            Modifier
                                .width(140.dp)
                                .height(18.dp),
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.a11y_back),
                        )
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
                    ),
            )
        },
    ) { padding -> BubblesSkeleton(Modifier.padding(padding)) }
}

@Composable
private fun BubblesSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Bottom),
    ) {
        SKELETON_BUBBLES.forEach { (fraction, mine) ->
            Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
                SkeletonBox(
                    Modifier
                        .fillMaxWidth(fraction)
                        .height(44.dp),
                    corner = 18.dp,
                )
            }
        }
    }
}

private val SKELETON_BUBBLES =
    listOf(0.62f to false, 0.48f to true, 0.7f to false, 0.4f to true, 0.55f to false, 0.35f to true)
