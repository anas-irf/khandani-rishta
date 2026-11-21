package com.khandanirishta.app.core.util

import android.content.res.Resources
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Age, height, dates and relative times, matching the web's lib/format.ts. Numbers use Western
 * digits; dates are written the Pakistani way ("20 Nov 2026") in the device's time zone.
 */
object Formatters {
    const val MIN_HEIGHT_CM = 122
    const val MAX_HEIGHT_CM = 213

    /** Day boundaries of the product (limits, ages) are in Pakistan time, a fixed UTC+5. */
    val KARACHI: ZoneOffset = ZoneOffset.ofHours(5)

    private val dateFormat = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
    private val longDateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH)
    private val timeFormat = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

    /** Feet and inches to centimetres, rounding half up (07 section 4.3). */
    fun feetInchesToCm(
        feet: Int,
        inches: Int,
    ): Int = floor((feet * 12 + inches) * 2.54 + 0.5).toInt()

    /** Centimetres to feet and inches for display (07 section 4.3). */
    fun cmToFeetInches(heightCm: Int): Pair<Int, Int> {
        val totalInches = (heightCm / 2.54).roundToInt()
        return totalInches / 12 to totalInches % 12
    }

    /** "5 ft 6 in (168 cm)". */
    fun height(
        res: Resources,
        heightCm: Int,
    ): String {
        val (feet, inches) = cmToFeetInches(heightCm)
        return res.text(R.string.common_format_height, "feet" to feet, "inches" to inches, "cm" to heightCm)
    }

    /** "5 ft 6 in". */
    fun heightShort(
        res: Resources,
        heightCm: Int,
    ): String {
        val (feet, inches) = cmToFeetInches(heightCm)
        return res.text(R.string.common_format_height_short, "feet" to feet, "inches" to inches)
    }

    fun todayInKarachi(now: Instant = Instant.now()): LocalDate = now.atOffset(KARACHI).toLocalDate()

    /** Whole years between a date of birth and today in Pakistan time (03 section 6). */
    fun ageFrom(
        dateOfBirth: LocalDate,
        now: Instant = Instant.now(),
    ): Int = ChronoUnit.YEARS.between(dateOfBirth, todayInKarachi(now)).toInt()

    private fun zone(): ZoneId = ZoneId.systemDefault()

    /** "20 Nov 2026". */
    fun date(instant: Instant): String = dateFormat.format(instant.atZone(zone()))

    /** "20 Nov 2026" for a calendar day. */
    fun date(day: LocalDate): String = dateFormat.format(day)

    /** "20 November 2026". */
    fun longDate(instant: Instant): String = longDateFormat.format(instant.atZone(zone()))

    fun longDate(day: LocalDate): String = longDateFormat.format(day)

    /** "3:45 PM" for chat messages (16 rule G11). */
    fun time(instant: Instant): String = timeFormat.format(instant.atZone(zone()))

    /** Whole calendar days between two instants in the device's time zone. */
    fun calendarDaysBetween(
        earlier: Instant,
        later: Instant,
    ): Long =
        ChronoUnit.DAYS.between(
            earlier.atZone(zone()).toLocalDate(),
            later.atZone(zone()).toLocalDate(),
        )

    /**
     * Relative for the last 7 days ("Just now", "5 min ago", "3 hours ago", "Yesterday",
     * "4 days ago"), then the date (16 rule G11).
     */
    fun relative(
        res: Resources,
        instant: Instant,
        now: Instant = Instant.now(),
    ): String {
        val seconds = max(0, Duration.between(instant, now).seconds)
        if (seconds < 60) return res.getString(R.string.common_time_just_now)
        val minutes = (seconds / 60).toInt()
        if (minutes < 60) return res.plural(R.plurals.common_time_minutes_ago, minutes)
        val days = calendarDaysBetween(instant, now)
        return when {
            days == 0L -> res.plural(R.plurals.common_time_hours_ago, minutes / 60)
            days == 1L -> res.getString(R.string.common_time_yesterday)
            days < 7 -> res.plural(R.plurals.common_time_days_ago, days.toInt())
            else -> date(instant)
        }
    }

    /** The day label of a chat day separator: "Today", "Yesterday" or the date. */
    fun dayLabel(
        res: Resources,
        instant: Instant,
        now: Instant = Instant.now(),
    ): String =
        when (calendarDaysBetween(instant, now)) {
            0L -> res.getString(R.string.common_time_today)
            1L -> res.getString(R.string.common_time_yesterday)
            else -> date(instant)
        }

    /** Whole days from now until [instant], never negative. */
    fun daysUntil(
        instant: Instant,
        now: Instant = Instant.now(),
    ): Int = max(0, kotlin.math.ceil(Duration.between(now, instant).toHours() / 24.0).toInt())

    /** A count shown on a badge: "99+" above 99. */
    fun badgeCount(count: Long): String = if (count > 99) "99+" else count.toString()

    /** Western-digit grouping, "100,000". */
    fun number(value: Long): String = String.format(Locale.ENGLISH, "%,d", value)
}
