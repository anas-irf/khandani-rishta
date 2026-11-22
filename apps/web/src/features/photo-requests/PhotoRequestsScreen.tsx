// APP-PHOTO-REQUESTS (16 section 6.16)
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Clock, ImageOff, Images, UserRoundCheck } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { CountBadge } from '~/components/common/CountBadge'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { ProfileCard } from '~/components/common/ProfileCard'
import { RowAnswers, RowMeta } from '~/components/common/RowParts'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { UnavailableRow } from '~/components/common/UnavailableRow'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import type { PhotoAccessEntry } from '~/lib/api-types'
import { formatRelative } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import {
  type PhotoAccessBox,
  useDenyPhotoAccess,
  useGrantPhotoAccess,
  usePhotoAccess,
  useRevokePhotoAccess,
  useSentPhotoAccess,
} from './queries'

type ReceivedFilter = 'waiting' | 'approved'

export function PhotoRequestsScreen() {
  return (
    <ScreenAccess screen="APP-PHOTO-REQUESTS">
      <PhotoRequestsContent />
    </ScreenAccess>
  )
}

function PhotoRequestsContent() {
  const { t } = useTranslation('photo_requests')
  const me = useCurrentMe()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { box?: string }
  const box: PhotoAccessBox = search.box === 'sent' ? 'sent' : 'received'

  return (
    <Tabs
      value={box}
      onValueChange={(next) =>
        void navigate({
          to: '/photo-requests',
          search: { box: next === 'sent' ? 'sent' : 'received' },
          replace: true,
        })
      }
      className="min-w-0 flex-1 gap-0"
    >
      <Page
        title={t('title')}
        width="column"
        header={
          <TabsList aria-label={t('tabs.label')}>
            <TabsTrigger value="received">
              {t('tabs.received')}
              <CountBadge count={me.counters.pending_photo_requests} />
            </TabsTrigger>
            <TabsTrigger value="sent">{t('tabs.sent')}</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="received">
          <ReceivedList />
        </TabsContent>
        <TabsContent value="sent">
          <SentList />
        </TabsContent>
      </Page>
    </Tabs>
  )
}

function ReceivedList() {
  const { t } = useTranslation('photo_requests')
  const [filter, setFilter] = useState<ReceivedFilter>('waiting')
  const waiting = filter === 'waiting'
  const query = usePhotoAccess('received', waiting ? 'pending' : 'granted')

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(next) => {
          if (next === 'waiting' || next === 'approved') setFilter(next)
        }}
        aria-label={t('filter.label')}
      >
        <ToggleGroupItem value="waiting">{t('filter.waiting')}</ToggleGroupItem>
        <ToggleGroupItem value="approved">{t('filter.approved')}</ToggleGroupItem>
      </ToggleGroup>
      <InfiniteList
        query={query}
        label={t('list.received')}
        getKey={(entry) => entry.id}
        renderItem={(entry) => <RequestItem entry={entry} box="received" />}
        empty={
          waiting ? (
            <EmptyState icon={Images} title={t('empty.received_waiting')} />
          ) : (
            <EmptyState icon={UserRoundCheck} title={t('empty.received_approved')} />
          )
        }
      />
    </div>
  )
}

function SentList() {
  const { t } = useTranslation('photo_requests')
  const query = useSentPhotoAccess()
  return (
    <InfiniteList
      query={query}
      label={t('list.sent')}
      getKey={(entry) => entry.id}
      renderItem={(entry) => <RequestItem entry={entry} box="sent" />}
      empty={<EmptyState icon={ImageOff} title={t('empty.sent')} />}
    />
  )
}

/** One request: the compact card of the other member, when it was asked, and its actions. */
function RequestItem({ entry, box }: { entry: PhotoAccessEntry; box: PhotoAccessBox }) {
  const { t } = useTranslation('photo_requests')
  const online = useOnlineStatus()
  const grant = useGrantPhotoAccess()
  const deny = useDenyPhotoAccess()
  const revoke = useRevokePhotoAccess()
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)

  const name = entry.profile?.display_name ?? t('member_fallback')
  const answering = grant.isPending || deny.isPending

  let buttons: ReactNode = null
  if (box === 'received' && entry.status === 'pending') {
    buttons = (
      <RowAnswers>
        <Button
          variant="secondary"
          fill="side"
          loading={deny.isPending}
          disabled={!online || grant.isPending}
          onClick={() => deny.mutate({ entry, name })}
        >
          {t('deny')}
        </Button>
        <Button
          fill="main"
          loading={grant.isPending}
          disabled={!online || deny.isPending}
          onClick={() => grant.mutate({ entry, name })}
        >
          {t('approve')}
        </Button>
      </RowAnswers>
    )
  } else if (box === 'received' && entry.status === 'granted') {
    buttons = (
      <Button
        variant="secondary"
        size="compact"
        disabled={!online || answering}
        onClick={() => setConfirmingRevoke(true)}
      >
        {t('remove_access')}
      </Button>
    )
  }

  const granted = entry.status === 'granted'
  const StatusIcon = granted ? UserRoundCheck : Clock
  const actions = (
    <div className="flex w-full flex-col items-start gap-3">
      <RowMeta>
        <time dateTime={entry.created_at} className="text-caption text-muted-foreground">
          {t('asked', { when: formatRelative(entry.created_at) })}
        </time>
        {box === 'sent' ? (
          <Badge variant={granted ? 'success' : 'outline'}>
            <StatusIcon aria-hidden="true" />
            {statusLabel(entry.status, t)}
          </Badge>
        ) : null}
      </RowMeta>
      {buttons}
    </div>
  )

  return (
    <>
      {entry.profile ? (
        <ProfileCard card={entry.profile} size="compact" actions={actions} headingLevel="h3" />
      ) : (
        <UnavailableRow data-photo-request-unavailable="" text={t('unavailable')}>
          {actions}
        </UnavailableRow>
      )}
      <ConfirmDialog
        open={confirmingRevoke}
        onOpenChange={setConfirmingRevoke}
        title={t('revoke.title')}
        description={t('revoke.text', { name })}
        confirmLabel={t('remove_access')}
        tone="ink"
        onConfirm={() => revoke.mutateAsync(entry)}
      />
    </>
  )
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === 'granted') return t('status.granted')
  if (status === 'pending') return t('status.pending')
  return status.replaceAll('_', ' ')
}
