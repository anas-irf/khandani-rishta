package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.DiscoveryRepository
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.TextStatus
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandDefaults
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.DarkSystemBarIcons
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.KrTopBar
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.SingleChoiceChips
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.exceptBottom
import com.khandanirishta.app.ui.feature.profile.ProfileDetailBody
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.LargeArchShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * "Preview how others see the profile" (specs/08 section 4): a full-screen dialog that loads
 * `GET /v1/me/profile/preview?as=member` (and `as=connection` behind a switch) and renders it with
 * `ProfileDetailBody`. Used by `ME-PROFILE` and `SET-PRIVACY`. The server reduces the profile for
 * the tier; this dialog adds only the owner's notes and has no visibility logic of its own.
 */
@Composable
fun ProfilePreviewDialog(onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        DarkSystemBarIcons()
        PreviewRoute(onDismiss = onDismiss)
    }
}

@Composable
private fun PreviewRoute(
    onDismiss: () -> Unit,
    viewModel: ProfilePreviewViewModel = hiltViewModel(),
) {
    // 08 section 4.2 rule 2: every opening fetches again (a privacy change may have happened).
    DisposableEffect(Unit) {
        viewModel.open()
        onDispose { viewModel.close() }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    ProfilePreviewContent(
        state = state,
        onSwitch = viewModel::switchTo,
        onRetry = viewModel::reload,
        onDismiss = onDismiss,
    )
}

/** The preview without its dialog and view model. Read-only: no control on it changes anything. */
@Composable
internal fun ProfilePreviewContent(
    state: ProfilePreviewUiState,
    onSwitch: (asConnection: Boolean) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val position =
        stringResource(if (state.asConnection) R.string.me_preview_connection else R.string.me_preview_member)
    val detail = state.detail
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            PreviewTopBar(subtitle = text(R.string.me_preview_as, "position" to position), onClose = onDismiss)
        },
        bottomBar = { if (detail != null) PreviewNote() },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding.exceptBottom())
                .consumeWindowInsets(padding)
                .verticalScroll(rememberScrollState())
                // The bands run on behind the note, under its rounded corners.
                .padding(bottom = padding.calculateBottomPadding()),
        ) {
            PreviewHeader(state = state, onSwitch = onSwitch)
            when {
                detail != null -> {
                    ProfileDetailBody(detail = detail)
                }

                state.error != null -> {
                    Band { ErrorState(error = state.error, onRetry = onRetry) }
                }

                else -> {
                    PreviewSkeleton()
                }
            }
        }
    }
}

