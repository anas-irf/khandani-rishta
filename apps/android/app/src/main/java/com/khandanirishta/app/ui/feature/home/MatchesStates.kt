package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.RelaxationHint
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The empty states of "Your matches" (specs/16 section 6.4), shared by Home and APP-MATCHES: the
 * exhausted pool; "Finding your matches..." over [skeleton] while it is asked again; then
 * "No matches yet." with Search.
 */
@Composable
internal fun MatchesEmpty(
    exhausted: Boolean,
    hints: List<RelaxationHint>,
    finding: Boolean,
    onSearch: () -> Unit,
    skeleton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        exhausted -> {
            ExhaustedNotice(empty = true, hints = hints, modifier = modifier)
        }

        finding -> {
            val label =
                rememberCandidate().pick(
                    R.string.discovery_matches_state_finding,
                    R.string.discovery_matches_state_finding_male,
                    R.string.discovery_matches_state_finding_female,
                )
            Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
                Text(
                    text = stringResource(label),
                    color = KrTheme.colors.textSecondary,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                skeleton()
            }
        }

        else -> {
            EmptyState(
                title = stringResource(R.string.discovery_matches_state_none_title),
                text = stringResource(R.string.discovery_matches_state_none_text),
                actionLabel = stringResource(R.string.discovery_matches_state_search),
                onAction = onSearch,
                modifier = modifier,
            )
        }
    }
}
