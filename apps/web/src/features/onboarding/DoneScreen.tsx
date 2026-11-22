// ONB-DONE (07 section 15): the profile is live; three things that make a difference.
import { useNavigate } from '@tanstack/react-router'
import { Camera, IdCard, type LucideIcon, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ArchTone } from '~/components/common/Arch'
import { CardSkeleton } from '~/components/common/CardSkeleton'
import { DisplayHeading } from '~/components/common/DisplayHeading'
import { ErrorState } from '~/components/common/ErrorState'
import { NudgeCard } from '~/components/common/LinkRow'
import { OrnamentRule } from '~/components/common/Ornament'
import { Button } from '~/components/ui/button'
import { useOwnProfile } from '~/features/profile-sections/queries'

type NextStep = {
  key: string
  to: string
  icon: LucideIcon
  tone?: ArchTone
  title: string
  text: string
}

export function DoneScreen() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const profile = useOwnProfile()

  if (profile.isError) {
    return (
      <ErrorState
        error={profile.error}
        onRetry={() => void profile.refetch()}
        retrying={profile.isFetching}
      />
    )
  }

  const steps: NextStep[] = []
  if (profile.data) {
    const { photos, verification } = profile.data
    const hasPhoto = photos.some(
      (photo) => photo.status !== 'rejected' && photo.status !== 'failed',
    )
    if (!hasPhoto) {
      steps.push({
        key: 'photo',
        to: '/me/photos',
        icon: Camera,
        title: t('done.photo_title'),
        text: t('done.photo_text'),
      })
    }
    if (!verification.id_verified && !verification.pending.id_document) {
      steps.push({
        key: 'verify',
        to: '/me/verification',
        icon: IdCard,
        tone: 'success',
        title: t('done.verify_title'),
        text: t('done.verify_text'),
      })
    }
    steps.push({
      key: 'privacy',
      to: '/settings/privacy',
      icon: SlidersHorizontal,
      title: t('done.privacy_title'),
      text: t('done.privacy_text'),
    })
  }

  return (
    <div className="flex flex-col gap-6" data-screen="ONB-DONE">
      <div className="flex flex-col items-center gap-4 pt-4 text-center">
        <OrnamentRule centered />
        <DisplayHeading as="h1">{t('done.title')}</DisplayHeading>
        <p className="max-w-measure text-body-lg text-foreground-secondary">{t('done.subtitle')}</p>
      </div>
      {profile.isPending ? (
        <CardSkeleton size="compact" />
      ) : (
        <ul className="flex flex-col gap-3">
          {steps.map((step) => (
            <li key={step.key}>
              <NudgeCard
                to={step.to}
                icon={step.icon}
                tone={step.tone}
                label={step.title}
                description={step.text}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        size="lg"
        fill="phone"
        onClick={() => void navigate({ to: '/home', replace: true })}
      >
        {t('done.matches')}
      </Button>
    </div>
  )
}
