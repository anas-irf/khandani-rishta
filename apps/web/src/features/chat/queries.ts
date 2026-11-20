import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type ApiError, http, isApiError, seg } from '~/lib/api'
import type {
  Connection,
  ContactShareBody,
  EndConnectionReason,
  Message,
  MessagePage,
  Page,
  Stage,
} from '~/lib/api-types'
import { formatDate } from '~/lib/format'
import { invalidateMe, nextCursor, qk, removeFromPages, STALE } from '~/lib/query'
import {
  applyMessageToConnections,
  type ChatMessage,
  type MessagesData,
  markMessageDeleted,
  oldestServerMessageId,
  removeLocalMessage,
  updateConnectionCaches,
  updateMessage,
  upsertMessage,
} from './cache'

/**
 * Connections and chat (15 section 12). Cache effects follow 17 section 6.3; optimistic only
 * where 16 rule G7 allows it: the "sending" state of a message, marking read, mute and archive.
 */

export type ConnectionFilter = 'active' | 'archived' | 'ended'

export const MESSAGE_PAGE_SIZE = 30
export const MESSAGE_MAX_LENGTH = 2000

const messagesPath = (connectionId: string) => `/v1/connections/${seg(connectionId)}/messages`
const connectionPath = (connectionId: string) => `/v1/connections/${seg(connectionId)}`

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useConnections(filter: ConnectionFilter) {
  return useInfiniteQuery({
    queryKey: qk.connections(filter),
    queryFn: ({ pageParam, signal }) =>
      http.get<Page<Connection>>('/v1/connections', {
        query: { filter, limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: STALE.list,
  })
}

export function connectionQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: qk.connection(connectionId),
    queryFn: ({ signal }) => http.get<Connection>(connectionPath(connectionId), { signal }),
    staleTime: STALE.connection,
    meta: { handles: ['not_found'] },
  })
}

export function useConnection(connectionId: string) {
  return useQuery(connectionQueryOptions(connectionId))
}

/**
 * `['messages', id]`: newest page first, older pages with `before=` (15 section 12). Kept
 * fresh by the WebSocket and the `after=` catch-up, never refetched as a whole (17 section 6.2).
 */
export function messagesQueryOptions(connectionId: string) {
  return infiniteQueryOptions({
    queryKey: qk.messages(connectionId),
    queryFn: async ({ pageParam, signal }) =>
      (await http.get<MessagePage>(messagesPath(connectionId), {
        query: { limit: MESSAGE_PAGE_SIZE, before: pageParam },
        signal,
      })) as MessagesData['pages'][number],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? oldestServerMessageId(last.items) : undefined),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { handles: ['not_found'] },
  })
}

export function useMessages(connectionId: string) {
  return useInfiniteQuery(messagesQueryOptions(connectionId))
}

// ---------------------------------------------------------------------------
// Connection mutations: set `['connection', id]` from the response, invalidate the lists
// ---------------------------------------------------------------------------

function setConnection(queryClient: QueryClient, connection: Connection) {
  queryClient.setQueryData(qk.connection(connection.id), connection)
  updateConnectionCaches(queryClient, connection.id, () => connection)
  void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
}

/** The connection is gone (`not_found`): it leaves every cached list (16 section 1.3). */
export function forgetConnection(queryClient: QueryClient, connectionId: string) {
  removeFromPages<Connection>(queryClient, qk.connectionsAll(), (item) => item.id === connectionId)
}

function refetchConnection(queryClient: QueryClient, connectionId: string) {
  void queryClient.invalidateQueries({ queryKey: qk.connection(connectionId) })
  void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
}

type ConnectionsSnapshot = [readonly unknown[], unknown][]

/**
 * `PATCH /v1/connections/{id}` with `is_muted` or `is_archived`. Optimistic (16 rule G7): the
 * flag changes at once and an archived row leaves its filter; reverted on error, with the
 * global toast.
 */
export function usePatchConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { id: string; is_muted?: boolean; is_archived?: boolean }) => {
      const { id, ...body } = variables
      return http.patch<Connection>(connectionPath(id), body)
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: qk.connectionsAll() })
      await queryClient.cancelQueries({ queryKey: qk.connection(variables.id) })
      const snapshot: ConnectionsSnapshot = [
        ...queryClient.getQueriesData({ queryKey: qk.connectionsAll() }),
        [qk.connection(variables.id), queryClient.getQueryData(qk.connection(variables.id))],
      ]
      updateConnectionCaches(queryClient, variables.id, (connection) => ({
        ...connection,
        ...(variables.is_muted !== undefined ? { is_muted: variables.is_muted } : {}),
        ...(variables.is_archived !== undefined ? { is_archived: variables.is_archived } : {}),
      }))
      if (variables.is_archived !== undefined) {
        // The row moves between the "Chats" and "Archived" filters.
        const leaving = variables.is_archived ? 'active' : 'archived'
        removeFromPages<Connection>(
          queryClient,
          qk.connections(leaving),
          (item) => item.id === variables.id,
        )
      }
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSuccess: (connection) => setConnection(queryClient, connection),
  })
}

