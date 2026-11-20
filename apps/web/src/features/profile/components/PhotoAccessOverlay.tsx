import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button } from '~/components/ui/button'
import { useRequestPhotoAccess } from '~/features/relations/queries'
import type { PhotoAccessState } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/**
 * The overlay over blurred photos when `locked` contains `photos` (16 section 6.7, "Photo
 * access"): "{name}'s photos are private" with "Request photos" for `can_request`, the pending
 * text for `requested`, and the private text alone for `denied` and `requests_off` (a denial is
 * never named, 09 section 6.4). Nothing for `visible`.
 */
export function PhotoAccessOverlay({
  profileId,
  name,
  state,
  interactive = true,
  className,
}: {
  profileId: string
  name: string
  state: PhotoAccessState
  /** False in the owner's preview: the text without the request button. */
  interactive?: boolean
  className?: string
}) {
  const { t } = useTranslation('profile')
  const request = useRequestPhotoAccess()
  const online = useOnlineStatus()
  if (state === 'visible') return null

  return (
    <div
      data-photo-access={state}
      className={cn(
        'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-foreground/45 p-4 text-center text-background',
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-7" />
      <p className="max-w-xs font-medium">
        {state === 'requested' ? t('photo_access.requested') : t('photo_access.private', { name })}
      </p>
      {state === 'can_request' && interactive ? (
        <Button
          className="pointer-events-auto"
          loading={request.isPending}
          disabled={!online}
          onClick={(event) => {
            event.stopPropagation()
            request.mutate(profileId)
          }}
        >
          {t('photo_access.request')}
        </Button>
      ) : null}
    </div>
  )
}
