import { useTranslation } from 'react-i18next'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/utils'

/** The first load of a form screen (16 rule G1): label and input shapes, then the button. */
export function FormSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  const { t } = useTranslation('shared')
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-5', className)}>
      <span className="sr-only">{t('list.loading')}</span>
      {Array.from({ length: fields }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <div key={index} aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-11 w-full rounded-[var(--radius-input)]" />
        </div>
      ))}
      <Skeleton aria-hidden="true" className="h-11 w-32 rounded-[var(--radius-input)]" />
    </div>
  )
}
