package com.khandanirishta.app.ui.navigation

import kotlinx.serialization.Serializable

/**
 * One key per screen ID of specs/16 (specs/22 section 3.1). Keys are serializable, so screen
 * arguments survive process death.
 */
@Serializable
sealed interface AppKey

@Serializable
data object GateBlocked : AppKey

@Serializable
data object GateDeletion : AppKey

@Serializable
data object GateConsent : AppKey

@Serializable
data object GateReview : AppKey

@Serializable
data object GateChanges : AppKey

/** `ONB-01` to `ONB-11`. [step] is the API step key; [edit] is true when opened from the review step. */
@Serializable
data class OnboardingStep(
    val step: String,
    val edit: Boolean = false,
) : AppKey

@Serializable
data object OnboardingDone : AppKey

@Serializable
data object Home : AppKey

@Serializable
data object Matches : AppKey

@Serializable
data class Search(
    val savedSearchId: String? = null,
) : AppKey

@Serializable
data class Profile(
    val profileId: String,
) : AppKey

@Serializable
data class PhotoViewer(
    val profileId: String,
    val index: Int,
) : AppKey

/** [box] is `received` or `sent`; [interestId] is a row to scroll to. */
@Serializable
data class Interests(
    val box: String = "received",
    val interestId: String? = null,
) : AppKey

@Serializable
data object Chats : AppKey

@Serializable
data class Chat(
    val connectionId: String,
) : AppKey

@Serializable
data class ConnectionDetails(
    val connectionId: String,
) : AppKey

@Serializable
data object Shortlist : AppKey

@Serializable
data object Visitors : AppKey

@Serializable
data object Notifications : AppKey

@Serializable
data class PhotoRequests(
    val box: String = "received",
) : AppKey

@Serializable
data object MyProfile : AppKey

/** `ME-EDIT` for one section key: `account_for`, `basics`, `community`, ... */
@Serializable
data class EditSection(
    val section: String,
) : AppKey

@Serializable
data object MyPhotos : AppKey

@Serializable
data object MyPreferences : AppKey

@Serializable
data object Verification : AppKey

/** `ME-VERIFY-ID`. [changeNumber] opens the document number step even when a number exists. */
@Serializable
data class VerifyIdentity(
    val changeNumber: Boolean = false,
) : AppKey

@Serializable
data object VerifySelfie : AppKey

@Serializable
data object Settings : AppKey

@Serializable
data object PrivacySettings : AppKey

@Serializable
data object NotificationSettings : AppKey

/** `SET-CONTACTS`. [focus] is a field to focus; [returnConnectionId] reopens a share dialog (08 section 3). */
@Serializable
data class ContactDetails(
    val focus: String? = null,
    val returnConnectionId: String? = null,
) : AppKey

@Serializable
data object BlockedMembers : AppKey

@Serializable
data object AccountSettings : AppKey

@Serializable
data object Help : AppKey

/** The five top-level destinations of specs/16 section 2.1. */
enum class Tab(
    val root: AppKey,
) {
    HOME(Home),
    SEARCH(Search()),
    INTERESTS(Interests()),
    CHATS(Chats),
    ME(MyProfile),
}

/** Screens that keep the bottom bar: the tab roots and the lists reached from them (16 section 2.1). */
fun AppKey.showsBottomBar(): Boolean =
    when (this) {
        Home, is Search, is Interests, Chats, MyProfile -> true
        Matches, Shortlist, Visitors, Notifications, is PhotoRequests, Settings -> true
        else -> false
    }

/** Screens that block screenshots (rule G17, specs/22 section 10). */
fun AppKey.isSecure(): Boolean =
    when (this) {
        is Profile, is PhotoViewer, is Chat, is ConnectionDetails, is VerifyIdentity, VerifySelfie -> true
        else -> false
    }
