package com.khandanirishta.app.ui.feature.onboarding

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.ui.components.Band
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.InfoRow
import com.khandanirishta.app.ui.components.KrTag
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.SectionHeading
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.bandToneAt
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.ARCH_RATIO
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * What ONB-11 shows (07 section 14.1): a band for each part with its diamond heading and Edit, or
 * Add when nothing is there yet, then the warning of 07 section 4.1 above the button.
 */
@Composable
internal fun ReviewBody(
    summary: ReviewSummary,
    onEdit: (step: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        summary.answers.forEachIndexed { index, part ->
            key(part.step) { AnswersBand(index = index, part = part, onEdit = onEdit) }
        }
        val afterAnswers = summary.answers.size
        val noPhotos = summary.photos.isEmpty()
        ReviewBand(
            index = afterAnswers,
            title = R.string.onboarding_review_cards_photos,
            empty = noPhotos,
            description = summary.photoVisibility?.let { stringResource(it) },
            onEdit = { onEdit("photos") },
        ) {
            if (noPhotos) {
                NotAdded(stringResource(R.string.onboarding_review_no_photos))
            } else {
                PhotoArches(summary.photos)
            }
        }
        ReviewBand(
            index = afterAnswers + 1,
            title = R.string.onboarding_review_cards_preferences,
            empty = summary.lookingFor.isEmpty(),
            onEdit = { onEdit("preferences") },
        ) {
            if (summary.lookingFor.isEmpty()) {
                NotAdded(stringResource(R.string.onboarding_review_not_added_yet))
            } else {
                LookingFor(summary.lookingFor)
            }
        }
        AnswersBand(index = afterAnswers + 2, part = summary.identity, onEdit = onEdit)
        Band(tone = bandToneAt(afterAnswers + 3), maxWidth = Sizes.formWidth) {
            StatusBanner(text = stringResource(R.string.profile_sections_basics_warning), tone = StatusTone.WARNING)
        }
    }
}

@Composable
private fun AnswersBand(
    index: Int,
    part: ReviewPart,
    onEdit: (step: String) -> Unit,
) {
    val empty = part.rows.isEmpty()
    ReviewBand(index = index, title = part.title, empty = empty, onEdit = { onEdit(part.step) }) {
        if (empty) NotAdded(stringResource(part.emptyText)) else AnswerRows(part.rows)
    }
}

@Composable
private fun ReviewBand(
    index: Int,
    @StringRes title: Int,
    empty: Boolean,
    onEdit: () -> Unit,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val name = stringResource(title)
    Band(tone = bandToneAt(index), maxWidth = Sizes.formWidth, spacing = Spacing.s8) {
        SectionHeading(
            title = name,
            description = description,
            action = {
                val label = if (empty) R.string.onboarding_review_add else R.string.onboarding_review_edit
                KrTextLink(
                    text = stringResource(label),
                    onClick = onEdit,
                    icon = if (empty) Icons.Outlined.Add else Icons.Outlined.Edit,
                    contentDescription =
                        text(
                            if (empty) R.string.onboarding_review_add_label else R.string.onboarding_review_edit_label,
                            "card" to name,
                        ),
                )
            },
        )
        content()
    }
}

@Composable
private fun AnswerRows(rows: List<ReviewRow>) {
    Column {
        rows.forEachIndexed { index, row ->
            InfoRow(label = row.label, divider = index < rows.lastIndex) {
                MemberText(row.value, style = MaterialTheme.typography.titleSmall)
                // Under the value, as words: a phone has no tooltip for the lock of 07 section 14.1.
                if (row.privateByDefault) {
                    IconText(
                        icon = Icons.Outlined.Lock,
                        text = stringResource(R.string.onboarding_review_private),
                        style = KrType.caption,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        iconSize = Sizes.iconTiny,
                        modifier = Modifier.padding(top = Spacing.s4),
                    )
                }
            }
        }
    }
}

@Composable
private fun NotAdded(text: String) {
    IconText(
        icon = Icons.Outlined.Info,
        text = text,
        color = KrTheme.colors.textSecondary,
        modifier = Modifier.padding(vertical = Spacing.s12),
    )
}