export function useEndConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { id: string; reason: EndConnectionReason; alsoBlock: boolean }) =>
      http.post<Connection>(`${connectionPath(variables.id)}/end`, {
        reason: variables.reason,
        also_block: variables.alsoBlock,
      }),
    meta: { handles: ['connection_ended'] },
    onSuccess: (connection, variables) => {
      setConnection(queryClient, connection)
      if (connection.other) {
        void queryClient.invalidateQueries({ queryKey: qk.profile(connection.other.id) })
      }
      void invalidateMe(queryClient)
      if (variables.alsoBlock) {
        void queryClient.invalidateQueries({ queryKey: qk.blocks() })
        void queryClient.invalidateQueries({ queryKey: qk.interestsAll() })
        void queryClient.invalidateQueries({ queryKey: qk.home() })
        void queryClient.invalidateQueries({ queryKey: qk.recommendations() })
        void queryClient.invalidateQueries({ queryKey: qk.shortlist() })
      }
    },
    onError: (error, variables) => {
      if (isApiError(error) && error.code === 'connection_ended') {
        refetchConnection(queryClient, variables.id)
      }
    },
  })
}

/** `PUT .../contact-share`. `validation_failed` (`required`) is shown by the dialog (08 section 3.5). */
export function useShareContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { id: string; body: ContactShareBody }) =>
      http.put<Connection>(`${connectionPath(variables.id)}/contact-share`, variables.body),
    meta: { handles: ['connection_ended'] },
    onSuccess: (connection) => setConnection(queryClient, connection),
    onError: (error, variables) => {
      if (isApiError(error) && error.code === 'connection_ended') {
        refetchConnection(queryClient, variables.id)
      }
    },
  })
}

export function useStopSharing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) =>
      http.delete<Connection>(`${connectionPath(connectionId)}/contact-share`),
    onSuccess: (connection) => setConnection(queryClient, connection),
  })
}

export type StageAction =
  | { kind: 'propose'; id: string; stage: Stage }
  | { kind: 'confirm'; id: string; proposalId: string }
  | { kind: 'decline'; id: string; proposalId: string }
  | { kind: 'cancel'; id: string; proposalId: string }

function stageRequest(action: StageAction): Promise<Connection> {
  const base = `${connectionPath(action.id)}/stage-proposals`
  switch (action.kind) {
    case 'propose':
      return http.post<Connection>(base, { stage: action.stage })
    case 'confirm':
      return http.post<Connection>(`${base}/${seg(action.proposalId)}/confirm`)
    case 'decline':
      return http.post<Connection>(`${base}/${seg(action.proposalId)}/decline`)
    case 'cancel':
      return http.delete<Connection>(`${base}/${seg(action.proposalId)}`)
  }
}

/**
 * Stage proposals and their answers (11 section 9, 16 section 6.12). `invalid_state`,
 * `already_exists` and `connection_ended` refetch the connection; `cooldown_active` shows
 * "You can suggest this again on {date}."
 */
