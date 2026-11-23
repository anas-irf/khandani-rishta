package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Compatibility
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.Disclosure
import com.khandanirishta.app.ui.components.HeadingOrnament
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.InfoRow
import com.khandanirishta.app.ui.components.KrChip
import com.khandanirishta.app.ui.components.KrMeter
import com.khandanirishta.app.ui.components.KrTag
import com.khandanirishta.app.ui.components.LockedRow
import com.khandanirishta.app.ui.components.LockedValue
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.MeterTone
import com.khandanirishta.app.ui.components.ProgressRing
import com.khandanirishta.app.ui.components.ReasonChips
import com.khandanirishta.app.ui.components.RingKind
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SectionCard
import com.khandanirishta.app.ui.components.SectionHeading
import com.khandanirishta.app.ui.components.TonalPanel
import com.khandanirishta.app.ui.components.bandToneAt
import com.khandanirishta.app.ui.components.lockedText
import com.khandanirishta.app.ui.components.percentText
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.dimensionText
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The read-only body of a profile for the owner's own preview (specs/08 section 4): the hero and
 * the same bands as APP-PROFILE, with no compatibility and no control that acts on the profile.
 * APP-PROFILE shows the same parts as items of its own list.
 */
@Composable
fun ProfileDetailBody(
    detail: ProfileDetail,
    modifier: Modifier = Modifier,
) {
    val bands = rememberProfileBands(detail, preview = true)
    Column(modifier.fillMaxWidth()) {
        ProfileHero(detail = detail, onOpenPhoto = null, onRequestPhotos = null)
        bands.forEachIndexed { index, band ->
            Band(tone = bandToneAt(index), maxWidth = Sizes.contentWidth) { ProfileBandContent(detail, band) }
        }
    }
}

@Composable
internal fun rememberProfileBands(
    detail: ProfileDetail,
    preview: Boolean = false,
): List<ProfileBand> {
    val reference = LocalReference.current
    val res = LocalResources.current
    return remember(detail, reference, res, preview) { profileBands(detail, reference, res, preview) }
}

/**
 * The bands under the hero, one item each, taking turns between page and sand whichever parts
 * are there (DESIGN.md section 6.10).
 */
internal fun LazyListScope.profileBandItems(
    detail: ProfileDetail,
    bands: List<ProfileBand>,
) {
    itemsIndexed(
        items = bands,
        key = { _, band -> band.key },
        contentType = { _, band -> band::class },
    ) { index, band ->
        Band(tone = bandToneAt(index), maxWidth = Sizes.contentWidth) { ProfileBandContent(detail, band) }
    }
}

@Composable
private fun ProfileBandContent(
    detail: ProfileDetail,
    band: ProfileBand,
) {
    val name = detail.card.displayName
    when (band) {
        is ProfileBand.Match -> {
            CompatibilityBlock(band.compatibility, name)
        }

        is ProfileBand.About -> {
            SectionCard(title = text(R.string.profile_about_title, "name" to name)) { MemberText(band.text) }
        }

        is ProfileBand.Details -> {
            DetailGroups(band.groups, detail.relation.tier)
        }

        ProfileBand.LookingFor -> {
            LookingForBlock(detail)
        }
    }
}

