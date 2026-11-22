// APP-INTERESTS (16 section 6.9)
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { CircleMinus, Clock, Mail, Send, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { CountBadge } from '~/components/common/CountBadge'
import { DeclineDialog } from '~/components/common/DeclineDialog'
import { EmptyState } from '~/components/common/EmptyState'
import { ExpiryNote } from '~/components/common/ExpiryNote'
import { InfiniteList } from '~/components/common/InfiniteList'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { ProfileCard } from '~/components/common/ProfileCard'
import { QuoteBlock } from '~/components/common/QuoteBlock'
import { RowAnswers, RowMeta } from '~/components/common/RowParts'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { UnavailableRow } from '~/components/common/UnavailableRow'
import { UnreadDot } from '~/components/common/UnreadDot'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { isApiError } from '~/lib/api'
import type { Interest, InterestBox, InterestListStatus } from '~/lib/api-types'
import { daysUntil, formatRelative } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { qk, removeFromPages } from '~/lib/query'
import { cn } from '~/lib/utils'
import {
  useAcceptInterest,
  useDeclineInterest,
  useInterests,
  useMarkInterestsSeen,
  useWithdrawInterest,
} from './queries'
import { interestsSearchSchema } from './search'

const STATUSES: readonly InterestListStatus[] = ['pending', 'accepted', 'closed']
const SEEN_DELAY_MS = 1000

export function InterestsScreen() {
  return (
    <ScreenAccess screen="APP-INTERESTS">
      <InterestsContent />
    </ScreenAccess>
  )
}

function InterestsContent() {
  const { t } = useTranslation('interests')
  const me = useCurrentMe()
  const navigate = useNavigate()
  const search = interestsSearchSchema.parse(useSearch({ strict: false }))
  const { box, status } = search

  const go = (next: { box: InterestBox; status: InterestListStatus }) =>
    void navigate({ to: '/interests', search: next, replace: true })

  const pending = me.counters.pending_interests

  return (
    <Tabs
      value={box}
      onValueChange={(value) => go({ box: value as InterestBox, status: 'pending' })}
      className="min-w-0 flex-1 gap-0"
    >
      <Page
        title={t('title')}
        width="column"
        header={
          <TabsList aria-label={t('box.label')}>
            <TabsTrigger value="received">
              {t('box.received')}
              <CountBadge count={pending} label={t('box.badge', { count: pending })} />
            </TabsTrigger>
            <TabsTrigger value="sent">{t('box.sent')}</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value={box}>
          <Tabs
            value={status}
            onValueChange={(value) => go({ box, status: value as InterestListStatus })}
          >
            <TabsList variant="chip" aria-label={t('status.label')}>
              {STATUSES.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(`status.${box}.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={status}>
              <InterestList box={box} status={status} highlightId={search.interest_id} />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Page>
    </Tabs>
  )
}

function InterestList({
  box,
  status,
  highlightId,
}: {
  box: InterestBox
  status: InterestListStatus
  highlightId?: string
}) {
  const { t } = useTranslation('interests')
  const query = useInterests(box, status)
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  useMarkSeen(box, status, items)

  // Scroll to and highlight the row named by `interest_id` (17 section 3.3).
  const scrolled = useRef<string | null>(null)
  const highlightLoaded = Boolean(highlightId && items.some((item) => item.id === highlightId))
  useEffect(() => {
    if (!highlightId || !highlightLoaded || scrolled.current === highlightId) return
    scrolled.current = highlightId
    document.getElementById(`interest-${highlightId}`)?.scrollIntoView?.({ block: 'center' })
  }, [highlightId, highlightLoaded])

  return (
    <InfiniteList
      query={query}
      getKey={(interest) => interest.id}
      label={t('list_label', { box: t(`box.${box}`), status: t(`status.${box}.${status}`) })}
      empty={<InterestsEmpty box={box} status={status} />}
      renderItem={(interest) => (
        <InterestItem
          interest={interest}
          box={box}
          status={status}
          highlighted={interest.id === highlightId}
        />
      )}
    />
  )
}

/**
 * `POST /v1/interests/seen` with the unseen received items shown, once per id, after one
 * second on screen (16 section 6.9).
 */
function useMarkSeen(box: InterestBox, status: InterestListStatus, items: Interest[]) {
  const markSeen = useMarkInterestsSeen()
  const sent = useRef(new Set<string>())
  const active = box === 'received' && status === 'pending'
  const unseen = active
    ? items.filter((item) => !item.seen && !sent.current.has(item.id)).map((item) => item.id)
    : []
  const key = unseen.join(',')
  const { mutate } = markSeen

  useEffect(() => {
    if (!key) return
    const ids = key.split(',')
    const timer = setTimeout(() => {
      if (document.visibilityState === 'hidden') return
      for (const id of ids) sent.current.add(id)
      mutate(ids)
    }, SEEN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, mutate])
}

function InterestsEmpty({ box, status }: { box: InterestBox; status: InterestListStatus }) {
  const { t } = useTranslation('interests')
  const base = `empty.${box}.${status}`
  let action = null
  if (box === 'received' && status === 'pending') {
    action = (
      <Button asChild>
        <Link to="/me">{t(`${base}.action`)}</Link>
      </Button>
    )
  } else if (box === 'sent' && status === 'pending') {
    action = (
      <Button asChild>
        <Link to="/matches">{t(`${base}.action`)}</Link>
      </Button>
    )
  }
  return (
    <EmptyState
      icon={box === 'received' ? Mail : Send}
      title={t(`${base}.title`)}
      text={status === 'pending' ? t(`${base}.text`) : undefined}
      action={action}
    />
  )
}

function InterestItem({
  interest,
  box,
  status,
  highlighted,
}: {
  interest: Interest
  box: InterestBox
  status: InterestListStatus
  highlighted: boolean
}) {
  const { t } = useTranslation('interests')
  const profile = interest.profile
  const showUnseen = interest.direction === 'received' && !interest.seen

  return (
    <div
      id={`interest-${interest.id}`}
      className={cn(
        'relative',
        // The row a notification named (17 section 3.3), on its own fill.
        highlighted &&
          '-mx-[12px] rounded-lg bg-primary-soft px-[12px] [--tonal:var(--color-background)]',
      )}
      data-highlighted={highlighted || undefined}
    >
      {showUnseen ? (
        <UnreadDot
          label={t('unseen')}
          className={cn('absolute top-3 z-20', highlighted ? 'start-[12px]' : 'start-0')}
        />
      ) : null}
      {profile ? (
        <ProfileCard
          card={{ ...profile, compat: interest.compat_score }}
          size="compact"
          actions={
            <div className="flex w-full flex-col gap-3">
              <InterestDetails interest={interest} box={box} />
              <InterestActions interest={interest} box={box} status={status} />
            </div>
          }
        />
      ) : (
        <UnavailableRow data-unavailable="" text={t('unavailable')}>
          <InterestDetails interest={interest} box={box} />
        </UnavailableRow>
      )}
    </div>
  )
}

const STATUS_LOOK = {
  accepted: { icon: UsersRound, variant: 'success' },
  no_response: { icon: Clock, variant: 'outline' },
} as const

function InterestDetails({ interest, box }: { interest: Interest; box: InterestBox }) {
  const { t } = useTranslation('interests')
  const days = daysUntil(interest.expires_at)
  const label =
    interest.display_status === 'pending'
      ? null
      : t(`display_status.${interest.display_status}`, { defaultValue: '' })
  const { icon: StatusIcon, variant } = STATUS_LOOK[
    interest.display_status as keyof typeof STATUS_LOOK
  ] ?? { icon: CircleMinus, variant: 'outline' }

  return (
    <div className="flex max-w-full flex-col items-start gap-2">
      {interest.message ? (
        <QuoteBlock text={t('message', { message: interest.message })} className="max-w-full" />
      ) : null}
      <RowMeta>
        <time dateTime={interest.created_at} className="text-caption text-muted-foreground">
          {t(box === 'received' ? 'received_at' : 'sent_at', {
            time: formatRelative(interest.created_at),
          })}
        </time>
        {interest.status === 'pending' ? (
          <ExpiryNote
            expiresAt={interest.expires_at}
            text={days === 0 ? t('expires_today') : t('expires_in', { count: days })}
          />
        ) : null}
        {label ? (
          <Badge variant={variant}>
            <StatusIcon aria-hidden="true" />
            {label}
          </Badge>
        ) : null}
      </RowMeta>
    </div>
  )
}

function InterestActions({
  interest,
  box,
  status,
}: {
  interest: Interest
  box: InterestBox
  status: InterestListStatus
}) {
  const { t } = useTranslation('interests')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const accept = useAcceptInterest({ handles: ['invalid_state', 'not_found'] })
  const decline = useDeclineInterest({ handles: ['invalid_state', 'not_found'] })
  const withdraw = useWithdrawInterest({ handles: ['invalid_state', 'not_found'] })
  const [declineOpen, setDeclineOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const profile = interest.profile
  if (!profile) return null

  const name = profile.display_name
  const listKey = qk.interests(box, status)
  const refetch = () => void queryClient.invalidateQueries({ queryKey: qk.interestsAll() })
  const leaveList = () =>
    removeFromPages<Interest>(queryClient, listKey, (item) => item.id === interest.id)
  const isStale = (error: unknown) =>
    isApiError(error) && (error.code === 'invalid_state' || error.code === 'not_found')

  const onAccept = () =>
    accept.mutate(
      { id: interest.id, profileId: profile.id },
      {
        onSuccess: (result) => {
          leaveList()
          toast.success(t('accept.success'))
          void navigate({
            to: '/chats/$connectionId',
            params: { connectionId: result.connection.id },
          })
        },
        onError: (error) => {
          if (isStale(error)) refetch()
        },
      },
    )

  const onDecline = async (alsoBlock: boolean) => {
    try {
      await decline.mutateAsync({ id: interest.id, profileId: profile.id, alsoBlock })
    } catch (error) {
      if (isStale(error)) {
        refetch()
        return
      }
      throw error
    }
    leaveList()
    toast.success(t('decline.success'))
  }

  const onWithdraw = async () => {
    try {
      await withdraw.mutateAsync({ id: interest.id, profileId: profile.id })
    } catch (error) {
      if (isStale(error)) {
        refetch()
        return
      }
      throw error
    }
    leaveList()
    toast.success(t('withdraw.success'))
  }

  if (interest.status === 'accepted' && interest.connection_id) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link to="/chats/$connectionId" params={{ connectionId: interest.connection_id }}>
            {t('actions.open_chat')}
          </Link>
        </Button>
      </div>
    )
  }
  if (interest.status !== 'pending') return null

  if (interest.direction === 'received') {
    return (
      <RowAnswers>
        <Button
          variant="secondary"
          fill="side"
          onClick={() => setDeclineOpen(true)}
          disabled={!online || accept.isPending}
        >
          {t('actions.decline')}
        </Button>
        <Button fill="main" onClick={onAccept} loading={accept.isPending} disabled={!online}>
          {t('actions.accept')}
        </Button>
        <DeclineDialog
          open={declineOpen}
          onOpenChange={setDeclineOpen}
          name={name}
          namespace="interests"
          onDecline={onDecline}
        />
      </RowAnswers>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setWithdrawOpen(true)} disabled={!online}>
        {t('actions.withdraw')}
      </Button>
      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title={t('withdraw.title')}
        description={t('withdraw.text')}
        confirmLabel={t('withdraw.confirm')}
        tone="ink"
        onConfirm={onWithdraw}
      />
    </div>
  )
}
