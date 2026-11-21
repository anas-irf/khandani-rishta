package com.khandanirishta.app.core.network

import com.khandanirishta.app.core.network.generated.model.FieldCode
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.serialization.ApiJson
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

/** The error mapping of specs/22 section 5.3 and the forward compatibility of the generated models. */
class ApiErrorTest {
    private fun response(
        code: Int,
        body: String,
    ): Response<Unit> = Response.error(code, body.toResponseBody("application/json".toMediaType()))

    @Test
    fun `reads code, message, fields, details and request id`() {
        val error =
            ApiError.from(
                response(
                    400,
                    """
                    {"error":{"code":"validation_failed","message":"Some fields need your attention.",
                    "fields":[{"field":"date_of_birth","code":"too_young","message":"Too young"}],
                    "details":{"limit":3},"request_id":"req-1"}}
                    """.trimIndent(),
                ),
            )
        assertEquals(400, error.status)
        assertEquals(ErrorCode.VALIDATION_FAILED, error.code)
        assertEquals("req-1", error.requestId)
        assertEquals(FieldCode.TOO_YOUNG, error.fieldError("date_of_birth")?.code)
        assertEquals(3L, error.detailLong("limit"))
    }

    @Test
    fun `an unreadable body becomes unreadable, never a crash`() {
        val error = ApiError.from(response(502, "<html>Bad gateway</html>"))
        assertEquals(ErrorCode.UNREADABLE, error.code)
        assertEquals(502, error.status)
        assertTrue(error.isGeneric)
    }

    @Test
    fun `network failures are generic`() {
        val error = ApiError.network()
        assertTrue(error.isNetwork)
        assertTrue(error.isGeneric)
    }

    @Test
    fun `gate codes are the six of specs 16 section 1_3`() {
        assertEquals(
            setOf(
                "account_banned",
                "account_suspended",
                "account_deletion_scheduled",
                "consent_required",
                "onboarding_required",
                "profile_not_active",
            ),
            ErrorCode.GATE_CODES,
        )
    }

    @Test
    fun `an enum value this build does not know reads as UNKNOWN`() {
        assertEquals(Gate.UNKNOWN, ApiJson.decodeFromJsonElement(Gate.serializer(), JsonPrimitive("on_holiday")))
        assertEquals(Gate.OK, ApiJson.decodeFromJsonElement(Gate.serializer(), JsonPrimitive("ok")))
        assertEquals(
            JsonPrimitive("pending_review"),
            ApiJson.encodeToJsonElement(Gate.serializer(), Gate.PENDING_REVIEW),
        )
    }
}
