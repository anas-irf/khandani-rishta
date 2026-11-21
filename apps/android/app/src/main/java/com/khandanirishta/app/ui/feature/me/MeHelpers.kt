package com.khandanirishta.app.ui.feature.me

import android.content.res.Resources
import androidx.annotation.StringRes
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.CompletenessItem
import com.khandanirishta.app.core.network.generated.model.ContactsSection
import com.khandanirishta.app.core.network.generated.model.DocumentType
import com.khandanirishta.app.core.network.generated.model.FamilySection
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.LifestyleSection
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.OwnVerification
import com.khandanirishta.app.core.network.generated.model.PhotoRejectionReason
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.VerificationKind
import com.khandanirishta.app.core.network.generated.model.VerificationRejectionReason
import com.khandanirishta.app.core.network.generated.model.VerificationRequestSummary
import com.khandanirishta.app.core.network.generated.model.VerificationStatus
import com.khandanirishta.app.core.network.serialization.ApiJson
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.navigation.VerifyIdentity
import com.khandanirishta.app.ui.navigation.VerifySelfie
import com.khandanirishta.app.ui.text.text
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/*
 * Pure helpers of the own-profile, photo and verification screens, ported from the web's
 * features/me/summaries.ts, features/photos and features/verification/copy.ts.
 */

// ---------------------------------------------------------------------------
// ME-PROFILE (specs/08 sections 1 and 6)
// ---------------------------------------------------------------------------

/** One hint row of the completeness card: its text and the screen it opens (08 section 6.2). */
internal data class CompletenessHint(
    val item: CompletenessItem,
    @param:StringRes val label: Int,
    val target: AppKey,
)

/** Where a `missing` item leads (08 section 6.2). Unknown items are left out. */
internal fun completenessHint(
    item: CompletenessItem,
    onboardingStep: String,
): CompletenessHint? {
    fun hint(
        @StringRes label: Int,
        target: AppKey,
    ) = CompletenessHint(item, label, target)
    return when (item) {
        CompletenessItem.CORE -> {
            hint(R.string.me_profile_completeness_core, OnboardingStep(onboardingStep))
        }

        CompletenessItem.PHOTO -> {
            hint(R.string.me_profile_completeness_photo, MyPhotos)
        }

        CompletenessItem.MORE_PHOTOS -> {
            hint(R.string.me_profile_completeness_more_photos, MyPhotos)
        }

        CompletenessItem.ABOUT_ME -> {
            hint(R.string.me_profile_completeness_about_me, EditSection(ME_SECTION_LIFESTYLE))
        }

        CompletenessItem.RELIGIOUS_PRACTICE -> {
            hint(R.string.me_profile_completeness_religious_practice, EditSection(ME_SECTION_LIFESTYLE))
        }

        CompletenessItem.PLANS -> {
            hint(R.string.me_profile_completeness_plans, EditSection(ME_SECTION_LIFESTYLE))
        }

        CompletenessItem.HOBBIES -> {
            hint(R.string.me_profile_completeness_hobbies, EditSection(ME_SECTION_LIFESTYLE))
        }

        CompletenessItem.FAMILY -> {
            hint(R.string.me_profile_completeness_family, EditSection(ME_SECTION_FAMILY))
        }

        CompletenessItem.EDUCATION_DETAILS -> {
            hint(R.string.me_profile_completeness_education_details, EditSection(ME_SECTION_EDUCATION))
        }

        CompletenessItem.CAREER_DETAILS -> {
            hint(R.string.me_profile_completeness_career_details, EditSection(ME_SECTION_EDUCATION))
        }

        CompletenessItem.INCOME -> {
            hint(R.string.me_profile_completeness_income, EditSection(ME_SECTION_EDUCATION))
        }

        CompletenessItem.RELOCATION -> {
            hint(R.string.me_profile_completeness_relocation, EditSection(ME_SECTION_LOCATION))
        }

        CompletenessItem.PARTNER_PREFERENCES -> {
            hint(R.string.me_profile_completeness_partner_preferences, MyPreferences)
        }

        CompletenessItem.IDENTITY -> {
            hint(R.string.me_profile_completeness_identity, Verification)
        }

        CompletenessItem.ID_VERIFIED -> {
            hint(R.string.me_profile_completeness_id_verified, VerifyIdentity())
        }

        CompletenessItem.PHOTO_VERIFIED -> {
            hint(R.string.me_profile_completeness_photo_verified, VerifySelfie)
        }

        CompletenessItem.UNKNOWN -> {
            null
        }
    }
}

