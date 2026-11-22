import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '~/components/ui/badge'
import type { Badge as BadgeCode } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/**
 * The earned checks, in the order of 12 section 1.2. `new` is not one of them: it is a label on
 * the photo (`MemberPhoto`). Unknown badges are ignored.
 */
export const VERIFICATION_BADGES: readonly BadgeCode[] = [
  'id_verified',
  'photo_verified',
  'phone_verified',
]

/**
 * Verification badges as words with a tick, by the name (12 section 1.2, DESIGN.md 6.3). Never
 * icons alone, and a tick means verified and nothing else.
 */
export function BadgeRow({
  badges,
  className,
}: {
  badges: readonly BadgeCode[]
  className?: string
}) {
  const { t } = useTranslation('shared')
  const earned = VERIFICATION_BADGES.filter((badge) => badges.includes(badge))
  if (earned.length === 0) return null

  return (
    <ul aria-label={t('badge.list')} className={cn('flex flex-wrap gap-2', className)}>
      {earned.map((badge) => (
        <li key={badge} className="inline-flex max-w-full">
          <Badge variant="success" data-badge={badge}>
            <Check aria-hidden="true" strokeWidth={2.8} />
            {t(`badge.${badge}`)}
          </Badge>
        </li>
      ))}
    </ul>
  )
}
