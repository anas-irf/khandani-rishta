// ADM-HOME: queue sizes and headline numbers (18 section 9).
import { Link } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { ErrorState } from '~/components/common/ErrorState'
import { DiamondTitle } from '~/components/common/Ornament'
import { Page } from '~/components/common/Page'
import { RelativeTime } from '~/components/common/RelativeTime'
import { SectionHeading } from '~/components/common/SectionHeading'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/utils'
import { Facts } from './components/Facts'
import { useAdminOverview } from './queries'
import type { AdminOverview } from './types'

/** Hours after which the longest-waiting item turns the card amber (18 section 9). */
const OTHER_QUEUE_TARGET_HOURS = 24
/** The tightest report target (priority 1, 13 section 6.5): the queue holds every priority. */
const REPORT_TARGET_HOURS = 12

const NUMBER = new Intl.NumberFormat('en')

type QueueCard = {
  id: string
  to:
    | '/admin/profiles'
    | '/admin/photos'
    | '/admin/texts'
    | '/admin/verifications'
    | '/admin/reports'
    | '/admin/castes'
  count: number
  /** A second line, such as the flagged photos. */
  detail?: string
  oldest?: string | null
  targetHours: number
}

function queueCards(queues: AdminOverview['queues'], t: TFunction) {
  const cards: QueueCard[] = [
    {
      id: 'profiles',
      to: '/admin/profiles',
      count: queues.profiles_pending,
      oldest: queues.oldest_waiting.profiles,
      targetHours: OTHER_QUEUE_TARGET_HOURS,
    },
    {
      id: 'photos',
      to: '/admin/photos',
      count: queues.photos_pending,
      detail: t('home.photos_flagged', { count: queues.photos_flagged }),
      oldest: queues.oldest_waiting.photos,
      targetHours: OTHER_QUEUE_TARGET_HOURS,
    },
    { id: 'texts', to: '/admin/texts', count: queues.texts_pending, targetHours: 0 },
    {
      id: 'verifications',
      to: '/admin/verifications',
      count: queues.verifications_pending,
      oldest: queues.oldest_waiting.verifications,
      targetHours: OTHER_QUEUE_TARGET_HOURS,
    },
    {
      id: 'reports',
      to: '/admin/reports',
      count: queues.reports_open,
      detail: t('home.reports_in_review', { count: queues.reports_in_review }),
      oldest: queues.oldest_waiting.reports,
      targetHours: REPORT_TARGET_HOURS,
    },
    {
      id: 'caste_suggestions',
      to: '/admin/castes',
      count: queues.caste_suggestions_pending,
      targetHours: 0,
    },
  ]
  return cards
}

