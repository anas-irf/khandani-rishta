import type { InfiniteData } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, Clock, MoreHorizontal, ShieldAlert } from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Spinner } from '~/components/ui/spinner'
import type { Connection } from '~/lib/api-types'
import { formatDayLabel, formatTime } from '~/lib/format'
import { cn } from '~/lib/utils'
import { type ChatMessage, type ChatMessagePage, flattenMessages, requestMarkRead } from './cache'
import { otherName, systemMessageText } from './text'

/** The list is virtualised beyond this many messages (17 section 17). */
export const VIRTUALIZE_FROM = 200
const REMOVE_WINDOW_MS = 15 * 60_000
const NEAR_BOTTOM_PX = 48
const NEAR_TOP_PX = 120

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'message'; key: string; message: ChatMessage; notice: boolean; status: boolean }

/** A stable key: an own message keeps its key when the server copy replaces the local one. */
export function messageKey(message: ChatMessage): string {
  return message.sender === 'me' && message.client_message_id
    ? `c:${message.client_message_id}`
    : message.id
}

function dayOf(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * The id of the first unread message from the other member when the screen opens, for the
 * "Unread messages" divider (16 section 6.11 block 4).
 */
export function firstUnreadId(messages: ChatMessage[], unreadCount: number): string | null {
  if (unreadCount <= 0) return null
  const theirs = messages.filter(
    (message) => message.sender === 'them' && message.kind === 'text' && !message.local,
  )
  if (theirs.length === 0) return null
  return theirs[Math.max(0, theirs.length - unreadCount)]?.id ?? null
}

/**
 * Display rows, oldest first: day separators, the unread divider, and messages. A safety
 * notice shows at most once per flag, per conversation, per day (13 section 5.3); the delivery
 * state shows under the newest own message.
 */
export function buildRows(
  messages: ChatMessage[],
  dividerBeforeId: string | null,
  now: Date = new Date(),
): Row[] {
  const rows: Row[] = []
  const notices = new Set<string>()
  let lastDay = ''
  let newestOwn: string | null = null
  for (const message of messages) {
    if (message.sender === 'me' && !message.is_deleted) newestOwn = messageKey(message)
  }
  for (const message of messages) {
    const day = dayOf(message.created_at)
    if (day !== lastDay) {
      rows.push({ kind: 'day', key: `day:${day}`, label: formatDayLabel(message.created_at, now) })
      lastDay = day
    }
    if (dividerBeforeId !== null && message.id === dividerBeforeId) {
      rows.push({ kind: 'unread', key: 'unread' })
    }
    let notice = false
    if (message.sender === 'them' && message.safety_notice && !message.is_deleted) {
      const seen = `${message.safety_notice}|${day}`
      if (!notices.has(seen)) {
        notices.add(seen)
        notice = true
      }
    }
    const key = messageKey(message)
    rows.push({ kind: 'message', key, message, notice, status: key === newestOwn })
  }
  return rows
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

export type MessagesQuery = {
  data: InfiniteData<ChatMessagePage> | undefined
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => Promise<unknown>
}

export type MessageActions = {
  retry: (message: ChatMessage) => void
  discard: (message: ChatMessage) => void
  remove: (message: ChatMessage) => void
  report: (message: ChatMessage, reason?: string) => void
}

/**
 * The conversation (16 section 6.11 block 4): oldest at the top, newest at the bottom, day
 * separators, the unread divider, older pages loaded when scrolling up (the visible message
 * stays in place), "New messages" when a message arrives away from the bottom, read marking
 * while visible, and virtualisation beyond 200 messages.
 */
export function MessageArea({
  connection,
  query,
  ownProfileId,
  canRemove,
  actions,
  top,
  bottom,
}: {
  connection: Connection
  query: MessagesQuery
  ownProfileId: string
  /** Own messages may be removed (an active connection, and the member may engage). */
  canRemove: boolean
  actions: MessageActions
  /** Content above the first message (the first-chat tips). */
  top?: ReactNode
  /** Content under the last message (the conversation starters). */
  bottom?: ReactNode
}) {
  const { t } = useTranslation('chat')
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const name = otherName(t, connection)
  const items = useMemo(() => flattenMessages(query.data), [query.data])
  const [divider] = useState(() => firstUnreadId(items, connection.unread_count))
  const shown = useCallback(
    (message: ChatMessage) =>
      message.kind !== 'system' || systemMessageText(t, message, ownProfileId, name) !== null,
    [t, ownProfileId, name],
  )
  const rows = useMemo(() => buildRows(items.filter(shown), divider), [items, divider, shown])
  const virtual = items.length > VIRTUALIZE_FROM

  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [newPill, setNewPill] = useState(false)

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    if (virtual && rows.length > 0) virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    else element.scrollTop = element.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
    setNewPill(false)
  }, [virtual, rows.length, virtualizer])

  // Older pages: remember where the member was, and restore it after the prepend.
  const anchor = useRef<{ height: number; top: number; key: string | null } | null>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadOlder = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    const element = scrollRef.current
    const firstVisible = virtual ? virtualizer.getVirtualItems()[0]?.key : undefined
    anchor.current = element
      ? {
          height: element.scrollHeight,
          top: element.scrollTop,
          key: firstVisible === undefined ? null : String(firstVisible),
        }
      : null
    void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, virtual, virtualizer])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX
    atBottomRef.current = nearBottom
    setAtBottom(nearBottom)
    if (nearBottom) setNewPill(false)
    if (element.scrollTop < NEAR_TOP_PX) loadOlder()
  }

  // Opening: at the unread divider when there are unread messages, otherwise at the bottom.
  const positioned = useRef(false)
  useLayoutEffect(() => {
    if (positioned.current) return
    positioned.current = true
    const element = scrollRef.current
    if (!element) return
    if (divider) {
      const index = rows.findIndex((row) => row.kind === 'unread')
      if (virtual && index >= 0) virtualizer.scrollToIndex(index, { align: 'start' })
      else element.querySelector('[data-row-key="unread"]')?.scrollIntoView?.({ block: 'start' })
    } else {
      scrollToBottom()
    }
  }, [divider, rows, virtual, virtualizer, scrollToBottom])

  // A new message: stay at the bottom when there, otherwise offer "New messages".
  const newest = items.at(-1)
  const newestKey = newest ? messageKey(newest) : null
  const previousNewest = useRef(newestKey)
  useLayoutEffect(() => {
    if (previousNewest.current === newestKey) return
    const had = previousNewest.current
    previousNewest.current = newestKey
    if (had === null) return
    if (newest?.sender === 'me' || atBottomRef.current) scrollToBottom()
    else setNewPill(true)
  }, [newestKey, newest?.sender, scrollToBottom])

  // An older page arrived: keep the visible message in place.
  const oldestKey = items[0] ? messageKey(items[0]) : null
  const previousOldest = useRef(oldestKey)
  useLayoutEffect(() => {
    if (previousOldest.current === oldestKey) return
    previousOldest.current = oldestKey
    const saved = anchor.current
    anchor.current = null
    const element = scrollRef.current
    if (!saved || !element) return
    if (virtual && saved.key) {
      const index = rows.findIndex((row) => row.key === saved.key)
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'start' })
    } else {
      element.scrollTop = saved.top + (element.scrollHeight - saved.height)
    }
  }, [oldestKey, rows, virtual, virtualizer])

  // Read marking: the newest message from them is on screen and the tab is in the foreground.
  const visible = usePageVisible()
  let newestTheirsId: string | null = null
  for (const message of items) {
    if (message.sender === 'them' && !message.local) newestTheirsId = message.id
  }
  useEffect(() => {
    if (!newestTheirsId || !atBottom || !visible) return
    requestMarkRead(queryClient, connection.id, newestTheirsId)
  }, [newestTheirsId, atBottom, visible, queryClient, connection.id])

  const renderRow = (row: Row) => (
    <RowView
      row={row}
      connection={connection}
      ownProfileId={ownProfileId}
      name={name}
      canRemove={canRemove}
      actions={actions}
    />
  )

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-3 py-2 md:px-4"
        data-virtualized={virtual || undefined}
      >
        {top}
        {hasNextPage ? (
          <div className="flex justify-center py-2">
            {isFetchingNextPage ? (
              <Spinner label={t('chat.loading_older')} />
            ) : (
              <Button variant="ghost" size="sm" className="h-11" onClick={loadOlder}>
                {query.isFetchNextPageError ? t('chat.older_failed') : t('chat.load_older')}
              </Button>
            )}
          </div>
        ) : null}
        <div role="log" aria-label={t('chat.messages_label')} aria-relevant="additions">
          {virtual ? (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]
                if (!row) return null
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute top-0 w-full start-0"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {renderRow(row)}
                  </div>
                )
              })}
            </div>
          ) : (
            rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)
          )}
        </div>
        {bottom}
      </div>
      {newPill ? (
        <Button
          size="sm"
          className="absolute bottom-3 start-1/2 h-11 -translate-x-1/2 rounded-full shadow-md rtl:translate-x-1/2"
          onClick={scrollToBottom}
        >
          <ArrowDown aria-hidden="true" />
          {t('chat.new_messages')}
        </Button>
      ) : null}
    </div>
  )
}

