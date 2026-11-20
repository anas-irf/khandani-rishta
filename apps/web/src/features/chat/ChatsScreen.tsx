// APP-CHATS (16 section 6.10)
import { Link, Outlet, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { BellOff, Clock, MessagesSquare, MoreVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { MemberPhoto, Silhouette } from '~/components/common/MemberPhoto'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PageHeader } from '~/components/common/PageHeader'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { Connection, Gender } from '~/lib/api-types'
import { formatRelative } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { badgeCount, cn } from '~/lib/utils'
import { type ConnectionFilter, useConnections, usePatchConnection } from './queries'
import { chatsSearchSchema } from './search'
import { hasNoTextMessages, isQuiet, otherName, stageName } from './text'

const FILTERS: readonly ConnectionFilter[] = ['active', 'archived', 'ended']

function useFilter(): ConnectionFilter {
  return chatsSearchSchema.parse(useSearch({ strict: false })).filter
}

/**
 * The `/chats` layout (17 section 9.1): on wide screens the chat list stays beside the open
 * conversation (two panes); on narrow screens the list and the conversation are separate
 * screens, so the side pane is hidden.
 */
export function ChatsLayout() {
  const { t } = useTranslation('chat')
  return (
    <ScreenAccess screen="APP-CHATS">
      <div className="md:container-app md:grid md:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] md:gap-6">
        <aside
          aria-label={t('chats.list_label')}
          className="hidden md:block md:h-[calc(100dvh-4rem)] md:overflow-y-auto md:py-3 md:pe-1"
        >
          <ChatList withTitle />
        </aside>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </ScreenAccess>
  )
}

/** `/chats`: the list on narrow screens; on wide screens the list is in the side pane. */
export function ChatsIndex() {
  const { t } = useTranslation('chat')
  return (
    <>
      <div className="md:hidden">
        <ChatsScreen />
      </div>
      <div className="hidden h-[calc(100dvh-4rem)] items-center justify-center text-center md:flex">
        <EmptyState icon={MessagesSquare} title={t('chats.select')} />
      </div>
    </>
  )
}

/** The chat list as a screen of its own. */
export function ChatsScreen() {
  return (
    <ScreenAccess screen="APP-CHATS">
      <div className="container-app">
        <ChatList withTitle />
      </div>
    </ScreenAccess>
  )
}

function ChatList({ withTitle = false }: { withTitle?: boolean }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const filter = useFilter()
  const query = useConnections(filter)

  return (
    <div className="flex flex-col gap-3">
      {withTitle ? <PageHeader title={t('chats.title')} /> : null}
      <Tabs
        value={filter}
        onValueChange={(value) =>
          void navigate({ to: '/chats', search: { filter: value as ConnectionFilter } })
        }
      >
        <TabsList aria-label={t('chats.filter.label')} className="w-full">
          {FILTERS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`chats.filter.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <InfiniteList
        query={query}
        getKey={(connection) => connection.id}
        label={t('chats.list_label')}
        listClassName="gap-2"
        empty={<ChatsEmpty filter={filter} />}
        renderItem={(connection) => <ChatRow connection={connection} filter={filter} />}
      />
    </div>
  )
}

function ChatsEmpty({ filter }: { filter: ConnectionFilter }) {
  const { t } = useTranslation('chat')
  return (
    <EmptyState
      icon={MessagesSquare}
      title={t(`chats.empty.${filter}.title`)}
      text={filter === 'ended' ? undefined : t(`chats.empty.${filter}.text`)}
      action={
        filter === 'active' ? (
          <Button asChild>
            <Link to="/matches">{t('chats.empty.active.action')}</Link>
          </Button>
        ) : null
      }
    />
  )
}

/** The neutral avatar when `other` is null: the opposite gender of the member's own profile. */
export function otherGender(ownGender: Gender | null): Gender {
  return ownGender === 'male' ? 'female' : 'male'
}

function ChatRow({ connection, filter }: { connection: Connection; filter: ConnectionFilter }) {
  const { t } = useTranslation(['chat', 'shared'])
  const me = useCurrentMe()
  const params = useParams({ strict: false }) as { connectionId?: string }
  const name = otherName(t, connection)
  const unread = connection.unread_count > 0
  const current = params.connectionId === connection.id
  const time = connection.last_message_at ?? connection.created_at
  const preview =
    connection.last_message_preview ??
    (hasNoTextMessages(connection) ? t('chats.preview_new') : t('chats.preview_update'))

  return (
    <article
      className={cn(
        'relative flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 transition-colors hover:bg-muted has-[[data-row-link]:focus-visible]:ring-2 has-[[data-row-link]:focus-visible]:ring-ring',
        current && 'border-primary bg-primary-soft',
      )}
      data-connection-row={connection.id}
    >
      {connection.other ? (
        <MemberPhoto
          photo={connection.other.photo}
          name={connection.other.display_name}
          gender={connection.other.gender}
          size="thumb"
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-full"
        />
      ) : (
        <Silhouette
          gender={otherGender(me.profile.gender)}
          label={name}
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-full"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <Link
            to="/chats/$connectionId"
            params={{ connectionId: connection.id }}
            search={{ filter }}
            data-row-link=""
            aria-current={current ? 'page' : undefined}
            className={cn(
              'min-w-0 truncate text-base after:absolute after:inset-0 focus-visible:outline-none',
              unread ? 'font-bold' : 'font-semibold',
            )}
          >
            {name}
          </Link>
          <time dateTime={time} className="ms-auto shrink-0 text-sm text-muted-foreground">
            {formatRelative(time)}
          </time>
        </div>
        <div className="flex items-center gap-2">
          <p
            dir="auto"
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {preview}
          </p>
          {connection.is_muted ? (
            <BellOff
              aria-label={t('chats.muted')}
              className="size-4 shrink-0 text-muted-foreground"
            />
          ) : null}
          {unread ? (
            <span className="min-w-6 shrink-0 rounded-full bg-primary px-1.5 text-center text-sm font-semibold text-primary-foreground">
              <span aria-hidden="true">{badgeCount(connection.unread_count)}</span>
              <span className="sr-only">
                {t('chats.unread', { count: connection.unread_count })}
              </span>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connection.stage !== 'chatting' ? (
            <Badge variant="secondary">{stageName(t, connection.stage)}</Badge>
          ) : null}
          {connection.pending_stage_proposal?.proposed_by === 'them' &&
          connection.status === 'active' ? (
            <Badge variant="warning">{t('chats.waiting_for_you')}</Badge>
          ) : null}
          {filter === 'ended' || connection.status === 'ended' ? (
            <Badge variant="outline">{t('chats.ended')}</Badge>
          ) : null}
        </div>
        {isQuiet(connection) ? (
          <p className="flex items-start gap-1 text-sm text-muted-foreground">
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('chats.quiet')}
          </p>
        ) : null}
      </div>
      {connection.status === 'active' ? <RowMenu connection={connection} name={name} /> : null}
    </article>
  )
}

/** The item menu (a menu button on the web): mute and archive, both optimistic (G7). */
function RowMenu({ connection, name }: { connection: Connection; name: string }) {
  const { t } = useTranslation('chat')
  const patch = usePatchConnection()
  const online = useOnlineStatus()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative z-10 -me-2 shrink-0"
          aria-label={t('chats.menu', { name })}
          disabled={!online}
        >
          <MoreVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => patch.mutate({ id: connection.id, is_muted: !connection.is_muted })}
        >
          {connection.is_muted ? t('chats.unmute') : t('chats.mute')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => patch.mutate({ id: connection.id, is_archived: !connection.is_archived })}
        >
          {connection.is_archived ? t('chats.unarchive') : t('chats.archive')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
