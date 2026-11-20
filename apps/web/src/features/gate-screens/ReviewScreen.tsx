// GATE-REVIEW (16 section 6.2, 07 section 15.1)
import { Link } from '@tanstack/react-router'
import { Camera, ShieldCheck, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '~/components/ui/button'
import { useOwnProfile } from '~/features/profile-sections/queries'
import { RowChevron } from '~/features/settings/controls'
import type { OwnProfile } from '~/lib/api-types'
import { cn } from '~/lib/utils'
import { GateLayout } from './GateLayout'
import { useGateRefresh } from './queries'

/** `GET /v1/me` every 60 seconds while the screen is visible (16 section 6.2). */
const POLL_MS = 60_000

/** "The profile has no photo that is not rejected or failed" (07 section 15.1). */
export function needsPhoto(profile: Pick<OwnProfile, 'photos'>): boolean {
  return !profile.photos.some((photo) => photo.status !== 'rejected' && photo.status !== 'failed')
}

/** "id_verified is false and no id_document request is pending" (07 section 15.1). */
export function needsVerification(profile: Pick<OwnProfile, 'verification'>): boolean {
  return !profile.verification.id_verified && !profile.verification.pending.id_document
}

export function ReviewScreen() {
  const { t } = useTranslation('gate')
  const profile = useOwnProfile()
  useGateRefresh(POLL_MS)

  const showPhoto = profile.data ? needsPhoto(profile.data) : false
  const showVerify = profile.data ? needsVerification(profile.data) : false

  return (
    <GateLayout title={t('review.title')}>
      <p className="text-base">{t('review.text')}</p>

      <ul aria-label={t('review.next_steps')} className="flex flex-col gap-3">
        {showPhoto ? (
          <li>
            <ActionCard to="/me/photos" icon={Camera} title={t('review.photo.title')}>
              {t('review.photo.text')}
            </ActionCard>
          </li>
        ) : null}
        {showVerify ? (
          <li>
            <ActionCard to="/me/verification" icon={UserCheck} title={t('review.verify.title')}>
              {t('review.verify.text')}
            </ActionCard>
          </li>
        ) : null}
        <li>
          <ActionCard to="/settings/privacy" icon={ShieldCheck} title={t('review.privacy.title')}>
            {t('review.privacy.text')}
          </ActionCard>
        </li>
      </ul>

      <div>
        <Link to="/me" className={cn(buttonVariants({ variant: 'default' }))}>
          {t('review.view_profile')}
        </Link>
      </div>
    </GateLayout>
  )
}

function ActionCard({
  to,
  icon: Icon,
  title,
  children,
}: {
  to: '/me/photos' | '/me/verification' | '/settings/privacy'
  icon: typeof Camera
  title: string
  children: string
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{children}</span>
      </span>
      <RowChevron className="mt-2" />
    </Link>
  )
}
