package com.khandanirishta.app.ui.feature.me

import android.content.ClipData
import android.content.ClipboardManager
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.TextStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.BadgeRow
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberPhoto
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.PhotoSize
import com.khandanirishta.app.ui.components.ProgressRing
import com.khandanirishta.app.ui.components.QuoteBlock
import com.khandanirishta.app.ui.components.RingKind
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.PhotoRequests
import com.khandanirishta.app.ui.navigation.Shortlist
import com.khandanirishta.app.ui.navigation.Visitors
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.navigation.Settings as SettingsKey

/** What the parts of `ME-PROFILE` can do; they get these instead of the view model. */
@Immutable
internal class MyProfileActions(
    val back: () -> Unit,
    val open: (AppKey) -> Unit,
    val refresh: () -> Unit,
    val retry: () -> Unit,
    val preview: () -> Unit,
    val resume: () -> Unit,
    val resubmit: () -> Unit,
    val copied: (Boolean, String) -> Unit,
)

// ---------------------------------------------------------------------------
// Blocks 1 and 2: header and profile code
// ---------------------------------------------------------------------------

/** The sand band: the own photo in an arch, the name, age and city, the badges, then the code. */
@Composable
internal fun ProfileHeader(
    profile: OwnProfile,
    onOpenPhotos: () -> Unit,
    onCopy: (Boolean, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val basics = profile.basics
    val name =
        remember(basics.firstName, basics.lastName) {
            listOfNotNull(basics.firstName, basics.lastName).filter { it.isNotBlank() }.joinToString(" ")
        }
    val age = remember(basics.dateOfBirth) { basics.dateOfBirth?.let { Formatters.ageFrom(it) } }
    val city = (profile.location.city?.name ?: profile.location.cityOther)?.takeIf { it.isNotBlank() }
    val ageCity =
        when {
            age != null && city != null -> text(R.string.me_profile_age_city, "age" to age, "city" to city)
            age != null -> text(R.string.me_profile_summary_age, "age" to age)
            else -> city
        }
    val badges = remember(profile.verification) { ownBadges(profile.verification) }
    Band(tone = BandTone.SAND, padding = HeaderPadding, spacing = Spacing.s16, modifier = modifier) {
        AdaptiveRow(spacing = Spacing.gutter, lineSpacing = Spacing.s12) {
            OwnArch(profile = profile, name = name, onClick = onOpenPhotos)
            Column(Modifier.grow(basis = NameBasis), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                MemberText(
                    text = name,
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() },
                )
                if (ageCity != null) Text(ageCity, color = KrTheme.colors.textSecondary)
                BadgeRow(badges, Modifier.padding(top = Spacing.s8))
            }
        }
        ProfileCode(code = profile.publicCode, onCopy = onCopy)
    }
}

/** The main photo at 96 x 120, or the lattice with the monogram. It opens `ME-PHOTOS`. */
@Composable
private fun OwnArch(
    profile: OwnProfile,
    name: String,
    onClick: () -> Unit,
) {
    val url = remember(profile.photos) { profile.photos.firstOrNull { it.isPrimary }?.mediumUrl }
    val open = stringResource(R.string.me_profile_photo_open)
    val none = stringResource(R.string.me_profile_photo_none)
    val description = if (url == null) "$open. $none" else open
    Box(
        Modifier
            .semantics { contentDescription = description }
            .tappable(shape = ArchShape, onClick = onClick)
            .size(Sizes.arch96),
    ) {
        OwnPhotoImage(
            url = url,
            description = null,
            modifier = Modifier.matchParentSize(),
            placeholder = {
                MemberPhoto(
                    photo = null,
                    name = name,
                    gender = profile.basics.gender,
                    size = PhotoSize.THUMB,
                    decorative = true,
                    monogramSize = OwnMonogram,
                    modifier = Modifier.matchParentSize(),
                )
            },
        )
    }
}

/** Block 2: `public_code` with "Copy link" (the link `/p/{code}` that opens the profile). */
@Composable
private fun ProfileCode(
    code: String,
    onCopy: (Boolean, String) -> Unit,
) {
    val context = LocalContext.current
    val copyLabel = text(R.string.me_profile_code_copy_label, "code" to code)
    val codeStyle =
        MaterialTheme.typography.titleMedium
            .merge(KrType.numbers)
            .copy(fontWeight = FontWeight.Bold, textDirection = TextDirection.Ltr)
    TonalPanel(shape = MaterialTheme.shapes.extraLarge, padding = CodePadding, spacing = Spacing.s4) {
        AdaptiveRow(lineSpacing = Spacing.s8) {
            FlowRow(
                modifier =
                    Modifier
                        .grow(basis = CodeBasis)
                        .semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.me_profile_code_label),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(code, style = codeStyle)
            }
            KrButton(
                text = stringResource(R.string.me_profile_code_copy),
                onClick = {
                    val link = AppConfig.fromBuildConfig().webPage("p/$code")
                    val clipboard = context.getSystemService(ClipboardManager::class.java)
                    val copied =
                        clipboard != null &&
                            runCatching { clipboard.setPrimaryClip(ClipData.newPlainText(code, link)) }.isSuccess
                    onCopy(copied, code)
                },
                variant = KrButtonVariant.QUIET,
                size = KrButtonSize.COMPACT,
                icon = Icons.Outlined.ContentCopy,
                contentDescription = copyLabel,
            )
        }
        CaptionText(stringResource(R.string.me_profile_code_help))
    }
}

