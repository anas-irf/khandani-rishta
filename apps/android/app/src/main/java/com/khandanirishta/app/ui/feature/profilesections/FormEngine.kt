package com.khandanirishta.app.ui.feature.profilesections

import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.generated.model.FieldCode
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText

/*
 * The plumbing shared by the profile section forms, the preferences form and the contact form
 * (the web's form-shell.ts): client rules re-run on every change once a submit was attempted,
 * server field errors placed under their fields with a summary for the rest (specs/17 section
 * 8.3), an inline failure for network and server errors (07 section 16.9, 08 section 2.5), and a
 * request to scroll to the first invalid field.
 */

/** Whether a form runs inside onboarding or edits a finished profile (07 section 2, 08 section 2). */
enum class FormMode { ONBOARDING, EDIT }

/** A client rule that failed: the form field and its message. */
data class FieldIssue(
    val field: String,
    val message: UiText,
)

/** A request to scroll to [field]; [token] changes for every request. */
data class Reveal(
    val field: String,
    val token: Int,
)

/** What a form needs to validate its values and to place server errors. */
interface FormRules<V> {
    /** The client rules, in page order. */
    fun validate(values: V): List<FieldIssue>

    /** The fields shown for these values, in page order. */
    fun fields(values: V): List<String>

    /** The form field that shows the error of an API field. */
    fun fieldFor(apiField: String): String = apiField

    /** The form's own message for an API field and code, when it has one. */
    fun message(
        apiField: String,
        code: String,
    ): Int? = null
}

/** The values of a form, the values last saved, and its errors. */
data class FormState<V>(
    val values: V,
    val saved: V,
    val clientErrors: Map<String, UiText> = emptyMap(),
    val serverErrors: Map<String, UiText> = emptyMap(),
    /** Server errors whose field is not on the form (the summary box). */
    val unmatched: List<UiText> = emptyList(),
    val attempted: Boolean = false,
    /** A save (and the onboarding continue) is running: the button spins, inputs are disabled. */
    val busy: Boolean = false,
    /** A network or server failure, shown inline with "Try again". */
    val failure: ApiError? = null,
    val reveal: Reveal? = null,
) {
    /** The member changed something since the form was filled or saved. */
    val dirty: Boolean get() = values != saved

    /** The message under [field]: a server error, or a client error once a submit was attempted. */
    fun error(field: String): UiText? = serverErrors[field] ?: if (attempted) clientErrors[field] else null

    private val hasErrors: Boolean get() = serverErrors.isNotEmpty() || (attempted && clientErrors.isNotEmpty())

    /** "Please check the highlighted fields." at the top of the form. */
    val showSummary: Boolean get() = unmatched.isNotEmpty() || (hasErrors && !busy)

    /** Errors that must be cleared before a save can succeed, in the page order of [fields]. */
    fun firstError(fields: List<String>): String? {
        val keys = serverErrors.keys + if (attempted) clientErrors.keys else emptySet()
        return fields.firstOrNull { it in keys } ?: keys.firstOrNull()
    }

    companion object {
        fun <V> of(
            values: V,
            rules: FormRules<V>,
        ): FormState<V> = FormState(values = values, saved = values, clientErrors = rules.validate(values).toErrorMap())
    }
}

private fun List<FieldIssue>.toErrorMap(): Map<String, UiText> {
    val map = LinkedHashMap<String, UiText>()
    forEach { issue -> if (issue.field !in map) map[issue.field] = issue.message }
    return map
}

private fun Reveal?.next(field: String): Reveal = Reveal(field, (this?.token ?: 0) + 1)

/** Applies a change to [fields]; their server errors go away and the client rules run again. */
fun <V> FormState<V>.edit(
    rules: FormRules<V>,
    fields: Collection<String>,
    transform: (V) -> V,
): FormState<V> {
    val next = transform(values)
    return copy(
        values = next,
        clientErrors = rules.validate(next).toErrorMap(),
        serverErrors = if (fields.isEmpty()) serverErrors else serverErrors - fields.toSet(),
    )
}

/** Replaces the values without making the form dirty (a fresh load). */
fun <V> FormState<V>.reset(
    rules: FormRules<V>,
    values: V,
): FormState<V> = copy(values = values, saved = values, clientErrors = rules.validate(values).toErrorMap())

/**
 * Starts a submit (07 section 2.4 step 3). Returns the state and the values to save, or `null`
 * values when a client rule fails: the errors are shown and the first invalid field is revealed.
 */
fun <V> FormState<V>.begin(rules: FormRules<V>): Pair<FormState<V>, V?> {
    val issues = rules.validate(values)
    val checked =
        copy(
            attempted = true,
            clientErrors = issues.toErrorMap(),
            serverErrors = emptyMap(),
            unmatched = emptyList(),
            failure = null,
        )
    if (issues.isEmpty()) return checked.copy(busy = true) to values
    val first = checked.firstError(rules.fields(values)) ?: issues.first().field
    return checked.copy(reveal = reveal.next(first)) to null
}

/** The save succeeded: the saved values become the new starting point. */
fun <V> FormState<V>.savedAs(values: V = this.values): FormState<V> = copy(saved = values, busy = false)

fun <V> FormState<V>.idle(): FormState<V> = copy(busy = false)

/** Codes shown inline with "Try again" (07 section 16.9, 08 section 2.5). */
val ApiError.isFormFailure: Boolean
    get() =
        code in
            setOf(
                ErrorCode.INTERNAL_ERROR,
                ErrorCode.SERVICE_UNAVAILABLE,
                ErrorCode.NETWORK,
                ErrorCode.UNREADABLE,
                ErrorCode.BAD_REQUEST,
            )

/** Whether the form itself shows [this] error; other codes go to [MessageBus.error]. */
val ApiError.shownByForm: Boolean get() = code == ErrorCode.VALIDATION_FAILED || isFormFailure

/** Shows a failed save: field errors with a summary, or the inline failure. */
fun <V> FormState<V>.failed(
    rules: FormRules<V>,
    error: ApiError,
): FormState<V> =
    when {
        error.code == ErrorCode.VALIDATION_FAILED -> idle().withFieldErrors(rules, error.fields)
        error.isFormFailure -> copy(busy = false, failure = error)
        else -> idle()
    }

/**
 * Places API field errors (17 section 8.3): each under the form field of the same name, the rest
 * in the summary box. The first one shown on the form is revealed.
 */
fun <V> FormState<V>.withFieldErrors(
    rules: FormRules<V>,
    errors: List<FieldError>,
): FormState<V> {
    if (errors.isEmpty()) return this
    val shown = rules.fields(values)
    val onForm = LinkedHashMap<String, UiText>()
    val rest = mutableListOf<UiText>()
    errors.forEach { error ->
        val text = fieldMessage(rules, error)
        val target = rules.fieldFor(error.field)
        if (target in shown) {
            if (target !in onForm) onForm[target] = text
        } else {
            rest += text
        }
    }
    val first = shown.firstOrNull { it in onForm }
    return copy(
        serverErrors = onForm,
        unmatched = rest,
        reveal = if (first != null) reveal.next(first) else reveal,
    )
}

/** The form's own message for a field error, then the generic one for its code, then the API's. */
fun <V> fieldMessage(
    rules: FormRules<V>,
    error: FieldError,
): UiText {
    rules.message(error.field, error.code.wire)?.let { return UiText.of(it) }
    if (error.code == FieldCode.UNKNOWN) return UiText.Raw(error.message)
    return MessageBus.fieldText(error.code.wire)
}
