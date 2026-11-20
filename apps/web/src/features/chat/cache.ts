import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { http, seg } from '~/lib/api'
import type { Connection, Me, Message, MessagePage, Page } from '~/lib/api-types'
import { qk } from '~/lib/query'

/**
 * The chat caches (17 sections 6.2, 6.3 and 7): messages of a conversation and the connection
 * rows that show its preview and unread count. Shared by the chat screens and the real-time
 * client, so a message delivered twice (REST and WebSocket) is shown once (11 section 6.3).
 */

/** A message held by the client. `local` is set only while the server has not confirmed it. */
export type ChatMessage = Message & {
  local?: {
    state: 'sending' | 'failed'
    /** Why it failed (a translated text), when known. */
    error?: string | null
    /** Creation order of local messages, which have no server id yet. */
    seq: number
  }
}

export type ChatMessagePage = Omit<MessagePage, 'items'> & { items: ChatMessage[] }

/** `['messages', id]`: pages go backwards in time; every page is newest first (15 section 12). */
export type MessagesData = InfiniteData<ChatMessagePage>

type ConnectionsData = InfiniteData<Page<Connection>, string | undefined>

const PREVIEW_LENGTH = 80

/**
 * Newest first. Server ids are UUIDv7, so their string order is creation order (11 section
 * 6.2); local messages are newer than every server message, in the order they were written.
 */
export function compareNewestFirst(a: ChatMessage, b: ChatMessage): number {
  if (a.local && b.local) return b.local.seq - a.local.seq
  if (a.local) return -1
  if (b.local) return 1
  if (a.id === b.id) return 0
  return a.id < b.id ? 1 : -1
}

/** Every held message, oldest first (display order). */
export function flattenMessages(data: MessagesData | undefined): ChatMessage[] {
  if (!data) return []
  const all = data.pages.flatMap((page) => page.items)
  return all.sort(compareNewestFirst).reverse()
}

/** The newest message id the server knows (for `after=`), or null. */
export function newestServerMessageId(data: MessagesData | undefined): string | null {
  let newest: string | null = null
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      if (item.local) continue
      if (newest === null || item.id > newest) newest = item.id
    }
  }
  return newest
}

/** The oldest server id of a page (for `before=`). */
export function oldestServerMessageId(items: ChatMessage[]): string | undefined {
  let oldest: string | undefined
  for (const item of items) {
    if (item.local) continue
    if (oldest === undefined || item.id < oldest) oldest = item.id
  }
  return oldest
}

function findIndexes(
  data: MessagesData,
  predicate: (message: ChatMessage) => boolean,
): [number, number] | null {
  for (const [pageIndex, page] of data.pages.entries()) {
    const itemIndex = page.items.findIndex(predicate)
    if (itemIndex >= 0) return [pageIndex, itemIndex]
  }
  return null
}

/** Whether `message` is the server copy of a held local message (same `client_message_id`). */
function sameClientMessage(held: ChatMessage, message: ChatMessage): boolean {
  return (
    held.client_message_id !== null &&
    held.client_message_id === message.client_message_id &&
    held.sender === 'me' &&
    message.sender === 'me'
  )
}

export type UpsertResult = 'added' | 'replaced' | 'duplicate' | 'no-cache'

/**
 * Adds or replaces one message in `['messages', connection_id]`. A message already held with
 * the same `id` is replaced in place; a local message with the same `client_message_id` is
 * replaced by the server copy. Returns `no-cache` when the conversation is not cached.
 */
export function upsertMessage(queryClient: QueryClient, message: ChatMessage): UpsertResult {
  let result: UpsertResult = 'no-cache'
  queryClient.setQueryData<MessagesData>(qk.messages(message.connection_id), (data) => {
    if (!data || data.pages.length === 0) return data
    const next = upsertInto(data, message)
    result = next.result
    return next.data
  })
  return result
}

function upsertInto(
  data: MessagesData,
  message: ChatMessage,
): { data: MessagesData; result: UpsertResult } {
  const byId = findIndexes(data, (held) => !held.local && held.id === message.id)
  if (byId) {
    const [pageIndex, itemIndex] = byId
    const held = data.pages[pageIndex]?.items[itemIndex]
    // A deleted message never comes back to life from an older copy.
    const merged = held?.is_deleted ? { ...message, body: null, is_deleted: true } : message
    return { data: replaceAt(data, pageIndex, itemIndex, merged), result: 'duplicate' }
  }
  const byClientId = findIndexes(data, (held) => sameClientMessage(held, message))
  if (byClientId) {
    const [pageIndex, itemIndex] = byClientId
    const pages = data.pages.map((page, index) => {
      if (index !== pageIndex) return page
      const items = page.items.filter((_, i) => i !== itemIndex)
      return { ...page, items: [...items, message].sort(compareNewestFirst) }
    })
    return { data: { ...data, pages }, result: 'replaced' }
  }
  const [first, ...rest] = data.pages
  if (!first) return { data, result: 'no-cache' }
  const items = [...first.items, message].sort(compareNewestFirst)
  return { data: { ...data, pages: [{ ...first, items }, ...rest] }, result: 'added' }
}

