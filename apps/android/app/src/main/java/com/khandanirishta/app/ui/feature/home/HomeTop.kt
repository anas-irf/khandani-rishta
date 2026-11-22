package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.DismissibleBanner
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.MonogramArch
import com.khandanirishta.app.ui.components.MonogramTone
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.InvertedFocusRing
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The sand band at the top of Home (DESIGN.md section 6.21): the announcement, the update prompt,
 * the greeting, the first-run tip and the pending interests. It stays short, so that the first
 * match is on the first screen.
 */
@Composable
internal fun HomeTop(
    me: Me,
    dismissed: Set<String>?,
    onDismiss: (String) -> Unit,
    onViewInterests: () -> Unit,
) {
    Band(tone = BandTone.SAND, padding = TopPadding, maxWidth = Sizes.contentWidth, spacing = Spacing.s12) {
        val announcement = me.config.announcement
        if (announcement != null && dismissed != null) {
            val key = "announcement:" + announcement.textEn.hashCode()
            if (key !in dismissed) Announcement(announcement.textEn, announcement.url, onClose = { onDismiss(key) })
        }
        UpdatePrompt()
        Greeting()
        val tipKey = "first_run_tip:" + me.profile.id
        if (dismissed != null && tipKey !in dismissed) {
            DismissibleBanner(
                text = stringResource(R.string.discovery_home_first_run_text),
                icon = Icons.Outlined.Lightbulb,
                onClose = { onDismiss(tipKey) },
                closeLabel = stringResource(R.string.discovery_home_first_run_close),
                container = KrTheme.tonal,
                iconTint = MaterialTheme.colorScheme.primary,
            )
        }
        if (me.counters.pendingInterests > 0) {
            PendingCallout(count = me.counters.pendingInterests, onView = onViewInterests)
        }
    }
}

@Composable
private fun Announcement(
    message: String,
    url: String?,
    onClose: () -> Unit,
) {
    val links = rememberLinkOpener()
    // Only web addresses: the text and the link come from the server's configuration.
    val link = url?.takeIf { it.startsWith("https://", true) || it.startsWith("http://", true) }
    DismissibleBanner(
        text = message,
        icon = Icons.Outlined.Campaign,
        onClose = onClose,
        closeLabel = stringResource(R.string.discovery_home_announcement_close),
        actionLabel = link?.let { stringResource(R.string.common_announcement_learn_more) },
        onAction = link?.let { address -> { links.url(address) } },
    )
}

@Composable
private fun UpdatePrompt() {
    val appViewModel = LocalAppViewModel.current
    val update by appViewModel.optionalUpdate.collectAsStateWithLifecycle()
    val release = update ?: return
    val links = rememberLinkOpener()
    DismissibleBanner(
        text = stringResource(R.string.update_banner_text),
        icon = Icons.Outlined.SystemUpdate,
        onClose = appViewModel::dismissUpdateBanner,
        closeLabel = stringResource(R.string.a11y_close),
        actionLabel = stringResource(R.string.update_banner_action),
        onAction = { links.url(release.downloadUrl) },
    )
}

/** "Welcome back, Ayesha", or the managed form over two lines (specs/16 section 6.4 block 4). */
@Composable
internal fun Greeting(modifier: Modifier = Modifier) {
    val candidate = rememberCandidate()
    val name = candidate.name
    val greeting =
        when {
            name.isBlank() -> stringResource(R.string.discovery_home_greeting_plain)
            candidate.managed -> text(R.string.discovery_home_greeting_managed, "name" to name)
            else -> text(R.string.discovery_home_greeting, "name" to name)
        }
    val (first, rest) = remember(greeting, candidate.managed) { twoLines(greeting, split = candidate.managed) }
    AdaptiveRow(modifier = modifier, spacing = Spacing.s16, lineSpacing = Spacing.s8) {
        if (name.isNotBlank()) {
            val scale = LocalDensity.current.fontScale.coerceAtLeast(1f)
            MonogramArch(
                name = name,
                tone = MonogramTone.PAGE,
                size = DpSize(GreetingArchWidth * scale, GreetingArchHeight * scale),
            )
        }
        Column(
            Modifier
                .grow(basis = GreetingBasis)
                .semantics(mergeDescendants = true) { heading() },
        ) {
            Text(first, style = MaterialTheme.typography.headlineSmall)
            if (rest != null) {
                Text(
                    text = rest,
                    style = MaterialTheme.typography.bodyMedium,
                    color = KrTheme.colors.textSecondary,
                    modifier = Modifier.padding(top = Spacing.s4),
                )
            }
        }
    }
}

/**
 * The first sentence and, when [split], the rest for a line under it. The break is found here,
 * so the copy stays plain text.
 */
private fun twoLines(
    text: String,
    split: Boolean,
): Pair<String, String?> {
    val end = (if (split) SENTENCE_END.find(text) else null) ?: return text to null
    return text.substring(0, end.range.first + 1) to text.substring(end.range.last + 1).ifBlank { null }
}

/** The pending interests: their count and View, without photos, on primary. */
@Composable
internal fun PendingCallout(
    count: Long,
    onView: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sentence =
        rememberCandidate().pick(
            R.plurals.discovery_home_pending_text,
            R.plurals.discovery_home_pending_text_male,
            R.plurals.discovery_home_pending_text_female,
        )
    val colors = MaterialTheme.colorScheme
    Surface(
        color = colors.primary,
        contentColor = colors.onPrimary,
        shape = MaterialTheme.shapes.extraLarge,
        modifier = modifier,
    ) {
        InvertedFocusRing {
            AdaptiveRow(
                modifier = Modifier.padding(CalloutPadding),
                spacing = Spacing.s16,
                lineSpacing = Spacing.s12,
            ) {
                Text(
                    text = plural(sentence, count.toInt()),
                    style = KrType.emphasis,
                    modifier = Modifier.grow(basis = CalloutBasis),
                )
                KrButton(
                    text = stringResource(R.string.discovery_home_pending_view),
                    onClick = onView,
                    variant = KrButtonVariant.INVERSE,
                )
            }
        }
    }
}

private val SENTENCE_END = Regex("[.!?\u06D4]\\s+")
private val TopPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s16, end = Spacing.gutter, bottom = Spacing.s12)
private val CalloutPadding =
    PaddingValues(start = Spacing.gutter, top = Spacing.s12, end = Spacing.s12, bottom = Spacing.s12)
private val GreetingArchWidth = 44.dp
private val GreetingArchHeight = 55.dp
private val GreetingBasis = 140.dp
private val CalloutBasis = 140.dp