function hoursSince(iso: string | null | undefined): number {
  if (!iso) return 0
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

export function OverviewScreen() {
  const { t } = useTranslation('admin')
  const query = useAdminOverview()

  const refresh = (
    <Button
      variant="secondary"
      onClick={() => void query.refetch()}
      disabled={query.isFetching}
      aria-busy={query.isFetching || undefined}
    >
      <RefreshCw aria-hidden="true" className={cn(query.isFetching && 'animate-spin')} />
      {t('actions.refresh')}
    </Button>
  )

  return (
    <Page
      title={t('home.title')}
      layout={query.isSuccess ? 'bands' : 'body'}
      description={
        query.data ? (
          <>
            {t('home.updated')} <RelativeTime value={query.data.generated_at} />
          </>
        ) : undefined
      }
      actions={refresh}
    >
      {query.isPending ? (
        <div
          role="status"
          aria-busy="true"
          className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4"
        >
          <span className="sr-only">{t('list.loading')}</span>
          {Array.from({ length: 6 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Queues overview={query.data} />
          <Metrics metrics={query.data.metrics} />
        </>
      )}
    </Page>
  )
}

function Queues({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation('admin')
  return (
    <Band tone="auto" aria-labelledby="home-queues" innerClassName="flex flex-col gap-4">
      <SectionHeading id="home-queues" title={t('home.queues')} />
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
        {queueCards(overview.queues, t).map((card) => {
          const late = card.targetHours > 0 && hoursSince(card.oldest) > card.targetHours
          return (
            <li key={card.id}>
              <Link
                to={card.to}
                className={cn(
                  'flex h-full flex-col gap-1 rounded-xl border-[1.5px] p-5 text-foreground transition-colors',
                  late
                    ? 'border-warning bg-warning-soft'
                    : 'tonal border-transparent hover:bg-muted-strong',
                )}
              >
                <span className="text-label-md text-muted-foreground">
                  {t(`home.queue.${card.id}`)}
                </span>
                <span className="text-headline-lg tabular-nums">{NUMBER.format(card.count)}</span>
                {card.detail ? <span className="text-body-sm">{card.detail}</span> : null}
                {card.oldest ? (
                  <span className="text-body-sm text-muted-foreground">
                    {t('home.oldest')} <RelativeTime value={card.oldest} />
                  </span>
                ) : null}
                {late ? (
                  <span className="flex items-center gap-1 text-body-sm font-semibold text-warning">
                    <TriangleAlert aria-hidden="true" className="size-4" />
                    {t('home.over_target', { hours: card.targetHours })}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </Band>
  )
}

function Metrics({ metrics }: { metrics: AdminOverview['metrics'] }) {
  const { t } = useTranslation('admin')
  const n = (value: number) => NUMBER.format(value)
  const label = (key: string) => t(`home.metric.${key}`)
  const status = metrics.profiles_by_status
  return (
    <Band tone="auto" aria-labelledby="home-metrics" innerClassName="flex flex-col gap-4">
      <SectionHeading id="home-metrics" title={t('home.metrics')} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-4">
        <Facts
          title={t('home.group.people')}
          columns={2}
          facts={[
            { label: label('users_total'), value: n(metrics.users_total) },
            { label: label('signups_today'), value: n(metrics.signups_today) },
            { label: label('signups_7d'), value: n(metrics.signups_7d) },
            { label: label('active_last_7d'), value: n(metrics.active_last_7d) },
            { label: label('active_male'), value: n(metrics.active_male) },
            { label: label('active_female'), value: n(metrics.active_female) },
            { label: label('active_id_verified'), value: n(metrics.active_id_verified) },
            { label: label('active_photo_verified'), value: n(metrics.active_photo_verified) },
          ]}
        />
        <Facts
          title={t('home.group.profiles')}
          columns={2}
          facts={Object.entries(status).map(([key, value]) => ({
            label: t(`status.${key}`),
            value: n(value),
          }))}
        />
        <Facts
          title={t('home.group.activity')}
          columns={2}
          facts={[
            { label: label('interests_sent_today'), value: n(metrics.interests_sent_today) },
            { label: label('interests_sent_7d'), value: n(metrics.interests_sent_7d) },
            { label: label('interests_accepted_7d'), value: n(metrics.interests_accepted_7d) },
            { label: label('messages_7d'), value: n(metrics.messages_7d) },
            { label: label('connections_active'), value: n(metrics.connections_active) },
            { label: label('connections_created_7d'), value: n(metrics.connections_created_7d) },
          ]}
        />
        <Facts
          title={t('home.group.stages')}
          columns={2}
          facts={Object.entries(metrics.stage_counts).map(([key, value]) => ({
            label: t(`home.stage.${key}`),
            value: n(value),
          }))}
        />
        <Facts
          title={t('home.group.safety')}
          columns={2}
          facts={[
            { label: label('reports_filed_7d'), value: n(metrics.reports_filed_7d) },
            { label: label('users_suspended'), value: n(metrics.users_suspended) },
            { label: label('users_banned'), value: n(metrics.users_banned) },
            { label: label('deletions_scheduled'), value: n(metrics.deletions_scheduled) },
          ]}
        />
        <section
          className={cn(
            'flex flex-col gap-2 rounded-xl border-[1.5px] p-5',
            metrics.jobs_dead > 0 ? 'border-danger bg-danger-soft' : 'tonal border-transparent',
          )}
        >
          <h3 className="text-title-md font-bold">
            <DiamondTitle>{t('home.group.system')}</DiamondTitle>
          </h3>
          <p className="text-body-sm text-muted-foreground">{label('jobs_dead')}</p>
          <p
            className={cn('text-headline-lg tabular-nums', metrics.jobs_dead > 0 && 'text-danger')}
            data-testid="jobs-dead"
          >
            {n(metrics.jobs_dead)}
          </p>
          {metrics.jobs_dead > 0 ? (
            <p
              role="alert"
              className="flex items-center gap-1 text-body-sm font-semibold text-danger"
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              {t('home.jobs_dead_hint')}
            </p>
          ) : null}
        </section>
      </div>
    </Band>
  )
}
