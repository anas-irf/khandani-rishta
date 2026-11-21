package com.khandanirishta.app.ui.feature.profile

import android.content.ClipData
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Mosque
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Spa
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.ChildrenStatus
import com.khandanirishta.app.core.network.generated.model.Compatibility
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.LockedGroup
import com.khandanirishta.app.core.network.generated.model.LookingFor
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.ParentStatus
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.RelationPhotoAccess
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.BadgeIcons
import com.khandanirishta.app.ui.components.CompatBadge
import com.khandanirishta.app.ui.components.InfoRow
import com.khandanirishta.app.ui.components.LockedRow
import com.khandanirishta.app.ui.components.MemberPhoto
import com.khandanirishta.app.ui.components.PhotoSize
import com.khandanirishta.app.ui.components.ReasonChips
import com.khandanirishta.app.ui.components.SectionCard
import com.khandanirishta.app.ui.components.nameAndAge
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.activityLabel
import com.khandanirishta.app.ui.text.dimensionText
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import kotlinx.coroutines.launch

/**
 * The read-only body of a profile (specs/16 section 6.7 blocks 1 to 11): gallery, header,
 * verification, compatibility, about, the detail blocks with locked groups, and looking-for.
 * Used by `APP-PROFILE` and by the own-profile preview. [onPhotoClick] opens the photo viewer;
 * [onRequestPhotos] is the "Request photos" control (absent in the preview).
 */
@Composable
fun ProfileDetailBody(
    detail: ProfileDetail,
    modifier: Modifier = Modifier,
    onPhotoClick: ((Int) -> Unit)? = null,
    onRequestPhotos: (() -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth()) {
        Gallery(detail, onPhotoClick, onRequestPhotos)
        Column(
            Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Header(detail)
            Verification(detail.card.badges)
            detail.compatibility?.let { Compatibility(it, detail.card.displayName) }
            detail.aboutMe?.let { about ->
                SectionCard(
                    title = text(R.string.profile_about_title, "name" to detail.card.displayName),
                    icon = Icons.Outlined.Person,
                ) {
                    Text(about, style = MaterialTheme.typography.bodyLarge)
                }
            }
            DetailBlocks(detail)
            LookingForBlock(detail.lookingFor, detail.partnerNotes, detail.card.displayName)
        }
    }
}

// ---------------------------------------------------------------- gallery

