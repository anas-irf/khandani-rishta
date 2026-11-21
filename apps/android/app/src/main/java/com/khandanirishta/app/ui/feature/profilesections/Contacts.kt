package com.khandanirishta.app.ui.feature.profilesections

import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.ContactsSection
import com.khandanirishta.app.core.network.generated.model.GuardianRelation
import com.khandanirishta.app.core.network.generated.model.PreferredContact
import com.khandanirishta.app.ui.components.Phone
import com.khandanirishta.app.ui.messages.UiText

/** The contact details form of `SET-CONTACTS` (08 section 3). Phone numbers are E.164 or `null`. */
data class ContactsInput(
    val phone: String? = null,
    /** "Same as mobile number": the WhatsApp control is hidden and the mobile number is sent. */
    val whatsappSame: Boolean = false,
    val whatsapp: String? = null,
    val email: String = "",
    val preferredContact: String = "self",
    val guardianName: String = "",
    val guardianRelation: String? = null,
    val guardianPhone: String? = null,
    val bestTimeToCall: String = "",
) {
    /** Whether any guardian value was entered (08 section 3.4 rule 3). */
    val hasGuardian: Boolean
        get() = collapse(guardianName) != null || guardianRelation != null || guardianPhone != null

    companion object {
        /** Fields `focus` may name (08 section 3.5 step 2). */
        val FOCUSABLE = setOf("phone_e164", "whatsapp_e164", "contact_email", "guardian_name")

        val GUARDIAN_FIELDS = setOf("guardian_name", "guardian_relation", "guardian_phone_e164")

        fun from(contacts: ContactsSection): ContactsInput {
            val phone = contacts.phoneE164
            val whatsapp = contacts.whatsappE164
            val same = whatsapp != null && whatsapp == phone
            return ContactsInput(
                phone = phone,
                whatsappSame = same,
                whatsapp = if (same) null else whatsapp,
                email = contacts.contactEmail.orEmpty(),
                preferredContact = contacts.preferredContact.wireCode ?: "self",
                guardianName = contacts.guardianName.orEmpty(),
                guardianRelation = contacts.guardianRelation.wireCode,
                guardianPhone = contacts.guardianPhoneE164,
                bestTimeToCall = contacts.bestTimeToCall.orEmpty(),
            )
        }
    }

    /** The whole section for `PUT /v1/me/profile/sections/contacts`. */
    fun toBody(): ContactsSection =
        ContactsSection(
            phoneE164 = phone,
            whatsappE164 = if (whatsappSame) phone else whatsapp,
            contactEmail = email.trim().ifEmpty { null },
            guardianName = collapse(guardianName),
            guardianRelation = wireOf<GuardianRelation>(guardianRelation),
            guardianPhoneE164 = guardianPhone,
            preferredContact = wireOf<PreferredContact>(preferredContact) ?: PreferredContact.SELF,
            bestTimeToCall = collapse(bestTimeToCall),
        )
}

/** The client rules of 08 sections 3.2 to 3.4 with the messages of 3.7. */
object ContactsRules : FormRules<ContactsInput> {
    private val pakistanMobile = Regex("^\\+923\\d{9}$")
    private val name = Regex("^[\\p{L}\\p{M}][\\p{L}\\p{M} .'-]*[\\p{L}\\p{M}.]$")
    private const val EMAIL_MAX = 254
    private const val GUARDIAN_NAME_MAX = 80
    private const val BEST_TIME_MAX = 80

    /** 08 section 3.3 rules 4 and 5: the message for a phone value, or `null` when valid. */
    private fun phoneIssue(
        field: String,
        value: String?,
    ): Int? =
        when {
            value == null -> null
            !Phone.E164.matches(value) -> contactMessage(field, "invalid")
            value.startsWith("+92") && !pakistanMobile.matches(value) -> R.string.me_errors_phone_pk_mobile
            else -> null
        }

    /** One `@`, something before it, a dot in the domain part, no spaces (08 section 3.2). */
    fun isEmail(value: String): Boolean {
        if (value.any { it.isWhitespace() }) return false
        val parts = value.split("@")
        if (parts.size != 2) return false
        val (local, domain) = parts
        return local.isNotEmpty() && Regex("^[^.]+(\\.[^.]+)+$").matches(domain)
    }

    override fun validate(values: ContactsInput): List<FieldIssue> {
        val issues = mutableListOf<FieldIssue>()

        fun add(
            field: String,
            message: Int?,
        ) {
            if (message != null && issues.none { it.field == field }) issues += FieldIssue(field, UiText.of(message))
        }
        add("phone_e164", phoneIssue("phone_e164", values.phone))
        if (!values.whatsappSame) add("whatsapp_e164", phoneIssue("whatsapp_e164", values.whatsapp))
        val email = values.email.trim()
        when {
            email.length > EMAIL_MAX -> add("contact_email", R.string.me_errors_contact_email_too_long)
            email.isNotEmpty() && !isEmail(email) -> add("contact_email", R.string.me_errors_contact_email_invalid)
        }
        if (values.preferredContact != "self" && values.preferredContact != "guardian") {
            add("preferred_contact", R.string.me_errors_preferred_contact_invalid)
        }
        val guardianName = collapse(values.guardianName)
        if (values.hasGuardian || values.preferredContact == "guardian") {
            if (guardianName == null) add("guardian_name", R.string.me_errors_guardian_required)
            if (values.guardianRelation == null) add("guardian_relation", R.string.me_errors_guardian_required)
            if (values.guardianPhone == null) add("guardian_phone_e164", R.string.me_errors_guardian_required)
        }
        if (guardianName != null && (guardianName.length !in 2..GUARDIAN_NAME_MAX || !name.matches(guardianName))) {
            add("guardian_name", R.string.me_errors_guardian_name_invalid)
        }
        add("guardian_phone_e164", phoneIssue("guardian_phone_e164", values.guardianPhone))
        if ((collapse(values.bestTimeToCall)?.length ?: 0) > BEST_TIME_MAX) {
            add("best_time_to_call", R.string.me_errors_best_time_to_call_too_long)
        }
        return issues
    }

    override fun fields(values: ContactsInput): List<String> =
        buildList {
            add("phone_e164")
            add("whatsapp_same")
            if (!values.whatsappSame) add("whatsapp_e164")
            add("contact_email")
            add("preferred_contact")
            addAll(listOf("guardian_name", "guardian_relation", "guardian_phone_e164"))
            add("best_time_to_call")
        }

    override fun message(
        apiField: String,
        code: String,
    ): Int? = contactMessage(apiField, code)
}
