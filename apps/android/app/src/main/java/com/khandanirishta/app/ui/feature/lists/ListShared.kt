package com.khandanirishta.app.ui.feature.lists

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Badge
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.PhotoPlaceholder

/*
 * Small building blocks shared by the activity lists: interests, photo requests, notifications,
 * shortlist and visitors (specs/16 sections 6.9 and 6.13 to 6.16).
 */

/** One tab of a two-tab list screen, with an optional count badge and its spoken form. */
internal data class ListTab(
    val label: String,
    val badge: Long = 0,
    val badgeDescription: String? = null,
)

/** The tabs under the top bar: "Received" and "Sent", "Viewed me" and "I viewed". */
@Composable
internal fun ListTabs(
    tabs: List<ListTab>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    PrimaryTabRow(
        selectedTabIndex = selected,
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.primary,
    ) {
        tabs.forEachIndexed { index, tab ->
            val description =
                if (tab.badge > 0 && tab.badgeDescription != null) {
                    "${tab.label}, ${tab.badgeDescription}"
                } else {
                    tab.label
                }
            Tab(
                selected = index == selected,
                onClick = { onSelect(index) },
                modifier = Modifier.semantics { contentDescription = description },
                selectedContentColor = MaterialTheme.colorScheme.primary,
                unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(tab.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (tab.badge > 0) {
                            Spacer(Modifier.width(6.dp))
                            Badge { Text(Formatters.badgeCount(tab.badge)) }
                        }
                    }
                },
            )
        }
    }
}

/** A single choice shown as filter chips under the tabs ("New", "Accepted", "Closed"). */
@Composable
internal fun FilterChipRow(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .selectableGroup()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { (code, label) ->
            val isSelected = code == selected
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(code) },
                label = { Text(label) },
                leadingIcon =
                    if (isSelected) {
                        {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = null,
                                modifier = Modifier.size(FilterChipDefaults.IconSize),
                            )
                        }
                    } else {
                        null
                    },
                colors =
                    FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        selectedLeadingIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    ),
            )
        }
    }
}

/** The small spinner shown inside a button while its request runs. */
@Composable
internal fun ButtonSpinner(modifier: Modifier = Modifier) {
    CircularProgressIndicator(
        modifier = modifier.size(18.dp),
        color = LocalContentColor.current,
        strokeWidth = 2.dp,
    )
}

/** A small icon followed by a line of meta text ("Received 2 hours ago"). */
@Composable
internal fun MetaLine(
    text: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    emphasis: Boolean = false,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(
            text,
            style = if (emphasis) MaterialTheme.typography.labelLarge else MaterialTheme.typography.bodySmall,
            color = color,
        )
    }
}

/**
 * A grey card for an item whose member can no longer be opened (11 section 3.1): the neutral
 * silhouette, the title and the item's own details under it.
 */
@Composable
internal fun UnavailableCard(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit = {},
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            PhotoPlaceholder(
                gender = null,
                modifier =
                    Modifier
                        .size(72.dp)
                        .clip(RoundedCornerShape(16.dp)),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                content()
            }
        }
    }
}
