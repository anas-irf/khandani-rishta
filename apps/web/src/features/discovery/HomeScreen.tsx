// APP-HOME (16 section 6.4, DESIGN.md 6.21)
import { useQueryClient } from '@tanstack/react-query'
import { Link, linkOptions, useNavigate } from '@tanstack/react-router'
import {
  Camera,
  IdCard,
  Lightbulb,
  type LucideIcon,
  PenLine,
  Phone,
  ScanFace,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnnouncementContent } from '~/components/common/AnnouncementBanner'
import { type ArchTone, MonogramArch } from '~/components/common/Arch'
import { Band } from '~/components/common/Band'
import { ErrorState } from '~/components/common/ErrorState'
import { NudgeCard } from '~/components/common/LinkRow'
import { MemberPhoto } from '~/components/common/MemberPhoto'
import { ProfileCard, profileCardCellClass } from '~/components/common/ProfileCard'
import { ProgressRing } from '~/components/common/ProgressRing'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { SectionHeading } from '~/components/common/SectionHeading'
import { TextLink } from '~/components/common/TextLink'
import { BrandLink } from '~/components/layout/BrandLink'
import { NotificationBell } from '~/components/layout/NotificationBell'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import { http } from '~/lib/api'
import type { Home, NudgeCode, ProfileCard as ProfileCardData } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { useBarHeight } from '~/lib/media'
import { qk } from '~/lib/query'
import { cn } from '~/lib/utils'
import { DiscoveryCard } from './components/DiscoveryCard'
import { ExhaustedNotice } from './components/ExhaustedNotice'
import { CardRailSkeleton, MatchesEmpty } from './components/MatchesEmpty'
import { textKey, useDeviceFlag } from './components/useDeviceFlag'
import { usePassInPlace } from './components/usePassInPlace'
import { useHome } from './queries'
import { encodeSearchQuery } from './search-params'

export function HomeScreen() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <HomeTopBar />
      <ScreenAccess screen="APP-HOME">
        <HomeContent />
      </ScreenAccess>
    </div>
  )
}

/** Narrow screens: the app name and the bell, on this screen only (16 section 2.2). */
function HomeTopBar() {
  const ref = useBarHeight('--screen-bar')
  return (
    <div
      ref={ref}
      data-slot="home-top-bar"
      className="sticky top-0 z-20 flex min-h-[64px] items-center justify-between gap-2 border-b border-border bg-background py-1 ps-[16px] pe-[8px] wide:hidden"
    >
      <BrandLink />
      <NotificationBell />
    </div>
  )
}

function HomeContent() {
  const home = useHome()
  const hasNew = (home.data?.new_members.length ?? 0) > 0
  const hasNear = (home.data?.nearby.length ?? 0) > 0
  // The bands under the matches take turns, whichever of the rows are shown.
  const nearTone = hasNew ? 'page' : 'sand'
  const lastTone = hasNear && nearTone === 'sand' ? 'page' : !hasNear && hasNew ? 'page' : 'sand'

  return (
    <>
      <GreetingBand />
      {home.data ? (
        <>
          <MatchesBand home={home.data} refetch={home.refetch} />
          {hasNew ? <NewMembers cards={home.data.new_members} /> : null}
          {hasNear ? <Nearby cards={home.data.nearby} tone={nearTone} /> : null}
        </>
      ) : (
        <Band as="div" innerClassName="flex flex-col gap-6">
          {home.isError ? (
            <ErrorState
              error={home.error}
              onRetry={() => void home.refetch()}
              retrying={home.isFetching}
            />
          ) : (
            <HomeSkeleton />
          )}
        </Band>
      )}
      <Band as="div" tone={lastTone} className="flex-1" innerClassName="flex flex-col gap-6">
        {home.data ? <WeekPanels home={home.data} /> : null}
        <SafetyLine />
      </Band>
    </>
  )
}

// ---------------------------------------------------------------------------
// The top: announcement, greeting, first-run tip, pending interests
// ---------------------------------------------------------------------------

function GreetingBand() {
  const me = useCurrentMe()
  return (
    <Band
      as="div"
      tone="sand"
      space="none"
      innerClassName="flex flex-col gap-4 pt-[clamp(16px,2.4vw,32px)] pb-[clamp(12px,2.4vw,32px)]"
    >
      <HomeAnnouncement />
      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4">
        <Greeting />
        <FirstRunTip profileId={me.profile.id} />
        <PendingCallout count={me.counters.pending_interests} />
      </div>
    </Band>
  )
}