/** The first three `missing` entries as hint rows (08 section 1.1 block 4). */
internal fun completenessHints(profile: OwnProfile): List<CompletenessHint> =
    profile.missing.mapNotNull { completenessHint(it, profile.onboardingStep.wire) }.take(MAX_HINTS)

/** Badges from `OwnProfile.verification`, in the order of 12 section 1.2. */
internal fun ownBadges(verification: OwnVerification): List<Badge> =
    buildList {
        if (verification.idVerified) add(Badge.ID_VERIFIED)
        if (verification.photoVerified) add(Badge.PHOTO_VERIFIED)
        if (verification.phoneVerified) add(Badge.PHONE_VERIFIED)
    }

/** How many preferences are must-haves (the "Looking for" card). */
internal fun profileMustHaveCount(preferences: Preferences): Int =
    ApiJson.encodeToJsonElement(Preferences.serializer(), preferences).jsonObject.count { (key, value) ->
        key.endsWith("_importance") && (value as? JsonPrimitive)?.contentOrNull == Importance.MUST.wire
    }

/** Whether nothing of the family section was added yet ("Add" instead of "Edit"). */
internal fun familyIsEmpty(family: FamilySection): Boolean =
    isBlankObject(ApiJson.encodeToJsonElement(FamilySection.serializer(), family))

/** Whether nothing of the lifestyle section was added yet ("Add" instead of "Edit"). */
internal fun lifestyleIsEmpty(lifestyle: LifestyleSection): Boolean =
    isBlankObject(ApiJson.encodeToJsonElement(LifestyleSection.serializer(), lifestyle))

private fun isBlankObject(element: JsonElement): Boolean =
    element.jsonObject.values.all { value ->
        when (value) {
            is JsonNull -> true
            is JsonArray -> value.isEmpty()
            is JsonPrimitive -> value.isString && value.content.isBlank()
            else -> false
        }
    }

/** "Added" or "Not added yet": whether any contact value is stored (08 section 1.3). */
internal fun hasContactDetails(contacts: ContactsSection): Boolean =
    listOf(
        contacts.phoneE164,
        contacts.whatsappE164,
        contacts.contactEmail,
        contacts.guardianName,
        contacts.guardianPhoneE164,
    ).any { !it.isNullOrEmpty() }

/** The first 120 characters of a text, with an ellipsis when cut (08 section 1.3). */
internal fun summaryExcerpt(
    text: String?,
    length: Int = EXCERPT_LENGTH,
): String? {
    if (text.isNullOrBlank()) return null
    val trimmed = text.trim()
    return if (trimmed.length > length) trimmed.take(length).trimEnd() + "..." else trimmed
}

/** Non-blank parts joined with commas, or `null` when there are none. */
internal fun joinSummaryParts(vararg parts: String?): String? {
    val shown = parts.filterNot { it.isNullOrBlank() }
    return if (shown.isEmpty()) null else shown.joinToString(", ")
}

/** The label of a profile status for "The profile is not visible to members right now ({status})". */
@StringRes
internal fun profileStatusLabel(status: ProfileStatus): Int? =
    when (status) {
        ProfileStatus.DRAFT -> R.string.me_status_label_draft
        ProfileStatus.PENDING_REVIEW -> R.string.me_status_label_pending_review
        ProfileStatus.CHANGES_REQUESTED -> R.string.me_status_label_changes_requested
        ProfileStatus.ACTIVE -> R.string.me_status_label_active
        ProfileStatus.PAUSED -> R.string.me_status_label_paused
        ProfileStatus.CLOSED -> R.string.me_status_label_closed
        ProfileStatus.SUSPENDED -> R.string.me_status_label_suspended
        ProfileStatus.DELETED, ProfileStatus.UNKNOWN -> null
    }

