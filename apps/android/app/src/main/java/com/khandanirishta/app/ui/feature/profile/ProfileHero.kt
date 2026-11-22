package com.khandanirishta.app.ui.feature.profile

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.BadgeRow
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.BandTone
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrOutlinedIconButton
import com.khandanirishta.app.ui.components.MetaLine
import com.khandanirishta.app.ui.components.NameAge
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.rememberCardFacts
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.activityLabel
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.text.verifications
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.theme.Strokes
import kotlinx.coroutines.launch

/**
 * The sand band at the top of a profile (16 section 6.7 blocks 1, 2 and 2a): the gallery beside
 * the name and facts, or over them where the two do not fit.
 */
@Composable
internal fun ProfileHero(
    detail: ProfileDetail,
    onOpenPhoto: ((index: Int) -> Unit)?,
    onRequestPhotos: (() -> Unit)?,
    modifier: Modifier = Modifier,
    requesting: Boolean = false,
) {
    val window = LocalWindowInfo.current.containerDpSize
    val galleryWidth = (window.width * GALLERY_SHARE).coerceIn(GalleryMin, Sizes.galleryMax)
    Band(modifier = modifier, tone = BandTone.SAND, maxWidth = Sizes.contentWidth) {
        AdaptiveRow(spacing = Spacing.s40, lineSpacing = Spacing.s24, verticalAlignment = Alignment.Top) {
            Box(Modifier.grow(basis = GalleryBasis), contentAlignment = Alignment.TopCenter) {
                ProfileGallery(
                    detail = detail,
                    onOpen = onOpenPhoto,
                    onRequestPhotos = onRequestPhotos,
                    requesting = requesting,
                    modifier = Modifier.width(galleryWidth),
                )
            }
            Column(
                modifier = Modifier.grow(basis = FactsBasis),
                verticalArrangement = Arrangement.spacedBy(Spacing.s16),
            ) {
                ProfileHeader(detail)
                VerificationPanel(detail.card.badges)
            }
        }
    }
}

@Composable
private fun ProfileHeader(detail: ProfileDetail) {
    val card = detail.card
    val reference = LocalReference.current
    val facts = rememberCardFacts(card)
    val details =
        remember(detail, reference, facts) {
            listOf(
                facts.location,
                facts.work,
                reference.option(Lists.MARITAL_STATUS, card.maritalStatus),
                detail.community.sectCode
                    ?.let { reference.sect(it) }
                    .orEmpty(),
            )
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
        CodeAndActivity(detail)
        NameAge(
            name = card.displayName,
            age = card.age,
            style = MaterialTheme.typography.headlineLarge,
            modifier = Modifier.semantics { heading() },
        )
        BadgeRow(card.badges)
        MetaLine(details, style = MaterialTheme.typography.bodyLarge)
        if (card.managedBy != ManagedBy.SELF && card.managedBy != ManagedBy.UNKNOWN) {
            val colors = MaterialTheme.colorScheme
            Surface(
                color = colors.primaryContainer,
                contentColor = colors.primary,
                shape = MaterialTheme.shapes.large,
            ) {
                IconText(
                    icon = Icons.Outlined.Groups,
                    text =
                        text(
                            R.string.profile_header_managed_by,
                            "label" to reference.option(Lists.MANAGED_BY, card.managedBy),
                        ),
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                    iconSize = Sizes.iconMedium,
                    gap = Spacing.s12,
                    modifier = Modifier.padding(horizontal = Spacing.s16, vertical = Spacing.s8),
                )
            }
        }
    }
}

/** The code with its copy control, and when the member was last here. */
@Composable
private fun CodeAndActivity(detail: ProfileDetail) {
    val colors = MaterialTheme.colorScheme
    val code = detail.card.publicCode
    val spokenCode = text(R.string.profile_header_code, "code" to code)
    val copyLabel = stringResource(R.string.profile_header_copy_code)
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by rememberSaveable { mutableStateOf(false) }
    val online = detail.isOnline == true
    val activity =
        if (online) {
            stringResource(R.string.profile_header_online)
        } else {
            activityLabel(detail.card.lastActive)?.let { stringResource(it) }
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = code,
                style = KrType.badge.merge(KrType.numbers),
                modifier =
                    Modifier
                        .semantics { contentDescription = spokenCode }
                        .background(KrTheme.tonal, MaterialTheme.shapes.large)
                        .padding(horizontal = Spacing.s12, vertical = Spacing.s8),
            )
            KrOutlinedIconButton(
                icon = Icons.Outlined.ContentCopy,
                contentDescription = copyLabel,
                onClick = {
                    scope.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(copyLabel, code)))
                        copied = true
                    }
                },
            )
            if (activity != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Filled when online, a ring otherwise: the words say it too.
                    val dot =
                        if (online) {
                            Modifier.background(KrTheme.colors.online, CircleShape)
                        } else {
                            Modifier.border(Strokes.control, colors.outline, CircleShape)
                        }
                    Box(Modifier.size(ActivityDot).then(dot))
                    Text(
                        text = activity,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
            }
        }
        if (copied) {
            CaptionText(
                text = stringResource(R.string.profile_header_copied),
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/** Block 2a: one line per earned check, then the disclaimer (12 section 1.2). */
@Composable
private fun VerificationPanel(badges: List<Badge>) {
    val lines =
        remember(badges) {
            badges.verifications().mapNotNull { badge ->
                when (badge) {
                    Badge.ID_VERIFIED -> R.string.profile_verification_id_verified
                    Badge.PHOTO_VERIFIED -> R.string.profile_verification_photo_verified
                    Badge.PHONE_VERIFIED -> R.string.profile_verification_phone_verified
                    else -> null
                }
            }
        }
    if (lines.isEmpty()) return
    val extra = KrTheme.colors
    Surface(
        color = extra.successContainer,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            Text(
                text = stringResource(R.string.profile_verification_title),
                style = KrType.figure,
                modifier = Modifier.semantics { heading() },
            )
            lines.forEach { line ->
                IconText(
                    icon = Icons.Outlined.Check,
                    text = stringResource(line),
                    style = MaterialTheme.typography.bodyMedium,
                    tint = extra.success,
                    gap = Spacing.s12,
                )
            }
            RowDivider(color = extra.successRule)
            Text(
                text = stringResource(R.string.profile_verification_disclaimer),
                style = MaterialTheme.typography.bodySmall,
                color = extra.textSecondary,
            )
        }
    }
}

private val GalleryMin = 260.dp
private val GalleryBasis = 300.dp
private val FactsBasis = 340.dp
private val ActivityDot = 9.dp
private const val GALLERY_SHARE = 0.8f
