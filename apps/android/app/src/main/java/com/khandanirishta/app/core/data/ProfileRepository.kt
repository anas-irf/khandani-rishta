package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.media.PreparedPhoto
import com.khandanirishta.app.core.media.PresignedUploader
import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.PhotosApi
import com.khandanirishta.app.core.network.generated.api.ProfileApi
import com.khandanirishta.app.core.network.generated.model.AccountForBody
import com.khandanirishta.app.core.network.generated.model.BasicsSection
import com.khandanirishta.app.core.network.generated.model.CommunitySection
import com.khandanirishta.app.core.network.generated.model.ConfirmRequest
import com.khandanirishta.app.core.network.generated.model.ContactsSection
import com.khandanirishta.app.core.network.generated.model.ContinueBody
import com.khandanirishta.app.core.network.generated.model.DocumentType
import com.khandanirishta.app.core.network.generated.model.EducationCareerSection
import com.khandanirishta.app.core.network.generated.model.FamilySection
import com.khandanirishta.app.core.network.generated.model.IdentityBody
import com.khandanirishta.app.core.network.generated.model.IdentitySummary
import com.khandanirishta.app.core.network.generated.model.LifestyleSection
import com.khandanirishta.app.core.network.generated.model.LocationSection
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.OnboardingStep
import com.khandanirishta.app.core.network.generated.model.OrderRequest
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.PatchPhoto
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.core.network.generated.model.PrivacyPatch
import com.khandanirishta.app.core.network.generated.model.UploadRequest
import com.khandanirishta.app.core.network.serialization.ApiJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonNull
import javax.inject.Inject
import javax.inject.Singleton

/** One section of the own profile, saved with `PUT /v1/me/profile/sections/{section}` (15 section 8). */
sealed interface SectionPayload {
    val key: String

    data class AccountFor(
        val body: AccountForBody,
    ) : SectionPayload {
        override val key = "account_for"
    }

    data class Basics(
        val body: BasicsSection,
    ) : SectionPayload {
        override val key = "basics"
    }

    data class Community(
        val body: CommunitySection,
    ) : SectionPayload {
        override val key = "community"
    }

    data class Location(
        val body: LocationSection,
    ) : SectionPayload {
        override val key = "location"
    }

    data class EducationCareer(
        val body: EducationCareerSection,
    ) : SectionPayload {
        override val key = "education_career"
    }

    data class Family(
        val body: FamilySection,
    ) : SectionPayload {
        override val key = "family"
    }

    data class Lifestyle(
        val body: LifestyleSection,
    ) : SectionPayload {
        override val key = "lifestyle"
    }

    data class Contacts(
        val body: ContactsSection,
    ) : SectionPayload {
        override val key = "contacts"
    }
}

/**
 * The member's own profile: sections, onboarding, photos, partner preferences, privacy and the
 * identity number (specs/07, 08, 09, 12). Holds the last loaded [OwnProfile] in memory.
 */
