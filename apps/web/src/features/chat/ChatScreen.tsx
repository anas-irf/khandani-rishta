// APP-CHAT (16 section 6.11)
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { MoreVertical } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockDialog } from '~/components/common/BlockDialog'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { NoLongerAvailable } from '~/components/common/NoLongerAvailable'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { BackArrow } from '~/components/common/PageHeader'
import { ReportDialog } from '~/components/common/ReportDialog'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { avatarVariants } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { isApiError } from '~/lib/api'
import type { Connection } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { subscribeConversation, usePresence, useTyping } from '~/lib/realtime'
import { cn } from '~/lib/utils'
import { OtherAvatar } from './ChatsScreen'
import { Composer, ComposerDisabled, composerBlock } from './Composer'
import { type ChatMessage, catchUpMessages, flattenMessages } from './cache'
import { EndConnectionDialog } from './EndConnectionDialog'
import { MessageArea } from './MessageList'
import {
  forgetConnection,
  useChatSender,
  useConnection,
  useDeleteMessage,
  useMessages,
  usePatchConnection,
} from './queries'
import { FirstChatTips, SafetyTipsDialog } from './SafetyTips'
import { ProposalBanner, StageFollowUps } from './stage'
import { otherName, stageName } from './text'

export function ChatScreen({ connectionId }: { connectionId: string }) {
  return (
    <ScreenAccess screen="APP-CHAT">
      <Chat key={connectionId} connectionId={connectionId} />
    </ScreenAccess>
  )
}

function Chat({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation('chat')
  const queryClient = useQueryClient()
  const connection = useConnection(connectionId)
  const messages = useMessages(connectionId)

  // The open conversation is resynchronised after a reconnect and polled while the socket is
  // down (17 section 7.1); returning to it catches up from the newest message held.
  useEffect(() => subscribeConversation(connectionId), [connectionId])
  useEffect(() => {
    if (queryClient.getQueryData(qk.messages(connectionId))) {
      void catchUpMessages(queryClient, connectionId).catch(() => undefined)
    }
  }, [connectionId, queryClient])

  const notFound = isApiError(connection.error) && connection.error.code === 'not_found'
  useEffect(() => {
    if (notFound) forgetConnection(queryClient, connectionId)
  }, [notFound, queryClient, connectionId])

  if (connection.isPending) return <ChatSkeleton />
  if (notFound || !connection.data) {
    return (
      <Page title={t('chats.title')} backTo="/chats" width="column">
        {notFound ? (
          <NoLongerAvailable />
        ) : (
          <ErrorState
            error={connection.error}
            onRetry={() => void connection.refetch()}
            retrying={connection.isFetching}
          />
        )}
      </Page>
    )
  }
  return <Conversation connection={connection.data} messages={messages} />
}

function ChatSkeleton() {
  const { t } = useTranslation('shared')
  return (
    <div
      role="status"
      aria-busy="true"
      data-conversation=""
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <span className="sr-only">{t('list.loading')}</span>
      <div className="flex min-h-[64px] items-center gap-3 border-b border-border px-[16px] py-[8px] wide:min-h-[80px]">
        <div className={cn(avatarVariants({ size: 'xs' }), 'skeleton rounded-arch')} />
        <div className="skeleton h-5 w-[min(100%,10rem)]" />
      </div>
      <BubblesSkeleton />
    </div>
  )
}

function BubblesSkeleton() {
  const { t } = useTranslation('shared')
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
    >
      <span className="sr-only">{t('list.loading')}</span>
      {['w-2/3', 'w-1/2 self-end', 'w-3/5', 'w-2/5 self-end', 'w-1/2'].map((width) => (
        <div key={width} className={cn('skeleton h-12 shrink-0 rounded-row', width)} />
      ))}
    </div>
  )
}

type MessagesResult = ReturnType<typeof useMessages>

