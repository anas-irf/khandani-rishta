package com.khandanirishta.app.core.network.serialization

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/** An enumeration of the API contract: every entry knows its wire value. */
interface WireEnum {
    val wire: String
}

/**
 * Reads an enumeration by its wire value. A value this build does not know maps to [unknown]
 * instead of failing, so a newer API never breaks an older app (specs/17 section 8.4).
 */
open class WireEnumSerializer<E>(
    serialName: String,
    private val values: List<E>,
    private val unknown: E,
) : KSerializer<E> where E : Enum<E>, E : WireEnum {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.khandanirishta.$serialName", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: E,
    ) = encoder.encodeString(value.wire)

    override fun deserialize(decoder: Decoder): E {
        val wire = decoder.decodeString()
        return values.firstOrNull { it.wire == wire } ?: unknown
    }
}

/** RFC 3339 timestamps, with or without fractions and with any offset. */
object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.khandanirishta.Instant", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: Instant,
    ) = encoder.encodeString(DateTimeFormatter.ISO_INSTANT.format(value))

    override fun deserialize(decoder: Decoder): Instant = OffsetDateTime.parse(decoder.decodeString()).toInstant()
}

/** Calendar dates as `YYYY-MM-DD`. */
object LocalDateSerializer : KSerializer<LocalDate> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.khandanirishta.LocalDate", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: LocalDate,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): LocalDate = LocalDate.parse(decoder.decodeString())
}

/**
 * The JSON settings for every API call. Unknown keys are ignored (the API may add fields), and
 * `null` values are left out of request bodies: the API treats a missing key and `null` alike.
 */
val ApiJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }
