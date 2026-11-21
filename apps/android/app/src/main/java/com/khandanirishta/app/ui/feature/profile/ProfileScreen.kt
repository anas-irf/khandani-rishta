package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.CannotSendDetail
import com.khandanirishta.app.core.network.generated.model.CannotSendReason
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.PhotoVisibility
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.BlockDialog
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.NoLongerAvailable
import com.khandanirishta.app.ui.components.ReportDialog
import com.khandanirishta.app.ui.components.ShortlistHeart
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.ConnectionDetails
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.Interests
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.PhotoViewer
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text

/** APP-PROFILE: another member's full profile and the place where interest is expressed (16 section 6.7). */
@Composable
fun ProfileScreen(
    profileId: String,
    modifier: Modifier = Modifier,
) {
    val viewModel = hiltViewModel<ProfileViewModel, ProfileViewModel.Factory> { it.create(profileId) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val me = LocalMe.current
    viewModel.supportEmail = me?.config?.supportEmail.orEmpty()
    var showSend by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                ProfileEvent.Back -> navigator.back()
                is ProfileEvent.OpenChat -> navigator.push(Chat(event.connectionId))
                ProfileEvent.CloseSendDialog -> showSend = false
            }
        }
    }

    Box(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when {
            state.notFound -> {
                Column(Modifier.statusBarsPadding()) {
                    FloatingBack(onBack = { navigator.back() }, onPhoto = false)
                    NoLongerAvailable(
                        onBack = { navigator.back() },
                        title = stringResource(R.string.profile_load_not_found),
                    )
                }
            }

            state.statusPanel -> {
                Column(Modifier.statusBarsPadding()) {
                    FloatingBack(onBack = { navigator.back() }, onPhoto = false)
                    StatusGate(GateRouter.Level.BROWSE) { }
                }
            }

            state.detail != null -> {
                ProfileContent(state.detail!!, state, viewModel, onSend = { showSend = true })
            }

            state.error != null -> {
                Column(Modifier.statusBarsPadding()) {
                    FloatingBack(onBack = { navigator.back() }, onPhoto = false)
                    ErrorState(error = state.error, onRetry = { viewModel.load() })
                }
            }

            else -> {
                ProfileSkeleton(onBack = { navigator.back() })
            }
        }
    }

    if (state.viewLimit) {
        AlertDialog(
            onDismissRequest = { navigator.back() },
            title = { Text(stringResource(R.string.profile_load_view_limit_title)) },
            text = { Text(stringResource(R.string.profile_load_view_limit)) },
            confirmButton = {
                TextButton(
                    onClick = { navigator.back() },
                ) { Text(stringResource(R.string.profile_load_ok)) }
            },
        )
    }
    val detail = state.detail
    if (showSend && detail != null) {
        SendInterestDialog(
            name = detail.card.displayName,
            busy = state.busy,
            error = state.messageError?.resolve(LocalResources.current),
            onSend = viewModel::sendInterest,
            onDismiss = { showSend = false },
        )
    }
    state.mutualConnectionId?.let { connectionId ->
        AlertDialog(
            onDismissRequest = viewModel::dismissMutual,
            title = { Text(stringResource(R.string.profile_send_mutual_title)) },
            text = { Text(stringResource(R.string.profile_send_mutual_text)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.dismissMutual()
                    navigator.push(Chat(connectionId))
                }) { Text(stringResource(R.string.profile_send_start_chatting)) }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissMutual) { Text(stringResource(R.string.profile_send_later)) }
            },
        )
    }
    if (state.verifiedOnlyDialog) {
        AlertDialog(
            onDismissRequest = viewModel::dismissVerifiedOnly,
            text = { Text(stringResource(R.string.profile_cannot_send_verified_only)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.dismissVerifiedOnly()
                    navigator.push(Verification)
                }) { Text(stringResource(R.string.profile_send_verify_now)) }
            },
            dismissButton = {
                TextButton(
                    onClick = viewModel::dismissVerifiedOnly,
                ) { Text(stringResource(R.string.common_actions_cancel)) }
            },
        )
    }
    if (state.noteDialog && detail != null) {
        NoteDialog(
            name = detail.card.displayName,
            busy = state.busy,
            onSave = viewModel::saveNote,
            onDismiss = viewModel::closeNoteDialog,
        )
    }
    if (state.reportDone) {
        AlertDialog(
            onDismissRequest = viewModel::closeReportDone,
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.shared_report_success))
                    if (state.reportTip) {
                        Text(
                            stringResource(R.string.shared_report_safety_tip),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = viewModel::closeReportDone,
                ) { Text(stringResource(R.string.errors_limit_ok)) }
            },
        )
    }
}

