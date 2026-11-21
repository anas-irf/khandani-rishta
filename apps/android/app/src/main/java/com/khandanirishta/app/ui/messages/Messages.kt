package com.khandanirishta.app.ui.messages

import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.text.fill
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/** Text that a ViewModel can produce without a Context. */
sealed interface UiText {
    fun resolve(res: Resources): String

    data class Res(
        @param:StringRes val id: Int,
        val args: List<Pair<String, Any?>> = emptyList(),
    ) : UiText {
        override fun resolve(res: Resources): String = res.getString(id).fill(*args.toTypedArray())
    }

    data class Plural(
        @param:PluralsRes val id: Int,
        val count: Int,
        val args: List<Pair<String, Any?>> = emptyList(),
    ) : UiText {
        override fun resolve(res: Resources): String =
            res.getQuantityString(id, count).fill("count" to count, *args.toTypedArray())
    }

    data class Raw(
        val text: String,
    ) : UiText {
        override fun resolve(res: Resources): String = text
    }

    companion object {
        fun of(
            @StringRes id: Int,
            vararg args: Pair<String, Any?>,
        ): UiText = Res(id, args.toList())
    }
}

/** Something to show above every screen: a toast (rule G9) or the limit dialog. */
sealed interface AppMessage {
    data class Toast(
        val text: UiText,
        val actionLabel: UiText? = null,
        val onAction: (() -> Unit)? = null,
        /** Undo toasts stay 5 seconds; plain ones 4 seconds (rules G7 and G9). */
        val withAction: Boolean = actionLabel != null,
    ) : AppMessage

    data class Limit(
        val text: UiText?,
    ) : AppMessage
}

/**
 * The app-wide toast and dialog channel. ViewModels post here; the root composable shows them,
 * so a message survives the screen that caused it closing.
 */
@Singleton
class MessageBus
    @Inject
    constructor() {
        private val channel = MutableSharedFlow<AppMessage>(extraBufferCapacity = 16)
        val messages: SharedFlow<AppMessage> = channel.asSharedFlow()

        fun toast(
            text: UiText,
            actionLabel: UiText? = null,
            onAction: (() -> Unit)? = null,
        ) {
            channel.tryEmit(AppMessage.Toast(text, actionLabel, onAction))
        }

        fun toast(
            @StringRes id: Int,
            vararg args: Pair<String, Any?>,
        ) = toast(UiText.Res(id, args.toList()))

        /** The limit dialog with [text], or the default text of specs/16 section 1.3. */
        fun limit(text: UiText? = null) {
            channel.tryEmit(AppMessage.Limit(text))
        }

        /**
         * The handling of specs/16 section 1.3 for an action that failed. Gate codes and a dead
         * session are handled by the gate router, so they show nothing here.
         */
        fun error(error: ApiError) {
            when (error.code) {
                in ErrorCode.GATE_CODES, ErrorCode.UNAUTHENTICATED, ErrorCode.UPGRADE_REQUIRED -> {}

                ErrorCode.RATE_LIMITED -> {
                    toast(
                        R.string.errors_code_rate_limited,
                        "seconds" to (error.detailLong("retry_after_seconds") ?: 30),
                    )
                }

                ErrorCode.LIMIT_REACHED -> {
                    limit()
                }

                ErrorCode.COOLDOWN_ACTIVE -> {
                    toast(
                        R.string.errors_code_cooldown_active,
                        "date" to formatDetailDate(error.detailString("retry_after_date")),
                    )
                }

                else -> {
                    toast(errorText(error))
                }
            }
        }

        companion object {
            /** The message for a code: specific where the copy has one, generic otherwise. */
            fun errorText(error: ApiError): UiText =
                when (error.code) {
                    ErrorCode.ALREADY_CONNECTED -> UiText.of(R.string.errors_code_already_connected)
                    ErrorCode.ALREADY_EXISTS -> UiText.of(R.string.errors_code_already_exists)
                    ErrorCode.CONNECTION_ENDED -> UiText.of(R.string.errors_code_connection_ended)
                    ErrorCode.FORBIDDEN -> UiText.of(R.string.errors_code_forbidden)
                    ErrorCode.IDENTITY_ALREADY_REGISTERED -> UiText.of(R.string.errors_code_identity_already_registered)
                    ErrorCode.INTEREST_ALREADY_PENDING -> UiText.of(R.string.errors_code_interest_already_pending)
                    ErrorCode.INVALID_STATE -> UiText.of(R.string.errors_code_invalid_state)
                    ErrorCode.NOT_FOUND -> UiText.of(R.string.errors_code_not_found)
                    ErrorCode.NOT_PERMITTED_BY_MEMBER -> UiText.of(R.string.errors_code_not_permitted_by_member)
                    ErrorCode.PAYLOAD_TOO_LARGE -> UiText.of(R.string.errors_code_payload_too_large)
                    ErrorCode.VALIDATION_FAILED -> UiText.of(R.string.errors_code_validation_failed)
                    ErrorCode.LIMIT_REACHED -> UiText.of(R.string.errors_code_limit_reached)
                    else -> UiText.of(R.string.errors_generic_action)
                }

            /** A `YYYY-MM-DD` detail as "20 Nov 2026". */
            fun formatDetailDate(value: String?): String =
                value?.let { runCatching { Formatters.date(LocalDate.parse(it.take(10))) }.getOrNull() }
                    ?: value.orEmpty()

            /** The message for a field error code (specs/17 section 8.3). */
            fun fieldText(code: String): UiText =
                when (code) {
                    "required" -> UiText.of(R.string.errors_field_required)
                    "invalid" -> UiText.of(R.string.errors_field_invalid)
                    "too_short" -> UiText.of(R.string.errors_field_too_short)
                    "too_long" -> UiText.of(R.string.errors_field_too_long)
                    "out_of_range" -> UiText.of(R.string.errors_field_out_of_range)
                    "unknown_code" -> UiText.of(R.string.errors_field_unknown_code)
                    "not_allowed" -> UiText.of(R.string.errors_field_not_allowed)
                    "too_young" -> UiText.of(R.string.errors_field_too_young)
                    "contains_contact_info" -> UiText.of(R.string.errors_field_contains_contact_info)
                    "inappropriate" -> UiText.of(R.string.errors_field_inappropriate)
                    "mismatch" -> UiText.of(R.string.errors_field_mismatch)
                    "locked" -> UiText.of(R.string.errors_field_locked)
                    else -> UiText.of(R.string.errors_field_invalid)
                }
        }
    }

/** Field errors of a `validation_failed` answer, by field key, resolved to text later. */
fun ApiError.fieldTexts(): Map<String, UiText> =
    if (code != ErrorCode.VALIDATION_FAILED) {
        emptyMap()
    } else {
        fields.associate { it.field to MessageBus.fieldText(it.code.wire) }
    }
