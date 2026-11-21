package com.khandanirishta.app.core.data

import com.khandanirishta.app.core.network.generated.model.Message
import com.khandanirishta.app.core.network.generated.model.MessageKind
import com.khandanirishta.app.core.network.generated.model.MessageSender
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** Messages appear once whether they arrive by event, by REST or both (specs/19 section 4.8). */
class MessageMergerTest {
    private fun message(
        id: String,
        at: Long,
        clientId: String? = null,
        body: String = id,
    ) = Message(
        body = body,
        clientMessageId = clientId,
        connectionId = "c",
        createdAt = Instant.ofEpochSecond(at),
        id = id,
        isDeleted = false,
        kind = MessageKind.TEXT,
        safetyNotice = null,
        sender = MessageSender.ME,
        systemData = null,
        systemEvent = null,
    )

    @Test
    fun `the same message twice is kept once`() {
        val merged = MessageMerger.merge(listOf(message("a", 1)), listOf(message("a", 1), message("b", 2)))
        assertEquals(listOf("a", "b"), merged.map { it.id })
    }

    @Test
    fun `the server copy replaces the sending copy with the same client id`() {
        val local = message("local-x", 5, clientId = "x", body = "Salaam")
        val server = message("m9", 5, clientId = "x", body = "Salaam")
        val merged = MessageMerger.merge(listOf(message("a", 1), local), listOf(server))
        assertEquals(listOf("a", "m9"), merged.map { it.id })
    }

    @Test
    fun `older pages slot in by time`() {
        val merged = MessageMerger.merge(
            listOf(message("c", 30), message("d", 40)),
            listOf(message("a", 10), message("b", 20)),
        )
        assertEquals(listOf("a", "b", "c", "d"), merged.map { it.id })
    }

    @Test
    fun `a newer version of a message replaces the old one`() {
        val deleted = message("a", 1).copy(isDeleted = true, body = null)
        val merged = MessageMerger.merge(listOf(message("a", 1)), listOf(deleted))
        assertEquals(true, merged.single().isDeleted)
    }
}