@Singleton
class ProfileRepository
    @Inject
    constructor(
        private val api: ProfileApi,
        private val photosApi: PhotosApi,
        private val caller: ApiCaller,
        private val uploader: PresignedUploader,
        private val me: MeRepository,
        private val invalidation: Invalidation,
    ) {
        private val own = MutableStateFlow<OwnProfile?>(null)
        val ownProfile: StateFlow<OwnProfile?> = own.asStateFlow()

        suspend fun load(): Result<OwnProfile> = caller.call { api.getOwnProfile() }.onSuccess { own.value = it }

        /** The cached profile, or a fresh load when there is none. */
        suspend fun cachedOrLoad(): Result<OwnProfile> = own.value?.let { Result.success(it) } ?: load()

        suspend fun saveSection(payload: SectionPayload): Result<OwnProfile> =
            caller
                .call {
                    when (payload) {
                        is SectionPayload.AccountFor -> api.putSectionAccountFor(payload.key, payload.body)
                        is SectionPayload.Basics -> api.putSectionBasics(payload.key, payload.body)
                        is SectionPayload.Community -> api.putSectionCommunity(payload.key, payload.body)
                        is SectionPayload.Location -> api.putSectionLocation(payload.key, payload.body)
                        is SectionPayload.EducationCareer -> api.putSectionEducationCareer(payload.key, payload.body)
                        is SectionPayload.Family -> api.putSectionFamily(payload.key, payload.body)
                        is SectionPayload.Lifestyle -> api.putSectionLifestyle(payload.key, payload.body)
                        is SectionPayload.Contacts -> api.putSectionContacts(payload.key, payload.body)
                    }
                }.onSuccess {
                    own.value = it
                    invalidation.invalidate(DataKey.OwnProfile, DataKey.Home, DataKey.Recommendations)
                    me.refresh()
                }

        /** Moves onboarding past [step] (07 section 2). */
        suspend fun continueOnboarding(step: OnboardingStep): Result<Me> =
            caller.call { api.postContinue(ContinueBody(step)) }.onSuccess(me::replace)

        suspend fun completeOnboarding(): Result<Me> = caller.call { api.postComplete() }.onSuccess(me::replace)

        suspend fun preferences(): Result<Preferences> = caller.call { api.getPreferences() }

        suspend fun savePreferences(value: Preferences): Result<Preferences> =
            caller.call { api.putPreferences(value) }.onSuccess {
                invalidation.invalidate(
                    DataKey.Preferences,
                    DataKey.Home,
                    DataKey.Recommendations,
                    DataKey.AllProfiles,
                    DataKey.OwnProfile,
                )
            }

        suspend fun privacy(): Result<Privacy> = caller.call { api.getPrivacy() }

        suspend fun updatePrivacy(patch: PrivacyPatch): Result<Privacy> =
            caller.call { api.patchPrivacy(patch) }.onSuccess { invalidation.invalidate(DataKey.Privacy) }

        /** The identity summary, or `null` while no number is registered. */
        suspend fun identity(): Result<IdentitySummary?> =
            caller.call { api.getIdentity() }.map { json ->
                if (json is JsonNull) null else ApiJson.decodeFromJsonElement(IdentitySummary.serializer(), json)
            }

        suspend fun registerIdentity(
            type: DocumentType,
            number: String,
        ): Result<IdentitySummary> =
            caller.call { api.putIdentity(IdentityBody(documentType = type, number = number)) }.onSuccess {
                invalidation.invalidate(DataKey.Verifications, DataKey.OwnProfile)
                me.refresh()
            }

        suspend fun photos(): Result<List<OwnPhoto>> = caller.call { photosApi.listPhotos() }

        /**
         * The three calls of the upload flow (08 section 5.2): request a URL, `PUT` the file, confirm.
         * The `PUT` is retried twice on a network error while the URL is valid.
         */
        suspend fun uploadPhoto(
            photo: PreparedPhoto,
            onProgress: (Float) -> Unit,
        ): Result<OwnPhoto> =
            runCatching {
                val ticket =
                    caller
                        .call {
                            photosApi.createPhotoUpload(
                                UploadRequest(contentType = "image/jpeg", sizeBytes = photo.sizeBytes),
                            )
                        }.getOrThrow()
                var attempt = 0
                while (true) {
                    val put = uploader.put(ticket, photo.file, "image/jpeg", onProgress)
                    if (put.isSuccess) break
                    attempt += 1
                    if (attempt > 2) put.getOrThrow()
                }
                caller.call { photosApi.confirmPhoto(ConfirmRequest(ticket.uploadKey)) }.getOrThrow()
            }.onSuccess { photosChanged() }

        suspend fun setPrimary(photoId: String): Result<List<OwnPhoto>> =
            caller.call { photosApi.patchPhoto(photoId, PatchPhoto(isPrimary = true)) }.onSuccess { photosChanged() }

        suspend fun reorder(photoIds: List<String>): Result<List<OwnPhoto>> =
            caller.call { photosApi.putOrder(OrderRequest(photoIds)) }.onSuccess { photosChanged() }

        suspend fun deletePhoto(photoId: String): Result<Unit> =
            caller
                .call {
                    photosApi.deletePhoto(photoId)
                }.onSuccess { photosChanged() }

        fun photosChanged() {
            invalidation.invalidate(DataKey.OwnPhotos, DataKey.OwnProfile)
        }

        fun clear() {
            own.value = null
        }
    }
