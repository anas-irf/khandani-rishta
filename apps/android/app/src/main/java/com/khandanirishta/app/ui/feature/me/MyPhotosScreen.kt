package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
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
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * `ME-PHOTOS` (specs/16 section 6.19, specs/08 section 5.5): add, order and remove the own
 * photos and see their review status. Block 1 is the privacy line with "Change"; the grid, the
 * rejection messages and the photo guidelines come from [PhotoManager].
 */
@Composable
fun MyPhotosScreen() {
    MyPhotosRoute()
}

@Composable
private fun MyPhotosRoute(viewModel: MyPhotosViewModel = hiltViewModel()) {
    val navigator = LocalNavigator.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    Scaffold(
        topBar = { DetailTopBar(title = stringResource(R.string.photos_screen_title), onBack = navigator::back) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = MeScreenPadding, end = MeScreenPadding, top = 4.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(MeBlockSpacing),
        ) {
            if (state.privacy != null || state.loading) {
                PrivacyLine(privacy = state.privacy, onChange = { navigator.push(PrivacySettings) })
            }
            PhotoManager()
        }
    }
}

/** Block 1: "Who can see the photos: {label}" with "Change" (09 section 3.2). */
@Composable
private fun PrivacyLine(
    privacy: Privacy?,
    onChange: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (privacy == null) {
        SkeletonBox(
            modifier
                .fillMaxWidth(0.75f)
                .height(44.dp),
            corner = 12.dp,
        )
        return
    }
    val label = LocalReference.current.option(Lists.PHOTO_VISIBILITY, privacy.photoVisibility)
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f),
        shape = MaterialTheme.shapes.medium,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text(R.string.photos_screen_privacy_line, "label" to label),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onChange) { Text(stringResource(R.string.photos_screen_privacy_change)) }
        }
    }
}

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
