// ONB-DONE (07 section 15): the profile is live; three things that make a difference.
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ChevronRight,
  ImagePlus,
  type LucideIcon,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CardSkeleton } from '~/components/common/CardSkeleton'
import { ErrorState } from '~/components/common/ErrorState'
import { Button } from '~/components/ui/button'
import { useOwnProfile } from '~/features/profile-sections/queries'

type ActionCard = { key: string; to: string; icon: LucideIcon; title: string; text: string }

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

  const cards: ActionCard[] = []
  if (profile.data) {
    const { photos, verification } = profile.data
    const hasPhoto = photos.some(
      (photo) => photo.status !== 'rejected' && photo.status !== 'failed',
    )
    if (!hasPhoto) {
      cards.push({
        key: 'photo',
        to: '/me/photos',
        icon: ImagePlus,
        title: t('done.photo_title'),
        text: t('done.photo_text'),
      })
    }
    if (!verification.id_verified && !verification.pending.id_document) {
      cards.push({
        key: 'verify',
        to: '/me/verification',
        icon: ShieldCheck,
        title: t('done.verify_title'),
        text: t('done.verify_text'),
      })
    }
    cards.push({
      key: 'privacy',
      to: '/settings/privacy',
      icon: SlidersHorizontal,
      title: t('done.privacy_title'),
      text: t('done.privacy_text'),
    })
  }

  return (
    <div className="flex flex-col gap-6" data-screen="ONB-DONE">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('done.title')}</h1>
        <p className="text-muted-foreground">{t('done.subtitle')}</p>
      </div>
      {profile.isPending ? (
        <CardSkeleton />
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((card) => (
            <li key={card.key}>
              <Link
                to={card.to}
                className="flex min-h-11 items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-muted"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <card.icon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{card.title}</span>
                  <span className="text-sm text-muted-foreground">{card.text}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5 shrink-0 rtl:-scale-x-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        className="w-full md:w-auto md:self-start"
        onClick={() => void navigate({ to: '/home', replace: true })}
      >
        {t('done.matches')}
      </Button>
    </div>
  )
}
