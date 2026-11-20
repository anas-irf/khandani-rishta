import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Heart, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useShortlistToggle } from '~/features/relations/queries'
import type { OwnProfile, ProfileCard as ProfileCardData } from '~/lib/api-types'
import { formatHeight } from '~/lib/format'
import { qk } from '~/lib/query'
import { useLabelOf } from '~/lib/reference'
import { cn } from '~/lib/utils'
import { BadgeRow } from './BadgeRow'
import { CompatBadge } from './CompatBadge'
import { MemberPhoto } from './MemberPhoto'
import { useOnlineStatus } from './OfflineBanner'
import { ReasonChips } from './ReasonChips'

export type ProfileCardSize = 'full' | 'compact'

export type ProfileCardProps = {
  card: ProfileCardData
  /** `full` in matches, search and home rows; `compact` in interests, shortlist, visitors, requests. */
  size?: ProfileCardSize
  /**
   * The viewer's own country. The card adds the country name to the city when the member lives
   * elsewhere (16 section 1.5). Defaults to the country of the cached own profile; when neither
   * is known the country is not shown.
   */
  viewerCountryCode?: string | null
  /** List-specific buttons (accept, withdraw, remove...), shown under the card's content. */
  actions?: ReactNode
  /** Heading level of the name in the page outline. */
  headingLevel?: 'h2' | 'h3'
  className?: string
}

const SEPARATOR = ' · '

/**
 * The one card for every list of members (16 section 1.5, 17 section 10). The whole card opens
 * `APP-PROFILE` through a stretched link; the heart and the `actions` sit above that link, so
 * no interactive element is nested inside it.
 */
