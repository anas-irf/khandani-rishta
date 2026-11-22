package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * `ME-PHOTOS` (specs/16 section 6.19, specs/08 section 5.5): add, order and remove the own
 * photos and see their review status. Block 1 is the privacy line with "Change", on sand; the
 * grid, the rejection messages and the photo guidelines come from [PhotoManager].
 */
@Composable
fun MyPhotosScreen() {
    MyPhotosRoute()
}

@Composable
private fun MyPhotosRoute(viewModel: MyPhotosViewModel = hiltViewModel()) {
    val navigator = LocalNavigator.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    MyPhotosContent(
        state = state,
        onBack = navigator::back,
        onChangePrivacy = { navigator.push(PrivacySettings) },
    ) {
        PhotoManager()
    }
}

/** The screen without its view models: [manager] is the grid and what follows it. */
@Composable
internal fun MyPhotosContent(
    state: MyPhotosUiState,
    onBack: () -> Unit,
    onChangePrivacy: () -> Unit,
    modifier: Modifier = Modifier,
    manager: @Composable () -> Unit,
) {
    MeScaffold(title = stringResource(R.string.photos_screen_title), onBack = onBack, modifier = modifier) {
        if (state.privacy != null || state.loading) {
            Band(tone = BandTone.SAND, padding = PrivacyPadding, maxWidth = Sizes.formWidth) {
                PrivacyLine(privacy = state.privacy, onChange = onChangePrivacy)
            }
        }
        Band(maxWidth = Sizes.formWidth) { manager() }
    }
}

/** Block 1: "Who can see the photos: {label}" with "Change" (09 section 3.2). */
@Composable
private fun PrivacyLine(
    privacy: Privacy?,
    onChange: () -> Unit,
) {
    if (privacy == null) {
        LoadingRegion(Modifier.fillMaxWidth()) {
            SkeletonBox(Modifier.fillMaxWidth(LINE_SHARE).height(Sizes.touch))
        }
        return
    }
    val label = LocalReference.current.option(Lists.PHOTO_VISIBILITY, privacy.photoVisibility)
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        IconText(
            icon = Icons.Outlined.Lock,
            text = text(R.string.photos_screen_privacy_line, "label" to label),
            style = MaterialTheme.typography.bodySmall,
            color = KrTheme.colors.textSecondary,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        KrTextLink(stringResource(R.string.photos_screen_privacy_change), onChange)
    }
}

@Immutable
data class MyPhotosUiState(
    val privacy: Privacy? = null,
    val loading: Boolean = true,
)

/** The privacy line of `ME-PHOTOS`: `GET /v1/me/privacy`, again after a privacy change. */
@HiltViewModel
class MyPhotosViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(MyPhotosUiState())
        val state: StateFlow<MyPhotosUiState> = mutableState.asStateFlow()

        init {
            load()
            viewModelScope.launch { invalidation.on(DataKey.Privacy).collect { load() } }
        }

        private fun load() {
            viewModelScope.launch {
                val privacy = profiles.privacy().getOrNull()
                mutableState.update { it.copy(privacy = privacy ?: it.privacy, loading = false) }
            }
        }
    }

private val PrivacyPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s12)
private const val LINE_SHARE = 0.75f
