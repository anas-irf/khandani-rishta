package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.RelationsApi
import com.khandanirishta.app.core.network.generated.model.BlockItem
import com.khandanirishta.app.core.network.generated.model.FileReportBody
import com.khandanirishta.app.core.network.generated.model.PhotoAccessItem
import com.khandanirishta.app.core.network.generated.model.PhotoRequested
import com.khandanirishta.app.core.network.generated.model.ReportFiled
import com.khandanirishta.app.core.network.generated.model.ReportReason
import com.khandanirishta.app.core.network.generated.model.ReportSubject
import com.khandanirishta.app.core.network.generated.model.ShortlistBody
import com.khandanirishta.app.core.network.generated.model.ShortlistItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** A profile was saved to or removed from the shortlist. */
data class ShortlistChange(
    val profileId: String,
    val shortlisted: Boolean,
)

/** Shortlist, passes, blocks, photo access and reports (specs/09, 11 section 12, 13, 15 section 13). */
@Singleton
class RelationRepository
    @Inject
    constructor(
        private val api: RelationsApi,
        private val caller: ApiCaller,
        private val me: MeRepository,
        private val discovery: DiscoveryRepository,
        private val invalidation: Invalidation,
    ) {
        suspend fun shortlist(cursor: String?): Result<Page<ShortlistItem>> =
            caller
                .call {
                    api.listShortlist(limit = DiscoveryRepository.PAGE, cursor = cursor)
                }.map { Page(it.items, it.nextCursor) }

        suspend fun addToShortlist(
            profileId: String,
            note: String? = null,
        ): Result<Unit> =
            caller
                .call {
                    api.putShortlist(
                        profileId,
                        ShortlistBody(note = note?.takeIf { it.isNotBlank() }),
                    )
                }.onSuccess {
                    mutableShortlistChanges.tryEmit(ShortlistChange(profileId, shortlisted = true))
                    invalidation.invalidate(DataKey.Shortlist)
                }

        suspend fun removeFromShortlist(profileId: String): Result<Unit> =
            caller.call { api.deleteShortlist(profileId) }.onSuccess {
                mutableShortlistChanges.tryEmit(ShortlistChange(profileId, shortlisted = false))
                invalidation.invalidate(DataKey.Shortlist)
            }

        private val mutableShortlistChanges = MutableSharedFlow<ShortlistChange>(extraBufferCapacity = 16)

        /**
         * Every saved shortlist change, wherever it was made, so screens that show the card (home,
         * matches, search, a profile) can set its heart without a refetch.
         */
        val shortlistChanges: SharedFlow<ShortlistChange> = mutableShortlistChanges.asSharedFlow()

        /** "Not interested" (specs/11 section 12). */
        suspend fun pass(profileId: String): Result<Unit> =
            caller.call { api.putPass(profileId) }.onSuccess {
                discovery.dropFromHome(profileId)
                invalidation.invalidate(DataKey.Profile(profileId))
            }

        suspend fun undoPass(profileId: String): Result<Unit> =
            caller.call { api.deletePass(profileId) }.onSuccess {
                invalidation.invalidate(DataKey.Home, DataKey.Recommendations, DataKey.Profile(profileId))
            }

        /** "Undo" of a shortlist removal from a toast that outlives the screen that showed it. */
        fun addToShortlistInBackground(
            profileId: String,
            note: String?,
        ) {
            scope.launch { addToShortlist(profileId, note) }
        }

        /** "Undo" of a pass from a toast that outlives the screen that showed it. */
        fun undoPassInBackground(profileId: String) {
            scope.launch { undoPass(profileId) }
        }

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        suspend fun block(profileId: String): Result<Unit> =
            caller.call { api.putBlock(profileId) }.onSuccess { afterBlock(profileId) }

        suspend fun unblock(profileId: String): Result<Unit> =
            caller.call { api.deleteBlock(profileId) }.onSuccess { invalidation.invalidate(DataKey.Blocks) }

        suspend fun blocks(cursor: String?): Result<Page<BlockItem>> =
            caller
                .call {
                    api.listBlocks(
                        limit = DiscoveryRepository.PAGE,
                        cursor = cursor,
                    )
                }.map { Page(it.items, it.nextCursor) }

        /** [box] is `received` or `sent`; [status] is `pending` or `granted`. */
        suspend fun photoAccess(
            box: String,
            status: String,
            cursor: String?,
        ): Result<Page<PhotoAccessItem>> =
            caller
                .call { api.listAccess(box = box, status = status, limit = DiscoveryRepository.PAGE, cursor = cursor) }
                .map { Page(it.items, it.nextCursor) }

        suspend fun requestPhotos(profileId: String): Result<PhotoRequested> =
            caller.call { api.requestAccess(profileId) }.onSuccess { photoAccessChanged(profileId) }

        suspend fun grantRequest(
            id: String,
            profileId: String?,
        ): Result<Unit> = caller.call { api.grantRequest(id) }.onSuccess { photoAccessChanged(profileId) }

        suspend fun denyRequest(
            id: String,
            profileId: String?,
        ): Result<Unit> = caller.call { api.denyRequest(id) }.onSuccess { photoAccessChanged(profileId) }

        /** "Let {name} see my photos" without a request (specs/16 section 6.7). */
        suspend fun giveAccess(profileId: String): Result<Unit> =
            caller.call { api.putGrant(profileId) }.onSuccess { photoAccessChanged(profileId) }

        suspend fun removeAccess(profileId: String): Result<Unit> =
            caller.call { api.deleteGrant(profileId) }.onSuccess { photoAccessChanged(profileId) }

        suspend fun report(
            targetProfileId: String,
            subject: ReportSubject,
            reason: ReportReason,
            details: String?,
            alsoBlock: Boolean,
            messageId: String? = null,
            photoId: String? = null,
        ): Result<ReportFiled> =
            caller
                .call {
                    api.fileReport(
                        FileReportBody(
                            targetProfileId = targetProfileId,
                            subjectType = subject,
                            reason = reason,
                            details = details?.takeIf { it.isNotBlank() },
                            alsoBlock = alsoBlock,
                            messageId = messageId,
                            photoId = photoId,
                        ),
                    )
                }.onSuccess { if (alsoBlock) afterBlock(targetProfileId) }

        private suspend fun afterBlock(profileId: String) {
            discovery.dropFromHome(profileId)
            invalidation.invalidate(
                DataKey.Connections,
                DataKey.Interests,
                DataKey.Shortlist,
                DataKey.Home,
                DataKey.Recommendations,
                DataKey.Search,
                DataKey.Blocks,
                DataKey.Visitors,
                DataKey.Profile(profileId),
            )
            me.refresh()
        }

        private suspend fun photoAccessChanged(profileId: String?) {
            invalidation.invalidate(DataKey.PhotoAccess)
            profileId?.let { invalidation.invalidate(DataKey.Profile(it)) }
            me.refresh()
        }
    }
