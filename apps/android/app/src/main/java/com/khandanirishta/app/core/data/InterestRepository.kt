package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.InterestsApi
import com.khandanirishta.app.core.network.generated.model.AcceptedInterest
import com.khandanirishta.app.core.network.generated.model.DeclineBody
import com.khandanirishta.app.core.network.generated.model.Interest
import com.khandanirishta.app.core.network.generated.model.SeenBody
import com.khandanirishta.app.core.network.generated.model.SendInterestBody
import com.khandanirishta.app.core.network.generated.model.SentInterest
import javax.inject.Inject
import javax.inject.Singleton

/** Interests (specs/11 sections 2 and 3, 15 section 11). */
@Singleton
class InterestRepository
    @Inject
    constructor(
        private val api: InterestsApi,
        private val caller: ApiCaller,
        private val me: MeRepository,
        private val invalidation: Invalidation,
    ) {
        /** [box] is `received` or `sent`; [status] is `pending`, `accepted` or `closed`. */
        suspend fun list(
            box: String,
            status: String,
            cursor: String?,
        ): Result<Page<Interest>> =
            caller
                .call {
                    api.listInterests(
                        box = box,
                        status = status,
                        limit = DiscoveryRepository.PAGE,
                        cursor = cursor,
                    )
                }.map { Page(it.items, it.nextCursor) }

        suspend fun get(interestId: String): Result<Interest> = caller.call { api.getInterest(interestId) }

        suspend fun send(
            profileId: String,
            message: String?,
        ): Result<SentInterest> =
            caller
                .call {
                    api.sendInterest(
                        SendInterestBody(receiverProfileId = profileId, message = message?.takeIf { it.isNotBlank() }),
                    )
                }.onSuccess { sent ->
                    invalidation.invalidate(DataKey.Interests, DataKey.Profile(profileId))
                    if (sent.connection != null) invalidation.invalidate(DataKey.Connections)
                    me.refresh()
                }

        suspend fun accept(
            interestId: String,
            profileId: String?,
        ): Result<AcceptedInterest> =
            caller.call { api.acceptInterest(interestId) }.onSuccess {
                invalidation.invalidate(DataKey.Interests, DataKey.Connections, DataKey.Home)
                profileId?.let { id -> invalidation.invalidate(DataKey.Profile(id)) }
                me.refresh()
            }

        suspend fun decline(
            interestId: String,
            profileId: String?,
            alsoBlock: Boolean,
        ): Result<Interest> =
            caller.call { api.declineInterest(interestId, DeclineBody(alsoBlock = alsoBlock)) }.onSuccess {
                invalidation.invalidate(DataKey.Interests, DataKey.Home)
                profileId?.let { id -> invalidation.invalidate(DataKey.Profile(id)) }
                if (alsoBlock) invalidation.invalidate(DataKey.Blocks, DataKey.Shortlist, DataKey.Recommendations)
                me.refresh()
            }

        suspend fun withdraw(
            interestId: String,
            profileId: String?,
        ): Result<Interest> =
            caller.call { api.withdrawInterest(interestId) }.onSuccess {
                invalidation.invalidate(DataKey.Interests)
                profileId?.let { id -> invalidation.invalidate(DataKey.Profile(id)) }
                me.refresh()
            }

        /** Marks received interests as seen; failures are ignored (specs/16 section 6.9). */
        suspend fun markSeen(ids: List<String>) {
            if (ids.isEmpty()) return
            caller.call { api.markSeen(SeenBody(ids)) }
        }
    }