@Composable
private fun ProfileContent(
    detail: ProfileDetail,
    state: ProfileUiState,
    viewModel: ProfileViewModel,
    onSend: () -> Unit,
) {
    val navigator = LocalNavigator.current
    val listState = rememberLazyListState()
    val solidBar by remember {
        derivedStateOf {
            listState.firstVisibleItemIndex > 0 ||
                listState.firstVisibleItemScrollOffset > 600
        }
    }
    var dialog by rememberSaveable { mutableStateOf<String?>(null) }
    val name = detail.card.displayName
    val reference = LocalReference.current

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(state = listState, modifier = Modifier.weight(1f)) {
                item(key = "body") {
                    ProfileDetailBody(
                        detail = detail,
                        onPhotoClick = { index -> navigator.push(PhotoViewer(detail.card.id, index)) },
                        onRequestPhotos = viewModel::requestPhotos,
                    )
                }
                item(key = "safety") {
                    SafetyFooter(onReport = { dialog = DIALOG_REPORT }, onBlock = { dialog = DIALOG_BLOCK })
                }
            }
            ActionBar(
                detail = detail,
                busy = state.busy,
                onSend = onSend,
                onAccept = viewModel::accept,
                onDecline = { dialog = DIALOG_DECLINE },
                onWithdraw = { dialog = DIALOG_WITHDRAW },
                onToggleShortlist = viewModel::toggleShortlist,
                onPass = {
                    dialog =
                        if (detail.relation.tier == Tier.INTEREST_TO_OWNER) DIALOG_PASS_INTEREST else DIALOG_PASS
                },
            )
        }
        TopOverlay(
            solid = solidBar,
            title = name,
            onBack = { navigator.back() },
            menu = { close ->
                if (detail.relation.tier == Tier.CONNECTION) {
                    MenuItem(stringResource(R.string.profile_actions_connection_details), Icons.Outlined.Info) {
                        close()
                        detail.relation.connectionId?.let { navigator.push(ConnectionDetails(it)) }
                    }
                }
                val related =
                    detail.relation.tier in setOf(Tier.CONNECTION, Tier.INTEREST_FROM_OWNER, Tier.INTEREST_TO_OWNER)
                if (related && state.ownPhotoVisibility != null &&
                    state.ownPhotoVisibility != PhotoVisibility.MEMBERS
                ) {
                    MenuItem(
                        text(R.string.profile_actions_let_see_photos, "name" to name),
                        Icons.Outlined.PhotoLibrary,
                    ) {
                        close()
                        viewModel.giveAccess()
                    }
                }
                if (detail.relation.tier == Tier.MEMBER) {
                    MenuItem(stringResource(R.string.profile_actions_not_interested), Icons.Outlined.VisibilityOff) {
                        close()
                        dialog = DIALOG_PASS
                    }
                }
                MenuItem(stringResource(R.string.profile_actions_report), Icons.Outlined.Flag) {
                    close()
                    dialog = DIALOG_REPORT
                }
                MenuItem(stringResource(R.string.profile_actions_block), Icons.Outlined.Block, destructive = true) {
                    close()
                    dialog = DIALOG_BLOCK
                }
            },
        )
    }

    when (dialog) {
        DIALOG_DECLINE -> {
            DeclineDialog(name = name, busy = state.busy, onConfirm = { block ->
                dialog = null
                viewModel.decline(block)
            }, onDismiss = { dialog = null })
        }

        DIALOG_WITHDRAW -> {
            ConfirmDialog(
                title = stringResource(R.string.profile_withdraw_title),
                text = stringResource(R.string.profile_withdraw_text),
                confirmLabel = stringResource(R.string.profile_withdraw_confirm),
                onConfirm = {
                    dialog = null
                    viewModel.withdraw()
                },
                onDismiss = { dialog = null },
                destructive = true,
            )
        }

        DIALOG_BLOCK -> {
            BlockDialog(name = name, onConfirm = {
                dialog = null
                viewModel.block()
            }, onDismiss = { dialog = null })
        }

        DIALOG_REPORT -> {
            ReportDialog(
                name = name,
                reasons = reference.options(Lists.REPORT_REASON),
                busy = state.busy,
                onSubmit = { reason, details, alsoBlock ->
                    dialog = null
                    viewModel.report(reason, details, alsoBlock)
                },
                onDismiss = { dialog = null },
            )
        }

        DIALOG_PASS -> {
            dialog = null
            viewModel.pass(withdrawFirst = false)
        }

        DIALOG_PASS_INTEREST -> {
            AlertDialog(
                onDismissRequest = { dialog = null },
                text = { Text(text(R.string.profile_pass_open_interest, "name" to name)) },
                confirmButton = {
                    TextButton(onClick = {
                        dialog = null
                        viewModel.pass(withdrawFirst = true)
                    }) { Text(stringResource(R.string.profile_pass_withdraw)) }
                },
                dismissButton = {
                    TextButton(onClick = {
                        dialog = null
                        viewModel.pass(withdrawFirst = false)
                    }) { Text(stringResource(R.string.profile_pass_keep)) }
                },
            )
        }
    }
}

