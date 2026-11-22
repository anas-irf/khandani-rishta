import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'
import { CardSkeleton } from './CardSkeleton'

/**
 * The first load of a list (16 rule G1): skeleton cards in the list's layout, announced once
 * as "Loading".
 */
export function ListSkeleton({
  count = 4,
  size = 'compact',
  className,
}: {
  count?: number
  /** `full` for card grids (matches, search), `compact` for rows. */
  size?: 'full' | 'compact'
  className?: string
}) {
  const { t } = useTranslation('shared')
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(size === 'full' ? 'card-grid' : 'flex flex-col', className)}
    >
      <span className="sr-only">{t('list.loading')}</span>
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
          key={index}
          size={size}
          className={size === 'full' ? 'wide:mb-10' : undefined}
        />
      ))}
    </div>
  )
}
