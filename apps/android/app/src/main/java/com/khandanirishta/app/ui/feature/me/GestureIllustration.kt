package com.khandanirishta.app.ui.feature.me

import androidx.compose.foundation.Canvas
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gesture
import com.khandanirishta.app.ui.text.text
import kotlin.math.min

/*
 * The line drawing of each selfie gesture (specs/12 section 4.2: "a simple line drawing per
 * gesture, shipped with the clients"), the same drawing as the web's GestureIllustration: a face
 * and shoulders, and the hand of the gesture next to the face. Coordinates are those of a
 * 170 by 190 canvas.
 */

private const val VIEW_WIDTH = 170f
private const val VIEW_HEIGHT = 190f
private const val LINE_WIDTH = 3f
private val LineStroke = Stroke(width = LINE_WIDTH, cap = StrokeCap.Round, join = StrokeJoin.Round)

/** The mouth and the shoulders. The head and eyes are drawn as an oval and two dots. */
private val FacePaths =
    listOf(
        "M52 86 q10 8 20 0",
        "M14 188 q0 -60 48 -66 q48 6 48 66",
    )

private fun handPaths(gesture: Gesture): List<String> =
    when (gesture) {
        // Two raised fingers beside the cheek.
        Gesture.PEACE_SIGN -> {
            listOf(
                "M118 118 v-22 a6 6 0 0 1 12 0 v22",
                "M122 98 l-6 -30 a5 5 0 0 1 10 -2 l5 28",
                "M128 96 l4 -32 a5 5 0 0 1 10 1 l-3 33",
                "M112 120 q-2 26 14 30 h10 q14 -4 12 -30 q0 -10 -10 -10 h-18 q-8 0 -8 10 z",
            )
        }

        // A fist with the thumb pointing up.
        Gesture.THUMBS_UP -> {
            listOf(
                "M112 112 h30 a8 8 0 0 1 0 16 h-30 z",
                "M112 128 h28 a8 8 0 0 1 0 16 h-28 z",
                "M112 144 h24 a7 7 0 0 1 0 14 h-24 z",
                "M112 112 l6 -30 a6 6 0 0 1 12 2 l-4 28",
            )
        }

        // The open palm with five fingers.
        Gesture.OPEN_PALM -> {
            listOf(
                "M110 150 q-6 -30 0 -48 h34 q6 18 0 48 z",
                "M112 102 v-26 a4 4 0 0 1 8 0 v26",
                "M121 102 v-34 a4 4 0 0 1 8 0 v34",
                "M130 102 v-32 a4 4 0 0 1 8 0 v32",
                "M139 104 v-24 a4 4 0 0 1 8 0 v30",
                "M110 120 l-12 -14 a4 4 0 0 1 6 -6 l8 8",
            )
        }

        // One hand flat on top of the head, the arm coming up from the shoulder.
        Gesture.HAND_ON_HEAD -> {
            listOf(
                "M40 18 h44 q8 0 8 6 q0 6 -8 6 h-44 q-6 0 -6 -6 q0 -6 6 -6 z",
                "M92 26 q24 10 22 70 q0 24 -10 44",
            )
        }

        Gesture.UNKNOWN -> {
            emptyList()
        }
    }

/**
 * A line drawing of a face and the requested gesture, described by its instruction unless it is
 * [decorative], beside words that already say it.
 */
@Composable
internal fun GestureIllustration(
    gesture: Gesture,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    decorative: Boolean = false,
) {
    val instruction = gestureInstruction(gesture)?.let { stringResource(it) }.orEmpty()
    val description = text(R.string.verification_gesture_illustration, "instruction" to instruction)
    val described =
        if (decorative) {
            Modifier
        } else {
            Modifier.semantics {
                contentDescription = description
                role = Role.Image
            }
        }
    val paths =
        remember(gesture) {
            (FacePaths + handPaths(gesture)).map { data -> PathParser().parsePathString(data).toPath() }
        }
    Canvas(modifier.then(described)) {
        val factor = min(size.width / VIEW_WIDTH, size.height / VIEW_HEIGHT)
        val left = (size.width - VIEW_WIDTH * factor) / 2f
        val top = (size.height - VIEW_HEIGHT * factor) / 2f
        translate(left = left, top = top) {
            scale(scaleX = factor, scaleY = factor, pivot = Offset.Zero) {
                drawOval(color = color, topLeft = Offset(30f, 32f), size = Size(64f, 76f), style = LineStroke)
                drawCircle(color = color, radius = 2.5f, center = Offset(51f, 64f))
                drawCircle(color = color, radius = 2.5f, center = Offset(73f, 64f))
                paths.forEach { path -> drawPath(path = path, color = color, style = LineStroke) }
            }
        }
    }
}
