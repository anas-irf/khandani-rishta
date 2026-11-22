package com.khandanirishta.app.ui.feature.home

import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.components.PassedCard
import com.khandanirishta.app.ui.components.ProfileCardView

/** One "Not interested" of a screen: the card as it was and its place in the list. */
@Immutable
data class PassEntry(
    val card: ProfileCard,
    val index: Int,
    /** `false` after Undo: the card shows again, in the same place. */
    val passed: Boolean,
)

/**
 * "Not interested" on a list (specs/16 section 6.4, specs/11 section 12, the web's
 * `usePassInPlace`): a panel with Undo stays in the card's place until the member leaves the
 * screen, with no time limit. A refetch no longer has a passed card, so this keeps it and puts
 * it back where it was.
 */
@Immutable
data class PassedCards(
    val entries: List<PassEntry> = emptyList(),
    /** The visit is over: the passed cards go when the member is back. */
    val left: Boolean = false,
) {
    fun isPassed(id: String): Boolean = entries.any { it.passed && it.card.id == id }

    /** The list as shown, with every card of [entries] in its place. */
    fun arrange(cards: List<ProfileCard>): List<ProfileCard> {
        if (entries.isEmpty()) return cards
        val shown = cards.mapTo(HashSet()) { it.id }
        val result = cards.toMutableList()
        for (entry in entries.sortedBy { it.index }) {
            if (entry.card.id !in shown) result.add(entry.index.coerceIn(0, result.size), entry.card)
        }
        return result
    }

    /** The list without the passed cards, for rows that have no panel and for leaving the screen. */
    fun hide(cards: List<ProfileCard>): List<ProfileCard> =
        if (entries.isEmpty()) cards else cards.filterNot { isPassed(it.id) }

    /** [shown] is the list as [arrange] gave it. */
    fun pass(
        card: ProfileCard,
        shown: List<ProfileCard>,
    ): PassedCards {
        val index = shown.indexOfFirst { it.id == card.id }.coerceAtLeast(0)
        return PassedCards(without(card.id).entries + PassEntry(card, index, passed = true))
    }

    fun restore(id: String): PassedCards = change(id) { it.copy(passed = false) }

    /** An Undo that failed. */
    fun passAgain(id: String): PassedCards = change(id) { it.copy(passed = true) }

    fun update(
        id: String,
        transform: (ProfileCard) -> ProfileCard,
    ): PassedCards = change(id) { it.copy(card = transform(it.card)) }

    /** A pass that failed. */
    fun without(id: String): PassedCards = copy(entries = entries.filterNot { it.card.id == id })

    fun leave(): PassedCards = if (entries.isEmpty()) this else copy(left = true)

    private fun change(
        id: String,
        transform: (PassEntry) -> PassEntry,
    ): PassedCards = copy(entries = entries.map { if (it.card.id == id) transform(it) else it })
}

/** A full-size card of Home, matches and search, or the panel in its place once it is passed. */
@Composable
fun DiscoveryCard(
    card: ProfileCard,
    passed: Boolean,
    onOpen: () -> Unit,
    onToggleShortlist: () -> Unit,
    onPass: () -> Unit,
    onUndo: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // The card's height, so the panel does not pull the list up under the reader.
    var height by rememberSaveable { mutableIntStateOf(0) }
    if (passed) {
        val minHeight = with(LocalDensity.current) { height.toDp() }
        PassedCard(name = card.displayName, onUndo = onUndo, minHeight = minHeight, modifier = modifier)
    } else {
        ProfileCardView(
            card = card,
            onOpen = onOpen,
            onToggleShortlist = onToggleShortlist,
            onPass = onPass,
            modifier = modifier.onSizeChanged { height = it.height },
        )
    }
}

/**
 * Runs [onLeave] when the member leaves the screen, but not when the screen is only rotated, and
 * [onReturn] once the screen is laid out. A list saves only an index: passed cards are taken out
 * on return, when the list has found its place again and keeps it by key.
 */
@Composable
fun VisitEffect(
    onLeave: () -> Unit,
    onReturn: () -> Unit,
) {
    val activity = LocalActivity.current
    val currentOnLeave by rememberUpdatedState(onLeave)
    val currentOnReturn by rememberUpdatedState(onReturn)
    DisposableEffect(activity) {
        onDispose { if (activity?.isChangingConfigurations != true) currentOnLeave() }
    }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        currentOnReturn()
    }
}

/** [card] back at [index] after a pass that failed, unless the list still has it. */
internal fun List<ProfileCard>.putBack(
    card: ProfileCard,
    index: Int,
): List<ProfileCard> =
    if (any { it.id == card.id }) {
        this
    } else {
        toMutableList().apply { add(index.coerceIn(0, size), card) }
    }
