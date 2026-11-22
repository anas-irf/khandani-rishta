package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.khandanirishta.app.R
import com.khandanirishta.app.ui.components.ArchIcon
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.DarkSystemBarIcons
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.OrnamentRule
import com.khandanirishta.app.ui.components.contentWidth
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * "Mubarak! May Allah bless this marriage." over the whole screen (16 section 6.12): the outlined
 * arch, the rule and the line in serif on the page, then Close and the nikah guide.
 */
@Composable
internal fun NikahMessage(
    muslim: Boolean,
    onGuide: () -> Unit,
    onClose: () -> Unit,
) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        DarkSystemBarIcons()
        NikahContent(muslim = muslim, onGuide = onGuide, onClose = onClose)
    }
}

@Composable
internal fun NikahContent(
    muslim: Boolean,
    onGuide: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val title = if (muslim) R.string.chat_stage_nikah_title else R.string.chat_stage_nikah_title_other
    Surface(color = colors.background, contentColor = colors.onBackground, modifier = modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .safeDrawingPadding()
                    .contentWidth(Sizes.formWidth)
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s32),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.s20, Alignment.CenterVertically),
        ) {
            ArchIcon(Icons.Outlined.Celebration, size = Sizes.archIconLarge, tone = ArchTone.OUTLINE)
            OrnamentRule(centered = true)
            Text(
                text = stringResource(title),
                style = MaterialTheme.typography.displaySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.chat_stage_nikah_text),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
            )
            KrButton(
                text = stringResource(R.string.chat_stage_nikah_close),
                onClick = onClose,
                fullWidth = true,
            )
            KrButton(
                text = stringResource(R.string.chat_stage_nikah_guide),
                onClick = onGuide,
                variant = KrButtonVariant.SECONDARY,
                size = KrButtonSize.LARGE,
                icon = Icons.AutoMirrored.Outlined.MenuBook,
                fullWidth = true,
            )
        }
    }
}
