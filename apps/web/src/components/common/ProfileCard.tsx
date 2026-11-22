import { Link } from '@tanstack/react-router'
import { UsersRound } from 'lucide-react'
import { type ReactNode, type Ref, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProfileCard as ProfileCardData } from '~/lib/api-types'
import { useLabelOf } from '~/lib/reference'
import { cn } from '~/lib/utils'
import { BadgeRow } from './BadgeRow'
import { CompatBadge } from './CompatBadge'
import { MemberPhoto } from './MemberPhoto'
import { MetaLine } from './MetaLine'
import { NameAge } from './NameAge'
import { ReasonChips } from './ReasonChips'
import { RelationHint } from './RelationHint'
import { ShortlistButton } from './ShortlistButton'
import { useCardFacts } from './useCardFacts'

export type ProfileCardSize = 'full' | 'compact' | 'tile'

/**
 * The cell of a full-size card in a `card-rail` or `card-grid`. On wide screens it passes the
 * five rows on, so the parts of every card in a row line up (DESIGN.md 6.9).
 */
export const profileCardCellClass =
  'min-w-0 snap-start has-[[data-fills-cell]]:grid has-[[data-fills-cell]]:self-stretch wide:row-span-5 wide:grid wide:grid-cols-[minmax(0,1fr)] wide:grid-rows-subgrid'

export type ProfileCardProps = {
  card: ProfileCardData
  /**
   * - `full`: matches, search and "Your matches" on Home.
   * - `compact`: interests, shortlist, visitors, requests and "Near you" on Home.
   * - `tile`: "New members" on Home, and nothing else.
   */
  size?: ProfileCardSize
  /**
   * The viewer's own country. The card adds the country name to the city when the member lives
   * elsewhere (16 section 1.5). Defaults to the country of the cached own profile; when neither
   * is known the country is not shown.
   */
  viewerCountryCode?: string | null
  /** Full size: the "More" control beside Shortlist. */
  more?: ReactNode
  /** List-specific lines and buttons (accept, withdraw, remove...), under the card's content. */
  actions?: ReactNode
  /** The name's link, for a list that puts focus back on it. */
  linkRef?: Ref<HTMLAnchorElement>
  /** The first photo of a screen loads eagerly. */
  priority?: boolean
  /** Heading level of the name in the page outline. */
  headingLevel?: 'h2' | 'h3'
  className?: string
}

/**
 * The one card for every list of members (16 section 1.5, 17 section 10, DESIGN.md 6.9). It
 * carries only what helps a family decide whether to open the profile: education, height,
 * religion or sect, caste and activity are on the profile.
 *
 * The whole card opens `APP-PROFILE` through one link, the name, stretched under the buttons, so
 * no interactive element is nested in it and each card is one tab stop before its buttons.
 */