function RowView({
  row,
  connection,
  ownProfileId,
  name,
  canRemove,
  actions,
}: {
  row: Row
  connection: Connection
  ownProfileId: string
  name: string
  canRemove: boolean
  actions: MessageActions
}) {
  const { t } = useTranslation('chat')
  if (row.kind === 'day') {
    return (
      <p
        className="py-2 text-center text-sm font-medium text-muted-foreground"
        data-row-key={row.key}
      >
        {row.label}
      </p>
    )
  }
  if (row.kind === 'unread') {
    return (
      <div className="my-2 flex items-center gap-2" data-row-key="unread">
        <span className="h-px flex-1 bg-primary/50" />
        <span className="text-sm font-medium text-primary">{t('chat.unread_divider')}</span>
        <span className="h-px flex-1 bg-primary/50" />
      </div>
    )
  }
  const { message } = row
  if (message.kind === 'system') {
    const text = systemMessageText(t, message, ownProfileId, name)
    const actor = message.system_data?.actor_profile_id
    const linkToDetails = message.system_event === 'contact_shared' && actor !== ownProfileId
    return (
      <p
        className="mx-auto my-2 w-fit max-w-md rounded-full bg-muted px-3 py-1 text-center text-sm text-muted-foreground"
        data-system-event={message.system_event}
      >
        {linkToDetails ? (
          <Link
            to="/chats/$connectionId/details"
            params={{ connectionId: connection.id }}
            className="font-medium text-primary underline"
          >
            {text}
          </Link>
        ) : (
          text
        )}
      </p>
    )
  }
  return (
    <MessageBubble
      message={message}
      connection={connection}
      notice={row.notice}
      status={row.status}
      canRemove={canRemove}
      actions={actions}
    />
  )
}

