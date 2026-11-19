package com.khandanirishta.app.ui

import androidx.compose.runtime.Composable
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import com.khandanirishta.app.ui.home.HomeScreen
import kotlinx.serialization.Serializable

/** Navigation destinations. Every screen gets a key here. */
@Serializable
data object Home : NavKey

/** Root composable: hosts the navigation back stack. */
@Composable
fun KhandaniApp() {
    val backStack = rememberNavBackStack(Home)

    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        entryProvider = entryProvider {
            entry<Home> { HomeScreen() }
        },
    )
}
