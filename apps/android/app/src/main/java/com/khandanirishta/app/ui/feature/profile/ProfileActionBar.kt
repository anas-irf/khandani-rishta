package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.CannotSendDetail
import com.khandanirishta.app.core.network.generated.model.CannotSendReason
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.AnswerRow
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.ExpiryNote
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MonogramArch
import com.khandanirishta.app.ui.components.QuoteBlock
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.rememberCandidate
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** What the action bar can do. */
@Immutable
internal class ProfileBarActions(
    val openChat: () -> Unit,
    val send: () -> Unit,
    val accept: () -> Unit,
    val decline: () -> Unit,
    val withdraw: () -> Unit,
    val verify: () -> Unit,
    val viewSentInterests: () -> Unit,
)

/**
 * The action bar of 16 section 6.7, decided by `relation` from top to bottom: one primary and at
 * most a line under it (DESIGN.md section 6.14). Shortlist and More are in the top bar.
 */
@Composable
internal fun ProfileActionBar(
    detail: ProfileDetail,
    busy: Boolean,
    accepting: Boolean,
    actions: ProfileBarActions,
    modifier: Modifier = Modifier,
) {
    val relation = detail.relation
    val ready = LocalOnline.current && !busy
    val received = relation.tier == Tier.INTEREST_FROM_OWNER
    val banner: (@Composable () -> Unit)? = if (received) ({ ReceivedBanner(detail) }) else null
    KrActionBar(modifier = modifier, maxWidth = Sizes.formWidth, banner = banner) {
        when {
            relation.tier == Tier.CONNECTION -> {
                KrButton(
                    text = stringResource(R.string.profile_actions_open_chat),
                    onClick = actions.openChat,
                    icon = Icons.AutoMirrored.Outlined.Chat,
                    enabled = relation.connectionId != null,
                    fullWidth = true,
                )
            }

            received -> {
                AnswerRow(
                    secondary = { answer ->
                        KrButton(
                            text = stringResource(R.string.profile_actions_decline),
                            onClick = actions.decline,
                            variant = KrButtonVariant.SECONDARY,
                            size = KrButtonSize.LARGE,
                            enabled = ready,
                            modifier = answer,
                        )
                    },
                    primary = { answer ->
                        KrButton(
                            text = stringResource(R.string.profile_actions_accept),
                            onClick = actions.accept,
                            enabled = ready,
                            loading = accepting,
                            modifier = answer,
                        )
                    },
                )
            }

            relation.tier == Tier.INTEREST_TO_OWNER -> {
                AdaptiveRow(Modifier.fillMaxWidth()) {
                    KrButton(
                        text = stringResource(R.string.profile_actions_interest_sent),
                        onClick = {},
                        enabled = false,
                        modifier = Modifier.grow(),
                    )
                    KrButton(
                        text = stringResource(R.string.profile_actions_withdraw),
                        onClick = actions.withdraw,
                        variant = KrButtonVariant.SECONDARY,
                        size = KrButtonSize.LARGE,
                        enabled = ready,
                        modifier = Modifier.grow(),
                    )
                }
            }

            relation.canSendInterest -> {
                KrButton(
                    text = stringResource(R.string.profile_actions_send_interest),
                    onClick = actions.send,
                    enabled = ready,
                    fullWidth = true,
                )
                InterestsLeft()
            }

            else -> {
                val label =
                    when (relation.cannotSendReason) {
                        CannotSendReason.ALREADY_PENDING -> R.string.profile_actions_interest_sent
                        CannotSendReason.ALREADY_CONNECTED -> R.string.profile_actions_connected
                        else -> R.string.profile_actions_send_interest
                    }
                KrButton(text = stringResource(label), onClick = {}, enabled = false, fullWidth = true)
                CannotSendLine(detail, onVerify = actions.verify, onViewSentInterests = actions.viewSentInterests)
            }
        }
    }
}

/** The interest banner of DESIGN.md section 6.12, as one unit with the buttons under it. */
@Composable
private fun ReceivedBanner(detail: ProfileDetail) {
    val interest = detail.relation.interest ?: return
    val name = detail.card.displayName
    val title =
        rememberCandidate().pick(
            R.string.profile_received_text,
            R.string.profile_received_text_male,
            R.string.profile_received_text_female,
        )
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            MonogramArch(name = name, size = Sizes.arch40)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
                Text(
                    text = text(title, "name" to name),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                ExpiryNote(
                    text = text(R.string.profile_received_expires, "date" to Formatters.date(interest.expiresAt)),
                    expiresAt = interest.expiresAt,
                )
            }
        }
        QuoteBlock(interest.message)
    }
}

/** "4 of 5 interests left today." */
@Composable
private fun InterestsLeft() {
    val usage = LocalMe.current?.usage ?: return
    CaptionText(
        text =
            text(
                R.string.profile_send_left,
                "left" to (usage.interestsPerDay - usage.interestsSentToday).coerceAtLeast(0),
                "total" to usage.interestsPerDay,
            ),
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The line under the disabled button (16 section 6.7, "Text for cannot_send_reason"). */
@Composable
private fun CannotSendLine(
    detail: ProfileDetail,
    onVerify: () -> Unit,
    onViewSentInterests: () -> Unit,
) {
    val relation = detail.relation
    val badges = LocalMe.current
        ?.profile
        ?.badges
        .orEmpty()
    // "New" is a badge too, so verified is the ID or the photo check.
    val verified = Badge.ID_VERIFIED in badges || Badge.PHOTO_VERIFIED in badges
    var line: String? = null
    var link: Pair<Int, () -> Unit>? = null
    when (relation.cannotSendReason) {
        CannotSendReason.COOLDOWN -> {
            line =
                text(
                    R.string.profile_cannot_send_cooldown,
                    "date" to relation.canSendInterestAfter?.let { Formatters.date(it) }.orEmpty(),
                )
        }

        CannotSendReason.DAILY_LIMIT -> {
            line = stringResource(R.string.profile_cannot_send_daily_limit)
            if (!verified) link = R.string.profile_cannot_send_verify_more to onVerify
        }

        CannotSendReason.PENDING_LIMIT -> {
            line = stringResource(R.string.profile_cannot_send_pending_limit)
            link = R.string.profile_cannot_send_view_sent to onViewSentInterests
        }

        CannotSendReason.CONNECTION_LIMIT -> {
            line = stringResource(R.string.profile_cannot_send_connection_limit)
        }

        CannotSendReason.NOT_PERMITTED_BY_MEMBER -> {
            if (relation.cannotSendDetail == CannotSendDetail.VERIFIED_ONLY) {
                line = stringResource(R.string.profile_cannot_send_verified_only)
                link = R.string.profile_cannot_send_get_verified to onVerify
            } else {
                line = stringResource(R.string.profile_cannot_send_preference_match)
            }
        }

        CannotSendReason.OWN_PROFILE_NOT_ACTIVE -> {
            line = stringResource(R.string.profile_cannot_send_own_profile_not_active)
        }

        else -> {}
    }
    if (line == null) return
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        CaptionText(line, textAlign = TextAlign.Center)
        link?.let { (label, onClick) ->
            KrTextLink(text = stringResource(label), onClick = onClick, style = MaterialTheme.typography.labelMedium)
        }
    }
}
