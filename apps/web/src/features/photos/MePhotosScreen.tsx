// ME-PHOTOS (16 section 6.19, 08 section 5.5)
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '~/components/common/PageHeader'
import { Skeleton } from '~/components/ui/skeleton'
import { usePrivacy } from '~/features/me/queries'
import { useLabelOf } from '~/lib/reference'
import { PhotoManager } from './PhotoManager'

/**
 * Add, order and remove the own photos and see their review status. Block 1 is the privacy
 * line; the grid, rejection messages and photo rules come from `PhotoManager`.
 */
export function MePhotosScreen() {
  const { t } = useTranslation('photos')
  const privacy = usePrivacy()
  const label = useLabelOf()

  return (
    <div className="container-app flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('screen.title')} showBack />
      {privacy.data ? (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>
            {t('screen.privacy_line', {
              label: label('photo_visibility', privacy.data.photo_visibility),
            })}
          </span>
          <Link
            to="/settings/privacy"
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('screen.privacy_change')}
          </Link>
        </p>
      ) : privacy.isPending ? (
        <Skeleton className="h-6 w-2/3" />
      ) : null}
      <PhotoManager context="me" />
    </div>
  )
}
