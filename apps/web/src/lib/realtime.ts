import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyMessageToConnections,
  type ChatMessage,
  catchUpMessages,
  clearUnread,
  markMessageDeleted,
  requestMarkRead,
  upsertMessage,
} from '~/features/chat/cache'
import { apiBaseUrl } from './api'
import type { Connection, Counters, Interest, Me, Message } from './api-types'
import { i18n } from './i18n'
import { invalidateMe, qk } from './query'
import { createStore, useStore } from './store'

/**
 * The real-time client (17 section 7, 19 section 4). Started by AuthGate once `Me` has loaded,
 * under every gate except banned, suspended and deletion_scheduled; stopped on sign-out.
 *
 * The socket only delivers events; REST stays the source of truth (19 section 4.1). While the
 * socket is down the client polls instead (11 section 6.4), and after every reconnect it
 * resynchronises through REST (19 section 4.8).
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed'

export const realtimeStatus = createStore<RealtimeStatus>('idle')

/** Connection id to the time (ms) until which "typing..." is shown (19 section 4.6). */
export const typingStore = createStore<Readonly<Record<string, number>>>({})

/** Profile id to the last `presence` event's `is_online` (19 section 5). */
export const presenceStore = createStore<Readonly<Record<string, boolean>>>({})

/** The minimal WebSocket surface the client uses (the browser's `WebSocket` fits). */
export type SocketLike = {
  readonly readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
}

export type RealtimeOptions = {
  queryClient: QueryClient
  getToken: () => Promise<string | null>
  /** In-app navigation for the links of event toasts. Default: a full page load. */
  navigate?: (href: string) => void
  /** Opens the socket. Default: `new WebSocket(url)`. Tests pass a fake. */
  createSocket?: (url: string) => SocketLike
  /** Random source for the reconnect jitter, 0 to 1. Default `Math.random`. */
  random?: () => number
}

/** Timings of 19 sections 4.3, 4.8 and 4.9 and 11 section 6.4, in milliseconds. */
export const REALTIME_TIMING = {
  ping: 30_000,
  deadAfter: 45_000,
  backoff: [1_000, 2_000, 4_000, 8_000, 16_000, 30_000],
  jitter: 0.2,
  stableAfter: 30_000,
  hiddenClose: 60_000,
  tooManyFrames: 30_000,
  pollMessages: 15_000,
  pollSlow: 60_000,
  typingVisible: 5_000,
  typingThrottle: 3_000,
  meStale: 60_000,
} as const

const OPEN = 1

/** The socket URL: the API base URL with `http` replaced by `ws`, path `/v1/ws` (17 section 7.1). */
export function realtimeUrl(base: string = apiBaseUrl): string {
  return `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/ws`
}

type ServerFrame = { type: string; data?: unknown }

class RealtimeClient {
  private readonly queryClient: QueryClient
  private readonly getToken: () => Promise<string | null>
  private readonly navigate: (href: string) => void
  private readonly createSocket: (url: string) => SocketLike
  private readonly random: () => number

  private socket: SocketLike | null = null
  private stopped = false
  /** True once a `ready` was received on any socket: the next `ready` follows a disconnect. */
  private everReady = false
  private readyAt: number | null = null
  private attempt = 0
  /** Why reconnecting waits for the tab or the network rather than a timer. */
  private hold: 'none' | 'hidden' | 'replaced' | 'forbidden' | 'signed_out' = 'none'

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private deadTimer: ReturnType<typeof setTimeout> | null = null
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollTicks = 0
  private typingSent = new Map<string, number>()
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(options: RealtimeOptions) {
    this.queryClient = options.queryClient
    this.getToken = options.getToken
    this.navigate =
      options.navigate ??
      ((href) => {
        window.location.assign(href)
      })
    this.createSocket =
      options.createSocket ?? ((url) => new globalThis.WebSocket(url) as unknown as SocketLike)
    this.random = options.random ?? Math.random
  }

  start() {
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    this.setStatus('connecting')
    if (document.visibilityState === 'hidden') {
      this.hold = 'hidden'
      this.setStatus('closed')
    } else if (!navigator.onLine) {
      this.setStatus('closed')
    } else {
      this.connect()
    }
  }

