import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Copy, Minus, UsersRound, X } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BadgeRow, VERIFICATION_BADGES } from '~/components/common/BadgeRow'
import { BleedBand } from '~/components/common/Band'
import { Chip } from '~/components/common/Chip'
import { DefinitionList, DefinitionRow } from '~/components/common/DefinitionList'
import { LockedValue } from '~/components/common/LockedValue'
import { MetaLine } from '~/components/common/MetaLine'
import { NameAge } from '~/components/common/NameAge'
import { Percent } from '~/components/common/Percent'
import { PlainText } from '~/components/common/PlainText'
import { ProgressRing } from '~/components/common/ProgressRing'
import { ReasonChips } from '~/components/common/ReasonChips'
import { SectionCard } from '~/components/common/SectionCard'
import { SectionHeading } from '~/components/common/SectionHeading'
import { useCardFacts } from '~/components/common/useCardFacts'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Progress } from '~/components/ui/progress'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import type { Badge as BadgeCode, LockedGroup, Me, ProfileDetail, Tier } from '~/lib/api-types'
import { formatHeight } from '~/lib/format'
import { qk } from '~/lib/query'
import { useLabelOf, useReference } from '~/lib/reference'
import { cn } from '~/lib/utils'
import { ProfileGallery } from './components/ProfileGallery'
import { dimensionLabel, formatLookingForValues } from './looking-for'

export type ProfileDetailViewProps = {
  detail: ProfileDetail
  /**
   * The owner's own preview ("Preview as member / as connection"): no action bar, no
   * compatibility, no controls that act on the profile.
   */
  preview?: boolean
  /** At the top of the hero: the back control on wide screens. */
  lead?: ReactNode
  /** A note in the hero, under the summary: the owner's preview banner. */
  notice?: ReactNode
  /** The last band: the safety footer on `APP-PROFILE`. */
  footer?: ReactNode
}

/** The gallery beside the name and facts, stacked when they do not fit. */
export const profileColumnsClass = 'flex flex-wrap gap-x-10 gap-y-8'

/**
 * The content of another member's profile (16 section 6.7 blocks 1 to 11): the hero with photos,
 * header and verification, then one band per part, taking turns between background and sand
 * whichever parts are there (DESIGN.md 6.10). Two groups share a band where they fit.
 */