/** One line per dimension that has a preference, with a "Must have" tag (07 section 14.1). */
@Composable
private fun LookingFor(lines: List<LookingForItem>) {
    Column(
        modifier = Modifier.padding(top = Spacing.s8),
        verticalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        lines.forEach { line ->
            key(line.dimension) {
                FlowRow(
                    modifier = Modifier.semantics(mergeDescendants = true) {},
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s8),
                    verticalArrangement = Arrangement.spacedBy(Spacing.s4),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) {
                    MemberText(line.text, style = MaterialTheme.typography.bodyMedium)
                    if (line.must) KrTag(stringResource(R.string.onboarding_review_must))
                }
            }
        }
    }
}

/** The own photos as arches with their status in words (08 section 5.5): 3 across, 2 at large text. */
@Composable
private fun PhotoArches(photos: List<OwnPhoto>) {
    val columns = if (LocalDensity.current.fontScale >= LARGE_TEXT) COLUMNS_LARGE_TEXT else COLUMNS
    val lines = remember(photos, columns) { photos.chunked(columns) }
    Column(
        modifier = Modifier.padding(top = Spacing.s8),
        verticalArrangement = Arrangement.spacedBy(Spacing.s16),
    ) {
        lines.forEachIndexed { line, shown ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
                shown.forEachIndexed { index, photo ->
                    key(photo.id) {
                        PhotoArch(photo, position = line * columns + index + 1, modifier = Modifier.weight(1f))
                    }
                }
                repeat(columns - shown.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Immutable
private data class PhotoState(
    @param:StringRes val label: Int,
    val icon: ImageVector,
    val problem: Boolean = false,
)

private fun photoState(photo: OwnPhoto): PhotoState? =
    when (photo.status) {
        PhotoStatus.APPROVED -> {
            if (photo.isPrimary) PhotoState(R.string.photos_status_main, Icons.Filled.Star) else null
        }

        PhotoStatus.PENDING_REVIEW -> {
            PhotoState(R.string.photos_status_pending_review, Icons.Outlined.Schedule)
        }

        PhotoStatus.PROCESSING -> {
            PhotoState(R.string.photos_status_processing, Icons.Outlined.HourglassEmpty)
        }

        PhotoStatus.REJECTED -> {
            PhotoState(R.string.photos_status_rejected, Icons.Outlined.ErrorOutline, problem = true)
        }

        PhotoStatus.FAILED -> {
            PhotoState(R.string.photos_status_failed, Icons.Outlined.ErrorOutline, problem = true)
        }

        else -> {
            null
        }
    }

@Composable
private fun PhotoArch(
    photo: OwnPhoto,
    position: Int,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val alt = text(R.string.photos_grid_photo_alt, "position" to position)
    val request = rememberStableImageRequest(photo.thumbUrl ?: photo.mediumUrl)
    val state = photoState(photo)
    Column(
        modifier = modifier.semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Spacing.s4),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ARCH_RATIO)
                    .clip(ArchShape)
                    .background(colors.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) {
            if (request == null) {
                // No picture yet while it is processed, or none at all after a failure.
                Icon(
                    Icons.Outlined.Image,
                    contentDescription = alt,
                    tint = colors.onSurfaceVariant,
                    modifier = Modifier.size(MissingIcon),
                )
            } else {
                AsyncImage(
                    model = request,
                    contentDescription = alt,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        if (state != null) {
            val color = if (state.problem) colors.error else KrTheme.colors.textSecondary
            // The icon over its word, so the word has the whole width of the arch.
            Icon(state.icon, contentDescription = null, tint = color, modifier = Modifier.size(Sizes.iconTiny))
            Text(
                text = stringResource(state.label),
                style = KrType.caption,
                color = color,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private const val LARGE_TEXT = 1.5f
private const val COLUMNS = 3
private const val COLUMNS_LARGE_TEXT = 2
private val MissingIcon = 28.dp
