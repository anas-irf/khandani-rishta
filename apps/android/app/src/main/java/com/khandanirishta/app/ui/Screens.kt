package com.khandanirishta.app.ui

import androidx.compose.runtime.Composable
import com.khandanirishta.app.ui.components.SecureScreen
import com.khandanirishta.app.ui.feature.chat.ChatScreen
import com.khandanirishta.app.ui.feature.chat.ChatsScreen
import com.khandanirishta.app.ui.feature.chat.ConnectionScreen
import com.khandanirishta.app.ui.feature.gates.GateBlockedScreen
import com.khandanirishta.app.ui.feature.gates.GateChangesScreen
import com.khandanirishta.app.ui.feature.gates.GateConsentScreen
import com.khandanirishta.app.ui.feature.gates.GateDeletionScreen
import com.khandanirishta.app.ui.feature.gates.GateReviewScreen
import com.khandanirishta.app.ui.feature.home.HomeScreen
import com.khandanirishta.app.ui.feature.home.MatchesScreen
import com.khandanirishta.app.ui.feature.interests.InterestsScreen
import com.khandanirishta.app.ui.feature.interests.PhotoRequestsScreen
import com.khandanirishta.app.ui.feature.lists.ShortlistScreen
import com.khandanirishta.app.ui.feature.lists.VisitorsScreen
import com.khandanirishta.app.ui.feature.me.EditSectionScreen
import com.khandanirishta.app.ui.feature.me.MyPhotosScreen
import com.khandanirishta.app.ui.feature.me.MyPreferencesScreen
import com.khandanirishta.app.ui.feature.me.MyProfileScreen
import com.khandanirishta.app.ui.feature.me.VerificationScreen
import com.khandanirishta.app.ui.feature.me.VerifyIdentityScreen
import com.khandanirishta.app.ui.feature.me.VerifySelfieScreen
import com.khandanirishta.app.ui.feature.notifications.NotificationsScreen
import com.khandanirishta.app.ui.feature.onboarding.OnboardingDoneScreen
import com.khandanirishta.app.ui.feature.onboarding.OnboardingStepScreen
import com.khandanirishta.app.ui.feature.profile.PhotoViewerScreen
import com.khandanirishta.app.ui.feature.profile.ProfileScreen
import com.khandanirishta.app.ui.feature.search.SearchScreen
import com.khandanirishta.app.ui.feature.settings.AccountSettingsScreen
import com.khandanirishta.app.ui.feature.settings.BlockedMembersScreen
import com.khandanirishta.app.ui.feature.settings.ContactDetailsScreen
import com.khandanirishta.app.ui.feature.settings.HelpScreen
import com.khandanirishta.app.ui.feature.settings.NotificationSettingsScreen
import com.khandanirishta.app.ui.feature.settings.PrivacySettingsScreen
import com.khandanirishta.app.ui.feature.settings.SettingsScreen
import com.khandanirishta.app.ui.navigation.AccountSettings
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.BlockedMembers
import com.khandanirishta.app.ui.navigation.Chat
import com.khandanirishta.app.ui.navigation.Chats
import com.khandanirishta.app.ui.navigation.ConnectionDetails
import com.khandanirishta.app.ui.navigation.ContactDetails
import com.khandanirishta.app.ui.navigation.EditSection
import com.khandanirishta.app.ui.navigation.GateBlocked
import com.khandanirishta.app.ui.navigation.GateChanges
import com.khandanirishta.app.ui.navigation.GateConsent
import com.khandanirishta.app.ui.navigation.GateDeletion
import com.khandanirishta.app.ui.navigation.GateReview
import com.khandanirishta.app.ui.navigation.Help
import com.khandanirishta.app.ui.navigation.Home
import com.khandanirishta.app.ui.navigation.Interests
import com.khandanirishta.app.ui.navigation.Matches
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.MyPreferences
import com.khandanirishta.app.ui.navigation.MyProfile
import com.khandanirishta.app.ui.navigation.NotificationSettings
import com.khandanirishta.app.ui.navigation.Notifications
import com.khandanirishta.app.ui.navigation.OnboardingDone
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.navigation.PhotoRequests
import com.khandanirishta.app.ui.navigation.PhotoViewer
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.navigation.Profile
import com.khandanirishta.app.ui.navigation.Search
import com.khandanirishta.app.ui.navigation.Settings
import com.khandanirishta.app.ui.navigation.Shortlist
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.navigation.VerifyIdentity
import com.khandanirishta.app.ui.navigation.VerifySelfie
import com.khandanirishta.app.ui.navigation.Visitors
import com.khandanirishta.app.ui.navigation.isSecure

/** Every screen key and its composable (specs/22 section 3.1). */
@Composable
fun Screen(key: AppKey) {
    if (key.isSecure()) SecureScreen()
    when (key) {
        GateBlocked -> GateBlockedScreen()
        GateDeletion -> GateDeletionScreen()
        GateConsent -> GateConsentScreen()
        GateReview -> GateReviewScreen()
        GateChanges -> GateChangesScreen()
        is OnboardingStep -> OnboardingStepScreen(step = key.step, edit = key.edit)
        OnboardingDone -> OnboardingDoneScreen()
        Home -> HomeScreen()
        Matches -> MatchesScreen()
        is Search -> SearchScreen(savedSearchId = key.savedSearchId)
        is Profile -> ProfileScreen(profileId = key.profileId)
        is PhotoViewer -> PhotoViewerScreen(profileId = key.profileId, index = key.index)
        is Interests -> InterestsScreen(box = key.box, interestId = key.interestId)
        Chats -> ChatsScreen()
        is Chat -> ChatScreen(connectionId = key.connectionId)
        is ConnectionDetails -> ConnectionScreen(connectionId = key.connectionId)
        Shortlist -> ShortlistScreen()
        Visitors -> VisitorsScreen()
        Notifications -> NotificationsScreen()
        is PhotoRequests -> PhotoRequestsScreen(box = key.box)
        MyProfile -> MyProfileScreen()
        is EditSection -> EditSectionScreen(section = key.section)
        MyPhotos -> MyPhotosScreen()
        MyPreferences -> MyPreferencesScreen()
        Verification -> VerificationScreen()
        is VerifyIdentity -> VerifyIdentityScreen(changeNumber = key.changeNumber)
        VerifySelfie -> VerifySelfieScreen()
        Settings -> SettingsScreen()
        PrivacySettings -> PrivacySettingsScreen()
        NotificationSettings -> NotificationSettingsScreen()
        is ContactDetails -> ContactDetailsScreen(focus = key.focus, returnConnectionId = key.returnConnectionId)
        BlockedMembers -> BlockedMembersScreen()
        AccountSettings -> AccountSettingsScreen()
        Help -> HelpScreen()
    }
}
