package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.feature.profile.ProfileDetailBody
import com.khandanirishta.app.ui.text.text
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
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        PreviewContent(onDismiss = onDismiss)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PreviewContent(
    onDismiss: () -> Unit,
    viewModel: ProfilePreviewViewModel = hiltViewModel(),
) {
    // 08 section 4.2 rule 2: every opening fetches again (a privacy change may have happened).
    DisposableEffect(Unit) {
        viewModel.open()
        onDispose { viewModel.close() }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val position =
        stringResource(if (state.asConnection) R.string.me_preview_connection else R.string.me_preview_member)
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            stringResource(R.string.me_preview_title),
                            style = MaterialTheme.typography.titleLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text(R.string.me_preview_as, "position" to position),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.me_preview_close))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                windowInsets = WindowInsets(0, 0, 0, 0),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        modifier = Modifier.fillMaxSize(),
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            PreviewHeader(
                asConnection = state.asConnection,
                status = state.profile?.status,
                hidden = hiddenTexts(state.profile),
                onSwitch = viewModel::switchTo,
            )
            val detail = state.detail
            when {
                detail != null -> {
                    MeNotice(
                        text = stringResource(R.string.me_preview_banner),
                        icon = Icons.Outlined.Info,
                        modifier = Modifier.padding(horizontal = MeScreenPadding),
                    )
                    ProfileDetailBody(detail = detail, modifier = Modifier.padding(top = 12.dp))
                }

                state.error != null -> {
                    ErrorState(error = state.error, onRetry = viewModel::reload)
                }

                else -> {
                    PreviewSkeleton()
                }
            }
        }
    }
}

@Composable
private fun PreviewHeader(
    asConnection: Boolean,
    status: ProfileStatus?,
    hidden: List<Int>,
    onSwitch: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val switchLabel = stringResource(R.string.me_preview_switch_label)
    Column(
        modifier
            .fillMaxWidth()
            .padding(start = MeScreenPadding, end = MeScreenPadding, top = 4.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = switchLabel },
        ) {
            SegmentedButton(
                selected = !asConnection,
                onClick = { onSwitch(false) },
                shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                label = { Text(stringResource(R.string.me_preview_member)) },
            )
            SegmentedButton(
                selected = asConnection,
                onClick = { onSwitch(true) },
                shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                label = { Text(stringResource(R.string.me_preview_connection)) },
            )
        }
        val notVisible = status?.takeIf { it != ProfileStatus.ACTIVE }?.let { profileStatusLabel(it) }
        if (notVisible != null) {
            MeNotice(
                text = text(R.string.me_preview_not_visible, "status" to stringResource(notVisible)),
                tone = MeNoticeTone.WARNING,
                icon = Icons.Outlined.VisibilityOff,
            )
        }
        hidden.forEach { title ->
            Text(
                text(R.string.me_preview_hidden_text, "text" to stringResource(title)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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

@Composable
private fun PreviewSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier.padding(MeScreenPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SkeletonBox(
            Modifier
                .fillMaxWidth()
                .aspectRatio(0.9f),
            corner = 20.dp,
        )
        SkeletonBox(
            Modifier
                .fillMaxWidth(0.6f)
                .height(24.dp),
        )
        SkeletonBox(
            Modifier
                .fillMaxWidth(0.8f)
                .height(16.dp),
        )
    }
}

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