/** Close, then the title over "Preview as: ...", which wrap rather than being cut. */
@Composable
private fun PreviewTopBar(
    subtitle: String,
    onClose: () -> Unit,
) {
    KrTopBar {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.s4, vertical = Spacing.s8),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s4),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            KrIconButton(
                icon = Icons.Outlined.Close,
                contentDescription = stringResource(R.string.me_preview_close),
                onClick = onClose,
            )
            Column(Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.me_preview_title),
                    style = KrType.name,
                    modifier = Modifier.semantics { heading() },
                )
                CaptionText(
                    text = subtitle,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

/** The switch of 08 section 4 and what only the owner is told. */
@Composable
private fun PreviewHeader(
    state: ProfilePreviewUiState,
    onSwitch: (asConnection: Boolean) -> Unit,
) {
    val member = stringResource(R.string.me_preview_member)
    val connection = stringResource(R.string.me_preview_connection)
    val positions = remember(member, connection) { listOf(false to member, true to connection) }
    val hidden = remember(state.profile) { hiddenTexts(state.profile) }
    val notVisible = state.profile
        ?.status
        ?.takeIf { it != ProfileStatus.ACTIVE }
        ?.let(::profileStatusLabel)
    Band(padding = BandDefaults.compactPadding, maxWidth = Sizes.contentWidth, spacing = Spacing.s12) {
        Column {
            FieldLabel(stringResource(R.string.me_preview_switch_label))
            SingleChoiceChips(
                options = positions,
                selected = state.asConnection,
                onSelect = onSwitch,
                // Each position asks the server.
                enabled = LocalOnline.current,
            )
        }
        if (notVisible != null) {
            StatusBanner(
                text = text(R.string.me_preview_not_visible, "status" to stringResource(notVisible)),
                tone = StatusTone.WARNING,
                icon = Icons.Outlined.VisibilityOff,
            )
        }
        hidden.forEach { title ->
            IconText(
                icon = Icons.Outlined.VisibilityOff,
                text = text(R.string.me_preview_hidden_text, "text" to stringResource(title)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                iconSize = Sizes.iconMedium,
            )
        }
    }
}

/** "This is a preview. ..." in place of the action bar (08 section 4.1). */
@Composable
private fun PreviewNote() {
    KrActionBar(maxWidth = Sizes.contentWidth) {
        IconText(
            icon = Icons.Outlined.Info,
            text = stringResource(R.string.me_preview_banner),
            style = MaterialTheme.typography.bodySmall,
            tint = MaterialTheme.colorScheme.primary,
        )
    }
}

/** Texts that are pending or rejected are absent from the response; the owner sees why. */
private fun hiddenTexts(profile: OwnProfile?): List<Int> {
    if (profile == null) return emptyList()
    return listOf(
        profile.textStatus.aboutMe to R.string.me_profile_moderation_about_me,
        profile.textStatus.aboutFamily to R.string.me_profile_moderation_about_family,
        profile.textStatus.partnerNotes to R.string.me_profile_moderation_partner_notes,
    ).filter { (status, _) -> status == TextStatus.PENDING || status == TextStatus.REJECTED }.map { it.second }
}

/** The shape of the hero: the arch of the gallery, then the name and a line. */
@Composable
private fun PreviewSkeleton() {
    LoadingRegion(Modifier.fillMaxWidth()) {
        Band(tone = BandTone.SAND, maxWidth = Sizes.contentWidth, spacing = Spacing.s16) {
            SkeletonBox(
                modifier =
                    Modifier
                        .align(Alignment.CenterHorizontally)
                        .widthIn(max = Sizes.galleryMax)
                        .fillMaxWidth()
                        .aspectRatio(ARCH_RATIO),
                shape = LargeArchShape,
            )
            SkeletonBox(Modifier.fillMaxWidth(SKELETON_TITLE).height(Spacing.s32))
            SkeletonBox(Modifier.fillMaxWidth(SKELETON_LINE).height(Spacing.s20))
        }
    }
}

private const val SKELETON_TITLE = 0.6f
private const val SKELETON_LINE = 0.8f

@Immutable
data class ProfilePreviewUiState(
    val asConnection: Boolean = false,
    val detail: ProfileDetail? = null,
    val error: ApiError? = null,
    val profile: OwnProfile? = null,
)

/** The preview of 08 section 4: `GET /v1/me/profile/preview?as=member|connection`. */
@HiltViewModel
class ProfilePreviewViewModel
    @Inject
    constructor(
        private val discovery: DiscoveryRepository,
        private val profiles: ProfileRepository,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ProfilePreviewUiState())
        val state: StateFlow<ProfilePreviewUiState> = mutableState.asStateFlow()

        private var loadJob: Job? = null

        /** Whether the dialog is on screen; the view model outlives it inside its screen. */
        private var visible = false

        init {
            viewModelScope.launch {
                profiles.ownProfile.collect { profile -> mutableState.update { it.copy(profile = profile) } }
            }
            viewModelScope.launch {
                invalidation.flow.collect { key ->
                    val relevant = key == DataKey.Privacy || key == DataKey.OwnProfile || key == DataKey.OwnPhotos
                    if (visible && relevant) reload()
                }
            }
        }

        /** Called each time the dialog opens: always the default position, freshly loaded. */
        fun open() {
            visible = true
            mutableState.update { it.copy(asConnection = false, detail = null, error = null) }
            if (profiles.ownProfile.value == null) viewModelScope.launch { profiles.load() }
            reload()
        }

        fun close() {
            visible = false
            loadJob?.cancel()
        }

        fun switchTo(asConnection: Boolean) {
            if (asConnection == mutableState.value.asConnection) return
            mutableState.update { it.copy(asConnection = asConnection, detail = null, error = null) }
            reload()
        }

        fun reload() {
            val tier = if (mutableState.value.asConnection) TIER_CONNECTION else TIER_MEMBER
            loadJob?.cancel()
            loadJob =
                viewModelScope.launch {
                    mutableState.update { it.copy(error = null) }
                    discovery
                        .preview(tier)
                        .onSuccess { detail -> mutableState.update { it.copy(detail = detail, error = null) } }
                        .onFailure { failure ->
                            mutableState.update { if (it.detail == null) it.copy(error = failure.apiError) else it }
                        }
                }
        }

        private companion object {
            const val TIER_MEMBER = "member"
            const val TIER_CONNECTION = "connection"
        }
    }