// ---------------------------------------------------------------------------
// The Me menu (16 section 2.2)
// ---------------------------------------------------------------------------

/** Under review only "Settings" can be opened (16 section 3.2). */
@Composable
internal fun MeMenu(
    tabbed: Boolean,
    photoRequests: Long,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        if (tabbed) {
            NavRow(
                title = stringResource(R.string.me_profile_menu_shortlist),
                onClick = { onOpen(Shortlist) },
                icon = Icons.Outlined.FavoriteBorder,
            )
            RowDivider()
            NavRow(
                title = stringResource(R.string.me_profile_menu_visitors),
                onClick = { onOpen(Visitors) },
                icon = Icons.Outlined.Visibility,
            )
            RowDivider()
            NavRow(
                title = stringResource(R.string.me_profile_menu_photo_requests),
                onClick = { onOpen(PhotoRequests()) },
                icon = Icons.Outlined.PhotoLibrary,
                // The diamond of the Me destination, here with the count in words beside it.
                subtitle =
                    if (photoRequests > 0) {
                        text(R.string.common_nav_badge_count, "count" to Formatters.badgeCount(photoRequests))
                    } else {
                        null
                    },
                dot = photoRequests > 0,
            )
            RowDivider()
        }
        NavRow(
            title = stringResource(R.string.me_profile_menu_settings),
            onClick = { onOpen(SettingsKey) },
            icon = Icons.Outlined.Settings,
        )
        RowDivider()
    }
}

// ---------------------------------------------------------------------------
// Block 3: status banners (08 section 1.2) and moderated texts (08 section 1.4)
// ---------------------------------------------------------------------------

