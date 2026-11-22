import { CircleDot, CircleX, Clock, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '~/components/ui/badge'
import { fallbackLabel } from '~/lib/reference'

type Variant = 'success' | 'warning' | 'danger' | 'tag' | 'secondary'

/** An icon beside the words. No tick: that means verified (DESIGN.md 6.6). */
const ICONS: Partial<Record<Variant, LucideIcon>> = {
  success: CircleDot,
  warning: Clock,
  danger: CircleX,
}

const VARIANTS: Record<string, Variant> = {
  active: 'success',
  approved: 'success',
  verified: 'success',
  actioned: 'success',
  promoted: 'success',
  pending: 'warning',
  pending_review: 'warning',
  open: 'warning',
  in_review: 'warning',
  changes_requested: 'warning',
  suspended: 'warning',
  deletion_scheduled: 'warning',
  rejected: 'danger',
  banned: 'danger',
  closed: 'danger',
  failed: 'danger',
  admin: 'tag',
}

/**
 * A status or role as a badge. The text always carries the meaning; colour only supports it
 * (20 section 7). Unknown codes show as the code with spaces.
 */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('admin')
  const variant = VARIANTS[status] ?? 'secondary'
  const Icon = ICONS[variant]
  return (
    <Badge variant={variant}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {t(`status.${status}`, { defaultValue: fallbackLabel(status) })}
    </Badge>
  )
}
