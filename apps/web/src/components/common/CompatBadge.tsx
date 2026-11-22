import { cva, type VariantProps } from 'class-variance-authority'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'
import { Percent } from './Percent'

const compatVariants = cva(
  'inline-block w-fit max-w-full rounded-pill bg-success text-success-foreground',
  {
    variants: {
      size: {
        default: 'px-[14px] py-[6px] text-label-md [&>strong]:text-figure',
        compact: 'px-3 py-1 text-label-sm [&>strong]:text-title-sm [&>strong]:font-bold',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

/**
 * The match pill (DESIGN.md 6.5): "{n}% match" on success, the number set larger. Renders nothing
 * when `compat` is null.
 */
export function CompatBadge({
  compat,
  size,
  className,
}: {
  /** 0..100, or null when there is no score. */
  compat: number | null
  className?: string
} & VariantProps<typeof compatVariants>) {
  const { t } = useTranslation('shared')
  if (compat === null) return null
  return (
    <span data-slot="compat-badge" className={cn(compatVariants({ size }), className)}>
      <Percent text={t('compat', { value: Math.round(compat) })} />
    </span>
  )
}
