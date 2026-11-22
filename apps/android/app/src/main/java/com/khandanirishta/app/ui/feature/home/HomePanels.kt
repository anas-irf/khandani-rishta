package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.MemberAvatar
import com.khandanirishta.app.ui.components.ProgressRing
import com.khandanirishta.app.ui.components.RingKind
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.SmallArchShape
import com.khandanirishta.app.ui.theme.Spacing

/** "Viewed your profile": up to five arches, the count of the week, then See all. */
@Composable
internal fun VisitorsPanel(
    count: Long,
    visitors: List<ProfileCard>,
    onOpen: (String) -> Unit,
    onSeeAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val candidate = rememberCandidate()
    val title = candidate.heading(R.string.discovery_home_visitors_title, R.string.discovery_home_visitors_title_named)
    val seeAll =
        candidate.heading(
            R.string.discovery_home_visitors_see_all_label,
            R.string.discovery_home_visitors_see_all_label_named,
        )
    val openLabel = stringResource(R.string.a11y_open_profile)
    TonalPanel(modifier = modifier, padding = PanelPadding, spacing = Spacing.s12) {
        Text(
            text = text(title, "name" to candidate.name),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        if (visitors.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                verticalArrangement = Arrangement.spacedBy(Spacing.s8),
            ) {
                visitors.take(VISITORS_SHOWN).forEach { visitor ->
                    Box(
                        Modifier.tappable(
                            shape = SmallArchShape,
                            onClick = { onOpen(visitor.id) },
                            onClickLabel = openLabel,
                        ),
                    ) {
                        MemberAvatar(
                            photo = visitor.photo,
                            name = visitor.displayName,
                            gender = visitor.gender,
                            size = Sizes.arch48,
                            decorative = false,
                        )
                    }
                }
            }
        }
        Text(
            text = plural(R.plurals.discovery_home_visitors_text, count.toInt()),
            style = MaterialTheme.typography.bodyLarge.merge(KrType.numbers),
        )
        KrTextLink(
            text = stringResource(R.string.discovery_home_visitors_see_all),
            onClick = onSeeAll,
            contentDescription = text(seeAll, "name" to candidate.name),
        )
    }
}

/** The completeness card, shown under 70. */
@Composable
internal fun CompletenessPanel(
    value: Int,
    onImprove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val action =
        rememberCandidate().pick(
            R.string.discovery_home_completeness_action,
            R.string.discovery_home_completeness_action_male,
            R.string.discovery_home_completeness_action_female,
        )
    TonalPanel(modifier = modifier, padding = PanelPadding) {
        AdaptiveRow(spacing = Spacing.s24, lineSpacing = Spacing.s16) {
            ProgressRing(
                value = value,
                kind = RingKind.COMPLETENESS,
                description = text(R.string.discovery_home_completeness_ring, "value" to value.coerceIn(0, MAX)),
            )
            Column(
                modifier = Modifier.grow(basis = CompletenessBasis),
                verticalArrangement = Arrangement.spacedBy(Spacing.s12),
            ) {
                Text(
                    text = stringResource(R.string.discovery_home_completeness_text),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.semantics { heading() },
                )
                KrButton(text = stringResource(action), onClick = onImprove, variant = KrButtonVariant.SECONDARY)
            }
        }
    }
}

/** "Never send money to anyone you meet here. Read the safety tips." */
@Composable
internal fun SafetyLine(
    onReadTips: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12, Alignment.CenterHorizontally),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        IconText(
            icon = Icons.Outlined.WarningAmber,
            text = stringResource(R.string.discovery_home_safety_text),
            color = KrTheme.colors.textSecondary,
            tint = MaterialTheme.colorScheme.primary,
        )
        KrTextLink(text = stringResource(R.string.discovery_home_safety_link), onClick = onReadTips)
    }
}

private val PanelPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s24)
private val CompletenessBasis = 180.dp
private const val VISITORS_SHOWN = 5
private const val MAX = 100
