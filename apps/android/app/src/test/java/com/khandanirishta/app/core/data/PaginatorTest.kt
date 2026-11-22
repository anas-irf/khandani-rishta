package com.khandanirishta.app.core.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** Cursor lists with optimistic edits and quiet refreshes (specs/16 rules G1, G5, G6, G7). */
@OptIn(ExperimentalCoroutinesApi::class)
class PaginatorTest {
    @Test
    fun `the first load shows the skeleton, then the items`() =
        runTest {
            val paginator =
                Paginator<String>(
                    this,
                    key = { it },
                    clock = { 1_000L },
                ) { Result.success(Page(listOf("a", "b"), null)) }
            paginator.refresh()
            assertTrue(paginator.state.value.isLoading)
            runCurrent()
            assertEquals(listOf("a", "b"), paginator.state.value.items)
            assertFalse(paginator.state.value.isLoading)
            assertTrue(paginator.state.value.endReached)
        }

    @Test
    fun `a quiet refresh keeps an empty list on screen until the page arrives`() =
        runTest {
            val pages = ArrayDeque(listOf(Page(emptyList<String>(), null), Page(listOf("x"), null)))
            val gate = CompletableDeferred<Unit>()
            var calls = 0
            val paginator =
                Paginator<String>(this, key = { it }, clock = { 5_000L }) {
                    calls++
                    if (calls == 2) gate.await()
                    Result.success(pages.removeFirst())
                }
            paginator.refresh()
            runCurrent()
            assertTrue(paginator.state.value.isEmpty)

            paginator.refresh(showSpinner = false)
            runCurrent()
            assertTrue(paginator.state.value.isEmpty)
            assertFalse(paginator.state.value.isLoading)

            gate.complete(Unit)
            runCurrent()
            assertEquals(listOf("x"), paginator.state.value.items)
        }

    @Test
    fun `a failed quiet refresh keeps the list without an error`() =
        runTest {
            var fail = false
            val paginator =
                Paginator<String>(this, key = { it }, clock = { 5_000L }) {
                    if (fail) Result.failure(IOException("offline")) else Result.success(Page(listOf("a"), null))
                }
            paginator.refresh()
            runCurrent()
            fail = true
            paginator.refresh(showSpinner = false)
            runCurrent()
            assertEquals(listOf("a"), paginator.state.value.items)
            assertNull(paginator.state.value.error)
            assertNull(paginator.state.value.appendError)
        }

    @Test
    fun `refreshIfStale waits sixty seconds after a load`() =
        runTest {
            var now = 0L
            var calls = 0
            val paginator =
                Paginator<String>(this, key = { it }, clock = { now }) {
                    calls++
                    Result.success(Page(listOf("a"), null))
                }
            paginator.refreshIfStale()
            runCurrent()
            assertEquals(0, calls)

            paginator.refresh()
            runCurrent()
            assertEquals(1, calls)

            now = 59_999L
            paginator.refreshIfStale()
            runCurrent()
            assertEquals(1, calls)

            now = 60_000L
            paginator.refreshIfStale()
            runCurrent()
            assertEquals(2, calls)
        }

    @Test
    fun `optimistic edits change the shown items`() =
        runTest {
            val paginator =
                Paginator<String>(this, key = { it }, clock = { 1L }) { Result.success(Page(listOf("a", "b"), null)) }
            paginator.refresh()
            runCurrent()
            paginator.remove("a")
            assertEquals(listOf("b"), paginator.state.value.items)
            paginator.prepend("c")
            assertEquals(listOf("c", "b"), paginator.state.value.items)
            paginator.updateItem("b") { "b2" }
            assertEquals(listOf("c", "b2"), paginator.state.value.items)
        }
}
