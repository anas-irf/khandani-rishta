package com.khandanirishta.app.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.FontScale
import androidx.compose.ui.test.ForcedSize
import androidx.compose.ui.test.LayoutDirection
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.then
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.ui.preview.SampleData
import com.khandanirishta.app.ui.preview.SampleTheme
import org.junit.Assert.assertEquals
import androidx.compose.ui.unit.LayoutDirection as UiDirection

/** A phone to test on: its width, the text size and the direction. */
data class TestPhone(
    val width: Int = 360,
    val height: Int = 640,
    val fontScale: Float = 1f,
    val direction: UiDirection = UiDirection.Ltr,
)

val SmallPhoneLargeText = TestPhone(width = 320, height = 568, fontScale = 2f)
val PhoneLargeText = TestPhone(width = 360, height = 640, fontScale = 2f)

private const val ROOT = "test-root"

/** Shows [content] on [phone] with the sample member signed in, in a scroll when [scrolls]. */
fun ComposeContentTestRule.show(
    phone: TestPhone = TestPhone(),
    me: Me = SampleData.me(),
    online: Boolean = true,
    scrolls: Boolean = true,
    content: @Composable () -> Unit,
) {
    setContent {
        val configuration =
            DeviceConfigurationOverride.ForcedSize(DpSize(phone.width.dp, phone.height.dp)) then
                DeviceConfigurationOverride.FontScale(phone.fontScale) then
                DeviceConfigurationOverride.LayoutDirection(phone.direction)
        DeviceConfigurationOverride(configuration) {
            SampleTheme(me = me) {
                CompositionLocalProvider(LocalOnline provides online) {
                    val scroll = if (scrolls) Modifier.verticalScroll(rememberScrollState()) else Modifier
                    Box(Modifier.testTag(ROOT).then(scroll)) { content() }
                }
            }
        }
    }
}

/**
 * DESIGN.md section 7: at 200% text rows stack and nothing that matters is cut. Every text node
 * shows all its lines, none is cut to an ellipsis or broken inside a word, and none reaches past
 * the side of the screen.
 */
fun ComposeContentTestRule.assertNoTextIsCut() {
    waitForIdle()
    val screen = onNodeWithTag(ROOT).fetchSemanticsNode().boundsInWindow
    val texts =
        onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true)
            .fetchSemanticsNodes()
    val problems = mutableListOf<String>()
    runOnIdle {
        for (node in texts) {
            val results = mutableListOf<TextLayoutResult>()
            node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
            val layout = results.firstOrNull() ?: continue
            val words = layout.layoutInput.text.text
            val lines = layout.lineCount
            if (layout.didOverflowHeight) problems += "too short: $words"
            val ellipsized = layout.layoutInput.overflow == TextOverflow.Ellipsis && lines > 0
            if (ellipsized && layout.isLineEllipsized(lines - 1)) problems += "ellipsis: $words"
            // Not didOverflowWidth: the layout behind semantics is as wide as the room there was,
            // so it flags every text that is narrower than that.
            for (line in 0 until lines) {
                val width = layout.getLineRight(line) - layout.getLineLeft(line)
                if (width > node.size.width + SLACK) problems += "too narrow: $words"
                val end = layout.getLineEnd(line)
                val wraps = line < lines - 1 && end in 1 until words.length
                if (wraps && words[end - 1].isLetterOrDigit() && words[end].isLetterOrDigit()) {
                    problems += "broken inside a word: $words"
                }
            }
            val start = node.positionInWindow.x
            if (start < screen.left - SLACK || start + node.size.width > screen.right + SLACK) {
                problems += "off the side: $words"
            }
        }
    }
    assertEquals(emptyList<String>(), problems)
}

private const val SLACK = 1f
