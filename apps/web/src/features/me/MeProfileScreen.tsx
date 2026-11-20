// ME-PROFILE (16 section 6.17, 08 section 1)
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ChevronRight,
  Copy,
  Eye,
  Heart,
  ImageIcon,
  type LucideIcon,
  Settings,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BadgeRow } from '~/components/common/BadgeRow'
import { ErrorState } from '~/components/common/ErrorState'
import { Silhouette } from '~/components/common/MemberPhoto'
import { PageHeader } from '~/components/common/PageHeader'
import { PlainText } from '~/components/common/PlainText'
import { SectionCard } from '~/components/common/SectionCard'
import { StatusBanner } from '~/components/common/StatusBanner'
import { useResumeProfile } from '~/components/common/StatusPanel'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { usePreferences } from '~/features/preferences/queries'
import { useOwnProfile, useResubmitProfile } from '~/features/profile-sections/queries'
import { isApiError } from '~/lib/api'
import type { OwnProfile, Preferences, Privacy, TextStatus } from '~/lib/api-types'
import { ageFromDateOfBirth, formatHeight } from '~/lib/format'
import { gateHome, showsPrimaryNavigation } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'
import { errorMessage, qk } from '~/lib/query'
import { useLabelOf } from '~/lib/reference'
import { badgeCount, cn, toSlug } from '~/lib/utils'
import { hasContactDetails } from './contacts'
import { ProfilePreviewDialog } from './ProfilePreviewDialog'
import { usePrivacy } from './queries'
import { completenessHints, excerpt, mustHaveCount, ownBadges, sectionIsEmpty } from './summaries'

/**
 * The member's own profile at a glance: header, profile code, status banner, completeness,
 * the preview, and a card per editable part (08 section 1.1). On narrow screens it also carries
 * the Me menu and the gear icon to `SET-HOME` (16 section 2.2).
 */
export function MeProfileScreen() {
  const { t } = useTranslation('me')
  const profile = useOwnProfile()

  const header = (
    <PageHeader
      title={t('profile.title')}
      actions={
        <Button asChild variant="ghost" size="icon" className="md:hidden">
          <Link to="/settings" aria-label={t('profile.settings')}>
            <Settings aria-hidden="true" className="size-5" />
          </Link>
        </Button>
      }
    />
  )

  return (
    <div className="container-app flex max-w-3xl flex-col gap-4">
      {header}
      {profile.isPending ? (
        <ProfileSkeleton />
      ) : profile.isError ? (
        <ErrorState
          error={profile.error}
          onRetry={() => void profile.refetch()}
          retrying={profile.isFetching}
        />
      ) : (
        <ProfileContent profile={profile.data} />
      )}
    </div>
  )
}

function ProfileContent({ profile }: { profile: OwnProfile }) {
  const { t } = useTranslation('me')
  const me = useCurrentMe()
  const preferences = usePreferences()
  const privacy = usePrivacy()
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <>
      <ProfileHeaderBlock profile={profile} />
      <ProfileCode code={profile.public_code} />
      <MeMenu
        full={showsPrimaryNavigation(me)}
        photoRequests={me.counters.pending_photo_requests}
      />
      <StatusBanners profile={profile} />
      <CompletenessCard profile={profile} />
      <Button variant="secondary" className="self-start" onClick={() => setPreviewOpen(true)}>
        <Eye aria-hidden="true" />
        {t('profile.preview_button')}
      </Button>
      <SectionCards
        profile={profile}
        preferences={preferences.data ?? null}
        preferencesPending={preferences.isPending}
        privacy={privacy.data ?? null}
        privacyPending={privacy.isPending}
      />
      <ProfilePreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} profile={profile} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Blocks 1 and 2: header and profile code
// ---------------------------------------------------------------------------

