import { useTranslation } from 'react-i18next'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'

/** "{n}% match" in the accent colour (17 section 10). Renders nothing when `compat` is null. */
export function CompatBadge({
  compat,
  className,
}: {
  /** 0..100, or null when there is no score. */
  compat: number | null
  className?: string
}) {
  const { t } = useTranslation('shared')
  if (compat === null) return null
  return (
    <Badge variant="accent" className={cn('tabular-nums', className)}>
      {t('compat', { value: Math.round(compat) })}
    </Badge>
  )
}