/** The action bar of 16 section 6.7, decided by `relation` from top to bottom. */
@Composable
private fun ActionBar(
    detail: ProfileDetail,
    busy: Boolean,
    onSend: () -> Unit,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onWithdraw: () -> Unit,
    onToggleShortlist: () -> Unit,
    onPass: () -> Unit,
) {
    val navigator = LocalNavigator.current
    val relation = detail.relation
    val name = detail.card.displayName
    val me = LocalMe.current
    Surface(shadowElevation = 12.dp, color = MaterialTheme.colorScheme.surfaceContainerLowest) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (relation.tier == Tier.INTEREST_FROM_OWNER) {
                Text(text(R.string.profile_received_text, "name" to name), style = MaterialTheme.typography.titleSmall)
                relation.interest?.message?.let {
                    Text(
                        "“$it”",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                relation.interest?.expiresAt?.let {
                    Text(
                        text(R.string.profile_received_expires, "date" to Formatters.date(it)),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    relation.tier == Tier.CONNECTION -> {
                        PrimaryAction(
                            label = stringResource(R.string.profile_actions_open_chat),
                            onClick = { relation.connectionId?.let { navigator.push(Chat(it)) } },
                            modifier = Modifier.weight(1f),
                            icon = { Icon(Icons.AutoMirrored.Outlined.Chat, contentDescription = null) },
                        )
                    }

                    relation.tier == Tier.INTEREST_FROM_OWNER -> {
                        OutlinedButton(
                            onClick = onDecline,
                            enabled = !busy,
                            modifier = Modifier.heightIn(min = 52.dp),
                        ) {
                            Text(stringResource(R.string.profile_actions_decline))
                        }
                        PrimaryAction(
                            stringResource(R.string.profile_actions_accept),
                            onAccept,
                            Modifier.weight(1f),
                            busy = busy,
                        )
                    }

                    relation.tier == Tier.INTEREST_TO_OWNER -> {
                        PrimaryAction(
                            stringResource(R.string.profile_actions_interest_sent),
                            {},
                            Modifier.weight(1f),
                            enabled = false,
                        )
                        OutlinedButton(
                            onClick = onWithdraw,
                            enabled = !busy,
                            modifier = Modifier.heightIn(min = 52.dp),
                        ) {
                            Text(stringResource(R.string.profile_actions_withdraw))
                        }
                    }

                    relation.canSendInterest -> {
                        PrimaryAction(
                            label = stringResource(R.string.profile_actions_send_interest),
                            onClick = onSend,
                            modifier = Modifier.weight(1f),
                            busy = busy,
                            icon = { Icon(Icons.Filled.Favorite, contentDescription = null) },
                        )
                    }

                    else -> {
                        val label =
                            when (relation.cannotSendReason) {
                                CannotSendReason.ALREADY_PENDING -> R.string.profile_actions_interest_sent
                                CannotSendReason.ALREADY_CONNECTED -> R.string.profile_actions_connected
                                else -> R.string.profile_actions_send_interest
                            }
                        PrimaryAction(stringResource(label), {}, Modifier.weight(1f), enabled = false)
                    }
                }
                if (relation.tier != Tier.CONNECTION) {
                    ShortlistHeart(shortlisted = relation.isShortlisted, name = name, onToggle = onToggleShortlist)
                }
                if (relation.tier == Tier.MEMBER) {
                    IconButton(onClick = onPass, enabled = !busy) {
                        Icon(
                            Icons.Outlined.VisibilityOff,
                            contentDescription = stringResource(R.string.profile_actions_not_interested),
                        )
                    }
                }
            }
            if (relation.tier == Tier.MEMBER && !relation.canSendInterest) {
                CannotSendLine(detail, verified = me?.profile?.badges?.isNotEmpty() == true, onVerify = {
                    navigator.push(Verification)
                }, onViewSentInterests = {
                    navigator.openOnTab(Tab.INTERESTS, listOf(Interests("sent")))
                })
            }
        }
    }
}

@Composable
private fun CannotSendLine(
    detail: ProfileDetail,
    verified: Boolean,
    onVerify: () -> Unit,
    onViewSentInterests: () -> Unit,
) {
    val relation = detail.relation
    val (line, link) =
        when (relation.cannotSendReason) {
            CannotSendReason.COOLDOWN -> {
                text(
                    R.string.profile_cannot_send_cooldown,
                    "date" to (relation.canSendInterestAfter?.let { Formatters.date(it) } ?: ""),
                ) to null
            }

            CannotSendReason.DAILY_LIMIT -> {
                stringResource(R.string.profile_cannot_send_daily_limit) to
                    if (!verified) stringResource(R.string.profile_cannot_send_verify_more) to onVerify else null
            }

            CannotSendReason.PENDING_LIMIT -> {
                stringResource(R.string.profile_cannot_send_pending_limit) to
                    (stringResource(R.string.profile_cannot_send_view_sent) to onViewSentInterests)
            }

            CannotSendReason.CONNECTION_LIMIT -> {
                stringResource(R.string.profile_cannot_send_connection_limit) to null
            }

            CannotSendReason.NOT_PERMITTED_BY_MEMBER -> {
                if (relation.cannotSendDetail == CannotSendDetail.VERIFIED_ONLY) {
                    stringResource(R.string.profile_cannot_send_verified_only) to
                        (stringResource(R.string.profile_cannot_send_get_verified) to onVerify)
                } else {
                    stringResource(R.string.profile_cannot_send_preference_match) to null
                }
            }

            CannotSendReason.OWN_PROFILE_NOT_ACTIVE -> {
                stringResource(R.string.profile_cannot_send_own_profile_not_active) to
                    null
            }

            else -> {
                null to null
            }
        }
    if (line == null) return
    Column {
        Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (link != null) {
            TextButton(
                onClick = link.second,
                contentPadding = androidx.compose.foundation.layout
                    .PaddingValues(horizontal = 0.dp),
            ) {
                Text(link.first)
            }
        }
    }
}

@Composable
private fun PrimaryAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: (@Composable () -> Unit)? = null,
) {
    Button(onClick = onClick, enabled = enabled && !busy, modifier = modifier.heightIn(min = 52.dp)) {
        if (busy) {
            CircularProgressIndicator(
                Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            if (icon != null) {
                icon()
                Spacer(Modifier.width(8.dp))
            }
            Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The back arrow and menu over the gallery; solid once the gallery has scrolled away. */
@Composable
private fun TopOverlay(
    solid: Boolean,
    title: String,
    onBack: () -> Unit,
    menu: @Composable (close: () -> Unit) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Surface(
        color = if (solid) MaterialTheme.colorScheme.surfaceContainerLowest else Color.Transparent,
        shadowElevation = if (solid) 3.dp else 0.dp,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FloatingBack(onBack = onBack, onPhoto = !solid)
            Text(
                if (solid) title else "",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Box {
                IconButton(
                    onClick = { open = true },
                    colors =
                        IconButtonDefaults.iconButtonColors(
                            containerColor = if (solid) Color.Transparent else Color.Black.copy(alpha = 0.35f),
                            contentColor = if (solid) MaterialTheme.colorScheme.onSurface else Color.White,
                        ),
                ) {
                    Icon(
                        Icons.Outlined.MoreVert,
                        contentDescription = text(
                            R.string.profile_actions_menu,
                            "name" to title,
                        ),
                    )
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) { menu { open = false } }
            }
        }
    }
}

@Composable
private fun FloatingBack(
    onBack: () -> Unit,
    onPhoto: Boolean,
) {
    IconButton(
        onClick = onBack,
        colors =
            IconButtonDefaults.iconButtonColors(
                containerColor = if (onPhoto) Color.Black.copy(alpha = 0.35f) else Color.Transparent,
                contentColor = if (onPhoto) Color.White else MaterialTheme.colorScheme.onSurface,
            ),
    ) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.a11y_back)) }
}

@Composable
private fun MenuItem(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = {
            Text(
                label,
                color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
        },
        leadingIcon = {
            Icon(
                icon,
                contentDescription = null,
                tint = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        onClick = onClick,
    )
}

/** Block 12: report and block links, and the money warning. */
@Composable
private fun SafetyFooter(
    onReport: () -> Unit,
    onBlock: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onReport) {
                Text(stringResource(R.string.profile_safety_report), color = MaterialTheme.colorScheme.error)
            }
            TextButton(onClick = onBlock) {
                Text(stringResource(R.string.profile_safety_block), color = MaterialTheme.colorScheme.error)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Outlined.Shield,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                stringResource(R.string.profile_safety_money),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** "Send an interest to {name}" (16 section 6.7 send dialog). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SendInterestDialog(
    name: String,
    busy: Boolean,
    error: String?,
    onSend: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val me = LocalMe.current
    var message by rememberSaveable { mutableStateOf("") }
    val templates =
        buildList {
            add(R.string.profile_send_template_1)
            add(R.string.profile_send_template_2)
            if (me?.profile?.managedBy != null &&
                me.profile.managedBy != ManagedBy.SELF
            ) {
                add(R.string.profile_send_template_3)
            }
        }
    val templateTexts = templates.map { stringResource(it) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(text(R.string.profile_send_title, "name" to name)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                me?.usage?.let { usage ->
                    Text(
                        text(
                            R.string.profile_send_left,
                            "left" to (usage.interestsPerDay - usage.interestsSentToday).coerceAtLeast(0),
                            "total" to usage.interestsPerDay,
                        ),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
                Text(
                    stringResource(R.string.profile_send_templates_label),
                    style = MaterialTheme.typography.labelMedium,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    FilterChip(selected = message.isEmpty(), onClick = {
                        message = ""
                    }, label = { Text(stringResource(R.string.profile_send_template_none)) })
                    templateTexts.forEach { template ->
                        FilterChip(
                            selected = message == template,
                            onClick = { message = template },
                            label = {
                                Text(
                                    template,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.width(180.dp),
                                )
                            },
                        )
                    }
                }
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it.take(MESSAGE_MAX) },
                    label = { Text(stringResource(R.string.profile_send_message_label)) },
                    isError = error != null,
                    supportingText = {
                        Text(
                            error
                                ?: (
                                    stringResource(R.string.profile_send_helper) + "  " +
                                        text(
                                            R.string.profile_send_count,
                                            "count" to message.length,
                                            "max" to MESSAGE_MAX,
                                        )
                                ),
                        )
                    },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(onClick = { onSend(message) }, enabled = !busy) {
                if (busy) {
                    CircularProgressIndicator(
                        Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text(stringResource(R.string.profile_send_submit))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.common_actions_cancel)) }
        },
    )
}

@Composable
private fun DeclineDialog(
    name: String,
    busy: Boolean,
    onConfirm: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var block by rememberSaveable { mutableStateOf(false) }
    ConfirmDialog(
        title = stringResource(R.string.profile_decline_title),
        text = text(R.string.profile_decline_text, "name" to name),
        confirmLabel = stringResource(R.string.profile_decline_confirm),
        onConfirm = { onConfirm(block) },
        onDismiss = onDismiss,
        destructive = true,
        busy = busy,
        extra = {
            CheckboxRow(
                checked = block,
                onCheckedChange = { block = it },
                label = text(
                    R.string.profile_decline_also_block,
                    "name" to name,
                ),
            )
        },
    )
}

@Composable
private fun NoteDialog(
    name: String,
    busy: Boolean,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var note by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(text(R.string.discovery_shortlist_note_title, "name" to name)) },
        text = {
            OutlinedTextField(
                value = note,
                onValueChange = { note = it.take(NOTE_MAX) },
                label = { Text(stringResource(R.string.discovery_shortlist_note_label)) },
                supportingText = {
                    Text(
                        text(
                            R.string.discovery_shortlist_note_count,
                            "count" to note.length,
                            "max" to NOTE_MAX,
                        ),
                    )
                },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(note) },
                enabled = !busy,
            ) { Text(stringResource(R.string.common_actions_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_actions_cancel)) } },
    )
}

@Composable
private fun ProfileSkeleton(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Box {
            SkeletonBox(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(0.82f),
                corner = 0.dp,
            )
            Box(Modifier.statusBarsPadding().padding(8.dp)) { FloatingBack(onBack = onBack, onPhoto = true) }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SkeletonBox(Modifier.fillMaxWidth(0.6f).height(28.dp))
            SkeletonBox(Modifier.fillMaxWidth(0.4f).height(16.dp))
            repeat(3) { SkeletonBox(Modifier.fillMaxWidth().height(120.dp), corner = 18.dp) }
        }
    }
}

private const val DIALOG_DECLINE = "decline"
private const val DIALOG_WITHDRAW = "withdraw"
private const val DIALOG_BLOCK = "block"
private const val DIALOG_REPORT = "report"
private const val DIALOG_PASS = "pass"
private const val DIALOG_PASS_INTEREST = "pass_interest"
private const val MESSAGE_MAX = 300
private const val NOTE_MAX = 300
