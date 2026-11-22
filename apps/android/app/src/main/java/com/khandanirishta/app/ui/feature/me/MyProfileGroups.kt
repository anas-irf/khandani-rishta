package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.SectionHeading
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.feature.profilesections.TextStatusNote
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/*
 * Block 6 of `ME-PROFILE` (specs/08 section 1.3): a group per editable part, with its saved
 * values or "Not added yet" and one named link. Two share a band.
 */

@Composable
internal fun PhotosGroup(
    profile: OwnProfile,
    privacy: Privacy?,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val thumbs = remember(profile.photos) { profile.photos.filter { it.thumbUrl != null }.take(THUMBS) }
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_photos),
        action = stringResource(R.string.me_profile_actions_manage),
        onAction = { onOpen(MyPhotos) },
        modifier = modifier,
    ) {
        if (thumbs.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                verticalArrangement = Arrangement.spacedBy(Spacing.s8),
            ) {
                thumbs.forEachIndexed { index, photo ->
                    OwnPhotoImage(
                        url = photo.thumbUrl,
                        description = text(R.string.me_profile_summary_photo_thumb, "position" to index + 1),
                        modifier =
                            Modifier
                                .size(Sizes.arch56)
                                .clip(ArchShape),
                    )
                }
            }
        }
        SummaryLines(
            listOf(
                if (profile.photos.isNotEmpty()) {
                    plural(R.plurals.me_profile_summary_photo_count, profile.photos.size)
                } else {
                    null
                },
                privacy?.let {
                    text(
                        R.string.me_profile_summary_photo_visibility,
                        "label" to reference.option(Lists.PHOTO_VISIBILITY, it.photoVisibility),
                    )
                },
            ),
        )
    }
}

@Composable
internal fun BasicsGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val res = LocalResources.current
    val basics = profile.basics
    val age = remember(basics.dateOfBirth) { basics.dateOfBirth?.let { Formatters.ageFrom(it) } }
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_basics),
        action = stringResource(R.string.me_profile_actions_edit),
        onAction = { onOpen(EditSection(ME_SECTION_BASICS)) },
        modifier = modifier,
    ) {
        SummaryLines(
            listOf(
                joinSummaryParts(
                    reference.option(Lists.GENDER, basics.gender),
                    age?.let { text(R.string.me_profile_summary_age, "age" to it) },
                ),
                joinSummaryParts(
                    reference.option(Lists.MARITAL_STATUS, basics.maritalStatus),
                    basics.heightCm?.let { Formatters.height(res, it) },
                ),
            ),
        )
    }
}

@Composable
internal fun CommunityGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val community = profile.community
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_community),
        action = stringResource(R.string.me_profile_actions_edit),
        onAction = { onOpen(EditSection(ME_SECTION_COMMUNITY)) },
        modifier = modifier,
    ) {
        SummaryLines(
            listOf(
                joinSummaryParts(reference.religion(community.religionCode), reference.sect(community.sectCode)),
                joinSummaryParts(
                    community.casteCode?.let { reference.caste(it) } ?: community.casteOther,
                    reference.language(community.motherTongueCode),
                ),
            ),
        )
    }
}

@Composable
internal fun LocationGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val location = profile.location
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_location),
        action = stringResource(R.string.me_profile_actions_edit),
        onAction = { onOpen(EditSection(ME_SECTION_LOCATION)) },
        modifier = modifier,
    ) {
        SummaryLines(
            listOf(
                joinSummaryParts(
                    location.city?.name ?: location.cityOther,
                    location.city?.regionName,
                    reference.country(location.countryCode),
                ),
            ),
        )
    }
}

@Composable
internal fun EducationGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val education = profile.educationCareer
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_education_career),
        action = stringResource(R.string.me_profile_actions_edit),
        onAction = { onOpen(EditSection(ME_SECTION_EDUCATION)) },
        modifier = modifier,
    ) {
        SummaryLines(
            listOf(
                reference.educationLevel(education.educationLevelCode),
                education.professionCode?.let { reference.profession(it) }
                    ?: reference.option(Lists.EMPLOYMENT_TYPE, education.employmentType),
            ),
        )
    }
}

