package com.khandanirishta.app.ui.feature.chat

import android.content.res.Resources
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.ConnectionStatus
import com.khandanirishta.app.core.network.generated.model.ContactShare
import com.khandanirishta.app.core.network.generated.model.ContactShareBody
import com.khandanirishta.app.core.network.generated.model.ContactShareStatus
import com.khandanirishta.app.core.network.generated.model.ContactsSection
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MemberEndReason
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.PreferredContact
import com.khandanirishta.app.core.network.generated.model.ProposableStage
import com.khandanirishta.app.core.network.generated.model.SystemEvent
import com.khandanirishta.app.ui.text.stageLabel
import com.khandanirishta.app.ui.text.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import java.time.Duration
import java.time.Instant

/*
 * Wording and small rules shared by the chat list, the conversation and the connection details,
 * ported from the web's features/chat/text.ts and ContactShareDialog.tsx.
 */

/** Messages are at most 2,000 characters (specs/11 section 6.2). */
internal const val MESSAGE_MAX_LENGTH = 2000

/** The character counter appears from 1,800 characters (specs/16 section 6.11). */
internal const val COUNTER_FROM = 1800

/** Own messages can be removed for 15 minutes (specs/11 section 6.7). */
internal val REMOVE_WINDOW: Duration = Duration.ofMinutes(15)

private val QUIET_AFTER: Duration = Duration.ofDays(7)

/** The four stages in order, as the tracker shows them (specs/11 section 9.1). */
internal val TRACKER_STAGES =
    listOf(
        ConnectionStage.CHATTING,
        ConnectionStage.FAMILIES_TALKING,
        ConnectionStage.ENGAGED,
        ConnectionStage.NIKAH_DONE,
    )

/** The place of a stage in the order; an unknown stage sorts first. Stages only move forward. */
internal fun ConnectionStage.order(): Int =
    when (this) {
        ConnectionStage.CHATTING -> 0
        ConnectionStage.FAMILIES_TALKING -> 1
        ConnectionStage.ENGAGED -> 2
        ConnectionStage.NIKAH_DONE -> 3
        ConnectionStage.UNKNOWN -> -1
    }

internal fun ProposableStage.toStage(): ConnectionStage =
    when (this) {
        ProposableStage.FAMILIES_TALKING -> ConnectionStage.FAMILIES_TALKING
        ProposableStage.ENGAGED -> ConnectionStage.ENGAGED
        ProposableStage.NIKAH_DONE -> ConnectionStage.NIKAH_DONE
        ProposableStage.UNKNOWN -> ConnectionStage.UNKNOWN
    }

/** The stages a member may suggest from [current]: every later one, skipping allowed (11 section 9.2). */
internal fun laterStages(current: ConnectionStage): List<ProposableStage> =
    listOf(ProposableStage.FAMILIES_TALKING, ProposableStage.ENGAGED, ProposableStage.NIKAH_DONE)
        .filter { it.toStage().order() > current.order() }

/** The line of explanation in the stage choice (specs/16 section 6.12). */
@StringRes
internal fun stageExplanation(stage: ProposableStage): Int =
    when (stage) {
        ProposableStage.ENGAGED -> R.string.chat_stage_explain_engaged
        ProposableStage.NIKAH_DONE -> R.string.chat_stage_explain_nikah_done
        ProposableStage.FAMILIES_TALKING, ProposableStage.UNKNOWN -> R.string.chat_stage_explain_families_talking
    }

/** The other member's name, or "Member no longer available" when `other` is null (15 section 4.7). */
@Composable
internal fun otherName(connection: Connection): String =
    connection.other?.displayName ?: stringResource(R.string.chat_member_unavailable)

/** The neutral avatar when `other` is null: the opposite gender of the member's own profile. */
internal fun otherGender(own: Gender?): Gender = if (own == Gender.MALE) Gender.FEMALE else Gender.MALE

/**
 * The text of a system message (specs/11 section 6.8): the "You" wording when the member is the
 * actor, otherwise the "They" wording with [name]. Unknown events give `null` and are not shown.
 */
