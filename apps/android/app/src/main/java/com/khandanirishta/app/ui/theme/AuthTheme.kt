package com.khandanirishta.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.clerk.api.ui.ClerkColors
import com.clerk.api.ui.ClerkDesign
import com.clerk.api.ui.ClerkTheme
import com.clerk.api.ui.ClerkTypography

/**
 * Clerk's screens (sign-in, and the account screen of SET-ACCOUNT) in the app's own colours and
 * type (DESIGN.md sections 2 and 3). The same colours stand for its dark scheme: the app is light
 * only, whatever the phone is set to.
 */
@Composable
fun rememberClerkTheme(): ClerkTheme {
    val scheme = MaterialTheme.colorScheme
    val extra = KrTheme.colors
    val type = MaterialTheme.typography
    return remember(scheme, extra, type) {
        val colors =
            ClerkColors(
                primary = scheme.primary,
                primaryForeground = scheme.onPrimary,
                background = scheme.background,
                foreground = scheme.onBackground,
                muted = scheme.surfaceContainer,
                mutedForeground = scheme.onSurfaceVariant,
                input = extra.card,
                inputForeground = scheme.onSurface,
                neutral = scheme.onSurface,
                border = scheme.outline,
                ring = extra.focusRing,
                danger = scheme.error,
                success = extra.success,
                warning = extra.warning,
                secondaryButtonBackground = extra.card,
                secondaryButtonForeground = scheme.onSurface,
                shadow = Color.Transparent,
            )
        ClerkTheme(
            colors = colors,
            lightColors = colors,
            darkColors = colors,
            typography =
                ClerkTypography(
                    displaySmall = type.headlineLarge,
                    headlineLarge = type.headlineLarge,
                    headlineMedium = type.headlineMedium,
                    headlineSmall = type.headlineSmall,
                    titleMedium = type.titleMedium,
                    titleSmall = type.titleSmall,
                    bodyLarge = type.bodyMedium,
                    bodyMedium = type.bodyMedium,
                    bodySmall = type.bodySmall,
                    labelMedium = type.labelMedium,
                    labelSmall = type.labelSmall,
                ),
            design = ClerkDesign(borderRadius = FieldRadius, logoMaxHeight = LogoHeight),
        )
    }
}

// Clerk has one radius for its fields and its buttons: the field radius of DESIGN.md section 4.1.
private val FieldRadius = 16.dp
private val LogoHeight = 56.dp