// ---------------------------------------------------------------------------
// Photos (specs/08 section 5, 13 section 4.3)
// ---------------------------------------------------------------------------

/** A photo that counts against `photos_max` (08 section 5.1). */
internal fun OwnPhoto.countsTowardLimit(): Boolean = status != PhotoStatus.REJECTED && status != PhotoStatus.FAILED

/** The label over a slot (08 section 5.5): the status, or "Main photo" on the primary one. */
@StringRes
internal fun photoStatusLabel(photo: OwnPhoto): Int? =
    when (photo.status) {
        PhotoStatus.PROCESSING -> R.string.photos_status_processing
        PhotoStatus.PENDING_REVIEW -> R.string.photos_status_pending_review
        PhotoStatus.REJECTED -> R.string.photos_status_rejected
        PhotoStatus.FAILED -> R.string.photos_status_failed
        PhotoStatus.APPROVED -> if (photo.isPrimary) R.string.photos_status_main else null
        PhotoStatus.UNKNOWN -> null
    }

/** The message of block 3 of `ME-PHOTOS` (08 section 5.5; reasons from 13 section 4.3). */
@StringRes
internal fun photoRejectionText(photo: OwnPhoto): Int =
    if (photo.status == PhotoStatus.FAILED) {
        R.string.photos_rejections_failed
    } else {
        when (photo.rejectionReason) {
            PhotoRejectionReason.NOT_A_PERSON -> R.string.photos_rejections_reason_not_a_person
            PhotoRejectionReason.FACE_NOT_VISIBLE -> R.string.photos_rejections_reason_face_not_visible
            PhotoRejectionReason.GROUP_PHOTO -> R.string.photos_rejections_reason_group_photo
            PhotoRejectionReason.INAPPROPRIATE -> R.string.photos_rejections_reason_inappropriate
            PhotoRejectionReason.CONTAINS_CONTACT_INFO -> R.string.photos_rejections_reason_contains_contact_info
            PhotoRejectionReason.LOW_QUALITY -> R.string.photos_rejections_reason_low_quality
            PhotoRejectionReason.NOT_THE_CANDIDATE -> R.string.photos_rejections_reason_not_the_candidate
            PhotoRejectionReason.OTHER, PhotoRejectionReason.UNKNOWN, null -> R.string.photos_rejections_reason_other
        }
    }

/** Moves one id earlier (-1) or later (+1) in the list; unchanged at the ends. */
internal fun moveId(
    ids: List<String>,
    id: String,
    delta: Int,
): List<String> {
    val from = ids.indexOf(id)
    val to = from + delta
    if (from < 0 || to < 0 || to >= ids.size) return ids
    return ids.toMutableList().apply {
        removeAt(from)
        add(to, id)
    }
}

// ---------------------------------------------------------------------------
// Verification (specs/12 section 8, 16 sections 6.21 to 6.23)
// ---------------------------------------------------------------------------

/**
 * Every check is about the candidate (12 section 1.3). `{name}` in the copy of 12 section 8 is the
 * candidate's first name; a profile managed by the candidate uses the "you" forms instead.
 */
internal data class VerifyCandidate(
    val self: Boolean,
    val name: String,
)

internal fun verifyCandidateOf(me: Me?): VerifyCandidate {
    val managedBy = me?.profile?.managedBy
    return VerifyCandidate(
        self = managedBy == null || managedBy == ManagedBy.SELF,
        name = me?.profile?.firstName.orEmpty(),
    )
}

/** The member-facing message for a verification `rejection_reason` (12 section 8.3). */
internal fun verificationRejectionText(
    res: Resources,
    reason: VerificationRejectionReason?,
    candidate: VerifyCandidate,
    supportEmail: String,
): String {
    val id =
        when (reason) {
            VerificationRejectionReason.UNREADABLE -> {
                R.string.verification_reason_unreadable
            }

            VerificationRejectionReason.DOCUMENT_MISMATCH -> {
                R.string.verification_reason_document_mismatch
            }

            VerificationRejectionReason.FACE_MISMATCH -> {
                if (candidate.self) {
                    R.string.verification_reason_face_mismatch_self
                } else {
                    R.string.verification_reason_face_mismatch
                }
            }

            VerificationRejectionReason.GESTURE_MISSING -> {
                R.string.verification_reason_gesture_missing
            }

            VerificationRejectionReason.EXPIRED_DOCUMENT -> {
                R.string.verification_reason_expired_document
            }

            VerificationRejectionReason.UNDERAGE -> {
                R.string.verification_reason_underage
            }

            VerificationRejectionReason.SUSPECTED_FRAUD -> {
                R.string.verification_reason_suspected_fraud
            }

            VerificationRejectionReason.OTHER, VerificationRejectionReason.UNKNOWN, null -> {
                R.string.verification_reason_other
            }
        }
    return res.text(id, "name" to candidate.name, "support_email" to supportEmail)
}

