import type { QueryClient } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, MessagesData } from '~/features/chat/cache'
import { db } from '~/mocks/db'
import { makeConnection, makeMe, makeMessage } from '~/mocks/factories'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { createTestQueryClient } from '~/test/render'
import type { Connection, Me, Page } from './api-types'
import { qk } from './query'
import {
  handleRealtimeEvent,
  presenceStore,
  REALTIME_TIMING,
  realtimeStatus,
  type SocketLike,
  sendRealtime,
  sendTyping,
  startRealtime,
  stopRealtime,
  subscribeConversation,
  typingStore,
} from './realtime'

// ---------------------------------------------------------------------------------------------
// A fake WebSocket driven by the test
// ---------------------------------------------------------------------------------------------

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  closedWith: number | null = null
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close(code = 1000) {
    this.readyState = 3
    this.closedWith = code
  }

  /** The server accepts the upgrade. */
  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  receive(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent)
  }

  /** The server or the network closes the socket. */
  drop(code: number) {
    this.readyState = 3
    this.onclose?.({ code } as CloseEvent)
  }

  types() {
    return this.sent.map((frame) => frame.type)
  }
}

const COUNTERS = {
  unread_chats: 4,
  pending_interests: 7,
  pending_photo_requests: 0,
  unread_notifications: 9,
}

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1)
  if (!socket) throw new Error('No socket was opened')
  return socket
}

let queryClient: QueryClient
let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

function start(options: { random?: () => number; getToken?: () => Promise<string | null> } = {}) {
  return startRealtime({
    queryClient,
    getToken: options.getToken ?? (async () => 'session-token'),
    createSocket: (url) => new FakeSocket(url),
    random: options.random ?? (() => 0.5),
    navigate: () => undefined,
  })
}

/** Opens the latest socket, lets the token arrive, and answers `ready`. */
async function connectReady(counters = COUNTERS) {
  const socket = latest()
  socket.open()
  await vi.advanceTimersByTimeAsync(0)
  socket.receive({
    type: 'ready',
    data: {
      profile_id: 'p',
      server_time: new Date().toISOString(),
      heartbeat_seconds: 30,
      counters,
    },
  })
  return socket
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  FakeSocket.instances = []
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  queryClient = createTestQueryClient()
  queryClient.setQueryData(qk.me(), makeMe())
})

afterEach(() => {
  stopRealtime()
  vi.useRealTimers()
  queryClient.clear()
})

// ---------------------------------------------------------------------------------------------

describe('connecting', () => {
  it('opens the API socket URL and sends auth with a fresh token as the first frame', async () => {
    start()
    expect(realtimeStatus.get()).toBe('connecting')
    const socket = latest()
    expect(socket.url).toBe('ws://localhost:8787/v1/ws')
    socket.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.sent[0]).toEqual({ type: 'auth', token: 'session-token' })
  })

  it('writes the counters of ready into Me and becomes open', async () => {
    start()
    await connectReady()
    expect(realtimeStatus.get()).toBe('open')
    expect(queryClient.getQueryData<Me>(qk.me())?.counters).toEqual(COUNTERS)
  })

  it('stays closed without a token (the session is over)', async () => {
    start({ getToken: async () => null })
    latest().open()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(latest().sent).toEqual([])
    expect(latest().closedWith).toBe(1000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(realtimeStatus.get()).toBe('closed')
  })

  it('stop closes the socket with 1000 and never reconnects', async () => {
    const stop = start()
    const socket = await connectReady()
    stop()
    expect(socket.closedWith).toBe(1000)
    expect(realtimeStatus.get()).toBe('idle')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('sends client frames only while open', async () => {
    start()
    expect(sendRealtime({ type: 'typing', connection_id: 'c' })).toBe(false)
    const socket = await connectReady()
    expect(sendRealtime({ type: 'typing', connection_id: 'c' })).toBe(true)
    expect(socket.types()).toContain('typing')
  })
})

describe('heartbeat', () => {
  it('pings every 30 seconds', async () => {
    start()
    const socket = await connectReady()
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.ping - 1)
    expect(socket.types().filter((type) => type === 'ping')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    socket.receive({ type: 'pong' })
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.ping)
    socket.receive({ type: 'pong' })
    expect(socket.types().filter((type) => type === 'ping')).toHaveLength(2)
    // Pongs keep the connection alive well past 45 seconds.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(socket.closedWith).toBeNull()
  })

  it('treats 45 seconds without a pong as dead, closes and reconnects', async () => {
    start()
    const socket = await connectReady()
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.deadAfter - 1)
    expect(socket.closedWith).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.closedWith).not.toBeNull()
    expect(realtimeStatus.get()).toBe('closed')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeSocket.instances).toHaveLength(2)
  })
})