function ProfileHeaderBlock({ profile }: { profile: OwnProfile }) {
  const { t } = useTranslation('me')
  const { basics, location } = profile
  const primary = profile.photos.find((photo) => photo.is_primary && photo.medium_url) ?? null
  const name = [basics.first_name, basics.last_name].filter(Boolean).join(' ')
  const age = basics.date_of_birth ? ageFromDateOfBirth(basics.date_of_birth) : null
  const city = location.city?.name ?? location.city_other ?? ''
  const ageCity =
    age !== null && city
      ? t('profile.age_city', { age, city })
      : age !== null
        ? t('profile.summary.age', { age })
        : city

  return (
    <section className="flex items-center gap-4">
      <Link
        to="/me/photos"
        aria-label={t('profile.photo_open')}
        className="block size-24 shrink-0 overflow-hidden rounded-full border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-28"
      >
        {primary?.medium_url ? (
          <img
            src={primary.medium_url}
            alt=""
            width={112}
            height={112}
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <Silhouette gender={basics.gender ?? 'female'} label={t('profile.photo_none')} />
        )}
      </Link>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <span dir="auto" className="truncate">
            {name}
          </span>
          <BadgeRow badges={ownBadges(profile.verification)} />
        </p>
        {ageCity ? <p className="text-muted-foreground">{ageCity}</p> : null}
      </div>
    </section>
  )
}

