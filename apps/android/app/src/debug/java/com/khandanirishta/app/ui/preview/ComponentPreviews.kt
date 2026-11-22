package com.khandanirishta.app.ui.preview

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.ui.DestinationBar
import com.khandanirishta.app.ui.DestinationCounts
import com.khandanirishta.app.ui.components.CardSkeleton
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.InfoRow
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.ListSkeleton
import com.khandanirishta.app.ui.components.LockedRow
import com.khandanirishta.app.ui.components.OfflineBanner
import com.khandanirishta.app.ui.components.PassedCard
import com.khandanirishta.app.ui.components.ProfileCardView
import com.khandanirishta.app.ui.components.ProfileRow
import com.khandanirishta.app.ui.components.ProfileTile
import com.khandanirishta.app.ui.components.SectionCard
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.components.SwitchRow
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

@Composable
private fun Specimen(content: @Composable ColumnScope.() -> Unit) {
    SampleTheme {
        Column(
            modifier = Modifier.padding(Spacing.gutter),
            verticalArrangement = Arrangement.spacedBy(Spacing.s16),
            content = content,
        )
    }
}

@PreviewPhones
@Composable
private fun CardWithEverythingPreview() {
    Specimen {
        ProfileCardView(
            card =
                SampleData.card(
                    name = SampleData.LONG_NAME,
                    badges = listOf(Badge.ID_VERIFIED, Badge.PHOTO_VERIFIED, Badge.PHONE_VERIFIED, Badge.NEW),
                    direction = InterestDirection.RECEIVED,
                    managedBy = ManagedBy.PARENT,
                    maritalStatus = MaritalStatus.DIVORCED,
                ),
            onOpen = {},
            onToggleShortlist = {},
            onPass = {},
            modifier = Modifier.widthIn(max = Sizes.cardMax),
        )
    }
}

@PreviewPhones
@Composable
private fun CardWithPrivatePhotoPreview() {
    Specimen {
        ProfileCardView(
            card = SampleData.card(photo = SampleData.photo(blurred = true), shortlisted = true),
            onOpen = {},
            onToggleShortlist = {},
            onPass = {},
            modifier = Modifier.widthIn(max = Sizes.cardMax),
        )
    }
}

@PreviewPhones
@Composable
private fun CompactCardsPreview() {
    Specimen {
        ProfileRow(card = SampleData.card(name = SampleData.LONG_NAME), onOpen = {})
        ProfileRow(
            card = SampleData.card(tier = Tier.CONNECTION, photo = SampleData.photo(blurred = true)),
            onOpen = {},
        )
        ProfileTile(card = SampleData.card(badges = listOf(Badge.NEW)), onOpen = {})
    }
}

@PreviewPhones
@Composable
private fun PassedCardPreview() {
    Specimen { PassedCard(name = SampleData.LONG_NAME, onUndo = {}, minHeight = 320.dp) }
}

@PreviewPhones
@Composable
private fun ButtonsPreview() {
    Specimen {
        KrButton(text = "Send interest", onClick = {}, fullWidth = true)
        KrButton(text = "Withdraw", onClick = {}, variant = KrButtonVariant.SECONDARY)
        KrButton(text = "Not interested", onClick = {}, variant = KrButtonVariant.QUIET)
        KrButton(text = "Block", onClick = {}, variant = KrButtonVariant.DANGER)
        KrButton(text = "Interest sent", onClick = {}, enabled = false)
    }
}

@PreviewPhones
@Composable
private fun DetailRowsPreview() {
    Specimen {
        SectionCard(title = "Education and career") {
            InfoRow(label = "Education level", value = "Professional degree (MBBS, BDS, Pharm-D, LLB, CA, ACCA)")
            LockedRow(label = "Monthly income", placeholder = "Visible after you connect")
        }
        SwitchRow(title = "Show me in search", checked = true, onCheckedChange = {}, helper = "Members can find you.")
    }
}

@PreviewPhones
@Composable
private fun StatesPreview() {
    Specimen {
        OfflineBanner()
        StatusBanner(text = "The profile is being reviewed.", tone = StatusTone.WARNING)
        EmptyState(title = "No saved profiles yet.", actionLabel = "See my matches", onAction = {})
        ErrorState(error = null, onRetry = {})
    }
}

@PreviewPhones
@Composable
private fun SkeletonsPreview() {
    Specimen {
        ListSkeleton(rows = 2)
        CardSkeleton(cards = 1)
    }
}

/** The bottom bar without its navigator. */
@PreviewPhones
@Composable
private fun DestinationsPreview() {
    SampleTheme {
        DestinationBar(
            selected = Tab.HOME,
            counts = DestinationCounts(interests = 4, chats = 120, attention = true),
            onSelect = {},
        )
    }
}
