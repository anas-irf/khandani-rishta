package com.khandanirishta.app.ui.preview

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.khandanirishta.app.core.network.generated.model.LockedGroup
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.RelationPhotoAccess
import com.khandanirishta.app.core.network.generated.model.RelaxationHint
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.ui.feature.auth.Welcome
import com.khandanirishta.app.ui.feature.home.ExhaustedCard
import com.khandanirishta.app.ui.feature.home.ExhaustedPanel
import com.khandanirishta.app.ui.feature.home.Greeting
import com.khandanirishta.app.ui.feature.home.PendingCallout
import com.khandanirishta.app.ui.feature.profile.PhotoViewerContent
import com.khandanirishta.app.ui.feature.profile.PhotoViewerState
import com.khandanirishta.app.ui.feature.profile.ProfileActionBar
import com.khandanirishta.app.ui.feature.profile.ProfileBarActions
import com.khandanirishta.app.ui.feature.profile.ProfileDetailBody
import com.khandanirishta.app.ui.feature.profile.ProfileHero
import com.khandanirishta.app.ui.theme.Spacing

private val Hints =
    listOf(
        RelaxationHint(dimension = "location", extraProfiles = 24),
        RelaxationHint(dimension = "living_arrangement", extraProfiles = 8),
    )

private val BarActions =
    ProfileBarActions(
        openChat = {},
        send = {},
        accept = {},
        decline = {},
        withdraw = {},
        verify = {},
        viewSentInterests = {},
    )

@PreviewPhones
@Composable
private fun WelcomePreview() {
    SampleTheme { Welcome(onStart = {}) }
}

@PreviewPhones
@Composable
private fun HomeTopPreview() {
    SampleTheme(me = SampleData.me(managedBy = ManagedBy.PARENT)) {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            Greeting()
            PendingCallout(count = 2, onView = {})
        }
    }
}

@PreviewPhones
@Composable
private fun NoMatchesPreview() {
    SampleTheme {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s16)) {
            ExhaustedPanel(hints = Hints, ageHint = true, onReview = {}, onSearch = {})
            ExhaustedCard(hints = Hints, ageHint = false, onReview = {})
        }
    }
}

@PreviewPhones
@Composable
private fun ProfileWithLockedValuesPreview() {
    SampleTheme {
        ProfileDetailBody(
            detail =
                SampleData.detail(
                    card = SampleData.card(name = SampleData.LONG_NAME),
                    locked = listOf(LockedGroup.CASTE, LockedGroup.INCOME, LockedGroup.FAMILY),
                ),
        )
    }
}

@PreviewPhones
@Composable
private fun ProfilePrivatePhotosPreview() {
    SampleTheme {
        ProfileHero(
            detail =
                SampleData.detail(
                    photos = listOf(SampleData.photo(blurred = true)),
                    locked = listOf(LockedGroup.PHOTOS),
                    access = RelationPhotoAccess.CAN_REQUEST,
                ),
            onOpenPhoto = {},
            onRequestPhotos = {},
        )
    }
}

@PreviewPhones
@Composable
private fun InterestReceivedBarPreview() {
    SampleTheme {
        ProfileActionBar(
            detail =
                SampleData.detail(
                    card = SampleData.card(name = SampleData.LONG_NAME),
                    tier = Tier.INTEREST_FROM_OWNER,
                ),
            busy = false,
            accepting = false,
            actions = BarActions,
        )
    }
}

@PreviewPhones
@Composable
private fun PhotoViewerPreview() {
    SampleTheme {
        PhotoViewerContent(
            state = PhotoViewerState(detail = SampleData.detail()),
            index = 0,
            onClose = {},
            onRetry = {},
            onRequest = {},
        )
    }
}
