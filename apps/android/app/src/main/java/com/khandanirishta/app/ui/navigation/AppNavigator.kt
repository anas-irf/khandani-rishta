package com.khandanirishta.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.UUID

/** An entry of a back stack: a screen key and an id that is unique even when a key repeats. */
@Serializable
data class Route(
    val key: AppKey,
    val id: String = UUID.randomUUID().toString(),
)

@Serializable
private data class NavigatorSnapshot(
    val tabbed: Boolean,
    val currentTab: Tab,
    val stacks: Map<Tab, List<Route>>,
)

private val navigatorJson = Json { ignoreUnknownKeys = true }

/**
 * The back stacks of the app (specs/22 section 3.3). Under the gate `ok` there is one stack per tab,
 * so switching tabs keeps where the member was; under every other gate there is one stack, rooted
 * at the gate's screen. A key the gate does not allow is never pushed.
 */
@Stable
class AppNavigator internal constructor(
    val tabbed: Boolean,
    initialTab: Tab,
    initialStacks: Map<Tab, List<Route>>,
) {
    private val stacks: Map<Tab, SnapshotStateList<Route>> =
        Tab.entries.associateWith { tab -> mutableStateListOf<Route>().apply { addAll(initialStacks[tab].orEmpty()) } }

    var currentTab: Tab by mutableStateOf(initialTab)
        private set

    /** Decides whether a key may be pushed; set by the gate host. */
    internal var isAllowed: (AppKey) -> Boolean = { true }

    /** Called when Back is pressed with nothing left to pop: the app should close. */
    internal var onExit: () -> Unit = {}

    fun stack(tab: Tab): List<Route> = stacks.getValue(tab)

    private fun currentStack(): SnapshotStateList<Route> = stacks.getValue(if (tabbed) currentTab else Tab.HOME)

    /** The routes on display: the home stack, then the current tab's stack (Back from a tab root goes home). */
    val visibleRoutes: List<Route>
        get() =
            if (!tabbed || currentTab == Tab.HOME) {
                stack(Tab.HOME)
            } else {
                stack(Tab.HOME) + stack(currentTab)
            }

    val top: Route get() = currentStack().last()

    fun push(key: AppKey) {
        if (!isAllowed(key)) return
        val stack = currentStack()
        if (stack.lastOrNull()?.key == key) return
        stack.add(Route(key))
    }

    /** Replaces the screen on top, for flows that move forward without a way back. */
    fun replaceTop(key: AppKey) {
        if (!isAllowed(key)) return
        val stack = currentStack()
        if (stack.size > 1) stack.removeAt(stack.lastIndex)
        stack.add(Route(key))
    }

    /** Pops the current stack. Returns false when nothing was popped (Back leaves the app). */
    fun pop(): Boolean {
        val stack = currentStack()
        if (stack.size > 1) {
            stack.removeAt(stack.lastIndex)
            return true
        }
        if (tabbed && currentTab != Tab.HOME) {
            currentTab = Tab.HOME
            return true
        }
        return false
    }

    /** Back: pop, or close the app at the root of Home. */
    fun back() {
        if (!pop()) onExit()
    }

    /** Pops screens until [predicate] matches the top, keeping at least the root. */
    fun popUntil(predicate: (AppKey) -> Boolean) {
        val stack = currentStack()
        while (stack.size > 1 && !predicate(stack.last().key)) stack.removeAt(stack.lastIndex)
    }

    /** Selecting the current tab again pops it to its root (specs/22 section 3.3). */
    fun selectTab(tab: Tab) {
        if (!tabbed) return
        if (tab == currentTab) {
            val stack = stacks.getValue(tab)
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
        } else {
            currentTab = tab
        }
    }

    /** Opens [keys] on top of [tab]'s root, for notifications and links (16 section 2.3 rule 3). */
    fun openOnTab(
        tab: Tab,
        keys: List<AppKey>,
    ) {
        val allowed = keys.filter(isAllowed)
        if (!tabbed) {
            val stack = stacks.getValue(Tab.HOME)
            allowed.forEach { key -> if (stack.last().key != key) stack.add(Route(key)) }
            return
        }
        val stack = stacks.getValue(tab)
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
        allowed.filter { it != tab.root }.forEach { stack.add(Route(it)) }
        currentTab = tab
    }

    internal fun snapshot(): String =
        navigatorJson.encodeToString(
            NavigatorSnapshot.serializer(),
            NavigatorSnapshot(tabbed, currentTab, stacks.mapValues { it.value.toList() }),
        )

    companion object {
        /** Navigator for the tabbed application: every tab starts at its root. */
        fun tabbed(): AppNavigator = AppNavigator(true, Tab.HOME, Tab.entries.associateWith { listOf(Route(it.root)) })

        /** Navigator for a gate: one stack with [keys], root first. */
        fun single(keys: List<AppKey>): AppNavigator =
            AppNavigator(false, Tab.HOME, mapOf(Tab.HOME to keys.map { Route(it) }))

        internal fun restore(value: String): AppNavigator? =
            runCatching {
                val snapshot = navigatorJson.decodeFromString(NavigatorSnapshot.serializer(), value)
                if (snapshot.stacks[Tab.HOME].isNullOrEmpty()) return null
                AppNavigator(snapshot.tabbed, snapshot.currentTab, snapshot.stacks)
            }.getOrNull()

        fun saver(fallback: () -> AppNavigator): Saver<AppNavigator, String> =
            Saver(save = { it.snapshot() }, restore = { restore(it) ?: fallback() })
    }
}

/** Remembers a navigator across configuration changes and process death. */
@Composable
fun rememberAppNavigator(
    key: Any,
    create: () -> AppNavigator,
): AppNavigator = rememberSaveable(key, saver = AppNavigator.saver(create)) { create() }

/** The navigator of the current gate, for screens. */
val LocalNavigator = staticCompositionLocalOf<AppNavigator> { error("No navigator") }
