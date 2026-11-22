package com.khandanirishta.app.ui.feature.notifications

import android.content.res.Resources
import androidx.compose.runtime.Immutable
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Notification
import com.khandanirishta.app.core.network.generated.model.NotificationType
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.net.URI

/** What tapping a feed row does (14 section 3, 16 section 6.15). */
internal sealed interface NotificationTarget {
    /** A screen ID of 16 section 4.1 with its parameters, opened through `DeepLinkResolver.fromTarget`. */
    data class Screen(
        val target: String,
        val params: Map<String, String?> = emptyMap(),
    ) : NotificationTarget

    /** `announcement` with a link: opened in the browser. */
    data class External(
        val url: String,
    ) : NotificationTarget

    /** `account_warning`: the dialog with the full reason. */
    data class Warning(
        val reason: String?,
    ) : NotificationTarget
}

/** The text of a row, the moderator's note of `text_rejected`, and what a tap opens (`null`: nothing). */
@Immutable
internal data class NotificationView(
    val text: String,
    val note: String?,
    val target: NotificationTarget?,
)

/**
 * The text and target of a feed row, built from `type`, `actor` and `data` (14 section 3,
 * 16 section 6.15; the web's features/notifications/describe.ts). Unknown keys in `data` are
 * ignored, and a type this build does not know reads "You have a new notification." with no
 * target, so old builds stay safe when new types are added.
 */
