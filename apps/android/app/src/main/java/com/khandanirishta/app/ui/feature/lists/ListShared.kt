package com.khandanirishta.app.ui.feature.lists

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.UnreadDot
import com.khandanirishta.app.ui.components.rememberNow
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Spacing
import java.time.Instant

/*
 * What the activity lists share beside the components of ui/components: interests, photo
 * requests, notifications, shortlist and visitors (specs/16 sections 6.9 and 6.13 to 6.16).
 */

/** When it happened and where it stands, on one line that wraps (the web's `RowMeta`). */
@Composable
internal fun RowMeta(
    modifier: Modifier = Modifier,
    content: @Composable FlowRowScope.() -> Unit,
) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
        verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        itemVerticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** An item not seen yet: the dot and its word, so it is never colour alone (rule G13). */
@Composable
internal fun UnseenMark(
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        UnreadDot(label)
        Text(label, style = KrType.badge, color = MaterialTheme.colorScheme.primary)
    }
}

/** "5 min ago", "Yesterday", then the date (rule G11). */
@Composable
internal fun rememberRelativeTime(instant: Instant): String {
    val res = LocalResources.current
    val now = rememberNow()
    return remember(res, instant, now) { Formatters.relative(res, instant, now) }
}

/**
 * The buttons of a row as actions of its one TalkBack item. Put it on the row's details: those are
 * merged into the item, and the actions with them.
 */
internal fun Modifier.rowActions(
    enabled: Boolean,
    vararg actions: Pair<String, () -> Unit>,
): Modifier =
    semantics {
        if (!enabled || actions.isEmpty()) return@semantics
        customActions =
            actions.map { (label, action) ->
                CustomAccessibilityAction(label) {
                    action()
                    true
                }
            }
    }
