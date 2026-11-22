import { useTranslation } from 'react-i18next'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/utils'

/** The first load of a form screen (16 rule G1): label and input shapes, then the button. */
export function FormSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  const { t } = useTranslation('shared')
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-6', className)}>
      <span className="sr-only">{t('list.loading')}</span>
      {Array.from({ length: fields }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <div key={index} aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-[48px] w-full rounded-input" />
        </div>
      ))}
      <Skeleton aria-hidden="true" className="h-[56px] w-2/5 rounded-pill" />
    </div>
  )
}