internal fun describeNotification(
    item: Notification,
    res: Resources,
    reference: Reference,
    urdu: Boolean,
): NotificationView {
    val data = item.data
    val actor = item.actor
    val actorName = actor?.displayName ?: res.getString(R.string.notifications_actor_fallback)
    val actorProfile = actor?.let { NotificationTarget.Screen("APP-PROFILE", mapOf("profile_id" to it.profileId)) }
    val unknown = NotificationView(res.getString(R.string.notifications_text_unknown), null, null)

    fun plain(
        id: Int,
        target: NotificationTarget?,
        vararg args: Pair<String, Any?>,
    ) = NotificationView(res.text(id, *args), null, target)

    fun connection(target: String): NotificationTarget? =
        data.string("connection_id")?.let { NotificationTarget.Screen(target, mapOf("connection_id" to it)) }

    return when (item.type) {
        NotificationType.INTEREST_RECEIVED -> {
            if (data.flag("reminder")) {
                val count = data.number("count") ?: 1
                val params = mapOf("box" to "received", "interest_id" to data.string("interest_id"))
                NotificationView(
                    res.plural(R.plurals.notifications_text_interest_received_reminder, count, "actor" to actorName),
                    null,
                    NotificationTarget.Screen("APP-INTERESTS", params),
                )
            } else {
                plain(R.string.notifications_text_interest_received, actorProfile, "actor" to actorName)
            }
        }

        NotificationType.INTEREST_ACCEPTED -> {
            plain(R.string.notifications_text_interest_accepted, connection("APP-CHAT"), "actor" to actorName)
        }

        NotificationType.PHOTO_REQUEST_RECEIVED -> {
            plain(
                R.string.notifications_text_photo_request_received,
                NotificationTarget.Screen("APP-PHOTO-REQUESTS", mapOf("box" to "received")),
                "actor" to actorName,
            )
        }

        NotificationType.PHOTO_REQUEST_GRANTED -> {
            plain(R.string.notifications_text_photo_request_granted, actorProfile, "actor" to actorName)
        }

        NotificationType.CONTACT_SHARED -> {
            plain(R.string.notifications_text_contact_shared, connection("APP-CONNECTION"), "actor" to actorName)
        }

        NotificationType.STAGE_PROPOSED, NotificationType.STAGE_CONFIRMED -> {
            val stage = data.string("stage") ?: return unknown
            plain(
                if (item.type == NotificationType.STAGE_PROPOSED) {
                    R.string.notifications_text_stage_proposed
                } else {
                    R.string.notifications_text_stage_confirmed
                },
                connection("APP-CONNECTION"),
                "actor" to actorName,
                "stage" to reference.option(Lists.CONNECTION_STAGE, stage),
            )
        }

        NotificationType.PROFILE_APPROVED -> {
            plain(R.string.notifications_text_profile_approved, NotificationTarget.Screen("APP-HOME"))
        }

        NotificationType.PROFILE_CHANGES_REQUESTED -> {
            plain(R.string.notifications_text_profile_changes_requested, NotificationTarget.Screen("GATE-CHANGES"))
        }

        NotificationType.PHOTO_APPROVED -> {
            plain(R.string.notifications_text_photo_approved, NotificationTarget.Screen("ME-PHOTOS"))
        }

        NotificationType.PHOTO_REJECTED -> {
            val photos = NotificationTarget.Screen("ME-PHOTOS")
            val reason = data.string("rejection_reason")
            if (reason != null) {
                plain(
                    R.string.notifications_text_photo_rejected,
                    photos,
                    "reason" to reference.option(Lists.PHOTO_REJECTION_REASON, reason),
                )
            } else {
                plain(R.string.notifications_text_photo_rejected_no_reason, photos)
            }
        }

        NotificationType.TEXT_REJECTED -> {
            NotificationView(
                res.getString(R.string.notifications_text_text_rejected),
                data.string("note"),
                textRejectedTarget(data.string("field")),
            )
        }

        NotificationType.VERIFICATION_APPROVED -> {
            plain(
                when (data.string("kind")) {
                    "id_document" -> R.string.notifications_text_verification_approved_id_document
                    "selfie" -> R.string.notifications_text_verification_approved_selfie
                    else -> R.string.notifications_text_verification_approved_other
                },
                NotificationTarget.Screen("ME-VERIFY"),
            )
        }

        NotificationType.VERIFICATION_REJECTED -> {
            val verify = NotificationTarget.Screen("ME-VERIFY")
            val reason = data.string("rejection_reason")
            if (reason != null) {
                plain(
                    R.string.notifications_text_verification_rejected,
                    verify,
                    "reason" to reference.option(Lists.VERIFICATION_REJECTION_REASON, reason),
                )
            } else {
                plain(R.string.notifications_text_verification_rejected_no_reason, verify)
            }
        }

        NotificationType.NEW_MATCHES -> {
            val count = data.number("count") ?: 0
            val name = data.string("saved_search_name")
            if (data.string("source") == "saved_search" && name != null) {
                NotificationView(
                    res.plural(R.plurals.notifications_text_new_matches_saved_search, count, "name" to name),
                    null,
                    NotificationTarget.Screen("APP-SEARCH", mapOf("saved_search_id" to data.string("saved_search_id"))),
                )
            } else {
                NotificationView(
                    res.plural(R.plurals.notifications_text_new_matches, count),
                    null,
                    NotificationTarget.Screen("APP-MATCHES"),
                )
            }
        }

        NotificationType.PROFILE_VIEWS_SUMMARY -> {
            NotificationView(
                res.plural(R.plurals.notifications_text_profile_views_summary, data.number("count") ?: 0),
                null,
                NotificationTarget.Screen("APP-VISITORS"),
            )
        }

        NotificationType.ACCOUNT_WARNING -> {
            val reason = data.string("reason")
            NotificationView(
                if (reason != null) {
                    res.text(R.string.notifications_text_account_warning, "reason" to reason)
                } else {
                    res.getString(R.string.notifications_text_account_warning_no_reason)
                },
                null,
                NotificationTarget.Warning(reason),
            )
        }

        NotificationType.ANNOUNCEMENT -> {
            val body = (if (urdu) data.string("text_ur") else null) ?: data.string("text_en") ?: return unknown
            NotificationView(body, null, safeExternalUrl(data.string("url"))?.let { NotificationTarget.External(it) })
        }

        NotificationType.UNKNOWN -> {
            unknown
        }
    }
}

/** The section of `ME-EDIT` (or `ME-PREFS`) that owns a rejected text; the own profile otherwise (16 section 4.1). */
private fun textRejectedTarget(field: String?): NotificationTarget =
    when (field) {
        "about_me", "about_family", "partner_notes" -> NotificationTarget.Screen("ME-EDIT", mapOf("field" to field))
        else -> NotificationTarget.Screen("ME-PROFILE")
    }

/** Only absolute http and https links are opened; anything else is dropped. */
internal fun safeExternalUrl(value: String?): String? {
    val raw = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val uri = runCatching { URI(raw) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase() ?: return null
    return if ((scheme == "https" || scheme == "http") && !uri.host.isNullOrEmpty()) raw else null
}

/** A non-empty string value; `null` for anything else. */
private fun JsonObject.string(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() }

/** A number value as a whole number; `null` for strings, booleans and `null`. */
private fun JsonObject.number(key: String): Int? =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.intOrNull ?: it.doubleOrNull?.toInt() }

/** True only for the boolean `true`. */
private fun JsonObject.flag(key: String): Boolean =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
