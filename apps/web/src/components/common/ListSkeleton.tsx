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
      className={cn(
        size === 'full'
          ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
          : 'flex flex-col gap-3',
        className,
      )}
    >
      <span className="sr-only">{t('list.loading')}</span>
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <CardSkeleton key={index} size={size} />
      ))}
    </div>
  )
}