export function ProfileCard({
  card,
  size = 'full',
  viewerCountryCode,
  actions,
  headingLevel: Heading = 'h3',
  className,
}: ProfileCardProps) {
  const { t } = useTranslation(['shared', 'common'])
  const label = useLabelOf()
  const queryClient = useQueryClient()
  const compact = size === 'compact'

  const viewerCountry =
    viewerCountryCode !== undefined
      ? viewerCountryCode
      : (queryClient.getQueryData<OwnProfile>(qk.ownProfile())?.location.country_code ?? null)
  const location =
    viewerCountry && card.country_code !== viewerCountry
      ? t('shared:card.location_with_country', {
          city: card.city_name,
          country: label('countries', card.country_code),
        })
      : card.city_name

  const education = label('education_levels', card.education_level_code)
  const work = card.profession_code
    ? label('profession_categories', card.profession_code)
    : label('employment_type', card.employment_type)

  const relationHint = relationHintKey(card.relation)
  const nameAndAge = t('common:format.name_age', { name: card.display_name, age: card.age })

  const name = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <Heading className="min-w-0 break-words text-base font-semibold leading-snug">
        <Link
          to="/profiles/$profileId"
          params={{ profileId: card.id }}
          data-card-link=""
          className="text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {nameAndAge}
        </Link>
      </Heading>
      <BadgeRow badges={card.badges} tooltips={false} />
    </div>
  )

  const locationLine = (
    <p className="flex items-center gap-1 text-sm text-muted-foreground">
      <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{location}</span>
    </p>
  )

  const relationLine = relationHint ? (
    <p className="text-sm font-medium text-primary" data-relation-hint="">
      {t(`shared:card.relation.${relationHint}`)}
    </p>
  ) : null

  const actionRow = actions ? (
    <div className="relative z-10 mt-2 flex flex-wrap gap-2">{actions}</div>
  ) : null

  const frame = cn(
    'relative rounded-[var(--radius-card)] border border-border bg-surface text-foreground shadow-sm transition-shadow hover:shadow-md has-[[data-card-link]:focus-visible]:ring-2 has-[[data-card-link]:focus-visible]:ring-ring has-[[data-card-link]:focus-visible]:ring-offset-2',
    className,
  )

  if (compact) {
    return (
      <article className={cn(frame, 'flex gap-3 p-3')} data-profile-card="compact">
        <MemberPhoto
          photo={card.photo}
          name={card.display_name}
          gender={card.gender}
          size="thumb"
          width={72}
          height={72}
          className="size-18 shrink-0 rounded-[var(--radius-input)]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {name}
          {locationLine}
          <p className="truncate text-sm text-muted-foreground">
            {[education, work].filter(Boolean).join(SEPARATOR)}
          </p>
          {card.compat !== null || relationLine ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <CompatBadge compat={card.compat} />
              {relationLine}
            </div>
          ) : null}
          {actionRow}
        </div>
      </article>
    )
  }

  const keyFacts = [
    formatHeight(card.height_cm),
    card.marital_status !== 'never_married' ? label('marital_status', card.marital_status) : '',
    card.sect_code ? label('sects', card.sect_code) : label('religions', card.religion_code),
    card.caste_label ?? '',
  ].filter(Boolean)
  // An activity value this build does not know is left out.
  const activity = card.last_active
    ? t(`shared:card.activity.${card.last_active}`, { defaultValue: '' })
    : ''

  return (
    <article className={cn(frame, 'flex flex-col overflow-hidden')} data-profile-card="full">
      <div className="relative">
        <MemberPhoto
          photo={card.photo}
          name={card.display_name}
          gender={card.gender}
          size="medium"
          width={400}
          height={500}
          className="aspect-[4/5] w-full"
        />
        {card.photo_count >= 2 ? (
          <span className="absolute top-2 start-2 rounded-full bg-foreground/75 px-2 py-0.5 text-sm text-background">
            {t('shared:card.photo_count', { count: card.photo_count })}
          </span>
        ) : null}
        <ShortlistHeart card={card} className="absolute top-1 end-1 z-10" />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        {name}
        {locationLine}
        <p className="text-sm text-muted-foreground">{education}</p>
        {work ? <p className="text-sm text-muted-foreground">{work}</p> : null}
        {keyFacts.length > 0 ? (
          <p className="text-sm text-muted-foreground" data-key-facts="">
            {keyFacts.join(SEPARATOR)}
          </p>
        ) : null}
        {card.managed_by && card.managed_by !== 'self' ? (
          <p className="text-sm text-muted-foreground">
            {t('shared:card.managed_by', { label: label('managed_by', card.managed_by) })}
          </p>
        ) : null}
        {card.compat !== null || card.reasons.length > 0 ? (
          <div className="mt-1 flex flex-col items-start gap-1.5">
            <CompatBadge compat={card.compat} />
            <ReasonChips reasons={card.reasons} max={3} />
          </div>
        ) : null}
        {activity ? <p className="text-sm text-muted-foreground">{activity}</p> : null}
        {relationLine}
        {actionRow}
      </div>
    </article>
  )
}

function relationHintKey(
  relation: ProfileCardData['relation'],
): 'connected' | 'sent' | 'received' | null {
  if (relation.tier === 'connection') return 'connected'
  if (relation.interest_direction === 'sent') return 'sent'
  if (relation.interest_direction === 'received') return 'received'
  return null
}

/**
 * The shortlist heart (16 section 1.5): `PUT /v1/shortlist/{id}` with `{}` or `DELETE`,
 * optimistic (G7). While the request runs the heart shows the requested state; the caches are
 * updated by the hook, and reverted with a toast on failure.
 */
export function ShortlistHeart({
  card,
  className,
}: {
  card: Pick<ProfileCardData, 'id' | 'display_name' | 'relation'>
  className?: string
}) {
  const { t } = useTranslation('shared')
  const toggle = useShortlistToggle()
  const online = useOnlineStatus()
  const shortlisted = toggle.isPending ? toggle.variables.shortlisted : card.relation.is_shortlisted

  return (
    <button
      type="button"
      aria-pressed={shortlisted}
      aria-label={
        shortlisted
          ? t('card.shortlist_remove', { name: card.display_name })
          : t('card.shortlist_add', { name: card.display_name })
      }
      disabled={!online}
      onClick={() => toggle.mutate({ profileId: card.id, shortlisted: !shortlisted })}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-full text-danger transition-colors hover:bg-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
        className,
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-surface/90 shadow-sm">
        <Heart
          aria-hidden="true"
          className={cn('size-5', shortlisted ? 'fill-danger' : 'fill-transparent')}
        />
      </span>
    </button>
  )
}
