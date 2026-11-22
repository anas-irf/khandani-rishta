// GATE-REVIEW (16 section 6.2, 07 section 15.1)
import { Link } from '@tanstack/react-router'
import { Camera, IdCard, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NudgeCard } from '~/components/common/LinkRow'
import { Button } from '~/components/ui/button'
import { useOwnProfile } from '~/features/profile-sections/queries'
import type { OwnProfile } from '~/lib/api-types'
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
      <p className="text-body-lg">{t('review.text')}</p>

      <ul aria-label={t('review.next_steps')} className="flex flex-col gap-3">
        {showPhoto ? (
          <li>
            <NudgeCard
              to="/me/photos"
              icon={Camera}
              label={t('review.photo.title')}
              description={t('review.photo.text')}
            />
          </li>
        ) : null}
        {showVerify ? (
          <li>
            <NudgeCard
              to="/me/verification"
              icon={IdCard}
              tone="success"
              label={t('review.verify.title')}
              description={t('review.verify.text')}
            />
          </li>
        ) : null}
        <li>
          <NudgeCard
            to="/settings/privacy"
            icon={ShieldCheck}
            label={t('review.privacy.title')}
            description={t('review.privacy.text')}
          />
        </li>
      </ul>

      <Button asChild size="lg" fill="phone">
        <Link to="/me">{t('review.view_profile')}</Link>
      </Button>
    </GateLayout>
  )
}