internal fun systemText(
    res: Resources,
    message: Message,
    ownProfileId: String,
    name: String,
): String? {
    val event = message.systemEvent ?: return null
    val data = message.systemData
    val mine = data.string("actor_profile_id") == ownProfileId
    val stage = data.string("stage")?.let { res.getString(stageLabel(it)) }.orEmpty()
    val cancelled = (data?.get("cancelled") as? JsonPrimitive)?.booleanOrNull == true
    val id =
        when (event) {
            SystemEvent.CONNECTED -> {
                pick(mine, R.string.chat_system_connected_me, R.string.chat_system_connected_them)
            }

            SystemEvent.CONTACT_SHARED -> {
                pick(mine, R.string.chat_system_contact_shared_me, R.string.chat_system_contact_shared_them)
            }

            SystemEvent.CONTACT_SHARE_REVOKED -> {
                pick(
                    mine,
                    R.string.chat_system_contact_share_revoked_me,
                    R.string.chat_system_contact_share_revoked_them,
                )
            }

            SystemEvent.STAGE_PROPOSED -> {
                pick(mine, R.string.chat_system_stage_proposed_me, R.string.chat_system_stage_proposed_them)
            }

            SystemEvent.STAGE_CONFIRMED -> {
                pick(mine, R.string.chat_system_stage_confirmed_me, R.string.chat_system_stage_confirmed_them)
            }

            SystemEvent.STAGE_DECLINED -> {
                if (cancelled) {
                    pick(mine, R.string.chat_system_stage_cancelled_me, R.string.chat_system_stage_cancelled_them)
                } else {
                    pick(mine, R.string.chat_system_stage_declined_me, R.string.chat_system_stage_declined_them)
                }
            }

            SystemEvent.CONNECTION_ENDED -> {
                R.string.chat_system_connection_ended
            }

            SystemEvent.UNKNOWN -> {
                return null
            }
        }
    return res.text(id, "name" to name, "stage" to stage)
}

@StringRes
private fun pick(
    mine: Boolean,
    @StringRes me: Int,
    @StringRes them: Int,
): Int = if (mine) me else them

/** Whether a system line names the member as its actor (the contact-shared line links only for them). */
internal fun Message.actorIs(profileId: String): Boolean = systemData.string("actor_profile_id") == profileId

