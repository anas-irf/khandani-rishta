// ME-PHOTOS (16 section 6.19, 08 section 5.5)
import { useTranslation } from 'react-i18next'
import { Page } from '~/components/common/Page'
import { TextLink } from '~/components/common/TextLink'
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
    <Page
      title={t('screen.title')}
      showBack
      width="form"
      header={
        privacy.data ? (
          <p className="flex flex-wrap items-center gap-x-3 text-body-sm text-foreground-secondary">
            <span>
              {t('screen.privacy_line', {
                label: label('photo_visibility', privacy.data.photo_visibility),
              })}
            </span>
            <TextLink to="/settings/privacy">{t('screen.privacy_change')}</TextLink>
          </p>
        ) : privacy.isPending ? (
          <Skeleton className="h-6 w-2/3" />
        ) : null
      }
    >
      <PhotoManager context="me" />
    </Page>
  )
}