function Conversation({
  connection,
  messages,
}: {
  connection: Connection
  messages: MessagesResult
}) {
  const { t } = useTranslation(['chat', 'common'])
  const me = useCurrentMe()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const sender = useChatSender(connection.id)
  const remove = useDeleteMessage(connection.id)
  const [draft, setDraft] = useState('')
  const [removeTarget, setRemoveTarget] = useState<ChatMessage | null>(null)
  const [report, setReport] = useState<{ messageId?: string; reason?: string } | null>(null)
  const [blockOpen, setBlockOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [tipsOpen, setTipsOpen] = useState(false)

  const name = otherName(t, connection)
  const canEngage = me.profile.status === 'active' || me.profile.status === 'paused'
  const block = composerBlock({
    ended: connection.status === 'ended',
    otherMissing: connection.other === null,
    ownClosed: me.profile.status === 'closed',
    online,
  })
  const items = useMemo(() => flattenMessages(messages.data), [messages.data])
  const noTextYet = messages.data !== undefined && !items.some((item) => item.kind === 'text')
  const backToList = () => void navigate({ to: '/chats' })

  const starters =
    noTextYet && !block ? (
      <div className="flex flex-col items-center gap-2 py-3">
        <p className="text-caption text-muted-foreground">{t('chat:chat.start_label')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {(['chip_salaam', 'chip_family'] as const).map((key) => (
            <Button
              key={key}
              variant="quiet"
              className="rounded-lg text-start"
              onClick={() => setDraft(t(`chat:chat.${key}`))}
            >
              {t(`chat:chat.${key}`)}
            </Button>
          ))}
        </div>
      </div>
    ) : null

  return (
    <div data-conversation="" className="flex min-h-0 flex-1 flex-col">
      <ChatHeader
        connection={connection}
        name={name}
        onTips={() => setTipsOpen(true)}
        onReport={() => setReport({})}
        onBlock={() => setBlockOpen(true)}
        onEnd={() => setEndOpen(true)}
      />
      <ProposalBanner connection={connection} />
      {messages.isPending ? (
        <BubblesSkeleton />
      ) : !messages.data ? (
        <div className="flex-1 p-4">
          <ErrorState
            error={messages.error}
            onRetry={() => void messages.refetch()}
            retrying={messages.isFetching}
          />
        </div>
      ) : (
        <MessageArea
          connection={connection}
          query={messages}
          ownProfileId={me.profile.id}
          canRemove={connection.status === 'active' && canEngage}
          actions={{
            retry: sender.retry,
            discard: sender.discard,
            remove: setRemoveTarget,
            report: (message, reason) => setReport({ messageId: message.id, reason }),
          }}
          top={<FirstChatTips profileId={me.profile.id} connectionId={connection.id} />}
          bottom={starters}
        />
      )}
      {block ? (
        <ComposerDisabled reason={block} />
      ) : (
        <Composer
          connectionId={connection.id}
          value={draft}
          onChange={setDraft}
          onSend={sender.send}
          limitReached={sender.dailyLimitReached}
        />
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={t('chat:message.remove_title')}
        description={null}
        confirmLabel={t('chat:message.remove_confirm')}
        tone="danger"
        onConfirm={async () => {
          if (!removeTarget) return
          try {
            await remove.mutateAsync(removeTarget.id)
          } catch {
            // `invalid_state` has its own toast; other errors the global one.
          }
        }}
      />
      {connection.other ? (
        <>
          <ReportDialog
            open={report !== null}
            onOpenChange={(open) => {
              if (!open) setReport(null)
            }}
            profileId={connection.other.id}
            name={name}
            subject={
              report?.messageId ? { type: 'message', messageId: report.messageId } : undefined
            }
            defaultReason={report?.reason}
            onBlocked={backToList}
          />
          <BlockDialog
            open={blockOpen}
            onOpenChange={setBlockOpen}
            profileId={connection.other.id}
            name={name}
            onBlocked={backToList}
          />
        </>
      ) : null}
      <EndConnectionDialog
        connection={connection}
        open={endOpen}
        onOpenChange={setEndOpen}
        onEnded={backToList}
      />
      <SafetyTipsDialog open={tipsOpen} onOpenChange={setTipsOpen} />
      <StageFollowUps connection={connection} />
    </div>
  )
}

function ChatHeader({
  connection,
  name,
  onTips,
  onReport,
  onBlock,
  onEnd,
}: {
  connection: Connection
  name: string
  onTips: () => void
  onReport: () => void
  onBlock: () => void
  onEnd: () => void
}) {
  const { t } = useTranslation(['chat', 'shared'])
  const patch = usePatchConnection()
  const online = useOnlineStatus()
  const typing = useTyping(connection.id)
  const other = connection.other
  const presence = usePresence(other?.id)
  const active = connection.status === 'active'

  let subtitle: string | null = null
  if (typing && active) subtitle = t('chat:chat.typing')
  else if (presence === true || (presence === undefined && other?.last_active === 'online')) {
    subtitle = t('chat:chat.online')
  } else if (other?.last_active) {
    const label = other.last_active === 'online' ? 'today' : other.last_active
    subtitle = t(`shared:card.activity.${label}`, { defaultValue: '' }) || null
  }

  return (
    <header className="flex min-h-[64px] items-center gap-[4px] border-b border-border bg-background px-[8px] py-[8px] wide:min-h-[80px] wide:px-[16px]">
      <Button asChild variant="ghost" size="icon" className="wide:hidden">
        <Link to="/chats" aria-label={t('shared:header.back')}>
          <BackArrow />
        </Link>
      </Button>
      <h1 className="sr-only">{name}</h1>
      {/* The link is the name, stretched over the block: stage and activity stay their own text. */}
      <div className="relative flex min-h-touch min-w-0 flex-1 items-center gap-[12px] rounded-row px-[4px] py-1 text-foreground transition-colors hover:tonal">
        <span aria-hidden="true" className="contents">
          <OtherAvatar connection={connection} size="xs" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to="/chats/$connectionId/details"
              params={{ connectionId: connection.id }}
              aria-label={t('chat:chat.open_details', { name })}
              className="stretched-link flex max-w-full min-w-0 text-foreground after:z-[1] after:rounded-row"
            >
              {/* The phone top bar is the one place a name is cut (DESIGN.md 6.16). */}
              <span
                className="max-w-full min-w-0 text-title-md font-bold max-wide:truncate"
                aria-hidden="true"
              >
                {name}
              </span>
            </Link>
            {connection.stage !== 'chatting' ? (
              <Badge variant="success">{stageName(t, connection.stage)}</Badge>
            ) : null}
          </span>
          {subtitle ? (
            <span
              className="text-caption text-muted-foreground"
              aria-live="polite"
              data-subtitle=""
            >
              {subtitle}
            </span>
          ) : null}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('chat:chat.menu')} className="shrink-0">
            <MoreVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {other ? (
            <DropdownMenuItem asChild>
              <Link to="/profiles/$profileId" params={{ profileId: other.id }}>
                {t('chat:chat.view_profile')}
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link to="/chats/$connectionId/details" params={{ connectionId: connection.id }}>
              {t('chat:chat.details')}
            </Link>
          </DropdownMenuItem>
          {active ? (
            <>
              <DropdownMenuItem
                disabled={!online}
                onSelect={() => patch.mutate({ id: connection.id, is_muted: !connection.is_muted })}
              >
                {connection.is_muted ? t('chat:chat.unmute') : t('chat:chat.mute')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!online}
                onSelect={() =>
                  patch.mutate({ id: connection.id, is_archived: !connection.is_archived })
                }
              >
                {connection.is_archived ? t('chat:chat.unarchive') : t('chat:chat.archive')}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem onSelect={onTips}>{t('chat:chat.safety_tips')}</DropdownMenuItem>
          {other || active ? <DropdownMenuSeparator /> : null}
          {other ? (
            <>
              <DropdownMenuItem onSelect={onReport}>{t('chat:chat.report')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onBlock}>{t('chat:chat.block')}</DropdownMenuItem>
            </>
          ) : null}
          {active ? (
            <DropdownMenuItem variant="destructive" onSelect={onEnd}>
              {t('chat:chat.end')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