/** "Not approved: {reason text}. You can try again." without a doubled full stop. */
internal fun withoutFinalStop(text: String): String = text.trimEnd { it == '.' || it.isWhitespace() }

/** The newest request of a kind: the first entry of `requests` with it (16 section 6.21). */
internal fun newestRequest(
    requests: List<VerificationRequestSummary>,
    kind: VerificationKind,
): VerificationRequestSummary? = requests.firstOrNull { it.kind == kind }

@StringRes
internal fun historyStatusLabel(status: VerificationStatus): Int =
    when (status) {
        VerificationStatus.PENDING -> {
            R.string.verification_centre_history_status_pending
        }

        VerificationStatus.APPROVED -> {
            R.string.verification_centre_history_status_approved
        }

        VerificationStatus.REJECTED -> {
            R.string.verification_centre_history_status_rejected
        }

        VerificationStatus.CANCELLED, VerificationStatus.UNKNOWN -> {
            R.string.verification_centre_history_status_cancelled
        }
    }

@StringRes
internal fun historyKindLabel(kind: VerificationKind): Int =
    when (kind) {
        VerificationKind.SELFIE -> R.string.verification_centre_history_kind_selfie
        VerificationKind.ID_DOCUMENT, VerificationKind.UNKNOWN -> R.string.verification_centre_history_kind_id_document
    }

/** The instruction of a gesture (12 section 4.2), or `null` for a gesture this build does not know. */
@StringRes
internal fun gestureInstruction(gesture: Gesture): Int? =
    when (gesture) {
        Gesture.PEACE_SIGN -> R.string.verification_gesture_peace_sign
        Gesture.THUMBS_UP -> R.string.verification_gesture_thumbs_up
        Gesture.OPEN_PALM -> R.string.verification_gesture_open_palm
        Gesture.HAND_ON_HEAD -> R.string.verification_gesture_hand_on_head
        Gesture.UNKNOWN -> null
    }

// ---------------------------------------------------------------------------
// Identity number (specs/07 section 13, 12 section 3)
// ---------------------------------------------------------------------------

/** Who the wording talks about (07 section 3.2): the member, or the candidate by gender. */
internal enum class IdSubject { SELF, MALE, FEMALE, UNKNOWN }

internal fun idSubjectOf(
    managedBy: ManagedBy?,
    gender: Gender?,
): IdSubject =
    when {
        managedBy == null || managedBy == ManagedBy.SELF -> IdSubject.SELF
        gender == Gender.MALE -> IdSubject.MALE
        gender == Gender.FEMALE -> IdSubject.FEMALE
        else -> IdSubject.UNKNOWN
    }

/** CNIC, NICOP and POC use the 13-digit mask; a passport is letters and digits (12 section 3.7). */
internal fun DocumentType.isCnicLike(): Boolean = this != DocumentType.PASSPORT

/** The preselected document type (07 section 13.2, 12 section 3.1). */
internal fun defaultDocumentType(
    nationalityCode: String?,
    countryCode: String?,
): DocumentType =
    when {
        // A missing nationality counts as Pakistani: the location step defaults it to PK.
        nationalityCode != null && nationalityCode != "PK" -> DocumentType.PASSPORT

        countryCode != null && countryCode != "PK" -> DocumentType.NICOP

        else -> DocumentType.CNIC
    }

