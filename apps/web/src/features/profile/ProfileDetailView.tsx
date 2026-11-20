import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Minus, ShieldCheck, X } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BadgeRow } from '~/components/common/BadgeRow'
import { LockedValue } from '~/components/common/LockedValue'
import { PlainText } from '~/components/common/PlainText'
import { ReasonChips } from '~/components/common/ReasonChips'
import { SectionCard } from '~/components/common/SectionCard'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
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
  /** Shown under the summary in the first column: the action bar on `APP-PROFILE`. */
  aside?: ReactNode
  /** Shown after the last block: the safety footer on `APP-PROFILE`. */
  footer?: ReactNode
}

/**
 * The content of another member's profile (16 section 6.7 blocks 1 to 11): photos, header,
 * verification, compatibility, about, the detail blocks with locked groups, and what the member
 * is looking for. On wide screens two columns: photos and summary, then details (17 section 9.1).
 */
export function ProfileDetailView({
  detail,
  preview = false,
  aside,
  footer,
}: ProfileDetailViewProps) {
  const { t } = useTranslation('profile')
  const name = detail.card.display_name
  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-6">
      <div className="flex flex-col gap-4 md:sticky md:top-20">
        <ProfileGallery detail={detail} preview={preview} />
        <ProfileHeader detail={detail} />
        <VerificationBlock badges={detail.card.badges} />
        {aside}
      </div>
      <div className="flex flex-col gap-4">
        {!preview && detail.compatibility ? <CompatibilityBlock detail={detail} /> : null}
        {detail.about_me ? (
          <SectionCard title={t('about.title', { name })}>
            <PlainText text={detail.about_me} />
          </SectionCard>
        ) : null}
        <DetailBlocks detail={detail} />
        <LookingForBlock detail={detail} />
        {footer}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header and verification (blocks 2 and 2a)
// ---------------------------------------------------------------------------

function ProfileHeader({ detail }: { detail: ProfileDetail }) {
  const { t } = useTranslation(['profile', 'shared', 'common'])
  const label = useLabelOf()
  const { card } = detail
  const activity =
    detail.is_online === true
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
    <header className="flex flex-col gap-1">
      <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl font-semibold leading-snug">
        <span className="break-words">
          {t('common:format.name_age', { name: card.display_name, age: card.age })}
        </span>
        <BadgeRow badges={card.badges} />
      </h1>
      {activity ? <p className="text-muted-foreground">{activity}</p> : null}
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        <span>{t('profile:header.code', { code: card.public_code })}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('profile:header.copy_code')}
          onClick={() => void copy()}
        >
          <Copy aria-hidden="true" className="size-4" />
        </Button>
      </p>
      {card.managed_by && card.managed_by !== 'self' ? (
        <p className="text-muted-foreground">
          {t('profile:header.managed_by', { label: label('managed_by', card.managed_by) })}
        </p>
      ) : null}
    </header>
  )
}

const VERIFICATION_BADGES: readonly BadgeCode[] = [
  'id_verified',
  'photo_verified',
  'phone_verified',
]

