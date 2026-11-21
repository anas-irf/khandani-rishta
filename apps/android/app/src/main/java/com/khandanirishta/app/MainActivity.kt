package com.khandanirishta.app

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.khandanirishta.app.core.push.PushKeys
import com.khandanirishta.app.ui.AppViewModel
import com.khandanirishta.app.ui.KhandaniApp
import com.khandanirishta.app.ui.RootState
import com.khandanirishta.app.ui.navigation.DeepLinkResolver
import com.khandanirishta.app.ui.theme.KhandaniTheme
import dagger.hilt.android.AndroidEntryPoint

/** The single activity. Handles notification taps and App Links (specs/22 section 3.4). */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels()

    private val localNetwork =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) appViewModel.retryIfFailed()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Keep the system splash until the app knows what to show first.
        splash.setKeepOnScreenCondition { appViewModel.state.value == RootState.Starting }
        if (savedInstanceState == null) handle(intent)
        requestLocalNetworkIfNeeded()
        setContent {
            KhandaniTheme {
                KhandaniApp(appViewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        intent ?: return
        val link =
            when {
                intent.getBooleanExtra(PushKeys.FROM_PUSH, false) -> {
                    val params = PushKeys.PARAMS.associateWith { intent.getStringExtra(it) }
                    DeepLinkResolver.fromTarget(intent.getStringExtra(PushKeys.TARGET).orEmpty(), params)
                }

                intent.action == Intent.ACTION_VIEW -> {
                    intent.data?.let(DeepLinkResolver::fromUri)
                }

                else -> {
                    null
                }
            } ?: return
        appViewModel.openLink(link)
    }

    /**
     * Debug builds talk to the API on the development machine. Android 17 blocks private network
     * addresses for apps targeting it unless they hold ACCESS_LOCAL_NETWORK, which only the debug
     * manifest declares.
     */
    private fun requestLocalNetworkIfNeeded() {
        if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < ANDROID_17) return
        val host = BuildConfig.API_BASE_URL.toUri().host ?: return
        val local =
            host == "10.0.2.2" || host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".local")
        if (!local) return
        if (ContextCompat.checkSelfPermission(this, LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED) return
        localNetwork.launch(LOCAL_NETWORK)
    }

    private companion object {
        const val ANDROID_17 = 37
        const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"
    }
}
