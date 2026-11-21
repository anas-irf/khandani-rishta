package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.media.PreparedPhoto
import com.khandanirishta.app.core.media.PresignedUploader
import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.MetaApi
import com.khandanirishta.app.core.network.generated.api.VerificationApi
import com.khandanirishta.app.core.network.generated.model.AppRelease
import com.khandanirishta.app.core.network.generated.model.SelfieChallenge
import com.khandanirishta.app.core.network.generated.model.SubmitVerificationIdDocument
import com.khandanirishta.app.core.network.generated.model.SubmitVerificationSelfie
import com.khandanirishta.app.core.network.generated.model.UploadSlot
import com.khandanirishta.app.core.network.generated.model.VerificationOverview
import com.khandanirishta.app.core.network.generated.model.VerificationRequestSummary
import com.khandanirishta.app.core.network.generated.model.VerificationUploadRequest
import javax.inject.Inject
import javax.inject.Singleton

/** Identity document and selfie verification (specs/12, 15 section 8). */
@Singleton
class VerificationRepository
    @Inject
    constructor(
        private val api: VerificationApi,
        private val caller: ApiCaller,
        private val uploader: PresignedUploader,
        private val me: MeRepository,
        private val invalidation: Invalidation,
    ) {
        suspend fun overview(): Result<VerificationOverview> = caller.call { api.getVerifications() }

        suspend fun selfieChallenge(): Result<SelfieChallenge> = caller.call { api.selfieChallenge() }

        /** Uploads one image for [slot] and returns its `upload_key` (12 section 5.2). */
        suspend fun upload(
            slot: UploadSlot,
            photo: PreparedPhoto,
            onProgress: (Float) -> Unit = {},
        ): Result<String> =
            runCatching {
                val ticket =
                    caller
                        .call {
                            api.createVerificationUpload(
                                VerificationUploadRequest(
                                    contentType = "image/jpeg",
                                    sizeBytes = photo.sizeBytes,
                                    slot = slot,
                                ),
                            )
                        }.getOrThrow()
                uploader.put(ticket, photo.file, "image/jpeg", onProgress).getOrThrow()
                ticket.uploadKey
            }

        suspend fun submitSelfie(
            selfieKey: String,
            gesture: String,
        ): Result<VerificationRequestSummary> =
            caller
                .call {
                    api.submitSelfie(SubmitVerificationSelfie(gesture = gesture, selfieKey = selfieKey))
                }.onSuccess { changed() }

        suspend fun submitIdDocument(
            frontKey: String,
            backKey: String?,
            selfieKey: String,
            gesture: String,
        ): Result<VerificationRequestSummary> =
            caller
                .call {
                    api.submitIdDocument(
                        SubmitVerificationIdDocument(
                            backKey = backKey,
                            frontKey = frontKey,
                            gesture = gesture,
                            selfieKey = selfieKey,
                        ),
                    )
                }.onSuccess { changed() }

        suspend fun cancel(requestId: String): Result<Unit> =
            caller.call { api.cancel(requestId) }.onSuccess { changed() }

        private suspend fun changed() {
            invalidation.invalidate(DataKey.Verifications, DataKey.OwnProfile)
            me.refresh()
        }
    }

/** The latest Android build, for the update checks of specs/22 section 13. */
@Singleton
class AppReleaseRepository
    @Inject
    constructor(
        private val api: MetaApi,
        private val caller: ApiCaller,
    ) {
        suspend fun latest(): Result<AppRelease> = caller.call { api.appRelease(platform = "android") }
    }