export function ProfileCard({
  card,
  size = 'full',
  viewerCountryCode,
  more,
  actions,
  linkRef,
  priority = false,
  headingLevel: Heading = 'h3',
  className,
}: ProfileCardProps) {
  const { t } = useTranslation('shared')
  const label = useLabelOf()
  const linkId = useId()
  const full = size === 'full'
  const compact = size === 'compact'

  const { country, work, maritalStatus } = useCardFacts(card, viewerCountryCode)
  const location = country
    ? t('card.location_with_country', { city: card.city_name, country })
    : card.city_name
  const isNew = card.badges.includes('new')

  // What the arch shows, read out after the name (DESIGN.md 8.3).
  const photoState = [
    isNew ? t('badge.new') : null,
    card.photo?.is_blurred ? t('photo.private') : null,
    card.photo ? null : t('photo.none'),
    full && card.photo_count >= 2 ? t('card.photo_count', { count: card.photo_count }) : null,
  ]
    .filter(Boolean)
    .join(', ')

  const heading = (
    <Heading
      className={cn(
        'max-w-full min-w-0 tabular-nums',
        full && 'text-title-lg',
        compact && 'text-title-md font-bold',
        size === 'tile' && 'text-emphasis',
      )}
    >
      <Link
        ref={linkRef}
        id={linkId}
        to="/profiles/$profileId"
        params={{ profileId: card.id }}
        data-card-link=""
        className="stretched-link text-foreground group-hover/card:link-gold"
      >
        <NameAge name={card.display_name} age={card.age} />
      </Link>
      {photoState ? <span className="sr-only">. {photoState}</span> : null}
    </Heading>
  )

  if (size === 'tile') {
    return (
      <article
        aria-labelledby={linkId}
        data-profile-card="tile"
        className={cn('group/card relative flex flex-col items-start gap-2', className)}
      >
        <MemberPhoto
          photo={card.photo}
          name={card.display_name}
          gender={card.gender}
          size="medium"
          variant="tile"
          width={156}
          height={195}
          decorative
          isNew={isNew}
          className="h-[195px] w-[156px]"
        />
        {heading}
        <CompatBadge compat={card.compat} size="compact" />
        <p className="max-w-full text-body-sm text-foreground-secondary">
          <span className="block">{location}</span>
          {work ? <span className="block">{work}</span> : null}
        </p>
      </article>
    )
  }

  if (compact) {
    return (
      <article
        aria-labelledby={linkId}
        data-profile-card="compact"
        className={cn(
          'group/card relative grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 py-3',
          className,
        )}
      >
        <MemberPhoto
          photo={card.photo}
          name={card.display_name}
          gender={card.gender}
          size="thumb"
          width={60}
          height={76}
          decorative
          isNew={isNew}
          // Grows with the text just enough for the "New" chip to stay inside the arch.
          className={cn('h-[76px] w-[60px]', isNew && 'h-[max(76px,4.1rem)] w-[max(60px,3.25rem)]')}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {heading}
            <CompatBadge compat={card.compat} size="compact" />
            <RelationHint relation={card.relation} />
          </div>
          <MetaLine parts={[location, work]} className="text-body-sm" />
          <BadgeRow badges={card.badges} className="mt-1" />
        </div>
        {actions ? (
          // Only the controls sit above the card's link: the lines between them still open it.
          <div className="col-span-2 flex min-w-0 flex-wrap gap-2 wide:col-span-1 wide:col-start-2 [&_:is(a,button,label)]:relative [&_:is(a,button,label)]:z-10">
            {actions}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <article
      aria-labelledby={linkId}
      data-profile-card="full"
      className={cn(
        'group/card relative flex w-full min-w-0 flex-col wide:row-span-5 wide:grid wide:grid-cols-[minmax(0,1fr)] wide:grid-rows-subgrid',
        className,
      )}
    >
      <MemberPhoto
        photo={card.photo}
        name={card.display_name}
        gender={card.gender}
        size="medium"
        width={400}
        height={500}
        decorative
        count={card.photo_count}
        isNew={isNew}
        priority={priority}
        className="aspect-[4/5] w-full wide:row-start-1"
      />
      <div className="mt-3 flex flex-col gap-2 wide:row-start-2">
        <div className="flex flex-wrap items-center gap-2">
          {heading}
          <CompatBadge compat={card.compat} />
          <RelationHint relation={card.relation} />
        </div>
        <BadgeRow badges={card.badges} />
      </div>
      <ReasonChips reasons={card.reasons} max={3} className="mt-3 wide:row-start-3" />
      <div className="mt-4 flex flex-col gap-1 wide:row-start-4">
        <MetaLine parts={[location, work, maritalStatus]} />
        {card.managed_by && card.managed_by !== 'self' ? (
          <p className="flex items-start gap-2 text-body-sm font-semibold text-foreground-secondary">
            <span aria-hidden="true" className="flex h-[1lh] items-center text-muted-foreground">
              <UsersRound className="size-[18px]" />
            </span>
            <span className="min-w-0">
              {t('card.managed_by', { label: label('managed_by', card.managed_by) })}
            </span>
          </p>
        ) : null}
      </div>
      <div className="relative z-10 mt-4 flex flex-col gap-3 wide:row-start-5 wide:self-end">
        <div className="flex flex-wrap gap-3">
          {/* Shortlist grows; when the two do not fit, each takes a line of its own. */}
          <ShortlistButton
            profileId={card.id}
            shortlisted={card.relation.is_shortlisted}
            size="compact"
            aria-describedby={linkId}
            className="grow-[999]"
          />
          {more}
        </div>
        {actions}
      </div>
    </article>
  )
}