function MessageBubble({
  message,
  connection,
  notice,
  status,
  canRemove,
  actions,
}: {
  message: ChatMessage
  connection: Connection
  notice: boolean
  status: boolean
  canRemove: boolean
  actions: MessageActions
}) {
  const { t } = useTranslation('chat')
  const mine = message.sender === 'me'
  const failed = message.local?.state === 'failed'
  const sending = message.local?.state === 'sending'
  const removable =
    mine &&
    canRemove &&
    !message.local &&
    !message.is_deleted &&
    Date.now() - new Date(message.created_at).getTime() < REMOVE_WINDOW_MS
  const read =
    connection.their_last_read_message_id !== null &&
    !message.local &&
    connection.their_last_read_message_id >= message.id

  const copy = () => {
    if (!message.body) return
    void navigator.clipboard
      ?.writeText(message.body)
      .then(() => toast.success(t('message.copied')))
      .catch(() => undefined)
  }

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('message.options')}
          className="shrink-0 text-muted-foreground md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={mine ? 'end' : 'start'}>
        {!message.is_deleted && message.body ? (
          <DropdownMenuItem onSelect={copy}>{t('message.copy')}</DropdownMenuItem>
        ) : null}
        {removable ? (
          <DropdownMenuItem onSelect={() => actions.remove(message)}>
            {t('message.remove')}
          </DropdownMenuItem>
        ) : null}
        {failed ? (
          <DropdownMenuItem onSelect={() => actions.discard(message)}>
            {t('message.delete_local')}
          </DropdownMenuItem>
        ) : null}
        {!mine && connection.other && !message.is_deleted ? (
          <DropdownMenuItem onSelect={() => actions.report(message)}>
            {t('message.report')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const hasMenu = !message.is_deleted || failed

  return (
    <div
      className={cn('group flex flex-col py-0.5', mine ? 'items-end' : 'items-start')}
      data-message-id={message.id}
      data-sender={message.sender}
    >
      <div className={cn('flex max-w-[88%] items-center gap-1', mine && 'flex-row-reverse')}>
        <div
          className={cn(
            'min-w-0 rounded-2xl px-3 py-2',
            message.is_deleted
              ? 'bg-muted text-muted-foreground'
              : mine
                ? 'rounded-ee-sm bg-primary text-primary-foreground'
                : 'rounded-es-sm border border-border bg-surface text-foreground',
            failed && 'opacity-80',
          )}
        >
          {message.is_deleted ? (
            <p className="text-base italic">{t('message.removed')}</p>
          ) : (
            <p dir="auto" className="whitespace-pre-line break-words text-base">
              {message.body}
            </p>
          )}
          <p
            className={cn(
              'mt-0.5 flex items-center justify-end gap-1 text-sm',
              mine && !message.is_deleted ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            {sending ? (
              <>
                <Clock aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t('message.sending')}</span>
              </>
            ) : null}
            <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
          </p>
        </div>
        {hasMenu ? menu : null}
      </div>
      {failed ? (
        <button
          type="button"
          onClick={() => actions.retry(message)}
          className="min-h-11 px-1 text-sm font-medium text-danger underline-offset-2 hover:underline"
        >
          {message.local?.error ? `${message.local.error}. ` : ''}
          {t('message.failed')}
        </button>
      ) : null}
      {status && !message.local ? (
        <p className="px-1 text-sm text-muted-foreground" data-delivery={read ? 'read' : 'sent'}>
          {read ? t('message.read') : t('message.sent')}
        </p>
      ) : null}
      {notice && message.safety_notice ? (
        <SafetyNoticeRow
          flag={message.safety_notice}
          onReport={
            message.safety_notice === 'money' && connection.other
              ? () => actions.report(message, 'asking_for_money')
              : undefined
          }
        />
      ) : null}
    </div>
  )
}

/** The notice under a flagged message from them (13 section 5.3). */
function SafetyNoticeRow({ flag, onReport }: { flag: string; onReport?: () => void }) {
  const { t } = useTranslation('chat')
  return (
    <div
      className="mt-1 flex max-w-[88%] items-start gap-2 rounded-[var(--radius-input)] bg-muted px-3 py-2 text-sm text-muted-foreground"
      data-safety-notice={flag}
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">
        {t(`notice.${flag}`)}
        {onReport ? (
          <>
            {' '}
            <button
              type="button"
              onClick={onReport}
              className="inline-flex min-h-11 items-center font-medium text-primary underline"
            >
              {t('notice.report')}
            </button>
          </>
        ) : null}
      </p>
    </div>
  )
}