export function ProfileDetailView({
  detail,
  preview = false,
  lead,
  notice,
  footer,
}: ProfileDetailViewProps) {
  const { t } = useTranslation('profile')
  const nameId = useId()
  const detailBands = useDetailBands(detail)
  const name = detail.card.display_name

  const bands: { key: string; content: ReactNode }[] = []
  if (!preview && detail.compatibility) {
    bands.push({ key: 'compatibility', content: <CompatibilityBlock detail={detail} /> })
  }
  if (detail.about_me) {
    bands.push({
      key: 'about',
      content: (
        <SectionCard title={t('about.title', { name })}>
          <PlainText text={detail.about_me} className="max-w-measure text-body-lg" />
        </SectionCard>
      ),
    })
  }
  bands.push(...detailBands)
  bands.push({ key: 'looking-for', content: <LookingForBlock detail={detail} /> })
  if (footer) bands.push({ key: 'footer', content: footer })

  return (
    <article aria-labelledby={nameId} className="flex min-w-0 flex-1 flex-col">
      <BleedBand tone="sand" className={cn(lead && 'pt-3')}>
        {lead}
        <div className={profileColumnsClass}>
          <ProfileGallery
            detail={detail}
            preview={preview}
            className="mx-auto max-w-[clamp(260px,80vw,380px)] flex-[1_1_300px]"
          />
          <div className="flex min-w-0 max-w-full flex-[1_1_340px] flex-col gap-4">
            <ProfileHeader detail={detail} nameId={nameId} />
            <VerificationBlock badges={detail.card.badges} />
            {notice}
          </div>
        </div>
      </BleedBand>
      {bands.map(({ key, content }, index) => (
        <BleedBand key={key} tone={index % 2 === 0 ? 'page' : 'sand'} className="last:flex-1">
          {content}
        </BleedBand>
      ))}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Header and verification (blocks 2 and 2a)
// ---------------------------------------------------------------------------

function ProfileHeader({ detail, nameId }: { detail: ProfileDetail; nameId: string }) {
  const { t } = useTranslation(['profile', 'shared'])
  const label = useLabelOf()
  const { card } = detail
  const { country, work } = useCardFacts(card)
  const location = country
    ? t('shared:card.location_with_country', { city: card.city_name, country })
    : card.city_name
  const online = detail.is_online === true
  const activity = online
    ? t('profile:header.online')
    : card.last_active
      ? t(`shared:card.activity.${card.last_active}`, { defaultValue: '' })
      : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.public_code)
      toast.success(t('profile:header.copied'))
    } catch {
      // Clipboard refused (permissions): nothing to copy to; the code stays visible.
    }
  }

  return (
    <header className="flex min-w-0 flex-col items-start gap-4">
      <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2">
        <span className="tonal max-w-full rounded-lg px-3 py-[8px] text-label-sm font-bold break-all tabular-nums">
          <span className="sr-only">{t('profile:header.code', { code: card.public_code })}</span>
          <span aria-hidden="true">{card.public_code}</span>
        </span>
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('profile:header.copy_code')}
          onClick={() => void copy()}
        >
          <Copy aria-hidden="true" className="size-4" />
        </Button>
        {activity ? (
          <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                'size-[9px] shrink-0 rounded-pill',
                online ? 'bg-success' : 'border-2 border-input',
              )}
            />
            {activity}
          </p>
        ) : null}
      </div>
      <h1 id={nameId} className="max-w-full text-headline-lg xl:text-headline-lg-wide tabular-nums">
        <NameAge name={card.display_name} age={card.age} />
      </h1>
      <BadgeRow badges={card.badges} />
      <MetaLine
        parts={[
          location,
          work,
          label('marital_status', card.marital_status),
          label('sects', card.sect_code),
        ]}
        className="text-body-lg"
      />
      {card.managed_by && card.managed_by !== 'self' ? (
        <p className="flex max-w-full items-start gap-3 rounded-lg bg-primary-soft px-4 py-2 text-label-md font-bold text-primary">
          <span aria-hidden="true" className="flex h-[1lh] items-center">
            <UsersRound className="size-[18px]" />
          </span>
          <span className="min-w-0">
            {t('profile:header.managed_by', { label: label('managed_by', card.managed_by) })}
          </span>
        </p>
      ) : null}
    </header>
  )
}

