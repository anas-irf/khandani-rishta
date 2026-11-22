package com.khandanirishta.app.ui.components

import androidx.compose.runtime.compositionLocalOf

/**
 * Whether the phone has a connection, provided by the root composable. Controls that need the
 * network are disabled without one (specs/16 rule G14); what is loaded stays visible.
 */
val LocalOnline = compositionLocalOf { true }
