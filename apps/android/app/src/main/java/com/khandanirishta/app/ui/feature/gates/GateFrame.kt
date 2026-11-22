package com.khandanirishta.app.ui.feature.gates

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.KrTopBar
import com.khandanirishta.app.ui.components.OrnamentRule
import com.khandanirishta.app.ui.components.Wordmark
import com.khandanirishta.app.ui.components.exceptBottom
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The page every gate screen and the update screen share (the web's `GateLayout`): the wordmark
 * with the screen's menu, the title on sand, then one column. The way on goes in [bottomBar], a
 * `KrActionBar`, so it stays in view.
 */
@Composable
internal fun GateFrame(
    title: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    bottomBar: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            KrTopBar {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(
                                start = Spacing.s16,
                                top = Spacing.s4,
                                end = Spacing.s4,
                                bottom = Spacing.s4,
                            ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Wordmark(Modifier.weight(1f))
                    actions()
                }
            }
        },
        bottomBar = bottomBar,
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding.exceptBottom())
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = padding.calculateBottomPadding()),
        ) {
            Band(tone = BandTone.SAND, maxWidth = Sizes.formWidth, spacing = Spacing.s12) {
                OrnamentRule()
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() },
                )
            }
            Band(maxWidth = Sizes.formWidth, spacing = Spacing.s20, content = content)
        }
    }
}
