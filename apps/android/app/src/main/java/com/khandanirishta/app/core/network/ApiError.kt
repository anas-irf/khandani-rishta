package com.khandanirishta.app.core.network

import com.khandanirishta.app.core.network.generated.model.ErrorBody
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.serialization.ApiJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import retrofit2.Response

/** Stable error codes of specs/15 section 2.1. */
object ErrorCode {
    const val BAD_REQUEST = "bad_request"
    const val VALIDATION_FAILED = "validation_failed"
    const val UNAUTHENTICATED = "unauthenticated"
    const val FORBIDDEN = "forbidden"
    const val ACCOUNT_BANNED = "account_banned"
    const val ACCOUNT_SUSPENDED = "account_suspended"
    const val ACCOUNT_DELETION_SCHEDULED = "account_deletion_scheduled"
    const val CONSENT_REQUIRED = "consent_required"
    const val ONBOARDING_REQUIRED = "onboarding_required"
    const val PROFILE_NOT_ACTIVE = "profile_not_active"
    const val NOT_FOUND = "not_found"
    const val INVALID_STATE = "invalid_state"
    const val ALREADY_EXISTS = "already_exists"
    const val IDENTITY_ALREADY_REGISTERED = "identity_already_registered"
    const val INTEREST_ALREADY_PENDING = "interest_already_pending"
    const val ALREADY_CONNECTED = "already_connected"
    const val COOLDOWN_ACTIVE = "cooldown_active"
    const val NOT_PERMITTED_BY_MEMBER = "not_permitted_by_member"
    const val CONNECTION_ENDED = "connection_ended"
    const val PAYLOAD_TOO_LARGE = "payload_too_large"
    const val UPGRADE_REQUIRED = "upgrade_required"
    const val RATE_LIMITED = "rate_limited"
    const val LIMIT_REACHED = "limit_reached"
    const val INTERNAL_ERROR = "internal_error"
    const val SERVICE_UNAVAILABLE = "service_unavailable"

    /** Not an API code: the request never reached the API (no connection, timeout). */
    const val NETWORK = "network"

    /** Not an API code: the response could not be read. */
    const val UNREADABLE = "unreadable"

    /** Codes after which `GET /v1/me` is fetched again and the gate decides (specs/16 section 1.3). */
    val GATE_CODES =
        setOf(
            ACCOUNT_BANNED,
            ACCOUNT_SUSPENDED,
            ACCOUNT_DELETION_SCHEDULED,
            CONSENT_REQUIRED,
            ONBOARDING_REQUIRED,
            PROFILE_NOT_ACTIVE,
        )
}

/** A failed API call, parsed from the error body of specs/15 section 2. */
data class ApiError(
    val status: Int,
    val code: String,
    val message: String,
    val fields: List<FieldError> = emptyList(),
    val details: JsonObject = JsonObject(emptyMap()),
    val requestId: String? = null,
) {
    val isNetwork: Boolean get() = code == ErrorCode.NETWORK

    /** A failure the member can do nothing about except retry (G3 and the generic toast). */
    val isGeneric: Boolean
        get() =
            code in
                setOf(
                    ErrorCode.INTERNAL_ERROR,
                    ErrorCode.SERVICE_UNAVAILABLE,
                    ErrorCode.UNREADABLE,
                    ErrorCode.BAD_REQUEST,
                    ErrorCode.FORBIDDEN,
                ) ||
                isNetwork

    fun detailString(key: String): String? = (details[key] as? JsonPrimitive)?.contentOrNull

    fun detailLong(key: String): Long? = (details[key] as? JsonPrimitive)?.longOrNull

    /** The message for one form field, if the API named it. */
    fun fieldError(field: String): FieldError? = fields.firstOrNull { it.field == field }

    companion object {
        fun network(cause: Throwable? = null): ApiError =
            ApiError(
                status = 0,
                code = ErrorCode.NETWORK,
                message = cause?.message ?: "No connection",
            )

        fun unreadable(
            status: Int,
            requestId: String?,
        ): ApiError =
            ApiError(
                status = status,
                code = ErrorCode.UNREADABLE,
                message = "The response could not be read.",
                requestId = requestId,
            )

        /** Reads the error body of a failed response. Never throws. */
        fun from(response: Response<*>): ApiError {
            val requestId = response.headers()[REQUEST_ID_HEADER]
            val raw =
                runCatching { response.errorBody()?.string() }.getOrNull()
                    ?: return unreadable(response.code(), requestId)
            val parsed =
                runCatching { ApiJson.decodeFromString(ErrorBody.serializer(), raw) }.getOrNull()
                    ?: return unreadable(response.code(), requestId)
            val error = parsed.error
            return ApiError(
                status = response.code(),
                code = error.code,
                message = error.message,
                fields = error.fields.orEmpty(),
                details = error.details,
                requestId = error.requestId.ifBlank { requestId },
            )
        }

        const val REQUEST_ID_HEADER = "x-request-id"
    }
}

/** The exception that carries an [ApiError] through `Result`. */
class ApiException(
    val error: ApiError,
    cause: Throwable? = null,
) : Exception("${error.code}: ${error.message}", cause)

/** The [ApiError] of a failed result, or a generic one for any other exception. */
val Throwable.apiError: ApiError
    get() =
        (this as? ApiException)?.error
            ?: ApiError(status = 0, code = ErrorCode.UNREADABLE, message = message ?: javaClass.simpleName)