@Composable
private fun Gallery(
    detail: ProfileDetail,
    onPhotoClick: ((Int) -> Unit)?,
    onRequestPhotos: (() -> Unit)?,
) {
    val photos = detail.photos
    val name = detail.card.displayName
    val locked = LockedGroup.PHOTOS in detail.locked
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(0.82f)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .semantics { contentDescription = "" },
    ) {
        if (photos.isEmpty()) {
            MemberPhoto(
                photo = null,
                gender = detail.card.gender,
                size = PhotoSize.MEDIUM,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
            )
            Text(
                stringResource(R.string.profile_gallery_none),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(24.dp),
            )
        } else {
            val pager = rememberPagerState { photos.size }
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                val photo = photos[page]
                val description =
                    if (photo.isBlurred) {
                        stringResource(R.string.a11y_private_photo)
                    } else {
                        text(R.string.profile_gallery_open, "current" to page + 1, "total" to photos.size)
                    }
                MemberPhoto(
                    photo = photo,
                    gender = detail.card.gender,
                    size = PhotoSize.MEDIUM,
                    contentDescription = description,
                    showLock = !locked,
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .then(if (onPhotoClick != null) Modifier.clickable { onPhotoClick(page) } else Modifier),
                )
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(120.dp)
                    .align(Alignment.BottomCenter)
                    .background(KrTheme.colors.photoScrim),
            )
            if (photos.size > 1) {
                Row(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    repeat(photos.size) { index ->
                        Box(
                            Modifier
                                .size(if (index == pager.currentPage) 9.dp else 7.dp)
                                .clip(CircleShape)
                                .background(
                                    if (index ==
                                        pager.currentPage
                                    ) {
                                        Color.White
                                    } else {
                                        Color.White.copy(alpha = 0.5f)
                                    },
                                ),
                        )
                    }
                }
                Surface(
                    color = Color.Black.copy(alpha = 0.45f),
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier =
                        Modifier
                            .align(Alignment.BottomEnd)
                            .padding(12.dp),
                ) {
                    Text(
                        text(
                            R.string.profile_gallery_position,
                            "current" to pager.currentPage + 1,
                            "total" to photos.size,
                        ),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
        }
        if (locked) {
            PhotoAccessOverlay(
                access = detail.relation.photoAccess,
                name = name,
                onRequest = onRequestPhotos,
                modifier = Modifier.align(Alignment.Center),
            )
        }
    }
}

/** The overlay of the "Photo access" table of 16 section 6.7. */
@Composable
fun PhotoAccessOverlay(
    access: RelationPhotoAccess,
    name: String,
    onRequest: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    if (access == RelationPhotoAccess.VISIBLE) return
    Surface(
        color = Color.Black.copy(alpha = 0.55f),
        contentColor = Color.White,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.padding(24.dp),
    ) {
        Column(
            Modifier.padding(horizontal = 20.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Filled.Lock, contentDescription = null, modifier = Modifier.size(28.dp))
            Text(
                if (access == RelationPhotoAccess.REQUESTED) {
                    stringResource(R.string.profile_photo_access_requested)
                } else {
                    text(R.string.profile_photo_access_private, "name" to name)
                },
                style = MaterialTheme.typography.bodyMedium,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            if (access == RelationPhotoAccess.CAN_REQUEST && onRequest != null) {
                Button(onClick = onRequest) { Text(stringResource(R.string.profile_photo_access_request)) }
            }
        }
    }
}

// ---------------------------------------------------------------- header

@Composable
private fun Header(detail: ProfileDetail) {
    val card = detail.card
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val copiedLabel = stringResource(R.string.profile_header_copy_code)
    var copied by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                nameAndAge(card),
                style = MaterialTheme.typography.headlineMedium,
                modifier =
                    Modifier
                        .weight(1f, fill = false)
                        .semantics { heading() },
            )
            Spacer(Modifier.width(8.dp))
            BadgeIcons(card.badges)
        }
        val activity =
            when {
                detail.isOnline == true -> stringResource(R.string.profile_header_online)
                else -> activityLabel(card.lastActive)?.let { stringResource(it) }
            }
        if (activity != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (detail.isOnline == true) {
                    Box(
                        Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(KrTheme.colors.online),
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    activity,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Outlined.LocationOn,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                listOfNotNull(detail.location.cityName, detail.location.regionName).joinToString(", "),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text(R.string.profile_header_code, "code" to card.publicCode),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            IconButton(onClick = {
                val clip = ClipEntry(ClipData.newPlainText(copiedLabel, card.publicCode))
                scope.launch { clipboard.setClipEntry(clip) }
                copied = true
            }) {
                Icon(Icons.Outlined.ContentCopy, contentDescription = copiedLabel, modifier = Modifier.size(18.dp))
            }
            if (copied) {
                Text(
                    stringResource(R.string.profile_header_copied),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        if (card.managedBy != ManagedBy.SELF) {
            Text(
                text(
                    R.string.profile_header_managed_by,
                    "label" to LocalReference.current.option(Lists.MANAGED_BY, card.managedBy),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Block 2a: one line per earned verification badge, then the disclaimer (12 section 1.2). */
@Composable
private fun Verification(badges: List<Badge>) {
    val lines =
        listOfNotNull(
            if (Badge.ID_VERIFIED in
                badges
            ) {
                Icons.Filled.VerifiedUser to R.string.profile_verification_id_verified
            } else {
                null
            },
            if (Badge.PHOTO_VERIFIED in
                badges
            ) {
                Icons.Filled.Verified to R.string.profile_verification_photo_verified
            } else {
                null
            },
            if (Badge.PHONE_VERIFIED in
                badges
            ) {
                Icons.Filled.PhoneAndroid to R.string.profile_verification_phone_verified
            } else {
                null
            },
        )
    if (lines.isEmpty()) return
    SectionCard(title = stringResource(R.string.profile_verification_title), icon = Icons.Filled.VerifiedUser) {
        lines.forEach { (icon, label) ->
            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = KrTheme.colors.success, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(stringResource(label), style = MaterialTheme.typography.bodyMedium)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            stringResource(R.string.profile_verification_disclaimer),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ---------------------------------------------------------------- compatibility

@Composable
private fun Compatibility(
    compatibility: Compatibility,
    name: String,
) {
    var details by rememberSaveable { mutableStateOf(false) }
    SectionCard(title = stringResource(R.string.profile_compat_title), icon = Icons.Outlined.FavoriteBorder) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val ring = text(R.string.profile_compat_ring, "value" to compatibility.compat)
            Box(Modifier.semantics { contentDescription = ring }, contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    progress = { compatibility.compat / 100f },
                    modifier = Modifier.size(76.dp),
                    strokeWidth = 7.dp,
                    color = MaterialTheme.colorScheme.tertiary,
                    trackColor = MaterialTheme.colorScheme.tertiaryContainer,
                )
                Text("${compatibility.compat}%", style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CompatBadge(compatibility.compat)
                ReasonChips(compatibility.reasons)
            }
        }
        Spacer(Modifier.height(12.dp))
        FitBar(
            text(R.string.profile_compat_viewer_fit, "name" to name, "value" to compatibility.viewerFit),
            compatibility.viewerFit,
        )
        Spacer(Modifier.height(8.dp))
        FitBar(
            text(R.string.profile_compat_owner_fit, "name" to name, "value" to compatibility.ownerFit),
            compatibility.ownerFit,
        )
        TextButton(onClick = { details = !details }) {
            Text(
                stringResource(
                    if (details) R.string.profile_compat_details_hide else R.string.profile_compat_details_show,
                ),
            )
        }
        AnimatedVisibility(details) {
            Column {
                compatibility.dimensions.forEach { dimension ->
                    val verdict =
                        if (dimension.matched) R.string.profile_compat_matched else R.string.profile_compat_not_matched
                    Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (dimension.matched) Icons.Filled.CheckCircle else Icons.Filled.Cancel,
                            contentDescription = stringResource(verdict),
                            tint = if (dimension.matched) KrTheme.colors.success else MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            dimensionText(dimension.dimension),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                        )
                        if (dimension.importance == Importance.MUST) MustTag()
                    }
                }
            }
        }
    }
}

@Composable
private fun FitBar(
    label: String,
    value: Int,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        LinearProgressIndicator(
            progress = { value / 100f },
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(CircleShape),
            trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        )
    }
}

@Composable
private fun MustTag() {
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        shape = CircleShape,
    ) {
        Text(
            stringResource(R.string.profile_compat_must),
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

// ---------------------------------------------------------------- detail blocks

/** Rows of one block: shown values, and locked placeholders (16 section 6.7 rules). */
private class Rows {
    val items = mutableListOf<Triple<String, String, Boolean>>()

    fun add(
        label: String,
        value: String?,
    ) {
        if (!value.isNullOrBlank()) items += Triple(label, value, false)
    }

    fun locked(
        label: String,
        placeholder: String,
    ) {
        items += Triple(label, placeholder, true)
    }
}

@Composable
private fun Block(
    title: String,
    icon: ImageVector,
    rows: Rows,
    footer: (@Composable () -> Unit)? = null,
) {
    if (rows.items.isEmpty() && footer == null) return
    SectionCard(title = title, icon = icon) {
        rows.items.forEachIndexed { index, (label, value, locked) ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
            if (locked) LockedRow(label, value) else InfoRow(label, value)
        }
        footer?.invoke()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DetailBlocks(detail: ProfileDetail) {
    val ref = LocalReference.current
    val res = LocalResources.current
    val locked = detail.locked.toSet()
    val placeholder =
        stringResource(
            if (detail.relation.tier ==
                Tier.CONNECTION
            ) {
                R.string.shared_locked_hidden_by_member
            } else {
                R.string.shared_locked_visible_after_connect
            },
        )
    val pronoun = stringResource(
        if (detail.card.gender ==
            Gender.FEMALE
        ) {
            R.string.profile_pronoun_female
        } else {
            R.string.profile_pronoun_male
        },
    )

    // 5 Basics
    val basics = detail.basics
    val basicRows = Rows()
    basicRows.add(
        stringResource(R.string.profile_rows_marital_status),
        ref.option(Lists.MARITAL_STATUS, basics.maritalStatus),
    )
    val count = basics.childrenCount ?: 0
    basicRows.add(
        stringResource(R.string.profile_rows_children),
        when (basics.childrenStatus) {
            ChildrenStatus.NONE -> stringResource(R.string.profile_rows_children_none)

            ChildrenStatus.LIVING_WITH_ME -> plural(R.plurals.profile_rows_children_with, count, "pronoun" to pronoun)

            ChildrenStatus.NOT_LIVING_WITH_ME -> plural(
                R.plurals.profile_rows_children_without,
                count,
                "pronoun" to pronoun,
            )

            else -> null
        },
    )
    basics.currentWivesCount?.let {
        basicRows.add(
            stringResource(R.string.profile_rows_current_wives),
            plural(R.plurals.profile_rows_current_wives_value, it),
        )
    }
    basicRows.add(stringResource(R.string.profile_rows_height), Formatters.height(res, basics.heightCm))
    basics.weightKg?.let {
        basicRows.add(
            stringResource(R.string.profile_rows_weight),
            text(
                R.string.profile_rows_weight_value,
                "value" to it,
            ),
        )
    }
    basicRows.add(stringResource(R.string.profile_rows_complexion), ref.option(Lists.COMPLEXION, basics.complexion))
    basicRows.add(stringResource(R.string.profile_rows_build), ref.option(Lists.BODY_TYPE, basics.bodyType))
    Block(stringResource(R.string.profile_blocks_basics), Icons.Outlined.Person, basicRows)

    // 6 Religion and community
    val community = detail.community
    val communityRows = Rows()
    communityRows.add(stringResource(R.string.profile_rows_religion), ref.religion(community.religionCode))
    communityRows.add(stringResource(R.string.profile_rows_sect), community.sectCode?.let { ref.sect(it) })
    if (LockedGroup.CASTE in locked) {
        communityRows.locked(stringResource(R.string.shared_locked_group_caste), placeholder)
    } else {
        communityRows.add(
            stringResource(R.string.profile_rows_caste),
            community.casteLabel?.let { caste -> community.subCasteLabel?.let { "$caste ($it)" } ?: caste },
        )
    }
    communityRows.add(stringResource(R.string.profile_rows_mother_tongue), ref.language(community.motherTongueCode))
    communityRows.add(
        stringResource(R.string.profile_rows_other_languages),
        community.languageCodes.filter { it != community.motherTongueCode }.joinToString(", ") { ref.language(it) },
    )
    Block(stringResource(R.string.profile_blocks_community), Icons.Outlined.Mosque, communityRows)

    // 7 Location
    val location = detail.location
    val locationRows = Rows()
    locationRows.add(
        stringResource(R.string.profile_rows_lives_in),
        listOfNotNull(location.cityName, location.regionName, ref.country(location.countryCode))
            .filter {
                it.isNotBlank()
            }.joinToString(", "),
    )
    if (LockedGroup.AREA in locked) {
        locationRows.locked(stringResource(R.string.shared_locked_group_area), placeholder)
    } else {
        locationRows.add(stringResource(R.string.profile_rows_area), location.area)
    }
    locationRows.add(
        stringResource(R.string.profile_rows_nationality),
        location.nationalityCode?.let { ref.country(it) },
    )
    locationRows.add(
        stringResource(R.string.profile_rows_residency),
        ref.option(Lists.RESIDENCY_STATUS, location.residencyStatus),
    )
    locationRows.add(stringResource(R.string.profile_rows_home_town), location.originLabel)
    locationRows.add(stringResource(R.string.profile_rows_relocate), ref.option(Lists.RELOCATION, location.relocation))
    Block(stringResource(R.string.profile_blocks_location), Icons.Outlined.LocationOn, locationRows)

    // 8 Education and career
    val career = detail.educationCareer
    val careerRows = Rows()
    careerRows.add(stringResource(R.string.profile_rows_education_level), ref.educationLevel(career.educationLevelCode))
    careerRows.add(
        stringResource(R.string.profile_rows_field),
        career.educationFieldCode?.let { ref.educationField(it) },
    )
    careerRows.add(stringResource(R.string.profile_rows_degree), career.degreeTitle)
    careerRows.add(
        stringResource(R.string.profile_rows_employment),
        ref.option(Lists.EMPLOYMENT_TYPE, career.employmentType),
    )
    careerRows.add(stringResource(R.string.profile_rows_profession), career.professionCode?.let { ref.profession(it) })
    if (LockedGroup.CAREER_DETAILS in locked) {
        careerRows.locked(stringResource(R.string.shared_locked_group_career_details), placeholder)
    } else {
        careerRows.add(stringResource(R.string.profile_rows_institute), career.instituteName)
        careerRows.add(stringResource(R.string.profile_rows_job_title), career.jobTitle)
        careerRows.add(stringResource(R.string.profile_rows_employer), career.employerName)
    }
    if (LockedGroup.INCOME in locked) {
        careerRows.locked(stringResource(R.string.shared_locked_group_income), placeholder)
    } else {
        careerRows.add(stringResource(R.string.profile_rows_income), career.incomeBandCode?.let { ref.incomeBand(it) })
    }
    Block(stringResource(R.string.profile_blocks_education_career), Icons.Outlined.School, careerRows)

    // 9 Family
    val familyRows = Rows()
    val family = detail.family
    if (LockedGroup.FAMILY in locked) {
        familyRows.locked(stringResource(R.string.profile_blocks_family), placeholder)
    } else if (family != null) {
        fun parent(
            status: ParentStatus?,
            occupation: String?,
        ): String? =
            listOfNotNull(
                status?.let {
                    ref.option(Lists.PARENT_STATUS, it)
                },
                occupation,
            ).filter { it.isNotBlank() }.joinToString(", ").ifBlank { null }
        familyRows.add(
            stringResource(R.string.profile_rows_father),
            parent(family.fatherStatus, family.fatherOccupation),
        )
        familyRows.add(
            stringResource(R.string.profile_rows_mother),
            parent(family.motherStatus, family.motherOccupation),
        )
        family.brothersCount?.let {
            familyRows.add(
                stringResource(R.string.profile_rows_brothers),
                text(
                    R.string.profile_rows_siblings_value,
                    "count" to it,
                    "married" to (family.brothersMarried ?: 0),
                ),
            )
        }
        family.sistersCount?.let {
            familyRows.add(
                stringResource(R.string.profile_rows_sisters),
                text(
                    R.string.profile_rows_siblings_value,
                    "count" to it,
                    "married" to (family.sistersMarried ?: 0),
                ),
            )
        }
        familyRows.add(
            stringResource(R.string.profile_rows_family_type),
            ref.option(Lists.FAMILY_TYPE, family.familyType),
        )
        familyRows.add(
            stringResource(R.string.profile_rows_family_status),
            ref.option(Lists.FAMILY_CLASS, family.familyClass),
        )
        familyRows.add(
            stringResource(R.string.profile_rows_family_values),
            ref.option(Lists.FAMILY_VALUES, family.familyValues),
        )
        familyRows.add(
            stringResource(R.string.profile_rows_family_lives_in),
            listOfNotNull(
                family.familyCityName,
                family.familyCountryCode?.let {
                    ref.country(it)
                },
            ).filter { it.isNotBlank() }.joinToString(", "),
        )
        if (LockedGroup.HOME in locked) {
            familyRows.locked(stringResource(R.string.shared_locked_group_home), placeholder)
        } else {
            val size =
                family.homeSizeValue?.let { value ->
                    val number = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
                    "$number ${ref.option(Lists.HOME_SIZE_UNIT, family.homeSizeUnit)}".trim()
                }
            familyRows.add(
                stringResource(R.string.profile_rows_home),
                listOfNotNull(
                    family.homeOwnership?.let { ref.option(Lists.HOME_OWNERSHIP, it) },
                    family.homeType?.let { ref.option(Lists.HOME_TYPE, it) },
                    size,
                ).filter { it.isNotBlank() }.joinToString(", "),
            )
        }
    }
    val aboutFamily = detail.aboutFamily
    Block(
        stringResource(R.string.profile_blocks_family),
        Icons.Outlined.Groups,
        familyRows,
        footer =
            if (aboutFamily != null && LockedGroup.FAMILY !in locked) {
                {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.profile_rows_about_family),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(aboutFamily, style = MaterialTheme.typography.bodyLarge)
                }
            } else {
                null
            },
    )

    // 10 Faith and lifestyle
    val lifestyle = detail.lifestyle
    val lifestyleRows = Rows()
    lifestyleRows.add(
        stringResource(R.string.profile_rows_religiosity),
        ref.option(Lists.RELIGIOSITY, lifestyle.religiosity),
    )
    lifestyleRows.add(
        stringResource(R.string.profile_rows_prayers),
        ref.option(Lists.PRAYER_FREQUENCY, lifestyle.prayerFrequency),
    )
    lifestyleRows.add(stringResource(R.string.profile_rows_hijab), ref.option(Lists.HIJAB, lifestyle.hijab))
    lifestyleRows.add(stringResource(R.string.profile_rows_beard), ref.option(Lists.BEARD, lifestyle.beard))
    lifestyleRows.add(
        stringResource(R.string.profile_rows_religious_education),
        ref.option(Lists.RELIGIOUS_EDUCATION, lifestyle.religiousEducation),
    )
    lifestyleRows.add(stringResource(R.string.profile_rows_smoking), ref.option(Lists.SMOKING, lifestyle.smoking))
    lifestyleRows.add(
        stringResource(R.string.profile_rows_living),
        ref.option(Lists.LIVING_ARRANGEMENT, lifestyle.livingArrangement),
    )
    lifestyleRows.add(
        stringResource(R.string.profile_rows_work),
        ref.option(Lists.WORK_AFTER_MARRIAGE, lifestyle.workAfterMarriage),
    )
    lifestyleRows.add(
        stringResource(R.string.profile_rows_timeline),
        ref.option(Lists.MARRIAGE_TIMELINE, lifestyle.marriageTimeline),
    )
    lifestyleRows.add(
        stringResource(R.string.profile_rows_jahez),
        ref.option(Lists.JAHEZ_STANCE, lifestyle.jahezStance),
    )
    if (LockedGroup.HEALTH in locked) {
        lifestyleRows.locked(stringResource(R.string.shared_locked_group_health), placeholder)
    } else {
        lifestyleRows.add(
            stringResource(R.string.profile_rows_blood_group),
            ref.option(Lists.BLOOD_GROUP, lifestyle.bloodGroup),
        )
        lifestyleRows.add(
            stringResource(R.string.profile_rows_disability),
            lifestyle.disability?.let {
                listOfNotNull(ref.option(Lists.DISABILITY, it), lifestyle.disabilityDetails).joinToString(", ")
            },
        )
    }
    val hobbies = lifestyle.hobbyCodes
    Block(
        stringResource(R.string.profile_blocks_lifestyle),
        Icons.Outlined.Spa,
        lifestyleRows,
        footer =
            if (hobbies.isNotEmpty()) {
                {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.profile_rows_hobbies),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(6.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        hobbies.forEach { code ->
                            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = CircleShape) {
                                Text(
                                    ref.hobby(code),
                                    style = MaterialTheme.typography.labelMedium,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                )
                            }
                        }
                    }
                }
            } else {
                null
            },
    )
}

// ---------------------------------------------------------------- looking for

@Composable
private fun LookingForBlock(
    lookingFor: LookingFor,
    notes: String?,
    name: String,
) {
    val ref = LocalReference.current
    val res = LocalResources.current
    val viewerGender = LocalMe.current?.profile?.gender
    SectionCard(
        title = text(R.string.profile_looking_for_title, "name" to name),
        icon = Icons.Outlined.Info,
        modifier = Modifier.animateContentSize(),
    ) {
        if (notes != null) {
            Text(notes, style = MaterialTheme.typography.bodyLarge, fontStyle = FontStyle.Italic)
            Spacer(Modifier.height(8.dp))
        }
        if (lookingFor.lines.isEmpty()) {
            Text(
                text(R.string.profile_looking_for_none, "name" to name),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@SectionCard
        }
        lookingFor.lines.forEachIndexed { index, line ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
            Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            dimensionText(line.dimension),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (line.importance == Importance.MUST) {
                            Spacer(Modifier.width(6.dp))
                            MustTag()
                        }
                    }
                    Text(
                        lookingForValues(line.dimension, line.summaryValues, ref, res, viewerGender),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                when (line.viewerMatches) {
                    true -> {
                        Icon(
                            Icons.Filled.CheckCircle,
                            contentDescription = stringResource(R.string.profile_looking_for_you_match),
                            tint = KrTheme.colors.success,
                        )
                    }

                    false -> {
                        Icon(
                            Icons.Filled.Cancel,
                            contentDescription = stringResource(R.string.profile_looking_for_you_do_not_match),
                            tint = MaterialTheme.colorScheme.error,
                        )
                    }

                    null -> {}
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text(R.string.profile_looking_for_summary, "matched" to lookingFor.matched, "total" to lookingFor.total),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

/**
 * The values of a looking-for line (16 section 6.7, 10 section 11.1): labels joined with commas,
 * an age pair as "25 to 32 years", a height pair with open bounds, a single rank as "At least".
 */
private fun lookingForValues(
    dimension: String,
    values: List<String>,
    ref: Reference,
    res: android.content.res.Resources,
    viewerGender: Gender?,
): String {
    fun t(
        id: Int,
        vararg args: Pair<String, Any?>,
    ) = res.text(id, *args)
    return when (dimension) {
        "age" -> {
            t(R.string.profile_looking_for_age, "min" to values.getOrNull(0), "max" to values.getOrNull(1))
        }

        "height" -> {
            val min = values.getOrNull(0)?.toIntOrNull()?.let { Formatters.height(res, it) }
            val max = values.getOrNull(1)?.toIntOrNull()?.let { Formatters.height(res, it) }
            when {
                min != null && max != null -> t(R.string.profile_looking_for_range, "min" to min, "max" to max)
                min != null -> t(R.string.profile_looking_for_at_least, "value" to min)
                max != null -> t(R.string.profile_looking_for_up_to, "value" to max)
                else -> ""
            }
        }

        "education" -> {
            t(R.string.profile_looking_for_at_least, "value" to ref.educationLevel(values.firstOrNull()))
        }

        "income" -> {
            val rank = values.firstOrNull()?.toIntOrNull()
            val band = ref.data.incomeBands.firstOrNull { it.currencyCode == "PKR" && it.rank == rank }
            if (band !=
                null
            ) {
                incomeMinLabel(res, band.label)
            } else {
                t(
                    R.string.profile_looking_for_at_least,
                    "value" to values.firstOrNull().orEmpty(),
                )
            }
        }

        "appearance" -> {
            values.joinToString(", ") {
                ref.option(
                    if (viewerGender ==
                        Gender.FEMALE
                    ) {
                        Lists.HIJAB
                    } else {
                        Lists.BEARD
                    },
                    it,
                )
            }
        }

        "location", "profession", "family" -> {
            values.joinToString(", ") { entry ->
                val prefix = entry.substringBefore(':', missingDelimiterValue = "")
                val value = entry.substringAfter(':')
                when {
                    prefix.isEmpty() -> entry
                    dimension == "location" && prefix == "country" -> ref.country(value)
                    dimension == "profession" && prefix == "employment" -> ref.option(Lists.EMPLOYMENT_TYPE, value)
                    dimension == "profession" && prefix == "profession" -> ref.profession(value)
                    dimension == "family" && prefix == "values" -> ref.option(Lists.FAMILY_VALUES, value)
                    dimension == "family" && prefix == "type" -> ref.option(Lists.FAMILY_TYPE, value)
                    else -> value
                }
            }
        }

        "marital_status" -> {
            values.joinToString(", ") { ref.option(Lists.MARITAL_STATUS, it) }
        }

        "children" -> {
            values.joinToString(", ") { ref.option(Lists.CHILDREN_ACCEPTANCE, it) }
        }

        "religion" -> {
            values.joinToString(", ") { ref.religion(it) }
        }

        "sect" -> {
            values.joinToString(", ") { ref.sect(it) }
        }

        "caste" -> {
            values.joinToString(", ") { ref.caste(it) }
        }

        "mother_tongue" -> {
            values.joinToString(", ") { ref.language(it) }
        }

        "religiosity" -> {
            values.joinToString(", ") { ref.option(Lists.RELIGIOSITY, it) }
        }

        "living_arrangement" -> {
            values.joinToString(", ") { ref.option(Lists.LIVING_ARRANGEMENT, it) }
        }

        "work_after_marriage" -> {
            values.joinToString(", ") { ref.option(Lists.WORK_AFTER_MARRIAGE, it) }
        }

        "smoking" -> {
            values.joinToString(", ") { ref.option(Lists.SMOKING, it) }
        }

        else -> {
            values.joinToString(", ")
        }
    }
}

/** "At least 100,000 PKR a month or the equivalent abroad" for a PKR band (05 section 10.3). */
fun incomeMinLabel(
    res: android.content.res.Resources,
    bandLabel: String,
): String {
    val lowest = Regex("^\\s*below\\b", RegexOption.IGNORE_CASE).containsMatchIn(bandLabel)
    val amount = if (lowest) null else Regex("[\\d][\\d,.]*").find(bandLabel)?.value
    return if (amount != null) {
        res.text(R.string.discovery_search_income_option, "amount" to amount)
    } else {
        res.text(R.string.discovery_search_income_option_lowest, "label" to bandLabel)
    }
}
