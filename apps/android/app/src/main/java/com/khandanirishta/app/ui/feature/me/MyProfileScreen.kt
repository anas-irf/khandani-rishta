package com.khandanirishta.app.ui.feature.me

import android.content.ClipData
import android.content.ClipboardManager
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ManageSearch
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ContactPhone
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FamilyRestroom
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mosque
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.SelfImprovement
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SupervisorAccount
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.TextStatus
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.BadgeIcons
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.PhotoPlaceholder
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.PhotoRequests
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.navigation.Shortlist
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.navigation.Visitors
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Brand
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.navigation.Settings as SettingsKey

/**
 * `ME-PROFILE` (specs/16 section 6.17, specs/08 section 1): the member's own profile at a glance:
 * the header with the main photo and the completeness ring, the profile code, the Me menu of 16
 * section 2.2, the status and moderation banners, the completeness hints, the preview, and a card
 * per editable part. A tab root with the gear icon to `SET-HOME`.
 */
@Composable
fun MyProfileScreen() {
    MyProfileRoute()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MyProfileRoute(viewModel: MyProfileViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    var previewOpen by rememberSaveable { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        viewModel.onVisible()
        onPauseOrDispose { }
    }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    val title = stringResource(R.string.me_profile_title)
    val settingsAction: @Composable RowScope.() -> Unit = {
        IconButton(onClick = { navigator.push(SettingsKey) }) {
            Icon(Icons.Outlined.Settings, contentDescription = stringResource(R.string.me_profile_settings))
        }
    }
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            if (navigator.tabbed) {
                TabTopBar(title = title, actions = settingsAction, scrollBehavior = scrollBehavior)
            } else {
                // Under review the own profile is opened from the gate screen: it has a way back.
                DetailTopBar(
                    title = title,
                    onBack = navigator::back,
                    actions = settingsAction,
                    scrollBehavior = scrollBehavior,
                )
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            val profile = state.profile
            when {
                profile != null -> {
                    PullToRefreshBox(
                        isRefreshing = state.refreshing,
                        onRefresh = { viewModel.load(pull = true) },
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        ProfileContent(
                            state = state,
                            profile = profile,
                            me = me,
                            tabbed = navigator.tabbed,
                            onOpen = { navigator.push(it) },
                            onPreview = { previewOpen = true },
                            onResume = viewModel::resume,
                            onResubmit = viewModel::resubmit,
                            onCopy = viewModel::onLinkCopied,
                        )
                    }
                }

                state.error != null -> {
                    ErrorState(error = state.error, onRetry = { viewModel.load() })
                }

                else -> {
                    ProfileSkeleton()
                }
            }
        }
    }
    if (previewOpen) ProfilePreviewDialog(onDismiss = { previewOpen = false })
}

@Composable
private fun ProfileContent(
    state: MyProfileUiState,
    profile: OwnProfile,
    me: Me,
    tabbed: Boolean,
    onOpen: (AppKey) -> Unit,
    onPreview: () -> Unit,
    onResume: () -> Unit,
    onResubmit: () -> Unit,
    onCopy: (Boolean, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val moderated = moderatedTexts(profile)
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = MeScreenPadding, end = MeScreenPadding, top = 4.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
    ) {
        item(key = "hero") {
            ProfileHero(profile = profile, onOpenPhotos = { onOpen(MyPhotos) }, onCopy = onCopy)
        }
        item(key = "menu") {
            MeMenu(tabbed = tabbed, photoRequests = me.counters.pendingPhotoRequests, onOpen = onOpen)
        }
        if (profile.status in BANNER_STATUSES) {
            item(key = "status") {
                StatusBannerBlock(
                    profile = profile,
                    me = me,
                    state = state,
                    onResume = onResume,
                    onResubmit = onResubmit,
                    onOpen = onOpen,
                )
            }
        }
        moderated.forEach { entry ->
            item(key = "moderation-" + entry.key) { ModerationBanner(moderated = entry, onOpen = onOpen) }
        }
        if (profile.completeness < 100) {
            item(key = "completeness") { CompletenessCard(profile = profile, onOpen = onOpen) }
        }
        item(key = "preview") {
            OutlinedButton(
                onClick = onPreview,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp),
            ) {
                Icon(Icons.Outlined.Visibility, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.me_profile_preview_button))
            }
        }
        item(key = "cards") {
            SectionCards(state = state, profile = profile, onOpen = onOpen)
        }
    }
}