private fun JsonObject?.string(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

/** "Say salaam" when only the `connected` line exists (specs/11 section 5.1, 16 section 6.10). */
internal fun hasNoTextMessages(connection: Connection): Boolean {
    val last = connection.lastMessageAt ?: return true
    return Duration.between(connection.createdAt, last).toMillis() < 1000
}

/** The quiet-chat hint, computed on the client (specs/11 section 6.10). */
internal fun isQuiet(
    connection: Connection,
    now: Instant = Instant.now(),
): Boolean {
    if (connection.status != ConnectionStatus.ACTIVE || connection.stage != ConnectionStage.CHATTING) return false
    val last = connection.lastMessageAt ?: connection.createdAt
    return Duration.between(last, now) > QUIET_AFTER
}

private val PK_MOBILE = Regex("^\\+92(\\d{3})(\\d{7})$")

/** "+92 300 1234567" for a Pakistani mobile number, otherwise the E.164 value as it is. */
internal fun formatPhone(e164: String): String =
    PK_MOBILE.matchEntire(e164)?.let { "+92 ${it.groupValues[1]} ${it.groupValues[2]}" } ?: e164

/** The reasons a member can choose when ending a connection, with this dialog's wording (16 section 6.12). */
internal val MEMBER_END_REASONS: List<MemberEndReason> =
    MemberEndReason.entries.filter { it != MemberEndReason.UNKNOWN }

@StringRes
internal fun endReasonLabel(reason: MemberEndReason): Int? =
    when (reason) {
        MemberEndReason.NOT_COMPATIBLE -> R.string.chat_end_reason_not_compatible
        MemberEndReason.FAMILY_DECLINED -> R.string.chat_end_reason_family_declined
        MemberEndReason.NO_RESPONSE -> R.string.chat_end_reason_no_response
        MemberEndReason.FOUND_SOMEONE_ELSE -> R.string.chat_end_reason_found_someone_else
        MemberEndReason.INAPPROPRIATE_BEHAVIOUR -> R.string.chat_end_reason_inappropriate_behaviour
        MemberEndReason.OTHER -> R.string.chat_end_reason_other
        MemberEndReason.UNKNOWN -> null
    }

/** The four items of the share dialog (specs/16 section 6.12), with the field `SET-CONTACTS` focuses. */
enum class ShareItem(
    /** The body key, also the `field` of a `required` error. */
    val field: String,
    /** The field to focus on `SET-CONTACTS` (08 section 3.5). */
    val focus: String,
    @param:StringRes val label: Int,
    @param:StringRes val missing: Int,
) {
    PHONE(
        "share_phone",
        "phone_e164",
        R.string.chat_connection_item_phone,
        R.string.chat_share_missing_share_phone,
    ),
    WHATSAPP(
        "share_whatsapp",
        "whatsapp_e164",
        R.string.chat_connection_item_whatsapp,
        R.string.chat_share_missing_share_whatsapp,
    ),
    EMAIL(
        "share_email",
        "contact_email",
        R.string.chat_connection_item_email,
        R.string.chat_share_missing_share_email,
    ),
    GUARDIAN(
        "share_guardian",
        "guardian_name",
        R.string.chat_connection_item_guardian,
        R.string.chat_share_missing_share_guardian,
    ),
}

internal val NO_SHARE =
    ContactShareBody(shareEmail = false, shareGuardian = false, sharePhone = false, shareWhatsapp = false)

internal fun ContactShareBody.isOn(item: ShareItem): Boolean =
    when (item) {
        ShareItem.PHONE -> sharePhone
        ShareItem.WHATSAPP -> shareWhatsapp
        ShareItem.EMAIL -> shareEmail
        ShareItem.GUARDIAN -> shareGuardian
    }

internal fun ContactShareBody.with(
    item: ShareItem,
    on: Boolean,
): ContactShareBody =
    when (item) {
        ShareItem.PHONE -> copy(sharePhone = on)
        ShareItem.WHATSAPP -> copy(shareWhatsapp = on)
        ShareItem.EMAIL -> copy(shareEmail = on)
        ShareItem.GUARDIAN -> copy(shareGuardian = on)
    }

internal val ContactShareBody.anyOn: Boolean get() = sharePhone || shareWhatsapp || shareEmail || shareGuardian

internal fun ContactShare.isOn(item: ShareItem): Boolean = toBody().isOn(item)

internal fun ContactShare.toBody(): ContactShareBody =
    ContactShareBody(
        shareEmail = shareEmail,
        shareGuardian = shareGuardian,
        sharePhone = sharePhone,
        shareWhatsapp = shareWhatsapp,
    )

/** Whether the member has a value for [item]; the guardian needs a name and a phone number (08 section 3.5). */
internal fun ContactsSection.has(item: ShareItem): Boolean =
    when (item) {
        ShareItem.PHONE -> !phoneE164.isNullOrBlank()
        ShareItem.WHATSAPP -> !whatsappE164.isNullOrBlank()
        ShareItem.EMAIL -> !contactEmail.isNullOrBlank()
        ShareItem.GUARDIAN -> !guardianName.isNullOrBlank() && !guardianPhoneE164.isNullOrBlank()
    }

/** Whether first contact should go through the guardian (09 section 10.2). */
internal fun guardianFirst(profile: OwnProfile): Boolean {
    val managedBy = profile.accountFor.managedBy
    val managed = managedBy != null && managedBy != ManagedBy.SELF
    return managed || profile.contacts.preferredContact == PreferredContact.GUARDIAN
}

/**
 * The ticks the share dialog opens with: the current share when there is one; otherwise only the
 * guardian when families prefer it, else only the mobile number (16 section 6.12).
 */
internal fun defaultSelection(
    profile: OwnProfile,
    current: ContactShare?,
): ContactShareBody {
    if (current?.status == ContactShareStatus.ACTIVE) return current.toBody()
    val contacts = profile.contacts
    if (guardianFirst(profile) && contacts.has(ShareItem.GUARDIAN)) return NO_SHARE.copy(shareGuardian = true)
    if (contacts.has(ShareItem.PHONE)) return NO_SHARE.copy(sharePhone = true)
    return NO_SHARE
}
