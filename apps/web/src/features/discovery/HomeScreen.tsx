// APP-HOME (16 section 6.4)
import { useQueryClient } from '@tanstack/react-query'
import { Link, linkOptions, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Heart, ShieldCheck, Sparkles, X } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnnouncementContent } from '~/components/common/AnnouncementBanner'
import { CardSkeleton } from '~/components/common/CardSkeleton'
import { ErrorState } from '~/components/common/ErrorState'
import { MemberPhoto } from '~/components/common/MemberPhoto'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { BrandLink } from '~/components/layout/BrandLink'
import { NotificationBell } from '~/components/layout/NotificationBell'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { http } from '~/lib/api'
import type { Home, NudgeCode, OwnProfile, ProfileCard } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { cn } from '~/lib/utils'
import { DiscoveryCard } from './components/DiscoveryCard'
import { ExhaustedNotice } from './components/ExhaustedNotice'
import { MatchesEmpty } from './components/MatchesEmpty'
import { textKey, useDeviceFlag } from './components/useDeviceFlag'
import { useHome } from './queries'
import { encodeSearchQuery } from './search-params'

export function HomeScreen() {
  return (
    <div className="container-app flex flex-col gap-5 pt-2">
      <HomeTopBar />
      <ScreenAccess screen="APP-HOME">
        <HomeContent />
      </ScreenAccess>
    </div>
  )
}

/** Narrow screens: the app name and the bell, on this screen only (16 section 2.2). */
function HomeTopBar() {
  return (
    <div className="flex items-center justify-between md:hidden">
      <BrandLink />
      <NotificationBell />
    </div>
  )
}

function HomeContent() {
  const { t } = useTranslation('discovery')
  const me = useCurrentMe()
  const home = useHome()
  const name = me.profile.first_name
  const managed = me.profile.managed_by !== null && me.profile.managed_by !== 'self'

  let greeting = t('home.greeting_plain')
  if (name) greeting = managed ? t('home.greeting_managed', { name }) : t('home.greeting', { name })

  return (
    <div className="flex flex-col gap-6">
      <HomeAnnouncement />
      <h1 className="text-2xl font-semibold leading-snug">{greeting}</h1>
      <FirstRunTip profileId={me.profile.id} />
      {home.data ? (
        <HomeBody home={home.data} refetch={home.refetch} />
      ) : home.isError ? (
        <ErrorState
          error={home.error}
          onRetry={() => void home.refetch()}
          retrying={home.isFetching}
        />
      ) : (
        <HomeSkeleton />
      )}
      <SafetyLine />
    </div>
  )
}

function HomeAnnouncement() {
  const { t } = useTranslation('discovery')
  const me = useCurrentMe()
  const announcement = me.config.announcement
  const key = announcement ? `kr.announcement.dismissed.${textKey(announcement.text_en)}` : null
  const [dismissed, dismiss] = useDeviceFlag(key)
  if (!announcement || dismissed) return null
  return (
    <div className="relative">
      <AnnouncementContent announcement={announcement} className="pe-12" />
      <Button
        variant="ghost"
        size="icon"
        className="absolute end-0 top-0"
        aria-label={t('home.announcement_close')}
        onClick={dismiss}
      >
        <X aria-hidden="true" className="size-5" />
      </Button>
    </div>
  )
}

/** The one-time tip of 07 section 15.2; the dismissal is stored on the device only. */
function FirstRunTip({ profileId }: { profileId: string }) {
  const { t } = useTranslation('discovery')
  const [dismissed, dismiss] = useDeviceFlag(`kr.home.first_run_tip.${profileId}`)
  if (dismissed) return null
  return (
    <section
      aria-label={t('home.first_run.text')}
      data-first-run-tip=""
      className="flex items-start gap-3 rounded-[var(--radius-card)] border border-primary/30 bg-primary-soft p-4"
    >
      <Sparkles aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
      <p className="flex-1">{t('home.first_run.text')}</p>
      <Button
        variant="ghost"
        size="icon"
        className="-me-2 -mt-2 shrink-0"
        aria-label={t('home.first_run.close')}
        onClick={dismiss}
      >
        <X aria-hidden="true" className="size-5" />
      </Button>
    </section>
  )
}

