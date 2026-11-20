import { BadgeCheck, IdCard, type LucideIcon, Smartphone, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { Badge } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/** Display order of 12 section 1.2. Unknown badges are ignored. */
export const BADGE_ORDER: readonly Badge[] = [
  'id_verified',
  'photo_verified',
  'phone_verified',
  'new',
]

const ICONS: Record<Badge, LucideIcon> = {
  id_verified: IdCard,
  photo_verified: BadgeCheck,
  phone_verified: Smartphone,
  new: Sparkles,
}

const TONE: Record<Badge, string> = {
  id_verified: 'text-success',
  photo_verified: 'text-success',
  phone_verified: 'text-success',
  new: 'text-accent',
}

/**
 * Earned badges as small icons after a name (16 section 1.5, 12 section 1.2). Each icon has
 * its label as the accessible name and as a tooltip; tooltips never carry information alone.
 */
export function BadgeRow({
  badges,
  tooltips = true,
  className,
}: {
  badges: readonly Badge[]
  /** Hover tooltips; switch off where the row sits under a stretched link. */
  tooltips?: boolean
  className?: string
}) {
  const { t } = useTranslation('shared')
  const earned = BADGE_ORDER.filter((badge) => badges.includes(badge))
  if (earned.length === 0) return null

  return (
    <ul aria-label={t('badge.list')} className={cn('inline-flex list-none gap-1 p-0', className)}>
      {earned.map((badge) => {
        const Icon = ICONS[badge]
        const label = t(`badge.${badge}`)
        const icon = (
          <span
            role="img"
            aria-label={label}
            data-badge={badge}
            className={cn('inline-flex items-center', TONE[badge])}
          >
            <Icon aria-hidden="true" className="size-4" />
          </span>
        )
        return (
          <li key={badge} className="inline-flex">
            {tooltips ? (
              <Tooltip>
                <TooltipTrigger asChild>{icon}</TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ) : (
              icon
            )}
          </li>
        )
      })}
    </ul>
  )
}