// ---------------------------------------------------------------------------
// Blocks 1 and 2: header and profile code
// ---------------------------------------------------------------------------

@Composable
private fun ProfileHero(
    profile: OwnProfile,
    onOpenPhotos: () -> Unit,
    onCopy: (Boolean, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val basics = profile.basics
    val name = listOfNotNull(basics.firstName, basics.lastName).filter { it.isNotBlank() }.joinToString(" ")
    val age = basics.dateOfBirth?.let { Formatters.ageFrom(it) }
    val city = profile.location.city?.name ?: profile.location.cityOther
    val ageCity =
        when {
            age != null && !city.isNullOrBlank() -> text(R.string.me_profile_age_city, "age" to age, "city" to city)
            age != null -> text(R.string.me_profile_summary_age, "age" to age)
            else -> city?.takeIf { it.isNotBlank() }
        }
    val primary = profile.photos.firstOrNull { it.isPrimary && it.mediumUrl != null }
    Surface(shape = RoundedCornerShape(28.dp), color = Color.Transparent, modifier = modifier.fillMaxWidth()) {
        Box(Modifier.background(KrTheme.colors.heroGradient)) {
            // Two soft circles give the gradient some depth.
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 60.dp, y = (-70).dp)
                    .size(200.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.07f)),
            )
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .offset(x = (-50).dp, y = 40.dp)
                    .size(140.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.05f)),
            )
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                HeroPhoto(
                    url = primary?.mediumUrl,
                    gender = basics.gender,
                    completeness = profile.completeness,
                    onClick = onOpenPhotos,
                )
                Spacer(Modifier.height(if (profile.completeness < 100) 22.dp else 14.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                ) {
                    Text(
                        name,
                        style = MaterialTheme.typography.headlineSmall,
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    BadgeIcons(badges = ownBadges(profile.verification), onPhoto = true)
                }
                if (ageCity != null) {
                    Text(
                        ageCity,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.85f),
                        textAlign = TextAlign.Center,
                    )
                }
                Spacer(Modifier.height(18.dp))
                ProfileCode(code = profile.publicCode, onCopy = onCopy)
            }
        }
    }
}

/** The main photo in a large circle inside the completeness ring; tapping opens `ME-PHOTOS`. */
@Composable
private fun HeroPhoto(
    url: String?,
    gender: Gender?,
    completeness: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val description = stringResource(R.string.me_profile_photo_open)
    val incomplete = completeness < 100
    Box(modifier.size(140.dp), contentAlignment = Alignment.Center) {
        if (incomplete) {
            MeProgressRing(
                progress = completeness / 100f,
                modifier = Modifier.fillMaxSize(),
                color = Brand.AccentLight,
                trackColor = Color.White.copy(alpha = 0.22f),
                strokeWidth = 5.dp,
            )
        }
        Box(
            Modifier
                .size(118.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.18f))
                .border(3.dp, Color.White, CircleShape)
                .clickable(role = Role.Button, onClickLabel = description, onClick = onClick)
                .semantics { contentDescription = description },
        ) {
            val request = rememberStableImageRequest(url)
            if (request != null) {
                AsyncImage(
                    model = request,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                PhotoPlaceholder(gender = gender, modifier = Modifier.fillMaxSize())
            }
        }
        Surface(
            shape = CircleShape,
            color = Color.White,
            shadowElevation = 3.dp,
            modifier =
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 10.dp, bottom = 10.dp)
                    .size(34.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Filled.PhotoCamera,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        if (incomplete) {
            Surface(
                shape = CircleShape,
                color = Brand.AccentLight,
                contentColor = Color.White,
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .offset(y = 12.dp)
                        .clearAndSetSemantics { },
            ) {
                Text(
                    text(R.string.me_android_percent, "value" to completeness),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp),
                )
            }
        }
    }
}

