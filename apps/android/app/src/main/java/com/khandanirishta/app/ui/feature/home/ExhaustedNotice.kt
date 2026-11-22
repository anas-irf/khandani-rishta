package com.khandanirishta.app.ui.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.RelaxationHint
import com.khandanirishta.app.ui.components.Diamond
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.IconTextLine
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.components.dashedBorder
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.Search
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.dimensionText
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.InnerArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.TABULAR_FIGURES
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Whether the age is a must-have, for the extra line of 10 section 8.7. */
@HiltViewModel
class ExhaustedNoticeViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableAgeHint = MutableStateFlow(false)
        val ageHint: StateFlow<Boolean> = mutableAgeHint.asStateFlow()

        init {
            load()
            viewModelScope.launch { invalidation.on(DataKey.Preferences).collect { load() } }
        }

        private fun load() {
            viewModelScope.launch {
                profiles.preferences().onSuccess { mutableAgeHint.value = it.ageImportance == Importance.MUST }
            }
        }
    }

/**
 * The exhausted pool (specs/16 section 6.4, 10 section 8.7, DESIGN.md section 6.15): the headline,
 * one line per relaxation hint and "Review preferences". [empty] is the panel in place of the
 * list, with Search beside the action; otherwise it is the card that closes the list, at least
 * [minHeight] tall.
 */
@Composable
fun ExhaustedNotice(
    empty: Boolean,
    hints: List<RelaxationHint>,
    modifier: Modifier = Modifier,
    minHeight: Dp = 0.dp,
    viewModel: ExhaustedNoticeViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val ageHint by viewModel.ageHint.collectAsStateWithLifecycle()
    val review = { navigator.openOnTab(Tab.ME, listOf(MyPreferences)) }
    if (empty) {
        ExhaustedPanel(
            hints = hints,
            ageHint = ageHint,
            onReview = review,
            onSearch = { navigator.openOnTab(Tab.SEARCH, listOf(Search())) },
            modifier = modifier,
        )
    } else {
        ExhaustedCard(hints = hints, ageHint = ageHint, onReview = review, minHeight = minHeight, modifier = modifier)
    }
}

/** "No more members fit all your must-haves right now." in place of the list. */
@Composable
internal fun ExhaustedPanel(
    hints: List<RelaxationHint>,
    ageHint: Boolean,
    onReview: () -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title =
        rememberCandidate().pick(
            R.string.discovery_matches_state_exhausted_empty,
            R.string.discovery_matches_state_exhausted_empty_male,
            R.string.discovery_matches_state_exhausted_empty_female,
        )
    EmptyState(
        title = stringResource(title),
        actionLabel = stringResource(R.string.discovery_matches_state_review_preferences),
        onAction = onReview,
        secondaryLabel = stringResource(R.string.discovery_matches_state_search),
        onSecondary = onSearch,
        modifier = modifier,
    ) {
        HintRows(hints, ageHint, MaterialTheme.typography.bodyLarge)
    }
}

/** The card-wide panel that closes a list, with its button at the bottom. */
@Composable
internal fun ExhaustedCard(
    hints: List<RelaxationHint>,
    ageHint: Boolean,
    onReview: () -> Unit,
    modifier: Modifier = Modifier,
    minHeight: Dp = 0.dp,
) {
    val title =
        rememberCandidate().pick(
            R.string.discovery_matches_state_exhausted_end,
            R.string.discovery_matches_state_exhausted_end_male,
            R.string.discovery_matches_state_exhausted_end_female,
        )
    val gold = KrTheme.colors.ornament
    TonalPanel(modifier = modifier, padding = CardPadding) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = (minHeight - CardPaddingY * 2).coerceAtLeast(0.dp)),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
                Box(
                    modifier =
                        Modifier
                            .clearAndSetSemantics {}
                            .size(Sizes.arch64)
                            .dashedBorder(InnerArchShape, gold),
                    contentAlignment = Alignment.Center,
                ) {
                    Diamond(size = CardDiamond)
                }
                Text(
                    text = stringResource(title),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.semantics { heading() },
                )
                HintRows(hints, ageHint, MaterialTheme.typography.bodyMedium)
            }
            KrButton(
                text = stringResource(R.string.discovery_matches_state_review_preferences),
                onClick = onReview,
                variant = KrButtonVariant.SECONDARY,
                fullWidth = true,
                modifier = Modifier.padding(top = Spacing.s16),
            )
        }
    }
}

@Composable
private fun HintRows(
    hints: List<RelaxationHint>,
    ageHint: Boolean,
    style: TextStyle,
) {
    if (hints.isEmpty() && !ageHint) return
    val candidate = rememberCandidate()
    val hintText =
        candidate.pick(
            R.string.discovery_matches_state_hint,
            R.string.discovery_matches_state_hint_male,
            R.string.discovery_matches_state_hint_female,
        )
    val strong =
        SpanStyle(
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = FontWeight.Bold,
            fontFeatureSettings = TABULAR_FIGURES,
        )
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
        hints.take(HINTS_MAX).forEach { hint ->
            val marked =
                text(
                    hintText,
                    "dimension" to "$VALUE_EDGE${dimensionText(hint.dimension)}$VALUE_EDGE",
                    "count" to "$VALUE_EDGE${hint.extraProfiles}$VALUE_EDGE",
                )
            HintRow(Icons.Outlined.Tune, remember(marked, strong) { boldValues(marked, strong) }, style)
        }
        if (ageHint) {
            val age =
                candidate.pick(
                    R.string.discovery_matches_state_age_hint,
                    R.string.discovery_matches_state_age_hint_male,
                    R.string.discovery_matches_state_age_hint_female,
                )
            HintRow(Icons.Outlined.Schedule, AnnotatedString(stringResource(age)), style)
        }
    }
}

@Composable
private fun HintRow(
    icon: ImageVector,
    text: AnnotatedString,
    style: TextStyle,
) {
    IconTextLine(
        icon = icon,
        style = style,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        iconSize = HintIcon,
        gap = Spacing.s12,
    ) {
        Text(text, style = style, color = KrTheme.colors.textSecondary, modifier = Modifier.weight(1f))
    }
}

/**
 * The values of a sentence in bold. The bold is found here, so the copy stays plain text and the
 * web shows the same strings (specs/22 section 1).
 */
private fun boldValues(
    marked: String,
    strong: SpanStyle,
): AnnotatedString =
    buildAnnotatedString {
        // Every second piece is one of the values.
        marked.split(VALUE_EDGE).forEachIndexed { index, part ->
            if (index % 2 == 1) withStyle(strong) { append(part) } else append(part)
        }
    }

/** An invisible separator: no copy and no label holds one. */
private const val VALUE_EDGE = '\u2063'
private const val HINTS_MAX = 2
private val HintIcon = 22.dp
private val CardDiamond = 10.dp
private val CardPaddingY = 28.dp
private val CardPadding = PaddingValues(horizontal = Spacing.s24, vertical = CardPaddingY)