function replaceAt(
  data: MessagesData,
  pageIndex: number,
  itemIndex: number,
  message: ChatMessage,
): MessagesData {
  return {
    ...data,
    pages: data.pages.map((page, index) =>
      index === pageIndex
        ? { ...page, items: page.items.map((item, i) => (i === itemIndex ? message : item)) }
        : page,
    ),
  }
}

/** Merges messages fetched with `after=` (or any batch) into the conversation. */
export function mergeMessages(queryClient: QueryClient, connectionId: string, messages: Message[]) {
  queryClient.setQueryData<MessagesData>(qk.messages(connectionId), (data) => {
    if (!data || data.pages.length === 0) return data
    let next = data
    for (const message of messages) next = upsertInto(next, message).data
    return next
  })
}

/** Changes the held message with `id` (server id or local `client_message_id`). */
export function updateMessage(
  queryClient: QueryClient,
  connectionId: string,
  match: (message: ChatMessage) => boolean,
  update: (message: ChatMessage) => ChatMessage,
) {
  queryClient.setQueryData<MessagesData>(qk.messages(connectionId), (data) => {
    if (!data) return data
    const found = findIndexes(data, match)
    if (!found) return data
    const [pageIndex, itemIndex] = found
    const held = data.pages[pageIndex]?.items[itemIndex]
    return held ? replaceAt(data, pageIndex, itemIndex, update(held)) : data
  })
}

/** Removes a local message (the "Delete" of a failed message). */
export function removeLocalMessage(
  queryClient: QueryClient,
  connectionId: string,
  clientMessageId: string,
) {
  queryClient.setQueryData<MessagesData>(qk.messages(connectionId), (data) => {
    if (!data) return data
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter(
          (item) => !(item.local && item.client_message_id === clientMessageId),
        ),
      })),
    }
  })
}

/** `message.deleted` and a successful removal: "Message removed" (11 section 6.7). */
export function markMessageDeleted(
  queryClient: QueryClient,
  connectionId: string,
  messageId: string,
) {
  const data = queryClient.getQueryData<MessagesData>(qk.messages(connectionId))
  const wasNewest = newestServerMessageId(data) === messageId
  updateMessage(
    queryClient,
    connectionId,
    (message) => !message.local && message.id === messageId,
    (message) => ({ ...message, body: null, is_deleted: true }),
  )
  if (wasNewest) {
    updateConnectionCaches(queryClient, connectionId, (connection) => ({
      ...connection,
      last_message_preview: null,
    }))
  }
}

// ---------------------------------------------------------------------------
// Connection rows
// ---------------------------------------------------------------------------

/** Applies `update` to `['connection', id]` and to the row in every `['connections', *]` page. */
export function updateConnectionCaches(
  queryClient: QueryClient,
  connectionId: string,
  update: (connection: Connection) => Connection,
) {
  queryClient.setQueryData<Connection>(qk.connection(connectionId), (connection) =>
    connection ? update(connection) : connection,
  )
  queryClient.setQueriesData<ConnectionsData>({ queryKey: qk.connectionsAll() }, (data) => {
    if (!data?.pages) return data
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => (item.id === connectionId ? update(item) : item)),
      })),
    }
  })
}

/** The cached connection, from `['connection', id]` or any list. */
export function findCachedConnection(
  queryClient: QueryClient,
  connectionId: string,
): Connection | undefined {
  const single = queryClient.getQueryData<Connection>(qk.connection(connectionId))
  if (single) return single
  for (const [, data] of queryClient.getQueriesData<ConnectionsData>({
    queryKey: qk.connectionsAll(),
  })) {
    for (const page of data?.pages ?? []) {
      const found = page.items.find((item) => item.id === connectionId)
      if (found) return found
    }
  }
  return undefined
}

/** Moves a row to the top of every cached `['connections', *]` list that holds it. */
function moveConnectionToTop(queryClient: QueryClient, connectionId: string) {
  queryClient.setQueriesData<ConnectionsData>({ queryKey: qk.connectionsAll() }, (data) => {
    if (!data?.pages?.length) return data
    let moved: Connection | undefined
    const pages = data.pages.map((page) => {
      const found = page.items.find((item) => item.id === connectionId)
      if (!found) return page
      moved = found
      return { ...page, items: page.items.filter((item) => item.id !== connectionId) }
    })
    if (!moved || !pages[0]) return data
    pages[0] = { ...pages[0], items: [moved, ...pages[0].items] }
    return { ...data, pages }
  })
}

