package com.khandanirishta.app.ui.feature.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FamilyRestroom
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.clerk.api.ui.ClerkColors
import com.clerk.api.ui.ClerkDesign
import com.clerk.api.ui.ClerkTheme
import com.clerk.ui.auth.AuthView
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.feature.gates.BrandMark
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.linkedText
import com.khandanirishta.app.ui.theme.Brand
import com.khandanirishta.app.ui.theme.KrTheme

/**
 * AUTH-SIGNIN (specs/16 section 6.1): a short welcome, then Clerk's `AuthView`, which decides
 * between sign-in and sign-up and offers the methods enabled in the Clerk dashboard.
 */
@Composable
fun SignInScreen(onSignedIn: () -> Unit) {
    var started by rememberSaveable { mutableStateOf(false) }
    AnimatedContent(targetState = started, transitionSpec = {
        fadeIn() togetherWith fadeOut()
    }, label = "sign-in") { showAuth ->
        if (showAuth) AuthStep(onSignedIn) else Welcome(onStart = { started = true })
    }
}

@Composable
private fun Welcome(onStart: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(KrTheme.colors.heroGradient)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 28.dp, vertical = 24.dp),
    ) {
        Spacer(Modifier.weight(1f))
        BrandMark(size = 72)
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.displaySmall, color = Color.White)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.auth_tagline),
            style = MaterialTheme.typography.titleMedium,
            color = Color.White.copy(alpha = 0.9f),
        )
        Spacer(Modifier.height(28.dp))
        Feature(Icons.Outlined.VerifiedUser, stringResource(R.string.auth_feature_verified))
        Feature(Icons.Outlined.Lock, stringResource(R.string.auth_feature_privacy))
        Feature(Icons.Outlined.FamilyRestroom, stringResource(R.string.auth_feature_family))
        Spacer(Modifier.weight(1f))
        Button(
            onClick = onStart,
            colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Brand.PrimaryDeep),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp),
        ) { Text(stringResource(R.string.auth_get_started), style = MaterialTheme.typography.titleMedium) }
        Spacer(Modifier.height(12.dp))
        LegalLine(color = Color.White.copy(alpha = 0.85f), link = Color.White)
    }
}

@Composable
private fun Feature(
    icon: ImageVector,
    text: String,
) {
    Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp)) }
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = Color.White)
    }
}

private val clerkTheme =
    ClerkTheme(
        colors =
            ClerkColors(
                primary = Brand.Primary,
                background = Brand.Background,
                danger = Brand.Danger,
                success = Brand.Success,
                warning = Brand.Warning,
                foreground = Brand.Text,
                mutedForeground = Brand.MutedText,
                primaryForeground = Color.White,
                border = Brand.Border,
            ),
        design = ClerkDesign(borderRadius = 12.dp),
    )

@Composable
private fun AuthStep(onSignedIn: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        AuthView(
            modifier = Modifier.weight(1f),
            clerkTheme = clerkTheme,
            logo = { BrandMark(size = 48) },
            isDismissible = false,
            onAuthComplete = onSignedIn,
        )
        LegalLine(
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            link = MaterialTheme.colorScheme.primary,
            modifier =
                Modifier
                    .navigationBarsPadding()
                    .padding(horizontal = 24.dp, vertical = 12.dp),
        )
    }
}

/** "By continuing you agree to the Terms of Use and Privacy Policy." with links. */
@Composable
private fun ColumnScope.LegalLine(
    color: Color,
    link: Color,
    modifier: Modifier = Modifier,
) {
    val links = rememberLinkOpener()
    Text(
        linkedText(
            stringResource(R.string.auth_legal),
            linkColor = link,
            links = mapOf("terms" to { links.webPage("terms") }, "privacy" to { links.webPage("privacy") }),
        ),
        style = MaterialTheme.typography.bodySmall,
        color = color,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(4.dp))
}
