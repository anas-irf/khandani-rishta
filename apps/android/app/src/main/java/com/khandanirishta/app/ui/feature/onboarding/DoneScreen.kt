package com.khandanirishta.app.ui.feature.onboarding

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
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
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.navigation.Home
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.Verification
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
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
 * ONB-DONE (07 section 15): "Mubarak!", up to three actions that open their screens and come back
 * here, and "See my matches", which leaves for APP-HOME. On Android 13 and later it explains
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

    DoneBody(
        state = state,
        onRetry = viewModel::load,
        onAction = { action ->
            navigator.push(
                when (action) {
                    DoneAction.PHOTO -> MyPhotos
                    DoneAction.VERIFY -> Verification
                    DoneAction.PRIVACY -> PrivacySettings
                },
            )
        },
        onSeeMatches = {
            // APP-HOME, without a way back to this screen (07 section 15.1).
            navigator.popUntil { it == Home }
            navigator.selectTab(Tab.HOME)
        },
    )

    if (state.askPermission) {
        KrDialog(
            title = stringResource(R.string.notifications_permission_title),
            text = stringResource(R.string.notifications_permission_text),
            confirmLabel = stringResource(R.string.notifications_permission_allow),
            dismissLabel = stringResource(R.string.notifications_permission_later),
            onDismissRequest = viewModel::permissionAnswered,
            onConfirm = {
                viewModel.permissionAnswered()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            },
        )
    }
}
