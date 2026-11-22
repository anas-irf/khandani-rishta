package com.khandanirishta.app.ui.feature.profilesections

import com.khandanirishta.app.core.network.serialization.WireEnum

/** The wire value of an API enumeration, or `null` for a value this build does not know. */
val WireEnum?.wireCode: String? get() = this?.wire?.takeIf { it.isNotEmpty() }

/** The API enumeration entry for a wire value, or `null`. */
inline fun <reified E> wireOf(code: String?): E? where E : Enum<E>, E : WireEnum =
    if (code.isNullOrEmpty()) null else enumValues<E>().firstOrNull { it.wire == code }

/** The API enumeration entries for wire values, skipping unknown ones. */
inline fun <reified E> wiresOf(codes: Collection<String>): List<E> where E : Enum<E>, E : WireEnum =
    codes.mapNotNull { wireOf<E>(it) }

/** Trims and collapses inner whitespace; empty is `null` (names and short text). */
fun collapse(value: String?): String? = value?.trim()?.replace(Regex("\\s+"), " ")?.takeIf { it.isNotEmpty() }

/** Trims only, keeping line breaks; empty is `null` (long text). */
fun trimmed(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }

/** `too_short` or `too_long` for a text of [min] to [max] characters; [min] 0 means optional. */
fun lengthCode(
    text: String?,
    min: Int,
    max: Int,
): String? =
    when {
        text == null -> if (min > 0) "too_short" else null
        text.length < min -> "too_short"
        text.length > max -> "too_long"
        else -> null
    }
