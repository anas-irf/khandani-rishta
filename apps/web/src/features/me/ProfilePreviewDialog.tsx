import { Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { StatusBanner } from '~/components/common/StatusBanner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Skeleton } from '~/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { ProfileDetailView } from '~/features/profile/ProfileDetailView'
import { useProfilePreview } from '~/features/profile-sections/queries'
import type { OwnProfile } from '~/lib/api-types'

type Position = 'member' | 'connection'

/**
 * "See how others see this profile" (08 section 4, 09 section 13): the server's own rendering
 * of the profile for the tier `member` or `connection`, shown with the `APP-PROFILE` component
 * in read-only mode. The client adds only the owner-only notes; it has no visibility logic.
 */
export function ProfilePreviewDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: OwnProfile
}) {
  const { t } = useTranslation('me')
  const [position, setPosition] = useState<Position>('member')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('preview.close')} className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t('preview.title')}</DialogTitle>
          <DialogDescription>
            {t('preview.as', { position: t(`preview.${position}`) })}
          </DialogDescription>
        </DialogHeader>
        <ToggleGroup
          type="single"
          aria-label={t('preview.switch_label')}
          value={position}
          onValueChange={(value) => {
            if (value === 'member' || value === 'connection') setPosition(value)
          }}
        >
          <ToggleGroupItem value="member">{t('preview.member')}</ToggleGroupItem>
          <ToggleGroupItem value="connection">{t('preview.connection')}</ToggleGroupItem>
        </ToggleGroup>
        {profile.status !== 'active' ? (
          <p className="text-muted-foreground">
            {t('preview.not_visible', { status: t(`status_label.${profile.status}`) })}
          </p>
        ) : null}
        {open ? <PreviewBody position={position} profile={profile} /> : null}
      </DialogContent>
    </Dialog>
  )
}

const MODERATED = ['about_me', 'about_family', 'partner_notes'] as const

function PreviewBody({ position, profile }: { position: Position; profile: OwnProfile }) {
  const { t } = useTranslation('me')
  const preview = useProfilePreview(position)

  if (preview.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{t('preview.loading')}</span>
        <Skeleton className="aspect-[4/3] w-full max-w-sm" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
    )
  }
  if (preview.isError) {
    return (
      <ErrorState
        error={preview.error}
        onRetry={() => void preview.refetch()}
        retrying={preview.isFetching}
      />
    )
  }

  // Texts that are pending or rejected are absent from the response; the owner sees why.
  const hidden = MODERATED.filter((key) => profile.text_status[key] !== 'approved')
  return (
    <div className="flex flex-col gap-4" data-preview-as={position}>
      {hidden.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {hidden.map((key) => (
            <li key={key}>{t('preview.hidden_text', { text: t(`profile.moderation.${key}`) })}</li>
          ))}
        </ul>
      ) : null}
      <ProfileDetailView
        detail={preview.data}
        preview
        aside={
          <StatusBanner variant="info" icon={Info}>
            {t('preview.banner')}
          </StatusBanner>
        }
      />
    </div>
  )
}
