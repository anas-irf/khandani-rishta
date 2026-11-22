package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContactPhone
import androidx.compose.material.icons.outlined.FamilyRestroom
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ContactShareStatus
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.PreferredContact
import com.khandanirishta.app.core.network.generated.model.SharedContact
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.InfoRow
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SectionCard
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** Block 3 of 16 section 6.12: the state of `my_contact_share`, and the "families_talking" suggestion once. */
@Composable
internal fun MyContactSection(
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
    val hinted = hint && share == null && canEngage
    SectionCard(title = stringResource(R.string.chat_connection_my_contact_title), modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            if (hinted) ShareHint(online = online, onShare = onShare, onDismiss = onDismissHint)
            if (share != null) {
                Text(stringResource(R.string.chat_connection_my_contact_sharing))
                val shared = ShareItem.entries.filter { share.isOn(it) }
                Column(Modifier.fillMaxWidth()) {
                    shared.forEach { item ->
                        val label = stringResource(item.label)
                        // Empty until the own profile is known, which may fail: it is no skeleton without an end.
                        InfoRow(label, ownProfile?.let { contactValue(it.contacts, item) }.orEmpty())
                    }
                }
                AdaptiveRow(Modifier.fillMaxWidth()) {
                    if (canEngage) {
                        KrButton(
                            text = stringResource(R.string.chat_connection_my_contact_change),
                            onClick = onShare,
                            variant = KrButtonVariant.SECONDARY,
                            enabled = online,
                            modifier = Modifier.grow(),
                        )
                    }
                    KrButton(
                        text = stringResource(R.string.chat_connection_my_contact_stop),
                        onClick = onStop,
                        variant = KrButtonVariant.SECONDARY,
                        enabled = online,
                        modifier = Modifier.grow(),
                    )
                }
            } else {
                Text(text(R.string.chat_connection_my_contact_none, "name" to name))
                if (canEngage) {
                    KrButton(
                        text = stringResource(R.string.chat_connection_my_contact_share),
                        onClick = onShare,
                        // One primary in the area: the suggestion above has it while it shows.
                        variant = if (hinted) KrButtonVariant.SECONDARY else KrButtonVariant.PRIMARY,
                        size = KrButtonSize.LARGE,
                        icon = Icons.Outlined.ContactPhone,
                        enabled = online,
                    )
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
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        color = colors.primaryContainer,
        contentColor = colors.onSurface,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = Spacing.s16, top = Spacing.s4, end = Spacing.s4, bottom = Spacing.s16)) {
            Row {
                IconText(
                    icon = Icons.Outlined.FamilyRestroom,
                    text = stringResource(R.string.chat_stage_share_hint),
                    tint = colors.primary,
                    modifier =
                        Modifier
                            .weight(1f)
                            .padding(vertical = Spacing.s12),
                )
                KrIconButton(
                    icon = Icons.Outlined.Close,
                    contentDescription = stringResource(R.string.chat_connection_my_contact_dismiss_hint),
                    onClick = onDismiss,
                )
            }
            KrButton(
                text = stringResource(R.string.chat_connection_my_contact_share),
                onClick = onShare,
                enabled = online,
                modifier = Modifier.padding(end = Spacing.s12),
            )
        }
    }
}

/** Block 4 of 16 section 6.12: what the other member shared, with tap to call, WhatsApp or email. */
@Composable
internal fun TheirContactSection(
    connection: Connection,
    name: String,
    onCall: (String) -> Unit,
    onWhatsApp: (String) -> Unit,
    onEmail: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val contact = connection.theirContact
    SectionCard(title = stringResource(R.string.chat_connection_their_contact_title), modifier = modifier) {
        if (contact == null) {
            Text(text(R.string.chat_connection_their_contact_none, "name" to name))
        } else {
            SharedContactRows(contact = contact, onCall = onCall, onWhatsApp = onWhatsApp, onEmail = onEmail)
        }
    }
}

@Composable
private fun SharedContactRows(
    contact: SharedContact,
    onCall: (String) -> Unit,
    onWhatsApp: (String) -> Unit,
    onEmail: (String) -> Unit,
) {
    val reference = LocalReference.current
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        if (contact.preferredContact == PreferredContact.GUARDIAN) {
            IconText(
                icon = Icons.Outlined.FamilyRestroom,
                text = stringResource(R.string.chat_connection_their_contact_guardian_first),
                style = MaterialTheme.typography.titleSmall,
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Column(Modifier.fillMaxWidth()) {
            contact.phoneE164?.let { phone ->
                val value = displayPhone(phone)
                ContactRow(
                    icon = Icons.Outlined.Call,
                    title = stringResource(R.string.chat_connection_their_contact_mobile),
                    value = value,
                    actionLabel = text(R.string.chat_connection_their_contact_call, "value" to value),
                    onClick = { onCall(phone) },
                )
            }
            contact.whatsappE164?.let { phone ->
                val value = displayPhone(phone)
                ContactRow(
                    icon = Icons.AutoMirrored.Outlined.Chat,
                    title = stringResource(R.string.chat_connection_their_contact_whatsapp),
                    value = value,
                    actionLabel = text(R.string.chat_connection_their_contact_open_whatsapp, "value" to value),
                    onClick = { onWhatsApp(phone) },
                )
            }
            contact.contactEmail?.let { email ->
                val value = leftToRight(email)
                ContactRow(
                    icon = Icons.Outlined.Mail,
                    title = stringResource(R.string.chat_connection_their_contact_email),
                    value = value,
                    actionLabel = text(R.string.chat_connection_their_contact_send_email, "value" to value),
                    onClick = { onEmail(email) },
                )
            }
            val guardian = contact.guardian
            if (guardian != null && (guardian.name != null || guardian.phoneE164 != null)) {
                val phone = guardian.phoneE164?.let(::displayPhone).orEmpty()
                val relation =
                    guardian.relation
                        ?.let { reference.option(Lists.GUARDIAN_RELATION, it) }
                        ?.takeIf { it.isNotBlank() }
                val value =
                    listOfNotNull(guardian.name, relation?.let { "($it)" }, phone.ifEmpty { null }).joinToString(" ")
                val guardianPhone = guardian.phoneE164
                ContactRow(
                    icon = Icons.Outlined.Call,
                    title = stringResource(R.string.chat_connection_their_contact_guardian),
                    value = value,
                    actionLabel = text(R.string.chat_connection_their_contact_call, "value" to phone),
                    onClick = guardianPhone?.let { number -> { onCall(number) } },
                )
            }
        }
        contact.bestTimeToCall?.takeIf { it.isNotBlank() }?.let { best ->
            MemberText(
                text = text(R.string.chat_connection_their_contact_best_time, "text" to best),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        CaptionText(stringResource(R.string.chat_connection_their_contact_private))
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
) {
    val action =
        if (onClick == null) {
            Modifier.semantics(mergeDescendants = true) {}
        } else {
            Modifier.tappable(shape = MaterialTheme.shapes.small, onClick = onClick, onClickLabel = actionLabel)
        }
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .then(action)
                    .heightIn(min = Sizes.touchLarge)
                    .padding(vertical = Spacing.s12),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                MemberText(value, style = MaterialTheme.typography.titleSmall)
            }
            if (onClick != null) ArchIcon(icon, size = Sizes.archIconSmall, tone = ArchTone.PRIMARY)
        }
        RowDivider()
    }
}
