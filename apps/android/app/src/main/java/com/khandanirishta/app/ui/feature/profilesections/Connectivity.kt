package com.khandanirishta.app.ui.feature.profilesections

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.ui.RootEntryPoint
import dagger.hilt.android.EntryPointAccessors

/** Whether the phone is online, so buttons that need the network can be disabled (rule G14). */
@Composable
fun rememberOnline(): Boolean {
    val context = LocalContext.current
    val observer =
        remember(context) {
            EntryPointAccessors.fromApplication(context.applicationContext, RootEntryPoint::class.java).connectivity()
        }
    val online by observer.online.collectAsStateWithLifecycle()
    return online
}