function listHolds(queryClient: QueryClient, filter: 'active' | 'archived', id: string): boolean {
  const data = queryClient.getQueryData<ConnectionsData>(qk.connections(filter))
  return Boolean(data?.pages.some((page) => page.items.some((item) => item.id === id)))
}

/**
 * The effect of a new message on the chat list (16 section 6.10 live updates): preview, time,
 * unread count, and the row moves to the top. A text message clears `is_archived` (11 section
 * 6.2 step 6), so an archived row goes back to the Chats filter. System messages clear the
 * preview and never count as unread (11 section 6.8).
 */
export function applyMessageToConnections(
  queryClient: QueryClient,
  message: Message,
  options: { countUnread: boolean },
) {
  const isText = message.kind === 'text'
  const preview = isText && message.body ? message.body.slice(0, PREVIEW_LENGTH) : null
  const wasArchived = findCachedConnection(queryClient, message.connection_id)?.is_archived
  updateConnectionCaches(queryClient, message.connection_id, (connection) => ({
    ...connection,
    last_message_at: message.created_at,
    last_message_preview: preview,
    unread_count:
      options.countUnread && isText && message.sender === 'them'
        ? connection.unread_count + 1
        : connection.unread_count,
    is_archived: isText ? false : connection.is_archived,
  }))
  moveConnectionToTop(queryClient, message.connection_id)

  const missingFromActive = !listHolds(queryClient, 'active', message.connection_id)
  if ((isText && wasArchived) || missingFromActive) {
    void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
  }
}

/** Unread count 0 in `['connection', id]` and `['connections', *]` (17 section 6.3). */
export function clearUnread(queryClient: QueryClient, connectionId: string) {
  const before = findCachedConnection(queryClient, connectionId)
  updateConnectionCaches(queryClient, connectionId, (connection) =>
    connection.unread_count === 0 ? connection : { ...connection, unread_count: 0 },
  )
  // `counters.unread_chats` counts connections with unread messages that are not muted.
  if (before && before.unread_count > 0 && !before.is_muted) {
    queryClient.setQueryData<Me>(qk.me(), (me) =>
      me
        ? {
            ...me,
            counters: {
              ...me.counters,
              unread_chats: Math.max(0, me.counters.unread_chats - 1),
            },
          }
        : me,
    )
  }
}

// ---------------------------------------------------------------------------
// Catching up and marking read
// ---------------------------------------------------------------------------

const AFTER_LIMIT = 100

/**
 * `GET .../messages?after=<newest id held>`, repeated while `has_more`, merged into the cache
 * (19 section 4.8 step 2, 11 section 6.4). Does nothing when the conversation is not cached.
 */
export async function catchUpMessages(queryClient: QueryClient, connectionId: string) {
  for (let round = 0; round < 50; round += 1) {
    const data = queryClient.getQueryData<MessagesData>(qk.messages(connectionId))
    if (!data) return
    const after = newestServerMessageId(data)
    if (!after) return
    const page = await http.get<MessagePage>(`/v1/connections/${seg(connectionId)}/messages`, {
      query: { after, limit: AFTER_LIMIT },
    })
    mergeMessages(queryClient, connectionId, page.items)
    if (!page.has_more || page.items.length === 0) return
  }
}

type ReadState = {
  sent: string | null
  pending: string | null
  timer: ReturnType<typeof setTimeout> | null
}

const readStates = new WeakMap<QueryClient, Map<string, ReadState>>()

function readStateFor(queryClient: QueryClient, connectionId: string): ReadState {
  let map = readStates.get(queryClient)
  if (!map) {
    map = new Map()
    readStates.set(queryClient, map)
  }
  let state = map.get(connectionId)
  if (!state) {
    state = { sent: null, pending: null, timer: null }
    map.set(connectionId, state)
  }
  return state
}

const READ_INTERVAL_MS = 1000

/**
 * `POST /v1/connections/{id}/read` with the newest visible id, at most once a second and never
 * backwards (11 section 6.5). The unread badge clears at once (optimistic, 16 rule G7);
 * failures are ignored.
 */
export function requestMarkRead(queryClient: QueryClient, connectionId: string, messageId: string) {
  const state = readStateFor(queryClient, connectionId)
  if (state.sent !== null && messageId <= state.sent) return
  if (state.pending !== null && messageId <= state.pending) return
  clearUnread(queryClient, connectionId)
  if (state.timer) {
    state.pending = messageId
    return
  }
  send(queryClient, connectionId, state, messageId)
}

function send(queryClient: QueryClient, connectionId: string, state: ReadState, messageId: string) {
  state.sent = messageId
  state.pending = null
  void http
    .post(`/v1/connections/${seg(connectionId)}/read`, { up_to_message_id: messageId })
    .catch(() => undefined)
  state.timer = setTimeout(() => {
    state.timer = null
    if (state.pending !== null && (state.sent === null || state.pending > state.sent)) {
      send(queryClient, connectionId, state, state.pending)
    }
  }, READ_INTERVAL_MS)
}
