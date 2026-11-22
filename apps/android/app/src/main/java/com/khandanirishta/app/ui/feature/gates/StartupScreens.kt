package com.khandanirishta.app.ui.feature.gates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.ui.RootState
import com.khandanirishta.app.ui.components.BrandMark
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrTopBar
import com.khandanirishta.app.ui.components.PanelTone
import com.khandanirishta.app.ui.components.QuoteBlock
import com.khandanirishta.app.ui.components.StateScreen
import com.khandanirishta.app.ui.components.Wordmark
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The brand mark on the page, shown while the app starts (specs/16 section 3.3). It carries on
 * from the system splash, which has the same mark on the same colour.
 */
@Composable
fun SplashScreen(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.splash_loading)
    val colors = MaterialTheme.colorScheme
    Surface(
        color = colors.background,
        modifier =
            modifier
                .fillMaxSize()
                .clearAndSetSemantics {
                    contentDescription = label
                    liveRegion = LiveRegionMode.Polite
                },
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .safeDrawingPadding()
                    .padding(horizontal = Spacing.gutter),
            verticalArrangement = Arrangement.spacedBy(Spacing.s20, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BrandMark(height = SplashMark)
            Text(stringResource(R.string.app_name), style = KrType.wordmarkLarge, textAlign = TextAlign.Center)
            CircularProgressIndicator(
                color = colors.primary,
                trackColor = Color.Transparent,
                strokeWidth = SpinnerStroke,
            )
        }
    }
}

/** GATE-UPGRADE: a blocking screen with the release notes and the download (specs/16 section 6.2). */
@Composable
fun UpgradeScreen(
    state: RootState.Upgrade,
    modifier: Modifier = Modifier,
) {
    val links = rememberLinkOpener()
    GateFrame(
        title = stringResource(R.string.upgrade_title),
        modifier = modifier,
        bottomBar = {
            KrActionBar(maxWidth = Sizes.formWidth) {
                KrButton(
                    text = stringResource(R.string.upgrade_download),
                    onClick = { state.downloadUrl?.let(links::url) },
                    enabled = state.downloadUrl != null,
                    fullWidth = true,
                )
                CaptionText(
                    text = stringResource(R.string.upgrade_install_note),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
    ) {
        Text(stringResource(R.string.upgrade_text), style = MaterialTheme.typography.bodyLarge)
        state.versionName?.let {
            Text(text(R.string.upgrade_latest, "version" to it), style = MaterialTheme.typography.titleSmall)
        }
        QuoteBlock(state.releaseNotes)
    }
}

/** A failure before any gate is known: the wordmark, then the state. */
@Composable
private fun StartupFrame(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = modifier.fillMaxSize()) {
        Column {
            KrTopBar {
                Wordmark(
                    Modifier
                        .heightIn(min = Sizes.topBar)
                        .padding(horizontal = Spacing.s16, vertical = Spacing.s4),
                )
            }
            StateScreen(Modifier.weight(1f)) { content() }
        }
    }
}

/** `GET /v1/me` failed at start: rule G3, never a guessed gate (specs/16 section 3.3). */
@Composable
fun StartErrorScreen(
    error: ApiError,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    StartupFrame(modifier) { ErrorState(error = error, onRetry = onRetry, needsNetwork = false) }
}

@Composable
fun NotConfiguredScreen(modifier: Modifier = Modifier) {
    StartupFrame(modifier) {
        EmptyState(
            title = stringResource(R.string.auth_not_configured),
            icon = Icons.Outlined.Info,
            tone = PanelTone.WARNING,
        )
    }
}

@Composable
fun ClerkFailedScreen(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    StartupFrame(modifier) {
        EmptyState(
            title = stringResource(R.string.auth_init_failed),
            icon = Icons.Outlined.ErrorOutline,
            tone = PanelTone.DANGER,
            actionLabel = stringResource(R.string.errors_generic_try_again),
            onAction = onRetry,
        )
    }
}

private val SplashMark = 72.dp
private val SpinnerStroke = 3.dp