function HomeBody({ home, refetch }: { home: Home; refetch: () => Promise<unknown> }) {
  const { t } = useTranslation('discovery')
  const me = useCurrentMe()
  const pending = me.counters.pending_interests

  return (
    <>
      {pending > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm">
          <p className="flex items-center gap-2 font-medium">
            <Heart aria-hidden="true" className="size-5 shrink-0 fill-danger text-danger" />
            {t('home.pending.text', { count: pending })}
          </p>
          <Button asChild>
            <Link to="/interests" search={{ box: 'received', status: 'pending' }}>
              {t('home.pending.view')}
            </Link>
          </Button>
        </section>
      ) : null}
      <Nudges nudges={home.nudges} completeness={home.completeness} />
      <MatchesRow home={home} refetch={refetch} />
      {home.new_members.length > 0 ? (
        <CardRow
          title={t('home.rows.new_members')}
          seeAll={
            <SeeAllLink
              title={t('home.rows.new_members')}
              to="/search"
              search={{
                q: encodeSearchQuery({ filters: { joined_within_days: 7 }, sort: 'newest' }),
              }}
            />
          }
        >
          <CardStrip cards={home.new_members} />
        </CardRow>
      ) : null}
      {home.nearby.length > 0 ? (
        <CardRow
          title={t('home.rows.nearby')}
          seeAll={<NearbySeeAll title={t('home.rows.nearby')} />}
        >
          <CardStrip cards={home.nearby} />
        </CardRow>
      ) : null}
      {home.visitors_count_7d > 0 ? (
        <VisitorsBlock count={home.visitors_count_7d} visitors={home.recent_visitors} />
      ) : null}
      {home.completeness < 70 ? <CompletenessCard value={home.completeness} /> : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Nudges
// ---------------------------------------------------------------------------

const NUDGE_LINKS = {
  add_photo: linkOptions({ to: '/me/photos' }),
  verify_identity: linkOptions({ to: '/me/verification' }),
  add_about_me: linkOptions({ to: '/me/edit/$section', params: { section: 'lifestyle' } }),
  set_preferences: linkOptions({ to: '/me/preferences' }),
  verify_photo: linkOptions({ to: '/me/verification/selfie' }),
  add_contact_details: linkOptions({ to: '/settings/contacts' }),
  complete_profile: linkOptions({ to: '/me' }),
} satisfies Record<NudgeCode, unknown>

function isKnownNudge(code: string): code is NudgeCode {
  return code in NUDGE_LINKS
}

function Nudges({ nudges, completeness }: { nudges: Home['nudges']; completeness: number }) {
  const { t } = useTranslation('discovery')
  // Unknown codes from a newer API are ignored.
  const known = nudges.filter((nudge) => isKnownNudge(nudge.code))
  if (known.length === 0) return null
  return (
    <section aria-label={t('home.nudges_label')}>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {known.map((nudge) => {
          return (
            <li key={nudge.code} className="w-64 shrink-0 snap-start">
              <Link
                {...NUDGE_LINKS[nudge.code]}
                data-nudge={nudge.code}
                className="flex h-full min-h-24 flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="flex items-center justify-between gap-2 font-semibold text-primary">
                  {t(`home.nudge.${nudge.code}.title`)}
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 rtl:-scale-x-100" />
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`home.nudge.${nudge.code}.text`, { completeness })}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function CardRow({
  title,
  seeAll,
  children,
}: {
  title: string
  seeAll?: ReactNode
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {seeAll}
      </div>
      {children}
    </section>
  )
}

function SeeAllLink({
  title,
  to,
  search,
}: {
  title: string
  to: '/matches' | '/search' | '/visitors'
  search?: { q: string }
}) {
  const { t } = useTranslation('discovery')
  return (
    <Button asChild variant="ghost" className="-me-3 text-primary">
      <Link to={to} search={search} aria-label={t('home.rows.see_all_named', { title })}>
        {t('home.rows.see_all')}
      </Link>
    </Button>
  )
}

/**
 * "See all" of "Near you": `APP-SEARCH` with the viewer's own city in `city_ids` and
 * `sort = best_match`. The own city comes from `GET /v1/me/profile`, loaded on demand.
 */
function NearbySeeAll({ title }: { title: string }) {
  const { t } = useTranslation('discovery')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const open = async () => {
    setLoading(true)
    let cityId: number | null = null
    try {
      const own = await queryClient.ensureQueryData({
        queryKey: qk.ownProfile(),
        queryFn: () => http.get<OwnProfile>('/v1/me/profile'),
      })
      cityId = own.location.city_id
    } catch {
      cityId = null
    } finally {
      setLoading(false)
    }
    void navigate({
      to: '/search',
      search: cityId
        ? { q: encodeSearchQuery({ filters: { city_ids: [cityId] }, sort: 'best_match' }) }
        : {},
    })
  }

  return (
    <Button
      variant="ghost"
      className="-me-3 text-primary"
      loading={loading}
      aria-label={t('home.rows.see_all_named', { title })}
      onClick={() => void open()}
    >
      {t('home.rows.see_all')}
    </Button>
  )
}

function CardStrip({ cards }: { cards: readonly ProfileCard[] }) {
  return (
    <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      {cards.map((card) => (
        <li key={card.id} className="w-64 shrink-0 snap-start">
          <DiscoveryCard card={card} className="h-full" />
        </li>
      ))}
    </ul>
  )
}

/**
 * "Your matches" (16 section 6.4): the row, the "finding" state with up to 3 refetches 5 seconds
 * apart, and the exhausted states.
 */
function MatchesRow({ home, refetch }: { home: Home; refetch: () => Promise<unknown> }) {
  const { t } = useTranslation('discovery')
  return (
    <CardRow
      title={t('home.rows.matches')}
      seeAll={<SeeAllLink title={t('home.rows.matches')} to="/matches" />}
    >
      {home.recommendations.length > 0 ? (
        <>
          <CardStrip cards={home.recommendations.slice(0, 10)} />
          {home.pool_exhausted ? (
            <ExhaustedNotice variant="end" hints={home.relaxation_hints} />
          ) : null}
        </>
      ) : (
        <MatchesEmpty
          poolExhausted={home.pool_exhausted}
          hints={home.relaxation_hints}
          refetch={refetch}
        />
      )}
    </CardRow>
  )
}

function SkeletonStrip() {
  return (
    <div aria-hidden="true" className="-mx-4 flex gap-3 overflow-hidden px-4 md:mx-0 md:px-0">
      {[0, 1, 2, 3].map((index) => (
        <CardSkeleton key={index} className="w-64 shrink-0" />
      ))}
    </div>
  )
}

function HomeSkeleton() {
  const { t } = useTranslation('shared')
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">{t('list.loading')}</span>
      <div aria-hidden="true" className="flex gap-3 overflow-hidden">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24 w-64 shrink-0 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <SkeletonStrip />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-32" />
        <SkeletonStrip />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Visitors, completeness, safety
// ---------------------------------------------------------------------------

function VisitorsBlock({ count, visitors }: { count: number; visitors: readonly ProfileCard[] }) {
  const { t } = useTranslation('discovery')
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold">
          {t('home.visitors.title')}
        </h2>
        <Button asChild variant="ghost" className="-me-3 text-primary">
          <Link to="/visitors" aria-label={t('home.visitors.see_all_label')}>
            {t('home.visitors.see_all')}
          </Link>
        </Button>
      </div>
      <p>{t('home.visitors.text', { count })}</p>
      {visitors.length > 0 ? (
        <ul className="flex gap-2">
          {visitors.slice(0, 5).map((visitor) => (
            <li key={visitor.id}>
              <Link
                to="/profiles/$profileId"
                params={{ profileId: visitor.id }}
                className="block rounded-full"
              >
                <MemberPhoto
                  photo={visitor.photo}
                  name={visitor.display_name}
                  gender={visitor.gender}
                  size="thumb"
                  width={48}
                  height={48}
                  className="size-12 rounded-full"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function CompletenessCard({ value }: { value: number }) {
  const { t } = useTranslation('discovery')
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm">
      <div className="relative size-16 shrink-0">
        <svg
          role="img"
          aria-label={t('home.completeness.ring', { value: clamped })}
          viewBox="0 0 64 64"
          className="size-16 -rotate-90"
        >
          <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-muted" />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
            className="stroke-primary"
          />
        </svg>
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-sm font-semibold"
        >
          {clamped}%
        </span>
      </div>
      <p className="min-w-40 flex-1">{t('home.completeness.text')}</p>
      <Button asChild>
        <Link to="/me">{t('home.completeness.action')}</Link>
      </Button>
    </section>
  )
}

function SafetyLine() {
  const { t } = useTranslation('discovery')
  return (
    <p className={cn('flex items-start gap-2 text-sm text-muted-foreground')}>
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {t('home.safety.text')}{' '}
        <Link to="/safety" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('home.safety.link')}
        </Link>
      </span>
    </p>
  )
}
