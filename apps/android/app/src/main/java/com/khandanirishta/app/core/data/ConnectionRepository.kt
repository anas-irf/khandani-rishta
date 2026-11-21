package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.ConnectionsApi
import com.khandanirishta.app.core.network.generated.model.ChatReadBody
import com.khandanirishta.app.core.network.generated.model.Connection
import com.khandanirishta.app.core.network.generated.model.ContactShareBody
import com.khandanirishta.app.core.network.generated.model.EndConnectionBody
import com.khandanirishta.app.core.network.generated.model.MemberEndReason
import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.MessagesPage
import com.khandanirishta.app.core.network.generated.model.PatchConnectionBody
import com.khandanirishta.app.core.network.generated.model.ProposableStage
import com.khandanirishta.app.core.network.generated.model.SendMessageBody
import com.khandanirishta.app.core.network.generated.model.StageProposalBody
import javax.inject.Inject
import javax.inject.Singleton

/** Connections, chat and stages (specs/11 sections 5 to 9, 15 section 12). */
@Singleton
class ConnectionRepository
    @Inject
    constructor(
        private val api: ConnectionsApi,
        private val caller: ApiCaller,
        private val me: MeRepository,
        private val invalidation: Invalidation,
    ) {
        /** [filter] is `active`, `archived` or `ended`. */
        suspend fun list(
            filter: String,
            cursor: String?,
        ): Result<Page<Connection>> =
            caller
                .call { api.listConnections(filter = filter, limit = DiscoveryRepository.PAGE, cursor = cursor) }
                .map { Page(it.items, it.nextCursor) }

        suspend fun get(connectionId: String): Result<Connection> = caller.call { api.getConnection(connectionId) }

        suspend fun setMuted(
            connectionId: String,
            muted: Boolean,
        ): Result<Connection> = patch(connectionId, PatchConnectionBody(isMuted = muted))

        suspend fun setArchived(
            connectionId: String,
            archived: Boolean,
        ): Result<Connection> = patch(connectionId, PatchConnectionBody(isArchived = archived))

        private suspend fun patch(
            connectionId: String,
            body: PatchConnectionBody,
        ): Result<Connection> = caller.call { api.patchConnection(connectionId, body) }.onSuccess { changed(it) }

        suspend fun shareContact(
            connectionId: String,
            body: ContactShareBody,
        ): Result<Connection> = caller.call { api.putContactShare(connectionId, body) }.onSuccess { changed(it) }

        suspend fun stopSharing(connectionId: String): Result<Connection> =
            caller.call { api.deleteContactShare(connectionId) }.onSuccess { changed(it) }

        suspend fun end(
            connectionId: String,
            reason: MemberEndReason,
            alsoBlock: Boolean,
        ): Result<Connection> =
            caller
                .call {
                    api.endConnection(
                        connectionId,
                        EndConnectionBody(reason = reason, alsoBlock = alsoBlock),
                    )
                }.onSuccess {
                    changed(it)
                    it.other?.id?.let { id -> invalidation.invalidate(DataKey.Profile(id)) }
                    if (alsoBlock) invalidation.invalidate(DataKey.Blocks, DataKey.Interests, DataKey.Shortlist)
                    me.refresh()
                }

        suspend fun propose(
            connectionId: String,
            stage: ProposableStage,
        ): Result<Connection> =
            caller
                .call {
                    api.proposeStage(connectionId, StageProposalBody(stage))
                }.onSuccess { changed(it) }

        suspend fun cancelProposal(
            connectionId: String,
            proposalId: String,
        ): Result<Connection> = caller.call { api.cancelProposal(connectionId, proposalId) }.onSuccess { changed(it) }

        suspend fun confirmProposal(
            connectionId: String,
            proposalId: String,
        ): Result<Connection> = caller.call { api.confirmProposal(connectionId, proposalId) }.onSuccess { changed(it) }

        suspend fun declineProposal(
            connectionId: String,
            proposalId: String,
        ): Result<Connection> = caller.call { api.declineProposal(connectionId, proposalId) }.onSuccess { changed(it) }

        suspend fun messages(
            connectionId: String,
            before: String? = null,
            after: String? = null,
            limit: Long = 30,
        ): Result<MessagesPage> =
            caller.call { api.listMessages(connectionId, before = before, after = after, limit = limit) }

        suspend fun send(
            connectionId: String,
            body: String,
            clientMessageId: String,
        ): Result<Message> =
            caller.call {
                api.sendMessage(
                    connectionId,
                    SendMessageBody(body = body, clientMessageId = clientMessageId),
                )
            }

        suspend fun deleteMessage(
            connectionId: String,
            messageId: String,
        ): Result<Message> = caller.call { api.deleteMessage(connectionId, messageId) }

        /** Marks messages read up to [messageId]; failures are ignored (specs/16 section 6.11). */
        suspend fun markRead(
            connectionId: String,
            messageId: String,
        ): Result<Unit> = caller.call { api.markConnectionRead(connectionId, ChatReadBody(upToMessageId = messageId)) }

        private fun changed(connection: Connection) {
            invalidation.invalidate(DataKey.Connection(connection.id), DataKey.Connections)
        }
    }

/**
 * Keeps a conversation's messages keyed by id. A server message replaces the local one with the
 * same `client_message_id`, so a message received both by event and by REST appears once
 * (specs/19 section 4.8).
 */
object MessageMerger {
    fun merge(
        current: List<Message>,
        incoming: List<Message>,
    ): List<Message> {
        if (incoming.isEmpty()) return current
        val byId = LinkedHashMap<String, Message>(current.size + incoming.size)
        current.forEach { byId[it.id] = it }
        for (message in incoming) {
            val clientId = message.clientMessageId
            if (clientId != null) {
                val local = byId.values.firstOrNull { it.clientMessageId == clientId && it.id != message.id }
                if (local != null) byId.remove(local.id)
            }
            byId[message.id] = message
        }
        return byId.values.sortedWith(compareBy<Message>({ it.createdAt }, { it.id }))
    }
}
