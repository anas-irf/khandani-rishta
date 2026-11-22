import { useTranslation } from 'react-i18next'
import { ArchInlay, Monogram } from '~/components/common/Arch'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Diamond } from '~/components/common/Ornament'
import { Button } from '~/components/ui/button'
import { useRequestPhotoAccess } from '~/features/relations/queries'
import type { PhotoAccessState } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/**
 * The layers over blurred photos when `locked` contains `photos` (16 section 6.7, "Photo
 * access"; DESIGN.md 6.8 and 7): veil, double gold line, monogram, then "{name}'s photos are
 * private" with "Request photos" for `can_request`, the pending text for `requested`, and the
 * private text alone for `denied` and `requests_off` (a denial is never named, 09 section 6.4).
 * Nothing for `visible`. It is drawn over the image as received: no blur here (16 rule G10).
 */
export function PhotoAccessOverlay({
  profileId,
  name,
  state,
  interactive = true,
  arch = false,
  className,
}: {
  profileId: string
  name: string
  state: PhotoAccessState
  /** False in the owner's preview: the text without the request button. */
  interactive?: boolean
  /** Over the gallery's arch, with its lines. */
  arch?: boolean
  className?: string
}) {
  const { t } = useTranslation('profile')
  const request = useRequestPhotoAccess()
  const online = useOnlineStatus()
  if (state === 'visible') return null
  const requested = state === 'requested'

  return (
    <div
      data-photo-access={state}
      className={cn(
        'pointer-events-none flex flex-col items-center justify-center gap-3 bg-muted/55 px-[20px] py-[24px] text-center text-foreground',
        arch && 'overflow-hidden rounded-arch-lg',
        className,
      )}
    >
      {arch ? <ArchInlay double /> : null}
      <Diamond className="size-[10px]" />
      <Monogram name={name} size="profile" />
      {/* Text never sits on a photo: it has its own fill (DESIGN.md 3.2). */}
      <p
        className={cn(
          'relative max-w-full rounded-lg bg-background px-3 py-2 text-balance',
          requested ? 'text-title-sm' : 'text-figure',
        )}
      >
        {requested ? t('photo_access.requested') : t('photo_access.private', { name })}
      </p>
      {state === 'can_request' && interactive ? (
        <Button
          size="compact"
          className="pointer-events-auto relative px-[16px]"
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
