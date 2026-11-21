package com.khandanirishta.app.ui

import androidx.activity.compose.LocalActivity
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.realtime.ConnectivityObserver
import com.khandanirishta.app.ui.components.LimitDialog
import com.khandanirishta.app.ui.components.OfflineBanner
import com.khandanirishta.app.ui.feature.auth.SignInScreen
import com.khandanirishta.app.ui.feature.gates.ClerkFailedScreen
import com.khandanirishta.app.ui.feature.gates.NotConfiguredScreen
import com.khandanirishta.app.ui.feature.gates.SplashScreen
import com.khandanirishta.app.ui.feature.gates.StartErrorScreen
import com.khandanirishta.app.ui.feature.gates.UpgradeScreen
import com.khandanirishta.app.ui.messages.AppMessage
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.messages.UiText
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.DeepLink
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.navigation.Route
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.navigation.rememberAppNavigator
import com.khandanirishta.app.ui.navigation.showsBottomBar
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.LocalViewerCountry
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.launch

@EntryPoint
@InstallIn(SingletonComponent::class)
interface RootEntryPoint {
    fun messageBus(): MessageBus

    fun connectivity(): ConnectivityObserver

    fun profileRepository(): ProfileRepository
}

/** App-wide helpers for screens: the root view model (sign-out, links, update banner). */
val LocalAppViewModel = androidx.compose.runtime.staticCompositionLocalOf<AppViewModel> { error("No app view model") }