/** Block 2: `public_code` with "Copy link" (the link `/p/{code}` that opens the profile). */
@Composable
private fun ProfileCode(
    code: String,
    onCopy: (Boolean, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val copyLabel = text(R.string.me_profile_code_copy_label, "code" to code)
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            color = Color.White.copy(alpha = 0.14f),
            shape = RoundedCornerShape(18.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.me_profile_code_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White.copy(alpha = 0.8f),
                    )
                    Text(
                        code,
                        style =
                            MaterialTheme.typography.titleMedium.copy(
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = 1.sp,
                            ),
                        color = Color.White,
                    )
                }
                FilledTonalButton(
                    onClick = {
                        val link = AppConfig.fromBuildConfig().webPage("p/$code")
                        val clipboard = context.getSystemService(ClipboardManager::class.java)
                        val copied =
                            clipboard != null &&
                                runCatching { clipboard.setPrimaryClip(ClipData.newPlainText(code, link)) }.isSuccess
                        onCopy(copied, code)
                    },
                    colors =
                        ButtonDefaults.filledTonalButtonColors(
                            containerColor = Color.White,
                            contentColor = MaterialTheme.colorScheme.primary,
                        ),
                    modifier = Modifier.semantics { contentDescription = copyLabel },
                ) {
                    Icon(Icons.Outlined.ContentCopy, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.me_profile_code_copy))
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.me_profile_code_help),
            style = MaterialTheme.typography.bodySmall,
            color = Color.White.copy(alpha = 0.85f),
            textAlign = TextAlign.Center,
        )
    }
}

/** The Me menu of 16 section 2.2. Under review only "Settings" can be opened (16 section 3.2). */
@Composable
private fun MeMenu(
    tabbed: Boolean,
    photoRequests: Long,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    MeSurfaceCard(modifier = modifier, contentPadding = PaddingValues(vertical = 4.dp), spacing = 0.dp) {
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
                badge = photoRequests,
            )
            RowDivider()
        }
        NavRow(
            title = stringResource(R.string.me_profile_menu_settings),
            onClick = { onOpen(SettingsKey) },
            icon = Icons.Outlined.Settings,
        )
    }
}

// ---------------------------------------------------------------------------
// Block 3: status banners (08 section 1.2) and moderated texts (08 section 1.4)
// ---------------------------------------------------------------------------

private val BANNER_STATUSES =
    setOf(ProfileStatus.PAUSED, ProfileStatus.CLOSED, ProfileStatus.PENDING_REVIEW, ProfileStatus.CHANGES_REQUESTED)

