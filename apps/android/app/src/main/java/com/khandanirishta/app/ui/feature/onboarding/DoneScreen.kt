package com.khandanirishta.app.ui.feature.onboarding

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.datastore.AppPreferences
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.push.PushRegistrar
import com.khandanirishta.app.ui.components.CardSkeleton
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.navigation.Home
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.theme.KrTheme
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DoneUi(
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    val profile: OwnProfile? = null,
    /** The explanation before the system's notification permission prompt (22 section 8). */
    val askPermission: Boolean = false,
)

/** ONB-DONE: the profile is live (07 section 15). */
@HiltViewModel
class OnboardingDoneViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val preferences: AppPreferences,
        private val push: PushRegistrar,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(DoneUi())
        val state: StateFlow<DoneUi> = mutableState.asStateFlow()
        private var permissionOffered = false

        init {
            load()
        }

        fun load() {
            mutableState.update { it.copy(loading = it.profile == null, loadError = null) }
            viewModelScope.launch {
                profiles
                    .load()
                    .onSuccess { profile -> mutableState.update { it.copy(loading = false, profile = profile) } }
                    .onFailure { error -> mutableState.update { it.copy(loading = false, loadError = error.apiError) } }
            }
        }

        /** The permission is asked for at most once automatically (`notificationPermissionAsked`). */
        fun offerPermission() {
            if (permissionOffered) return
            permissionOffered = true
            viewModelScope.launch {
                if (!preferences.notificationPermissionAsked()) mutableState.update { it.copy(askPermission = true) }
            }
        }

        /** "Allow notifications" or "Not now": either way it is not offered again by itself. */
        fun permissionAnswered() {
            mutableState.update { it.copy(askPermission = false) }
            viewModelScope.launch { preferences.setNotificationPermissionAsked() }
        }

        fun onPermissionResult(granted: Boolean) {
            if (granted) viewModelScope.launch { push.register() }
        }
    }

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun notificationsAllowed(context: Context): Boolean {
    val state = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
    return state == PackageManager.PERMISSION_GRANTED
}

/**
 * ONB-DONE (07 section 15): "Mubarak!", up to three action cards that open their screens and come
 * back here, and "See my matches", which leaves for APP-HOME. On Android 13 and later it explains
 * notifications and asks for the permission (22 section 8).
 */
@Composable
internal fun DoneContent(viewModel: OnboardingDoneViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            viewModel.onPermissionResult(granted)
        }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notificationsAllowed(context)) {
            viewModel.offerPermission()
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            StepBottomBar(
                primaryLabel = stringResource(R.string.onboarding_done_matches),
                onPrimary = {
                    // APP-HOME, without a way back to this screen (07 section 15.1).
                    navigator.popUntil { it == Home }
                    navigator.selectTab(Tab.HOME)
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .windowInsetsPadding(WindowInsets.statusBars)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            DoneHeader()
            val profile = state.profile
            when {
                state.loadError != null && profile == null -> {
                    ErrorState(state.loadError, onRetry = viewModel::load)
                }

                profile == null -> {
                    CardSkeleton(cards = 1)
                }

                else -> {
                    val hasPhoto = usablePhotos(profile.photos).isNotEmpty()
                    if (!hasPhoto) {
                        ActionCard(
                            icon = Icons.Outlined.AddPhotoAlternate,
                            title = stringResource(R.string.onboarding_done_photo_title),
                            text = stringResource(R.string.onboarding_done_photo_text),
                            onClick = { navigator.push(MyPhotos) },
                        )
                    }
                    if (!profile.verification.idVerified && !profile.verification.pending.idDocument) {
                        ActionCard(
                            icon = Icons.Outlined.VerifiedUser,
                            title = stringResource(R.string.onboarding_done_verify_title),
                            text = stringResource(R.string.onboarding_done_verify_text),
                            onClick = { navigator.push(Verification) },
                        )
                    }
                    ActionCard(
                        icon = Icons.Outlined.PrivacyTip,
                        title = stringResource(R.string.onboarding_done_privacy_title),
                        text = stringResource(R.string.onboarding_done_privacy_text),
                        onClick = { navigator.push(PrivacySettings) },
                    )
                }
            }
        }
    }

    if (state.askPermission) {
        AlertDialog(
            onDismissRequest = viewModel::permissionAnswered,
            icon = { Icon(Icons.Outlined.NotificationsActive, contentDescription = null) },
            title = { Text(stringResource(R.string.notifications_permission_title)) },
            text = { Text(stringResource(R.string.notifications_permission_text)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.permissionAnswered()
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    },
                ) { Text(stringResource(R.string.notifications_permission_allow)) }
            },
            dismissButton = {
                TextButton(onClick = viewModel::permissionAnswered) {
                    Text(stringResource(R.string.notifications_permission_later))
                }
            },
        )
    }
}

@Composable
private fun DoneHeader() {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.extraLarge)
            .background(KrTheme.colors.heroGradient)
            .padding(horizontal = 20.dp, vertical = 28.dp),
    ) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Celebration,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(34.dp),
                )
            }
            Text(
                stringResource(R.string.onboarding_done_title),
                style = MaterialTheme.typography.headlineSmall,
                color = Color.White,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                stringResource(R.string.onboarding_done_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.92f),
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** One of the three things that make a real difference (07 section 15.1). */
@Composable
private fun ActionCard(
    icon: ImageVector,
    title: String,
    text: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(
                    text,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