/** Root composable: start-up, gate routing and the navigation host (specs/22 section 3). */
@Composable
fun KhandaniApp(viewModel: AppViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val entryPoint =
        remember { EntryPointAccessors.fromApplication(context.applicationContext, RootEntryPoint::class.java) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    CompositionLocalProvider(LocalAppViewModel provides viewModel) {
        MessageHost(entryPoint.messageBus(), snackbar)
        AnimatedContent(
            targetState = state.rootKind(),
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "root",
        ) { kind ->
            when (kind) {
                RootKind.STARTING -> {
                    SplashScreen()
                }

                RootKind.NOT_CONFIGURED -> {
                    NotConfiguredScreen()
                }

                RootKind.CLERK_FAILED -> {
                    ClerkFailedScreen(onRetry = viewModel::retry)
                }

                RootKind.UPGRADE -> {
                    (state as? RootState.Upgrade)?.let { UpgradeScreen(it) } ?: SplashScreen()
                }

                RootKind.SIGNED_OUT -> {
                    SignInScreen(onSignedIn = viewModel::load)
                }

                RootKind.ERROR -> {
                    (state as? RootState.StartError)?.let { StartErrorScreen(it.error, onRetry = viewModel::retry) }
                }

                RootKind.READY -> {
                    (state as? RootState.Ready)?.let { ready ->
                        val ownProfile by entryPoint.profileRepository().ownProfile.collectAsStateWithLifecycle()
                        CompositionLocalProvider(
                            LocalReference provides ready.reference,
                            LocalMe provides ready.me,
                            LocalViewerCountry provides (ownProfile?.location?.countryCode ?: "PK"),
                        ) {
                            GateHost(ready.me, snackbar, entryPoint.connectivity())
                        }
                    }
                }
            }
        }
    }
}

private enum class RootKind { STARTING, NOT_CONFIGURED, CLERK_FAILED, UPGRADE, SIGNED_OUT, ERROR, READY }

private fun RootState.rootKind(): RootKind =
    when (this) {
        RootState.Starting -> RootKind.STARTING
        RootState.NotConfigured -> RootKind.NOT_CONFIGURED
        RootState.ClerkFailed -> RootKind.CLERK_FAILED
        is RootState.Upgrade -> RootKind.UPGRADE
        RootState.SignedOut -> RootKind.SIGNED_OUT
        is RootState.StartError -> RootKind.ERROR
        is RootState.Ready -> RootKind.READY
    }

/** Shows toasts (4 seconds, 5 with an action) and the limit dialog posted on the [MessageBus]. */
@Composable
private fun MessageHost(
    bus: MessageBus,
    snackbar: SnackbarHostState,
) {
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    var limit by remember { mutableStateOf<UiText?>(null) }
    var showLimit by remember { mutableStateOf(false) }
    LaunchedEffect(bus) {
        bus.messages.collect { message ->
            when (message) {
                is AppMessage.Toast -> {
                    scope.launch {
                        snackbar.currentSnackbarData?.dismiss()
                        val result =
                            snackbar.showSnackbar(
                                message = message.text.resolve(res),
                                actionLabel = message.actionLabel?.resolve(res),
                                duration = SnackbarDuration.Short,
                            )
                        if (result == SnackbarResult.ActionPerformed) message.onAction?.invoke()
                    }
                }

                is AppMessage.Limit -> {
                    limit = message.text
                    showLimit = true
                }
            }
        }
    }
    if (showLimit) {
        LimitDialog(text = limit?.resolve(res), onDismiss = { showLimit = false })
    }
}

/** The stacks for one gate. A change of gate replaces the whole stack (specs/22 section 3.2). */
@Composable
private fun GateHost(
    me: Me,
    snackbar: SnackbarHostState,
    connectivity: ConnectivityObserver,
) {
    val activity = LocalActivity.current
    val appViewModel = LocalAppViewModel.current
    val tabbed = GateRouter.isTabbed(me.gate)
    val navigator =
        rememberAppNavigator(key = me.gate) {
            if (tabbed) {
                AppNavigator.tabbed()
            } else if (me.gate == Gate.ONBOARDING) {
                val current = GateRouter
                    .stepIndex(
                        me.profile.onboardingStep.wire,
                    ).coerceIn(0, GateRouter.ONBOARDING_STEPS.lastIndex)
                AppNavigator.single(GateRouter.ONBOARDING_STEPS.take(current + 1).map { OnboardingStep(it.wire) })
            } else {
                AppNavigator.single(listOf(GateRouter.root(me.gate, me.profile.onboardingStep)))
            }
        }
    navigator.isAllowed = { key -> GateRouter.isAllowed(me.gate, me.profile.onboardingStep, key) }
    navigator.onExit = { activity?.finish() }

    val pendingLink by appViewModel.pendingLink.collectAsStateWithLifecycle()
    val linkOpener = rememberLinkOpener()
    LaunchedEffect(pendingLink, me.gate) {
        val link = pendingLink ?: return@LaunchedEffect
        // A screen opened while onboarding ends (ONB-DONE) waits for the gate that allows it.
        if (link is DeepLink.Screen && me.gate == Gate.ONBOARDING && link.keys.isNotEmpty() &&
            link.keys.none(navigator.isAllowed)
        ) {
            return@LaunchedEffect
        }
        appViewModel.consumeLink()
        when (link) {
            is DeepLink.Screen -> {
                navigator.openOnTab(link.tab, link.keys)
            }

            is DeepLink.ProfileCode -> {
                appViewModel.resolveProfileCode(link.code).onSuccess { resolved ->
                    if (resolved is DeepLink.Screen) navigator.openOnTab(resolved.tab, resolved.keys)
                }
            }

            is DeepLink.WebPage -> {
                linkOpener.webPage(link.path)
            }

            is DeepLink.External -> {
                linkOpener.url(link.url)
            }
        }
    }
    val approved by appViewModel.approved.collectAsStateWithLifecycle()
    val bus =
        remember {
            EntryPointAccessors
                .fromApplication(
                    activity!!.applicationContext,
                    RootEntryPoint::class.java,
                ).messageBus()
        }
    LaunchedEffect(approved) {
        if (approved) {
            bus.toast(R.string.common_toast_approved_live)
            appViewModel.consumeApproved()
        }
    }

    val online by connectivity.online.collectAsStateWithLifecycle()
    val decorators =
        listOf(
            rememberSaveableStateHolderNavEntryDecorator<Route>(),
            rememberViewModelStoreNavEntryDecorator<Route>(),
        )
    val entryProvider: (Route) -> NavEntry<Route> = { route ->
        NavEntry(route, contentKey = route.id) { Screen(route.key) }
    }
    val homeEntries = rememberDecoratedNavEntries(navigator.stack(Tab.HOME), decorators, entryProvider)
    val searchEntries = rememberDecoratedNavEntries(navigator.stack(Tab.SEARCH), decorators, entryProvider)
    val interestEntries = rememberDecoratedNavEntries(navigator.stack(Tab.INTERESTS), decorators, entryProvider)
    val chatEntries = rememberDecoratedNavEntries(navigator.stack(Tab.CHATS), decorators, entryProvider)
    val meEntries = rememberDecoratedNavEntries(navigator.stack(Tab.ME), decorators, entryProvider)
    val visible =
        if (!navigator.tabbed || navigator.currentTab == Tab.HOME) {
            homeEntries
        } else {
            homeEntries +
                when (navigator.currentTab) {
                    Tab.SEARCH -> searchEntries
                    Tab.INTERESTS -> interestEntries
                    Tab.CHATS -> chatEntries
                    else -> meEntries
                }
        }
    val showBar = navigator.tabbed && navigator.top.key.showsBottomBar()

    CompositionLocalProvider(LocalNavigator provides navigator) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = { if (showBar) AppBottomBar(navigator = navigator, me = me) },
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
        ) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .consumeWindowInsets(padding),
            ) {
                if (!online) OfflineBanner(Modifier.windowInsetsPadding(WindowInsets.statusBars))
                Box(
                    Modifier
                        .weight(1f)
                        .then(if (!online) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier),
                ) {
                    NavDisplay(
                        entries = visible,
                        onBack = { navigator.back() },
                        transitionSpec = {
                            (fadeIn() + slideInHorizontally { it / 8 }) togetherWith fadeOut()
                        },
                        popTransitionSpec = {
                            (fadeIn() + slideInHorizontally { -it / 8 }) togetherWith
                                (fadeOut() + slideOutHorizontally { it / 8 })
                        },
                        predictivePopTransitionSpec = { _ ->
                            (fadeIn() + slideInHorizontally { -it / 8 }) togetherWith
                                (fadeOut() + slideOutHorizontally { it / 8 })
                        },
                    )
                }
            }
        }
    }
}