function VerificationBlock({ badges }: { badges: readonly BadgeCode[] }) {
  const { t } = useTranslation('profile')
  const headingId = useId()
  const earned = VERIFICATION_BADGES.filter((badge) => badges.includes(badge))
  if (earned.length === 0) return null
  return (
    <section
      aria-labelledby={headingId}
      className="band-success mt-1 flex flex-col gap-3 rounded-lg px-[20px] py-5"
    >
      <h2 id={headingId} className="text-figure">
        {t('verification.title')}
      </h2>
      <ul className="flex flex-col gap-3">
        {earned.map((badge) => (
          <li key={badge} className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-[1lh] items-center text-success">
              <Check strokeWidth={2.5} className="size-5" />
            </span>
            <span className="min-w-0">{t(`verification.${badge}`)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-success/30 pt-3 text-body-sm text-foreground-secondary">
        {t('verification.disclaimer')}
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Compatibility (block 3)
// ---------------------------------------------------------------------------

function FitBar({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'primary'
}) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-body-lg">
        <Percent text={label} className={tone === 'success' ? 'text-success' : 'text-primary'} />
      </p>
      <Progress role="meter" tone={tone} aria-labelledby={labelId} value={Math.round(value)} />
    </div>
  )
}

function CompatibilityBlock({ detail }: { detail: ProfileDetail }) {
  const { t } = useTranslation('profile')
  const { context } = useCandidate()
  const [open, setOpen] = useState(false)
  const headingId = useId()
  const compatibility = detail.compatibility
  if (!compatibility) return null
  const name = detail.card.display_name
  const percent = Math.round(compatibility.compat)
  const ringLabel = t('compat.ring', { value: percent })

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
        <ProgressRing
          kind="match"
          value={percent}
          label={ringLabel}
          // The ring's word is what the translation puts beside the number.
          caption={ringLabel.replace(`${percent}%`, '').trim()}
        />
        <div className="flex min-w-0 max-w-full flex-[1_1_320px] flex-col gap-4">
          <SectionHeading id={headingId} title={t('compat.title')} ornament="none" />
          <ReasonChips reasons={compatibility.reasons} max={3} className="gap-2 text-body-md" />
          <FitBar
            tone="success"
            label={t('compat.viewer_fit', { name, value: compatibility.viewer_fit, context })}
            value={compatibility.viewer_fit}
          />
          <FitBar
            tone="primary"
            label={t('compat.owner_fit', { name, value: compatibility.owner_fit, context })}
            value={compatibility.owner_fit}
          />
        </div>
      </div>
      {compatibility.dimensions.length > 0 ? (
        <Collapsible open={open} onOpenChange={setOpen} className="tonal rounded-lg px-[20px] py-1">
          <CollapsibleTrigger>
            {open ? t('compat.details_hide') : t('compat.details_show')}
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-background"
            >
              <ChevronDown className="size-[1.125rem] transition-transform duration-(--duration-base) group-data-[state=open]/collapsible:rotate-180" />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(290px,100%),1fr))] gap-x-8 pb-3">
              {compatibility.dimensions.map((dimension) => (
                <li
                  key={dimension.dimension}
                  className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-[8px]"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0">{dimensionLabel(dimension.dimension)}</span>
                    {dimension.importance === 'must' ? (
                      <Badge variant="tag">{t('compat.must')}</Badge>
                    ) : null}
                  </span>
                  <MatchResult
                    matched={dimension.matched}
                    matchText={t('compat.matched')}
                    differsText={t('compat.not_matched')}
                  />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  )
}

/** A tick or a cross, always with its words; a difference is never red (DESIGN.md 2.2). */
function MatchResult({
  matched,
  matchText,
  differsText,
}: {
  matched: boolean | null
  matchText: string
  differsText: string
}) {
  if (matched === null) {
    return <Minus aria-hidden="true" className="size-[18px] text-muted-foreground" />
  }
  const Icon = matched ? Check : X
  return (
    <span
      data-match={matched}
      className={cn(
        'inline-flex max-w-full items-center gap-2 text-label-md font-bold',
        matched ? 'text-success' : 'text-foreground-secondary',
      )}
    >
      <Icon aria-hidden="true" strokeWidth={2.5} className="size-[18px]" />
      {matched ? matchText : differsText}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Detail blocks (5 to 10)
// ---------------------------------------------------------------------------

type Row =
  | { key: string; label: string; value: ReactNode }
  | { key: string; label: string; locked: LockedGroup }

type Group = { key: string; title: string; items: Row[]; more?: ReactNode }

function value(text: string | null | undefined): string | null {
  return text ? text : null
}

/** Rows with a value, and locked placeholders; a null value is left out (16 section 6.7). */
function rows(list: (Row | null | false)[]): Row[] {
  return list.filter((row): row is Row => {
    if (!row) return false
    if ('locked' in row) return true
    return row.value !== null && row.value !== undefined && row.value !== ''
  })
}

function GroupBlock({ group, tier, split }: { group: Group; tier: Tier; split: boolean }) {
  return (
    <SectionCard title={group.title}>
      {group.items.length > 0 ? (
        <DefinitionList split={split}>
          {group.items.map((row) => (
            <DefinitionRow
              key={row.key}
              label={row.label}
              data-row={row.key}
              data-locked={'locked' in row ? row.locked : undefined}
            >
              {'locked' in row ? <LockedValue tier={tier} /> : row.value}
            </DefinitionRow>
          ))}
        </DefinitionList>
      ) : null}
      {group.more}
    </SectionCard>
  )
}

/**
 * Blocks 5 to 10 as bands: Basics with Religion and community, Location with Education and
 * career, then Family and Faith and lifestyle on their own. A block with no rows is not shown.
 */
function useDetailBands(detail: ProfileDetail): { key: string; content: ReactNode }[] {
  const { t } = useTranslation(['profile', 'shared'])
  const label = useLabelOf()
  const tier = detail.relation.tier
  const locked = new Set(detail.locked)
  const { basics, community, location, education_career: career, family, lifestyle } = detail
  const pronoun = t(`pronoun.${detail.card.gender}`)
  const r = (key: string) => t(`rows.${key}`)

  let children: string | null = null
  if (basics.children_status === 'none') children = r('children_none')
  else if (
    basics.children_status === 'living_with_me' ||
    basics.children_status === 'not_living_with_me'
  ) {
    const key = basics.children_status === 'living_with_me' ? 'children_with' : 'children_without'
    children =
      basics.children_count !== null
        ? t(`rows.${key}`, { count: basics.children_count, pronoun })
        : label('children_status', basics.children_status)
  } else if (basics.children_status) {
    children = label('children_status', basics.children_status)
  }

  const basicsRows = rows([
    {
      key: 'marital_status',
      label: r('marital_status'),
      value: value(label('marital_status', basics.marital_status)),
    },
    { key: 'children', label: r('children'), value: children },
    basics.current_wives_count !== null && {
      key: 'current_wives',
      label: r('current_wives'),
      value: t('rows.current_wives_value', { count: basics.current_wives_count }),
    },
    {
      key: 'height',
      label: r('height'),
      value: basics.height_cm ? formatHeight(basics.height_cm) : null,
    },
    {
      key: 'weight',
      label: r('weight'),
      value: basics.weight_kg !== null ? t('rows.weight_value', { value: basics.weight_kg }) : null,
    },
    {
      key: 'complexion',
      label: r('complexion'),
      value: value(label('complexion', basics.complexion)),
    },
    { key: 'build', label: r('build'), value: value(label('body_type', basics.body_type)) },
  ])

  const caste = community.caste_label
    ? community.sub_caste_label
      ? `${community.caste_label} (${community.sub_caste_label})`
      : community.caste_label
    : null
  const communityRows = rows([
    {
      key: 'religion',
      label: r('religion'),
      value: value(label('religions', community.religion_code)),
    },
    { key: 'sect', label: r('sect'), value: value(label('sects', community.sect_code)) },
    locked.has('caste')
      ? { key: 'caste', label: r('caste'), locked: 'caste' }
      : { key: 'caste', label: r('caste'), value: caste },
    {
      key: 'mother_tongue',
      label: r('mother_tongue'),
      value: value(label('languages', community.mother_tongue_code)),
    },
    {
      key: 'other_languages',
      label: r('other_languages'),
      value: community.language_codes.map((code) => label('languages', code)).join(', ') || null,
    },
  ])

  const livesIn = [
    location.city_name,
    location.region_name,
    label('countries', location.country_code),
  ]
    .filter(Boolean)
    .join(', ')
  const locationRows = rows([
    { key: 'lives_in', label: r('lives_in'), value: livesIn || null },
    locked.has('area')
      ? { key: 'area', label: r('area'), locked: 'area' }
      : {
          key: 'area',
          label: r('area'),
          value: location.area ? <PlainText as="span" text={location.area} /> : null,
        },
    {
      key: 'nationality',
      label: r('nationality'),
      value: value(label('countries', location.nationality_code)),
    },
    {
      key: 'residency',
      label: r('residency'),
      value: value(label('residency_status', location.residency_status)),
    },
    { key: 'home_town', label: r('home_town'), value: location.origin_label },
    {
      key: 'relocate',
      label: r('relocate'),
      value: value(label('relocation', location.relocation)),
    },
  ])

  const careerRows = rows([
    {
      key: 'education_level',
      label: r('education_level'),
      value: value(label('education_levels', career.education_level_code)),
    },
    {
      key: 'field',
      label: r('field'),
      value: value(label('education_fields', career.education_field_code)),
    },
    ...(locked.has('career_details')
      ? [
          {
            key: 'career_details',
            label: t('shared:locked.group.career_details'),
            locked: 'career_details' as const,
          },
        ]
      : [
          {
            key: 'degree',
            label: r('degree'),
            value: career.degree_title ? <PlainText as="span" text={career.degree_title} /> : null,
          },
          {
            key: 'institute',
            label: r('institute'),
            value: career.institute_name ? (
              <PlainText as="span" text={career.institute_name} />
            ) : null,
          },
        ]),
    {
      key: 'employment',
      label: r('employment'),
      value: value(label('employment_type', career.employment_type)),
    },
    {
      key: 'profession',
      label: r('profession'),
      value: value(label('profession_categories', career.profession_code)),
    },
    ...(locked.has('career_details')
      ? []
      : [
          {
            key: 'job_title',
            label: r('job_title'),
            value: career.job_title ? <PlainText as="span" text={career.job_title} /> : null,
          },
          {
            key: 'employer',
            label: r('employer'),
            value: career.employer_name ? (
              <PlainText as="span" text={career.employer_name} />
            ) : null,
          },
        ]),
    locked.has('income')
      ? { key: 'income', label: r('income'), locked: 'income' }
      : {
          key: 'income',
          label: r('income'),
          value: value(label('income_bands', career.income_band_code)),
        },
  ])

  const parent = (status: string | null, occupation: string | null) =>
    [label('parent_status', status), occupation].filter(Boolean).join(', ') || null
  const siblings = (count: number | null, married: number | null) =>
    count === null
      ? null
      : married !== null && married > 0
        ? t('rows.siblings_value', { count, married })
        : String(count)
  const home = family
    ? [
        label('home_ownership', family.home_ownership),
        label('home_type', family.home_type),
        family.home_size_value !== null
          ? `${family.home_size_value} ${label('home_size_unit', family.home_size_unit)}`.trim()
          : '',
      ]
        .filter(Boolean)
        .join(', ') || null
    : null
  const familyCity = family
    ? [
        family.family_city_name,
        family.family_country_code ? label('countries', family.family_country_code) : '',
      ]
        .filter(Boolean)
        .join(', ') || null
    : null
  const familyRows: Row[] = locked.has('family')
    ? []
    : rows([
        {
          key: 'father',
          label: r('father'),
          value: family ? parent(family.father_status, family.father_occupation) : null,
        },
        {
          key: 'mother',
          label: r('mother'),
          value: family ? parent(family.mother_status, family.mother_occupation) : null,
        },
        {
          key: 'brothers',
          label: r('brothers'),
          value: family ? siblings(family.brothers_count, family.brothers_married) : null,
        },
        {
          key: 'sisters',
          label: r('sisters'),
          value: family ? siblings(family.sisters_count, family.sisters_married) : null,
        },
        {
          key: 'family_type',
          label: r('family_type'),
          value: value(label('family_type', family?.family_type)),
        },
        {
          key: 'family_status',
          label: r('family_status'),
          value: value(label('family_class', family?.family_class)),
        },
        {
          key: 'family_values',
          label: r('family_values'),
          value: value(label('family_values', family?.family_values)),
        },
        { key: 'family_lives_in', label: r('family_lives_in'), value: familyCity },
        locked.has('home')
          ? { key: 'home', label: r('home'), locked: 'home' }
          : { key: 'home', label: r('home'), value: home },
      ])

  const appearanceKey = detail.card.gender === 'female' ? 'hijab' : 'beard'
  const appearanceValue = detail.card.gender === 'female' ? lifestyle.hijab : lifestyle.beard
  const disability = [label('disability', lifestyle.disability), lifestyle.disability_details]
    .filter(Boolean)
    .join(', ')
  const lifestyleRows = rows([
    {
      key: 'religiosity',
      label: r('religiosity'),
      value: value(label('religiosity', lifestyle.religiosity)),
    },
    {
      key: 'prayers',
      label: r('prayers'),
      value: value(label('prayer_frequency', lifestyle.prayer_frequency)),
    },
    {
      key: appearanceKey,
      label: r(appearanceKey),
      value: value(label(appearanceKey, appearanceValue)),
    },
    {
      key: 'religious_education',
      label: r('religious_education'),
      value: value(label('religious_education', lifestyle.religious_education)),
    },
    { key: 'smoking', label: r('smoking'), value: value(label('smoking', lifestyle.smoking)) },
    {
      key: 'living',
      label: r('living'),
      value: value(label('living_arrangement', lifestyle.living_arrangement)),
    },
    {
      key: 'work',
      label: r('work'),
      value: value(label('work_after_marriage', lifestyle.work_after_marriage)),
    },
    {
      key: 'timeline',
      label: r('timeline'),
      value: value(label('marriage_timeline', lifestyle.marriage_timeline)),
    },
    {
      key: 'jahez',
      label: r('jahez'),
      value: value(label('jahez_stance', lifestyle.jahez_stance)),
    },
    ...(locked.has('health')
      ? [{ key: 'health', label: t('shared:locked.group.health'), locked: 'health' as const }]
      : [
          {
            key: 'blood_group',
            label: r('blood_group'),
            value: value(label('blood_group', lifestyle.blood_group)),
          },
          { key: 'disability', label: r('disability'), value: disability || null },
        ]),
  ])

  let familyMore: ReactNode = null
  if (locked.has('family')) {
    familyMore = (
      <div data-locked="family">
        <LockedValue tier={tier} />
      </div>
    )
  } else if (detail.about_family) {
    familyMore = (
      <div className="mt-2 flex flex-col gap-2">
        <h3 className="text-emphasis">{r('about_family')}</h3>
        <PlainText text={detail.about_family} className="max-w-measure text-body-lg" />
      </div>
    )
  }

  // Hobbies are chips under the rows: several values that do not read as one.
  const hobbies =
    lifestyle.hobby_codes.length > 0 ? (
      <div data-row="hobbies" className="mt-2 flex flex-col gap-2">
        <h3 className="text-body-sm font-normal text-muted-foreground">{r('hobbies')}</h3>
        <ul className="flex flex-wrap gap-2">
          {lifestyle.hobby_codes.map((code) => (
            <li key={code} className="max-w-full">
              <Chip>{label('hobbies', code)}</Chip>
            </li>
          ))}
        </ul>
      </div>
    ) : null

  const layout: Group[][] = [
    [
      { key: 'basics', title: t('blocks.basics'), items: basicsRows },
      { key: 'community', title: t('blocks.community'), items: communityRows },
    ],
    [
      { key: 'location', title: t('blocks.location'), items: locationRows },
      { key: 'education_career', title: t('blocks.education_career'), items: careerRows },
    ],
    [{ key: 'family', title: t('blocks.family'), items: familyRows, more: familyMore }],
    [{ key: 'lifestyle', title: t('blocks.lifestyle'), items: lifestyleRows, more: hobbies }],
  ]

  return layout
    .map((band) => band.filter((group) => group.items.length > 0 || Boolean(group.more)))
    .filter((band) => band.length > 0)
    .map((band) => ({
      key: band.map((group) => group.key).join('-'),
      content: (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-x-14 gap-y-10">
          {band.map((group) => (
            <GroupBlock key={group.key} group={group} tier={tier} split={band.length === 1} />
          ))}
        </div>
      ),
    }))
}

// ---------------------------------------------------------------------------
// Looking for (block 11)
// ---------------------------------------------------------------------------

function LookingForBlock({ detail }: { detail: ProfileDetail }) {
  const { t } = useTranslation('profile')
  const { context } = useCandidate()
  const label = useLabelOf()
  const reference = useReference()
  const queryClient = useQueryClient()
  const viewerGender = queryClient.getQueryData<Me>(qk.me())?.profile.gender ?? null
  const name = detail.card.display_name
  const { lines, matched, total } = detail.looking_for

  return (
    <SectionCard title={t('looking_for.title', { name })} className="gap-4">
      {lines.length > 0 ? (
        <p className="rounded-lg bg-success-soft px-5 py-4 text-title-lg text-success tabular-nums">
          {t('looking_for.summary', { matched, total, context })}
        </p>
      ) : null}
      <PlainText text={detail.partner_notes} className="max-w-measure text-body-lg" />
      {lines.length === 0 ? (
        <p className="text-muted-foreground">{t('looking_for.none', { name })}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-x-12">
          {lines.map((line) => (
            <li
              key={line.dimension}
              data-line={line.dimension}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border py-3"
            >
              <span className="flex min-w-0 max-w-full flex-[1_1_11rem] flex-col gap-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted-foreground">
                  <span className="min-w-0">{dimensionLabel(line.dimension)}</span>
                  {line.importance === 'must' ? (
                    <Badge variant="tag">{t('looking_for.must')}</Badge>
                  ) : null}
                </span>
                <span className="text-title-sm">
                  {formatLookingForValues(line.dimension, line.summary_values, {
                    label,
                    reference,
                    viewerGender,
                  })}
                </span>
              </span>
              {line.viewer_matches === null ? null : (
                <MatchResult
                  matched={line.viewer_matches}
                  matchText={t('looking_for.you_match', { context })}
                  differsText={t('looking_for.you_do_not_match', { context })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
