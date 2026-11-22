// APP-CHATS (16 section 6.10)
import { Link, Outlet, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  BellOff,
  CircleAlert,
  CircleMinus,
  Clock,
  MessagesSquare,
  MoreVertical,
  UsersRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { CountBadge } from '~/components/common/CountBadge'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { MemberAvatar } from '~/components/common/MemberAvatar'
import { UnavailablePhoto } from '~/components/common/MemberPhoto'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PageHeader } from '~/components/common/PageHeader'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { avatarVariants } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { Connection, Gender } from '~/lib/api-types'
import { formatRelative } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { cn } from '~/lib/utils'
import { type ConnectionFilter, useConnections, usePatchConnection } from './queries'
import { chatsSearchSchema } from './search'
import { hasNoTextMessages, isQuiet, otherName, stageName } from './text'

const FILTERS: readonly ConnectionFilter[] = ['active', 'archived', 'ended']

function useFilter(): ConnectionFilter {
  return chatsSearchSchema.parse(useSearch({ strict: false })).filter
}

/**
 * The `/chats` layout (17 section 9.1): on wide screens the chat list stays beside the open
 * conversation (two panes that scroll on their own); on narrow screens the list and the
 * conversation are separate screens, so the side pane is hidden. The shell gives Chats the
 * height of the window, so the panes only fill what is left.
 */
export function ChatsLayout() {
  const { t } = useTranslation('chat')
  const { connectionId } = useParams({ strict: false }) as { connectionId?: string }
  return (
    <ScreenAccess screen="APP-CHATS">
      <div className="flex min-w-0 flex-1 flex-col has-[[data-conversation]]:min-h-0 wide:mx-auto wide:grid wide:min-h-0 wide:w-full wide:max-w-[calc(var(--container-content)+2*var(--spacing-gutter))] wide:grid-cols-[clamp(280px,34vw,400px)_minmax(0,1fr)] wide:grid-rows-[minmax(0,1fr)] wide:border-x wide:border-border">
        <aside
          aria-label={t('chats.list_label')}
          data-fills-window=""
          // A pane is narrow, so it keeps the gutters of a phone.
          className="hidden min-h-0 overflow-y-auto border-e border-border [--spacing-gutter:20px] wide:flex wide:flex-col"
        >
          <ChatList titleAs={connectionId ? 'h2' : 'h1'} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col has-[[data-conversation]]:min-h-0 wide:min-h-0 wide:overflow-y-auto">
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
      <div className="flex flex-1 flex-col wide:hidden">
        <ChatsScreen />
      </div>
      <div className="hidden flex-1 items-center justify-center p-[clamp(20px,3vw,40px)] wide:flex">
        <EmptyState icon={MessagesSquare} title={t('chats.select')} className="max-w-form" />
      </div>
    </>
  )
}

/** The chat list as a screen of its own. */
export function ChatsScreen() {
  return (
    <ScreenAccess screen="APP-CHATS">
      <ChatList />
    </ScreenAccess>
  )
}

function ChatList({ titleAs }: { titleAs?: 'h1' | 'h2' }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const filter = useFilter()
  const query = useConnections(filter)

  return (
    <Tabs
      value={filter}
      onValueChange={(value) =>
        void navigate({ to: '/chats', search: { filter: value as ConnectionFilter } })
      }
      className="min-w-0 flex-[1_0_auto] gap-0"
    >
      <PageHeader title={t('chats.title')} titleAs={titleAs} width="column">
        <TabsList variant="chip" aria-label={t('chats.filter.label')}>
          {FILTERS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`chats.filter.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </PageHeader>
      <TabsContent value={filter} className="rounded-none">
        <Band as="div" width="column" space="sm">
          <InfiniteList
            query={query}
            getKey={(connection) => connection.id}
            label={t('chats.list_label')}
            listClassName="-mx-[12px] flex flex-col"
            empty={<ChatsEmpty filter={filter} />}
            renderItem={(connection) => <ChatRow connection={connection} filter={filter} />}
          />
        </Band>
      </TabsContent>
    </Tabs>
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

/** The other member's arch, or the silhouette when they are no longer available. */
export function OtherAvatar({
  connection,
  size,
}: {
  connection: Connection
  size: 'xs' | 'md' | 'lg'
}) {
  const { t } = useTranslation('chat')
  const me = useCurrentMe()
  const other = connection.other
  if (other) {
    return (
      <MemberAvatar
        photo={other.photo}
        name={other.display_name}
        gender={other.gender}
        size={size}
      />
    )
  }
  return (
    <UnavailablePhoto
      gender={otherGender(me.profile.gender)}
      label={otherName(t, connection)}
      className={avatarVariants({ size })}
    />
  )
}

function ChatRow({ connection, filter }: { connection: Connection; filter: ConnectionFilter }) {
  const { t } = useTranslation(['chat', 'shared'])
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
        'relative flex flex-wrap items-start gap-x-[12px] gap-y-1 rounded-row px-[12px] py-3 transition-colors',
        current ? 'bg-primary-soft [--tonal:var(--color-background)]' : 'hover:tonal',
      )}
      data-connection-row={connection.id}
    >
      <OtherAvatar connection={connection} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <Link
            to="/chats/$connectionId"
            params={{ connectionId: connection.id }}
            search={{ filter }}
            data-row-link=""
            aria-current={current ? 'page' : undefined}
            className={cn(
              'stretched-link max-w-full min-w-0 text-title-md text-foreground after:rounded-row',
              unread && 'font-bold',
            )}
          >
            {name}
          </Link>
          <time dateTime={time} className="text-caption text-muted-foreground tabular-nums">
            {formatRelative(time)}
          </time>
        </div>
        <div className="flex items-center gap-2">
          {/* One line by 16 section 6.10: the whole message is one tap away. */}
          <p
            dir="auto"
            data-preview=""
            className={cn(
              'min-w-0 flex-1 truncate text-body-sm',
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
          <CountBadge
            count={connection.unread_count}
            label={t('chats.unread', { count: connection.unread_count })}
            tone="inverse"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 empty:hidden">
          {connection.stage !== 'chatting' ? (
            <Badge variant="success">
              <UsersRound aria-hidden="true" />
              {stageName(t, connection.stage)}
            </Badge>
          ) : null}
          {connection.pending_stage_proposal?.proposed_by === 'them' &&
          connection.status === 'active' ? (
            <Badge variant="warning">
              <CircleAlert aria-hidden="true" />
              {t('chats.waiting_for_you')}
            </Badge>
          ) : null}
          {filter === 'ended' || connection.status === 'ended' ? (
            <Badge variant="outline">
              <CircleMinus aria-hidden="true" />
              {t('chats.ended')}
            </Badge>
          ) : null}
        </div>
      </div>
      {isQuiet(connection) ? (
        // Under the whole row: at 200% text its words do not fit between the photo and the menu.
        <p className="order-last flex basis-full items-start gap-2 text-caption text-muted-foreground">
          <span aria-hidden="true" className="flex h-[1lh] items-center">
            <Clock className="size-4" />
          </span>
          <span className="min-w-0">{t('chats.quiet')}</span>
        </p>
      ) : null}
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
          className="relative z-10 -me-[8px] shrink-0"
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
