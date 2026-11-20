// APP-INTERESTS (16 section 6.9)
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertTriangle, Clock, Heart, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { Silhouette } from '~/components/common/MemberPhoto'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PageHeader } from '~/components/common/PageHeader'
import { PlainText } from '~/components/common/PlainText'
import { ProfileCard } from '~/components/common/ProfileCard'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Label } from '~/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { isApiError } from '~/lib/api'
import type { Interest, InterestBox, InterestListStatus } from '~/lib/api-types'
import { daysUntil, formatRelative } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { qk, removeFromPages } from '~/lib/query'
import { badgeCount, cn } from '~/lib/utils'
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
const ATTENTION_DAYS = 3

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
    <div className="container-app flex max-w-3xl flex-col gap-3">
      <PageHeader title={t('title')} />
      <Tabs
        value={box}
        onValueChange={(value) => go({ box: value as InterestBox, status: 'pending' })}
      >
        <TabsList aria-label={t('box.label')} className="w-full">
          <TabsTrigger value="received">
            {t('box.received')}
            {pending > 0 ? (
              <span className="min-w-5 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                <span aria-hidden="true">{badgeCount(pending)}</span>
                <span className="sr-only">{t('box.badge', { count: pending })}</span>
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="sent">{t('box.sent')}</TabsTrigger>
        </TabsList>
        <TabsContent value={box} className="flex flex-col gap-3">
          <Tabs
            value={status}
            onValueChange={(value) => go({ box, status: value as InterestListStatus })}
          >
            <TabsList aria-label={t('status.label')} className="w-full">
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
      </Tabs>
    </div>
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
      icon={box === 'received' ? Heart : Send}
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
        'relative rounded-[var(--radius-card)]',
        highlighted && 'ring-2 ring-primary ring-offset-2',
      )}
      data-highlighted={highlighted || undefined}
    >
      {showUnseen ? (
        <span className="absolute top-3 end-3 z-20 flex size-3 rounded-full bg-primary">
          <span className="sr-only">{t('unseen')}</span>
        </span>
      ) : null}
      {profile ? (
        <ProfileCard
          card={{ ...profile, compat: interest.compat_score }}
          size="compact"
          actions={
            <div className="flex w-full flex-col gap-2">
              <InterestDetails interest={interest} box={box} />
              <InterestActions interest={interest} box={box} status={status} />
            </div>
          }
        />
      ) : (
        <article
          className="flex gap-3 rounded-[var(--radius-card)] border border-border bg-muted p-3 text-muted-foreground"
          data-unavailable=""
        >
          <Silhouette
            gender="male"
            label={t('unavailable')}
            width={72}
            height={72}
            className="size-18 shrink-0 rounded-[var(--radius-input)]"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-medium">{t('unavailable')}</p>
            <InterestDetails interest={interest} box={box} />
          </div>
        </article>
      )}
    </div>
  )
}

function InterestDetails({ interest, box }: { interest: Interest; box: InterestBox }) {
  const { t } = useTranslation('interests')
  const days = daysUntil(interest.expires_at)
  const waiting = interest.status === 'pending'
  const soon = waiting && days <= ATTENTION_DAYS
  const label =
    interest.display_status === 'pending'
      ? null
      : t(`display_status.${interest.display_status}`, { defaultValue: '' })

  return (
    <div className="flex flex-col gap-1 text-sm">
      {interest.message ? (
        <PlainText
          text={t('message', { message: interest.message })}
          className="text-base text-foreground"
        />
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <time dateTime={interest.created_at}>
          {t(box === 'received' ? 'received_at' : 'sent_at', {
            time: formatRelative(interest.created_at),
          })}
        </time>
        {waiting ? (
          <span
            className={cn('inline-flex items-center gap-1', soon && 'font-medium text-warning')}
            data-attention={soon || undefined}
          >
            {soon ? (
              <AlertTriangle aria-hidden="true" className="size-4" />
            ) : (
              <Clock aria-hidden="true" className="size-4" />
            )}
            {days === 0 ? t('expires_today') : t('expires_in', { count: days })}
          </span>
        ) : null}
        {label ? <span className="font-medium text-foreground">{label}</span> : null}
      </p>
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
  const [alsoBlock, setAlsoBlock] = useState(false)
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

  const onDecline = async () => {
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
        <Button asChild variant="soft">
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
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAccept} loading={accept.isPending} disabled={!online}>
          {t('actions.accept')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setAlsoBlock(false)
            setDeclineOpen(true)
          }}
          disabled={!online || accept.isPending}
        >
          {t('actions.decline')}
        </Button>
        <ConfirmDialog
          open={declineOpen}
          onOpenChange={setDeclineOpen}
          title={t('decline.title')}
          description={t('decline.text', { name })}
          confirmLabel={t('decline.confirm')}
          destructive
          onConfirm={onDecline}
        >
          <Label className="min-h-11 cursor-pointer gap-3 font-normal text-base">
            <Checkbox
              checked={alsoBlock}
              onCheckedChange={(checked) => setAlsoBlock(checked === true)}
            />
            {t('decline.also_block', { name })}
          </Label>
        </ConfirmDialog>
      </div>
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
        destructive
        onConfirm={onWithdraw}
      />
    </div>
  )
}
