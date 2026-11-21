package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContactPhone
import androidx.compose.material.icons.outlined.FamilyRestroom
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.ContactShareStatus
import com.khandanirishta.app.core.network.generated.model.EndedBy
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.PreferredContact
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.SharedContact
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.Avatar
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.NoLongerAvailable
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.SectionCard
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text

/**
 * APP-CONNECTION: everything about one connection that is not the conversation (specs/16 section
 * 6.12): the member, the stage tracker and suggestions, both sides' contact details, chat
 * settings, help links, and ending, reporting or blocking. An ended connection shows when and why
 * it ended and keeps "Report" and "Block".
 */
@Composable
fun ConnectionScreen(
    connectionId: String,
    modifier: Modifier = Modifier,
) {
    val viewModel = hiltViewModel<ConnectionViewModel, ConnectionViewModel.Factory> { it.create(connectionId) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    // Back from `SET-CONTACTS` with a share in progress: the dialog opens again (08 section 3.5).
    LifecycleResumeEffect(viewModel) {
        viewModel.onResume()
        onPauseOrDispose { }
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
    Scaffold(
        modifier = modifier,
        topBar = {
            DetailTopBar(title = stringResource(R.string.chat_connection_title), onBack = { navigator.back() })
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                connection != null -> ConnectionContent(state = state, connection = connection, viewModel = viewModel)
                core.notFound -> NoLongerAvailable(onBack = { navigator.back() })
                core.error != null -> ErrorState(error = core.error, onRetry = { viewModel.retry() })
                else -> DetailsSkeleton()
            }
        }
    }
}

@Composable
private fun ConnectionContent(
    state: ConnectionUiState,
    connection: Connection,
    viewModel: ConnectionViewModel,
) {
    val me = LocalMe.current
    val navigator = LocalNavigator.current
    val links = rememberLinkOpener()
    val core = state.core
    val name = otherName(connection)
    val status = me?.profile?.status
    // Sharing contact details and the stage controls need `engage`; the rest only `connected`.
    val canEngage = status == ProfileStatus.ACTIVE || status == ProfileStatus.PAUSED
    val active = connection.status == ConnectionStatus.ACTIVE
    val online = core.online
    val other = connection.other

    // Only the screen on display claims a stage follow-up, so it never shows twice.
    LaunchedEffect(core.pendingFollowUp) {
        if (core.pendingFollowUp != null) viewModel.claimFollowUp()
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

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        MemberBlock(connection = connection, name = name, onViewProfile = { id -> navigator.push(Profile(id)) })
        if (active) {
            SectionCard(title = stringResource(R.string.chat_stage_title)) {
                StageTracker(stage = connection.stage, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
                StageControls(
                    connection = connection,
                    name = name,
                    canEngage = canEngage,
                    busy = core.busy,
                    online = online,
                    onAction = viewModel::stage,
                    onSuggest = { viewModel.openDialog(ConnectionDialog.SuggestStage) },
                )
            }
            MyContactCard(
                connection = connection,
                name = name,
                ownProfile = state.ownProfile,
                canEngage = canEngage,
                online = online,
                hint = state.shareHint,
                onShare = viewModel::openShare,
                onStop = { viewModel.openDialog(ConnectionDialog.StopSharing) },
                onDismissHint = viewModel::dismissShareHint,
            )
            TheirContactCard(connection = connection, name = name)
            SectionCard(title = stringResource(R.string.chat_connection_settings_title)) {
                SettingSwitch(
                    title = stringResource(R.string.chat_connection_settings_mute),
                    checked = connection.isMuted,
                    enabled = online,
                    onCheckedChange = viewModel::setMuted,
                )
                SettingSwitch(
                    title = stringResource(R.string.chat_connection_settings_archive),
                    checked = connection.isArchived,
                    enabled = online,
                    onCheckedChange = viewModel::setArchived,
                )
            }
        } else {
            EndedBlock(connection)
        }
        SectionCard(title = stringResource(R.string.chat_connection_help_title)) {
            LinkRow(
                icon = Icons.Outlined.HealthAndSafety,
                label = stringResource(R.string.chat_connection_help_safety),
                onClick = { links.webPage("safety") },
            )
            LinkRow(
                icon = Icons.AutoMirrored.Outlined.MenuBook,
                label = stringResource(R.string.chat_connection_help_nikah),
                onClick = { links.webPage("nikah-guide") },
            )
        }
        if (active || other != null) {
            DangerZone(
                active = active,
                hasOther = other != null,
                online = online,
                onEnd = { viewModel.openDialog(ConnectionDialog.End) },
                onReport = { viewModel.openReport() },
                onBlock = { viewModel.openBlock() },
            )
        }
    }

    val share = state.share
    if (share.open) {
        ContactShareDialog(
            name = name,
            profile = state.ownProfile,
            selection = share.selection,
            missing = share.missing,
            busy = core.busy == ConnectionAction.SHARE,
            online = online,
            onChange = viewModel::updateSelection,
            onAdd = { item, selection ->
                viewModel.rememberSelection(selection)
                navigator.push(ContactDetails(focus = item.focus, returnConnectionId = connection.id))
            },
            onShare = viewModel::share,
            onDismiss = viewModel::closeShare,
        )
    }
    when (core.dialog) {
        ConnectionDialog.StopSharing -> {
            ConfirmDialog(
                title = text(R.string.chat_connection_my_contact_stop_title, "name" to name),
                text = stringResource(R.string.chat_share_warning),
                confirmLabel = stringResource(R.string.chat_connection_my_contact_stop),
                onConfirm = viewModel::stopSharing,
                onDismiss = viewModel::closeDialog,
                destructive = true,
                busy = core.busy == ConnectionAction.STOP_SHARING,
            )
        }

        ConnectionDialog.SuggestStage -> {
            SuggestStageDialog(
                current = connection.stage,
                busy = core.busy == ConnectionAction.PROPOSE,
                online = online,
                onSuggest = { stage -> viewModel.stage(StageAction.Propose(stage)) },
                onDismiss = viewModel::closeDialog,
            )
        }

        else -> {}
    }
    ConnectionDialogs(core = core, name = name, canBlockOnEnd = other != null, actions = dialogActions)
}

/** Block 1: the compact card of the other member with "View profile", and "Connected since". */
@Composable
private fun MemberBlock(
    connection: Connection,
    name: String,
    onViewProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val me = LocalMe.current
    val other = connection.other
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (other != null) {
            ProfileRow(
                card = other,
                onOpen = { onViewProfile(other.id) },
                showRelation = false,
                actions = {
                    OutlinedButton(
                        onClick = { onViewProfile(other.id) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Outlined.Person, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.chat_connection_view_profile))
                    }
                },
            )
        } else {
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(
                        photo = null,
                        gender = otherGender(me?.profile?.gender),
                        contentDescription = null,
                        size = 56.dp,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(name, style = MaterialTheme.typography.titleMedium)
                }
            }
        }
        Text(
            text(R.string.chat_connection_connected_since, "date" to Formatters.longDate(connection.createdAt)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}

/** Block 3: the state of `my_contact_share`, and the "families_talking" suggestion once. */
@Composable
private fun MyContactCard(
    connection: Connection,
    name: String,
    ownProfile: OwnProfile?,
    canEngage: Boolean,
    online: Boolean,
    hint: Boolean,
    onShare: () -> Unit,
    onStop: () -> Unit,
    onDismissHint: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val share = connection.myContactShare?.takeIf { it.status == ContactShareStatus.ACTIVE }
    SectionCard(title = stringResource(R.string.chat_connection_my_contact_title), modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (hint && share == null && canEngage) {
                ShareHint(online = online, onShare = onShare, onDismiss = onDismissHint)
            }
            if (share != null) {
                Text(
                    stringResource(R.string.chat_connection_my_contact_sharing),
                    style = MaterialTheme.typography.bodyMedium,
                )
                ShareItem.entries.filter { share.isOn(it) }.forEach { item ->
                    val value = ownProfile?.contacts?.let { contactValue(it, item) }
                    LabelValue(label = stringResource(item.label), value = value.orEmpty())
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (canEngage) {
                        OutlinedButton(onClick = onShare, enabled = online) {
                            Text(stringResource(R.string.chat_connection_my_contact_change))
                        }
                    }
                    OutlinedButton(onClick = onStop, enabled = online) {
                        Text(stringResource(R.string.chat_connection_my_contact_stop))
                    }
                }
            } else {
                Text(
                    text(R.string.chat_connection_my_contact_none, "name" to name),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (canEngage) {
                    Button(onClick = onShare, enabled = online) {
                        Icon(Icons.Outlined.ContactPhone, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.chat_connection_my_contact_share))
                    }
                }
            }
        }
    }
}

/** "Families usually exchange contact details at this point." with "Share contact details". */
@Composable
private fun ShareHint(
    online: Boolean,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f),
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Box {
            Column(
                Modifier.padding(start = 14.dp, top = 12.dp, end = 48.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(verticalAlignment = Alignment.Top) {
                    Icon(
                        Icons.Outlined.FamilyRestroom,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(stringResource(R.string.chat_stage_share_hint), style = MaterialTheme.typography.bodyMedium)
                }
                Button(onClick = onShare, enabled = online) {
                    Text(stringResource(R.string.chat_connection_my_contact_share))
                }
            }
            IconButton(onClick = onDismiss, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = stringResource(R.string.chat_connection_my_contact_dismiss_hint),
                )
            }
        }
    }
}