@Composable
internal fun FamilyGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val family = profile.family
    val empty = remember(family) { familyIsEmpty(family) }
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_family),
        action = stringResource(if (empty) R.string.me_profile_actions_add else R.string.me_profile_actions_edit),
        onAction = { onOpen(EditSection(ME_SECTION_FAMILY)) },
        modifier = modifier,
    ) {
        SummaryLines(
            listOf(
                joinSummaryParts(
                    family.fatherStatus?.let {
                        text(R.string.me_profile_summary_father, "value" to reference.option(Lists.PARENT_STATUS, it))
                    },
                    family.motherStatus?.let {
                        text(R.string.me_profile_summary_mother, "value" to reference.option(Lists.PARENT_STATUS, it))
                    },
                ),
                if (family.brothersCount != null || family.sistersCount != null) {
                    text(
                        R.string.me_profile_summary_siblings,
                        "brothers" to (family.brothersCount ?: 0),
                        "sisters" to (family.sistersCount ?: 0),
                    )
                } else {
                    null
                },
                reference.option(Lists.FAMILY_TYPE, family.familyType),
            ),
        )
        TextStatusNote(profile.textStatus.aboutFamily)
    }
}

@Composable
internal fun LifestyleGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val lifestyle = profile.lifestyle
    val empty = remember(lifestyle) { lifestyleIsEmpty(lifestyle) }
    val about = remember(lifestyle.aboutMe) { summaryExcerpt(lifestyle.aboutMe) }
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_lifestyle),
        action = stringResource(if (empty) R.string.me_profile_actions_add else R.string.me_profile_actions_edit),
        onAction = { onOpen(EditSection(ME_SECTION_LIFESTYLE)) },
        modifier = modifier,
    ) {
        SummaryLines(listOf(reference.option(Lists.RELIGIOSITY, lifestyle.religiosity)))
        about?.let {
            MemberText(it, style = MaterialTheme.typography.bodyMedium, color = KrTheme.colors.textSecondary)
        }
        TextStatusNote(profile.textStatus.aboutMe)
    }
}

@Composable
internal fun LookingForGroup(
    profile: OwnProfile,
    preferences: Preferences?,
    loading: Boolean,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val musts = remember(preferences) { preferences?.let(::profileMustHaveCount) ?: 0 }
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_preferences),
        action = stringResource(R.string.me_profile_actions_edit),
        onAction = { onOpen(MyPreferences) },
        modifier = modifier,
    ) {
        when {
            preferences != null -> {
                SummaryLines(
                    listOf(
                        text(
                            R.string.me_profile_summary_age_range,
                            "min" to preferences.ageMin,
                            "max" to preferences.ageMax,
                        ),
                        if (musts > 0) {
                            plural(R.plurals.me_profile_summary_must_haves, musts)
                        } else {
                            stringResource(R.string.me_profile_summary_must_haves_none)
                        },
                    ),
                )
            }

            loading -> {
                LinesSkeleton()
            }

            else -> {
                SummaryLines(emptyList())
            }
        }
        TextStatusNote(profile.textStatus.partnerNotes)
    }
}

@Composable
internal fun VerificationGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val verification = profile.verification
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_verification),
        action = stringResource(R.string.me_profile_actions_open),
        onAction = { onOpen(Verification) },
        modifier = modifier,
    ) {
        CheckLine(
            text = text(
                R.string.me_profile_summary_id,
                "state" to checkState(verification.idVerified, verification.pending.idDocument),
            ),
            done = verification.idVerified,
            waiting = verification.pending.idDocument,
        )
        CheckLine(
            text = text(
                R.string.me_profile_summary_photo_check,
                "state" to checkState(verification.photoVerified, verification.pending.selfie),
            ),
            done = verification.photoVerified,
            waiting = verification.pending.selfie,
        )
        val phone =
            if (verification.phoneVerified) {
                R.string.me_profile_summary_state_confirmed
            } else {
                R.string.me_profile_summary_state_not_confirmed
            }
        CheckLine(
            text = text(R.string.me_profile_summary_phone, "state" to stringResource(phone)),
            done = verification.phoneVerified,
            waiting = false,
        )
    }
}