@Composable
private fun StatusBannerBlock(
    profile: OwnProfile,
    me: Me,
    state: MyProfileUiState,
    onResume: () -> Unit,
    onResubmit: () -> Unit,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (profile.status) {
        ProfileStatus.PAUSED -> {
            MeNotice(
                text = stringResource(R.string.me_profile_banner_paused),
                tone = MeNoticeTone.WARNING,
                icon = Icons.Outlined.PauseCircle,
                modifier = modifier,
            ) {
                OutlinedButton(onClick = onResume, enabled = !state.resuming) {
                    if (state.resuming) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(stringResource(R.string.me_profile_banner_paused_action))
                }
            }
        }

        ProfileStatus.CLOSED -> {
            MeNotice(
                text = stringResource(R.string.me_profile_banner_closed),
                icon = Icons.Outlined.Lock,
                modifier = modifier,
            ) {
                OutlinedButton(onClick = { onOpen(AccountSettings) }) {
                    Text(stringResource(R.string.me_profile_banner_closed_action))
                }
            }
        }

        ProfileStatus.PENDING_REVIEW -> {
            MeNotice(
                text = stringResource(R.string.me_profile_banner_pending_review),
                icon = Icons.Outlined.HourglassTop,
                modifier = modifier,
            )
        }

        ProfileStatus.CHANGES_REQUESTED -> {
            val reason = profile.statusReason ?: me.profile.statusReason
            MeNotice(
                text = stringResource(R.string.me_profile_banner_changes_requested),
                tone = MeNoticeTone.WARNING,
                icon = Icons.Outlined.EditNote,
                modifier = modifier,
            ) {
                if (!reason.isNullOrBlank()) {
                    Text(reason, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                }
                state.resubmitErrors.forEach { message ->
                    Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
                Button(onClick = onResubmit, enabled = !state.resubmitting) {
                    if (state.resubmitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(stringResource(R.string.me_profile_banner_resubmit))
                }
            }
        }

        else -> {}
    }
}

/** A moderated text of 08 section 1.4 and where it is edited. */
private data class ModeratedText(
    val key: String,
    @param:StringRes val title: Int,
    val status: TextStatus,
    val target: AppKey,
)

private fun moderatedTexts(profile: OwnProfile): List<ModeratedText> =
    listOf(
        ModeratedText(
            key = "about_me",
            title = R.string.me_profile_moderation_about_me,
            status = profile.textStatus.aboutMe,
            target = EditSection(ME_SECTION_LIFESTYLE),
        ),
        ModeratedText(
            key = "about_family",
            title = R.string.me_profile_moderation_about_family,
            status = profile.textStatus.aboutFamily,
            target = EditSection(ME_SECTION_FAMILY),
        ),
        ModeratedText(
            key = "partner_notes",
            title = R.string.me_profile_moderation_partner_notes,
            status = profile.textStatus.partnerNotes,
            target = MyPreferences,
        ),
    ).filter { it.status == TextStatus.PENDING || it.status == TextStatus.REJECTED }

@Composable
private fun ModerationBanner(
    moderated: ModeratedText,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(moderated.title)
    val fix = text(R.string.me_profile_moderation_fix, "text" to title)
    MeNotice(
        title = title,
        text = moderationLabel(moderated.status),
        tone = if (moderated.status == TextStatus.REJECTED) MeNoticeTone.DANGER else MeNoticeTone.INFO,
        modifier = modifier,
    ) {
        TextButton(onClick = { onOpen(moderated.target) }) { Text(fix) }
    }
}

/** The owner-only label of a moderated text (08 section 1.4); nothing when approved. */
@Composable
private fun moderationLabel(status: TextStatus): String? =
    when (status) {
        TextStatus.PENDING -> stringResource(R.string.me_profile_moderation_pending)
        TextStatus.REJECTED -> stringResource(R.string.me_profile_moderation_rejected)
        TextStatus.APPROVED, TextStatus.UNKNOWN -> null
    }

// ---------------------------------------------------------------------------
// Block 4: completeness (08 section 6)
// ---------------------------------------------------------------------------

@Composable
private fun CompletenessCard(
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val hints = completenessHints(profile)
    val value = profile.completeness.coerceIn(0, 100)
    MeSurfaceCard(modifier = modifier, spacing = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                MeProgressRing(progress = value / 100f, modifier = Modifier.fillMaxSize(), strokeWidth = 7.dp)
                Text(
                    text(R.string.me_android_percent, "value" to value),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.clearAndSetSemantics { },
                )
            }
            Spacer(Modifier.width(16.dp))
            Text(
                text(R.string.me_profile_completeness_line, "value" to value),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
        }
        if (hints.isNotEmpty()) {
            Text(
                stringResource(R.string.me_profile_completeness_hints),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column {
                hints.forEachIndexed { index, hint ->
                    if (index > 0) RowDivider(Modifier.padding(start = 20.dp))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable(role = Role.Button) { onOpen(hint.target) }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.AutoAwesome,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.tertiary,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            stringResource(hint.label),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Block 6: section cards (08 section 1.3)
// ---------------------------------------------------------------------------

@Composable
private fun SectionCards(
    state: MyProfileUiState,
    profile: OwnProfile,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val res = LocalResources.current
    val edit = stringResource(R.string.me_profile_actions_edit)
    val add = stringResource(R.string.me_profile_actions_add)
    val open = stringResource(R.string.me_profile_actions_open)
    val basics = profile.basics
    val community = profile.community
    val location = profile.location
    val education = profile.educationCareer
    val family = profile.family
    val lifestyle = profile.lifestyle
    val privacy = state.privacy
    val age = basics.dateOfBirth?.let { Formatters.ageFrom(it) }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SummaryCard(
            icon = Icons.Outlined.PhotoLibrary,
            title = stringResource(R.string.me_profile_cards_photos),
            action = stringResource(R.string.me_profile_actions_manage),
            onClick = { onOpen(MyPhotos) },
        ) {
            val thumbs = profile.photos.filter { it.thumbUrl != null }.take(3)
            if (thumbs.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                    thumbs.forEachIndexed { index, photo ->
                        AsyncImage(
                            model = rememberStableImageRequest(photo.thumbUrl),
                            contentDescription = text(R.string.me_profile_summary_photo_thumb, "position" to index + 1),
                            contentScale = ContentScale.Crop,
                            modifier =
                                Modifier
                                    .size(56.dp)
                                    .clip(MaterialTheme.shapes.small)
                                    .background(MaterialTheme.colorScheme.surfaceContainerHigh),
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

        SummaryCard(
            icon = Icons.Outlined.Person,
            title = stringResource(R.string.me_profile_cards_basics),
            action = edit,
            onClick = { onOpen(EditSection(ME_SECTION_BASICS)) },
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

        SummaryCard(
            icon = Icons.Outlined.Mosque,
            title = stringResource(R.string.me_profile_cards_community),
            action = edit,
            onClick = { onOpen(EditSection(ME_SECTION_COMMUNITY)) },
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

        SummaryCard(
            icon = Icons.Outlined.LocationOn,
            title = stringResource(R.string.me_profile_cards_location),
            action = edit,
            onClick = { onOpen(EditSection(ME_SECTION_LOCATION)) },
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

        SummaryCard(
            icon = Icons.Outlined.School,
            title = stringResource(R.string.me_profile_cards_education_career),
            action = edit,
            onClick = { onOpen(EditSection(ME_SECTION_EDUCATION)) },
        ) {
            SummaryLines(
                listOf(
                    reference.educationLevel(education.educationLevelCode),
                    education.professionCode?.let { reference.profession(it) }
                        ?: reference.option(Lists.EMPLOYMENT_TYPE, education.employmentType),
                ),
            )
        }

        SummaryCard(
            icon = Icons.Outlined.FamilyRestroom,
            title = stringResource(R.string.me_profile_cards_family),
            action = if (familyIsEmpty(family)) add else edit,
            onClick = { onOpen(EditSection(ME_SECTION_FAMILY)) },
        ) {
            SummaryLines(
                listOf(
                    joinSummaryParts(
                        family.fatherStatus?.let {
                            text(
                                R.string.me_profile_summary_father,
                                "value" to reference.option(Lists.PARENT_STATUS, it),
                            )
                        },
                        family.motherStatus?.let {
                            text(
                                R.string.me_profile_summary_mother,
                                "value" to reference.option(Lists.PARENT_STATUS, it),
                            )
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
            ModerationLabel(profile.textStatus.aboutFamily)
        }

        SummaryCard(
            icon = Icons.Outlined.SelfImprovement,
            title = stringResource(R.string.me_profile_cards_lifestyle),
            action = if (lifestyleIsEmpty(lifestyle)) add else edit,
            onClick = { onOpen(EditSection(ME_SECTION_LIFESTYLE)) },
        ) {
            SummaryLines(listOf(reference.option(Lists.RELIGIOSITY, lifestyle.religiosity)))
            summaryExcerpt(lifestyle.aboutMe)?.let { about ->
                Text(
                    about,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            ModerationLabel(profile.textStatus.aboutMe)
        }

        SummaryCard(
            icon = Icons.AutoMirrored.Outlined.ManageSearch,
            title = stringResource(R.string.me_profile_cards_preferences),
            action = edit,
            onClick = { onOpen(MyPreferences) },
        ) {
            val preferences = state.preferences
            when {
                preferences != null -> {
                    val musts = profileMustHaveCount(preferences)
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

                state.preferencesLoading -> {
                    LineSkeleton()
                }

                else -> {
                    SummaryLines(emptyList())
                }
            }
            ModerationLabel(profile.textStatus.partnerNotes)
        }

        val verification = profile.verification
        val verified = stringResource(R.string.me_profile_summary_state_verified)
        val pending = stringResource(R.string.me_profile_summary_state_pending)
        val notVerified = stringResource(R.string.me_profile_summary_state_not_verified)

        fun stateOf(
            done: Boolean,
            waiting: Boolean,
        ): String =
            when {
                done -> verified
                waiting -> pending
                else -> notVerified
            }
        SummaryCard(
            icon = Icons.Outlined.VerifiedUser,
            title = stringResource(R.string.me_profile_cards_verification),
            action = open,
            onClick = { onOpen(Verification) },
        ) {
            SummaryLines(
                listOf(
                    text(
                        R.string.me_profile_summary_id,
                        "state" to stateOf(verification.idVerified, verification.pending.idDocument),
                    ),
                    text(
                        R.string.me_profile_summary_photo_check,
                        "state" to stateOf(verification.photoVerified, verification.pending.selfie),
                    ),
                    text(
                        R.string.me_profile_summary_phone,
                        "state" to
                            stringResource(
                                if (verification.phoneVerified) {
                                    R.string.me_profile_summary_state_confirmed
                                } else {
                                    R.string.me_profile_summary_state_not_confirmed
                                },
                            ),
                    ),
                ),
            )
        }

        val contactsAdded = hasContactDetails(profile.contacts)
        SummaryCard(
            icon = Icons.Outlined.ContactPhone,
            title = stringResource(R.string.me_profile_cards_contacts),
            action = if (contactsAdded) edit else add,
            onClick = { onOpen(ContactDetails()) },
        ) {
            val added = if (contactsAdded) stringResource(R.string.me_profile_summary_contacts_added) else null
            SummaryLines(listOf(added))
        }

        SummaryCard(
            icon = Icons.Outlined.SupervisorAccount,
            title = stringResource(R.string.me_profile_cards_account_for),
            action = edit,
            onClick = { onOpen(EditSection(ME_SECTION_ACCOUNT_FOR)) },
        ) {
            val managedBy = reference.option(Lists.MANAGED_BY, profile.accountFor.managedBy)
            val manager = profile.accountFor.managerName
            SummaryLines(
                listOf(
                    if (!manager.isNullOrBlank()) {
                        text(R.string.me_profile_summary_manager, "label" to managedBy, "name" to manager)
                    } else {
                        managedBy
                    },
                ),
            )
        }

        SummaryCard(
            icon = Icons.Outlined.Shield,
            title = stringResource(R.string.me_profile_cards_privacy),
            action = open,
            onClick = { onOpen(PrivacySettings) },
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

                state.privacyLoading -> {
                    LineSkeleton()
                }

                else -> {
                    SummaryLines(emptyList())
                }
            }
        }
    }
}

/** One section card: icon, title, the summary, and its control ("Edit", "Add", "Manage", "Open"). */
@Composable
private fun SummaryCard(
    icon: ImageVector,
    title: String,
    action: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val description = text(R.string.me_profile_actions_named, "action" to action, "title" to title)
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            MeIconBubble(icon = icon, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                content()
            }
            Spacer(Modifier.width(8.dp))
            Row(
                Modifier
                    .padding(top = 2.dp)
                    .semantics { contentDescription = description },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    action,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

/** The saved values of a card, or "Not added yet". */
@Composable
private fun SummaryLines(
    lines: List<String?>,
    modifier: Modifier = Modifier,
) {
    val shown = lines.filterNotNull().filter { it.isNotBlank() }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (shown.isEmpty()) {
            Text(
                stringResource(R.string.me_profile_not_added),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            shown.forEach { line ->
                Text(line, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/** The moderation label under a card whose text is pending or rejected (08 section 1.4). */
@Composable
private fun ModerationLabel(
    status: TextStatus,
    modifier: Modifier = Modifier,
) {
    val label = moderationLabel(status) ?: return
    val rejected = status == TextStatus.REJECTED
    Surface(
        color = if (rejected) MaterialTheme.colorScheme.errorContainer else KrTheme.colors.warningContainer,
        contentColor =
            if (rejected) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.small,
        modifier = modifier.padding(top = 4.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun LineSkeleton(modifier: Modifier = Modifier) {
    SkeletonBox(
        modifier
            .padding(vertical = 4.dp)
            .width(160.dp)
            .height(16.dp),
    )
}

/** Loading: the header and four cards (08 section 1.5). */
@Composable
private fun ProfileSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = MeScreenPadding, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
    ) {
        SkeletonBox(
            Modifier
                .fillMaxWidth()
                .height(300.dp),
            corner = 28.dp,
        )
        repeat(4) {
            SkeletonBox(
                Modifier
                    .fillMaxWidth()
                    .height(96.dp),
                corner = 18.dp,
            )
        }
    }
}
