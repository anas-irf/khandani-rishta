package com.khandanirishta.app.ui.text

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.ConnectionStage
import com.khandanirishta.app.core.network.generated.model.LastActive
import com.khandanirishta.app.core.network.generated.model.Me

/** The reference bootstrap, loaded before any member screen is shown (specs/17 section 8.4). */
val LocalReference = staticCompositionLocalOf<Reference> { error("Reference data is not loaded") }

/** The signed-in member's `Me`, for screens that need the viewer's own facts. */
val LocalMe = staticCompositionLocalOf<Me?> { null }

/** The viewer's country, so cards name another country only when it differs (specs/16 section 1.5). */
val LocalViewerCountry = staticCompositionLocalOf { "PK" }

/** A card and the compatibility block show at most this many reasons (10 section 7). */
const val REASONS_MAX = 3

/**
 * The label of a match reason in the candidate's form (10 section 7). `null` for a code outside
 * the closed list: `verified` and `new_member` are not reasons any more, because a badge says
 * both, and like any unknown code they are not shown.
 */
@StringRes
fun reasonLabel(
    code: String,
    subject: Subject = Subject.SELF,
): Int? =
    when (code) {
        "same_city" -> {
            subject.pick(
                R.string.shared_reason_same_city,
                R.string.shared_reason_same_city_male,
                R.string.shared_reason_same_city_female,
            )
        }

        "same_caste" -> {
            R.string.shared_reason_same_caste
        }

        "same_sect" -> {
            R.string.shared_reason_same_sect
        }

        "you_meet_their_preferences" -> {
            subject.pick(
                R.string.shared_reason_you_meet_their_preferences,
                R.string.shared_reason_you_meet_their_preferences_male,
                R.string.shared_reason_you_meet_their_preferences_female,
            )
        }

        "age_fits" -> {
            subject.pick(
                R.string.shared_reason_age_fits,
                R.string.shared_reason_age_fits_male,
                R.string.shared_reason_age_fits_female,
            )
        }

        "education_fits" -> {
            subject.pick(
                R.string.shared_reason_education_fits,
                R.string.shared_reason_education_fits_male,
                R.string.shared_reason_education_fits_female,
            )
        }

        "religiosity_fits" -> {
            subject.pick(
                R.string.shared_reason_religiosity_fits,
                R.string.shared_reason_religiosity_fits_male,
                R.string.shared_reason_religiosity_fits_female,
            )
        }

        "family_values_fit" -> {
            subject.pick(
                R.string.shared_reason_family_values_fit,
                R.string.shared_reason_family_values_fit_male,
                R.string.shared_reason_family_values_fit_female,
            )
        }

        "profession_fits" -> {
            subject.pick(
                R.string.shared_reason_profession_fits,
                R.string.shared_reason_profession_fits_male,
                R.string.shared_reason_profession_fits_female,
            )
        }

        "same_mother_tongue" -> {
            subject.pick(
                R.string.shared_reason_same_mother_tongue,
                R.string.shared_reason_same_mother_tongue_male,
                R.string.shared_reason_same_mother_tongue_female,
            )
        }

        "same_region" -> {
            subject.pick(
                R.string.shared_reason_same_region,
                R.string.shared_reason_same_region_male,
                R.string.shared_reason_same_region_female,
            )
        }

        "shared_hobbies" -> {
            R.string.shared_reason_shared_hobbies
        }

        "meets_your_must_haves" -> {
            subject.pick(
                R.string.shared_reason_meets_your_must_haves,
                R.string.shared_reason_meets_your_must_haves_male,
                R.string.shared_reason_meets_your_must_haves_female,
            )
        }

        "recently_active" -> {
            R.string.shared_reason_recently_active
        }

        else -> {
            null
        }
    }

/** The first [REASONS_MAX] reasons this build knows, as string resources. */
fun reasonLabels(
    codes: List<String>,
    subject: Subject = Subject.SELF,
): List<Int> = codes.mapNotNull { reasonLabel(it, subject) }.take(REASONS_MAX)

@StringRes
fun badgeLabel(badge: Badge): Int? =
    when (badge) {
        Badge.ID_VERIFIED -> R.string.shared_badge_id_verified
        Badge.PHOTO_VERIFIED -> R.string.shared_badge_photo_verified
        Badge.PHONE_VERIFIED -> R.string.shared_badge_phone_verified
        Badge.NEW -> R.string.shared_badge_new
        Badge.UNKNOWN -> null
    }

private val VERIFICATION_BADGES = listOf(Badge.ID_VERIFIED, Badge.PHOTO_VERIFIED, Badge.PHONE_VERIFIED)

/**
 * The earned checks, in the order of 12 section 1.2. `new` is not one of them: it is the label on
 * the photo. Unknown badges are left out.
 */
fun List<Badge>.verifications(): List<Badge> = VERIFICATION_BADGES.filter { it in this }

@StringRes
fun activityLabel(lastActive: LastActive?): Int? =
    when (lastActive) {
        LastActive.ONLINE -> R.string.shared_card_activity_online
        LastActive.TODAY -> R.string.shared_card_activity_today
        LastActive.THIS_WEEK -> R.string.shared_card_activity_this_week
        LastActive.THIS_MONTH -> R.string.shared_card_activity_this_month
        LastActive.EARLIER -> R.string.shared_card_activity_earlier
        LastActive.UNKNOWN, null -> null
    }

/** Dimension labels of the compatibility and looking-for blocks (16 section 6.7). */
@StringRes
fun dimensionLabel(dimension: String): Int? =
    when (dimension) {
        "age" -> R.string.discovery_dimension_age
        "height" -> R.string.discovery_dimension_height
        "marital_status" -> R.string.discovery_dimension_marital_status
        "children" -> R.string.discovery_dimension_children
        "religion" -> R.string.discovery_dimension_religion
        "sect" -> R.string.discovery_dimension_sect
        "caste" -> R.string.discovery_dimension_caste
        "mother_tongue" -> R.string.discovery_dimension_mother_tongue
        "location" -> R.string.discovery_dimension_location
        "education" -> R.string.discovery_dimension_education
        "profession" -> R.string.discovery_dimension_profession
        "income" -> R.string.discovery_dimension_income
        "religiosity" -> R.string.discovery_dimension_religiosity
        "appearance" -> R.string.discovery_dimension_appearance
        "family" -> R.string.discovery_dimension_family
        "living_arrangement" -> R.string.discovery_dimension_living_arrangement
        "work_after_marriage" -> R.string.discovery_dimension_work_after_marriage
        "smoking" -> R.string.discovery_dimension_smoking
        else -> null
    }

@Composable
@ReadOnlyComposable
fun dimensionText(dimension: String): String =
    dimensionLabel(dimension)?.let { stringResource(it) } ?: Reference.fallback(dimension)

/** Stage names of 11 section 9.1. */
@StringRes
fun stageLabel(stage: ConnectionStage): Int =
    when (stage) {
        ConnectionStage.FAMILIES_TALKING -> R.string.chat_stage_name_families_talking
        ConnectionStage.ENGAGED -> R.string.chat_stage_name_engaged
        ConnectionStage.NIKAH_DONE -> R.string.chat_stage_name_nikah_done
        ConnectionStage.CHATTING, ConnectionStage.UNKNOWN -> R.string.chat_stage_name_chatting
    }

@StringRes
fun stageLabel(wire: String?): Int =
    stageLabel(ConnectionStage.entries.firstOrNull { it.wire == wire } ?: ConnectionStage.CHATTING)