/** The number as stored and sent (12 sections 3.2 and 3.7): digits only, or letters and digits. */
internal fun normalizeIdentityNumber(
    type: DocumentType,
    input: String,
): String {
    val compact = input.filterNot { it.isWhitespace() || it == '-' }.uppercase()
    return if (type.isCnicLike()) {
        compact.filter { it in '0'..'9' }.take(CNIC_DIGITS)
    } else {
        compact.filter { it in 'A'..'Z' || it in '0'..'9' }.take(PASSPORT_MAX)
    }
}

/** "Continue" is enabled only at 13 digits for CNIC, NICOP and POC (12 section 3.7). */
internal fun identityNumberComplete(
    type: DocumentType,
    number: String,
): Boolean = if (type.isCnicLike()) number.length == CNIC_DIGITS else number.isNotEmpty()

/** The client checks of 07 section 16.8; the API checks the rest. Returns the message, or `null`. */
@StringRes
internal fun identityNumberProblem(
    type: DocumentType,
    number: String,
): Int? =
    when {
        number.isEmpty() -> {
            R.string.identity_errors_number_required
        }

        type.isCnicLike() && number.length != CNIC_DIGITS -> {
            R.string.identity_errors_number_invalid_cnic
        }

        !type.isCnicLike() && (number.length !in PASSPORT_MIN..PASSPORT_MAX || number.none { it.isDigit() }) -> {
            R.string.identity_errors_number_invalid_passport
        }

        else -> {
            null
        }
    }

/** "CNIC number", "His CNIC number" and so on (07 section 13.1 with the wording of 3.2). */
@StringRes
internal fun identityNumberLabel(
    type: DocumentType,
    subject: IdSubject,
): Int =
    when (type) {
        DocumentType.NICOP -> {
            when (subject) {
                IdSubject.SELF -> R.string.identity_number_label_nicop
                IdSubject.MALE -> R.string.identity_number_label_nicop_male
                IdSubject.FEMALE -> R.string.identity_number_label_nicop_female
                IdSubject.UNKNOWN -> R.string.identity_number_label_nicop_unknown
            }
        }

        DocumentType.POC -> {
            when (subject) {
                IdSubject.SELF -> R.string.identity_number_label_poc
                IdSubject.MALE -> R.string.identity_number_label_poc_male
                IdSubject.FEMALE -> R.string.identity_number_label_poc_female
                IdSubject.UNKNOWN -> R.string.identity_number_label_poc_unknown
            }
        }

        DocumentType.PASSPORT -> {
            when (subject) {
                IdSubject.SELF -> R.string.identity_number_label_passport
                IdSubject.MALE -> R.string.identity_number_label_passport_male
                IdSubject.FEMALE -> R.string.identity_number_label_passport_female
                IdSubject.UNKNOWN -> R.string.identity_number_label_passport_unknown
            }
        }

        DocumentType.CNIC, DocumentType.UNKNOWN -> {
            when (subject) {
                IdSubject.SELF -> R.string.identity_number_label_cnic
                IdSubject.MALE -> R.string.identity_number_label_cnic_male
                IdSubject.FEMALE -> R.string.identity_number_label_cnic_female
                IdSubject.UNKNOWN -> R.string.identity_number_label_cnic_unknown
            }
        }
    }

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Goes back to [key] when it is on the current stack, or replaces the top with it otherwise (a
 * flow opened from a nudge or a notification has no `ME-VERIFY` below it).
 */
internal fun AppNavigator.returnTo(key: AppKey) {
    val current = if (tabbed) stack(currentTab) else stack(Tab.HOME)
    if (current.any { it.key == key }) popUntil { it == key } else replaceTop(key)
}

internal const val ME_SECTION_ACCOUNT_FOR = "account_for"
internal const val ME_SECTION_BASICS = "basics"
internal const val ME_SECTION_COMMUNITY = "community"
internal const val ME_SECTION_LOCATION = "location"
internal const val ME_SECTION_EDUCATION = "education_career"
internal const val ME_SECTION_FAMILY = "family"
internal const val ME_SECTION_LIFESTYLE = "lifestyle"

private const val MAX_HINTS = 3
private const val EXCERPT_LENGTH = 120
private const val CNIC_DIGITS = 13
private const val PASSPORT_MIN = 6
private const val PASSPORT_MAX = 12