export function useStageAction() {
  const queryClient = useQueryClient()
  const { t } = useTranslation('chat')
  return useMutation({
    mutationFn: stageRequest,
    meta: { handles: ['invalid_state', 'already_exists', 'connection_ended', 'cooldown_active'] },
    onSuccess: (connection) => setConnection(queryClient, connection),
    onError: (error, action) => {
      if (!isApiError(error)) return
      if (error.code === 'cooldown_active') {
        const date = error.details.retry_after_date
        toast.error(t('stage.cooldown', { date: typeof date === 'string' ? formatDate(date) : '' }))
        return
      }
      if (['invalid_state', 'already_exists', 'connection_ended'].includes(error.code)) {
        refetchConnection(queryClient, action.id)
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Removes an own message within 15 minutes (11 section 6.7). */
export function useDeleteMessage(connectionId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('chat')
  return useMutation({
    mutationFn: (messageId: string) =>
      http.delete<Message>(`${messagesPath(connectionId)}/${seg(messageId)}`),
    meta: { handles: ['invalid_state'] },
    onSuccess: (message) => {
      upsertMessage(queryClient, message)
      markMessageDeleted(queryClient, connectionId, message.id)
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'invalid_state') {
        toast.error(t('message.remove_too_late'))
      }
    },
  })
}

let localSeq = 0

/** A message shown at once in the "Sending" state (17 section 7.3 step 2). */
function localMessage(connectionId: string, body: string, clientMessageId: string): ChatMessage {
  localSeq += 1
  return {
    id: `local:${clientMessageId}`,
    connection_id: connectionId,
    sender: 'me',
    kind: 'text',
    body,
    is_deleted: false,
    system_event: null,
    system_data: null,
    client_message_id: clientMessageId,
    safety_notice: null,
    created_at: new Date().toISOString(),
    local: { state: 'sending', seq: localSeq },
  }
}

const SEND_HANDLES = [
  'connection_ended',
  'rate_limited',
  'limit_reached',
  'validation_failed',
  'invalid_state',
  'network_error',
] as const

function newClientMessageId(): string {
  return crypto.randomUUID()
}

/**
 * Sending, retrying and discarding messages (16 section 6.11 "Sending a message", 17 section
 * 7.3). A failed message keeps its `client_message_id`, so a retry can never create a
 * duplicate. Messages are never retried automatically, except once after `rate_limited`.
 */
export function useChatSender(connectionId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('chat')
  const [dailyLimitReached, setDailyLimitReached] = useState(false)
  const autoRetried = useRef(new Set<string>())

  const markFailed = (clientMessageId: string, error: string | null) =>
    updateMessage(
      queryClient,
      connectionId,
      (message) => message.local !== undefined && message.client_message_id === clientMessageId,
      (message) => ({
        ...message,
        local: { seq: message.local?.seq ?? 0, state: 'failed', error },
      }),
    )

  const mutation = useMutation({
    mutationFn: (variables: { body: string; clientMessageId: string }) =>
      http.post<Message>(messagesPath(connectionId), {
        body: variables.body,
        client_message_id: variables.clientMessageId,
      }),
    meta: { handles: SEND_HANDLES },
    onSuccess: (message) => {
      // Replaces the local message (matched on `client_message_id`); a `message.new` event for
      // the same message that arrives later is ignored by the deduplication.
      upsertMessage(queryClient, message)
      applyMessageToConnections(queryClient, message, { countUnread: false })
    },
    onError: (error, variables) => {
      const code = isApiError(error) ? error.code : 'internal_error'
      switch (code) {
        case 'rate_limited': {
          markFailed(variables.clientMessageId, t('message.too_fast'))
          if (!autoRetried.current.has(variables.clientMessageId)) {
            autoRetried.current.add(variables.clientMessageId)
            const seconds = Number((error as ApiError).details.retry_after_seconds ?? 5)
            setTimeout(() => retryWith(variables), Math.max(1, seconds) * 1000)
          }
          return
        }
        case 'limit_reached':
          setDailyLimitReached(true)
          markFailed(variables.clientMessageId, null)
          return
        case 'validation_failed': {
          const apiError = error as ApiError
          markFailed(variables.clientMessageId, apiError.fields[0]?.message ?? apiError.message)
          return
        }
        case 'connection_ended':
          markFailed(variables.clientMessageId, null)
          refetchConnection(queryClient, connectionId)
          return
        case 'invalid_state':
          markFailed(variables.clientMessageId, null)
          refetchConnection(queryClient, connectionId)
          return
        default:
          markFailed(variables.clientMessageId, null)
      }
    },
  })

  const retryWith = (variables: { body: string; clientMessageId: string }) => {
    updateMessage(
      queryClient,
      connectionId,
      (message) =>
        message.local !== undefined && message.client_message_id === variables.clientMessageId,
      (message) => ({
        ...message,
        local: { seq: message.local?.seq ?? 0, state: 'sending', error: null },
      }),
    )
    mutation.mutate(variables)
  }

  /** Trims the text; returns false for an empty message. */
  const send = (text: string): boolean => {
    const body = text.trim()
    if (!body) return false
    const clientMessageId = newClientMessageId()
    upsertMessage(queryClient, localMessage(connectionId, body, clientMessageId))
    mutation.mutate({ body, clientMessageId })
    return true
  }

  /** "Not sent. Tap to retry": the same request with the same `client_message_id`. */
  const retry = (message: ChatMessage) => {
    if (!message.client_message_id || message.body === null) return
    retryWith({ body: message.body, clientMessageId: message.client_message_id })
  }

  /** "Delete" on a failed message: removes the local message only. */
  const discard = (message: ChatMessage) => {
    if (message.client_message_id) {
      removeLocalMessage(queryClient, connectionId, message.client_message_id)
    }
  }

  return { send, retry, discard, dailyLimitReached }
}