  stop() {
    this.stopped = true
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    this.clearTimer('reconnectTimer')
    this.clearTimer('hiddenTimer')
    this.stopPolling()
    this.closeSocket(1000, 'stop')
    for (const timer of this.typingTimers.values()) clearTimeout(timer)
    this.typingTimers.clear()
    typingStore.set({})
    presenceStore.set({})
    realtimeStatus.set('idle')
  }

  send(frame: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== OPEN || realtimeStatus.get() !== 'open') {
      return false
    }
    this.socket.send(JSON.stringify(frame))
    return true
  }

  sendTyping(connectionId: string) {
    const now = Date.now()
    const last = this.typingSent.get(connectionId)
    if (last !== undefined && now - last < REALTIME_TIMING.typingThrottle) return
    if (this.send({ type: 'typing', connection_id: connectionId })) {
      this.typingSent.set(connectionId, now)
    }
  }

  // -------------------------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------------------------

  private connect() {
    if (this.stopped || this.socket) return
    this.clearTimer('reconnectTimer')
    this.hold = 'none'
    this.setStatus('connecting')
    let socket: SocketLike
    try {
      socket = this.createSocket(realtimeUrl())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => void this.authenticate(socket)
    socket.onmessage = (event) => this.onFrame(socket, event)
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.onDisconnect(event.code)
    }
    socket.onerror = () => undefined
  }

  /** The first frame on every socket is `auth` with a fresh token (19 section 4.2). */
  private async authenticate(socket: SocketLike) {
    let token: string | null = null
    try {
      token = await this.getToken()
    } catch {
      token = null
    }
    if (this.socket !== socket) return
    if (!token) {
      // No token can be obtained: the session is over. The API client signs out on the next
      // request (17 section 4.4); the socket stays down.
      this.hold = 'signed_out'
      this.closeSocket(1000, 'no token')
      this.setStatus('closed')
      return
    }
    socket.send(JSON.stringify({ type: 'auth', token }))
  }

  private onFrame(socket: SocketLike, event: MessageEvent) {
    if (this.socket !== socket) return
    let frame: ServerFrame
    try {
      frame = JSON.parse(String(event.data)) as ServerFrame
    } catch {
      return
    }
    if (!frame || typeof frame.type !== 'string') return
    if (frame.type === 'ready') {
      this.onReady(frame.data)
      return
    }
    if (frame.type === 'pong') {
      this.armDeadTimer()
      return
    }
    handleRealtimeEvent(this.queryClient, frame, {
      navigate: this.navigate,
      onTyping: (connectionId) => this.showTyping(connectionId),
    })
  }

  private onReady(data: unknown) {
    const reconnected = this.everReady
    this.everReady = true
    this.readyAt = Date.now()
    this.setStatus('open')
    this.stopPolling()

    const ready = (data ?? {}) as { counters?: Counters; heartbeat_seconds?: number }
    if (ready.counters) writeCounters(this.queryClient, ready.counters)

    this.clearTimer('pingTimer')
    const interval =
      typeof ready.heartbeat_seconds === 'number' && ready.heartbeat_seconds > 0
        ? ready.heartbeat_seconds * 1000
        : REALTIME_TIMING.ping
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), interval)
    this.armDeadTimer()

    if (reconnected) void resync(this.queryClient)
  }

  /** 45 seconds without a `pong` (or `ready`) is a dead connection (19 section 4.3). */
  private armDeadTimer() {
    this.clearTimer('deadTimer')
    this.deadTimer = setTimeout(() => {
      this.closeSocket(4000, 'heartbeat')
      this.onDisconnect(4408)
    }, REALTIME_TIMING.deadAfter)
  }

  /** Close codes of 19 section 4.7. */
  private onDisconnect(code: number) {
    this.clearTimer('pingTimer')
    this.clearTimer('deadTimer')
    const stableFor = this.readyAt === null ? 0 : Date.now() - this.readyAt
    if (stableFor >= REALTIME_TIMING.stableAfter) this.attempt = 0
    this.readyAt = null
    if (this.stopped) return
    this.setStatus('closed')
    this.startPolling()

    if (code === 4403) {
      // The account may not connect: follow the gate.
      this.hold = 'forbidden'
      void invalidateMe(this.queryClient)
      return
    }
    if (code === 4409) {
      // Replaced by a newer connection: wait until the tab is brought to the front again.
      this.hold = 'replaced'
      return
    }
    if (this.hold === 'hidden' || this.hold === 'signed_out') return
    if (code === 4440) {
      this.connectSoon(0)
      return
    }
    if (code === 4429) {
      this.connectSoon(REALTIME_TIMING.tooManyFrames)
      return
    }
    this.scheduleReconnect()
  }

  /** 1, 2, 4, 8, 16, then 30 seconds, each with plus or minus 20 percent jitter (19 section 4.8). */
  private scheduleReconnect() {
    const steps = REALTIME_TIMING.backoff
    const base = steps[Math.min(this.attempt, steps.length - 1)] ?? 30_000
    this.attempt += 1
    const jitter = 1 + (this.random() * 2 - 1) * REALTIME_TIMING.jitter
    this.connectSoon(Math.round(base * jitter))
  }

  private connectSoon(delay: number) {
    this.clearTimer('reconnectTimer')
    // Do not reconnect while the device is offline; the `online` event reconnects.
    if (!navigator.onLine) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private closeSocket(code: number, reason: string) {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    try {
      socket.close(code, reason)
    } catch {
      // Already closed.
    }
    this.clearTimer('pingTimer')
    this.clearTimer('deadTimer')
  }

  private onVisibility = () => {
    if (this.stopped) return
    if (document.visibilityState === 'hidden') {
      this.clearTimer('hiddenTimer')
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null
        // Closed after the tab has been hidden for 60 seconds (19 section 4.9).
        this.hold = 'hidden'
        this.clearTimer('reconnectTimer')
        if (this.socket) {
          this.closeSocket(1000, 'hidden')
          this.onDisconnect(1000)
        }
      }, REALTIME_TIMING.hiddenClose)
      return
    }
    this.clearTimer('hiddenTimer')
    if (this.hold === 'forbidden' || this.hold === 'signed_out') return
    if (!this.socket) {
      this.hold = 'none'
      this.attempt = 0
      if (navigator.onLine) this.connect()
    }
  }

  private onOnline = () => {
    if (this.stopped || this.socket) return
    if (this.hold !== 'none') return
    this.attempt = 0
    this.connect()
  }

  private onOffline = () => {
    this.clearTimer('reconnectTimer')
  }

  // -------------------------------------------------------------------------------------------
  // Polling fallback (11 section 6.4, 17 section 7.1 step 6)
  // -------------------------------------------------------------------------------------------

  private startPolling() {
    if (this.pollTimer || this.stopped) return
    this.pollTicks = 0
    this.pollTimer = setInterval(() => this.poll(), REALTIME_TIMING.pollMessages)
  }

  private stopPolling() {
    this.clearTimer('pollTimer')
  }

  private poll() {
    if (realtimeStatus.get() === 'open') {
      this.stopPolling()
      return
    }
    if (document.visibilityState === 'hidden') return
    this.pollTicks += 1
    const slowTick =
      this.pollTicks % (REALTIME_TIMING.pollSlow / REALTIME_TIMING.pollMessages) === 0
    const conversation = openConversationId
    if (conversation) {
      void catchUpMessages(this.queryClient, conversation).catch(() => undefined)
      if (slowTick) {
        void this.queryClient.invalidateQueries({ queryKey: qk.connection(conversation) })
      }
    } else if (slowTick) {
      void invalidateMe(this.queryClient)
    }
  }

  // -------------------------------------------------------------------------------------------

  private showTyping(connectionId: string) {
    const until = Date.now() + REALTIME_TIMING.typingVisible
    typingStore.set((previous) => ({ ...previous, [connectionId]: until }))
    const existing = this.typingTimers.get(connectionId)
    if (existing) clearTimeout(existing)
    this.typingTimers.set(
      connectionId,
      setTimeout(() => {
        this.typingTimers.delete(connectionId)
        typingStore.set((previous) => {
          const { [connectionId]: _removed, ...rest } = previous
          return rest
        })
      }, REALTIME_TIMING.typingVisible),
    )
  }

  private setStatus(status: RealtimeStatus) {
    realtimeStatus.set(status)
  }

  private clearTimer(
    name: 'reconnectTimer' | 'pingTimer' | 'deadTimer' | 'hiddenTimer' | 'pollTimer',
  ) {
    const timer = this[name]
    if (timer !== null) {
      clearTimeout(timer)
      clearInterval(timer)
      this[name] = null
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Event handling (17 section 7.2)
// ---------------------------------------------------------------------------------------------

/** Writes a counters object into `['me']` (16 section 3.3: no refetch). */
function writeCounters(queryClient: QueryClient, counters: Counters) {
  queryClient.setQueryData<Me>(qk.me(), (me) => (me ? { ...me, counters: { ...counters } } : me))
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/** A display name for toasts. */
function nameOf(card: { display_name: string } | null | undefined): string {
  return card?.display_name ?? i18n.t('chat:member_unavailable')
}

/**
 * Applies one server frame to the caches. Exported for tests; unknown types and unknown keys
 * are ignored (19 section 4.4).
 */
export function handleRealtimeEvent(
  queryClient: QueryClient,
  frame: ServerFrame,
  hooks: { navigate?: (href: string) => void; onTyping?: (connectionId: string) => void } = {},
) {
  const data = (frame.data ?? {}) as Record<string, unknown>
  switch (frame.type) {
    case 'message.new': {
      const message = data.message as Message | undefined
      if (!message?.id || !message.connection_id) return
      const result = upsertMessage(queryClient, message as ChatMessage)
      if (result === 'duplicate' || result === 'replaced') return
      const open = openConversationId === message.connection_id && isVisible()
      applyMessageToConnections(queryClient, message, { countUnread: !open })
      if (open && message.sender === 'them') {
        requestMarkRead(queryClient, message.connection_id, message.id)
      }
      return
    }
    case 'message.deleted': {
      const connectionId = data.connection_id
      const messageId = data.message_id
      if (typeof connectionId !== 'string' || typeof messageId !== 'string') return
      markMessageDeleted(queryClient, connectionId, messageId)
      return
    }
    case 'message.read': {
      const connectionId = data.connection_id
      const upTo = data.up_to_message_id
      if (typeof connectionId !== 'string' || typeof upTo !== 'string') return
      if (data.reader === 'them') {
        queryClient.setQueryData<Connection>(qk.connection(connectionId), (connection) => {
          if (!connection) return connection
          const held = connection.their_last_read_message_id
          if (held && held >= upTo) return connection
          return { ...connection, their_last_read_message_id: upTo }
        })
      } else if (data.reader === 'me') {
        clearUnread(queryClient, connectionId)
      }
      return
    }
    case 'typing': {
      if (typeof data.connection_id === 'string') hooks.onTyping?.(data.connection_id)
      return
    }
    case 'presence': {
      const profileId = data.profile_id
      if (typeof profileId !== 'string' || typeof data.is_online !== 'boolean') return
      const online = data.is_online
      presenceStore.set((previous) => ({ ...previous, [profileId]: online }))
      return
    }
    case 'connection.updated': {
      const connection = data.connection as Connection | undefined
      if (!connection?.id) return
      void queryClient.invalidateQueries({ queryKey: qk.connection(connection.id) })
      void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
      return
    }
    case 'interest.received':
    case 'interest.accepted': {
      void queryClient.invalidateQueries({ queryKey: qk.interestsAll() })
      void queryClient.invalidateQueries({ queryKey: qk.home() })
      void invalidateMe(queryClient)
      const interest = data.interest as Interest | undefined
      if (frame.type === 'interest.accepted') {
        // APP-CHATS refetches its list on `interest.accepted` (16 section 6.10).
        void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
      }
      const connection = data.connection as Connection | undefined
      const connectionId = connection?.id ?? interest?.connection_id ?? null
      const profileId = interest?.profile?.id ?? null
      void i18n.loadNamespaces(['interests', 'chat']).then(() => {
        const name = nameOf(interest?.profile)
        if (frame.type === 'interest.received') {
          toast(i18n.t('interests:live.received', { name }), {
            action: profileId
              ? {
                  label: i18n.t('interests:live.view'),
                  onClick: () => hooks.navigate?.(`/profiles/${encodeURIComponent(profileId)}`),
                }
              : undefined,
          })
          return
        }
        toast(i18n.t('interests:live.accepted', { name }), {
          action: connectionId
            ? {
                label: i18n.t('interests:live.open_chat'),
                onClick: () => hooks.navigate?.(`/chats/${encodeURIComponent(connectionId)}`),
              }
            : undefined,
        })
      })
      return
    }
    case 'notification.new':
      void queryClient.invalidateQueries({ queryKey: qk.notifications() })
      return
    case 'counters':
      if (frame.data && typeof frame.data === 'object') {
        writeCounters(queryClient, frame.data as Counters)
      }
      return
    case 'photo.updated':
      void queryClient.invalidateQueries({ queryKey: qk.photos() })
      void queryClient.invalidateQueries({ queryKey: qk.ownProfile() })
      void invalidateMe(queryClient)
      return
    case 'gate.changed':
      void invalidateMe(queryClient)
      return
    default:
      return
  }
}

/**
 * The resync after every `ready` that follows a disconnect (19 section 4.8, 17 section 7.1
 * step 5). Counters were already written from `ready`.
 */
export async function resync(queryClient: QueryClient) {
  const meState = queryClient.getQueryState(qk.me())
  if (!meState?.dataUpdatedAt || Date.now() - meState.dataUpdatedAt > REALTIME_TIMING.meStale) {
    void invalidateMe(queryClient)
  }
  void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
  void queryClient.invalidateQueries({ queryKey: qk.interestsAll() })
  void queryClient.invalidateQueries({ queryKey: qk.notifications() })
  const conversation = openConversationId
  if (conversation) {
    try {
      await catchUpMessages(queryClient, conversation)
    } catch {
      // REST failures here are retried by the next resync or poll.
    }
    void queryClient.invalidateQueries({ queryKey: qk.connection(conversation) })
  }
}

// ---------------------------------------------------------------------------------------------
// Module API
// ---------------------------------------------------------------------------------------------

let client: RealtimeClient | null = null
let openConversationId: string | null = null

/** Starts the client and returns a function that stops it. */
export function startRealtime(options: RealtimeOptions): () => void {
  stopRealtime()
  const current = new RealtimeClient(options)
  client = current
  current.start()
  return () => {
    if (client === current) stopRealtime()
  }
}

/** Closes the socket (sign-out step 1, 06 section 10.1). */
export function stopRealtime() {
  const current = client
  client = null
  current?.stop()
  if (!current) realtimeStatus.set('idle')
}

/** Sends a client frame when the socket is open. Returns false when it could not be sent. */
export function sendRealtime(frame: Record<string, unknown>): boolean {
  return client?.send(frame) ?? false
}

/** The `typing` frame for a conversation, at most once every 3 seconds (11 section 6.6). */
export function sendTyping(connectionId: string) {
  client?.sendTyping(connectionId)
}

/**
 * Registers the conversation open on screen (`APP-CHAT`): it is resynchronised after a
 * reconnect, polled while the socket is down, and new messages in it are marked read while
 * the tab is visible. Returns the function that unregisters it.
 */
export function subscribeConversation(connectionId: string): () => void {
  openConversationId = connectionId
  return () => {
    if (openConversationId === connectionId) openConversationId = null
  }
}

/** Whether "typing..." should show for a conversation. */
export function useTyping(connectionId: string): boolean {
  return useStore(typingStore, (state) => (state[connectionId] ?? 0) > 0)
}

/** The last presence event for a profile, or undefined when none arrived. */
export function usePresence(profileId: string | null | undefined): boolean | undefined {
  return useStore(presenceStore, (state) => (profileId ? state[profileId] : undefined))
}