/** Block 4: what the other member shared, with tap to call, WhatsApp or email (16 section 6.12). */
@Composable
private fun TheirContactCard(
    connection: Connection,
    name: String,
    modifier: Modifier = Modifier,
) {
    val contact = connection.theirContact
    SectionCard(title = stringResource(R.string.chat_connection_their_contact_title), modifier = modifier) {
        if (contact == null) {
            Text(
                text(R.string.chat_connection_their_contact_none, "name" to name),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            SharedContactRows(contact)
        }
    }
}

@Composable
private fun SharedContactRows(
    contact: SharedContact,
    modifier: Modifier = Modifier,
) {
    val links = rememberLinkOpener()
    val reference = LocalReference.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (contact.preferredContact == PreferredContact.GUARDIAN) {
            Text(
                stringResource(R.string.chat_connection_their_contact_guardian_first),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(bottom = 4.dp),
            )
        }
        contact.phoneE164?.let { phone ->
            val value = formatPhone(phone)
            ContactRow(
                icon = Icons.Outlined.Call,
                title = stringResource(R.string.chat_connection_their_contact_mobile),
                value = value,
                actionLabel = text(R.string.chat_connection_their_contact_call, "value" to value),
                onClick = { links.call(phone) },
            )
        }
        contact.whatsappE164?.let { phone ->
            val value = formatPhone(phone)
            ContactRow(
                icon = Icons.AutoMirrored.Outlined.Chat,
                title = stringResource(R.string.chat_connection_their_contact_whatsapp),
                value = value,
                actionLabel = text(R.string.chat_connection_their_contact_open_whatsapp, "value" to value),
                onClick = { links.whatsApp(phone) },
            )
        }
        contact.contactEmail?.let { email ->
            ContactRow(
                icon = Icons.Outlined.Mail,
                title = stringResource(R.string.chat_connection_their_contact_email),
                value = email,
                actionLabel = text(R.string.chat_connection_their_contact_send_email, "value" to email),
                onClick = { links.email(email, subject = "") },
            )
        }
        val guardian = contact.guardian
        if (guardian != null && (guardian.name != null || guardian.phoneE164 != null)) {
            val phone = guardian.phoneE164?.let(::formatPhone).orEmpty()
            val relation =
                guardian.relation
                    ?.let { reference.option(Lists.GUARDIAN_RELATION, it) }
                    ?.takeIf { it.isNotBlank() }
            val value =
                listOfNotNull(guardian.name, relation?.let { "($it)" }, phone.ifEmpty { null }).joinToString(" ")
            val guardianPhone = guardian.phoneE164
            ContactRow(
                icon = Icons.Outlined.FamilyRestroom,
                title = stringResource(R.string.chat_connection_their_contact_guardian),
                value = value,
                actionLabel = text(R.string.chat_connection_their_contact_call, "value" to phone),
                onClick = guardianPhone?.let { number -> { links.call(number) } },
            )
        }
        contact.bestTimeToCall?.takeIf { it.isNotBlank() }?.let { best ->
            Text(
                text(R.string.chat_connection_their_contact_best_time, "text" to best),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        Text(
            stringResource(R.string.chat_connection_their_contact_private),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

/** One shared detail; the whole row calls, opens WhatsApp or writes an email. */
@Composable
private fun ContactRow(
    icon: ImageVector,
    title: String,
    value: String,
    actionLabel: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(MaterialTheme.shapes.medium)
            .then(if (onClick != null) Modifier.clickable(onClickLabel = actionLabel, onClick = onClick) else Modifier)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
        if (onClick != null) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

@Composable
private fun LabelValue(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

/** A switch and its title as one touch target. */
@Composable
private fun SettingSwitch(
    title: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

@Composable
private fun LinkRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(MaterialTheme.shapes.medium)
            .clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.AutoMirrored.Outlined.OpenInNew,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(18.dp),
        )
    }
}

/** "This conversation ended on {date}." and, for the member who ended it, the reason given. */
@Composable
private fun EndedBlock(
    connection: Connection,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.LinkOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text(
                        R.string.chat_connection_ended_on,
                        "date" to Formatters.longDate(connection.endedAt ?: connection.createdAt),
                    ),
                    style = MaterialTheme.typography.bodyLarge,
                )
                val reason = connection.endedReason
                if (connection.endedBy == EndedBy.ME && reason != null) {
                    Text(
                        text(
                            R.string.chat_connection_ended_reason,
                            "reason" to reference.option(Lists.CONNECTION_END_REASON, reason),
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** Block 7: "End connection", "Report" and "Block". */
@Composable
private fun DangerZone(
    active: Boolean,
    hasOther: Boolean,
    online: Boolean,
    onEnd: () -> Unit,
    onReport: () -> Unit,
    onBlock: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val danger = MaterialTheme.colorScheme.error
    SectionCard(title = stringResource(R.string.chat_connection_actions_label), modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (active) {
                OutlinedButton(
                    onClick = onEnd,
                    enabled = online,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = danger),
                    border = BorderStroke(1.dp, danger.copy(alpha = 0.5f)),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Outlined.LinkOff, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.chat_chat_end))
                }
            }
            if (hasOther) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onReport, enabled = online, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Outlined.Flag, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.chat_chat_report))
                    }
                    OutlinedButton(onClick = onBlock, enabled = online, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Outlined.Block, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.chat_chat_block))
                    }
                }
            }
        }
    }
}

/** Skeleton blocks in the layout of the screen (rule G1). */
@Composable
private fun DetailsSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SKELETON_BLOCKS.forEach { blockHeight ->
            SkeletonBox(
                Modifier
                    .fillMaxWidth()
                    .height(blockHeight.dp),
                corner = 18.dp,
            )
        }
    }
}

private val SKELETON_BLOCKS = listOf(112, 168, 128, 96, 120)