function Greeting() {
  const { t } = useTranslation('discovery')
  const { managed, name } = useCandidate()
  return (
    <div className="flex min-w-0 items-center gap-4">
      {name ? (
        <MonogramArch
          name={name}
          size="md"
          tone="page"
          className="h-[3.4375rem] w-[2.75rem] [&>span]:text-[1.375rem] wide:h-[4.375rem] wide:w-[3.5rem] wide:[&>span]:text-[1.625rem]"
        />
      ) : null}
      <h1 className="min-w-0 text-headline-sm wide:text-headline-md lg:text-headline-lg">
        {name && managed ? (
          <TwoLines text={t('home.greeting_managed', { name })} />
        ) : name ? (
          t('home.greeting', { name })
        ) : (
          t('home.greeting_plain')
        )}
      </h1>
    </div>
  )
}

/**
 * The first sentence large and the rest on a line under it (DESIGN.md 6.21). The break is found
 * here, so the copy stays plain text: Android shows the same string (specs/22 section 1).
 */
function TwoLines({ text }: { text: string }) {
  const end = /[.!?\u06D4]\s+/.exec(text)
  if (!end) return text
  return (
    <>
      <span className="block">{text.slice(0, end.index + 1)}</span>{' '}
      <span className="mt-1 block text-body-md font-normal text-foreground-secondary">
        {text.slice(end.index + end[0].length)}
      </span>
    </>
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
      <AnnouncementContent announcement={announcement} className="pe-[56px]" />
      <Button
        variant="ghost"
        size="icon"
        className="absolute end-1 top-1"
        aria-label={t('home.announcement_close')}
        onClick={dismiss}
      >
        <X aria-hidden="true" />
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
      className="tonal flex basis-full items-start gap-[12px] rounded-lg py-1 ps-[16px] pe-[4px]"
    >
      <Lightbulb aria-hidden="true" className="mt-[16px] size-5 text-primary" />
      <p className="min-w-0 flex-1 py-3 text-body-sm">{t('home.first_run.text')}</p>
      <Button variant="ghost" size="icon" aria-label={t('home.first_run.close')} onClick={dismiss}>
        <X aria-hidden="true" />
      </Button>
    </section>
  )
}