describe('reconnecting', () => {
  async function delaysOfDrops(count: number, random: () => number): Promise<number[]> {
    start({ random })
    const delays: number[] = []
    for (let index = 0; index < count; index += 1) {
      const before = FakeSocket.instances.length
      latest().drop(1006)
      let waited = 0
      while (FakeSocket.instances.length === before) {
        await vi.advanceTimersByTimeAsync(100)
        waited += 100
        if (waited > 60_000) throw new Error('No reconnect')
      }
      delays.push(waited)
    }
    return delays
  }

  it('backs off 1, 2, 4, 8, 16, then 30 seconds', async () => {
    expect(await delaysOfDrops(7, () => 0.5)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ])
  })

  it('adds plus or minus 20 percent of jitter', async () => {
    expect(await delaysOfDrops(3, () => 0)).toEqual([800, 1_600, 3_200])
    stopRealtime()
    FakeSocket.instances = []
    expect(await delaysOfDrops(3, () => 1)).toEqual([1_200, 2_400, 4_800])
  })

  it('resets the sequence after 30 seconds of a ready connection', async () => {
    start()
    latest().drop(1006)
    await vi.advanceTimersByTimeAsync(1_000)
    latest().drop(1006)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(FakeSocket.instances).toHaveLength(3)
    const socket = await connectReady()
    for (let tick = 0; tick < 2; tick += 1) {
      await vi.advanceTimersByTimeAsync(REALTIME_TIMING.ping)
      socket.receive({ type: 'pong' })
    }
    socket.drop(1001)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it('does not reconnect on 4403 and refetches Me', async () => {
    start()
    const socket = await connectReady()
    socket.drop(4403)
    expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('waits for the tab to come to the front after 4409', async () => {
    start()
    const socket = await connectReady()
    socket.drop(4409)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeSocket.instances).toHaveLength(1)
    setVisibility('hidden')
    setVisibility('visible')
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('waits 30 seconds after 4429 and reconnects at once after 4440', async () => {
    start()
    latest().drop(4429)
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.tooManyFrames - 1)
    expect(FakeSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.instances).toHaveLength(2)
    latest().drop(4440)
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('does not reconnect while offline, and reconnects when the network returns', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    start()
    expect(FakeSocket.instances).toHaveLength(0)
    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(FakeSocket.instances).toHaveLength(1)
    onLine.mockReturnValue(false)
    latest().drop(1006)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(FakeSocket.instances).toHaveLength(2)
    onLine.mockRestore()
  })
})

describe('hidden tab', () => {
  it('closes after 60 seconds hidden and reopens when visible', async () => {
    start()
    const socket = await connectReady()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(30_000)
    socket.receive({ type: 'pong' })
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.hiddenClose - 30_001)
    expect(socket.closedWith).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.closedWith).toBe(1000)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeSocket.instances).toHaveLength(1)
    setVisibility('visible')
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('keeps the socket when the tab comes back within 60 seconds', async () => {
    start()
    const socket = await connectReady()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(30_000)
    socket.receive({ type: 'pong' })
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(40_000)
    expect(socket.closedWith).toBeNull()
    expect(FakeSocket.instances).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Resync and polling
// ---------------------------------------------------------------------------------------------

const CONNECTION_ID = '40000000-0000-4000-8000-000000000001'

function seedConversation(items: ChatMessage[]) {
  const data: MessagesData = {
    pages: [{ items: [...items].reverse(), has_more: false }],
    pageParams: [undefined],
  }
  queryClient.setQueryData(qk.messages(CONNECTION_ID), data)
}

function heldIds(): string[] {
  const data = queryClient.getQueryData<MessagesData>(qk.messages(CONNECTION_ID))
  return (data?.pages ?? []).flatMap((page) => page.items.map((item) => item.id)).sort()
}

describe('resync', () => {
  it('after a reconnect: catches up the open conversation and invalidates lists', async () => {
    const seeded = db.messages.get(CONNECTION_ID) ?? []
    seedConversation(seeded.slice(0, 2))
    queryClient.setQueryData(qk.connection(CONNECTION_ID), makeConnection({ id: CONNECTION_ID }))
    queryClient.setQueryData(qk.connections('active'), { pages: [], pageParams: [] })
    queryClient.setQueryData(qk.interests('received', 'pending'), { pages: [], pageParams: [] })
    queryClient.setQueryData(qk.notifications(), { pages: [], pageParams: [] })
    const unsubscribe = subscribeConversation(CONNECTION_ID)

    start()
    await connectReady()
    // The first ready is not a resync.
    expect(queryClient.getQueryState(qk.connections('active'))?.isInvalidated).toBe(false)

    latest().drop(1006)
    await vi.advanceTimersByTimeAsync(1_000)
    await connectReady({ ...COUNTERS, unread_chats: 0 })
    await vi.waitFor(() => expect(heldIds()).toEqual(seeded.map((message) => message.id).sort()))

    expect(queryClient.getQueryData<Me>(qk.me())?.counters.unread_chats).toBe(0)
    expect(queryClient.getQueryState(qk.connections('active'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(qk.interests('received', 'pending'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(qk.notifications())?.isInvalidated).toBe(true)
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(qk.connection(CONNECTION_ID))?.isInvalidated).toBe(true),
    )
    unsubscribe()
  })

  it('repeats the after request while has_more', async () => {
    const calls: string[] = []
    server.use(
      http.get(apiUrl('/v1/connections/:id/messages'), ({ request }) => {
        const after = new URL(request.url).searchParams.get('after') ?? ''
        calls.push(after)
        const next = after === 'm1' ? 'm2' : after === 'm2' ? 'm3' : null
        return HttpResponse.json({
          items: next
            ? [
                makeMessage({
                  id: next,
                  connection_id: CONNECTION_ID,
                  created_at: new Date().toISOString(),
                }),
              ]
            : [],
          has_more: next === 'm2',
        })
      }),
    )
    seedConversation([makeMessage({ id: 'm1', connection_id: CONNECTION_ID })])
    const unsubscribe = subscribeConversation(CONNECTION_ID)
    start()
    await connectReady()
    latest().drop(1006)
    await vi.advanceTimersByTimeAsync(1_000)
    await connectReady()
    await vi.waitFor(() => expect(heldIds()).toEqual(['m1', 'm2', 'm3']))
    expect(calls).toEqual(['m1', 'm2'])
    unsubscribe()
  })
})

describe('polling while the socket is down', () => {
  it('polls the open conversation every 15 seconds and the connection every 60', async () => {
    const afters: string[] = []
    server.use(
      http.get(apiUrl('/v1/connections/:id/messages'), ({ request }) => {
        afters.push(new URL(request.url).searchParams.get('after') ?? '')
        return HttpResponse.json({ items: [], has_more: false })
      }),
    )
    seedConversation([makeMessage({ id: 'm1', connection_id: CONNECTION_ID })])
    queryClient.setQueryData(qk.connection(CONNECTION_ID), makeConnection({ id: CONNECTION_ID }))
    const unsubscribe = subscribeConversation(CONNECTION_ID)
    start({ random: () => 0.5 })
    // The socket never opens: the server is unreachable.
    latest().drop(1006)
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.pollMessages)
    await vi.waitFor(() => expect(afters).toEqual(['m1']))
    expect(queryClient.getQueryState(qk.connection(CONNECTION_ID))?.isInvalidated).toBe(false)
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.pollMessages * 3)
    await vi.waitFor(() => expect(afters).toHaveLength(4))
    expect(queryClient.getQueryState(qk.connection(CONNECTION_ID))?.isInvalidated).toBe(true)
    unsubscribe()
  })

  it('refetches Me every 60 seconds elsewhere, and stops polling once open', async () => {
    start()
    latest().drop(1006)
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.pollSlow - 1_000)
    expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// Events (17 section 7.2)
// ---------------------------------------------------------------------------------------------

type ConnectionsData = { pages: Page<Connection>[]; pageParams: unknown[] }

function seedConnections(connections: Connection[]) {
  queryClient.setQueryData<ConnectionsData>(qk.connections('active'), {
    pages: [{ items: connections, next_cursor: null }],
    pageParams: [undefined],
  })
  for (const connection of connections) {
    queryClient.setQueryData(qk.connection(connection.id), connection)
  }
}

function activeRows(): Connection[] {
  return (
    queryClient
      .getQueryData<ConnectionsData>(qk.connections('active'))
      ?.pages.flatMap((page) => page.items) ?? []
  )
}

describe('message.new', () => {
  const other = makeConnection({ id: 'c-other', last_message_at: '2026-11-19T10:00:00Z' })
  const target = makeConnection({
    id: CONNECTION_ID,
    unread_count: 0,
    last_message_at: '2026-11-18T10:00:00Z',
  })
  const incoming = makeMessage({
    id: 'm9',
    connection_id: CONNECTION_ID,
    sender: 'them',
    body: 'Assalam o Alaikum, how is your family?',
    created_at: '2026-11-20T08:00:00Z',
  })

  it('appends to the conversation and moves the row to the top with preview and unread', () => {
    seedConversation([makeMessage({ id: 'm1', connection_id: CONNECTION_ID })])
    seedConnections([other, target])
    handleRealtimeEvent(queryClient, { type: 'message.new', data: { message: incoming } })
    expect(heldIds()).toEqual(['m1', 'm9'])
    const rows = activeRows()
    expect(rows.map((row) => row.id)).toEqual([CONNECTION_ID, 'c-other'])
    expect(rows[0]).toMatchObject({
      last_message_preview: incoming.body,
      last_message_at: incoming.created_at,
      unread_count: 1,
    })
    expect(queryClient.getQueryData<Connection>(qk.connection(CONNECTION_ID))?.unread_count).toBe(1)
  })

  it('is applied once when delivered twice (deduplication by id)', () => {
    seedConversation([makeMessage({ id: 'm1', connection_id: CONNECTION_ID })])
    seedConnections([target])
    handleRealtimeEvent(queryClient, { type: 'message.new', data: { message: incoming } })
    handleRealtimeEvent(queryClient, { type: 'message.new', data: { message: incoming } })
    expect(heldIds()).toEqual(['m1', 'm9'])
    expect(activeRows()[0]?.unread_count).toBe(1)
  })

  it('replaces the local sending message with the same client_message_id', () => {
    const local: ChatMessage = {
      ...makeMessage({
        id: 'local:abc',
        connection_id: CONNECTION_ID,
        sender: 'me',
        body: 'Hello',
        client_message_id: 'abc',
      }),
      local: { state: 'sending', seq: 1 },
    }
    seedConversation([makeMessage({ id: 'm1', connection_id: CONNECTION_ID }), local])
    seedConnections([target])
    const server = makeMessage({
      id: 'm10',
      connection_id: CONNECTION_ID,
      sender: 'me',
      body: 'Hello',
      client_message_id: 'abc',
    })
    handleRealtimeEvent(queryClient, { type: 'message.new', data: { message: server } })
    expect(heldIds()).toEqual(['m1', 'm10'])
    const data = queryClient.getQueryData<MessagesData>(qk.messages(CONNECTION_ID))
    expect(data?.pages[0]?.items.find((item) => item.id === 'm10')?.local).toBeUndefined()
  })

  it('updates the row even when the conversation is not cached', () => {
    seedConnections([target])
    handleRealtimeEvent(queryClient, { type: 'message.new', data: { message: incoming } })
    expect(activeRows()[0]?.unread_count).toBe(1)
  })

  it('does not count system messages as unread and clears the preview', () => {
    seedConnections([makeConnection({ ...target, last_message_preview: 'Old' })])
    handleRealtimeEvent(queryClient, {
      type: 'message.new',
      data: {
        message: makeMessage({
          id: 'm11',
          connection_id: CONNECTION_ID,
          sender: 'system',
          kind: 'system',
          body: null,
          system_event: 'stage_proposed',
        }),
      },
    })
    expect(activeRows()[0]).toMatchObject({ unread_count: 0, last_message_preview: null })
  })

  it('marks it read at once when the conversation is open and visible', async () => {
    const reads: unknown[] = []
    server.use(
      http.post(apiUrl('/v1/connections/:id/read'), async ({ request }) => {
        reads.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    seedConversation([makeMessage({ id: 'm1', connection_id: CONNECTION_ID })])
    seedConnections([target])
    const unsubscribe = subscribeConversation(CONNECTION_ID)
    handleRealtimeEvent(queryClient, { type: 'message.new', data: { message: incoming } })
    expect(activeRows()[0]?.unread_count).toBe(0)
    await vi.waitFor(() => expect(reads).toEqual([{ up_to_message_id: 'm9' }]))
    unsubscribe()
  })
})

describe('other events', () => {
  it('message.deleted marks the message removed', () => {
    seedConversation([
      makeMessage({ id: 'm1', connection_id: CONNECTION_ID, body: 'Hi' }),
      makeMessage({ id: 'm2', connection_id: CONNECTION_ID, body: 'There' }),
    ])
    seedConnections([makeConnection({ id: CONNECTION_ID, last_message_preview: 'There' })])
    handleRealtimeEvent(queryClient, {
      type: 'message.deleted',
      data: { connection_id: CONNECTION_ID, message_id: 'm2' },
    })
    const data = queryClient.getQueryData<MessagesData>(qk.messages(CONNECTION_ID))
    const removed = data?.pages[0]?.items.find((item) => item.id === 'm2')
    expect(removed).toMatchObject({ body: null, is_deleted: true })
    expect(activeRows()[0]?.last_message_preview).toBeNull()
  })

  it('message.read from them sets their_last_read_message_id, never backwards', () => {
    seedConnections([makeConnection({ id: CONNECTION_ID, their_last_read_message_id: 'm5' })])
    const read = (id: string) =>
      handleRealtimeEvent(queryClient, {
        type: 'message.read',
        data: { connection_id: CONNECTION_ID, reader: 'them', up_to_message_id: id },
      })
    read('m3')
    expect(
      queryClient.getQueryData<Connection>(qk.connection(CONNECTION_ID))
        ?.their_last_read_message_id,
    ).toBe('m5')
    read('m7')
    expect(
      queryClient.getQueryData<Connection>(qk.connection(CONNECTION_ID))
        ?.their_last_read_message_id,
    ).toBe('m7')
  })

  it('message.read from me (another tab) clears the unread count', () => {
    seedConnections([makeConnection({ id: CONNECTION_ID, unread_count: 3 })])
    handleRealtimeEvent(queryClient, {
      type: 'message.read',
      data: { connection_id: CONNECTION_ID, reader: 'me', up_to_message_id: 'm9' },
    })
    expect(activeRows()[0]?.unread_count).toBe(0)
    expect(queryClient.getQueryData<Connection>(qk.connection(CONNECTION_ID))?.unread_count).toBe(0)
  })

  it('typing shows for 5 seconds after the last event', async () => {
    start()
    const socket = await connectReady()
    socket.receive({ type: 'typing', data: { connection_id: CONNECTION_ID } })
    expect(typingStore.get()[CONNECTION_ID]).toBeDefined()
    await vi.advanceTimersByTimeAsync(4_000)
    socket.receive({ type: 'pong' })
    socket.receive({ type: 'typing', data: { connection_id: CONNECTION_ID } })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(typingStore.get()[CONNECTION_ID]).toBeDefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(typingStore.get()[CONNECTION_ID]).toBeUndefined()
  })

  it('presence writes to the presence store', () => {
    handleRealtimeEvent(queryClient, {
      type: 'presence',
      data: { profile_id: 'p1', is_online: true },
    })
    expect(presenceStore.get().p1).toBe(true)
    handleRealtimeEvent(queryClient, {
      type: 'presence',
      data: { profile_id: 'p1', is_online: false },
    })
    expect(presenceStore.get().p1).toBe(false)
  })

  it('connection.updated invalidates the connection and the lists', () => {
    seedConnections([makeConnection({ id: CONNECTION_ID })])
    handleRealtimeEvent(queryClient, {
      type: 'connection.updated',
      data: { connection: makeConnection({ id: CONNECTION_ID }) },
    })
    expect(queryClient.getQueryState(qk.connection(CONNECTION_ID))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(qk.connections('active'))?.isInvalidated).toBe(true)
  })

  it.each(['interest.received', 'interest.accepted'])(
    '%s invalidates interests, home and Me',
    (type) => {
      queryClient.setQueryData(qk.interests('received', 'pending'), { pages: [], pageParams: [] })
      queryClient.setQueryData(qk.home(), {})
      handleRealtimeEvent(queryClient, { type, data: { interest: null } })
      expect(queryClient.getQueryState(qk.interests('received', 'pending'))?.isInvalidated).toBe(
        true,
      )
      expect(queryClient.getQueryState(qk.home())?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(true)
    },
  )

  it('notification.new invalidates the notifications', () => {
    queryClient.setQueryData(qk.notifications(), { pages: [], pageParams: [] })
    handleRealtimeEvent(queryClient, { type: 'notification.new', data: { notification: {} } })
    expect(queryClient.getQueryState(qk.notifications())?.isInvalidated).toBe(true)
  })

  it('counters are written into Me without a refetch', () => {
    handleRealtimeEvent(queryClient, { type: 'counters', data: COUNTERS })
    expect(queryClient.getQueryData<Me>(qk.me())?.counters).toEqual(COUNTERS)
    expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(false)
  })

  it('photo.updated invalidates the own photos, profile and Me', () => {
    queryClient.setQueryData(qk.photos(), [])
    queryClient.setQueryData(qk.ownProfile(), {})
    handleRealtimeEvent(queryClient, { type: 'photo.updated', data: { photo: {} } })
    expect(queryClient.getQueryState(qk.photos())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(qk.ownProfile())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(true)
  })

  it('gate.changed refetches Me', () => {
    handleRealtimeEvent(queryClient, { type: 'gate.changed', data: { gate: 'suspended' } })
    expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(true)
  })

  it('ignores unknown types and malformed frames', async () => {
    start()
    const socket = await connectReady()
    socket.onmessage?.({ data: 'not json' } as MessageEvent)
    socket.receive({ type: 'something.new', data: { x: 1 } })
    expect(realtimeStatus.get()).toBe('open')
  })
})

describe('typing frames', () => {
  it('are sent at most once every 3 seconds', async () => {
    start()
    const socket = await connectReady()
    sendTyping(CONNECTION_ID)
    sendTyping(CONNECTION_ID)
    await vi.advanceTimersByTimeAsync(REALTIME_TIMING.typingThrottle - 1)
    socket.receive({ type: 'pong' })
    sendTyping(CONNECTION_ID)
    expect(socket.types().filter((type) => type === 'typing')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    sendTyping(CONNECTION_ID)
    expect(socket.types().filter((type) => type === 'typing')).toHaveLength(2)
    expect(socket.sent.at(-1)).toEqual({ type: 'typing', connection_id: CONNECTION_ID })
  })
})
