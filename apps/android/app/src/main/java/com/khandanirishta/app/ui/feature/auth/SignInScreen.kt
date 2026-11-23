package com.khandanirishta.app.ui.feature.auth

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FamilyRestroom
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.clerk.ui.auth.AuthView
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.BrandMark
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.OrnamentRule
import com.khandanirishta.app.ui.components.Wordmark
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.components.dashedBorder
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.linkedText
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.InnerArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Motion
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import com.khandanirishta.app.ui.theme.rememberClerkTheme

/**
 * AUTH-SIGNIN (specs/16 section 6.1): a short welcome, then Clerk's `AuthView`, which decides
 * between sign-in and sign-up and offers the methods enabled in the Clerk dashboard.
 */
@Composable
fun SignInScreen(onSignedIn: () -> Unit) {
    var started by rememberSaveable { mutableStateOf(false) }
    // Back from Clerk's step returns to the welcome rather than leaving the app.
    BackHandler(enabled = started) { started = false }
    AnimatedContent(targetState = started, transitionSpec = {
        fadeIn(Motion.base()) togetherWith fadeOut(Motion.fast())
    }, label = "sign-in") { showAuth ->
        if (showAuth) AuthStep(onSignedIn) else Welcome(onStart = { started = true })
    }
}

/** The welcome: the wordmark, the line in serif, and what the product promises. */
@Composable
internal fun Welcome(
    onStart: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column {
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
                        ).contentWidth(Sizes.formWidth)
                        .padding(horizontal = Spacing.gutter, vertical = Spacing.s24),
                verticalArrangement = Arrangement.spacedBy(Spacing.s24, Alignment.CenterVertically),
            ) {
                Wordmark()
                WelcomeArches()
                OrnamentRule()
                Text(
                    text = stringResource(R.string.auth_tagline),
                    style = MaterialTheme.typography.displayLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.semantics { heading() },
                )
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
                    Feature(
                        Icons.Outlined.VerifiedUser,
                        ArchTone.SUCCESS,
                        stringResource(R.string.auth_feature_verified),
                    )
                    Feature(Icons.Outlined.Lock, ArchTone.PRIMARY, stringResource(R.string.auth_feature_privacy))
                    Feature(Icons.Outlined.FamilyRestroom, ArchTone.TONAL, stringResource(R.string.auth_feature_family))
                }
            }
            KrActionBar(maxWidth = Sizes.formWidth) {
                KrButton(text = stringResource(R.string.auth_get_started), onClick = onStart, fullWidth = true)
                LegalLine()
            }
        }
    }
}

/** Three arches, the middle one whole: two families and the meeting between them. Decoration. */
@Composable
private fun WelcomeArches() {
    val gold = KrTheme.colors.ornament
    Row(
        modifier = Modifier.clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalAlignment = Alignment.Bottom,
    ) {
        val side = Modifier.size(Sizes.arch64).dashedBorder(InnerArchShape, gold)
        Box(side)
        Box(
            modifier =
                Modifier
                    .size(Sizes.arch96)
                    .background(MaterialTheme.colorScheme.primary, ArchShape)
                    .padding(Spacing.s8)
                    .border(Strokes.hairline, gold, InnerArchShape),
            contentAlignment = Alignment.Center,
        ) {
            Diamond(size = Spacing.s12)
        }
        Box(side)
    }
}

@Composable
private fun Feature(
    icon: ImageVector,
    tone: ArchTone,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s16), verticalAlignment = Alignment.CenterVertically) {
        ArchIcon(icon, tone = tone)
        Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun AuthStep(onSignedIn: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        AuthView(
            modifier = Modifier.weight(1f),
            clerkTheme = rememberClerkTheme(),
            logo = { BrandMark(height = Sizes.touchLarge) },
            isDismissible = false,
            onAuthComplete = onSignedIn,
        )
        LegalLine(
            modifier =
                Modifier
                    .navigationBarsPadding()
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s12),
        )
    }
}

/** "By continuing you agree to the Terms of Use and Privacy Policy." with links. */
@Composable
private fun LegalLine(modifier: Modifier = Modifier) {
    val links = rememberLinkOpener()
    Text(
        linkedText(
            stringResource(R.string.auth_legal),
            linkColor = MaterialTheme.colorScheme.primary,
            links = mapOf("terms" to { links.webPage("terms") }, "privacy" to { links.webPage("privacy") }),
        ),
        style = KrType.caption,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth(),
    )
}