function ProfileCode({ code }: { code: string }) {
  const { t } = useTranslation('me')
  const copy = async () => {
    const url = `${window.location.origin}/p/${code}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('profile.code.copied'))
    } catch {
      toast.error(t('profile.code.copy_failed', { code }))
    }
  }
  return (
    <section className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p>
          <span className="text-sm text-muted-foreground">{t('profile.code.label')}</span>{' '}
          <span className="font-mono text-lg font-semibold tracking-wide" dir="ltr">
            {code}
          </span>
        </p>
        <Button
          variant="secondary"
          aria-label={t('profile.code.copy_label', { code })}
          onClick={() => void copy()}
        >
          <Copy aria-hidden="true" />
          {t('profile.code.copy')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('profile.code.help')}</p>
    </section>
  )
}

/** The Me menu of 16 section 2.2, on narrow screens only (wide screens use the avatar menu). */
function MeMenu({ full, photoRequests }: { full: boolean; photoRequests: number }) {
  const { t } = useTranslation('me')
  const count = badgeCount(photoRequests)
  const items: { to: string; label: string; icon: LucideIcon; badge?: string; name?: string }[] = [
    ...(full
      ? [
          { to: '/shortlist', label: t('profile.menu.shortlist'), icon: Heart },
          { to: '/visitors', label: t('profile.menu.visitors'), icon: Users },
          {
            to: '/photo-requests',
            label: t('profile.menu.photo_requests'),
            icon: ImageIcon,
            badge: count,
            name: count
              ? t('profile.menu.photo_requests_count', { count: photoRequests })
              : undefined,
          },
        ]
      : []),
    { to: '/settings', label: t('profile.menu.settings'), icon: Settings },
  ]
  return (
    <nav aria-label={t('profile.menu.label')} className="md:hidden">
      <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              aria-label={item.name}
              className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <item.icon aria-hidden="true" className="size-5 text-muted-foreground" />
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="rounded-full bg-danger px-2 py-0.5 text-sm font-medium text-danger-foreground">
                  {item.badge}
                </span>
              ) : null}
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground rtl:-scale-x-100"
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Block 3: status banners (08 section 1.2) and moderated texts (08 section 1.4)
// ---------------------------------------------------------------------------

const MODERATED: { key: 'about_me' | 'about_family' | 'partner_notes'; fix: string }[] = [
  { key: 'about_me', fix: '/me/edit/lifestyle' },
  { key: 'about_family', fix: '/me/edit/family' },
  { key: 'partner_notes', fix: '/me/preferences' },
]

function StatusBanners({ profile }: { profile: OwnProfile }) {
  const { t } = useTranslation('me')
  const me = useCurrentMe()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const resume = useResumeProfile()
  const resubmit = useResubmitProfile()
  const [resubmitErrors, setResubmitErrors] = useState<string[]>([])

  let banner: ReactNode = null
  switch (profile.status) {
    case 'paused':
      banner = (
        <StatusBanner
          variant="warning"
          action={
            <Button
              variant="secondary"
              loading={resume.isPending}
              onClick={() =>
                resume.mutate(undefined, {
                  onSuccess: () => {
                    // The banner follows `OwnProfile.status` (08 section 1.2).
                    void queryClient.invalidateQueries({ queryKey: qk.ownProfile() })
                    toast.success(t('profile.banner.resumed'))
                  },
                })
              }
            >
              {t('profile.banner.paused_action')}
            </Button>
          }
        >
          {t('profile.banner.paused')}
        </StatusBanner>
      )
      break
    case 'closed':
      banner = (
        <StatusBanner
          variant="info"
          action={
            <Button asChild variant="secondary">
              <Link to="/settings/account">{t('profile.banner.closed_action')}</Link>
            </Button>
          }
        >
          {t('profile.banner.closed')}
        </StatusBanner>
      )
      break
    case 'pending_review':
      banner = <StatusBanner variant="info">{t('profile.banner.pending_review')}</StatusBanner>
      break
    case 'changes_requested':
      banner = (
        <StatusBanner
          variant="warning"
          action={
            <div className="flex flex-col gap-2">
              {resubmitErrors.length > 0 ? (
                <ul role="alert" className="list-disc ps-5 text-danger">
                  {resubmitErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
              <Button
                className="self-start"
                loading={resubmit.isPending}
                onClick={() => {
                  setResubmitErrors([])
                  resubmit.mutate(undefined, {
                    onSuccess: (next) => {
                      void queryClient.invalidateQueries({ queryKey: qk.ownProfile() })
                      toast.success(t('profile.banner.resubmitted'))
                      void navigate({ to: gateHome(next) })
                    },
                    onError: (error) => {
                      if (isApiError(error) && error.code === 'validation_failed') {
                        setResubmitErrors(error.fields.map((field) => field.message))
                      } else if (isApiError(error) && error.code === 'invalid_state') {
                        toast.error(errorMessage(error))
                      }
                    },
                  })
                }}
              >
                {t('profile.banner.resubmit')}
              </Button>
            </div>
          }
        >
          <p>{t('profile.banner.changes_requested')}</p>
          <PlainText
            text={profile.status_reason ?? me.profile.status_reason}
            className="font-medium"
          />
        </StatusBanner>
      )
      break
    default:
      banner = null
  }

  const moderation = MODERATED.filter(({ key }) => profile.text_status[key] !== 'approved')
  return (
    <>
      {banner}
      {moderation.map(({ key, fix }) => {
        const status = profile.text_status[key]
        const text = t(`profile.moderation.${key}`)
        return (
          <StatusBanner
            key={key}
            variant={status === 'rejected' ? 'danger' : 'info'}
            title={text}
            action={
              <Button asChild variant="link" className="h-auto px-0">
                <Link to={fix}>{t('profile.moderation.fix', { text })}</Link>
              </Button>
            }
          >
            <ModerationText status={status} />
          </StatusBanner>
        )
      })}
    </>
  )
}

/** The owner-only label of a moderated text (08 section 1.4); nothing when approved. */
export function ModerationText({ status }: { status: TextStatus }) {
  const { t } = useTranslation('me')
  if (status === 'approved') return null
  return (
    <>{status === 'pending' ? t('profile.moderation.pending') : t('profile.moderation.rejected')}</>
  )
}

// ---------------------------------------------------------------------------
// Block 4: completeness (08 section 6)
// ---------------------------------------------------------------------------

function CompletenessCard({ profile }: { profile: OwnProfile }) {
  const { t } = useTranslation('me')
  if (profile.completeness >= 100) return null
  const hints = completenessHints(profile)
  const value = Math.max(0, Math.min(100, profile.completeness))
  const circumference = 2 * Math.PI * 26

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center gap-4">
        <svg aria-hidden="true" viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90">
          <circle cx="32" cy="32" r="26" fill="none" strokeWidth="7" className="stroke-border" />
          <circle
            cx="32"
            cy="32"
            r="26"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className="stroke-primary"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - value / 100)}
          />
        </svg>
        <p className="text-lg font-semibold">{t('profile.completeness.line', { value })}</p>
      </div>
      {hints.length > 0 ? (
        <nav aria-label={t('profile.completeness.hints')}>
          <ul className="flex flex-col divide-y divide-border">
            {hints.map((hint) => (
              <li key={hint.key}>
                <Link
                  to={hint.to}
                  className="flex min-h-11 items-center justify-between gap-2 py-2 font-medium text-primary hover:underline"
                >
                  {t(`profile.completeness.${hint.key}`)}
                  <ChevronRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Block 6: section cards (08 section 1.3)
// ---------------------------------------------------------------------------

function CardAction({ to, action, title }: { to: string; action: string; title: string }) {
  const { t } = useTranslation('me')
  return (
    <Button asChild variant="ghost" className="-me-2 text-primary">
      <Link to={to} aria-label={t('profile.actions.named', { action, title })}>
        {action}
      </Link>
    </Button>
  )
}

function Lines({ lines }: { lines: (string | null | undefined | false)[] }) {
  const { t } = useTranslation('me')
  const shown = lines.filter((line): line is string => Boolean(line))
  if (shown.length === 0) return <p className="text-muted-foreground">{t('profile.not_added')}</p>
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}

function join(...parts: (string | null | undefined)[]): string | null {
  const shown = parts.filter((part): part is string => Boolean(part))
  return shown.length > 0 ? shown.join(', ') : null
}

function SectionCards({
  profile,
  preferences,
  preferencesPending,
  privacy,
  privacyPending,
}: {
  profile: OwnProfile
  preferences: Preferences | null
  preferencesPending: boolean
  privacy: Privacy | null
  privacyPending: boolean
}) {
  const { t } = useTranslation('me')
  const label = useLabelOf()
  const { basics, community, location, education_career: education, family, lifestyle } = profile
  const edit = t('profile.actions.edit')
  const add = t('profile.actions.add')
  const open = t('profile.actions.open')
  const title = (key: string) => t(`profile.cards.${key}`)
  const editAction = (section: string, empty = false) => (
    <CardAction
      to={`/me/edit/${toSlug(section)}`}
      action={empty ? add : edit}
      title={title(section)}
    />
  )
  const thumbs = profile.photos.filter((photo) => photo.thumb_url).slice(0, 3)
  const age = basics.date_of_birth ? ageFromDateOfBirth(basics.date_of_birth) : null
  const caste = community.caste_code ? label('castes', community.caste_code) : community.caste_other
  const familyEmpty = sectionIsEmpty(family)
  const lifestyleEmpty = sectionIsEmpty(lifestyle)
  const contactsAdded = hasContactDetails(profile.contacts)
  const verification = profile.verification
  const stateOf = (verified: boolean, pending: boolean) =>
    verified
      ? t('profile.summary.state_verified')
      : pending
        ? t('profile.summary.state_pending')
        : t('profile.summary.state_not_verified')
  const musts = preferences ? mustHaveCount(preferences) : 0

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SectionCard
        title={title('photos')}
        action={
          <CardAction
            to="/me/photos"
            action={t('profile.actions.manage')}
            title={title('photos')}
          />
        }
      >
        {thumbs.length > 0 ? (
          <ul className="flex gap-2">
            {thumbs.map((photo, index) => (
              <li key={photo.id}>
                <img
                  src={photo.thumb_url ?? ''}
                  alt={t('profile.summary.photo_thumb', { position: index + 1 })}
                  width={64}
                  height={64}
                  draggable={false}
                  className="size-16 rounded-[var(--radius-input)] object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}
        <Lines
          lines={[
            profile.photos.length > 0
              ? t('profile.summary.photo_count', { count: profile.photos.length })
              : null,
            privacy
              ? t('profile.summary.photo_visibility', {
                  label: label('photo_visibility', privacy.photo_visibility),
                })
              : null,
          ]}
        />
      </SectionCard>

      <SectionCard title={title('basics')} action={editAction('basics')}>
        <Lines
          lines={[
            join(
              label('gender', basics.gender),
              age !== null ? t('profile.summary.age', { age }) : null,
            ),
            join(
              label('marital_status', basics.marital_status),
              basics.height_cm ? formatHeight(basics.height_cm) : null,
            ),
          ]}
        />
      </SectionCard>

      <SectionCard title={title('community')} action={editAction('community')}>
        <Lines
          lines={[
            join(label('religions', community.religion_code), label('sects', community.sect_code)),
            join(caste, label('languages', community.mother_tongue_code)),
          ]}
        />
      </SectionCard>

      <SectionCard title={title('location')} action={editAction('location')}>
        <Lines
          lines={[
            join(
              location.city?.name ?? location.city_other,
              location.city?.region_name,
              label('countries', location.country_code),
            ),
          ]}
        />
      </SectionCard>

      <SectionCard title={title('education_career')} action={editAction('education_career')}>
        <Lines
          lines={[
            label('education_levels', education.education_level_code),
            education.profession_code
              ? label('profession_categories', education.profession_code)
              : label('employment_type', education.employment_type),
          ]}
        />
      </SectionCard>

      <SectionCard title={title('family')} action={editAction('family', familyEmpty)}>
        <Lines
          lines={[
            join(
              family.father_status
                ? t('profile.summary.father', {
                    value: label('parent_status', family.father_status),
                  })
                : null,
              family.mother_status
                ? t('profile.summary.mother', {
                    value: label('parent_status', family.mother_status),
                  })
                : null,
            ),
            family.brothers_count !== null || family.sisters_count !== null
              ? t('profile.summary.siblings', {
                  brothers: family.brothers_count ?? 0,
                  sisters: family.sisters_count ?? 0,
                })
              : null,
            label('family_type', family.family_type),
          ]}
        />
        <ModerationLabel status={profile.text_status.about_family} />
      </SectionCard>

      <SectionCard title={title('lifestyle')} action={editAction('lifestyle', lifestyleEmpty)}>
        <Lines lines={[label('religiosity', lifestyle.religiosity)]} />
        <PlainText text={excerpt(lifestyle.about_me)} className="text-muted-foreground" />
        <ModerationLabel status={profile.text_status.about_me} />
      </SectionCard>

      <SectionCard
        title={title('preferences')}
        action={<CardAction to="/me/preferences" action={edit} title={title('preferences')} />}
      >
        {preferencesPending ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <Lines
            lines={
              preferences
                ? [
                    t('profile.summary.age_range', {
                      min: preferences.age_min,
                      max: preferences.age_max,
                    }),
                    musts > 0
                      ? t('profile.summary.must_haves', { count: musts })
                      : t('profile.summary.must_haves_none'),
                  ]
                : []
            }
          />
        )}
        <ModerationLabel status={profile.text_status.partner_notes} />
      </SectionCard>

      <SectionCard
        title={title('verification')}
        action={<CardAction to="/me/verification" action={open} title={title('verification')} />}
      >
        <Lines
          lines={[
            t('profile.summary.id', {
              state: stateOf(verification.id_verified, verification.pending.id_document),
            }),
            t('profile.summary.photo_check', {
              state: stateOf(verification.photo_verified, verification.pending.selfie),
            }),
            t('profile.summary.phone', {
              state: verification.phone_verified
                ? t('profile.summary.state_confirmed')
                : t('profile.summary.state_not_confirmed'),
            }),
          ]}
        />
      </SectionCard>

      <SectionCard
        title={title('contacts')}
        action={
          <CardAction
            to="/settings/contacts"
            action={contactsAdded ? edit : add}
            title={title('contacts')}
          />
        }
      >
        <Lines lines={[contactsAdded ? t('profile.summary.contacts_added') : null]} />
      </SectionCard>

      <SectionCard title={title('account_for')} action={editAction('account_for')}>
        <Lines
          lines={[
            profile.account_for.manager_name
              ? t('profile.summary.manager', {
                  label: label('managed_by', profile.account_for.managed_by),
                  name: profile.account_for.manager_name,
                })
              : label('managed_by', profile.account_for.managed_by),
          ]}
        />
      </SectionCard>

      <SectionCard
        title={title('privacy')}
        action={<CardAction to="/settings/privacy" action={open} title={title('privacy')} />}
      >
        {privacyPending ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <Lines
            lines={
              privacy
                ? [
                    t('profile.summary.photo_privacy', {
                      label: label('photo_visibility', privacy.photo_visibility),
                    }),
                    t('profile.summary.name_display', {
                      label: label('name_display', privacy.name_display),
                    }),
                  ]
                : []
            }
          />
        )}
      </SectionCard>
    </div>
  )
}

function ModerationLabel({ status }: { status: TextStatus }) {
  if (status === 'approved') return null
  return (
    <p
      className={cn(
        'rounded-[var(--radius-input)] px-3 py-2 text-sm',
        status === 'rejected' ? 'bg-danger-soft text-danger' : 'bg-warning-soft',
      )}
    >
      <ModerationText status={status} />
    </p>
  )
}

function ProfileSkeleton() {
  const { t } = useTranslation('me')
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{t('profile.loading')}</span>
      <div aria-hidden="true" className="flex items-center gap-4">
        <Skeleton className="size-24 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div aria-hidden="true" className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}