@Composable
internal fun ContactsGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val added = remember(profile.contacts) { hasContactDetails(profile.contacts) }
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_contacts),
        action = stringResource(if (added) R.string.me_profile_actions_edit else R.string.me_profile_actions_add),
        onAction = { onOpen(ContactDetails()) },
        modifier = modifier,
    ) {
        // Never the values themselves.
        SummaryLines(listOf(if (added) stringResource(R.string.me_profile_summary_contacts_added) else null))
    }
}

@Composable
internal fun ManagedByGroup(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val managedBy = LocalReference.current.option(Lists.MANAGED_BY, profile.accountFor.managedBy)
    val manager = profile.accountFor.managerName
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_account_for),
        action = stringResource(R.string.me_profile_actions_edit),
        onAction = { onOpen(EditSection(ME_SECTION_ACCOUNT_FOR)) },
        modifier = modifier,
    ) {
        SummaryLines(
            listOf(
                if (manager.isNullOrBlank()) {
                    managedBy
                } else {
                    text(R.string.me_profile_summary_manager, "label" to managedBy, "name" to manager)
                },
            ),
        )
    }
}

@Composable
internal fun PrivacyGroup(
    privacy: Privacy?,
    loading: Boolean,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    ProfileGroup(
        title = stringResource(R.string.me_profile_cards_privacy),
        action = stringResource(R.string.me_profile_actions_open),
        onAction = { onOpen(PrivacySettings) },
        modifier = modifier,
    ) {
        when {
            privacy != null -> {
                SummaryLines(
                    listOf(
                        text(
                            R.string.me_profile_summary_photo_privacy,
                            "label" to reference.option(Lists.PHOTO_VISIBILITY, privacy.photoVisibility),
                        ),
                        text(
                            R.string.me_profile_summary_name_display,
                            "label" to reference.option(Lists.NAME_DISPLAY, privacy.nameDisplay),
                        ),
                    ),
                )
            }

            loading -> {
                LinesSkeleton()
            }

            else -> {
                SummaryLines(emptyList())
            }
        }
    }
}

/** The diamond heading with its control ("Edit", "Add", "Manage", "Open"), then what is saved. */
@Composable
private fun ProfileGroup(
    title: String,
    action: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val named = text(R.string.me_profile_actions_named, "action" to action, "title" to title)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        SectionHeading(
            title = title,
            action = { KrTextLink(text = action, onClick = onAction, contentDescription = named) },
        )
        content()
    }
}

/** The saved values of a group, or "Not added yet". */
@Composable
private fun SummaryLines(
    lines: List<String?>,
    modifier: Modifier = Modifier,
) {
    val shown = remember(lines) { lines.filterNotNull().filter { it.isNotBlank() } }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
        if (shown.isEmpty()) {
            Text(
                text = stringResource(R.string.me_profile_not_added),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            shown.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
    }
}

@Composable
private fun checkState(
    done: Boolean,
    waiting: Boolean,
): String =
    stringResource(
        when {
            done -> R.string.me_profile_summary_state_verified
            waiting -> R.string.me_profile_summary_state_pending
            else -> R.string.me_profile_summary_state_not_verified
        },
    )

/** A verification state with its icon. The tick is for what is verified, and only that. */
@Composable
private fun CheckLine(
    text: String,
    done: Boolean,
    waiting: Boolean,
) {
    val colors = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    IconText(
        icon =
            when {
                done -> Icons.Outlined.Check
                waiting -> Icons.Outlined.Schedule
                else -> Icons.Outlined.RadioButtonUnchecked
            },
        text = text,
        tint =
            when {
                done -> extra.success
                waiting -> extra.warning
                else -> colors.onSurfaceVariant
            },
        iconSize = Sizes.iconTiny,
    )
}

@Composable
private fun LinesSkeleton() {
    LoadingRegion(Modifier.fillMaxWidth(), spacing = Spacing.s8) {
        SkeletonBox(Modifier.fillMaxWidth(LINE_LONG).height(Spacing.s20))
        SkeletonBox(Modifier.fillMaxWidth(LINE_SHORT).height(Spacing.s20))
    }
}

private const val THUMBS = 3
private const val LINE_LONG = 0.6f
private const val LINE_SHORT = 0.4f
