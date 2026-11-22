package com.khandanirishta.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.ripple
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role

/*
 * Taps for whole rows and cards: Material's ripple and focus ring, both in the shape of what is
 * tapped (DESIGN.md section 4.2, Focus).
 */

/** A whole row or card that does one thing. */
fun Modifier.tappable(
    shape: Shape,
    onClick: () -> Unit,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
    enabled: Boolean = true,
): Modifier =
    this
        .clip(shape)
        .clickable(
            interactionSource = null,
            indication = ripple(focusRingShape = shape),
            enabled = enabled,
            onClickLabel = onClickLabel,
            role = role,
            onClick = onClick,
        )

/** A whole row that is one of a few choices. */
fun Modifier.choosable(
    shape: Shape,
    selected: Boolean,
    onClick: () -> Unit,
    role: Role = Role.RadioButton,
    enabled: Boolean = true,
): Modifier =
    this
        .clip(shape)
        .selectable(
            selected = selected,
            interactionSource = null,
            indication = ripple(focusRingShape = shape),
            enabled = enabled,
            role = role,
            onClick = onClick,
        )

/** A whole row that turns on and off. */
fun Modifier.switchable(
    shape: Shape,
    value: Boolean,
    onValueChange: (Boolean) -> Unit,
    role: Role = Role.Switch,
    enabled: Boolean = true,
): Modifier =
    this
        .clip(shape)
        .toggleable(
            value = value,
            interactionSource = null,
            indication = ripple(focusRingShape = shape),
            enabled = enabled,
            role = role,
            onValueChange = onValueChange,
        )
