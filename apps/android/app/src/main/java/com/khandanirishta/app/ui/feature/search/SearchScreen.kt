package com.khandanirishta.app.ui.feature.search

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.CardSkeleton
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.TabTopBar
import com.khandanirishta.app.ui.feature.home.PassedCards
import com.khandanirishta.app.ui.feature.home.StatusGate
import com.khandanirishta.app.ui.feature.home.VisitEffect
import com.khandanirishta.app.ui.navigation.GateRouter
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.Sizes

/**
 * APP-SEARCH: find members with explicit filters (specs/16 section 6.6). A phone shows one view at
 * a time: the filter form first, then the results; "Filters" and system Back return to the form.
 * [savedSearchId] (from a notification) loads that saved search and runs it.
 */
@Composable
fun SearchScreen(
    savedSearchId: String?,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        topBar = { TabTopBar(title = stringResource(R.string.discovery_search_title)) },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .consumeWindowInsets(padding)
                .fillMaxSize(),
        ) {
            StatusGate(GateRouter.Level.BROWSE) { SearchRoute(savedSearchId) }
        }
    }
}

/** The search of a profile that may search: its view model starts only behind the status gate. */
@Composable
private fun SearchRoute(
    savedSearchId: String?,
    viewModel: SearchViewModel =
        hiltViewModel<SearchViewModel, SearchViewModel.Factory> { factory -> factory.create(savedSearchId) },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val results by viewModel.results.collectAsStateWithLifecycle()
    val passed by viewModel.passed.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    LaunchedEffect(viewModel, navigator) {
        viewModel.events.collect { event ->
            when (event) {
                is SearchEvent.OpenProfile -> navigator.push(Profile(event.profileId))
            }
        }
    }
    LifecycleResumeEffect(viewModel) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    VisitEffect(onLeave = viewModel::leaveScreen, onReturn = viewModel::returnToScreen)
    val actions: SearchActions = viewModel
    SearchContent(
        state = state,
        results = results,
        passed = passed,
        actions = actions,
        onOpenProfile = { profileId -> navigator.push(Profile(profileId)) },
    )
}

/** The form or the results, with the dialogs of both. */
@Composable
internal fun SearchContent(
    state: SearchUiState,
    results: PagedState<ProfileCard>,
    passed: PassedCards,
    actions: SearchActions,
    onOpenProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reference = LocalReference.current
    val res = LocalResources.current
    val gender = LocalMe.current?.profile?.gender
    val options = remember(reference, res, gender) { FilterOptions(reference, res, gender) }
    // The results come from the end edge, so from the other side in right-to-left layouts.
    val forward = if (LocalLayoutDirection.current == LayoutDirection.Ltr) 1 else -1
    // On a phone the results replace the form; Back shows the form again (16 section 6.6).
    BackHandler(enabled = state.view == SearchPane.RESULTS) { actions.showForm() }
    // Each view keeps its scroll position and open groups while the other one is shown.
    val views = rememberSaveableStateHolder()
    AnimatedContent(
        targetState = state.view,
        transitionSpec = {
            val direction = if (targetState == SearchPane.RESULTS) forward else -forward
            val enter = fadeIn(Motion.base()) + slideInHorizontally(Motion.base()) { direction * it / SLIDE }
            val exit = fadeOut(Motion.fast()) + slideOutHorizontally(Motion.base()) { -direction * it / SLIDE }
            enter togetherWith exit
        },
        label = "search-view",
        modifier = modifier.fillMaxSize(),
    ) { view ->
        views.SaveableStateProvider(view.name) {
            when {
                !state.ready && view == SearchPane.FORM -> {
                    FirstLoad(maxWidth = Sizes.formWidth) { FormSkeleton() }
                }

                !state.ready -> {
                    FirstLoad(maxWidth = Sizes.columnWidth) { CardSkeleton() }
                }

                view == SearchPane.FORM -> {
                    FilterFormView(state = state, options = options, actions = actions)
                }

                else -> {
                    ResultsView(
                        state = state,
                        options = options,
                        results = results,
                        passed = passed,
                        actions = actions,
                        onOpenProfile = onOpenProfile,
                    )
                }
            }
        }
    }
    SearchDialogs(state = state, actions = actions)
}

@Composable
private fun FirstLoad(
    maxWidth: Dp,
    content: @Composable () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Band(maxWidth = maxWidth) { content() }
    }
}

@Composable
private fun SearchDialogs(
    state: SearchUiState,
    actions: SearchActions,
) {
    state.saveDialog?.let { dialog ->
        SaveSearchDialog(
            dialog = dialog,
            onSave = actions::saveSearch,
            onEdit = actions::clearDialogError,
            onDismiss = actions::dismissSaveDialog,
        )
    }
    state.renameDialog?.let { dialog ->
        RenameSearchDialog(
            dialog = dialog,
            onRename = actions::rename,
            onEdit = actions::clearDialogError,
            onDismiss = actions::dismissRename,
        )
    }
    state.removing?.let { saved ->
        ConfirmDialog(
            title = stringResource(R.string.discovery_saved_remove_title),
            text = text(R.string.discovery_saved_remove_text, "name" to saved.name),
            confirmLabel = stringResource(R.string.discovery_saved_remove),
            onConfirm = actions::confirmRemove,
            onDismiss = actions::dismissRemove,
            destructive = true,
            busy = state.removeBusy,
        )
    }
}

/** The views slide by an eighth of the width, like the screens of the app. */
private const val SLIDE = 8