/** Block 3: the ring, the reasons, the two meters, then every dimension behind "See details". */
@Composable
private fun CompatibilityBlock(
    compatibility: Compatibility,
    name: String,
) {
    val candidate = rememberCandidate()
    var open by rememberSaveable { mutableStateOf(false) }
    val extra = KrTheme.colors
    val percent = compatibility.compat
    val ring = text(R.string.profile_compat_ring, "value" to percent)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s24)) {
        AdaptiveRow(spacing = Spacing.s40, lineSpacing = Spacing.s24, verticalAlignment = Alignment.CenterVertically) {
            ProgressRing(
                value = percent,
                kind = RingKind.MATCH,
                description = ring,
                // The word of the ring is what the translation puts beside the number.
                caption = ring.replace("$percent%", "").trim(),
            )
            Column(
                modifier = Modifier.grow(basis = CompatBasis),
                verticalArrangement = Arrangement.spacedBy(Spacing.s16),
            ) {
                SectionHeading(title = stringResource(R.string.profile_compat_title), ornament = HeadingOrnament.NONE)
                ReasonChips(compatibility.reasons, style = MaterialTheme.typography.bodyMedium)
                val viewerFit =
                    candidate.pick(
                        R.string.profile_compat_viewer_fit,
                        R.string.profile_compat_viewer_fit_male,
                        R.string.profile_compat_viewer_fit_female,
                    )
                FitMeter(
                    label = text(viewerFit, "name" to name, "value" to compatibility.viewerFit),
                    value = compatibility.viewerFit,
                    tone = MeterTone.SUCCESS,
                )
                val ownerFit =
                    candidate.pick(
                        R.string.profile_compat_owner_fit,
                        R.string.profile_compat_owner_fit_male,
                        R.string.profile_compat_owner_fit_female,
                    )
                FitMeter(
                    label = text(ownerFit, "name" to name, "value" to compatibility.ownerFit),
                    value = compatibility.ownerFit,
                    tone = MeterTone.PRIMARY,
                )
            }
        }
        if (compatibility.dimensions.isNotEmpty()) {
            val toggle = if (open) R.string.profile_compat_details_hide else R.string.profile_compat_details_show
            TonalPanel(padding = DetailsPadding) {
                Disclosure(
                    title = stringResource(toggle),
                    expanded = open,
                    onExpandedChange = { open = it },
                    spacing = 0.dp,
                ) {
                    compatibility.dimensions.forEach { dimension ->
                        Column(Modifier.semantics(mergeDescendants = true) {}) {
                            AdaptiveRow(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .heightIn(min = DetailRow)
                                        .padding(vertical = Spacing.s8),
                                lineSpacing = Spacing.s4,
                            ) {
                                DimensionName(
                                    dimension = dimension.dimension,
                                    must = dimension.importance == Importance.MUST,
                                    mustLabel = stringResource(R.string.profile_compat_must),
                                    color = extra.textSecondary,
                                    modifier = Modifier.grow(basis = DimensionBasis),
                                )
                                MatchResult(
                                    matched = dimension.matched,
                                    matchText = stringResource(R.string.profile_compat_matched),
                                    differsText = stringResource(R.string.profile_compat_not_matched),
                                )
                            }
                            RowDivider()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FitMeter(
    label: String,
    value: Int,
    tone: MeterTone,
) {
    val color = if (tone == MeterTone.SUCCESS) KrTheme.colors.success else MaterialTheme.colorScheme.primary
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
        Text(percentText(label, color), style = MaterialTheme.typography.bodyLarge)
        KrMeter(progress = { value.toFloat() / PERCENT }, tone = tone)
    }
}

@Composable
private fun DimensionName(
    dimension: String,
    must: Boolean,
    mustLabel: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
        verticalArrangement = Arrangement.spacedBy(Spacing.s4),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(dimensionText(dimension), style = MaterialTheme.typography.bodyMedium, color = color)
        if (must) KrTag(mustLabel)
    }
}

/** A tick or a cross, always with words. A difference is never red (DESIGN.md section 2.2). */
@Composable
private fun MatchResult(
    matched: Boolean,
    matchText: String,
    differsText: String,
    modifier: Modifier = Modifier,
) {
    IconText(
        icon = if (matched) Icons.Outlined.Check else Icons.Outlined.Close,
        text = if (matched) matchText else differsText,
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
        color = if (matched) KrTheme.colors.success else KrTheme.colors.textSecondary,
        iconSize = Sizes.iconMedium,
        modifier = modifier,
    )
}

/** Blocks 5 to 10: one group, or two side by side where they fit. */
@Composable
private fun DetailGroups(
    groups: List<ProfileGroup>,
    tier: Tier,
) {
    if (groups.size == 1) {
        GroupBlock(groups.first(), tier)
        return
    }
    AdaptiveRow(spacing = Spacing.s56, lineSpacing = Spacing.s40, verticalAlignment = Alignment.Top) {
        groups.forEach { group -> GroupBlock(group, tier, Modifier.grow(basis = GroupBasis)) }
    }
}

@Composable
private fun GroupBlock(
    group: ProfileGroup,
    tier: Tier,
    modifier: Modifier = Modifier,
) {
    val placeholder = lockedText(tier)
    SectionCard(title = group.title, modifier = modifier) {
        group.rows.forEach { row ->
            val value = row.value
            if (value == null) {
                LockedRow(label = row.label, placeholder = placeholder)
            } else {
                // Some values are the member's own words, with a direction of their own.
                InfoRow(label = row.label) { MemberText(value, style = MaterialTheme.typography.titleSmall) }
            }
        }
        if (group.locked) LockedValue(placeholder)
        if (group.aboutFamily != null) {
            Column(Modifier.padding(top = Spacing.s16), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                Text(
                    text = stringResource(R.string.profile_rows_about_family),
                    style = KrType.emphasis,
                    modifier = Modifier.semantics { heading() },
                )
                MemberText(group.aboutFamily)
            }
        }
        if (group.hobbies.isNotEmpty()) {
            // Chips, because several values do not read as one.
            Column(Modifier.padding(top = Spacing.s16), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                // A heading like "About family" above it, for the eye and for TalkBack.
                Text(
                    text = stringResource(R.string.profile_rows_hobbies),
                    style = KrType.emphasis,
                    modifier = Modifier.semantics { heading() },
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                    verticalArrangement = Arrangement.spacedBy(Spacing.s8),
                ) {
                    group.hobbies.forEach { KrChip(it) }
                }
            }
        }
    }
}

/** Block 11: how many the viewer matches, the note, then one line per preference. */
@Composable
private fun LookingForBlock(detail: ProfileDetail) {
    val candidate = rememberCandidate()
    val reference = LocalReference.current
    val res = LocalResources.current
    val viewerGender = LocalMe.current?.profile?.gender
    val name = detail.card.displayName
    val lookingFor = detail.lookingFor
    val colors = MaterialTheme.colorScheme
    SectionCard(title = text(R.string.profile_looking_for_title, "name" to name)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
            // The total counts only lines that could be compared, so none has a "0 of 0" summary
            // (10 section 11.1), as in the owner's own preview.
            if (lookingFor.lines.isNotEmpty() && lookingFor.total > 0) {
                val summary =
                    candidate.pick(
                        R.string.profile_looking_for_summary,
                        R.string.profile_looking_for_summary_male,
                        R.string.profile_looking_for_summary_female,
                    )
                Surface(
                    color = KrTheme.colors.successContainer,
                    contentColor = KrTheme.colors.success,
                    shape = MaterialTheme.shapes.large,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = text(summary, "matched" to lookingFor.matched, "total" to lookingFor.total),
                        style = MaterialTheme.typography.titleLarge.merge(KrType.numbers),
                        modifier = Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.s16),
                    )
                }
            }
            detail.partnerNotes?.let { MemberText(it) }
            if (lookingFor.lines.isEmpty()) {
                Text(
                    text = text(R.string.profile_looking_for_none, "name" to name),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant,
                )
            } else {
                val youMatch =
                    candidate.pick(
                        R.string.profile_looking_for_you_match,
                        R.string.profile_looking_for_you_match_male,
                        R.string.profile_looking_for_you_match_female,
                    )
                val youDiffer =
                    candidate.pick(
                        R.string.profile_looking_for_you_do_not_match,
                        R.string.profile_looking_for_you_do_not_match_male,
                        R.string.profile_looking_for_you_do_not_match_female,
                    )
                Column {
                    lookingFor.lines.forEach { line ->
                        val values =
                            remember(line, reference, res, viewerGender) {
                                lookingForValues(line.dimension, line.summaryValues, reference, res, viewerGender)
                            }
                        Column(Modifier.semantics(mergeDescendants = true) {}) {
                            AdaptiveRow(
                                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.s12),
                                spacing = Spacing.s16,
                                lineSpacing = Spacing.s8,
                                verticalAlignment = Alignment.Top,
                            ) {
                                Column(
                                    modifier = Modifier.grow(basis = LineBasis),
                                    verticalArrangement = Arrangement.spacedBy(Spacing.s4),
                                ) {
                                    DimensionName(
                                        dimension = line.dimension,
                                        must = line.importance == Importance.MUST,
                                        mustLabel = stringResource(R.string.profile_looking_for_must),
                                        color = colors.onSurfaceVariant,
                                    )
                                    Text(values, style = MaterialTheme.typography.titleSmall)
                                }
                                line.viewerMatches?.let {
                                    MatchResult(it, stringResource(youMatch), stringResource(youDiffer))
                                }
                            }
                            RowDivider()
                        }
                    }
                }
            }
        }
    }
}

private val DetailsPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.s4)
private val CompatBasis = 240.dp
private val DimensionBasis = 120.dp
private val DetailRow = 52.dp
private val GroupBasis = 340.dp
private val LineBasis = 160.dp
private const val PERCENT = 100