/** One banner chosen by the profile's status, or none. */
@Composable
internal fun ProfileStatusBanner(
    state: MyProfileUiState,
    profile: OwnProfile,
    me: Me,
    actions: MyProfileActions,
) {
    val online = LocalOnline.current
    when (profile.status) {
        ProfileStatus.PAUSED -> {
            StatusBanner(
                text = stringResource(R.string.me_profile_banner_paused),
                tone = StatusTone.WARNING,
                icon = Icons.Outlined.PauseCircle,
            ) {
                KrButton(
                    text = stringResource(R.string.me_profile_banner_paused_action),
                    onClick = actions.resume,
                    variant = KrButtonVariant.SECONDARY,
                    enabled = online,
                    loading = state.resuming,
                    modifier = Modifier.padding(top = Spacing.s8),
                )
            }
        }

        ProfileStatus.CLOSED -> {
            StatusBanner(
                text = stringResource(R.string.me_profile_banner_closed),
                icon = Icons.Outlined.Lock,
                actionLabel = stringResource(R.string.me_profile_banner_closed_action),
                onAction = { actions.open(AccountSettings) },
            )
        }

        ProfileStatus.PENDING_REVIEW -> {
            StatusBanner(
                text = stringResource(R.string.me_profile_banner_pending_review),
                icon = Icons.Outlined.Schedule,
            )
        }

        ProfileStatus.CHANGES_REQUESTED -> {
            StatusBanner(
                text = stringResource(R.string.me_profile_banner_changes_requested),
                tone = StatusTone.WARNING,
                icon = Icons.Outlined.EditNote,
            ) {
                QuoteBlock(
                    text = profile.statusReason ?: me.profile.statusReason,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                )
                state.resubmitErrors.forEach { message ->
                    IconText(
                        icon = Icons.Outlined.ErrorOutline,
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
                KrButton(
                    text = stringResource(R.string.me_profile_banner_resubmit),
                    onClick = actions.resubmit,
                    enabled = online,
                    loading = state.resubmitting,
                    modifier = Modifier.padding(top = Spacing.s8),
                )
            }
        }

        else -> {}
    }
}

/** A moderated text of 08 section 1.4 and where it is edited. */
@Immutable
internal data class ModeratedText(
    @param:StringRes val title: Int,
    val status: TextStatus,
    val target: AppKey,
)

/** The texts that are waiting or were refused. An approved text has no label. */
internal fun moderatedTexts(profile: OwnProfile): List<ModeratedText> =
    listOf(
        ModeratedText(
            title = R.string.me_profile_moderation_about_me,
            status = profile.textStatus.aboutMe,
            target = EditSection(ME_SECTION_LIFESTYLE),
        ),
        ModeratedText(
            title = R.string.me_profile_moderation_about_family,
            status = profile.textStatus.aboutFamily,
            target = EditSection(ME_SECTION_FAMILY),
        ),
        ModeratedText(
            title = R.string.me_profile_moderation_partner_notes,
            status = profile.textStatus.partnerNotes,
            target = MyPreferences,
        ),
    ).filter { it.status == TextStatus.PENDING || it.status == TextStatus.REJECTED }

@Composable
internal fun ModerationBanner(
    moderated: ModeratedText,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val rejected = moderated.status == TextStatus.REJECTED
    val title = stringResource(moderated.title)
    val label = if (rejected) R.string.me_profile_moderation_rejected else R.string.me_profile_moderation_pending
    StatusBanner(
        title = title,
        text = stringResource(label),
        tone = if (rejected) StatusTone.DANGER else StatusTone.INFO,
        icon = if (rejected) Icons.Outlined.ErrorOutline else Icons.Outlined.Schedule,
        modifier = modifier,
    ) {
        KrTextLink(
            text = text(R.string.me_profile_moderation_fix, "text" to title),
            onClick = { onOpen(moderated.target) },
        )
    }
}

// ---------------------------------------------------------------------------
// Block 4: completeness (08 section 6)
// ---------------------------------------------------------------------------

/** The ring and its line, then up to three next steps. */
@Composable
internal fun CompletenessPanel(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val hints = remember(profile.missing, profile.onboardingStep) { completenessHints(profile) }
    val line = text(R.string.me_profile_completeness_line, "value" to profile.completeness.coerceIn(0, MAX_PERCENT))
    TonalPanel(modifier = modifier, padding = CompletenessPadding, spacing = Spacing.s12) {
        AdaptiveRow(spacing = Spacing.gutter, lineSpacing = Spacing.s12) {
            // Decoration: the same number is in the line beside it.
            Box(Modifier.clearAndSetSemantics {}) {
                ProgressRing(value = profile.completeness, kind = RingKind.COMPLETENESS, description = line)
            }
            Text(
                text = line,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.grow(basis = NameBasis).semantics { heading() },
            )
        }
        if (hints.isNotEmpty()) {
            Column(Modifier.fillMaxWidth()) {
                Text(
                    text = stringResource(R.string.me_profile_completeness_hints),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = Spacing.s4),
                )
                hints.forEach { hint ->
                    RowDivider()
                    NavRow(title = stringResource(hint.label), onClick = { onOpen(hint.target) })
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Loading (08 section 1.5): the header and four groups
// ---------------------------------------------------------------------------

@Composable
internal fun MyProfileSkeleton(modifier: Modifier = Modifier) {
    LoadingRegion(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState(), enabled = false),
        spacing = Spacing.gutter,
    ) {
        Band(tone = BandTone.SAND, padding = HeaderPadding, spacing = Spacing.s16) {
            AdaptiveRow(spacing = Spacing.gutter) {
                SkeletonBox(Modifier.size(Sizes.arch96), shape = ArchShape)
                Column(Modifier.grow(basis = NameBasis), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
                    SkeletonBox(Modifier.fillMaxWidth(SKELETON_TITLE).height(Spacing.s32))
                    SkeletonBox(Modifier.fillMaxWidth(SKELETON_LINE).height(Spacing.s20))
                }
            }
            SkeletonBox(Modifier.fillMaxWidth().height(Sizes.switchRow), shape = MaterialTheme.shapes.extraLarge)
        }
        Band(padding = BandDefaults.compactPadding, spacing = Spacing.s32) {
            repeat(SKELETON_GROUPS) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                    SkeletonBox(Modifier.fillMaxWidth(SKELETON_LINE).height(Spacing.s24))
                    SkeletonBox(Modifier.fillMaxWidth(SKELETON_TITLE).height(Spacing.s20))
                }
            }
        }
    }
}

private val HeaderPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s12, end = Spacing.gutter, bottom = Spacing.s24)
private val CodePadding = PaddingValues(horizontal = Spacing.s16, vertical = Spacing.s12)
private val CompletenessPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s24)
private val NameBasis = 160.dp
private val CodeBasis = 140.dp
private val OwnMonogram = 34.dp
private const val MAX_PERCENT = 100
private const val SKELETON_TITLE = 0.7f
private const val SKELETON_LINE = 0.4f
private const val SKELETON_GROUPS = 4
