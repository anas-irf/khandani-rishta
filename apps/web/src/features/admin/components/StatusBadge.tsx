import { useTranslation } from 'react-i18next'
import { Badge } from '~/components/ui/badge'
import { fallbackLabel } from '~/lib/reference'

type Variant = 'success' | 'warning' | 'danger' | 'secondary'

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
  admin: 'danger',
}

/**
 * A status or role as a badge. The text always carries the meaning; colour only supports it
 * (20 section 7). Unknown codes show as the code with spaces.
 */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('admin')
  return (
    <Badge variant={VARIANTS[status] ?? 'secondary'}>
      {t(`status.${status}`, { defaultValue: fallbackLabel(status) })}
    </Badge>
  )
}