function VerificationBlock({ badges }: { badges: readonly BadgeCode[] }) {
  const { t } = useTranslation('profile')
  const earned = VERIFICATION_BADGES.filter((badge) => badges.includes(badge))
  if (earned.length === 0) return null
  return (
    <section
      aria-label={t('verification.title')}
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-success/30 bg-success-soft/40 p-4"
    >
      <ul className="flex flex-col gap-1.5">
        {earned.map((badge) => (
          <li key={badge} className="flex items-start gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
            {t(`verification.${badge}`)}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">{t('verification.disclaimer')}</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Compatibility (block 3)
// ---------------------------------------------------------------------------

function Ring({ value, label }: { value: number; label: string }) {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="relative size-20 shrink-0">
      <svg viewBox="0 0 72 72" className="size-20 -rotate-90" aria-hidden="true">
        <circle cx="36" cy="36" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="stroke-accent"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center px-1 text-center text-sm font-semibold leading-tight">
        {label}
      </span>
    </div>
  )
}

function FitBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">{label}</p>
      {/* biome-ignore lint/a11y/useSemanticElements: a native meter cannot take the design tokens */}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

function CompatibilityBlock({ detail }: { detail: ProfileDetail }) {
  const { t } = useTranslation('profile')
  const [open, setOpen] = useState(false)
  const listId = useId()
  const compatibility = detail.compatibility
  if (!compatibility) return null
  const name = detail.card.display_name

  return (
    <SectionCard title={t('compat.title')}>
      <div className="flex items-center gap-4">
        <Ring
          value={compatibility.compat}
          label={t('compat.ring', { value: Math.round(compatibility.compat) })}
        />
        <ReasonChips reasons={compatibility.reasons} max={3} />
      </div>
      <FitBar
        label={t('compat.viewer_fit', { name, value: compatibility.viewer_fit })}
        value={compatibility.viewer_fit}
      />
      <FitBar
        label={t('compat.owner_fit', { name, value: compatibility.owner_fit })}
        value={compatibility.owner_fit}
      />
      {compatibility.dimensions.length > 0 ? (
        <>
          <Button
            variant="ghost"
            className="-ms-3 self-start text-primary"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('compat.details_hide') : t('compat.details_show')}
          </Button>
          <ul id={listId} hidden={!open} className="flex flex-col divide-y divide-border">
            {compatibility.dimensions.map((dimension) => (
              <li key={dimension.dimension} className="flex items-center gap-3 py-2">
                <MatchIcon matched={dimension.matched} />
                <span className="flex-1">{dimensionLabel(dimension.dimension)}</span>
                {dimension.importance === 'must' ? (
                  <Badge variant="outline">{t('compat.must')}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </SectionCard>
  )
}

function MatchIcon({ matched }: { matched: boolean | null }) {
  const { t } = useTranslation('profile')
  if (matched === null) {
    return <Minus aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
  }
  return matched ? (
    <span role="img" aria-label={t('compat.matched')} className="inline-flex text-success">
      <Check aria-hidden="true" className="size-5 shrink-0" />
    </span>
  ) : (
    <span role="img" aria-label={t('compat.not_matched')} className="inline-flex text-danger">
      <X aria-hidden="true" className="size-5 shrink-0" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Detail blocks (5 to 10)
// ---------------------------------------------------------------------------

type Row =
  | { key: string; label: string; value: ReactNode }
  | { key: string; label: string; locked: LockedGroup }

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

function DetailList({ items, tier }: { items: Row[]; tier: Tier }) {
  return (
    <dl className="flex flex-col divide-y divide-border">
      {items.map((row) => (
        <div
          key={row.key}
          data-row={row.key}
          data-locked={'locked' in row ? row.locked : undefined}
          className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="break-words">
            {'locked' in row ? <LockedValue tier={tier} /> : row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Block({
  title,
  items,
  tier,
  children,
}: {
  title: string
  items: Row[]
  tier: Tier
  children?: ReactNode
}) {
  if (items.length === 0 && !children) return null
  return (
    <SectionCard title={title}>
      {items.length > 0 ? <DetailList items={items} tier={tier} /> : null}
      {children}
    </SectionCard>
  )
}

function DetailBlocks({ detail }: { detail: ProfileDetail }) {
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
    {
      key: 'hobbies',
      label: r('hobbies'),
      value:
        lifestyle.hobby_codes.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {lifestyle.hobby_codes.map((code) => (
              <li key={code} className="rounded-full bg-muted px-2.5 py-0.5 text-sm">
                {label('hobbies', code)}
              </li>
            ))}
          </ul>
        ) : null,
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

  return (
    <>
      <Block title={t('blocks.basics')} items={basicsRows} tier={tier} />
      <Block title={t('blocks.community')} items={communityRows} tier={tier} />
      <Block title={t('blocks.location')} items={locationRows} tier={tier} />
      <Block title={t('blocks.education_career')} items={careerRows} tier={tier} />
      {locked.has('family') ? (
        <SectionCard title={t('blocks.family')}>
          <div data-locked="family">
            <LockedValue tier={tier} />
          </div>
        </SectionCard>
      ) : (
        <Block title={t('blocks.family')} items={familyRows} tier={tier}>
          {detail.about_family ? (
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold">{r('about_family')}</h3>
              <PlainText text={detail.about_family} />
            </div>
          ) : null}
        </Block>
      )}
      <Block title={t('blocks.lifestyle')} items={lifestyleRows} tier={tier} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Looking for (block 11)
// ---------------------------------------------------------------------------

function LookingForBlock({ detail }: { detail: ProfileDetail }) {
  const { t } = useTranslation('profile')
  const label = useLabelOf()
  const reference = useReference()
  const queryClient = useQueryClient()
  const viewerGender = queryClient.getQueryData<Me>(qk.me())?.profile.gender ?? null
  const name = detail.card.display_name
  const { lines, matched, total } = detail.looking_for

  return (
    <SectionCard title={t('looking_for.title', { name })}>
      {detail.partner_notes ? <PlainText text={detail.partner_notes} /> : null}
      {lines.length === 0 ? (
        <p className="text-muted-foreground">{t('looking_for.none', { name })}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {lines.map((line) => (
              <li
                key={line.dimension}
                data-line={line.dimension}
                className="flex items-start gap-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm text-muted-foreground">
                    {dimensionLabel(line.dimension)}
                  </span>
                  <span className="break-words">
                    {formatLookingForValues(line.dimension, line.summary_values, {
                      label,
                      reference,
                      viewerGender,
                    })}
                  </span>
                </div>
                {line.importance === 'must' ? (
                  <Badge variant="outline" className="shrink-0">
                    {t('looking_for.must')}
                  </Badge>
                ) : null}
                <span className="mt-0.5 shrink-0">
                  {line.viewer_matches === null ? null : line.viewer_matches ? (
                    <span
                      role="img"
                      aria-label={t('looking_for.you_match')}
                      className="inline-flex text-success"
                    >
                      <Check aria-hidden="true" className="size-5" />
                    </span>
                  ) : (
                    <span
                      role="img"
                      aria-label={t('looking_for.you_do_not_match')}
                      className="inline-flex text-danger"
                    >
                      <X aria-hidden="true" className="size-5" />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className={cn('font-medium')}>{t('looking_for.summary', { matched, total })}</p>
        </>
      )}
    </SectionCard>
  )
}