/** The pending interests callout: its text and View, without photos (DESIGN.md 6.21). */
function PendingCallout({ count }: { count: number }) {
  const { t } = useTranslation('discovery')
  const { context } = useCandidate()
  const textId = useId()
  if (count <= 0) return null
  return (
    <section
      aria-labelledby={textId}
      data-pending-interests=""
      className="band-primary flex min-w-0 max-w-full flex-[1_1_100%] flex-wrap items-center gap-x-4 gap-y-3 rounded-xl py-3 ps-5 pe-3 wide:gap-x-5 wide:gap-y-4 wide:py-4 wide:ps-6 wide:pe-4 roomy:flex-[0_1_560px]"
    >
      <p
        id={textId}
        className="min-w-0 flex-[1_1_10ch] text-balance text-emphasis wide:flex-[1_1_12.5rem] wide:text-figure"
      >
        {t('home.pending.text', { count, context })}
      </p>
      <Button asChild variant="inverse" size="lg">
        <Link to="/interests" search={{ box: 'received', status: 'pending' }}>
          {t('home.pending.view')}
        </Link>
      </Button>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Matches and nudges
// ---------------------------------------------------------------------------

/**
 * "Your matches" (16 section 6.4): the row, its "finding" state with up to 3 refetches 5 seconds
 * apart, and the exhausted states. The nudges follow in the same band, after the first match.
 */
function MatchesBand({ home, refetch }: { home: Home; refetch: () => Promise<unknown> }) {
  const { t } = useTranslation('discovery')
  const { context, named, name } = useCandidate()
  const headingId = useId()
  const passing = usePassInPlace()
  const cards = passing.arrange(home.recommendations.slice(0, 10))
  const title = t('home.rows.matches', { context: named, name })

  return (
    <Band
      as="div"
      space="none"
      innerClassName="flex flex-col gap-[clamp(12px,1.7vw,24px)] pt-[clamp(16px,2.8vw,40px)] pb-[clamp(36px,4.5vw,64px)]"
    >
      <section
        aria-labelledby={headingId}
        className="flex min-w-0 flex-col gap-[clamp(12px,1.7vw,24px)]"
      >
        <SectionHeading
          id={headingId}
          title={title}
          ornament="rule"
          description={cards.length > 0 ? t('home.rows.matches_fit', { context }) : undefined}
          action={
            cards.length > 0 ? (
              <TextLink to="/matches" aria-label={t('home.rows.see_all_named', { title })}>
                {t('home.rows.see_all')}
              </TextLink>
            ) : null
          }
        />
        {cards.length > 0 ? (
          <div className="@container min-w-0">
            <ul className="card-rail scroll-row">
              {cards.map((card, index) => (
                <li key={card.id} className={profileCardCellClass}>
                  <DiscoveryCard
                    card={card}
                    index={index}
                    passing={passing}
                    priority={index === 0}
                  />
                </li>
              ))}
              {home.pool_exhausted ? (
                <li className={profileCardCellClass}>
                  <ExhaustedNotice variant="end" titleAs="h3" hints={home.relaxation_hints} />
                </li>
              ) : null}
            </ul>
          </div>
        ) : (
          <MatchesEmpty
            titleAs="h3"
            poolExhausted={home.pool_exhausted}
            hints={home.relaxation_hints}
            refetch={refetch}
          />
        )}
      </section>
      <Nudges nudges={home.nudges} completeness={home.completeness} />
    </Band>
  )
}

const NUDGE_LINKS = {
  add_photo: linkOptions({ to: '/me/photos' }),
  verify_identity: linkOptions({ to: '/me/verification' }),
  add_about_me: linkOptions({ to: '/me/edit/$section', params: { section: 'lifestyle' } }),
  set_preferences: linkOptions({ to: '/me/preferences' }),
  verify_photo: linkOptions({ to: '/me/verification/selfie' }),
  add_contact_details: linkOptions({ to: '/settings/contacts' }),
  complete_profile: linkOptions({ to: '/me' }),
} satisfies Record<NudgeCode, unknown>

const NUDGE_LOOK: Record<NudgeCode, { icon: LucideIcon; tone: ArchTone }> = {
  add_photo: { icon: Camera, tone: 'primary' },
  verify_identity: { icon: IdCard, tone: 'success' },
  add_about_me: { icon: PenLine, tone: 'primary' },
  set_preferences: { icon: SlidersHorizontal, tone: 'primary' },
  verify_photo: { icon: ScanFace, tone: 'success' },
  add_contact_details: { icon: Phone, tone: 'primary' },
  complete_profile: { icon: UserRound, tone: 'primary' },
}

function isKnownNudge(code: string): code is NudgeCode {
  return code in NUDGE_LINKS
}

/** One row of equal columns on wide screens; a row that scrolls sideways on phones. */
function Nudges({ nudges, completeness }: { nudges: Home['nudges']; completeness: number }) {
  const { t } = useTranslation('discovery')
  const { context, named, name } = useCandidate()
  // Unknown codes from a newer API are ignored.
  const known = nudges.filter((nudge) => isKnownNudge(nudge.code))
  if (known.length === 0) return null
  return (
    <section aria-label={t('home.nudges_label', { context })} className="min-w-0">
      <ul className="flex gap-3 max-wide:scroll-row wide:grid wide:grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))]">
        {known.map(({ code }) => (
          <li
            key={code}
            className="max-w-[min(max(300px,18.75rem),100%)] shrink-0 snap-start wide:max-w-none"
          >
            <NudgeCard
              {...NUDGE_LINKS[code]}
              {...NUDGE_LOOK[code]}
              inRow
              data-nudge={code}
              label={t(`home.nudge.${code}.title`, {
                context: code === 'add_about_me' ? named : context,
                name,
              })}
              description={t(`home.nudge.${code}.text`, { completeness, context })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// New members and Near you
// ---------------------------------------------------------------------------

function Row({
  title,
  tone,
  action,
  children,
}: {
  title: string
  tone: 'page' | 'sand'
  action: ReactNode
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <Band aria-labelledby={headingId} tone={tone} innerClassName="flex flex-col gap-5">
      <SectionHeading id={headingId} title={title} ornament="none" action={action} />
      {children}
    </Band>
  )
}

function NewMembers({ cards }: { cards: readonly ProfileCardData[] }) {
  const { t } = useTranslation('discovery')
  const title = t('home.rows.new_members')
  return (
    <Row
      title={title}
      tone="sand"
      action={
        <TextLink
          to="/search"
          search={{
            q: encodeSearchQuery({ filters: { joined_within_days: 7 }, sort: 'newest' }),
          }}
          aria-label={t('home.rows.see_all_named', { title })}
        >
          {t('home.rows.see_all')}
        </TextLink>
      }
    >
      <ul className="scroll-row flex gap-5">
        {cards.map((card) => (
          <li key={card.id} className="w-[max(156px,6.5rem)] shrink-0 snap-start">
            <ProfileCard card={card} size="tile" />
          </li>
        ))}
      </ul>
    </Row>
  )
}

function Nearby({ cards, tone }: { cards: readonly ProfileCardData[]; tone: 'page' | 'sand' }) {
  const { t } = useTranslation('discovery')
  const { named, name } = useCandidate()
  const title = t('home.rows.nearby', { context: named, name })
  return (
    <Row title={title} tone={tone} action={<NearbySeeAll title={title} />}>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-x-10">
        {cards.map((card) => (
          <li key={card.id} className="min-w-0 border-b border-border">
            <ProfileCard card={card} size="compact" />
          </li>
        ))}
      </ul>
    </Row>
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
        queryFn: () => http.get('/v1/me/profile'),
      })
      cityId = own.location.city_id ?? null
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
      variant="link"
      loading={loading}
      aria-label={t('home.rows.see_all_named', { title })}
      onClick={() => void open()}
    >
      {t('home.rows.see_all')}
    </Button>
  )
}

function HomeSkeleton() {
  const { t } = useTranslation('shared')
  return (
    <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <span className="sr-only">{t('list.loading')}</span>
      <Skeleton aria-hidden="true" className="h-8 w-3/5 max-w-[320px]" />
      <CardRailSkeleton />
      <Skeleton aria-hidden="true" className="h-[72px] w-full rounded-lg" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The last band: visitors, completeness, safety
// ---------------------------------------------------------------------------

const PANEL = 'tonal flex min-w-0 rounded-lg px-5 py-6'

function WeekPanels({ home }: { home: Home }) {
  const visitors = home.visitors_count_7d > 0
  const completeness = home.completeness < 70
  if (!visitors && !completeness) return null
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-4">
      {visitors ? (
        <VisitorsPanel count={home.visitors_count_7d} visitors={home.recent_visitors} />
      ) : null}
      {completeness ? <CompletenessPanel value={home.completeness} /> : null}
    </div>
  )
}

function VisitorsPanel({
  count,
  visitors,
}: {
  count: number
  visitors: readonly ProfileCardData[]
}) {
  const { t } = useTranslation('discovery')
  const { named, name } = useCandidate()
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn(PANEL, 'flex-col items-start gap-3')}>
      <h2 id={headingId} className="max-w-full text-title-lg">
        {t('home.visitors.title', { context: named, name })}
      </h2>
      <div className="flex max-w-full flex-wrap items-center gap-x-5 gap-y-3">
        {visitors.length > 0 ? (
          <ul className="flex max-w-full flex-wrap gap-2">
            {visitors.slice(0, 5).map((visitor) => (
              <li key={visitor.id}>
                <Link
                  to="/profiles/$profileId"
                  params={{ profileId: visitor.id }}
                  className="block rounded-arch-sm"
                >
                  <MemberPhoto
                    photo={visitor.photo}
                    name={visitor.display_name}
                    gender={visitor.gender}
                    size="thumb"
                    width={48}
                    height={60}
                    className="h-[60px] w-[48px] border-2 border-background"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="min-w-0 text-body-lg tabular-nums">{t('home.visitors.text', { count })}</p>
      </div>
      <TextLink
        to="/visitors"
        aria-label={t('home.visitors.see_all_label', { context: named, name })}
      >
        {t('home.visitors.see_all')}
      </TextLink>
    </section>
  )
}

function CompletenessPanel({ value }: { value: number }) {
  const { t } = useTranslation('discovery')
  const { context } = useCandidate()
  const textId = useId()
  return (
    <section
      aria-labelledby={textId}
      className={cn(PANEL, 'flex-wrap items-center gap-x-6 gap-y-4')}
    >
      <ProgressRing
        kind="completeness"
        value={value}
        label={t('home.completeness.ring', { value })}
      />
      <div className="flex min-w-0 flex-[1_1_12.5rem] flex-col items-start gap-3">
        <h2 id={textId} className="max-w-full text-title-lg">
          {t('home.completeness.text')}
        </h2>
        <Button asChild variant="secondary">
          <Link to="/me">{t('home.completeness.action', { context })}</Link>
        </Button>
      </div>
    </section>
  )
}

function SafetyLine() {
  const { t } = useTranslation('discovery')
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-foreground-secondary">
      <TriangleAlert aria-hidden="true" className="size-5 text-primary" />
      <span className="min-w-0">{t('home.safety.text')}</span>
      <TextLink to="/safety">{t('home.safety.link')}</TextLink>
    </p>
  )
}
