package com.khandanirishta.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import com.khandanirishta.app.ui.theme.Elevation
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.MenuItemShape
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes

/** Material's menu in the look of DESIGN.md section 6.18: surface, a hairline and the menu shadow. */
@Composable
fun KrMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        containerColor = KrTheme.colors.card,
        tonalElevation = Elevation.none,
        shadowElevation = Elevation.menu,
        border = BorderStroke(Strokes.hairline, MaterialTheme.colorScheme.outlineVariant),
        content = content,
    )
}

/**
 * An item of a [KrMenu]: at least 48 tall, and it may wrap. Danger is not a menu colour: it
 * appears in the confirmation that follows (DESIGN.md section 2.2).
 */
@Composable
fun KrMenuItem(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    DropdownMenuItem(
        text = { Text(text, style = MaterialTheme.typography.bodyMedium) },
        onClick = onClick,
        enabled = enabled,
        leadingIcon =
            icon?.let {
                { Icon(it, contentDescription = null, modifier = Modifier.size(Sizes.iconSmall)) }
            },
        colors =
            MenuDefaults.itemColors(
                textColor = colors.onSurface,
                leadingIconColor = colors.onSurfaceVariant,
                disabledTextColor = colors.onSurfaceVariant,
                disabledLeadingIconColor = colors.onSurfaceVariant,
            ),
        modifier =
            modifier
                .padding(horizontal = Spacing.s8)
                .clip(MenuItemShape)
                .heightIn(min = Sizes.touch),
    )
}

@Composable
fun KrMenuDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(
        modifier = modifier.padding(horizontal = Spacing.s8, vertical = Spacing.s4),
        thickness = Strokes.hairline,
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}
